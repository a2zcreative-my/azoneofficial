# GATE 1.324.0 — Global UI System, phase D group 1: Sales, Payroll, Finance (and the Dashboard fits)

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only: no route, permission, approval rule, calculation or table changes.
**Authority:** the CEO, 16-11-2026, after reviewing 1.323.0:
- *"Dashboard with the alert band: tighten the space between cards so it fits the screen"*
- *"Phase D order: confirm Sales / Payroll / Finance first, then HR / Staff / Leave / Claims, then the rest."*

**Sits on:** 1.323.0, which is on the PC and not deployed.

## What changes on the screen

### Dashboard

On a desktop the Overview's cards now sit 12 px apart (16 px before), and Quick Actions is a little slimmer. **The whole Overview, with the alert band showing, now fits a 1440 × 900 screen** (it was 924 px). The phone is unchanged.

### Sales

- **The one tab row (gold underline) replaces the pill rows:**
  - **Documents:** All Documents, Quotations and Invoices, with **More…** (delivery orders, receipts, credit notes, outstanding, packages) at the end of the row.
  - **Customers & Follow-ups:** Needs Action, Enquiries, Follow-ups, All Customers and Board, with the Everyone / Mine switch at the end of the row.
  - **Clients / Add customer.**
  - **Payments:** Needs My Verification, Invoice Balances, Payment History and Audit Trail.
- **The one view switch:** the Closed Sales period (This month / Last month / All) and the enquiry filter (Open / New / Closed).
- **The quotation approval limit** reads as one line, for example "Quotation approval: on, above RM 4,000.00 · Change". The field opens in a drawer, with the same Change limit / Turn on / Turn off buttons and the same save. The drawer asks before discarding anything typed.
- **On a desktop**, the documents list, the Sales Worklist and Customers needing action fill the screen and scroll inside it when they are long, with the pager kept under them.

### Payroll

- **The processing grid stays on the page, because it is the work.** On a desktop it fills the screen and scrolls inside, with its header and TOTAL row pinned. Payroll History does the same.
- **Base salaries** now read as a list of names and amounts. **Edit base salaries** opens the same fields and the same **Save base salaries** in a drawer. Save works as before: it carries a new base into the open month, unless that month is released or past. The drawer asks before discarding typed figures.

### Finance

- **Add Expense** is now a button. Its form opens in a drawer with the same fields, checks, evidence upload and save. Recording an expense still never books cash.
- **Add transaction:** Money in or out / Transfer between accounts is the one view switch. When Transfer cannot be chosen, the reason shows on it ("Needs two accounts of one company").
- **Reconciliation:** the two big figures (Out of Step, Total Difference) are now the one KPI strip.
- **On a desktop**, the Transactions ledger and the monthly report fill the screen and scroll inside, with the column names pinned.

## Measured at 1440 × 900 (height of the page in the fixture)

| View | 1.323.0 | 1.324.0 |
|---|---|---|
| Dashboard → Overview (with the alert band) | 924 | **900 (fits)** |
| Payroll → Payroll Processing | 948 | **900 (fits)** |
| Payroll → Settings & Audit | 1,406 | 1,292 |
| Finance → Transactions | 1,183 | **900 (fits)** |
| Finance → Expenses | 1,297 | 1,151 |
| Finance → Reconciliation | 909 | **900 (fits)** |
| Sales → Quotations & Invoices | 986 | 976 |

**Still taller than the screen, by their nature:**

| View | Height (px) | Why |
|---|---|---|
| Sales → Overview | 1,305 | Strip, pipeline, then the worklist beside the follow-ups. |
| Payroll → Overview | 1,284 | Four cards. |
| Payroll → Reports & Export | 2,073 | Bank file, history and the report tables. |
| Finance → Overview | 1,093 | Several cards. |
| Finance → Reports | 2,593 | Several report tables. |

On these views the page scrolls. A list only fills the screen when at least 320 px is left for it.

## Evidence (executed in the sandbox)

- **`tests/ui-system.mjs`:** 39 checks; all 35 deliberately broken versions are caught. New for group 1:
  - Sales, Payroll and Finance draw no tab row and no pressed-button switch of their own.
  - Their sub-tabs are LineTabs and keep their test ids.
  - Their view switches are PillSwitch, including the option that cannot be chosen, with its reason.
  - The three inline forms open in drawers that warn before discarding, and save to the same routes.
  - The long lists fill the screen.
  - Reconciliation's figures are the KPI strip.
  - The Dashboard's 12 px gap.
- **Ratchets lowered:**
  - Hand-made tab rows: 18 → **15**.
  - Private switch styles: 49 → **45**.
- **`tests/browser/ui-system.py`** adds:
  - the Dashboard fit with the alert band showing;
  - the three modules' main lists at 1440 and 390;
  - Add Expense in the drawer, including the discard warning;
  - base salaries as a list, opening the drawer;
  - the approval limit in the drawer;
  - the Documents tab row.
- **Adapted:** `tests/tab-concept.mjs`. It still requires a tab row on the Sales work card; that row is now LineTabs.
- **Browser runs on the final build** (the fixture servers):

  | Suite | Result |
  |---|---|
  | `ui-system` | 220/220 |
  | `finance5` | 64/64 |
  | `payroll-figures` | every payroll figure as before, no failures |
  | `payments-3` | 202/202 |
  | `pay-ceo` | 36/36 |
  | `payments-verify` | 63/63 |
  | `sales2` | 44/44 |
  | `sales4` | 356/356 |
  | `sales-e3` | 33/33 |
  | `dashboard-e2` | 49/49 |
  | `commission5` | 55/55 |
  | `compact-dashboard` | 43/43 |
  | `sales-discipline` | 37/37 |

- **`sales-e3` showed 31/33 once, in a batch run right after the payments suites.** Those suites change the payments on the same fixture server. Run on its own after a reset, it passed 33/33.
- **Adapted (intent kept):**
  - `payments-3`: the Waiting for review tab now reads its word with its count on the same line, so the check reads the start of the line.
  - `commission5`: its Dashboard check looked for the `kpis4` wrapper that 1.323.0 removed. It now reads the one KPI strip. The cards under the strip line up within half the 12 px gap, because the strip has no gaps of its own.
- **Full guard run** (`node scripts/run-guards.mjs`, 16-11-2026): **[OK] all 209 guards passed.**
- **Lint and types:** lint 0 errors, 114 warnings (unchanged); tsc clean.

## Deploy notes

- No migration.
- Files retired: none.
- Earlier, `components/ui/metric-strip.module.css` (from 1.323.0) was to be removed. If it is still in the folder, it is in `_to_delete/`, or should be deleted by hand.
