-- 0101 - v1.78.0: a day worked on a rest day, credited back as leave.
--
-- The CEO, 31-08-2026:
--   "in Staff table should appear a list of replacement leave for the staff
--    that working on weekend which is for me to credit the replacement leave
--    either half day or full day depend on their in and out time."
--
-- Replacement leave already existed as a leave TYPE, and could only ever be
-- TAKEN. The entitlement editor refuses it in as many words - "Unpaid and
-- replacement leave are counted as taken, not granted" - so there was no way
-- to GRANT the day somebody earned by working a Saturday. Staff worked rest
-- days and the balance they were owed lived in somebody memory.
--
-- The credit itself is added to leave_balances.adjust for the replacement
-- type, which is the CEO-only lever that already exists and is already
-- audited. THIS table is the receipt: which rest day was credited,
-- for how much, by whom. Without it the same Saturday could be credited
-- twice and nothing would say so - the balance would simply be a day too
-- high, which is the kind of error nobody finds until somebody takes a day
-- they were not owed.
--
-- ONE ROW PER PERSON PER DATE. The UNIQUE index is the rule, not a hint:
-- crediting is a button, buttons get pressed twice, and a double tap on a
-- slow connection must cost the company nothing.
--
-- Fully replayable - every statement IF NOT EXISTS (audit B4).

CREATE TABLE IF NOT EXISTS replacement_credits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  -- The rest day that was worked, YYYY-MM-DD in Malaysia time.
  work_date    TEXT    NOT NULL,
  -- 0.5 or 1.0. REAL, like leave_requests.days, so half days are real days
  -- and not a rounding somebody has to remember.
  days         REAL    NOT NULL,
  -- Minutes actually clocked that day, kept as the evidence the decision was
  -- made on. A question three months later about why a day was credited as
  -- half is answerable without reconstructing the attendance table.
  minutes      INTEGER,
  credited_by  INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_credits_once
  ON replacement_credits (user_id, work_date);
