-- 0010: Leave approval chain, attendance policy, self-created tasks (v1.4.15)
--
-- Leave: replaces the single approve/reject with a staged chain.
--   Staff route:      applied -> hr_reviewed -> pre_approved -> approved
--   COO/CCO route:    applied -> hr_reviewed ->              -> approved
--   Any stage may reject -> rejected (terminal). Cancel by owner while not
--   yet approved/rejected -> cancelled.
-- We record each stage's actor so the trail is auditable end to end.

ALTER TABLE leave_requests ADD COLUMN stage TEXT NOT NULL DEFAULT 'applied';
ALTER TABLE leave_requests ADD COLUMN hr_by INTEGER REFERENCES users(id);
ALTER TABLE leave_requests ADD COLUMN hr_at TEXT;
ALTER TABLE leave_requests ADD COLUMN preapp_by INTEGER REFERENCES users(id);
ALTER TABLE leave_requests ADD COLUMN preapp_at TEXT;
ALTER TABLE leave_requests ADD COLUMN final_by INTEGER REFERENCES users(id);
ALTER TABLE leave_requests ADD COLUMN final_at TEXT;

-- Existing rows: map old single-status values onto the new stage.
UPDATE leave_requests SET stage = 'approved' WHERE status = 'approved';
UPDATE leave_requests SET stage = 'rejected' WHERE status = 'rejected';
UPDATE leave_requests SET stage = 'cancelled' WHERE status = 'cancelled';
UPDATE leave_requests SET stage = 'applied'  WHERE status = 'pending';

-- Staff ID / badge fields (admin sets employee_id/position/department already;
-- add the extras a printed badge card needs).
ALTER TABLE users ADD COLUMN id_issued_on TEXT;   -- ISO date badge issued
ALTER TABLE users ADD COLUMN blood_type TEXT;     -- optional, common on MY staff IDs

CREATE INDEX IF NOT EXISTS idx_leave_stage ON leave_requests (stage);
