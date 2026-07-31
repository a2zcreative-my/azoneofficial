-- 0011: Public holidays / company calendar (v1.4.16)
--
-- Backs three features:
--   * leave day-counting can skip holidays (and weekends)
--   * attendance flags can treat a holiday as a non-working day
--   * a shared company calendar staff can see
--
-- leave_balances (entitlement) already exists (0003); this migration only adds
-- the holiday calendar. Entitlements get an admin editor in the same release,
-- writing to the existing leave_balances table.

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holiday_date TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD (Malaysia)
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'public', -- public | company | replacement
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays (holiday_date);
