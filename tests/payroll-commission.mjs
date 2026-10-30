#!/usr/bin/env node
/* Guard - v1.215.0: PAYROLL 2.0, PHASE A. A PAID INVOICE IS VOUCHED FOR ONCE,
 * BY THE CEO TIER; THE PAYROLL TABLE SHOWS COMMISSION AND INVENTS NONE.
 *
 * The owner's "Payroll 2.0" brief (28-10-2026) and his answers to the audit
 * (claude/PAYROLL-COMMISSION-AUDIT.md): two phases, Phase A now; the CEO,
 * COO and super admin confirm a paid invoice; commission only when the
 * invoice is fully paid and confirmed; OT as a small line under Net plus the
 * row details. So this guard holds:
 *
 *   1. ONE LIVE CONFIRMATION per invoice (0145's partial unique index), a
 *      revocation is a stamp and a reason, never a delete.
 *   2. THE CONFIRMATION is the CEO, COO or super admin's, never on their own
 *      sale, on an invoice marked paid in full, for exactly its total, with
 *      the "I checked" tick, written conditionally (the invoice must still be
 *      paid at that total), audited. Taking it back needs a reason.
 *   3. IT FOLLOWS THE INVOICE: marked unpaid/overdue, or its total edited, and
 *      the confirmation is taken back automatically, with a trail.
 *   4. PAYROLL READS, NEVER WRITES: /payroll/commission-sources is a GET for
 *      the payroll processors, of live confirmations only, with no policy; it
 *      writes nothing into payroll (no automatic deduction, no amount).
 *   5. THE TABLE: no OT column and no commission box; the Sales Commission
 *      cell is read-only and says no policy is set; OT is still in Net, still
 *      on the payslip, shown under Net and edited in the row's details.
 *   6. THE SALES SCREEN offers Confirm/Take back only where the server says
 *      so (can_confirm_paid), and sends the invoice total with the tick.
 *
 * Negative-tested by: cco among the confirm roles (2); dropping the full-
 * paid check (2); dropping amount == total (2); a plain INSERT (2); no reason
 * on revoke (2); a DELETE of a confirmation (1); dropping the unpaid auto-
 * revoke (3); a commission-sources UPDATE (4); an OT column header (5); a
 * commission input (5); OT out of Net (5); the Confirm button without
 * canConfirm (6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const between = (s, a, b) => { const i = s.indexOf(a); return i < 0 ? "" : s.slice(i, b ? s.indexOf(b, i + a.length) : undefined); };

const mig = read("worker/migrations/0145_invoice_paid_confirmations.sql");
const idx = read("worker/src/index.ts");
const staff = read("worker/src/staff.ts");
const staffCode = strip(staff);
const pay = read("components/portal/payroll-panel.tsx");
const payCode = strip(pay);
const ws = read("components/portal/sales-workspace.tsx");
const wsCode = strip(ws);
const sales = strip(read("components/portal/sales.tsx"));

/* ---- 1. one live confirmation; revoked, never deleted ---- */
ok("0145 keeps one live confirmation per invoice",
   /CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_confirm_live\s+ON invoice_paid_confirmations \(invoice_id\) WHERE revoked_at IS NULL;/.test(mig)
   && /revoked_at TEXT,\s*revoked_by INTEGER,\s*revoke_reason TEXT/.test(mig) && !/DROP|DELETE|ALTER TABLE sales_documents/i.test(mig.replace(/^--.*$/gm, "")));
ok("...and is expected and probed by the worker", /"0145_invoice_paid_confirmations"/.test(idx) && /INDEXED BY idx_paid_confirm_live/.test(idx));
ok("a confirmation is never deleted", !/DELETE FROM invoice_paid_confirmations/i.test(staff));

/* ---- 2. the confirmation ---- */
{
  /* v1.227.0 - the owner, 30-10-2026: "Only CEO or COO may confirm an invoice as Paid" */
  ok("the CEO and COO confirm - nobody else (not even the super admin)", /const CONFIRM_PAID_ROLES = \["ceo", "coo"\];/.test(staffCode));
  const c = between(staffCode, "const confirmPaid = path.match(", "const confirmRevoke = path.match(");
  ok("the route is gated on those roles", /if \(!CONFIRM_PAID_ROLES\.includes\(user\.role\)\) return err\("forbidden"/.test(c));
  /* v1.216.2 - the owner: "CEO can self-confirm"; the COO and super admin still cannot */
  ok("only the CEO confirms their own sale", /const SELF_CONFIRM_ROLES = \["ceo"\];/.test(staffCode)
     && /const selfConfirm = inv\.salesperson_id === user\.id;\s*if \(selfConfirm && !SELF_CONFIRM_ROLES\.includes\(user\.role\)\) return err\("forbidden"/.test(c));
  ok("...and a self-confirmation is audited and shown as one", /self_confirmed: selfConfirm,/.test(c) && /r\.paid_confirmed_self = c\.confirmed_by === r\.salesperson_id;/.test(staffCode)
     && /can_confirm_own: SELF_CONFIRM_ROLES\.includes\(user\.role\)/.test(staffCode));
  ok("only an invoice marked paid in full", /if \(inv\.doc_type !== "INV"\)/.test(c) && /if \(inv\.payment_status !== "paid"\) \{/.test(c));
  ok("for exactly its total, with the tick", /if \(amount !== inv\.total_cents\) \{/.test(c) && /if \(body\?\.checked !== true\) return err/.test(c));
  ok("written only while the invoice is still paid at that total, once",
     /INSERT OR IGNORE INTO invoice_paid_confirmations[\s\S]{0,200}WHERE EXISTS \(SELECT 1 FROM sales_documents WHERE id = \?1 AND doc_type = 'INV' AND payment_status = 'paid' AND total_cents = \?2\)\s*RETURNING id/.test(c)
     && /if \(!row\) return err\("conflict"/.test(c));
  ok("audited", /await audit\(env, user\.id, "invoice\.paid_confirm", "sales_documents"/.test(c));
  const r = between(staffCode, "const confirmRevoke = path.match(", "/* ---- notifications ---- */");
  ok("taking it back: the same roles, a reason, a stamp, audited",
     /if \(!CONFIRM_PAID_ROLES\.includes\(user\.role\)\) return err\("forbidden"/.test(r) && /if \(reason\.length < 10\) return err\("invalid_input"/.test(r)
     && /UPDATE invoice_paid_confirmations SET revoked_at = datetime\('now'\), revoked_by = \?2, revoke_reason = \?3/.test(r)
     && /"invoice\.paid_confirm_revoke"[\s\S]{0,80}automatic: false/.test(r));
}

/* ---- 3. it follows the invoice ---- */
{
  const fn = between(staffCode, "async function revokePaidConfirmation(", "async function invoiceCloserLock(");
  ok("the automatic take-back stamps, audits and says it was automatic",
     /UPDATE invoice_paid_confirmations SET revoked_at = datetime\('now'\)/.test(fn) && /"invoice\.paid_confirm_revoke"[\s\S]{0,80}automatic: true/.test(fn));
  ok("an invoice marked unpaid or overdue loses its confirmation",
     /SET payment_status = \?1, payment_method = NULL, payment_ref = NULL, paid_at = NULL WHERE id = \?2`,\s*\)\.bind\(body!\.payment_status, id\)\.run\(\);\s*await revokePaidConfirmation\(env, Number\(id\), user\.id,/.test(staffCode));
  ok("an invoice whose total changed loses a confirmation for a different amount",
     /if \(docE\.doc_type === "INV"\) await revokePaidConfirmation\(env, Number\(idE\), user\.id, "Invoice total changed after the confirmation", totalE\);/.test(staffCode));
  ok("GET /docs says which invoices are confirmed and who may confirm",
     /r\.paid_confirmed_at = c\.confirmed_at; r\.paid_confirmed_by = c\.by_name;/.test(staffCode) && /can_confirm_paid: CONFIRM_PAID_ROLES\.includes\(user\.role\)/.test(staffCode));
}

/* ---- 4. payroll reads, never writes ---- */
{
  const src = between(staffCode, 'if (path === "/payroll/commission-sources" && method === "GET") {', 'if (path === "/payroll/pull-commission"');
  ok("commission-sources is the payroll processors' read of live confirmations",
     /if \(!PAYROLL_PROC\.includes\(user\.role\)\) return err\("forbidden"/.test(src) && /WHERE c\.revoked_at IS NULL AND strftime\('%Y-%m', c\.confirmed_at, '\+8 hours'\) = \?1/.test(src));
  /* v1.224.0 (the owner's Commission answers, 29-10-2026): it now also names
     the approved policy and what each invoice earned in the commission
     ledger, and - with the owner's payroll switch on - lets the ledger give
     the month its eligible rows (commission.ts commissionForPayroll). It
     still writes nothing into payroll: the payroll row's commission is
     written by Save and Recompute alone, from the server's sum. */
  ok("...and never writes a payroll row (no automatic deduction, no amount typed)",
     !/(UPDATE|INSERT INTO|DELETE FROM)\s+payroll_entries/i.test(src) && /commissionForPayroll\(env, mS, payrollMonthStaffSql\(mS, "u\."\), \{ include: null, released: await payslipsOut\(mS\) \}\)/.test(src)
     && /FROM commission_policies\s+WHERE status = 'active'/.test(src));
}

/* ---- 4b. v1.216.1 - the owner: commission "will start to effectively on 1st Nov payroll" ---- */
{
  const src = between(staffCode, 'if (path === "/payroll/commission-sources" && method === "GET") {', 'if (path === "/payroll/pull-commission"');
  ok("commission starts with the November 2026 payroll", /const COMMISSION_START_MONTH = "2026-11";/.test(staffCode));
  ok("...no month before it lists anything, and an invoice paid before 1 November never counts",
     /if \(mS < COMMISSION_START_MONTH\) return json\(\{ month: mS, policy: null, starts: COMMISSION_START_MONTH, rows: \[\] \}\);/.test(src)
     && /AND date\(COALESCE\(d\.paid_at, d\.created_at\), '\+8 hours'\) >= \?2/.test(src) && /\.bind\(mS, `\$\{COMMISSION_START_MONTH\}-01`\)/.test(src));
  ok("...and the payroll screen says so before it starts", /const beforeComm = commStarts !== null && month < commStarts;/.test(payCode) && /Starts with the \$\{startsLabel\} payroll/.test(pay));
}

/* ---- 5. the payroll table ---- */
{
  ok("no OT column: the column set is staff, basic, allowance, commission, deduction, net",
     /type PrCol = "rank" \| "staff" \| "basic" \| "allow" \| "comm" \| "deduct" \| "net";/.test(payCode) && !/\["ot", L\(/.test(payCode));
  ok("no commission box: the commission is never typed",
     !/setField\([^)]*"commission_cents"/.test(payCode) && !/value=\{[^}]*commission_cents/.test(payCode) && !/commission_cents:\s*[a-z]/i.test(between(payCode, "<SideDrawer", "</SideDrawer>")));
  const cell = between(payCode, "<span className={pp.commCell}>", "</td>");
  ok("the Sales Commission cell is read-only and says no policy is set",
     /<span className=\{pp\.commAmt\}>\{rm\(e\.commission_cents \|\| 0\)\}<\/span>/.test(cell) && /No policy yet/.test(cell) && !/<input/.test(cell) && !/\d\s*%|percent|rate/i.test(cell));
  ok("OT is still in Net and on the payslip",
     /\+ e\.allowance_cents \+ ot - e\.deduction_cents - ulDed - adj - advance\);/.test(payCode) && /if \(otCents > 0\) earnings\.push\(\[`OVERTIME/.test(payCode)
     && /ot_cents: otPay\(entry\(id\)\.basic_cents, entry\(id\)\.ot_hours\),/.test(payCode));
  ok("...said under Net, and its hours corrected in the row's details",
     /<span className=\{pp\.otLine\}/.test(payCode) && /setEntries\(\(m\) => \(\{ \.\.\.m, \[detailUser\.id\]: \{ \.\.\.e, ot_hours: h \} \}\)\);/.test(payCode));
  ok("the breakdown lists the confirmed invoices and what the ledger says each earned - calculated nowhere here",
     /commOf\(detailUser\.id\)\.map\(\(r\) => \(/.test(payCode) && /No commission policy is approved - nothing is calculated/.test(pay)
     && /typeof r\.commission_cents === "number" \? ` → \$\{rm\(r\.commission_cents\)\}` : ""/.test(payCode));
}

/* ---- 6. the sales screen ---- */
{
  ok("Confirm / Take back only where the server says so",
     /setCanConfirmPaid\(d\.data\?\.can_confirm_paid === true\);/.test(sales) && /canConfirm=\{canConfirmPaid\}/.test(sales)
     && /if \(!canConfirm \|\| d\.doc_type !== "INV" \|\| d\.payment_status !== "paid"\) return null;/.test(wsCode)
     && /\{canConfirm && <ConfirmPaid /.test(wsCode));
  ok("...on your own sale only where the server says you may (the CEO), marked Self-confirmed",
     /if \(d\.salesperson_id === userId && !canConfirmOwn\) return <span/.test(wsCode) && /setCanConfirmOwn\(d\.data\?\.can_confirm_own === true\);/.test(sales)
     && /if \(d\.paid_confirmed_self\) \{/.test(wsCode));
  ok("the confirmation sends the invoice total and the tick; taking back sends the reason",
     /body: JSON\.stringify\(\{ amount_cents: doc\.total_cents, checked: true, payment_ref:/.test(wsCode) && /confirm-paid\/revoke`, \{ method: "POST", body: JSON\.stringify\(\{ reason \}\) \}/.test(wsCode)
     && /const ready = revoke \? reason\.trim\(\)\.length >= 10 : checked;/.test(wsCode));
}

ok("the guard is registered", /\["payroll-commission", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
