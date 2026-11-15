# GATE 1.307.0 — Attendance Workspace 4.0: one verdict, five views

**Status:** BUILT AND TESTED. NOT DEPLOYED. **There is no database migration and no data is touched.** One permission is added: `attendance_location_raw` (the CEO, A-8).
**Authority:** the CEO, 14-11-2026: "approve as the recommendation and correct it the error issue" (A-0 to A-12 in `claude/ATTENDANCE-WORKSPACE-4.0-BLUEPRINT.md`).
**Sits on:** 1.306.0 (HR 4.0, on your PC, not deployed).

## The error, corrected
**Saturday showed staff as "not clocked in".** The cause was that "not clocked in" meant no clock-in today, whatever the day. So a rest day, a public holiday or approved leave all showed as missing. The same rule had four more faults:
- a person whose shift had not started yet showed as missing;
- today counted as absent as soon as a report was opened;
- a forgotten punch waiting for approval counted;
- "late" meant after a fixed 10:00, whatever the person's shift.

**Now there is one rule** (`worker/src/attendance-day.ts`), and every attendance screen reads it:

| The day | What it shows |
|---|---|
| Rest day (e.g. Saturday) with no work booked | **Rest day** |
| Public holiday (e.g. 09-11 Deepavali replacement) | **Public holiday** |
| Approved full-day leave | **On leave** |
| Clocked in | On shift · Present · Late · Missing clock-out (an hour after their own shift end) |
| A forgotten punch waiting for approval | **Pending approval** (counts nowhere until approved) |
| Before the shift starts, or inside the grace | **Not yet due** |
| After start + grace, before the shift ends | **Not clocked in** |
| The shift is over with no punch | **Absent** |

- **Late = after the person's own start + the grace. The grace is 10 minutes from 16-11-2026** (A-5) and none before, so a past day keeps the rule it was judged by.
- **One difference from the blueprint:** the grace is a dated constant in the worker, not a database setting. That keeps this release free of migrations. It is shown read-only in Automation & Rules. Changing it later means adding a new dated line.
- **Screens that now read the rule:**
  - Team On Shift (Dashboard and On Shift, A-9);
  - the attendance monitor (every row carries the status);
  - the Dashboard's attendance-today figures and summary;
  - your My Shift chip (Rest day / Public holiday / On leave);
  - the Users attention list (missing clock-out is no longer a fixed 18:00);
  - the staff quick view;
  - the month report.

## The five views (A-0, A-11)
Each view has its own address (`/portal?tab=Attendance&view=…`), and Back/Forward work. On a phone, the view switch replaces the tab row.

1. **Overview:**
   - four figures: Present Today, Late Arrivals, Missing Punches and On Leave Today;
   - Requires Attention;
   - Today's Schedule;
   - Today's Attendance.
2. **Attendance Records:**
   - the day register for any date, with team, staff and search filters, a status legend that filters, a day CSV and the payroll punch export;
   - the month punch log;
   - one person's day opens in a drawer with Details, Punch History, Corrections and Audit (that person's attendance events only).
3. **Shift Roster:**
   - the expected schedule, by week or month, worked out from shift patterns, roster commitments, approved leave and holidays;
   - read-only;
   - **Shift Templates** opens the working-hours editor.
4. **Exceptions & Approvals:**
   - forgotten punches and overtime in one queue;
   - **These are the same decisions as before** (A-6, A-12): approve, reject, or overtime as a replacement day. There is no new approval chain.
   - The corrections card moved here, and the Desk's links land here.
5. **Reports:**
   - the month reconciled; each figure filters the list;
   - the dates behind each figure, the six-month trend, the breakdown, CSV;
   - the daily chart.
   - The old verification card is merged into this view.

**Staff** see Attendance Records (their own month) and Shift Roster (their own row).

## What moved (nothing is copied)
- **The On Shift tab** is removed from Attendance. Punches are made on the sidebar's On Shift page.
- **The Settings tab** is split up:
  - corrections → Exceptions & Approvals;
  - working hours → Shift Templates;
  - **unpaid days → Leave → The company** (still CEO only).
- **The operational roster board** (lives, task blocks, sales duty) and **Today's assignments** → **Tasks → Calendar** (A-3), with the same permissions. The Dashboard's Live Sessions links now go there.
- **Raw GPS coordinates are shown to the CEO only** (A-8). HR, the COO and the CCO see the result and the distance (verified / outside / low accuracy / no location) in the register, the monitor and the month log.
- **Automation & Rules → Attendance policy:** the rule, shown read-only. The geofence stays in Users.

## Before you run PUSH.bat (A-4)
You approved the read-only 8–10 November check "before P1 is released". **I have no production access.** Please run this in the D1 console. It only reads data:

```sql
SELECT id, user_id, type, created_at, datetime(created_at,'+8 hours') AS myt,
       pending_approval, manual_by, amended_by, amended_at, offline_sent_at, gps IS NOT NULL AS has_gps
  FROM attendance_records
 WHERE date(created_at,'+8 hours') BETWEEN '2026-11-08' AND '2026-11-10'
 ORDER BY user_id, created_at;
SELECT * FROM audit_log WHERE action LIKE 'attendance.%' AND created_at >= '2026-11-07' ORDER BY id;
```

Nothing is repaired automatically. A wrong record becomes a correction in Exceptions & Approvals.

## Not in this release
- **Attendance P3 (A-7, migration 0196):** immutable correction history and roster overrides. It needs a separate approval.

## Two files to delete on your PC
These are unused after this release. Nothing imports them, and the build ignores them. I can't delete files on your computer:
- `components/portal/verification-card.tsx`
- `components/portal/attendance-panel.module.css`

## Evidence (executed in the sandbox)
- **Full guard run with the mutation pass: 193 / 193 passed** ("[OK] all 193 guards passed"; attendance4 newly registered).
- `tests/attendance4.mjs` passes 60 checks, covering:
  - the pure rule;
  - direct requests on Saturday 07-11, the 09-11 holiday and a working day;
  - the headcount rule by day (a Resigned record with no last day, or a future joiner, is never absent);
  - the source.
  - **All 12 deliberately broken versions were caught** (holiday ignored, pending counted, no grace, a fixed 10:00, coordinates leaked, the gate removed, and so on).
- `tab-concept`, `tab-zones`, `lazy-panels`, `roster-week`, `shift-schedule`, `remembered-views` and `unpaid-leave` now check the same rules at the new homes.
- Four older guards asserted the old wrong rule and now hold the approved one: `staff-headcount` (the headcount read by day), `pay-records` (on time from the verdict, not 10:00), `interface-v3` (a quiet chip on a rest day) and `go-live-c` (today is "ahead" until its shift is over). None was weakened. Each still checks the same thing, against the new rule.
- Browser `attendance4.py`: **38/38**. It covers the CEO and the COO, Saturday and the holiday, all five views, the drawer, Tasks → Calendar, Leave, the policy card, and eight widths with no sideways scrolling.
- Typecheck is clean (app and worker). Lint: 123 warnings, 0 errors. The build succeeded.
