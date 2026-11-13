-- 0189_fa_case_ops  v1.299.0
-- Financial Advisory 2.0 phase 2 (the CEO 13-11-2026, blueprint decisions D-2 D-4 D-6).
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- fa_case_ops  one row per case at most - what the case waits on, its blocker,
--              its next action, how it closed (completed, not proceeding or
--              withdrawn) and a management priority override with its reason.
--              The computed priority is never stored, it is worked out on read.

CREATE TABLE IF NOT EXISTS fa_case_ops (
  case_id INTEGER PRIMARY KEY,
  waiting_on TEXT CHECK (waiting_on IS NULL OR waiting_on IN ('client', 'banker', 'management', 'paused')),
  blocker TEXT,
  blocker_urgent INTEGER NOT NULL DEFAULT 0 CHECK (blocker_urgent IN (0, 1)),
  next_action TEXT,
  closed_kind TEXT CHECK (closed_kind IS NULL OR closed_kind IN ('completed', 'not_proceeding', 'withdrawn')),
  priority_override TEXT CHECK (priority_override IS NULL OR priority_override IN ('critical', 'high', 'normal', 'low')),
  priority_reason TEXT,
  priority_by INTEGER,
  priority_at TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
