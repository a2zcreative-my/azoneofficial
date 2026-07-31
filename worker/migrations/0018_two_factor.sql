-- 0018: Two-factor authentication (v1.4.37)
--
-- TOTP (Google Authenticator / Authy compatible) for privileged accounts.
-- The secret is stored per user; backup codes are stored HASHED (single use).
-- A login that passes the password but needs a code gets a short-lived
-- challenge row instead of a session — no session exists until the code is
-- verified.

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS twofa_backup_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_user ON twofa_backup_codes (user_id);

CREATE TABLE IF NOT EXISTS twofa_challenges (
  id TEXT PRIMARY KEY,               -- sha256 of the challenge token
  user_id INTEGER NOT NULL REFERENCES users(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
