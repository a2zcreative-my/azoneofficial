-- 0113 - v1.101.0: who each person reports to.
--
-- The CEO, 05-09-2026:
--   I want to add infographic for each staff reported to who which is either
--   CEO, COO or CCO. I will assigned by myself and organized it based on who
--   is their HOD to make it like organisation.
--
-- ONE COLUMN, NOT THREE. The obvious reading is a tag on each person saying
-- CEO or COO or CCO, and it is the wrong shape: it can only ever draw a chart
-- two levels deep, so the day a supervisor has their own people the chart
-- cannot say so. reports_to points at ANOTHER PERSON, so the same column
-- carries the whole tree - the COO reports to the CEO, an HOD reports to the
-- COO, their team reports to the HOD - and the division a person sits in is
-- read by walking up the line rather than stored a second time and left to
-- drift. NULL means not assigned yet, which on day one is everyone.
--
-- THE REFERENCE IS NOT A CONSTRAINT ON PURPOSE. SQLite in D1 does not enforce
-- foreign keys by default, and a manager row is never deleted here anyway -
-- people are offboarded, not removed - so this is documentation for whoever
-- reads the schema. The worker is what refuses a manager who does not exist,
-- a person reporting to themselves, and any assignment that would close a
-- loop. A loop is the one failure that matters: a chart is drawn by walking
-- up, and a cycle walks forever.
--
-- WHO SETS IT: the CEO, the COO and the CCO - org_assign in
-- worker/src/permissions.ts. Not hr_admin, and not admin: a reporting line is
-- a statement about how the company is run, not a data-entry field. Every
-- change is written to audit_log with both names.

ALTER TABLE users ADD COLUMN reports_to INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_reports_to ON users(reports_to);
