-- 0217 - THE NAME ON A PORTFOLIO (the CEO, 19-11-2026: I want to have a function to change
-- their name to nickname instead).
-- A portfolio may show a short name or nickname on the card and the public page. The staff
-- record keeps the full name - users is not altered and never written from a portfolio.
-- Empty means the full name from the staff record, exactly as before.
-- ADDITIVE ONLY: one nullable column on staff_portfolios.
ALTER TABLE staff_portfolios ADD COLUMN display_name TEXT;
