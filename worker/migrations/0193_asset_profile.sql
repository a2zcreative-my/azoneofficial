-- 0193_asset_profile  v1.303.0
-- Assets Workspace 4.0 phase 1 (the CEO 14-11-2026, blueprint section 4 and 11, decisions D-0 D-3 D-10).
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- asset_profile  one row per asset at most - the company that owns it (a2z or azoo)
--                and, for a shared-use asset, the team or place that keeps it. An
--                asset with no row reads as Company not set and held as the register
--                says (assigned_to). A company is set by a person, never guessed (A5).

CREATE TABLE IF NOT EXISTS asset_profile (
  asset_id INTEGER PRIMARY KEY,
  issuer_code TEXT CHECK (issuer_code IS NULL OR issuer_code IN ('a2z', 'azoo')),
  shared_label TEXT,
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
