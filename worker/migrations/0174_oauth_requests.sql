-- 1.265.0 Secure Authentication 2.0 Phase 1b - Google OpenID Connect
-- claude/AUTH-2.0-AUDIT.md revision 3 sec. 3.2 and 3.3 - approved by phase
--
-- Additive only. One row per Google sign-in or Connect Google request.
-- The state is stored only as its SHA-256 and the binding cookie likewise.
-- The nonce and the PKCE verifier live here and never in the browser.
-- A row is single use - used_at is set once and a second callback with the
-- same state is refused. Rows expire after ten minutes and are removed a day
-- later by the next request. No existing row of any table is changed.
CREATE TABLE IF NOT EXISTS oauth_requests (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'connect')),
  binding_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  user_id INTEGER,
  session_hash TEXT,
  return_to TEXT CHECK (return_to IS NULL OR return_to IN ('portal', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_requests_expires ON oauth_requests (expires_at);
