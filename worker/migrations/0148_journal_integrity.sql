-- 0148 - Accounting 2.0: a journal reference is posted once.
-- The unique index covers entries written from 29 October 2026 onward only,
-- so the existing history is never checked or changed and this cannot fail
-- on old data. Older references keep their check by reference in the code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_ref_once ON journal_entries (ref) WHERE ref != '' AND created_at >= '2026-10-29';
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries (ref);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries (entry_date);
