-- 0143 - customers (ERP roadmap phase 4).
--
-- Everything here sits beside the customers table and never changes it.
-- customer_contacts holds more than one person per client. A contact is
-- removed by stamping removed_at, never deleted.
-- customer_tags holds free tags, one row per tag per client.
-- customer_followups holds a dated follow-up with an owner. It is done or
-- cancelled by a stamp, never deleted. Open ones show on the Desk.
-- customer_terms holds the credit terms in days for a client. With terms
-- set, a NEW invoice for that client is created with a due date. Without
-- terms nothing changes. Existing invoices are never touched.
-- recurring_invoices names an invoice to raise again each month on a day.
-- Nothing raises it by itself: the Desk lists it when due and a person
-- fills the normal form from it and saves. The reference carries the
-- recurring id so the month is known to be raised.
-- quotation_acceptances records a customer accepting a quotation on its
-- shared link, with the revision they saw. It changes no status.

CREATE TABLE IF NOT EXISTS customer_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer
  ON customer_contacts (customer_id, removed_at);

CREATE TABLE IF NOT EXISTS customer_tags (
  customer_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_id, tag)
);

CREATE TABLE IF NOT EXISTS customer_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  due_on TEXT NOT NULL,
  owner_id INTEGER,
  note TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT,
  done_by INTEGER,
  done_note TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_followups_open
  ON customer_followups (done_at, cancelled_at, due_on);

CREATE TABLE IF NOT EXISTS customer_terms (
  customer_id INTEGER PRIMARY KEY,
  terms_days INTEGER NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  source_doc_id INTEGER NOT NULL,
  day_of_month INTEGER NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at TEXT,
  stopped_by INTEGER
);

CREATE TABLE IF NOT EXISTS quotation_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  accepted_name TEXT NOT NULL,
  accepted_position TEXT,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT,
  user_agent TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotation_acceptances_once
  ON quotation_acceptances (doc_id, revision);
