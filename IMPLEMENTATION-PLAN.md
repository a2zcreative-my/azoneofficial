# IMPLEMENTATION PLAN — A2Z portal ⇄ ELFIA, and the road to a full business system

**Status:** Active — Track A code-complete (v1.35.0–v1.38.0 built, awaiting one push + secrets); Track B next
**Owner:** Alīf
**Target system:** `azoneofficial` (website) + `azoneofficial-api` (Worker) + D1 `azoneofficial`
**Portal version at time of writing:** v1.34.0 · 74 migrations (latest `0074_customer_brand`)
**Counterpart system:** ELFIA OFFICIAL STORE (`elfiaofficialstore.my`) — Next.js + Worker `elfia-api` + D1 `elfia-store` + R2 `elfia-media`
**Created:** 22 August 2026
**Last revised:** 22 August 2026 · rev 0.4 (see [Revision log](#revision-log))

---

## 0. How to use this document

This is a **living document**. It is not a one-off proposal — it is the file we edit every time scope, sequencing or a requirement changes, so that "what we agreed" and "what is being built" never drift apart.

**Rules for keeping it alive**

| Rule | Detail |
|---|---|
| One home | `IMPLEMENTATION-PLAN.md` at the root of the portal repo, next to `ROADMAP.md` and `CHANGELOG.md`. |
| Edit, never fork | Do not create `IMPLEMENTATION-PLAN-v2.md`. Change this file and add a line to the [Revision log](#revision-log). |
| Status per item | Every deliverable carries a status marker: `☐ not started` · `◐ in progress` · `☑ shipped` · `✗ dropped` (with a reason) · `⏸ parked`. |
| Shipped means shipped | An item flips to `☑` only when its **acceptance criteria** pass and a `CHANGELOG.md` entry exists. The version that shipped it goes in the item's row. |
| The CEO's words win | When a requirement changes in conversation, paste the quote into the item. That is how the CHANGELOG is already written; the plan should match. |
| Facts get a citation | Anything asserted about the current system names a file and, where useful, a line. If a citation goes stale, the claim is suspect — re-check it. |
| Decisions get recorded | Anything with two defensible answers goes in [§13 Open decisions](#13-open-decisions), not in someone's head. |

**Sequencing decision already taken (22-08-2026):** Track A (ELFIA bridge) and Track B (HRM) run **in parallel**. Everything else queues behind them.

---

## 1. Executive summary

The portal is already a substantial business system: 74 migrations, ~11,700 lines of Worker code, 23 portal tabs, attendance with geofence, a three-stage leave chain, payroll with a Maybank M2E bulk-payment file, claims with an approval chain, quotation→invoice conversion with per-entity letterheads, a general ledger with auto-posting, and a cron-driven TikTok Shop sync.

What it is **not** yet:

1. **Connected to ELFIA.** One read-only endpoint exists (`GET /api/v1/bridge/elfia-inventory`). It sends `sku`, `name`, `stock` — no price. There is no way for the store to tell the portal it sold something, and no way for the portal to see a web order. The two systems therefore drift apart on every web sale. The store side is **already built and waiting**; the portal is the missing half.
2. **Statutory-complete on payroll.** There is no EPF, SOCSO, EIS or PCB anywhere in the schema. The UI says so out loud: *"No KWSP/SOCSO/EIS lines yet — registration pending."*
3. **A CRM.** `customers` is a contact list with a free-text `notes` column. The pipeline table (`prospects`) exists but its API and tab were deleted — while a cron still fires "Follow up today — Pipeline tab" notifications at a tab that no longer exists.
4. **Safe on one specific point.** Five real handwritten signatures are publicly downloadable from the live site (`public/signatures/*.png`). Recorded in `CHANGELOG.md` v1.34.0 as found-but-not-fixed. This plan schedules the fix.

The plan below is **seven tracks over roughly six months**, expressed as releases you can ship one at a time, each with schema, endpoints, UI, tests and acceptance criteria.

### Track map

| Track | Theme | Priority | Releases | Depends on |
|---|---|---|---|---|
| **A** | ELFIA bridge — two-way stock, price, orders | **P0** | v1.35 → v1.38 | — |
| **B** | HRM — statutory payroll, org chart, leave v2, appraisal, ATS | **P0** | v1.39 → v1.46 | — |
| **S** | Security & tech-debt (runs alongside, small) | **P0** | v1.35.1, v1.40.1 | — |
| **C** | CRM — customer 360, pipeline, quotation lifecycle | P1 | v1.47 → v1.51 | A (web orders land as customers) |
| **D** | Accounting & finance — payments, AR/AP, e-Invoice | P1 | v1.52 → v1.57 | C |
| **E** | Warehouse & purchasing — one stock ledger, locations, stock take | P1 | v1.58 → v1.62 | A (ledger is shared) |
| **F** | Analytics & BI | P2 | v1.63 → v1.66 | D, E |
| **G** | Mobile / PWA / notifications | P2 | v1.67 → v1.69 | — |

Version numbers are **placeholders for ordering**, not commitments. The repo bumps `package.json` only (house rule 6).

---

## 2. Ground rules this plan must obey

These are not suggestions — they are enforced by `npm run ci` (typecheck → 9 guards → build), which is Cloudflare's build command. A violation stops the deploy and the live site keeps serving the previous version.

| # | Rule | Where it bites |
|---|---|---|
| 1 | **Money is integer cents (sen).** Never a decimal, never a float. | Every new column. The ELFIA spec refuses anything that is not a positive integer. |
| 2 | **No foreign keys** in new migrations (house rule since v1.4.69). Note the rule is not universally kept — `0071_erp_core.sql:188-189` declares FKs on `journal_lines` after v1.4.69 — so confirm it still stands before the first new migration. | All new tables below are declared without FK. |
| 3 | **Append-only columns.** A retired field keeps its column (see `users.blood_type`). SQLite `CHECK` cannot be altered — changing one means a table rebuild with an explicit column list. | `0021_employment_status_values.sql` is the pattern to copy. |
| 4 | **Migration-skew defence.** Every optional-column write is wrapped so a pending migration degrades instead of 500-ing (the "v1.4.218 lesson"). | `staff.ts:3868-3886`, `erp.ts:669-676`. |
| 5 | **`tests/sql-schema-check.mjs` must pass.** It builds the cumulative schema into `node:sqlite` and PREPAREs every SQL literal found in `worker/src/*.ts` (620+ queries). | Any query referencing a column you forgot to migrate fails the build. |
| 6 | **`tests/worker-compile-gate.mjs` must pass.** Root `tsconfig.json` excludes `worker/`, and `wrangler deploy` uses esbuild (strips types without resolving) — this gate is the only real `tsc` over the Worker. | The 19-08 `url is not defined` outage. |
| 7 | **Every mutating request goes through `api()` / `csrfFetch()`** from `lib/api.ts`. A bare mutating `fetch()` fails `tests/csrf-guard.mjs`. | All new UI. |
| 8 | **Every user-facing string is bilingual** at the display point — `L("English","BM")` or `tr()`. Strings used in logic stay English. Every new tab in `ALL_TABS` needs a DICT entry. | `tests/bm-coverage.mjs`. |
| 9 | **Printed/official documents stay English** (payslip, claim form AZOO-HR-CLM-001, leave form, SOA, ID badge). | New statutory payslip lines follow this. |
| 10 | **Issuer is chosen at creation and never editable.** `DOCUMENT_ISSUER` and `AZ_ONE` bank identities are byte-stable forever. | `tests/document-issuer-guard.mjs`, `tests/doc-issuer-render.mjs`. |
| 11 | **Migrations apply from `main` only.** A Cloudflare preview is bound to the **real** D1. `scripts/deploy-api.sh` gates on `WORKERS_CI_BRANCH`; API previews are off. | Never "just try it on a preview". |
| 12 | **Two constants must be bumped with every migration:** `LATEST_MIGRATION` (`worker/src/index.ts:241`) and `EXPECTED_MIGRATIONS` (`worker/src/index.ts:~2869`). | `/api/v1/health` lies otherwise. |
| 13 | **One version number** — bump `package.json`, write a CHANGELOG entry addressed to the CEO. | House rule 6. |
| 14 | **Grid layouts need `grid-cols-1` as the mobile base**; use `overflow-x: clip`, not `hidden`. | Old iOS Safari. |

**Migration numbering from here:** the next free number is **`0075`**. This plan allocates `0075`–`0113`; if you ship out of order, keep the file numbers monotonic and update the table in [§12](#12-migration-allocation).

---

## 3. Current state — verified snapshot

Everything in this section was read out of the code on 22-08-2026. It is the baseline the plan builds on.

### 3.1 The bridge as it exists

`worker/src/index.ts:1482-1495`, registered **before** auth in `route()`:

```ts
if (path === "/api/v1/bridge/elfia-inventory" && method === "GET") {
  if (!env.ELFIA_BRIDGE_KEY) return errorResponse("not_configured", "Bridge is not enabled", 501);
  const given = request.headers.get("X-Bridge-Key") ?? "";
  if (!timingSafeEqual(given, env.ELFIA_BRIDGE_KEY)) return errorResponse("unauthorized", "Bad bridge key", 401);
  const { results } = await env.DB.prepare(
    `SELECT sku, name, stock FROM inventory_items
     WHERE UPPER(sku) LIKE 'ELFIA%' OR UPPER(sku) LIKE 'LUMI%'
     ORDER BY sku LIMIT 500`,
  ).all();
  return json({ items: results, as_of: new Date().toISOString() });
}
```

| Spec requirement | Portal today | Gap |
|---|---|---|
| **A** — inventory + price feed | Exists. Returns `sku, name, stock`. | **No `price_cents`.** Scoping is a SKU-prefix `LIKE`, not a flag. Hard `LIMIT 500`, no paging. |
| **B** — movements (store → portal) | **Does not exist.** No POST under `/api/v1/bridge/*`. | Entire endpoint, plus an idempotency store. `event_id` appears **zero times** in the repo. |
| **C** — orders feed (portal polls store) | **Does not exist.** Nothing outbound to the store. | Poller, cursor storage, an orders table, a UI to see web orders. |
| Shared secret | `ELFIA_BRIDGE_KEY` declared in `Env` (`index.ts:29-32`), compared with `timingSafeEqual` (`index.ts:112-117`). | **Not listed in `worker/wrangler.toml`'s secret block** — so on any deploy where it was never set by hand, the endpoint answers `501 not_configured`. |

The CHANGELOG states the current posture explicitly (v1.31.0): *"the portal is the counting house… the store is a consumer… nothing here pushes, nothing runs on a timer."*

### 3.2 Inventory & pricing

`inventory_items` (`0007_role_modules.sql:16-25`, extended since):

| Column | Source | Note |
|---|---|---|
| `id`, `sku` UNIQUE, `name`, `stock`, `status`, `note`, `updated_by`, `updated_at` | `0007` | `status` ∈ `in_stock \| low \| out_of_stock \| discontinued` |
| `unit_price_cents` NOT NULL DEFAULT 0 | `0037_lifecycle_money.sql:10` | the selling price |
| `live_rebate_cents` NOT NULL DEFAULT 0 | `0046_live_rebate.sql:6` | TikTok-live discount; net live price is **computed, never stored** |
| `low_alerted` | `0056` | low-stock cron dedupe |

There is **no** brand/site/tenant column on `inventory_items`, no cost price, no variants, no reorder point, no location.

**Stock is mutated in seven places** and only some of them leave a trail:

| # | Where | Trail written |
|---|---|---|
| 1 | `POST /inventory` create — `staff.ts:5569` | — |
| 2 | `PATCH /inventory/{id}` absolute set — `staff.ts:5588` | audit only |
| 3 | `POST /inventory/{id}/adjust` — `staff.ts:5833` | `manual_stockouts` (+ `manual_sales` when a sale price is given) |
| 4 | Invoice created → `deductForInvoice` — `staff.ts:5263` | `manual_stockouts` with `doc_id` |
| 5 | TikTok sync/webhook — `recordTiktokLine()`, `index.ts:524-549` | `postage_items`, **not** `manual_stockouts`, and **no ledger row at all** |
| 6 | PO goods receipt — `erp.ts:546-568` | `manual_stockouts` (INSERT at `erp.ts:560-563`) — **without `direction`, so a stock IN is recorded as `'out'`** (bug, see [S-3](#s-3--goods-receipt-writes-the-wrong-direction--release-v1351-)) |
| 7 | Supplier returns / replacements — `staff.ts:5944-6120` | `supplier_returns` |

`manual_stockouts` is the closest thing to a ledger but covers only 3, 4 and 6.

### 3.3 HR — what exists and what is missing

| Area | Exists | Missing |
|---|---|---|
| Staff records | `users` with employment, bank, IC, EPF/SOCSO/tax **ID strings**, emergency contact, address; `staff_documents` vault (R2 `private/staff-docs/`); `assets` register | No `manager_id`, no document expiry, no dependants, no confidential HR notes |
| Attendance | `attendance_records` (+ manual/amend, `selfie_key` retired), geofence in `system_meta.attendance_geofence` (HQ 1.5444/103.7100, r=120 m), hard-coded `SHIFT` 10:00–18:00 Mon–Fri | No shifts table, no per-person shift, no break punches (schema allows, code refuses), no late/absence counters |
| Overtime | `ot_records` + approval (`0054`), 1.5× normal-workday, weekday window opens 18:00 | No 2.0× rest-day / 3.0× public-holiday, no 104 h/month cap, **hours are typed into payroll by hand** |
| Leave | `leave_requests` with 3-stage chain (HR → pre-approve → CEO), `leave_balances`, `holidays` (23 rows seeded for 2026: 18 public + 5 company replacement) | **Only 2026 seeded.** No carry-forward, no maternity/paternity/compassionate/hospitalisation, no half-day flag, no encashment, MC upload not wired |
| Payroll | `payroll_entries` (UNIQUE user+month), `net_cents` single source of truth, hourly vs monthly, ÷26 divisor, `payslip_releases` gated to the 5th, `payroll_payments`, **Maybank M2E `.xlsm`** generator (`worker/src/m2e.ts`) | **EPF, SOCSO, EIS, PCB entirely absent.** No EA form, no CP8D, no Borang E, no employer share |
| Claims | `claims` with itemised lines, 4-stage chain, payee, payment proof | No per-category limits, no mileage rate, no advance/float |
| Permissions | `worker/src/permissions.ts` (58 lines) — 11 roles × **26** permission keys + `can(role, perm)` + `MANDATORY_2FA_ROLES`. `ROLE_RANK`/`atLeast()` live in `worker/src/index.ts:672-697`, not here. Runtime tab overrides in `system_meta.tab_access` | No roles/permissions **table** — the matrix is code. No hierarchy or inheritance |
| Absent entirely | — | Recruitment/ATS, performance appraisal, training records, disciplinary, org chart, self-service beyond phone number |

### 3.4 Commercial / ERP

- **Documents**: `sales_documents` — `QT`/`DO`/`INV`, items as a **JSON blob**, numbering `{TYPE}-AZOO{DDMMYY}-{X}` from `doc_counters_daily`. QT→INV conversion (one direction, reversible while unpaid). **DO is in no conversion chain.** QT has no status at all; `valid_until` is stored and nothing acts on it.
- **Money on the document**: one `paid_at` / `payment_method` / `payment_ref` triple per invoice — **no payments table, so no partial payments**. Receipts (`RC-…`) and credit notes (`CN-…`) exist; **nothing consumes a credit note** — it does not reduce revenue, cashflow or the GL. Aging exists **client-side only** (`app/portal/page.tsx:8894-8940`).
- **GL**: `gl_accounts` seeded with 15 Malaysian-SME codes; every bank movement drafts one balanced two-line journal entry, idempotent by `ref` (`shared.ts:93-156`). Nothing posts to `1200 Accounts receivable` or `2000 Accounts payable`. The ledger is read back only by `GET /erp/gl/journal` (`erp.ts:602-612`) and `GET /erp/gl/trial-balance` (`erp.ts:655`); `POST /erp/gl/journal` (`erp.ts:613-654`) also accepts a manual 2–50 line entry and refuses an unbalanced one.
- **Retired-but-retained**: `orders`/`order_lines` (API removed v1.19.0), `prospects` (API removed v1.5.0/v1.21.0), `bd_pipeline`, `ops_reports`. **A live orphan**: the prospects follow-up cron (`index.ts:1272-1294`) still notifies people to visit a deleted tab.
- **Duplication to be aware of**: two commission engines (`commission_rules` 0068 vs `commission_rates`/`commission_entries` 0071), two supplier systems (`supplier_returns` free-text vs `suppliers`+`purchase_orders`), two numbering schemes (`docNumber` vs `nextNo`), two renderers of the same document layout (`lib/doc-template.ts` + `lib/doc-pdf.ts`).

### 3.5 Infrastructure

| Thing | Value |
|---|---|
| Website worker | `azoneofficial` — static export from `out/`, build `npm run ci` |
| API worker | `azoneofficial-api` — `worker/src/index.ts`, routes `a2zcreative.my/api/*` + `www.` |
| D1 | `azoneofficial` (`d9df2d7a-8303-4396-a4ee-a26836a4c9a8`), binding `DB` |
| R2 | `azoneofficial`, binding `MEDIA` |
| KV / Queues / Durable Objects | **None.** SSE is used for notifications instead |
| Crons | `*/30 * * * *` (7 jobs incl. TikTok sync, low stock, housekeeping) · `20 19 * * *` (03:20 MYT backup) · `0 1 * * *` (09:00 MYT birthdays) |
| Secrets | `worker/wrangler.toml`'s comment block documents **five**: `SESSION_PEPPER`, `GOOGLE_CLIENT_SECRET`, `SETUP_TOKEN`, `TIKTOK_APP_SECRET`, `TIKTOK_WEBHOOK_SECRET`. **Undocumented but read by the code**: `ELFIA_BRIDGE_KEY` (`index.ts:29-32`), the VAPID trio (`index.ts:42-44`), `NOTIFY_WEBHOOK` (`staff.ts:179`). All four gaps should be fixed in the same edit |
| Deploy | push `dev` → guards + preview → PR to `main` → migrations apply, then health check |
| Frontend | `app/portal/page.tsx` is a **single 12,080-line client component** with 23 string-literal tabs; state is plain `useState`, tab memory in sessionStorage |

---

## 4. Track A — ELFIA bridge (P0)

**Goal:** the portal and the store never disagree about a piece of stock or a price, every web sale is recorded and traceable in the portal, and every web order is visible from the portal without opening the shop's admin.

**The store side is already finished.** `PORTAL-BRIDGE-SPEC.md` in the store repo is the contract; the store polls A every 5 minutes, pushes B immediately on every order (with an outbox, so nothing is lost when the portal is down), and answers C. **Everything in this track is portal-side work.**

**Direction of authority (do not blur this):**

- The **portal owns stock and price.** The store never sends absolute counts, only deltas.
- The **store owns the order.** The portal reads orders; it does not create or edit them.
- The store **refuses a stale count**: if a SKU still has undelivered movements, the store skips that SKU on its next pull rather than accepting a number computed before the portal heard about the sale. That is what stops the two systems fighting — so the portal must acknowledge movements honestly.

### A-0 · Design decisions taken up front

| Decision | Choice | Why |
|---|---|---|
| How does the portal know which SKUs go to ELFIA? | A new **`bridge_enabled`** flag on `inventory_items`, backfilled from the current `LIKE 'ELFIA%' OR LIKE 'LUMI%'` match. | The prefix hack silently includes/excludes items when someone renames a SKU. A flag is explicit, visible in the UI, and auditable. |
| Which price goes on the shop's price tag? | A new nullable **`elfia_price_cents`**. When set, that is what feed A sends. When `NULL`, fall back to `unit_price_cents`. **`live_rebate_cents` is never applied to the web price.** | `live_rebate_cents` is a TikTok-LIVE discount. Pushing it to the web shop would silently discount the website every time a live rebate is set. The spec says send the **net price the customer must actually pay** — so if you want a web rebate, set `elfia_price_cents` to the net figure. See [OD-1](#13-open-decisions). |
| Where do movements get recorded? | A new **`stock_ledger`** table (Track E's foundation, brought forward), plus the existing `manual_stockouts` row for continuity. | The bridge needs an append-only ledger anyway for idempotency and audit. Building it here means Track E inherits it instead of a second one. |
| Idempotency store | **`bridge_events`** with `UNIQUE(event_id)` and `INSERT … ON CONFLICT DO NOTHING`. | Exactly what the spec asks for. Silence means retry, so the acknowledgement must be truthful. |
| How does the portal poll feed C? | A new **`*/5 * * * *`** cron trigger, cursor in `system_meta.elfia_orders_cursor`. | The existing `*/30` cron is already seven jobs deep and runs the TikTok sync; a web order should not wait up to half an hour, and a bridge failure must not be able to swallow the clock-out reminders. |
| Does a web order become a `sales_document`? | **No.** It lands in its own `web_orders` / `web_order_lines` tables. | An ELFIA order is not an A2Z quotation or invoice — it has no issuer, no letterhead, no signer. Forcing it into `sales_documents` would corrupt `docNumber`, the issuer guard and revenue attribution. Revenue integration is a deliberate later step (A-4). |

---

### A-1 · `price_cents` on feed A — *release v1.35.0* ◐ code complete 22-08-2026 — awaiting deploy + store-side acceptance (criteria 3 and the 5-minute price check need the live store)

**"The store shows the price I set in the portal, within five minutes."**

#### Schema — `worker/migrations/0075_bridge_pricing.sql`

```sql
-- v1.35.0 — the portal owns ELFIA's selling price.
-- No FK (house rule since v1.4.69). Money in integer sen.

-- Which items the ELFIA bridge is allowed to publish. Explicit beats a SKU
-- prefix LIKE: renaming a SKU must not silently add or drop a product.
ALTER TABLE inventory_items ADD COLUMN bridge_enabled INTEGER NOT NULL DEFAULT 0;

-- The web selling price in sen. NULL = "no web-specific price", and feed A
-- falls back to unit_price_cents. Deliberately NOT unit_price_cents minus
-- live_rebate_cents: the live rebate is a TikTok LIVE discount and must never
-- leak onto the shop's price tag.
ALTER TABLE inventory_items ADD COLUMN elfia_price_cents INTEGER;

-- Backfill exactly the set the old hard-coded LIKE was publishing, so the
-- first deploy changes nothing about WHICH items appear.
UPDATE inventory_items
   SET bridge_enabled = 1
 WHERE UPPER(REPLACE(sku, ' ', '')) LIKE 'ELFIA%'
    OR UPPER(REPLACE(sku, ' ', '')) LIKE 'LUMI%';

CREATE INDEX IF NOT EXISTS idx_inventory_bridge ON inventory_items (bridge_enabled);
```

#### Endpoint — `GET /api/v1/bridge/elfia-inventory` (rewrite, same path)

Auth unchanged: `X-Bridge-Key` vs `ELFIA_BRIDGE_KEY`, `timingSafeEqual`, `401` with no hint, `501` when unset.

```jsonc
// 200
{
  "items": [
    { "sku": "LUMI001", "name": "Bawal Premium — Dusty Rose", "stock": 24, "price_cents": 4900 },
    { "sku": "LUMI002", "name": "Bawal Premium — Periwinkle", "stock": 0 }
  ],
  "as_of": "2026-08-22T04:00:00.000Z",
  "count": 2
}
```

| Field | Rule |
|---|---|
| `sku` | Sent exactly as the portal spells it. The store matches case- and whitespace-insensitively, so `LUMI 004` ≡ `LUMI004`; **neither side renames**. |
| `stock` | `MAX(0, inventory_items.stock)` — integer ≥ 0. Never send a negative. |
| `price_cents` | `COALESCE(elfia_price_cents, NULLIF(unit_price_cents, 0))`. **Omitted from the JSON entirely when the result is `NULL` or ≤ 0** — an absent field means "the store's own price stands", and a `0` would be refused by the store as not a positive integer. |
| `name` | For humans reading the sync report. |

Query:

```sql
SELECT sku, name, MAX(stock, 0) AS stock,
       COALESCE(elfia_price_cents, NULLIF(unit_price_cents, 0)) AS price_cents
  FROM inventory_items
 WHERE bridge_enabled = 1 AND status != 'discontinued'
 ORDER BY sku
 LIMIT 1000;
```

Then strip `price_cents` where it is null or ≤ 0 before serialising. **Return the whole list every time** — the store diffs it, and a SKU that stops appearing is reported as unmatched, not deleted.

**Migration-skew defence:** if `bridge_enabled` does not exist yet (deploy landed before the migration), fall back to the old `LIKE` predicate and omit `price_cents`, rather than 500-ing. Pattern: `staff.ts:3868-3886`.

#### UI — Inventory tab

Two new controls per row, gated on the existing `inventory` permission — which is **wider than you may expect**: `super_admin, admin, ceo, coo, cco, sales_marketing, marketing, hr_admin` (`permissions.ts:25`). Consider a new, narrower `bridge_manage` permission for the web price, since it is the number a customer pays:

- **"Publish to ELFIA"** checkbox → `bridge_enabled`.
- **"Web price (RM)"** input → `elfia_price_cents`, blank = "use the portal price". Show the effective price beside it, and a hint when the item also has a `live_rebate_cents` so nobody assumes the rebate applies online.

New route: `PATCH /api/v1/staff/inventory/{id}/bridge` `{ bridge_enabled?: boolean, elfia_price_cents?: number | null }`. Audited as `inventory.bridge`.

#### Tests

- `tests/bridge-feed-guard.mjs` (**new guard #10**) — pure-function assertions on the feed serialiser: `price_cents` omitted when null/0; `stock` never negative; discontinued excluded; `bridge_enabled = 0` excluded; the payload contains no key outside `{sku,name,stock,price_cents}`.
- `tests/sql-schema-check.mjs` — passes automatically once `0075` is in place.
- Manual: set a price in the portal, wait ≤ 5 min, confirm the shop's price tag changed. (Spec checklist step 8.)

#### Acceptance criteria

1. `curl -H "X-Bridge-Key: …" https://a2zcreative.my/api/v1/bridge/elfia-inventory` returns `price_cents` for every SKU that has one, and omits the key for those that do not.
2. A wrong key returns `401` with no body hinting at the correct value; an unset secret returns `501`.
3. The store's `/admin → Products → Sync with portal now` report shows prices applied and zero unmatched SKUs.
4. Setting a `live_rebate_cents` in the portal does **not** change the web price.
5. `ELFIA_BRIDGE_KEY` is documented in `worker/wrangler.toml`'s secret comment block.

---

### A-2 · Movements endpoint B + the stock ledger — *release v1.36.0* ◐ code complete 22-08-2026 — awaiting deploy + spec checklist 6–7

**"Every scarf the website sells comes off my count, once — never twice, never never."**

This is the release where **getting idempotency wrong costs real stock**. The store retries anything it does not see acknowledged, because losing a sale is worse than sending it twice.

#### Schema — `worker/migrations/0076_bridge_movements.sql`

```sql
-- v1.36.0 — inbound movements from the ELFIA store, and the append-only
-- stock ledger they write into.

-- The idempotency store. UNIQUE(event_id) is the whole safety mechanism:
-- a repeated event_id is reported as "ignored" and applied zero times.
CREATE TABLE IF NOT EXISTS bridge_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL DEFAULT 'elfia',  -- room for a second store later
  event_id     TEXT    NOT NULL,                  -- the store's UUID
  sku          TEXT    NOT NULL,                  -- as sent, unnormalised
  sku_key      TEXT    NOT NULL,                  -- UPPER(REPLACE(sku,' ','')) — the match key
  delta        INTEGER NOT NULL,                  -- negative = sold, positive = cancelled back
  reason       TEXT,                              -- 'order' | 'cancel' (informational)
  reference    TEXT,                              -- the store's order number, may be NULL
  occurred_at  TEXT,                              -- UTC, as the store recorded it
  outcome      TEXT    NOT NULL,                  -- 'applied' | 'unknown_sku'
  item_id      INTEGER,                           -- inventory_items.id when matched
  received_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_events_id
  ON bridge_events (source, event_id);
CREATE INDEX IF NOT EXISTS idx_bridge_events_sku  ON bridge_events (sku_key);
CREATE INDEX IF NOT EXISTS idx_bridge_events_recv ON bridge_events (received_at);

-- The append-only stock ledger. Every future movement writes here; Track E
-- backfills the historical sources into it. Never UPDATEd, never DELETEd —
-- a mistake is corrected by a compensating row.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL,
  sku          TEXT,
  delta        INTEGER NOT NULL,          -- signed; + in, - out
  balance_after INTEGER,                  -- the count immediately after this row
  source       TEXT    NOT NULL,          -- 'elfia' | 'manual' | 'invoice' | 'tiktok' | 'po' | 'return' | 'stocktake'
  ref_type     TEXT,                      -- 'bridge_event' | 'doc' | 'po' | 'stockout' | …
  ref_id       TEXT,                      -- the id in that system
  reason       TEXT,
  created_by   INTEGER,                   -- users.id, NULL for machine movements
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_item ON stock_ledger (item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_src  ON stock_ledger (source, ref_id);

-- A normalised match key so 'LUMI 001' and 'LUMI001' find each other without
-- a table scan on every movement.
ALTER TABLE inventory_items ADD COLUMN sku_key TEXT;
UPDATE inventory_items SET sku_key = UPPER(REPLACE(sku, ' ', ''));
CREATE INDEX IF NOT EXISTS idx_inventory_sku_key ON inventory_items (sku_key);
```

> **`sku_key` must be maintained.** There are exactly two statements that write `inventory_items.sku`: `POST /inventory` (`staff.ts:5569`) and `POST /inventory/{id}/edit` (route match `staff.ts:5629`, `UPDATE … SET sku = COALESCE(?1, sku)` at `staff.ts:5645`). **Not** `PATCH /inventory/{id}` (`staff.ts:5588`), which never touches `sku`. Both writers must set `sku_key = UPPER(REPLACE(sku,' ',''))` in the same statement — a rename that leaves `sku_key` stale silently breaks bridge matching, and the failure looks like an `unknown_sku` from the store. A guard asserts no bare `sku` write exists without it.

#### Endpoint — `POST /api/v1/bridge/elfia-movements` (new)

Registered in the **public** section of `route()` next to feed A, same key, before auth.

> **On CSRF:** no bypass is needed and none should be added. The middleware at `index.ts:1387-1405` widens the permitted `Origin` for public form routes, and its token check runs **only when a session cookie is present** (`index.ts:1397-1405`). A cookieless server-to-server POST with no `Origin` header already passes through untouched. Verify this with a test rather than assuming it — an added bypass would be a hole nobody closes later.

```jsonc
// request — up to 50 movements
{ "movements": [ {
  "event_id": "9f1c8b2e-6a34-4f7d-9c21-0a5b7e3d1f88",
  "sku": "LUMI001", "delta": -2, "reason": "order",
  "reference": "ELF-200826-6", "occurred_at": "2026-08-20 11:54:03"
} ] }

// 200 — all three lists contain event_id values, never SKUs
{ "applied": ["9f1c…"], "ignored": ["3b7d…"], "unknown_sku": ["c40a…"] }
```

**Processing rules, in order:**

1. **Key check** → `401` on mismatch, `501` when the secret is unset.
2. **Body cap** — refuse > 64 KB (reuse `MAX_WEBHOOK_BODY_BYTES`, `index.ts:243`) and > 50 movements → `400`.
3. **Zod validation** per movement: `event_id` non-empty string ≤ 64 chars; `sku` non-empty; `delta` a non-zero integer; `reason` ∈ `{order, cancel}` or absent; `reference` string or null; `occurred_at` string or absent. A malformed movement is left out of **all three lists** so the store resends it — never guess.
4. For each movement, in order:
   a. `INSERT INTO bridge_events (…) ON CONFLICT (source, event_id) DO NOTHING`. **Zero rows changed ⇒ already seen ⇒ push the id to `ignored` and move on. Apply nothing.**
   b. Match the SKU: `SELECT id, stock FROM inventory_items WHERE sku_key = ?`. No match ⇒ set `outcome = 'unknown_sku'`, push to `unknown_sku`, apply nothing. (The store then stops retrying and surfaces it in its `/admin` for a human.)
   c. Apply: `UPDATE inventory_items SET stock = MAX(0, stock + ?), status = <recomputed>, updated_at = datetime('now') WHERE id = ?`.
   d. Write one `stock_ledger` row: `source='elfia'`, `ref_type='bridge_event'`, `ref_id=event_id`, `reason=reason`, `balance_after` = the new count.
   e. Write one `manual_stockouts` row for continuity with the existing Inventory tab trail: `direction` = `'out'` when `delta < 0` else `'in'`, `remark` = `ELFIA <reason> <reference>`, `unit_sale_cents` = the effective ELFIA price when `reason = 'order'` (so web sales can be valued), else `NULL`.
   f. Set `outcome = 'applied'`, push to `applied`.
5. **Whole-request failure** (bad key, D1 down) → non-2xx with no lists. The store retries the entire batch; nothing is lost.
6. **Partial failure is fine** — leave the ids you did not apply out of all three lists.

> **The one rule that must not be got wrong:** an `event_id` **not** in one of the three lists is treated as undelivered and **will be sent again**. Silence means retry. Do not "helpfully" add ids you did not actually process.

**Clamping note.** `MAX(0, stock + delta)` means a negative resulting count is clamped, not refused — because refusing would make the store retry forever and the pieces have physically already left. When a clamp happens, write the ledger row with the **actual** applied delta, and raise a notification to `sales_marketing` + `ceo` (`kind: 'stock'`, `ref: 'bridge_clamp:{sku}'`) so a human reconciles it. This is a real-world divergence, and it must be loud.

**Batch transaction.** D1 supports `db.batch()` for atomic multi-statement execution. Apply each movement's statements as one batch where practical; if a batch fails, omit those ids from all three lists.

#### Low-stock interaction

The `*/30` cron's low-stock sweep (`index.ts:1245-1271`) uses `inventory_items.low_alerted`. Bridge-applied deductions must call the same `checkLowStock` path so a web sale that crosses the ≤ 5 threshold alerts just like a manual one.

#### UI — Inventory tab → "ELFIA bridge" card

- Last movement received (relative time), count applied in the last 24 h, count ignored (dedupe working), and an **`unknown_sku` list that must be actioned** — with a one-click "map to this item" that renames nothing but sets `sku_key` alias (see [OD-3](#13-open-decisions)).
- New route `GET /api/v1/staff/inventory/bridge-health` → `{ last_event_at, applied_24h, ignored_24h, unknown: [{sku, count, last_at}], feed_key_configured }`. Permission: `inventory`.

#### Tests

- `tests/bridge-idempotency.mjs` (**new guard #11**) — builds the cumulative schema in `node:sqlite`, replays the same `event_id` five times against the real handler logic, asserts the count moved **exactly once** and the id landed in `applied` then `ignored` ×4.
- Extend `tests/bridge-feed-guard.mjs`: unknown SKU applies nothing; malformed movement appears in no list; a 51-movement batch is refused; whitespace/case SKU variants match.
- Manual (spec checklist steps 6–7): place an RM 1 test order in the store → portal count drops by one; cancel it → count returns; `curl` the same `event_id` twice by hand → count moves once.

#### Acceptance criteria

1. Same `event_id` sent twice moves stock once and returns it in `ignored` the second time.
2. A movement for a SKU the portal does not hold returns it in `unknown_sku`, applies nothing, and appears in the bridge-health card.
3. `LUMI 001` in the portal matches `LUMI001` from the store, both directions, with neither side renaming.
4. Killing the portal mid-batch and letting the store retry produces the same final count as a clean run.
5. `stock_ledger` contains one row per applied movement, with a `balance_after` that reconciles to `inventory_items.stock`.
6. A web sale crossing the low-stock threshold raises the same alert a manual sale would.

---

### A-3 · Orders feed C — the portal sees every web order — *release v1.37.0* ◐ code complete 22-08-2026 — awaiting deploy + `ELFIA_ORDERS_URL` secret

**"Everything is monitored in one place."**

#### Schema — `worker/migrations/0077_web_orders.sql`

```sql
-- v1.37.0 — web orders pulled from the ELFIA store. The portal READS these;
-- it never creates or edits one. Upsert key is (store, order_number).

CREATE TABLE IF NOT EXISTS web_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  store             TEXT    NOT NULL DEFAULT 'elfia',
  order_number      TEXT    NOT NULL,
  status            TEXT    NOT NULL,   -- pending_payment|payment_review|paid|shipped|completed|cancelled
  customer_name     TEXT,
  phone             TEXT,
  address           TEXT,
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  shipping_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  payment_method    TEXT,
  tracking_no       TEXT,
  tracking_courier  TEXT,
  placed_at         TEXT,               -- the store's created_at
  store_updated_at  TEXT,               -- the store's updated_at (drives the cursor)
  customer_id       INTEGER,            -- set later by Track C matching; NULL for now
  first_seen_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  synced_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_orders_no
  ON web_orders (store, order_number);
CREATE INDEX IF NOT EXISTS idx_web_orders_status  ON web_orders (status, store_updated_at);
CREATE INDEX IF NOT EXISTS idx_web_orders_placed  ON web_orders (placed_at);
CREATE INDEX IF NOT EXISTS idx_web_orders_phone   ON web_orders (phone);

CREATE TABLE IF NOT EXISTS web_order_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL,       -- web_orders.id (no FK, house rule)
  store_product_id INTEGER,              -- the store's product_id, informational
  name           TEXT,
  sku            TEXT,
  sku_key        TEXT,
  qty            INTEGER NOT NULL DEFAULT 0,
  price_cents    INTEGER NOT NULL DEFAULT 0  -- FROZEN price actually charged
);
CREATE INDEX IF NOT EXISTS idx_web_order_lines_order ON web_order_lines (order_id);
```

> `web_order_lines.price_cents` is the **price actually charged at purchase time** — the order's own frozen snapshot. Every report must use it, never today's `unit_price_cents`. This is stated in the spec and is the whole reason the column exists.

#### The poller

New cron trigger `*/5 * * * *` in `worker/wrangler.toml` (existing three stay). Handler `pollElfiaOrders(env)` in a **new file `worker/src/bridge.ts`** — `worker/src/index.ts` is already **3,517 lines** and everything in Track A would otherwise land in it:

```
cursor = system_meta['elfia_orders_cursor']            -- absent on the first ever run
loop (max 10 pages per tick, hard stop):
  GET https://elfiaofficialstore.my/api/v1/bridge/orders?since=<cursor>
      X-Bridge-Key: ELFIA_BRIDGE_KEY
  for each order: UPSERT web_orders BY (store, order_number)
                  DELETE + re-INSERT its web_order_lines   -- lines are a snapshot, replaced whole
  cursor = response.cursor
  if response.orders is empty: break
persist cursor to system_meta
```

| Rule | Detail |
|---|---|
| First call | Omit `since` entirely. |
| Ordering | Rows come back **oldest-change-first**, ≤ 200 per call. |
| Re-delivery | The same order reappears on **every status change** (paid → shipped → completed). **Upsert by `order_number`** — it is the stable key. |
| Cancelled orders | Their pieces already came back through feed B. **Do not add them again.** The poller touches `web_orders` only — it must never write to `inventory_items` or `stock_ledger`. |
| Cursor persistence | Only after a page is fully written. A crash mid-page re-reads that page next tick; the upsert makes that harmless. |
| Failure | `logError(env, 'elfia_orders_poll', …)`. Three consecutive failures raise a `system` notification to `super_admin` + `ceo`, deduped by `ref: 'elfia_poll:{date}'`. Never throw out of `scheduled()`. |
| Timeout | 20 s per request (matches the health-check convention in `deploy-api.sh`). |
| Base URL | `ELFIA_ORDERS_URL` — a **secret**, not a var, matching the store's own posture that the counterpart domain never enters a committed file. |

#### UI — new **"Web Orders"** tab

Added to `ALL_TABS` (`app/portal/page.tsx:10582`) with a DICT entry (`Pesanan Web`), permission `sales` + `inventory` + exec roles. New component `components/portal/web-orders-panel.tsx`.

- Status filter chips, search by order number / phone / name.
- Row: order number · status badge · customer · total · placed date · tracking.
- Detail drawer: lines with frozen prices, totals, payment method, tracking link, and the **portal-side stock movements** for that reference (joined from `stock_ledger` via `ref_id` → `bridge_events.reference`) — so "what did this order do to my count" is one click.
- Dashboard pulse tile: web orders today, unshipped count, month GMV.
- **The customer's private order-page token is deliberately not in the feed** and must not be reconstructed or displayed.

New routes (all permission-gated, `sales`): `GET /api/v1/staff/web-orders` (filters + paging), `GET /api/v1/staff/web-orders/{id}`, `POST /api/v1/staff/web-orders/sync` (manual "pull now", audited, rate-limited to once a minute).

#### Tests

- `tests/bridge-orders-upsert.mjs` — replay the same order at three statuses; assert one row, latest status, lines replaced not duplicated, cursor advanced.
- Assert the poller writes **zero** rows to `inventory_items` and `stock_ledger`.
- Cursor round-trip: empty page stops the loop; a mid-loop throw leaves the previous cursor intact.

#### Acceptance criteria

1. An RM 1 test order placed in the store appears in the portal's Web Orders tab within 5 minutes, with its items and status.
2. Moving it paid → shipped → completed updates the same row; there is never a second row.
3. Cancelling an unpaid order shows `cancelled` and does **not** change any stock count (feed B already did that).
4. Turning the store off for an hour and back on produces no gaps and no duplicates.
5. `/api/v1/health` reports `elfia_bridge: { pull: true, push: true, orders: true, last_poll_at, cursor }`.

---

### A-4 · Bridge operations, revenue and reconciliation — *release v1.38.0* ◐ code complete 22-08-2026 (runbook at `docs/BRIDGE-RUNBOOK.md`)

The point at which the bridge stops being plumbing and starts being business data.

| Item | Detail |
|---|---|
| **Health surface** | Extend `GET /api/v1/system/health` (already surfaced in /admin → Audit → System health) with a bridge block: secret configured, last feed-A read (inferred from access), last movement received, last successful poll, cursor age, undelivered `unknown_sku` count. Amber past 30 min with no poll, red past 2 h. |
| **Web revenue** | Add an `elfia` bucket to `revenueLines()` (`staff.ts:428-494`) — paid/shipped/completed `web_orders`, recognised on a **payment-received basis** like the rest of the system, valued at `web_order_lines.price_cents`. Because `revenueByMonth()` derives from `revenueLines()`, `/revenue`, `/finance/pnl` and the business-lines card cannot disagree. |
| **Cash & GL** | A paid web order books one `cashflow_entries` money-in row plus one balanced journal entry via the existing `recordBankMovement` → `postJournal` path, **idempotent by `ref = 'ELF-<order_number>'`** (`shared.ts:127-156`). Billplz fees, when the store exposes them, post to `6900`. Until then, gross only — flagged in [OD-4](#13-open-decisions). |
| **Daily reconciliation report** | New `GET /api/v1/staff/bridge/reconcile?date=` — for each bridge-enabled SKU: opening count, movements by source, closing count, and the store's last-known count from the most recent feed read. Any SKU where the two disagree is listed first. This is the report that proves the sync is honest. |
| **Attribution** | Web orders are **not** attributed to a salesperson (no live session, no shift). They are excluded from `attributedSalesByUser()` and from the leaderboard, and that exclusion is asserted in a test so nobody "fixes" it later. See [OD-5](#13-open-decisions). |
| **Retention** | `bridge_events` grows one row per web sale forever. Add a housekeeping step to the `*/30` cron: delete `bridge_events` older than **400 days** whose `outcome = 'applied'`. Keep `unknown_sku` rows indefinitely — they are unresolved business problems. `stock_ledger` is never pruned. |
| **Runbook** | New `docs/BRIDGE-RUNBOOK.md`: rotating the shared key on both sides without losing a movement; what to do when `unknown_sku` appears; how to replay a cursor; how to correct a clamped count with a compensating ledger row. |

#### Track A acceptance — the whole track is done when

Run the ELFIA spec's own checklist end to end and every step passes:

1. ☐ Portal implements B, unique index on `event_id`, deployed.
2. ☐ `ELFIA_BRIDGE_KEY` set on the portal and documented.
3. ☐ Store's three secrets set to matching values, deployed.
4. ☐ `elfiaofficialstore.my/api/v1/health` shows `bridge_pull_configured: true, bridge_push_configured: true`.
5. ☐ Store `/admin → Products → Sync with portal now` report is clean.
6. ☐ RM 1 test order drops the portal count by one; cancelling returns it.
7. ☐ The same `event_id` sent twice by hand moves the count only once.
8. ☐ Portal polls feed C and sees the test order; a portal price change reaches the shop within 5 minutes.


---

## 5. Track S — security & tech debt (P0, runs alongside)

Small, unglamorous, and blocking. Each of these is a real defect found in the code, not a nice-to-have.

### S-1 · Publicly downloadable handwritten signatures — *shipped in v1.38.0* ◐ code complete — **two human steps left: upload fresh scans in /admin → Staff → Signatures, and treat the leaked images as compromised.** Found in build: NINE call sites, not three — the printable leave form (`app/portal/page.tsx` ×3) and claim form (`role-panels.tsx` ×3) also fetched the public path; all repointed, and no table was needed (deterministic R2 keys + audit_log).

**The problem.** `public/signatures/{ceo,coo,cco,hr-admin,sales-marketing}-sign.png` are plain static assets. `https://a2zcreative.my/signatures/ceo-sign.png` returns the CEO's real handwritten signature as a clean PNG to anyone, with no login. No `_headers` rule restricts them, and the paths appear in the markup of approved leave and claim forms. Recorded in `CHANGELOG.md` v1.34.0 as found-but-not-fixed.

**Why it was not a one-line fix.** **Three** files fetch these by URL from the browser — `lib/doc-pdf.ts:569`, `lib/form-pdf.ts:248-250` and `:325-327`, and `lib/doc-template.ts:146` (`` `${location.origin}/signatures/${…}-sign.png` ``). The CHANGELOG names only the first two; the HTML renderer is the one that would break silently. Deleting the public files without repointing all three breaks every signed document.

**The fix, in order:**

1. Migration `0078_signature_vault.sql` — table `signatures (role TEXT PRIMARY KEY, r2_key TEXT NOT NULL, updated_by INTEGER, updated_at TEXT)`.
2. Upload the five PNGs to R2 under `private/signatures/` (the `private/` prefix already requires staff auth, `SECURITY.md` §13).
3. New route `GET /api/v1/staff/signature/{role}` — session-authenticated, returns the PNG bytes with `Cache-Control: no-store, private`. Only roles that may *see* a signed document may fetch it.
4. Repoint **all three** — `lib/doc-pdf.ts`, `lib/form-pdf.ts` and `lib/doc-template.ts` — at the authenticated endpoint (they run in the browser with the session cookie, so this is a URL change plus `credentials: 'include'`).
5. **Delete** `public/signatures/` and add `public/_headers` denial as belt-and-braces.
6. New guard `tests/no-public-signatures.mjs` (**guard #12**) — fails the build if any file exists under `public/signatures/` or if any `lib/` file references that path. This is the part that stops it coming back.
7. **Rotate**: the five signatures have been public for an unknown period. Treat them as compromised for any high-value use; consider re-scanning fresh signature images so the leaked files no longer match what appears on new documents.

**Acceptance:** an unauthenticated `curl` of every old signature URL returns 404; a logged-in CEO's leave-form PDF still renders their signature; guard #12 fails on a deliberately reintroduced file.

### S-2 · The orphan pipeline cron — *shipped in v1.38.0* ☑ (block deleted per OD-6(a); prospects data retained)

`worker/src/index.ts:1272-1294` still queries `prospects.next_followup` and notifies "📞 Follow up today: … — Pipeline tab". **That tab was deleted in v1.5.0/v1.21.0.** Staff are being told to visit a screen that does not exist.

Two options, decide in [OD-6](#13-open-decisions): switch the cron off now and re-enable it in Track C when the pipeline returns, **or** leave it and accept dead notifications for ~4 months. Recommendation: switch it off now (one `if (false)` is not acceptable — delete the block and note it in the CHANGELOG), because a notification that leads nowhere trains people to ignore notifications.

### S-3 · Goods receipt writes the wrong direction — *shipped in v1.38.0* ☑ (`direction='in'` explicit + data fix `0078_fix_po_direction`)

`worker/src/erp.ts:560-563` inserts the PO goods-receipt trail row into `manual_stockouts` **without `direction`**, so it defaults to `'out'` (`0064_manual_stock_direction.sql:12`) while the stock actually went **in**. Every report reading `manual_stockouts.direction` is wrong for every PO ever received.

Fix: pass `direction = 'in'` explicitly, and write a one-off data-correction migration `0079_fix_po_direction.sql` that flips `direction` to `'in'` for `manual_stockouts` rows whose `remark` matches the PO pattern. Assert the corrected count in the CHANGELOG entry.

### S-4 · Documentation drift — *release v1.40.1* ☐

| Doc | Drift |
|---|---|
| `DATABASE.md` | Documents migrations up to **0022**. The repo has **74**. 52 migrations are undocumented. |
| `MILESTONES.md` | Stops at v1.4.69 (01 Aug). CHANGELOG is at v1.34.0 (21 Aug) — ~30 versions stale. |
| `ROADMAP.md` | Phase B items unticked that have shipped: PDF export, WhatsApp share, payroll, inventory, client portal, PWA. |
| `WORKFLOW.md` §12 | Says "69 migrations"; there are 74. Cron table will need the new `*/5` entry. |
| `SECURITY.md` vs `WORKFLOW.md` §4.1 | PBKDF2 iterations documented as **100k** in one and **310k** in the other. **Resolve by reading the code and correcting the wrong doc** — this is a security control, and two numbers means nobody knows which is true. |
| `DEPLOYMENT.md` | Names branch `develop`; `AUTO-DEPLOY.md` and the live flow use `dev`. Does not mention the 9 guards or `deploy-api.sh`. |
| `FEATURES-v1.7.0.md` | Describes the Sales Pipeline as live; it was retired. |

Scope: bring `DATABASE.md` current in **one pass** (a table per migration 0023–0074+ using the existing "History (do not remove)" convention), reconcile the PBKDF2 number, fix the branch name, tick the shipped ROADMAP items and add a "superseded" note to `FEATURES-v1.7.0.md`. Then add `IMPLEMENTATION-PLAN.md` to `CONTRIBUTING.md`'s documentation-rules list so it is updated with code like every other doc.

### S-5 · Duplication register (no work now — a decision each) ☐

Recorded so these are chosen deliberately rather than discovered again:

| Duplication | Where | Suggested resolution | Track |
|---|---|---|---|
| Two commission engines | `commission_rules` (0068, leaderboard) vs `commission_rates`/`commission_entries` (0071, ERP tab) | Pick one. `0068` drives the leaderboard staff actually look at; `0071` drives payroll pull. Likely: keep `0071` as the ledger, make `0068` the rule source that generates `0071` entries. | D |
| Two supplier systems | `supplier_returns.supplier` free text vs `suppliers` table | Add `supplier_returns.supplier_id`, backfill by name match, keep the text column (append-only rule). | E |
| Two numbering schemes | `docNumber` (atomic, `doc_counters_daily`) vs `nextNo` (`COUNT(*)`, non-atomic) | Move PO numbering onto `docNumber` with a `PO` type. | E |
| Two renderers of one layout | `lib/doc-template.ts` (HTML) + `lib/doc-pdf.ts` (hand-rolled PDF) | **Keep both** — deliberate, and `tests/doc-issuer-render.mjs` covers divergence. Documented, not fixed. | — |
| Retired tables still present | `orders`/`order_lines`, `prospects`, `bd_pipeline`, `ops_reports` | Keep the tables (append-only), but `/overview` (`staff.ts:6181`) still queries `bd_pipeline` — either restore that module or stop querying it. | C |
| `AZOO` hard-coded in `docNumber` | `staff.ts:325` | An A2Z-issued invoice still carries `-AZOO` in its number. Decide whether that is intended before Track D touches numbering. | D / [OD-7](#13-open-decisions) |

---

## 6. Track B — HRM (P0, parallel with A)

**Goal:** payroll that satisfies Malaysian statutory requirements, an approval structure that reflects who actually reports to whom, and the HR records the business is currently keeping in people's heads.

### B-1 · Statutory payroll — EPF, SOCSO, EIS, PCB — *release v1.39.0* ☐ **the biggest single item in this plan**

Today's net formula (`staff.ts:5090` — the only `const net = Math.max` in the Worker; mirrored in `components/portal/payroll-panel.tsx:611`):

```
net = max(0, basic + commission + allowance + ot
             − manual deduction − unpaid-leave deduction − incomplete-month deduction)
```

There is no EPF, SOCSO, EIS or PCB anywhere. `users` holds `epf_no`, `socso_no`, `tax_no` as **text identifiers only**. The UI states it plainly: *"No KWSP/SOCSO/EIS lines yet — registration pending."*

> **Compliance caveat, stated once and meant.** Contribution rates, wage ceilings and PCB schedules are set by KWSP, PERKESO and LHDN and change. This plan specifies the **mechanism**, not the numbers. Every rate lives in a versioned, effective-dated table an admin can update — never a constant in the code — and the figures must be confirmed against the current official schedules (and, for PCB, with your tax agent) before the first live payroll run. I am not your accountant, and a payroll release should not go live on my arithmetic.

#### Schema — `worker/migrations/0080_statutory_payroll.sql`

```sql
-- v1.39.0 — Malaysian statutory contributions. Rates are DATA, never code:
-- KWSP/PERKESO/LHDN change them, and a code change is a deploy.

-- Effective-dated contribution rules. One row per (scheme, band, effective_from).
CREATE TABLE IF NOT EXISTS statutory_rates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme          TEXT    NOT NULL,   -- 'epf' | 'socso' | 'eis'
  category        TEXT,               -- e.g. epf age band, socso first/second category
  wage_from_cents INTEGER NOT NULL DEFAULT 0,
  wage_to_cents   INTEGER,            -- NULL = no upper bound
  employee_pct    REAL,               -- percentage form (EPF)
  employer_pct    REAL,
  employee_cents  INTEGER,            -- fixed-amount form (SOCSO/EIS wage bands)
  employer_cents  INTEGER,
  effective_from  TEXT    NOT NULL,   -- YYYY-MM-DD
  effective_to    TEXT,
  note            TEXT,
  created_by      INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_statutory_scheme
  ON statutory_rates (scheme, effective_from, wage_from_cents);

-- Per-employee statutory profile. Separate from users so the payroll engine
-- has one place to look and users stays a people table.
CREATE TABLE IF NOT EXISTS staff_statutory (
  user_id            INTEGER PRIMARY KEY,
  epf_enrolled       INTEGER NOT NULL DEFAULT 1,
  epf_employee_pct   REAL,            -- NULL = use the rate table (voluntary top-up otherwise)
  epf_employer_pct   REAL,
  socso_enrolled     INTEGER NOT NULL DEFAULT 1,
  socso_category     TEXT,            -- 'first' (employment injury + invalidity) | 'second' (injury only)
  eis_enrolled       INTEGER NOT NULL DEFAULT 1,
  pcb_enrolled       INTEGER NOT NULL DEFAULT 1,
  marital_status     TEXT,            -- PCB relief inputs
  spouse_working     INTEGER,
  children_count     INTEGER NOT NULL DEFAULT 0,
  disabled_self      INTEGER NOT NULL DEFAULT 0,
  disabled_spouse    INTEGER NOT NULL DEFAULT 0,
  zakat_monthly_cents INTEGER NOT NULL DEFAULT 0,
  updated_by         INTEGER,
  updated_at         TEXT
);

-- The computed statutory lines for one payroll month. Written by the engine,
-- never typed. One row per (user, month) mirroring payroll_entries.
CREATE TABLE IF NOT EXISTS payroll_statutory (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL,
  month                TEXT    NOT NULL,   -- YYYY-MM
  wage_base_cents      INTEGER NOT NULL DEFAULT 0,  -- what each scheme was computed on
  epf_employee_cents   INTEGER NOT NULL DEFAULT 0,
  epf_employer_cents   INTEGER NOT NULL DEFAULT 0,
  socso_employee_cents INTEGER NOT NULL DEFAULT 0,
  socso_employer_cents INTEGER NOT NULL DEFAULT 0,
  eis_employee_cents   INTEGER NOT NULL DEFAULT 0,
  eis_employer_cents   INTEGER NOT NULL DEFAULT 0,
  pcb_cents            INTEGER NOT NULL DEFAULT 0,
  zakat_cents          INTEGER NOT NULL DEFAULT 0,
  rates_version        TEXT,               -- which effective_from set was used
  computed_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_statutory_um
  ON payroll_statutory (user_id, month);

-- Employer cost is not an employee deduction; keep it on payroll_entries so
-- P&L and the M2E file can see it without a join gymnastics.
ALTER TABLE payroll_entries ADD COLUMN statutory_employee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_entries ADD COLUMN statutory_employer_cents INTEGER NOT NULL DEFAULT 0;
```

#### The engine

New file `worker/src/statutory.ts` — **pure functions, zero imports**, so tests import the shipped code directly (the `shift-sales.ts` pattern, and the reason `tests/shift-sales-split.mjs` is trustworthy).

```ts
export function epfFor(wageCents: number, age: number, rules: Rule[], override?: Pct): Pair
export function socsoFor(wageCents: number, category: "first" | "second", rules: Rule[]): Pair
export function eisFor(wageCents: number, rules: Rule[]): Pair
export function pcbFor(input: PcbInput, schedule: PcbBand[]): number
export function netPay(entry: PayrollEntry, statutory: StatutoryLines): number
```

Rules the engine must honour:

- **Wage base differs per scheme.** Define once, in code, with a comment naming the source: EPF on wages as defined by the EPF Act; SOCSO/EIS on wages subject to their own ceilings; PCB on remuneration net of allowable reliefs. Do not assume one `basic` figure serves all three.
- **Rounding is per-scheme and must be explicit** (EPF rounds up to the next ringgit for the employee share; SOCSO/EIS come from fixed wage-band tables). Every rounding decision gets a named constant and a test.
- **Age matters** for EPF bands — derive from `users.birthday`; a missing birthday blocks the payroll run for that person with a named error rather than silently using the wrong band.
- **`net_cents` stays the single source of truth.** The new formula extends the existing one; the M2E file, `/finance/pnl` and the payslip all keep reading `net_cents` and **must never grow a second formula** (`staff.ts:2707-2712` is explicit about this).
- **Hourly staff** (part-time live hosts, `PART_TIME_LH_RATE_CENTS` = RM 15.00/h) are still recomputed server-side; their statutory treatment is a genuine question — see [OD-8](#13-open-decisions).

#### Payslip

`components/portal/payroll-panel.tsx` — replace the *"No KWSP/SOCSO/EIS lines yet"* note with real lines:

```
Basic                         2,500.00
Allowance                       200.00
Overtime (12.0 h)               216.35
Commission                      340.00
                            ──────────
Gross                         3,256.35
Less  EPF (employee 11%)       -358.00
Less  SOCSO (employee)          -14.75
Less  EIS (employee)             -5.90
Less  PCB                       -35.00
Less  Unpaid leave (1.0 day)    -96.15
                            ──────────
Net pay                       2,746.55

Employer contributions (not deducted from you)
EPF 13%  423.00 · SOCSO 51.65 · EIS 5.90
```

Printed documents stay English (house rule 9). The employer block is shown because staff ask, and it is the honest picture of what the job costs.

#### Statutory reports — *may slip to v1.39.1*

| Report | Route | Format |
|---|---|---|
| EPF Form A (monthly) | `GET /staff/payroll/epf-file?month=` | CSV/text in KWSP's submission layout |
| SOCSO/EIS Borang 8A | `GET /staff/payroll/socso-file?month=` | PERKESO layout |
| PCB CP39 (monthly) | `GET /staff/payroll/pcb-file?month=` | LHDN layout |
| EA form (annual, per employee) | `GET /staff/payroll/ea?year=&user_id=` | printable, English |
| CP8D / Borang E (annual) | `GET /staff/payroll/cp8d?year=` | CSV |

All gated on `payroll_export`. Each file layout must be checked against the current official template before first submission — layouts change, and a rejected file is a penalty.

#### Tests

- `tests/statutory-payroll.mjs` (**new guard #13**) — imports `worker/src/statutory.ts` directly. A fixture table of ~30 (wage, age, category) → expected contribution pairs, covering: band boundaries exactly, below the SOCSO floor, above the ceiling, age-60 EPF band change, a zero-wage month, a wage that rounds ambiguously. **This fixture is the compliance artefact** — when a rate changes, update the fixture first and watch it fail.
- Assert `net_cents` is computed in exactly one place (grep-style guard: no second net formula in `worker/src/` or `components/`).
- Assert a missing birthday blocks rather than defaults.

#### Acceptance criteria

1. A monthly-paid employee's payslip shows all four statutory lines plus the employer block, and `net = gross − employee statutory − other deductions`.
2. Changing a rate row with a future `effective_from` does not alter a past month; recomputing a past month reproduces the same figures (`rates_version` pinned).
3. The M2E `.xlsm` bulk-payment file pays the **new** net.
4. `/finance/pnl` payroll cost includes the employer share.
5. The fixture guard fails when a rate constant is edited without updating the fixture.

### B-2 · Org chart & manager-based approvals — *release v1.40.0* ☐

Today every approval chain is a **hard-coded role array**: `HR_STAGE_ROLES`, `PREAPP_ROLES`, `FINAL_ROLES` (`staff.ts:337-380`), `claimChain` (`staff.ts:2219`), `PAYROLL_PROC`, `TARGET_ADMIN_ROLES`. There is no `manager_id` on `users` — hierarchy is implicit in role strings. Adding one person with an unusual reporting line means editing TypeScript and deploying.

`0081_org_chart.sql`:

```sql
ALTER TABLE users ADD COLUMN manager_id INTEGER;          -- users.id, no FK
ALTER TABLE users ADD COLUMN cost_centre TEXT;            -- department roll-up for P&L
ALTER TABLE users ADD COLUMN grade TEXT;                  -- for policy tables in B-3/B-4
CREATE INDEX IF NOT EXISTS idx_users_manager ON users (manager_id);

-- Declarative approval chains. Replaces the hard-coded arrays; the arrays stay
-- as the fallback when no rule matches, so nothing breaks on day one.
CREATE TABLE IF NOT EXISTS approval_chains (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject      TEXT    NOT NULL,   -- 'leave' | 'claim' | 'ot' | 'purchase' | 'expense'
  applies_role TEXT,               -- NULL = any role
  applies_grade TEXT,
  min_amount_cents INTEGER,        -- claims/purchases: threshold-based routing
  stage_no     INTEGER NOT NULL,
  approver_kind TEXT   NOT NULL,   -- 'manager' | 'role' | 'user'
  approver_ref TEXT,               -- role name or users.id when kind != 'manager'
  optional     INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approval_chains ON approval_chains (subject, active, stage_no);
```

**Migration strategy that cannot break approvals:** seed `approval_chains` with rows that reproduce today's behaviour exactly, then switch the resolver to read the table with the hard-coded arrays as fallback. A guard (`tests/approval-chain-parity.mjs`, **#14**) asserts that for every (role × subject) combination the table-driven chain equals the legacy array chain. Only after that guard is green for a release do new rules get added.

**Rules that must survive:** no self-review; no payee-self-review (if the approver is the payee the stage is waived and the CEO is notified with the reason — `staff.ts` claim chain); COO/CCO applicants skip pre-approval; reject at any stage is terminal.

**UI:** an org-chart view (`components/portal/org-chart.tsx`) on the Staff Details tab — collapsible tree from `manager_id`, showing vacancies and direct-report counts; a manager sees their team's leave/claims/attendance in one place. Approval-chain editor for `hr_manage` only, with a live preview: "a claim of RM 350 by a `marketing` staff will route: Manager (Nurul) → COO → CEO".

### B-3 · Leave engine v2 — *release v1.41.0* ☐

| Gap today | Fix |
|---|---|
| Only 5 types (`annual, medical, emergency, unpaid, replacement`), enforced by a `CHECK` | Table rebuild (the `0021` pattern) adding `maternity, paternity, compassionate, hospitalisation, marriage, study, unrecorded`. **A `CHECK` cannot be altered — this is a full rebuild with an explicit column list.** |
| Entitlement is a flat `DEFAULT_ENTITLEMENT` + pro-rata from `COMPANY_START = 2026-07` | `leave_policies` table: entitlement by grade × years-of-service × type, effective-dated. Employment Act minimums (8/12/16 days by service length) as the floor, company policy above it. |
| No carry-forward | `leave_carry_forward (user_id, year, type, days, expires_on)`. A December cron proposes the carry-forward; **HR approves it** — never automatic, because it is money. |
| No half-day flag | `leave_requests.day_part` (`full` \| `am` \| `pm`); `days` stays REAL for compatibility. |
| Only 2026 holidays seeded | `POST /staff/holidays/import?year=` + a **November reminder cron** so 2027 is seeded before anyone books January leave. Johor state holidays, not federal-only. |
| MC upload not wired | `mc_media_id` exists; wire the upload to R2 `private/leave-mc/` and make it **required** for medical leave > 2 consecutive days (configurable in `leave_policies`). |
| No team calendar | `GET /staff/leave/calendar?month=` — approved leave per team, honouring the existing PDPA rule that **leave type is hidden from non-managers** (already done in `/roster`). |
| No encashment | `leave_encashment` table + a payroll line. [OD-9](#13-open-decisions) — may be dropped if policy says no. |

`0082_leave_v2.sql` (type rebuild) + `0083_leave_policies.sql`.

### B-4 · Performance, KPI & appraisal — *release v1.42.0* ☐

Nothing exists today. Every "KPI" in the codebase is a **sales revenue target** (`sales_targets`, `user_sales_targets`, `team_sales_targets`); `announcements.category = 'kpi'` is a label.

`0084_performance.sql`: `review_cycles` (name, period_from/to, status draft→open→calibration→closed) · `review_templates` + `review_competencies` (weighted) · `reviews` (cycle, user, reviewer, self-assessment, manager assessment, rating, calibrated rating, status) · `goals` (user, cycle, title, measure, target, actual, weight, status) · `one_on_ones` (manager, user, date, notes — private to the pair + HR).

- Ratings on a fixed scale with **written definitions** (a number with no definition produces inflation).
- Self-assessment opens first, then the manager's, then calibration — a manager cannot see the self-assessment until they have submitted theirs. That ordering is the whole point of the module.
- Sales roles pull actuals automatically from `attributedSalesByUser()` so a sales goal is not typed twice.
- Output: a printable review form (English, house rule 9) and a per-person history on Staff Details.

### B-5 · Recruitment (ATS lite) — *release v1.43.0* ☐

`app/careers/page.tsx` is 44 lines of static marketing pointing at WhatsApp.

`0085_recruitment.sql`: `job_openings` (title, department, grade, headcount, status draft→open→filled→cancelled, description, public_slug) · `applicants` (opening, name, email, phone, resume_key → R2 `private/resumes/`, source, stage applied→screening→interview→offer→hired→rejected, rating, notes, created_at) · `interviews` (applicant, interviewer, scheduled_at, mode, feedback, recommendation).

- A **public** application form on `/careers/{slug}` — reuses the existing `PUBLIC_FORM_ORIGINS` + rate-limited public-form pattern (`POST /api/v1/enquiries` is the template), 5/h per IP.
- Resume upload to `private/` (staff-auth to read), size-capped, extension-checked.
- **Hire → staff**: one click creates the `users` row with `employment_status = 'probation'`, seeds `staff_statutory`, and starts the B-6 onboarding checklist. No retyping.
- PDPA: applicant data has a **retention period** (default 12 months after rejection) enforced by a housekeeping cron. Say so on the form.

### B-6 · Onboarding & offboarding workflows — *release v1.44.0* ☐

Today: `users.onboarding_json` + a 6-item hard-coded checklist (`ONBOARDING_ITEMS`), and a one-button `POST /api/v1/users/{id}/offboard` (`index.ts:2884`) that sets status, `left_on`, clears TOTP and deletes sessions. `is_active` is deliberately left alone so the leaver stays in the final payroll — **preserve that**.

`0086_onboarding_tasks.sql`: `checklist_templates` + `checklist_template_items` (kind onboarding/offboarding, task, owner_role, due_offset_days) · `checklist_runs` + `checklist_run_items` (status, owner, completed_by, completed_at, note).

- Offboarding gains an **asset-return step** driven by the existing `assets` table (`assigned_to`): every asset assigned to the leaver becomes a checklist item that must be returned or written off before clearance completes. Today those two modules do not know about each other.
- Final-pay calculation: unused annual leave (if encashable per B-3), pro-rated month, outstanding claims, statutory for a partial month.
- Exit interview form stored in the vault.
- Nothing is deleted on offboarding — the record and the documents stay (payroll history, EA form).

### B-7 · Training & disciplinary records — *release v1.45.0* ☐

`0087_training_discipline.sql`: `training_records` (user, title, provider, kind internal/external/certification, from/to, cost_cents, hrdf_claimable, certificate_key, expires_on) · `disciplinary_records` (user, kind verbal/written/show_cause/inquiry/final, incident_date, summary, issued_by, response, outcome, document_key, expires_on).

- Certificate/licence **expiry alerting** via the existing notification funnel — the same mechanism that already drives birthdays and low stock.
- Disciplinary records are **restricted to `hr_manage` + CEO** and never appear in any list a manager can browse; every read is audited. This is the most sensitive table in the system and should be treated that way from day one.
- HRD Corp levy claimability flag, because the training spend is claimable and nobody tracks it.

### B-8 · Employee self-service & shift management — *release v1.46.0* ☐

Self-service today is one editable field: phone number (`Profile()`, `app/portal/page.tsx:9511`).

- **Self-service with approval**: address, emergency contact, bank details. A bank-detail change is a **request** requiring HR approval and an audit row — never a direct write, because that is the fraud path.
- Self-upload of profile photo (first photo already `hr_manage`; replacements stay admin/CEO — keep that).
- **Shifts**: `0088_shifts.sql` — `shift_patterns` (name, start, end, break minutes, days-of-week) · `shift_assignments` (user, pattern, from, to). Replaces the hard-coded `SHIFT` constant (`staff.ts:63`, 10:00–18:00 Mon–Fri) which currently makes every late/half-day flag wrong for anyone not on office hours. The OT window (opens 18:00 weekdays) derives from the assigned shift instead of a constant.
- **Break punches**: the schema already allows `break_in`/`break_out`; the code refuses them. Enable behind a policy flag.
- Attendance→OT→payroll: today approved OT hours are **typed into payroll by hand**. Wire `ot_records` (approved only) into `payroll_entries.ot_hours` automatically, with a manual override that is audited. Add the rest-day (2.0×) and public-holiday (3.0×) multipliers and the 104 h/month statutory cap warning.


---

## 7. Track C — CRM (P1)

**Goal:** stop treating `customers` as an address book. Know who a client is, what they have bought, what was said last, and what is due next — including the web buyers arriving from ELFIA.

### C-1 · Customer 360 & activity timeline — *release v1.47.0* ☐

`customers` today: `company, contact_person, phone, email, address, delivery_address, notes, website, logo_key, quiet_alerted_on`. One free-text `notes` column, no timestamped interactions, no tags, no owner, no segmentation. Deleting a customer is blocked when documents reference it (`staff.ts:3731`) — good, keep that.

`0089_crm_core.sql`:

```sql
ALTER TABLE customers ADD COLUMN owner_id       INTEGER;  -- account manager (users.id)
ALTER TABLE customers ADD COLUMN customer_type  TEXT;     -- 'company' | 'individual' | 'reseller' | 'web'
ALTER TABLE customers ADD COLUMN industry       TEXT;
ALTER TABLE customers ADD COLUMN source         TEXT;     -- how they found us
ALTER TABLE customers ADD COLUMN tier           TEXT;     -- 'a' | 'b' | 'c'
ALTER TABLE customers ADD COLUMN status         TEXT NOT NULL DEFAULT 'active';  -- active|dormant|lost
ALTER TABLE customers ADD COLUMN credit_terms_days INTEGER;   -- feeds Track D aging
ALTER TABLE customers ADD COLUMN credit_limit_cents INTEGER;
ALTER TABLE customers ADD COLUMN tin            TEXT;     -- LHDN TIN — Track D needs it
ALTER TABLE customers ADD COLUMN sst_no         TEXT;
ALTER TABLE customers ADD COLUMN brn            TEXT;     -- SSM business registration no.
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers (owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);

CREATE TABLE IF NOT EXISTS customer_activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  kind        TEXT    NOT NULL,  -- 'call'|'whatsapp'|'email'|'meeting'|'note'|'doc'|'payment'|'web_order'|'live'
  subject     TEXT,
  body        TEXT,
  ref_type    TEXT,              -- 'doc'|'web_order'|'live_session'|…
  ref_id      TEXT,
  occurred_at TEXT    NOT NULL,
  created_by  INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cust_act ON customer_activities (customer_id, occurred_at);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  name        TEXT NOT NULL, role TEXT, phone TEXT, email TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cust_contacts ON customer_contacts (customer_id);
```

- **Auto-activities.** Every quotation, invoice, receipt, payment, live session and web order writes a `customer_activities` row automatically. A timeline nobody has to maintain is the only kind that stays accurate.
- **Web buyers become customers.** A `web_orders` row with a phone that matches an existing `customers.phone` links (`web_orders.customer_id`); no match creates a `customer_type = 'web'` record. Matching by phone, normalised (strip spaces, `+60`/`0` equivalence) — see [OD-10](#13-open-decisions) on whether to auto-create or queue for review.
- **Customer detail drawer**: profile, contacts, documents (QT/DO/INV/RC/CN), web orders, live sessions, aging, activity timeline, and the existing per-client report link.
- `ROADMAP.md` Phase B already promises exactly this: *"CRM detail view: per-customer quotations/DO/invoices + communication history."* This item closes it.

### C-2 · Pipeline, revived properly — *release v1.48.0* ☐

The `prospects` table exists (`0066`, `0067`) with stages `identified→contacted→replied→meeting→proposal→won→lost`, `next_followup`, `assigned_to`. Its API and tab were removed twice — the second time on **"Sales pipeline is really needed?? I dont think so"** (v1.21.0).

**Do not rebuild what was rejected.** Rebuild the part that was missing: a pipeline is only worth having if it *produces work*. Scope:

- Deals live on `customers`, not on a parallel `prospects` universe — a lead is a customer with `status = 'lead'`. `deals (customer_id, title, value_cents, stage, probability, expected_close, owner_id, lost_reason)` in `0090_deals.sql`.
- **A quotation creates or advances a deal automatically.** No double entry — that is what killed the first pipeline.
- The **follow-up cron comes back** (fixing [S-2](#s-2--the-orphan-pipeline-cron--release-v1351-)), now pointing at a tab that exists, with the notification naming the customer and the amount.
- One board view, one list view, nothing more. Win/loss reasons are mandatory on close — that is the only report that matters.
- **Explicit CEO sign-off required before this item starts.** It was killed once; it does not get rebuilt on a developer's initiative.

### C-3 · Quotation lifecycle & follow-ups — *release v1.49.0* ☐

Today a quotation has **no status at all** — `PATCH` refuses (`staff.ts:4033`), and `valid_until` is stored but nothing acts on it.

`0091_quotation_lifecycle.sql`: `sales_documents.qt_status` (`draft|sent|viewed|accepted|rejected|expired`), `sent_at`, `viewed_at`, `decided_at`, `lost_reason`.

- `viewed_at` is set by the **existing public share-token route** (`/api/v1/public/doc/<32-hex>`, `index.ts:1940`) the first time the customer opens the link. That single line turns a share link into a signal.
- A daily cron marks `expired` past `valid_until` and nudges the owner at 3 and 7 days without a decision. `REVIEW.md:32` asks for exactly this: *"a 'quotations idle > 7 days' list on the dashboard turns the module from record-keeping into pipeline."*
- Dashboard card: open quotations by age bucket, with the WhatsApp chase already written (the pattern used for invoice chasing at `app/portal/page.tsx:8894-8940`).

### C-4 · Communications — *release v1.50.0* ☐

- **WhatsApp**: today every "send" is a manual `wa.me` link. Evaluate WhatsApp Business Cloud API for templated sends (quotation ready, invoice due, order shipped, leave approved). Store every send in `customer_activities`. Note that templates need Meta approval and there is a per-message cost — [OD-11](#13-open-decisions).
- **Email**: `MILESTONES.md:89` records *"Outbound email service choice (unlocks forgot-password and email-verified registration)"* as an open decision owned by you. Those are the two features it explicitly blocks; emailing documents and the D-2 dunning ladder would ride on the same choice. This is the oldest unresolved decision in the repo. Options: Cloudflare Email Routing (receive only), Resend, Postmark, Amazon SES. Recommendation: **Resend** — a Workers-native SDK, simple domain verification, and cheap at this volume. Decide it here, in [OD-12](#13-open-decisions), and stop it blocking three features.
- Once email exists: send QT/INV as PDF, dunning reminders, payslip release notice, password reset.

### C-5 · Client portal v2 — *release v1.51.0* ☐

`/account` today is gated to **Google-OAuth accounts only** (`index.ts:3066-3069`, `locked: true` otherwise) and matched by lower-cased email against `customers.email`. Extend: password accounts allowed once email verification exists (C-4), plus web-order history from ELFIA, statement of account download, and an "accept quotation" button that writes `qt_status = 'accepted'` — which closes the C-3 loop without a phone call.

---

## 8. Track D — accounting & finance (P1)

**Goal:** partial payments, a real AR/AP subledger, credit notes that actually do something, and readiness for LHDN e-Invoicing.

### D-1 · Payments table — the end of one-payment-per-invoice — *release v1.52.0* ☐

Today an invoice carries exactly one `paid_at` / `payment_method` / `payment_ref`. A customer who pays a RM 10,000 invoice in three instalments cannot be recorded. `FEATURE-SUGGESTIONS.md` item 7 asked for partial payments and it was not built.

`0092_payments.sql`:

```sql
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no     TEXT,                 -- from docNumber('PY'), see below
  customer_id    INTEGER,
  doc_id         INTEGER,              -- sales_documents.id; NULL = unapplied / on account
  amount_cents   INTEGER NOT NULL,
  method         TEXT,                 -- bank_transfer|cash|cheque|fpx|billplz|other
  reference      TEXT,
  paid_on        TEXT NOT NULL,
  bank_account_id INTEGER,             -- erp bank_accounts.id
  proof_key      TEXT,                 -- R2
  issuer_code    TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at      TEXT, voided_by INTEGER, void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_doc  ON payments (doc_id);
CREATE INDEX IF NOT EXISTS idx_payments_cust ON payments (customer_id, paid_on);

CREATE TABLE IF NOT EXISTS credit_note_applications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_note_id INTEGER NOT NULL,
  doc_id         INTEGER NOT NULL,
  amount_cents   INTEGER NOT NULL,
  applied_at     TEXT NOT NULL DEFAULT (datetime('now')),
  applied_by     INTEGER
);
```

- **Backfill, not replace.** A migration copies every existing `paid_at`/`payment_method`/`payment_ref` triple into `payments`. The invoice columns stay (append-only rule) and become **derived**: `payment_status = paid` when `SUM(payments) + SUM(credit applications) >= total_cents`. Every read path switches to the derived value in the same release.
- Receipts move from one-per-invoice to **one per payment**, keeping the `RC-` series. Partial receipts state the balance.
- A payment books cashflow + a balanced journal entry idempotent by `ref = 'PAY-<id>'`, and **now posts to `1200 Accounts receivable`** — the seeded GL code nothing has ever used.
- **Credit notes finally do something**: `credit_note_applications` reduces an invoice's outstanding balance, reduces recognised revenue in `revenueLines()`, and posts to the GL. Today a credit note is recorded and then ignored entirely.
- Voiding a payment writes a reversing journal entry — never deletes.

### D-2 · Accounts receivable & dunning — *release v1.53.0* ☐

- Move aging **server-side**: `GET /staff/ar/aging` with buckets aged from **`due_date`** (today's client-side card ages from `created_at`, which overstates), honouring `customers.credit_terms_days`.
- A daily cron sets `payment_status = 'overdue'` automatically — today it must be set by hand and therefore never is.
- Dunning ladder: day 1 / 7 / 14 / 30 after due, each step producing a pre-written WhatsApp or email (needs C-4), logged to `customer_activities`, with a manual "pause chasing" per customer.
- Statement of account becomes a **server-generated PDF** (today it is a client-side print built from already-fetched rows) so it can be emailed and archived.

### D-3 · LHDN e-Invoice (MyInvois) readiness — *release v1.54.0 → v1.56.0* ☐

`FEATURE-SUGGESTIONS.md` item 4 asked for this in July 2026 and **nothing exists** — no TIN, no SST number, no MyInvois field anywhere in the schema.

> **Check your mandate date first.** LHDN phases e-Invoicing in by annual turnover, and the thresholds and dates have moved more than once. Confirm A2Z CREATIVE MARKETING's and AZ ONE OFFICIAL's actual obligation date with LHDN or your tax agent before scheduling this — it determines whether this is a v1.54 item or an urgent one. This plan builds the capability; it does not assert your deadline.

Three sub-releases:

1. **v1.54.0 — data readiness.** `0093_einvoice_fields.sql`: supplier TIN/BRN/SST/MSIC on each issuer (`lib/issuers.ts` gains the fields, guarded byte-stable like the bank details); buyer TIN/BRN/SST on `customers` (added in C-1); **classification code and UOM per line item** (`sales_documents.items` JSON gains `classification`, `uom` — validated on write); currency and exchange rate columns.
2. **v1.55.0 — document model.** Immutable invoice numbers (already true — `docNumber` never changes); the full e-Invoice field set; self-billed and consolidated invoice types; a validation endpoint that reports every missing mandatory field **before** submission.
3. **v1.56.0 — submission.** MyInvois API integration: certificate handling, submit, poll for validation, store the UIN and QR, 72-hour cancellation window, rejection handling. Put every submission in an outbox with retries — the same discipline the ELFIA store uses for movements, for the same reason.

**SST** (`FEATURE-SUGGESTIONS.md` item 5): today the document carries a raw `tax_percent` number and `2100 SST payable` is never posted to. Add proper tax codes per line, an SST registration number on the issuer, and GL posting.

### D-4 · Accounts payable & supplier bills — *release v1.57.0* ☐

`gl_accounts` seeds `2000 Accounts payable` and nothing has ever posted to it. `purchase_orders` is all-or-nothing at `received` with no bill and no payment.

`0094_payables.sql`: `supplier_bills` (supplier, bill_no, po_id, dates, amounts, status draft/approved/paid/void, attachment) · `supplier_payments` (bill, amount, method, ref, bank_account, paid_on) · link `supplier_returns.supplier_id` to `suppliers.id` (backfill by name, keep the text column).

- PO → goods receipt → bill → payment, each step posting to the GL.
- Payables aging and a "due this week" card, mirroring AR.
- Recurring expenses (`expenses.recurring`, `due_day`) roll into the same "money out" view instead of a separate card.

### D-5 · Period close & statements — *release v1.57.1* ☐

- `accounting_periods` (month, status open/closed, closed_by, closed_at). A closed period refuses new journal entries; a correction is a **new** entry in an open period, never a backdated edit.
- Real **P&L and balance sheet from the GL** — today the ledger is only read back as a journal list and a trial balance, and `/finance/pnl` is computed from source tables rather than from the ledger at all. Two numbers that should agree and are never compared: add a reconciliation report that compares them and flags a difference. That report will find real bugs.
- Budget vs actual for expenses by category (today only the ads fund has a budget).

---

## 9. Track E — warehouse & purchasing (P1)

**Goal:** one truthful stock ledger, more than one place to keep stock, and a purchasing flow that survives a partial delivery.

### E-1 · Unify the stock ledger — *release v1.58.0* ☐ **do this before anything else in E**

`stock_ledger` was created in [A-2](#a-2--movements-endpoint-b--the-stock-ledger--release-v1360-). Right now only bridge movements write to it. This release makes it the **single truth**:

1. Route **all seven** mutation sites through one `applyStockMovement(env, {item_id, delta, source, ref_type, ref_id, reason, user_id})` helper — including the TikTok sync (`recordTiktokLine()`, `index.ts:524-549`), which today writes `postage_items` and leaves no ledger row at all.
2. Backfill historical movements into `stock_ledger` from `manual_stockouts`, `manual_sales`, `postage_items` and `supplier_returns`, tagged by `source`, in one migration with a recorded row count.
3. **Reconciliation guard** (`tests/stock-ledger-balance.mjs`, **#15**): for every item, `SUM(stock_ledger.delta)` from the backfill epoch must equal `inventory_items.stock`. A drift is a bug; failing the build on drift is the point.
4. A per-item movement history in the UI — "why is this 24 and not 26" answered in one click, which is the question the ELFIA bridge will make people ask constantly.
5. Add `cost_cents` to `inventory_items` and a moving-average cost on the ledger, so **gross margin becomes reportable** (today it is not — there is no cost price on catalogue items).

### E-2 · Locations & transfers — *release v1.59.0* ☐

`0095_locations.sql`: `locations` (code, name, kind warehouse/shop/live_studio/stokis/consignment, address, active) · `stock_by_location` (item, location, qty) · `stock_transfers` + lines (from, to, status draft/in_transit/received).

- `stock_ledger` gains `location_id`. `inventory_items.stock` becomes the **sum across locations** — computed, and a guard asserts it.
- ELFIA's bridge publishes **one nominated location** (or the total — [OD-13](#13-open-decisions)). Getting this wrong oversells the web shop, so it is a decision, not a default.

### E-3 · Stock take, reorder points, barcode — *release v1.60.0* ☐

`0096_stocktake.sql`: `stock_takes` (location, date, status draft/counting/review/posted, counted_by) · `stock_take_lines` (item, expected, counted, variance, reason).

- Posting a stock take writes **compensating ledger rows**, never an absolute overwrite. A count that silently overwrites is how the trail dies.
- Variance report by value, requiring approval above a threshold.
- `reorder_point` / `reorder_qty` per item per location; a "to reorder" list feeding straight into a draft PO. Today the only signal is the fixed `stock <= 5` low-stock cron.
- `barcode` column + camera scanning in the PWA for counting and picking (Track G).

### E-4 · Purchasing v2 — *release v1.61.0 → v1.62.0* ☐

- **Partial receipt.** A PO is all-or-nothing at `received` today (`erp.ts:525-568`), and its idempotency is `WHERE status != 'received'`. Introduce `goods_receipts` + lines; a PO's status derives from what has actually arrived. Keep the idempotency property — receiving twice must still move stock once.
- PO numbering moves from `nextNo` (`COUNT(*)`, non-atomic, relying on a UNIQUE collision to produce a clean 400) onto `docNumber`'s atomic `doc_counters_daily` with a `PO` type.
- Supplier price history, lead times, and a preferred supplier per item.
- Approval thresholds via `approval_chains` from [B-2](#b-2--org-chart--manager-based-approvals--release-v1400-) — one approval engine for claims, leave and purchases.
- Link `supplier_returns` to the PO that brought the goods in.

---

## 10. Track F — analytics & BI (P2)

**Goal:** answer questions across modules, in one place, on the CEO's phone.

Today's reporting is a good set of **single-purpose endpoints** (`/dashboard/summary`, `/overview`, `/revenue`, `/finance/pnl`, `/gmv`, `/sales/by-hour`, `/fulfilment/summary`, `/orders/geo`, `/leaderboard`, `/clients/summary`, `/clients/live-economics`, `/reports/outstanding`, `/erp/gl/trial-balance`). What is missing: date-range control (most cards are month or a fixed 7 days), exports (only attendance CSV and the payroll files export), gross margin (no cost price — fixed in E-1), cohort/retention/LTV, and any cross-module view.

| Release | Item |
|---|---|
| **v1.63.0** ☐ | **CEO dashboard**: one screen — cash position, revenue vs target by line (A2Z services · TikTok · ELFIA web · stokis), AR aging, payroll cost incl. employer statutory, headcount and attendance, top 5 customers, stock value. Everything sourced from the existing single-truth functions (`revenueLines()`, `netPay`) so nothing can disagree. |
| **v1.64.0** ☐ | **Date-range engine**: a shared `?from=&to=` contract across every report endpoint, plus comparison to the previous period. One implementation, applied everywhere. |
| **v1.65.0** ☐ | **Export everywhere**: CSV from every report; a scheduled monthly pack (PDF) mailed to the CEO once email exists (C-4). |
| **v1.66.0** ☐ | **Cross-module analytics**: customer LTV and retention cohorts, product gross margin (needs E-1 cost), sales-cycle length (needs C-2/C-3 timestamps), staff cost per revenue ringgit, ELFIA web vs TikTok vs direct channel comparison. |

Deliberately **not** in scope: a third-party BI tool. The data is in one D1 database and the audience is a handful of people; a bespoke dashboard is cheaper than a licence and a pipeline.

---

## 11. Track G — mobile, PWA & notifications (P2)

The PWA already exists: `public/manifest.json` (`start_url: /portal`, standalone), `public/sw.js` (`azone-shell-v31`, network-first, `/api/*` never cached), RFC 8291 web push implemented from scratch in `worker/src/webpush.ts` with no dependencies, `push_subscriptions`, SSE notification stream, and a synthesized two-tone chime on a new unread.

| Release | Item |
|---|---|
| **v1.67.0** ☐ | **Offline clock-in.** Today a punch requires the network and a GPS fix. Queue a punch in IndexedDB when offline and replay it on reconnect, with the **original** timestamp and fix, marked `deferred` so it is visibly not a live punch. Rate-limit and cap the replay window (say 6 hours) so this cannot become a back-dating tool. |
| **v1.68.0** ☐ | **Notification preferences.** One funnel already exists (`notify()` → D1 → Web Push → optional `NOTIFY_WEBHOOK`). Add per-user, per-kind opt-outs and a digest mode; today everyone gets everything and the volume will only grow as this plan lands. |
| **v1.69.0** ☐ | **Split the portal page.** `app/portal/page.tsx` is **12,080 lines in one client component**. Every tab this plan adds makes it worse: slower first paint, harder review, and a single error boundary for 23 unrelated features. Move each tab to its own lazily-loaded component under `components/portal/`, keeping the existing string-literal tab + sessionStorage memory model (do not introduce a router — the static export and the tab-access override system both depend on it). This is refactor-only: **no behaviour change, and the Playwright suites are the proof.** |

Also in this track: barcode scanning for stock take (E-3), camera receipt capture for claims, and a review of whether **Google OAuth sign-in bypassing the TOTP challenge** is acceptable now that 2FA is mandatory for every staff role (`WORKFLOW.md` §4.2 records the bypass; `permissions.ts:55-58` records the mandate). Those two statements are in tension — [OD-14](#13-open-decisions).

---

## 12. Migration allocation

Reserve numbers now so parallel tracks do not collide. **Keep file numbers monotonic even if you ship out of order** — a gap is fine, a duplicate is not.

| Range | Track | Purpose |
|---|---|---|
| `0075` | A-1 | `bridge_enabled`, `elfia_price_cents` |
| `0076` | A-2 | `bridge_events`, `stock_ledger`, `sku_key` |
| `0077` | A-3 | `web_orders`, `web_order_lines` |
| `0078` | S-3 | PO `direction` data fix (S-1 needed **no migration** — deterministic R2 keys + audit_log; numbering shifted down one) |
| `0080` | B-1 | `statutory_rates`, `staff_statutory`, `payroll_statutory` |
| `0081` | B-2 | `manager_id`, `approval_chains` |
| `0082`–`0083` | B-3 | leave type rebuild, `leave_policies`, carry-forward |
| `0084` | B-4 | performance & appraisal |
| `0085` | B-5 | recruitment |
| `0086` | B-6 | onboarding/offboarding checklists |
| `0087` | B-7 | training, disciplinary |
| `0088` | B-8 | shift patterns & assignments |
| `0089`–`0091` | C | CRM core, deals, quotation lifecycle |
| `0092`–`0094` | D | payments, e-Invoice fields, payables |
| `0095`–`0096` | E | locations, stock take |
| `0097`+ | F, G | reserved |

Every migration also bumps `LATEST_MIGRATION` (`worker/src/index.ts:241`) and `EXPECTED_MIGRATIONS` (`worker/src/index.ts:~2869`), and adds a "History (do not remove)" row to `DATABASE.md`.

---

## 13. Open decisions

Nothing here should be settled by whoever writes the code first. Each needs your answer.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **OD-1** | Does `live_rebate_cents` affect the ELFIA web price? | (a) Never — web price is `elfia_price_cents` or `unit_price_cents`. (b) Web price is net of the live rebate. | **(a).** The live rebate is a TikTok LIVE mechanic. If you want a web discount, set `elfia_price_cents` — explicit beats implicit when it is the price a customer pays. |
| **OD-2** | Should the portal also push price/stock to the store, or keep the store pulling every 5 min? | (a) Pull only (as specced). (b) Add a push-on-change. | **(a).** The contract is written and the store side is built. Five minutes is fine for a price change. |
| **OD-3** | How do we resolve an `unknown_sku` from ELFIA? | (a) Create the item in the portal. (b) Alias the store SKU to an existing item. (c) Human-only, no tooling. | **(b)** — an `sku_aliases` table. Creating an item automatically risks a typo becoming a product. |
| **OD-4** | Are Billplz/FPX fees recorded in the portal? | (a) Gross only for now. (b) Ask the store to expose the fee in feed C, post to `6900`. | **(b)**, but as a Track D item — it needs a small change on the store side too. |
| **OD-5** | Are web orders attributed to a salesperson / eligible for commission? | (a) No — no live session, no shift. (b) Yes, to whoever runs ELFIA. | **(a)** initially, asserted by a test. Revisit when ELFIA has a dedicated owner. |
| **OD-6** | The orphan prospects cron | (a) Delete now, restore in C-2. (b) Leave it firing at a dead tab. | **(a).** |
| **OD-7** | `docNumber` hard-codes `AZOO` in every number, so an A2Z-issued invoice reads `INV-AZOO220826-1`. | (a) Intended, leave it. (b) Derive the mark from `issuer_code`. | Needs your call. (b) is more correct but changes the number format — and numbers are immutable, so it can only apply going forward. |
| **OD-8** | Statutory treatment of hourly part-time live hosts | Depends on their actual employment status and the schemes' own rules. | **Confirm with your accountant.** Do not let the code decide this. |
| **OD-9** | Leave encashment on exit | (a) Build it. (b) Policy says no, skip. | Answer before B-3 starts. |
| **OD-10** | Web buyer → customer record | (a) Auto-create on first order. (b) Queue for review. | **(a)** with phone-normalised matching; a `web` type keeps them out of the B2B client list. |
| **OD-11** | WhatsApp Business API | (a) Adopt (templates need Meta approval, per-message cost). (b) Stay with manual `wa.me` links. | Volume decides. Manual links are working today; revisit at C-4. |
| **OD-12** | **Outbound email provider** — the oldest open decision in the repo (`MILESTONES.md:89`) | Resend · Postmark · Amazon SES · Cloudflare Email Routing (receive only) | **Resend.** It unblocks the two features the milestone names (forgot-password, verified registration) and makes emailed documents and the D-2 dunning ladder possible. One choice, four things move. |
| **OD-13** | Which location's stock does ELFIA see once E-2 lands? | (a) One nominated location. (b) Total across all. | **(a).** Publishing the total oversells the web shop the moment stock sits in a studio or with a stokis. |
| **OD-14** | Google OAuth sign-in bypasses the mandatory TOTP challenge | (a) Accept (Google account is itself 2FA-protected). (b) Enforce TOTP after OAuth for staff roles. | Needs your call. If (a), write it into `SECURITY.md` as a deliberate decision rather than leaving it as a footnote. |

---

## 14. Risk register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **Double-deducted stock** from a bridge idempotency bug | Sells stock that does not exist; loses customer trust on both systems | Medium | `UNIQUE(source, event_id)`, `ON CONFLICT DO NOTHING`, guard #11 replaying the same id five times, and a daily reconciliation report (A-4) |
| **Wrong statutory figures** | Penalties, staff underpaid, a payroll that has to be re-run | Medium-High | Rates as effective-dated data, a ~30-case fixture guard, and a required review by your accountant before the first live run — stated in B-1 |
| **One D1, no preview database** | A bad migration hits production data directly | Medium | Migrations from `main` only (`deploy-api.sh`); nightly R2 backup already runs at 03:20 MYT; **restore-from-backup must be rehearsed once before Track B**, because an untested backup is not a backup |
| **`app/portal/page.tsx` at 12,080 lines** | Every new tab makes review and first paint worse; one error boundary for 23 features | High | G-3 splits it. Until then, every new tab in this plan lands as its own `components/portal/*.tsx`, never inline |
| **Signature PNGs already public** | Forged documents; the exposure window is unknown | Already happened | S-1, plus rotating the signature images |
| **Scope creep across seven tracks** | Nothing finishes | High | Ship release by release; each item has acceptance criteria; this document is reviewed at each release |
| **Cloudflare builder cannot run the Playwright guards** | A UI regression reaches production | Medium | The 4 browser suites plus `scratch/` run locally before each release — `run-guards.mjs` already prints what it does **not** cover on every run. Keep that honesty |
| **Store and portal deploy independently** | A minute of contract mismatch during a release | Low | Additive changes only: add `price_cents` before the store reads it; ship endpoint B before the store is pointed at it |
| **ELFIA key rotation drops movements** | Sales silently not deducted | Low | Runbook in A-4: accept both old and new key for one overlap window, rotate the store, then retire the old |
| **PDPA exposure** — resumes, MC files, disciplinary records, IC numbers | Regulatory and human harm | Medium | Everything under R2 `private/`, `hr_manage`-only reads, audited access, retention cron for applicant data |

---

## 15. Testing & release discipline

Nothing in this plan ships outside the existing machinery. Extend, do not replace.

**Guards** — currently 9, all in `tests/`, run by `scripts/run-guards.mjs` as part of `npm run ci` (Cloudflare's build command). A guard that *cannot run* is a failure, never a skip. This plan adds six:

| # | New guard | Track |
|---|---|---|
| 10 | `bridge-feed-guard.mjs` — feed A payload shape | A-1 |
| 11 | `bridge-idempotency.mjs` — same `event_id` applies once | A-2 |
| 12 | `no-public-signatures.mjs` — nothing under `public/signatures/` | S-1 |
| 13 | `statutory-payroll.mjs` — the contribution fixture table | B-1 |
| 14 | `approval-chain-parity.mjs` — table-driven chain == legacy arrays | B-2 |
| 15 | `stock-ledger-balance.mjs` — `SUM(ledger) == inventory_items.stock` | E-1 |

**Per release, in order:**

1. `npm run ci` green locally (typecheck → guards → build).
2. The 4 Playwright suites (`bm-coverage`, `leaderboard-sales-floor`, `location-scenarios`, `no-false-attendance`) and the relevant `scratch/` e2e — Cloudflare's builder has no Chromium, so this step is on you and cannot be skipped.
3. Migration applied to a **local** D1 first (`worker/package.json` → `migrate:local`), then the migration reviewed by a second pair of eyes if it is destructive or a table rebuild.
4. Push `dev` → guards + website preview → PR to `main`.
5. `main` builds, `deploy-api.sh` applies migrations and prints the health check.
6. Verify `/api/v1/health` reports the expected `LATEST_MIGRATION`.
7. `CHANGELOG.md` entry written for the CEO — a quote, what broke, what changed, how it was proved.
8. **Update this document**: flip the item's status, record the shipped version, add a revision-log line.

**For Track A specifically**, add: the store's `/api/v1/health` shows both bridge flags true, and the store's `/admin → Products` sync report is clean.

---

## 16. Revision log

Newest first. One line per change; say what changed and why, not just that something changed.

| Date | Rev | Change | By |
|---|---|---|---|
| 2026-08-22 | 0.4 | **A-2, A-3, A-4, S-1, S-2, S-3 built** (v1.36.0–v1.38.0, one deploy): migrations `0076`–`0078`, `bridge-core.ts`/`bridge.ts`, movements endpoint with the ON-CONFLICT dedupe, 5-min orders poller + Web Orders tab, `elfia` revenue bucket + `ELF-` cash booking, health block, reconcile report, signature vault (nine call sites repointed — six more than the CHANGELOG knew of), orphan cron deleted, PO direction fixed. Guards #11 `bridge-idempotency` (same event ×5 → one deduction, proven against the real schema and the shipped INSERT) and #12 `no-public-signatures`. All 12 guards + typecheck green. Migration numbering: S-1 needed no table, so `0078` is the PO fix and `0079` is free again. | Claude |
| 2026-08-22 | 0.3 | **A-1 built** (v1.35.0): migration `0075_bridge_pricing`, `worker/src/bridge-feed.ts` pure serialiser, feed rewrite with skew fallback, `PATCH /staff/inventory/{id}/bridge`, "ELFIA web" column on the Inventory tab, guard #10 (16 checks), wrangler secrets list completed (all four gaps). All 10 guards + typecheck green; build blocked only by the sandbox's Google-Fonts fetch (known AUTO-DEPLOY.md limitation). Status ☐ → ◐ pending deploy + spec checklist 5/8. | Claude |
| 2026-08-22 | 0.2 | Fact-check pass over every file:line citation and every "does not exist" claim. Corrected: permission key count (26, not 28), the `inventory` permission's real role list, the net-pay formula line, the `sku_key` write sites (`/inventory/{id}/edit`, not `PATCH /inventory/{id}`), the CSRF claim (no bypass exists or is needed), a **third** file fetching signature PNGs (`lib/doc-template.ts:146`), the undocumented-secrets list (four, not one), and the MILESTONES email quote. | Claude |
| 2026-08-22 | 0.1 | First draft. Seven tracks derived from a full read of the portal (v1.34.0, 74 migrations) and the ELFIA store's `PORTAL-BRIDGE-SPEC.md`. Sequencing set to Track A ∥ Track B per CEO. 14 open decisions raised. | Claude, for Alīf |

---

## 17. Appendix — the ELFIA contract in one page

For anyone implementing Track A without the store repo to hand. Authoritative source: `PORTAL-BRIDGE-SPEC.md` in `elfiaofficialstore`.

| | A — inventory + price | B — movements | C — orders |
|---|---|---|---|
| **Direction** | portal → store | store → portal | portal ← store |
| **Lives on** | portal | portal | store |
| **Method** | `GET <BRIDGE_URL>` | `POST <BRIDGE_PUSH_URL>` | `GET /api/v1/bridge/orders?since=` |
| **Auth** | `X-Bridge-Key` | `X-Bridge-Key` | `X-Bridge-Key` |
| **Frequency** | store polls every 5 min | immediately on order + 5-min retry cron | portal polls (every 5 min proposed) |
| **Payload** | `{items:[{sku,name,stock,price_cents?}]}` | `{movements:[{event_id,sku,delta,reason,reference,occurred_at}]}` (≤50) | `{orders:[…], cursor, store}` (≤200, oldest-change-first) |
| **Response** | 200 with the **whole** list | `{applied:[],ignored:[],unknown_sku:[]}` — **event ids, not SKUs** | 200 |
| **Status** | ☑ exists, **missing `price_cents`** | ☐ **not built** | ☐ **not polled** |

**Non-negotiables**

- One shared secret, compared in **constant time**, `401` with no hint on mismatch. Server-to-server only: no cookies, no CORS.
- SKUs match **case- and whitespace-insensitively** (`LUMI 004` ≡ `LUMI004`). Neither side renames anything.
- `price_cents` is an **integer in sen**, and it is the **net price the customer must actually pay** — never ringgit as a decimal, never a pre-rebate figure.
- **Idempotency by `event_id` is the one rule that must not be got wrong.** Applied twice = stock deducted twice.
- **Silence means retry.** Any `event_id` missing from all three lists will be sent again.
- The store **never sends absolute counts** — only deltas. The portal owns the true number.
- The store **will not accept a count for a SKU whose movements the portal has not yet acknowledged.** Acknowledging honestly is what keeps the two systems from fighting.
- A cancelled order's pieces **already came back through B** — feed C must not restock them a second time.
- The customer's private order-page token is deliberately excluded from feed C. Do not reconstruct it.
