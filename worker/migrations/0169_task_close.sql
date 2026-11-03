-- 0169 - Task closure and reopening, release 1.256.0.
-- The owner approved claude/TASK-CLOSURE-AUDIT.md on 03-11-2026 with decision
-- D3-A. The progress record task_updates gains three kinds - closed (a task
-- closed directly with its completion summary), closed_with_exception (closed
-- by a manager while deliverables were still outstanding, with the reason) and
-- reopened (a closed task brought back to work, with the reason).
-- SQLite cannot change a CHECK in place, so the table is rebuilt - every row is
-- copied with its own id and nothing in it changes. The append-only triggers
-- and the indexes are created again exactly as 0159 made them. Nothing else
-- refers to task_updates by a foreign key.
-- No task status, stage, progress, deadline or checklist is changed.
PRAGMA defer_foreign_keys = true;
CREATE TABLE task_updates_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  project_id INTEGER,
  author_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress','blocker','waiting_client','review_request','review_approved','review_returned','correction','file','assist_request','cancel','note','done_request','closed','closed_with_exception','reopened')),
  body TEXT NOT NULL,
  completed_work TEXT,
  blockers TEXT,
  next_action TEXT,
  status_to TEXT,
  stage_to TEXT,
  progress_snapshot INTEGER,
  progress_source TEXT,
  corrects_id INTEGER,
  client_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (task_id IS NOT NULL OR project_id IS NOT NULL)
);
INSERT INTO task_updates_new (id, task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, status_to, stage_to, progress_snapshot, progress_source, corrects_id, client_key, created_at)
SELECT id, task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, status_to, stage_to, progress_snapshot, progress_source, corrects_id, client_key, created_at FROM task_updates;
DROP TABLE task_updates;
ALTER TABLE task_updates_new RENAME TO task_updates;
CREATE INDEX IF NOT EXISTS idx_task_updates_task ON task_updates (task_id, id);
CREATE INDEX IF NOT EXISTS idx_task_updates_project ON task_updates (project_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_updates_once ON task_updates (author_id, client_key) WHERE client_key IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS task_updates_no_update BEFORE UPDATE ON task_updates
BEGIN SELECT RAISE(ABORT, 'Task updates are append-only'); END;
CREATE TRIGGER IF NOT EXISTS task_updates_no_delete BEFORE DELETE ON task_updates
BEGIN SELECT RAISE(ABORT, 'Task updates are append-only'); END;
PRAGMA defer_foreign_keys = false;
