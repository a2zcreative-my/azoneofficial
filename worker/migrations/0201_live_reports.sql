-- v1.315.0 - TASKS WORKSPACE 5.0, GATE 4 - THE LIVE HOST REPORT (the CEO,
-- 15-11-2026: approved as per recommendations, TK-1 and TK-14, with L2 and L3 of
-- 12-11-2026 kept).
-- One report per live session on the roster, written by the host of that session.
-- Draft, then Submitted, then Reviewed, then Accepted - or Returned for
-- correction and submitted again as a new version. Every submitted version,
-- every screenshot and every review is kept: the triggers refuse an update or
-- a delete, and a screenshot is only ever moved from the draft onto the version
-- it was submitted with. Reported GMV is the figure of the host: it is never
-- verified sales, cash, an invoice paid, commission or payroll, and nothing
-- here writes to those tables.
-- ADDITIVE ONLY: four new tables, their indexes and triggers.
CREATE TABLE IF NOT EXISTS live_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL UNIQUE,
  host_user_id INTEGER NOT NULL,
  company TEXT CHECK (company IS NULL OR company IN ('a2z', 'azoo')),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'reviewed', 'accepted', 'returned')),
  current_version INTEGER NOT NULL DEFAULT 0,
  draft_gmv_cents INTEGER CHECK (draft_gmv_cents IS NULL OR draft_gmv_cents >= 0),
  draft_duration_min INTEGER CHECK (draft_duration_min IS NULL OR draft_duration_min >= 0),
  draft_highlights TEXT,
  draft_blockers TEXT,
  draft_next_actions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_reports_host ON live_reports (host_user_id, state);
CREATE INDEX IF NOT EXISTS idx_live_reports_state ON live_reports (state, updated_at);
CREATE TABLE IF NOT EXISTS live_report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  company TEXT,
  gmv_cents INTEGER NOT NULL CHECK (gmv_cents >= 0),
  duration_min INTEGER,
  highlights TEXT,
  blockers TEXT,
  next_actions TEXT,
  submitted_by INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (report_id, version)
);
CREATE TRIGGER IF NOT EXISTS live_report_versions_no_update BEFORE UPDATE ON live_report_versions
BEGIN SELECT RAISE(ABORT, 'Live report versions are kept as submitted'); END;
CREATE TRIGGER IF NOT EXISTS live_report_versions_no_delete BEFORE DELETE ON live_report_versions
BEGIN SELECT RAISE(ABORT, 'Live report versions are kept as submitted'); END;
CREATE TABLE IF NOT EXISTS live_report_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  version INTEGER,
  r2_key TEXT NOT NULL,
  file_name TEXT,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  uploaded_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_report_files_report ON live_report_files (report_id, version);
CREATE TRIGGER IF NOT EXISTS live_report_files_no_rewrite BEFORE UPDATE ON live_report_files
WHEN OLD.version IS NOT NULL OR NEW.r2_key != OLD.r2_key OR NEW.report_id != OLD.report_id
BEGIN SELECT RAISE(ABORT, 'A submitted screenshot is kept as it was'); END;
CREATE TRIGGER IF NOT EXISTS live_report_files_no_delete BEFORE DELETE ON live_report_files
BEGIN SELECT RAISE(ABORT, 'Live report screenshots are kept'); END;
CREATE TABLE IF NOT EXISTS live_report_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('review', 'accept', 'return', 'reopen')),
  note TEXT,
  actor_id INTEGER NOT NULL,
  actor_role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_report_reviews_report ON live_report_reviews (report_id, id);
CREATE TRIGGER IF NOT EXISTS live_report_reviews_no_update BEFORE UPDATE ON live_report_reviews
BEGIN SELECT RAISE(ABORT, 'Live report reviews are append-only'); END;
CREATE TRIGGER IF NOT EXISTS live_report_reviews_no_delete BEFORE DELETE ON live_report_reviews
BEGIN SELECT RAISE(ABORT, 'Live report reviews are append-only'); END;
