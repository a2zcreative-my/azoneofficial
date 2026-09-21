-- 0137 - roles and responsibilities: what each working staff member is
-- answerable for, written by the CEO or the HR tier on the Staff tab and
-- read by the person on their Profile.
--
-- The CEO, 21-09-2026, asked for Roles and Responsibilities on the Staff tab
-- for the staff currently working for him, editable by him there.
--
-- Four columns on users, nothing else. role_title is the one-line title
-- (for example Sales Executive - ELFIA accounts). responsibilities is the
-- list, one per line. The last two say who wrote it and when, so the card
-- can show the author and the date and the audit log has a row to match.
--
-- Additive only: no DROP, no rewrite, no default that invents a value. A
-- portal that deploys before this applies keeps working (worker/src/staff.ts
-- GET /users has its own migration-skew rung for these columns).

ALTER TABLE users ADD COLUMN role_title TEXT;
ALTER TABLE users ADD COLUMN responsibilities TEXT;
ALTER TABLE users ADD COLUMN responsibilities_updated_at TEXT;
ALTER TABLE users ADD COLUMN responsibilities_updated_by INTEGER;
