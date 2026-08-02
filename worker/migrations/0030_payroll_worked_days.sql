-- v1.4.82: incomplete-month correction. Basic on the slip stays the FULL
-- salary; the working-day shortfall becomes an explicit, reproducible
-- deduction. These two columns persist what the deduction was computed from
-- so the staff member's own payslip shows identical figures.
ALTER TABLE payroll_entries ADD COLUMN worked_days INTEGER;
ALTER TABLE payroll_entries ADD COLUMN month_working_days INTEGER;
