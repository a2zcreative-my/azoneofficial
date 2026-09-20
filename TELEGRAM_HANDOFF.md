# TELEGRAM_HANDOFF.md

**Hankei's ordering and payment verification — the integration contract.**
Version 1 of the API. Portal release v1.166.0. Written for whoever builds the
Telegram adapter (Astra GPT).

---

## 0. The one rule this whole module exists to enforce

**A receipt, an OCR result, a customer declaration or a Telegram message never
marks a payment as verified.**

A person opens Maybank, finds the incoming transaction in the receiving
account's own record, and allocates it to an order in the staff portal. Until
that happens the order is `awaiting_review` and nothing ships.

The API you are building against **has no endpoint that can verify a payment**,
and none can be added to it without also changing the portal's permission
matrix and its session authentication. Not "should not" — cannot. The
simulator (§11) demonstrates the refusal.

The second rule follows from the first: **rejecting a receipt is a statement
about the evidence, never about the bank.** The Bahasa Melayu copy in
`worker/src/hankeis-core.ts` says so explicitly (`BM.receipt_rejected`:
*"Ini BUKAN bermakna pembayaran anda gagal"*). Do not paraphrase it into
"your payment failed" when you render it.

---

## 1. Architecture, and where everything lives

The portal is a Cloudflare Worker (`azoneofficial-api`) over D1 (SQLite) and
R2, with a Next.js static export as its front end. Hankei's is four files
plus one migration.

| File | What it is |
|---|---|
| `worker/migrations/0135_hankeis_commerce.sql` | Every `hk_*` table. Additive; nothing pre-existing is altered. |
| `worker/src/hankeis-core.ts` | Pure logic, no database: state machines, pricing, the upload gate, the BM copy, the OCR seam. Directly unit-testable. |
| `worker/src/hankeis.ts` | Staff side. Ordering, receipts, **`verifyPayment`**, exceptions, refunds, shipments, settings, credentials, expiry. Mounted at `/api/v1/staff/hankeis/*` behind the portal session. |
| `worker/src/hankeis-api.ts` | **Your surface.** Mounted at `/api/v1/hankeis/*`, bearer token only, no cookies, no CORS, no session. |
| `components/portal/hankeis-panel.tsx` | The staff screens, including the payment-review screen where verification happens. |
| `tests/hankeis.mjs` | 185 checks; runs the real modules against real SQLite. |
| `scripts/hankeis-simulator.mjs` | Development-only walkthrough of this whole document. |

The mount point is the first thing `route()` does in `worker/src/index.ts`,
**before** any session machinery, which is why a bearer token never touches
the cookie path and a session never reaches your routes.

### The three states an order has

They are independent on purpose — an order can be paid and unfulfilled, or
cancelled and refunded.

```
order_state       open | quote_required | cancelled | closed
payment_state     awaiting_payment | awaiting_review | clarification_required | verified | refunded
fulfilment_state  not_ready | ready_to_pack | packing | shipped | delivered | on_hold
```

`fulfilment_state` can only leave `not_ready` when `payment_state === 'verified'`.
That is checked in `canFulfil()` **and** in the SQL that writes the shipment.

---

## 2. Base URL, authentication and scopes

```
https://a2zcreative.my/api/v1/hankeis
Authorization: Bearer hk_xxxxxxxx…
```

The token is minted in the portal by the owner: **Hankei's → Settings →
integration credentials**. It is shown **once**; only its SHA-256 hash is
stored (`hk_api_clients.token_hash`), and comparison is constant-time.
There is no way to read it back — if it is lost, revoke and mint another.

**Keep the token in an environment variable or your platform's secret
manager. Never in source, a message, a log line or a screenshot.**

Scopes are a space-separated list on the credential. Ask for the least you
need:

| Scope | Unlocks |
|---|---|
| `catalogue` | `GET /catalogue`, `GET /qr` |
| `customers` | `POST /customers`, `POST /addresses` |
| `orders` | `POST /quote`, `POST /orders`, `POST /orders/{no}/cancel` |
| `receipts` | `POST /orders/{no}/receipt` |
| `status` | `GET /orders/{no}` |
| `events` | `POST /events/claim`, `/ack`, `/nack` |

A missing scope is `403 forbidden`. There is **no scope that grants payment
verification, settings, pricing, customer category, refunds or another
customer's data**, because no route on this surface does any of those things.

---

## 3. Customer identity and ownership

**Bind customers by `telegram_user_id` — the numeric id from the authenticated
Telegram update (`message.from.id`).** Never `@username`: a username can be
released and claimed by somebody else, and that would hand them another
person's order history.

- The id must be a positive integer. A negative number is a *chat* id (a
  group), never a user, and is rejected `400`.
- Take it from the update object Telegram sent you. **Never from message text
  a customer typed**, and never from a deep link a customer can craft.
- `hk_customers.telegram_user_id` is `UNIQUE`. One Telegram account maps to
  one customer record.

**Ownership is re-checked against the database on every single request.** A
customer asking for an order that belongs to somebody else gets exactly the
same answer as one asking for an order number that does not exist:

```
404 {"error":{"code":"not_found","message":"No such order"}}
```

Identical, deliberately: otherwise the difference between the two answers
would be a way to enumerate order numbers. Do not "helpfully" distinguish
them in your own copy.

**`category` (retail / agent / stockist) decides pricing and package
eligibility, and a client cannot set it.** `POST /customers` on an existing
mapping refreshes the name and phone and *ignores* any category sent. Staff
assign it in the portal.

---

## 4. The endpoints

Every response carries `api_version: 1`. Every error is
`{"error":{"code":"...","message":"..."}}`.

### `GET /health` — the only unauthenticated route

```json
{ "ok": true, "api_version": 1,
  "configured": { "qr": true, "recipient": true, "receiving_account": true },
  "note": "Payment verification is manual and staff-only. No endpoint on this surface can verify a payment." }
```

Use it as a readiness probe. `configured.qr === false` means the owner has not
uploaded the QR yet — do not take orders.

### `GET /catalogue?telegram_user_id=123` — the menu

`telegram_user_id` is optional; supplying it filters packages to the ones that
customer may buy. The filter is a courtesy for rendering the menu: the server
re-checks eligibility on every quote and every order, so a client that ignores
it gains nothing.

```json
{ "api_version": 1, "customer_category": "retail",
  "products": [{ "id": 1, "sku": "HK-SER-30", "name": "Serum 30ml", "unit_price_cents": 12900 }],
  "packages": [], "currency": "MYR",
  "payment": { "recipient_name": "HANKEIS ENTERPRISE", "instructions_bm": "…", "disclaimer_bm": "…" } }
```

### `GET /qr` — the static Maybank QR image

Returns the image bytes (`image/png` or whatever was uploaded). Every other
response gives you `qr_image_key`, which is a key in our R2 bucket and
resolves to nothing outside the worker — this route is how you actually send
the customer a picture. Cache it: the QR is static and does not expire.

`503 not_configured` if the owner has not set one yet.

**The receiving account number is not on this route and is not anywhere on
this surface.** Customers check the *recipient name* on their own banking app
before they pay. That is the check we ask them to make.

### `POST /customers` — bind a Telegram user

```json
{ "telegram_user_id": 884412991, "name": "Nurul Aina", "phone": "0123456789" }
→ 201 { "api_version": 1, "customer_id": 2, "telegram_user_id": 884412991, "category": "retail", "created": true }
```

Idempotent by nature: a second call returns `200` with `created: false`.

### `POST /addresses`

```json
{ "telegram_user_id": 884412991, "recipient": "Nurul Aina", "phone": "0123…",
  "line1": "12 Jalan Melur 3", "line2": null, "postcode": "43000", "city": "Kajang", "state": "Selangor" }
→ 201 { "api_version": 1, "address_id": 3 }
```

### `POST /quote` — the authoritative total

```json
{ "telegram_user_id": 884412991, "lines": [{ "product_id": 1, "qty": 2 }] }
```

```json
{ "api_version": 1, "customer_category": "retail",
  "lines": [{ "name": "Serum 30ml", "sku": "HK-SER-30", "qty": 2, "unit_price_cents": 12900, "line_total_cents": 25800 }],
  "subtotal_cents": 25800, "shipping_cents": 800, "total_cents": 26600,
  "needs_quote": false, "currency": "MYR",
  "display": { "subtotal": "RM 258.00", "shipping": "RM 8.00", "total": "RM 266.00" },
  "message_bm": "Jumlah perlu dibayar: RM 266.00. Sila imbas kod QR Maybank …",
  "note": "This quote is authoritative. Prices sent by a client are ignored - the order is priced again on creation." }
```

**Any price field you send is discarded.** `unit_price_cents`,
`line_total_cents`, `total_cents` in a request body are read past. The order
is priced again from the catalogue when it is created, so a quote that has
gone stale cannot become a cheap order.

`needs_quote: true` means shipping for that address has to be priced by a
person. Tell the customer the total is coming; do not invent one.

### `POST /orders`

Send `Idempotency-Key`. Telegram delivers updates more than once.

```json
{ "telegram_user_id": 884412991, "address_id": 3, "lines": [{ "product_id": 1, "qty": 2 }], "note": "gift wrap" }
```

```json
201 { "api_version": 1, "order_no": "HK-260920-0007", "total_cents": 26600,
      "needs_quote": false, "reserved_until": "2026-09-21 02:55:55",
      "payment": { "recipient_name": "HANKEIS ENTERPRISE", "qr_image_key": "hk/qr/static.png",
                   "amount_cents": 26600, "amount_display": "RM 266.00",
                   "instructions_bm": "…", "disclaimer_bm": "…" },
      "message_bm": "Jumlah perlu dibayar: RM 266.00 …" }
```

Lines may be `{product_id, qty}` or `{package_id, qty}`. A package the
customer's category is not eligible for is refused `400`. Stock is reserved
until `reserved_until`; see §8.

### `GET /orders/{order_no}?telegram_user_id=123` — what to show the customer

```json
{ "api_version": 1, "order_no": "HK-260920-0007",
  "order_state": "open", "payment_state": "awaiting_review", "fulfilment_state": "not_ready",
  "subtotal_cents": 25800, "shipping_cents": 800, "total_cents": 26600, "total_display": "RM 266.00",
  "expires_at": "2026-09-21 02:55:58",
  "lines": [ … ], "receipts": [{ "id": 1, "state": "submitted", "created_at": "…" }],
  "shipment": null,
  "payment_instructions": { "recipient_name": "…", "qr_image_key": "…", "instructions_bm": "…", "disclaimer_bm": "…" },
  "message_bm": "Resit anda telah diterima dan sedang menunggu semakan …" }
```

`message_bm` is written to be sent as-is and always matches the current state.
Prefer it over composing your own sentence.

### `POST /orders/{order_no}/receipt?telegram_user_id=123` — see §5

### `POST /orders/{order_no}/cancel`

```json
{ "telegram_user_id": 884412991, "reason": "changed my mind" }
```

Allowed **only** while `payment_state === 'awaiting_payment'`. Once a receipt
exists, or the payment is verified, it is `409 not_allowed` — money is
involved and a person decides. Releases the stock reservation.

### `POST /events/claim`, `/events/ack`, `/events/nack` — see §7

---

## 5. Uploading a receipt

```
POST /orders/HK-260920-0007/receipt?telegram_user_id=884412991
     &declared_amount_cents=26600&declared_reference=TRF2209     (both optional)
Content-Type: image/jpeg
<raw file bytes as the request body>
```

**Send the file bytes, not a Telegram `file_id`.** Download the file from
Telegram first (`getFile` → download) and POST the body. We never call
Telegram; we hold no bot token.

| Rule | Value |
|---|---|
| Accepted types | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` |
| Size | 64 bytes – 8 MB |
| Type check | **Magic bytes**, not the header. A PDF renamed `.jpg` is refused `type_mismatch` and never written. |
| Rate limit | `uploads_per_hour` per customer (default 10) → `429 rate_limited` |
| Storage key | `hk/receipts/<uuid>` — unguessable, never the order number |
| Duplicate detection | SHA-256 of the bytes; the staff screen shows "same file as N other uploads". It does not block the upload. |

```json
201 { "api_version": 1, "receipt_id": 1, "payment_state": "awaiting_review",
      "message_bm": "Resit anda telah diterima dan sedang menunggu semakan …",
      "disclaimer_bm": "Muat naik resit BUKAN pengesahan pembayaran …",
      "note": "Stored as evidence. A human must still find this transaction in the bank before the payment is verified." }
```

**Send `disclaimer_bm` to the customer.** Do not follow the upload with a tick
emoji, "Payment received", "Order confirmed" or anything a person would read
as confirmation.

`declared_amount_cents` and `declared_reference` are the *customer's claim*.
They are stored, shown to the reviewer labelled as a declaration, and are
**never** evidence. A declaration that matches the total exactly still does
not verify anything.

**Idempotency nuance, specific to this route:** because hashing an 8 MB body
on every retry is wasteful, the stored request fingerprint for uploads is the
`Idempotency-Key` itself, not a hash of the file. So the *same key with a
different file* replays the first response instead of storing the second file.
Use a key derived from the Telegram update id, which is what you want anyway.

### OCR

**There is no OCR engine configured in this project, and nothing pretends
otherwise.** `worker/src/hankeis-core.ts` exposes a registration seam
(`registerOcrAdapter` / `ocrAvailable`) that returns `null` when no engine is
registered. Receipts are stored with `ocr_state = 'unavailable'` and the staff
screen says: *"No OCR engine is configured, so no extraction was attempted."*

If an engine is added later, its output is a **reading aid** displayed beside
the receipt. It cannot verify anything, and a confidence score is not evidence
at any value.

---

## 6. State transitions you will observe

```
                    POST /orders
                         │
                 awaiting_payment ──── cancel (customer, only here) ──► cancelled
                         │                                    expiry ──► stock released
                  receipt uploaded
                         │
                  awaiting_review ◄──────────────┐
                    │        │                   │
   staff: clarify   │        │  staff: reject receipt (evidence unusable —
                    ▼        │   makes NO claim about the bank)
          clarification_required ──── new receipt ──┘
                         │
      STAFF ONLY, hankeis_verify, having read Maybank:
      allocate bank transaction + attest
                         ▼
                     verified ───► fulfilment ready_to_pack ──► shipped
                         │
             staff: refund (records an EXTERNAL transfer) ──► refunded
```

Transitions your credential can cause: `awaiting_payment → awaiting_review`
(upload), and `→ cancelled` (cancel, from `awaiting_payment` only). That is
the complete list.

**`verified` is reachable only by a signed-in staff member holding
`hankeis_verify`** who supplies, in one request: the receiving account, the
bank reference, the amount, the transaction time, and an explicit attestation
that they read the bank record. The whole thing is one `env.DB.batch()` — one
transaction — whose first statement is a conditional insert into
`hk_bank_allocations`, which carries:

```sql
UNIQUE (receiving_account, bank_reference)
```

**One bank transaction cannot pay for two orders**, and two reviewers pressing
approve at the same moment produce exactly one verification; the loser is told
so and writes no second audit trail. This is proven by concurrency tests in
`tests/hankeis.mjs`, not asserted here.

Placeholder references (`n/a`, `-`, `test`, `0`, `1234`, anything under 4
characters) are refused. **An identifier is never manufactured to let an
approval through.** If the bank record cannot identify the transfer, the
reviewer asks the customer for clarification instead.

### Refunds

A refund in this system **records that a person made a transfer in Maybank**.
The portal moves no money and never claims to. A refund is requested, then
confirmed with its own bank reference once the transfer has actually been
made.

---

## 7. Notifications: the outbox

The worker never calls Telegram. It writes events to `hk_outbox`, in the same
transaction as the state change that caused them, and **you pull them**.

```
POST /events/claim   { "limit": 20, "visibility_seconds": 60 }
POST /events/ack     { "event_ids": ["<uuid>", …] }
POST /events/nack    { "event_id": "<uuid>", "error": "telegram 429" }
```

```json
{ "api_version": 1, "delivery": "at-least-once", "claim_expires_at": "2026-09-20 02:56:58",
  "events": [{
    "event_id": "7168b727-11f0-4116-897e-d427854291b0",
    "event_type": "order.created", "payload_version": 1,
    "order_no": "HK-260920-0001", "telegram_user_id": 770000001,
    "attempts": 1, "created_at": "2026-09-20 02:55:58",
    "payload": { "order_no": "…", "total_cents": 26600, "payment_state": "awaiting_payment",
                 "message_bm": "…", "event_type": "…", "event_id": "…", "occurred_at": "…" } }] }
```

Event types (`EVENT_TYPES` in `hankeis-core.ts`):

`order.created` · `order.quoted` · `receipt.received` ·
`payment.clarification_requested` · `receipt.rejected` · `payment.verified` ·
`order.expired` · `order.cancelled` · `shipment.created` · `refund.confirmed`

**Delivery is at-least-once, and this is not going to change.** A claim that
is never acknowledged — your process died, Telegram timed out, the network
dropped — returns to the queue when `claim_expires_at` passes and is handed
out again. **Nobody can promise exactly-once delivery across two systems, and
this document does not.**

What that requires of you:

1. **Keep a record of `event_id`s you have already sent** and skip repeats.
   `event_id` is a UUID, stable across redeliveries.
2. **Ack only after Telegram has accepted the message**, never before.
3. **Nack on failure**, with the error. After 10 attempts an event is
   dead-lettered (`state='dead'`) rather than retried for ever.
4. Every payload is **self-describing and idempotent to render**: it carries
   the current state, so a duplicate `payment.verified` renders the same
   sentence rather than a second "payment received!".

**A dead, lost, duplicated or never-acknowledged event changes no payment
state.** The outbox is a notification channel, not a source of truth. If your
consumer is offline for a day, orders are still correct when it comes back;
`GET /orders/{no}` is always authoritative.

`telegram_user_id` on an event can be `null` if the order was raised in the
portal for a walk-in customer who has no Telegram mapping. Skip those.

---

## 8. Reservations and expiry

Creating an order reserves stock until `reserved_until` (`reservation_minutes`,
default 1440 = 24 h). A cron in `worker/src/index.ts` runs `expireOrders()`
every 5 minutes: it releases lapsed reservations and emits `order.expired`.

**The QR does not expire, and the BM copy says so:**

> *"Tempahan stok untuk pesanan ini telah tamat tempoh. Kod QR tidak tamat
> tempoh — jika anda telah membayar, sila muat naik resit dan kami akan semak
> secara manual."*

A customer who paid an hour late has still paid. An expired order accepts a
receipt and goes to review like any other. Do not tell them their payment
failed.

---

## 9. Errors

| HTTP | code | What it means |
|---|---|---|
| 400 | `invalid_input` | Missing or malformed field; the message names it. |
| 401 | `unauthorized` | Bad, missing or revoked bearer token. Do not retry with the same token. |
| 403 | `forbidden` | Your credential lacks that scope. |
| 404 | `not_found` | Unknown route, unknown order, **or an order belonging to someone else**. |
| 409 | `conflict` | Telegram id already mapped. |
| 409 | `idempotency_conflict` | Same `Idempotency-Key`, different request body. Use a fresh key. |
| 409 | `not_allowed` | Cancel attempted after money was involved. |
| 413 | `too_large` | Body > 256 KB, or receipt > 8 MB. |
| 429 | `rate_limited` | Upload limit for that customer this hour. |
| 503 | `not_configured` | No QR configured yet. |
| 503 | `pending_migration` | Migration 0135 has not been applied to that database. |

Retry policy: retry `429` and `5xx` with backoff **and the same
`Idempotency-Key`**. Never retry `4xx` unchanged. A `409
idempotency_conflict` means your key was reused for different content — that
is a bug in your key derivation, not a transient failure.

---

## 10. Connecting Telegram — the actual steps

Nothing below changes any business logic. It is all adapter work.

1. **Ask the owner to mint a credential.** Portal → Hankei's → Settings →
   integration credentials. Name it, choose scopes, copy the token once.
2. **Put it in your environment.** See `hankeis-bot.env.example` in this
   repository. Never in source or a message.
3. **Create the bot with @BotFather** and hold the bot token **on your side
   only**. The portal does not have it, does not want it, and has no field
   for it.
4. **Confirm reachability:** `GET /health` with your token. Check
   `configured.qr`.
5. **Handle `/start`:** `POST /customers` with `message.from.id`.
6. **Render the menu** from `GET /catalogue`, and send the picture from
   `GET /qr`.
7. **Quote before promising.** `POST /quote`, show `display.total`.
8. **Create the order** with an `Idempotency-Key` derived from the Telegram
   update id. Send `payment.*` and `message_bm` as they come back.
9. **On a photo or document:** download from Telegram, `POST …/receipt` with
   the bytes. Reply with `message_bm` **and** `disclaimer_bm`. No tick, no
   "confirmed".
10. **Run a consumer loop:** claim → send → ack, deduplicating on `event_id`,
    nacking on failure. Every 5–15 seconds is plenty.
11. **Never build:** a verify command, an admin command, a "mark as paid"
    button, a way to set a customer's category, or anything that reads
    another customer's order. None of them have an endpoint.
12. **Test against a preview deployment first.** The simulator in live mode
    creates real orders in whatever database the worker is bound to.

---

## 11. The simulator

```bash
node scripts/hankeis-simulator.mjs
```

Runs offline: it bundles the real worker modules and executes them against an
in-memory SQLite database with migration 0135 applied. No token, no bot, no
deployment, nothing leaves the machine. It walks all twelve steps of this
document and prints every request and response, including the refusals when
it tries to verify a payment with an integration credential.

```bash
node scripts/hankeis-simulator.mjs --base https://<host>/api/v1/hankeis \
                                   --token hk_xxx --telegram-id 123456789
```

The same journey over HTTP against a running worker. **This creates real
orders** — point it at a preview deployment.

The file is development-only: nothing in the portal, the worker or the guard
suite imports it.

---

## 12. What is done, and what is not

**Implemented and tested** (185 checks in `tests/hankeis.mjs`, run against a
real SQLite database with the real migration, plus the full 81-guard suite and
a browser render of the staff screens):

- The schema, all 19 tables, additive.
- Ordering, server-side pricing, package eligibility by customer category.
- Stock reservation, oversell prevention, expiry with release.
- Receipt upload with magic-byte validation, unguessable keys, duplicate
  detection, per-customer rate limiting.
- Manual verification: atomic, unique per bank transaction, race-safe,
  finance-only, with a full audit and event trail.
- Exceptions (underpaid, overpaid, late, duplicate, mismatch), refund
  recording, shipments gated on verification.
- The integration API: scoped tokens, idempotency, ownership isolation, the
  outbox with claim/ack/nack.
- The staff portal section, including the payment-review screen.

**Needs configuration before first use** (owner, in the portal):

- The static Maybank QR image, the recipient name, the receiving account.
- Products, prices and any packages.
- An integration credential for the bot.

**Not built here, and waiting on the Telegram adapter:**

- The bot itself, its menus and its conversation flow.
- Downloading files from Telegram and forwarding the bytes.
- The outbox consumer loop and message delivery.
- Any webhook endpoint Telegram calls — that lives on your side, not in this
  worker.

**Known limitations, stated rather than hidden:**

- **No OCR engine exists.** The seam is there; it returns `null`, and the UI
  says so.
- **No bank API.** Verification is a person reading Maybank. That is the
  design, not a gap to close later with automation.
- **Delivery is at-least-once**, never exactly-once. Deduplicate on
  `event_id`.
- A multi-line order whose reservation partially fails is compensated by
  releasing what was taken, not by a true rollback — D1 has no interactive
  transactions, so a conditional insert per line inside one batch is the
  closest correct construction.
- The portal records refunds; it does not move money.
