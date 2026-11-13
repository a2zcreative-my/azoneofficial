-- 0190_fa_case_updates  v1.299.0
-- Financial Advisory 2.0 phase 2 (the CEO 13-11-2026, blueprint decision D-4).
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- fa_case_updates  every case update - a comment, a status change, a follow-up
--                  (the follow-up itself is a row in tasks), an owner change, a
--                  supporting document, a blocker, the next action, what the case
--                  waits on, a priority override, a closing - with its author and
--                  time. Append only.

CREATE TABLE IF NOT EXISTS fa_case_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'status', 'follow_up', 'owner', 'document', 'blocker', 'next_action', 'waiting_on', 'priority', 'closed')),
  body TEXT,
  old_value TEXT,
  new_value TEXT,
  task_id INTEGER,
  document_id INTEGER,
  author_id INTEGER NOT NULL,
  author_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_case_updates_case
  ON fa_case_updates (case_id, id);

CREATE TRIGGER IF NOT EXISTS fa_case_updates_no_update BEFORE UPDATE ON fa_case_updates
BEGIN SELECT RAISE(ABORT, 'fa_case_updates is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_case_updates_no_delete BEFORE DELETE ON fa_case_updates
BEGIN SELECT RAISE(ABORT, 'fa_case_updates is append only'); END;
