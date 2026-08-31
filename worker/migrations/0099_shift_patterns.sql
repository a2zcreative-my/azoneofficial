-- 0099 - v1.76.0: working hours that are a SCHEDULE, not a constant.
--
-- The CEO, 30-08-2026:
--   "I want to have the working hour schedule for me to setup their working
--    hours so that system able to capture their working hours without
--    everything dump into 1 working hour which is 10am to 6pm which is there
--    might have a staff that working hour 11am to 7pm or beside it."
--
-- Until now there was ONE shift in the whole system, written as a constant in
-- the worker: 10:00-18:00, Monday to Friday, half day after 12:00. Every late
-- flag, every early-out, the attendance export and the payroll short-day scan
-- measured against it.
--
-- It was already wrong. The company changed its Friday finishing time - there
-- is an announcement on the dashboard about it, PERUBAHAN WAKTU BALIK BEKERJA
-- UNTUK HARI JUMAAT - and the code never knew. Every Friday since has been
-- flagged against 18:00.
--
-- TWO TABLES, NOT A COLUMN ON users. A per-person start and end would be
-- fewer lines, and would mean the next company-wide Friday change is nine
-- edits instead of one. A pattern is named, shared, and edited once.
--
-- EFFECTIVE-DATED. An assignment carries the date it starts. Changing
-- somebody hours in March does not rewrite what their January looked like -
-- attendance flags on a month that has already been paid must not move.
-- The pattern in force on a day is the assignment with the latest
-- effective_from on or before it.
--
-- Minutes from midnight, Malaysia time. NULL start = NOT a working day for
-- that person, which is what makes "weekend" answerable per staff member
-- rather than assumed to be Saturday and Sunday.
--
-- Fully replayable - every statement IF NOT EXISTS or guarded (audit B4).

CREATE TABLE IF NOT EXISTS shift_patterns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  mon_start INTEGER, mon_end INTEGER,
  tue_start INTEGER, tue_end INTEGER,
  wed_start INTEGER, wed_end INTEGER,
  thu_start INTEGER, thu_end INTEGER,
  fri_start INTEGER, fri_end INTEGER,
  sat_start INTEGER, sat_end INTEGER,
  sun_start INTEGER, sun_end INTEGER,
  -- Arriving after this many minutes counts the day a half day (was 12:00).
  half_day_minutes  INTEGER NOT NULL DEFAULT 720,
  -- Exactly one row should carry this - it is what a person with no
  -- assignment falls back to, and what a new joiner starts on.
  is_default        INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff_shifts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  pattern_id     INTEGER NOT NULL REFERENCES shift_patterns(id),
  effective_from TEXT    NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_shifts_user ON staff_shifts (user_id, effective_from);

-- The office pattern, seeded so nothing has to exist before this works: the
-- old constant, plus the Friday finish the company actually moved to. Guarded
-- by NOT EXISTS so re-running this migration cannot create a second one.
INSERT INTO shift_patterns
  (name, mon_start, mon_end, tue_start, tue_end, wed_start, wed_end,
   thu_start, thu_end, fri_start, fri_end, half_day_minutes, is_default)
SELECT 'Office (10:00-18:00, Fri 17:30)',
       600, 1080, 600, 1080, 600, 1080, 600, 1080, 600, 1050, 720, 1
WHERE NOT EXISTS (SELECT 1 FROM shift_patterns);
