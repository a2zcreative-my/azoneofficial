-- 0152: Commission rates per package, per policy version
-- (v1.227.0, the Commission Configuration brief from the owner and his answers,
-- 30-10-2026, claude/COMMISSION-CONFIG-AUDIT.md: "Build now"). Additive
-- only: one new table and no existing row or table is changed.
--
-- commission_policy_packages - the package rules of ONE policy version,
-- written with its draft and never edited after (a version is never
-- edited). package_name is matched against the name of an invoice line,
-- trimmed and without regard to case. rule is percent (rate_bp in basis
-- points, 1000 = 10.00 percent), fixed (fixed_cents for each unit sold) or
-- none (the package earns no commission). A line that matches no package
-- earns at the default rate of the version. A version with no rows here works
-- exactly as before.

CREATE TABLE IF NOT EXISTS commission_policy_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL,
  package_name TEXT NOT NULL,
  match_key TEXT NOT NULL,
  rule TEXT NOT NULL CHECK (rule IN ('percent', 'fixed', 'none')),
  rate_bp INTEGER,
  fixed_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (policy_id, match_key)
);

CREATE INDEX IF NOT EXISTS idx_comm_pkg_policy ON commission_policy_packages (policy_id);
