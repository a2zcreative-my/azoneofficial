# ELFIA bridge — runbook

**For:** whoever operates the portal when something about the store sync looks wrong.
**Contract:** `PORTAL-BRIDGE-SPEC.md` in the store repo. **Plan:** `IMPLEMENTATION-PLAN.md` Track A.

The bridge is three feeds on one shared secret:

| Feed | Direction | Where | Cadence |
| --- | --- | --- | --- |
| A — stock + price | portal → store | `GET /api/v1/bridge/elfia-inventory` (portal) | store pulls every 5 min |
| B — movements | store → portal | `POST /api/v1/bridge/elfia-movements` (portal) | pushed on every order + 5-min retry |
| C — orders | portal ← store | `GET <ELFIA_ORDERS_URL>?since=<cursor>` (store) | portal polls every 5 min |

Health at a glance: `https://a2zcreative.my/api/v1/health` → `elfia_bridge` block, and the
**ELFIA bridge card** on the portal's Inventory tab. The store's side:
`https://elfiaofficialstore.my/api/v1/health` → `bridge_pull_configured` / `bridge_push_configured`.

---

## Switching it on (one time)

Portal (this repo — after the deploy that carries migrations 0075–0082):

```
cd worker
npx wrangler secret put ELFIA_BRIDGE_KEY    # any long random value — you will paste the SAME value into the store
npx wrangler secret put ELFIA_ORDERS_URL    # https://elfiaofficialstore.my/api/v1/bridge/orders
```

Store (the elfiaofficialstore repo):

```
cd worker
npx wrangler secret put BRIDGE_URL          # https://a2zcreative.my/api/v1/bridge/elfia-inventory
npx wrangler secret put BRIDGE_PUSH_URL     # https://a2zcreative.my/api/v1/bridge/elfia-movements
npx wrangler secret put BRIDGE_KEY          # the SAME value as ELFIA_BRIDGE_KEY above
```

Generate the key locally so it never appears in a chat or a file, e.g.
`openssl rand -hex 32` (or PowerShell:
`-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})`).

Then run the spec's checklist (steps 4–8): store health shows both flags true →
store /admin → Products → **Sync with portal now** is clean → RM 1 test order
drops the count by one → cancel restores it → the same `event_id` curled twice
moves the count once → the test order appears in the portal's Web Orders tab →
a portal price change reaches the shop within 5 minutes.

## Rotating the shared key without losing a movement

The store retries any unacknowledged movement, so a short 401 window loses
nothing — it only delays. Still, do it in this order:

1. Portal: `npx wrangler secret put ELFIA_BRIDGE_KEY` with the NEW value.
2. Store: `npx wrangler secret put BRIDGE_KEY` with the same new value, deploy.
3. During the gap the store's pushes answer 401 → its outbox holds them → the
   next 5-min retry after step 2 delivers everything. Confirm on the
   Inventory tab's bridge card ("last sale reported" catches up).
4. If a key has ever been pasted into a chat, an email or a screenshot,
   rotate it — the same rule the store's README applies to Billplz keys.

## `unknown_sku` showing on the Inventory card

The store sold something the portal has no matching SKU for. Nothing was
applied and the store has ALREADY stopped retrying those events — they are a
human's job now:

1. Decide which portal item it should be. Rename that item's SKU (Inventory →
   Edit) to match the store's spelling — case and spaces do not matter,
   `LUMI 001` ≡ `LUMI001` — or create the item if it truly is new.
2. The listed events are NOT replayed automatically. Adjust the count
   manually (Out −, with the order reference in the remark) for the pieces
   those sales took.
3. The card clears as new movements for that SKU start applying.

## The poller stopped (bell: "ELFIA orders feed unreachable for 3 polls")

- `curl -H "X-Bridge-Key: <key>" "<ELFIA_ORDERS_URL>"` — a 401 means the keys
  have drifted (rotate, above); a timeout means the store itself is down.
- The cursor lives in `system_meta.elfia_orders_cursor`. It only ever moves
  forward after a fully-written page, so restarts are safe. To force a full
  re-read, delete that row — the upsert makes a replay harmless (same orders,
  same rows).
- Errors land in error_log under `elfia_orders_poll` (/admin → Audit).

## A clamp alert ("ELFIA sold N× SKU but the portal only had M")

The web shop sold pieces the portal did not think existed. The count is now 0
and the ledger recorded the APPLIED delta (what actually happened to the
number), not the requested one.

1. Count the physical stock for that SKU.
2. Set the real number via Inventory (In + with a remark naming this alert).
3. Ask why the portal was low: an unrecorded manual sale? a TikTok order that
   never synced? The `stock_ledger` for the item (and
   `/staff/bridge/reconcile?date=`) shows every recorded movement for the day.

## Reading the reconcile report

`GET /api/v1/staff/bridge/reconcile?date=YYYY-MM-DD` — each published SKU with
the day's ledger movements by source. Until Track E routes every mutation site
through `stock_ledger`, it carries ELFIA movements only, and says so in the
response — do not read it as full coverage yet.

## Pending refunds (bell: "PAID and is now CANCELLED")

A paid web order the store later cancelled. Its revenue stays booked — by
design (OD-17b, the same rule as "paid invoices cannot be silently
cancelled"). The Web Orders tab shows the order; decide the refund, then
correct the books the way you would any refund (credit note / manual
cashflow adjustment naming `ELF-<order_number>`). The flag and count sit on
the bridge health card until the cancelled orders are dealt with.

## First run & importing history

The very first poll SEEDS its cursor to "now" — the store's back catalogue
is deliberately NOT imported (it would land months of revenue in one day's
books). If you ever want history in the portal, that is a one-off decision:
clear `system_meta.elfia_orders_cursor` **and** accept that every historical
paid order will book cash on the day you do it — or ask for a proper
backdated import instead.

## A movement stuck at outcome 'pending'

Normal for seconds (a retry in flight), never for days. A pending row means
an apply-batch failed after the event was recorded; the store WILL retry it
and the retry applies cleanly (guard #11 proves this exact path). If one is
old, the store may have been told a whole-request failure and be holding the
batch — check `error_log` under `bridge_movements` and the store's outbox.
Never hand-flip a pending row to 'applied': that recreates audit finding B1
(the store stops retrying a sale that never landed).

## What is deliberately NOT automatic

- `unknown_sku` resolution (a typo must not become a product).
- Restocking from a cancelled order seen in feed C (feed B already did it —
  doing it again would double-restock; guard #11 enforces this).
- Attributing web orders to a salesperson (no live session, no shift; also
  guard-enforced).
