# GATE 1.328.0 — People → Roster & Scheduling; On Shift in five cards; the clock confirmation is a compact centred modal

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only, plus one worker line: the new tab is added to the tab-access list, and a bell about a live now opens the new tab.
**Sits on:** 1.327.0, which is on the PC and not deployed.

**Authority:** the CEO, 16-11-2026:

> *"Perform everything as I need this system ready without waiting further!"* This approves R-1 to R-6 of claude/ROSTER-SCHEDULING-STAGE-0-AUDIT.md as recommended.

> *"Ensure that 1.328.0 and 1.329.0 done tonight without delay anything. All this must complete without my review. I have approved it based on recommended."*

> *"Fix A2Z OS → Clock In / Clock Out PWA Confirmation Popup ... This must be a centered modal, NOT a bottom sheet or full-screen page. Do not change its actual attendance functionality."*

## 1. People → Roster & Scheduling (R-1, R-4, R-5)

**The tab:**
- one new entry in People, after On Shift, at /portal/roster;
- every staff member sees it, as with Tasks and Attendance (R-5);
- the tab-access matrix governs it like any other tab.

It is one workspace over the two scheduling engines that already exist:
- the operational roster (`/staff/roster`): lives, task blocks, sales duty;
- the expected working schedule (`/staff/attendance/roster`): patterns, leave, holidays.

There is no new engine, route, table or permission.

| View | What it holds | Where it came from | Gate (unchanged) |
|---|---|---|---|
| **Today** | Scheduled today (or "Your shift today"), On shift now (the managing roles), On leave, Lives today; Today's assignments; who works today (a manager opens a person's day) | new view over the two engines | assignments: the managing roles, as on Tasks |
| **Roster Board** | RosterBoard | Tasks → Calendar | canManage / canEdit / task_delete as on Tasks |
| **Shift Roster** | ShiftRoster | Attendance | staff see their own row |
| **Shift Templates** | the pattern editor | the drawer inside Shift Roster | ceo, super_admin, admin, hr_admin |
| **Live Reports** | the Live Host Report | Tasks → Reports (R-4) | the server's rules |

**Old addresses still work:**
- `?tab=Attendance&view=roster` and Attendance's Shift Roster quick action open Shift Roster.
- The `roster-board` anchor (the Dashboard and the bell) opens the Roster Board.

## 2. What the other screens keep

- **Tasks → Calendar (R-2):**
  - tasks, deadlines, reviews and project milestones;
  - the lives left;
  - task blocks stay as "Booked work", off by default;
  - one line opens Roster & Scheduling.
- **Tasks → Reports:** the Live Host card and its figure left.
- **Attendance:** Overview, Attendance Records, Exceptions & Approvals, Reports.
- **Dashboard:** Live Sessions and "Live sessions today" open Roster & Scheduling.

## 3. On Shift: five cards from eight (R-3, layout only)

**The cards:**

1. **My Shift:**
   - status, timer, figures and facts;
   - the one Clock In / Clock Out, with everything that follows a press (waiting punches, the answer, overtime, the confirmation);
   - the GPS line, whose **Location details** opens the verification card (map, distance, Check my location).
2. **Today:** the schedule and the punches against it.
3. **My days:** This week · Recent, behind one tab row.
4. **The team** (the managing roles): one line ("6 on shift · 1 not yet clocked in · ... View in Attendance").

The punch, geofence, early clock-in, overtime, the outbox and the day verdict are untouched.

## 4. The clock confirmation: a compact centred modal

**The shared result sheet** (`components/ui/result-sheet.tsx`) is now one centred card on every screen:
- fixed position, inside all four iPhone safe areas;
- 90% of the width, up to 360 px;
- its own height, scrolling inside itself only on a screen shorter than it;
- no sideways scroll;
- the house modal surface (`.erp-modal`).

The X is 32 px with a 44 px tap ring.

**The card's content is smaller:** a 48 px tick, a smaller logo, the facts in one row, the place and the person on single lines, and a 44 px Done.

**Kept:** the tick, the title, the recorded details, the GPS status, who recorded it, and Done.

**Recorded is not verified:**
- only a punch inside the geofence is green and says "Location verified";
- outside the geofence is always the amber warning band (also for the CEO, COO and CCO, who are only never *tagged*);
- everything else reads "Not GPS verified · ...".

Clock In is green. Clock Out is gold with navy ink.

## 5. Tests run (in the sandbox, against this build)

| Check | Result |
|---|---|
| All guards (`node scripts/run-guards.mjs`) | **209 / 209 pass** (after the two test adaptations in section 7) |
| Lint | 0 errors, 115 warnings (limit 125) |
| `tests/browser/overflow-sweep.py` | 272 / 272 screens clean (8 role/width runs) |
| `tests/browser/punch-receipt.py` | 54 / 54 (centred at 1440, 390, 320, 360, 430 px) |
| `tests/browser/onshift2.py` | 60 / 60 |
| `tests/browser/tasks5.py` | 82 / 82 |
| `tests/browser/attendance4.py` | 39 / 39 |
| `tests/browser/ui-system.py` (new: Roster & Scheduling and On Shift at 1440 and 390) | 337 / 337 |

**Adapted to the approved layout, intent kept:**
- node guards: navigation, tab-concept, attendance4, tab-zones, onshift2, on-shift-module, tasks5, lazy-panels, ui-system, punch-receipt;
- browser suites: onshift2, tasks5, attendance4, punch-receipt.

**Two fixture date drifts were found and fixed in the tests, not the product:**
- the fixture's outside-geofence days are fixed dates (3, 10, 17, 24);
- its holiday is 09-11-2026. From 16-11 that holiday falls in the week before the default.

## 6. Known limits

- No real iPhone was used. Phones are Chromium device emulation at 320–430 px, which does not draw a notch, so the safe-area padding is checked in the source.
- The team register (search, filters, each person's day) is no longer on On Shift. It is Attendance → Overview's Today's Attendance (R-3).

## 7. Guards adapted at the full run

- **roster-week:** it reads the board's `task_delete` gate in roster-scheduling.tsx, where the board now lives. The rule it checks is the same.
- **shift-entry-coverage:** the fixture's day is 17-09-2026, and the worker refuses a leave that starts more than 60 days ago. From 17-11-2026 (MYT) the run failed on the calendar, not the code. The test now pins its clock to the fixture's week (20-09-2026), and every check still runs.

## Deployment

Nothing reached production. Run `PUSH.bat` when you choose. There is no migration. The worker change (the tab-access list and the live bell) deploys with it.
