-- 0014: Manual attendance entries & amendments (v1.4.28)
--
-- The CEO (and admin tier) can add clock in/out records for days before the
-- system existed, and amend wrong punches. These columns keep the trail
-- honest: a record either came from a real punch (both NULL) or names who
-- created/changed it and when.

ALTER TABLE attendance_records ADD COLUMN manual_by INTEGER REFERENCES users(id);
ALTER TABLE attendance_records ADD COLUMN amended_by INTEGER REFERENCES users(id);
ALTER TABLE attendance_records ADD COLUMN amended_at TEXT;
