-- 0068 (v1.6.0): sales-target/commission/leaderboard engine + web-push.
-- No foreign keys, matching the v1.4.69 policy (a table rebuild never breaks
-- another table's writes). Every table is IF NOT EXISTS so a re-run is safe.

-- Per-person monthly sales target (the company target stays in sales_targets).
CREATE TABLE IF NOT EXISTS user_sales_targets (
  user_id      INTEGER NOT NULL,
  month        TEXT NOT NULL,            -- YYYY-MM (MYT)
  target_cents INTEGER NOT NULL,
  set_by       INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month)
);

-- Per-team monthly sales target. team = a free label ('sales', 'live', …).
CREATE TABLE IF NOT EXISTS team_sales_targets (
  team         TEXT NOT NULL,
  month        TEXT NOT NULL,
  target_cents INTEGER NOT NULL,
  set_by       INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team, month)
);

-- Commission rules. A rule pays base_pct on ALL attributed sales, plus an
-- extra bonus_pct on the portion ABOVE the person's target (the "1.5% base +
-- bonus over target" the CEO asked for). applies_to = 'all' or a single role.
CREATE TABLE IF NOT EXISTS commission_rules (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  base_pct   REAL NOT NULL DEFAULT 0,     -- % of attributed sales
  bonus_pct  REAL NOT NULL DEFAULT 0,     -- extra % on sales above target
  applies_to TEXT NOT NULL DEFAULT 'all', -- 'all' or a role name
  active     INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Web-push subscriptions (RFC 8291). One row per browser/device per user.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,               -- client public key (base64url)
  auth       TEXT NOT NULL,               -- client auth secret (base64url)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
