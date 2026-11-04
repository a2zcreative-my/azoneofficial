-- 0171 - Leave approval follows the Organisation chart, release 1.260.0.
-- The CEO approved claude/LEAVE-ROUTING-AUDIT.md revision 2 on 04-11-2026.
-- D1 c - an ordinary employee is approved by their reporting manager.
-- D2 b - the COO and the CCO are approved by the CEO.
-- D3 a - the CEO records his own leave as an Executive Leave Record.
-- Additive only. No existing row is changed and nothing is backfilled.
-- A request with route_json NULL was submitted under the previous rules and
-- keeps them until it is decided.
-- route_json is the route frozen when the request was submitted - who
-- approves each step, their position and why they were chosen.
-- route_version is the policy version used. step_no is the current step.
-- approver_id is the person who decides the current step - the routed
-- approver, or the person the step was reassigned to.
-- New stage values need no rebuild because stage has no CHECK constraint -
-- routed while a step waits, routing_required when no valid manager exists.
ALTER TABLE leave_requests ADD COLUMN route_json TEXT;
ALTER TABLE leave_requests ADD COLUMN route_version INTEGER;
ALTER TABLE leave_requests ADD COLUMN step_no INTEGER;
ALTER TABLE leave_requests ADD COLUMN approver_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_leave_requests_approver ON leave_requests (approver_id) WHERE approver_id IS NOT NULL;
-- Every decision on a routed request, append-only. kind is approved,
-- rejected, returned, resubmitted, reassigned, routed, recorded, hr_verified,
-- hr_flagged or override. on_behalf_of stays NULL - there is no delegation.
CREATE TABLE IF NOT EXISTS leave_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_id INTEGER NOT NULL,
  step_no INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('approved','rejected','returned','resubmitted','reassigned','routed','recorded','hr_verified','hr_flagged','override')),
  actor_id INTEGER NOT NULL,
  on_behalf_of INTEGER,
  from_user INTEGER,
  to_user INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_decisions_leave ON leave_decisions (leave_id, id);
-- One deciding row per step - a step is never approved or rejected twice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_leave_decisions_decided ON leave_decisions (leave_id, step_no) WHERE kind IN ('approved','rejected','override');
CREATE TRIGGER IF NOT EXISTS leave_decisions_no_update BEFORE UPDATE ON leave_decisions
BEGIN SELECT RAISE(ABORT, 'Leave decisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS leave_decisions_no_delete BEFORE DELETE ON leave_decisions
BEGIN SELECT RAISE(ABORT, 'Leave decisions are append-only'); END;
