/* MASTER FLOW STABILIZATION (v1.225.0) - runtime guard: the real worker
 * (staff.ts, bundled) against SQLite with EVERY migration applied.
 *
 * The owner's answers to the Master Flow audit, 29-10-2026
 * (claude/MASTER-FLOW-AUDIT.md): "Block edits on paid invoices",
 * "Restrict and book refunds", "Close both", and the four P1 fixes
 * ("Enquiry owner -> closer", "Hide resigned in pickers", "Log refused
 * attempts", "Customer duplicate warning"). This guard holds:
 *
 *   P0-1 a paid invoice's amounts cannot be edited (unmark first); its
 *        wording can; Reconciliation lists a paid invoice whose total no
 *        longer matches its cash row (history);
 *   P0-2 only the CEO, COO and admins issue a credit note or record a
 *        refund; a refund paid back books money out ONCE with a balanced
 *        journal entry against Sales (4000) or Sales - services (4100);
 *        a credit with no money moving books nothing; credit notes never
 *        exceed the invoice;
 *   P0-5 the retired commission routes answer 410; the new engine answers;
 *   P1-5 monthly person/team targets: CEO, COO, super admin only;
 *   P1-3 a closer must be on staff today;
 *   P1-4 Resigned with no last day is off the pickers; payroll's base list
 *        is unchanged;
 *   P1-6 a refused money action is written to the audit log;
 *   P1-7 a customer with the same name or phone is warned about, and added
 *        only when confirmed.
 *
 * Negative-tested by: dropping the paid lock; DOC_MANAGE back on credit
 * notes; dropping the refund booking; a plain bookCash ref (no CN- key
 * reuse check); removing a retired route; CCO back on /targets; dropping
 * the closer check; the old currentStaffSql; dropping the denial audit;
 * dropping the duplicate check.
 *
 *   node tests/master-flow.mjs
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
const sales = read("components/portal/sales.tsx");
ok("Make quotation from an enquiry carries its consultant as the closer", /salesperson_id: e\.assigned_to \?\? undefined/.test(sales) && /salesperson_id: pf\.salesperson_id && staffList\.some\(\(u\) => u\.id === pf\.salesperson_id\)/.test(sales));
ok("the browser's staff rule matches the worker's", /\["resigned", "terminated"\]\.includes\(u\.employment_status \?\? ""\)/.test(read("lib/staff-order.ts")));
ok("payroll's base list keeps its own rule", /WHERE role NOT IN \('customer', 'super_admin'\) AND is_active = 1 AND \$\{payrollBaseStaffSql\(\)\}/.test(read("worker/src/staff.ts")));
ok("credit notes: the screen offers them only where the server says so", /canIssue && <button type="button" className=\{btnSm\} onClick=\{\(\) => void issueCreditNote\(inv\)\}>/.test(read("components/portal/documents-panel.tsx")));

/* ---- runtime ---- */
const dir = mkdtempSync(join(tmpdir(), "master-"));
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
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, base_salary_cents, employment_status, left_on) VALUES
  (1,'Boss','b@x.t','ceo',1,'x',800000,'permanent',NULL),(2,'Ops','o@x.t','coo',1,'x',600000,'permanent',NULL),(3,'Com','c@x.t','cco',1,'x',600000,'permanent',NULL),
  (4,'Aina','a@x.t','sales_marketing',1,'x',210000,'permanent',NULL),(5,'Zul','z@x.t','sales_marketing',1,'x',210000,'resigned',NULL),
  (6,'Adm','d@x.t','admin',1,'x',0,'permanent',NULL),(8,'Hr','r@x.t','hr_admin',1,'x',300000,'permanent',NULL)`);
db.exec(`INSERT INTO customers (id, company, phone, created_by) VALUES (1,'Kedai Satu','012-345 6789',4)`);
const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, paid_at, kind) VALUES (?,'INV',?,1,?,0,0,?,?,'2026-11-02 02:00:00',1,4,?,?)`);
doc.run(10, "INV-10", JSON.stringify([{ name: "AZ Starter", qty: 1, unit_price_cents: 120000 }]), 120000, "unpaid", null, "service");
doc.run(11, "INV-11", JSON.stringify([{ name: "AZ Monthly Care", qty: 1, unit_price_cents: 39900 }]), 39900, "unpaid", null, "product");

const { handleStaff } = await import(pathToFileURL(out).href);
const RealDate = Date; const fixed = new RealDate("2026-11-10T02:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "sales_marketing", 6: "admin", 8: "hr_admin" };
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
  return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
};
const cash = (ref) => db.prepare(`SELECT * FROM cashflow_entries WHERE ref = ?`).all(ref);
const jl = (ref) => db.prepare(`SELECT a.code, l.debit_cents, l.credit_cents FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id JOIN gl_accounts a ON a.id = l.account_id WHERE e.ref = ? ORDER BY l.id`).all(ref);
const edit = (id, who, items, extra = {}) => call(`/docs/${id}/edit`, who, "POST", { items, discount_cents: 0, tax_percent: 0, delivery_cents: 0, ...extra });
const denied = () => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'security.denied'`).get().n;

try {
  /* P0-1 - a paid invoice's money cannot be edited */
  ok("the CEO marks INV-10 paid", (await call("/docs/10", 1, "PATCH", { payment_status: "paid", payment_ref: "MBB-1", paid_on: "2026-11-05" })).status === 200 && cash("INV-10").length === 1);
  const e1 = await edit(10, 1, [{ name: "AZ Starter", qty: 1, unit_price_cents: 150000 }]);
  ok("P0-1: changing a paid invoice's amount is refused - unmark first", e1.status === 409 && e1.j?.error?.code === "paid_locked", JSON.stringify(e1.j));
  ok("...and nothing changed", db.prepare(`SELECT total_cents FROM sales_documents WHERE id = 10`).get().total_cents === 120000);
  ok("...its wording can still be fixed", (await edit(10, 1, [{ name: "AZ Starter package", qty: 1, unit_price_cents: 120000 }])).status < 300);
  ok("an unpaid invoice is edited as before", (await edit(11, 1, [{ name: "AZ Monthly Care", qty: 2, unit_price_cents: 39900 }])).status < 300 && db.prepare(`SELECT total_cents FROM sales_documents WHERE id = 11`).get().total_cents === 79800);
  db.exec(`UPDATE sales_documents SET total_cents = 99000 WHERE id = 10`); // an edit made before 1.225.0
  const cb = (await call("/erp/cashbook?from=2026-11-01&to=2026-11-30", 1)).j;
  ok("Reconciliation lists a paid invoice whose total differs from its cash row", (cb?.exceptions ?? []).some((x) => x.kind === "out_of_step" && /now totals 990\.00/.test(x.detail)), JSON.stringify((cb?.exceptions ?? []).map((x) => x.kind)));
  db.exec(`UPDATE sales_documents SET total_cents = 120000 WHERE id = 10`);

  /* P0-2 - credit notes and refunds */
  const before = denied();
  ok("P0-2: the CCO cannot issue a credit note", (await call("/docs/10/credit-note", 3, "POST", { amount_cents: 1000 })).status === 403);
  ok("...nor a consultant", (await call("/docs/10/credit-note", 4, "POST", { amount_cents: 1000 })).status === 403);
  ok("P1-6: both refusals are written to the audit log", denied() === before + 2, String(denied() - before));
  const cn1 = await call("/docs/10/credit-note", 1, "POST", { amount_cents: 20000, reason: "Customer refunded", refund_on: "2026-11-09" });
  ok("the CEO issues a credit note with its refund paid", cn1.status === 201);
  const r1 = cash(`CN-${cn1.j.id}`);
  ok("the refund is money out once, on the day it was paid", r1.length === 1 && r1[0].type === "out" && r1[0].amount_cents === 20000 && r1[0].effective_date === "2026-11-09", JSON.stringify(r1));
  const j1 = jl(`CN-${cn1.j.id}`);
  ok("...with a balanced journal entry against Sales - services (4100)", j1.length === 2 && j1[0].code === "4100" && j1[0].debit_cents === 20000 && j1[1].code === "1100" && j1[1].credit_cents === 20000, JSON.stringify(j1));
  ok("recording the same refund again is refused", (await call(`/credit-notes/${cn1.j.id}/refund`, 1, "POST", { refund_on: "2026-11-09" })).status === 409 && cash(`CN-${cn1.j.id}`).length === 1);
  const cn2 = await call("/docs/10/credit-note", 2, "POST", { amount_cents: 5000, reason: "Goodwill credit" });
  ok("a credit with no money moving books nothing", cn2.status === 201 && cash(`CN-${cn2.j.id}`).length === 0);
  ok("the refund can be recorded later, by the COO or an admin, not the CCO", (await call(`/credit-notes/${cn2.j.id}/refund`, 3, "POST", { refund_on: "2026-11-10" })).status === 403
    && (await call(`/credit-notes/${cn2.j.id}/refund`, 6, "POST", { refund_on: "2026-11-10" })).status === 200 && cash(`CN-${cn2.j.id}`).length === 1);
  /* v1.242.0 (go-live audit B1) - a refund needs money IN first: INV-11 is
     unpaid, so its refund is refused; a part payment on it makes room */
  const r11 = await call("/docs/11/credit-note", 1, "POST", { amount_cents: 1000, refund_on: "2026-11-10" });
  ok("B1: a refund on an invoice with no money recorded is refused, and books nothing", r11.status === 400 && r11.j?.error?.code === "refund_exceeds_paid" && db.prepare(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE type = 'out' AND ref LIKE 'CN-%'`).get().n === cash(`CN-${cn1.j.id}`).length + cash(`CN-${cn2.j.id}`).length, JSON.stringify(r11.j));
  ok("a part payment is received on INV-11", (await call("/docs/11/payments", 1, "POST", { amount_cents: 5000, received_on: "2026-11-10", method: "cash" })).status === 201);
  ok("a product invoice's refund (within the money received) books against Sales (4000)", (await call("/docs/11/credit-note", 1, "POST", { amount_cents: 1000, refund_on: "2026-11-10" })).status === 201 && jl(`CN-${db.prepare(`SELECT MAX(id) AS id FROM credit_notes`).get().id}`)[0].code === "4000");
  ok("credit notes on one invoice never exceed its total", (await call("/docs/10/credit-note", 1, "POST", { amount_cents: 100000 })).status === 400);
  ok("a refund in the future is refused", (await call("/docs/10/credit-note", 1, "POST", { amount_cents: 100, refund_on: "2026-12-01" })).status === 400);
  const list = (await call("/credit-notes", 1)).j;
  ok("the list says which refunds are recorded and who may record one", list.can_issue === true && list.credit_notes.find((n) => n.id === cn1.j.id).refunded_on === "2026-11-09" && (await call("/credit-notes", 3)).j.can_issue === false);

  /* P0-5 - the retired commission routes */
  for (const [p, m] of [["/commission/rules", "GET"], ["/commission/rules", "POST"], ["/commission/rules/1", "DELETE"], ["/payroll/pull-commission", "POST"], ["/leaderboard", "GET"], ["/erp/commission", "GET"], ["/erp/commission/rates", "POST"]]) {
    ok(`P0-5: ${m} ${p} is retired (410)`, (await call(p, 1, m, m === "GET" ? undefined : {})).status === 410);
  }
  ok("the one engine still answers", (await call("/commission/summary?scope=all", 1)).status === 200);

  /* P1-5 - monthly targets */
  const tgt = (id) => call("/targets", id, "POST", { scope: "user", id: 4, month: "2026-11", target_cents: 500000 });
  ok("P1-5: the CCO cannot set a monthly person target", (await tgt(3)).status === 403);
  ok("...nor admin", (await tgt(6)).status === 403);
  ok("...the COO can", (await tgt(2)).status < 300);

  /* P1-3 - the closer must be on staff */
  const mk = (sp) => call("/docs", 1, "POST", { doc_type: "QT", customer_id: 1, kind: "service", items: [{ name: "AZ Starter", qty: 1, unit_price_cents: 9900 }], salesperson_id: sp });
  ok("P1-3: a resigned closer is refused", (await mk(5)).status === 400);
  ok("...a closer who does not exist is refused", (await mk(999)).status === 400);
  ok("...a closer on staff is accepted", (await mk(4)).status < 300);

  /* P1-4 - resigned with no last day */
  const staffList = (await call("/staff-list", 1)).j?.staff ?? [];
  ok("P1-4: Resigned with no last day is off the staff picker", !staffList.some((u) => u.id === 5) && staffList.some((u) => u.id === 4), JSON.stringify(staffList.map((u) => u.id)));
  ok("...payroll's basic-salary list keeps them, exactly as before", ((await call("/payroll/base", 1)).j?.base ?? []).some((b) => b.user_id === 5));

  /* P1-6 - a refused Confirm Paid is written down */
  const b2 = denied();
  await call("/docs/10/confirm-paid", 3, "POST", { amount_cents: 120000, checked: true });
  const last = db.prepare(`SELECT * FROM audit_log WHERE action = 'security.denied' ORDER BY id DESC LIMIT 1`).get();
  ok("P1-6: the CCO's Confirm Paid attempt is audited with role, method and route", denied() === b2 + 1 && last.entity_id === "/docs/10/confirm-paid" && JSON.parse(last.detail).role === "cco" && JSON.parse(last.detail).method === "POST");
  const b3 = denied();
  await call("/docs", 8);
  ok("...a refused plain read is not (no noise)", denied() === b3);

  /* P1-7 - customer duplicates */
  const c1 = await call("/customers", 4, "POST", { company: "  kedai satu ", phone: "" });
  ok("P1-7: the same company name is warned about", c1.status === 409 && c1.j?.error?.code === "possible_duplicate" && c1.j.matches[0].id === 1);
  ok("...the same phone too, however it is written", (await call("/customers", 4, "POST", { company: "Satu Trading", phone: "+60 12-345 6789" })).j?.error?.code === "possible_duplicate");
  ok("...and it is added only when confirmed", (await call("/customers", 4, "POST", { company: "Kedai Satu", confirm_duplicate: true })).status < 300 && db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE LOWER(company) = 'kedai satu'`).get().n === 2);
  ok("a new customer is added as before", (await call("/customers", 4, "POST", { company: "Kedai Baru", phone: "0199999999" })).status < 300);
} catch (e) {
  failed++;
  console.log(`  ✗ runtime: ${e?.stack ?? e}`);
}

console.log(failed ? `\nmaster-flow: ${failed} failed, ${passed} passed.` : `Master flow: ${passed} checks passed - paid invoices locked, refunds in the books, retired commission closed, one target authority, closers on staff, leavers off the pickers, refusals logged, duplicates warned.`);
process.exit(failed ? 1 : 0);
