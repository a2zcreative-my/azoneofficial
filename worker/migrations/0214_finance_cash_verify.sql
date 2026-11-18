-- 18-11-2026 - FINANCE HISTORICAL RECOVERY (the CEO: "proceed as per recommend" on
-- docs/FINANCE-HISTORY-GATE.md). A receipt paid before 01-11-2026 is verified as CASH ONLY:
-- a mark on the Finance item, written by the CEO owner with a fresh code. It is never an
-- invoice_paid_confirmations row, so commission cannot see it. Taking it back keeps the mark
-- with its reason. ADDITIVE: six nullable columns, nothing rewritten.
ALTER TABLE cashbook_marks ADD COLUMN cash_verified_at TEXT;
ALTER TABLE cashbook_marks ADD COLUMN cash_verified_by INTEGER;
ALTER TABLE cashbook_marks ADD COLUMN cash_verified_note TEXT;
ALTER TABLE cashbook_marks ADD COLUMN cash_revoked_at TEXT;
ALTER TABLE cashbook_marks ADD COLUMN cash_revoked_by INTEGER;
ALTER TABLE cashbook_marks ADD COLUMN cash_revoke_reason TEXT;
