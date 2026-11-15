-- v1.315.0 - TASKS WORKSPACE 5.0, GATE 4 (the CEO, 15-11-2026: approved as per
-- recommendations, TK-9 and TK-15).
-- The deliverables of a project become rows that can be ticked, with a due date,
-- who ticked them and when - kept apart from task completion. The written
-- deliverables list on the project is copied in once, in its order, and the
-- original column is kept and still follows every edit. A removed deliverable
-- is marked removed, never deleted.
-- The acceptance by the client of the delivered work is recorded by the Project
-- Owner or management (date, the name of the client, a note) and is required
-- before a project is closed. Acceptance rows are only ever added.
-- ADDITIVE ONLY: two new tables, their indexes and triggers, and the one copy.
CREATE TABLE IF NOT EXISTS project_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  due_on TEXT,
  done_at TEXT,
  done_by INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_project_deliverables_project ON project_deliverables (project_id, position);
CREATE TRIGGER IF NOT EXISTS project_deliverables_no_delete BEFORE DELETE ON project_deliverables
BEGIN SELECT RAISE(ABORT, 'A deliverable is marked removed, never deleted'); END;
INSERT INTO project_deliverables (project_id, title, position)
  SELECT p.id, CAST(j.value AS TEXT), CAST(j.key AS INTEGER)
    FROM projects p, json_each(p.deliverables) j
   WHERE p.deliverables IS NOT NULL AND json_valid(p.deliverables) AND json_type(p.deliverables) = 'array'
     AND TRIM(CAST(j.value AS TEXT)) != ''
     AND NOT EXISTS (SELECT 1 FROM project_deliverables d WHERE d.project_id = p.id);
CREATE TABLE IF NOT EXISTS project_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  accepted_on TEXT NOT NULL,
  client_name TEXT NOT NULL,
  note TEXT,
  recorded_by INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_acceptances_project ON project_acceptances (project_id, id);
CREATE TRIGGER IF NOT EXISTS project_acceptances_no_update BEFORE UPDATE ON project_acceptances
BEGIN SELECT RAISE(ABORT, 'A client acceptance is kept as recorded'); END;
CREATE TRIGGER IF NOT EXISTS project_acceptances_no_delete BEFORE DELETE ON project_acceptances
BEGIN SELECT RAISE(ABORT, 'A client acceptance is kept as recorded'); END;
