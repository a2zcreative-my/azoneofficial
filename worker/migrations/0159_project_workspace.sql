-- 0159 - Project Workspace and task progress, release 1.246.0. Two owner
-- briefs - the Quotation-linked Project Workspace of 31-10-2026 with
-- decisions P-1 to P-6 in claude/PROJECT-WORKSPACE-AUDIT.md and the Task
-- Assignment and Progress Reporting brief of 01-11-2026 with decisions T-1
-- to T-9 in claude/TASK-PROGRESS-AUDIT.md. T-1 re-cut this file before it was
-- ever applied - the progress record belongs to the task engine, so every
-- task has one, with or without a project. Additive only - new tables, new
-- nullable columns, no existing row changed.
-- projects: the project brief, ONE per quotation (unique quotation_id). The
-- quotation, customer and package stay the source - customer_id is a
-- reference kept for lists. scope_snapshot freezes the quotation lines and
-- package version when the project becomes active, so a later package or
-- quotation change cannot alter the agreed scope. owner_id stays empty until
-- the CEO or COO assigns the Project Owner (nothing records who acquired a
-- client, so it is never guessed). Project tasks are ordinary tasks with
-- link_kind project - there is no second task table.
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  owner_id INTEGER,
  owner_set_by INTEGER,
  owner_set_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','in_progress','waiting_client','on_hold','completed','cancelled')),
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT,
  due_date TEXT,
  notes TEXT,
  deliverables TEXT,
  scope_revision INTEGER,
  scope_snapshot TEXT,
  activated_at TEXT,
  activated_by INTEGER,
  activation_reason TEXT,
  completion_requested_at TEXT,
  completion_requested_by INTEGER,
  completed_at TEXT,
  completed_by INTEGER,
  cancelled_at TEXT,
  cancelled_by INTEGER,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_quotation ON projects (quotation_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status, updated_at);

-- task_updates: the progress record of EVERY task, APPEND-ONLY. One table for
-- standalone and project tasks - a project task row also names its project,
-- stamped by the server, and a project level note has a project and no task.
-- The author is always the signed-in person. A correction is a new row naming
-- the one it corrects. A repeated press or an offline replay carries the same
-- client_key and lands once. Each row keeps the status, stage and progress of
-- that moment, so history never depends on the current task row. Two triggers
-- refuse any change or removal at the database itself.
CREATE TABLE IF NOT EXISTS task_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  project_id INTEGER,
  author_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress','blocker','waiting_client','review_request','review_approved','review_returned','correction','file','assist_request','cancel','note','done_request')),
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
CREATE INDEX IF NOT EXISTS idx_task_updates_task ON task_updates (task_id, id);
CREATE INDEX IF NOT EXISTS idx_task_updates_project ON task_updates (project_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_updates_once ON task_updates (author_id, client_key) WHERE client_key IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS task_updates_no_update BEFORE UPDATE ON task_updates
BEGIN SELECT RAISE(ABORT, 'Task updates are append-only'); END;
CREATE TRIGGER IF NOT EXISTS task_updates_no_delete BEFORE DELETE ON task_updates
BEGIN SELECT RAISE(ABORT, 'Task updates are append-only'); END;

-- task_files: evidence. The bytes are in R2 under private/tasks/ with a media
-- row - never under the public uploads/ prefix - and are opened only through
-- the task, or the project, after a visibility check. A file may belong to an
-- update or a comment. restricted = the owner, the assigner and management.
CREATE TABLE IF NOT EXISTS task_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  project_id INTEGER,
  media_id INTEGER NOT NULL,
  update_id INTEGER,
  comment_id INTEGER,
  uploader_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  level TEXT NOT NULL DEFAULT 'team' CHECK (level IN ('team','restricted')),
  client_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (task_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files (task_id, id);
CREATE INDEX IF NOT EXISTS idx_task_files_project ON task_files (project_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_files_once ON task_files (uploader_id, client_key) WHERE client_key IS NOT NULL;

-- task_assistants: people helping on a task. The primary assignee stays
-- tasks.assigned_to - an assistant never replaces it. Removal stamps the row,
-- it is never deleted, so who helped when stays on record.
CREATE TABLE IF NOT EXISTS task_assistants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  added_by INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_by INTEGER,
  removed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_assistants_live ON task_assistants (task_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_assistants_user ON task_assistants (user_id, removed_at);

-- tasks: the stage inside a status - waiting for the client, blocked, ready
-- for review, cancelled - without rebuilding the status CHECK. And where the
-- progress number comes from - the checklist or a manual progress update.
-- NULL on every existing row - nothing is rewritten.
ALTER TABLE tasks ADD COLUMN stage TEXT CHECK (stage IS NULL OR stage IN ('waiting_client','blocked','review','cancelled'));
ALTER TABLE tasks ADD COLUMN progress_source TEXT CHECK (progress_source IS NULL OR progress_source IN ('checklist','manual'));

-- task_comments: the existing thread. A retry lands once, a comment names
-- the people it mentions, and a posted comment is never edited.
ALTER TABLE task_comments ADD COLUMN client_key TEXT;
ALTER TABLE task_comments ADD COLUMN mentions TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_comments_once ON task_comments (user_id, client_key) WHERE client_key IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS task_comments_no_update BEFORE UPDATE ON task_comments
BEGIN SELECT RAISE(ABORT, 'Task comments are never edited'); END;
