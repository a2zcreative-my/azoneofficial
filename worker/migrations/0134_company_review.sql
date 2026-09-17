-- Reconciliation metadata only. No operational ownership is inferred.
CREATE TABLE company_review_decisions (
  record_kind TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  proposed_company TEXT CHECK (proposed_company IN ('azoo','a2z')),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  reason TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  reviewed_by INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (record_kind, record_id)
);
CREATE TABLE company_staff_setup (
  user_id INTEGER PRIMARY KEY,
  employer_code TEXT CHECK (employer_code IN ('azoo','a2z')),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE company_memberships (
  user_id INTEGER NOT NULL,
  company_code TEXT NOT NULL CHECK (company_code IN ('azoo','a2z')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('read','write')),
  PRIMARY KEY (user_id, company_code)
);
CREATE TABLE company_review_events (
  request_id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  guard INTEGER NOT NULL CONSTRAINT company_review_fresh CHECK (guard = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_company_review_history ON company_review_events (subject_kind, subject_id, created_at);
CREATE TRIGGER company_review_events_no_update BEFORE UPDATE ON company_review_events
BEGIN SELECT RAISE(ABORT, 'Company review history is immutable'); END;
CREATE TRIGGER company_review_events_no_delete BEFORE DELETE ON company_review_events
BEGIN SELECT RAISE(ABORT, 'Company review history is immutable'); END;
