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
- Self-registration: open to any valid email but always created **inactive** — password registration cannot prove mailbox ownership, so a super admin must approve. Google-verified company-domain accounts auto-activate; this is safe because Google attests email ownership.

## Reporting
Security concerns: contact the team via the address in constants/content.ts.
