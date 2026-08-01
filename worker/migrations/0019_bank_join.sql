-- 0019: Bank details + joining date (v1.4.43)
--
-- Bank name + account number feed payroll processing and print on the
-- payslip (company primary bank: Maybank). joined_on gates payslip months —
-- no payslip exists for months before a person joined AZ ONE OFFICIAL.
-- employment_status (existing column) now records part_time/contract/permanent.

ALTER TABLE users ADD COLUMN bank_name TEXT;
ALTER TABLE users ADD COLUMN bank_account TEXT;
ALTER TABLE users ADD COLUMN joined_on TEXT;  -- YYYY-MM-DD
