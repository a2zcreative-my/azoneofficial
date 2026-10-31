-- 0158 - Payroll population and payout integrity (go-live audit E1 and E3, the
-- owner decision D-5 of 31-10-2026). Additive only - no existing row is
-- changed and no payroll figure is recomputed.
-- payroll_exceptions: a person in the month run who cannot be paid by the
-- bank file yet (no bank account, bank not recognised), a login that is
-- suspended (shown, never blocking), or a payment the CEO made by hand.
-- Paid for a month is refused while a blocking exception is open.
CREATE TABLE IF NOT EXISTS payroll_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('no_bank','bank_unrecognised','login_suspended','manual_payment')),
  detail TEXT,
  amount_cents INTEGER,
  resolution TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payroll_exceptions_month ON payroll_exceptions (month, user_id, kind);
-- The bank run names the release it paid (the rowid of payslip_releases) and
-- what the file carried.
ALTER TABLE payroll_payments ADD COLUMN release_id INTEGER;
ALTER TABLE payroll_payments ADD COLUMN file_total_cents INTEGER;
ALTER TABLE payroll_payments ADD COLUMN file_payees INTEGER;
ALTER TABLE payroll_payments ADD COLUMN manual_total_cents INTEGER;
