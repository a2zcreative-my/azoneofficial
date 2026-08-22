# API

## Current

No API — the site is fully static. Leads arrive via WhatsApp deep links (`https://wa.me/60123834821`) and email.

## Phase 3 — IMPLEMENTED in `/worker`: health · enquiries (POST public rate-limited, GET/PATCH marketing+) · auth (login rate-limited/logout/me) · dashboard summary · content GET/PUT · media upload/serve/delete (R2) · full CRUD for products/posts/portfolio/testimonials (editor+ write, admin+ delete, public reads filtered). Also implemented: GET /content (editor+ listing) · users management (GET/POST /users, PATCH /users/:id — super_admin only) · dashboard summary now includes posts/testimonials counts and recent audit activity. Table below is the reference.

Base: `/api/v1`, JSON, session-cookie auth for admin routes.

| Method         | Route                                     | Auth                  | Purpose                             |
| -------------- | ----------------------------------------- | --------------------- | ----------------------------------- |
| POST           | /auth/login                               | public (rate-limited) | Create session                      |
| POST           | /auth/register                            | public (rate-limited) | Self-register (pending approval)    |
| GET            | /auth/google                              | public                | Redirect to Google OAuth            |
| GET            | /auth/google/callback                     | public                | OAuth callback → session or pending |
| POST           | /auth/logout                              | session               | Destroy session                     |
| GET            | /content/:key                             | public                | Read site content                   |
| PUT            | /content/:key                             | editor+               | Update site content                 |
| GET/POST       | /products                                 | public / editor+      | List / create products              |
| GET/PUT/DELETE | /products/:id                             | public / editor+      | Read / update / delete              |
| POST           | /enquiries                                | public (rate-limited) | Contact form submission             |
| GET/PATCH      | /enquiries/:id                            | marketing+            | Read / update status                |
| CRUD           | /posts, /portfolio, /testimonials, /media | editor+               | Content management                  |
| GET            | /dashboard/summary                        | admin+                | Stats for dashboard                 |

Error format: `{ "error": { "code": string, "message": string } }`. All request bodies validated with Zod; responses typed in `types/`.

## Staff Portal API (`/api/v1/staff/*`) — all require auth

profile GET/PATCH · users GET/PATCH (HR) · attendance POST/GET, report GET (HR) · leave POST/GET/balance, PATCH :id (cancel|approve|reject) · announcements GET/POST, POST :id/ack · tasks GET/POST/PATCH :id, comments GET/POST · customers GET/POST/PUT :id (sales roles) · docs GET/POST (auto number QT/DO/INV), PATCH :id (delivery/payment status) · notifications GET, read POST.
Roles: super_admin, admin, editor, marketing, managing_director, coo, business_dev, finance_admin, live_manager, live_host. Module permissions in worker/src/staff.ts (PERMS map).

## v1.4.4 — staff role-module endpoints (`/api/v1/staff/…`)

All permission-checked server-side (see the matrix in ADMIN_GUIDE.md).

| Endpoint                       | Methods          | Who                                                  | Notes                                                                                                                   |
| ------------------------------ | ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/attendance/report`           | GET              | hr_manage                                            | Now returns per-event `myt_time` and `flag` (ok / late / early_out / weekend) against the 10:00–18:00 MYT Mon–Fri shift |
| `/task-reports`                | GET, POST        | HR writes; executives read                           | `period`: daily / weekly / monthly                                                                                      |
| `/birthdays`                   | GET              | all staff                                            | Sorted by month-day; HR maintains via `PATCH /users/:id` (`birthday`)                                                   |
| `/inventory`, `/inventory/:id` | GET, POST, PATCH | sales_marketing/marketing/coo write; executives read | Stock changes auto-set status                                                                                           |
| `/postage`, `/postage/:id`     | GET, POST, PATCH | same as inventory                                    | Status: preparing / shipped / in_transit / delivered / returned                                                         |
| `/materials`, `/materials/:id` | GET, POST, PATCH | same as inventory                                    | Status: requested / in_progress / done / rejected                                                                       |
| `/bd`, `/bd/:id`               | GET, POST, PATCH | cco writes; executives read                          | Status: open / pending / kiv / closed_won / closed_lost                                                                 |
| `/ops-reports`                 | GET, POST        | coo writes; executives read                          | One per day per author; resubmit updates                                                                                |
| `/overview`                    | GET              | exec_view (ceo + management)                         | Read-only aggregate: attendance today, pending leave, docs, low stock, pipeline, latest ops report                      |

Document numbering on `POST /docs` now issues `{TYPE}-AZOO{DDMMYY}-{X}`.

## History (do not remove)

| Version | Change                                                                         |
| ------- | ------------------------------------------------------------------------------ |
| v1.4.4  | Role-module endpoints; shift-flagged attendance report; new doc number format. |

## Notable endpoint changes v1.25–v1.26 (2026-08)

- `GET /api/v1/auth/me` — re-issues the `csrf_token` cookie when the session is valid but the cookie is missing (v1.26.2 self-heal).
- `GET /api/v1/staff/leaderboard` — `rank` is now `number | null` (null = on the sales floor with zero attributed sales; sales_marketing / live_host / cco are always listed, other roles only with sales or a target). Attribution adds manual walk-in sales and shift-window TikTok orders for sales_marketing (v1.25.5–v1.25.6).
- `POST /api/v1/staff/attendance` — accepts `no_location_reason`; stores `gps = "no_location:<reason>"`, flags red in registers, bell-notifies HR/COO/CEO (v1.25.3). A punch with no location AND no reason is still refused.
- `GET /api/v1/health` — includes `version` (single source: package.json).

## Notable endpoint changes v1.35.0 (2026-08-22) — ELFIA bridge, feed A completed

- `GET /api/v1/bridge/elfia-inventory` — **server-to-server, `X-Bridge-Key` header** (constant-time compare against the `ELFIA_BRIDGE_KEY` secret; unset = 501, wrong = 401, no CORS, no cookies). Now returns `price_cents` per item — `elfia_price_cents` when set, else `unit_price_cents`; the key is **omitted** when there is neither (the store keeps its own price). Scoping is the `bridge_enabled` flag, no longer the `ELFIA%`/`LUMI%` SKU prefixes. Response: `{ items: [{ sku, name?, stock, price_cents? }], as_of, count }`, whole list every time, `LIMIT 1000`. Payload shape is enforced by `tests/bridge-feed-guard.mjs` (guard #10) against the shipped serialiser `worker/src/bridge-feed.ts`.
- `PATCH /api/v1/staff/inventory/:id/bridge` — perm `inventory`. Body: `{ bridge_enabled?: boolean, elfia_price?: number | "" | null }` (RM; `""`/`null` clears the web price → feed falls back to the list price). Audited as `inventory.bridge`. Pre-0075 database → `migration_missing`.

## Notable endpoint changes v1.36.0–v1.38.0 (2026-08-22) — ELFIA bridge completed

- `POST /api/v1/bridge/elfia-movements` — feed B (server-to-server, `X-Bridge-Key`). Body `{ movements: [{ event_id, sku, delta, reason?, reference?, occurred_at? }] }` (≤50, ≤64KB). Response `{ applied, ignored, unknown_sku }` — **event ids, not SKUs**; an id in no list is resent by the store (silence = retry). Idempotent by `event_id` (guard #11). SKU match is case- and whitespace-insensitive via `sku_key`. Deltas clamp at zero with a bell to sales+CEO.
- `GET /api/v1/health` — adds `elfia_bridge: { configured, orders_configured, last_movement_at, last_poll_at }`.
- `GET /api/v1/public/doc-signature?t=<32-hex share token>` — the signature for a shared document, token-scoped (S-1). 404 for ink-signed docs or a missing vault image.
- `GET /api/v1/staff/signature/<role>-sign.png` — vault serve, any signed-in staff. `POST /api/v1/staff/signatures/<role>-sign.png` — upload (raw PNG body), super_admin/admin/ceo, audited.
- `GET /api/v1/staff/inventory/bridge-health` — key state, last movement, applied-24h, unknown-SKU list. Perm `inventory` or `exec_view`.
- `GET /api/v1/staff/web-orders?status=&q=` · `GET /web-orders/:id` (order + frozen lines + linked bridge movements) · `POST /web-orders/sync` (rate-limited pull-now). Perms `sales`/`inventory`/`exec_view`.
- `GET /api/v1/staff/bridge/reconcile?date=YYYY-MM-DD` — per published SKU, the day's ledger movements by source vs the current count.
- `GET /api/v1/staff/revenue` family — `revenueLines()` gains the `elfia` bucket (paid web orders, payment-received basis, ref `ELF-<order_number>` in cashflow/GL).
