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
| v1.3.0 | 29 Jul 2026 | ELFIA repositioned as client and featured case study; product catalogue removed; /portfolio/elfia added — copy/links/data only on the stable v1.2.29 build |

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

## v1.2.6 – v1.2.8 — 25 Jul 2026 — Launch day + UI pass + numbering
- **Site went LIVE** on azoneofficial.com (deploy checklist completed; v0.1 page retired)
- ELFIA coverflow gallery replaces the grid on home + /products (`components/ui/elfia-gallery.tsx`) — mobile swipe, keyboard, a11y, zero deps; centre card links to its detail page
- Professional service icon family (`components/ui/service-icons.tsx`) on navy/gold chips
- Shared Button (`components/ui/button.tsx`) — consistent h-12 / rounded-lg / min-width across hero, CTA, ELFIA, products, product detail, contact (fixed contact's rounded-full drift)
- Sales doc numbering → `{TYPE}{YYYYMMDD}-{NN}-AZOO` (migration 0005, `doc_counters_daily`); legacy numbers preserved; spec in DOCUMENT-NUMBERING.md
- New docs: REVIEW.md, DOCUMENT-NUMBERING.md, FEATURE-SUGGESTIONS.md; docs policy: append-only history

## v1.2.9 – v1.2.11 — 25 Jul 2026 — Post-launch polish
- WhatsApp OG preview fixed to the large landscape banner card (landscape-only openGraph); og-square.png retained but unreferenced
- Hero "We sell live" pill replaced with the transparent company logo
- ELFIA product renames: Taupe→Mocha, Grey→Soft Grey, Corporate Blush→Khaki (Beige unchanged); slugs updated with 301 redirects in `public/_redirects`. Note: the asset list above records the original photo filenames, which are unchanged.

## v1.2.13 — 25 Jul 2026 — Site-wide layout standardisation
- One page frame for the whole site: PageShell rebuilt on the /products layout (max-w-6xl, px-6, py-16/sm:py-24, pt-16 under the fixed navbar)
- Consistent header block (eyebrow / h1 / intro) on every inner page; /faq gained a proper page header for the first time
- FAQ accordion extracted to a shared component so the home section and /faq cannot drift
- Content re-flowed for the wider frame: 2-col grids on /services and /blog, side-by-side form + map on /contact

## v1.2.14 — 25 Jul 2026 — Navigation & footer polish
- Site-wide back-to-top button with footer-aware visibility
- FAQ accordion now fills the standardised page width (no dead space on the right)
- Footer rebalanced to an even grid and tightened vertically

## v1.2.15 — 25 Jul 2026 — Mobile audit
- Full pass for narrow-screen defects: iOS input zoom, footer email overflow, unscrollable mobile menu, clipped gallery caption, swipe/scroll conflict, tight button padding, iOS safe-area
- Explicit viewport config with viewport-fit=cover and brand theme-color

## v1.2.16 — 25 Jul 2026 — Carousel autoplay + icon redesign
- ELFIA carousel now auto-advances every 3.5s with full manual control retained; pauses on hover/focus/swipe/hidden-tab/off-screen and respects reduced motion
- Service icon family redesigned on a single 24px/1.5px grid; ambiguous target-and-arrow glyph replaced with concentric rings

## v1.2.17 — 25 Jul 2026 — Mobile autoplay fix
- Carousel autoplay repaired for touch devices: touchcancel handling, mouse-only hover pause, keyboard-only focus pause, separate swipe state, plus a 6s watchdog

## v1.2.18 — 26 Jul 2026 — Credibility, packages, conversion
- Zero-value counters removed; qualitative trust signals shown until real numbers exist
- Package tiers published (Starter/Growth/Scale/Enterprise) on home + /services, scope without price
- Action-oriented CTAs (free live audit, strategy call, WhatsApp now) + floating WhatsApp button
- Cost and logistics FAQs added to reduce pre-enquiry hesitation

## v1.2.19 — 26 Jul 2026 — Interaction + mobile density
- Carousel photos and dots made tappable (side cards were inert)
- Equal-width CTA pairs via ButtonGroup; floating buttons aligned on one axis
- Homepage trimmed for mobile: FAQ 5 of 12 with link to /faq, testimonials 3 of 7, accordions collapsed by default

## v1.2.20 — 26 Jul 2026 — Packages as its own page
- /packages created: tier cards + desktop comparison matrix + cost FAQs + audit CTA
- /services returns to capability only, linking through to /packages
- Nav restructured (Packages in, FAQ to footer); FAQ content split by intent across home / packages / faq

## v1.2.21 — 26 Jul 2026 — Package carousel + scroll behaviour
- Package tiers presented as a scroll-snap carousel on home and /packages (1/2/3 cards by breakpoint)
- Refresh returns to the top of the page; back navigation still restores position (ELFIA product -> back -> ELFIA section)

## v1.2.22 — 26 Jul 2026 — ELFIA brand audit + gallery + standardisation
- ELFIA slogan "Dekat Di Mata, Menarik Di Hati" published; every "fashion brand" reference corrected to hijab brand
- Product pages get a main-image + thumbnail gallery
- Package carousel switched to scroll/drag only; button sizing unified through one component
- /about restructured into a two-column layout

## v1.2.23 — 26 Jul 2026 — Scroll restoration + carousel affordance
- Per-path scroll memory with layout-settle retry fixes Back from product pages
- Package carousel: instruction text replaced with edge fade, progress bar, counter, and card peek
- Product gallery resized for both phone and laptop viewports

## v1.2.24 — 26 Jul 2026 — Gallery frame fix
- Product gallery frame sized by one fixed aspect ratio and max-width only; removed the height cap that broke the ratio and left empty space beside the photo

## v1.2.25 — 26 Jul 2026 — Carousel progress bar
- Full-width scroll progress bar, counter removed, thumb tracks real scroll position and visible fraction

## v1.2.26 — 26 Jul 2026 — ELFIA brand line + buying experience
- English strapline changed to "At First Sight. Forever in Your Heart." and paired with the Malay slogan
- Drop process explained in four steps; WhatsApp drop alerts and context-prefilled product enquiries added

## v1.2.27 — 26 Jul 2026 — Back-after-reload fix + breadcrumb
- Scroll restoration now covers full-document back_forward loads, not just in-app popstate
- Product breadcrumb moved to its own strip under the navbar

## v1.2.28 — 27 Jul 2026 — Footer lockup + /about grid width
- Footer logo/strapline hierarchy corrected so the strapline sits narrower than the mark
- PageShell prose rule no longer shrinks card grids, removing dead space on /about

## v1.2.29 — 27 Jul 2026 — Footer lockup centring
- Logo and strapline wrapped as a single lockup so the strapline centres under the mark

## v1.3.0 — 29 Jul 2026 — ELFIA repositioned as client
- **Decision**: ELFIA is a client of AZ ONE OFFICIAL, never a house brand — the agency must be able to pitch brands that compete with its clients, so the agency site shows client results, not a product catalogue
- Applied directly on the stable v1.2.29 build; layout, section sizing, spacing, and animation untouched (supersedes the abandoned v1.4/v1.5 workspace branch, whose restructure broke the deployed layout)
- Copy repositioned site-wide: description, hero, about, trust signal, homepage ELFIA section (markup byte-identical), FAQ
- Added /portfolio/elfia case study; PORTFOLIO_ITEMS + CASE_STUDIES populated so /portfolio and /case-studies show real work with zero page-code changes
- Removed /products and detail pages; all catalogue URLs 301 to /portfolio/elfia; nav "ELFIA" repointed; customer area links to elfia.com.my

## v1.3.1 — 29 Jul 2026 — ESLint build fix
- Cloudflare Pages build failed: 14 ESLint errors across 8 files (unescaped entities, plain <a> for internal link, unused var)
- All fixed with semantic-equivalent changes; no copy, layout, or logic altered

## v1.3.2 — 29 Jul 2026 — ELFIA off the landing page
- Homepage ELFIA showcase section removed; landing page is fully AZ ONE OFFICIAL
- ELFIA stays visible as the existing successful client: hero mention, trust signal, FAQ, nav, portfolio, and the /portfolio/elfia case study
- ELFIA outbound links updated to the brand's own landing page: elfiaofficialstore.com

## v1.3.3 — 29 Jul 2026 — Live showcase section
- Homepage gains a "See a live session, live" section: TikTok /live CTA (self-routing: live room when live, profile otherwise) + official TikTok video embed for the process showcase
- Graceful preview card while no video is configured or while the embed loads; Shopee Live button optional via constant
- Documented platform constraint: live streams are not embeddable and no public live-status API exists for static sites

## v1.4.0 — 29 Jul 2026 — Live embed, problems section, ELFIA into Portfolio
- TikTok creator widget embedded in the live showcase (latest videos, always current); /live CTA keeps routing to the live room during sessions
- Problems-we-solve section added between About and Services (four pain\u2192solution cards)
- Hero: ELFIA text mention replaced by a client logo strip with a temporary generated wordmark linking to elfiaofficialstore.com
- Navbar CTA renamed to "Get a free live audit"; ELFIA nav item removed; /portfolio/elfia removed (301 \u2192 /portfolio) with the ELFIA card linking out

## v1.4.1 — 29 Jul 2026 — Shopee Live channel panel
- Live showcase now shows both channels side by side: TikTok official creator embed + Shopee branded channel card linking to shopee.com.my/azoneoff
- Shopee blocks framing (X-Frame-Options) and offers no embed API, so its panel is a designed card rather than a broken iframe; constraint documented in constants

## v1.4.3 — 30 Jul 2026 — Admin control + kill switch + passwords
- Admin role granted full user management with server-side escalation guards (super admin untouchable)
- Kill switch: Suspend (block + revoke all sessions) and Force logout (revoke only) per account
- Self-service change password in /admin Account tab and portal Profile; rotates out all other sessions

## v1.4.4 — 30 Jul 2026 — Company role modules
- hr_admin, sales_marketing, cco, ceo roles with dedicated portal modules; coo duties expanded (daily ops/sales reports)
- Attendance shift-checked against 10:00–18:00 MYT Mon–Fri; HR verification table
- Doc numbering switched to {TYPE}-AZOO{DDMMYY}-{X}; migration 0007 adds the module tables

## v1.4.5 — 31 Jul 2026 — Admin/site sync + friendly Website editor
- Website tab: labelled, per-field editing of live site copy (hero, about, sections, footer, stats)
- Products tab removed (no /products routes on the site); raw editor kept as Advanced
- Dashboard cards + summary endpoint aligned with real site content

## v1.4.6 — 31 Jul 2026 — Admin password reset
- Per-user Reset password in /admin Users (forgotten-password flow, sessions revoked on set)

## v1.4.7 — 31 Jul 2026 — Role CHECK fix
- Migration 0008 expands users.role CHECK to the v1.4.4 roles; API stops mislabelling constraint failures as email conflicts

## v1.4.9 — 31 Jul 2026 — Separation, MYT display, password UX
- Staff roles fully separated from /admin (login routing + page gate + API content-team guards)
- Attendance displayed in Asia/Kuala_Lumpur across the portal
- Eye toggle on all password boxes; customer change-password; PASSWORD-GUIDE.md

## v1.4.10 — 31 Jul 2026 — Change-password error fix
- Nested API error shape parsed correctly; real failure reason (e.g. wrong current password) now shown

## v1.4.11 — 31 Jul 2026 — Full admin authority
- Staff tab in /admin: leave approvals (audit-logged, requester notified) + bridge to all staff modules

## v1.4.12 — 31 Jul 2026 — SECURITY: login backdoor removed
- Hardcoded universal password stripped from the login handler; recovery + rotation procedure in SECURITY.md

## v1.4.13 — 31 Jul 2026 — Complete interface separation
- /portal bounces content roles to /admin; /account bounces non-customers; full role×interface audit — API boundary confirmed the real protection

## v1.4.14 — 31 Jul 2026 — Role model overhaul
- 11 roles (removed MD/business_dev/finance_admin/live_manager); editor/marketing → portal task roles; content editing = admin tier only
- hr_admin attendance CSV export for payroll; CEO read-only; COO=CCO HR-level oversight; migration 0009

## v1.4.15 — 31 Jul 2026 — Badges, self-tasks, attendance policy, leave chain
- Government-size ID badge print + admin employee-field editing
- Staff self-create tasks (open/pending/closed + deadline); customer enquiries from /account
- Attendance policy (no break; MYT clock-in/out rules); multi-stage leave approval (HR→COO/CCO→CEO); migration 0010; tighter UI spacing

## v1.4.16 — 31 Jul 2026 — Payroll, calendar, audit, PDFs
- Leave entitlement editor + confirmed balance deduction; public holidays calendar
- Payslip/payroll summary (printable); audit-log viewer in /admin; off-platform notify webhook; branded QT/DO/INV PDFs

## v1.4.17 — 31 Jul 2026 — Staff directory for HR
- Employee-field editor + ID badge now in portal HR tab (hr_admin/coo/cco), shared with /admin; save failures surfaced

## v1.4.18 — 31 Jul 2026 — Profile, CEO birthdays, mobile, exec summary
- Two-column Profile; CEO Birthdays tab; mobile-friendly tab bars/tables/grids across all 3 interfaces
- Overview gains company task progress (per-staff) + inventory status for CEO/COO/CCO monitoring

## v1.4.19 — 31 Jul 2026 — Staff Details tab
- Dedicated Staff Details tab in /portal for HR tier: staff list + employee ID/position/department/birth date + badge

## v1.4.20 — 31 Jul 2026 — HR staff onboarding
- Add-staff form in Staff Details (HR tier); scoped endpoint creates staff roles only, never admin/super_admin

## v1.4.21 — 31 Jul 2026 — Update-instead on existing email
- Add-staff form resolves email conflicts by offering to update the existing record's employee fields (never role/password)

## v1.4.22 — 31 Jul 2026 — Badge preview + amendment lock
- Live on-screen badge preview at true card size; badge redesigned (logo, full name, phone; no blood type)
- Saved fields lock for HR — amendments admin-only, enforced server-side; migration 0012 (full_name)

## v1.4.23 — 31 Jul 2026 — Portrait badge + photo + location
- Badge portrait (54×85.6mm) with staff photo (private R2 storage, HR uploads / admin replaces) and company location in footer; migration 0013

## v1.4.24 — 31 Jul 2026 — Date format + create form completeness
- DD-MM-YYYY everywhere staff-facing (ISO in DB); blood type restored as record-only data; create captures birth date/ID issued/blood type; eye toggle on temp password

## v1.4.25 — 31 Jul 2026 — Compact lists + photo at create
- Fixed-height scroll areas for all long lists; add-staff photo picker with auto-upload; dashboard shift text removed

## v1.4.26 — 31 Jul 2026 — Bell rings for announcements
- Publishing an announcement notifies all active staff (bell + optional off-platform relay); notification clicks through to the tab

## v1.4.27 — 31 Jul 2026 — Accrual, CEO birthdays, clarity, pulses
- Leave eligibility accrues monthly (shown as "N eligible now" + annual total); CEO can read the staff list (Birthdays/Overview fixed)
- Overview document counts explained in plain words; dashboard pulse badges; mobile polish

## v1.4.28 — 31 Jul 2026 — CEO attendance corrections
- CEO/admin can amend punches and back-enter clock in/out for pre-system days; provenance columns + audit; migration 0014

## v1.4.29 — 31 Jul 2026 — Punch integrity + confirmation
- One punch per type per day (server-enforced 409); animated ring-and-check confirmation card with result + MYT time

## v1.4.30 — 31 Jul 2026 — Company-start accrual
- 2026 leave entitlement divides over Jul–Dec (start 20 Jul 2026); Jan–Dec from 2027 automatically

## v1.4.31 — 31 Jul 2026 — Stock logic + live bell
- Postage deducts stock (insufficient refused), returns restock once, manual In/Out with audit; migration 0015
- Bell polls 60s + focus, pulsing amber unread badge — announcements alert staff live

## v1.4.32 — 31 Jul 2026 — Multi-item orders
- Orders ship multiple items/quantities; merge → validate-all → guarded deduct → rollback on race; returns restock all lines; migration 0016

## v1.4.33 — 31 Jul 2026 — Statutory medical + CEO visibility + account tabs
- Medical leave full from day one; CEO read-only HR/Sales/Staff Details; clickable dashboard cards; 7-day scrollable bell; super_admin out of staff lists; /account tabs

## v1.4.34 — 31 Jul 2026 — Backfilled bell + rank rework
- Announcement notifications backfill on read (deploy-order independent); NEW pulse on unacked announcements
- CEO edits Staff/HR/Staff Details (+ HR tools in portal, also for hr_admin); COO & CCO read-only; leave chain unchanged

## v1.4.35 — 31 Jul 2026 — Registration hardening
- All self-registration = customer, always; Google company-domain auto-staff assignment removed

## v1.4.36 — 31 Jul 2026 — Payroll + format audit
- DD-MM-YYYY across the system; staff sorted by rank; unpaid leave full from day one
- Payroll processing tab (CEO/hr_admin; COO/CCO read) with branded AZ ONE OFFICIAL payslip; migration 0017

## v1.4.37 — 31 Jul 2026 — Backdoor removed + 2FA
- CRITICAL: master-password backdoor (2nd occurrence, via forked base) removed from login and change-password
- TOTP 2FA with hashed single-use backup codes for super_admin/admin/CEO; migration 0018

## v1.4.38 — 31 Jul 2026 — Punch feedback + thresholds
- Clock in after 12:00 = half day; clock out before 18:00 = early out (HR report aligned)
- Repeat taps show an amber popup with the time already recorded; buttons show Clocked in/out ✓

## v1.4.39 — 31 Jul 2026 — CEO Sales tab fix
- Sales content gate now matches the tab gate; CEO sees documents + customers read-only

## v1.4.40 — 31 Jul 2026 — 2FA everywhere, payroll rework, TikTok
- 2FA all staff roles; Payroll = CEO+COO processors, My payslip (view/print) for everyone
- Sales edit: ceo/coo/cco/hr_admin/sales_marketing; TikTok order webhook moves stock by SKU

## v1.4.41 — 01 Aug 2026 — Malaysian payslip format
- Boxed EARNINGS | DEDUCTIONS | OTHERS layout with NETT PAY; late-only deductions; no statutory rows; real attendance/leave data

## v1.4.42 — 01 Aug 2026 — Company-email domain policy
- Staff/admin roles only on @azoneofficial.com; personal emails are customers; enforced on all assignment paths

## v1.4.43 — 01 Aug 2026 — Badges, bank, proration
- Multi-badge printing (9/A4); bank details (Maybank primary) + employment status + joined-on; payslip full name + BANK line + month-scoped balances; working-day proration + Save all; pre-joining months greyed

## v1.4.44 — 01 Aug 2026 — TikTok protocol compatibility
- tiktok-signature verification (both schemes) + replay window; Get Order Detail for line items; seller authorization callback; webhook_events log; migration 0020

## v1.4.45 — 01 Aug 2026 — TikTok app key in config
- TIKTOK_APP_KEY committed to worker/wrangler.toml; secret stays a wrangler secret; scope activation still pending in Partner Center

## v1.4.46 — 01 Aug 2026 — Status constraint fix + bank on creation
- users CHECK rebuilt for permanent/contract/part_time (migration 0021); friendly validation; add-staff captures bank details
