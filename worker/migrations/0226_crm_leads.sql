-- 0226 - LEADS AND CRM (the CEO 21-11-2026, Sales Command Center Phase 2, decisions 1-7 of 21-11-2026
-- and his answer As recommended on the six Phase 2 decisions).
--   customers.owner_id            - who looks after the lead. Set only by an assignment (crm_assign) or
--                                   by a manager confirming a suggested owner. Never guessed in place.
--   customers.lead_source         - where the lead came from: website, growth_check, agent, referral,
--                                   walk_in, social, tiktok, existing, other. Staff choose it.
--   customers.lead_source_detail  - free words beside the source (the campaign, who referred them).
--   customers.interested_services - a JSON array of Packages library ids (pkg:12) and other:words.
--                                   Names only, a price is never stored here.
--   customers.relationship_status - new_lead, contacted, qualified, customer, inactive, disqualified.
--                                   Set by staff, never worked out from invoices. NULL = not set yet.
--   customers.crm_key             - enquiry:id or growth:id for a customer made by converting one, so a
--                                   second convert of the same entry cannot make a second customer.
--   customers.crm_version         - the version a CRM edit started from (a stale edit is refused).
--   enquiries.customer_id, business_growth_enquiries.customer_id - the customer an entry was converted
--                                   to or linked with (after the duplicate check).
--   customer_owner_events         - every assignment, reassignment and confirmed suggestion. Append-only.
--   customer_status_events        - every relationship status change, with its reason. Append-only.
--   sales_activities              - calls, WhatsApp, email, meetings, notes, proposals and closed
--                                   follow-ups. Append-only. source_key makes each one happen once
--                                   (followup:id for a closed follow-up, client:key for a press).
-- ADDITIVE ONLY: nullable columns (crm_version has a default), three new tables, indexes and triggers.
-- No existing row is changed.

ALTER TABLE customers ADD COLUMN owner_id INTEGER REFERENCES users(id);
ALTER TABLE customers ADD COLUMN lead_source TEXT CHECK (lead_source IS NULL OR lead_source IN
  ('website', 'growth_check', 'agent', 'referral', 'walk_in', 'social', 'tiktok', 'existing', 'other'));
ALTER TABLE customers ADD COLUMN lead_source_detail TEXT;
ALTER TABLE customers ADD COLUMN interested_services TEXT;
ALTER TABLE customers ADD COLUMN relationship_status TEXT CHECK (relationship_status IS NULL OR relationship_status IN
  ('new_lead', 'contacted', 'qualified', 'customer', 'inactive', 'disqualified'));
ALTER TABLE customers ADD COLUMN crm_key TEXT;
ALTER TABLE customers ADD COLUMN crm_version INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_crm_key ON customers (crm_key) WHERE crm_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers (owner_id);

ALTER TABLE enquiries ADD COLUMN customer_id INTEGER REFERENCES customers(id);
ALTER TABLE business_growth_enquiries ADD COLUMN customer_id INTEGER REFERENCES customers(id);

CREATE TABLE IF NOT EXISTS customer_owner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  from_owner INTEGER REFERENCES users(id),
  to_owner INTEGER REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('assign', 'reassign', 'unassign', 'suggestion', 'convert')),
  reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_owner_events ON customer_owner_events (customer_id, id);
CREATE TRIGGER IF NOT EXISTS customer_owner_events_no_update BEFORE UPDATE ON customer_owner_events
BEGIN SELECT RAISE(ABORT, 'An ownership record is never edited'); END;
CREATE TRIGGER IF NOT EXISTS customer_owner_events_no_delete BEFORE DELETE ON customer_owner_events
BEGIN SELECT RAISE(ABORT, 'An ownership record is never deleted'); END;

CREATE TABLE IF NOT EXISTS customer_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_status_events ON customer_status_events (customer_id, id);
CREATE TRIGGER IF NOT EXISTS customer_status_events_no_update BEFORE UPDATE ON customer_status_events
BEGIN SELECT RAISE(ABORT, 'A status record is never edited'); END;
CREATE TRIGGER IF NOT EXISTS customer_status_events_no_delete BEFORE DELETE ON customer_status_events
BEGIN SELECT RAISE(ABORT, 'A status record is never deleted'); END;

CREATE TABLE IF NOT EXISTS sales_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL CHECK (kind IN ('call', 'whatsapp', 'email', 'meeting', 'note', 'proposal', 'followup')),
  outcome TEXT,
  note TEXT,
  occurred_at TEXT NOT NULL,
  followup_id INTEGER,
  doc_id INTEGER,
  source_key TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_activities_key ON sales_activities (source_key);
CREATE INDEX IF NOT EXISTS idx_sales_activities_customer ON sales_activities (customer_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_sales_activities_by ON sales_activities (created_by, created_at);
CREATE TRIGGER IF NOT EXISTS sales_activities_no_update BEFORE UPDATE ON sales_activities
BEGIN SELECT RAISE(ABORT, 'A sales activity is never edited'); END;
CREATE TRIGGER IF NOT EXISTS sales_activities_no_delete BEFORE DELETE ON sales_activities
BEGIN SELECT RAISE(ABORT, 'A sales activity is never deleted'); END;
