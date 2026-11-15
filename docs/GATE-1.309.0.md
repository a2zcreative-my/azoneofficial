# GATE 1.309.0 — Leave Workspace 4.0: one engine, five views, the server counts the days

**Status:** BUILT AND TESTED. NOT DEPLOYED.
- **There is no database migration, no new table, no tab-access change, and no existing record is rewritten.**
- Two rule changes you approved (L-1 and L-12), and one flow change (L-3), are described below.

**Authority:** the CEO, 15-11-2026: "approve as recommend and make sure it is correct flow" (L-0 to L-15 in `claude/LEAVE-WORKSPACE-4.0-BLUEPRINT.md`).
**Sits on:** 1.308.0 (Staff 4.0) and 1.307.0 (Attendance 4.0), both on your PC and not deployed.

## The five views (your five images)
Each view has its own address (`/portal?tab=Leave&view=…`), and Back/Forward work. On a phone, the view switch and an **Apply** button replace the tab row. A view a person does not have opens the Overview instead, never a blank page.

1. **Overview**
   - Five figures: Applications this month · Approved · Pending · Rejected · **On Leave Today (n of m staff)**.
   - **Pending Requests:** what waits on *you*, with Review. Staff see their own pending requests.
   - **Team Availability:** taken from Attendance's own day check, so it never disagrees with Attendance.
   - **Today's Leave** and **Upcoming (next 7 days)**: approved leave only. Only the approval chain sees the leave type.
   - **Removed:** the balance cards, the mini calendar, the quick actions and the route card with your switch.
2. **Apply Leave**
   - Three steps: Details → Review → Submitted.
   - **Working Days are counted by the server.** It takes the roster's working days and leaves out the public holidays the person is entitled to (from HR's calendar). A half day is 0.5 on one working day. The form names what it did not count, e.g. "Not counted: 16-09-2026 Malaysia Day".
   - The reason is required (5–500 characters).
   - Attachment: one PDF, JPG or PNG up to 10 MB. **Required for medical leave.**
   - **Leave Balance Impact:** before → this request → after.
   - **Approval Route:** the real steps from the Organisation chart, with HR's check shown as information only.
3. **My Leave**
   - Annual, Medical and Replacement, each as available / entitled, with any pending days.
   - Emergency and unpaid leave are one line saying what they cost.
   - **View details** shows the ledger and the replacement credits.
   - History: Request #, Leave Type, Period, Days, Status, **Last update**, and a ⋮ menu (Print form, Send PDF, Withdraw).
4. **Team Calendar**
   - **One** month grid (team leave · public holiday · pending · today).
   - Managers also get a **By person** view: the same month with the department clash marks.
   - Beside it: Team Availability and **Who's Away by Department**.
5. **Approvals & Management**
   - **Leave Management** figures: waiting on you · approved this year · **routing needs configuration**. The image's "3 Active Approval Routes" is not used, because there is no route table: the Organisation chart *is* the route.
   - **Leave Policy & Entitlements**, read from the rules (Annual 14 / Medical 14 / Replacement earned / Emergency and unpaid). **Manage Policy** opens your entitlement editor.
   - **Approval Queue:** View · Approve · Reject · **Send back**, with the stage ("Step 2 of 2 · final").
   - Below it, the full register: listed only. Decisions are made in the queue and in the details drawer, one place each.
   - The unpaid-day editor is unchanged.

## What changed in the rules (as approved)
- **L-1: the legacy / organisation switch is retired.**
  - Every new request is routed by the Organisation chart.
  - `PUT /leave/routing` now answers 410 for everyone, you included.
  - Requests submitted under the old role chain finish under their own rule.
  - The stored setting is left untouched.
- **L-2: the route is unchanged.** It is your 04-11 rule: up the chart to the CEO, with HR's check as information only. The image's "Direct Manager → HR Leave" was **not** adopted.
- **L-3: the client's number of days is ignored.** The server stores its own count.
  - A returned request resubmitted on its original dates **keeps its days**; no existing record is recalculated.
  - New dates are counted like a new request.
- **L-6 / L-7: one balance everywhere** = entitled + adjustments − approved − pending.
  - **Correction found by the audit:** replacement leave was never checked against its credits, so anyone could apply for it. It now is.
- **L-8: rest days worked are decided in Attendance → Exceptions only** (credit replacement leave, or pay as overtime). Leave shows the credits, read only.
- **L-12: deciding in an approver's place is yours alone** (the verified owner). The Super Admin no longer can.
  - It always needs a reason and your authenticator code, for approve **and** reject.
  - It is offered only in the request's details drawer.
- **Attachments are private.** They are readable only by the applicant, the people on that request's route, HR and you. Every read by someone other than the applicant is audited.

## Flow corrections made while building (your "no bug of the flow")
- **The preview cannot disagree with the submission.**
  - The form's figures come from `GET /leave/quote`, which runs the submission's own checks and writes nothing.
  - The submission counts again, so a changed roster or a new holiday is never missed.
- **A stale preview is never shown.** An answer for other dates is ignored, and "Apply for another" clears it.
- **One attachment cannot be reused**, and nobody can attach someone else's file.
- **A part-timer or a staff member following a link to Approvals sees the Overview**, not an empty page.
- **The phone view switch** (shared with Staff, HR and Attendance) now shows a chevron instead of a downward trend arrow.

## Evidence (executed in the sandbox)
- **Full guard run with the mutation pass: 195 / 195 passed** ("[OK] all 195 guards passed"; leave4 newly registered).
- **New `tests/leave4.mjs`: 50 checks by direct request and on the source, and all 15 deliberately broken versions were caught.** Examples:
  - holidays ignored;
  - the client's days trusted;
  - the reason made optional;
  - medical leave allowed without a certificate;
  - someone else's file attached;
  - the attachment readable by anyone;
  - pending days not held;
  - replacement leave unchecked;
  - the Super Admin allowed to override;
  - a reject override without your code;
  - an old record recalculated;
  - the switch brought back;
  - pending leave counted as away;
  - the rest-day card moved back into Leave.
- **Browser `leave4.py`: 59/59.** It covers you, a staff member and the COO; all five views; the real flow (dates → 4 days with Malaysia Day not counted → balance 12 → 8 → reason → Review → Submit, with the body carrying no days figure); medical with its certificate; a half day; the queue's Approve and Send back; the drawer's attachment; the override for the owner only; and eight widths with no sideways page.
- `leave-timeline.py`: 62/62.
- Updated to the approved rules, with every original check kept or replaced by the new rule: `go-live-v`, `go-live-l` (old-rule requests made as production holds them), `go-live-c`, `leave-module`, `unpaid-leave`, `tab-zones`, `tab-concept`, `staff-order`, `action-feedback`, `attendance4`, `shift-entry-coverage`.
- Also re-run in the browser: `staff4` 49/49, `hr4` 62/62, `ecc4` 208/208. `ecc4.py` still looked for the attendance statistic on Attendance → Overview; Attendance 4.0 (1.307.0) moved it to Reports. That test now checks Reports.
- Typecheck is clean (app and worker). Lint: 123 warnings, 0 errors. The build succeeded.

## Rollback
This release is code only: re-run PUSH.bat from the 1.308.0 files.
- Requests created by 1.309.0 use the same columns and stages as before.
- The routing setting row was never changed. After a rollback, the switch would show its current state (organisation).
