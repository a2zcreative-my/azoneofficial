-- v1.368.0 - LIVE REPORTS, REVISION 18-11-2026 (the CEOs directive and picture,
-- audit claude/LIVE-REPORTS-AUDIT-REV-18NOV.md, decisions C1-C3 there).
--
-- ADDITIVE ONLY. Nothing existing is rewritten or deleted.
--
-- 1. Who performed a live: the roster host (live_sessions.host_user_id, as
--    always) plus live_participants - every other staff member who took part
--    (co-host, assistant, salesperson). The one report of the live is shared
--    by all of them. NOTHING is back-filled: the host is read from the roster
--    entry itself, so it is right even when the roster host is changed, and
--    nobody is invented for past lives (directive 7).
-- 2. Which project: live_sessions.project_id (client and company come from
--    the project). A live that was not on the roster is created as
--    unplanned = 1.
-- 3. The ten figures, confirmed by staff, on the draft and on every
--    submitted version (gmv_cents and duration_min already exist).
-- 4. What the screenshot AI read: live_report_ai_readings, append-only, kept
--    apart from what staff confirmed.
-- 5. The AI budget: ai_budget, one row a day (Malaysia), reserved BEFORE a
--    call by a conditional update so two uploads at once cannot pass the cap.

ALTER TABLE live_sessions ADD COLUMN project_id INTEGER;
ALTER TABLE live_sessions ADD COLUMN unplanned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_live_sessions_project ON live_sessions (project_id, session_date);

CREATE TABLE IF NOT EXISTS live_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('host', 'co_host', 'assistant', 'sales')),
  added_by INTEGER,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_live_participants_user ON live_participants (user_id, session_id);

ALTER TABLE live_reports ADD COLUMN draft_viewers INTEGER;
ALTER TABLE live_reports ADD COLUMN draft_peak_viewers INTEGER;
ALTER TABLE live_reports ADD COLUMN draft_avg_watch_sec INTEGER;
ALTER TABLE live_reports ADD COLUMN draft_orders INTEGER;
ALTER TABLE live_reports ADD COLUMN draft_items_sold INTEGER;
ALTER TABLE live_reports ADD COLUMN draft_product_clicks INTEGER;
ALTER TABLE live_reports ADD COLUMN draft_ctr_bp INTEGER;
ALTER TABLE live_reports ADD COLUMN draft_conversion_bp INTEGER;

ALTER TABLE live_report_versions ADD COLUMN viewers INTEGER;
ALTER TABLE live_report_versions ADD COLUMN peak_viewers INTEGER;
ALTER TABLE live_report_versions ADD COLUMN avg_watch_sec INTEGER;
ALTER TABLE live_report_versions ADD COLUMN orders INTEGER;
ALTER TABLE live_report_versions ADD COLUMN items_sold INTEGER;
ALTER TABLE live_report_versions ADD COLUMN product_clicks INTEGER;
ALTER TABLE live_report_versions ADD COLUMN ctr_bp INTEGER;
ALTER TABLE live_report_versions ADD COLUMN conversion_bp INTEGER;
ALTER TABLE live_report_versions ADD COLUMN project_id INTEGER;
ALTER TABLE live_report_versions ADD COLUMN participants TEXT;

CREATE TABLE IF NOT EXISTS live_report_ai_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  figures TEXT,
  model TEXT,
  neurons INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('read', 'unreadable', 'failed')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_ai_readings_report ON live_report_ai_readings (report_id, id);
CREATE TRIGGER IF NOT EXISTS live_ai_readings_no_update BEFORE UPDATE ON live_report_ai_readings
BEGIN SELECT RAISE(ABORT, 'An AI reading is kept as it was read'); END;
CREATE TRIGGER IF NOT EXISTS live_ai_readings_no_delete BEFORE DELETE ON live_report_ai_readings
BEGIN SELECT RAISE(ABORT, 'An AI reading is kept as it was read'); END;

CREATE TABLE IF NOT EXISTS ai_budget (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  neurons INTEGER NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0
);
