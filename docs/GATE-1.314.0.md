# GATE 1.314.0 — Accounting Workspace 5.0, Phase A: the four tabs say what the books are

**Status:** BUILT AND TESTED. **NOT DEPLOYED.** There is no migration and no server change.
**Authority:** the CEO, 15-11-2026: "Approved as per recommendations both" on `claude/ACCOUNTING-WORKSPACE-5.0-BLUEPRINT.md` (AC-1 … AC-12).
**Scope:** Phase A is presentation only. No figure, posting, permission or record changes.

**Still to come, each with its own approval:**
- **B:** ledger accuracy. It needs the 7 read-only P0 queries first.
- **C:** a company on each journal.
- **D:** reporting.
- **E:** the server enforcing month-end, plus the period lock.
- AC-1 (who may post) is a permission change, and belongs to Phase B or later.

## What changed (your four images, with the directive's corrections)
- **Four tabs, each with its own address**, `/portal?tab=Accounting&view=overview|ledger|reports|close`. Back/Forward work. On a phone, the view switch and the period replace the tab row.
- **Overview**
  - **Trial Balance Status** says "Debits = credits (arithmetic only)" and shows the exceptions to check beside it. It never says the books are healthy.
  - Money In and Money Out are labelled **cash basis**.
  - **Posting Exceptions** counts movements not in the books, unbalanced entries and references posted twice. It no longer says "accounts in use".
  - The chart says it shows cash movement, not recognised income and expenses.
  - **Checks & Exceptions** says that a balanced trial balance does not prove the books are complete, correctly classified or matched to the bank.
- **General Ledger:** when the chart of accounts is filtered, its sum is labelled "shown accounts only", never the ledger total.
- **Financial Reports**
  - Every report reads "AZ ONE OFFICIAL + A2Z CREATIVE MARKETING · combined - one ledger for both companies, not a consolidated statement" (AC-3/AC-4). Per-company reports need a company on each journal, which is Phase C.
  - The trial balance gains a band: **Total Debit · Total Credit · Balanced (arithmetic)**.
  - The P&L is titled **cash basis (receipts and payments)**.
  - The Balance Sheet stays **not supported** (AC-5).
- **Month-End & Audit**
  - **Close month** is offered only for the month whose checks above have passed. Every other open month offers **Review checks**, which opens that month's checklist.
  - The screen still says **nothing is locked**. That is the truth: the server does not yet refuse a close that fails its checks. That refusal is Phase E.

## Evidence (executed in the sandbox)
- **`tests/accounting5.mjs` (new, registered): 14 checks; all 7 deliberately broken versions were caught.**
- **Browser `accounting5.py` (new): 31/31.** It covers:
  - the four tabs and their addresses, with Back;
  - the arithmetic/cash-basis wording;
  - "combined, not consolidated";
  - the trial balance band;
  - the cash-basis P&L, and the Balance Sheet not supported;
  - the filtered-chart label;
  - Close month only for a month that passed its checks;
  - the phone view switch;
  - **no sideways page at 320–1440 px.**
- `business-joins` now looks for the Month end panel by its new gate. Its intent (the panel's place) is kept.
- **Full guard run for 1.313.0 and 1.314.0 together, with the mutation pass: 200 / 200 passed** ("[OK] all 200 guards passed"; `tasks5` and `accounting5` newly registered).

## Rollback
- Re-run PUSH.bat from the 1.313.0 (or 1.312.1) files.
- Nothing on the server changed.
