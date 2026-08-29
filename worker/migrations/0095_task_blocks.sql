-- 0095 - v1.66.0: Track R. A task can occupy a slot on the roster.
--
-- The Schedule and Roster board planned live sessions and nothing else, so it
-- showed three of eight staff and said the marketing team did nothing all
-- week. That was never true. Their work simply lived on another screen.
--
-- A task already knows when it is DUE. It had no way to say when the WORK
-- HAPPENS, which is the only fact a grid of days by people needs.
--
-- WHY A SIDE TABLE AND NOT THREE COLUMNS ON tasks:
--
--   1. One task is often two blocks. Three hours Tuesday and two hours
--      Thursday is an ordinary week, and a single date column can never
--      express it.
--   2. Dragging a block to a new day then writes here, not to a hot tasks
--      row that carries scope, status and assignment.
--   3. Unscheduling deletes a row instead of nulling three columns on a live
--      record, so an accident is a lost block rather than a damaged task.
--
-- WHY NOT MERGE THIS INTO live_sessions, which already has date and time:
-- because the sales leaderboard credits TikTok GMV to whoever was in a live
-- session at that moment. A task stored as a live session would pay
-- commission to somebody doing paperwork. The money would go wrong quietly,
-- and the first symptom would be an argument about a payslip.
--
-- user_id is who works the block, normally the task assignee but not always:
-- a manager can put a colleague on one afternoon of a task belonging to
-- someone else, without reassigning the whole thing.
--
-- Both statements are idempotent (audit B4 rule: no half-apply is possible).

CREATE TABLE IF NOT EXISTS task_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  block_date TEXT    NOT NULL,
  start_time TEXT    NOT NULL,
  end_time   TEXT,
  created_by INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_blocks_week ON task_blocks (block_date, user_id);
