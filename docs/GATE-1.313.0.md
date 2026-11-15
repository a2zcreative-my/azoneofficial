# GATE 1.313.0 — Tasks Workspace 5.0, Gate 3: six tabs to the board, screens only

**Status:** BUILT AND TESTED. **NOT DEPLOYED.** There is no migration.
**Authority:** the CEO, 15-11-2026: "Approved as per recommendations both" on `claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md` (TK-1 … TK-15).
**Scope:** Gate 3 is the screens only, built on records that already exist.
**Gate 4 is not built and waits for your own approval:**
- title history with a reason (0199);
- report review (0200);
- the Live Host Report with GMV screenshots (0201);
- deliverable rows and client acceptance (0202).

**Sits on:** 1.312.1. Delivered together with 1.314.0 (Accounting Phase A); the two were built and tested in the same tree.

## The six tabs (your board)
Each tab has its own address, `/portal?tab=Tasks&view=…`, and Back/Forward work. On a phone, a view switch with **Create Task** replaces the tab row.

1. **Overview** (TK-2; there was no image)
   - Four figures: My Open Tasks, In Progress, Overdue, Awaiting Review.
   - **My Priority Work:** overdue first, then due today, then high priority, then the soonest due.
   - **Team Attention** (management):
     - counts for blocked, overdue, waiting for review and no recent update, each opening the register;
     - the tasks themselves, each with its reason.
   - **Recent Progress:** the latest progress reports.
   - The status donut, the recently-closed list and the team table were removed from the Overview because they repeated other tabs.
2. **My Tasks** (image 1)
   - Four figures: Assigned Today, Due Soon, Overdue, Completed This Week.
   - One list in the board's columns, with the latest progress report under each title.
   - From 1280 px, the chosen task sits beside the list: progress, due date, priority, assignee, subtasks, Open task / Add update.
   - Four cards below: My Focus, Today's Agenda (from the roster), Upcoming Deadlines, Recent Updates.
3. **All Tasks** (image 3)
   - Five figures: Open Tasks, In Progress, Waiting Review, Overdue, Closed This Week.
   - The register, with a Department column and **Edit** on each open row. Edit opens the existing edit (title, description, priority, dates, assignee); the server still decides who may.
   - Beside it: Workload Balance, Department Breakdown, Quick Approvals.
4. **Projects** (image 4)
   - Four figures: Active Projects, At Risk, Completed This Month, Due This Week.
   - **Project Register:** Project & Client, Owner, Stage, Progress, Tasks, and Health. Health follows the TK-8 rule and shows its reason.
   - The chosen project sits beside the register: the four stages, deliverables, team, next task, recent activity, Open project.
5. **Calendar** (image 2)
   - Four figures: Events Today, Due This Week, Reviews, Milestones This Month.
   - Filters: staff, project, and type (Tasks, Deadlines, Reviews, Live Sessions, Milestones).
   - Month view (Sunday first), Week view and List view.
   - Beside it: the chosen day's schedule, Overdue Carry-Overs, Upcoming Deadlines.
   - **Client Meetings is not shown** (TK-10): nothing records a meeting.
   - A phone reads a date agenda instead of the grid.
   - The roster board stays below.
6. **Reports & Archive** (image 5)
   - Four figures: Reports Submitted, Awaiting Review, Archived, Live Host Sessions ("Gate 4").
   - The operational reports beside the **Live Host card**. The card says the form with GMV evidence comes with Gate 4, and lists the recent lives on the roster. There is no pretended form and no GMV figure.
   - The archive and the management cards are kept.

## Deviations from the images (each one decided)
- "Recurring" is not shown (TK-6).
- "Client Meetings" is not shown (TK-10).
- "ARC-…" archive numbers are not shown (TK-11).
- Deliverables have no ticks or dates (TK-9, Gate 4).
- The status words are Open, In Progress, Review, Closed. Normal priority reads Medium (TK-3).

## Server (read additions only)
- The staff picker now includes each person's **department**, and nothing more: no phone, IC, bank or salary.
- The project list now includes the completion date and a count of overdue project tasks (TK-8).

## Evidence (executed in the sandbox)
- **`tests/tasks5.mjs` (new, registered): 18 checks; all 9 deliberately broken versions were caught.**
- **Browser `tasks5.py` (new): 64/64.** It covers:
  - the six tabs and their addresses, with Back;
  - every tab's figures and the board's columns;
  - the preview beside the list at 1440 px, and aside at 1024 px;
  - today's agenda from the roster;
  - Department and Edit;
  - the Project Register and the project beside it;
  - the calendar starting on Sunday, with no Client Meetings, and the type filters;
  - the phone agenda;
  - the Live Host card at Gate 4;
  - the phone view switch;
  - **no sideways page on any view at 320–1440 px.**
- **Updated to the approved screens**, with each original intent kept:
  - `tasks-module` (the calendar's reads) and `tab-zones` (the calendar zone);
  - browser `task-progress` (Team Attention; "Review"; the phone uses the view switch);
  - browser `owner-roles` ("Due Date" column), `nav-1` (the Projects view through the address) and `project-workspace` (the calendar address; the counter's "57 / 500" spacing, which failed the same way on 1.312.0).
- **Browser results, all passing:**
  - `task-progress`: 81/81
  - `project-workspace`: 101/101
  - `task-title`: 40/40
  - `owner-roles`: 28/28
  - `phone-fixes`: 11/11
  - `hr4`: 62/62
  - `attendance4`: 38/38
  - `ecc4`: 208/208
  - `compact-dashboard`: 43/43
  - `nav-1`: 138/138
  - `shell-e1`: 30/30
  - `desk5`: 168/168
  - `payments-verify`: 63/63
  - `finance5`: 64/64
  - `overflow-sweep`: 270/270 screens
- **Checks:** typecheck is clean (app and worker); lint shows 117 warnings and 0 errors.
- **Full guard run (with 1.314.0), with the mutation pass: 200 / 200 passed.**

## Rollback
- Re-run PUSH.bat from the 1.312.1 files.
- No data was changed.
