-- 0017: Payroll processing (v1.4.36)
--
-- One row per staff member per month: basic + commission + allowance −
-- deduction = net. Processed by the CEO or hr_admin (hr_manage), printed as
-- a branded AZ ONE OFFICIAL payslip. Amounts in sen (cents).

CREATE TABLE IF NOT EXISTS payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,                -- YYYY-MM
  basic_cents INTEGER NOT NULL DEFAULT 0,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  allowance_cents INTEGER NOT NULL DEFAULT 0,
  deduction_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, month)
);
