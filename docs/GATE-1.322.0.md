# GATE 1.322.0 — The positions list

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** **0204_staff_positions — additive.** It adds two new tables with their indexes and triggers. No existing table is altered and no existing row is changed.
**Authority:** the CEO, 16-11-2026: *"for the position, I want to add my ownself for the roles which is can be linked with Super Admin for CEO, this is allowed me to add and edit the roles which is there is a might of the position changes and requirement needs based on operation requirement"*. Asked to choose, the CEO picked **"Position list (Recommended)"**. The plan is `claude/POSITIONS-STAGE-0-AUDIT.md` (P-1 to P-7).
**Sits on:** 1.321.0, which is on the PC and not deployed.

## What you can do now

On **Staff → Departments & Roles**, a **Positions** card appears for you and the Super Admin only.

- **Add a position** and link it to an access level (Sales & Marketing, Editor, Live Host, HR Admin, COO, CCO, Admin, CEO, Marketing or Agent). A department is optional.
- **Edit a position:**
  - **Rename it.** You can also update the records of the people who hold the old name. This option is ticked by default, and each record change is kept on that person's history.
  - **Change its access level.** The card says plainly that this changes nobody's role.
- **Retire a position.** It is no longer offered, and the people who hold it keep it. **Show retired** lists retired positions with **Restore**.
- **History** shows who added, renamed, re-linked, retired or restored each position, and when.
- **Typed on staff records, not on the list:** the titles already on people's records. **Add to the list** puts a title into the form. When the list is empty, **Start from current positions** adds them all at once, each linked to the access level its holders have now.

On a **staff record** (Employment → Position) and on **Create staff**:

- **Picking a position:** the list is offered as suggestions. Any other title can still be typed, and is kept as text exactly as before.
- **A hint under the field** says one of three things:
  - "On the list"; or
  - "Not on the positions list – kept as typed"; or
  - "This position is normally X access; this person is Y. Their access does not change by itself", with **Review the role**, which opens Role & Access.

## What does not change (the safety rules)

- **A position never changes anybody's role or access.** Nothing in the new code writes a person's role. A role still changes only through the existing role change on Role & Access, with all of its rules:
  - who may grant what;
  - an authenticator code and a reason where needed;
  - nobody changes their own role;
  - the CEO role stays with the Super Admin.
- Positions stay text on the staff record. Payroll order, the org chart, signatures, news bylines and attendance lists read them exactly as before.
- **Only you and the Super Admin can change the list.** This is checked on the server for every change; the new guard tests it with direct requests. Everyone on staff can read the list. Agents and customers cannot.
- **Nothing is deleted.** A position is retired, never deleted. Every change is kept as written, and the database refuses an edit or a delete of a change row.
- **A new permission, `positions_manage`** (the CEO and the Super Admin), is on your permission matrix with the others under Staff Details.

## Evidence (executed in the sandbox)

- **`tests/positions.mjs` (new, registered):** 43 checks against the whole worker on SQLite with every migration applied, by direct request as the CEO, the Super Admin, the COO, the CCO, the HR Admin, the Admin, a seller, a live host and an agent. All 9 deliberately broken versions were caught. Two locks are each held twice, so no single break can show them: an agent is refused by the staff gate before positions.ts, and a rename onto a name already on the list is refused by both the check and the unique index.
- **`tests/browser/positions.py` (new):** 46/46.
  - Covers the card: adding, renaming with holders, re-linking, retiring and restoring, history, and the typed titles.
  - Covers the record's picker and hint, including that Review the role sends nothing.
  - Checks that the COO and HR Admin have no card but still have the picker, and that the Super Admin keeps the list.
  - Checks eight widths from 320 px to 1440 px.
- **Adapted:** `tests/hr4.mjs`, `tests/staff4.mjs` and `tests/attendance4.mjs` now accept 0204 as the newest migration. Their intent is kept: none of those modules added a migration.
- `tests/browser/staff4.py` 49/49 and `tests/browser/users-admin.py` 60/60 (the permission matrix with the new row). Lint: 0 errors, 114 warnings. tsc is clean (app and worker).
- Full guard run (node scripts/run-guards.mjs, 16-11-2026): **[OK] all 208 guards passed.** Two earlier runs each stopped on one thing, and both were fixed. The first was `business-joins`: `docs/ERP-ROADMAP.md` must name the newest migration, and 0204 is now written there. The second was `fa-criteria2`: a time-dependent check read the notification row's own clock time, so a 10:58 timestamp matched "58". It now reads the row without its timestamp, and that guard still catches all 11 of its mutations.

## Deploy notes

- **0204 must apply on deploy.** Until it does, the server answers "Run PUSH.bat so migration 0204 applies", the Positions card does not appear and Position stays a plain text box. The health check names 0204.
- No change to sign-in or to the role-change rules.
- Files retired: none.
