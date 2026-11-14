-- 0194_asset_custody  v1.304.0
-- Assets Workspace 4.0 phase 2 (the CEO 14-11-2026, blueprint section 5 and decisions D-2 D-4 D-5).
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- asset_custody  every custody step of an asset - assign, acknowledge (by the holder
--                only), transfer, return, cancel - and a manager request for an
--                assignment or transfer with its decision. Who, from whom, to whom,
--                where, why, the condition at hand-over, and when. Append only - the
--                register keeps the current holder (assets.assigned_to), written in
--                the same request. Holders before 4.0 are the starting point - no
--                earlier step is invented.

CREATE TABLE IF NOT EXISTS asset_custody (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assign', 'acknowledge', 'transfer', 'return', 'cancel', 'request', 'approve', 'decline')),
  from_holder INTEGER,
  to_holder INTEGER,
  location TEXT,
  reason TEXT,
  condition TEXT CHECK (condition IS NULL OR condition IN ('good', 'fair', 'damaged')),
  request_id INTEGER,
  actor_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_custody_asset
  ON asset_custody (asset_id, id);

CREATE TRIGGER IF NOT EXISTS asset_custody_no_update BEFORE UPDATE ON asset_custody
BEGIN SELECT RAISE(ABORT, 'asset_custody is append only'); END;

CREATE TRIGGER IF NOT EXISTS asset_custody_no_delete BEFORE DELETE ON asset_custody
BEGIN SELECT RAISE(ABORT, 'asset_custody is append only'); END;
