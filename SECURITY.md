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

### Known limitations (tracked in ROADMAP.md)
- No email verification for password registrations (limits above mitigate; verification needs an outbound email service)
- No strict Content-Security-Policy yet (Next.js inline runtime; revisit with nonce-based CSP)
- SESSION_PEPPER / SETUP_TOKEN / GOOGLE_CLIENT_SECRET live only in Cloudflare secrets — never commit them
