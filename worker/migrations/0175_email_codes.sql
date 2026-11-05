-- 1.266.0 Secure Authentication 2.0 Phase 1c - customers and Google
-- claude/AUTH-2.0-AUDIT.md revision 3 sec. 3.3 and 3.4 and 6 - approved by phase
--
-- Additive only. A six digit code emailed to a customer before Google is
-- connected to or disconnected from their account. It proves the mailbox
-- together with their password. Only a keyed hash of the code is stored.
-- A code is bound to the session that asked for it, works for ten minutes,
-- allows five tries and is used once. No existing row of any table changes.
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('google_connect', 'google_disconnect')),
  code_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_codes (user_id, purpose);
