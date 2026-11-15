# GATE 1.310.0 — Claims Workspace 4.0: one claims engine, one approval flow, no self-approval

**Status:** BUILT AND TESTED. NOT DEPLOYED.
- **There is no database migration, no new table, no tab-access change, and no historical claim, receipt, payment or audit record is rewritten.**
- This release is P1 + P2 of the blueprint. **C-6 (Reverse payment) needs a migration and is P3 — it is not in this release.**

**Authority:** the CEO, 15-11-2026: "approve as recommended" (C-0 to C-13 in `claude/CLAIMS-WORKSPACE-4.0-BLUEPRINT.md`).
**Sits on:** 1.309.0 (Leave 4.0), 1.308.0 (Staff 4.0) and 1.307.0 (Attendance 4.0), all on your PC and not deployed.

## The five views (your references)
Each view has its own address (`/portal?tab=Claims&view=…`), and Back/Forward work. On a phone, the view switch and a **Submit** button replace the tab row. A view a person does not have opens the Overview instead, never a blank page.

1. **Overview (reference 1)**
   - Five figures for the month, by claim date: **Total Claims · Pending Approval · Approved · Paid · Rejected**, each with its count and RM.
   - Total = Pending + Approved + Paid + Rejected. "Approved" means **approved and still awaiting payment**; Paid is counted apart (C-5).
   - **Claims by Category:** a donut of the month's claim lines, rejected left out.
   - **Requires Attention:** waiting for your approval · ready for payment · missing receipt · a question for you · rejected this month.
   - **Recent Claims**, with approval and payment as two separate chips.
   - Each figure opens the claims it counts.
2. **Submit Claim (reference 2)**
   - Three steps: **Claim Details → Attachments → Review & Submit**.
   - Beside the steps:
     - **My Claim Info:** the company mileage rate, the salary advance rule, and "approved is not paid".
     - **Required Documents:** a receipt for a reimbursement. A claim that is all mileage, and a salary advance, need no receipt.
   - At Attachments, a reimbursement does not go on without its receipt (C-8).
3. **My Claims (reference 3)**
   - Shows your own claims and the claims paid to you — **nobody else's** (C-4).
   - Each claim is a card with its real stages left to right (on a phone, top to bottom), taken from the server. There is no "HOD" stage.
   - Each card's own buttons: View, Attach receipt, Edit, Delete, View receipt, Print form, Send PDF.
4. **Approvals**
   - Four lists:
     - **Waiting for my approval**
     - **All pending:** your review scope. It is read only unless the server offers you an action.
     - **Ready for payment**
     - **All claims:** the register, with search.
   - Your own claim is never listed here.
5. **Reports & Payments**
   - Built from the server's own report, **by claim date or by bank date** (C-10).
   - Each payment shows its Finance status: **Booked in Finance**, **Reversed in Finance** or **Not in the cash book**.
   - Also shown: salary advances by the payroll month that recovers them, and approved against paid by category.
   - A CSV with both the claim date and the bank date.
   - HR's compilation of approved claims is unchanged.

## What changed in the rules (as approved)
- **C-1: the COO decides and pays the CEO's own claims.**
  - This covers claims the CEO raised and claims paid to the CEO.
  - It is one step: no HR review and no pre-approval.
  - The CEO can never approve, reject, pay or attach the payment proof of his own claim. This includes you as the verified owner: a claim is never an executive record.
  - **Correction found while building:** the COO's approval of the CEO's claim now counts as his turn, so it appears under "Waiting for my approval". The CEO's early approval of someone else's claim is still an override, not his turn.
  - **Correction found while building:** a claim between the CEO and the COO (the CEO's claim paid to the COO, or the reverse) could never be decided by anyone. It is now refused when it is created, when the payee is changed and when it is edited. The claimant raises it in the payee's own name instead.
- **C-2: the Super Admin no longer approves or pays claims.** It still reads every claim.
- **C-3: rejecting needs your authenticator code too.** Approving past an unfinished stage needs a reason of at least 5 characters, and the reason is recorded on the claim.
- **C-4:** My Claims holds only your own claims and the claims paid to you.
  - **Correction found by the audit (F-2):** HR and the reviewers used to see other people's claims under "My claims". That list is gone.
- **C-5: approved is "Payment due" until Mark paid, with the bank date.** The payment proof:
  - can be attached only after Mark paid;
  - is attached by the person who paid;
  - is never attached by anyone on their own claim.
- **C-7:** the cash book back-fill never books a payment again once Finance has reversed it.
- **C-8:** a reimbursement is approved only with its receipt. A mileage-only claim and a salary advance are the exceptions.
- **C-9 (a):** no server drafts.
- **C-10:** the report is the server's own. It covers the claims you are allowed to read, by claim date or by bank date. A reversed payment is listed and marked, but never added into the paid total.
- **C-11:** paying a salary advance lowers that month's payslip through Payroll's own rule. It is refused for a month whose salaries are already paid.
- **Not changed:** the 10% Direct Sales and 7% Agent + 3% Closer rules, and any historical claim, payment or audit row.

## Evidence (executed in the sandbox)
- **New `tests/claims4.mjs`: 60 checks by direct request and on the source. All 18 deliberately broken versions were caught**, including:
  - the CEO decides his own claim;
  - another decider decides the CEO's claim;
  - it is not the COO's turn;
  - a CEO–COO claim is created;
  - the Super Admin decides;
  - a reject without the code;
  - an override without a reason;
  - one's own payment proof;
  - a reversed payment booked again;
  - approval without a receipt;
  - the bank date ignored;
  - a reversed payment summed;
  - an unscoped report;
  - an advance paid into a paid month;
  - the payslip not moved;
  - an employee reading everyone's claims.
- **Browser `claims4.py`: 69/69**, covering:
  - you, a staff member and the COO, in all five views;
  - the full submit flow: details, then the receipt asked for, then the review, one submission, and the receipt sent to the new claim;
  - a mileage-only claim with no receipt;
  - the override's reason;
  - the COO approving and paying the CEO's claims;
  - reports by claim date and by bank date, with the CSV;
  - eight screen widths with no sideways scrolling.
- Updated to the approved rules, with every original check kept or replaced by the new rule:
  - `self-approval`: 58 checks, 19 mutations. The Super Admin and the CEO on his own claim are refused, the COO decides; refusals are still audited.
  - `go-live-k`: 51 checks.
  - `signature-entities`: the rejection's code.
  - `clickable-data`, `tab-zones`, `tab-concept`, `interface-v3`, `pay-records`: the figures, the zones, the list and the receipt now live in the new views.
  - browser `claims-timeline.py`: 48/48.
- Also re-run in the browser: `desk5`, `nav-1`, `shell-e1`, `hr4` and `overflow-sweep` passed; `ecc4` passed 208/208.
  - `ui-audit`, `table-shred` and `webkit-overflow` need Selenium, which this sandbox does not have, so they were not run.
- Typecheck is clean (app and worker). Lint: 122 warnings, 0 errors. The build succeeded.
- **Full guard run with the mutation pass: 196 / 196 passed** ("[OK] all 196 guards passed"; `claims4` newly registered).

## Rollback
This release is code only: re-run PUSH.bat from the 1.309.0 files. No row was changed by this release.
