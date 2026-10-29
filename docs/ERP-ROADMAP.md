# ERP roadmap: HRM, CRM, Inventory, Sales, Finance

The portal is being completed into five joined systems, one phase at a time.
This file is the status record for that work. Every AI tool and contributor
reads it before touching a module the roadmap covers, after `AGENTS.md` (the
contract every AI tool shares) and `CLAUDE.md`.

Owner's brief, 20 October 2026:

> "I want to make my system like a HRM, CRM, inventory management, sales and
> recording."
>
> "Proceed with the implementation phase by phase, and also do not change any
> logic since my system are currently use by staff."

## The rule every phase keeps

**Additive only.** A phase reads what the portal already records, or writes
to tables of its own. It never changes how an existing figure is computed,
how an invoice becomes paid, what payroll pays, what the cash book says, or
what a role can already see. New behaviour that would change an existing
outcome is opt-in (off until someone turns it on) and says so on screen.

- New routes live in `worker/src/business.ts`, behind one door in
  `worker/src/staff.ts`. Each route uses the permission of the screen whose
  data it reads. Nothing in `business.ts` writes to `sales_documents`,
  `cashflow_entries`, the journal, payroll, users, leave, attendance, claims,
  receipts or credit notes. Phase 2 is the one exception, written down below:
  receiving stock raises `inventory_items.stock` and moves the average cost,
  through the same movement log manual stock-in already uses. Phase 3's
  stock take does the same for counted differences, as variance movements.
- New screens are `.erp-*` classes and `components/portal/business.module.css`.
  No new utility class.
- Every phase has a migration that only adds, registered with a health probe,
  and a block in the guard `tests/business-joins.mjs`.
- Each phase is its own version, delivered to the owner's PC and released by
  the owner with `PUSH.bat`. Nothing deploys itself.

## Decisions the owner made (20 October 2026)

| Question | Decision |
| --- | --- |
| Part payments | Recorded against the invoice and shown as a balance. The invoice stays unpaid; aging, revenue, commission and cash flow change only when somebody marks it paid, as before. |
| Purchasing | Stays retired (it was retired on 21-09-2026 because nobody used it). Stock-in is a **Receive stock** form on Inventory, with no purchase orders. |
| Finance cash flow date | Unchanged. The money-in entry is still dated the day the invoice is marked paid. |
| Stock costing | Moving average, applied by Receive stock only and only when its box is ticked (ticked by default; the owner can untick it per receipt). |
| Month close | A snapshot of the month's figures. It locks nothing (a lock would change what staff can save); a later change shows as "changed since close". |
| Prospect to customer | Not built. The owner retired the prospects pipeline in v1.21.0; enquiries are the funnel, and an enquiry becomes a quotation. |
| Credit terms | Opt-in per client. They give a NEW invoice its due date through the normal form; issued invoices are never changed. |
| Recurring invoices | Never raised by a machine. Listed when due; a person fills the normal form from one and saves it. |
| Acceptance on the shared link | Recorded against the revision shown. No status changes. |
| Probation decision | Recorded only. The employment status is still changed in Staff Details. |
| HR letters | Drafted from the record, edited by HR, signed by hand. No signature image. |
| Quotation approval limit | Off until the CEO sets it. When on, it gates Send PDF in Sales for quotations raised or revised after it was turned on; PDF printing is unchanged. |
| Locations, batches, client portal, appraisals, statutory payslip lines, bank import, SST | Not in this programme. |

### 22 October 2026 - five tabs retired (v1.183.0)

The owner retired **Commission, Enquiries, Sales Performance, Hankei's and
Web Orders** the v1.172.0 way: tabs, panels, role defaults, hints, icons,
strings and their guard checks are gone from the portal; the worker routes
and D1 tables stay dormant and untouched. His choices: the intakes that fed
three of them keep running (the website and customer-account enquiry forms,
Astra GPT's `/api/v1/hankeis`, the ELFIA shop checkout) - rows land in the
database with no screen; and commission leaves pay as well as the portal
(the payroll grid's Commission column and "Pull approved commission" are
gone; a month already paid with commission keeps its figure). What this
changes in the roadmap above: phase 4's **Enquiries → Make quotation**
handoff is gone with Enquiries (a quotation still starts in Sales); the
customer File still lists a client's enquiries and engagements as history,
read by the same permissions. Phase 1's "commission ... change only when
somebody marks it paid" is moot: nothing computes commission any more.

## Phases

| Phase | Version | Status | What it adds |
| --- | --- | --- | --- |
| 1 Joins | 1.181.13 | Built, local | Customer history (one client's documents, revisions, payments, receipts, credit notes, and the enquiries, engagements and live sessions the role may see); part payments on an invoice |
| 2 Stock in | 1.181.14 | Built, local | Receive stock (supplier, lines, cost) with moving-average cost; optional supplier bill in Expenses; reorder level per SKU |
| 3 Books | 1.181.15 | Built, local | Month close (a snapshot; nothing locks); position: debtors, creditors, stock at cost; audit trail; stock take with variances |
| 4 Customers | 1.181.16 | Built, local | Client file (contacts, tags, credit terms, follow-ups on the Desk, monthly invoice to raise), enquiry to quotation, acceptance on the shared link |
| 5 People | 1.181.17 | Built, local | Joining and leaving checklists, probation reminders and decisions, HR letters, team leave calendar, training log, quotation approval limit (off by default) |

"Built, local" means the code is on the owner's PC and passes every gate, but
has not been released. Only a successful `PUSH.bat` run changes a phase to
"Released".

## Phase 1 - Joins (v1.181.13)

**Customer history.** Sales → Customers → a client's row → **History**.
`GET /staff/customers/:id/timeline` reads, newest first: documents and their
revisions, invoices marked paid, part payments, receipts, credit notes, and:

| Source | Shown to | Same rule as |
| --- | --- | --- |
| Documents, payments, receipts, credit notes | `sales` or `exec_view` | `GET /staff/docs` |
| Enquiries (matched by the last 9 phone digits or the company name) | `enquiry_manage` | the Enquiries tab |
| Engagements | `sales_perf_manage` all; `sales_perf_view` own only | Sales Performance |
| Live sessions | CEO, COO, CCO, HR admin, admin | `GET /staff/live-sessions` (management view) |

A source the role may not see is not queried; the dialog names what was left out.

**Part payments.** Sales → Documents → an invoice's number → **Part payments**.
Table `invoice_payments` (migration `0140_part_payments`).

- `GET /staff/docs/part-payments` - received so far per invoice (row chips).
- `GET /staff/docs/:id/payments` - the parts, received, balance.
- `POST /staff/docs/:id/payments` - `finance` permission. Refuses a paid
  invoice, an amount over the balance, and a date after today.
- `POST /staff/docs/:id/payments/:pid/void` - `finance`, with a reason. A part
  is never deleted.

Nothing here marks an invoice paid. When the parts reach the total, the panel
says so and asks the person to mark it paid with the existing status picker,
choosing the last part's date.

## Phase 2 - Stock in (v1.181.14)

Inventory → **Receive stock** (zone between Record and What moved), one card
with three panes. Tables `stock_receipts`, `stock_receipt_lines`; columns
`inventory_items.reorder_level`, `reorder_qty` (migration `0141_stock_receipts`).

- `GET /staff/inventory/receipts` - receipts, past suppliers, reorder list and levels.
- `GET /staff/inventory/receipts/:id` - a receipt's lines.
- `POST /staff/inventory/receipts` - `inventory` permission. Supplier, day
  (today or earlier), 1-30 lines, `update_cost` (default true), optional
  `bill_due_on`. One D1 batch per receipt: a line row, a relative stock
  update with the `stockStatus` rule and the low-alert reset, and a
  `manual_stockouts` row (`in`, `restock`). The head is removed if the batch fails.
- `POST /staff/inventory/receipts/:id/void` - with a reason. Refused when an
  item no longer holds the received quantity. Writes `out` / `correction`
  rows; restores the unit cost only if no later receipt set it.
- `POST /staff/inventory/receipts/:id/bill` - `{ paid_on }` (or `null`).
  Recorded on the receipt only.
- `PUT /staff/inventory/:id/reorder` - optional level and quantity.

Not written: expenses, cash flow, journal. The low-stock watcher keeps its
own threshold; a reorder level only lists the item in the Reorder pane.

## Phase 3 - Books (v1.181.15)

Accounting → **Month end** (zone between The books and Adjustments), one card
with three panes; Inventory → **Stock take** (zone after Receive stock).
Tables `period_closes`, `stock_counts`, `stock_count_lines` (migration
`0142_books_stock_take`).

Books - `accounting_manage` (the Accounting tab's permission):

- `GET /staff/books/months` - the last six months: invoiced, received
  (marked paid, by paid date), part payments, expenses, stock received,
  payroll net, documents; each closed month with `changed_since_close`.
- `POST /staff/books/close` - `{ month, note? }`. Only a month that has
  ended; one active close per month. Stores the figures as JSON.
- `POST /staff/books/reopen` - `{ month, reason }`. Marks the close
  reopened; never deletes it.
- `GET /staff/books/position` - debtors (unpaid invoices less part
  payments), creditors (unpaid supplier bills from Receive stock), stock at
  cost by category.
- `GET /staff/books/audit` - CEO and super_admin only. Filters `user`,
  `action` (prefix), `from`, `to`, `q`, `before`; 100 rows.

A close **locks nothing**. Nothing outside `business.ts` reads
`period_closes`, so no save, release or report behaves differently.

Stock take - `inventory` permission:

- `GET /staff/stock-counts`, `GET /staff/stock-counts/:id`.
- `POST /staff/stock-counts` - `{ category? }`. One open at a time. Notes
  each item's stock as `system_qty`.
- `PUT /staff/stock-counts/:id/lines` - `{ lines: [{ item_id, counted_qty | null }] }`.
- `POST /staff/stock-counts/:id/post` - one D1 batch: for each counted line
  that differs, `stock = stock + (counted - system_qty)` with the
  `stockStatus` rule and the low-alert reset, and a `manual_stockouts` row
  (`in` / `variance_found` or `out` / `variance_missing`). Refused with the
  item named if a difference would take the shelf below zero.
- `POST /staff/stock-counts/:id/cancel` - stock untouched.

## Phase 4 - Customers (v1.181.16)

Sales → Customers → a client's row → **File** (dialog); a strip of monthly
invoices due at the top of Sales → The work; Enquiries → **Make quotation**
(retired with the Enquiries tab, v1.183.0);
an **Accept this quotation** card on the shared quotation page. Tables
`customer_contacts`, `customer_tags`, `customer_followups`, `customer_terms`,
`recurring_invoices`, `quotation_acceptances` (migration `0143_customer_joins`).

Reads: `sales` or `exec_view`. Writes: `sales` (as `POST /customers`).

- `GET /staff/customers/crm` - tags, terms, open follow-ups, recurring
  invoices with `due` / `raised` for this month.
- `GET /staff/customers/:id/file` - one client's contacts, tags, terms,
  follow-ups, recurring invoices, its invoices, the possible owners.
- `POST /staff/customers/:id/contacts`, `POST /staff/customers/:id/contacts/:cid/remove`.
- `PUT /staff/customers/:id/tags` - `{ tags: [] }`, the whole set, max 12.
- `PUT /staff/customers/:id/terms` - `{ terms_days: 1-120 | null }`.
- `POST /staff/customers/:id/followups` - `{ due_on, note, owner_id? }`;
  `POST /staff/followups/:id/done`, `POST /staff/followups/:id/cancel`.
- `POST /staff/customers/recurring` - `{ source_doc_id, day_of_month }`;
  `POST /staff/customers/recurring/:id/stop`;
  `GET /staff/customers/recurring/:id/prefill` - the source invoice's lines
  and the reference `Recurring R-<id> · YYYY-MM`, for the Create form.
- `GET /staff/docs/:id/acceptance`.
- Public: `POST /api/v1/public/doc/:token/accept` - `{ name, position?, agree: true }`.
  Quotations only, once per revision, 10 per hour per address. The public
  `GET /api/v1/public/doc/:token` adds `can_accept` and `acceptance`.

The Desk gains two buckets for the sales team, both "do": `followups` (due
today or earlier, mine or nobody's) and `billing` (monthly invoices due and
not raised). Both only read.

Credit terms: the Sales form sends `due_date` = invoice date + terms on a
NEW, unpaid invoice of a client with terms (the existing `POST /docs` already
accepts it). Editing never sends one.

## Phase 5 - People (v1.181.17)

HR → **Joining, leaving and letters** (zone after Administration, rendered
only for `hr_manage`); Leave → The company → **Team leave** (rendered only
for `team_manage`); Sales → Documents → the CEO's approval switch. Tables
`leaving_checklists`, `probation_reviews`, `hr_letters`, `training_records`,
`business_settings`, `quotation_approvals` (migration `0144_people`).

`hr_manage`:

- `GET /staff/people/overview` - joining (last 90 days, open keys of
  `users.onboarding_json`, read only), leaving (last day within 60 days,
  checklist, assets held), probation (status `probation`, review row,
  suggested end = joined + 3 months), recent decisions, letters, training,
  the staff list.
- `PUT /staff/people/:uid/leaving` - `{ items: { key: true } }`, only the
  six `LEAVING_KEYS`.
- `POST /staff/people/:uid/probation` - `{ ends_on }`;
  `POST /staff/people/:uid/probation/decide` -
  `{ outcome: confirmed | extended | ended, note?, next_ends_on? }`.
  Never writes `users`.
- `GET /staff/people/:uid/letter-fields`; `POST /staff/people/:uid/letters` -
  `{ kind, subject, body, issued_on, signer_name, signer_position }`,
  numbered `A2Z/HR/YYYY/NNN`; `GET /staff/people/letters/:id`;
  `POST /staff/people/letters/:id/void` - `{ reason }`.
- `POST /staff/people/:uid/training`; `POST /staff/people/training/:id/remove`.

`team_manage`: `GET /staff/people/leave-calendar?month=YYYY-MM` - approved
and pending leave overlapping the month. Read only.

Quotation approval limit (CEO and super admin; OFF by default):

- `GET /staff/quotes/approval` - `{ limit_cents: null }` when off; when on,
  quotations above the limit raised or revised since it was turned on
  (`revised_at` is stored in Malaysia time and converted), split pending /
  approved for their current revision.
- `PUT /staff/quotes/approval/limit` - `{ limit_cents | null }`.
- `POST /staff/docs/:id/approve` - approves the current revision.

The Desk gains `people` (HR: probation ending within 14 days or past it
undecided - decide; open joining steps for someone who joined in the last 60
days, open leaving steps - do) and `quotes` (CEO, only while the limit is on -
decide). Both only read.

## After phase 5

All five phases are built and on the owner's PC. Each moves to "Released"
only after a successful `PUSH.bat` run, which applies migrations 0140 to 0144
in order. Not in this programme (owner's decision): purchasing, locations,
batches, client portal, appraisals, statutory payslip lines, bank import,
SST, prospects.

Later additions outside the five phases: 1.215.0 (Payroll 2.0 phase A) adds
migration `0145_invoice_paid_confirmations` - the CEO or COO confirmation
that an invoice paid in full is real. It never changes an invoice. 1.217.0
(News & Announcements 2.0) adds migration `0146_announcements_v2`.
1.219.0 (Finance & Cash Flow 2.0) adds migration `0147_cashbook` - additive
columns for true dates, reversals and transfers, opening balances, and
`cashbook_marks`; bank import stays out of the programme.
1.222.0 (Accounting & Financial Control 2.0) adds migration
`0148_journal_integrity` - indexes only: a journal reference is posted once
(new entries), and the ledger is read by the day the money moved. The books
stay cash basis; no balance sheet until opening balances are approved.
1.223.0 (Weekly Sales) adds migration `0149_weekly_sales` - approved weekly
targets (insert-only), finalised week results, recovery plans, and a
nullable link (customer, enquiry, quotation, recovery plan) on tasks.
1.224.0 (Sales Commission) adds migration `0150_commission_ledger` -
versioned commission policies, the entitlement ledger (one row per event)
and the log of the payroll switch.
