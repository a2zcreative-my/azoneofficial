-- 0192_fa_templates  v1.302.0
-- Financial Advisory 2.0 phase 5 (the CEO 13-11-2026, blueprint section 10 and decisions D-4 D-5 D-6 D-7).
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- fa_templates          one agreement template - its name, the company that issues it
--                       and the service it is for.
-- fa_template_versions  every version of a template - the uploaded DOCX (kept in R2
--                       with its SHA-256) or typed text, the clause text with its merge
--                       fields, the fee rate in basis points, and its state: draft, then
--                       review, then approved (published by the CEO, with the legal basis
--                       recorded) and archived. The text, the fields, the fee rate and the
--                       source hash of a version past draft can never change (trigger) and
--                       no version is ever deleted. A change is a new version.
-- fa_agreement_drafts   every draft agreement prepared from a version for a case - the
--                       version, the hash of the text and whether a full IC was typed for
--                       it. The IC itself is never stored. Append only.
-- fa_fee_bills          the advisory fee prepared for Sales from ONE recorded disbursement
--                       (a decision note with the bank evidence) - the rate, the base and
--                       the fee. One per disbursement note. Append only. The quotation and
--                       the invoice are the normal Sales documents.

CREATE TABLE IF NOT EXISTS fa_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  issuer_code TEXT NOT NULL CHECK (issuer_code IN ('a2z', 'azoo')),
  service_type TEXT NOT NULL CHECK (service_type IN ('personal_financing', 'debt_consolidation', 'advisory_only')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fa_template_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'text')),
  source_name TEXT,
  source_r2_key TEXT,
  source_sha256 TEXT,
  body TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',
  fee_bp INTEGER CHECK (fee_bp IS NULL OR (fee_bp > 0 AND fee_bp <= 10000)),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'review', 'approved', 'archived')),
  submitted_by INTEGER,
  submitted_at TEXT,
  legal_basis TEXT CHECK (legal_basis IS NULL OR legal_basis IN ('counsel_reviewed', 'ceo_without_review')),
  legal_reviewer TEXT,
  legal_firm TEXT,
  legal_reviewed_on TEXT,
  legal_reference TEXT,
  published_by INTEGER,
  published_at TEXT,
  archived_by INTEGER,
  archived_at TEXT,
  archived_reason TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (template_id, version)
);

CREATE TRIGGER IF NOT EXISTS fa_template_versions_text_locked BEFORE UPDATE OF body, fields_json, fee_bp, source_sha256, source_r2_key, format, template_id, version ON fa_template_versions
WHEN OLD.state != 'draft'
BEGIN SELECT RAISE(ABORT, 'a template version past draft keeps its text - make a new version'); END;

CREATE TRIGGER IF NOT EXISTS fa_template_versions_no_delete BEFORE DELETE ON fa_template_versions
BEGIN SELECT RAISE(ABORT, 'template versions are never deleted - archive one instead'); END;

CREATE TABLE IF NOT EXISTS fa_agreement_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  text_sha256 TEXT NOT NULL,
  full_ic INTEGER NOT NULL DEFAULT 0 CHECK (full_ic IN (0, 1)),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_agreement_drafts_case
  ON fa_agreement_drafts (case_id, id);

CREATE TRIGGER IF NOT EXISTS fa_agreement_drafts_no_update BEFORE UPDATE ON fa_agreement_drafts
BEGIN SELECT RAISE(ABORT, 'fa_agreement_drafts is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_agreement_drafts_no_delete BEFORE DELETE ON fa_agreement_drafts
BEGIN SELECT RAISE(ABORT, 'fa_agreement_drafts is append only'); END;

CREATE TABLE IF NOT EXISTS fa_fee_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  decision_note_id INTEGER NOT NULL UNIQUE,
  version_id INTEGER NOT NULL,
  fee_bp INTEGER NOT NULL CHECK (fee_bp > 0 AND fee_bp <= 10000),
  base_cents INTEGER NOT NULL CHECK (base_cents > 0),
  fee_cents INTEGER NOT NULL CHECK (fee_cents > 0),
  reference TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS fa_fee_bills_no_update BEFORE UPDATE ON fa_fee_bills
BEGIN SELECT RAISE(ABORT, 'fa_fee_bills is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_fee_bills_no_delete BEFORE DELETE ON fa_fee_bills
BEGIN SELECT RAISE(ABORT, 'fa_fee_bills is append only'); END;
