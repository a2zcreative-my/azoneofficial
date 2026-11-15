-- v1.315.0 - TASKS WORKSPACE 5.0, GATE 4 (the CEO, 15-11-2026: approved as per
-- recommendations, TK-4 in claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md).
-- Every change of a task title keeps the previous title, the new title, who
-- changed it, when, and the reason. Rows are only ever added: the triggers
-- refuse an update or a delete, so the history cannot be rewritten.
-- ADDITIVE ONLY: one new table, its index and its two triggers. No existing
-- row or column is changed.
CREATE TABLE IF NOT EXISTS task_title_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  old_title TEXT NOT NULL,
  new_title TEXT NOT NULL,
  reason TEXT,
  changed_by INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_title_history_task ON task_title_history (task_id, id);
CREATE TRIGGER IF NOT EXISTS task_title_history_no_update BEFORE UPDATE ON task_title_history
BEGIN SELECT RAISE(ABORT, 'Task title history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS task_title_history_no_delete BEFORE DELETE ON task_title_history
BEGIN SELECT RAISE(ABORT, 'Task title history is append-only'); END;
