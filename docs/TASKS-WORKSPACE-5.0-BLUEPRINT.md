# A2Z OS Tasks Workspace 5.0 — Architecture & UI/UX Implementation Blueprint

**Status:** GATE 1, a READ-ONLY audit. No code was written, no migration was made, and nothing was deployed.
**Authority:** the CEO directive "A2Z OS — TASKS WORKSPACE 5.0", 15-11-2026, with the 5-image Tasks Master Design Board: My Tasks, Calendar, All Tasks, Projects, Reports & Archive.
**Code audited:** the sandbox repository at 1.312.0 (Finance 5.0), which is built but not deployed. The Tasks code is the same as in the 1.311.0 copy on your PC.

Legend: **[C]** is a confirmed fact read in the code. **[A]** is an assumption. **[P]** is a proposal.

---

## 1. Repository assessment [C]

| Piece | Where | Size |
|---|---|---|
| Tasks page: six views, KPIs, lists, calendar, reports zone | `components/portal/tasks.tsx` | 1,512 lines |
| Task drawer: details, checklist, updates, files, activity, close/reopen, Edit Title | `components/portal/task-progress.tsx` | 1,042 |
| Project register and project drawer | `components/portal/project-workspace.tsx` | 914 |
| Written operational report (moved from HR in 1.306.0) | `components/portal/task-reports.tsx` | 167 |
| Roster board: lives, task blocks, sales duty | `components/portal/roster-board.tsx` | 3,216 |
| Task e-mails (CEO/COO/CCO) | `components/portal/task-mail-panel.tsx` | 283 |
| Task routes (list, create, PATCH, checklist, events) | `worker/src/staff.ts` (`/tasks…`) | ~600 of 20,987 |
| Progress engine: updates, files, assistants, close/reopen, activity | `worker/src/tasks-progress.ts` | 882 |
| Project engine: handoff from an accepted quotation, owner, scope, status | `worker/src/projects.ts` | 729 |
| Desk inbox items for tasks | `worker/src/desk.ts` (`tasks` bucket) | — |

### Data [C]
- **`tasks`** (0003, extended by 0083, 0149, 0159 and 0163):
  - `id, title, description, assigned_to, created_by, priority (low|normal|high|urgent), deadline, start_date`;
  - `status (open|in_progress|completed)`, `stage (waiting_client|blocked|review|cancelled)`;
  - `progress, progress_source (checklist|manual)`, `link_kind/link_id` (project, quotation, …), `created_at`.
  - **There is no company column and no department column.** A department exists only as `users.department`.
- **`task_items`** (the checklist), **`task_events`** (ack, status, reminders), **`task_comments`**, **`task_blocks`** (timed roster blocks of a task, 0095).
- **`task_updates`** (0159/0169/0170) is append-only, enforced by triggers. Its kinds include progress, blocker, waiting_client, review_request, review_approved, review_returned, correction, file, done_request, closed, closed_with_exception and reopened. Each row keeps a snapshot of status, stage and progress, plus an idempotency key.
- **`task_files`** (R2, guarded uploads) and **`task_assistants`**.
- **`projects`** (0159):
  - **one project per quotation**, enforced by `UNIQUE (quotation_id)`;
  - status `draft|ready|in_progress|waiting_client|on_hold|completed|cancelled`;
  - an owner (set by the CEO/COO), `deliverables` (a JSON list of plain text with no done flag and no date), a scope snapshot, completion requested/approved, cancellation with a reason, and `version` (optimistic lock, 409 `stale`).
- **`task_reports`** (0007): `period (daily|weekly|monthly), report_date, content, created_by`. There is **no status, type, review, evidence or history**.
- **`live_sessions`** (0056): date, start/end, platform, client, `host_user_id`, `status (scheduled|completed|cancelled)`. **No live report or GMV evidence exists anywhere** (the LIVE-REPORT blueprint of 12-11 was approved in part but never built).
- **`audit_log`** holds every task and project edit, including `changed.title: [old, new]`. **It has no append-only trigger**: the code never updates it, but the database does not refuse an update.

### Permissions in force [C]

| Capability | Roles |
|---|---|
| `team_manage` (manage any standalone task) | super_admin, admin, hr_admin, ceo, coo, cco |
| `project_manage` | super_admin, ceo, coo, cco. The Project Owner has the same rights on their own project. |
| `task_reports` (read the written reports) | super_admin, admin, hr_admin, ceo, coo, cco |
| Task title (1.289.0) | **the assignee, or a manager**; the Project Owner (or `project_manage`) on a project task. Helpers cannot. A closed task must be reopened first (T1). Empty → 400, over 200 characters → 400. The other person is told (T3). |
| Close / reopen (1.256.0) | Through the task with a completion summary. Closing with exception: a manager, with a reason. Reopening needs a reason. Checklist completion **does not** close a task. |
| Progress | Moves only with the checklist or a progress update. PATCH refuses a bare `progress` (409). |

## 2. Live versus local [C]

| Where | Version |
|---|---|
| Production (`/api/v1/health`, 15-11-2026) | **1.310.0** |
| Your PC | 1.311.0 (Commission 5.0), not deployed |
| Sandbox | 1.312.0 (Finance 5.0, built and tested, being transferred), not deployed |

The Tasks code has not changed since 1.306.0, when the written reports moved from HR. Everything in this blueprint applies equally to 1.310.0–1.312.0.

## 3. Current business logic [C]

```
Create (manager or self) ─► open ──► in_progress ──► completed (Close task, with a summary)
                              │            │                 ▲
                              │            ├─ stage waiting_client / blocked (conditions, not completion)
                              │            ├─ stage review (review_request) ─► review_approved ─┘
                              │            │                                  └► review_returned ─► in_progress
                              └────────────┴─ stage cancelled (with a reason)
completed ─► Reopen (with a reason) ─► in_progress
```
- Overdue = `deadline < today (MYT)` and not completed or cancelled.
- Progress has two sources:
  - `checklist`: the done items as a share of all items;
  - `manual`: the last progress update, kept as a snapshot on every update.
- Acknowledgement: `task_events.kind='ack'`, with nudges and reminders deduplicated.
- **Project handoff:** an accepted quotation (`quotation_acceptances`, current revision) makes **one** project (`UNIQUE quotation_id`).
  - draft → ready → in_progress. The owner is set by the CEO/COO.
  - Tasks link with `link_kind='project'`.
  - Completion is requested by the owner and approved by `project_manage`.
- **Desk** lists my open tasks and tasks to close, and links to the original record. It has no approval engine of its own.
- **Attendance** is not read by any task rule. Nothing infers completion from clock-in.

## 4. Duplicate function analysis

| Function | Today | Verdict |
|---|---|---|
| Task progress update form | One form, in the task drawer (`task-progress.tsx`), used by Tasks, Projects and the phone | ✅ Already one. Keep it. |
| Written daily/weekly/monthly reports | Tasks → Reports & Archive only. HR stopped drawing it in 1.306.0. | ✅ One home. |
| Live session schedule | The roster (`live_sessions`) | ✅ One. The Live Host Report must hang on it, not on a second session list. |
| Live host GMV report | **Two approved homes on paper:** `LIVE-REPORT-BLUEPRINT` L1 (12-11) approved a separate **Report Live** tab under Revenue; this directive puts it in **Tasks → Reports & Archive**. Neither is built. | ⚠️ **Decision TK-1.** |
| Calendar | Tasks → Calendar: task deadlines and project due dates (month grid, Monday first), plus the roster board. Leave and HR holidays have their own calendars. | ✅ No second calendar table. The new Calendar reads tasks, projects, task_blocks and live_sessions. |
| Staff task performance | Tasks → Reports & Archive (management) | ✅ Keep it in Reports. Not repeated on Overview. |
| Status words | Tasks shows Open / In progress / Waiting for review / Blocked / Waiting for client / Closed. Projects shows Draft / Ready / In progress / Waiting client / On hold / Completed / Cancelled. The board images use **To Do / Done**. | ⚠️ Decision TK-3 (one vocabulary). |
| KPI tiles | The current Overview has 5 count buttons and **repeats** them as filters on My/All Tasks | [P] Each tab gets the tiles of its reference, and no tile is repeated on the same screen. |

## 5. Screenshot-to-tab mapping

| Tab | Reference supplied | What the reference shows | Source for each element [C/P] |
|---|---|---|---|
| **01 Overview** | **No image in the board.** | The directive text: 4 tiles (My Open, In Progress, Overdue, Awaiting Review), My Priority Work, Team Attention, Recent Progress | **Decision TK-2.** [P] Built from the board's own components: the tile row of image 1, the My Tasks table rows, and the Recent Updates feed. |
| **02 My Tasks** | Image 1 | Tiles Assigned Today / Due Soon / Overdue / Completed This Week; "My Tasks" table (Task & Context, Status, Priority, Due ↑, Assignee, Progress, Subtasks, Actions ⋯); a selected task in a **right detail panel** (title, status menu, progress bar, Due/Priority/Assignee, tabs Subtasks · Comments · Attachments · Update History); a bottom row: My Focus, Today's Agenda, Upcoming Deadlines, Recent Updates | Tiles: tasks (assigned today = `created_at` today; due soon = deadline within 3 days; completed this week = closed Mon–Sun). Subtasks = `task_items`. **Today's Agenda (09:30 …) = my `task_blocks` for today** (the only timed task data); nothing is invented. "Recurring · 16–20 Nov": **no recurring model exists** (TK-6). |
| **03 All Tasks** | Image 3 | 5 tiles Open / In Progress / Waiting Review / Overdue / Closed This Week; search, Filters (2), Advanced Filters, Bulk Actions, ⋯; filter chips; table (Title, Context/Client, Status, Priority, Due, Assignee, **Department**, Progress, **Edit**, ⋯); right: Workload Balance (top 5), Department Breakdown (donut), Quick Approvals (waiting review) | Department = the assignee's `users.department` (blank → "Others"). Quick Approvals = `stage='review'` within my scope, opening the task. **Bulk Actions** limited to non-destructive ones (TK-7). |
| **04 Projects** | Image 4 | Tiles Active / At Risk / Completed This Month / Milestones Due; Project Register (Project & Client, Owner, Stage, Progress, Tasks, **Health**); a right detail panel (client, owner, due, overall progress, tabs Timeline · Key Deliverables · Team · Next Task · Recent Activity; a stage timeline Quotation Accepted → Project Kickoff → Content Production → Final Delivery) | All from `projects` plus linked tasks. **Health "At Risk"** needs a written rule (TK-8). **Deliverables have no done/date today** (TK-9). The timeline stages map onto the existing status and dates; no new engine. |
| **05 Calendar** | Image 2 | Tiles Events Today / Due This Week / Reviews Scheduled / Milestones This Month; filters (team, task type, chips Tasks · Deadlines · Reviews · Live Sessions · **Client Meetings** · Milestones); month grid **Sunday first**; Month/Week/**List**; right: the selected day's schedule, Overdue Carry-Overs, Upcoming Deadlines; legend | Tasks/Deadlines = `tasks.deadline`. Reviews = tasks in `review` (dated by their review request). Live Sessions = `live_sessions`. Milestones = project due dates (and deliverable dates if TK-9 adds them). **"Client Meetings" has no source today** (TK-10). |
| **06 Reports & Archive** | Image 5 | Tiles Reports Submitted (+% vs previous) / Awaiting Review / Archived / Live Host Sessions; Operational Reports table (Title, Type, Staff, Period, Status, Evidence, ⋯, Export, Submit Report, filters, pages); **Live Host Report form** on the right (session, platform, GMV, duration, GMV screenshots, highlights, blockers, next actions, Submit for Review / Save Draft / View History); Report Archive (ARC-2026-0118 …); Report Audit Trail | `task_reports` has no type, status, evidence or review: Phase 2 needs a migration. Archive = closed tasks plus reviewed reports. "ARC-…" numbering does not exist (TK-11). |

## 6. Six desktop design references (for approval at Gate 2)

The five board images **are** the desktop references for tabs 02–06. They will be followed in layout, order and wording, with the corrections in §5 where a figure has no source. Every tab shares the existing shell (white sidebar, gold active item, the header with **Month picker** and **+ Create Task**), the `LineTabs` row, the KPI tile component and the `erp` table style. Tab 01 has no image; the proposed layout is:

```
┌ Tasks ─────────────────────────────────────────── [▣ November 2026 ▾] [+ Create Task] ┐
│ Overview  My Tasks  All Tasks  Projects  Calendar  Reports & Archive                   │
├────────────┬────────────┬────────────┬────────────────────────────────────────────────┤
│ My Open 7  │ In Prog. 3 │ Overdue 2  │ Awaiting Review 1                               │  ← image-1 tile style
├────────────────────────────────────────────────┬──────────────────────────────────────┤
│ My Priority Work (5 rows, image-1 table rows)  │ Team Attention (managers only)       │
│ overdue → due today → high/urgent → due soonest│ blocked · overdue · waiting review   │
│ each row opens the task                        │ within my scope; each opens the task │
├────────────────────────────────────────────────┴──────────────────────────────────────┤
│ Recent Progress (image-1 "Recent Updates" feed: 6 verified task_updates, who · when)    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
A non-manager sees Recent Progress at full width in place of Team Attention.

## 7. Six Mobile PWA references (for approval at Gate 2)

None was supplied. The proposal follows the phone pattern already approved in Finance, Commission and Sales: a **view switch** in place of the tab row, tiles in **2×2**, **cards in place of tables**, filters folded in a `<details>`, the task drawer as a full-height sheet, no sideways page at 320–430 px, and 44 px targets.

| Tab | Phone layout |
|---|---|
| Overview | 2×2 tiles · My Priority Work cards · Team Attention (managers) · Recent Progress |
| My Tasks | 2×2 tiles · search + folded filters + List/Board · task cards (title, context, status chip, priority chip, due, progress bar, n/m subtasks) · the sheet opens on tap with **Add update** fixed at the bottom; the camera/gallery is the file input's `capture` |
| All Tasks | 5 tiles in a horizontally *wrapping* grid (no scroll) · search + folded filters · cards with ⋯ (Edit title, Reassign, …) · Workload and Department as folded sections · Quick Approvals as a list |
| Projects | 2×2 tiles · project cards (client, owner, stage, progress, health) · the project sheet with the stage timeline vertical |
| Calendar | 2×2 tiles · a week strip with dots + **date agenda list** (directive §8), never the 7-column grid · type chips wrap |
| Reports & Archive | 2×2 tiles · report cards · **Live Host Report as a 3-step sheet** (Session → Figures → Evidence & notes, camera upload) · Archive list · Audit trail per report |

[P] At Gate 2 I can render all twelve as screenshots from a clickable prototype that uses the fixture data, if you want images rather than these specifications (TK-12).

## 8. Task status transitions

```
            ┌──────── Waiting for Client ◄──┐ (condition: stage, not completion)
            │                                │
 Open ──► In Progress ──► Review ──► Closed │
   │        │  ▲            │   ▲      │     │
   │        │  └─ Returned ◄┘   │      └─► Reopened (reason) ─► In Progress
   │        └──► Blocked / On Hold ─────────┘ (condition)
   └──► Cancelled (reason, manager)
```
- **Who:**
  - The assignee moves Open → In Progress, sets the conditions, and requests review.
  - **Closure** follows the 1.256.0 rules: the assignee closes with a summary when no review is required; a manager closes with exception, with a reason.
  - Approve/Return of a review: the setter or a manager, never the assignee themselves.
- **A completed checklist never closes a task** [C], kept.
- The Projects mapping is in TK-3.

## 9. Management permission matrix (proposed; the backend enforces every row)

| Action | CEO | COO | CCO | HOD* | Super Admin / Admin / HR Admin | Assignee | Helper | Other staff |
|---|---|---|---|---|---|---|---|---|
| See All Tasks | ✅ | ✅ | ✅ | own dept (TK-5) | ✅ today (TK-5) | — | — | — |
| Create / assign | ✅ | ✅ | ✅ | own dept | ✅ today | self only | — | self only |
| **Edit title** | ✅ | ✅ | ✅ | own dept (TK-5) | TK-4 | TK-4 | ❌ | ❌ |
| Reassign / change deadline / scope | ✅ | ✅ | ✅ | own dept | ✅ today | deadline: tells the setter (today) | ❌ | ❌ |
| Delete | ❌ (cancel with a reason only) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve review / close with exception | ✅ | ✅ | ✅ | own dept | ✅ today | ❌ own | ❌ | ❌ |
| Project edit | ✅ | ✅ | ✅ | — | super_admin today | Project Owner: own project | updates only | ❌ |
| Review a Live Host Report | ✅ | ✅ | ✅ (L3) | — | ❌ (L3) | never their own | — | — |

\* **HOD:** an `is_hod` style flag exists for Sales (`HOD=1` in the fixtures); the Tasks code has **no HOD rule** today [C]. "Own dept" applies only if TK-5 approves it.

## 10. Task title-editing plan

**Already built in 1.289.0 [C]:**
- the existing PATCH, with no new route;
- the ID, assignment, checklist, updates, files and progress are untouched;
- closed tasks are refused (T1) and the other person is told (T3);
- empty or too-long titles are refused;
- the audit row `task.update {changed:{title:[old,new]}}` is written, and Activity shows "Title updated — changed from "A" to "B"".

**Gaps against this directive:**
1. **Reason.** Not stored. [P] Add an optional `reason` to the PATCH and the audit row. It becomes required when a manager renames someone else's task (TK-4).
2. **Who.** Today any `team_manage` role or the assignee may rename. The directive names CEO/COO/CCO (and HOD per policy) → TK-4.
3. **Company scope.** Tasks carry **no company** [C], so "within company scope" can only follow the **assignee's company membership**. Decision TK-13. Nothing is guessed from a title.
4. **Previous titles.** They are kept in `audit_log` only. [P] Phase 2 adds `task_title_history (task_id, old, new, by, at, reason)` with append-only triggers, so the history cannot be edited even though `audit_log` has no trigger.
5. **Recurring.** There is no template model [C], so a rename can never touch another task; this is stated on screen. A real recurring series is a separate project (TK-6).
6. **The UI** follows image 3: an **Edit** button on each All Tasks row opens a small title sheet (Title, Reason, Save). Start/Due dates stay in their own fields, as the example "Tugasan Mingguan (2/11–6/11)" → "Tugasan Mingguan" requires.

## 11. Live Host Report architecture

Reuses the 12-11 LIVE-REPORT blueprint (L2 and L3 approved). It moves into **Tasks → Reports & Archive** if TK-1 is approved.

- **Hangs on** one `live_sessions` row (L2: no report without a roster session). The host is that row's `host_user_id`, never sent by the browser.
- **States (proposed policy, TK-14):** `draft → submitted → reviewed → accepted`, or `returned` (for correction) → submitted (a new version).
  - "Reviewed" = a reviewer has opened and noted it; "Accepted" closes it.
  - Every version and review is append-only.
- **Data (Phase 2 migration, additive):**
  - `live_reports` (one per session: state, current version, company (L8), accepted figures);
  - `live_report_versions` (reported GMV in cents, duration, highlights, blockers, next actions, submitted by/at);
  - `live_report_files` (R2 via `putGuarded`: JPEG/PNG/WebP ≤ 8 MB, 1–4 files, sha256, served only through an authorised route);
  - `live_report_reviews`.
- **GMV is never** Verified Sales, cash, Invoice Paid, commission or payroll. No table of Sales, Finance, Commission or Payroll is written, and a test proves their row counts unchanged. The banner says so on the form.
- **Phone:** a 3-step sheet with a camera/gallery upload. A draft is kept if the upload fails.

The **operational reports** (`task_reports`) gain `type (daily|weekly|monthly|project|design)`, `status (submitted|reviewed)`, `reviewed_by/at` and optional files, as an additive Phase 2 migration. Existing reports become `submitted`, with no content changed.

## 12. Project handoff verification [C]

| Check | Result |
|---|---|
| One project per accepted quotation | ✅ `UNIQUE (quotation_id)`; handoff is refused a second time |
| Quotation reference kept | ✅ `projects.quotation_id`; the register shows the QT number |
| Owner | ✅ set by the CEO/COO (P-2) and recorded with who and when |
| Concurrent edits | ✅ `version`, 409 `stale` |
| Client acceptance | ⚠️ **The quotation acceptance is recorded; acceptance of the delivered work is not.** The image timeline ends at "Final Delivery". → TK-15 |
| Milestones vs task completion | ⚠️ Deliverables are plain text with no done/date, so they cannot be ticked as in image 4 → TK-9 |
| Salesperson/client owner rights | ✅ Kept: sales owns the opportunity; Projects only reads the quotation |

## 13. Data reuse strategy

- **One task engine:** `tasks` + `task_items` + `task_updates` + `task_files` + `task_events`. No new task table.
- **One project engine:** `projects` (+ deliverables, TK-9) and linked tasks. No second register.
- **One calendar:** a read-only aggregation API, `GET /staff/tasks/calendar?from&to&type&staff&project`, that reads tasks, projects, task_blocks and live_sessions. No calendar table.
- **One reporting home:** `task_reports` (extended) plus live reports, both in Reports & Archive.
- **One timeline:** `task_updates` + `task_events` + audit rows, merged by the existing `taskActivity`.
- **Reused components:** `LineTabs`, `ViewSwitch`, `KpiTile`, `SideDrawer`, `TaskDrawer`, `AppIcon`, the `erp` table and chips, and `useTabViewAddress` (already used by Tasks).

## 14. Required database and API changes

| Phase | Change | Kind |
|---|---|---|
| UI (Gate 3) | None. Read-only aggregations for the tiles, calendar and workload use existing tables. | no migration |
| Workflow (Gate 4) | `0199_task_title_history` (append-only) + an optional `reason` on PATCH | additive |
| Workflow | `0200_task_reports_review`: type, status, reviewed_by/at, report files | additive, existing rows untouched |
| Workflow | `0201_live_reports` (4 tables, append-only triggers) | additive |
| Workflow (if TK-9/15) | `0202_project_deliverables` (deliverable rows: title, due, done_at, done_by) + a client acceptance record | additive; the JSON list is copied once, the original column is kept |
| API | `GET /staff/tasks/calendar`; `GET /staff/tasks/workload`; `POST /staff/live-reports…`; `PATCH /staff/task-reports/:id/review` | new reads + new workflow routes only |

(The numbers follow 0198. The Attendance P3 migration once planned as 0196/0197 is renumbered after these.)

## 15. Regression tests

- **New guard `tests/tasks5.mjs`** (whole worker against SQLite, by direct request as each role, with a mutation pass), covering every item of directive §12:
  - IDs unchanged; updates and files survive; status maths; overdue at MYT midnight; checklist ≠ closure;
  - title history kept; no task other than the renamed one changes;
  - no duplicate project per quotation; the quotation reference stays valid;
  - GMV files readable only by the host and reviewers;
  - GMV writes touch no Sales/Finance/Commission/Payroll table;
  - task_reports not drawn by HR;
  - permissions by direct request (assignee, helper, other staff, HOD, Super Admin);
  - notifications sent once (idempotency key).
- **New browser test `tests/browser/tasks5.py`:** the six views and addresses with Back/Forward; each tab against its image; the Edit title sheet; the Live Host form with an upload; the phone view switch and agenda; eight widths with no sideways page.
- **Kept and re-run:** `task-title`, `task-progress`, `task-closure`, `project-workspace`, `tab-concept`, `desk5`, `hr4` (the reports stay out of HR), `overflow-sweep`, and the full guard run.

## 16. Implementation phases

| Gate | Content | Data change |
|---|---|---|
| **Gate 2** | You approve the references (§5–7), this workflow (§8–11) and the decisions TK-1…TK-15 | — |
| **Gate 3 = Phase 1 (UI only)** | The six tabs to the board, with existing data only. Live Host shows "coming in Phase 2" and no fake figures. | none |
| **Gate 4 = Phase 2 (workflow/backend)** | Title reason + history; report review; Live Host Report with GMV screenshots; deliverables/acceptance if approved | 0199–0202, additive |
| **Gate 5** | Full regression, security by direct request, mutation pass, 8 widths | — |
| **Gate 6** | Your separate deploy approval; PUSH.bat only | — |

## 17. Rollback plan

- **Phase 1 (UI only):** re-run PUSH.bat from the previous release. No data was touched.
- **Phase 2:**
  - Every migration is additive (new tables and nullable columns). Rolling back the code leaves them unused and harmless.
  - No existing row is rewritten. `task_reports` rows only gain a default status.
  - Deliverables keep the original JSON column, so the old screen still reads it.
  - Uploaded GMV files stay in R2 under their own prefix.

---

## Decisions for the CEO (Gate 2)

| # | Question | Recommendation |
|---|---|---|
| **TK-1** | Live Host Report: in **Tasks → Reports & Archive** (this directive) or the separate **Report Live** tab under Revenue (approved as L1 on 12-11)? | **Tasks → Reports & Archive**, as this newer directive says ("one operational reporting home"). L1 is withdrawn; L2 (roster session required) and L3 (CEO/COO/CCO, never their own) stay. |
| **TK-2** | Overview has no image in the board | The §6 layout, built from the board's own components. Or send an Overview image. |
| **TK-3** | One status vocabulary | Tasks show **Open · In Progress · Review · Closed**, plus conditions **Waiting for Client · Blocked/On Hold · Cancelled**. The image words "To Do" = Open and "Done" = Closed. Projects keep their own statuses, but the register uses the same chip colours: In Progress / Review (= completion requested) / Awaiting (= draft/ready) / Closed. |
| **TK-4** | Who may rename a task? | CEO, COO, CCO (and HOD per TK-5) on any task in scope, with a **required reason** when it is not their own task. The **assignee keeps renaming their own task** (approved 12-11), and the setter is told. Super Admin/Admin/HR Admin: **no longer** (keeps title edits with management). |
| **TK-5** | HOD scope in Tasks (none today) | No HOD rule in Phase 1. Add "HOD = own department" in Phase 2 only if you confirm which users are HODs per department. |
| **TK-6** | "Recurring task" label in image 1 | Not shown: no recurring model exists. A real recurring series (template + dated occurrences) is a separate project. |
| **TK-7** | All Tasks "Bulk Actions" | Only: change priority, set due date, reassign (managers), export CSV. **No bulk close and no bulk delete.** |
| **TK-8** | Project "At Risk" rule | At Risk = an overdue task on the project, **or** the due date within 7 days with delivery progress < 50%. Not Started = no task started. Otherwise On Track. Shown with the reason. |
| **TK-9** | Key Deliverables with ticks and dates (image 4) | Phase 2: deliverable rows (title, due, done by/at), kept apart from task completion (directive §7). Until then, the list is shown without ticks. |
| **TK-10** | "Client Meetings" on the Calendar | Hidden until a source exists. (Sales follow-ups have no meeting type and time today.) Do not invent one. |
| **TK-11** | Archive IDs "ARC-2026-0118" | Use the existing record id, formatted (`TSK-000123` / `RPT-000045`). No new numbering. |
| **TK-12** | Phone references as images? | Yes: render the 12 screens from a fixture-only prototype at Gate 2 if you want pictures. |
| **TK-13** | "Company scope" for tasks with no company column | Phase 1: none (as today). Phase 2: scope by the assignee's company membership, **if** you want company isolation in Tasks. |
| **TK-14** | Live report states | Draft → Submitted → Reviewed → Accepted / Returned for Correction (→ Submitted v2). The reviewer is never the host. Accepted is final; a later correction needs a manager to reopen it with a reason. |
| **TK-15** | Client acceptance of delivered work | Phase 2: the owner records it (date, client name, evidence file). It is required before management closes the project. |

**Nothing will be coded until you approve Gate 2 and then Gate 3.**
