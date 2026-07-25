# AZ One Official — Project Status
**Version:** v1.2.7 · **Updated:** 25 Jul 2026 · **Docs:** 16 files (+ REVIEW, DOCUMENT-NUMBERING, FEATURE-SUGGESTIONS)
**Build:** COMPLETE (in zip) · **Live deployment:** ⚠️ NOT YET — verified 24 Jul: azoneofficial.com still shows the old "Site under construction" page from v0.1

Two-part platform in one repository:
- **Public site** (Next.js static export → Cloudflare Pages) — everything a visitor sees
- **API Worker** (`/worker`, Cloudflare Workers + D1 + R2) — auth, CMS, staff portal, customer accounts

---

## 🚨 What's blocking you right now

Everything built since v0.1.0 is in the zip but has **not been pushed to GitHub**. That's why the login screen returns *"Can't reach the sign-up service."* — the domain still serves the old landing page, and no API Worker is running.

**The fix is deployment, not more code.** See the "Deploy checklist" below.

---

## ✅ What's built and ready (in the zip)

### Public website
Home, About, Services, Portfolio, Case Studies, **Products (ELFIA)** with 6 detail pages + galleries, Blog (2 starter posts), Careers, FAQ, Contact (with working form), Privacy Policy, Terms & Conditions. Mobile-first, WCAG AA contrast, real navy+gold branding with your logo everywhere, SEO complete (sitemap, robots, JSON-LD, OG image from logo). ELFIA — all 9 real product photos wired in, priced "announced live." Social handles all @azoneofficialhq.

### 🆕 v1.2.7 (25 Jul 2026)
- **QT/DO/INV numbering** moved to date-based format `{TYPE}{YYYYMMDD}-{NN}-AZOO` (e.g. `DO20260725-01-AZOO`) — full spec, rationale, and migration rules in **DOCUMENT-NUMBERING.md**. Old numbers (`QT202600001`) stay valid; never renumbered. D1 counter utility: `worker/lib/numbering.ts` (+ `doc_counters` migration).
- **FEATURE-SUGGESTIONS.md** added — 15 candidate features across core business (Live Session module, host commission, ELFIA live-stock), Malaysian compliance (MyInvois e-Invoice readiness, SST, holiday calendar), money flow (payments/OR, CN, statements), comms (WhatsApp enquiry alerts), and hardening (D1 backup, 2FA, audit viewer), with suggested sequencing.
- Docs policy made explicit: **md files are append-only for history** — every doc carries a History table; entries are never removed.

### v1.2.6 UI pass (25 Jul 2026)
- **ELFIA gallery** rebuilt as a coverflow carousel (`components/ElfiaGallery.tsx`): centre card prominent, neighbours peek behind, arrow buttons + position dots below, touch-swipe + keyboard support, reduced-motion safe, no external library. Replaces the previous gallery on the Products (ELFIA) pages.
- **Service icons** replaced with one professional family (`components/ServiceIcons.tsx`): uniform 1.6px stroke on navy chips with gold strokes, mapped to all six services.
- **Buttons standardised** via shared `components/Button.tsx`: h-12, rounded-full, `min-w-[180px]` on ≥sm so paired CTAs align; full-width when stacked on mobile. Replace ad-hoc button styling on Home, Services, ELFIA, Contact.
- **REVIEW.md added** — improvement suggestions for client site, staff portal, and customer area, with priority order.

### Auth & access — one login, role-routed
`/login` is the single door. After sign-in, users route automatically:
- **Customer** → `/account`
- **Staff** (COO, BD, Finance, Live Manager, Live Host) → `/portal`
- **CMS** (Super Admin, Admin, Editor, Marketing, MD) → `/admin`

Sign-in via email/password OR Continue with Google. Registration = instant active customer account. Password field has show/hide eye toggle + live character counter. Staff/admin roles assigned only by super admins.

### /admin — CMS
Dashboard (counts + activity feed), Enquiries (workflow), Products/Posts/Portfolio/Testimonials CRUD, Media (R2 upload), **no-code Content editor** (hero, about, CTA, footer, contact intro), Users management (super admin only).

### /portal — Staff Portal (BMS v1)
Dashboard with quick actions (clock in/out, break, apply leave, create quotation), Attendance (IP+device capture, monthly, team report), Leave (5 types, balances, approvals), Tasks, Announcements, **Sales** (customers + QT/DO/INV with auto-numbering `QT202600001` + live RM totals), Notifications, **light/dark mode**, mobile-responsive.

### /account — Customer area
Profile, own enquiry history, ELFIA link.

### Security (audit report in SECURITY.md)
Zero-hardcoded super admin bootstrap (SETUP_TOKEN, self-disabling) · PBKDF2+pepper passwords · SHA-256-hashed session tokens · Google OAuth · SameSite+HttpOnly+Secure cookies · Origin checks · rate limits · RBAC · audit logging · static security headers · `private/` R2 keys staff-only · enquiry-history email-squatting leak closed · zero credentials in source (all config in Cloudflare dashboard/secrets).

### Documentation (15 files, in sync)
README · CHANGELOG (v1.2.7) · MILESTONES · FEATURES · ROADMAP · ARCHITECTURE · DATABASE · API · DEPLOYMENT · SECURITY · CONTRIBUTING · ADMIN_GUIDE · USER_GUIDE · REVIEW · **DOCUMENT-NUMBERING** · **FEATURE-SUGGESTIONS**

---

## ⚠️ Deploy checklist — what you need to do (~15 minutes)

### 1. Push the site to GitHub
```bash
# Extract azoneofficial-built.zip over your local repo, then:
cd /path/to/azoneofficial
git add .
git commit -m "feat: full platform build v1.2.2"
git push origin main
```
Cloudflare Pages auto-deploys in 1–2 minutes. Verify by refreshing azoneofficial.com — you should see the real navy homepage with your logo instead of the "site under construction" text. `/login` will render but sign-up still fails until step 2+3.

### 2. Deploy the Worker
```bash
cd worker
pnpm install
pnpm wrangler secret put SESSION_PEPPER        # random 32+ chars from password manager
pnpm wrangler secret put GOOGLE_CLIENT_SECRET  # from Google Cloud OAuth client
pnpm wrangler secret put SETUP_TOKEN           # random 32+ chars from password manager
pnpm migrate:prod
pnpm deploy
```

### 3. Cloudflare dashboard — variables + route (CRITICAL)
**Workers & Pages → azoneofficial-api → Settings**:

**Variables → Plaintext variables:**
- `ALLOWED_ORIGIN` = `https://azoneofficial.com`
- `COMPANY_DOMAIN` = `azoneofficial.com`
- `GOOGLE_CLIENT_ID` = `357852391876-0hln8ehf5do4pb188kfh8rt486nvj4d9.apps.googleusercontent.com`

**Triggers → Routes → Add Route:**
- Pattern: `azoneofficial.com/api/*`
- Zone: `azoneofficial.com`

*Without the route, `/api/*` returns 404 and login fails.*

### 4. Verify
Open `https://azoneofficial.com/api/v1/health` — expect `{"ok":true,"service":"azoneofficial-api"}`.

### 5. Create your super admin (one time)
```bash
curl -X POST https://azoneofficial.com/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<your SETUP_TOKEN>",
    "email": "admin@azoneofficial.com",
    "name": "Alīf",
    "password": "<10+ character password>"
  }'
```
Endpoint returns 410 Gone forever after. Then sign in at `/login`.

### 6. Google OAuth redirect URI
Google Cloud Console → OAuth client → Authorized redirect URIs:
- `https://azoneofficial.com/api/v1/auth/google/callback`

### 7. After deploy: refresh social link previews
Once the new site is live, WhatsApp/Facebook may still show the old (or generic) preview from their cache. Force a refresh once:
- **Facebook / WhatsApp**: paste https://azoneofficial.com into [developers.facebook.com/tools/debug](https://developers.facebook.com/tools/debug) → click "Scrape Again"
- **LinkedIn**: [linkedin.com/post-inspector](https://www.linkedin.com/post-inspector/)
- **Twitter/X**: post the link once; Twitter re-fetches on first share

### 8. Optional (do anytime)
- Cloudflare Web Analytics token → paste into `constants/site.ts` `cfAnalyticsToken`
- Real statistics in `constants/content.ts` (or remove the stats block — currently placeholder 500+/12/3x)
- Lawyer review of Privacy Policy and Terms
- ELFIA RM pricing decision (currently "announced live" — I can switch anytime)

---

## 🗺️ Explicitly deferred (in ROADMAP.md, not launch blockers)
PDF/print for QT/DO/INV · Excel export & overtime/late computation · MC upload in leave form · CRM per-customer document history · forgot-password (needs email service) · email verification for password signups · nonce-based CSP · Payroll · Inventory · Client Portal · Mobile App

---

## 📜 Version history (append-only — do not remove entries)
| Version | Date | Summary |
|---|---|---|
| v0.1.0 | 2026 | Initial "site under construction" page (currently what azoneofficial.com serves) |
| v1.2.5 | 24 Jul 2026 | Full platform build complete in zip: public site, /login role-routed auth, /admin CMS, /portal BMS v1, /account, security audit, 12 docs. Not yet deployed. |
| v1.2.6 | 25 Jul 2026 | UI pass: ELFIA coverflow gallery, professional service icon family, standardised Button component, REVIEW.md added. |
| v1.2.7 | 25 Jul 2026 | Date-based QT/DO/INV numbering (`{TYPE}{YYYYMMDD}-{NN}-AZOO`) + DOCUMENT-NUMBERING.md, numbering.ts + doc_counters migration, FEATURE-SUGGESTIONS.md, append-only docs policy. |
