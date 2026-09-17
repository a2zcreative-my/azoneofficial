# Company Reconciliation Workspace

Updated: 17 September 2026
Status: implemented locally, not deployed. Migration 0134 is not applied to production.

## Scope

This is the reconciliation foundation for AZ ONE OFFICIAL (`azoo`) and A2Z CREATIVE
MARKETING (`a2z`), not an activated multi-company access boundary.

The Companies tab is after Accounting, without changing the first four mobile tabs.
CEO and super-admin can read and write the workspace. Other roles cannot access its
API, even if somebody grants them the tab through existing navigation overrides.

## Ownership Review

- Nine registers: expenses, purchase orders, bank accounts, cash-flow entries,
  reconciliations, inventory items, manual stock movements, stock ledger and journals.
- All existing records start unassigned. Opening the queue does not create decisions.
  No vendor, SKU, staff role, company default or historical document issuer is used to
  infer the owner of an operational record.
- Management can propose a company or defer a decision. A reason, current source
  snapshot, explicit confirmation and current review revision are required.
- Proposals are reconciliation metadata in `company_review_decisions`, not company
  ownership on the operational tables. They do not move money, stock or liabilities,
  filter existing reports, modify issued documents, or grant access.
- A changed source is marked Changed since review. Stale writes fail, including a
  change between the API read and the database write. Re-review keeps earlier events.
- Source register links open the existing module; record IDs and source details are
  shown in the review pane. Links do not pretend to select a record in a module that
  does not support record-level deep linking.
- Stored bank/item IDs and PO item IDs show related records. Related proposals are
  evidence only, may conflict, and never cascade. Large related lists explicitly
  indicate truncation. Free-text references are not authoritative relationships.
- Queue pagination is 25 records. Previously reviewed includes deferred and changed
  proposals. Review history shows the latest 30 events; the database retains all.

## Staff Setup

- Employee employer and company memberships are separate. Selecting an employer does
  not grant membership. Either employer may be unset; membership may cover neither,
  one or both companies, with planned read-only or read/write access.
- Customers are excluded. Inactive staff remain visible so planned access can be
  removed. Changes require a reason and revision check.
- `company_staff_setup` and `company_memberships` are rollout preparation. Existing
  job roles, payroll employer stamps and API authorization are not changed by them.
  The screen explicitly reports that company access restrictions are not active.

## Integrity

- One D1 batch saves the event, current decision/setup and ordinary audit-log link.
  An audit failure rolls back all of them. The transactional source/revision assertion
  rejects concurrent changes instead of reporting a successful partial save.
- Request IDs make retries idempotent. Reusing an ID with a different actor or payload
  fails. Review events retain before/after data and source snapshots and have database
  triggers rejecting updates/deletes. Database administrators remain privileged;
  this is an application audit trail, not a cryptographic signature.
- Writes are online-only, not placed in the attendance offline outbox. Network errors
  keep the current form. Missing migration or denied access is an error, not an empty
  queue. Reads are uncached and aborted when the selected register/person changes.

## Remaining Before Company Isolation

1. Reconcile management proposals against original evidence and balances. Decide
   shared SKU/client-owned stock handling and explicitly resolve related conflicts.
2. Add stable links where existing accounting references or goods-receipt remarks are
   only text. Never infer financial ownership from a coincidentally matching string.
3. Add operational ownership and promote a reconciled dependency group atomically,
   with totals before/after. Stale, conflicting and deferred proposals must not post.
4. Apply membership plus existing action permissions to every read, write, export,
   file, integration, cache and report. Add scoped selectors and consolidated views.
5. Pilot with management and test guessed IDs, cross-company exports, account switches,
   original document rendering and stock/bank totals before enabling enforcement.
6. Implement revision-bound e-signature consent after the ownership boundary is ready.

Do not use saved proposals or memberships as proof that the current system isolates
company data. No company is automatically assigned in production by this change.

## Verification

- All 83 browser-free regression guards passed, including the new company-review
  API tests and existing attendance, authorization, schema, icon and navigation gates.
- Isolated SQLite/API tests cover all nine registers, unauthorized readers/writers,
  malformed input, missing migration, no inferred ownership, unchanged operational
  balances, immutable history, retries, stale source/review versions, write-time races,
  audit-failure rollback and independent employer/membership setup.
- Twelve mocked browser scenarios passed at 360, 390, 768 and 1440px: propose/defer,
  staff setup, stale-write preservation and missing-migration errors. No horizontal
  overflow or browser runtime errors. Screenshots inspected at mobile and desktop.
- Frontend TypeScript passed. Worker strict checking reports the same 38 pre-existing
  diagnostics, none in the new company-review module.
- Production build passed with existing unrelated lint warnings. No deployment was run.
- Existing installed PWA/native WebView acceptance and production reconciliation are
  still required. Mocked browser tests are not evidence of native device behavior.

Deployment is a separate approved operation through PUSH.bat. Nothing here has been
published, and no production employee or business record was changed.
