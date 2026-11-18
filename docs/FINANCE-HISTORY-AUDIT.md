# Finance — why earlier months show RM 0 (read-only audit, 18-11-2026)

Ask (the CEO): Finance does not show the previous months' records; make them visible "with correct flow data". Audit first, no implementation.

Read: `worker/src/cashbook.ts` (GET /staff/erp/cashbook — the one read behind all five Finance tabs), `components/portal/finance-panels.tsx`, `worker/src/staff.ts` /docs/:id/confirm-paid. Nothing was changed.

The live database was not read: the built-in browser was not signed in to the portal. The causes below are proven in code. The counts per month still need the live data (queries at the end).

## What the code does

- The server reads **all history**, with no date limit: every cash-book row (`cashflow_entries`), every invoice marked paid, every part payment.
- The period only filters what is shown. The Cash Trend is built from the same full list, month by month.
- So nothing is "not fetched". Earlier months reach the screen empty because of the rules below, applied after the read.

## Root causes

**R1 — Money In counts only CEO-verified receipts (v1.312.0, CEO-1).**
- A paid invoice counts once the CEO presses **Confirm paid**, which writes an `invoice_paid_confirmations` row. That step exists only since v1.215.0, 28-10-2026.
- A part payment counts once its payment report is verified, or once its invoice is paid in full and confirmed.
- Everything else is "awaiting verification": listed, but counted in neither Money In nor the trend.
- Invoices paid June–October, before the confirmation step existed, were never confirmed. Their months draw as RM 0.

**R2 — the warnings only look at the chosen period.**
- "Awaiting verification", Needs Attention and the Reconciliation list are built only from items inside the selected period (`exceptionsOf … inPeriod`; the awaiting totals use only the period's items).
- With "This month" selected, nothing from June–October is ever flagged. That is why the page reads *Needs Attention 0* while the history is missing.

**R3 — one company at a time, and older rows belong to no company.**
- Finance opens on **A2Z Creative Marketing**.
- An item counts for a company by its account's company, else the row's own `company`, else (for a receipt) its invoice issuer.
- Cash-book rows written before migration 0197 (v1.312.0) carry no company: payroll bank runs, claims, expenses and manual entries. Many also have no account. They count only under **Both companies**.
- Their "which account?" warning is also dropped in a single-company view: the filter `x.company === company` never matches null.
- Result: in the A2Z view, earlier months show *Money Out RM 0*, with nothing pointing at the cause.

**R4 — not a bug: the legal rule.**
- Invoices created before the 19-08-2026 switch carry `issuer_code` NULL, which means **AZ ONE OFFICIAL** (lib/issuers.ts).
- Their money is AZ ONE's and appears under AZ ONE OFFICIAL, never under A2Z. This must stay: the two companies are never pooled.

**Smaller points.**
- The trend asks the server for 12 months but draws the last 6.
- The account balance (RM 900) is a book balance: an opening balance a person entered, plus verified movements through that account only.

## What correcting it touches

- **Confirm paid also feeds commission.** `/docs/:id/confirm-paid` (CEO owner only, amount = invoice total, "checked" tick) calls `ensureLedger`, the commission engine.
- The engine earns only under a policy in force on the paid day. Policies start on or after 2026-11-01, so June–October invoices should earn nothing. This must be proven before any bulk step.
- **Company separation.** An item's company comes from the account it moved through. Assigning an old payroll or claim row to an account is the existing "assign account" correction (`cashbook_correct`). It is audited and stored as a mark; the row is never rewritten.

## Options for the CEO

**D1 — how historical receipts become Money In.**
- (a) Verify them one by one, from a "Past receipts awaiting verification" list covering every period. Uses the existing Confirm paid action.
- (b) One bulk verification up to a date you choose, with reason and authenticator code. One confirmation row per invoice through the same rule, each audited. Commission is proven to add nothing first.
- (c) Leave them unverified but drawn: a separate "awaiting verification" line in the trend, not counted as Money In.

**D2 — attention scope.** Warnings for earlier periods ("N older items") are shown whatever period is selected.

**D3 — cash rows with no company.** Each company view lists "Needs a company". Assigning an account settles the company, through the existing action — never a guess from the description.

**D4 — money never recorded in the portal at all.** Enter it with **Record movement** at its true date. Already built; no code needed.

## Data still needed (read-only; Cloudflare → D1 → azoneofficial → Console)

```sql
-- paid invoices by month, company and whether the CEO verified them
SELECT substr(COALESCE(date(d.paid_at,'+8 hours'), date(d.created_at,'+8 hours')),1,7) AS month,
       COALESCE(d.issuer_code,'legacy = AZ ONE') AS issuer,
       EXISTS(SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id=d.id AND k.revoked_at IS NULL) AS verified,
       COUNT(*) AS invoices, SUM(d.total_cents)/100.0 AS rm
  FROM sales_documents d WHERE d.doc_type='INV' AND d.payment_status='paid'
 GROUP BY 1,2,3 ORDER BY 1,2,3;

-- cash-book rows (not invoice rows) by month, direction and company
SELECT substr(COALESCE(c.effective_date, c.entry_date),1,7) AS month, c.type,
       COALESCE(b.company, c.company, 'NO COMPANY') AS company,
       COUNT(*) AS rows, SUM(c.amount_cents)/100.0 AS rm
  FROM cashflow_entries c LEFT JOIN bank_accounts b ON b.id=c.bank_id
 WHERE c.ref NOT LIKE 'INV-%' GROUP BY 1,2,3 ORDER BY 1,2,3;

-- part payments by month and whether verified
SELECT substr(p.received_on,1,7) AS month,
       EXISTS(SELECT 1 FROM invoice_payment_reports x WHERE x.payment_id=p.id AND x.state='verified') AS verified,
       COUNT(*), SUM(p.amount_cents)/100.0 AS rm
  FROM invoice_payments p WHERE p.voided_at IS NULL GROUP BY 1,2 ORDER BY 1,2;
```

Quick check without SQL: Finance → company **Both companies**, period **Custom 01-06-2026 → today**, then read Transactions. Items marked "awaiting verification" are the ones R1 keeps out of Money In.
