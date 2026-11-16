# GATE 1.320.0 — Sales 2.0, Stages 1 and 2: the shared 2.0 pieces, and the new Overview

**Status:** BUILT AND TESTED. **NOT DEPLOYED.** Stopped here for your approval of Stage 3 (Quotations & Invoices).
**Migration:** none. Screens only; the worker is unchanged, and no permission, payment, commission or numbering rule changed.

**Authority:** the CEO, 15-11-2026: "Proceed the recommend" on `claude/SALES-2.0-STAGE-0-AUDIT.md` (S2-1 to S2-10 as recommended), then "Continue as approve with recommend" and "proceed with the rest of the stage as per recommend".
**Sits on:** 1.319.0, on your PC and not deployed.

The two stages are reported separately below, as the directive asks.

---

## Stage 1 — the design foundation

New shared pieces, used first by Sales and meant for every 2.0 module (Tasks, Claims, Leave, Financial Advisory), so the modules cannot drift apart:

| Piece | What it is |
|---|---|
| `components/ui/panel.tsx` | **Panel**: the white card every picture draws — a tinted icon well, the title with an optional count "(7)", one quiet line, and the card's own controls at the right. **WorkspaceGrid**: the main column with a narrower rail of panels beside it from 1280 px. **PillSwitch**: the "Everyone · Mine" and "This Week · This Month" switches. |
| `components/ui/flow-strip.tsx` | **FlowStrip**: the row of steps with arrows between them (the Sales Pipeline, the Payment Flow, the workflows). A step can carry a count and can be pressed. On a phone it scrolls sideways inside itself; the page never does. |
| `KpiRow cols` | The figure row keeps five or six figures in one row from 1280 px, as the pictures do. Below that it wraps as before. |
| `lib/sales-status.ts` | **One status map (S2-4).** A quotation is Open, Follow-up, Accepted, Partially invoiced or Invoiced, worked out from records that already exist. An invoice is Unpaid, Partially paid, Paid or Void, with Overdue as a tag. "Draft" and "Sent" are not drawn, because nothing records them. |

- The Everyone / Mine switch on Sales is now the shared pill switch, with Everyone first, as the pictures show.
- **Nothing is stored for any of it.**

## Stage 2 — the Overview (picture 01)

- **Six figures in one row:** Sales This Week, Weekly Target, Outstanding (Verified Outstanding while the CEO verifies payments), Pending CEO Verification, Due Follow-Ups, Open Quotations.
  - A consultant sees **My** Sales This Week and **My** Weekly Target.
  - With payment verification off, Pending CEO Verification says so and shows no amount.
- **The Sales Pipeline (S2-5):** Enquiry → Quotation → Follow-Up → Invoice → Payment Reported → CEO Verified → Closed Sale, each with the number of records standing on that step now.
  - Pressing a step narrows the worklist to that step's records; pressing it again, or Clear, brings everything back.
  - CEO Verified and Closed Sale have no work waiting, so they open Closed Sales.
- **The Sales Worklist** is the same one worklist as before, with the step filter added.
- **The rail:**
  - **Important Follow-Ups:** due in the next 7 days, overdue first.
  - **Recent Payment Activity:** the latest invoices, each with Paid, Partially paid or Unpaid.
  - **Team Sales Performance:** this week, for management only, from the weekly figures the server already gives management.

### Where the picture was not followed, and why
| In the picture | What was built | Why |
|---|---|---|
| "+22% vs last week" | No change is drawn | The weekly figure has no stored last week to compare with. |
| "Mark paid" on invoice rows | Report payment, or Open | S2-1: only a CEO-verified payment makes an invoice paid. |
| Team Sales Performance: This Month / YTD | This Week only | Only the week is counted per person today. Month and year would need a new server report — a later stage. |
| A pipeline step count that "moves" | A count per step | Nothing stores "a deal at step X" (R-5); each count is read from that step's own table. |

### Two things to tell you plainly
1. **The worklist under a step can show fewer records than the step's count.** The count is everything standing on that step; the worklist shows the ones that need someone now. For example, a quotation with a follow-up booked for next week counts under Follow-Up but does not wait on anyone today.
2. **The pipeline's invoice steps read the 200 newest documents the tab already loads**, as the 4.0 Overview did. Counts from the server for the whole table belong to Stage 8 (QA), or sooner if you want them.

## Evidence (executed in the sandbox)
- **`tests/sales2.mjs` (new, registered): 33 checks; all 14 deliberately broken versions were caught.** It bundles and runs the real status module.
- **`tests/browser/sales2.py` (new): 44/44.** Covers the six figures in one row, the pipeline and its filter, the rail, a consultant's view, and the eight widths with no sideways page.
- **Adapted to the approved picture, intent kept:** `tests/sales4.mjs` (26 checks, 21 mutations) and `tests/browser/sales4.py`.
- Full guard run (node scripts/run-guards.mjs, 16-11-2026, after a clean pnpm install --frozen-lockfile): [OK] all 206 guards passed. Browser: sales2 44/44, sales4 356/356. tsc clean; lint 0 errors, 114 warnings.

## Deploy notes
- No migration and no worker change.
- **After deploying:** the Sales Overview shows the six figures, the pipeline and the rail. Nothing else in Sales moves.

## Rollback
- Re-run PUSH.bat from the 1.319.0 files. No data was touched.
