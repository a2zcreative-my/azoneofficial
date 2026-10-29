# AGENTS.md - one contract for every AI tool

This file is the shared contract for every coding agent that works in this
repository: Claude (Claude Code, Cowork), OpenAI Codex, GitHub Copilot,
Cursor, Gemini CLI, and any tool that reads `AGENTS.md`. Tool-specific files
(`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`) point here and
add only what is specific to that tool. When the rules disagree, this file and
`CLAUDE.md` win over older guides.

Last synchronised: 28 October 2026, version **1.224.0** (local, undeployed; 1.181.17 is on GitHub main).

## What this repository is

The public website and the staff portal of A2Z CREATIVE MARKETING (and its
sister issuer AZ ONE OFFICIAL): HR, attendance, leave, payroll, claims, sales
documents (quotation, delivery order, invoice), inventory, finance and
accounting, enquiries, and the ELFIA store bridge (ELFIA is a client, not a
house brand). Next.js 16 static export + React 19 in `app/` and `components/`;
a Cloudflare Worker API with D1 (SQLite) and R2 in `worker/`. The portal is in
daily use by staff: **behaviour that staff rely on must not change unless the
owner asks for that change.**

## Read before you change anything

1. `docs/PROJECT-STATE.md` - the current handoff: what is local, what is live, what is blocked.
2. The latest entries of `CHANGELOG.md`.
3. `CLAUDE.md` - the full implementation contract and the house rules learned in production.
4. The module's own doc: `docs/ERP-ROADMAP.md` (HRM, CRM, inventory, sales, finance additions),
   `docs/DATABASE.md` (migrations), `docs/PERMISSIONS.md` (roles), `docs/INTERFACE-SYSTEM-V3.md` (UI).
5. `git status --short` and `git diff --stat`. Uncommitted files and any stash (`refs/stash`) are
   another contributor's work: never overwrite, reformat, rename, delete or pop them.

## Rules that are never broken

**Release**
- `PUSH.bat` is the only release path. It runs every gate, applies migrations and deploys. Never call
  Wrangler deploy directly and never run `PUSH.bat` on the owner's behalf.
- `PUSH.bat allow-dirty` only with the owner's approval written in `docs/PROJECT-STATE.md` first.
- Local work is "local, undeployed" until a successful `PUSH.bat` run. Never call it released.
- Never weaken, skip or delete a guard to make a release pass. Fix the code, or explain to the owner.

**Security and data**
- Never write a secret, key or token into any file or chat. Secrets go in through the hidden
  prompts of `PUSH.bat secrets`. A key that has appeared in a chat must be rotated.
- Bridge and store URLs are Wrangler secrets; do not hard-code portal or client domains where a guard bans them.
- No per-person tracking of customer browsing (decision OD-20a).
- A receipt, OCR result, customer declaration or Telegram message never marks a payment verified.
  Only an authorised person who checked the bank record does.
- Never write a real handwritten signature image into the repository (`public/signatures/` is guarded).
- Demo or sample data never goes into a production migration.
- Audit artifacts stay out of the repositories.

**The ERP programme (20 October 2026, phases 1-5, `docs/ERP-ROADMAP.md`)**
- Additive only. New routes live in `worker/src/business.ts`, behind ONE door in `worker/src/staff.ts`
  (exact path regexes). `business.ts` never writes `sales_documents`, `cashflow_entries`, the journal,
  payroll, `users`, leave, attendance, claims, receipts or credit notes. The stated exceptions are
  receiving stock and posting a stock take, which move `inventory_items.stock` through the same
  `manual_stockouts` log a manual adjustment uses.
- Each route uses the permission of the screen whose data it touches (`can(role, "...")` from
  `worker/src/permissions.ts`). A join never becomes a softer road to data a role could not open.
- A new behaviour that would change an existing outcome is OFF until the owner turns it on, and says so
  on screen (example: the quotation approval limit).
- Record, never decide: part payments do not mark an invoice paid; a month close locks nothing; a
  customer's acceptance changes no status; a probation decision does not change the employment status;
  a monthly invoice is never raised by a machine.
- Retired and staying retired: Purchasing, Reconciliation, Ads Fund, the prospects pipeline, and
  (1.183.0, the owner, 22-10-2026) Commission, Enquiries, Sales Performance, Hankei's and Web Orders -
  including commission in pay. Do not bring their screens back. Their worker routes and tables are
  dormant, not deleted; the enquiry forms, `/api/v1/hankeis` and the ELFIA checkout still accept work
  by the owner's choice. P1.0b / P1.2+ routing work is not authorised.

**Database**
- A migration only adds (`CREATE TABLE IF NOT EXISTS`, nullable `ALTER TABLE ... ADD COLUMN`), uses
  ASCII `--` comments with no quotes and no semicolons, is appended to `EXPECTED_MIGRATIONS`, set as
  `LATEST_MIGRATION` and given a health probe in `worker/src/index.ts`. It must pass
  `tests/migration-safety.mjs` and `tests/sql-schema-check.mjs`.
- `sales_documents.created_at` is UTC; `revised_at` is Malaysia time (+8). Convert before comparing.
- Every route tolerates a database one migration behind (`no such table/column`) with a clear
  "apply migration NNNN" answer, never a 500 to staff.

**Interface**
- Tailwind is retired. Never write a utility class. Use the vocabulary in `lib/ui-styles.ts`, the
  `.erp-*` classes in `styles/erp-v3.css`, tokens from `styles/globals.css` and a CSS Module beside the
  component (`components/portal/business.module.css` serves the ERP screens). No hex colours in components.
- A tab body is `TabPage` of captioned `TabZone`s, figures before work before records before setup.
- Every component that fetches on mount shows a skeleton in its own shape (`Skel`, `SkelRows`).
- Every user-facing string is bilingual at the display point: `L("English", "Bahasa Melayu")`.
  Printed and official documents (letters, payslips, forms, the shared document page) stay English.
- Mutating requests go through `api()` or `csrfFetch()` from `lib/api.ts`, never a bare `fetch()`.
- Preserve `canSeeTab` / `accessOf`; do not build a second permission model.
- Dead files `components/staff/leave-review-card.tsx` and `components/portal/next-event-card.tsx`
  must not be restored or recreated.

## The gate (all must pass before handing work over)

```bash
npm run -s typecheck && npm run -s lint          # 0 errors; warnings must not rise (125 at 1.224.0)
cd worker && npx tsc --noEmit -p . && cd ..      # worker types
node scripts/run-guards.mjs                      # 109 guards, including business-joins (102 checks)
pnpm build                                       # static export
```

For a screen change, also look at it at 1500px and 390px against the fixture server
(`node tests/browser/serve.mjs out 4177`, fixtures in `tests/browser/fixture.mjs`; add a fixture row
for every endpoint a new card reads). For a worker change, run it locally:
`npx wrangler d1 migrations apply azoneofficial --local` then `npx wrangler dev --local`.

## Where the ERP modules live

| Phase (version) | Screens | Worker routes | Tables (migration) |
| --- | --- | --- | --- |
| 1 Joins (1.181.13) | Sales: customer History, invoice Part payments | `/docs/part-payments`, `/docs/:id/payments`, `/customers/:id/timeline` | `invoice_payments` (0140) |
| 2 Stock in (1.181.14) | Inventory: Receive stock | `/inventory/receipts`, `/inventory/:id/reorder` | `stock_receipts`, `stock_receipt_lines` (0141) |
| 3 Books (1.181.15) | Accounting: Month end, Position, Audit trail; Inventory: Stock take | `/books/*`, `/stock-counts/*` | `period_closes`, `stock_counts`, `stock_count_lines` (0142) |
| 4 Customers (1.181.16) | Sales: client File, monthly invoices; Enquiries: Make quotation (retired with Enquiries, 1.183.0); shared link: Accept | `/customers/crm`, `/customers/:id/file`, `/customers/recurring`, `/followups/*`, `/docs/:id/acceptance`, public `/api/v1/public/doc/:token/accept` | `customer_contacts`, `customer_tags`, `customer_followups`, `customer_terms`, `recurring_invoices`, `quotation_acceptances` (0143) |
| 5 People (1.181.17) | HR: Joining, leaving and letters; Leave: Team leave; Sales: approval limit | `/people/*`, `/quotes/approval*`, `/docs/:id/approve` | `leaving_checklists`, `probation_reviews`, `hr_letters`, `training_records`, `business_settings`, `quotation_approvals` (0144) |
| Payroll 2.0 phase A (1.215.0) | Sales: Closed Sales - Confirm paid; Payroll: Sales Commission column (read-only) | `/docs/:id/confirm-paid`, `/docs/:id/confirm-paid/revoke`, `/payroll/commission-sources` (in `worker/src/staff.ts`) | `invoice_paid_confirmations` (0145) |
| News 2.0 (1.217.0) | News: Feed, My Acknowledgements, Publish & Manage, Reports & Archive | `/announcements`, `/announcements/:id` (PATCH), `/:id/ack`, `/:id/versions`, `/:id/acks`, `/announcements/report`, `/:id/files` (in `worker/src/news.ts`) | `announcements`, `announcement_acks` rebuilt; `announcement_versions`, `announcement_files` (0146) |
| Accounting 2.0 (1.222.0) | Accounting: Overview, General Ledger, Financial Reports, Month-End & Audit | `/erp/gl/overview`, `/erp/gl/month-end`, `/erp/gl/journal` (paged), `/erp/gl/journal/:id`, `/erp/gl/journal/:id/reverse`, `/erp/gl/ledger`, `/erp/gl/pnl`, `/erp/gl/trial-balance?as_of` (reads in `worker/src/ledger.ts`; posting in `shared.ts` `postJournal`, atomic and dated) | `journal_entries` unique ref for new entries (0148) |
| Finance 2.0 (1.219.0) | Finance: Overview, Transactions, Expenses, Reconciliation, Reports | `/erp/cashbook`, `/erp/cashbook/rows/:id/reverse`, `/erp/cashbook/transfer`, `/erp/cashbook/assign-bank`, `/erp/cashbook/review`, `/erp/cashbook/banks/:id` (in `worker/src/cashbook.ts`; bookings via `bookCash`) | `cashflow_entries`, `bank_accounts` gain columns; `cashbook_marks` (0147) |
| Weekly Sales (1.223.0) | Sales: Overview weekly scorecard, Set targets, Recovery plan; Tasks: linked sales tasks | `/sales/week`, `/sales/week/targets`, `/sales/week/settings`, `/sales/week/plan`, `/sales/week/plan/:id/review` (in `worker/src/weekly-sales.ts`); `POST /tasks` takes `link_kind`/`link_id` | `sales_week_targets`, `sales_week_results`, `sales_recovery_plans`; `tasks` gains `link_kind`, `link_id` (0149) |
| Commission (1.224.0) | Commission tab: Entries, Flow, Policy; Sales: commission card; Payroll: commission from the ledger | `/commission/summary`, `/commission/entries`, `/commission/entries/:id`, `/commission/flow`, `/commission/policy`, `/commission/policy/:id/approve`, `/reject`, `/preview`, `/commission/settings`, `/commission/ledger/:id/decide` (in `worker/src/commission.ts`); `invoice_payment` gates marking paid | `commission_policies`, `commission_ledger`, `commission_settings_log` (0150) |

The Desk (`worker/src/desk.ts`, a pure read) lists follow-ups, monthly invoices, people steps and
quotations to approve beside leave, claims, overtime and the rest. The guard
`tests/business-joins.mjs` holds every rule above, phase by phase; extend it when you extend a phase.

## Handing over

Report the files changed, the gate results, migrations the next `PUSH.bat` will apply, and anything
not done. Update `docs/PROJECT-STATE.md`, `CHANGELOG.md` (a new version entry written for the owner,
not for engineers), `package.json` version, and the module doc. Leave the tree so the next contributor,
human or AI, can read what happened without guessing.
