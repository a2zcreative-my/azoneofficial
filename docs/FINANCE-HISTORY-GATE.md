# Finance Historical Recovery & Reconciliation — implementation gate (18-11-2026)

Answers the CEO's brief "A2Z OS — Finance Historical Recovery & Reconciliation" (sections 1–7). Nothing has been implemented: no production record, commission record, schema or deployed code was changed. Companion: `docs/FINANCE-HISTORY-AUDIT.md` (the first audit).

Evidence added (not registered in PUSH, so it changes nothing yet):
- `tests/finance-history.mjs` — the real worker against SQLite with every migration, fixtures only. **20/20 pass.**
- `docs/finance-history-queries.sql` — the read-only reconciliation queries.

---

## 1. Actual historical numbers — NOT YET RETRIEVED

The production database could not be read from here: the session has no Cloudflare credentials, and the built-in browser is not signed in to the portal. No figure is estimated or invented.

The report needs one of two things:

- **Option A (5 minutes, no sign-in for me).** Cloudflare dashboard → Storage & databases → D1 → `azoneofficial` → Console. Paste each query Q1–Q7 from `docs/finance-history-queries.sql` and send me the result tables (copy or screenshot). All seven are `SELECT` only.
- **Option B.** Sign in to the portal in the built-in browser pane on your PC (the Claude desktop app). I will then read `GET /api/v1/staff/erp/cashbook?company=all&from=2026-06-01&to=2026-11-18&months=12` — the same read Finance makes, read only — and build the report.

Each query, and the section 5 line it fills:

| Query | Measures | Report line |
|---|---|---|
| Q1 | invoices issued, invoiced amount and outstanding balance, by issue month and company (void excluded) | Total invoices issued · invoice amounts · outstanding balances |
| Q2 | receipts by the month PAID and company: verified vs awaiting (whole-invoice balance + part payments, never both for the same sen) | Confirmed receipts · awaiting verification · receipt side of Money In |
| Q3 | cash-book movements by month, kind and company (UNASSIGNED shown apart), excluding invoice rows, transfers and reversed pairs | Money Out · other money in · unassigned transactions · movements missing a bank account |
| Q4 | transfers between our own accounts | Transfers (outside Money In / Out) |
| Q5 | invoice rows still in the cash book (Finance reads the invoices instead) | Not counted twice |
| Q6 | same day + direction + amount more than once | Duplicate risks |
| Q7 | paid invoices with no payment reference | Missing supporting evidence |

What the report will contain once the data is back (June → 18 November; A2Z / AZ ONE / Unassigned):
- invoices issued (count, RM) and outstanding balance;
- confirmed receipts, awaiting verification, Money In;
- Money Out by kind;
- refunds (credit notes), agent payouts, transfers;
- unassigned movements and movements with no account;
- duplicate risks;
- what today's Finance view leaves out (awaiting receipts and unassigned rows) — every sen in exactly one line.

Known limits of the queries, stated, not hidden:
- Q2 takes a receipt's company from its invoice issuer. Finance also lets a bank-account mark override it — rare, and Q3 shows the marks.
- Q3 dates a row by its own effective date or booking day. Finance can also read a claim's or expense's own paid day when the row has none; the month can differ for a row booked late.
- Loans (staff loans or advances) have no distinct reference in the cash book today. They appear as `manual: <category>` or `claims`, and are reported under that label.

## 2. Root causes — CONFIRMED by test (finance-history.mjs, R1–R4)

| | Cause | Proven by |
|---|---|---|
| R1 | Money In and the Cash Trend count only CEO-verified receipts. Paid Jun–Oct receipts were never confirmed, so their months draw RM 0. | "September and October draw RM 0 … while unverified"; "September's receipt is there, as awaiting verification, not Money In" |
| R2 | Needs Attention and the awaiting figure look only at the selected period. | "this month's Needs Attention does not list the older unverified receipts" |
| R3 | Cash-book rows without a company count only under "all"; their "which account?" warning is hidden in both company views. | "a payroll row with no company counts only under 'all' - RM 0 out in both company views" |
| R4 | No issuer (before 19-08-2026) = AZ ONE OFFICIAL — correct, must stay. | "an invoice with no issuer belongs to AZ ONE OFFICIAL, never A2Z" |

Also proven:
- After verification, a receipt lands in the month it was **paid**, never the month it was verified.
- This month's Money In does not absorb the old receipts.

## 3. Commission safety proof

**Every path that can write commission.** Only two tables hold commission: `commission_ledger` and `commission_attributions`. Every write to them is in `worker/src/commission.ts`:
- `ensureLedger`, steps 1–3: earn, take-back, credit note;
- `writeClassified`: direct or agent partnership, called only from `ensureLedger`;
- the decide/settle routes, which act on rows that already exist.

`ensureLedger` is called from:
- Confirm paid (`staff.ts /docs/:id/confirm-paid`) and its take-back;
- payment verification when the last part is verified (`payment-verify.ts`, two places);
- mark-paid / credit note (`staff.ts`);
- the commission screens and payroll reads (`commission.ts`).

**The one gate.** Step 1 (the only step that creates an entitlement) selects confirmations with:

```
WHERE c.revoked_at IS NULL AND date(COALESCE(d.paid_at, d.created_at), '+8 hours') >= COMMISSION_START_DAY ('2026-11-01')
  AND NOT EXISTS (… commission_ledger l WHERE l.confirmation_id = c.id AND l.kind = 'earn')
```

So a receipt paid before 01-11-2026 is never selected, whichever path confirms it. Agent partnership (7% / 3%) is classified inside the same loop, after this filter, so it is gated the same way. Steps 2 and 3 act only on earn rows that already exist.

Proven by test, with a live 10% policy from 01-11:
- **Control:** a November receipt verified → its 10% is written (the engine works in the test).
- Three receipts paid June, September and October, verified by the CEO → **no commission row** (ledger or attribution). The existing ledger is **byte-for-byte unchanged**.
- A second verification → refused (409); nothing written; one confirmation row.
- Verification never changes `paid_at`.

**One difference from your section 4 rule — needs your decision.**
- Your brief says *sales and invoices originating before 1 November stay ineligible, even if paid later*.
- The approved rule (v1.216.1, "only invoices paid from 1 Nov 2026"; guard `commission-flow` test B) gates on the **paid day**, not the invoice date.
- The test proves the gap: an invoice **created 28-10, paid 05-11 earns 10% today**.
- Changing that is a commission-rule change. I have not touched it.
- Options:
  - (i) keep the paid-day rule;
  - (ii) add "and the invoice was created on/after 01-11-2026" to the same gate. One condition; `commission-flow` test B would be updated; no stored row changes.

**Separation for the historical work (recommended).** Do NOT use Confirm paid for history at all:
- A historical receipt (paid before 01-11-2026) is verified as **cash only**: a Finance mark on the item, never `invoice_paid_confirmations`, the table commission reads.
- Commission cannot see the mark at all, so history is protected even if the gate is ever changed.
- Confirm paid stays the act for receipts from 01-11.
- An item that has both is counted once.

## 4. Proposed implementation sequence (each step its own release, each approved)

| Step | What | Data | Commission |
|---|---|---|---|
| H1 | **Visibility only.** Cash Trend draws "awaiting verification" beside verified (never added). The Needs Attention strip shows "n older" from all periods. A banner points to History. | read only | none |
| H2 | **History view** in Finance → Reconciliation (a view inside the tab, not a new tab): the queue of receipts from 01-06-2026, grouped by month paid / company / status, with filters (month, company, status, account, kind) and 10 a page. Review drawer: invoice total, parts received, this receipt, paid day, reference, evidence. | read only | none |
| H3 | **Historical cash verification.** One receipt at a time, CEO owner only, fresh authenticator code, "I checked the bank" tick. Writes a Finance mark (additive columns on `cashbook_marks`: `cash_verified_at/by/note`). Refused for receipts paid on/after 01-11 (those use Confirm paid) and for a receipt already verified either way. Audited. Undo = take-back with reason (audited, mark kept with `revoked_at`). Partial payments are verified per part; the invoice balance counts only once it is paid. | 1 additive migration | provably none (commission never reads the mark) |
| H4 | **Unassigned queue**, reachable from BOTH company views; kept out of both company totals. Assign uses the existing "assign account" (`cashbook_correct`, mark + reason, audited). The company comes only from the account's company — never guessed. | existing marks | none |
| H5 | **Reports:** the monthly reconciliation (section 5) as a Finance report with CSV, from the same read. | read only | none |
| (H6) | Only if you choose (ii) in section 3: the commission gate on the invoice date. | none | rule change — separate approval |

No bulk verification anywhere (your section 1).

## 5. Proposed UI — wireframes (layout only; dots are placeholders, no real figures)

Existing visual system: white cards, navy type, gold active tab, one connected KPI strip, filters in one toolbar, 10-row pages, drawers for detail.

- `finance-wireframe-1.png` — **Overview**: the strip gains *Awaiting verification* and *Needs Attention n · n older*; a one-line banner for earlier periods; the trend with a striped "awaiting" part (never added).
- `finance-wireframe-2.png` — **Reconciliation → History**: strip, filter toolbar, the queue table, the Verify drawer showing "Commission: not eligible — paid before 01-11-2026".
- `finance-wireframe-3.png` — **Reconciliation → Unassigned**: movements with no company and the Assign account action.
- `finance-wireframe-4.png` — **PWA 390px**: the same History view as compact rows with a Filters button.

## 6. Data migration and rollback safeguards

- **H1, H2, H4, H5:** no migration and no data change — they read what exists. Rollback = redeploy the previous version.
- **H3:** one **additive** migration (new nullable columns on `cashbook_marks`, no rewrite of a row), applied through PUSH.bat after its pre-migration backup (`release-backup.mjs export`). The code checks the columns exist before using them, so code without the migration keeps today's behaviour. Rollback: the previous code ignores the columns; marks stay as harmless history. No existing migration is edited.
- **Never touched:** `sales_documents` dates and amounts, `invoice_payments`, `invoice_paid_confirmations`, `commission_*`, `cashflow_entries` rows (a correction is always a mark or a reversal row, never an edit).
- Before H3 goes live: a live run of the section 1 queries, and a dry-run report of what Money In becomes month by month if every awaiting receipt were verified, for you to compare against bank statements.

## 7. Tests (to be extended with each step)

Today, `tests/finance-history.mjs` proves on the current code:
- old invoices keep their dates and AZ ONE ownership;
- unassigned rows stay out of company totals;
- verification is single, never re-dates, and writes no commission for history.

Each step adds:
- **H1:** awaiting never enters `in_cents`; the "older" count covers every period; company views never show another company's item.
- **H3:** a mark verifies a receipt once; a second is refused; the mark adds **no** row to `invoice_paid_confirmations` or `commission_*` (mutation: pointing it at confirmations must fail the test); a receipt paid on/after 01-11 is refused; take-back restores the awaiting state; part payments count once and the invoice balance never double-counts a part.
- **H4:** assignment changes the company only through an account with a company; a row is never rewritten; the audit carries the reason.
- **All:** `commission-flow`, `commission-ledger`, `payment-verify`, `cashflow` stay green; browser checks for the History and Unassigned views at 1440 / 1024 / 390 px, no sideways scroll.

## Decisions waiting for you

1. Section 1: Option A (paste the query results) or B (sign in to the browser pane).
2. Section 3: keep the paid-day commission rule (i), or add the invoice-date condition (ii).
3. Section 3/4: approve the separate cash-only historical verification (recommended), or use Confirm paid for history.
4. Section 4: approve H1 → H5 in that order.
