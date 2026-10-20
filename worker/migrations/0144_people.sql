-- 0144 - people (ERP roadmap phase 5).
--
-- Every table here sits beside users, leave and sales_documents and never
-- changes them.
-- leaving_checklists holds the leaving steps ticked for a person, by key.
-- The joining checklist stays where it is, in users.onboarding_json.
-- probation_reviews holds the day a probation ends and what was decided.
-- Deciding records the outcome only. The employment status is still
-- changed in Staff Details, as before.
-- hr_letters keeps every letter issued, with its reference and the text
-- as printed. A letter is voided with a reason, never deleted.
-- training_records holds courses attended, removed by a stamp.
-- business_settings holds owner settings by key. The quotation approval
-- limit lives here and is absent until the CEO sets it, so it is off.
-- quotation_approvals records the CEO approving one revision of a quotation.

CREATE TABLE IF NOT EXISTS leaving_checklists (
  user_id INTEGER PRIMARY KEY,
  items TEXT NOT NULL DEFAULT '{}',
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS probation_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ends_on TEXT NOT NULL,
  outcome TEXT,
  note TEXT,
  set_by INTEGER,
  set_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by INTEGER,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_probation_reviews_user
  ON probation_reviews (user_id, id);

CREATE TABLE IF NOT EXISTS hr_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  signer_name TEXT,
  signer_position TEXT,
  issued_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at TEXT,
  voided_by INTEGER,
  void_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_letters_ref
  ON hr_letters (ref_no);

CREATE TABLE IF NOT EXISTS training_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  provider TEXT,
  on_date TEXT NOT NULL,
  hours REAL,
  cost_cents INTEGER,
  paid_by TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER
);

CREATE TABLE IF NOT EXISTS business_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotation_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER,
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotation_approvals_once
  ON quotation_approvals (doc_id, revision);
