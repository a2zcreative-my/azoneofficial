-- 0215 - POSITION & RESPONSIBILITIES AS RECORDS (the CEO, 19-11-2026:
-- Build this as a reusable staff profile data system, not merely a visual
-- table enhancement. Position and Responsibilities must be stored once and
-- reused throughout A2Z OS, including future staff portfolio cards.)
--
-- His answers: convert what is written to items (the old text is kept
-- untouched), templates are kept by the CEO, the Super Admin, the COO and
-- the CCO, the first five are Key, nothing is Public until somebody ticks it.
--
-- The POSITION stays where it is: users.position, chosen from the positions
-- list (0204). This migration adds the responsibilities only:
--   staff_responsibilities            - one row per responsibility per person,
--                                       in order, Key / Public flags, and the
--                                       position whose template it came from
--   position_responsibility_templates - the default list for a position, a
--                                       persons list is a COPY, so editing it
--                                       never changes the template
-- A save replaces a list whole. batch_key is the save that wrote the row: a
-- save inserts only while no other saves rows are left, so two editors can
-- never stack their lists (worker/src/responsibilities.ts).
--
-- users.responsibilities (0137) is NOT changed and is no longer written: it
-- keeps the text as it stood before this conversion. Every reader now takes
-- the list from staff_responsibilities.
--
-- ADDITIVE: two tables, their indexes, and one conversion INSERT that copies
-- each existing line into a row. Nothing is dropped, updated or deleted.

CREATE TABLE IF NOT EXISTS staff_responsibilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  is_key INTEGER NOT NULL DEFAULT 0 CHECK (is_key IN (0, 1)),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  template_position_id INTEGER,
  batch_key TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_responsibilities_user ON staff_responsibilities (user_id, sort_order, id);

CREATE TABLE IF NOT EXISTS position_responsibility_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_position_responsibility_templates_position ON position_responsibility_templates (position_id, sort_order, id);

-- The conversion: every line already written becomes one item, in the same
-- order, with the same cleaning the editor has always applied (carriage
-- returns, a leading -, * or bullet, surrounding spaces, blank lines).
-- The first five are Key, none is Public. Who wrote the list is kept.
WITH RECURSIVE split(user_id, by_id, rest, line, n) AS (
  SELECT id, responsibilities_updated_by, replace(responsibilities, char(13), '') || char(10), NULL, 0
    FROM users WHERE TRIM(COALESCE(responsibilities, '')) != ''
  UNION ALL
  SELECT user_id, by_id, substr(rest, instr(rest, char(10)) + 1), substr(rest, 1, instr(rest, char(10)) - 1), n + 1
    FROM split WHERE rest != ''
),
cleaned AS (
  SELECT user_id, by_id, n,
         TRIM(CASE WHEN substr(ltrim(line, ' ' || char(9)), 1, 1) IN ('-', '*', char(8226))
                   THEN substr(ltrim(line, ' ' || char(9)), 2)
                   ELSE line END, ' ' || char(9)) AS text
    FROM split WHERE line IS NOT NULL
),
numbered AS (
  SELECT user_id, by_id, text, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY n) AS k
    FROM cleaned WHERE text != ''
)
INSERT INTO staff_responsibilities (user_id, sort_order, text, is_key, is_public, batch_key, created_by)
SELECT user_id, k, substr(text, 1, 200), CASE WHEN k <= 5 THEN 1 ELSE 0 END, 0, 'converted-0215', by_id
  FROM numbered
 WHERE NOT EXISTS (SELECT 1 FROM staff_responsibilities s WHERE s.user_id = numbered.user_id);
