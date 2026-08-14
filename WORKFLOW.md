# AZ ONE OFFICIAL — Full System Workflow Reference

**Version:** based on codebase v1.7.x (azoneofficialv1.7.5) · **Generated:** 13 Aug 2026
**Purpose:** one document that explains, end to end, how the whole platform works — public site, API Worker, admin CMS, staff portal, customer accounts, integrations, and deployment.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Architecture & Request Flow](#2-architecture--request-flow)
3. [Roles, Login & Access Routing](#3-roles-login--access-routing)
4. [Authentication Workflow](#4-authentication-workflow)
5. [Public Website Workflow](#5-public-website-workflow)
6. [Admin CMS Workflow (/admin)](#6-admin-cms-workflow-admin)
7. [Staff Portal Workflow (/portal)](#7-staff-portal-workflow-portal)
8. [Customer Account Workflow (/account)](#8-customer-account-workflow-account)
9. [Sales Documents & Numbering](#9-sales-documents--numbering)
10. [Notifications Workflow](#10-notifications-workflow)
11. [TikTok Shop Integration](#11-tiktok-shop-integration)
12. [Scheduled Jobs (Cron)](#12-scheduled-jobs-cron)
13. [Data & Storage](#13-data--storage)
14. [Development & Deployment Workflow](#14-development--deployment-workflow)
15. [Quick Reference](#15-quick-reference)

---

## 1. The Big Picture

AZ ONE OFFICIAL is a Malaysian live-commerce agency platform. One codebase serves **four audiences**:

| Audience | Entry point | What they do |
|---|---|---|
| The public / prospects | `azoneofficial.com` (marketing pages) | Learn about the agency, view packages/portfolio, send enquiries |
| Customers | `/account` | View orders (QT/DO/INV), booked live sessions, send & read enquiries |
| Staff (all internal roles) | `/portal` | Attendance, leave, claims, payroll, inventory, sales, live sessions, pipeline, content, etc. |
| Admins (`super_admin`, `admin`) | `/admin` | CMS (site content, media, posts, portfolio), users, staff bridge, audit, system health |

```
                      ┌────────────────────────────────────────────┐
                      │            azoneofficial.com               │
                      └────────────────────────────────────────────┘
                             │                        │
              static pages   │                        │  /api/*
                             ▼                        ▼
              ┌────────────────────────┐   ┌────────────────────────┐
              │  Static Next.js export │   │  Cloudflare Worker     │
              │  (Cloudflare assets,   │   │  azoneofficial-api     │
              │   /out directory)      │   │  /api/v1/*             │
              └────────────────────────┘   └───────────┬────────────┘
                                                       │
                                    ┌──────────────────┼──────────────────┐
                                    ▼                  ▼                  ▼
                              ┌──────────┐      ┌────────────┐    ┌──────────────┐
                              │ D1 (SQL) │      │ R2 (files) │    │ External:    │
                              │azoneoffi-│      │ media,     │    │ Google OAuth │
                              │cial DB   │      │ backups,   │    │ TikTok Shop  │
                              │69 migra- │      │ staff docs │    │ Web Push     │
                              │tions     │      │ claims     │    │ services     │
                              └──────────┘      └────────────┘    └──────────────┘
```

**Key architectural decision (24 Jul 2026):** static public site + a **separate** admin/API Worker, rather than moving the whole app onto a server runtime. The marketing site can never go down because of the API — every dynamic public component falls back to built-in constants if the Worker is unreachable.

---

## 2. Architecture & Request Flow

### 2.1 Stack

- **Frontend:** Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · `output: "export"` → fully static, no server runtime.
- **Backend:** single Cloudflare Worker (`worker/`) named `azoneofficial-api`, bound to routes `azoneofficial.com/api/*` and `www.azoneofficial.com/api/*` — the Worker claims `/api/*` **before** the static assets are served.
- **Data:** Cloudflare D1 (SQLite) database `azoneofficial` (69 migrations) + R2 bucket `azoneofficial` for binary objects.

### 2.2 How a request flows

```
Browser
  │
  ├── GET /packages, /about, /blog/...     → static HTML from the export (instant, edge-cached)
  │       └── page hydrates → optional fetch /api/v1/content-public, /packages,
  │           /portfolio, /testimonials → overrides constants; on failure, constants win
  │
  └── Anything /api/v1/*                   → Worker
          ├── baseline headers on every response (nosniff, X-Frame-Options: DENY, no-store)
          ├── CSRF / Origin checks on mutating methods
          ├── session lookup (azone_session cookie → SHA-256 hash → sessions table)
          ├── permission check (can(role, perm) / atLeast(rank) / module role lists)
          └── D1 / R2 / external API work → JSON response
```

### 2.3 Frontend → API conventions

- **One fetch wrapper:** `lib/api.ts`. Base URL is `"/api/v1"` (relative, same-origin). Always sends `credentials: "include"`. On POST/PUT/PATCH/DELETE it attaches `X-CSRF-Token` read from the non-HttpOnly `csrf_token` cookie (double-submit pattern). Network failure returns `{ok:false, status:0}` so panels can show "can't reach the server".
- **Content rule:** pages compose components; components read `constants/` (`site.ts`, `content.ts`, `pages.ts`); no copy is hard-coded in components. Empty array = section hidden or an honest "in preparation" state — never a fake placeholder or "0+".
- **Errors from the API** follow `{ "error": { "code": string, "message": string } }`.

---

## 3. Roles, Login & Access Routing

### 3.1 The 11 roles

`super_admin` · `admin` · `editor` · `marketing` · `live_host` · `hr_admin` · `sales_marketing` · `ceo` · `coo` · `cco` · `customer`

(`live_host_part_time` is an accepted alias = `live_host` with `employment_status = 'part_time'`, not a real role.)

### 3.2 One login door, three destinations

Everyone signs in at **`/login`** (password or Google). After auth, the app routes by role:

```
role == customer                         →  /account
role in { editor, marketing, live_host,
          hr_admin, sales_marketing,
          ceo, coo, cco }                →  /portal
role in { super_admin, admin }           →  /admin
```

Each destination page re-checks `GET /auth/me` on mount and bounces users who land in the wrong place (e.g. a customer opening `/portal` is redirected to `/account`).

### 3.3 Three authorization layers (server-side)

1. **`can(role, permission)`** — a flat allow-list of 16 permissions (`hr_manage`, `sales`, `finance`, `claims_decide`, `exec_view`, `inventory`, `payroll_export`, …) in `worker/src/permissions.ts`. No hierarchy or inheritance. Notably: `claims_decide` = **super_admin + ceo only**.
2. **`ROLE_RANK` / `atLeast()`** — numeric ranks used by admin CMS routes (`customer/live_host 0 … ceo/admin 3, super_admin 4`). A CEO cannot PATCH an admin-tier account despite equal rank (explicit guard).
3. **Module role arrays** — hard-coded lists per feature, e.g. `PAYROLL_PROC = [super_admin, admin, ceo, coo]`, `TARGET_ADMIN_ROLES`, `PIPE_MANAGE`, `STOKIS_MANAGE`, and the leave/claims approval-chain role lists.

### 3.4 Tab access (UI shaping layer)

The portal's visible tabs come from a static role matrix **plus CEO-managed overrides** stored in D1 (`system_meta.tab_access`):

- `GET /api/v1/staff/tabs/access` — every staff member reads it to render their own tab strip.
- `POST /api/v1/staff/tabs/access` — **ceo / super_admin only**; set roles per tab, or reset to default. Audited.
- This shapes the UI only — **API route permissions still apply** underneath. `super_admin` always sees everything; `Dashboard` and `Profile` are always visible.

---

## 4. Authentication Workflow

### 4.1 Password login

```
POST /api/v1/auth/login { email, password }
  1. Rate-limit probe: 10/15min per account+IP, 30/15min per IP  → 429 if exceeded
  2. User must be is_active = 1 AND employment_status NOT IN (resigned, terminated)
  3. Verify PBKDF2-SHA256 (310k iterations, per-user salt + server pepper)
       failure → bump rate limit, 401           (only FAILED attempts consume budget)
       success → reset account rate limit
  4. If user has 2FA enabled → return { twofa_required, challenge }  (NO cookie yet)
       → POST /auth/2fa/verify { challenge, code }   (TOTP or backup code, 5 attempts max)
  5. Create session → Set-Cookie: azone_session (HttpOnly, Secure, SameSite=Lax, 12h)
                    + csrf_token (readable by JS, same lifetime)
```

### 4.2 Two-factor (TOTP)

- Standard RFC 6238: 6 digits / 30s / ±1 step; works with Google Authenticator, Authy, 1Password.
- Flow to enable: `POST /auth/2fa/setup` (get secret + otpauth URI) → scan QR → `POST /auth/2fa/enable` with a valid code → receive **8 single-use backup codes** (shown exactly once).
- Disabling requires the **current password** — a stolen session alone can't strip 2FA.
- **Mandatory-2FA roles:** `ceo, super_admin, admin, coo, cco, hr_admin`. `/auth/me` returns `requires_2fa: true` until set up; the front-end replaces the whole portal/admin with a 2FA-setup gate. (Enforcement is front-end; the API itself doesn't block on it.)

### 4.3 Google OAuth

```
GET /auth/google → Google consent (state cookie, 10 min)
GET /auth/google/callback → verify state → exchange code → require email_verified
  • New accounts are ALWAYS created as customer (no auto-staff path)
  • Offboarded/inactive users are rejected
  • Session minted directly (note: OAuth sign-in bypasses the TOTP challenge)
  • Redirect by role (customer→/account, admin tier→/admin, else /portal)
```

### 4.4 Sessions, CSRF, logout

| Item | Behaviour |
|---|---|
| Session cookie | `azone_session`, 32 random bytes; **only the SHA-256 hash is stored in D1** |
| TTL | 12 hours (DB + cookie) |
| CSRF | Double-submit: `csrf_token` cookie must equal `X-CSRF-Token` header on mutating requests; `Origin` header must match the allowed origin (apex + www) |
| Logout | `POST /auth/logout` deletes the session server-side and clears **both** cookies; `{ all: true }` revokes every session for the user |
| Password change | Requires current password; refuses Google-only accounts; **revokes all sessions**, re-issues one for the current browser |

### 4.5 Registration & bootstrap

- `POST /auth/register` — public self-registration, **always `customer`**, min 10-char password, rate limited 5/hour/IP.
- `POST /auth/setup` — one-time super-admin bootstrap gated by `SETUP_TOKEN`; only works while zero super_admins exist, then 410 Gone forever.
- Staff accounts are created by HR (`POST /staff/users`, limited to 5 staff roles, company-domain email enforced) or by admins (`POST /users`, any role). **Role changes are super_admin only.**

---

## 5. Public Website Workflow

### 5.1 Pages

Marketing pages (`/`, `/about`, `/services`, `/packages`, `/portfolio`, `/case-studies`, `/blog`, `/blog/[slug]`, `/careers`, `/contact`, `/faq`, `/privacy`, `/terms`) are static HTML composed from `constants/`. The Navbar/Footer/PageShell come from `components/layout/`.

### 5.2 Content override flow (static + CMS hybrid)

```
Page renders with constants defaults
   └── <Editable id="home.hero.headline"> etc. fetch /api/v1/content-public (cached 60s, once per load)
         key found in D1 site_content → CMS text replaces the default
         key absent / API down       → the built-in constant stays  (site can never break)
Same pattern: /portfolio + /testimonials (D1-backed lists), /packages (public rate card)
```

### 5.3 Contact / enquiry flow

```
Visitor → /contact form → POST /api/v1/enquiries  (public, rate-limited 5/hour/IP)
  → row in D1 (status: new)
  → staff see it: admin CMS "Enquiries" tab, or portal CustomerEnquiriesCard
  → staff update status: new → contacted → qualified → closed
  → staff may attach an in-app reply → the customer reads it on /account (reply auto-marks "contacted")
WhatsApp deep links (wa.me/60123834821) remain the primary CTA everywhere.
```

### 5.4 Public token-gated pages (no login)

| Page | Fed by | Purpose |
|---|---|---|
| `/doc?t=<32-hex>` | `GET /api/v1/public/doc/{token}` | Share a QT/DO/INV with a customer over WhatsApp. Read-only, revocable, `noindex`. "Save as PDF" prints from an iframe. |
| `/report?t=<token>` | `GET /api/v1/client-report` | Monthly client report: live sessions vs last month, settled amount, hours live, best hours. "A client can forward this to their boss." |

### 5.5 PWA

Root layout registers `public/sw.js` (network-first, `/api/*` never cached, offline falls back to cached `/portal`). `manifest.json` has `start_url: "/portal"` — installing the PWA is aimed at staff. Push notifications land in the service worker and open/focus `/portal`.

---

## 6. Admin CMS Workflow (/admin)

**Who:** effectively `super_admin` + `admin` only (all staff roles are redirected to `/portal`, customers to `/account`, and mandatory-2FA users see the setup gate first).

| Tab | Workflow |
|---|---|
| **Dashboard** | Counts (enquiries/new, posts, portfolio, testimonials) + recent audit activity from `/dashboard/summary`. |
| **Website** | The friendly CMS: labelled field groups mapped to exact `<Editable>` keys (`home.hero.headline`, `about.body1`, `footer.slogan`, `stats.items` JSON…). Empty field = the live site shows the built-in default. Saves via `PUT /content/:key`. |
| **Enquiries** | Triage contact-form messages: set status, write in-app replies (surface on the customer's `/account`). |
| **Portfolio / Testimonials / Posts** | Generic CRUD panels over the D1 tables the public pages read. Public reads see only published/visible rows. Delete requires admin rank. |
| **Media** | Upload to R2 (`uploads/` prefix → public, immutable cache). Images are client-compressed first (`lib/compress-image.ts`, max 1600px, JPEG q0.82). SVG uploads are blocked (stored-XSS protection). Copy-URL / delete. |
| **Users** | All accounts across the 11 roles: create, change role (**super_admin only**), suspend, force logout, offboard. Offboarding (CEO+) sets employment status, kills sessions + 2FA, but deliberately leaves `is_active` so the leaver still appears in final-month payroll. |
| **Staff** | A bridge into the same staff modules the portal uses (leave approvals, directory, badges) with admin authority — same guarded, audit-logged APIs. |
| **Audit** | Filterable audit-trail viewer (sign-ins, user changes, …) + SystemHealthCard: last 20 errors from `error_log`, latest nightly R2 backup + "Back up now", pending migrations. |
| **Account** | Change password (revokes every other session). |
| **Advanced** | Raw `site_content` key/value editor for anything the Website tab doesn't cover. |

`/admin/permissions` is a standalone **read-only, client-side approximation** of the permission matrix — the real policy is `can()` server-side.

---

## 7. Staff Portal Workflow (/portal)

**Who:** every staff role. What each person sees = static tab matrix → overridden by the CEO's tab-access settings → cards inside a tab gated again by role (denied cards show a 🔒 placeholder). Last-used tab is remembered per user. Dark mode, mobile bottom nav, real-time bell (SSE + poll + push).

### 7.1 Attendance & Overtime

```
Daily flow (shift = 10:00–18:00 MYT, Mon–Fri):
  clock_in  (once) → classified at write time:  ≤10:00 ok · 10:01–12:00 late · >12:00 half_day
  clock_out (once) → before 18:00 early_out · else completed
  IP, user-agent, optional GPS stored. Double punch → 409 with the original time.

Overtime (separate punches, never self-approving):
  weekdays: OT buttons appear at 18:00 MYT, require today's clock-in
  weekends: every hour is OT — open all day, no clock-in prerequisite
  ot_in + ot_out → "pending" queue → ceo/coo/admin approve or reject (never their own)
  → decision bell-notifies the staff member → ONLY approved OT feeds payroll
  Ineligible: executives (ceo/coo/cco), admin tier, part_time staff.

HR/CEO exception tools: manual insert, amend punches (audited), today's monitor, payroll CSV export.
```

### 7.2 Leave

```
Types: annual (14) · medical (14) · emergency (3) · unpaid · replacement
Apply: type + dates + days (≤60) + reason + optional MC attachment

Approval chain (role-dependent, no one acts on their own request):
  ordinary staff : applied → hr_reviewed → pre_approved (COO/CCO) → approved (CEO)
  coo / cco      : applied → hr_reviewed → pending_final → approved (CEO)
  Reject at any stage is terminal · owner may cancel while still in flight
  Every transition bell-notifies the applicant and is audited.

Balances: pro-rata by month over the operating window (2026 = Jul–Dec), half-day steps.
  Exceptions: medical leave = full statutory entitlement from day one; unpaid never pro-rated.
HR maintains per-staff per-year entitlements; holidays come from the company calendar.
```

### 7.3 Claims (expense reimbursement)

```
Submit (any staff with claims_submit): 1–10 lines, categories travel/meal/accommodation/
equipment/medical/other — mirrors paper form AZOO-HR-CLM-001. Receipt upload ≤8 MB (PDF/JPG/PNG).

Approval chain by claimant role:            Decision = super_admin/ceo ONLY
  staff    : HR review → COO pre-approval → CEO
  hr_admin : CCO pre-approval → CEO
  coo/cco  : CEO
  ceo/admin: CEO

Special rules:
  • Payee ≠ claimant supported (payment-routing remark, visible to CEO/admin/HR only)
  • An approver who IS the payee is barred from acting — that stage is waived by design,
    routed straight to the CEO with the reason attached
  • Attaching a receipt to a REJECTED claim auto-resubmits it (clears chain stamps, re-notifies)
  • Approved claims lock; pending/rejected stay editable
  • After approval: payment proof upload → mark paid → feeds expenses/P&L
```

### 7.4 Payroll

```
Who processes: super_admin, admin, ceo, coo  (hr_admin writes entries; coo/cco read-only in UI)
Monthly entry per person: basic + commission + allowance + OT (hours→sen) + deductions
  → net_cents STORED (not re-derived) so expenses/P&L can never drift

Part-time live hosts: computed server-side from clocked minutes × RM15/h, OT forced 0 — tamper-proof.
Recompute: re-derives the month's working days from the holiday calendar, rewrites stale rows.

Payslip release: 5th of the following month, 10:00 MYT, shifted FORWARD past weekends/holidays.
  Manual early release + undo available. Staff see their own slip on Profile ("MyPayslip"),
  printable A4 + shareable PDF (lib/payslip-pdf.ts).

Bank payment: Maybank2E — CSV matching the "Salary Bulk Payment (MY)" sheet, or a fully
  filled .xlsm generated in-Worker (m2e.ts, macros preserved). Payment date = 5th shifted
  EARLIER off weekends (deliberately opposite to payslip release).
```

### 7.5 Inventory, Postage & Fulfilment

```
Inventory (permission: inventory; execs read):
  status auto-derives: 0 = out_of_stock · ≤5 = low · else in_stock
  deductions guarded: UPDATE … WHERE stock >= qty → concurrent shipping can't go negative
  manual out + sold price → recorded sale (counts toward revenue); without price → correction
  supplier returns tracked to credit-received or replacement-received
  crossing ≤5 bell-notifies sales_marketing + ceo (once, re-armed on recovery)

Postage (one record = one outbound order, ≤20 item lines):
  duplicate lines merged → ALL lines validated against stock → all-or-nothing commit
  statuses: preparing → shipped → in_transit → delivered · returned (restocks exactly once)
  TikTok orders arrive automatically as TT-{order_id} (webhook + 30-min sync)
  Fulfilment card: this month's shipments by status + oldest order still preparing
```

### 7.6 Sales documents — see [section 9](#9-sales-documents--numbering)

### 7.7 Live sessions & GMV

```
Management (ceo/coo/cco/hr_admin/admin) schedules: host + client + platform + date/time slot.
Hosts see only their own sessions.
Attribution: TikTok orders timestamped inside a completed session window are credited to
  that host → feeds /gmv, the leaderboard, and commission.
/gmv is open to EVERY staff role by design ("motivation, not payroll"):
  company GMV today / this month / last 7 days + your own session take.
Booking a session clears the client's "gone quiet" flag.
```

### 7.8 Sales pipeline (Prospects)

```
Stages: lead → contacted → meeting → proposal → negotiation → won | lost
Any staff can read + add a lead; only the sales tier moves stages / reassigns / deletes.
Lead carries: source (tiktok/shopee/ig/fb/expo/referral/other), niche, contact, value, owner.
next_followup date → 30-min cron bell + web-push to the owner once per due date.
Insights endpoint: stage counts + per-source win rates.
```

### 7.9 Content production board

```
Kinds: video / reel / live / campaign / other · Platforms: tiktok / shopee / ig / fb / other
Flow: idea → script → shoot → edit → approval → posted (posted_at auto-stamped)
Holds script, caption, campaign tag, scheduled date, assignee, post-hoc performance note.
Assignment bell-notifies the assignee. All staff read; edits need CONTENT_MANAGE.
```

### 7.10 Stokis (resellers/distributors)

Register of distributors with commission %, location, status. Orders logged underneath (amount, qty, paid/unpaid); the list aggregates lifetime total, **outstanding balance**, month volume vs target, and the commission that volume earns. Reads are restricted too (contact PII + financials).

### 7.11 Tasks, reports & BD

Staff create tasks for themselves; `team_manage` roles assign to others and see all, with threaded comments. `task-reports` = daily/weekly/monthly written reports (HR writes, executives read). `ops-reports` (one per day per author) and the `bd` pipeline (open/pending/kiv/closed_won/closed_lost) are executive-view. `materials` is a lightweight material-request queue.

### 7.12 HR extras

Staff Details tab → staff directory + **ID badge printing** (ISO ID-1 85.6×54 mm) with an **amendment lock**: once a field is saved it greys out for HR and only admin can change it (enforced server-side). Staff document vault (contracts, offer letters) in R2 under `private/staff-docs/`. Birthdays tab; holidays/company calendar; events with `.ics` download; announcements with per-user acknowledgement.

### 7.13 Finance, revenue & targets

```
ONE revenue arithmetic (revenueLines()) buckets every ringgit:
  product  = TikTok orders + other postage + manual sales + paid product invoices
  service  = paid service invoices
  invoices = honest bucket for pre-migration rows
  → /revenue, /finance/pnl and the business-lines card can never disagree.

Expenses: tracked with due dates + paid marking; ExpensePie + PnlCard visualize.
Commission rules: base_pct on all sales + bonus_pct above target, scoped to role or all;
  when several rules apply, the most staff-friendly one wins.
Leaderboard: attributed sales per person vs monthly target + commission the rules would pay —
  visible to everyone with revenue_view ("the motivational heart of the sales floor").
Targets: company KPI = super_admin/ceo/coo only; per-user/team targets = TARGET_ADMIN_ROLES.
Overview tab: exec-only aggregate (attendance today, pending leave, docs, low stock, BD,
  events, ops reports, task stats, inventory) in one batch.
```

---

## 8. Customer Account Workflow (/account)

Three tabs for `customer` accounts:

1. **Account** — name/email, change password (Google-only accounts see an explanation instead), ELFIA store link.
2. **Orders** — the customer's sales documents (QT/DO/INV with payment + delivery status and `/doc` share links) and booked live sessions. *Note: order history unlocks only for Google-verified accounts; password-registered customers see a locked state.*
3. **Enquiries** — submit a categorized enquiry (`general | package_pricing | live_commerce | order_delivery | collaboration`) and read staff replies. New enquiries bell-notify the business team immediately.

Registration (`/login` → Register) always creates a customer account, active immediately.

---

## 9. Sales Documents & Numbering

### 9.1 Document lifecycle

```
QT (quotation) ──convert──▶ INV (invoice) ──paid──▶ RC (receipt, idempotent)
     │                          │                        └─ CN (credit note, capped at invoice total)
     └─ DO (delivery order)     └─ product INV moves stock the moment it exists

• Each doc belongs to ONE business line: product or service
• DO = goods only, never charges · service docs force delivery to 0
• Line discounts → then document discount → then tax → delivery added last (pass-through)
• Backdating allowed (never future-dating) · customer_id 0 = "Walk-in Customer"
• Convert is one click (same items, fresh INV number, audited, reversible via unconvert)
• Share: mints a 32-hex token → public read-only /doc?t=… link for WhatsApp → revocable
• PATCH updates delivery/payment status · outstanding report lists unpaid oldest-first
```

Creating QT/DO requires the `sales` permission; INV requires `finance`.

### 9.2 Numbering (current format, v1.4.4+)

```
{TYPE}-AZOO{DDMMYY}-{N}        e.g.  QT-AZOO300726-1 · INV-AZOO010826-1
```

- Types: `QT`, `DO`, `INV`, `RC`, `CN`. Date is Malaysia time (UTC+8).
- `N` = per-type per-day counter (`doc_counters_daily`), atomic upsert, resets daily, widens past 99 automatically.
- **Numbers are immutable** — a cancelled doc keeps its number and is VOIDed (LHDN e-Invoice: unique numbers, explainable gaps). The document *chain* (QT→DO→INV links) is stored in columns, never encoded in the number.
- Legacy formats (`QT202600001`, `DO20260725-01-AZOO`) remain valid forever; formats are never applied retroactively.

### 9.3 Printing/PDF

One HTML template (`lib/doc-template.ts`) is shared by the portal print popup and the public `/doc` page. A hand-rolled PDF writer (`lib/doc-pdf.ts`, few KB, no library) produces shareable PDFs; `payslip-pdf.ts` and `form-pdf.ts` (claim/leave forms) build on the same primitives; receipts/credit notes print via a letterhead window (`lib/receipt-print.ts`).

---

## 10. Notifications Workflow

Everything flows through **one function** — `notify(env, userId, kind, message, ref)`:

```
notify()
  ├─ 1. INSERT INTO notifications      ← always; the durable in-app record (the bell)
  ├─ 2. Web Push to every registered device (best-effort; dead subscriptions pruned)
  └─ 3. POST to NOTIFY_WEBHOOK relay if configured (email/WhatsApp decided by the relay)
```

**Delivery to the browser (portal):**

- Initial fetch of the last 7 days (limit 50); announcements are backfilled so the bell never depends on publish ordering.
- **SSE** stream `GET /staff/notifications/stream?since=N` — Worker polls D1 every 5s, self-closes ~20s, EventSource auto-reconnects (~5s latency without Durable Objects). Plus a 120s poll safety net and refetch on window focus.
- New unread count plays a synthesized two-tone chime (user-toggleable).
- **Web Push** (v1.6.0): from-scratch RFC 8291/8292 implementation in the Worker (VAPID ES256 JWT + aes128gcm payload encryption). If VAPID keys aren't configured, push is simply off; in-app + SSE still work.

**`ref`** is a stable dedupe/deep-link key (`claim:123`, `leave:45`, `ot:2026-08-13`, `stock:12`, …). Kinds include `claim, leave, ot, event, announcement, stock, prospect, sales, birthday, system, content`.

---

## 11. TikTok Shop Integration

```
Order placed on TikTok Shop
  │
  ├── Webhook  POST /integrations/tiktok/webhook  (≤64 KB body)
  │     • verified by TikTok HMAC signature OR relay shared-secret
  │     • EVERY receipt recorded in webhook_events (even unverified → diagnosable, 401'd,
  │       rate-limited 30/h, table trimmed to newest 2000)
  │     • paid/new/awaiting_shipment → create postage record TT-{order_id}
  │       + deduct stock per SKU (all-or-nothing)
  │     • cancelled/returned → restock exactly once
  │
  └── Cron sync every 30 min (runTikTokSync)
        • pulls last 30 days of orders via Get Order List
        • RETRY PASS: orders with zero stock movement re-attempted against current
          inventory — fixing a SKU heals past orders on the next sync
        • manual backfill: POST /integrations/tiktok/sync (sync_manage)

Authorization: GET /integrations/tiktok/callback (ceo/coo/admin) exchanges the OAuth code,
stores tokens + shop_cipher in integration_tokens.
Health: /integrations/tiktok/status (configured, authorized, last event/order, failures 7d)
  → portal ConnectionStatusCard. /webhook-debug shows raw recent receipts.
Live analytics: /live-analytics — TikTok LIVE GMV/views/likes etc., 30-min cache.
```

---

## 12. Scheduled Jobs (Cron)

Three cron expressions in `worker/wrangler.toml`:

| Schedule | Job |
|---|---|
| `20 19 * * *` (03:20 MYT) | **Nightly DB backup** — dumps every app table (≤50k rows each) as gzipped JSON to R2 `backups/db-YYYY-MM-DD.json.gz`; keeps the newest 30. |
| `0 1 * * *` (09:00 MYT) | **Birthday greetings** — 🎂 notification to all active staff for each staff birthday today. |
| `*/30 * * * *` | Six jobs in sequence: **(1)** TikTok order sync + healing retry pass · **(2)** low-stock sweep (≤5 units → notify sales_marketing + ceo, once per level) · **(3)** pipeline follow-up reminders due today (bell + push, once per due date) · **(4)** housekeeping (expired 2FA challenges, stale rate-limit rows) · **(5)** "client gone quiet" — clients with no live session in 14 days → notify sales team, re-armed every 14 days · **(6)** new-error alerting — new `error_log` rows since the watermark → notify super_admin + ceo with a top-3 source breakdown. |

---

## 13. Data & Storage

### 13.1 D1 (SQLite)

Database `azoneofficial`, built up by **69 migrations** (`worker/migrations/0001…0069`). Major table families: users/sessions/2FA, rate_limits, site_content + CMS tables (posts, portfolio, testimonials, media), enquiries, staff modules (attendance, leave + entitlements, claims + items, payroll, inventory + manual outs + supplier returns, postage + items, docs + doc_counters_daily, live_sessions, events, holidays, announcements, tasks, prospects, content board, stokis + orders + targets, assets, expenses, targets/commission rules), notifications + push subscriptions, webhook_events, integration_tokens, error_log, audit log, system_meta.

`GET /health/migrations` reports pending state; the front-end shows a migration banner if the deployed Worker is behind.

### 13.2 R2 (object storage) — default-deny access

| Prefix | Contents | Who can read |
|---|---|---|
| `uploads/` | Site media (CMS) | **Public**, immutable 1-year cache |
| `backups/` | Nightly DB dumps | super_admin only |
| `private/staff-docs/{userId}-…` | Contracts, offer letters | Owner, HR, executives |
| `private/staff-photos/{userId}-…` | Badge photos | Any staff |
| `private/m2e/template.xlsm` | Maybank2E payroll template | payroll_export roles |
| `claims/{claimId}-…` | Receipts & payment proofs | Claimant, payee, HR, decider, executives |

Any SVG/HTML/XML content is forced to download (`Content-Disposition: attachment`) so user-supplied markup can never execute on the API origin. All uploads stream directly to R2 (no buffering); images are compressed client-side first.

### 13.3 Secrets & config (Worker)

- **Plaintext vars:** `ALLOWED_ORIGIN`, `COMPANY_DOMAIN`, `GOOGLE_CLIENT_ID`, `TIKTOK_APP_KEY`.
- **Secrets** (`wrangler secret put`): `SESSION_PEPPER`, `GOOGLE_CLIENT_SECRET`, `SETUP_TOKEN`, `TIKTOK_APP_SECRET`, `TIKTOK_WEBHOOK_SECRET`*, `VAPID_PUBLIC_KEY`*, `VAPID_PRIVATE_KEY`*, `VAPID_SUBJECT`*, `NOTIFY_WEBHOOK`* (*optional — features degrade gracefully without them).

---

## 14. Development & Deployment Workflow

### 14.1 Local development

```bash
pnpm install
pnpm dev            # Next.js on http://localhost:3000
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm build          # next build → static export to /out
```

The Worker lives in `/worker` with its own `wrangler.toml`, migrations, and package.json (deployed with `wrangler deploy`; migrations applied with `wrangler d1 migrations apply`).

### 14.2 Deployment pipeline

```
Developer → git commit → GitHub (a2zcreative-my/azoneofficial)
   main branch    → Cloudflare auto-deploy → azoneofficial.com  (static assets from /out)
   develop branch → Cloudflare preview deployments per branch/PR
Worker (API): deployed separately via wrangler; claims /api/* on the same domain.
```

GitHub is the single source of truth. Rollback = `git revert` on main (preferred) or Cloudflare dashboard → Deployments → Rollback.

### 14.3 Conventions that keep the codebase safe

- Content lives in `constants/`, never hard-coded in components.
- Empty data = hidden section or honest "in preparation" — no fake numbers.
- ELFIA is a **featured client**, never presented as a house brand.
- Every public D1-backed component degrades to constants when the API is down.
- Every privileged action is audit-logged; stock/counter writes are atomic/guarded.
- Design system: 8px grid, Poppins, WCAG 2.1 AA, no gradients/neon/clutter.

---

## 15. Quick Reference

### Who can do what (high-level)

| Action | Roles |
|---|---|
| Decide claims | super_admin, ceo |
| Approve leave (final) | ceo |
| Process payroll | super_admin, admin, ceo, coo |
| Change a user's role | super_admin |
| Offboard staff | ceo+ |
| Manage tab access | ceo, super_admin |
| Edit site content / media | super_admin, admin |
| Manage enquiries | admin tier + ceo/coo/cco + sales_marketing/marketing/hr_admin |
| Set company KPI target | super_admin, ceo, coo |
| Create staff accounts | HR (5 staff roles) / admins (any role) |
| Download DB backup | super_admin |

### Key URLs

| URL | What |
|---|---|
| `/login` | Single sign-in door (password, Google, 2FA) |
| `/admin` | CMS + users + audit (admin tier) |
| `/portal` | Staff portal (all staff roles) |
| `/account` | Customer area |
| `/doc?t=…` | Public shared sales document |
| `/report?t=…` | Public client monthly report |
| `/api/v1/health` | API uptime probe |

### Daily rhythm of the system

```
09:00 MYT  birthday notifications
10:00 MYT  shift starts (clock-in classification threshold)
18:00 MYT  shift ends · OT punches open (weekdays)
every 30m  TikTok sync · low-stock sweep · follow-ups · housekeeping ·
           quiet-client check · error alerting
03:20 MYT  nightly DB backup to R2 (30 kept)
5th 10:00  payslips release (shifted forward past holidays/weekends)
5th        salary payment date (shifted earlier off weekends)
```

---

*This reference was generated from the v1.7.x source (app/, worker/src/, constants/, lib/) and the in-repo docs (ARCHITECTURE.md, API.md, DEPLOYMENT.md, DOCUMENT-NUMBERING.md). For granular per-version history see CHANGELOG.md and MILESTONES.md in the repo.*
