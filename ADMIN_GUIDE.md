# Admin Guide

> **First-time sign-in:** create your super admin account via the one-time bootstrap curl in `worker/README.md` (uses your SETUP_TOKEN secret; nothing is hardcoded). After that, sign in normally at `/login` with email/password or Continue with Google.

> The admin v0 is LIVE at `/admin` (after Worker deploy + first super admin creation — see worker/README.md).

## Using admin v0
1. Visit azoneofficial.com/admin — sign in with email+password or **Continue with Google**. New teammates can self-register (any valid email); their accounts stay pending until a super admin activates them in **Users**. Google accounts on @azoneofficial.com are approved automatically.
2. **Dashboard** — enquiry and product counts
3. **Enquiries** — every contact-form submission with a status workflow: new → contacted → qualified → closed
4. **Products / Posts / Portfolio / Testimonials** — create, edit, delete; public pages show only published/visible items
5. **Media** — upload files to R2, preview images, copy public URLs, delete
6. **Content** — no-code website edits. These keys are LIVE on the public site (set them and the page updates within a minute, no deploy):
   - `home.hero.headline` · `home.hero.subheadline` — homepage hero
   - `about.body1` · `about.body2` — About section paragraphs
   - `home.cta.heading` — closing CTA headline
   - `footer.slogan` — footer tagline
   - `contact.intro` — Contact page opening line
   Other keys can be saved for future wiring; values can be text or JSON
7. **Users** (super admin only) — add team members, change roles, activate/deactivate (deactivation revokes sessions), reset passwords

## Roles & permissions (planned)
| Capability | Super Admin | Admin | Editor | Marketing |
|---|---|---|---|---|
| Manage users & roles | ✅ | — | — | — |
| Edit site content / menus / SEO | ✅ | ✅ | ✅ | — |
| Products / portfolio / blog / media / testimonials | ✅ | ✅ | ✅ | — |
| View & manage enquiries/leads | ✅ | ✅ | — | ✅ |
| View dashboard analytics | ✅ | ✅ | ✅ | ✅ |
| Audit log | ✅ | ✅ | — | — |

## Content editing principle
No code changes should be required to update website content. Every editable string maps to a `site_content` key (DATABASE.md).

## Until Phase 3 ships
Content is edited in `constants/*.ts` and deployed by git push — see USER_GUIDE.md.


## Role matrix (v1.4.4)

Roles are assigned in **/admin → Users**. Staff sign in with their
`@azoneofficial.com` Google account (auto-provisioned) or email + password, and
land in **/portal**. Every rule below is enforced server-side; the tabs are a
convenience, not the boundary. Standard working shift: **10:00am–6:00pm MYT,
Monday–Friday** — all attendance events are flagged against it (late / early
out / weekend).

| Role | Portal tabs | Can do |
|---|---|---|
| **HR & Administrative** (`hr_admin`) | HR, Sales, Leave, Attendance, Tasks, Profile | Verify every staff member's attendance in a table (company accounts, shift-checked); file task reports daily/weekly/monthly; create QT/DO/INV numbered `QT-AZOODDMMYY-X`; administer Annual/Medical/Emergency leave (approve/reject in Leave); maintain staff birthdays via the staff directory; own clock in/out |
| **Sales & Marketing** (`sales_marketing`) | Inventory, Leave, Attendance, Tasks, Profile | Update sales-side inventory in real time (stock counts auto-set in_stock/low/out_of_stock); keep postage tracking records current; request and track marketing materials; apply for leave; clock in/out |
| **Chief Commercial Officer** (`cco`) | Commercial, Leave, Attendance, Profile | Maintain the business development pipeline — open / pending / KIV / closed won / closed lost — with strategy and next-action notes per deal; apply for leave; clock in/out |
| **Chief Operation Officer** (`coo`) | Operations, Inventory, HR view, Leave, Attendance, Profile | File the daily operational status and daily sales results (one per day, re-submitting updates it); record operation strategy for sales & marketing; apply for leave; clock in/out |
| **Chief Executive Officer** (`ceo`) | Overview, HR view, Leave, Attendance, Profile | Read-only monitoring across the whole company: who clocked in today, pending leave, documents issued, low stock, BD pipeline totals, latest operational report |

Notes:
- `hr_admin` gets the Sales tab because document creation (QT/DO/INV) is an
  administrative duty here; finance status changes stay with `finance_admin`.
- The CEO deliberately has **no edit rights** in the modules — review and
  monitoring only, per the role definition.
- Leave types supported: Annual, Medical, Emergency (unchanged from v1.2.x).

## History (do not remove)
| Version | Change |
|---|---|
| v1.4.4 | Role matrix added: hr_admin, sales_marketing, cco, ceo (+existing coo duties expanded). |


## Editing the website (v1.4.5)

/admin → **Website** edits the live site's text field by field — each field is
labelled with where it appears (hero, about, services, showcase, footer,
statistics). Save one field at a time; the site picks it up on the next page
load. An empty field falls back to the built-in default, so nothing here can
blank the page. Anything not listed lives in **Advanced** (raw content keys).
Text that is structural — service card contents, package tiers, page layouts —
stays in code by design: changing structure safely needs a build, not a live
edit.

| Version | Change |
|---|---|
| v1.4.5 | Website tab added; Products tab removed; Advanced replaces raw Content. |


## Forgotten passwords (v1.4.6)

/admin → Users → **Reset password** on the user's row. Set a temporary password
(10+ characters), tell them directly, and ask them to change it in their
Profile after signing in. Setting a password signs the user out of every
device. Admins cannot reset a super admin's password; a super admin can.
Google-sign-in staff never need this — their password is their Google account.

| Version | Change |
|---|---|
| v1.4.6 | Admin reset-password flow added to Users. |


## Who works where (v1.4.9)

- **/admin** — content team only: super_admin, admin, editor, marketing.
- **/portal** — every staff role: ceo, coo, cco, managing_director, hr_admin,
  sales_marketing, business_dev, finance_admin, live_manager, live_host.
- **/account** — customers.
A staff role opening /admin is redirected to /portal automatically; the API
enforces the same boundary. Passwords: see docs/PASSWORD-GUIDE.md.

| Version | Change |
|---|---|
| v1.4.9 | Interface map added; PASSWORD-GUIDE referenced. |


## Admin authority map (v1.4.11)

Admin and super admin have **full authority across the system**:
- /admin → Website, content, enquiries, portfolio, testimonials, posts, media
- /admin → Users: create, roles, suspend, force logout, reset passwords
- /admin → **Staff**: approve/reject all leave (with comment + audit + notification), and entry to every staff module
- /portal: full rights in HR, Inventory, Commercial, Operations, Overview
Super admin additionally manages other admins. Staff roles remain barred from
/admin (v1.4.9) — authority flows down, never sideways.

| Version | Change |
|---|---|
| v1.4.11 | Staff tab (leave administration + module bridge) added to /admin. |


## Role model (v1.4.14) — definitive

Eleven roles across three interfaces. The API enforces every capability;
interfaces follow.

### Interfaces
- **/admin** — super_admin, admin only. Full website/content/CMS + Users + Staff (leave, etc.).
- **/portal** — all staff roles below.
- **/account** — customer.

### Roles and capabilities

| Role | Home | Capabilities |
|---|---|---|
| **super_admin** | /admin | Everything, incl. managing admins |
| **admin** | /admin | Full /admin: website, content, users (suspend/force-logout/reset), Staff leave admin |
| **editor** | /portal | Task pipeline + task updates. **No inventory visibility.** No content editing (moved to admin tier) |
| **marketing** | /portal | Task pipeline + task updates. **No inventory visibility.** No content editing |
| **live_host** | /portal | Task pipeline + task updates. No inventory visibility |
| **hr_admin** | /portal | HR pipeline: documentation (QT/DO/INV), leave updates, **attendance CSV export for payroll**, birthdays, task reports |
| **sales_marketing** | /portal | Own pipeline + tasks + **inventory control, postage tracking, materials**. Cannot see editor/marketing work |
| **ceo** | /portal | **Read-only** view across all role features (except super_admin/admin surfaces). No write — leave decisions and suspensions stay with the admin tier |
| **coo** | /portal | HR-level: docs (QT/DO/INV), leave updates, attendance CSV, **view tasks across all roles except CEO exec data** |
| **cco** | /portal | Same as COO in this model: HR-docs, leave, attendance CSV, task oversight (excl. CEO exec data) |
| **customer** | /account | Own details, enquiries, password |

### Removed roles
`managing_director`, `business_dev`, `finance_admin`, `live_manager` — removed
in v1.4.14. Migration 0009 reassigns any existing holders (MD→admin,
business_dev→cco, finance_admin→hr_admin, live_manager→live_host) and tightens
the database constraint. Reassign individually in /admin → Users if a default
is not right for a specific person.

### Design notes
- **CEO is view-only by your instruction.** The earlier draft gave CEO a kill
  switch; that was declined to keep exec strictly monitoring. Suspending
  resigned staff is done by admin/super_admin in /admin → Users.
- **COO and CCO are intentionally identical** in this model (HR-docs + leave +
  attendance CSV + task oversight). Their earlier Operations/Commercial
  modules are retired; the underlying data endpoints remain reachable to the
  admin tier only, so nothing is orphaned.
- **editor/marketing lost content editing** — that now requires super_admin or
  admin. This is the trade for moving them fully into /portal.

| Version | Change |
|---|---|
| v1.4.14 | Role model reduced to 11 roles; capabilities remapped; migration 0009. |


## Leave approval flow (v1.4.15)

- **Staff request** → HR review (hr_admin/admin) → pre-approval (COO or CCO) → **CEO final approval**.
- **COO/CCO request** → HR review → **CEO final approval** (no pre-approval — they can't approve their own tier).
- Reject at any stage ends the request. The applicant can cancel while it's still moving. No one can act on their own request. super_admin/admin can act at any stage.
- Each reviewer sees only what's waiting at their stage, in /portal → Leave (or /admin → Staff).

## ID badges (v1.4.15)

/admin → Staff → Staff directory. Fill employee ID, position, department, issue
date, blood type, then **Print badge** — it prints at 85.6 × 54 mm (government
card size).

| Version | Change |
|---|---|
| v1.4.15 | Leave chain + ID badge documented. |


## Payroll, calendar & audit (v1.4.16)

- **Leave entitlement**: /admin → Staff → set days per person per type. Balances deduct approved leave automatically.
- **Holidays**: /admin → Staff → add public/company holidays; staff see the calendar and leave-counting can skip them.
- **Payslip**: /admin → Staff → pick a person and month → Generate → Print (A4 attendance + leave summary for payroll).
- **Audit**: /admin → Audit → full activity trail with filters (sign-ins, users, leave, holidays, tasks).
- **Document PDFs**: /portal → Sales → PDF on any QT/DO/INV for a branded, printable document.
- **Off-platform alerts**: set the `NOTIFY_WEBHOOK` Worker variable to relay approvals/assignments to email or WhatsApp.

| Version | Change |
|---|---|
| v1.4.16 | Entitlement editor, holidays, payslip, audit viewer, document PDFs, notify webhook. |


## Staff directory access (v1.4.17)
Employee-field editing and ID badge printing are available to:
- super_admin / admin — /admin → Staff
- hr_admin / coo / cco — /portal → HR
Same tool, same API. Set employee_id / position / department / issue date /
blood type, then Print badge (85.6 × 54 mm).

| Version | Change |
|---|---|
| v1.4.17 | Staff directory + badge added to portal HR tab (hr_admin/coo/cco); save-failure feedback. |


## v1.4.18 additions
- **Birthdays tab** in /portal for CEO + HR tier (CEO's write exception).
- **Overview / executive summary** (CEO/COO/CCO): adds company task progress (totals + per-staff) and inventory status monitoring.
- **Mobile**: tab bars scroll, tables scroll sideways, grids collapse to two columns on phones.
- **Profile** is a two-column layout (details + password) that stacks on mobile.

| Version | Change |
|---|---|
| v1.4.18 | Profile layout, CEO birthdays tab, mobile responsiveness, exec task/inventory summary. |


## Staff Details tab (v1.4.19)
/portal → **Staff Details** (hr_admin / coo / cco / admin tier): the full staff
list with editable employee ID, position, department, birth date, ID issue
date, blood type, and the ID badge print. Same tool that lives in /admin →
Staff for super_admin/admin.

| Version | Change |
|---|---|
| v1.4.19 | Staff Details as a dedicated portal tab for HR tier; birth date editable in the record. |


## Onboarding staff as HR (v1.4.20)
/portal → Staff Details → **Add a staff member**. HR creates staff-level
accounts (not admin/super_admin) with a temporary password; hand it over and
they change it on first sign-in. There is no auto-import from the domain —
azoneofficial.com is not on Google Workspace — so accounts are created here or
in /admin → Users.

| Version | Change |
|---|---|
| v1.4.20 | HR-scoped staff creation in Staff Details (staff roles only). |


## Add-staff form: existing emails (v1.4.21)
If the email already has an account, the form offers "Update NAME's record
instead" — it applies employee ID / position / department to the existing
account. Role and password are never changed from this path (roles in /admin;
passwords via change-password or admin reset).

| Version | Change |
|---|---|
| v1.4.21 | Add-staff form updates an existing account's employee fields on email conflict. |


## Badge & record policy (v1.4.22)
- **Preview badge** shows the live card before printing; print matches exactly.
- Records carry **full name (as per IC)** and **phone**; blood type is retired.
- The badge shows the **company logo**, role, full name, employee ID, position,
  department, phone, SSM number and issue date.
- **Amendment lock**: HR fills empty fields; once saved, a field locks (🔒) and
  only an admin can change it in /admin → Staff. The API enforces this — the
  lock is real, not cosmetic. Birthdays lock the same way.

| Version | Change |
|---|---|
| v1.4.22 | Live badge preview; amendment lock (admin-only edits of set fields); full name + phone on badge; logo replaces wordmark; blood type retired. |


## Badge v2 (v1.4.23)
Portrait card (54 × 85.6 mm) with: company logo, staff photo, full name, role,
employee ID, position, department, phone, and a footer carrying the company
location (Setia Tropika, Johor Bahru), SSM number and issue date.
**Upload photo** on each row sets the picture (HR uploads first, replacement is
admin-only — same lock as record fields). Photos are private: they serve only
to signed-in staff.

| Version | Change |
|---|---|
| v1.4.23 | Portrait badge with staff photo + company location; private photo storage. |


## v1.4.24 notes
- Dates in Staff Details are DD-MM-YYYY on screen (stored ISO underneath).
- Blood type is record data only — captured at create and editable in the grid,
  never printed on the badge.
- The add-staff form captures birth date, ID issued and blood type up front,
  and the temp password box has the show/hide eye.

| Version | Change |
|---|---|
| v1.4.24 | DD-MM-YYYY display; blood type back as record-only data; create form captures birth/issued/blood; password eye on temp password. |


## v1.4.25 notes
- Lists (staff, leave, tasks, announcements, birthdays, attendance, holidays,
  audit) scroll within a fixed height to keep pages compact.
- The add-staff form takes an optional photo, attached automatically on create.
- The dashboard no longer displays the shift-rule text; punches still confirm
  their result.

| Version | Change |
|---|---|
| v1.4.25 | Scrollable list areas across tabs; photo picker in add-staff; shift-rule text removed from dashboard. |


## v1.4.26 note
Announcements ring the bell for all active staff (and the off-platform relay
when configured); clicking the notification opens the Announcements tab.

| Version | Change |
|---|---|
| v1.4.26 | Announcement publish fans out to every staff bell; clickable to the tab. |


## Leave accrual (v1.4.27)
Entitlement releases monthly (pro-rata, half-day steps): eligible-to-date =
annual entitlement × months elapsed / 12. Staff see "N eligible now" plus the
annual total and days used. Approvers see the same balances.

Also in v1.4.27: Birthdays readable by the CEO (write rules unchanged);
Overview's document counts renamed and explained (Quotations / Delivery
orders / Invoices created in Sales); dashboard shows pulsing badges on pending
leave, open tasks and announcements.

| Version | Change |
|---|---|
| v1.4.27 | Monthly leave accrual display; CEO Birthdays fix; overview documents clarified; dashboard pulse cues; mobile stat tiles 2-up. |


## Attendance corrections (v1.4.28)
/portal → Attendance → "Staff attendance — corrections & back-entry"
(CEO + admin tier only):
- **Add**: pick staff, clock in/out, date and time (MYT) — for days worked
  before the system existed.
- **Amend**: change a record's time inline and Save.
- **Remove**: delete a wrong record.
Every record shows its provenance (punch / manual / amended) and every action
is audit-logged with the actor. CEO's other surfaces remain read-only.

| Version | Change |
|---|---|
| v1.4.28 | CEO attendance amend/back-entry panel; provenance-marked, audit-logged. |


## v1.4.29 notes
- One clock-in and one clock-out per person per day, enforced by the API.
- Punching shows an animated confirmation card (result + MYT time); errors
  (e.g. already punched) show inline.

| Version | Change |
|---|---|
| v1.4.29 | Once-per-day punches (server-enforced); animated punch confirmation overlay. |


## Accrual window (v1.4.30)
2026 divides annual entitlement across Jul–Dec (company started 20 Jul 2026):
14/year → 2.0 by end Jul, 4.5 Aug, 7.0 Sep, 9.0 Oct, 11.5 Nov, 14 Dec.
From 2027: standard Jan–Dec twelve-month accrual, automatic.

| Version | Change |
|---|---|
| v1.4.30 | Accrual anchored to company start (Jul–Dec 2026 window; 12-month from 2027). |


## Stock movement & bell alerts (v1.4.31)
- Postage with an item + qty deducts stock on create; *returned* restocks once;
  insufficient stock refuses the record. In/Out buttons handle manual
  corrections. All movements audit-logged with quantities.
- The bell polls every 60 s (and on tab focus) and shows a pulsing amber unread
  count — announcements alert staff without a reload.

| Version | Change |
|---|---|
| v1.4.31 | Postage-driven stock movement + manual In/Out; live bell polling with pulsing unread badge. |


## Multi-item orders (v1.4.32)
Add as many item lines as the order ships, each with its own quantity. The
system merges duplicate lines, validates every line before deducting anything,
refuses the whole order if any line is short (listing the shortages), and
guards each deduction against simultaneous shipping. Verify any movement in
/admin → Audit: inventory.in / inventory.out entries carry item, qty and order
reference.

| Version | Change |
|---|---|
| v1.4.32 | Multi-item order lines with all-or-nothing, race-proof deduction. |


## v1.4.33 notes
- Medical leave: statutory — full entitlement from day one (Employment Act);
  other types keep monthly accrual.
- CEO visibility: HR, Sales (read-only, no create form), Staff Details
  (read-only incl. badge preview/print). super_admin hidden from staff lists.
- Dashboard cards click through to their tabs; bell keeps 7 days, ~5 rows
  visible with scroll. /account has Account | My Enquiries tabs.

| Version | Change |
|---|---|
| v1.4.33 | Medical full eligibility; CEO read-only HR/Sales/Staff Details; clickable dashboard cards; 7-day scrollable notifications; super_admin hidden; account tabs. |


## v1.4.34 — roles in the staff/HR area
| Role | Staff & HR data |
|---|---|
| super_admin / admin | Full edit incl. amendments |
| **ceo** | **Full edit incl. amendments** (rank rework) + HR tools in portal |
| hr_admin | Fill empty fields (amendments stay admin/CEO) + HR tools in portal |
| coo / cco | Read-only (all views + CSV export; leave pre-approval unchanged) |

Announcements: unacknowledged items pulse a NEW chip until acknowledged.
Bell: announcements backfill on read — alerts work regardless of when the
announcement was published relative to a deploy.

| Version | Change |
|---|---|
| v1.4.34 | Bell backfill; NEW announcement animation; CEO edits Staff/HR/Staff Details, COO & CCO read-only. |


| Version | Change |
|---|---|
| v1.4.35 | Self-registration (email or Google) always creates a customer; staff roles granted only via /admin Users or HR staff creation. |
