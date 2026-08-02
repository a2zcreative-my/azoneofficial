-- v1.4.80: payslip release control. Staff see a month's payslip only from
-- the 5th of the following month at 10:00 MYT (shifted to the next working
-- day when the 5th is a weekend or public holiday) — OR earlier only when a
-- payroll processor explicitly releases the month here. Prevents staff
-- learning salaries before the official release. No foreign keys by policy.
CREATE TABLE IF NOT EXISTS payslip_releases (
  month TEXT PRIMARY KEY,            -- payroll month YYYY-MM
  released_by INTEGER,
  released_at TEXT NOT NULL DEFAULT (datetime('now'))
);
