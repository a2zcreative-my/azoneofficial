# GATE 1.319.0 — Tasks 2.0, Stage 1: the new Overview, My Tasks with the task beside the list, the task as a full page

**Status:** BUILT AND TESTED. **NOT DEPLOYED.** Stopped here for your approval of Stage 2.
**Migration:** none. Screens only; the worker is unchanged, and no permission changed.

**Authority:** the CEO, 15-11-2026: "Proceed the recommend" on `claude/TASKS-2.0-STAGE-0-AUDIT.md` — T2-1 to T2-21 as recommended — with seven pictures.
**Sits on:** 1.318.0 (not yet deployed).

## What Stage 1 is
The audit's Stage 1: **screens only**, drawn from data that already exists. No second Tasks or Projects system, no stored status changed, no approval rule loosened.

## What changed

### One set of status words (T2-5, T2-6)
- **To Do · In Progress · Review · Done.**
- **Waiting for Client, Blocked and Cancelled are tags** beside the word.
- **Overdue is a red marker** on an open task, never a status. A done task is never overdue.
- The stored status and stage are untouched. Only the words changed.

### Overview (picture 5 — your choice T2-2)
- **Five figures:** Total Tasks, Overdue, In Progress, Awaiting Review, Done. Each one filters the list below it.
- **Task List & Workflow:** a Table or a four-column Board, with its own filters (project, department, staff, status). The most pressing task is first: overdue, then due today, then the higher priority, then the sooner due.
- **Staff Performance**, for those who manage the team only (T2-14). The rule is printed on the card: *closed this week ÷ tasks held this week; cancelled tasks left out*.
- **My Tasks (Today)** takes that place for everyone else.
- **Quick Links, Recent Activity, the workflow strip and the week's closures.**
- The workflow strip says who really reviews: whoever set the task, the Project Owner or management. The picture's "HOD" is not a role here.

### My Tasks (pictures 2 and 3 — T2-3)
- **From 1280 px:** the card list on the left, the chosen task beside it.
  - The four steps, with the day each was reached.
  - Task Information, with Edit.
  - The Current Stage, its progress and the one next step.
  - **The update form, always open**: Update Task, Submit for Review, Mark Done. Each button appears only when the server allows that person.
  - Notes, Files and Activity.
- **Board:** four columns, one per step. A card opens the task; it carries no status dropdown (T2-7).
- **Below 1280 px** there is no room beside the list, so the list stays as it was.

### The task as a full page (picture 4 — T2-4)
- From 768 px, a task opened from the Overview, All Tasks or a board is a page: the facts strip, description, checklist, attachments, flow and progress, recent activity, the discussion, and the update form.
- **Back to the list**, the crumb and the browser's Back all return to where it was opened.
- **The page's Recent Activity shows the latest five**, with View all to open the whole record in place.
- **No record is written into the address.**
- **A phone keeps the drawer**, as approved for the PWA.

### Nothing is a second engine
| On the new screens | Where it comes from |
|---|---|
| The task's record | The same request the drawer makes |
| The update form | The drawer's own form, drawn on the page |
| Submit for Review, Mark Done | That form's one submit. Mark Done still needs the summary and every deliverable |
| The status menu | Only the moves the server offers that person |
| The four steps | The stored status and stage, said in the four words |
| Every figure | Counted from the task rows the tab already loads |

## What I left out, and why
| Item | Why |
|---|---|
| "+12% this week" on the figures | No history is kept to compare with. Stage 2 decides it (T2-15). |
| Counts from the server | Stage 2, as planned. Today's figures are counted in the browser from the loaded rows, as they always were. |
| The create wizard, drafts, labels, task type | Stage 3 — they need new data. |
| Several assignees, private tasks, stages per task | Stage 4 — they need your rules first. |
| Bookmark and share buttons (picture 4) | T2-21: a link format has to be agreed; bookmark needs a new table. |
| A "Manager / HOD" review step | Not a role in the system. |

## Three things to tell you plainly
1. **My Priority Work and Team Attention are gone from the Overview.** Their order is now the list's own order, and their four counts (blocked, overdue, waiting for review, gone quiet) are the list's Status filter. Nothing was lost, but it is one press further away.
2. **The four cards under My Tasks stay** (My Focus, Today's Agenda, Upcoming Deadlines, Recent Updates). They are not in picture 2. Say if you want them removed or moved.
3. **The task-closure browser test had been broken on phones since 1.313.0** and was not in the recent runs. It looked for the tab row, which a phone does not show. It is repaired and now passes at all three widths.

## Evidence (executed in the sandbox)
- **`tests/tasks2.mjs` (new, registered): 37 checks; all 17 deliberately broken versions were caught.** It bundles and runs the real rules module.
- **`tests/browser/tasks2.py` (new): 105/105.** Overview, the page, My Tasks, the board, a person with no team, a phone, and the eight widths with nothing past the screen's edge.
- **Adapted to the approved design, intent kept:**
  - `tests/browser/tasks5.py` 76/76;
  - `task-progress.py` 84/84;
  - `task-closure.py` 135/135;
  - `task-title.py` 40/40.
- **Also run after the change:** `project-workspace.py` 101/101, `overflow-sweep.py` 270 of 270 screens clean, `nav-1.py` 138/138.
- **Source guards updated for the new screens:** `tasks5.mjs` (20 checks, 9 mutations), `tasks-module.mjs` (25), `tab-zones.mjs` (109).
- **Full run (after the last change): 205 of 205 guards passed** (tasks2 newly registered). TypeScript clean; lint 0 errors, 114 warnings (limit 125).

## Deploy notes
- No migration and no worker change.
- **After deploying:** staff see the new Overview and My Tasks at once. Status chips read To Do and Done where they read Open and Closed.

## Rollback
- Re-run PUSH.bat from the 1.318.0 files. No data was touched.
