# A2Z OS — Finance Workspace 5.0: Architecture & UI/UX Blueprint

**Status:** READ-ONLY AUDIT AND DESIGN. **STOPPED AT THE GATE.**
- Nothing has been coded, migrated or deployed, and no production data has been touched.
- No financial rule has been changed.

**Authority:** the CEO's directive "A2Z OS — Finance Workspace 5.0, Strict CEO Implementation Directive", 15-11-2026, with the Finance Master Design Board and its five tab references (Overview, Transactions, Expenses, Reconciliation, Reports).

**Audited code:** the sandbox copy of v1.311.0, which is identical to your PC (§1). The Finance code is the same as in live 1.310.0.

Codes used in every table:

| Code | Meaning |
|---|---|
| **EXISTS** | Built and verified in the code today |
| **UX** | Screen change only (Phase A) |
| **FIX** | Financial logic change, no schema change (Phase B) |
| **DB** | Needs a migration (Phase B or C) |
| **SEC** | Security or permission rule |
| **CEO** | Needs your decision (§19) |

---

## 0. What I received

| Item | Received |
|---|---|
| Master Design Board (all five tabs, the Finance Flow and the Key Rules) | **Yes** |
| The five individual tab references (Overview, Transactions, Expenses, Reconciliation, Reports) | **Yes** |
| Mobile PWA references | **No.** None were supplied. The directive asks me to design them, and §10 does. |
| Production screenshots for comparison | The tab references show production-like figures (Nov 2026: RM 75.00 in, RM 71.30 out). I checked them against the code in §11. |

**The references are a design, not data.** Several figures in them do not follow from the records:
- money out shown as "Sales invoices";
- a bank balance of RM 13,161.66;
- a difference of −RM 13,161.66;
- due payments of RM 1,850, RM 2,000 and RM 420.

The finished screens will show only the server's own figures, never the reference's. The details are in §11.

---

## 1. Live versus local

| Where | Version | Finance code |
|---|---|---|
| **Live** (`a2zcreative.my/api/v1/health`, read 15-11-2026) | **1.310.0** | Finance 2.0, from v1.219.0 plus later fixes |
| **Your PC / sandbox** | **1.311.0**, built and not deployed (Commission 5.0) | The same Finance code. 1.311.0 changes only who confirms Paid (the CEO owner alone, K-3) and how agent payouts are settled (by the COO, K-5). Both feed Finance. |

The Finance tab today is **one page with five tabs** in `components/portal/finance-panels.tsx` (1,001 lines). The Expenses tab draws the older `ExpensesPanel` (`role-panels.tsx:5473`) together with the accrual `PnlCard` (`sales.tsx:777`).

---

## 2. Current Finance architecture

```
            ┌──────────── modules that move money ────────────┐
 Sales      │ Mark paid (PATCH /docs/:id)     ──► bookCash INV-<id>   (full total, paid day)
            │ Payment verification (payment-verify.ts) ──► bookCash INV-<id>
            │ Part payments (invoice_payments) ──► NOT booked (read live by Finance)
            │ Credit-note refund                ──► bookCash CN-<id>  (out)
 Claims     │ Pay claim                          ──► bookCash CLM-<id> (out, bank date)
 Payroll    │ Bank run done                      ──► bookCash PAYROLL-<yyyy-mm> (out, the day it is pressed)
 Commission │ Agent payout settled (COO)         ──► bookCash AGT-<id> (out, bank date)
 Expenses   │ Mark paid / create paid            ──► bookCash EXP-<id> (out, the day it is pressed)
 ELFIA      │ Bridge poll sees "paid"            ──► its OWN insert ELF-<order> (in, poll day) — not bookCash
 Live sales │ Channel reconciliation             ──► RECON-<period>-<channel>-n (in)
 Manual     │ POST /erp/cashflow                 ──► free row, ref typed by the user (+ journal CF-<id>)
            └──────────────────────────────────────────────────┘
                              │ every booking also posts a journal entry (Accounting)
                              ▼
        cashflow_entries (the cash book, 0071 + 0147)  ──  journal_entries/lines (Accounting)
                              │
                              ▼
   GET /staff/erp/cashbook  (cashbook.ts: loadAll → buildItems → exceptionsOf)
     • money in from SALES is read from the invoices, not the cash book:
       each part payment on its day, the rest of a paid invoice on its paid day
     • every other movement from the cash book, on the day it moved
     • one response feeds all five tabs (totals, groups, trend, items, banks, exceptions)
```

**What "one authoritative ledger" means today:**
- **EXISTS:** `bookCash` books an event once. Its check and write are one statement with a unique `source_key` (0147). Undoing a payment adds a reversal row and never deletes one. A transfer is a pair of rows.
- **Not yet true:**
  - Sales money in is computed from the invoices' current state, not from the ledger (F-7).
  - ELFIA and manual rows bypass `bookCash` (F-9, F-10).

---

## 3. Existing API, database and source components

| Layer | Item | Notes |
|---|---|---|
| API | `GET /staff/erp/cashbook?from&to&months` | The one read for all five tabs. Gate: `cashflow_manage`. |
| API | `POST /erp/cashbook/rows/:id/reverse` | Reversal row plus mirrored journal. Gate: `cashbook_correct`. |
| API | `POST /erp/cashbook/transfer` | Between two company accounts. Gate: **`cashflow_manage`**, which is wider than corrections (F-12). |
| API | `POST /erp/cashbook/assign-bank`, `/review`, `PATCH /banks/:id` | Gate: `cashbook_correct`. |
| API | `GET/POST /erp/banks`, `GET/POST /erp/cashflow`, `DELETE` (refused: "reverse instead"), `POST /erp/cashflow/backfill` ("Book missing") | Gate: `cashflow_manage`. |
| API | `GET/POST/PATCH/DELETE /staff/expenses`, `POST /expenses/:id/paid` | Gate: `expenses` (SA, admin, CEO, COO). |
| DB | `cashflow_entries` (0071, 0147: effective_date, source_key UNIQUE, reversal_of UNIQUE, reverse_reason, transfer_id) | **No company column** |
| DB | `bank_accounts` (0071, 0147: opening_balance_cents, opening_on) | **No company column.** The company appears only in the account's name. |
| DB | `cashbook_marks` (item_key PK: bank_id, reviewed_note/by/at) | A review **hides** the item (F-4). |
| DB | `expenses` (0032, 0033: recurring, due_day, paid_at; receipt_key unused by the form) | **No company, account, approval or payee fields.** Category is fixed to 8 values. |
| Source | `invoice_paid_confirmations`, `invoice_payments`, `invoice_payment_reports` (payment-verify.ts), `claims.paid_at`, `payroll_payments`, `web_orders`, `agent_payouts` | All read, never copied. |
| Screen | `finance-panels.tsx` (FinancePage, TrendChart, GroupBars, AccountList, ItemCards, Transactions, ItemDrawer, AddDrawer, AccountsDrawer, Reconciliation, Reports), `finance.module.css` (721 lines) | No view address (`?view=`). Back/Forward does not move between tabs. |
| Screen | `ExpensesPanel` (role-panels.tsx), `PnlCard` (sales.tsx), `FinanceHealthCard` (week-target-card.tsx) | They contain Tailwind classes, the P&L (accrual) and a card that is not in the reference. |

---

## 4. Duplicated financial functionality

| # | Duplication | Evidence | Proposal |
|---|---|---|---|
| D-1 | **Three "money in" definitions are still visible:** <br>• Finance: the parts rule (the correct cash rule); <br>• the cash book and journal: the full invoice total on the paid day; <br>• the Expenses tab: the P&L card (accrual). | `cashbook.ts:408` skips INV- rows. `bookCash INV-` books the total (`staff.ts:11830`, `payment-verify.ts:215`). `PnlCard` is on the Expenses tab. | The P&L leaves Finance; Accounting owns it (UX). Part payments become ledger rows (DB, CEO-3). |
| D-2 | **Two expense views of the same money:** <br>• Expenses (ExpensesPanel: staff payroll, claims in month, claims due, P&L); <br>• Finance (cash out by group). <br>The Expenses tab recomputes payroll net with its own formula (`staff.ts` /expenses, v1.4.91). | `GET /expenses` returns `staff_payroll` and `staff_claims` | The Expenses tab shows only cash-basis figures from the cash book read, plus commitments read from the modules. It no longer has its own payroll formula (UX + FIX). |
| D-3 | **Two booking paths for invoices** (Mark Paid and payment verification), both `INV-<id>` | They are keyed the same, so they are **not** double-booked. | Keep both; already idempotent. |
| D-4 | **ELFIA books outside `bookCash`** | `bridge.ts:425` | Route it through `bookCash` with the paid date (FIX). |
| D-5 | **The Financial Health card on the Overview** repeats the week engine's sales outlook (moved from the Dashboard in 1.291.0) | `finance-panels.tsx:317` | It is not in the reference, and the directive says no repeated metrics, so remove it from Finance (UX, CEO-9). |

---

## 5. Current cash posting and verification flow

| Source | Booked when | Date carried | Amount | Verified? |
|---|---|---|---|---|
| Invoice paid in full | Mark Paid, or the last verified payment | The paid day (`paid_at`, MYT) | Full invoice total | Chip "Verified" when the CEO confirmed it. Otherwise it is **counted anyway** as money in, marked "Unverified" (F-1). |
| Part payment | **Never booked.** Read live from `invoice_payments`. | Received date | Part amount | Same as above |
| Claim | Pay out | Bank date (`paidOn`) | Claim amount | Claims' own approval chain (C-1…C-11) |
| Payroll | Bank run marked done | **The day it is pressed** (no effective date passed) | Saved net, file + manual (`staff.ts:15531`) | Payroll's release |
| Agent payout | COO settles (K-5) | Bank date | Payout | CEO authorises, COO settles |
| Expense | Mark paid | **The day it is pressed** (`paid_at = now`) | Expense amount, **editable after payment** (F-8) | **None.** The person who records it can pay it (F-8). |
| ELFIA | Bridge poll | Poll day | Store total | Store status "paid" |
| Manual | Typed | Typed | Typed | **None** (F-10) |

---

## 6. Findings (incorrect states, transitions and risks)

| # | Sev | Finding (evidence) | Fix | Code |
|---|---|---|---|---|
| **F-1** | P0 | **Unverified receipts count as Money In.** <br>• A paid invoice or part payment is counted the moment it is recorded (`cashbook.ts` buildItems). <br>• "Unverified" is only a chip and an attention item. <br>• Its text still says "confirmed by the CEO or COO" (`:497`), which is wrong since K-3. | Money In counts verified receipts only. Unverified receipts show as "Awaiting CEO verification", with their sum, under Needs Attention. Correct the text. | FIX, CEO-1 |
| **F-2** | P0 | **The reconciliation difference is wrong.** <br>• A payroll mismatch reports the *booked* amount as its amount (`cashbook.ts:534`, `amount_cents: r.amount_cents`). <br>• Source RM 13,156.66 against booked RM 13,161.66 differ by **RM 5.00**. <br>• The screen and the reference show **−RM 13,161.66**. <br>• The same applies to expense and invoice mismatches. | The server returns `source_cents`, `booked_cents` and `difference_cents = source − booked`. The total difference is the sum of differences, never of amounts. See §8. | FIX |
| **F-3** | P0 | **No company segregation in Finance.** <br>• `bank_accounts`, `cashflow_entries` and `expenses` have no company. <br>• Only invoice receipts know their issuer. <br>• Every total, balance and report combines A2Z and AZ ONE. <br>• The earlier audit deferred this (MASTER-FLOW P1-8, "by decision"); the directive now requires it. | Add company ownership to accounts, cash rows and expenses. A company selector is enforced on the server. "Consolidated" appears only when explicitly chosen. | DB, SEC, CEO-2 |
| **F-4** | P1 | **"Mark reviewed" = "resolved".** A reviewed item is removed from the list (`exceptionsOf`, `:485`), whether or not the records now agree. | Separate states: Open → Flagged → Assigned → Reviewed → Correction proposed → Resolved. Resolved only when the records agree, or when the CEO accepts it with a reason. | DB, CEO-6 |
| **F-5** | P1 | **Agent payouts appear as "Manual".** `sourceOfRef` does not know `AGT-` (`:253`). They show as typed rows and can be flagged as "possible duplicates". | Add `AGT-` = Commission (source "commission"). | FIX |
| **F-6** | P1 | **Payroll is booked on the day of the click, and payroll can still change after the bank run.** The Aug-2026 run booked RM 13,161.66, and payroll now totals RM 13,156.66. | <br>• Book with the bank-run date. <br>• Ask Payroll why a paid month changed (P0 query 4). <br>• The fix to the payroll figures is Payroll's, not Finance's. | FIX, CEO-7 |
| **F-7** | P1 | **Sales history can change after the fact.** Money in is computed from each invoice's *current* state. Un-marking an October invoice in November changes October's report. The cash-book reversal (dated November) is skipped by the view. | Money in from sales is read from append-only ledger rows: part payments are booked as `PART-<id>` and the balance as `INV-<id>`. An undo becomes a dated reversal. | DB, CEO-3 |
| **F-8** | P1 | **Expenses have no control.** <br>• The person who records an expense can mark it paid. <br>• `paid_at` = the click. <br>• The amount can be edited after payment (`staff.ts:9126`), and the expense deleted outright (`:9194`, the cash is reversed but the record is gone). <br>• There is no company, account, payee or evidence. | Expense lifecycle (§9): recorded → approved → scheduled → authorised → paid (bank date, account, evidence) → reconciled. A paid expense is locked. Delete becomes Cancel, with a reason. | DB, SEC, CEO-4 |
| **F-9** | P2 | **ELFIA bypasses `bookCash`:** <br>• the poll day is used, not the paid date; <br>• there is no `source_key`; <br>• after a reversal it can never book again (its `NOT EXISTS ref`). | Book through `bookCash` with the store's paid date. | FIX, CEO-8 |
| **F-10** | P0 | **The manual "Add transaction" is open-ended:** <br>• the `ref` is typed freely, so a row can be named `INV-12` or `CLM-4`. That blocks the module's real booking, or appears as a Claims/Payroll movement. <br>• There is no idempotency key, so a double tap gives two rows. <br>• `admin` can add rows. <br>• No reason or evidence is asked. | <br>• Reserved prefixes are refused. <br>• The server sets the ref (`MAN-<id>`). <br>• An idempotency key, a reason and evidence are required. <br>• Only roles with `cashbook_correct`. <br>• It never pays for a Sales, Claims, Payroll or Commission event. | FIX, SEC |
| **F-11** | P1 | **Account "balance" is a book balance.** <br>• It is shown only after someone enters an opening balance; this part is correct. <br>• It is not verified against a statement, and no statement import exists. <br>• The reference's "Total Balance RM 13,161.66" is not a balance (§11). | Label it "Book balance (not bank-verified)", with its start date. With no opening balance, show "No verified balance". Never sum the two companies. | UX, CEO-5 |
| **F-12** | P1 | **Transfers use the wider gate.** `POST /cashbook/transfer` checks `cashflow_manage` (admin included), while its own comment says corrections are narrower. | `cashbook_correct`, or a new `cashbook_transfer` (CEO, COO). | SEC |
| **F-13** | P2 | **Part payments and the journal disagree.** <br>• Part payments never reach the cash book or journal; the full total is booked when the invoice is fully paid. <br>• Finance (by day) and Accounting (by the final paid day) disagree for those months. <br>• An invoice that never becomes fully paid has its parts nowhere in the books. | Solved by F-7 (`PART-<id>` rows post their journal). | DB, CEO-3 |
| **F-14** | P2 | **The Super Admin can still move money.** In Finance: `cashflow_manage`, `cashbook_correct`, `expenses` and `bank_run`. Elsewhere (`invoice_payment`): marking invoices paid. Since Claims C-2 and Commission K-4, the Super Admin approves and pays nothing else. | The Super Admin reads Finance and does not post, correct or pay. | SEC, CEO-10 |
| **F-15** | P2 | **The screens break the reference's hierarchy:** <br>• no view address; <br>• the Overview has an extra Health card and 5 recent rows instead of 3; <br>• Expenses is the old panel plus the P&L; <br>• Reconciliation shows 7 groups of pills, with no "Total difference" tile and no review history; <br>• Reports has no report selector; <br>• the period picker disappears on Expenses. | Phase A (§9, §10) | UX |

**Verified correct, and kept:**
- `bookCash` is atomic and keyed.
- Reversals are append-only, with mirrored journals.
- A cash row is never deleted (409, "reverse instead").
- "Book missing" never re-books a reversed claim (C-7).
- An undone expense or invoice is reversed, never left behind.
- A transfer counts as neither in nor out.
- Book balances are shown only from an opening balance.
- Refund credit notes book `CN-` money out.
- All amounts are integer sen.

---

## 7. Cross-company data separation risks

| Area | Today | Risk |
|---|---|---|
| Transactions | No company on a row. Only invoice items carry `issuer`. | Both companies' money in one list and one total |
| Accounts | Company only in the name ("A2Z CREATIVE MARKETING – Maybank") | A movement can be assigned to the other company's account |
| Expenses | No company | Company costs cannot be separated |
| Claims and Payroll | Booked as one row per claim and one per month, without company | A payroll run covering staff of both companies is one figure |
| Commission payouts | AGT- without company | — |
| Reports and exports | All combined | A consolidated figure presented as one company's |
| Reconciliation | All combined | — |

**Proposed rule (CEO-2):**
- Every cash row, account and expense belongs to **one company**, `a2z` or `azoo` (the issuer codes Sales already uses).
- Each company comes from its source:
  - invoice → issuer;
  - claim and payroll → the payee's employing company (to be confirmed: does Staff record a company per person?);
  - agent payout → the invoice issuer of its deals;
  - ELFIA → the company you name (CEO-8);
  - manual and expense → chosen when entered.
- Existing rows are **not** back-filled silently. A one-time assignment screen lists them for you to confirm (DB, P0 query 6).
- The company selector is a server parameter. **A consolidated view appears only when the user chooses "Both companies (consolidated)"**, and it is labelled so on every figure and export.

---

## 8. Reconciliation formula verification

**The payroll example (Aug 2026, row dated 04-09-2026):**

| Figure | Value | Where it comes from |
|---|---|---|
| Source amount (payroll net today) | RM 13,156.66 | `SUM(payroll_entries.net_cents) WHERE month = '2026-08'` |
| Recorded cash amount (bank run booked) | RM 13,161.66 | `cashflow_entries.amount_cents`, ref `PAYROLL-2026-08` |
| **Difference = source − recorded** | **−RM 5.00** | The cash book shows RM 5.00 *more* paid out than payroll now says |
| What the screen shows today | −RM 13,161.66 | The bug: the booked amount is reported as the amount (F-2) |

**The proposed sign convention** (shown in the Reconciliation header):
- **Difference = Source record − Cash book.**
- **Negative:** the cash book holds *more* than the source.
- **Positive:** it holds *less* than the source.

**The total difference** is the sum of `difference_cents` over the open **amount** mismatches only.

**Not counted in the total difference** (each is a count with its own list):
- "No account";
- "No reference";
- "Unverified";
- "Possible duplicate";
- a deleted source, where the difference = −booked;
- "Not booked", where the difference = +source.

**Which is right, RM 13,156.66 or RM 13,161.66, is not something I can settle from the code.** Before anything is changed:
- P0 query 4 shows when payroll entries for 2026-08 changed after `payroll_payments.paid_at`, and by whom.
- The bank statement shows what actually left the bank.
- If the bank paid RM 13,161.66, the cash book is right and Payroll's figures changed after payment; Payroll owns that correction.
- If the bank paid RM 13,156.66, the cash row is corrected by an authorised reversal and re-booking, with the reason.

**No bank-statement reconciliation exists.** The tab compares the cash book with the portal's own source records. The header says so, and no screen will claim otherwise.

---

## 9. The five redesigned desktop screens

Each tab gets its own address (`/portal?tab=Finance&view=overview|transactions|expenses|reconciliation|reports`), and Back/Forward move between them.

**The header row** stays the same on every tab:
- the five line tabs;
- the period picker (also on Expenses);
- a **company selector**: "A2Z Creative Marketing" / "AZ ONE Official" / "Both (consolidated)", as in CEO-2;
- the tab's one primary action.

### 01 Overview (`ref 01`)
1. **The cash-basis banner** (reference wording).
2. **Four tiles:**
   - Money In ("Actual receipts", verified only, F-1);
   - Money Out ("Actual payments");
   - Net Cash Movement ("Inflow – Outflow");
   - Needs Attention ("Items to review", which opens Reconciliation).
3. Row 2, in a 2:1 split:
   - **Cash Trend (Monthly)**: two lines, Money In in green and Money Out in red, over 6 months, from `trend`;
   - **Money Out by Category**: the total, then bars with RM and %.
4. Row 3, in three equal columns:
   - **Account Balances**: each account with its *book balance (not bank-verified)*, or "No verified balance";
   - **Recent Transactions (Latest 3)**: Date, Description, Category, Amount, then "View all transactions →";
   - **Attention Items**: invoices awaiting CEO verification (count and RM), commission ready for payroll sync, mismatches, missing evidence. Each opens its record.
5. **Removed:** the Financial Health card (D-5) and the 5-row recent list.

### 02 Transactions (`ref 02`)
1. **A header card:** an icon, "Transactions", the subtitle "Cash movement ledger by money-moved date…", then **Export CSV** and **Add Transaction** (shown only to `cashbook_correct`, F-10).
2. **Filters:**
   - Direction, Source, Status, Account, Date, Search;
   - Company is in the header selector;
   - on a phone, the filters are collapsible.
3. **Table:** Date ↕ · Description · Category · Direction (In / Out chip) · Amount · Account · Source · Reference · Status (Verified / Recorded / Unverified / Reversed / Reversal / Transfer).
4. **Reconciliation status** is shown as a second small chip in the Status cell, but only when an item is out of step, so the columns stay exactly as in the reference (CEO-11).
5. Footer: "Showing 1 to n of N entries", with paging.
6. **A row opens a detail drawer** with:
   - the source record (opens it);
   - the payment reference and proof;
   - who booked it, who verified it and who reversed it;
   - the timeline (booked → verified → reconciled / reversed);
   - the audit history.

### 03 Expenses (`ref 03`)
1. The title line ("Expenses — Perbelanjaan syarikat, bayaran akan datang & impak tunai"), then the **cash-basis banner**.
2. **Add Expense:**
   - **Row 1, as in the reference:** Description, Category, Amount (RM), Date, Recurring toggle.
   - **Row 2, added by the directive:** Company, Vendor / payee, Payment account, Supporting evidence (upload).
   - Buttons: **Clear** and **Record Expense**.
   - Recording creates a *recorded* expense. **It never books cash** (§9 state machine).
3. **Due Payments / Scheduled Expenses** (with View All):
   - approved and scheduled expenses, rent and subscriptions from recurring templates;
   - approved claims not yet paid (read from Claims, never re-entered);
   - payroll due (read from Payroll).
   - Each line shows a due date and amount. Paying opens the owning module's flow.
   - **Nothing here is cash.**
4. **Monthly Expense Impact (period):** Total Expenses = actual money out excluding transfers; vs last month (%); Top Category.
5. **Monthly Summary:** category · amount · % of total, then Total Expenses = 100%.
6. **Removed from this tab:** the P&L card, which moves to Accounting (D-1); the per-person payroll recomputation (D-2); and the Tailwind panel.

### 04 Reconciliation (`ref 04`)
1. **An info banner:** "Compares cash book entries with source records… No bank statement is imported."
2. **Two tiles:**
   - **Out of Step (Mismatch)**: the number of open amount mismatches;
   - **Total Difference**: the sum of `difference_cents`, with its sign (§8). For the payroll example this is −RM 5.00.
3. **Out of Step Records (n):** one card per mismatch, showing:
   - the title;
   - the date and source text;
   - Source amount · Cash book amount · **Difference**;
   - Company and account;
   - the state chip.
4. Each card's buttons, kept exactly as in the reference:
   - **Open Record**;
   - **Reverse** (CEO, COO);
   - **Mark Reviewed**;
   - the reference's **Review History** strip.
5. The directive's other actions sit in a "More" menu on the card, which keeps the reference's three buttons:
   - Compare Entries;
   - Flag for Review;
   - Assign Reviewer;
   - Propose Correction;
   - Authorised Reversal.
6. **"Other checks"**, below and collapsed: unverified receipts, no account, no reference, possible duplicates, not booked, cancelled ELFIA orders. These exist today and are real controls, so they stay, but out of the reference's main card (CEO-12).

### 05 Reports (`ref 05`)
1. **One Report selector** with:
   - Monthly Cash Flow;
   - Money In by Category;
   - Money Out by Category;
   - Account Summary;
   - Source Summary;
   - Detailed Transaction Export.
2. **One Period selector**, the company selector, an account filter, and **Export**.
3. **Three tiles:** Money In · Money Out · Net Cash Movement.
4. **Monthly Cash Flow Summary:** Month · Money In · Money Out · Net (a green or red chip), Malaysia time.
5. **Three cards:**
   - **Money In / Money Out by Category:** the split is correct and reversals are netted.
   - **Account Summary:** in, out and book balance per account; "Not assigned"; and a **Total only within one company**.
   - **Source Summary:** # · In · Out, counted by the same signed rule as the totals. The meta note about differing totals goes away.
6. Each export is the displayed report, with the same filters and the same totals. The file name carries the company, period and account.
7. P&L and accrual are not shown; a link points to Accounting.

---

## 10. The five matching mobile PWA screens

Common to every tab:
- the page title;
- a **view switch** (the same component as Commission, Claims and Leave) with the tab's primary action beside it;
- the period and company chips;
- **one column, no sideways page, no nested scroll areas**;
- every table becomes a list of cards;
- each drawer is a full-height sheet.

```
01 OVERVIEW            02 TRANSACTIONS         03 EXPENSES
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Finance          │   │ Finance          │   │ Finance          │
│[Overview ▾]      │   │[Transactions ▾][+]│  │[Expenses ▾] [+Add]│
│ Nov 2026 · A2Z ▾ │   │ Nov 2026 · A2Z ▾ │   │ Nov 2026 · A2Z ▾ │
│ ⓘ Cash basis…    │   │ [Filters (3) ▾]  │   │ ⓘ Cash basis…    │
│┌──────┐┌──────┐  │   │ 🔍 Search…        │   │ Add Expense ▸     │
││In    ││Out   │  │   │┌────────────────┐│   │  (sheet: 2 steps) │
││75.00 ││71.30 │  │   ││11-11 · In 37.50 ││   │ Due Payments      │
│└──────┘└──────┘  │   ││INV-AZO011126-1  ││   │ ┌──────────────┐  │
│┌──────┐┌──────┐  │   ││Sales · Verified ││   │ │Staff claims  │  │
││Net   ││Attn  │  │   │└────────────────┘│   │ │Due 11-11 RM… │  │
││3.70  ││2     │  │   │┌────────────────┐│   │ └──────────────┘  │
│└──────┘└──────┘  │   ││04-11 · Out 60.00││   │ Monthly Impact    │
│ Cash Trend       │   ││Staff claim · Rec ││   │ Total · vs last · │
│ Money Out by Cat │   │└────────────────┘│   │ top category      │
│ Account Balances │   │ 1–4 of 4         │   │ Monthly Summary   │
│ Recent (3) View →│   └──────────────────┘   │ (category cards)  │
│ Attention Items  │                          └──────────────────┘
└──────────────────┘
04 RECONCILIATION      05 REPORTS
┌──────────────────┐   ┌──────────────────┐
│[Reconciliation ▾]│   │[Reports ▾][Export]│
│ ⓘ Compares… no   │   │ Report: Monthly ▾ │
│   bank import    │   │ Period: Nov 2026 ▾│
│┌──────┐┌──────┐  │   │┌────┐┌────┐┌────┐ │
││Mism. ││Diff  │  │   ││In  ││Out ││Net │ │
││1     ││−5.00 │  │   │└────┘└────┘└────┘ │
│└──────┘└──────┘  │   │ Month cards:      │
│┌────────────────┐│   │ Nov  +3.70        │
││Payroll 2026-08 ││   │ Oct  −4,719.00    │
││Src 13,156.66   ││   │ …                 │
││Book 13,161.66  ││   │ Category / Account│
││Diff −5.00      ││   │ / Source as cards │
││[Open][Reverse] ││   └──────────────────┘
││[Mark reviewed] ││
││History ▸       ││
│└────────────────┘│
│ Other checks ▸   │
└──────────────────┘
```

**Widths tested:** 320, 360, 390, 430, 768, 1024, 1280 and 1440 px, the same as every 4.0 and 5.0 workspace.

---

## 11. Exact mapping to the supplied images

| Reference element | Our screen | Note |
|---|---|---|
| Sidebar, header, search, line tabs, gold active tab, white cards, light-grey page | Unchanged A2Z OS shell and tokens | No new design system |
| Ref 01: banner, 4 tiles, Cash Trend, Money Out by Category, Account Balances, Recent (Latest 3), Attention Items | §9-01, one for one | **Correction:** the reference shows money out as "Sales invoices RM 11.30, 15.9%". In the records, Nov money out is two **claim** payments (RM 60.00 and RM 11.30), so the screen will show *Staff claims RM 71.30, 100%*. |
| Ref 01 Account Balances "A2Z CREATIVE MARKETING – Maybank RM 13,161.66" | Book balance, or "No verified balance" | **Correction:** RM 13,161.66 equals the Aug payroll bank run, money *out*. It is not a balance. A balance needs an opening balance and is labelled as a book balance (F-11). |
| Ref 01 Attention: "2 invoices marked Paid — RM 97.50 need review", "1 commission ready for payout (RM 150.00)" | From the server's attention list | The figures come from the records, never from the image. |
| Ref 02: header card, Export CSV, Add Transaction, five filters plus search, nine columns, chips, count | §9-02, one for one | The company is in the header selector. Reconciliation status is a second chip (CEO-11). |
| Ref 03: title line, banner, Add Expense (one row), Due Payments, Monthly Expense Impact, Monthly Summary | §9-03 | **Added (the directive):** a second form row. **Correction:** the reference's due items (Staff claims RM 1,850, Office rental RM 2,000, Software RM 420) are illustrative. The list shows only real commitments: recurring expenses you have recorded, approved but unpaid claims, and payroll due. Otherwise it shows an empty state. |
| Ref 04: banner, 2 tiles, Out of Step card, Open Record / Reverse / Mark Reviewed, Review History | §9-04 | **Correction:** the total difference is −RM 5.00, not −RM 13,161.66 (§8). The card adds the source and cash-book amounts. |
| Ref 05: report and period selectors, Export, 3 tiles, monthly table, 3 cards | §9-05 | **Correction:** the reference's category table shows Sales invoices with RM 37.50 money *out*, and its % column does not sum. The screen uses the server's signed groups. |
| Master Board "Finance Flow": Transaction created → Cash movement recorded → Expense/payout recorded → Reconciliation check → Report & export | §13 diagram | — |
| Master Board "Key Rules" (cash basis only, no duplicate cash records, every outflow has a source, mismatches flagged, reports follow cash, audit-ready) | §6 fixes and §16 tests | — |

---

## 12. Permissions and approval matrix (proposed; changes in **bold**)

| Action | CEO (owner) | COO (Finance) | CCO | Admin | HR admin | Super Admin | Sales |
|---|---|---|---|---|---|---|---|
| Open Finance and read | ✓ | ✓ | — | ✓ | — | ✓ (**read only**) | — |
| Choose the consolidated view | ✓ | ✓ | — | — | — | read | — |
| Record an expense (draft or recorded) | ✓ | ✓ | — | ✓ | — | **—** | — |
| **Approve an expense** | ✓ | **—** (CEO-4) | — | — | — | — | — |
| **Authorise a payment** | ✓ | — | — | — | — | — | — |
| **Mark a payment completed** (bank date, account, evidence) | — | ✓ | — | — | — | **—** | — |
| Add a manual transaction | ✓ | ✓ | — | **—** | — | **—** | — |
| Transfer between own accounts | ✓ | ✓ | — | **—** | — | **—** | — |
| Reverse, correct or assign an account | ✓ | ✓ | — | — | — | **—** | — |
| Flag, assign or mark reviewed | ✓ | ✓ | — | — | — | — | — |
| **Resolve with acceptance** (records still differ) | ✓ | — | — | — | — | — | — |
| Accounts and opening balances | ✓ | ✓ | — | — | — | **—** | — |
| Verify a customer payment | ✓ (K-3) | — | — | — | — | — | — |
| Export | ✓ | ✓ | — | ✓ | — | ✓ | — |

**Rules that come with the matrix:**
- No self-approval: the person who records an expense cannot approve it; the person who authorises a payment cannot complete it.
- Every action is checked on the server and written to the audit log.
- The company given by the screen is never trusted; it is checked against the record.

---

## 13. Finance integration diagram

```
 Sales ──(CEO verifies, K-3)──► INV-/PART- ledger rows ─┐
 Claims ──(paid, bank date)────► CLM-                  │
 Payroll ─(bank run, its date)─► PAYROLL-              │      ┌─────────────────┐
 Commission ─(COO settles)─────► AGT-   (staff commission│ ───► │ cashflow_entries │──► journal (Accounting: P&L, TB)
                  goes via Payroll, never here)          │      │ one row / event │
 Expenses ─(completed payment)─► EXP-                  │      │ company · account│
 ELFIA ─(paid date)────────────► ELF-                  │      │ reversal-only    │
 Manual (CEO/COO, reason) ─────► MAN-                  ┘      └────────┬────────┘
                                                                       ▼
                     Overview · Transactions · Expenses (impact) · Reconciliation · Reports
   Commitments (never cash): approved claims, payroll due, scheduled expenses → "Due Payments"
```

- **Finance never** calculates commission or payroll, and never approves a claim or verifies a customer payment.
- **Accounting** owns the journal and the statements. Finance owns the operational cash view. Both read the same cash rows.

---

## 14. Existing functionality to preserve

- `bookCash` idempotency, the unique `source_key`, and one reversal per row.
- "Reverse instead of delete" (409) and mirrored journals.
- The C-7 rule (never re-book a reversed claim).
- Undo paths: expense unpaid, invoice unmarked, credit-note refund.
- Transfers: neither in nor out.
- Assign-bank, single and bulk, including "use the account printed on each invoice".
- "Book all missing" (the backfill), dated from the source.
- Opening balances.
- The CSV exporter (BOM, CRLF, formula defusing).
- The Accounting month-end checklist, which reads `cashExceptionsFor`.
- Payment verification (payment-verify.ts) and K-3 confirm-paid.
- The Claims 4.0 and Commission 5.0 settlement rules.

---

## 15. Necessary backend changes

| # | Phase | Change | Migration |
|---|---|---|---|
| B-1 | B | Reconciliation returns `source_cents`, `booked_cents` and `difference_cents`; the total is computed on the server (F-2) | No |
| B-2 | B | Money In counts verified receipts only; "awaiting verification" becomes its own figure (F-1, CEO-1) | No |
| B-3 | B | `AGT-` recognised as Commission; ELFIA through `bookCash` with its paid date; payroll and expenses booked with their bank date (F-5, F-6, F-9) | No |
| B-4 | B | Manual entries: server ref `MAN-`, reserved prefixes refused, idempotency key, reason, gate `cashbook_correct`; transfers on the same gate (F-10, F-12) | No |
| B-5 | B | **0197** company ownership: `company` on `bank_accounts`, `cashflow_entries` and `expenses`; a server-side company filter; the assignment screen for existing rows (F-3) | **Yes** (additive, nullable columns) |
| B-6 | B | **0198** expense lifecycle (`status`, `approved_by/at`, `authorised_by/at`, `paid_on`, `bank_id`, `payee`, `evidence_key`, `cancelled_reason`); a paid expense is locked; delete becomes cancel (F-8) | **Yes** (additive) |
| B-7 | C | **0199** reconciliation workflow table (`state`, `assignee`, `proposal`, `resolution`, history); review ≠ resolve (F-4) | **Yes** (additive) |
| B-8 | C | Part payments booked as `PART-<id>` through `bookCash` (with their journal), and the view reads sales money from the ledger (F-7, F-13). Existing invoices are left as they are, **forward only**. | No (uses `source_key`) |
| B-9 | B | The Super Admin is read-only in Finance (F-14) | No (permissions) |

Migration numbers are provisional. The Attendance P3 migration (planned as 0197 before Commission took 0196) is renumbered in whichever order you approve.

---

## 16. Full regression test plan

**New `tests/finance5.mjs`**: the whole worker against SQLite with every migration, by direct request as each role. Each rule has deliberate mutations that the test must catch.

- **Cash:**
  - one event = one row (double tap, two tabs at once, retry after a failure, the backfill twice);
  - a reversal then re-booking leaves one live row;
  - no delete.
- **Money In:**
  - verified only;
  - a part payment on its day;
  - an un-marked invoice does **not** change a past month (after B-8);
  - a refund nets out.
- **Reconciliation:**
  - the payroll fixture (13,156.66 vs 13,161.66) gives a difference of **−RM 5.00**;
  - the expense and invoice amount drift cases;
  - a deleted source gives −booked;
  - "not booked" gives +source;
  - Mark Reviewed does **not** resolve;
  - a resolution appears when the records agree;
  - "accepted" needs the CEO and a reason.
- **Manual entries:**
  - `INV-`, `CLM-`, `PAYROLL-`, `AGT-` and `EXP-` refs refused;
  - admin refused;
  - an idempotency key replayed gives one row.
- **Expenses:**
  - the recorder cannot approve;
  - the authoriser cannot complete;
  - a scheduled or recurring expense never books cash;
  - a paid expense cannot be edited or deleted;
  - a Claims or Payroll payment cannot be re-entered as an expense.
- **Companies:**
  - each total, list, balance and export for A2Z ≠ AZ ONE;
  - a company supplied by the screen for another company's row is refused;
  - consolidated only when explicitly asked.
- **Permissions:**
  - the full matrix of §12 by direct request, including the Super Admin read-only and the agent and sales roles refused.
- **Exports:**
  - the CSV totals equal the screen totals for the same filters.

**Browser `tests/browser/finance5.py`:**
- the CEO, the COO and admin;
- all five views, their addresses and Back/Forward;
- the drawers;
- the phone view switch and collapsible filters;
- eight widths with no sideways page;
- the reference's element order on each tab.

**Re-run:**
- `cashflow`, `accounting-v2`, `master-flow`, `payment-verify`, `claims4`, `commission5`, `go-live-*`, `self-approval`, `company-review`, `tab-concept`, `interface-v3`, `skeleton-loading`, `design-tokens`;
- the browser `overflow-sweep`, `ecc4`, `payments-verify`, `payroll-figures`;
- the full guard run with mutations.

---

## 17. Implementation phases (each stops for your approval)

| Phase | Scope | Financial logic | Migration |
|---|---|---|---|
| **A — UI/UX Consolidation** | <br>• The five views with addresses; desktop as §9 and phone as §10. <br>• Overview: Financial Health card removed, recent = 3. <br>• Expenses rebuilt on the existing data (P&L moved to an Accounting link). <br>• Reconciliation layout (tiles, cards, Other checks) and Reports selector. <br>• Texts corrected (F-1 wording). | **None.** Every figure is the server's figure as today. The "Total difference" tile waits for B-1; until then Phase A shows the count only. | No |
| **B — Financial Accuracy** | <br>• B-1 to B-6 and B-9: difference formula, verified Money In, sources and dates, manual and transfer controls, company ownership (0197), expense lifecycle (0198), Super Admin read-only. | Yes, as approved | 0197, 0198 |
| **C — Reporting & Automation** | <br>• B-7 reconciliation workflow (0199). <br>• B-8 ledger-based sales money in. <br>• Report selector exports per company and account. <br>• Optional: bank-statement import (only if you want it, CEO-13). | Yes | 0199 |

---

## 18. Rollback strategy

- **Phase A:** screens only. Re-run PUSH.bat from 1.311.0, and no data is involved.
- **Phase B and C:**
  - Every migration is additive (nullable columns, a new table, no rewrite). The code is rolled back by PUSH.bat from the previous release, and the extra columns stay unused.
  - Rows written under the new rules (a `MAN-` ref, a company, an expense status) remain valid for the old code, which ignores them.
  - No existing row is changed by any phase. Corrections are always reversal rows.
  - Company assignment of existing rows is a recorded decision (audit log) and can be repeated, never silently overwritten.

---

## 19. Read-only production queries (P0, before Phase B)

Run each with `npx wrangler d1 execute azoneofficial --remote --command "<query>"` and paste the results back. Nothing is written.

1. `SELECT id, name, bank, number_masked, active, opening_balance_cents, opening_on FROM bank_accounts`
2. `SELECT substr(ref,1,instr(ref||'-','-')) AS src, type, COUNT(*) n, SUM(amount_cents) cents, SUM(bank_id IS NULL) no_bank, SUM(reversal_of IS NOT NULL) reversals FROM cashflow_entries GROUP BY 1,2`
3. `SELECT ref, COUNT(*) n FROM cashflow_entries WHERE reversal_of IS NULL AND ref != '' GROUP BY ref HAVING n > 1`
4. `SELECT a.created_at, a.user_id, a.action, a.entity_id FROM audit_log a WHERE (a.action LIKE 'payroll.%') AND (a.entity_id LIKE '%2026-08%' OR a.detail LIKE '%2026-08%') ORDER BY a.created_at`
5. `SELECT id, entry_date, effective_date, type, category, amount_cents, ref, created_by FROM cashflow_entries WHERE ref NOT GLOB '[A-Z]*-*' OR ref = '' ORDER BY id DESC LIMIT 50`
6. `SELECT d.issuer_code, COUNT(*) n, SUM(d.total_cents) cents FROM sales_documents d WHERE d.doc_type='INV' AND d.payment_status='paid' GROUP BY 1`
7. `SELECT key, value, updated_at FROM business_settings WHERE key IN ('payment_verification','commission_sync','agent_partnership')`

What each answers:

| Query | Answers |
|---|---|
| 1 | Which accounts exist, and whether either has an opening balance (F-11) |
| 2 | Where every cash row came from, how many have no account, and the reversals |
| 3 | Any event with two live rows (should be none) |
| 4 | Why Aug-2026 payroll changed after the bank run (§8) |
| 5 | The manual rows, and whether any typed ref looks like a module's (F-10) |
| 6 | Paid invoices by company: how much of the money in is A2Z and how much AZ ONE |
| 7 | Whether your payment-verification switch is on. It decides how many receipts reach Finance before your verification (F-1). |

---

## 20. CEO decisions required before implementation

| # | Decision | Recommendation |
|---|---|---|
| **CEO-1** | Money In: verified receipts only, or everything recorded? | **Verified only.** Unverified receipts show as "Awaiting CEO verification" (count and RM) under Needs Attention. |
| **CEO-2** | Company segregation: accounts, cash rows and expenses each belong to one company; a consolidated view only by explicit choice; existing rows assigned by you on a one-time screen, never by guess | **Approve (0197).** |
| **CEO-3** | Part payments become ledger rows (`PART-<id>`, with their journal), so history never changes and Finance agrees with Accounting. This reverses the 20-10-2026 "parts stay out of the cash book" decision, forward only. | **Approve, in Phase C.** |
| **CEO-4** | Expense lifecycle: who approves (CEO), who authorises payment (CEO), who completes it (COO, with the bank date, account and evidence)? | **CEO approves and authorises; COO completes.** The same pattern as K-5. |
| **CEO-5** | Account balances: show a *book balance (not bank-verified)* from an opening balance, or hide balances until a statement import exists? | **Show book balance, labelled.** |
| **CEO-6** | Reconciliation: Reviewed ≠ Resolved. Who may "accept" a difference that remains? | **CEO only, with a reason.** |
| **CEO-7** | The Aug-2026 payroll RM 5.00: after P0 query 4 and the bank statement, who corrects it? Payroll (if the bank paid RM 13,161.66) or Finance by reversal (if it paid RM 13,156.66)? | Decide after the evidence. |
| **CEO-8** | ELFIA receipts: whose company (A2Z, AZ ONE, or client money collected for ELFIA)? | Your answer. The Accounting audit raised the same question. |
| **CEO-9** | Remove the Financial Health card from Finance (it is not in the reference)? | **Remove.** The Dashboard and Sales already carry the outlook. |
| **CEO-10** | Super Admin in Finance: read only? | **Yes**, consistent with Claims C-2 and Commission K-4. |
| **CEO-11** | Transactions columns: keep the reference's nine columns exactly, with company as a header selector and reconciliation status as a second chip? | **Yes.** |
| **CEO-12** | Reconciliation: keep the six "Other checks" (unverified, no account, no reference, duplicates, not booked, ELFIA cancelled) below the reference's main card? | **Keep, collapsed.** |
| **CEO-13** | Bank-statement import (CSV upload per account) in Phase C? | **Not now.** Decide after Phase B. |
| **CEO-14** | Mobile: approve the §10 layouts in place of mobile references? | **Approve**, or send phone references. |

**STOP.** Nothing in this blueprint is built until you approve a phase. Phase A can be approved on its own. It changes no financial figure.
