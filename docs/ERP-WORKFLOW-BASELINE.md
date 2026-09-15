# ERP Workflow Baseline

**Reviewed:** 15 September 2026  
**Source baseline:** v1.162.1  
**Phase:** 0 - source mapping in progress

This file records what the current source proves before broader ERP changes begin.
It is not yet a team-approved SOP. Production data, timings, and real user behavior
still require walkthroughs with HR, Finance, Operations, and the CEO.

## Reading the status

- **Source verified:** routes, schema, or UI supporting the statement were found.
- **Needs walkthrough:** the source shows a flow, but the team's actual handoff,
  timing, or exception handling is not confirmed.
- **Confirmed gap:** the needed behavior was not found in the reviewed source paths.
- **Implemented, pending release:** changed in source and checked locally, but not yet
  confirmed in production or accepted by users.

## Company model

| Area | Current evidence | Status | Required decision or action |
|---|---|---|---|
| Legal issuers | `lib/issuers.ts` defines `a2z` and `azoo` identities | Source verified | Keep this registry as the identity source. |
| Issued documents | Migration 0073 adds `issuer_code` to sales documents, receipts, credit notes, claims, leave requests, and payslip releases | Source verified | Preserve a document's issuer permanently. Reject unknown issuer values on new writes. |
| Signature assets | Migration 0118 keys immutable signature versions by issuer and role; admin UI manages both companies | Source verified | Extend this vault with signing events; do not create another signature store. |
| User company membership | No employer/company membership column or relation was found on `users` | Confirmed gap | Decide whether each user belongs to A2Z, AZ ONE, or both, separately from their role. |
| Operational ownership | No issuer/company ownership field was found on customers, suppliers, inventory items, purchase orders, or reconciliations | Confirmed gap | Decide which records are shared and which balances/transactions belong to one company. |
| Authorization | `worker/src/permissions.ts` grants module actions by role | Source verified, incomplete for two companies | Add server-side company scope after the membership decision. UI filtering alone is insufficient. |
| Reporting | Document renderers retain issuer; combined operational reporting was not proven to isolate entities | Needs walkthrough | Define separate company reports and explicitly labeled consolidated management views. |

`company` on customer/contact records is a customer's business name. It must not be
reused as the internal owner of the record.

## Current workflow map

| Workflow | Current source path | Existing handoff | Company behavior | Phase 0 question |
|---|---|---|---|---|
| Claims | `worker/src/staff.ts`, `worker/src/desk.ts`, claim UI in `components/portal/role-panels.tsx` | Staff chains through HR review, pre-approval, CEO decision, then payment/proof | Claim carries `issuer_code`; signatures resolve by issuer, role, and approval time | Who checks evidence, who signs, and when Finance accepts it for payment? |
| Leave | `worker/src/leave-chain.ts`, `worker/src/staff.ts`, `components/portal/leave.tsx` | Applied, HR reviewed, pre-approved, final decision | Leave row carries `issuer_code`; printed form follows it | Which exceptions may skip a stage, and who handles returned/incorrect applications? |
| Payroll | payroll routes in `worker/src/staff.ts`, `components/portal/payroll-panel.tsx` | Payroll prepared, reviewed, released, paid/exported | Employer is stamped on `payslip_releases` | Who verifies attendance/deductions before release, and does one run ever include both employers? |
| Sales documents | sales routes in `worker/src/staff.ts`, `components/portal/sales.tsx` | Quotation, delivery order/invoice, payment, receipt/credit records | Issuer selected at creation and retained; A2Z is current default | Which users may issue for AZ ONE, and what prevents the wrong bank/entity selection? |
| Purchasing | `worker/src/erp.ts` and purchasing UI | Supplier and purchase order through goods receipt | No internal company owner found | Are suppliers shared? Which company owns each PO, liability, stock receipt, and payment? |
| Inventory | inventory routes in `worker/src/staff.ts`, bridge routes, inventory UI | Manual edits/adjustments, sales deductions, receipts, ELFIA movements | No internal company owner found; ELFIA integration shares the same inventory register | Is stock legally owned by A2Z, AZ ONE, or held by client/brand? Can one SKU have more than one owner? |
| Reconciliation | `worker/src/erp.ts` | Pull/import, compare, reconcile or dispute | No internal company owner found | Which bank/channel/entity is reconciled, and how are cross-company payments blocked? |
| Daily queue | `worker/src/desk.ts`, `components/portal/one-desk.tsx` | One Desk reads actionable work from leave, claims, OT, punches, commissions, tasks, enquiries, and announcements | Queue follows role permissions; no company scope exists yet | Which additional payment, purchasing, stock, and release exceptions belong on the desk? |

## First implementation slice

**ERP-08 - inventory and queue truthfulness**

- Inventory overview and item details now use the existing cache/live-version system.
  A successful inventory write causes both the count and expanded detail to refresh.
- A failed first load shows a bilingual retry action instead of an endless skeleton.
- One Desk shows a bilingual retryable error when it has no usable response. It does
  not display "Nothing is waiting on you" after a failed request.
- Local TypeScript check passed. Production deployment and user acceptance remain.

## Walkthrough script

Run each scenario with the employee who starts it and the people who check, sign,
release, or pay it. Record start/end time, repeated data entry, messages outside the
system, unclear ownership, and recovery from a failed step.

1. Submit, return, correct, approve, pay, and retrieve one claim under A2Z.
2. Repeat the claim with an authorized AZ ONE case and verify every issuer/signature.
3. Submit leave through the normal chain and one real exception case.
4. Prepare one payroll month from attendance through release and bank export.
5. Convert a quotation to an invoice, record payment, issue a receipt, and reconcile it.
6. Create a purchase order, receive part/all goods, and verify stock and accounting.
7. Apply one manual stock adjustment and one ELFIA movement; compare all visible counts.
8. Repeat a save after a simulated timeout and confirm that money/stock changes once.

## Exit criteria for Phase 0

- HR, Finance, Operations, and CEO approve their workflow maps.
- Each step has one accountable owner, an allowed role/company scope, and a next state.
- Shared and company-owned records are decided for users, customers, suppliers,
  inventory, purchasing, bank accounts, claims, and reporting.
- Baseline timings and the three most expensive team frustrations are recorded.
- Phase 1 schema and API changes can be designed without guessing company ownership.

