# Changelog

All notable changes to the AZ ONE OFFICIAL platform.

## [1.2.16] — 2026-07-25
### Added
- **ELFIA carousel autoplay** — advances every 3.5s by default (`autoPlay` / `interval` props on `ElfiaGallery`). Manual arrows, dots, swipe, and keyboard all still work exactly as before and reset the timer on use. Autoplay pauses on hover, on keyboard focus, while swiping, when the browser tab is hidden, and when the carousel is scrolled off screen; it is disabled entirely for `prefers-reduced-motion`. The screen-reader live region switches to `off` during autoplay so it doesn't announce a new product every 3.5s
### Changed
- **Service icons redesigned** for a consistent professional set: 24px grid, 1.5px stroke, round caps, optically centred, geometric — nothing glyph- or emoji-like
  - **TikTok strategy** icon replaced: the target-plus-diagonal-arrow read as a ♂ symbol; it is now concentric rings with a solid centre dot (positioning/targeting, fully symmetric)
  - **Business consultation** changed from a briefcase-with-trend-line to a conversation bubble — the trend line duplicated the bars in the Live commerce management icon
  - Microphone, dashboard, pen nib, and clapperboard redrawn on the same grid with matched proportions
- Icon chips refined to `rounded-xl` at 48px with 22px icons on both the home services section and `/services`, tuned for the lighter 1.5px stroke

## [1.2.15] — 2026-07-25
### Fixed (mobile)
- **iOS input zoom**: contact form fields were `text-sm` (14px); Safari auto-zooms the whole page on focus below 16px. Now `text-base` on mobile, `sm:text-sm` on desktop
- **Footer email overflow**: `admin@azoneofficial.com` (~150px) did not fit the 2-column footer grid on 320–390px screens. Column gap reduced to `gap-6` on mobile, `min-w-0` added, and the address now wraps via `[overflow-wrap:anywhere]`
- **Mobile menu could exceed the viewport** with no way to reach the last items — now `max-h-[calc(100svh-4rem)] overflow-y-auto`
- **ELFIA gallery caption clipped** between ~430px and the `sm` breakpoint (card grew to 400px inside a 420px stage). Stage is now `h-[440px] sm:h-[500px]` and the mobile card caps at `max-w-[260px]`; verified to fit at 320/390/430/600/640/768px
- **Vertical scrolling while swiping the gallery** — added `touch-pan-y` so a vertical drag scrolls the page instead of being captured by the carousel
- **Buttons sat ~16px from overflowing at 320px** — mobile padding reduced to `px-6` (`sm:px-8` unchanged)
- **Back-to-top button** now respects the iOS home indicator via `bottom-[max(1.25rem,env(safe-area-inset-bottom))]`
### Added
- Explicit `viewport` export in `app/layout.tsx`: `viewport-fit=cover` (notched phones) and `theme-color: #1a2946`, so the browser chrome matches the brand on Android/iOS
- `overflow-x: hidden` on `body` as a safety net against stray horizontal scroll (no sticky positioning in use, so no side effects)

## [1.2.14] — 2026-07-25
### Added
- **Back-to-top button** (`components/ui/scroll-to-top.tsx`, mounted site-wide in `app/layout.tsx`) — fades in after ~500px of scroll, hides while the footer is on screen so it never covers footer links, and reappears once the footer scrolls out of view. Footer detection via IntersectionObserver on `#site-footer`; smooth scroll respects `prefers-reduced-motion`; removed from the tab order while hidden
### Changed
- **FAQ**: the accordion was capped at `max-w-3xl` inside the 6xl frame, leaving a large dead area on the right. It now spans the full container width on both the home section and `/faq`; answer text stays capped at `max-w-3xl` for readability
- **Footer spacing tightened**: `py-16` → `py-12`, column gap `12` → `8/10`, CTA `mt-6` → `mt-5`, bottom bar `mt-12` → `mt-10`
- **Footer layout rebalanced**: the brand block and link columns used `md:justify-between`, which pushed them to opposite edges and left a dead centre gap. Now an even 4-column grid (brand spans 2, Explore + Follow us span 2)
- Footer legal links wrap gracefully (`flex-wrap`) instead of overflowing on narrow screens

## [1.2.13] — 2026-07-25
### Changed
- **Page width standardised across the site.** `PageShell` rebuilt on the `/products` frame — `main pt-16` → `mx-auto max-w-6xl px-6 py-16 sm:py-24` → header → content. Every inner page now shares one width and vertical rhythm: /about, /services, /portfolio, /products, /blog (+ posts), /faq, /contact, /careers, /case-studies, /privacy, /terms (was `max-w-3xl` with different top padding)
- Running text is capped at `max-w-3xl` inside the wide frame, so line length stays readable — wide frame, readable measure
- `PageShell` gained `intro` (lead paragraph under the h1) and `dark` (navy background) props; header markup is now identical on every page
- **/faq** rebuilt on `PageShell` — it previously had no page header at all and reused the home section, which double-padded the layout. Accordion extracted to `components/ui/faq-list.tsx` and shared by the home section and the page, so both render identical markup
- **/services**: lead line promoted to `intro`; service cards now a 2-column grid in the wider frame
- **/blog**: post cards now a 2-column grid with equal-height cards; `intro` added
- **/portfolio**: `intro` added
- **/contact**: message form and location map now sit side by side on large screens instead of stacking
- Icon chips standardised to navy + gold (`bg-brand text-gold`) on /services and /about, matching the home services section (were `bg-gold-soft` + black icons)
### Note
- `/products` keeps its bespoke ELFIA header typography; its frame values already match `PageShell` exactly, so the two stay visually in sync

## [1.2.12] — 2026-07-25
### Changed
- `public/og.png` rebuilt from the master OG artwork at exactly 1200×630, alpha flattened onto the cream background (transparency can render as black in some scrapers), no horizontal stretching — 37px of empty cream trimmed from the top so the gold/navy curves stay fully intact
### Diagnosis note
- The small-thumbnail WhatsApp preview was NOT a broken og.png: the live site still runs pre-1.2.9 metadata, which declares both `og.png` and `og-square.png`, and WhatsApp was picking the square — rendering it as a cropped small-thumbnail card. The landscape-only fix from [1.2.9] resolves it and takes effect on deploy.

## [1.2.11] — 2026-07-25
### Changed
- ELFIA product names updated in `constants/content.ts`:
  - "The Signature Shawl — Taupe" → **"The Signature Shawl — Mocha"** (slug `signature-shawl-taupe` → `signature-shawl-mocha`)
  - "The Signature Shawl — Grey" → **"The Signature Shawl — Soft Grey"** (slug `signature-shawl-grey` → `signature-shawl-soft-grey`)
  - "Corporate Series — Blush" → **"Corporate Series — Khaki"** (slug `corporate-blush` → `corporate-khaki`)
  - "The Signature Shawl — Beige" unchanged; Active Hijab and Neutral Collection unchanged
- Alt text and product descriptions reworded to match the new colour names; The Neutral Collection copy now reads "black, mocha, beige, and soft grey"
### Added
- `public/_redirects` — 301s from the three old product URLs to the new slugs, so any link already shared keeps working
### Note
- Image filenames in `/public/elfia/` unchanged (`shawl-taupe.jpg`, `corporate.jpg`, …) — internal references only, not visible to visitors. Swap the photos if the new colours are different fabric, not a rename.

## [1.2.10] — 2026-07-25
### Changed
- Hero: "We sell live" pill badge replaced with the transparent company logo (`/logo.png`, no pill background, h-16/h-20 responsive) — hero now opens logo → "LIVE . CONNECT . GROW." eyebrow → headline, mirroring the OG banner layout. Logo has no tagline baked in, so the eyebrow is kept (no duplication)

## [1.2.9] — 2026-07-25
### Fixed
- WhatsApp link preview inconsistency: openGraph now declares only the landscape `og.png` (1200×630). With both landscape and square variants listed, WhatsApp sometimes picked `og-square.png` and rendered the compact small-thumbnail layout instead of the large banner card. `og-square.png` stays in `/public` (unreferenced) in case it's wanted later.
### Note
- WhatsApp caches previews per exact URL (with/without trailing slash are separate entries) for up to ~30 days — after deploy, re-scrape via Facebook Sharing Debugger and/or share the link once with `?v=2` to force a fresh fetch

## [1.2.8] — 2026-07-25
### Deployed
- azoneofficial.com live — v0.1 under-construction page retired
### Changed
- `/products`: grid replaced by the coverflow gallery; "Explore the range" link list added beneath it (all six detail pages remain one tap away); "Where to buy" CTAs migrated to shared Button

## [1.2.7] — 2026-07-25
### Changed
- Sales document numbering: new format `{TYPE}{YYYYMMDD}-{NN}-AZOO` (e.g. `DO20260725-01-AZOO`) — date-readable, daily sequence (KL time), issuer code. Legacy numbers (`QT202600001`) remain valid, never renumbered. Spec: `DOCUMENT-NUMBERING.md`
### Added
- Migration `0005_doc_numbering_daily.sql` — `doc_counters_daily` table; old `doc_counters` kept untouched
- `DOCUMENT-NUMBERING.md` — format spec, rationale, migration rules, future doc types (OR/CN/PO)
- `FEATURE-SUGGESTIONS.md` — 15 candidate features with sequencing (Live Session module, host commission, ELFIA live-stock, MyInvois e-Invoice readiness, SST, payments/OR, CN, WhatsApp enquiry alerts, D1 backup, 2FA, more)
### Policy
- Docs are append-only for history: version entries are never removed

## [1.2.6] — 2026-07-25
### Changed
- ELFIA gallery: grid replaced by coverflow carousel (`components/ui/elfia-gallery.tsx`) on the home ELFIA section — centre card full size and linked to its detail page, neighbours peek behind, infinite wrap, touch-swipe + keyboard + aria-live, motion-reduce respected, zero dependencies
- Service icons: all six cards now use one professional icon family (`components/ui/service-icons.tsx`, 1.6px stroke, 24px grid) on navy chips with gold strokes (was mixed lucide icons on gold-soft chips)
- Buttons standardised via `components/ui/button.tsx` (h-12, rounded-lg, min-w-[180px] on ≥sm, full-width stacked on mobile) — migrated hero, home CTA, ELFIA, /products, product detail, and contact page (which was drifting with rounded-full)
### Added
- `REVIEW.md` — improvement suggestions for client site, staff portal, customer area, with priority order

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
