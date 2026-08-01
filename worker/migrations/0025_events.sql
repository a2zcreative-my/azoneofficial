-- v1.4.73: company events (training, classes, meetings, other important
-- dates) — visible to every staff member so nobody misses them.
-- No foreign keys by policy since the v1.4.69 incident: reference by id,
-- resolve names with LEFT JOIN.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'event' CHECK (category IN ('training','class','meeting','event')),
  event_date TEXT NOT NULL,        -- ISO YYYY-MM-DD (displayed DD-MM-YYYY)
  start_time TEXT,                 -- HH:MM, optional
  end_time TEXT,                   -- HH:MM, optional
  location TEXT,
  details TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
