#!/usr/bin/env node
/* Guard - v1.214.0: ONE VERIFIED SALE. ONE VERIFIED CLOSER.
 *
 * The owner's "A2Z OS - Sales Workspace 2.0" brief (27-10-2026) and his
 * answers to the audit (claude/SALES-WORKSPACE-AUDIT.md): the retired modules
 * stay retired and the workspace is built on the live records; the screen
 * first, the commission ledger after he sets a policy; the closer is locked
 * at the first recorded payment. So this guard holds:
 *
 *   1. THE LOCK. Edit refuses to move the salesperson of an invoice with any
 *      payment recorded (marked paid, or a part payment not voided), and the
 *      write itself is guarded so a payment landing in between still wins.
 *      Every salesperson change is audited from -> to.
 *   2. THE CORRECTION is the CEO tier's (commission_decide), on an invoice,
 *      with a reason of 10+ characters, conditional on the closer the
 *      reviewer saw, touching salesperson_id and nothing else, audited with
 *      the reason.
 *   3. THE WORKSPACE WRITES NOTHING ELSE and invents nothing: its only
 *      request is the correction; no commission figure, rate or percentage;
 *      no retired module's route; no sample data from the reference.
 *   4. ONE RULE FOR COLLECTED: an invoice marked paid, by paid_at in
 *      Malaysia time - the Paid tile's rule; part payments are not counted
 *      as collected.
 *   5. ONE PANEL: the tabs hide bodies, never unmount them; "Mine" is the
 *      salesperson (or the follow-up's owner); the form locks the field the
 *      server locks.
 *
 * Negative-tested by: dropping the lock check (1); dropping the write guard
 * (1); a correction gated on `sales` (2); a correction with no reason (2); a
 * commission % on the screen (3); an /erp/commission call (3); counting part
 * payments as collected (4); unmounting the documents body (5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const staff = read("worker/src/staff.ts");
const ws = read("components/portal/sales-workspace.tsx");
const wsCode = strip(ws);
const sales = read("components/portal/sales.tsx");
const salesCode = strip(sales);

/* ---- 1. the lock ---- */
{
  const fn = staff.slice(staff.indexOf("async function invoiceCloserLock("), staff.indexOf("/** Commission (sen) for a person's attributed"));
  ok("the lock is the first recorded payment: marked paid, or a part payment not voided",
     /paidRow\?\.ps === "paid" \|\| parts > 0/.test(fn) && /FROM invoice_payments WHERE invoice_id = \?1 AND voided_at IS NULL/.test(fn)
     && /AND COALESCE\(payment_status, ''\) != 'paid'/.test(fn) && /NOT EXISTS \(SELECT 1 FROM invoice_payments ip WHERE ip\.invoice_id = sales_documents\.id AND ip\.voided_at IS NULL\)/.test(fn));
  const edit = staff.slice(staff.indexOf("const docEdit = path.match("), staff.indexOf("const closerFix = path.match("));
  ok("Edit refuses to move a locked invoice's closer", /if \(docE\.doc_type === "INV"\) \{\s*const lock = await invoiceCloserLock\(env, Number\(idE\)\);\s*if \(lock\.locked\) \{\s*return err\("closer_locked"/.test(edit));
  ok("...and the write is guarded, so a payment landing in between still wins",
     /reference = \?10, delivery_address = \?11 WHERE id = \?9\$\{lockGuard\}`\)/.test(edit) && /if \(lockGuard && !ran\.meta\.changes\) \{\s*return err\("closer_locked"/.test(edit) && /UPDATE sales_documents SET \$\{baseSet\} WHERE id = \?9\$\{lockGuard\}/.test(edit));
  ok("every salesperson change is audited from -> to", /await audit\(env, user\.id, "doc\.closer_change", "sales_documents", idE, \{ doc_type: docE\.doc_type, from: closerFrom, to: spE \}\);/.test(edit));
}

/* ---- 2. the correction ---- */
{
  const fix = staff.slice(staff.indexOf("const closerFix = path.match("), staff.indexOf("/* ---- notifications ---- */"));
  ok("the CEO tier corrects, nobody else", /if \(!can\(user\.role, "commission_decide"\)\) return err\("forbidden"/.test(fix));
  ok("with a reason, on an invoice, to a current staff member", /if \(reason\.length < 10\) return err\("invalid_input"/.test(fix) && /if \(inv\.doc_type !== "INV"\)/.test(fix) && /\$\{currentStaffSql\(\)\}/.test(fix));
  ok("conditional on the closer the reviewer saw; salesperson_id and nothing else",
     /UPDATE sales_documents SET salesperson_id = \?1 WHERE id = \?2 AND doc_type = 'INV' AND COALESCE\(salesperson_id, 0\) = \?3/.test(fix)
     && (fix.match(/UPDATE sales_documents SET/g) ?? []).length === 1);
  ok("audited with the reason", /await audit\(env, user\.id, "doc\.closer_correct", "sales_documents", String\(docId\), \{\s*invoice: inv\.doc_number, from: cur, to: toId, reason, locked: lock\.locked,/.test(fix));
}

/* ---- 3. the workspace writes nothing else and invents nothing ---- */
{
  const calls = [...wsCode.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`/g)].map((m) => m[1]);
  /* v1.215.0 - and the CEO/COO paid confirmation and its take-back (tests/payroll-commission.mjs) */
  ok("its requests are the closer correction and the paid confirmation", JSON.stringify(calls) === JSON.stringify(["/staff/docs/${doc.id}/closer", "/staff/docs/${doc.id}/confirm-paid/revoke", "/staff/docs/${doc.id}/confirm-paid"]) && !/fetch\(|csrfFetch/.test(wsCode), calls.join(","));
  ok("no commission figure, rate or percentage on the screen (no policy is set)", !/commission_cents|rate_bp|base_pct|bonus_pct|\d+(\.\d+)?\s*%|percent/i.test(wsCode));
  ok("no retired module is called", !/\/enquiries|\/erp\/commission|\/commission|\/sales-performance|\/leaderboard|\/prospects/.test(wsCode + salesCode));
  ok("no sample data from the reference", !/Kedai Rasa|ABC Trading|Creative Express|Siti Enterprise|QT-DEMO|INV-DEMO|Consultant AF|31\.80|RM 6,500|RM 10,000/.test(ws + sales));
  ok("the correction is offered to the CEO tier only", /canFix=\{\["ceo", "super_admin"\]\.includes\(user\.role\)\}/.test(salesCode));
}

/* ---- 4. one rule for collected ---- */
{
  const trend = wsCode.slice(wsCode.indexOf("function CollectedTrend("), wsCode.indexOf("function QuoteFunnel("));
  ok("collected is an invoice marked paid, by paid_at in Malaysia time",
     /if \(d\.doc_type !== "INV" \|\| d\.payment_status !== "paid"\) continue;\s*const day = ymd\(d\.paid_at \?\? d\.created_at\);/.test(trend) && /const ymd = \(ts\?: string \| null\) => \(ts \? mytDateOf\(ts\) : ""\);/.test(wsCode) && !/partPaid/.test(trend));
  ok("...the Paid tile's own rule", /const paidThisMonth = sDocs\.filter\(\(d\) => d\.doc_type === "INV" && d\.payment_status === "paid"\s*&& mytYm\(d\.paid_at \?\? d\.created_at\) === monthKey\);/.test(salesCode));
  ok("the lock on screen is the server's lock", /d\.doc_type === "INV" && \(d\.payment_status === "paid" \|\| \(partPaid\[d\.id\] \?\? 0\) > 0\)/.test(wsCode));
}

/* ---- 5. one panel ---- */
{
  ok("the workspace tabs are the shared underline tabs", /<LineTabs value=\{wsView\} onChange=\{\(k\) => setWsView\(k\)\} label=\{L\("Sales", "Jualan"\)\}/.test(salesCode));
  ok("bodies are hidden, never unmounted (a half-written quotation survives)",
     /<section id="sales-work" className="[^"]*" hidden=\{wsView !== "documents"\}>/.test(salesCode) && /<section id="sales-customers" className="[^"]*" hidden=\{wsView !== "customers"\}>/.test(salesCode));
  ok("\"Mine\" is the salesperson, or the follow-up's owner; management opens on everyone",
     /const sDocs = scope === "mine" \? docs\.filter\(\(d\) => d\.salesperson_id === user\.id\) : docs;/.test(salesCode)
     && /const sFollowups = scope === "mine" \? crm\.followups\.filter\(\(f\) => f\.owner_id === user\.id\) : crm\.followups;/.test(salesCode)
     && /useState<WsScope>\(MANAGE_ROLES\.includes\(user\.role\) \? "all" : "mine"\)/.test(salesCode));
  ok("the form locks the field the server locks", /disabled=\{editCloserLocked\}/.test(salesCode) && /return !!e && closerLocked\(e, partPaid\);/.test(salesCode));
  ok("a search hit still opens its record", /setWsView\("documents"\);\s*setWorkTab\("documents"\);/.test(salesCode) && /setWsView\("customers"\);\s*setCustTab\("clients"\)/.test(salesCode));
}

/* ---- v1.214.1: the figure fits its tile (the owner: "why the figure
   overflow from the card") - one rule in the shared tile, for every page ---- */
{
  const kt = read("components/ui/kpi-tile.module.css");
  const value = kt.slice(kt.indexOf(".value {"), kt.indexOf("}", kt.indexOf(".value {")));
  ok("the tile is a size container and the figure scales with it, never clipped and never forced onto one line",
     /\.tile \{\s*container-type: inline-size;/.test(kt) && /font-size: clamp\(1\.125rem, 9cqi, var\(--type-kpi-lg-size\)\);/.test(value)
     && !/white-space: nowrap/.test(value) && /overflow-wrap: anywhere;/.test(value)
     && /@container \(max-width: 18rem\) \{[\s\S]{0,300}?\.body \{\s*grid-column: 1 \/ -1;[\s\S]{0,200}?12\.5cqi/.test(kt));
  ok("no page pins the tile figure to a fixed size again",
     !/span:nth-child\(2\) > span:first-child \{[^}]*font-size/.test(read("components/portal/sales-docs.module.css") + read("components/portal/ecommerce-panel.module.css")));
}

ok("the guard is registered", /\["sales-workspace", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
