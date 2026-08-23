# Database

**Provisioned:** Cloudflare D1 `azoneofficial` — id `d9df2d7a-8303-4396-a4ee-a26836a4c9a8`. Media bucket: R2 `azoneofficial`.
Migrations: `0001_init.sql` (CMS schema below), `0002_rate_limits.sql`, `0003_staff_portal.sql` (Staff Portal/BMS: expanded roles + staff profiles, attendance_records, leave_requests/balances, announcements/acks, tasks/comments, customers, sales_documents + doc_counters, notifications), `0004_customer_role.sql`, `0005_doc_numbering_daily.sql` (doc_counters_daily for date-based numbering — see DOCUMENT-NUMBERING.md; legacy doc_counters kept). Apply with `pnpm migrate:prod` from `/worker`.

## v1.42.0 — `0083_task_tracking.sql`

`task_items` — a task's scope, itemised and tickable; `tasks.progress` becomes derived (done/total) for any task that has items. `task_events` — the tracking trail: `'ack'` (the assignee's timestamped "seen and understood"), `'status:<v>'`, `'scope_done'`, and the daily-alert dedupe rows (`'ack_nudge'` / `'due_reminder'` / `'overdue_alert'`, keyed by `on_date`). Zero ALTERs — fully replayable (audit B4 rule).

| Date | Version | Change |
| --- | --- | --- |
| 2026-08-23 | 1.42.0 | `task_items`, `task_events` + indexes. |

## v1.39.0–v1.40.1 — the ELFIA bridge migrations, restructured after AUDIT-2026-08-22 (`0075`–`0082`)

The audit's finding B4: a migration file mixing a non-idempotent `ALTER TABLE ADD COLUMN` with trailing statements can, on a half-apply, become permanently unappliable — and `deploy-api.sh` runs under `set -e`, so one such file wedges every future API deploy. The four original bridge migrations (drafted as 0075–0078, **never applied or pushed anywhere**) were therefore restructured before first contact with the real database: **one non-idempotent statement per file, everything else convergent or `IF NOT EXISTS`.** `tests/registry-parity.mjs` now asserts the file list ↔ `EXPECTED_MIGRATIONS` ↔ `LATEST_MIGRATION` ↔ health-probe coverage on every build.

| File | Contents | Replay-safe because |
| --- | --- | --- |
| `0075_bridge_enabled.sql` | `inventory_items.bridge_enabled` (publish flag, replaces the ELFIA%/LUMI% LIKE) | single ALTER — half-apply = no-apply |
| `0076_elfia_price.sql` | `inventory_items.elfia_price_cents` (web price, sen; NULL → feed falls back to `unit_price_cents`; the TikTok live rebate never applies) | single ALTER |
| `0077_bridge_pricing_backfill.sql` | backfill `bridge_enabled = 1` for the old LIKE set + `idx_inventory_bridge` | convergent UPDATE + `IF NOT EXISTS` |
| `0078_bridge_movements.sql` | `bridge_events` (idempotency store, `UNIQUE(source, event_id)`, outcome `'pending' \| 'applied' \| 'unknown_sku'`) + `stock_ledger` (append-only) + 5 indexes incl. `idx_bridge_events_ref` | all `IF NOT EXISTS` |
| `0079_inventory_sku_key.sql` | `inventory_items.sku_key` (normalised match key, computed in JS by `bridge-core.skuKey` at every SKU write) | single ALTER |
| `0080_sku_key_backfill.sql` | backfill `WHERE sku_key IS NULL` + non-unique `idx_inventory_sku_key` (unique would refuse to build over pre-existing collisions and wedge the deploy; collisions surface on the bridge health card instead) | convergent + `IF NOT EXISTS` |
| `0081_web_orders.sql` | `web_orders` (upsert key `(store, order_number)`; `paid_seen_at` stamped only WITH a successful cash booking; `booked_cents`; `refund_flagged_at` for the human refund decision) + `web_order_lines` (frozen purchase prices) | all `IF NOT EXISTS` |
| `0082_fix_po_direction.sql` | data fix: PO goods-receipt trail rows re-marked `direction = 'in'` (scoped to the exact `Goods receipt PO-%` remark; literal guard-asserted) | convergent UPDATE |

| Date | Version | Change |
| --- | --- | --- |
| 2026-08-22 | 1.39.0–1.40.1 | The eight files above, replacing the four never-applied drafts 0075–0078 from earlier the same day. |

Target: **Cloudflare D1 (SQLite)**. Media binaries in **R2**, referenced by key.

## Schema draft v1

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- argon2id
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','editor','marketing')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                  -- random 256-bit token id
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE site_content (             -- editable website content
  key TEXT PRIMARY KEY,                 -- e.g. 'home.hero.headline'
  value TEXT NOT NULL,                  -- JSON
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  price_cents INTEGER,                  -- MYR cents; NULL = "announced live"
  inventory INTEGER,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  seo_title TEXT, seo_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  r2_key TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','document','logo')),
  alt TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_media (
  product_id INTEGER NOT NULL REFERENCES products(id),
  media_id INTEGER NOT NULL REFERENCES media(id),
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, media_id)
);

CREATE TABLE portfolio_items (
  id INTEGER PRIMARY KEY,
  client TEXT NOT NULL,
  summary TEXT, result TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE posts (                    -- blog
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published')),
  publish_at TEXT,
  category TEXT, tags TEXT,             -- tags: JSON array
  featured_media_id INTEGER REFERENCES media(id),
  seo_title TEXT, seo_description TEXT,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE testimonials (
  id INTEGER PRIMARY KEY,
  author TEXT NOT NULL, company TEXT, position TEXT,
  review TEXT NOT NULL, rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  photo_media_id INTEGER REFERENCES media(id),
  is_published INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE enquiries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','closed')),
  assigned_to INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,                 -- e.g. 'product.update'
  entity TEXT, entity_id TEXT,
  detail TEXT,                          -- JSON diff
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Migration policy
- Numbered SQL migrations in `/migrations`, applied via `wrangler d1 migrations`
- Every schema change documented here + CHANGELOG.md


## v1.4.4 — migration 0007_role_modules.sql

Additive migration behind the expanded role set:

| Table / change | Purpose |
|---|---|
| `users.birthday` (new column) | Staff birthdays, maintained by HR via the staff directory |
| `inventory_items` | Sales-side stock; status auto-derived: 0 → out_of_stock, ≤5 → low, else in_stock |
| `postage_records` | Shipment tracking: preparing → shipped → in_transit → delivered / returned |
| `material_requests` | Marketing material pipeline: requested → in_progress → done / rejected |
| `bd_pipeline` | CCO deal tracking: open / pending / kiv / closed_won / closed_lost, with strategy + next action |
| `ops_reports` | COO daily operational + sales report; UNIQUE (report_date, created_by) — resubmitting a day updates it |
| `task_reports` | HR daily / weekly / monthly reports |

## History (do not remove)
| Version | Change |
|---|---|
| v1.4.4 | 0007_role_modules.sql — role-module tables + users.birthday. |


## v1.4.7 — migration 0008_expand_role_check.sql

Rebuilds `users` (SQLite cannot alter a CHECK) with the role list expanded to
the v1.4.4 set: adds `ceo`, `cco`, `hr_admin`, `sales_marketing`. Same rebuild
pattern as 0004; all rows preserved; includes the 0007 `birthday` column in the
new definition. Root cause and the accompanying API fix are recorded in
CHANGELOG [1.4.7].

| Version | Change |
|---|---|
| v1.4.7 | 0008 — users.role CHECK expanded to the full role set. |


## v1.4.14 — migration 0009_role_cleanup.sql
Reassigns removed roles (MD→admin, business_dev→cco, finance_admin→hr_admin,
live_manager→live_host), then rebuilds users with the final 11-role CHECK.
Data preserved.

| Version | Change |
|---|---|
| v1.4.14 | 0009 — role set reduced to 11; holders of removed roles reassigned. |


## v1.4.15 — migration 0010_leave_chain_and_badge.sql
Adds leave staging columns (stage, hr_by/at, preapp_by/at, final_by/at) and maps
old statuses onto stages; adds users.id_issued_on and users.blood_type for the
ID badge. Additive; existing rows preserved.

| Version | Change |
|---|---|
| v1.4.15 | 0010 — leave approval chain columns + badge fields. |


## v1.4.16 — migration 0011_holidays.sql
Adds the `holidays` table (date, name, kind, created_by). Leave entitlement uses
the existing leave_balances table (0003); no schema change needed there.

| Version | Change |
|---|---|
| v1.4.16 | 0011 — holidays / company calendar table. |


## v1.4.22 — migration 0012_full_name.sql
Adds users.full_name (name as per IC, used on the ID badge). blood_type is
retired from UI and badge but the column remains per append-only policy.

| Version | Change |
|---|---|
| v1.4.22 | 0012 — users.full_name; blood_type retired from UI (column kept). |


## v1.4.23 — migration 0013_staff_photo.sql
Adds users.photo_key (R2 key under private/staff-photos/, staff-auth to serve).

| Version | Change |
|---|---|
| v1.4.23 | 0013 — users.photo_key for the badge photo. |


## v1.4.28 — migration 0014_attendance_manual.sql
attendance_records gains manual_by, amended_by, amended_at — who created a
back-entry or corrected a punch, and when. NULLs mean an original device punch.

| Version | Change |
|---|---|
| v1.4.28 | 0014 — attendance manual/amendment provenance columns. |


## v1.4.31 — migration 0015_postage_stock_link.sql
postage_records gains inventory_item_id, qty, restocked — the link that lets a
shipment deduct stock on create and restock once on return. audit_log.detail
now actually receives the JSON detail (quantities, roles) that calls pass.

| Version | Change |
|---|---|
| v1.4.31 | 0015 — postage↔inventory movement columns; audit detail stored. |


## v1.4.32 — migration 0016_postage_multi_items.sql
postage_items: one row per (order, item, qty) line. Orders deduct all lines on
create (validated first, guarded per-line, rolled back on race) and restock all
lines on return, once. Legacy single-item columns (0015) remain readable.

| Version | Change |
|---|---|
| v1.4.32 | 0016 — multi-item postage lines. |


## v1.4.36 — migration 0017_payroll.sql
payroll_entries: one row per (user, month) — basic/commission/allowance/
deduction in sen, note, creator, UNIQUE(user_id, month) upsert target.

| Version | Change |
|---|---|
| v1.4.36 | 0017 — payroll_entries. |


## v1.4.37 — migration 0018_two_factor.sql
users.totp_secret / totp_enabled; twofa_backup_codes (hashed, single-use);
twofa_challenges (sha256 token, attempts, 5-minute expiry).

| Version | Change |
|---|---|
| v1.4.37 | 0018 — two-factor authentication tables and columns. |


## v1.4.43 — migration 0019_bank_join.sql
users gains bank_name, bank_account (payroll + payslip BANK line) and
joined_on (payslip month gating). employment_status now records
permanent/contract/part_time.

| Version | Change |
|---|---|
| v1.4.43 | 0019 — bank details + joining date. |


## v1.4.44 — migration 0020_tiktok_tokens.sql
integration_tokens (provider PK, shop_id, shop_cipher, access/refresh token,
expiry) and webhook_events (provider, event_type, order_ref, verified flag,
headers summary, raw body) for diagnosable webhook receipts.

| Version | Change |
|---|---|
| v1.4.44 | 0020 — TikTok seller tokens + webhook event log. |


## v1.4.46 — migration 0021_employment_status_values.sql
users rebuilt (SQLite cannot alter a CHECK): employment_status now accepts
permanent/contract/part_time alongside the legacy set; default 'permanent';
legacy 'active' rows mapped to 'permanent'. All columns through 0019 carried
over with explicit column lists.

| Version | Change |
|---|---|
| v1.4.46 | 0021 — employment_status CHECK expanded; users table rebuilt. |


## v1.4.51 — migration 0022_ic_number.sql
users gains ic_number (Malaysian NRIC) — staff record, payslip I/C # row,
badge grid.

| Version | Change |
|---|---|
| v1.4.51 | 0022 — ic_number. |
