# Security

## Current (static site)
- No server runtime, no database, no auth surface — attack surface is limited to static assets and third-party embeds (Google Maps iframe)
- No cookies set; no personal data collected by the site itself (leads arrive via WhatsApp/email)
- Dependencies pinned via pnpm-lock.yaml; update deliberately

## Phase 3 requirements (admin CMS)
- **Authentication**: email + password — PBKDF2-SHA256 @ 310k iterations with per-user salt + server pepper (documented deviation from argon2id: no native argon2 on Workers; revisit with a vetted wasm lib). Session tokens in HTTP-only, Secure, SameSite=Lax cookies; session table in D1 with expiry. IMPLEMENTED in worker/src/index.ts
- **Authorization**: RBAC enforced server-side on every API route — roles: super_admin, admin, editor, marketing (permissions matrix in ADMIN_GUIDE.md)
- **Input validation**: Zod schemas on every Worker endpoint
- **XSS**: no dangerouslySetInnerHTML for user content; sanitize rich text on write and render
- **CSRF**: same-site cookies + origin checks on mutating requests
- **SQL injection**: D1 prepared statements only — never string-built SQL
- **Rate limiting**: IMPLEMENTED — D1-backed fixed window: login 10 attempts/15 min/IP, enquiries 5/hour/IP (migration 0002). Consider upgrading to the native Workers rate-limiting binding at scale.
- **Audit logging**: every mutating admin action recorded in `audit_log`
- **Secrets**: only in Cloudflare environment bindings — never committed

## Authentication modes
- Password login (PBKDF2 + pepper, rate-limited)
- Google OAuth 2.0 (authorization code + state cookie; requires Google-verified email)
- Self-registration: open to any valid email and creates an ACTIVE **customer** account (immediate sign-in). Safe by design: the customer role can access only its own data (own enquiries by email match) and is blocked from all /staff routes and every CMS permission. Staff and admin roles can only be granted by a super admin. Google-verified company-domain sign-ins create staff-side accounts; other Google sign-ins create customer accounts.

## Reporting
Security concerns: contact the team via the address in constants/content.ts.

## Security audit — 2026-07-24 (v1.2.0)

### Verified safe
- SQL injection: every user-supplied value goes through D1 prepared statements; dynamic table/column names come only from server-side constant whitelists
- XSS: React auto-escaping everywhere; the only dangerouslySetInnerHTML is server-constant JSON-LD
- CSRF: SameSite=Lax HttpOnly Secure cookies + Origin verification on every mutating request
- RBAC: enforced server-side on every route; customers blocked from all /staff and CMS routes; Live Hosts cannot reach finance/CMS/admin; self-deactivation prevented
- Password login cannot be used against Google-only accounts (hash format mismatch fails closed)
- Brute force: rate limits on login (10/15min/IP), registration (5/h), enquiries (5/h), setup (5/h)
- Audit logging on every privileged mutation

### Fixed in this audit
- Session tokens now stored as SHA-256 hashes — a leaked sessions table cannot be replayed; expired sessions purged opportunistically
- Account enquiry history: password-registered (unverified) accounts see only enquiries submitted after registration, closing the register-a-stranger's-email history leak; Google-verified accounts get full history
- R2 keys under `private/` now require staff authentication (prepared for medical certificates and internal documents)
- Static site security headers via `public/_headers`: nosniff, frame-deny, strict referrer, locked permissions
- First super admin created via a one-time SETUP_TOKEN-protected bootstrap that self-disables — no credentials in code

### v1.2.1 follow-ups
- Password minimum harmonised to 10 characters everywhere (was inconsistently 12 in setup); login/register UI now shows the true reason on validation errors instead of blaming length.

### Configuration discipline
- Zero credentials, IDs, tokens, or environment values live in source. `wrangler.toml` lists only variable NAMES with instructions to set them in the Cloudflare dashboard or via `wrangler secret put`. Local development reads from `.dev.vars` (git-ignored). The repo is safe to publish or share without leaking any operational value.

### Known limitations (tracked in ROADMAP.md)
- No email verification for password registrations (limits above mitigate; verification needs an outbound email service)
- No strict Content-Security-Policy yet (Next.js inline runtime; revisit with nonce-based CSP)
- SESSION_PEPPER / SETUP_TOKEN / GOOGLE_CLIENT_SECRET live only in Cloudflare secrets — never commit them


## v1.4.3 — account control additions

- `POST /api/v1/auth/change-password`: requires the current password; minimum 10 characters; on success deletes **all** sessions for the user and re-issues one for the requesting browser, so credential rotation also evicts any stolen session. OAuth-only accounts (hash `oauth$google`) are refused — allowing a session holder to add a password would convert temporary access into permanent access.
- `POST /api/v1/users/:id/revoke-sessions` (admin+): immediate server-side session revocation ("force logout"), audit-logged with the revoked count.
- Role escalation guards, enforced in the Worker (not just hidden in the UI): `admin` cannot modify a `super_admin`, cannot create or grant `super_admin`, and cannot change their own role. Suspension (`is_active = 0`) both blocks login and deletes sessions.

## History (do not remove)
| Version | Change |
|---|---|
| v1.4.3 | Change-password endpoint with full session rotation; per-user force-logout endpoint; user management opened to `admin` behind server-side escalation guards. |


## v1.4.4 — role-module permissions

Every module endpoint is capability-checked in the Worker (`PERMS` in
staff.ts): task_reports (HR), inventory (sales & marketing + COO), bd_manage
(CCO), ops_manage (COO), exec_view (CEO + management, read-only). UI tabs are
convenience only — the API is the boundary. The CEO role intentionally has no
write permission on any module. Attendance flags (late / early out / weekend)
are computed server-side against the 10:00–18:00 MYT shift so they cannot be
suppressed client-side.

| Version | Change |
|---|---|
| v1.4.4 | Capability matrix extended for hr_admin, sales_marketing, cco, ceo; exec_view is read-only. |


## v1.4.9 — role/interface separation

Three enforcement layers keep staff roles out of content management:
1. Login router sends portal roles to /portal (list kept in sync with the role set).
2. /admin redirects any portal role to /portal before rendering.
3. The API guards every content endpoint with `isContentTeam` (explicit set:
   super_admin, admin, editor, marketing) rather than rank — so a staff role
   cannot reach content data even with direct API calls.
Layer 3 is the boundary; 1 and 2 are UX. Rank (`atLeast`) remains for
hierarchical checks (user management), set membership for lateral ones.

| Version | Change |
|---|---|
| v1.4.9 | Content endpoints moved from rank guards to explicit content-team set; /admin gate; login routing completed. |
