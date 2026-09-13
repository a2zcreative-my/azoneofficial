-- 0128 - SALES DUTY ON THE ROSTER (v1.158.0).
-- The CEO, 13-09-2026, on the Schedule & Roster - beside the assigned lives,
-- the sales person is to be assigned to perform sales on the day or date the
-- CEO picks (CHANGELOG 1.158.0 carries the exact words).
--
-- A sales shift is the third thing a week is made of, beside a live session
-- (live_sessions) and a task block (task_blocks) - one person, one day, the
-- hours they are on sales, an optional target, an optional focus. It is a
-- PLAN, not a claim - what actually happened that day is read from the Sales
-- Performance register (0127), which is why the board shows the day evidence
-- count beside the shift once the day has passed.
--
-- One row per person per day - a second assignment on the same day is the
-- same duty, so the insert is OR IGNORE and the run reports how many landed.
-- No FOREIGN KEY, as everywhere else in this schema (D1 does not enforce
-- them across a batch and the code checks the person itself).
CREATE TABLE IF NOT EXISTS sales_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  shift_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  target_cents INTEGER,
  focus TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, shift_date)
);
CREATE INDEX IF NOT EXISTS idx_sales_shifts_day ON sales_shifts(shift_date);
