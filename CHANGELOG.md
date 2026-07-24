# Changelog

All notable changes to the AZ ONE OFFICIAL platform.

## [1.2.5] — 2026-07-24
### Added
- Official brand tagline "Live . Connect . Grow." — in constants/site.ts as SITE_CONFIG.brandTagline, displayed as gold uppercase eyebrow above the hero headline and beneath the footer logo; used in OG image alt text
- OG share images replaced with the official corporate design (cream + navy + gold curves) — landscape 1200×630 (public/og.png) and square 1080×1080 for WhatsApp (public/og-square.png)
### Note
- The descriptive tagline "Malaysia's Premium Live Commerce Agency" remains as the primary SEO/meta description; the brand tagline is used for identity moments (hero eyebrow, footer, share preview)

## [1.2.4] — 2026-07-24
### Changed
- /login: mode switcher moved to a persistent top-of-form Sign in / Create account tab pair (was a text link buried under the submit button). Both modes visible from arrival — clearer wayfinding, no more "New here?" line

## [1.2.3] — 2026-07-24
### Added
- `public/og.png` (1200×630) redesigned — logo enlarged, cleaner corporate layout, navy tagline, gold accent band
- `public/og-square.png` (1080×1080) new — square variant for WhatsApp centre-crop on mobile chat lists
- `MILESTONES.md` — comprehensive milestone log recording every version, asset, and decision from inception
- After deploy: use Facebook Sharing Debugger or WhatsApp's link cache reset (add ?v=2 once) to force social platforms to re-fetch

## [1.2.2] — 2026-07-24
### Changed
- Configuration discipline: no credentials or IDs in source. `wrangler.toml` now lists only variable names with instructions; all values (including GOOGLE_CLIENT_ID as a plaintext variable) live in the Cloudflare dashboard or as secrets. Added `.dev.vars.example` for local dev; `.dev.vars` is git-ignored.

## [1.2.1] — 2026-07-24
### Fixed
- Login/register error handling: 400s now show the API's real reason (was hidden as a misleading "password needs 10+ characters" for every failure); network/route-missing errors now say so plainly, so users can tell "not deployed yet" apart from "check your input"
- Password minimum harmonised to 10 characters everywhere (setup was inconsistently 12)
### Added
- Show/hide password eye toggle on login/register + live character counter with progress feedback (X of 10 — Y more needed) when registering
- Live length feedback on the admin Create User form

## [1.2.0] — 2026-07-24 — Security audit & hardening
### Added
- One-time super admin bootstrap: POST /auth/setup guarded by SETUP_TOKEN secret + timing-safe compare; self-disables once a super admin exists (no hardcoded credentials anywhere)
- Static security headers (public/_headers): nosniff, X-Frame-Options DENY, strict referrer, permissions policy
### Security
- Sessions stored as SHA-256 hashes (leak-resistant) with opportunistic expiry purge
- /account/enquiries: unverified accounts limited to post-registration enquiries (email-squatting history leak closed)
- R2 `private/` prefix requires staff auth
Full audit report in SECURITY.md.

## [1.1.1] — 2026-07-24
### Changed
- Official social handles confirmed and applied site-wide: TikTok/Instagram/Facebook → @azoneofficialhq (footer, contact page, ELFIA "Watch the next drop live" buttons)

## [1.1.0] — 2026-07-24 — General login & role-routed access
### Added
- General /login (one door for everyone) with role-based routing after sign-in: customer → /account, staff-only roles → /portal, CMS roles → /admin; Google callback routes the same way
- Customer role (migration 0004) + /account page: own details and enquiry history (matched by email); GET /api/v1/account/enquiries
- Public registration now creates an ACTIVE customer account and signs the person in immediately (safe: customers see only their own data; staff/admin roles are assigned only by super admins)
### Changed
- Navbar/footer point to /login; /admin and /portal redirect unauthenticated visitors to /login and customers to /account; customers blocked from all /staff API routes
### Removed
- Pending-approval registration flow (replaced by customer accounts); embedded login screen inside /admin

## [1.0.0] — 2026-07-24 — Staff Portal (BMS) v1
### Added
- Migration 0003: full BMS schema — expanded 10-role users (+staff profile fields), attendance, leave (+balances), announcements (+acks), tasks (+comments), customers, sales_documents with per-year auto numbering (QT/DO/INV 202600001), notifications
- Staff API (`/api/v1/staff/*`, worker/src/staff.ts) with module-level RBAC: profile, staff directory (HR), attendance clock in/out/break (IP+device captured) + monthly history + team report, leave apply/cancel/approve/reject with notifications and balance tracking, announcements + acknowledgements, tasks assign/progress/comments, CRM customers, QT/DO/INV creation with auto numbering + delivery/payment status, in-app notifications
- Staff Portal UI at /portal (noindexed, robots-blocked): personalized dashboard (quick actions clock in/out, pending leave, tasks, announcements), Attendance, Leave (balances, apply, approvals), Tasks, Announcements, Sales (customers + document builder with live RM total), Profile; notification bell; light/dark mode
### Security
- New roles ranked into existing CMS RBAC (live_host lowest — no CMS/finance/admin access); all staff routes require auth; every mutating action audited

## [0.9.0] — 2026-07-24
### Added
- No-code content editing is live end-to-end: public `/content-public` endpoint (60s cache) + `<Editable>` component; hero headline/subheadline, About paragraphs, CTA heading, footer slogan, and Contact intro now read D1 overrides with static fallback
- Visitor analytics: Cloudflare Web Analytics beacon, token-gated in `constants/site.ts` (inert until token set)

## [0.8.0] — 2026-07-24
### Changed — UI/UX redesign pass (premium corporate principles)
- WCAG 2.1 AA contrast: new deep-gold token (#7D6027, 5.0:1) for accent text on light backgrounds; footer text raised from 40% to 60% white; navy focus-visible outlines site-wide
- Consistent radius system: pill buttons replaced with 8px-radius buttons; cards on the same scale; only true dots remain circular
- 8px spacing grid: all section/page paddings normalized to multiples of 8
- Subtle shadows only (shadow-sm on hover)
- Every page ends with a clear next step: About and FAQ pages gained consultation CTAs

## [0.7.0] — 2026-07-24
### Added
- Google OAuth sign-in for /admin (state-cookie CSRF protection, verified-email requirement); company-domain Google accounts auto-activate
- Self-registration on /admin (rate-limited): any valid email, created pending until super-admin approval
- Login screen: Continue with Google, register mode, pending/oauth notices
### Changed
- Contact email: hello@ → admin@azoneofficial.com

## [0.6.0] — 2026-07-24
### Added
- User management: API (super_admin only — create, role change, activate/deactivate with session revocation, password reset) + admin Users tab
- Admin Media tab: upload to R2, image previews, copy-URL, delete
- Admin Content tab: key-value site content editor (dot-notation keys, JSON or text values)
- Dashboard: posts/testimonials counts + recent-activity feed from audit log
- ELFIA individual product pages (/products/[slug]) with descriptions, galleries (grey shawl: 4 angles), "price announced live" panel, cross-links; added to sitemap
- Public D1 reads: /portfolio and homepage testimonials render published D1 items at runtime with graceful static fallback
### Changed
- Product cards on homepage and /products now link to detail pages

## [0.5.0] — 2026-07-24
### Added
- Rate limiting (D1 fixed-window): login 10/15min, enquiries 5/hour per IP (migration 0002)
- Full CRUD API: products, posts, portfolio, testimonials (editor+ write, admin+ delete, public reads filtered to published/visible)
- Site content API: GET public, PUT editor+ (upsert with audit)
- Media API: R2 upload (editor+), public cached serving, delete
- Contact form on /contact posting to /api/v1/enquiries with WhatsApp fallback on failure
- Admin UI at /admin (noindexed): login, dashboard, enquiry management with status workflow, CRUD panels for products/posts/portfolio/testimonials
### Security
- /admin disallowed in robots.txt and noindexed; all admin API writes audited

## [0.4.0] — 2026-07-24
### Added
- ELFIA product photos (9, web-optimized) wired into homepage + /products; brand copy corrected to premium chiffon hijabs/shawls
- Phase 3 architecture DECIDED: static site + separate admin/API Worker (`/worker`)
- Worker scaffold: wrangler.toml with real D1/R2 bindings, migration 0001 (full schema), API v0 — auth (PBKDF2 sessions), public enquiries endpoint, enquiry management, dashboard summary, audit logging
### Security
- PBKDF2-SHA256 310k iterations + pepper (argon2 deviation documented in SECURITY.md); origin checks on mutations; HttpOnly/Secure/SameSite cookies

## [0.3.0] — 2026-07-24
### Added
- Full public website (Phase 2): `/about`, `/services`, `/portfolio`, `/case-studies`, `/products` (ELFIA), `/blog` (+2 starter posts), `/careers`, `/faq`, `/contact`, `/privacy`, `/terms`
- SEO: sitemap.xml, robots.txt, JSON-LD Organization schema, Open Graph + Twitter card images
- Brand assets: OG share image (`public/og.png`), favicon/app icon
- Mandatory documentation set (this file and 11 siblings)
### Changed
- Navigation switched from homepage anchors to dedicated pages
- Footer: legal links, Case Studies, Careers added

## [0.2.0] — 2026-07-24
### Added
- Full landing page: Hero, About + stats, Services, Showcase, ELFIA, Process, FAQ, CTA, Navbar, Footer
- Real contact data from Master Project Prompt: WhatsApp +60 12-383 4821, official slogan, Setia Tropika address
- Services aligned to master list (6 services)
### Changed
- Hero copy per master prompt ("Grow your sales through live commerce")

## [0.1.0] — baseline
- Next.js 15 scaffold with design tokens, coming-soon page, Cloudflare static deploy
