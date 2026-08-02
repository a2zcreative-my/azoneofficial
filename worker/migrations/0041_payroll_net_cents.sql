-- v1.4.124: single source of truth for "what payroll costs". The panel now
-- SAVES the computed net per entry (the one shared formula, at save time);
-- /expenses sums these stored nets instead of re-deriving them, so the
-- Expenses card and the Payroll tab can never disagree after Save all.
ALTER TABLE payroll_entries ADD COLUMN net_cents INTEGER;
