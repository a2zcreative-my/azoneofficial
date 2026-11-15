# GATE 1.308.0 — Staff Workspace 4.0: one master record, six views

**Status:** BUILT AND TESTED. NOT DEPLOYED. **There is no database migration, no permission change, no tab-access change, and no data is touched.** One access tightening on the server (S-1), described below.
**Authority:** the CEO, 15-11-2026: "approve as recommended" (S-0 to S-14 in `claude/STAFF-WORKSPACE-4.0-BLUEPRINT.md`).
**Sits on:** 1.307.0 (Attendance 4.0, on your PC, not deployed).

## The six views (your six images)
Each view has its own address (`/portal?tab=Staff Details&view=…`), and Back/Forward work. On a phone, the view switch replaces the tab row, with Add staff beside it.

1. **Overview**
   - Four figures: Total Staff · Active Staff · Departments · **Profiles Missing Info**. A record counts as missing info when a working person lacks any of 12 key fields (S-5).
   - **One** department distribution card, which also holds Staff Status and Employment Type.
   - **One Needs Attention list.** Each row opens the right place:
     - roles not written;
     - incomplete records;
     - probation ending within 30 days (a count only; it opens HR);
     - leaving within 60 days;
     - sign-in blocked;
     - not on the organisation chart.
   - Quick Actions.
2. **Directory**
   - New **Employment Type** column and filter.
   - Statuses: **Active · On probation · On notice · Starting · Inactive · Resigned · Terminated** (S-4). They describe employment, never today's attendance or leave.
   - **Profile · Record** buttons on a wide screen. On a phone, tapping the row opens the profile (S-3).
   - The department cards under the list are removed; they repeated the Overview.
3. **Organisation**
   - **Leadership Summary:** the CEO, no direct supervisor, oversees the company, Direct Reports, Departments.
   - The tree, with **search person, focus department and fold / unfold**. On a phone it becomes a foldable list.
   - A Reporting lines summary.
   - **Changing a line now asks for a reason and an effective date** (S-8). They are recorded; the line itself changes when you save, and nothing is scheduled. The dialog also says it decides the person's **next** leave request, as approved in v1.260 (S-7, unchanged).
4. **Team Map**
   - The CEO at the centre, with department sectors around and names under faces.
   - Header figures: Total / Active / Next Birthdays (7 days) / On Leave today.
   - Departments on the left; Next Birthdays (**day and month only**) and On Leave (**names only**) on the right.
   - On a phone: department chips over a grid of faces.
   - Read-only, using the same staff IDs.
5. **Departments & Roles**
   - Coverage: n of m and %. There is **no "+pp" figure**, because no history exists to calculate it.
   - Everyone / Not written / Written filters, plus a department filter.
   - Each department shows "n staff · n written · n not written".
   - **Add staff to department:** the same field and lock as the record. HR fills an empty department; the CEO or an admin moves someone who already has one.
6. **Staff Records**
   - The header: photo, name, ID · position, status, joined date, tenure, plus **Print ID, Upload Document, History, Edit**.
   - **View first, then Edit / Cancel / Save.**
   - Six sections: Personal Details, Employment, Role & Access, Bank & Statutory, Documents, Emergency Contact. Each other section shows how complete it is.
   - On a phone, the record opens full screen with a way back.
   - **No Religion, Nationality, Gender or Marital Status fields** (S-11).

## S-1 — who sees private details (the one server change you should know)
- The staff list **no longer carries** NRIC, bank, account, EPF / SOCSO / tax numbers, home address, emergency contact or blood type. It only says which of them are filled.
- One person's private details are read through **`GET /staff/users/:id/private`, by the CEO and the HR tier only**. Every read is audited by field name, never by value.
- **One honest exception:** the **CEO, COO and admin tier still receive NRIC, bank and account in the list**, because the **Payroll** tab reads that list to print payslips. The Staff screens do not show them to the COO, who sees "On file · restricted". Removing them from Payroll would need a separate change to Payroll; say if you want it.
- On screen, the NRIC is **masked until Edit**.
- The ID badge prints the NRIC, so **Print ID / Print badge is only offered to the CEO and the HR tier**. The COO and CCO no longer see the button.

## Records integrity
- **Two people editing at once:** a save is refused (409) if someone else changed the same field meanwhile, so it is never silently overwritten. A save writes only the fields that were changed.
- The server now enforces the "fill once, then the CEO or an admin amends" lock for **NRIC, bank, account and the dates**, as the screen already showed. Before, the server did not enforce it for those fields.
- **Change history (S-12):** before / after values are kept for staff ID, position, department, status, dates and full name. Bank or NRIC changes are named but never shown.

## Not in this release (as recommended)
- S-9: draft → published responsibilities and staff acknowledgement.
- S-13: the database additions (employment type kept after leaving, contract end date, departments table).

## Evidence (executed in the sandbox)
- **Full guard run with the mutation pass: 194 / 194 passed** ("[OK] all 194 guards passed"; staff4 newly registered).
- `tests/staff4.mjs`: 38 checks by direct request and on the source. **All 10 deliberately broken versions were caught**, including:
  - private fields back in the list;
  - the private route ungated or not audited;
  - no concurrency check;
  - a bank value kept in the history;
  - the CEO given a supervisor;
  - the NRIC unmasked;
  - the badge printable by anyone.
- Seven older guards check the same rules at the redesigned homes: `tab-zones`, `clickable-data` (the circle checks now hold the Team Map), `role-assign`, `staff-headcount`, `staff-responsibilities`, `page-frame` and `portal-experience`.
- Browser `staff4.py`: **49/49**. It covers the CEO, COO and HR admin, all six views, filters, the line-change dialog, the masked NRIC and Edit, the history, and eight widths with no sideways scrolling. Also re-run: `leave-timeline` 62/62, `users-admin` 60/60, `agents` 62/62, `nav-1` 138/138, `shell-e1` 30/30.
- Typecheck is clean (app and worker). Lint: 123 warnings, 0 errors. The build succeeded.

## Rollback
This release is code only: re-run PUSH.bat from the 1.307.0 files. No data or schema changes.
