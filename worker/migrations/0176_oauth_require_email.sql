-- 1.267.0 Secure Authentication 2.0 - Connect Google for a password customer
-- while email sending is not set up - the CEO approved 05-11-2026 (Proceed)
--
-- Additive only. A Connect Google request may name the exact address the
-- Google account must prove - the account own address on a Google hosted
-- mailbox. The callback links only when the ID token carries that address
-- as verified. NULL on every existing row - no existing row changes.
ALTER TABLE oauth_requests ADD COLUMN require_email TEXT;
