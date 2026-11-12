-- 0183 - Financial Advisory, Release 1 (v1.284.0).
--
-- The CEO, 11-11-2026: approved Financial Advisory on
-- claude/FINANCIAL-ADVISORY-BLUEPRINT.md (decisions F1, F2, F3, F9, F11-F13
-- as recommended). Internal use only: the client agreement, the proposed
-- fee, disclosure to banks and any commission stay disabled in code until
-- counsel clears them (Gate 0, L1-L10).
--
-- ADDITIVE ONLY. New tables, no existing table, column or row changes.
-- The client is an existing customers row (customer_id), the financial
-- data lives here, readable only through the fa_* permissions and the
-- case scope. Amounts are sen (whole cents). DSR values are basis
-- points (5000 = 50.00 percent). Dates are Malaysian YYYY-MM-DD.
--
-- fa_cases            one case per customer and product while it is open
-- fa_case_members     staff who assist on a case (read and notes)
-- fa_consents         privacy notice, assessment, disclosure (append only)
-- fa_profiles         versioned profile, the IC is kept masked + keyed hash
-- fa_items            income, deductions, commitments, living expenses
-- fa_documents        evidence in private R2 (fa/<case>/...)
-- fa_assessments      immutable DSR snapshots (append only)
-- fa_notes            A system, B banker feedback, C official decision
-- fa_criteria         bank criteria, versioned, only verified ones match
-- fa_bank_contacts    the banker relations directory
-- fa_contact_log      communication history (append only)
-- fa_events           the case timeline (append only)

CREATE TABLE IF NOT EXISTS fa_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_ref TEXT,
  customer_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  agent_request_id INTEGER,
  issuer_code TEXT NOT NULL CHECK (issuer_code IN ('a2z', 'azoo')),
  product TEXT NOT NULL CHECK (product IN ('personal_financing', 'debt_consolidation', 'advisory_only')),
  purpose TEXT,
  stage TEXT NOT NULL DEFAULT 'intake' CHECK (stage IN ('intake', 'profile', 'prescreen', 'review', 'matching', 'agreement', 'enquiry', 'application', 'decision', 'disbursed', 'fee', 'closed')),
  prescreen TEXT NOT NULL DEFAULT 'incomplete' CHECK (prescreen IN ('incomplete', 'potentially_suitable', 'manual_review', 'affordability_concern', 'no_product')),
  banker_status TEXT NOT NULL DEFAULT 'not_contacted' CHECK (banker_status IN ('not_contacted', 'enquiry_sent', 'under_review', 'indicatively_suitable', 'documents_required', 'not_supported')),
  application_status TEXT NOT NULL DEFAULT 'not_submitted' CHECK (application_status IN ('not_submitted', 'submitted', 'processing', 'conditional_offer', 'officially_approved', 'declined', 'withdrawn', 'disbursed')),
  override_result TEXT,
  override_reason TEXT,
  override_by INTEGER,
  override_at TEXT,
  closed_reason TEXT,
  closed_at TEXT,
  closed_by INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_cases_open
  ON fa_cases (customer_id, product) WHERE stage != 'closed';

CREATE INDEX IF NOT EXISTS idx_fa_cases_owner
  ON fa_cases (owner_id, stage);

CREATE TABLE IF NOT EXISTS fa_case_members (
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  added_by INTEGER,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (case_id, user_id)
);

CREATE TABLE IF NOT EXISTS fa_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('privacy_notice', 'assessment', 'disclosure')),
  notice_version TEXT,
  institution TEXT,
  documents TEXT,
  captured_how TEXT NOT NULL,
  evidence_id INTEGER,
  given_at TEXT NOT NULL,
  expires_at TEXT,
  recorded_by INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  withdrawn_by INTEGER,
  withdrawn_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_fa_consents_case
  ON fa_consents (case_id, kind);

CREATE TABLE IF NOT EXISTS fa_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  employment_status TEXT,
  employment_category TEXT,
  employer_type TEXT,
  service_months INTEGER,
  salary_pattern TEXT,
  dependants INTEGER,
  age_years INTEGER,
  ic_masked TEXT,
  ic_hash TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_profiles_version
  ON fa_profiles (case_id, version);

CREATE INDEX IF NOT EXISTS idx_fa_profiles_ic
  ON fa_profiles (ic_hash);

CREATE TABLE IF NOT EXISTS fa_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('income', 'deduction', 'commitment', 'expense')),
  kind TEXT NOT NULL,
  label TEXT,
  monthly_cents INTEGER NOT NULL CHECK (monthly_cents >= 0),
  outstanding_cents INTEGER,
  arrears INTEGER NOT NULL DEFAULT 0,
  settle_in_consolidation INTEGER NOT NULL DEFAULT 0,
  settlement_cents INTEGER,
  settlement_doc_id INTEGER,
  source TEXT NOT NULL DEFAULT 'declared',
  evidence_id INTEGER,
  state TEXT NOT NULL DEFAULT 'declared' CHECK (state IN ('declared', 'verified', 'rejected')),
  verified_by INTEGER,
  verified_at TEXT,
  voided_at TEXT,
  voided_by INTEGER,
  void_reason TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_items_case
  ON fa_items (case_id, side);

CREATE TABLE IF NOT EXISTS fa_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  doc_date TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER,
  verified_at TEXT,
  retain_until TEXT,
  uploaded_by INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_fa_documents_case
  ON fa_documents (case_id);

CREATE TABLE IF NOT EXISTS fa_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  ruleset TEXT NOT NULL,
  inputs TEXT NOT NULL,
  result TEXT NOT NULL,
  current_dsr_bp INTEGER,
  projected_dsr_bp INTEGER,
  outcome TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_assessments_case
  ON fa_assessments (case_id, id);

CREATE TABLE IF NOT EXISTS fa_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  note_type TEXT NOT NULL CHECK (note_type IN ('system', 'banker', 'decision')),
  assessment_id INTEGER,
  bank TEXT,
  product TEXT,
  contact_id INTEGER,
  source TEXT,
  status_value TEXT,
  body TEXT NOT NULL,
  conditions TEXT,
  missing_documents TEXT,
  follow_up_on TEXT,
  bank_reference TEXT,
  approved_cents INTEGER,
  expires_on TEXT,
  evidence_id INTEGER,
  corrects_id INTEGER,
  author_id INTEGER,
  author_role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_notes_case
  ON fa_notes (case_id, id);

CREATE TABLE IF NOT EXISTS fa_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL,
  version INTEGER NOT NULL,
  bank TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('personal_financing', 'debt_consolidation')),
  income_definition TEXT NOT NULL DEFAULT 'net',
  commitment_definition TEXT NOT NULL DEFAULT 'all',
  dsr_guideline_bp INTEGER,
  min_income_cents INTEGER,
  employment_categories TEXT,
  min_service_months INTEGER,
  required_documents TEXT,
  source TEXT NOT NULL,
  evidence_id INTEGER,
  effective_from TEXT,
  last_verified_on TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'verified', 'retired')),
  verified_by INTEGER,
  verified_at TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_criteria_version
  ON fa_criteria (family, version);

CREATE TABLE IF NOT EXISTS fa_bank_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank TEXT NOT NULL,
  products TEXT,
  contact_name TEXT NOT NULL,
  contact_role TEXT,
  branch TEXT,
  channel TEXT,
  channel_confirmed INTEGER NOT NULL DEFAULT 0,
  relationship TEXT NOT NULL DEFAULT 'prospect' CHECK (relationship IN ('prospect', 'active', 'paused', 'ended')),
  owner_id INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS fa_contact_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  case_id INTEGER,
  channel TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fa_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  actor_id INTEGER,
  detail TEXT,
  event_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_events_key
  ON fa_events (event_key) WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fa_events_case
  ON fa_events (case_id, id);

CREATE TRIGGER IF NOT EXISTS fa_notes_no_update BEFORE UPDATE ON fa_notes
BEGIN SELECT RAISE(ABORT, 'Eligibility notes are append only - add a correction'); END;

CREATE TRIGGER IF NOT EXISTS fa_notes_no_delete BEFORE DELETE ON fa_notes
BEGIN SELECT RAISE(ABORT, 'Eligibility notes are append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_assessments_no_update BEFORE UPDATE ON fa_assessments
BEGIN SELECT RAISE(ABORT, 'Assessments are append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_assessments_no_delete BEFORE DELETE ON fa_assessments
BEGIN SELECT RAISE(ABORT, 'Assessments are append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_events_no_update BEFORE UPDATE ON fa_events
BEGIN SELECT RAISE(ABORT, 'The case timeline is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_events_no_delete BEFORE DELETE ON fa_events
BEGIN SELECT RAISE(ABORT, 'The case timeline is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_contact_log_no_update BEFORE UPDATE ON fa_contact_log
BEGIN SELECT RAISE(ABORT, 'The contact log is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_contact_log_no_delete BEFORE DELETE ON fa_contact_log
BEGIN SELECT RAISE(ABORT, 'The contact log is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_consents_no_delete BEFORE DELETE ON fa_consents
BEGIN SELECT RAISE(ABORT, 'Consents are kept'); END;
