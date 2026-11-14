-- 0195_asset_care  v1.305.0
-- Assets Workspace 4.0 phase 3 (the CEO 14-11-2026 "Phase 3", blueprint section 6, decisions D-6 D-8 D-10).
-- Additive only. CREATE ... IF NOT EXISTS, append-only triggers, no ALTER, no DROP, no data written.
-- Four append-only tables, one row per step. The asset row is never deleted -
-- lost and disposed assets stay in the register with their history.
--   asset_issues     report (what is wrong, since when) and resolve (closed with no repair)
--   asset_repairs    sent (repairer, reference, expected back) and back (fixed or not
--                    repairable). cost_cents is a NOTE. expense_id is a read only link to
--                    the expense Finance recorded - nothing is created in Finance.
--   asset_incidents  lost (last seen where and when, circumstances, police ref) and found
--   asset_disposals  request (method, reason, proceeds as a NOTE), approve, reject.
--                    Approved by the CEO or COO, never the requester (the owner apart).
--                    No write-off, journal, cash or income row is ever written (D-8).
-- ref_id points at the step a later step answers (a back at its sent, a found at its lost,
-- a decision at its request, a resolve at its report). status_before keeps the asset
-- status the step moved it from.

CREATE TABLE IF NOT EXISTS asset_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report', 'resolve')),
  ref_id INTEGER,
  description TEXT NOT NULL,
  noticed_on TEXT,
  actor_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_issues_asset ON asset_issues (asset_id, id);
CREATE TRIGGER IF NOT EXISTS asset_issues_no_update BEFORE UPDATE ON asset_issues
BEGIN SELECT RAISE(ABORT, 'asset_issues is append only'); END;
CREATE TRIGGER IF NOT EXISTS asset_issues_no_delete BEFORE DELETE ON asset_issues
BEGIN SELECT RAISE(ABORT, 'asset_issues is append only'); END;

CREATE TABLE IF NOT EXISTS asset_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sent', 'back')),
  ref_id INTEGER,
  issue_id INTEGER,
  repairer TEXT,
  reference TEXT,
  expected_on TEXT,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('fixed', 'not_repairable')),
  cost_cents INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),
  expense_id INTEGER,
  note TEXT,
  status_before TEXT,
  actor_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_repairs_asset ON asset_repairs (asset_id, id);
CREATE TRIGGER IF NOT EXISTS asset_repairs_no_update BEFORE UPDATE ON asset_repairs
BEGIN SELECT RAISE(ABORT, 'asset_repairs is append only'); END;
CREATE TRIGGER IF NOT EXISTS asset_repairs_no_delete BEFORE DELETE ON asset_repairs
BEGIN SELECT RAISE(ABORT, 'asset_repairs is append only'); END;

CREATE TABLE IF NOT EXISTS asset_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lost', 'found')),
  ref_id INTEGER,
  last_seen_place TEXT,
  last_seen_on TEXT,
  circumstances TEXT,
  police_ref TEXT,
  holder_id INTEGER,
  status_before TEXT,
  actor_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_incidents_asset ON asset_incidents (asset_id, id);
CREATE TRIGGER IF NOT EXISTS asset_incidents_no_update BEFORE UPDATE ON asset_incidents
BEGIN SELECT RAISE(ABORT, 'asset_incidents is append only'); END;
CREATE TRIGGER IF NOT EXISTS asset_incidents_no_delete BEFORE DELETE ON asset_incidents
BEGIN SELECT RAISE(ABORT, 'asset_incidents is append only'); END;

CREATE TABLE IF NOT EXISTS asset_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('request', 'approve', 'reject')),
  ref_id INTEGER,
  method TEXT CHECK (method IS NULL OR method IN ('sold', 'scrapped', 'donated', 'returned_to_vendor', 'written_off')),
  reason TEXT,
  proceeds_cents INTEGER CHECK (proceeds_cents IS NULL OR proceeds_cents >= 0),
  status_before TEXT,
  actor_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_disposals_asset ON asset_disposals (asset_id, id);
CREATE TRIGGER IF NOT EXISTS asset_disposals_no_update BEFORE UPDATE ON asset_disposals
BEGIN SELECT RAISE(ABORT, 'asset_disposals is append only'); END;
CREATE TRIGGER IF NOT EXISTS asset_disposals_no_delete BEFORE DELETE ON asset_disposals
BEGIN SELECT RAISE(ABORT, 'asset_disposals is append only'); END;
