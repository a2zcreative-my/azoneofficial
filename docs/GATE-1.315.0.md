# GATE 1.315.0 — Tasks Workspace 5.0, Gate 4: title history, report review, the Live Host Report, deliverables, client acceptance

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migrations:** four additive migrations, 0199–0202 (new tables with append-only triggers, nullable columns, and one copy of the written deliverables into rows). No existing row is changed.

**Authority:** the CEO, 15-11-2026: "Approved as per recommendations both", then "continue the rest". This is Gate 4 of `claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md`, as recommended (TK-1, TK-4, TK-9, TK-14, TK-15). L2 and L3 of 12-11-2026 are kept.

## What changed
### Task titles (TK-4, 0199)
- Another person's task is renamed by the **CEO, COO or CCO**, or by the **Project Owner** on a project task. A reason is **always** required.
- The **assignee** still renames their own task.
- The HR Admin, Admin and Super Admin **no longer** rename someone else's task.
- Every rename is kept in a history that cannot be rewritten: the old title, the new title, who, when and why.
- The drawer's Edit Title and the Edit form ask for the reason, and Activity shows it.

### Operational reports (0200)
- Each report has a type: Operational, Project or Design.
- It is **Submitted**, then **Reviewed** by the CEO, COO or CCO. Never by its author, and only once. The reviewer can add a note, and the author is told.

### The Live Host Report (TK-1, TK-14, 0201), in Tasks → Reports & Archive
- The **host** reports a live that is **on the roster and has already happened** (L2). The report holds:
  - GMV reported (RM), duration and company;
  - highlights, blockers and next actions;
  - **1–4 GMV screenshots** (JPEG, PNG or WebP, 8 MB). On a phone, the camera or gallery opens.
- The host saves a draft, then submits it for review.
- The **CEO, COO or CCO** can mark it reviewed, **accept** it, or **return** it for correction with what to fix (L3: never a live they hosted themselves).
  - A correction is submitted as a new version.
  - An accepted report reopens only with a reason.
- Every version, screenshot and review is kept. The database refuses an edit or a delete.
- Screenshots are served **only to the host and the reviewers**.
- **Reported GMV is the host's own figure.** It never writes a sales, payment, cash, journal, payroll or commission row; the test counts those tables before and after.

### Projects (TK-9, TK-15, 0202)
- **Deliverables** become rows to tick, with a due date and a record of who ticked each one. A ticked deliverable is not a closed task.
- Your written list is copied in once and stays in step with every edit. A removed line is marked removed, never deleted.
- The Project Owner or management **records the client's acceptance** (the date and the client's name). The signed copy goes in the project's Files.
- **A project can be confirmed completed only after this acceptance.**

## Evidence (executed in the sandbox)
- **`tests/tasks-gate4.mjs` (new, registered): 69 checks; all 10 deliberately broken versions were caught.** This runs the whole worker against every migration, by direct request as each role.
- **`tests/tasks5.mjs`: 20 checks; all 9 deliberately broken versions were caught.** It now covers the Live Host card's disclaimer, the camera upload, the return note and the real Live Host figure.
- **`tests/task-title.mjs`: 21 checks; all 6 deliberately broken versions were caught.** A manager now gives the reason; the helper mutation lifts both gates.
- **Browser results (Chromium, the fixture server; executed 15-11-2026 on the 1.315.0 build):**
  - tasks5 77/77, task-progress 81/81, project-workspace 101/101, task-title 40/40, owner-roles 28/28.
  - Neighbouring screens: accounting5 31/31, finance5 64/64, hr4 62/62, nav-1 138/138.
  - overflow-sweep: 270 of 270 screens clean (8 role/width runs).
- **Checks:** typecheck is clean (app and worker); lint shows 117 warnings and 0 errors.

## Deploy notes
- PUSH.bat applies 0199–0202. `/api/v1/health/detail` probes each one.
- The four migrations are independent of Finance's 0197/0198.
- **After deploying:**
  - Live hosts see their past roster lives under Reports & Archive → Live Host Report.
  - Project owners see the deliverables as rows to tick, and the Client Acceptance section.

## Rollback
- Re-run PUSH.bat from the 1.314.0 files.
- The new tables stay unused. Nothing existing was changed.
