/* 18-11-2026 - FINANCE HISTORY, PROOF OF THE AUDIT (docs/FINANCE-HISTORY-AUDIT.md; the CEO's
 * "Finance Historical Recovery & Reconciliation" gate). READ-ONLY with respect to production:
 * the real worker (staff.ts, bundled) against SQLite in memory with EVERY migration applied,
 * fixtures only. It proves, on today's code, before anything is changed:
 *
 *   R1  a receipt paid Jun-Oct and never confirmed is listed but counts in neither Money In
 *       nor the Cash Trend; once confirmed it lands in the month it was PAID, never the month
 *       it was verified
 *   R2  the warnings look only at the chosen period: an older unverified receipt is not in
 *       "Needs Attention" for this month
 *   R3  a cash-book row with no company and no account counts in neither company view, only
 *       under "all"; its "which account?" warning is not in either company view
 *   R4  an invoice with no issuer (before 19-08-2026) belongs to AZ ONE OFFICIAL, never A2Z
 *   C   COMMISSION SAFETY: confirming an invoice PAID before 01-11-2026 writes no commission
 *       row (attribution or ledger); a second confirmation is refused and writes nothing; the
 *       existing ledger is untouched. And the one case the CEO's new rule differs from the
 *       approved rule: an invoice CREATED in October but PAID on/after 01-11 does earn today
 *       (the approved paid-day rule, v1.216.1) - reported, not changed.
 *
 *   node tests/finance-history.mjs
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), "finhist-")), "staff.mjs");
execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });

const res = [];
const ok = (c, m, why = "") => res.push([!!c, why && !c ? `${m} - ${why}` : m]);
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
  (1,'Boss','b@x.t','ceo',1,'x',800000),(2,'Ops','o@x.t','coo',1,'x',600000),(4,'Aina','a@x.t','sales_marketing',1,'x',210000)`);
db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',4)`);
const ROLE = { 1: "ceo", 2: "coo", 4: "sales_marketing" };
const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-18T06:00:00Z").getTime();
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const { handleStaff } = await import(pathToFileURL(out).href);
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x", is_owner: id === 1 });
  return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
};
const inv = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (?,'INV',?,1,?,0,0,?,'paid',?,?,1,4,'service',?)`);
const items = (c) => JSON.stringify([{ name: "Live session", qty: 1, unit_price_cents: c }]);
const ledger = () => db.prepare(`SELECT COUNT(*) n FROM commission_ledger`).get().n;
const attrib = () => { try { return db.prepare(`SELECT COUNT(*) n FROM commission_attributions`).get().n; } catch { return 0; } };
const book = (from, to, co = "all") => call(`/erp/cashbook?from=${from}&to=${to}&months=12&company=${co}`, 1);
const tr = (v, m) => v.j.trend.find((x) => x.month === m) ?? { in_cents: null, out_cents: null };

try {
  /* the approved policy: 10% from 01-11-2026 (the owner's model) */
  fixed = new RealDate("2026-10-30T02:00:00Z").getTime(); // a policy is dated from today or later: approved before 01-11, as in production
  const d1 = await call("/commission/policy", 2, "POST", { name: "A2Z Sales Commission", effective_from: "2026-11-01", rate_kind: "percent", rate_pct: 10, reason: "The documented 10% base rate" });
  const ap = await call(`/commission/policy/${d1.j?.id}/approve`, 1, "POST", { confirm: true });
  ok(d1.status === 201 && ap.status === 200, "the 10% policy from 01-11-2026 is drafted and approved", `${d1.status} ${ap.status} ${JSON.stringify(d1.j)}`);
  fixed = new RealDate("2026-11-18T06:00:00Z").getTime();

  /* fixtures: three historical receipts, one November receipt, one created-October-paid-November */
  inv.run(201, "INV-JUN", items(30000), 30000, "2026-06-15 04:00:00", "2026-06-10 02:00:00", null);  // before the switch: AZ ONE
  inv.run(202, "INV-SEP", items(50000), 50000, "2026-09-12 04:00:00", "2026-09-05 02:00:00", "a2z");
  inv.run(203, "INV-OCT", items(20000), 20000, "2026-10-20 04:00:00", "2026-10-15 02:00:00", "a2z");
  inv.run(204, "INV-NOV", items(14500), 14500, "2026-11-10 04:00:00", "2026-11-08 02:00:00", "a2z");
  inv.run(205, "INV-OCTNOV", items(10000), 10000, "2026-11-05 04:00:00", "2026-10-28 02:00:00", "a2z");
  /* a payroll row booked before 0197: no company, no account */
  db.exec(`INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by) VALUES ('2026-09-30', 'out', 'payroll', 420000, 'Payroll 2026-09', 'PAYROLL-2026-09', 1)`);
  db.exec(`INSERT INTO bank_accounts (name, bank, number_masked, active, company) VALUES ('A 2 Z Creative Marketing', 'Maybank', '****5300', 1, 'a2z')`);
  await call(`/docs/204/confirm-paid`, 1, "POST", { amount_cents: 14500, checked: true, payment_ref: "MBB-204" });
  ok(db.prepare(`SELECT amount_cents FROM commission_ledger WHERE invoice_id = 204 AND kind = 'earn'`).get()?.amount_cents === 1450, "control: a November receipt, once verified, earns its 10% (the engine is live in this run)");

  /* R1 + R2 - before any historical verification */
  let a2z = await book("2026-11-01", "2026-11-18", "a2z");
  ok(a2z.status === 200, "the cash book reads (A2Z, this month)", JSON.stringify(a2z.j).slice(0, 200));
  ok(tr(a2z, "2026-09").in_cents === 0 && tr(a2z, "2026-10").in_cents === 0, "R1: September and October draw RM 0 in the A2Z trend while their receipts are unverified", JSON.stringify(a2z.j.trend));
  const sep = (await book("2026-09-01", "2026-09-30", "a2z")).j;
  ok(sep.totals.in_cents === 0 && sep.totals.awaiting_cents === 50000 && sep.items.some((i) => i.ref === "INV-SEP" && i.awaiting), "R1: September's receipt is there, as awaiting verification, not Money In", JSON.stringify(sep.totals));
  ok(!a2z.j.exceptions.some((x) => x.item_key === "INV:202" || x.item_key === "INV:203"), "R2: this month's Needs Attention does not list the older unverified receipts");

  /* R3 - a row with no company */
  const all = (await book("2026-09-01", "2026-09-30", "all")).j;
  const sepAz = (await book("2026-09-01", "2026-09-30", "azoo")).j;
  ok(all.totals.out_cents === 420000 && sep.totals.out_cents === 0 && sepAz.totals.out_cents === 0, "R3: a payroll row with no company counts only under 'all' - RM 0 out in both company views", `${all.totals.out_cents}/${sep.totals.out_cents}/${sepAz.totals.out_cents}`);
  ok(all.exceptions.some((x) => x.kind === "no_bank" && x.item_key?.startsWith("CF:")) && !sep.exceptions.some((x) => x.kind === "no_bank" && x.item_key?.startsWith("CF:")) && !sepAz.exceptions.some((x) => x.kind === "no_bank" && x.item_key?.startsWith("CF:")), "R3: its 'which account?' warning shows under 'all' only, never in a company view");

  /* R4 - before the switch = AZ ONE OFFICIAL */
  const jun = (await book("2026-06-01", "2026-06-30", "azoo")).j, junA = (await book("2026-06-01", "2026-06-30", "a2z")).j;
  ok(jun.items.some((i) => i.ref === "INV-JUN" && i.company === "azoo") && !junA.items.some((i) => i.ref === "INV-JUN"), "R4: an invoice with no issuer belongs to AZ ONE OFFICIAL, never A2Z");

  /* C - commission safety on historical verification */
  const before = { l: ledger(), a: attrib(), snap: JSON.stringify(db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all()) };
  for (const [id, c] of [[201, 30000], [202, 50000], [203, 20000]]) {
    const r = await call(`/docs/${id}/confirm-paid`, 1, "POST", { amount_cents: c, checked: true, payment_ref: `MBB-${id}` });
    ok(r.status === 201, `C: the CEO verifies historical receipt ${id}`, `${r.status} ${JSON.stringify(r.j)}`);
  }
  ok(ledger() === before.l && attrib() === before.a, "C: verifying receipts paid before 01-11-2026 writes NO commission row (ledger or attribution)", `${before.l}->${ledger()} / ${before.a}->${attrib()}`);
  ok(JSON.stringify(db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all()) === before.snap, "C: the existing commission ledger is byte-for-byte unchanged");
  const again = await call(`/docs/202/confirm-paid`, 1, "POST", { amount_cents: 50000, checked: true });
  ok(again.status === 409 && ledger() === before.l && db.prepare(`SELECT COUNT(*) n FROM invoice_paid_confirmations WHERE invoice_id = 202`).get().n === 1, "C: a second verification is refused and writes nothing");
  ok(db.prepare(`SELECT paid_at FROM sales_documents WHERE id = 202`).get().paid_at === "2026-09-12 04:00:00", "C: verification never moves the paid date");

  /* after verification: the money lands in the month it was PAID */
  a2z = await book("2026-11-01", "2026-11-18", "a2z");
  ok(tr(a2z, "2026-09").in_cents === 50000 && tr(a2z, "2026-10").in_cents === 20000, "R1: once verified, September and October show their receipts in the month they were paid", JSON.stringify(a2z.j.trend));
  ok(a2z.j.totals.in_cents === 14500, "R1: this month's Money In does not take the historical receipts (verified today, paid earlier)", String(a2z.j.totals.in_cents));
  ok(tr(await book("2026-11-01", "2026-11-18", "azoo"), "2026-06").in_cents === 30000, "R4: June's verified receipt is AZ ONE OFFICIAL's");

  /* H1 - visibility: awaiting drawn beside Money In, older items counted whatever the period */
  inv.run(206, "INV-AUG", items(40000), 40000, "2026-08-21 04:00:00", "2026-08-20 02:00:00", "a2z");
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (207,'INV','INV-OPEN',1,'${items(60000)}',0,0,60000,'unpaid','2026-10-01 02:00:00',1,4,'service','a2z')`);
  db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, method, created_by) VALUES (207, 25000, '2026-10-05', 'bank_transfer', 1)`);
  const partId = db.prepare(`SELECT id FROM invoice_payments WHERE invoice_id = 207`).get().id;
  inv.run(208, "INV-NOV2", items(9000), 9000, "2026-11-12 04:00:00", "2026-11-11 02:00:00", "a2z");
  let v = (await book("2026-11-01", "2026-11-18", "a2z")).j; const trv = (m) => v.trend.find((x) => x.month === m) ?? {};
  ok(trv("2026-08").awaiting_cents === 40000 && trv("2026-08").in_cents === 0 && trv("2026-10").awaiting_cents === 25000, "H1: the trend draws awaiting receipts beside Money In, never inside it", JSON.stringify(v.trend));
  ok(v.older?.awaiting_count === 2 && v.older.awaiting_cents === 65000 && (v.older.by_kind?.unverified ?? 0) === 2, "H1: 'older' counts the earlier unverified receipts whatever the period (Aug invoice, Oct part)", JSON.stringify(v.older));
  ok(v.unassigned?.count === 1 && v.unassigned.out_cents === 420000 && v.totals.out_cents === 0, "H4: the movement with no company is counted once, apart, reachable from a company view - and in neither company's total", JSON.stringify(v.unassigned));
  ok(v.history_end === "2026-11-01" && v.can_cash_verify === true && v.cash_verify_ready === true, "H3: the read says where history ends and that the CEO owner may verify it");
  const cb = readFileSync(join(root, "worker/src/cashbook.ts"), "utf8"), cm = readFileSync(join(root, "worker/src/commission.ts"), "utf8");
  const route = cb.slice(cb.indexOf('path === "/cashbook/cash-verify"'), cb.indexOf("a mismatch the CEO accepts as it is"));
  ok(route.length > 500 && !/invoice_paid_confirmations|ensureLedger|commission_ledger|UPDATE sales_documents|UPDATE invoice_payments|UPDATE cashflow_entries/.test(route), "H3: the cash-verify route touches no confirmation, commission, invoice, payment or cash-book row (static)");
  ok(/export const HISTORY_END = "2026-11-01";/.test(cb) && /export const COMMISSION_START_DAY = "2026-11-01";/.test(cm), "H3: the historical line equals the commission start day");

  /* H3 - historical cash verification, one at a time, cash only */
  const confBefore = db.prepare(`SELECT COUNT(*) n FROM invoice_paid_confirmations`).get().n, ledBefore = ledger(), atBefore = attrib();
  const cv = (key, who = 1, extra = {}) => call(`/erp/cashbook/cash-verify`, who, "POST", { key, checked: true, note: "Checked on the Maybank statement", ...extra });
  ok((await cv("INV:206", 2)).status === 403, "H3: the COO cannot verify a historical receipt (the CEO owner only)");
  ok((await cv("INV:206", 1, { checked: false })).status === 400, "H3: the bank check tick is required");
  const v206 = await cv("INV:206");
  ok(v206.status === 200, "H3: the CEO verifies the August receipt as cash", `${v206.status} ${JSON.stringify(v206.j)}`);
  ok((await cv("INV:206")).status === 409, "H3: a second verification is refused");
  ok((await cv(`PART:${partId}`)).status === 200, "H3: a historical part payment of an open invoice is verified on its own");
  ok((await cv("INV:208")).status === 409, "H3: a receipt paid on/after 01-11-2026 is refused here (it uses Confirm paid)");
  ok((await cv("INV:202")).status === 409, "H3: a receipt already verified through Confirm paid is refused (counted once)");
  ok(db.prepare(`SELECT COUNT(*) n FROM invoice_paid_confirmations`).get().n === confBefore && ledger() === ledBefore && attrib() === atBefore, "H3: cash verification writes NO confirmation and NO commission row");
  ok(db.prepare(`SELECT paid_at, total_cents, payment_status FROM sales_documents WHERE id = 206`).get().paid_at === "2026-08-21 04:00:00" && db.prepare(`SELECT amount_cents, received_on FROM invoice_payments WHERE id = ?`).get(partId).received_on === "2026-10-05", "H3: the invoice and the part payment keep their dates and amounts");
  v = (await book("2026-11-01", "2026-11-18", "a2z")).j;
  ok(trv("2026-08").in_cents === 40000 && trv("2026-10").in_cents === 20000 + 25000 && v.totals.in_cents === 14500, "H3: verified history lands in the month it was paid; this month's Money In is unchanged", JSON.stringify(v.trend) + " " + v.totals.in_cents);
  ok(v.older.awaiting_count === 0, "H3: nothing older is awaiting once verified");
  ok((await call(`/erp/cashbook/cash-verify/revoke`, 1, "POST", { key: "INV:206", reason: "Wrong account on the statement" })).status === 200, "H3: the CEO takes a verification back, with a reason");
  v = (await book("2026-11-01", "2026-11-18", "a2z")).j;
  ok(trv("2026-08").in_cents === 0 && trv("2026-08").awaiting_cents === 40000 && db.prepare(`SELECT cash_revoked_at FROM cashbook_marks WHERE item_key = 'INV:206'`).get()?.cash_revoked_at, "H3: taken back, it waits again; the mark keeps its history");
  ok((await cv("INV:206")).status === 200 && db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'cashbook.cash_verify%'`).get().n === 4, "H3: verified again; every step is in the audit history");

  /* the one gap against the CEO's new rule (reported, not changed) */
  await call(`/docs/205/confirm-paid`, 1, "POST", { amount_cents: 10000, checked: true });
  const earn205 = db.prepare(`SELECT amount_cents FROM commission_ledger WHERE invoice_id = 205 AND kind = 'earn'`).get();
  ok(earn205?.amount_cents === 1000, "GAP (approved rule today): an invoice CREATED 28-10 but PAID 05-11 earns 10% - the gate is the paid day, not the invoice date", JSON.stringify(earn205));
} catch (e) { ok(false, `the run threw: ${e?.stack ?? e}`); }

let failed = 0;
for (const [p, m] of res) { console.log(`${p ? "PASS" : "FAIL"} ${m}`); if (!p) failed++; }
console.log(`finance-history: ${res.length - failed} of ${res.length} passed`);
process.exit(failed ? 1 : 0);
