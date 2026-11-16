-- v1.322.0 - THE POSITIONS LIST (the CEO, 16-11-2026: Position list, as recommended,
-- claude/POSITIONS-STAGE-0-AUDIT.md).
-- The CEO and the Super Admin keep a list of positions. Each is linked to one of
-- the existing access levels as a SUGGESTION only - choosing a position for
-- somebody never changes their role, which still changes through the one role door.
-- A staff record keeps its position as text, as before (users is not altered).
-- A position is renamed or retired, never deleted, and every change is kept.
-- ADDITIVE ONLY: two new tables, their indexes and triggers.
CREATE TABLE IF NOT EXISTS staff_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  access_role TEXT NOT NULL,
  department TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT,
  retired_at TEXT,
  retired_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_positions_name ON staff_positions (name COLLATE NOCASE);
CREATE TRIGGER IF NOT EXISTS staff_positions_no_delete BEFORE DELETE ON staff_positions
BEGIN SELECT RAISE(ABORT, 'A position is retired, never deleted'); END;
-- every change to a position, old and new, who and when - only ever added
CREATE TABLE IF NOT EXISTS staff_position_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_name TEXT,
  new_name TEXT,
  old_access_role TEXT,
  new_access_role TEXT,
  note TEXT,
  actor_id INTEGER,
  actor_role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_position_changes_position ON staff_position_changes (position_id, id);
CREATE TRIGGER IF NOT EXISTS staff_position_changes_no_update BEFORE UPDATE ON staff_position_changes
BEGIN SELECT RAISE(ABORT, 'A position change is kept as written'); END;
CREATE TRIGGER IF NOT EXISTS staff_position_changes_no_delete BEFORE DELETE ON staff_position_changes
BEGIN SELECT RAISE(ABORT, 'A position change is kept as written'); END;
