-- v1.4.72: system error log. Deliberately NO foreign keys — the error log
-- must be writable even when referential integrity itself is the problem
-- (the exact failure class the v1.4.69 Google-login incident exposed).
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  path TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_log_id ON error_log(id);
