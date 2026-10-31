-- 0155: Account identity, login email changes and recovery links
-- (v1.238.0, the owner brief CEO ACCOUNT MANAGEMENT, LOGIN RECOVERY AND
-- SYSTEM RELIABILITY, 31-10-2026, claude/ACCOUNT-RECOVERY-AUDIT.md, answer:
-- Approve migration 0155). Additive only: new columns default to NULL and
-- new tables start empty. No existing row is changed.
--
-- users.google_sub - the permanent Google account id (OpenID sub). Google
-- sign-in finds the account by this first and never by a typed email.
-- users.email_verified_at - when the login email was last proven.
-- sessions.user_agent and last_seen_at - the device list on the account.
-- email_changes - a requested login email change, pending until verified.
-- account_tokens - one-time set-password links, stored only as a hash.

ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

CREATE TABLE IF NOT EXISTS email_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('email', 'google', 'in_person')),
  token_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled', 'expired')),
  needs_second INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER,
  approved_at TEXT,
  identity_checked_by TEXT,
  requested_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_changes_user ON email_changes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_email_changes_new ON email_changes(new_email, status);

CREATE TABLE IF NOT EXISTS account_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('set_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, kind);
