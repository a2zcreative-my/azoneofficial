-- 0132 - the Advisors workstations (v1.161.0). Every step a desk takes is an
-- event the CEO can watch as it happens. Messages gain an addressee and an
-- author so the desks can talk to each other and the CEO can join a thread.

CREATE TABLE IF NOT EXISTS ai_events (
  id         INTEGER PRIMARY KEY,
  desk       TEXT NOT NULL,
  run_id     INTEGER,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_events_desk ON ai_events (desk, id);

ALTER TABLE ai_messages ADD COLUMN to_desk TEXT;
ALTER TABLE ai_messages ADD COLUMN author INTEGER;
ALTER TABLE ai_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE ai_proposals ADD COLUMN joint INTEGER NOT NULL DEFAULT 0;
