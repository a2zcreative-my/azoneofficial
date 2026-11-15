# A2Z OS — Claims Workspace 4.0: UI/UX and Workflow Blueprint

**Status:** read-only source audit and design are complete. **STOP GATE: waiting for your approval.** Nothing has been coded, migrated, re-permissioned or deployed, and no production data was read or changed.
**Authority:** the CEO's directive "A2Z OS — Claims Workspace 4.0", 15-11-2026.
**Sits on:** 1.309.0 (Leave 4.0), 1.308.0 (Staff 4.0) and 1.307.0 (Attendance 4.0), all on your PC and not yet deployed.

**Source audited:**
- Screens:
  - `components/portal/role-panels.tsx` → `ClaimsPanel` (about 1,080 lines, from line 4296);
  - `claims-overview.tsx` (ClaimsOverview, ClaimsReports);
  - `claim-detail.tsx` (ClaimDrawer, timeline, dots);
  - `claims.module.css` / `claims-overview.module.css`.
- Server:
  - `worker/src/claim-chain.ts` (the one chain);
  - `claims-scope.ts` (who reads what);
  - `decision-policy.ts` (refuseSelf);
  - `staff.ts`: every `/claims*` route, the payroll salary-advance functions and `recordBankMovement`;
  - `cashbook.ts` (bookCash, reverseLive);
  - `erp.ts` (the cash back-fill);
  - `permissions.ts`.
- Earlier decisions:
  - `claude/CLAIMS-TIMELINE-AUDIT.md` (D1–D3, built in 1.254.0);
  - `claude/PHASE0-SAFETY-REVIEW.md` (D10: the CEO's own records, 1.271.0).

> **What arrived with this message.** There were five images, but only **three distinct references**: 1 Overview, 2 Submit Claim, and 3 My Claims (sent three times). Missing:
> - the Approvals and Reports & Payments desktop references;
> - all five Mobile PWA references;
> - the Master Prompt.
>
> Approvals and Reports are designed here in the same visual language. The phone screens follow the PWA pattern you approved for Staff, Attendance and Leave. Send the missing images if you want them matched exactly (decision C-12).
>
> **The pictures are illustrative.** Their names (Nursyazwani, Izzudin, Zolkefli), claim numbers, amounts (RM 260 / 1,240 / 1,060), counts, the "By HOD" stage and "Available for claim" are not real. **Nothing from them is copied.**

---

## 1. The current Claims workflow (as the code enforces it)

**One engine.** There is one table (`claims`) and one chain module (`claim-chain.ts`, used by the routes, the list, the drawer and the Desk). There is one cash booking: ref `CLM-<id>`, through `bookCash`, with a unique key.

| Claimant role | Chain | Stages (server) |
|---|---|---|
| marketing, sales_marketing, editor, live_host | staff | **HR review** (hr_admin) → **COO pre-approval** → **CEO final** |
| hr_admin | hr | **CCO pre-approval** → **CEO final** |
| coo, cco | exec | **CEO final** |
| ceo, admin tier | top | **CEO final** |

- **Final decision** (`POST /claims/:id/decide`):
  - It needs `claims_decide`, which today is **CEO and super_admin**.
  - Approve asks for the authenticator code; reject does not.
  - The write is guarded (`AND status = 'pending'`): a second press gets 409.
- **CEO before the chain is complete:** this is allowed, and recorded in `decision_note` and in the audit `chain_override`.
- **Payee conflict:**
  - If the stage's approver is the person being paid, that stage is waived to the CEO.
  - The payee may never review or pre-approve.
- **Return for information / resubmit, comments, activity:** built in 1.254.0.
- **Payment** (`POST /claims/:id/paid`):
  - Allowed only on `approved` claims.
  - `paid_at` is stamped once (`WHERE paid_at IS NULL`).
  - It records the **bank date** (D3) on the one `CLM-<id>` cash row.
  - The payment proof is attached afterwards.
- **Approval never books cash and never marks paid.** ✔
- **Salary advance:**
  - It is one amount with a reason and a payroll month (never a released month).
  - On payment, the claim route **lowers that month's `payroll_entries.net_cents` itself**.
  - Payroll also deducts paid advances whenever it computes a net (`salaryAdvanceResolver`).
- **Mileage:** the km × the rate set by the CEO (default 70 sen/km) is computed on the server and kept on the line.
- **Payee-on-behalf:** HR, the CEO or the admin tier may raise a claim paid to another staff member.

## 2. Findings: vulnerabilities, wrong transitions, duplicate postings, report errors

| # | Severity | Finding | Where | Effect today |
|---|---|---|---|---|
| **F-1** | **High (policy)** | **The CEO can approve AND mark paid his own claim** (or one paid to him). This is the 1.271.0 "executive record": audited, and the COO is told. | `decision-policy.ts refuseSelf`, `claim-chain.ts claimActions` (owner keeps his buttons) | It directly contradicts "Never allow self-approval, including executive claims". It was your D10 answer on 06-11, so this needs a new decision (C-1). |
| **F-2** | **High (privacy)** | **My Claims shows other employees' claims** to HR, the COO, the CCO and admin. For anyone who is not a decider, the tab lists `mainList` = every claim in their review scope, not their own. | `role-panels.tsx` `recordsTab = "mine"` + `mainList` | A reviewer opening *My* Claims sees colleagues' amounts and purposes. That is authorised data, but in the wrong place. |
| **F-3** | **High (finance)** | **A reversed claim payment can be booked again.** If Finance reverses a `CLM-<id>` cash row, the claim stays `paid`. The Finance back-fill ("sync from records", `erp.ts`) books every paid claim again, and `bookCash` allows a new `CLM-<id>#2` once the earlier row is reversed. | `erp.ts` back-fill + `cashbook.ts bookCash` rule | One payment, two cash rows after a reversal and a back-fill. The claim also shows Paid while the cash book says reversed. |
| **F-4** | **Medium (reports)** | **Payment Records use the moment Mark paid was pressed (`paid_at`, UTC), not the bank date.** A payment made on the 31st and recorded on the 1st lands in the wrong month. Any record before 08:00 Malaysia time falls on the previous UTC day. The CSV prints the same date. | `claims-overview.tsx ClaimsReports` (`paid_at.slice(0, 7)`) | The monthly payment total can disagree with the cash book, which uses the bank date. |
| **F-5** | **Medium (reports)** | **Reports are built in the browser from the latest 200 claims.** `GET /claims` has `LIMIT 200`, so an older month silently comes out incomplete. | `staff.ts GET /claims` + `ClaimsReports` | A monthly report goes wrong without any warning once there are more than 200 claims. |
| **F-6** | **Medium (payroll)** | **Two writers to a payslip's net.** Paying an advance edits `payroll_entries.net_cents` directly, while Payroll computes the same deduction itself. They agree today, but the claim route writes payroll figures. It also checks only "released", not "**payroll already paid**", so an advance paid after the salary transfer (before release) changes a net that has already left the bank. | `staff.ts /claims/:id/paid` | This breaks "Payroll is the authoritative recovery source", and creates a late mismatch between the net and the money paid. |
| **F-7** | Medium (control) | **The Super Admin (a system account) holds `claims_decide`.** It can approve and pay staff claims, not its own. | `permissions.ts` | Money is decided by a non-person account. Leave stopped this in 1.309.0 (L-12). |
| **F-8** | Low (control) | **An override needs no reason.** The CEO approving before HR or the COO only stores an automatic note, and a rejection needs no authenticator code. | `staff.ts decide` | The override is not explained in the CEO's own words. |
| **F-9** | Low (control) | **Payment proof upload has no self check.** The CEO could attach the proof to his own claim. | `staff.ts /payment-proof` | Minor, but it follows F-1. |
| F-10 | Info | The receipt is **optional** for every reimbursement (the reference marks it required). | `ClaimsPanel` submit | Receipts depend on the claimant remembering. |
| F-11 | Info | "Paid" in the Overview / Reports category table is "of this month's claims, how many are paid". That is correct but unlabelled, so it can be read as "paid this month". | `claims-overview.tsx` | Confusing, not wrong. |

**Confirmed correct, kept as they are:**
- One chain module.
- The state guards on review, pre-approval, decide and paid.
- Approved ≠ Paid.
- One `CLM-` row per payment (in normal use).
- The payee can never review their own claim.
- Approved and paid claims cannot be edited or deleted.
- The audit trail.
- The bank date for the cash row.
- The salary advance never touches a released month.

---

## 3. Function mapping: old → new

| Today | Becomes | Tab |
|---|---|---|
| Overview tiles (Pending, Approved, Paid…), month strip | **Total Claims · Pending Approval · Approved · Paid · Rejected** (count + RM; month by claim date, labelled) | Overview |
| — | **Claims by Category** donut (this month) | Overview |
| "Waiting on me" counts scattered across tiles | **Requires Attention**: waiting for your approval · missing receipt · ready for payment, each with View | Overview |
| Recent list | **Recent Claims** (Claim No., Date, Staff, Category, Amount, Status, View) | Overview |
| One long submit form (type, items, payee, receipt) | **3 steps: Claim Details → Attachments → Review & Submit**; right panel **My Claim Info** (real policy: mileage rate, categories, salary advance rule) + **Required Documents** | Submit Claim |
| My Claims (deciders) / "the records" (everyone else) | **My Claims = your own claims and claims paid to you, nothing else** (F-2): cards with a **horizontal timeline** (Submitted → each real stage → Payment), search, category, status, year | My Claims |
| Approvals: "Waiting on me" + "Approval history" | **Approvals:** **Waiting on me** (my_turn) · **In my review scope** (read-only, reviewers) · **Ready for payment** (CEO only, separate) · **Decided** history | Approvals |
| Reports & Payments (browser maths) | **Reports & Payments**, from a server report (F-5): month by **claim date** or by **payment date (bank date)**, payment records, salary advances (recovered by payroll month), category table, finance status of each payment, CSV | Reports & Payments |
| Claim drawer (Progress, Details, Documents, Comments, Activity) | **Kept as the one Claim Detail** for every tab; desktop side drawer, full-screen sheet on a phone | all |

## 4. Exact source files to reuse (no second engine)

- **Screens:**
  - `ClaimsPanel` (split into `claims4.tsx` + `claims4.module.css`, as Leave 4.0 did);
  - `ClaimDrawer`, `ClaimDots`, `claimStatusChip` (`claim-detail.tsx`);
  - `StageTimeline`, `KpiTile`, `Donut`, `SideDrawer`, `LineTabs` + `useTabViewAddress` + the phone `ViewSwitch`.
- **Server:**
  - `claim-chain.ts` (chain, waiting_on, my_turn, actions, timeline);
  - `claims-scope.ts`;
  - `refuseSelf`;
  - `bookCash` / `recordBankMovement` / `reverseLive`;
  - the payroll `salaryAdvanceResolver` and its recompute;
  - `/claims` routes as they are.
- **New, read-only:** `GET /staff/claims/report?month=&basis=claim|payment`. Server totals for the reader's own scope, never limited to 200 rows (F-5).

---

## 5. The actual approval route (unchanged unless you choose otherwise)

**This is the Claims policy, not the Leave chain** (role-based, not the Organisation chart, as the directive asks):

| Claimant | Route |
|---|---|
| Sales & marketing, editor, live host | HR review → COO pre-approval → **CEO approval** → Payment (CEO) |
| HR & Admin | CCO pre-approval → **CEO approval** → Payment (CEO) |
| COO, CCO | **CEO approval** → Payment (CEO) |
| **CEO himself** | **today: he approves and pays it himself (F-1)** → C-1 below |
| Payee is a stage's approver | that stage is waived to the CEO (kept) |

- The My Claims timeline draws **these** stages, with real names and times. "By HOD" in the reference does not exist and is not drawn.
- The Payment step is **never green on approval**. It turns green only when Mark paid is recorded, and it shows the bank date.

## 6. Payment controls (separate from approval)

1. **Approve** (decide) → status `approved`, Payment due. **No cash row.**
2. **Mark paid** (CEO):
   - It needs the **bank date**, which may not be later than today or earlier than the approval.
   - Optional reference.
   - It writes one `CLM-<id>` cash row (bookCash, keyed).
   - It is refused on your own claim (C-1) and twice (`paid_at IS NULL`).
3. **Payment proof:** attached after Mark paid, with a self check (F-9).
4. **Reverse payment** (new, C-6):
   - CEO, with a reason and the authenticator code.
   - It reverses the cash row through the existing `reverseLive`.
   - The claim reads **"Payment reversed – due again"**; nothing is deleted.
   - The back-fill **skips reversed claim payments** (F-3).
5. **Salary advance:**
   - Mark paid is refused once that payroll month is **paid or released** (F-6).
   - The net is recomputed by **Payroll's own function** for that person and month, never by a second formula in the claim route.

## 7. Permission matrix (proposed; ✱ = changes)

| Who | Submit | My Claims | Review / pre-approve | Approve | Pay / proof / reverse | Approvals tab | Reports & Payments |
|---|---|---|---|---|---|---|---|
| CEO (owner) | ✓ | own + paid to him | — | everyone's **except his own** ✱ (C-1) | everyone's **except his own** ✱ | all | company |
| COO | ✓ | own ✱ (F-2) | staff chain pre-approval (not as payee) | — | — | scope + **the CEO's own claims** ✱ (C-1 option b) | his scope ✱ |
| CCO | ✓ | own ✱ | HR chain pre-approval | — | — | scope | his scope ✱ |
| HR admin | ✓ (+ on behalf) | own ✱ | staff chain HR review | — | — | scope + approved (read) | staff + approved (read) |
| super_admin | ✓ | own | backstop review / pre-approval | **today ✓ → ✗** ✱ (C-2) | **today ✓ → ✗** ✱ | read | read |
| admin | ✓ (+ on behalf) | own ✱ | backstop review / pre-approval | — | — | scope | scope |
| Staff | ✓ | own + paid to them | — | — | — | — | own |

**The server enforces every cell** (claims-scope, claimActions, each route). The screen only draws what the server accepts.

---

## 8. Ten screens (desktop to your references; phone < 768 px)

The address is `/portal?tab=Claims&view=overview|submit|mine|approvals|reports`. A view a person does not have opens the Overview.

| Tab | Desktop | Mobile PWA |
|---|---|---|
| **1 Overview** (ref 1) | Five tiles (Total Claims this month · Pending Approval · Approved · Paid · Rejected, each count + RM); **Claims by Category** donut with %; **Requires Attention** (waiting for your approval, missing receipt, ready for payment, View); **Recent Claims** table (Claim No., Date, Staff, Category, Amount, Status, View) | View switch + Submit; tiles 2 × 2 + one; donut over its legend; attention as a short list; recent claims as cards |
| **2 Submit Claim** (ref 2) | Stepper **Claim Details → Attachments → Review & Submit**; Category, Amount / Date, Description; **Claim Items** (Item, Amount, + Add Item; mileage km on travel); type (Reimbursement / Salary advance with payroll month); payee (HR, CEO, admin only); right: **My Claim Info** (real policy: mileage rate, salary advance rule — no invented "available" amount) and **Required Documents** (receipt required, C-8; supporting document optional); **Next: Attachments** | One field per row; items as cards; sticky **Next / Submit**; camera or file picker for receipts |
| **3 My Claims** (ref 3) | Search · All categories · All status · This year; one card per claim: number, category · date, purpose, amount, status chip, **horizontal timeline** of the real stages (Submitted → HR / COO / CCO → CEO → Payment) with who and when, View · ⋯ (print form, edit / delete while allowed) | Cards with a vertical mini timeline; View opens the full-screen detail |
| **4 Approvals** | **Waiting on me** (Claim No., Staff, Category, Amount, Stage, View · Approve · Return · Reject; the CEO's early approval says "Approve (skip CCO pre-approval)" and asks the reason, C-3); **Ready for payment** (CEO: Mark paid with the bank date); **In my review scope** (read-only); **Decided** | Queue cards with the actions in a row; payment as its own list |
| **5 Reports & Payments** | Month picker + **basis: Claim date / Payment (bank) date**; tiles Submitted · Approved · Paid · Approved-not-paid; category table (approved vs paid, labelled); **Payment Records** (bank date, claim no., staff, claim date, amount, proof, finance status: booked / reversed); **Salary Advances** (recovered by payroll month, recovered or not); CSV with both dates | Stacked sections, one at a time; CSV button |

**Claim Detail** (one, everywhere): the existing drawer — header with number, claimant, status naming who acts; Progress (vertical timeline), Details, Documents, Comments, Activity; actions only where the server's `actions` allows them.

---

## 9. Test cases (to be added; existing guards kept)

**New `tests/claims4.mjs`** (the whole worker on SQLite, by direct request, with mutations). It covers:
- **Self-approval:**
  - the claimant and the payee cannot review, pre-approve, approve, reject, pay, attach proof or reverse their own claim — **the CEO included** (C-1);
  - super_admin cannot approve or pay (C-2).
- **Route:**
  - each chain's next stage;
  - can_act = what the endpoints accept;
  - an unauthorised call → 403;
  - concurrent decisions → one stands, the other 409;
  - an override without a reason → 400 (C-3).
- **Approved ≠ Paid:**
  - an approval writes no cash row;
  - Mark paid twice → one `paid_at`, one `CLM-` row;
  - a reversal → the claim reads due again, one live cash row;
  - **the back-fill after a reversal books nothing** (F-3).
- **Reports:**
  - the server report counts by claim date and by bank date;
  - a payment recorded on the 1st with a bank date of the 31st lands in the earlier month;
  - more than 200 claims in the database → the month is still complete (F-5).
- **My Claims:** for a reviewer it holds only their own and paid-to-them claims (F-2); another person's appears only under Approvals / Reports with authority.
- **Salary advance:**
  - Mark paid is refused once that payroll month is paid or released;
  - the net comes from Payroll's own recompute (one formula);
  - no double recovery (hash of payroll before / after).
- **History:** old claims, receipts, proofs, cash rows and audit unchanged (hash).

**Browser `tests/browser/claims4.py`:**
- the CEO, the COO, HR and staff;
- five views in the address;
- the three Submit steps;
- My Claims timeline;
- the approval queue and payment;
- the eight widths with no sideways page;
- the phone sheet.

**Existing guards kept green:** `go-live-m` (claims timeline), `claims-timeline.py`, Phase 0 self-decision guards, `unpaid-leave`, payroll and cashbook guards, the full 195-guard run.

## 10. Implementation phases

| Phase | Content | Migration | Permission change |
|---|---|---|---|
| **P1 — the five screens** | Address and phone switch; Overview (ref 1), Submit 3 steps (ref 2), My Claims own-only with timelines (ref 3, F-2), Approvals (queue, ready for payment, scope, decided), Reports & Payments by claim or bank date; the one Claim Detail | none | none |
| **P2 — controls and reports** | C-1 CEO's own claims, C-2 super_admin, C-3 override reason, F-9 proof self check, F-3 back-fill skips reversed payments, F-4/F-5 server report by bank date, F-6 advance through Payroll's recompute and the paid-month guard, C-8 receipt required | none | **C-1, C-2** |
| **P3 — optional** | C-6 Reverse payment (new columns `payment_reversed_at/by/reason`, additive), C-9 server-side drafts | one additive migration (next free number) | none |

**Rollback:**
- P1 and P2 are code only: re-run PUSH.bat from the 1.309.0 files.
- P3's columns are additive and harmless if its code is rolled back.
- No existing claim, receipt, payment, cash row or audit line is changed by any phase.

---

## 11. Decisions for you (STOP GATE)

| # | Decision | My recommendation |
|---|---|---|
| **C-0** | Build the five tabs to the references (ref 1, 2, 3; Approvals and Reports in the same style), each with its own address and the phone view switch | **Yes** |
| **C-1** | **Your own claims.** **(a)** keep the 06-11 executive record (you approve and pay your own, audited, the COO told); or **(b)** you never decide or pay your own: the **COO approves** the CEO's claim (one step), and payment is confirmed by **the COO** too, for that case only | **(b)** — your new rule says no self-approval "including executive claims"; (a) is the current behaviour |
| **C-2** | The Super Admin (system account) no longer approves or pays claims | **Yes** |
| **C-3** | Approving before the chain is complete asks for a reason (and is shown before the click); a rejection asks for the authenticator code too | **Yes** |
| **C-4** | My Claims = your own and those paid to you only; colleagues' claims stay under Approvals / Reports for those authorised | **Yes** (F-2) |
| **C-5** | Approved stays Payment due until Mark paid with the bank date; payment proof cannot be attached to your own claim | **Yes** |
| **C-6** | Add **Reverse payment** (CEO, reason, code; the cash row reversed through the cash book; the claim back to due) — needs one additive migration | **Yes, in P3** |
| **C-7** | The cash back-fill never re-books a claim payment Finance reversed | **Yes** (F-3, no migration) |
| **C-8** | A receipt is **required** for reimbursement lines (mileage-only lines and salary advances excepted) | **Yes** |
| **C-9** | "Save as draft" on Submit: **(a)** not now — the form keeps what you typed while you move between tabs; **(b)** server drafts (needs a table) | **(a)** |
| **C-10** | Reports & Payments from a server report, by claim date or by **bank date**, for the reader's own scope, never cut at 200 | **Yes** (F-4, F-5) |
| **C-11** | Salary advance: Payroll's own recompute sets the net (the claim route stops editing it), and an advance cannot be paid once that payroll month is paid or released | **Yes** (F-6) |
| **C-12** | Phone screens: build to the PWA pattern now, or wait for the five phone images (and the Approvals / Reports references) | **Build now**; adjust if you send them |
| **C-13** | Release: P1 + P2 as **1.310.0** (no migration); P3 separately | **Yes** |

**ONE CLAIMS ENGINE · ONE AUTHORITATIVE APPROVAL FLOW · NO SELF-APPROVAL · NO DUPLICATE PAYMENT POSTINGS · CORRECT FINANCIAL REPORTS.** Nothing is coded until you approve.
