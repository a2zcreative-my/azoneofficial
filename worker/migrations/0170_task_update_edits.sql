-- 0170 - Task updates can be edited and withdrawn, and a reported percentage
-- is kept beside the checklist, release 1.257.0.
-- The owner answered on 03-11-2026 - edit and withdraw with the history kept,
-- and a reported percentage on every update.
-- An edit is a new row of kind edit that names the update it changes in
-- corrects_id and carries the new text. The original row is never changed and
-- stays readable as the original.
-- A withdrawal is a new row of kind withdrawn that names the update in
-- corrects_id and carries the reason. The update leaves the timeline and a
-- short line says who withdrew it, when and why.
-- reported_progress is the percentage the author reported, 0 to 100. On a task
-- with a checklist the official progress stays the checklist figure.
-- SQLite cannot change a CHECK in place, so the table is rebuilt the same way
-- 0169 did it - every row is copied with its own id and nothing in it changes.
-- The append-only triggers and the indexes are created again.
PRAGMA defer_foreign_keys = true;
CREATE TABLE task_updates_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  project_id INTEGER,
  author_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress','blocker','waiting_client','review_request','review_approved','review_returned','correction','file','assist_request','cancel','note','done_request','closed','closed_with_exception','reopened','edit','withdrawn')),
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
  reported_progress INTEGER CHECK (reported_progress IS NULL OR (reported_progress >= 0 AND reported_progress <= 100)),
  CHECK (task_id IS NOT NULL OR project_id IS NOT NULL)
);
INSERT INTO task_updates_new (id, task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, status_to, stage_to, progress_snapshot, progress_source, corrects_id, client_key, created_at)
SELECT id, task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, status_to, stage_to, progress_snapshot, progress_source, corrects_id, client_key, created_at FROM task_updates;
DROP TABLE task_updates;
ALTER TABLE task_updates_new RENAME TO task_updates;
CREATE INDEX IF NOT EXISTS idx_task_updates_task ON task_updates (task_id, id);
CREATE INDEX IF NOT EXISTS idx_task_updates_project ON task_updates (project_id, id);
CREATE INDEX IF NOT EXISTS idx_task_updates_corrects ON task_updates (corrects_id) WHERE corrects_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_updates_once ON task_updates (author_id, client_key) WHERE client_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_updates_withdrawn_once ON task_updates (corrects_id) WHERE kind = 'withdrawn';
CREATE TRIGGER IF NOT EXISTS task_updates_no_update BEFORE UPDATE ON task_updates
BEGIN SELECT RAISE(ABORT, 'Task updates are append-only'); END;
CREATE TRIGGER IF NOT EXISTS task_updates_no_delete BEFORE DELETE ON task_updates
BEGIN SELECT RAISE(ABORT, 'Task updates are append-only'); END;
PRAGMA defer_foreign_keys = false;
