-- 0136 - claim submission idempotency and salary advances.
-- A submission key makes a double tap or offline replay one claim.
-- Salary advances remain claims for approval and payment evidence, but their
-- recovery month is explicit so payroll can deduct only approved, paid money.

ALTER TABLE claims ADD COLUMN claim_type TEXT NOT NULL DEFAULT 'reimbursement';
ALTER TABLE claims ADD COLUMN payroll_month TEXT;
ALTER TABLE claims ADD COLUMN submission_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_submission_once
  ON claims (user_id, submission_key);

CREATE INDEX IF NOT EXISTS idx_claims_salary_advance_payroll
  ON claims (payroll_month, claim_type, status, paid_at);
