# GATE 1.312.0 — Finance Workspace 5.0: five views, one cash book, one company at a time

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
- **Two additive migrations:** `0197_finance_company` and `0198_expense_lifecycle`. They add nullable columns and indexes only. **No row is changed.**
- **The 10% Direct Sales and 7% Agent + 3% salesperson rules are unchanged.** No historical payment, approval, cash or audit row is rewritten.

**Authority:** the CEO, 15-11-2026, "approve as per recomment", on `claude/FINANCE-WORKSPACE-5.0-BLUEPRINT.md` (CEO-1 … CEO-14).
- Phase A (screens) and Phase B (accuracy) are built here.
- **Phase C is not built:** the reconciliation workflow table (assign reviewer, propose a correction) and the PART- ledger rows (CEO-3).

**Sits on:** 1.311.0 (Commission 5.0, on your PC, not deployed), which sits on 1.310.0 live.

## The five views (your references)
Each view has its own address, `/portal?tab=Finance&view=overview|transactions|expenses|reconciliation|reports`, and Back/Forward work. On a phone, the view switch replaces the tab row.

1. **Overview**
   - Four figures:
     - **Money In** counts verified receipts only; an unverified one shows as awaiting.
     - **Money Out.**
     - **Net Cash Movement.**
     - **Needs Attention.**
   - The 12-month trend; Money Out by category.
   - **Account Balances**, which are book balances, not bank-verified.
   - **Recent Transactions** (three) and **Needs Attention**.
   - The Financial health card stays on the Dashboard (CEO-9).
2. **Transactions**
   - One list from the one cash book.
   - Filters: direction, source, status, account and search. On a phone they are folded away.
   - Pages of 25. The CSV is the list on screen.
   - Each row opens its drawer: company, verification and history.
3. **Expenses**
   - Add Expense (folded on a phone).
   - **Due Payments / Scheduled Expenses**, which are commitments, never cash.
   - Monthly Expense Impact, the summary, and View All.
4. **Reconciliation**
   - **Out of Step** count and **Total Difference = source − cash book.** The payroll example now shows **−RM 5.00**, not RM 13,161.66 (CEO-1).
   - **Mark Reviewed keeps a record open** ("Reviewed - still open"). Only **the CEO's Accept**, with a reason of at least 10 characters, resolves it (CEO-6).
   - Other checks are folded below.
5. **Reports**
   - One report selector, one period, and the company and account filters. Each export is the table on screen.
   - **No P&L in Finance**; Accounting holds the one P&L (CEO-8).

## What changed in the rules (as approved)
- **CEO-2: one company at a time.** The choices are A2Z Creative Marketing, AZ ONE Official, or both labelled "consolidated", never silently combined.
  - Each movement, account and expense carries its company. The cash book takes it from the invoice issuer, the expense or the deal.
  - An account is never moved across companies; a used account's company is locked.
- **CEO-4:** Money In counts verified receipts only.
- **CEO-5: expense steps.** Each step is done by its own person:
  - **Recorded** (Admin, CEO or COO).
  - **Approved** (the CEO, or the COO if the CEO recorded it; never the recorder).
  - **Authorised** (the CEO).
  - **Paid** (the COO, never the authoriser). Paying needs the bank date (not in the future), the company's own account, the payment reference and evidence. The EXP- row is booked once, dated the bank date.
  - An expense is cancelled with a reason, never deleted.
- **CEO-7: manual entries.**
  - Only the CEO or COO, with a company, a reason and an idempotency key. The server sets the reference (MAN-…).
  - A module's own category is refused, and a replay is not booked twice.
- **CEO-10:** the Super Admin reads Finance but no longer corrects it or runs a bank run.

## Evidence (executed in the sandbox)
- **`tests/finance5.mjs` (new, registered):** the whole worker against SQLite with every migration, by direct request as each role. **79 checks; all 16 deliberately broken versions were caught.**
- **Browser `tests/browser/finance5.py` (new): 61/61.** It covers:
  - the CEO, COO, Admin and Super Admin;
  - the five views and their addresses, with Back/Forward;
  - the company selector, including AZ ONE's reviewed record hidden under A2Z;
  - Recent Transactions = 3 rows;
  - **−RM 5.00**;
  - reviewed shown as still open;
  - the expense step buttons per role;
  - the phone view switch, with the filters and form folded and the months as a list;
  - **no sideways page on any view at 320, 360, 390, 430, 768, 1024, 1280 and 1440 px.**
- **Updated to the approved rules**, with each original intent kept:
  - `cashflow.mjs`, `access-policy` (bank run CEO/COO);
  - `ecc4.mjs` and browser `ecc4.py` (Financial health not repeated on Finance);
  - browser `compact-dashboard.py`, `tab-concept`;
  - `attendance4` / `hr4` / `staff4` (latest migration 0198).
- **Re-run in the browser, all passing:**
  - `ecc4`: 208/208
  - `compact-dashboard`: 43/43
  - `payments-verify`: 63/63
  - `payroll-figures`: all pass
  - `nav-1`: 138/138
  - `shell-e1`: 30/30
  - `overflow-sweep`: 270/270 screens
- **Checks:** typecheck is clean (app and worker); lint shows 122 warnings and 0 errors; the build succeeded.
- **Full guard run with the mutation pass: 198 / 198 passed** ("[OK] all 198 guards passed"; `finance5` newly registered). It was run after the last fixes:
  - the evidence upload now carries the CSRF header (`csrfFetch`), which the guard caught; without it the upload would have been refused on production;
  - the retired company-expenses panel was removed, since nothing rendered it;
  - the expense step calls use fixed addresses;
  - the Accounts drawer says when it saves.

## Deploy notes
- PUSH.bat applies 0197 and 0198. `/api/v1/health/detail` probes both.
- **Recommended before deploying:** run the blueprint's seven read-only P0 queries and send me the results.
- **After deploying, one step on the screen:** Finance → Accounts. The CEO or COO gives each existing bank account its company, once. Until then, those movements show as "no company" under the consolidated view.
- The Attendance P3 migration once planned as 0196/0197 is renumbered after the Tasks/Accounting migrations.

## Rollback
- Re-run PUSH.bat from the 1.311.0 files.
- 0197/0198 add nullable columns only, so the older code ignores them.
- No row was changed by this release.
