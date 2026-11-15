-- v1.312.0 - FINANCE WORKSPACE 5.0, PHASE B (the CEO, 15-11-2026: approve as
-- per recommend, CEO-2 and CEO-6 in claude/FINANCE-WORKSPACE-5.0-BLUEPRINT.md).
--
-- ONE COMPANY PER MONEY RECORD. A2Z CREATIVE MARKETING (a2z) and AZ ONE
-- OFFICIAL (azoo) keep separate books from here: each company account, each
-- cash movement and each expense names its company. ADDITIVE ONLY - three
-- nullable columns and three for the CEO acceptance of a difference. No row
-- is changed: an existing movement takes the company of the account it went
-- through once that account has one, and the screen lists the rest for a
-- person to assign, never by guess.
--
-- REVIEWED IS NOT RESOLVED. cashbook_marks keeps the review note as before
-- and gains the acceptance by the CEO, with its reason, which is the only way
-- a difference that remains leaves the reconciliation list.

ALTER TABLE bank_accounts ADD COLUMN company TEXT;
ALTER TABLE cashflow_entries ADD COLUMN company TEXT;
ALTER TABLE expenses ADD COLUMN company TEXT;

ALTER TABLE cashbook_marks ADD COLUMN accepted_note TEXT;
ALTER TABLE cashbook_marks ADD COLUMN accepted_by INTEGER;
ALTER TABLE cashbook_marks ADD COLUMN accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_cashflow_company ON cashflow_entries (company);
