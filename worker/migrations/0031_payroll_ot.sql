-- v1.4.85: overtime. Hours entered per person per month; the amount is
-- computed at the Employment Act rate for a normal working day:
-- hourly ORP = monthly wage ÷ 26 ÷ 8, OT = 1.5 × hourly × hours.
-- Both the hours and the computed sen are stored so the payslip reproduces
-- the figure exactly, forever.
ALTER TABLE payroll_entries ADD COLUMN ot_hours REAL;
ALTER TABLE payroll_entries ADD COLUMN ot_cents INTEGER NOT NULL DEFAULT 0;
