# A2Z OS — Leave Workspace 4.0: UI/UX and Approval Consolidation Blueprint

**Status:** read-only audit and design are complete. **STOP GATE: waiting for your approval.** Nothing has been coded, migrated, re-permissioned or deployed.
**Authority:** the CEO's directive "A2Z OS — Leave Workspace 4.0", 15-11-2026, with five desktop reference images: Apply Leave, My Leave, Team Calendar, Approvals & Management, and Overview.
**Sits on:** 1.308.0 (Staff 4.0) and 1.307.0 (Attendance 4.0), both on your PC and not yet deployed.

**Source audited:**
- Screens:
  - `components/portal/leave.tsx` (1,879 lines);
  - `leave-overview.tsx` (483);
  - `leave-calendar.tsx`;
  - `leave-month-card.tsx`;
  - `rest-day-credits.tsx`;
  - `attendance-exceptions.tsx`;
  - `leave-page.module.css`.
- Server:
  - `worker/src/leave-chain.ts` (the approval engine);
  - the `/leave*`, `/replacement-credit`, `/rest-day-work`, `/rest-day-ot`, `/attendance/ot/decide` and `/holidays` routes in `worker/src/staff.ts`;
  - `desk.ts`;
  - `attendance-day.ts`.
- Earlier decisions:
  - `claude/LEAVE-ROUTING-AUDIT.md` rev 2;
  - `GATE-1.260.0`;
  - `GATE-1.261.0`.

> **Two things to know before reading on.**
> 1. **What was attached.** Only the five desktop images came with this message. The five Mobile PWA references and the separate Master Prompt did not arrive. The phone designs in §6 follow the PWA pattern already approved for Staff and Attendance. Send the phone images if you want them matched exactly (decision L-14).
> 2. **The pictures are illustrative.** Their names, request numbers (LR-2026-0587), counts (12 / 86 / 3, 24 staff, 88 %), balances, dates and photos are not real. **Nothing from them is copied.** Every figure comes from the records.

---

## 1. Current workflow and duplicated-function findings

### 1.1 What exists today

**The five tabs already exist** (since v1.196): Overview · Apply Leave · My Leave · Team Calendar · Approvals & Management. They all read one engine:
- `leave_requests`;
- the approval rules in `leave-chain.ts`;
- the append-only `leave_decisions`;
- `leave_balances` as the entitlement ledger;
- `replacement_credits` as the evidence for credited replacement leave.

| Tab | What it shows today | Gap against your reference |
|---|---|---|
| Overview | "In progress across the company" callout; 5 KPI tiles of **my** applications this year; **"Your approval route" card with the CEO's legacy/organisation switch**; **My Leave Balance (5 cards)**; Recent requests; **mini calendar**; Upcoming team leave; Public holidays; Quick actions | Ref 5 is a **team** picture: Applications this month · Approved · Pending · Rejected · On Leave Today; Pending Requests (needing *my* action); Team Availability donut; Today's Leave; Upcoming Leave (next 7 days). The **balances, mini-calendar, route switch and quick actions are duplicates** (§1.2). |
| Apply Leave | One card: type, start, end, **Days typed by hand** (0.5 = half), half-day select, reason (optional), Submit | Ref 1 needs: 3-step stepper (Details → Review → Submitted); **working days calculated, not typed**; **reason required** (500 chars); **attachment** (PDF/JPG/PNG ≤10 MB); **Leave Balance Impact** (before · this request · after); **Approval Route** preview. |
| My Leave | Five balance cards ("days eligible now"); "My leave history" table, search, status filter, row actions (print form, PDF, cancel), drawer | Matches closely. Ref 2: three balance cards with bars (Annual, Medical, Replacement); **Request #** column; type and status filters; **Last update**; ⋮ menu; pager. |
| Team Calendar | **Two calendars**: `TeamCalendarGrid` (month grid, everyone) and `LeaveCalendar` (person × day strip, managers only, clashes) | Ref 3: **one** month grid with legend (Team leave · Public holiday · Pending · Today), plus **Team Availability** and **Who's Away by Department** beside it. |
| Approvals & Management | **Rest-day credit card** (rest days worked → credit replacement leave **or pay as OT**); a pill chooser "Leave — whole company" / "Leave entitlement"; the company register (search, department, status, month, pager, row Approve/Reject, **CEO "Approve now" override on the row**); Unpaid leave days editor (CEO, moved here in 1.307.0) | Ref 4: Leave Management tiles (Pending · Approved this year · Routes); **Leave Policy & Entitlements** summary + Manage Policy; **Approval Queue** (View · Approve · Reject · **Send back**, with the stage). The rest-day / OT decision belongs in Attendance (§1.2). |

### 1.2 Duplicates and conflicts found

| # | Finding | Where | Resolution |
|---|---|---|---|
| D-1 | **Balances drawn three times** | Overview "My Leave Balance", My Leave "Available leave balances", the Overview tiles (hourly fallback) | **My Leave only** (directive). Apply shows only the **impact** of this request on the one type chosen. |
| D-2 | **Three calendars** | Overview mini-calendar, Team Calendar `TeamCalendarGrid`, Team Calendar `LeaveCalendar` | **One Team Calendar.** The person × day strip becomes a "By person" view of the same month (managers), so the clash warning stays. The mini-calendar is removed. Holidays come from the same `/staff/holidays` source HR maintains. |
| D-3 | **Competing approval rules switch** | Overview "Your approval route" card: the CEO's **legacy ⇄ organisation** button (`PUT /leave/routing`) | **Remove the switch** (L-1). Organisation routing is permanent. Requests still in flight under the old role chain finish under the rule they were submitted with (D8, already approved). Nothing is re-staged. |
| D-4 | **Rest-day work and overtime decided in two modules** | Leave → `RestDayCreditCard` (credit replacement **or pay as OT**, via `/replacement-credit` and `/rest-day-ot`) **and** Attendance → Exceptions (`/attendance/ot/decide`, approve OT **or** convert to replacement) | Both write the same ledger (`replacement_credits` + `leave_balances.adjust`), and a unique index stops a double credit. But **two doors decide one question**. **Move the decision to Attendance** (L-8). Leave keeps a **read-only replacement-credit ledger**. |
| D-5 | **Days typed by the applicant** | Apply → "Days (0.5 = half day)" | The server already refuses more days than the roster's working days. It does **not** exclude **public holidays**, so a range over a holiday can be charged for it. **The server computes the days** (L-3). |
| D-6 | **Balance shown ≠ balance enforced** | `GET /leave/balance` counts **approved** days; `POST /leave` refuses against **approved + pending** | One definition, shown honestly: **Available = entitlement − approved − pending**, with "n pending" beside it (L-7). Display only; the rule is unchanged. |
| D-7 | **Override reachable from the register row** | "Approve now" / "Reject" beside every in-progress row for the CEO, **and for super_admin** | Override moves into the request's detail view only. It is restricted to **the verified owner (CEO)**, with a reason **and** the authenticator for both approve and reject (L-12). |
| D-8 | Route card on Overview and the drawer timeline | Overview card; drawer | The route is shown **before submission** on Apply (ref 1), and the **progress timeline** in the drawer. Nowhere else. |
| D-9 | Attachment column exists, but no upload | `leave_requests.mc_media_id` is accepted by the server; the screen has no way to attach | Add the upload on Apply (L-4). **No migration:** the column and the private `media` + R2 pattern already exist (used by Tasks and Agents). |

**No second leave engine, ledger, calendar or approval path exists, and none is proposed.** Desk keeps listing "leave waiting on you" from the same `leaveCanActAt` rule, as an inbox that links into Leave.

---

## 2. Old-to-new interface mapping

| Today | Becomes | Tab |
|---|---|---|
| Overview KPI row (my applications this year) | **Applications this month · Approved · Pending · Rejected · On Leave Today (n of m staff)**. Approvers see the company; staff see their own, plus "On leave today" as a count. | Overview |
| "In progress across the company" callout | **Pending Requests** card (rows needing *my* action, Review →) | Overview |
| Upcoming team leave | **Today's Leave** + **Upcoming Leave (next 7 days)** | Overview |
| — | **Team Availability** donut (Available · On leave · Off day / holiday), from the roster and approved leave today | Overview |
| My Leave Balance on Overview | removed (D-1) → My Leave | My Leave |
| Mini calendar, Public holidays card | removed (D-2) → Team Calendar | Team Calendar |
| Your approval route card + switch | route preview → Apply; switch removed (D-3) | Apply |
| Quick actions | removed (the five tabs and the header **Apply Leave** button do it) | — |
| Apply form | stepper, computed days, reason, attachment, Balance Impact, Approval Route | Apply |
| Available leave balances (5 cards) | **3 entitlement cards** (Annual, Medical, Replacement: available / entitled, bar, pending), plus one line for the unpaid types ("Emergency and unpaid: no limit · n taken · deducted at 1/26 a day") | My Leave |
| My leave history | Leave History: **Request #** · Type · Period · Days · Status · **Last update** · ⋮ (View · Print form · Send PDF · Cancel while in progress) | My Leave |
| — | **Replacement credits** (read-only: date worked, days, credited by, from Attendance) | My Leave |
| TeamCalendarGrid + LeaveCalendar | one grid + "By person" toggle (managers); Team Availability; Who's Away by Department | Team Calendar |
| RestDayCreditCard | moved to **Attendance → Exceptions → Rest days worked** (L-8) | Attendance |
| Pill chooser (company / entitlement) | **Leave Management tiles** + **Leave Policy & Entitlements** card (Manage Policy opens the existing entitlement editor in a drawer) | Approvals |
| Company register | **Approval Queue** (waiting on me) on top, then **All requests** (the same register, filters, pager) for the chain | Approvals |
| Row override buttons | moved into the detail drawer, owner-only (D-7) | Approvals |
| HR check (Verified / Flag), Route now, Reassign, Re-route | unchanged, in the detail drawer and a queue filter "Needs routing" | Approvals |
| Unpaid leave days editor (CEO) | unchanged, a section under Approvals | Approvals |

---

## 3. Source components and APIs to reuse

**Screens** (no new UI library):
- `LineTabs` + `useTabViewAddress` (each tab gets an address, with Back/Forward), and the phone `ViewSwitch` (as in Staff 4.0);
- `KpiTile`, `Avatar`, `SideDrawer`, `StageTimeline` / `StageDots`, `RecordComments` / `RecordActivity`, `usePrompt` / `withStepUp`, `useCachedApi`;
- the existing leave drawer (details, timeline, comments, activity, print / PDF), `BalanceCard` (reshaped), `TeamCalendarGrid` (extended), `LeaveCalendar` (as the "By person" view), `LeaveEntitlement` (in a drawer);
- `AttendanceAdminPanel areas={["unpaid"]}`, and `RestDayCreditCard` (moved).

**Server routes:**

| Need | Route | Change |
|---|---|---|
| Apply | `POST /staff/leave` | **days computed on the server** (L-3); reason required (L-5); `mc_media_id` must belong to the applicant's own upload |
| **Preview before submit** | **new** `GET /staff/leave/quote?type&start&end&part` | read-only; for **the session's own user only**. Returns: working days per day (roster, holidays, half day), the balance before / after, and **the route this request would take now** (`leaveRoute`). Writes nothing. |
| Attachment | **new** `POST /staff/leave/attachment` (binary → R2 → `media`), `GET /staff/leave/:id/attachment` | upload by the applicant before submit; read by the applicant, the route's approvers, HR (`hr_manage`) and the CEO only; audited read |
| My list, the chain's list | `GET /staff/leave`, `?all=1` | unchanged (timeline, `can_act`, route, payroll states already on each row) |
| Decide | `PATCH /staff/leave/:id` (approve · reject · **return = Send back** · resubmit · reassign · route · reroute · hr_verify · hr_flag · cancel) | override: owner-only, reason + authenticator for both (L-12) |
| Route mode | `GET /staff/leave/routing` | keeps the "my route" answer; **`PUT` removed** (410), mode fixed at organisation (L-1) |
| Balance | `GET /staff/leave/balance` | + `pending` per type (L-7) |
| Calendar | `GET /staff/leave/month`, `/staff/people/leave-calendar`, `/staff/holidays` | unchanged; D6 privacy kept (type / reason only to the chain) |
| Availability today | the roster (`shiftResolver`) + approved leave + holidays | read in the existing `/staff/leave/month` answer (+ `availability` block for `team_manage`) |
| Entitlements | `GET/PUT /staff/leave/entitlement(s)`, `/leave/eligible`, `/bulk` | unchanged (CEO `leave_entitlement`) |
| Replacement credits | `/replacement-credit`, `/rest-day-work`, `/rest-day-ot`, `/attendance/ot/decide` | **unchanged routes**; only the card moves to Attendance. + read-only `GET /staff/leave/replacement-credits?user_id` (own; HR / CEO any) |

---

## 4. Organisation approval route and permission matrix

### 4.1 The route (the rule in force, unchanged)

Your decisions of 04-11-2026 (GATE-1.260.0 and GATE-1.261.0, route version 2):

| Applicant | Route frozen at submission |
|---|---|
| Ordinary staff | **every person above them on the Organisation chart, nearest first; the CEO gives the final approval** (e.g. Nurfarah: CCO → CEO; Nurul Fasehah: COO → CEO) |
| COO / CCO | CEO (one step) |
| CEO | **Executive Leave Record**: nobody approves; his authenticator; COO, CCO and HR told |
| No valid manager | **Routing requires configuration**: nobody can approve it until HR or the CEO sets the line and presses Route now (audited) |
| Part-time host | no leave (paid hourly), unchanged |

- **HR check** (Verified / Flag) appears on the timeline and **never approves or blocks**.
- **Your reference shows a different route:** "Direct Manager → **HR Leave**", and an "HR Review" stage in the queue. That would make HR an approval step, which you removed on 04-11. **I will draw the real route** and show HR's check as an information row (L-2). I will change who approves only if you choose otherwise.

### 4.2 Integrity rules (all server-side; most already enforced and tested)

| Rule | Today | After |
|---|---|---|
| No self-approval | `leaveCanActAt` returns false for the applicant; the override refuses your own | kept + new tests on the quote and the attachment |
| Only the frozen step's approver decides | `approver_id` match | kept |
| One decision per step (no double / race) | write names the stage it read → 409 | kept |
| No silent skipping | a step is "Not needed" only when the same person already decided it, and the screen says so; override recorded as override | kept |
| A pending or returned request is never absence | Attendance / Payroll read `status = 'approved'` only | kept |
| **Override** | CEO **and super_admin**; reason; authenticator on approve only | **owner CEO only**; reason + authenticator for approve **and** reject; from the detail drawer only (L-12) |
| Route switch | CEO, authenticator | **removed** (L-1) |
| Routing-required requests | nobody approves, until Route now | kept |
| Old role-chain requests in flight | legacy rule | kept until each closes (D8). Before release, the count is read from the PUSH backup and reported to you. |

### 4.3 Permission matrix (no change unless marked)

| Who | Overview | Apply / My Leave | Team Calendar | Approvals queue | All requests (register) | Policy & entitlements | Override | Unpaid days |
|---|---|---|---|---|---|---|---|---|
| CEO (owner) | company | own (Executive Record) | all, with type | routed to him | ✓ | ✓ edit | **✓ (only)** | ✓ |
| COO / CCO | company | own | all, with type | routed to them | ✓ (read) | read | — | — |
| HR admin | company | own | all, with type | routed to her + HR check + Route now | ✓ (read) | read | — | — |
| super_admin / admin | company | — (not on the chart) | all | — (never a routed approver) | ✓ (read) | read (super_admin edits today: **kept**) | **today ✓ → ✗ (L-12)** | super_admin ✓ (unchanged) |
| Team lead (not in the tier) | own + "waiting on you" | own | names + dates only | routed to them | — | — | — | — |
| Staff | own | own | names + Tentative / Approved only | — | — | — | — | — |
| Part-time host | own (no entitlement note) | — | names only | — | — | — | — | — |

The Approvals tab shows for anyone with a request routed to them (as today, `canApprove`), plus the chain (`leaveSeesAll`) and the entitlement holders.

---

## 5. Five final desktop screens (to your references)

Every tab has its address (`/portal?tab=Leave&view=overview|apply|mine|calendar|manage`). The header row keeps **the month** and **Apply Leave** at the right, as in the images. White sidebar, light-grey ground, navy text, gold active tab, tokens only, no dark sidebar.

### 5.1 Overview (ref 5)
- **Five tiles:** Applications (this month) · Approved (% of applications) · Pending · Rejected · **On Leave Today (n of m staff, %)**. "m staff" = people working today on the roster, not headcount.
- **Pending Requests:** staff, type, period, days, submitted, **Review →** (opens the drawer). Only rows where `can_act` is true. "View all" opens the Approval Queue.
- **Team Availability:** donut + Available · On leave · Off day / holiday, with counts and %.
- **Today's Leave** and **Upcoming Leave (next 7 days):** approved only, with name, department / position, type chip (chain only; others see "On leave"), dates and days.
- Staff without approval rights see their own tiles, and Today / Upcoming as names only.

### 5.2 Apply Leave (ref 1)
- **Stepper:** 1 Leave Details → 2 Review → 3 Submitted. Review is the same card made read-only, with **Back / Submit request**. Submitted shows the request number and its first step.
- **Fields:**
  - Leave Type * (with "— unpaid" on emergency and unpaid);
  - Date Range * (start – end; one-day = same date);
  - **Half day** toggle (first / second half), offered when the range is one working day;
  - **Working Days: calculated** (n days), with a "how" line (e.g. "3 days — excludes Sun 16 Nov rest day and Deepavali");
  - Reason * (5–500, counter);
  - Attachment (PDF / JPG / PNG ≤10 MB; **required for medical leave** — L-4).
- **Right column:**
  - **Leave Balance Impact:** Available (before) · This request (−n) · Available (after). Shown red, with the server's message, when it would go below zero. Unpaid types show "Unpaid — deducted at 1/26 of monthly wage per day" instead.
  - **Approval Route:** the real steps from `/leave/quote` (e.g. "1 · Mohamad Izzudin — Chief Commercial Officer", "2 · CEO — final"), plus "HR check — information only". The CEO sees "Executive Leave Record". Without a reporting line, it says "Your reporting line is not set — HR or the CEO will route it", and submission is still allowed (as today).
- **Cancel · Submit request.** The server re-checks everything; the preview is never trusted.

### 5.3 My Leave (ref 2)
- **My Leave Balance (year):** Annual · Medical · Replacement cards with **available / entitled**, a bar, and "n pending". Under them, one line for Emergency / Unpaid (no limit · taken · cost). **View details** opens a drawer with the per-type ledger: entitlement, accrual so far, CEO adjustments, replacement credits, approved, pending.
- **Leave History:**
  - Search (request #, type);
  - All Leave Types · All Status filters;
  - columns: Request # (`LR-yyyy-nnnn` from the existing leave number) · Leave Type · Period · Days · Status chip (Approved · Pending · Returned · Rejected · Cancelled) · Last update · ⋮;
  - pager.
- **Detail drawer** (unchanged engine): the progress timeline (✓ completed · ● current · ○ next steps, with names and times), comments, activity, attachment, the payroll month state, Print form / Send PDF, Cancel while in progress, and Resubmit when returned.
- **Replacement credits** (collapsible): date worked · days · credited by · when.

### 5.4 Team Calendar (ref 3)
- **Month grid** (Sun–Sat as in the picture) with ‹ › and the month picker; legend Team Leave · Public Holiday · Pending Leave · Today.
- Day chips: "n on leave" (approved), "n pending", the holiday name. Multi-day spans draw as one bar where they share a week.
- Pressing a day opens a short list for that day (names; type only for the chain — D6).
- **"By person"** toggle (`team_manage`): today's `LeaveCalendar` strip, with the department clash marks.
- **Right column:**
  - **Team Availability** (today, or the chosen day): donut, Available · On Leave · Pending · Total team;
  - **Who's Away by Department** (this month): accordion per department with "n away", people, type chip (chain only), dates.

### 5.5 Approvals & Management (ref 4)
- **Leave Management tiles:**
  - **Pending Approvals** (waiting on you);
  - **Approved (this year)**, across all staff (chain only);
  - **Routing needs configuration** (n), instead of the picture's "3 Active Approval Routes". There is no table of routes: the route is the chart.
- **Leave Policy & Entitlements:** Annual 14 days / year · Medical 14 · Replacement "earned from rest days worked". These are the real defaults and policy, read from the entitlement rows. **Manage Policy** (CEO) opens the entitlement editor in a drawer.
- **Approval Queue** (waiting on you):
  - filters: All leave types · All stages (Step n of m · Routing required · Returned) · search;
  - row: photo, name, position · type chip · dates · days · **Stage** ("Step 1 of 2 · CCO") · **View · Approve · Reject · Send back**;
  - Approve on the final step asks the authenticator, as today;
  - Reject and Send back ask the reason / question, as today.
- **All requests** (the chain): today's register, unchanged in behaviour, below the queue.
- **HR check list** (HR / CEO): Verified / Flag, unchanged.
- **Unpaid leave days** (CEO): unchanged.

---

## 6. Five Mobile PWA screens (< 768 px)

| Tab | Phone layout |
|---|---|
| All | The view switch replaces the tab row; **Apply Leave** sits beside it. Bottom navigation unchanged. 44 px targets, safe areas, no sideways page at 320 px. |
| Overview | Tiles 2 × 2, with On Leave Today full width; Pending Requests as cards (name, type, dates, Review); availability donut over the legend; Today / Upcoming as short lists. |
| Apply | **One field per row**; the date range as two date inputs; Working Days and Balance Impact as a compact summary bar above **Submit**; route as a vertical list; attachment uses the phone's file / camera picker; **sticky Cancel / Next / Submit** above the keyboard. |
| My Leave | Balance cards stacked (or a 3-up scroller); history as cards (Request #, type, dates, days, status chip); the drawer opens **full screen**. |
| Team Calendar | **Agenda list** of the month by default (day headers, chips), with a compact month grid toggle; Availability and Who's Away below. |
| Approvals | Tiles 2 × 2; Policy as one line + Manage; Queue as cards with **Approve / Reject / Send back** in a row, and View on the card; the register behind a "All requests" button. |

---

## 7. Leave balance, Attendance and Payroll integration

**One ledger.** A balance is always computed, never stored:
- `leave_balances` (entitled, the CEO `adjust`, `used_adjust`; one row per person / year / type);
- `leaveAccrual()` (annual leave accrues through the operating months);
- `leave_requests` (approved and pending days).

**Replacement leave is earned only through `replacement_credits`.** Each credit adds its days to `leave_balances.adjust`, and is written only by:
- an `ot/decide` "replacement";
- or a `/replacement-credit`.

Both of these need `leave_entitlement` (the CEO and super_admin, unchanged), on a day that is a real rest day or a real OT record, with a clock-in. A day cannot be both paid OT and credited (409 both ways). **No other path grants replacement leave.** The entitlement editor still refuses a "granted" replacement figure.

**Attendance** reads `leave_requests WHERE status = 'approved'` (`attendance-day.ts` status `leave`, partial leave by coverage). Approval is availability; there is no sync job and none is added. A pending request is never absence.

**Payroll** reads the same approved rows:
- unpaid and emergency days are deducted at 1/26 of the monthly wage;
- a half day is 0.5;
- the drawer already shows each month as not prepared / prepared / released, from `payroll_entries` and `payslip_releases`.

**What changes with L-3:** the days figure stored on new requests becomes the server's count. **No existing request is recalculated.** Payroll keeps reading `days` exactly as today.

**Holidays:**
- `/staff/holidays` (HR's calendar) is the only source: the Team Calendar, the working-day count (L-3) and Attendance all read it.
- `holidayEntitles()` decides whether someone who had not joined yet gets it, exactly as Attendance does.

**Rounding:** half days only (0.5). The server refuses any other fraction, as today.

---

## 8. Security and regression tests

**New `tests/leave4.mjs`** (the whole worker on SQLite, by direct request, with deliberate mutations). It covers:
- **Quote:**
  - own only (403 for `?user_id`);
  - excludes rest days and entitled holidays;
  - a half day = 0.5 on a working day only;
  - writes nothing (table hashes before / after);
  - the route equals `leaveRoute`.
- **Apply:**
  - client-sent `days` is ignored (server count stored);
  - reason required;
  - medical needs an attachment;
  - an attachment of someone else's is refused;
  - over-balance refused with pending counted.
- **Attachment:**
  - 10 MB / type limits;
  - read 403 for a colleague, 200 for the applicant, a route approver, HR and the CEO;
  - each read audited.
- **Self-approval:**
  - the applicant cannot approve, reject or override their own (all roles, including the CEO);
  - HR cannot HR-check her own.
- **Override:**
  - super_admin → 403;
  - CEO without reason or authenticator → refused (approve **and** reject);
  - recorded as `override`, never as a normal approval.
- **Switch:**
  - `PUT /leave/routing` → 410;
  - new requests are always routed by the chart;
  - legacy in-flight rows are still decided only by the legacy rule.
- **Skipping:** every step decided once; a second press → 409; a reassigned step cannot be decided by the old approver.
- **Rest-day move:** the Leave screen has no OT / credit buttons; Attendance does; the routes and permissions are unchanged.
- **Integration:**
  - Attendance, roster and payroll outputs are byte-identical for pending / returned requests (hash);
  - an approved request appears once (no double deduction);
  - the balance = entitlement − approved − pending everywhere.
- **Privacy:** calendar and month answers carry no type / reason / attachment to staff (D6).

**Browser `tests/browser/leave4.py`:**
- CEO, COO, HR, a team lead and staff;
- all five views by address and Back / Forward;
- the stepper;
- computed days on a range with a rest day and a holiday;
- balance impact;
- the route preview;
- the attachment;
- queue actions;
- empty / loading / error states;
- eight widths (320–1440) with no sideways page;
- the phone view switch and full-screen drawer.

**Existing guards kept green, changed only where approved behaviour changes:** `go-live-v`, `go-live-l`, `leave-module`, `unpaid-leave`, `roster-leave`, `one-desk`, `global-search`, the signatures guard, `attendance4`, `staff4`, `tab-zones`, `lazy-panels`, `leave-timeline.py`, and the full 194-guard run with mutations. **No test is weakened to pass.**

---

## 9. Implementation phases and rollback

| Phase | Content | Migration | Permission change |
|---|---|---|---|
| **P1 — the five screens** (1.309.0) | Addresses and phone switch; Overview (ref 5); My Leave (balances once, history, credits ledger); Team Calendar (one grid + by-person + side panels); Approvals (tiles, policy card, queue + register); duplicates D-1, D-2, D-8 removed; L-7 pending display | none | none |
| **P2 — Apply and rules** (same release, or 1.310.0 — L-15) | Stepper; `/leave/quote`; server-computed days (L-3); reason required (L-5); attachment (L-4); route preview; switch removed (L-1); override owner-only (L-12); rest-day / OT card moved to Attendance (L-8) | **none** (uses `mc_media_id`, `media`, R2) | override narrowed (L-12) |

**Before release:** count the legacy-stage requests still open and the requests in `routing_required` from the PUSH backup, and report both to you.

**Rollback:**
- Code only. Re-run PUSH.bat from the 1.308.0 files. No data or schema changes.
- Requests created under P2 carry the same columns and stages as today, so older code reads them normally.
- The routing setting row is left untouched, so the switch would reappear after a rollback, in the state you left it (organisation).

---

## 10. Decisions for you (STOP GATE)

| # | Decision | My recommendation |
|---|---|---|
| **L-0** | Build the five tabs to the five references, each with its own address and the phone view switch | **Yes** |
| **L-1** | Remove the legacy ⇄ organisation switch; organisation routing is permanent; old-rule requests in flight finish under their rule | **Yes** |
| **L-2** | Approval route: **(a)** keep your 04-11 rule (up the chart to the CEO; HR check is information only) and draw it truthfully, or **(b)** follow the picture and make **HR an approval step** after the manager (route version 3) | **(a)** |
| **L-3** | Working days are **computed by the server**: the person's roster working days in the range, minus public holidays they are entitled to (HR's calendar), with a half day = 0.5 on one working day. Applicants no longer type days. This applies to new requests only. **Please have HR confirm the holiday treatment** (the D5 condition from 04-11). | **Yes** |
| **L-4** | Attachment on Apply: one file, PDF / JPG / PNG ≤10 MB; **required for Medical**, optional otherwise; visible to the applicant, their route approvers, HR and the CEO | **Yes** |
| **L-5** | Reason becomes required (5–500 characters), as the picture marks it | **Yes** |
| **L-6** | Balance Impact on Apply for Annual, Medical and Replacement; unpaid types show their pay cost instead | **Yes** |
| **L-7** | Balances show **available = entitled − approved − pending**, with "n pending", everywhere (today My Leave ignores pending while the server counts it) | **Yes** (display only) |
| **L-8** | Rest-day work and overtime decisions (credit replacement / pay OT) leave the Leave tab and live in **Attendance → Exceptions** only; Leave keeps a read-only replacement-credit ledger | **Yes** |
| **L-9** | One Team Calendar: remove the Overview mini-calendar; the person × day strip becomes a "By person" view (managers) | **Yes** |
| **L-10** | Overview becomes the team picture of ref 5 for approvers (own picture for staff); balances, quick actions and the route card leave it | **Yes** |
| **L-11** | Approvals: queue with View · Approve · Reject · **Send back** (the existing Return); the third tile shows "Routing needs configuration" instead of "Active Approval Routes" (no route table exists — the chart is the route) | **Yes** |
| **L-12** | Override ("decide in place of the approver"): **owner CEO only** (super_admin loses it); reason + authenticator for approve **and** reject; only from the detail view | **Yes** |
| **L-13** | Part-time hosts keep no Apply / My Leave (paid hourly), so they see three tabs | **Keep** |
| **L-14** | Phone screens: build to the PWA pattern above now, or wait for the five phone images (they did not arrive) | **Build now**; adjust if you send them |
| **L-15** | Release: P1 + P2 together as **1.309.0** (no migration), after the backup count of open old-rule requests | **Yes** |

**ONE LEAVE ENGINE · ONE ENTITLEMENT LEDGER · ONE TEAM CALENDAR · ONE ORGANISATION-BASED APPROVAL WORKFLOW · NO SELF-APPROVAL.** Nothing is coded until you approve.
