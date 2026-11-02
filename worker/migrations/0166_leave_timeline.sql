-- 0166 - The leave approval timeline, release 1.252.0.
-- The owner approved claude/LEAVE-TIMELINE-AUDIT.md on 02-11-2026 with three
-- answers - add Returned for more information, a comment thread with
-- internal and employee notes, and notify the next approver.
-- Additive only. Every existing leave row is kept exactly as it is and reads
-- NULL in the new columns - no history is invented for the past.
-- cancelled_at and cancelled_by record a withdrawal, which kept no time
-- before. returned_from, returned_by, returned_at and return_question record
-- the last time an approver sent the request back with a question. The
-- request keeps status pending and stage returned while it is with the
-- applicant, and goes back to returned_from when it is resubmitted.
-- leave_comments is the thread on one leave, append-only. visibility is
-- employee (the applicant and management read it) or internal (management
-- only). It has no foreign key so that removing a leave record never
-- erases what was said about it.
ALTER TABLE leave_requests ADD COLUMN cancelled_at TEXT;
ALTER TABLE leave_requests ADD COLUMN cancelled_by INTEGER;
ALTER TABLE leave_requests ADD COLUMN returned_from TEXT;
ALTER TABLE leave_requests ADD COLUMN returned_by INTEGER;
ALTER TABLE leave_requests ADD COLUMN returned_at TEXT;
ALTER TABLE leave_requests ADD COLUMN return_question TEXT;
CREATE TABLE IF NOT EXISTS leave_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_id    INTEGER NOT NULL,
  author_id   INTEGER NOT NULL,
  visibility  TEXT    NOT NULL DEFAULT 'internal' CHECK (visibility IN ('employee', 'internal')),
  body        TEXT    NOT NULL,
  client_key  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_comments_leave ON leave_comments (leave_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_leave_comments_key ON leave_comments (author_id, client_key) WHERE client_key IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS leave_comments_no_update BEFORE UPDATE ON leave_comments
BEGIN SELECT RAISE(ABORT, 'leave comments are kept as they were'); END;
CREATE TRIGGER IF NOT EXISTS leave_comments_no_delete BEFORE DELETE ON leave_comments
BEGIN SELECT RAISE(ABORT, 'leave comments are kept as they were'); END;
