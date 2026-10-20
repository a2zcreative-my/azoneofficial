-- 0142 - month close and stock take (ERP roadmap phase 3).
--
-- Closing a month records its figures as they stood that day, so a later
-- change to a document dated in that month shows up as a difference against
-- what was closed. It locks nothing: every screen keeps working exactly as
-- before, by the owner rule that no existing logic changes.
-- A month may be reopened with a reason and closed again. Every close is
-- kept, the reopened ones marked, so the history of the books is visible.
-- A stock take counts the shelf against the quantity the portal held when
-- the count started. Posting it moves stock by the difference, through the
-- same manual movement log a manual stock in or out writes.
-- status of a stock count is open, posted or cancelled, checked in code.

CREATE TABLE IF NOT EXISTS period_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  figures TEXT NOT NULL,
  note TEXT,
  closed_by INTEGER,
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  reopened_by INTEGER,
  reopened_at TEXT,
  reopen_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_period_closes_month
  ON period_closes (month, reopened_at);

CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  started_by INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_by INTEGER,
  posted_at TEXT,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  sku TEXT,
  item_name TEXT,
  system_qty INTEGER NOT NULL,
  counted_qty INTEGER,
  posted_delta INTEGER,
  counted_by INTEGER,
  counted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_count_lines_once
  ON stock_count_lines (count_id, item_id);
