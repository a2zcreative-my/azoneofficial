-- 0056: Live session roster + low-stock alert tracking (v1.4.191)
-- The schedule that drives a live commerce agency: which host, which client,
-- which platform, what slot. client_id references customers by value
-- (no FK — v1.4.69 lesson).
CREATE TABLE IF NOT EXISTS live_sessions (
  id INTEGER PRIMARY KEY,
  session_date TEXT NOT NULL,          -- YYYY-MM-DD (MYT)
  start_time TEXT NOT NULL,            -- HH:MM
  end_time TEXT,
  platform TEXT NOT NULL DEFAULT 'tiktok',  -- tiktok / shopee / other
  client_id INTEGER,                   -- customers.id (client registry)
  client_name TEXT,                    -- snapshot / free text when unregistered
  host_user_id INTEGER NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled / completed / cancelled
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_date ON live_sessions(session_date);
-- Low-stock alerts: the stock level last alerted at (NULL = recovered/never).
-- Alert fires when stock ≤ 5 and (never alerted or dropped further); resets
-- when stock recovers above 5.
ALTER TABLE inventory_items ADD COLUMN low_alerted INTEGER;
