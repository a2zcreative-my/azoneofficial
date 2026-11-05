-- 1.268.0 Secure Authentication 2.0 Phase R - executive recovery
-- claude/PHASE-R-GOVERNANCE.md revision 2 - the CEO approved 05-11-2026
--
-- Additive only. No existing row changes.
-- exec_recovery_panel - the people the company owner names in advance to
-- recover the owner or the Super Admin account. A member counts only once
-- they accepted with their own authenticator code and 24 hours after being
-- named. A removed member stays as history with removed_at set.
-- exec_recovery_requests - one request by one member, approved by a second
-- member, executed 12 hours after approval unless cancelled. Every step keeps
-- who and when. Nothing is ever deleted.
-- users.recovery_rotation_required - set by an executed recovery - the person
-- sets up two-factor again and reviews their recent activity before it clears.
CREATE TABLE IF NOT EXISTS exec_recovery_panel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  added_by INTEGER NOT NULL,
  added_reason TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  effective_at TEXT NOT NULL,
  accepted_at TEXT,
  removed_at TEXT,
  removed_by INTEGER,
  removed_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_panel_live ON exec_recovery_panel (user_id) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS exec_recovery_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER NOT NULL,
  requested_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  identity_checked TEXT NOT NULL,
  identity_method TEXT NOT NULL CHECK (identity_method IN ('in_person', 'video_call')),
  unlink_google INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'executed', 'cancelled', 'lapsed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approve_by TEXT NOT NULL,
  approved_by INTEGER,
  approved_at TEXT,
  approver_identity TEXT,
  execute_after TEXT,
  executed_at TEXT,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_request_open ON exec_recovery_requests (target_id) WHERE status IN ('requested', 'approved');
ALTER TABLE users ADD COLUMN recovery_rotation_required INTEGER;
