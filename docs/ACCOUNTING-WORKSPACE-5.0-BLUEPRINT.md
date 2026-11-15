# A2Z OS Accounting Workspace 5.0 — Accounting Architecture, Financial Integrity & UI/UX Blueprint

**Status:** a READ-ONLY audit. No code, migration or deploy.
**Authority:** the CEO directive "A2Z OS — ACCOUNTING WORKSPACE 5.0", 15-11-2026, with 4 images (Overview, Financial Reports, General Ledger, Month-End & Audit).
**Code audited:** the sandbox at 1.312.0 (Finance 5.0, built and not deployed). The ledger code is the same as 1.310.0 live, except the Finance 5.0 changes noted in §6.

Legend: **[C]** is confirmed in the code. **[A]** is an assumption that needs a production query. **[P]** is a proposal. **[D]** is a confirmed defect against this directive.

---

## 1. Current source-code architecture [C]

| Piece | Where |
|---|---|
| Accounting page: 4 tabs already (Overview, General Ledger, Financial Reports, Month-End & Audit), period picker | `components/portal/accounting-panel.tsx` (781 lines); `books-panel.tsx` (month-end table) |
| Ledger **reads**: overview, trial balance, P&L, ledger, journal list/detail, month-end checks, post-close adjustments | `worker/src/ledger.ts` (441). Header: "reads only… no second engine" |
| Ledger **writes**: accounts, manual journal (`MJ-`), reversal (`REVJ-`), trial balance | `worker/src/erp.ts` `/gl/*` (lines 637–800) |
| Automatic posting (one function) | `worker/src/shared.ts` `postJournal()`: 2 lines, bank 1100 against a category account; idempotent by `ref` |
| What calls it | `worker/src/cashbook.ts` `bookCash()` (every cash-book event: INV-, CN-, EXP-, CLM-, PAYROLL-, AGT-, MAN-, ELFIA) **and** `erp.ts:325` (`RECON-` channel settlement, directly) |
| Month close | `worker/src/business.ts` `/books/close`, `/books/reopen` → `period_closes` |
| Gate | `accounting_manage` = super_admin, admin, ceo. **The COO has no Accounting access** (the Month-End image shows a COO user). |

### Data [C]
- `gl_accounts (code UNIQUE, name, type asset|liability|equity|income|expense, active)`. Seed: 1000 Cash on hand, 1100 Bank — operating, 1200 AR, 1300 Inventory, 2000 AP, 2100 SST payable, 3000 Owner equity, 4000 Sales — products, 4100 Sales — live services, 6000 Marketing & ads, 6100 Salaries & commission, 6200 Rent & utilities, 6300 Platform fees, 6900 Other expenses.
- `journal_entries (entry_date, memo, ref, created_by, created_at)`. **There is no company, status, source table, reviewer or version column.**
- `journal_lines (entry_id → ON DELETE CASCADE, account_id, debit_cents ≥ 0, credit_cents ≥ 0)`. Integer cents, so there is **no floating point** ✅.
- `idx_journal_ref_once`: `ref` is unique for entries created from **29-10-2026** onward (0148). Older history is checked by ref in code.
- `period_closes (month, figures JSON, note, closed_by/at, reopened_by/at, reopen_reason)`. **A snapshot; it locks nothing** (0142 says so). It has no company.
- **No append-only trigger** on `journal_entries`, `journal_lines` or `period_closes`. No route edits or deletes them, but the database would not refuse.

## 2. Live and local versions [C]
- **Production:** 1.310.0.
- **Your PC:** 1.311.0.
- **Sandbox:** 1.312.0 (Finance 5.0: `company` on cash rows, banks and expenses; the expense lifecycle; awaiting receipts not counted).
- The Accounting screens are the Accounting 2.0/3.x design (1.222.0 onward). The images you sent are the **proposed** look. Their figures (for example codes 1010/1500/2300) are illustrative and **differ from the real chart** (1100/1300/2100). The real codes will be used.

## 3. Ledger model and accounting basis [C]
- **CASH BASIS.** Every automatic entry is *bank 1100 against an income or expense account*, posted when money moves, and dated by the cash book's effective (money-moved) date.
- **No accruals:** no receivable when an invoice is issued, no payable when a bill or expense is recorded, no payroll liability, no SST payable, no depreciation.
- **Therefore:**
  - the **P&L is a cash-basis receipts-and-payments statement**, not an accrual P&L (§9);
  - a **Balance Sheet cannot be drawn honestly.** There are no opening balances, no equity, no AR/AP, and **one** bank account (1100) for **every** bank and **both** companies. The code already refuses to draw one: Reports → "Balance sheet not supported" ✅.

## 4. Chart-of-accounts assessment
| Finding | Kind |
|---|---|
| The code is unique **globally**, not per company; one chart serves both companies | [C] |
| Account creation: 4-digit code, name, type; a duplicate code → 400; audited | [C] ✅ |
| **No deactivate/delete route.** An account with history cannot be deleted casually ✅, but it also cannot be retired | [C] |
| "Propose new accounts" (directive §5) has **no approval**: any `accounting_manage` user (including Admin and Super Admin) creates an account directly | [D] |
| One GL bank account (1100) for 4 Finance bank accounts and 2 companies | [C], a structural limitation |
| 6100 "Salaries & commission" also receives **agent** commission (AGT-, category `agent_commission` → "commission" → 6100) | [C], a classification question (AC-7) |
| Claims → 6900 Other expenses (not by claim type) | [C] |
| No Cost of Sales account, so Gross Profit cannot be shown | [C] |

## 5. Debit and credit calculation audit [C]
- **Manual entries** need ≥ 2 lines and either a debit or a credit on each line, and **Σ debit = Σ credit or 400** ✅. One D1 batch, so there is no half-written entry ✅. `MJ-` ref, duplicate → 409 ✅.
- **Automatic entries** are 2 lines of the same amount, so they always balance ✅. They are idempotent by ref ✅. If the account is missing, they are **skipped silently** ("never block"). That surfaces only as "unjournaled" in the checks ⚠️.
- **Reversal:** manual entries only, by mirror, reason ≥ 8, once (`REVJ-<id>`); a reversal of a reversal is refused ✅. A source entry is reversed at its source ✅.
- **Trial balance:** sums every line by effective date. Normal side: assets and expenses on the debit side, the others on the credit side ✅.
- **The integrity checks** (all reads) cover unbalanced or one-line entries, duplicate refs, cash rows with no journal, and payroll drift ✅.
- **The image's Chart of Accounts total row** (Dr 28,735.10 ≠ Cr 40,991.85) would be impossible over the whole ledger. If it appears, the table is filtered (for example only some accounts or periods), and the **total must then not be labelled "Total"**, or it must be shown with the period stated. [P]

## 6. Finance-to-Accounting integration
| Event | Cash book (Finance) | Journal (Accounting) | Note |
|---|---|---|---|
| Invoice paid in full (CEO verified) | `INV-<id>` in | Dr 1100 / Cr 4000 or 4100 | ✅ once, by ref |
| **Part payment** | listed as awaiting until verified (1.312.0); **not booked** | **none** until the invoice is paid in full | [C] "Part payments outside the books" check; PART- rows are Finance Phase C (CEO-3) |
| Credit note refund | `CN-<id>` out | Dr income / Cr 1100 | ✅ |
| Expense paid (1.312.0 lifecycle) | `EXP-<id>` out at the bank date | Dr 6xxx / Cr 1100 | ✅ once |
| Claim paid | `CLM-<id>` out | Dr 6900 / Cr 1100 | ✅ only when paid |
| Payroll bank run | `PAYROLL-YYYY-MM` out (net) | Dr 6100 / Cr 1100 | ⚠️ **net pay only.** Employer EPF/SOCSO/EIS and PCB are booked only if and when paid as separate cash rows [A] |
| Agent payout settled | `AGT-<id>` out | Dr 6100 / Cr 1100 | AC-7 |
| ELFIA order (bridge) | `bookCash` in | Dr 1100 / Cr 4000 | ✅ |
| **Channel settlement pull** | `RECON-<period>-<channel>-n`, **written directly, not through `bookCash`** (no company, no source key) | Dr 1100 / Cr 4100 | ⚠️ **[A] possible double count** with the ELFIA bridge or with INV- receipts for the same orders → P0 query 4 |
| Manual cash entry | `MAN-<key>` (CEO/COO, 1.312.0) | Dr/Cr category / 1100 | ✅ |
| Transfer between banks | `TRF-` pair | **none** (one GL bank account) | [C] correct while there is one 1100 |

**One engine ✅:** Accounting has no cash-receipt engine of its own. Every automatic journal comes from a cash-book event, except `RECON-` (above).

## 7. Multi-company data analysis
- **[C]** Journals carry **no company**. From 1.312.0, a cash row carries its company (0197), so a journal's company can be **read through its ref** (`journal_entries.ref = cashflow_entries.source_key/ref`) for new entries.
- **[C]** Historic cash rows have `company NULL` until assigned on the Finance screen. Manual journals (`MJ-`) have no cash row at all. **Neither can be attributed without a person's decision.** Nothing will be guessed (directive §6).
- **[D]** The ledger's "ownership" check still counts records with no `company_review_decisions` row (0134), **not** the new 0197 `company` columns, so the two disagree after 1.312.0.
- **[C]** The Trial Balance header today reads "AZ ONE OFFICIAL + A2Z CREATIVE MARKETING … one ledger for both companies". This is honest about the mixing, but it is mixing, which the directive forbids by default.
- **Consolidation:** with one chart and no intercompany accounts, the combined figure is a **sum**, not a consolidation. It must be labelled "Combined (not consolidated)" until AC-4 is decided.

## 8. Payroll discrepancy investigation
- **[C]** The check "Payroll in the books matches payroll" compares live `PAYROLL-YYYY-MM` cash rows with `SUM(payroll_entries.net_cents)` now.
- **[C] Known case (Finance 5.0 fixture and blueprint P0):** source RM 13,156.66, booked RM 13,161.66, difference **−RM 5.00**. The payroll was recomputed after the bank run. The image "October 2026 (RM 12,348.99) is not yet finalized" is the *not-paid* case of the same check.
- **[A] Cause to confirm on production (P0 queries 1–3):** a payroll line edited or recomputed after the run, versus the run's own figure. Fix route: Finance → Reconciliation (review, then the CEO accepts, or reverse and rebook). **Accounting never edits payroll.**
- **Distinguish:** calculated (`payroll_entries`), approved, released, paid (`payroll_payments`), posted (`PAYROLL-` journal). Today Accounting shows only *saved / paid / drift*. [P] Show all five states in the check's drawer, read-only.

## 9. Financial report calculation review [C]
| Report | Today | Verdict |
|---|---|---|
| Trial Balance | `trialOf` over effective date ≤ as-of; Dr = Cr | ✅ correct arithmetic; the title must not imply completeness (directive §4) |
| Profit & Loss | income − expense accounts in the period, compared with the same length of time just before | ⚠️ It is a **cash-basis** statement. Allowed **only** with the title "Cash-basis Profit & Loss (receipts and payments)". **No Gross Profit** (no Cost of Sales account). |
| General Ledger | per-account lines with a running balance | ✅ |
| Balance Sheet | refused ("not supported") | ✅ correct. Keep it refused until AC-5. **Never** manufacture an opening balance or equity to make it balance. |
| Company filter | **none** | [D] → Phase C |
| Comparative period | P&L only | [P] TB and GL "vs previous month" |
| CSV | yes. PDF: browser print | [P] print stylesheet, so the PDF = the screen |
| Drill-down | journal detail drawer | ✅; [P] from every report row |

## 10. Trial Balance and Balance Sheet validation
- **The TB will balance by construction** (balanced inserts, integer cents). **This proves nothing about completeness.** The Overview tile shows "Balanced (arithmetic)" next to the open exceptions count, and is **never** "Healthy" on its own (directive §4).
- **Bank 1100 can show a credit balance** (the image shows Cr RM 19,928.80): money out exceeds money in **because no opening bank balance was ever posted** [C]. This is a missing opening position, not an overdraft. [P] Phase D: an **opening balance journal per company** entered by the CEO from the bank statement, with evidence (AC-6). It is never computed.

## 11. Month-End Closing state machine
**Today [C]:**
- **[D]** `POST /books/close` checks only "month has ended" and "not already closed". It **does not enforce** the month-end checks (`ready` is computed by `/gl/month-end` but **not** required by the close).
- The close is a snapshot and **locks nothing**. A manual journal into a closed month needs only a reason ≥ 8 (listed as a post-close adjustment).
- The image text says the same: "Nothing is locked".

**Proposed (Phase E):**
```
open ─► reviewing_balances ─► checking_exceptions ─► final_review ─► closed ─► (reopen: CEO, reason) ─► open
  (step 1: auto checks)     (step 2: each Look item     (step 3: a reviewer      (step 4: the
                             resolved or formally        who is NOT the           closing authority,
                             accepted with a reason)     closer, notes)           backend re-runs ALL
                                                                                  checks; any "block" → 409)
```
- **Store:** company, period, version, closing balances (TB per account), checks with their results, exceptions and their dispositions, `reviewed_by`, `approved_by`, `closed_at`, and an audit ref.
- **Lock (only if AC-9 = "lock"):** the backend refuses new journals and source bookings dated in a closed period. A late item is posted in the **current** period as a post-close adjustment, with a reference to the closed month. **I will not call it "locked" until a test proves that a direct request is refused.**

## 12. Role and permission matrix (proposed; AC-1)
| Action | CEO | COO | CCO | Admin | Super Admin | Others |
|---|---|---|---|---|---|---|
| View Accounting | ✅ | ✅ (new) | ✅ read (AC-1) | ✅ read | ✅ read | ❌ |
| Propose an account | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Approve an account | ✅ (never their own proposal) | ✅ (never their own) | ❌ | ❌ | ❌ | ❌ |
| Manual journal | ✅ | ✅ | ❌ | ❌ (today ✅) | ❌ (today ✅) | ❌ |
| Reverse a manual journal | ✅ | ✅ (not their own entry) | ❌ | ❌ | ❌ | ❌ |
| Month-end Final Review (step 3) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Close the month (step 4) | ✅ (not the step-3 reviewer) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reopen a month | ✅, with a reason | ❌ | ❌ | ❌ | ❌ | ❌ |

Company access follows the user's company membership on the server. A frontend filter is never a control.

## 13. Four desktop screen designs (your images = the references)
1. **Overview** (image 1):
   - the basis banner;
   - 4 tiles: Trial Balance Status ("Balanced (arithmetic)" + checks), Money In (cash, income accounts), Money Out (cash, expense accounts), Posting Exceptions;
   - Money In vs Money Out, 6 months (labelled cash basis); Top Expense Accounts;
   - Checks & Exceptions (one row per check, OK / Look, each opening its list);
   - Recent Journal Entries (5), each opening the entry drawer;
   - **plus the company selector** (A2Z / AZ ONE / Combined).
2. **General Ledger** (image 3): the note; **Chart of Accounts** (search, Type, + New account = *propose*, CSV; Code, Account, Type chip, Debit, Credit, Balance; a total row only when the whole period is shown); **Journal Entries** (search, Source, From/To; Date moved, Entry + ref, Source chip, Amount, By, **Company, Status**). A row opens a drawer with every line, the evidence link to its source, and its history.
3. **Financial Reports** (image 2): the basis banner; "Reports" card with the 4 pills (Trial balance · Profit & Loss · General ledger · Balance sheet), CSV, Print/PDF; the company title (**never** the two names joined unless Combined is chosen and labelled); totals band (Total Debit, Total Credit, Balanced); the table; a footnote. The Balance sheet pill shows the "not supported on a cash basis, and why" panel.
4. **Month-End & Audit** (image 4): the info line; the 4-step stepper; 5 tiles (Closing Period, Journal Entries, Documents, Ledger Income, Ledger Expense); Closing checklist (the directive's 10 items, OK / Look / Block); Post-close adjustments; Month End table (Month end · Position · Audit trail) with **Close month enabled only on a month whose checks pass**, shown with the step it is at.

## 14. Four Mobile PWA designs
The pattern is the same as Finance 5.0, which is approved: a view switch in place of the tabs, 2×2 tiles, cards in place of tables, folded filters, drawers as full-height sheets, and no sideways page at 320–430 px.
- **Overview:** tiles 2×2; the chart at full width (6 bars); Checks as a list with OK/Look chips; Recent entries as cards.
- **General Ledger:** a searchable account list (code, name, balance) expanding to its lines; journal cards opening the full entry.
- **Financial Reports:** one report at a time; the statement as label/amount rows with section totals; CSV and Print fixed at the bottom.
- **Month-End:** a vertical stepper; a checklist with the pending action under each item; the month list as cards with one Close/Review button.

## 15. Master Design Board comparison
| Image element | Matches the code? | Action |
|---|---|---|
| Overview: 4 tiles, chart, top expenses, checks, recent | ✅ the same data exists | Restyle; add the company selector; caveat on "Balanced" |
| Overview: "7 of 13 accounts with unposted entries" | ❌ no such measure ("unposted" is a cash row with no journal, not an account) | Use "n movements not in the books" |
| GL: codes 1010 / 1500 / 2300 | ❌ the real chart is 1100 / 1300 / 2100 | Real codes |
| GL: total row Dr ≠ Cr | ❌ impossible over the whole ledger | Total only over the whole ledger, or with the filter named |
| Reports: "one ledger for both companies" | ✅ true today, but forbidden by the directive | Company selector; Combined labelled |
| Month-End: Close month on every row incl. Nov "In progress" | ❌ the directive forbids closing on a click | Close only when the server says ready; an ended month only |
| Month-End: "Nothing is locked" | ✅ true today | Keep the honest text until AC-9 makes it otherwise |

## 16. Database and API changes (only if approved, by phase)
| Phase | Change |
|---|---|
| A (UI) | none |
| B (ledger accuracy) | `RECON-` through `bookCash` (company, source key) or retired (AC-8); a skipped automatic post shown as an exception; **append-only triggers** on journal_entries/lines (an UPDATE or DELETE is refused) |
| C (company) | `0199_journal_company` (additive): `journal_entries.company` NULL; new entries take the cash row's company; old entries get it **only** through a reviewed assignment screen; `period_closes.company` |
| D (reporting) | the company filter on every `/gl/*` read; opening balance journals (`OB-<company>-<date>`, CEO, with evidence); Balance Sheet only after AC-5 |
| E (month-end) | `0200_period_close_steps` (step, reviewer, approver, checks JSON, version); `/books/close` re-runs the checks and refuses (409) if any is "block"; the lock if AC-9 |
| Accounts | `gl_account_proposals` (proposed by, approved by, never the same person) or a `status` on gl_accounts (AC-10) |

## 17. Data migration risk
- All proposed migrations are **additive** (new nullable columns, new tables, triggers). **No existing journal, line or close row is changed.**
- **The risk is in the triggers:** any code path that today UPDATEs or DELETEs a journal would start failing. A grep finds none [C]; the full guard run will prove it before release.
- **Company backfill:** never automatic. A person assigns, and the assignment is audited.
- **Opening balances** change every balance shown from that date. They are entered once per company, with evidence, and reversible by a mirror entry.

## 18. Regression tests
- **New guard `tests/accounting5.mjs`**, whole worker against SQLite, by direct request, with a mutation pass. It covers all 25 items of directive §13. The most important:
  - every entry balances, and an unbalanced manual entry → 400;
  - one post per ref under concurrency;
  - a reversal is once only and audited;
  - TB = Σ lines;
  - P&L labelled cash; Balance Sheet refused;
  - the company filter isolates;
  - Combined labelled;
  - RECON-/INV- not double;
  - PAYROLL- once;
  - a part payment is not in income until the policy says so;
  - a claim is posted only when paid;
  - no commission maths in Accounting;
  - a close with a failing check → 409; a close by an unauthorised role → 403; the reviewer cannot also close;
  - a post-close journal is listed and never rewrites the snapshot;
  - CSV totals = screen totals;
  - an UPDATE or DELETE on a journal is refused by the trigger.
- **New browser test `tests/browser/accounting5.py`:** the 4 tabs and their addresses; each against its image; the company selector; the phone layouts; eight widths.
- **Kept:** `accounting2`/`ledger` guards (whatever exists today), `cashflow`, `finance5`, `payroll-*`, `commission5`, `business-joins`, `overflow-sweep`.

## 19. Implementation phases (each with its own CEO gate)
| Phase | Content | Data change |
|---|---|---|
| **A — UI/UX** | The 4 tabs to the images; caveats; real codes; company selector **shown, reading cash-row company where it exists**, with an "unattributed" exception for the rest; Close month disabled unless ready (display only) | none |
| **B — Ledger accuracy** | RECON- path (AC-8); skipped-post exception; journal append-only triggers; ownership check reads 0197 | triggers only |
| **C — Company segregation** | journal company, assignment screen, company access on the server | 0199 |
| **D — Financial reporting** | the company filter everywhere; comparatives; print; opening balances (AC-6); Balance Sheet only if AC-5 | journals only (OB-) |
| **E — Month-end controls** | the 4-step state machine enforced on the server; lock if AC-9 | 0200 |

## 20. Rollback strategy
- **A:** PUSH.bat from the previous release.
- **B–E:** the code rolls back by PUSH.bat. The additive columns and tables stay unused.
  - The triggers can be dropped by a new migration if they block an unforeseen path. The trigger is the protection, so it is dropped only with your approval.
  - Opening balance journals are reversed by a mirror entry and never deleted.

## 21. Outstanding CEO decisions
| # | Question | Recommendation |
|---|---|---|
| **AC-1** | Who sees and runs Accounting? | View: CEO, COO, Admin, Super Admin (read); CCO read-only. Post/reverse: **CEO and COO only** (the Admin and Super Admin lose posting). Close: CEO. |
| **AC-2** | Reporting basis | **Stay cash basis** and label every report so. Accrual (AR/AP, payroll liabilities) is a separate future project. |
| **AC-3** | Default company on Accounting | **A2Z Creative Marketing**. Combined is allowed, labelled "Combined - not a consolidated statement". |
| **AC-4** | Consolidation | Not offered as "consolidated" until intercompany accounts exist; Combined only. |
| **AC-5** | Balance Sheet | Keep refused ("not supported on a cash basis") until opening balances (AC-6) and liabilities exist. |
| **AC-6** | Opening bank balances | The CEO enters one opening journal per company from the bank statement on an agreed date, with the statement as evidence. |
| **AC-7** | Agent commission account | A new expense account **6150 Agent commission** (proposed through the account approval), so 6100 stays salaries and staff commission. Past AGT- entries are not moved. |
| **AC-8** | `RECON-` channel settlements | First run P0 query 4. If they overlap ELFIA/INV- receipts, retire the pull's booking (the bridge books each order). Otherwise route it through `bookCash` with a company. |
| **AC-9** | Real period lock | **Yes, soft-lock:** after close, any journal or cash booking dated in the month → 409, except a CEO post-close adjustment with a reason (posted in the current month, referencing the closed one). Reopen: CEO, with a reason. |
| **AC-10** | New accounts | Proposed by CEO/COO/Admin; approved by the CEO or COO who did not propose it; codes unique per chart. |
| **AC-11** | Part payments in the ledger | Follow Finance CEO-3 (Phase C): verified PART- rows booked to the bank and to a **customer deposits / unearned (liability)** account, released to income when the invoice is paid in full. This is not part of Accounting Phase A. |
| **AC-12** | The four statutory payroll liabilities (EPF, SOCSO, EIS, PCB) | Show them in the payroll check as "paid outside the books" until accrual (AC-2) is approved. |

## P0 queries (read-only; run on production and send me the results before Phase B)
1. `SELECT ref, COUNT(*) FROM journal_entries WHERE ref != '' GROUP BY ref HAVING COUNT(*) > 1;`: duplicate refs (pre-0148 history).
2. `SELECT e.id, e.ref, SUM(l.debit_cents) d, SUM(l.credit_cents) c, COUNT(l.id) n FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id HAVING d != c OR n < 2;`: unbalanced entries.
3. `SELECT month, SUM(net_cents) FROM payroll_entries GROUP BY month;` and `SELECT ref, amount_cents, reversal_of FROM cashflow_entries WHERE ref LIKE 'PAYROLL-%';`: payroll drift.
4. `SELECT ref, entry_date, amount_cents FROM cashflow_entries WHERE ref LIKE 'RECON-%' ORDER BY entry_date;`: channel settlements to compare with ELFIA/INV- receipts in the same periods.
5. `SELECT company, COUNT(*), SUM(amount_cents) FROM cashflow_entries GROUP BY company;` (after 0197): how much history is unattributed.
6. `SELECT a.code, a.name, SUM(l.debit_cents), SUM(l.credit_cents) FROM journal_lines l JOIN gl_accounts a ON a.id = l.account_id GROUP BY a.code;`: the real trial balance.
7. `SELECT * FROM period_closes ORDER BY id;`: closes and reopens so far.

**Nothing will be coded, migrated or deployed until you approve a phase.**
