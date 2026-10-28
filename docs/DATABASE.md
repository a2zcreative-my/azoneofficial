# Database

Current backup limits, validation and recovery follow-up: [Backup recovery](BACKUP-RECOVERY.md). The local 12 October improvements reject oversized exports and attach schema/migration/sequence metadata and checksums. A read-only verifier and synthetic SQLite restore drill are available; these changes are included in 3e42644 (1.181.9), whose version is reported live; no production recovery drill was performed.

**Provisioned:** Cloudflare D1 `azoneofficial` — id `d9df2d7a-8303-4396-a4ee-a26836a4c9a8`. Media bucket: R2 `azoneofficial`.
Migrations: `0001_init.sql` (CMS schema below), `0002_rate_limits.sql`, `0003_staff_portal.sql` (Staff Portal/BMS: expanded roles + staff profiles, attendance_records, leave_requests/balances, announcements/acks, tasks/comments, customers, sales_documents + doc_counters, notifications), `0004_customer_role.sql`, `0005_doc_numbering_daily.sql` (doc_counters_daily for date-based numbering — see DOCUMENT-NUMBERING.md; legacy doc_counters kept). Apply with `pnpm migrate:prod` from `/worker`.

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

## v1.181.11 - migration 0139_quotation_revisions.sql
sales_documents gains revision (0 = original) and revised_at (Malaysia time,
printed as the revision date). sales_document_revisions keeps each version a
revision replaced: doc_id, revision, snapshot (the whole row as JSON, without
share_token), total_cents, replaced_at, replaced_by; unique on (doc_id, revision).

| Version | Change |
|---|---|
| v1.181.11 | 0139 - quotation revisions and their history. |

## v1.181.13 - migration 0140_part_payments.sql
invoice_payments: one row per part of an invoice received - invoice_id,
amount_cents, received_on (Malaysian date), method, reference, note,
created_by, created_at, voided_at, voided_by, void_reason. A part is voided,
never deleted. Recording parts never changes sales_documents.

| Version | Change |
|---|---|
| v1.181.13 | 0140 - part payments (ERP roadmap phase 1). |

## v1.181.14 - migration 0141_stock_receipts.sql
stock_receipts: supplier, received_on, reference, note, total_cents,
bill_due_on, bill_paid_on, created_by, voided_at/by/reason. stock_receipt_lines:
receipt_id, item_id, sku, item_name, qty, unit_cost_cents, stock_before/after,
cost_before/after_cents. inventory_items gains nullable reorder_level and
reorder_qty. Receiving raises stock through manual_stockouts (direction in,
purpose restock); it writes no expense or cash entry.

| Version | Change |
|---|---|
| v1.181.14 | 0141 - receiving stock, reorder levels (ERP roadmap phase 2). |

## v1.181.15 - migration 0142_books_stock_take.sql
period_closes: month (YYYY-MM), figures (JSON snapshot of the month's
figures), note, closed_by/at, reopened_by/at, reopen_reason. A close locks
nothing; nothing outside worker/src/business.ts reads it. stock_counts:
category (null = every item), note, status (open / posted / cancelled),
started_by/at, posted_by/at, cancelled_at. stock_count_lines: count_id,
item_id, sku, item_name, system_qty (held when the count started),
counted_qty (null = not counted), posted_delta, counted_by/at; unique on
(count_id, item_id). Posting moves inventory_items.stock relatively through
manual_stockouts (purpose variance_found / variance_missing).

| Version | Change |
|---|---|
| v1.181.15 | 0142 - month close, stock take (ERP roadmap phase 3). |

## v1.181.16 - migration 0143_customer_joins.sql
customer_contacts: customer_id, name, role, phone, email, note, created_by/at,
removed_at/by (never deleted). customer_tags: (customer_id, tag) primary key.
customer_followups: customer_id, due_on, owner_id, note, created_by/at,
done_at/by, done_note, cancelled_at. customer_terms: customer_id primary key,
terms_days, updated_by/at; the Sales form sends due_date on a NEW invoice of
a client with terms. recurring_invoices: customer_id, source_doc_id,
day_of_month, note, created_by/at, stopped_at/by; a month is raised when an
invoice of that client created that month carries the reference
"Recurring R-<id> ...". quotation_acceptances: doc_id, revision,
accepted_name, accepted_position, accepted_at, ip, user_agent; unique on
(doc_id, revision). The customers and sales_documents tables are not altered.

| Version | Change |
|---|---|
| v1.181.16 | 0143 - client file, follow-ups, recurring invoices, acceptance (ERP roadmap phase 4). |

## v1.181.17 - migration 0144_people.sql
leaving_checklists: user_id primary key, items (JSON of ticked keys),
updated_by/at. probation_reviews: user_id, ends_on, outcome (null, confirmed,
extended, ended), note, set_by/at, decided_by/at; an extension adds a new
row. hr_letters: user_id, kind, ref_no (unique, A2Z/HR/YYYY/NNN), issued_on,
subject, body (as printed), signer_name, signer_position, issued_by,
created_at, voided_at/by, void_reason. training_records: user_id, title,
provider, on_date, hours, cost_cents, paid_by, note, created_by/at,
removed_at/by. business_settings: key primary key, value, updated_by/at;
key quote_approval holds {limit_cents, since} and is absent (off) by
default. quotation_approvals: doc_id, revision, approved_by/at, note;
unique on (doc_id, revision). users, leave_requests and sales_documents are
not altered.

| Version | Change |
|---|---|
| v1.181.17 | 0144 - joining and leaving, probation, letters, training, approval limit (ERP roadmap phase 5). |

## v1.215.0 - migration 0145_invoice_paid_confirmations.sql
invoice_paid_confirmations: id, invoice_id, amount_cents (the invoice total
the confirmer checked), payment_ref, paid_at (copied from the invoice),
confirmed_by, confirmed_at, revoked_at/by, revoke_reason. A partial unique
index (idx_paid_confirm_live) allows one live confirmation per invoice; a
confirmation is revoked with a stamp and a reason and never deleted.
sales_documents and invoice_payments are not altered.

| Version | Change |
|---|---|
| v1.215.0 | 0145 - CEO/COO/super admin confirmation that an invoice paid in full is real (Payroll 2.0 phase A). |

## v1.217.0 - migration 0146_announcements_v2.sql
announcements rebuilt (every row and id kept): category now allows memo
(the CHECK from 0003 refused it); new columns important, pinned, audience
(JSON list of departments, NULL = all staff), to_line, memo_date, from_name
(the publisher's name and position from the login), version, updated_at,
updated_by. announcement_acks rebuilt with version in the key
(announcement_id, user_id, version); every acknowledgement copied as version
1 with its own acked_at. announcement_versions: the text each version
replaced (announcement_id, version, title, body, category, to_line,
memo_date, replaced_by/at). announcement_files: attachments in R2
(announcement_id, r2_key, filename, content_type, size, uploaded_by/at,
removed_at/by).

| Version | Change |
|---|---|
| v1.217.0 | 0146 - News & Announcements 2.0: memo, versions, acknowledgements per version, audience, attachments. |

## v1.219.0 - migration 0147_cashbook.sql
Additive only - no row changed, moved or deleted. cashflow_entries gains
effective_date (the day the money moved, written by new bookings; old rows
keep NULL and the Finance view reads their source's paid day), source_key
(the booking key of a new row, unique where set - a retry cannot book twice),
reversal_of (unique where set - a row is reversed once), reverse_reason, and
transfer_id (the two halves of a transfer between company accounts); an index
on ref. bank_accounts gains opening_balance_cents, opening_on and updated_at.
cashbook_marks (item_key primary key): which account a receipt went through,
and that a Reconciliation item was reviewed, with who, when and a note.

| Version | Change |
|---|---|
| v1.219.0 | 0147 - Finance 2.0: true dates, reversals, transfers, opening balances, reviewed marks. |
| v1.222.0 | 0148 - Accounting 2.0: a journal reference is posted once (new entries). |

## v1.222.0 - migration 0148_journal_integrity.sql
Indexes only - no row changed. A partial UNIQUE index on journal_entries(ref)
for entries written from 2026-10-29 (ref not empty), so two requests at once
cannot book the same event twice; the history before that date is neither
checked nor changed (the code's check by ref still covers it). Plain indexes
on journal_entries(ref) and (entry_date) for the ledger reads. Journal entries
are never updated or deleted: a manual entry is reversed by a mirror entry
(ref REVJ-<id>), an automatic one at its source.
