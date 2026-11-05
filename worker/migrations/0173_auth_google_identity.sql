-- 0173 - Secure Authentication 2.0, Phase 1a (claude/AUTH-2.0-AUDIT.md revision 3,
-- the CEO approved by phase on 05-11-2026). Additive only - no existing row,
-- password, authenticator secret, backup code, session or Google link changes.
-- auth_assert is a guard table that is always empty between batches. An identity
-- change - a Google link, a login email change, a sign-in challenge used - is
-- written in one batch with an assertion row after each step. The row may only
-- be written when the step really changed exactly what it should, otherwise the
-- NOT NULL and CHECK rules abort the batch and D1 rolls every statement back.
-- An UPDATE that matched no row can therefore never be taken for a success.
-- twofa_challenges gains the identity a Google sign-in is waiting to attach -
-- pending_google_sub and pending_change_id - so nothing is linked or changed
-- until the authenticator code is accepted. An abandoned or failed challenge
-- expires in five minutes and attaches nothing.
CREATE TABLE IF NOT EXISTS auth_assert (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
ALTER TABLE twofa_challenges ADD COLUMN pending_google_sub TEXT;
ALTER TABLE twofa_challenges ADD COLUMN pending_change_id INTEGER;
