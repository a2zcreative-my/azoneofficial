# MILESTONES.md

Complete milestone log for AZ ONE OFFICIAL — every version, decision, and asset from project inception to now. Companion to CHANGELOG.md (which records granular changes); this document tells the story and preserves context.

---

## Timeline

| Version | Date | Milestone |
|---|---|---|
| v0.1.0 | earlier | Baseline: Next.js scaffold, coming-soon page, first Cloudflare Pages deploy |
| v0.2.0 | 24 Jul 2026 | Full landing page: Hero, About + stats, Services, Showcase, ELFIA, Process, FAQ, CTA. Real contact data from Master Prompt applied |
| v0.3.0 | 24 Jul 2026 | Full public site (Phase 2): 10 additional pages, SEO layer, brand assets |
| v0.4.0 | 24 Jul 2026 | ELFIA product photos (9) integrated; brand copy corrected to premium hijabs/shawls; Phase 3 architecture decided (static site + separate admin Worker) |
| v0.5.0 | 24 Jul 2026 | Phase 3 API + admin CMS v0: auth, RBAC, CRUD, contact form storing enquiries, /admin UI |
| v0.6.0 | 24 Jul 2026 | Admin Media/Content/Users screens; dashboard activity feed; ELFIA product detail pages; public D1 reads for portfolio + testimonials |
| v0.7.0 | 24 Jul 2026 | Google OAuth sign-in for /admin; self-registration; email → admin@azoneofficial.com |
| v0.8.0 | 24 Jul 2026 | UI/UX redesign pass — WCAG AA contrast, 8px spacing grid, consistent radius system, focus rings; design principles recorded |
| v0.9.0 | 24 Jul 2026 | No-code content editing wired end-to-end (hero, about, CTA, footer, contact intro); Cloudflare Web Analytics beacon |
| v1.0.0 | 24 Jul 2026 | **Staff Portal (BMS) v1**: attendance, leave, tasks, announcements, CRM, QT/DO/INV with auto-numbering, notifications, light/dark mode |
| v1.1.0 | 24 Jul 2026 | **General login & role-routed access**: /login is one door for everyone; customer role added; /account for customers |
| v1.1.1 | 24 Jul 2026 | Official social handles confirmed and applied site-wide: @azoneofficialhq |
| v1.2.0 | 24 Jul 2026 | **Security audit & hardening**: zero-hardcoded super admin bootstrap, SHA-256 session tokens, private R2 prefix, static security headers |
| v1.2.1 | 24 Jul 2026 | Login UX fixes: honest error messages, show/hide password eye toggle, live character counter |
| v1.2.2 | 24 Jul 2026 | Configuration discipline: zero credentials or IDs in source; all values in Cloudflare dashboard/secrets |
| v1.2.3 | 24 Jul 2026 | OG share preview redesigned + new square variant for WhatsApp centre-crop |
| v1.2.4 | 24 Jul 2026 | /login mode switcher moved to persistent top tabs (Sign in / Create account) |
| v1.2.5 | 24 Jul 2026 | Official corporate OG design (cream/navy/gold curves) + brand tagline "Live . Connect . Grow." wired site-wide |

---

## Assets shipped

### Branding
- `public/logo.png` — official AZ ONE OFFICIAL wordmark, navy on transparent (navbar, /login)
- `public/logo-white.png` — same wordmark inverted for dark/navy backgrounds (footer, ELFIA section)
- `app/favicon.ico` + `app/icon.png` — browser tab icon, generated from the logo mark
- `public/og.png` (1200×630) — social share preview for Facebook/LinkedIn/Twitter
- `public/og-square.png` (1080×1080) — square social share preview for WhatsApp mobile crop

### ELFIA product photography (`public/elfia/`)
Nine web-optimised images (all under 150KB) across three categories:
- Everyday: `shawl-taupe.jpg`, `shawl-beige.jpg`, `shawl-grey-front.jpg` (+ 3-angle gallery: `shawl-grey.jpg`, `shawl-grey-profile.jpg`, `shawl-grey-back.jpg`)
- Workwear: `corporate.jpg` (blush hijab)
- Active: `active.jpg` (black sports hijab)
- Collection: `collection.jpg` (four-colour group shot)

---

## Key decisions recorded

### Architecture (v0.4.0)
Chose static public site + separate admin/API Worker over full Workers migration. Rationale: smaller blast radius (public site can never be taken down by a CMS bug), zero attack surface for the marketing site, cheaper hosting.

### Password model (v0.7.0, refined v1.1.0)
PBKDF2-SHA256 @ 310k iterations with per-user salt + server pepper. Documented deviation from argon2id (no native argon2 on Workers). All password endpoints require 10+ characters (harmonised in v1.2.1).

### Registration policy (v1.1.0)
Public registration creates an ACTIVE customer account with instant sign-in. Safe by design: the customer role can access only its own data and is blocked from all /staff routes and every CMS permission. Staff/admin roles can only be granted by a super admin. Google-verified company-domain sign-ins create staff-side accounts.

### Login model (v1.1.0)
One `/login` for everyone. After sign-in, users route by role: customer → /account, staff-only roles → /portal, CMS roles → /admin. Rejected: separate /admin and /login screens (confusing, and admin-only signup encourages hardcoded credentials).

### Super admin bootstrap (v1.2.0)
One-time POST /auth/setup guarded by SETUP_TOKEN secret with timing-safe comparison. Self-disables permanently once any super admin exists. No credentials in code.

### Configuration discipline (v1.2.2)
Zero values in source. `wrangler.toml` lists only variable names with instructions. All values (including GOOGLE_CLIENT_ID as a plaintext variable) live in the Cloudflare dashboard or as secrets. `.dev.vars` for local development, git-ignored. Repo is safe to publish without leaking any operational value.

### Design principles (v0.8.0)
Premium corporate: modern, minimal, elegant, professional, clean, trustworthy, mobile-first. 8px spacing grid, max two font families (currently one: Poppins), WCAG 2.1 AA contrast (deep gold #7D6027 for accent text on light; brand gold #C8A96A only decorative or on navy), navy focus outlines, consistent 8px radius, subtle shadows, generous whitespace. Every page must answer: What is this? Why trust it? What should I do next?

### RBAC model (v1.0.0, v1.1.0)
Eleven roles ranked into a permission hierarchy:
- Super Admin, Admin, Editor, Marketing (CMS side)
- Managing Director, COO, Business Development, Finance & Admin, Live Manager, Live Host (operational)
- Customer (public)

Live Hosts cannot reach finance, CMS, or admin. Customers cannot reach staff or CMS. Enforced server-side on every route.

---

## Pending decisions (owner: Alīf)

- Real statistics for About section (currently placeholder 500+/12/3x) or remove the stats block
- ELFIA on-site pricing (currently "announced live" — decide RM display per product)
- Legal review of Privacy Policy and Terms
- Outbound email service choice (unlocks forgot-password and email-verified registration)
- Bahasa Melayu language toggle for the public site

---

## Deployment status

**As of 24 Jul 2026**: Build v1.2.3 complete in the zip. Live production still on v0.1.0 (verified via public fetch — the coming-soon page). Deploy checklist in `DEPLOYMENT.md` and the tracking `azone-website-tasks.md`.
