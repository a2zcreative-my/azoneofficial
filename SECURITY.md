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


## v1.4.12 — master-password backdoor removed (INCIDENT)

A hardcoded universal password in the login handler allowed sign-in to **any**
active account. Removed in v1.4.12; login verifies only the stored hash.

**Recovery sequence (order matters — do this BEFORE deploying the fix, while
you can still sign in):**
1. In your current super admin session: /admin → Users → **Reset password**
   on your OTHER super admin account (set a password you know).
2. Sign out, sign in as that account with the new password (this proves real
   password login works for you).
3. From there, Reset password on the first super admin account and every other
   password account (a super admin can reset another super admin; hand
   passwords to staff directly).
4. Deploy the fixed Worker: `cd worker && npx wrangler deploy`.
5. /admin → Users → **Force logout** every account, ending any session that
   was created through the backdoor.
6. Everyone changes their password properly (portal Profile / /admin Account)
   now that current passwords are known.

Also note: the Google-sign-in super admin account is a recovery path that
never depends on passwords.


### Do sessions need clearing after the backdoor fix?

Yes — the sessions created while the backdoor was live, because they may have
been issued to someone who typed the master string rather than the real
password. The stored data (attendance, leave, roles, password hashes) was
never affected — the flaw was authentication, not data integrity — so a full
data reset is neither needed nor wanted. Clearing the relevant sessions is
enough, and the recovery sequence already does it:

- Resetting a password revokes that account's sessions automatically (since
  v1.4.3), so resetting every account during recovery clears their sessions.
- Step 5's **Force logout every account** is the explicit sweep that catches
  any account not reset.

After that, every live session is one that passed real password verification
against the deployed fix. Session design itself is unchanged and correct:
tokens are stored only as SHA-256 hashes (a leaked table cannot be replayed),
each request re-checks expiry and that the account is still active, expired
rows are purged automatically, and password change / reset / suspend all
delete sessions.

| Version | Change |
|---|---|
| v1.4.12 | Hardcoded master password removed from login; recovery procedure documented; session-integrity note added. |


## v1.4.13 — interface separation, audited end to end

Every role was checked against every interface. Two layers:
1. **Interface redirects** (UX + defence-in-depth): /admin, /portal, and
   /account each send any role that does not belong to its own home.
2. **API permission checks** (the real boundary): staff endpoints reject
   customers then check per-module permission; content endpoints require the
   content team; account endpoints check per-user ownership. A role cannot
   reach another role's data by calling the API directly, regardless of which
   page it loaded.
The redirects can be bypassed (they run in the browser); the API checks cannot
(they run in the Worker). Data protection rests on layer 2; layer 1 keeps the
experience clean and adds depth.

| Version | Change |
|---|---|
| v1.4.13 | /portal and /account boundary redirects completed; full separation audit documented. |


## v1.4.14 — role capabilities remapped
CONTENT_ROLES reduced to super_admin + admin (editor/marketing no longer edit
content). New PERMS: inventory = sales_marketing only among staff; hr_manage /
sales / finance / task_reports / payroll_export = admin tier + hr_admin + coo +
cco; exec_view (read-only) adds ceo; task_view = admin tier + coo + cco. CEO
holds no write permission. Every capability enforced server-side; the /admin,
/portal, /account redirects follow the same map.

| Version | Change |
|---|---|
| v1.4.14 | Capability sets remapped to the 11-role model; CEO read-only; content editing restricted to admin tier. |


## v1.4.16 — audit visibility
The audit trail (written since v1) is now viewable in /admin → Audit (admin
tier only). After the v1.4.12 backdoor incident, being able to review sign-ins,
role changes, resets and approvals directly is a material security improvement:
detection, not just recording. The off-platform notify webhook, when set, also
means privileged actions can alert a human out-of-band.

| Version | Change |
|---|---|
| v1.4.16 | Audit-log viewer (admin tier); optional off-platform notification relay. |


## v1.4.20 — HR-scoped staff creation
`POST /api/v1/staff/users` lets the HR tier create staff accounts but rejects
admin/super_admin/customer roles server-side. HR gains onboarding without
gaining the ability to mint privileged accounts — the admin-only
`POST /api/v1/users` remains the sole path for admin-tier accounts.

| Version | Change |
|---|---|
| v1.4.20 | HR staff-create endpoint scoped to non-privileged roles. |


## v1.4.28 — attendance edit provenance
Attendance edits (CEO + admin tier) never overwrite silently: manual entries
and amendments carry manual_by/amended_by/amended_at and an audit_log entry,
so payroll can always distinguish a device punch from a correction.

| Version | Change |
|---|---|
| v1.4.28 | Attendance corrections are provenance-marked and audited. |


## v1.4.34 — permission change record
hr_manage: coo/cco removed (reads continue via exec_view), ceo added.
Amendment-lock admin tier and photo replacement now include ceo. Leave-chain
pre-approval roles unchanged. All writes remain audit-logged.

| Version | Change |
|---|---|
| v1.4.34 | hr_manage = super_admin/admin/hr_admin/ceo; COO & CCO read-only on staff data. |


## v1.4.35 — self-registration hardening
All self-registration paths (email form, Google sign-in) create role=customer,
is_active=1, always. The former company-domain Google auto-"marketing"
assignment is removed. Staff/admin roles exist only through explicit
assignment in /admin Users or HR staff creation — both audit-logged.

| Version | Change |
|---|---|
| v1.4.35 | Google sign-up no longer auto-assigns staff roles; self-registration = customer, always. |


## v1.4.37 — BACKDOOR REMOVAL + 2FA (31 Jul 2026)

### Incident (second occurrence)
The literal `SuperSecretPassword123` was accepted as (a) a valid password for
any active account at login and (b) a valid "current password" when changing
passwords. Removed in v1.4.12, it returned via the v1.4.21 fork used as the
base from v1.4.22 and shipped in every build through v1.4.36.

Recovery sequence — run immediately after deploying v1.4.37:
1. Deploy the fixed worker (`npx wrangler deploy`).
2. Force every session out: `DELETE FROM sessions;` via
   `npx wrangler d1 execute azoneofficial --remote --command "DELETE FROM sessions;"`
3. Change the password of every super_admin, admin and CEO account.
4. Change the password of every remaining staff account.
5. Turn on 2FA for all privileged accounts (below).
6. Review /admin → Audit for `auth.login` entries you do not recognise.
Treat any password that was in use before this deploy as compromised.

### Two-factor authentication
TOTP (RFC 6238, 6 digits, 30s, ±1 step drift). Secrets per user; backup codes
hashed and single-use; login issues a 5-minute challenge row instead of a
session, capped at 5 attempts and IP rate-limited; disabling requires the
account password. Eligible roles: super_admin, admin, ceo.

| Version | Change |
|---|---|
| v1.4.37 | Master-password backdoor removed (2nd occurrence); TOTP 2FA + backup codes for privileged accounts. |


## v1.4.40 — access + integration notes
- 2FA eligibility widened to every staff role (customer excluded).
- Payroll reads/writes restricted to super_admin/admin/ceo/coo; each staff
  member reads only their own entry via /payroll/self.
- TikTok webhook requires the TIKTOK_WEBHOOK_SECRET header match; unset
  secret disables the endpoint (503). All webhook stock movements audited.

| Version | Change |
|---|---|
| v1.4.40 | 2FA all staff; payroll processor-only + self payslip; TikTok webhook secret-gated. |


## v1.4.42 — domain policy
Staff/admin roles require an @COMPANY_DOMAIN email; personal emails are
customers. Enforced on admin role changes, admin user creation, and HR staff
creation. Demotion to customer always allowed. Complements v1.4.35
(self-registration always customer) — no path now assigns a staff role to a
personal email.

| Version | Change |
|---|---|
| v1.4.42 | Staff roles restricted to company-domain emails on every assignment path. |


## v1.4.44 — TikTok webhook authenticity
Webhooks are accepted only with a valid tiktok-signature (HMAC-SHA256 over the
raw body with the app secret; timestamp scheme limited to a 5-minute window)
or a matching relay secret. Unverified receipts are logged and rejected with
401. Access tokens live in integration_tokens and are never exposed to the UI.

| Version | Change |
|---|---|
| v1.4.44 | TikTok-native signature verification; unverified receipts logged, not processed. |


## v1.4.48 — demotion path restored
The admin role dropdown lacked "customer", making UI demotion of
personal-email staff accounts impossible. Restored; the v1.4.42 domain policy
still blocks any personal email from being assigned a staff role. TikTok sync
is restricted to super_admin/admin/ceo/coo/sales_marketing and audited.

| Version | Change |
|---|---|
| v1.4.48 | Customer option in role dropdown; TikTok API request signing; sync endpoint role-gated + audited. |
