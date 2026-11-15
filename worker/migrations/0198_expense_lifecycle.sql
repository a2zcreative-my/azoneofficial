-- v1.312.0 - FINANCE WORKSPACE 5.0, PHASE B (the CEO, 15-11-2026: approve as
-- per recommend, CEO-4 in claude/FINANCE-WORKSPACE-5.0-BLUEPRINT.md).
--
-- AN EXPENSE HAS A LIFE, AND ONLY ITS LAST STEP MOVES MONEY.
--   recorded   - entered by the CEO, COO or admin, with its company
--   approved   - by the CEO (by the COO when the CEO recorded it)
--   authorised - payment authorised by the CEO
--   paid       - completed by Finance (the COO) with the bank date, the
--                account and the evidence - the only step that books cash
--   cancelled  - with a reason, never deleted
-- A scheduled expense is an approved one with a due date. Reconciled is read
-- from the cash book, never stored. ADDITIVE ONLY: nullable columns. An
-- existing expense keeps its meaning - paid when paid_at is set, otherwise
-- recorded - and no row is changed.

ALTER TABLE expenses ADD COLUMN status TEXT;
ALTER TABLE expenses ADD COLUMN due_on TEXT;
ALTER TABLE expenses ADD COLUMN approved_by INTEGER;
ALTER TABLE expenses ADD COLUMN approved_at TEXT;
ALTER TABLE expenses ADD COLUMN authorised_by INTEGER;
ALTER TABLE expenses ADD COLUMN authorised_at TEXT;
ALTER TABLE expenses ADD COLUMN paid_on TEXT;
ALTER TABLE expenses ADD COLUMN paid_by INTEGER;
ALTER TABLE expenses ADD COLUMN bank_id INTEGER;
ALTER TABLE expenses ADD COLUMN payment_ref TEXT;
ALTER TABLE expenses ADD COLUMN cancelled_by INTEGER;
ALTER TABLE expenses ADD COLUMN cancelled_at TEXT;
ALTER TABLE expenses ADD COLUMN cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses (status, company);
