-- 0218 - HOW THE NAME ON A PORTFOLIO IS LETTERED (the CEO, 19-11-2026: for the Nickname I should be
-- able to choose either caplock, or uncaplock).
-- upper = CAPITAL LETTERS, normal (or NULL, the default) = the name in normal letters, as before.
-- The staff record is not altered. 0217 is already applied, so this is its own migration.
-- ADDITIVE ONLY: one nullable column on staff_portfolios.
ALTER TABLE staff_portfolios ADD COLUMN name_case TEXT;
