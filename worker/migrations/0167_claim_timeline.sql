-- 0167 - The claim approval and payment timeline, release 1.254.0.
-- The owner approved claude/CLAIMS-TIMELINE-AUDIT.md on 02-11-2026 with
-- three answers - add Return for info, a comment thread with internal and
-- employee notes, and the actual bank date when a claim is marked paid.
-- Additive only. Every existing claim is kept exactly as it is and reads NULL
-- in the new columns - no history is invented for the past.
-- returned_from, returned_by, returned_at and return_question record the last
-- time an approver sent the claim back with a question. The claim keeps
-- status pending. return_answered_at is set when the claimant answers, and
-- the claim goes back to the stage it left. An open return is one with
-- returned_at set and return_answered_at empty.
-- The bank date of a payment is not stored here. It is the effective date of
-- the one cash book row of the claim, which is the payout record.
-- claim_comments is the thread on one claim, append-only. visibility is
-- employee (the claimant, the payee and management read it) or internal
-- (management only). It has no foreign key so that removing a claim never
-- erases what was said about it.
ALTER TABLE claims ADD COLUMN returned_from TEXT;
ALTER TABLE claims ADD COLUMN returned_by INTEGER;
ALTER TABLE claims ADD COLUMN returned_at TEXT;
ALTER TABLE claims ADD COLUMN return_question TEXT;
ALTER TABLE claims ADD COLUMN return_answered_at TEXT;
CREATE TABLE IF NOT EXISTS claim_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id    INTEGER NOT NULL,
  author_id   INTEGER NOT NULL,
  visibility  TEXT    NOT NULL DEFAULT 'internal' CHECK (visibility IN ('employee', 'internal')),
  body        TEXT    NOT NULL,
  client_key  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claim_comments_claim ON claim_comments (claim_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_claim_comments_key ON claim_comments (author_id, client_key) WHERE client_key IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS claim_comments_no_update BEFORE UPDATE ON claim_comments
BEGIN SELECT RAISE(ABORT, 'claim comments are kept as they were'); END;
CREATE TRIGGER IF NOT EXISTS claim_comments_no_delete BEFORE DELETE ON claim_comments
BEGIN SELECT RAISE(ABORT, 'claim comments are kept as they were'); END;
