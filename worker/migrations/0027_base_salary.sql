-- v1.4.78: fixed monthly basic salary per staff member. Payroll auto-fills
-- each new month's Basic from here; change it here when an increment is
-- awarded. Stored in sen like all money.
ALTER TABLE users ADD COLUMN base_salary_cents INTEGER NOT NULL DEFAULT 0;
