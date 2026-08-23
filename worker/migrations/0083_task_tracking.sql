-- 0083 — v1.42.0 (CEO: "make the task scope followed clearly by the staff
-- and I want a proper implementation to make sure that everyone is alert on
-- their task and the task being track properly").
--
-- Two tables, zero ALTERs (audit B4 rule — everything here is IF NOT EXISTS
-- and fully replayable):
--
-- task_items — the SCOPE, itemised. One row per deliverable; ticking them is
-- how progress moves (tasks.progress becomes derived, done/total). A scope
-- someone can tick is a scope someone can follow.
--
-- task_events — the TRAIL. Acknowledgements ('ack' — the staff member's
-- explicit "I have seen and understood this task"), status changes, and the
-- daily-alert dedupe rows ('ack_nudge' / 'due_reminder' / 'overdue_alert',
-- keyed by on_date so each fires at most once per task per day). Monitoring
-- lives on facts, not memory.

CREATE TABLE IF NOT EXISTS task_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id  INTEGER NOT NULL,
  title    TEXT    NOT NULL,
  done     INTEGER NOT NULL DEFAULT 0,
  done_by  INTEGER,
  done_at  TEXT,
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_task_items_task ON task_items (task_id, sort);

CREATE TABLE IF NOT EXISTS task_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL,
  kind       TEXT    NOT NULL,  -- 'ack' | 'status:<v>' | 'scope_done' | 'ack_nudge' | 'due_reminder' | 'overdue_alert'
  user_id    INTEGER,
  on_date    TEXT,              -- MYT date; the daily-dedupe key for alert kinds
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events (task_id, kind, on_date);
