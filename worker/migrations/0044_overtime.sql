-- 0044: Overtime punches (v1.4.155)
-- OT in / OT out taps from the Dashboard, opening at 18:00 MYT.
-- Separate table rather than new attendance_records types: that table carries a
-- CHECK constraint on `type`, and changing a CHECK in SQLite means rebuilding
-- the table — not worth the risk for two new punch kinds.
-- No FOREIGN KEYs (v1.4.69 lesson) — user_id is referenced by value.
CREATE TABLE IF NOT EXISTS ot_records (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ot_in','ot_out')),
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ot_user_date ON ot_records(user_id, created_at);
