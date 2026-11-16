# GATE 1.321.0 — Tasks Unified Workspace, phase A: Overview, My Tasks, All Tasks and one task pane

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only. The worker is unchanged, and no permission, approval, status or audit rule changed.

**Authority:** the CEO, 16-11-2026: "follow this prompt for Tasks" (A2Z OS — Tasks Module Unified Workspace Redesign).
**Sits on:** 1.320.0 (Sales 2.0 Stages 1–2), which is built and not deployed.
**Phase B (next):** Projects, Calendar (Month / Week / Agenda / Roster), Reports & Archive.

The six screenshots the brief mentions did not arrive with the message. The existing screens were used as the record of what each tab does today.

---

## The shared pieces (the brief's "Reusable components")

| The brief asks for | Built as | Where |
|---|---|---|
| SummaryStrip | **MetricStrip**. This is Sales' compact strip, moved to components/ui so Sales and Tasks draw the same one. `sales-shell.tsx` re-exports it, so there is no second copy. A cell can be pressed, and is then the list's filter. | `components/ui/metric-strip.tsx` |
| PaginationControls | "Showing 1–15 of 42", the page numbers, and rows per page **10 / 15 / 25 / 50** | `components/ui/pagination-controls.tsx` |
| FilterPopover | **Filters (n)**. It opens a panel under the toolbar, in the page's flow. It is not a dialog, so it covers nothing and does not trap the keyboard. Escape or Done closes it; Clear filters resets it. | `components/ui/filter-popover.tsx` |
| TaskToolbar · CompactTaskTable | One toolbar (search, the daily filter, then Filters, Columns and views) and one compact table. It has sortable headers (a second press reverses the order), optional columns, pagination, and a row that opens the task while its row buttons do not. **It sorts and fetches nothing itself**, so the figures and the list remain one count. | `components/portal/task-table.tsx` |
| TaskDetailDrawer | The one task pane inside the side drawer, full screen on a phone | `components/portal/task-workspace.tsx` |
| StatusStepper | The compact horizontal **To Do → In Progress → Review → Done**. Blocked, Waiting for Client and Cancelled appear as its tag. Overdue stays a due-date marker, never a step. | `components/portal/task-workspace.tsx` |

`SummaryStrip` is not used as a name because `tab-concept.tsx` already has a different SummaryStrip (a tile grid). A second component with the same name would be a duplicate.

## The one task pane (My Tasks and every drawer)

From top to bottom:

- The title bar, with Edit Title.
- The project and client line.
- The **status menu**. It offers only the moves the server allows.
- **The facts in one line:** Priority, Due (with "n day(s) overdue"), Assigned to, Progress.
- **The stepper.**
- **The decisions:** the review bar with Submit for review, Approve, Return, Close, Cancel and Reopen. Each appears only when the server says so. This sits above the sections and is never hidden behind a tab.
- **Five sections:**
  - **Details:** the status summary, Task information with Edit, the acknowledgement and helper facts, and the task's own commands (Acknowledge, Delete).
  - **Checklist:** the deliverables.
  - **Updates:** the one composer, and the feed with its filters, Edit and Withdraw.
  - **Files.**
  - **Activity.**

**One composer.** "Update Task" and "Quick Update" are now one box with three modes:

- **Comment:** posted to the comments route, with the @mentions resolved as before.
- **Progress note:** posted to the updates route.
- **Status update:** the drawer's own Add Status Update form, drawn inline. It handles the status, reported %, outstanding deliverables, completion summary, exception reason and files, with the same checks and the same once-only key.

The status menu, Approve & close, Close task and a row's **Update** all open this composer on the right step.

The pane reads what a person may do from the server's `can` only, never from a role. Self-approval stays impossible because the server decides it, exactly as before.

**Retired:**
- The v1.319.0 full task page (and its browser-history step).
- The beside layout's separate Update Task card and Notes card.

Their contents are all in the pane.

## Overview

- **The compact strip:** Total, Overdue, In Progress, Awaiting Review, Done. Each cell is the queue's filter and shows when it is pressed.
- **The priority queue is the main workspace:**
  - overdue and blocked first, then the soonest due, a page at a time (10 to start);
  - Status stays in reach;
  - Project, Department and Staff sit behind Filters;
  - Table and Board as before.
- **One secondary panel**, switched between:
  - **Staff** (Staff Performance for those who manage the team, or My Today for everyone else), **with the Weekly Summary**;
  - **Activity** (Recent Activity);
  - **Actions** (Quick Links and the workflow strip).

  Nothing was dropped. These were three rail cards and two footer cards; they are now one panel.

## My Tasks

- The strip of four. A pressed cell shows the filter in force.
- **From 1024 px:** the card list (35 %) and the chosen task in the pane (65 %). This used to start at 1280 px.
- **Below 1024 px:** the full-width card list. A task opens full screen in the drawer.
- List / Board / Calendar as before.
- **My Day** (My Focus, Today's Agenda, Upcoming Deadlines, Recent Updates) is kept whole, folded under the list.
  - The brief moves the agenda into the Calendar's Agenda mode, which is phase B. It stays here until then, so nothing is lost in between.

## All Tasks

- The strip of five.
- **One register:**
  - **Toolbar:** search, status, **Filters** (Department, Assigned to, Project, Priority, Due from, Due until), **Columns**, List / Board, **Insights**.
  - **Columns:** Task & Context, Status, Priority, Due Date, Assignee, Department, Progress, Subtasks (hidden to start), and the row commands.
  - **Sorting:** by task, status, priority, due date, assignee and progress. A second press reverses the order.
  - **Pagination:** 15 rows a page to start; 10, 25 or 50 to choose.
  - **Opening a task:** a row opens the drawer.
  - **Row commands kept:** Edit, Update and Delete. Each does what it did before and does not open the row.
- **Insights** holds Workload Balance, Department Breakdown and Quick Approvals. It is closed to start.
- The tab is still only for those who manage the team, as before.

## States

| State | Where |
|---|---|
| Loading | Skeleton rows in every list and in the pane |
| Empty | "No task matches — clear the search or a filter", "No tasks yet. Create Task starts the first one", and similar |
| Error | The pane shows the server's message (`data-state="error"`) |
| Permission denied | All Tasks is not offered to a person outside management. Actions the server refuses are not drawn (`can`). The server still refuses a direct request. |

## Where the brief was not followed literally, and why

| The brief | What was built | Why |
|---|---|---|
| "SummaryStrip" | MetricStrip | A different SummaryStrip already exists (tab-concept.tsx). One strip is now shared by Sales and Tasks. |
| The four status words only | The stepper keeps Blocked, Waiting for Client and Cancelled as a tag | The brief's own rule: these come from business rules, they are not stages. |
| My Tasks agenda into Calendar Agenda | Kept in My Day for now | The Calendar's Agenda mode is phase B. Removing it first would lose a feature in between. |
| Quick Actions as a separate panel | One face of the one panel (Quick Links + workflow) | Keeps one secondary panel, as the brief asks. |

## Evidence (executed in the sandbox)

- **`tests/tasks-unified.mjs` (new, registered):** 35 checks; all 23 deliberately broken versions were caught.
- **`tests/browser/tasks-unified.py` (new):** 112/112 checks. It covers the strip and its filter cells, the queue's pages, the one panel and its three faces, All Tasks (sort both ways, Columns, the Department and due-range filters, Clear, Insights, row versus row command, Update opening the composer), the comment posted to the comments route and never as an update, and nine widths from 320 px to 1440 px. Those widths include 402 px with Staff Performance kept inside the screen; this is the overflow you reported on 16-11.
- **Adapted to the brief, with each test's intent kept:**
  - Static: `tests/tasks2.mjs` (17 mutations caught), `tests/tasks5.mjs` (9 mutations caught), `tests/tasks-module.mjs`, `tests/tab-zones.mjs`, `tests/executive-workspace.mjs`.
  - Browser: `tests/browser/tasks2.py` 105/105, `tests/browser/tasks5.py` 80/80, `tests/browser/task-progress.py` 84/84, `tests/browser/task-closure.py` 135/135, and `tests/browser/task-title.py` 40/40 (not changed).
- Full guard run (node scripts/run-guards.mjs, 16-11-2026): **[OK] all 207 guards passed.** tsc is clean. Lint: 0 errors and 114 warnings (the limit is 125).

## Deploy notes

- No migration, no worker change, no new permission.
- Retired files: none.

## Also fixed here: your overflow report (16-11-2026, 07:52)
`ui_overflow /portal v1.319.0 tab=Tasks viewport=402`. On a phone the Staff Performance row (rank, face, name, bar, "0 / 2 (0%)") was about 30 px wider than the screen. From 1.321.0 the row is two lines on a phone: the rank, face, name and count on the first line, and the bar under the name. The new browser test checks that nothing in Staff Performance runs past the edge at every width from 320 px to 1440 px, including 402 px.
