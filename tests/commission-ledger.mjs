/* SALES COMMISSION (v1.224.0) - runtime guard: the real worker (staff.ts,
 * bundled) against SQLite with EVERY migration applied.
 *
 * The owner's Commission brief and answers, 29-10-2026
 * (claude/COMMISSION-AUDIT.md): 10% of the sale after discounts, excluding
 * SST and delivery; LIVE packages and every paid monthly renewal the same;
 * the Commission tab back; only the CEO, COO and admins mark invoices paid;
 * the recommended defaults approved (refunds to review, never deducted from
 * wages; the paid day picks the policy; month-end cutoff with carry-forward;
 * the CEO approves the policy; shadow ledger first, payroll by a switch).
 *
 * The brief's eight cases, deterministic fixtures, no production data:
 *   A paid RM 1,200 at 10%                  -> RM 120.00 eligible, policy v1
 *   B unpaid RM 249                         -> estimate RM 24.90, eligible 0
 *   C part-paid RM 399                      -> estimate RM 39.90, never payroll
 *   D the CCO confirms Paid by API          -> 403 (and cannot mark paid)
 *   E a missed weekly KPI                   -> commission still eligible
 *   F a new rate from a later date          -> old entries keep v1
 *   G the same event twice, Save/Recompute  -> one entitlement, one month
 *   H a refund (credit note) after payout   -> review, nothing deducted
 * plus: the basis excludes SST; no closer -> review; October money never
 * earns; the policy is drafted by the CEO/COO/super admin and approved only
 * by the CEO/super admin, never back-dated; payroll ignores the screen's
 * commission figure; a released month is never written; a consultant reads
 * only their own commission.
 *
 * Negative-tested by: counting SST in the basis; dropping the UNIQUE
 * source_key (0150); letting the CCO approve; dropping
 * the payroll_month IS NULL condition; storing the screen's commission;
 * applying a reversal of paid commission; letting a back-dated policy in;
 * cco back in invoice_payment.
 *
 *   node tests/commission-ledger.mjs
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let passed = 0, failed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- source ---- */
const mig = read("worker/migrations/0150_commission_ledger.sql");
ok("0150 only adds tables and indexes", !/\b(UPDATE|DELETE|DROP|INSERT|ALTER)\b/i.test(mig.replace(/^--.*$/gm, "")));
ok("0150 is registered and probed", /"0150_commission_ledger",/.test(read("worker/src/index.ts")) && /\["0150 \(commission/.test(read("worker/src/index.ts")));
ok("one entitlement per event: source_key is UNIQUE", /source_key TEXT NOT NULL UNIQUE/.test(mig));
const cm = read("worker/src/commission.ts");
ok("the engine never writes a payroll row - payroll reads it", !/(UPDATE|INSERT INTO)\s+payroll_entries/.test(cm));
ok("the weekly KPI never touches commission", !/from "\.\/commission"|commission_ledger|commission_policies|(INSERT INTO|UPDATE)\s+invoice_paid_confirmations/.test(read("worker/src/weekly-sales.ts")));
const staffSrc = read("worker/src/staff.ts");
ok("payroll Save never stores the screen's commission", !/cents\(body\.commission_cents\),/.test(staffSrc) && /commissionForPayroll\(env, month, payrollMonthStaffSql\(month, "u\."\), \{ include: \[Number\(body\.user_id\)\], released: await payslipsOut\(month\) \}\)/.test(staffSrc)); // v1.232.0 - only the person saved joins
ok("the dormant old engine is not called by the new one", !/commission_rules|commission_entries|commission_rates/.test(cm));
ok("the sales screen offers Mark paid only to the payment roles", /const canPay = \["super_admin", "admin", "ceo", "coo"\]\.includes\(user\.role\)/.test(read("components/portal/sales.tsx")));

/* ---- runtime ---- */
const dir = mkdtempSync(join(tmpdir(), "commission-"));
const out = join(dir, "staff.mjs");
execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
}
const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
  bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
  first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
  run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
const env = { DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, base_salary_cents) VALUES
  (1,'Boss','b@x.t','ceo',1,'x',800000),(2,'Ops','o@x.t','coo',1,'x',600000),(3,'Com','c@x.t','cco',1,'x',600000),
  (4,'Aina','a@x.t','sales_marketing',1,'x',210000),(5,'Hafiz','h@x.t','sales_marketing',1,'x',210000),
  (6,'Adm','d@x.t','admin',1,'x',0),(7,'Sup','s@x.t','super_admin',1,'x',0),(8,'Hr','r@x.t','hr_admin',1,'x',300000)`);
db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',4),(2,'Kedai Dua',4)`);
const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, paid_at, kind) VALUES (?,'INV',?,?,?,?,?,?,?,?,1,?,?,'service')`);
const items = (cents, name = "AZ package") => JSON.stringify([{ name, qty: 1, unit_price_cents: cents }]);
doc.run(20, "INV-20", 1, items(120000, "LIVE Host - Starter"), 0, 0, 120000, "paid", "2026-11-02 02:00:00", 4, "2026-11-05 04:00:00"); // A
doc.run(21, "INV-21", 2, items(24900, "AZ Creative Express"), 0, 0, 24900, "unpaid", "2026-11-03 02:00:00", 5, null);            // B
doc.run(22, "INV-22", 1, items(39900, "AZ Monthly Care"), 0, 0, 39900, "unpaid", "2026-11-03 02:00:00", 4, null);                // C
doc.run(23, "INV-23", 2, items(100000), 10000, 8, 97200, "paid", "2026-11-04 02:00:00", 4, "2026-11-06 04:00:00");              // SST + discount
doc.run(24, "INV-24", 1, items(50000), 0, 0, 50000, "paid", "2026-10-15 02:00:00", 4, "2026-10-20 04:00:00");                   // October money
doc.run(25, "INV-25", 1, items(30000), 0, 0, 30000, "paid", "2026-11-04 02:00:00", null, "2026-11-07 04:00:00");                // no closer
db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, reference, created_by) VALUES (22, 20000, '2026-11-04', 'TT', 1)`);

const { handleStaff } = await import(pathToFileURL(out).href);
const RealDate = Date; let fixed = new RealDate("2026-10-30T02:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "sales_marketing", 6: "admin", 7: "super_admin", 8: "hr_admin" };
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const led = (where = "1=1") => db.prepare(`SELECT * FROM commission_ledger WHERE ${where} ORDER BY id`).all();
const confirm = (inv, id, amount) => call(`/docs/${inv}/confirm-paid`, id, "POST", { amount_cents: amount, checked: true, payment_ref: "MBB-1" });

try {
  /* 1. the policy: drafted, approved, never back-dated */
  const draft = (id, b) => call("/commission/policy", id, "POST", { name: "A2Z Sales Commission", effective_from: "2026-11-01", rate_kind: "percent", rate_pct: 10, basis: "net_of_tax_delivery", reason: "The documented 10% base rate (PDF v2)", ...b });
  ok("the CCO cannot draft a policy", (await draft(3)).status === 403);
  ok("a consultant cannot draft a policy", (await draft(4)).status === 403);
  ok("a policy cannot start before today (no back-dating)", (await draft(2, { effective_from: "2026-10-29" })).status === 400);
  ok("a renewal rule not yet approved is refused", (await draft(2, { renewal_rule: "first_only" })).status === 400);
  const d1 = await draft(2);
  ok("the COO drafts v1 at 10% (1000 basis points)", d1.status === 201 && d1.j.version === 1 && db.prepare(`SELECT rate_bp, status FROM commission_policies WHERE id = ?`).get(d1.j.id).rate_bp === 1000);
  ok("the COO cannot approve it", (await call(`/commission/policy/${d1.j.id}/approve`, 2, "POST", { confirm: true })).status === 403);
  ok("the CCO cannot approve it", (await call(`/commission/policy/${d1.j.id}/approve`, 3, "POST", { confirm: true })).status === 403);
  ok("approval needs the tick", (await call(`/commission/policy/${d1.j.id}/approve`, 1, "POST", {})).status === 400);
  ok("the CEO approves v1", (await call(`/commission/policy/${d1.j.id}/approve`, 1, "POST", { confirm: true })).status === 200 && db.prepare(`SELECT status FROM commission_policies WHERE id = ?`).get(d1.j.id).status === "active");
  ok("the CCO reads the policy", (await call("/commission/policy", 3)).j?.versions?.length === 1 && (await call("/commission/policy", 3)).j.can_approve === false);

  fixed = new RealDate("2026-11-10T02:00:00Z").getTime();
  /* 2. estimates: never stored */
  let es = (await call("/commission/entries?scope=all", 1)).j.estimates;
  const est = (inv) => es.find((e) => e.invoice_id === inv);
  ok("B: unpaid RM 249 - estimate RM 24.90, nothing eligible", est(21)?.estimate_cents === 2490 && est(21).stage === "unpaid" && led("invoice_id = 21").length === 0);
  ok("C: part-paid RM 399 - estimate RM 39.90, stage part paid, nothing eligible", est(22)?.estimate_cents === 3990 && est(22).stage === "part_paid" && led("invoice_id = 22").length === 0);
  ok("the basis is after discounts and excludes SST: RM 1,000 - RM 100, SST 8% -> RM 90.00", est(23)?.basis_cents === 90000 && est(23).estimate_cents === 9000, JSON.stringify(est(23)));
  ok("money that landed in October never earns", !est(24));

  /* 3. who says money arrived (the owner: only CEO/COO/admins) */
  ok("D: the CCO cannot confirm Paid", (await confirm(20, 3, 120000)).status === 403);
  ok("a consultant cannot confirm Paid", (await confirm(20, 4, 120000)).status === 403);
  ok("the CCO cannot mark an invoice paid", (await call("/docs/21", 3, "PATCH", { payment_status: "paid" })).status === 403);
  ok("a consultant cannot mark an invoice paid", (await call("/docs/21", 4, "PATCH", { payment_status: "paid" })).status === 403);
  ok("HR admin cannot mark an invoice paid", (await call("/docs/21", 8, "PATCH", { payment_status: "paid" })).status === 403);
  ok("the CCO cannot record a part payment", (await call("/docs/21/payments", 3, "POST", { amount_cents: 100, received_on: "2026-11-09" })).status === 403);
  ok("the CCO cannot create an invoice already paid", (await call("/docs", 3, "POST", { doc_type: "INV", customer_id: 1, kind: "service", items: [{ name: "x", qty: 1, unit_price_cents: 100 }], paid_received: true })).status === 403);
  ok("the CCO still reads an invoice's payments", (await call("/docs/22/payments", 3)).status === 200 && (await call("/docs/22/payments", 3)).j.can_record === false);
  ok("an admin may record a part payment", (await call("/docs/21/payments", 6, "POST", { amount_cents: 100, received_on: "2026-11-09" })).status < 300);

  /* 4. A: paid and confirmed -> eligible, once */
  ok("A: the COO confirms RM 1,200", (await confirm(20, 2, 120000)).status === 201);
  let a = led("invoice_id = 20");
  ok("A: one entitlement, RM 120.00, eligible, Aina, policy v1", a.length === 1 && a[0].amount_cents === 12000 && a[0].status === "eligible" && a[0].user_id === 4 && a[0].policy_id === d1.j.id && a[0].rate_bp === 1000, JSON.stringify(a));
  ok("LIVE packages earn the same rate (owner, 29-10)", a[0].amount_cents === 12000);
  let dup = false; try { db.exec(`INSERT INTO commission_ledger (source_key, kind, invoice_id, amount_cents, status) VALUES ('${a[0].source_key}', 'earn', 20, 1, 'eligible')`); } catch { dup = true; }
  ok("G: the database itself refuses a second row for one event", dup);
  ok("G: confirming again is refused", (await confirm(20, 1, 120000)).status === 409);
  await call("/commission/entries?scope=all", 1); await call("/commission/summary?scope=all", 1); await call("/commission/flow", 1);
  ok("G: reads and retries write nothing more", led("invoice_id = 20").length === 1);
  ok("the SST invoice earns on RM 900.00", (await confirm(23, 1, 97200)).status === 201 && led("invoice_id = 23")[0]?.amount_cents === 9000);
  await confirm(24, 1, 50000);
  ok("October money confirmed in November earns nothing", led("invoice_id = 24").length === 0);
  await confirm(25, 2, 30000);
  ok("no closer: the entitlement waits for review", led("invoice_id = 25")[0]?.status === "review" && led("invoice_id = 25")[0].user_id === null);

  /* 5. who reads what */
  const mine = (await call("/commission/summary?scope=all", 4)).j;
  ok("a consultant asking for everyone gets their own figures", mine.scope === "mine" && mine.eligible.cents === 21000 && mine.estimated.cents === 3990, JSON.stringify(mine));
  ok("another consultant sees none of Aina's", (await call("/commission/summary?scope=all", 5)).j.eligible.cents === 0 && (await call("/commission/entries", 5)).j.entries.length === 0);
  ok("...nor her entry", (await call(`/commission/entries/${a[0].id}`, 5)).status === 403);
  ok("the CCO reads everyone's", (await call("/commission/summary?scope=all", 3)).j.eligible.cents === 21000);
  ok("the flow is for management", (await call("/commission/flow", 4)).status === 403 && (await call("/commission/flow", 3)).status === 200);
  ok("an entry carries its history", ((await call(`/commission/entries/${a[0].id}`, 1)).j.history ?? []).some((h) => h.action === "invoice.paid_confirm"));

  /* 6. E: the weekly KPI does not touch it */
  await call("/sales/week/targets", 1, "POST", { scope: "person", user_id: 4, week_from: "2026-11-09", target_cents: 9000000, reason: "A target she will miss" });
  fixed = new RealDate("2026-11-13T02:00:00Z").getTime();
  const wk = (await call("/sales/week", 4)).j.me;
  ok("E: a missed weekly target leaves commission eligible", ["action", "at_risk", "on_track"].includes(wk.status) && led("invoice_id = 20")[0].status === "eligible" && led("invoice_id = 20")[0].amount_cents === 12000, wk.status);

  /* 7. payroll: shadow until the switch, then the ledger - once */
  const row = (uid, month) => db.prepare(`SELECT commission_cents, net_cents FROM payroll_entries WHERE user_id = ? AND month = ?`).get(uid, month);
  const save = (uid, month, comm = 0) => call("/payroll", 1, "POST", { user_id: uid, month, basic_cents: 210000, commission_cents: comm, allowance_cents: 0, deduction_cents: 0, net_cents: 210000 + comm });
  await save(4, "2026-11", 99999);
  ok("switch off: the screen's commission is not stored (shadow mode)", row(4, "2026-11").commission_cents === 0 && row(4, "2026-11").net_cents === 210000, JSON.stringify(row(4, "2026-11")));
  ok("switch off: nothing goes to a payroll month", led("payroll_month IS NOT NULL").length === 0);
  ok("the COO cannot switch payroll on", (await call("/commission/settings", 2, "POST", { sync: "on", reason: "Start November payroll" })).status === 403);
  ok("the switch needs a reason", (await call("/commission/settings", 1, "POST", { sync: "on" })).status === 400);
  ok("the CEO switches payroll on, logged", (await call("/commission/settings", 1, "POST", { sync: "on", reason: "Checked the November shadow ledger" })).status === 200 && db.prepare(`SELECT COUNT(*) AS n FROM commission_settings_log`).get().n === 1);
  await save(4, "2026-11", 0);
  ok("switch on: Save carries the ledger's RM 210.00, net moves with it", row(4, "2026-11").commission_cents === 21000 && row(4, "2026-11").net_cents === 231000, JSON.stringify(row(4, "2026-11")));
  ok("...and both entitlements are in November", led("payroll_month = '2026-11' AND status = 'included'").length === 2);
  await save(4, "2026-11", 50000); await save(4, "2026-11", 0);
  await call("/payroll/recompute", 1, "POST", { month: "2026-11" }); await call("/payroll/recompute", 1, "POST", { month: "2026-11" });
  ok("G: Save twice, Recompute twice - still RM 210.00, one month each", row(4, "2026-11").commission_cents === 21000 && led("invoice_id IN (20, 23)").every((l) => l.payroll_month === "2026-11"));
  db.exec(`UPDATE invoice_paid_confirmations SET confirmed_at = '2026-11-10 03:00:00' WHERE invoice_id IN (20, 23)`); // SQLite's 'now' is the real clock
  ok("commission-sources shows what each invoice earned", ((await call("/payroll/commission-sources?month=2026-11", 1)).j.rows ?? []).find((r) => r.invoice_id === 20)?.commission_cents === 12000);

  /* 8. a released month is never written; the next month carries forward */
  db.exec(`INSERT INTO payslip_releases (month, released_by) VALUES ('2026-11', 1)`);
  db.exec(`UPDATE sales_documents SET salesperson_id = 5 WHERE id = 25`);
  ok("an earn without a closer: apply needs the reason", (await call(`/commission/ledger/${led("invoice_id = 25")[0].id}/decide`, 1, "POST", { decision: "apply", note: "x" })).status === 400);
  ok("the CCO cannot decide it", (await call(`/commission/ledger/${led("invoice_id = 25")[0].id}/decide`, 3, "POST", { decision: "apply", note: "Closer set to Hafiz on review" })).status === 403);
  ok("the CEO applies it once the invoice names a closer", (await call(`/commission/ledger/${led("invoice_id = 25")[0].id}/decide`, 1, "POST", { decision: "apply", note: "Closer set to Hafiz on review" })).j?.status === "eligible" && led("invoice_id = 25")[0].user_id === 5);
  await call("/payroll/recompute", 1, "POST", { month: "2026-11", force_released: true });
  ok("a released month takes nothing new (not even with the payroll override)", led("invoice_id = 25")[0].payroll_month === null && row(4, "2026-11").commission_cents === 21000);
  fixed = new RealDate("2026-12-05T02:00:00Z").getTime();
  await call("/payroll", 1, "POST", { user_id: 5, month: "2026-12", basic_cents: 210000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, net_cents: 210000 });
  ok("carry forward: November's late entitlement lands in December", led("invoice_id = 25")[0].payroll_month === "2026-12" && row(5, "2026-12").commission_cents === 3000);

  /* 9. the bank run: paid */
  await call("/payroll/paid", 1, "POST", { month: "2026-11" });
  ok("the November bank run marks its commission paid", led("payroll_month = '2026-11'").every((l) => l.status === "paid" && l.paid_out_at));

  /* 10. F: a new rate from a later date - history keeps its version */
  const d2 = await call("/commission/policy", 1, "POST", { name: "A2Z Sales Commission v2", effective_from: "2026-12-10", rate_kind: "percent", rate_pct: 8, reason: "Management-approved new rate" });
  await call(`/commission/policy/${d2.j.id}/approve`, 1, "POST", { confirm: true });
  doc.run(26, "INV-26", 1, items(120000), 0, 0, 120000, "paid", "2026-12-10 02:00:00", 4, "2026-12-11 04:00:00");
  fixed = new RealDate("2026-12-12T02:00:00Z").getTime();
  await confirm(26, 2, 120000);
  ok("F: a sale paid under v2 earns 8% (RM 96.00)", led("invoice_id = 26")[0]?.amount_cents === 9600 && led("invoice_id = 26")[0].policy_id === d2.j.id);
  ok("F: the November entitlement keeps v1 and RM 120.00", led("invoice_id = 20 AND kind = 'earn'")[0].amount_cents === 12000 && led("invoice_id = 20 AND kind = 'earn'")[0].policy_id === d1.j.id);
  ok("F: a v2 draft cannot reach back before today", (await call("/commission/policy", 1, "POST", { name: "Back-dated", effective_from: "2026-12-01", rate_pct: 5, reason: "Should never be accepted" })).status === 400);

  /* 11. a confirmation taken back before payroll: both drop out */
  await call("/docs/26/confirm-paid/revoke", 1, "POST", { reason: "The transfer bounced back" });
  const r26 = led("invoice_id = 26");
  ok("taken back before payroll: the entitlement and its reversal are void", r26.length === 2 && r26.every((l) => l.status === "void") && r26[1].amount_cents === -9600, JSON.stringify(r26));

  /* 12. H: a refund after payout - review, nothing taken from wages */
  await call("/docs/20/credit-note", 1, "POST", { amount_cents: 120000, reason: "Customer refunded" });
  const rev = led("invoice_id = 20 AND kind = 'reverse'");
  ok("H: a credit note opens a reversal for review; the original stays", rev.length === 1 && rev[0].status === "review" && rev[0].amount_cents === -12000 && led("invoice_id = 20 AND kind = 'earn'")[0].status === "paid");
  db.exec(`DELETE FROM payslip_releases WHERE month = '2026-11'`); // the bank run alone - payslips not formally released - still means paid
  ok("H: it cannot be applied against wages already paid", (await call(`/commission/ledger/${rev[0].id}/decide`, 1, "POST", { decision: "apply", note: "Take it back from December" })).status === 409);
  ok("H: it is settled outside payroll, with the reason kept", (await call(`/commission/ledger/${rev[0].id}/decide`, 1, "POST", { decision: "settled", note: "Agreed with Aina, handled by HR" })).j?.status === "void" && led(`id = ${rev[0].id}`)[0].decision_note.includes("handled by HR"));
  ok("H: nothing reached December's payroll", (row(4, "2026-12")?.commission_cents ?? 0) === 0);
  ok("every decision is audited", db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'commission.%'`).get().n >= 6);
} catch (e) {
  failed++;
  console.log(`  ✗ runtime: ${e?.stack ?? e}`);
}

console.log(failed ? `\ncommission-ledger: ${failed} failed, ${passed} passed.` : `Commission: ${passed} checks passed - one entitlement per event, the approved policy by the paid day, payroll by the switch and never twice, refunds to review.`);
process.exit(failed ? 1 : 0);
