-- 0054: OT approval chain (v1.4.191)
-- OT was self-declared; now each day-pair is decided by management.
-- status: pending (default) / approved / rejected — decisions apply to both
-- punches of the MYT day. Only APPROVED OT will ever feed payroll.
ALTER TABLE ot_records ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE ot_records ADD COLUMN decided_by INTEGER;
ALTER TABLE ot_records ADD COLUMN decided_at TEXT;
ALTER TABLE ot_records ADD COLUMN decision_note TEXT;
