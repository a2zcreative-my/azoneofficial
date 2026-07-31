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
