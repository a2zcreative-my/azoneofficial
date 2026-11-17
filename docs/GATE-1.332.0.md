# GATE 1.332.0 — The Payment & No Refund Policy on every invoice and quotation of both companies

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Document text only. No amount, status, calculation or route changes.
**Sits on:** 1.331.0, which is on the PC and not deployed.

**Authority:** the CEO, 17-11-2026:
- *"Include the approved Payment & No Refund Policy in both invoice templates. Place the policy above the Payment & Signature section ... Ensure the policy appears in invoice previews, PDF downloads, printed documents and shared invoices ... Apply the same policy to the relevant quotation acceptance terms before payment ... Reuse existing invoice templates and styling. No new designs. Do not modify invoice amounts, payment statuses, calculations or existing business logic."*
- *"Both companies must use the same approved policy wording while maintaining their separate company identities. Verify both invoice templates and PDF output. Do not deploy without approval."*

## The wording (one constant, both companies)

> **PAYMENT & NO REFUND POLICY**
> Upon receipt and confirmation of payment, the Company will commence or continue the agreed services according to the approved project scope and timeline.
> All payments are non-refundable once work has commenced, except where required by applicable law. Any changes to the agreed scope or timeline must be mutually agreed upon in writing.

The wording lives in `PAYMENT_POLICY` (lib/doc-template.ts).

The rest of each document stays its own company's, from `resolveIssuer`, exactly as before:
- the letterhead;
- the SSM registration;
- the bank account;
- the signatures;
- the footer.

## Where it appears

| Output | How | Invoice | Quotation | Delivery order |
|---|---|---|---|---|
| Staff preview and print | lib/doc-template.ts | above **PAYMENT** | above **COMMITMENT ORDER CONFIRMATION** | none |
| Customer's shared link | the same template, in /doc | above PAYMENT | above COMMITMENT ORDER CONFIRMATION | none |
| PDF download / send | lib/doc-pdf.ts (the second renderer) | above PAYMENT | above COMMITMENT ORDER CONFIRMATION | none |
| Online quotation acceptance | components/public/doc-accept.tsx | — | above the tick box; the box names the policy | — |

The quotation's acceptance clause now ends "... subject to the terms above, including the Payment & No Refund Policy."

The block is compact: 14mm printed, in the address panels' tint with their gold rule, small type.

To keep every document on one page, the editor's page budget reserves 18mm for it on quotations and invoices. That is the larger of the printed and PDF heights. A quotation or invoice therefore holds about two fewer plain item lines than before, or prints its table in the denser style.

## Verified (in the sandbox)

Each company's invoice, quotation and delivery order was rendered:
- once with three items;
- once filled to the page budget.

Each was output both as the printed page (Chromium, A4) and as the PDF.

| Check | Result |
|---|---|
| Page count, all 12 documents, print and PDF | **1 page each** |
| Policy present | on all 8 invoices and quotations, both outputs; on no delivery order |
| Position | above PAYMENT / COMMITMENT ORDER CONFIRMATION in both outputs |
| Company identity | A2Z CREATIVE MARKETING (SSM 202603003468, MAYBANK 5511 0086 5300); AZ ONE OFFICIAL (SSM 202603168673, MAYBANK 5516 2328 7032) - each on its own paper only |
| All guards (`node scripts/run-guards.mjs`) | **212 / 212 pass** |
| `tests/payment-policy.mjs` (new) | 13 checks, 9 mutations caught |
| `tests/browser/payment-policy.py` (new: the customer's shared link, both companies, invoice and quotation, the online acceptance, one printed page) | **27 / 27** |
| Lint | 0 errors, 115 warnings (limit 125) |

**Observation, not changed:** the A2Z CREATIVE MARKETING letterhead's email line reads admin@azoneofficial.com (lib/issuers.ts). Say if it should be an a2zcreative address.

## Files

**New:**
- tests/payment-policy.mjs
- tests/browser/payment-policy.py
- docs/GATE-1.332.0.md

**Changed:**
- lib/doc-template.ts
- lib/doc-pdf.ts
- components/public/doc-accept.tsx
- components/public/doc-accept.module.css
- tests/browser/fixture.mjs (four shared documents)
- scripts/run-guards.mjs
- CHANGELOG.md
- CLAUDE.md
- AGENTS.md
- package.json (1.332.0)

## Deployment

Nothing reached production. Run `PUSH.bat` when you choose. There is no migration.
