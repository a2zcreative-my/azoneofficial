-- 1.269.0 Secure Authentication 2.0 Phase 2A - passkeys for the company owner
-- claude/AUTH-2.0-AUDIT.md revision 3 sec. 4 6 9 10 - the CEO approved 05-11-2026
-- Built switched OFF - auth_passkeys stage stays off until the owner turns it on.
--
-- Additive only. No existing row changes.
-- webauthn_credentials - one row per passkey - the public key only, never a
-- secret. A removed passkey stays as history with revoked_at set and can never
-- sign in again.
-- webauthn_challenges - a single use challenge for one ceremony - adding a
-- passkey bound to the session that asked, or signing in bound to the browser
-- by an HttpOnly cookie. Stored as given, five minutes, used once.
-- sessions gain auth_method and auth_credential_id - how a session began, so
-- a removed passkey can end the sessions it opened.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  aaguid TEXT,
  transports TEXT,
  backup_eligible INTEGER,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by INTEGER,
  revoked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credential_id ON webauthn_credentials (credential_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials (user_id);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  user_id INTEGER,
  session_hash TEXT,
  binding_hash TEXT,
  challenge TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
ALTER TABLE sessions ADD COLUMN auth_method TEXT;
ALTER TABLE sessions ADD COLUMN auth_credential_id INTEGER;
