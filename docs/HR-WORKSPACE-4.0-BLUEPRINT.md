# A2Z OS — HR Workspace 4.0: Remove Duplication — Audit & Blueprint

**Status:** GATE 1 (audit) and GATE 2 (design) only. **STOPPED AT THE GATE for your explicit approval.** Nothing has been coded, migrated, deleted, re-permissioned or deployed.
**Authority:** the CEO's directive "A2Z OS — HR Workspace 4.0, Strict CEO Directive — Remove Duplication", 14-11-2026.
**Baseline:** v1.305.0 (Assets phase 3, built in the sandbox, not deployed). Every finding below was read in the code, not assumed.

**What arrived, and what did not:**
- **5 images arrived, not 8.** Images 2 and 3 are the same desktop Overview.
- I have the desktop **Overview**, **Calendar & Holidays** and **HR Policies & Settings**.
- **Missing:** the desktop **Employee Lifecycle** screen, every **Mobile PWA** screen, and the **Master Prompt** text.
- Image 1 is an older "HR Module 4.0 — Improvement" draft with 5 tabs (Overview · Employees · Leave · Payroll · Documents). It keeps Leave and Payroll inside HR, which your directive forbids. **Your written directive wins:** 4 tabs. Image 1 is used only for its intent (remove the Reports tab; no overlap with Tasks).
- The references' "Illustrative view" badge and footer ("UI reference only · illustrative content"), and their sample people and figures, are **not** copied. Every number comes from the real records.

Codes: **EXISTS** (built today) · **MOVE** (same code and data, new home) · **REMOVE-UI** (the screen copy goes; data, route and table stay) · **UX** · **NEW** (new function) · **DB** · **CEO** (needs your decision).

---

## 1. HR today (v1.305.0), verified in the code

`components/portal/hr-page.tsx` (466 lines), `hr-overview.tsx` (446), `people-panel.tsx` (384), `components/admin/hr-admin-panel.tsx` (312).

| HR tab today | What it really is | Data / route | Owner it duplicates |
|---|---|---|---|
| **Overview** | 5 tiles: Total Staff · **Leave Requests** · **Claims to decide** · **Payroll Items (OT days)** · Training & review. Pending HR actions (the **Desk** items, all kinds). **Leave Overview** (donut + bars by week). Recent activity (task reports, letters, training, probation). Today's schedule. Upcoming dates. Quick actions (**Approve Leave, Approve Claims, Process Payroll**, Manage Staff, View Calendar, Add Staff). | `/dashboard/summary`, `/leave/month`, `/people/overview`, `/events`, `/holidays`, `/birthdays`, `/task-reports`; Desk data | Leave, Claims, Attendance/Payroll, Desk, Tasks |
| **Reports** | The daily / weekly / monthly **task report**: submit form and the management list | `task_reports` (0007); `GET/POST /task-reports`; cap `task_reports` | **Tasks.** Tasks → Reports & Archive has the board's progress, staff performance and task emails, but **not** these written reports. |
| **Calendar & Holidays** | Holidays card (add/remove, the auto-Monday replacement), company events list, birthdays | `holidays` (0011, 0029, 0130), `events` (0025, 0122), `/birthdays` | **No data copy.** One holidays table and one events table; Leave, Attendance, Payroll and the Dashboard already read them. The same Holidays card is also on the old `/admin` console. |
| **Employee Lifecycle** (hr_manage) | PeoplePanel: Joining & leaving · Probation · Letters · Training | `leaving_checklists`, `probation_reviews`, `hr_letters`, `training_records` (0144); `users.onboarding_json` (0057, read only); `/people/*` | **The joining checklist is edited in Staff Details** (Documents) while the **leaving** checklist is edited in HR, so one lifecycle has two homes. A probation decision is recorded in HR, but the status itself is changed in Staff Details. |
| **Payroll & Payslips** (admin roles) | PayslipCard: a person's attendance + leave summary for a month, printable; a link to Payroll | `GET /payslip` (payroll_export) | **Payroll.** Payroll already computes attendance days, unpaid days and OT (`/payroll/attendance-days`) and prints the real payslip. The same card is also on the old `/admin` console. |
| **HR Administration** | Launcher cards to Leave, Leave entitlements, Claims, Attendance, Payroll, Users, Staff Details, plus **"Your HR access"** (a permissions table) | none (links) | **Users & Security** (permissions); every other module (a launcher). |

**Not in HR, checked:** Leave approvals (Leave), claims (Claims), OT and punches (Attendance), the payroll run (Payroll), roles (Users). **HR has no copy of their data or routes.** The duplication is in the **screens**: tiles, quick actions and launchers.

**HR has no view in the address today.** `/portal/hr` opens the Overview; its sub-tabs have no `view=` value. So **no old HR link points at a sub-tab**, and the only redirect needed is a new one (§6).

## 2. Original → new function mapping

| # | Function today | New authoritative home | Class | Data |
|---|---|---|---|---|
| 1 | HR → Reports: submit a daily/weekly/monthly report, and the list | **Tasks → Reports & Archive** ("Written reports" card) | **MOVE** | Same `task_reports` table, same `/task-reports` route, same `task_reports` cap. Every existing report stays and shows there. |
| 2 | HR header "Submit report" button | Tasks → Reports & Archive | REMOVE-UI | — |
| 3 | HR Overview "Recent activity" rows from task reports | Tasks | REMOVE-UI | — |
| 4 | HR → Payroll & Payslips (attendance + leave summary) | **Payroll** (already computes the same figures) | **REMOVE-UI** from HR (CEO **H-2**) | `/payslip` route kept; the `/admin` console card decided in **H-6** |
| 5 | HR Overview tiles: Leave Requests · Claims · Payroll Items | Leave · Claims · Attendance/Payroll | REMOVE-UI | — |
| 6 | HR Overview "Leave Overview" donut and weekly bars | Leave | REMOVE-UI | — |
| 7 | Quick actions: Approve Leave · Approve Claims · Process Payroll · Add New Staff | Leave · Claims · Payroll · Staff | REMOVE-UI (one "Open Staff Directory" button stays, as in the reference) | — |
| 8 | "Pending HR actions" (Desk items of every kind) | **Desk** keeps the queue | UX: HR shows only the **people** items (probation, joining, leaving) and links to Desk | Desk `people` bucket (exists) |
| 9 | HR Administration launcher (10 cards) | HR Policies & Settings → **"Authoritative module links"** (4 links: Leave, Payroll, Attendance, Users) | UX (shrink) | — |
| 10 | "Your HR access" permissions table | **Users & Security** | REMOVE-UI | caps unchanged |
| 11 | Holidays card, events, birthdays | **HR → Calendar & Holidays** (one month grid) | MOVE + UX, reusing `EventsCalendar` (`events.tsx`) | Same `holidays` and `events` tables. No new record type. |
| 12 | Joining checklist edited in Staff Details · leaving checklist in HR | **One editor in HR → Employee Lifecycle** (CEO **H-3**) | MOVE | Same `users.onboarding_json` and the same `/users/:id/onboarding` route. Staff Details shows it read-only with "Open in HR". |
| 13 | Probation, letters, training | HR → Employee Lifecycle | EXISTS (re-laid) | 0144 tables unchanged |
| 14 | Employment status, profile, uploaded documents (contract, offer, resignation) | **Staff Details** stays the employee record (CEO **H-4**) | EXISTS | `users`, `staff_documents` (0057) |
| 15 | Letter templates and checklist steps | HR → Policies & Settings → **HR policy library**, read-only list of what exists | UX | Templates are in code today (`lib/hr-letters.ts`, the JOINING/LEAVING keys). **Not versioned.** See H-5. |

## 3. Data ownership matrix (one function, one module)

| Data | Table / source | Authoritative module | HR may |
|---|---|---|---|
| Employee identity, profile, position, department, status, joined/left dates, reports_to | `users` | **Staff** | read; link |
| Uploaded employment documents | `staff_documents` + R2 | **Staff** (the record's Documents) | read; link per person (H-4) |
| Joining checklist | `users.onboarding_json` | **HR** (one editor, H-3) | edit |
| Leaving checklist | `leaving_checklists` | **HR** | edit |
| Probation reviews and decisions | `probation_reviews` | **HR** (the status change stays in Staff) | edit |
| HR letters (numbered, voidable) | `hr_letters` | **HR** | edit |
| Training records | `training_records` | **HR** | edit |
| Public / company / replacement holidays | `holidays` | **HR** manages (hr_manage); Leave, Attendance and Payroll read | edit |
| Company events | `events`, `event_attendees` | **HR calendar** (events_manage, unchanged); the Dashboard reads | edit (by cap) |
| Birthdays | `users.birthday` | **Staff** | read (privacy-safe: day and month only) |
| Task reports (written) | `task_reports` | **Tasks** | — |
| Leave, entitlements | `leave_requests`, `leave_balances` | **Leave** | link |
| Claims | `claims` | **Claims** | link |
| Punches, OT | `attendance_records`, OT tables | **Attendance** | link |
| Payroll run, payslips | payroll tables, `payslip_releases` | **Payroll** | link |
| Roles and access | `permissions.ts` + overrides | **Users & Security** | link |
| Action queue | Desk | **Desk** | people items only, linked |

## 4. The four tabs (desktop from your references; phone in §5)

**Header:** "A2Z STAFF PORTAL / HR". Tabs: **Overview · Employee Lifecycle · Calendar & Holidays · HR Policies & Settings**. The view is in the address (`/portal/hr?view=lifecycle`), as every other 4.0 workspace has it.

**1. Overview** (your image 2)
- Eyebrow "HR ONLY · STAFF LIFECYCLE". Title "HR Overview", with the line "People matters and employment milestones — not a second Tasks, Leave or Payroll dashboard". Button: **Open Staff Directory ›**.
- **One three-figure strip:**
  - **Staff on record** (from the Staff record);
  - **Probation reviews due** (`probation_reviews`, next 30 days and overdue);
  - **Leaving / exit records** (left or leaving within 60 days).
  - The reference's second line under "Probation reviews due", "As shown in current screenshots", is placeholder text and is replaced with the real rule.
- **HR lifecycle worklist** (left): joining checklists with progress (e.g. 2/6) → View record; offboarding records → View record; Employment document templates → Manage. Only real rows; nothing invented.
- **Upcoming people milestones** (right): Probation & confirmation (n due) · Joining & leaving dates · Employee birthdays (privacy-safe). Button: View calendar ›.
- **The boundary note:** "Leave decisions belong in Leave. Overtime belongs in Attendance. All operational task reports belong in Tasks → Reports & Archive."

**2. Employee Lifecycle** (no reference received, so the layout follows the other three)
- One segmented control: **Joining · Probation · Letters · Training · Leaving**. These are PeoplePanel's existing parts, with joining and leaving each getting their own segment.
- Each row is one person, with the open steps and an action. "View employee record ›" opens Staff Details on that person (the existing record focus).
- The **joining checklist editor moves here** (H-3). Uploaded documents stay in the Staff record and are linked (H-4).

**3. Calendar & Holidays** (your image 4)
- Eyebrow "HOLIDAY APPLICABILITY · COMPANY EVENTS". Title "Calendar & Holidays". **+ Add HR event** opens the existing events form, with the same events_manage gate.
- **The month grid** reuses `EventsCalendar` and shows holidays, company events and birthdays on one grid. Prev · Today · Next. The subtitle reads "Company scope · Johor", the real workplace. **The grid starts on Sunday today (the Malaysian convention in `EventsCalendar`); your reference starts on Monday (CEO H-7).**
- **Holiday controls** (right):
  - **Applicable state / workplace:** today there is **one** company calendar (Johor). Per-state applicability does **not** exist; it is **NEW + DB** and is **not built** (H-8). The card says "Johor — one calendar for every staff member".
  - **Public holiday sources:** lists where each year's holidays came from (the 2026 Johor gazette seed, 0029) and who added the rest. This is read from the existing rows.
  - **Replacement day policy:** shows today's rule as it is (a weekend public holiday moves to Monday, or the next free working day; per-row override; `replaces_date`, 0130). The rule is unchanged.
- Note: "Approved holiday dates feed Leave and Attendance through one calendar source. Event entries are not duplicated in Tasks or Dashboard." This is true today.

**4. HR Policies & Settings** (your image 5)
- Eyebrow "HR-SPECIFIC GOVERNANCE". **View audit history ›** opens the HR events of the audit log (letters, probation, training, checklists, holidays). This needs one read route like the asset history (H-9).
- **HR policy library** (left). It lists what really exists:
  - employment letter templates (offer, confirmation, extension, warning, resignation acceptance, employment verification);
  - joining and leaving checklists (their steps);
  - probation review standard (14-day Desk reminder; outcomes confirmed / extended / ended);
  - training records.
  - **Today these live in code and are not versioned.** The reference's green "Versioned" chip and its "+ New policy draft" button would be **NEW** (a versioned policy store with approval). Your directive says "do not create new data engines or approval workflows merely to support the new interface", so they are **not built** (H-5).
- **Authoritative module links** (right): Leave entitlements & approvals → Open Leave · Payroll runs & payslips → Open Payroll · Attendance & OT rules → Open Attendance · User roles and access → Open Users. Each link shows only to a role that can open the module.
- Note: "This page contains HR-owned settings only."

## 5. Mobile PWA (no phone reference received, so the standard 4.0 pattern applies)
- The title "HR ▾" is the Dashboard's **view switch** (as in Assets, Financial Advisory, Ecommerce and Sales). Never a cut-off tab row.
- **Overview:** three figures stacked; worklist and milestones as lists.
- **Lifecycle:** the segmented control scrolls on its own row; each person is a card.
- **Calendar:** the month grid with dots, and the tapped day's agenda below (`EventsCalendar` already does this on phones); Holiday controls below the grid.
- **Policies:** two lists.
- 44 px targets; no sideways page at 320–430 px; nothing under the bottom bar; breakpoints 640 / 768 / 1024 / 1280 only.
- **When the phone references arrive, I will match them before building.**

## 6. Legacy routes and links
- `/portal/hr` still opens HR (the Overview).
- A new **`/portal/hr?view=reports`** (and the old HR "Submit report" action) **redirects to `/portal/tasks?view=reports#task-reports`**. HR's views were never addressable, so no other old link exists.
- Search and command entries that point at "task report" or "payslip summary" in HR are re-pointed to Tasks and Payroll. The tab keyword "docs, leave admin" changes to "lifecycle, probation, holidays".
- Desk `people` items keep opening HR → Lifecycle.

## 7. Exact files affected (when approved)

| File | Change |
|---|---|
| `components/portal/hr-page.tsx` | Four tabs; view in the address (`useTabViewAddress("HR")`); phone ViewSwitch; TaskReports and HrAdministration move out or go; PayslipCard import removed |
| `components/portal/hr-overview.tsx` | Rewritten to the reference: 3 figures, worklist, milestones, boundary note; the leave, claims and payroll tiles, the leave donut and the quick actions go |
| `components/portal/hr-lifecycle.tsx` *(new, or PeoplePanel re-laid)* | Joining · Probation · Letters · Training · Leaving; the joining checklist editor |
| `components/portal/hr-calendar.tsx` *(new)* | `EventsCalendar` + Holiday controls (reads existing rows) |
| `components/portal/hr-policies.tsx` *(new)* | Policy library (read-only) + module links + audit history link |
| `components/portal/tasks.tsx` (1,468 lines) | Reports & Archive gains "Written reports": the **moved** TaskReports component (`components/portal/task-reports.tsx`, new file, moved code) |
| `components/staff/staff-directory.tsx` | Joining checklist read-only with "Open in HR" (H-3) |
| `components/portal/people-panel.tsx` | Folded into the lifecycle view (same routes) |
| `components/admin/hr-admin-panel.tsx`, `app/admin/page.tsx` | Per H-6 |
| `app/portal/page.tsx` | `startView` for HR |
| `lib/portal-tabs.ts` | HR keywords; no role change |
| `worker/src/staff.ts` / `business.ts` | **Only if H-9 is approved:** one read route `GET /people/history` (HR audit events, hr_manage). **No other worker change**: no table, no permission. |
| `hr-page.module.css` (+ modules for new files) | Tokens only |
| Tests | see §9 |

**No migration.** No table is created, altered or emptied. **No permission changes**: `task_reports`, `hr_manage`, `events_manage`, `payroll_export` and the HR tab roles stay exactly as they are.

## 8. Migration and regression risks
1. **Task reports move:** management that read reports in HR now reads them in Tasks. Risk: a role that opens HR but not Tasks loses the list. **Checked:** every `task_reports` role (super admin, admin, HR admin, COO, CCO, CEO) can open Tasks. Same data, same route, so nothing is lost.
2. **The payslip summary:** the HR admin uses it today. Payroll already shows the same attendance and leave days and prints the payslip, but in Payroll's own layout. If HR depends on the one-page summary print, H-2 keeps it inside Payroll instead of removing it.
3. **The joining checklist moving** (H-3): one editor only, so two people cannot overwrite each other from two screens. The data and route are unchanged.
4. **The COO and CCO open HR but do not hold `hr_manage`.** They see the Overview and Calendar, but not the Lifecycle actions, as today. No permission is changed to "fix" this; it stays your decision.
5. **The `/admin` console** keeps the same Holidays and Payslip cards (H-6). Left there, a small duplication remains outside HR.
6. **Calendar week start** (H-7) changes how every month grid looks if changed globally. The recommendation is to keep Sunday.
7. The tests that read these files (`tab-zones`, `tab-concept`, `kept-lines`, `business-joins`, `design-tokens-budget`) need their expectations moved with the code, never weakened.

## 9. Regression test plan
**Kept and run:**
- the full guard run with mutations (190+);
- lint ≤125; typecheck (app and worker); build;
- Leave, Claims, Attendance, Payroll, Tasks, Desk and Staff guards unchanged.

**New `tests/hr4.mjs`** (source + direct request, with mutations):
- HR has no route, card or tile that reads or writes leave decisions, claims, OT, punches, payroll runs or roles;
- `TaskReports` exists **once**, in Tasks; HR has no `/task-reports` write;
- `/task-reports` GET/POST behave exactly as before: same roles, every old report still listed, nothing deleted;
- PayslipCard is not imported by HR;
- the four tabs and their addresses; `?view=reports` redirects to Tasks;
- the Overview's three figures equal the Staff and `probation_reviews` rows;
- no new holiday or event record type; the calendar reads `/holidays` and `/events` only;
- the joining checklist has one editor (H-3);
- the 0144 tables, `holidays`, `events` and `task_reports` row counts are unchanged by opening any screen;
- no permission or tab-role change (the `permissions.ts` and `portal-tabs.ts` HR entries are byte-for-byte the same).

**Browser `tests/browser/hr4.py`** at 1440 / 1280 / 1024 / 768 / 430 / 390 / 360 / 320:
- every tab from its address, Back/Forward;
- the phone view switch; no sideways page; 44 px; nothing under the bottom bar;
- HR admin, CEO, COO (no lifecycle actions), CCO;
- Tasks → Reports & Archive shows the written reports and the submit form.

## 10. CEO decisions needed

| # | Decision | Recommendation |
|---|---|---|
| **H-0** | Approve this audit, the four tabs, and the scope in §2 and §7 (no migration, no permission change) | **Yes** |
| H-1 | Task reports move to **Tasks → Reports & Archive** (same table, route and roles) | **Yes** |
| H-2 | The HR "Payroll & Payslips" summary: remove from HR (Payroll already has the figures), or move the one-page summary into Payroll | **Remove from HR**; the route stays |
| H-3 | The joining checklist: **one editor in HR → Lifecycle**; Staff Details shows it read-only | **Yes** |
| H-4 | Uploaded employment documents stay in the **Staff** record (HR links to them per person) | **Yes** — Staff is the employee record |
| H-5 | Versioned HR policy library with "+ New policy draft" (reference image 5) | **Not now.** It is a new engine; show the existing templates read-only |
| H-6 | The old `/admin` console's Holidays and Payslip cards | **Replace with links** to HR → Calendar and to Payroll |
| H-7 | Calendar week starts Sunday (today, Malaysian) or Monday (reference) | **Keep Sunday** |
| H-8 | Holiday applicability per state / workplace (reference) | **Not now.** One workplace (Johor); it needs a DB change |
| H-9 | "View audit history": one read-only HR audit route (HR events only, hr_manage), like the asset history | **Yes** |
| H-10 | Send the **missing references** (Employee Lifecycle desktop, all phone screens, the Master Prompt) before building | **Yes**, or approve building to the 4.0 phone pattern in §5 |

---
Implementation, once approved, is one release (no migration). The order: the Tasks move first (so no report is ever without a home), then the four HR tabs, then the clean-up of links. Nothing is deployed by Claude. You run PUSH.bat after your Gate 6 approval.
