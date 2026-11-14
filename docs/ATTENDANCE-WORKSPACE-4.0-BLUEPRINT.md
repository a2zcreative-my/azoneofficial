# A2Z OS — Attendance Workspace 4.0: Audit & Blueprint

**Status:** GATE 1 (audit) and GATE 2 (design) only. **STOPPED AT THE GATE for your explicit approval.** Nothing has been coded, migrated, re-permissioned or deployed, and no live record has been read or changed.
**Authority:** the CEO's directive "A2Z OS — Attendance Workspace 4.0, CEO Final UI/UX and Workflow Consolidation Directive", 14-11-2026, with the reference images.
**Baseline:** v1.306.0 (on your PC, not deployed). Every finding below was read in the code.

**What arrived:**
- **6 images, not 10.** I have:
  1. Overview;
  2. Attendance Records with the record drawer;
  3. Shift Roster, version A (Publish Roster, Week Summary);
  4. Shift Roster, version B (Shift Templates, Copy Roster, Create/Edit, Week/Month, totals);
  5. Exceptions & Approvals with the request drawer;
  6. Reports.
- **Missing:** all the Mobile PWA references, and the Master Prompt text.
- **The two Shift Roster images are different designs** (see A-2).
- **The references' sample data is not copied.** Some of it is wrong:
  - "Fri, 14 Nov 2026": 14 Nov 2026 is a **Saturday**.
  - "Public Holiday (Hari Krismas)" on 14 Nov: Christmas is 25 Dec.
  - "Hari Deepavali" on Fri 13 Nov: Deepavali is **Sun 8 Nov**, and its replacement day is **Mon 9 Nov** (seeded in 0029).
  - Stock building photos are used as "location evidence".
  - Coordinates are shown to managers.

Codes: **EXISTS** · **MOVE** (same code and data, new home) · **REMOVE-UI** (the screen copy goes; data, route and table stay) · **FIX** (a wrong result corrected) · **NEW** · **DB** · **CEO** (needs your decision).

---

## 1. Current source and API audit (v1.306.0)

**Screen:**
- `components/portal/attendance-panel.tsx`: 7 tabs. Overview and Attendance (your month) for everyone. On Shift, Roster, Team, Reports and Settings for managers (MANAGE_ROLES).
- The tabs are not in the address, and a phone gets the cut-off tab row.

| Tab today | What it is | Data / route |
|---|---|---|
| Overview | 5 tiles (On time · Late · **Not clocked in** · On shift · Hours), today's table, donut, month strip, issues, activity; Daily Attendance chart | `/dashboard/summary`, `/dashboard/attendance-today`, `/attendance/monitor`, `/attendance/report` |
| Attendance | your own month and records | `GET /attendance` |
| **On Shift** | **a button that opens the On Shift page**: a duplicate entry point | — |
| Roster | today's assignments plus the **operational roster board** (live sessions, task blocks, sales duty) | `/roster`, `live_sessions`, `task_blocks`, `sales_shifts` |
| Team | OT approvals and the team punch log | `/attendance/ot/pending`, `/ot/decide`, `GET /attendance?all` |
| Reports | the verification report (one row per person, flags, CSV) | `/attendance/verification` |
| **Settings** | AttendanceAdminPanel: forgotten-punch approvals, manual entries, amend/delete punches, **unpaid leave recording**, **working-hour patterns**, OT rules, export | `/attendance/pending(/decide)`, `/attendance/manual`, `/attendance/:id`, `/attendance/unpaid`, shift-pattern routes, `/attendance/export` |

**Engine (worker/src/staff.ts, clock-day.ts):**
- `shift_patterns` + effective-dated assignments (0099, 0102, 0103, 0119, 0129) are the **expected schedule**:
  - per person, per weekday;
  - split blocks;
  - unpaid break;
  - categories;
  - NULL = rest day.
- `shiftResolver` / `lateAgainst` / `dayMinutesInSchedule` apply that schedule.
- `/attendance/verification` already reconciles correctly:
  - rest day → not counted;
  - holiday (per person, `holidayEntitles`) → not counted;
  - approved leave (full or partial) → leave;
  - no clock-in → absent;
  - late against the person's own shift.
- Forgotten punches: `pending_approval` (0100). They don't count until approved; **only the CEO approves** (`unpaid_leave` cap); self-approval is refused (`refuseSelf`).
- OT: `ot_records` with `status` pending/approved/rejected (0044, 0054).
  - Derived OT is inserted **pending**.
  - Decided by `OT_DECIDE_ROLES` (CEO, COO, super admin, admin).
  - Only approved OT reaches Payroll.
- Location:
  - punches store `gps`;
  - the monitor sends an **outcome** per punch (word, distance, accuracy);
  - `in_gps` (raw coordinates) is still sent to monitor readers for older cards.
- Payroll **pulls** attendance (`/payroll/attendance-days`, `/attendance/export`). There is no push.
- The Desk already queues `ot` and `punches` items.

## 2. Accuracy findings: the screenshot discrepancies explained

### 2.1 "Seven employees not clocked in on Saturday 14 Nov 2026" — FIX
There are **two attendance engines** today, and the Overview uses the wrong one:

| Screen | How it decides | Result on a Saturday |
|---|---|---|
| Overview tiles, today's table, issues; Dashboard donut; `/dashboard/attendance-today`; `/dashboard/summary` | "Not clocked in" = **everybody active without a clock-in today**. Late = first clock-in **after a fixed 10:00**, for everyone | **All 7 show "Not clocked in"** on a rest day, a public holiday or before their shift starts. A 08:30 starter at 09:45 shows on time; a 10:00–19:00 host at 10:05 shows late, with no grace. |
| `/attendance/verification` (Reports) | the person's own published pattern, holidays, leave, rest days | correct (but see 2.3) |

The monitor already sends `shift.scheduled`, `holiday` and `on_leave` per person (since 1.294.0). **The Overview never reads them.** In addition:
- the Overview's `in_at` counts **pending (unapproved) forgotten punches**, which the reports exclude;
- the month strip colours a day by "people clocked in out of headcount", so every weekend and holiday reads as a bad day.

### 2.2 The suspicious 09 November record — needs a read-only check
**09 Nov 2026 is the Deepavali replacement holiday** (Sun 8 Nov public holiday → Mon 9 Nov, seeded in 0029). What the code does with a punch on that day:
- **Reports skip the day entirely**: the holiday comes before the clock check. Hours worked on a holiday are neither "worked" nor OT unless OT punches were made, so the record looks orphaned.
- The Overview treats it as an ordinary day.
- A punch replayed from the phone's offline outbox (`offline_sent_at`), or a forgotten punch approved later, carries its **claimed** time, not its arrival time.
- An approval that set a new time **overwrote** `created_at` (see 2.4).

**I have not looked at production** (STOP GATE). The check I propose is read-only. With your approval, run it in the D1 console:

```sql
SELECT id, user_id, type, created_at, datetime(created_at,'+8 hours') AS myt,
       pending_approval, manual_by, amended_by, amended_at, offline_sent_at, gps IS NOT NULL AS has_gps
  FROM attendance_records
 WHERE date(created_at,'+8 hours') BETWEEN '2026-11-08' AND '2026-11-10'
 ORDER BY user_id, created_at;
SELECT * FROM audit_log WHERE action LIKE 'attendance.%' AND created_at >= '2026-11-07' ORDER BY id;
```

It shows whether the 9 Nov record is:
- a real holiday punch;
- a manual entry;
- an amended or forgotten punch;
- an offline replay;
- a clock-out that crossed midnight.

**Nothing is repaired silently.** A wrong record becomes a correction request in Exceptions & Approvals, decided by an approver.

### 2.3 Two further defects in the "correct" engine — FIX
1. **Today counts as absent before the shift is over.** `if (d <= todayV) absent++` counts today as soon as the report is opened, although its own comment says today before anyone clocks in is not an absence. The rule should be: absent only after the scheduled end, plus grace, has passed.
2. **There is no grace period.** A clock-in one minute after the scheduled start is "late". The directive asks for an "effective working-hour **and grace** policy".
   - **CEO A-5:** grace minutes. My recommendation is 10 minutes, stored as one System setting, effective-dated.

### 2.4 Correction history is not immutable today — FIX + DB
- Approving a forgotten punch **overwrites** `created_at`. The claimed time survives only in `audit_log`.
- **Rejecting it deletes the row.** The audit keeps a copy.
- Amending a punch (`PATCH /attendance/:id`) overwrites it, and `DELETE /attendance/:id` hard-deletes it.
- The directive requires "preserve original attendance events and immutable correction history". **This is the one place a DB change is needed** (A-7, Phase 3).

## 3. Duplicate-function assessment

| Function | Where it is today | One owner (proposed) |
|---|---|---|
| Clock in/out, location check, geofence evidence | On Shift page **and** a duplicate "On Shift" tab in Attendance | **On Shift**. The Attendance tab is removed (REMOVE-UI). |
| Today's team status | Attendance Overview table, **Dashboard "Team On Shift" card**, On Shift page "Team on shift" | **Attendance Overview owns the verdict.** The other two keep their small view but read the **same status engine** (FIX), so they can never disagree. Removing them is CEO A-9. |
| Present / late / absent rule | naive rule (Overview, Dashboard) **and** schedule rule (Reports) | **One engine:** `worker/src/attendance-day.ts` (MOVE of the verification day logic), used by every screen |
| Expected work schedule | working-hour patterns inside **Settings** | **Shift Roster** (patterns = shift templates) |
| Live sessions, task blocks, sales duty board | Attendance → Roster (RosterBoard) | **Not attendance.** It is the operational schedule. It moves to its owner (A-3); recommended: **Tasks → Calendar**, which already holds deadlines. |
| Forgotten punch / correction approvals | Settings card **and** Desk `punches` | **Exceptions & Approvals**, the same routes and rules as the Desk |
| OT decisions | Team tab **and** Desk `ot` | **Exceptions & Approvals**, the same routes and rules as the Desk |
| Unpaid leave recording | Attendance Settings (`/attendance/unpaid`, writes `leave_requests`) | **Leave** (MOVE the control; same route, same CEO-only cap) |
| OT rules, geofence | Attendance Settings, Dashboard | **System → Automation & Rules** (the existing authorized settings tab) |
| Verification report and export | Reports tab, Settings export | **Reports** |
| Task reports | Tasks (since 1.306.0) | Tasks. Not recreated here. |

## 4. Old → new tab mapping

| Old | New |
|---|---|
| Overview | **1 Overview** (with the FIXed status) |
| Attendance (my month) | **2 Attendance Records**, filtered to me for staff |
| On Shift | removed. The sidebar On Shift stays the only punch page. |
| Roster: today's assignments + operational board | **3 Shift Roster** shows the *work schedule*. The operational board moves to its owner (A-3). |
| Team: OT approvals | **4 Exceptions & Approvals** |
| Team: punch log | **2 Attendance Records** |
| Reports: verification | **5 Reports** |
| Settings: forgotten punches, manual entry, amend | **4 Exceptions & Approvals** (as decisions with a reason) |
| Settings: working-hour patterns | **3 Shift Roster → Shift Templates** |
| Settings: unpaid leave | **Leave** |
| Settings: OT rules, geofence, grace | **System → Automation & Rules** |
| Settings: export | **5 Reports → Export** |

## 5. Authoritative data ownership

| Data | Table | Owner | Attendance may |
|---|---|---|---|
| Punch events (clock in/out, GPS, device, offline replay) | `attendance_records` | **On Shift** writes; **Attendance** reconciles | read; never edit in place (Phase 3) |
| Expected schedule | `shift_patterns` + assignments | **Shift Roster** | edit (hr_manage, as today) |
| Live sessions, task blocks, sales duty | `live_sessions`, `task_blocks`, `sales_shifts` | Ecommerce/Tasks (A-3) | read for context only |
| Approved, partial and unpaid leave; balances | `leave_requests`, `leave_balances` | **Leave** | read |
| Public and replacement holidays | `holidays` | **HR Calendar** | read (`holidayEntitles` per person) |
| OT | `ot_records` | **Attendance** decides; **Payroll** pays approved OT only | decide (OT_DECIDE_ROLES) |
| Corrections | `attendance_records.pending_approval` (+ Phase 3 table) | **Exceptions & Approvals** | decide |
| Payroll figures, payslips | payroll tables | **Payroll** | nothing is written |

## 6. Correct attendance status calculation (the one engine)

For each person and each day, decided **in this order**. The first match wins:

1. **Not employed** (before `joined_on` or after `left_on`) → *not counted*.
2. **Rest day** (no block in the published pattern for that weekday) → **Rest day**. A punch on a rest day is shown as "worked on a rest day" for review. It is never "absent".
3. **Public or replacement holiday** that this person is entitled to → **Holiday**. Same rule for a punch.
4. **Approved full-day leave** → **On leave (type)**. Partial leave: the remaining blocks are judged.
5. A **pending** (unapproved) punch counts for nothing yet → **Missing punch – pending approval**.
6. **Clock-in present:**
   - first clock-in after block start **+ grace** → **Late**, otherwise **Present**;
   - last session still open after the block end + 60 min (the reminder grace that exists) → **Missing clock-out**.
7. **No clock-in:**
   - now < block start + grace → **Not yet due**;
   - start + grace ≤ now < end of the last block → **Not clocked in**;
   - **after the last block has ended** → **Absent**. This is the only path to Absent.

Hours: the existing pairing (`dayMinutesInSchedule`). Closed sessions, inside the schedule, minus the unpaid break when a block runs longer than 5 h. **Unchanged.**

The same function feeds the Overview, Records, Reports, the Dashboard card, On Shift's team view and the Desk.

## 7. Shift, leave and holiday integration
- **Shift Roster shows a computed week or month:** pattern blocks per day, overlaid with approved leave (Leave), holidays (HR Calendar, per person) and rest days. It is read from the authoritative tables, and nothing is copied.
- **Shift Templates** are the existing working-hour patterns: the editor moves here, unchanged. **Assign** sets a person's pattern from a date, using the existing effective-dated assignment, so past paid months never move.
- **Not possible today without a DB change (Phase 3, CEO A-2/A-7):**
  - one-off day changes ("Rest Day" on one Saturday for one person; Shift A for one day);
  - a **Draft / Published** roster state;
  - **Copy Roster** and **Bulk Assign** across specific dates.

  Today the roster is the weekly pattern, which is always "published".
- Leave stays the only place leave is applied, approved or recorded (unpaid included).

## 8. OT and correction approval flow

| Item | Who raises | Who decides (unchanged rules) | Self-approval |
|---|---|---|---|
| Forgotten punch / correction | the staff member (On Shift, or "Request correction" in Records) | **CEO** (super admin) today, `unpaid_leave` cap | refused (`refuseSelf`); only the verified owner may decide his own, and that is recorded and the COO is told (existing rule) |
| OT | derived from punches, **always pending** | CEO, COO, super admin, admin: approve, reject, or **replacement day** (an explicit decision that credits replacement leave, existing since before 4.0) | refused ("You cannot decide your own OT") |
| Late review | **NEW** (the reference shows it). Today a late day is a fact on the report, not a decision. | CEO A-6 | — |

- Each decision is one row on Exceptions & Approvals and one item on the Desk. They come from the **same route**: approve on either, and both clear.
- **Reject** keeps the record (Phase 3), with a reason. **Approve** may set the time; the original stays (Phase 3).
- **Not built, as it would be a new approval workflow:**
  - the reference's **HR Review → COO Approval → Final** chain;
  - **evidence uploads**;
  - **SLA / escalation**.

  The directive says "reuse backend authorization and the existing Desk decision queue". **CEO A-6.**
- OT is **never** auto-approved and **never** converted into leave automatically. The existing "replacement day" decision is an approver's explicit choice per day, and it stays (CEO A-12). Payroll reads approved OT only (unchanged).

## 9. Role and company access matrix (server-enforced, unchanged)

| Action | CEO | COO | CCO | HR admin | Super admin / admin | Manager (reports_to) | Staff |
|---|---|---|---|---|---|---|---|
| Overview (team) | ✓ | ✓ | ✓ | ✓ | ✓ | — | own day only |
| Records (all) | ✓ | ✓ | ✓ | ✓ | ✓ | — | own |
| Location: outcome word/distance | ✓ | ✓ | ✓ | ✓ | ✓ | — | own |
| Location: **raw coordinates** | CEO A-8 | | | | | — | own |
| Shift Roster view | ✓ | ✓ | ✓ | ✓ | ✓ | team (read) | own (read) |
| Shift templates / assign | ✓ | — | — | ✓ | ✓ | — | — |
| Decide a forgotten punch | ✓ | — | — | — | super admin | — | — |
| Decide OT | ✓ | ✓ | — | — | ✓ | — | — |
| Reports + export | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Request a correction | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Company:**
- Attendance is one workforce today. Users carry no A2Z / AZ ONE employer field; Payroll fixes the employer per release.
- **No company split is proposed** (CEO A-10).
- **No permission is changed by this plan.**

## 10. Desktop and PWA, against the six references

| Reference | Built as | Not copied, and why |
|---|---|---|
| 1 Overview | 4 figures (Present today x/scheduled, Late, Missing punches, On leave) **counted only among people scheduled today**; Requires Attention; Today's Schedule (the viewer's own published shift, today's holiday); Today's Attendance table; Quick Actions | "5/7" when 7 includes rest-day staff; "Fri 14 Nov"; avatars from stock photos |
| 2 Records + drawer | filters, legend chips, table, pager, Export; drawer tabs **Attendance Details · Punch History · Corrections · Audit Log** | **Stock building photos** (no photo is captured at a punch); **raw coordinates** (A-8: the outcome word and distance instead) |
| 3 / 4 Shift Roster | week grid from the patterns, with leave and holidays overlaid; Week/Month; templates; assign; totals | **A-2:** pick A or B. Publish, Copy, Bulk and per-day edits need Phase 3. Wrong holiday names and dates. |
| 5 Exceptions & Approvals | three figures (Pending · Approved today · Overdue), type pills, one table, a drawer with details and the decision; "You cannot approve your own request" | HR → COO multi-step chain, evidence files, SLA (A-6) |
| 6 Reports | report type, period, team, employee; six figures; the per-person table (the verification engine); Attendance Trend; Breakdown donut; **Export** | **"Export to Payroll" push** (Payroll already pulls verified data, so a push would be a second path); "View Export History" (NEW) |

**Phone (no reference received, so the 4.0 pattern applies):**
- the "Attendance ▾" view switch;
- figures 2×2;
- tables become cards below 768 px;
- the drawer becomes a full-height sheet;
- sticky actions above the existing Dashboard / Desk / On Shift / Tasks / More bar;
- 44 px targets;
- no sideways page at 320–430 px.

## 11. Exact files to change

| File | Change | Phase |
|---|---|---|
| `worker/src/attendance-day.ts` *(new)* | the one status engine (MOVE from the verification loop + the fixes in 2.3) | 1 |
| `worker/src/staff.ts` | `/attendance/monitor`, `/dashboard/attendance-today`, `/dashboard/summary` (on time / late), `/attendance/verification`, `/attendance/report` call the engine; pending punches excluded everywhere | 1 |
| `components/portal/attendance-panel.tsx` | 5 tabs, address, phone switch; On Shift and Settings tabs removed | 1 |
| `components/portal/attendance-overview.tsx` | rebuilt to reference 1 on the engine's status | 1 |
| `components/portal/attendance-records.tsx` *(new)* | reference 2 (team and own), drawer | 1 |
| `components/portal/attendance-exceptions.tsx` *(new)* | reference 5 on the existing pending-punch and OT routes | 1 |
| `components/portal/attendance-reports.tsx` *(new)* / `verification-card.tsx` | reference 6 on `/attendance/verification` | 1 |
| `components/portal/shift-roster.tsx` *(new)* | reference 3 or 4 (A-2), computed | 2 |
| `components/portal/role-panels.tsx` (AttendanceAdminPanel) | split: patterns → Shift Roster; unpaid → Leave; decisions → Exceptions; OT rules/geofence/grace → Automation & Rules | 1–2 |
| `components/portal/leave.tsx` | the unpaid-day control (moved) | 2 |
| `components/portal/automation-rules.tsx` | OT rules, geofence, grace (moved / A-5) | 2 |
| `components/portal/dashboard*.tsx`, `on-shift.tsx` | read the engine's status (no layout change) | 1 |
| `components/portal/roster-board.tsx` | moves with the operational schedule (A-3) | 2 |
| `lib/portal-tabs.ts` | keywords only; **no role change** | 1 |
| `worker/migrations/0196_*` | **only if A-7 / A-2 are approved** (Phase 3) | 3 |
| Tests | §12 | each |

## 12. Regression tests
**Kept:** the full guard run with mutations; lint ≤125; typecheck; build; every Attendance, On Shift, Leave, Payroll, Desk and OT guard.

**New `tests/attendance4.mjs`** (direct request on SQLite, with mutations):
- **Sat 14 Nov 2026** with Mon–Fri patterns: **0 not clocked in, 0 absent**, all 7 Rest day.
- **Mon 9 Nov 2026** (replacement holiday): Holiday, never Absent. A punch that day is flagged for review, not lost.
- Before shift start + grace: Not yet due. Between start + grace and the end: Not clocked in. After the end: Absent.
- Late is measured against the person's own start + grace (08:30 starter, 10:00 host).
- Full and partial approved leave.
- A joiner before their start date is not counted.
- **A pending forgotten punch counts nowhere** (Overview, Records, Reports and Payroll agree).
- Overview, Dashboard, On Shift team view and Reports give the **same verdict for the same person and day**.
- OT is never approved without a decision; self-decisions are refused; Payroll row counts are unchanged by any attendance screen.
- No coordinates are sent to a role that may not see them (A-8).
- **No permission or tab-access change.**

**Browser `tests/browser/attendance4.py`:**
- 1440 / 1280 / 1024 / 768 / 430 / 390 / 360 / 320;
- every tab from its address;
- the phone switch; no sideways page; 44 px targets;
- the record drawer;
- an approve/reject decision;
- the Saturday fixture showing Rest day.

## 13. Phases and rollback

| Phase | Scope | DB | Rollback |
|---|---|---|---|
| **P1** | the one status engine + fixes (2.1, 2.3); 5 tabs; Overview, Records, Exceptions (existing decisions), Reports; On Shift and Settings tabs removed; all screens read one verdict | **none** | revert the files; no data touched |
| **P2** | Shift Roster (computed, templates, assign); the moves to Leave and Automation & Rules; the operational board to its owner (A-3); grace setting (A-5, uses the existing settings store if approved) | none | revert |
| **P3** *(separate approval)* | immutable corrections (`attendance_corrections`, append-only; approve/reject/amend never overwrite or delete); roster day overrides with Draft/Published, Copy, Bulk; optional evidence files and late-review decisions (A-6) | 0196 (+0197) | revert; tables stay |

Each phase is built and tested in the sandbox, then copied to your PC. **Nothing is deployed until you approve.**

## 14. CEO decisions needed

| # | Decision | Recommendation |
|---|---|---|
| **A-0** | Approve the audit, the 5 tabs and **P1** | **Yes** |
| A-1 | Fix the status rule everywhere (§6): rest days, holidays and before-shift are never "Not clocked in"/"Absent"; pending punches count nowhere | **Yes**. It is a correction, not a policy change. |
| A-2 | Shift Roster design: reference **A** (image 3) or **B** (image 4) | **B** (templates, week/month, totals), computed in P2. Publish/Copy/Bulk/per-day only with P3. |
| A-3 | The operational roster board (lives, task blocks, sales duty): where it lives | **Tasks → Calendar** (Ecommerce keeps live sessions) |
| A-4 | Run the read-only 8–10 Nov query (§2.2) and share the result | **Yes**, before P1 is released |
| A-5 | A grace period for late | **10 min**, one System setting, effective-dated |
| A-6 | Reference 5's HR→COO chain, evidence uploads, SLA, late-review decisions | **Not now.** Existing single decisions, through the Desk. |
| A-7 | Immutable correction history (no overwrite or delete of punches) | **Yes, as P3** (migration 0196) |
| A-8 | Raw GPS coordinates on screen | **CEO only**; everyone else sees the outcome and distance. **No stock photos.** |
| A-9 | Dashboard "Team On Shift" card and On Shift "Team" view | **Keep both**, reading the one engine |
| A-10 | Split attendance by company (A2Z / AZ ONE) | **No**. One workforce; Payroll sets the employer. |
| A-11 | Send the 4 missing references (phone screens) and the Master Prompt | **Yes**, or approve the 4.0 phone pattern |
| A-12 | Keep the existing OT decision "replacement day" (an approver turns one day's OT into replacement leave, by hand) | **Keep**. It is a decision, not an automatic conversion. |

---
**ONE ON SHIFT ENGINE · ONE ATTENDANCE ENGINE · ONE SHIFT ROSTER · ONE APPROVAL WORKFLOW.** Nothing is coded until you approve.
