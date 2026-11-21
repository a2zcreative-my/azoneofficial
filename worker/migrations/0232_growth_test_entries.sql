-- 0232 - A TEST GROWTH CHECK ENTRY, MARKED BY THE CEO (21-11-2026, his answer Mark as test).
-- An enquiry is never deleted (0211 trigger growth_enquiries_no_delete keeps the consent record).
-- The CEO may mark one as a test entry with a reason: it is closed (status not_interested), leaves the
-- Action Center, the Desk, the Growth list and every figure, and keeps its record and history.
-- test_marked_at is the mark (NULL = a real enquiry), with who marked it and why.
-- ADDITIVE ONLY: three nullable columns. No existing row is changed.
ALTER TABLE business_growth_enquiries ADD COLUMN test_marked_at TEXT;
ALTER TABLE business_growth_enquiries ADD COLUMN test_marked_by INTEGER REFERENCES users (id);
ALTER TABLE business_growth_enquiries ADD COLUMN test_reason TEXT;
