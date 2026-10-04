-- 0138 - claim categories: stationery and client meeting are real categories
--
-- The claim form and the API have offered eight categories since v1.150.0
-- but the claims table still carried the six-value CHECK from 0026. A claim
-- whose first line was Stationery or Client meeting broke the constraint and
-- was never saved. SQLite cannot alter a CHECK so the table is rebuilt, the
-- same dance as 0021, keeping every column added since 0026 in its place.
-- No table references claims, so nothing else has to move.
-- The id high-water mark is carried over with a placeholder row that is
-- removed straight away, so the id of a deleted claim is never handed out
-- again and the audit log never points one number at two claims.
-- The category index is also the mark the health probe looks for.

CREATE TABLE claims_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  claim_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('travel','meal','client meeting','stationery','accommodation','equipment','medical','other')),
  amount_cents INTEGER NOT NULL,
  description TEXT,
  receipt_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  items TEXT,
  paid_at TEXT,
  hr_reviewed_by INTEGER,
  hr_reviewed_at TEXT,
  pre_approved_by INTEGER,
  pre_approved_at TEXT,
  payment_proof_key TEXT,
  payee_user_id INTEGER,
  issuer_code TEXT,
  claim_type TEXT NOT NULL DEFAULT 'reimbursement',
  payroll_month TEXT,
  submission_key TEXT
);

INSERT INTO claims_new (
  id, user_id, claim_date, category, amount_cents, description, receipt_key,
  status, decided_by, decided_at, decision_note, created_at, items, paid_at,
  hr_reviewed_by, hr_reviewed_at, pre_approved_by, pre_approved_at,
  payment_proof_key, payee_user_id, issuer_code, claim_type, payroll_month,
  submission_key
)
SELECT
  id, user_id, claim_date, category, amount_cents, description, receipt_key,
  status, decided_by, decided_at, decision_note, created_at, items, paid_at,
  hr_reviewed_by, hr_reviewed_at, pre_approved_by, pre_approved_at,
  payment_proof_key, payee_user_id, issuer_code, claim_type, payroll_month,
  submission_key
FROM claims;

INSERT INTO claims_new (id, user_id, claim_date, amount_cents, description)
SELECT seq, 0, '1970-01-01', 0, 'id high-water mark'
FROM sqlite_sequence
WHERE name = 'claims' AND seq > (SELECT COALESCE(MAX(id), 0) FROM claims);

DELETE FROM claims_new WHERE user_id = 0 AND claim_date = '1970-01-01' AND description = 'id high-water mark';

DROP TABLE claims;

ALTER TABLE claims_new RENAME TO claims;

CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id);

CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_submission_once
  ON claims (user_id, submission_key);

CREATE INDEX IF NOT EXISTS idx_claims_salary_advance_payroll
  ON claims (payroll_month, claim_type, status, paid_at);

CREATE INDEX IF NOT EXISTS idx_claims_category ON claims(category);
