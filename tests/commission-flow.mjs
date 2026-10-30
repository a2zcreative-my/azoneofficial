/* COMMISSION 2.1 (v1.232.0) - runtime guard: the business flow from an
 * invoice to the payroll that pays it, through the real worker (staff.ts,
 * bundled) against SQLite with EVERY migration applied.
 *
 * The owner's Commission 2.1 brief and answers, 30-10-2026
 * (claude/COMMISSION-2.1-AUDIT.md): services earn, products only if a rule
 * lists them; part payments keep the whole-invoice rule; a rule may name a
 * library package; build the fixes. The audit's deterministic tests A-J,
 * fixtures only, no production data:
 *   A unpaid RM 150                 -> estimate RM 15.00, nothing earned, next step named
 *   B paid 31-10 / 01-11 / split    -> the day the WHOLE invoice landed picks the policy
 *   C paid + CEO/COO                -> eligible once; a confirmed payment day is locked (F5)
 *   D the CCO by direct request     -> 403 on confirm, release, bank run, decide, approve, switch
 *   E two monthly invoices          -> two entitlements; replays add nothing
 *   F a product line                -> earns nothing unless listed; a library package rule
 *   G payroll                       -> a GET attaches nothing (F1); Save takes only that person;
 *                                      Recompute twice = once; no future month (F3); no month
 *                                      whose payslips are out by time (F4); the bank run pays
 *                                      only what the payslip carries (F2)
 *   H a credit note after payout    -> review, nothing taken from wages
 *   I a leaver                      -> settled by the CEO, never voided (F6)
 *   J a new version                 -> old entitlements unchanged
 * Then mutated copies of commission.ts / staff.ts must each fail a check.
 *
 *   node tests/commission-flow.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => execSync(`npx esbuild "${join(srcRoot, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });

async function runtime(staffBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
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
    (6,'Adm','d@x.t','admin',1,'x',0),(9,'Rina','r@x.t','sales_marketing',1,'x',210000)`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',4)`);
  db.exec(`INSERT INTO sales_packages (id, name, issuers, status, current_version) VALUES (3,'Growth Bundle','a2z','active',1)`);
  const inv = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (?,'INV',?,1,?,0,0,?,?,?,?,1,?,?,'a2z')`);
  const line = (n, c, q = 1, sku) => ({ name: n, qty: q, unit_price_cents: c, ...(sku ? { sku } : {}) });
  const items = (...ls) => JSON.stringify(ls);
  const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "sales_marketing", 6: "admin", 9: "sales_marketing" };
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-30T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const at = (iso) => { fixed = new RealDate(iso).getTime(); };
  const { handleStaff } = await import(pathToFileURL(staffBundle).href + `?v=${Math.random()}`);
  const call = async (p, id = 1, method = "GET", body) => {
    const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: "x" });
    return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
  };
  const led = (where = "1=1") => db.prepare(`SELECT * FROM commission_ledger WHERE ${where} ORDER BY id`).all();
  const one = (invId) => led(`invoice_id = ${invId} AND kind = 'earn'`)[0];
  const confirm = (id, amount, who = 1) => call(`/docs/${id}/confirm-paid`, who, "POST", { amount_cents: amount, checked: true, payment_ref: "MBB-1" });
  const save = (uid, month) => call("/payroll", 1, "POST", { user_id: uid, month, basic_cents: 210000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, net_cents: 210000 });
  const slip = (uid, month) => db.prepare(`SELECT commission_cents FROM payroll_entries WHERE user_id = ? AND month = ?`).get(uid, month)?.commission_cents ?? null;
  const snap = () => JSON.stringify(led().map((r) => [r.id, r.status, r.payroll_month, r.amount_cents]));

  try {
    /* the policy: v1 at 10% from 01-11, the payroll switch on */
    const d1 = await call("/commission/policy", 2, "POST", { name: "A2Z Sales Commission", effective_from: "2026-11-01", rate_kind: "percent", rate_pct: 10, reason: "The documented 10% base rate" });
    await call(`/commission/policy/${d1.j?.id}/approve`, 1, "POST", { confirm: true });
    ok(d1.status === 201 && db.prepare(`SELECT product_rule FROM commission_policies WHERE id = ?`).get(d1.j.id)?.product_rule === "listed_only", "every version carries the approved product rule (listed only, 0154)");
    ok((await call("/commission/policy", 2, "POST", { name: "Products too", effective_from: "2026-11-01", rate_pct: 10, reason: "Let every product earn", product_rule: "all" })).status === 400, "another product rule is refused without the owner's approval");
    ok((await call("/commission/settings", 1, "POST", { sync: "on", reason: "Start with the November payroll" })).status === 200, "the CEO switches payroll on");

    /* A - unpaid RM 150: an estimate, a named next step, nothing stored */
    inv.run(10, "INV-A", items(line("Konsultasi", 15000)), 15000, "unpaid", null, "2026-10-30 02:00:00", 4, "service");
    inv.run(11, "INV-NC", items(line("Konsultasi", 5000)), 5000, "unpaid", null, "2026-10-30 02:00:00", null, "service");
    const eA = (await call("/commission/entries?scope=all", 1)).j?.estimates ?? [];
    ok(eA.find((x) => x.invoice_id === 10)?.estimate_cents === 1500 && eA.find((x) => x.invoice_id === 10)?.next === "await_payment", "A: unpaid RM 150 - estimate RM 15.00, next: collect the payment", JSON.stringify(eA));
    ok(eA.find((x) => x.invoice_id === 11)?.next === "choose_closer", "A: an invoice with no closer names that step first");
    const iA = await call("/commission/invoice/10", 4);
    ok(iA.status === 200 && iA.j.estimate_cents === 1500 && iA.j.stage === "unpaid" && iA.j.invoice.issuer_code === "a2z", "A: the invoice opens with its estimate, stage and issuer");
    ok((await call("/commission/invoice/10", 5)).status === 404, "A: another consultant cannot open it");
    ok(led().length === 0, "A: nothing is stored for an estimate");
    let fl = (await call("/commission/flow", 1)).j;
    ok(fl?.invoices?.find((x) => x.key === "unpaid")?.n === 2 && fl.entitlements.every((x) => x.cents === 0) && !("stages" in fl), "A: the flow keeps invoices and entitlements apart (no summed stages)", JSON.stringify(fl?.invoices));

    /* B - the day the whole invoice landed */
    at("2026-11-04T02:00:00Z");
    inv.run(12, "INV-B1", items(line("Live", 10000)), 10000, "paid", "2026-10-31 04:00:00", "2026-10-20 02:00:00", 4, "service");
    inv.run(13, "INV-B2", items(line("Live", 10000)), 10000, "paid", "2026-11-01 04:00:00", "2026-10-20 02:00:00", 4, "service");
    await confirm(12, 10000); await confirm(13, 10000);
    ok(!one(12) && one(13)?.amount_cents === 1000 && one(13).status === "eligible", "B: paid 31-10 earns nothing; paid 01-11 earns RM 10.00 under v1");
    inv.run(14, "INV-B3", items(line("Live", 15000)), 15000, "unpaid", null, "2026-10-20 02:00:00", 4, "service");
    db.exec(`INSERT INTO invoice_payments (invoice_id, amount_cents, received_on, method, created_by) VALUES (14, 10000, '2026-10-25', 'bank_transfer', 1)`);
    ok((await call("/commission/invoice/14", 1)).j?.next === "await_balance", "B: part paid - next: collect the balance");
    await call(`/docs/14/payments`, 1, "POST", { amount_cents: 5000, received_on: "2026-11-03" });
    await call(`/docs/14`, 1, "PATCH", { payment_status: "paid", paid_on: "2026-11-03" });
    ok((await call("/commission/invoice/14", 1)).j?.next === "confirm_paid", "B: paid in full - next: CEO/COO confirm");
    await confirm(14, 15000);
    ok(one(14)?.amount_cents === 1500, "B: a split payment earns on the whole invoice, by the day it was paid in full (owner: keep)", JSON.stringify(one(14)));

    /* C - once; a confirmed payment day is locked */
    ok((await confirm(13, 10000)).status === 409 && led("invoice_id = 13").length === 1, "C: a second confirmation is refused - one entitlement");
    const re = await call(`/docs/13`, 2, "PATCH", { payment_status: "paid", paid_on: "2026-10-30" }); // v1.234.0 - the COO (the Admin account no longer marks paid)
    ok(re.status === 409 && re.j?.error?.code === "confirmed_locked" && db.prepare(`SELECT paid_at FROM sales_documents WHERE id = 13`).get().paid_at.startsWith("2026-11-01"), "C: re-dating a confirmed invoice is refused (F5)", `${re.status} ${JSON.stringify(re.j)}`);

    /* D - the CCO reviews only, by direct request */
    inv.run(15, "INV-D", items(line("Live", 10000)), 10000, "paid", "2026-11-03 04:00:00", "2026-11-01 02:00:00", 5, "service");
    ok((await confirm(15, 10000, 3)).status === 403, "D: the CCO cannot confirm Paid");
    ok((await call(`/payroll/paid`, 3, "POST", { month: "2026-11" })).status === 403, "D: the CCO cannot record the bank run");
    ok((await call(`/payroll/release`, 3, "POST", { month: "2026-11" })).status === 403, "D: the CCO cannot release payslips");
    ok((await call(`/commission/ledger/${one(13).id}/decide`, 3, "POST", { decision: "settle", note: "The CCO tries to settle" })).status === 403, "D: the CCO cannot decide or settle");
    ok((await call(`/commission/settings`, 3, "POST", { sync: "off", reason: "The CCO tries the switch" })).status === 403, "D: the CCO cannot touch the payroll switch");
    ok((await call(`/commission/flow`, 3)).status === 200 && (await call(`/commission/invoice/10`, 3)).status === 200, "D: the CCO reads the flow and any invoice");
    ok((await confirm(15, 10000, 5)).status === 403, "D: no one confirms their own sale");
    await confirm(15, 10000, 2);

    /* E - two monthly invoices, two entitlements */
    inv.run(16, "INV-E1", items(line("AZ Monthly Care", 39900)), 39900, "paid", "2026-11-03 04:00:00", "2026-11-01 02:00:00", 4, "service");
    inv.run(17, "INV-E2", items(line("AZ Monthly Care", 39900)), 39900, "paid", "2026-11-04 01:00:00", "2026-11-02 02:00:00", 4, "service");
    await confirm(16, 39900); await confirm(17, 39900); await confirm(16, 39900);
    await call("/commission/entries?scope=all", 1); await call("/commission/flow", 1);
    ok(led("invoice_id IN (16, 17)").length === 2 && one(16).amount_cents === 3990 && one(17).amount_cents === 3990, "E: two paid monthly invoices - two entitlements; replays and reads add nothing");

    /* F - products earn only when listed; a library package rule */
    inv.run(18, "INV-F1", items(line("MOCHA", 4500, 2, "ELFIA001")), 9000, "paid", "2026-11-03 04:00:00", "2026-11-01 02:00:00", 4, "product");
    await confirm(18, 9000);
    ok(one(18)?.amount_cents === 0 && one(18).status === "void" && /Nothing to earn/.test(one(18).note ?? ""), "F: an unlisted product earns nothing - recorded void with the reason, not eligible", JSON.stringify(one(18)));
    inv.run(19, "INV-F2", items(line("Shooting", 20000), line("MOCHA", 4500, 2, "ELFIA001")), 29000, "paid", "2026-11-03 04:00:00", "2026-11-01 02:00:00", 4, "service");
    const iF = (await call("/commission/invoice/19", 1)).j;
    ok(iF?.lines?.find((l) => l.name === "MOCHA")?.rule === "not_listed" && iF.estimate_cents === 2000, "F: a mixed invoice earns on the service only; the product line says why", JSON.stringify(iF?.lines));
    await confirm(19, 29000);
    ok(one(19)?.amount_cents === 2000, "F: confirmed, the service RM 200 earns RM 20.00");
    ok((await call("/commission/policy", 2, "POST", { name: "Bad pkg", effective_from: "2026-11-10", rate_pct: 10, reason: "A package that is not there", packages: [{ package_id: 999, rule: "percent", rate_pct: 5 }] })).status === 400, "F: a rule naming a missing library package is refused");
    const d2 = await call("/commission/policy", 2, "POST", { name: "A2Z Sales Commission v2", effective_from: "2026-11-10", rate_pct: 10, reason: "Growth Bundle at 5 percent, MOCHA listed",
      packages: [{ package_id: 3, rule: "percent", rate_pct: 5 }, { name: "MOCHA", rule: "fixed", fixed_cents: 500 }] });
    ok(d2.status === 201 && db.prepare(`SELECT match_key FROM commission_policy_packages WHERE policy_id = ? ORDER BY id`).all(d2.j.id).map((r) => r.match_key).join() === "pkg:3,mocha", "F: a draft rule may name a library package (stored as pkg:<id>)");
    await call(`/commission/policy/${d2.j?.id}/approve`, 1, "POST", { confirm: true });
    at("2026-11-12T02:00:00Z");
    inv.run(20, "INV-F3", items(line("TikTok LIVE x12", 90000), line("Ring light", 10000)), 100000, "paid", "2026-11-12 01:00:00", "2026-11-10 02:00:00", 4, "service");
    db.exec(`UPDATE sales_documents SET package_id = 3 WHERE id = 20`);
    inv.run(21, "INV-F4", items(line("MOCHA", 4500, 2, "ELFIA001")), 9000, "paid", "2026-11-12 01:00:00", "2026-11-10 02:00:00", 4, "product");
    await confirm(20, 100000); await confirm(21, 9000);
    ok(one(20)?.amount_cents === 5000, "F: an invoice made from the library package earns its rule on every line (5% of RM 1,000)", JSON.stringify(one(20)));
    ok(one(21)?.amount_cents === 1000 && one(21).status === "eligible", "F: a listed product earns its rule (RM 5.00 x 2)");

    /* J - a new version leaves old entitlements alone */
    ok(one(13).amount_cents === 1000 && one(13).policy_id === d1.j.id && one(18).status === "void", "J: entitlements under v1 keep v1 and their amounts");

    /* I - a leaver: Rina's sale, confirmed, then she leaves */
    inv.run(22, "INV-I", items(line("Live", 30000)), 30000, "paid", "2026-11-05 04:00:00", "2026-11-01 02:00:00", 9, "service");
    await confirm(22, 30000);
    db.exec(`UPDATE users SET left_on = '2026-11-15' WHERE id = 9`);

    /* G - payroll */
    at("2026-11-20T02:00:00Z");
    let before = snap();
    await call(`/payroll/commission-sources?month=2026-11`, 1);
    ok(snap() === before, "G: opening payroll (a GET) attaches nothing (F1)");
    await save(4, "2026-11");
    const aina = led("user_id = 4 AND status != 'void'");
    ok(aina.every((r) => r.status === "included" && r.payroll_month === "2026-11") && led("user_id = 5").every((r) => r.status === "eligible" && !r.payroll_month), "G: saving Aina's payroll takes only Aina's entitlements (F1)", snap());
    const ainaSum = aina.reduce((a, r) => a + r.amount_cents, 0);
    ok(slip(4, "2026-11") === ainaSum, "G: her payslip carries exactly the ledger's sum", `${slip(4, "2026-11")} vs ${ainaSum}`);
    await save(4, "2026-11"); await call("/payroll/recompute", 1, "POST", { month: "2026-11" }); await call("/payroll/recompute", 1, "POST", { month: "2026-11" });
    ok(slip(4, "2026-11") === ainaSum && led("user_id = 4 AND status = 'included'").length === aina.length, "G: Save again and Recompute twice - still once");
    const leftRow = one(22);
    ok(leftRow.status === "eligible" && !leftRow.payroll_month, "I: the leaver's commission is not taken by anyone else's payroll");
    /* a sale confirmed after Aina's November Save: eligible, in no month yet */
    inv.run(24, "INV-G3", items(line("Live", 10000)), 10000, "paid", "2026-11-19 04:00:00", "2026-11-10 02:00:00", 4, "service");
    await confirm(24, 10000);
    before = snap();
    await save(4, "2026-12"); await call(`/payroll/commission-sources?month=2026-12`, 1);
    ok(snap() === before, "G: a future month takes nothing (F3)");
    await save(5, "2026-11");
    ok(led("user_id = 5").every((r) => r.status === "included" && r.payroll_month === "2026-11") && slip(5, "2026-11") === 1000, "G: Hafiz's own Save takes his", snap());
    /* a payslip that does not carry what the ledger gave the month
       (simulated - the fault the bank run must never pay) */
    db.exec(`UPDATE payroll_entries SET commission_cents = 0 WHERE user_id = 5 AND month = '2026-11'`);
    fl = (await call("/commission/flow", 1)).j;
    ok(fl.exceptions.not_on_payslip?.n === 1 && fl.exceptions.not_on_payslip.cents === 1000, "G: the flow shows commission in payroll but not on the payslip", JSON.stringify(fl.exceptions));
    const ents = (await call("/commission/entries?scope=all", 1)).j.entries;
    ok(ents.find((e) => e.invoice_id === 15)?.next === "recompute_payroll" && ents.find((e) => e.invoice_id === 13)?.next === "await_bank_run" && ents.find((e) => e.invoice_id === 22)?.next === "settle_leaver" && ents.find((e) => e.invoice_id === 18)?.next === "none", "G: each entitlement names its next step", JSON.stringify(ents.map((e) => [e.invoice_id, e.next])));

    /* I - settle */
    ok((await call(`/commission/ledger/${leftRow.id}/decide`, 4, "POST", { decision: "settle", note: "Not mine to settle at all" })).status === 403, "I: a consultant cannot settle");
    ok((await call(`/commission/ledger/${leftRow.id}/decide`, 1, "POST", { decision: "settle", note: "short" })).status === 400, "I: settling needs a reason");
    ok((await call(`/commission/ledger/${one(24).id}/decide`, 1, "POST", { decision: "settle", note: "Not a leaver - must refuse" })).status === 409, "I: only a leaver's unpaid eligible commission is settled");
    const st = await call(`/commission/ledger/${leftRow.id}/decide`, 1, "POST", { decision: "settle", note: "Paid in Rina's final settlement, ref FS-11" });
    ok(st.status === 200 && one(22).status === "paid" && one(22).amount_cents === 30000 * 0.1 && /^settle: /.test(one(22).decision_note) && !one(22).payroll_month, "I: the CEO records it paid in the final settlement - never voided, amount kept (F6)", JSON.stringify(one(22)));
    ok((await call(`/commission/ledger/${leftRow.id}/decide`, 1, "POST", { decision: "settle", note: "Paid in Rina's final settlement again" })).status === 409, "I: settled once only");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'commission.settle'`).get().n === 1, "I: the settlement is audited");

    /* G - the bank run pays only what the payslip carries (F2) */
    at("2026-12-05T06:00:00Z");
    const bank = await call(`/payroll/paid`, 1, "POST", { month: "2026-11" });
    ok(bank.status === 200 && bank.j?.commission?.held === 1 && led("user_id = 4 AND status = 'paid'").length === aina.length && led("user_id = 5").every((r) => r.status === "included"), "G: the bank run pays Aina, holds what Hafiz's payslip does not carry (F2)", `${bank.status} ${JSON.stringify(bank.j)} ${snap()}`);
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'commission.paid_held'`).get().n === 1, "G: the hold is audited");

    /* H - a refund after payout: review, never taken from wages */
    await call("/docs/16/credit-note", 1, "POST", { amount_cents: 39900, reason: "Customer refunded" });
    const rv = led("invoice_id = 16 AND kind = 'reverse'");
    ok(rv.length === 1 && rv[0].status === "review" && one(16).status === "paid", "H: a credit note after payout opens a reversal for review; the paid row stays");
    ok((await call(`/commission/ledger/${rv[0].id}/decide`, 1, "POST", { decision: "apply", note: "Take it from December wages" })).status === 409, "H: it cannot be applied against wages already paid");

    /* G - a month whose payslips are out by time takes nothing new (F4) */
    at("2026-12-10T02:00:00Z");
    inv.run(23, "INV-G4", items(line("Live", 30000)), 30000, "paid", "2026-12-30 04:00:00", "2026-12-01 02:00:00", 4, "service");
    at("2027-01-07T02:00:00Z"); // December payslips visible from 05-01-2027, no release row
    await confirm(23, 30000);
    await save(4, "2026-12");
    ok(one(23)?.status === "eligible" && !one(23).payroll_month, "G: December's payslips are out - a late row is not added to December (F4)", JSON.stringify(one(23)));
    await save(4, "2027-01");
    ok(one(23)?.payroll_month === "2027-01" && one(23).status === "included" && one(24)?.payroll_month === "2027-01", "G: it carries forward to January, with the November row no payroll took");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

/* ---- source ---- */
function source() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
  const mig = read("worker/migrations/0154_commission_product_rule.sql").replace(/^--.*$/gm, "");
  ok(/ALTER TABLE commission_policies ADD COLUMN product_rule TEXT NOT NULL DEFAULT 'listed_only'/.test(mig) && !/\b(UPDATE|DELETE|DROP|INSERT)\b/i.test(mig), "0154 only adds the product rule column, defaulting to the owner's rule");
  ok(/"0154_commission_product_rule"/.test(read("worker/src/index.ts")), "0154 is registered");
  const panel = read("components/portal/commission-panel.tsx");
  ok(!/d\.stages/.test(panel) && /d\.invoices/.test(panel) && /d\.entitlements/.test(panel), "the Overview reads invoices and entitlements as two rows");
  ok(/e\.next === "settle_leaver"/.test(panel) && /d\.can_decide && e\.next === "settle_leaver"/.test(panel), "the settle button shows only to those who may decide, only for a leaver");
  ok(!/commission_cents\s*:/.test(panel), "the panel never sends a commission amount");
  return out;
}

let fail = 0, n = 0;
const report = (list, tag = "") => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${tag}${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "commflow-"));
bundle(root, join(dir, "staff.mjs"));
report(await runtime(join(dir, "staff.mjs")));
report(source());

/* mutations - each must fail a runtime check */
const MUT = [
  ["staff.ts", "Save attaches everyone (F1)", "{ include: [Number(body.user_id)], released: await payslipsOut(month) }", "{ include: (await env.DB.prepare(`SELECT id FROM users`).all()).results.map((r) => r.id), released: await payslipsOut(month) }"],
  ["staff.ts", "a GET attaches everyone (F1)", "{ include: null, released: await payslipsOut(mS) }", "{ include: (await env.DB.prepare(`SELECT id FROM users`).all()).results.map((r) => r.id), released: await payslipsOut(mS) }"],
  ["commission.ts", "a future month takes rows (F3)", "if (ids.length && month <= mytToday().slice(0, 7)) {", "if (ids.length) {"],
  ["commission.ts", "a time-released month takes rows (F4)", "  if (opts.released) return null;\n", ""],
  ["commission.ts", "the bank run pays what no payslip carries (F2)", "WHERE payroll_month = ?1 AND status = 'included'\n          AND user_id IN", "WHERE payroll_month = ?1 AND status = 'included'\n          AND 1 OR user_id IN"],
  ["staff.ts", "a confirmed invoice may be re-dated (F5)", "if (live && live.day !== paidOn) {", "if (false) {"],
  ["commission.ts", "products earn the default rate", "} else if (listedOnly && isProduct(l)) {", "} else if (false) {"],
  ["commission.ts", "a library package rule is ignored", "const whole = inv.doc_package_id ? byKey.get(pkgKey(Number(inv.doc_package_id))) : undefined;", "const whole = undefined;"],
  ["commission.ts", "anyone eligible may be settled", "AND u.left_on IS NOT NULL AND substr(u.left_on, 1, 10) < ?2 AND (u.rejoined_on IS NULL OR substr(u.rejoined_on, 1, 10) > ?2)`,\n      ).bind(id, today)", "`,\n      ).bind(id)"],
];
const srcs = { "staff.ts": readFileSync(join(root, "worker/src/staff.ts"), "utf8"), "commission.ts": readFileSync(join(root, "worker/src/commission.ts"), "utf8") };
for (const [file, name, from, to] of MUT) {
  n++;
  if (!srcs[file].includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "commflow-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, `worker/src/${file}`), srcs[file].replace(from, to));
  try { bundle(mdir, join(mdir, "staff.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "staff.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`commission-flow: ${fail} of ${n} failed`); process.exit(1); }
console.log(`commission-flow: ${n} checks passed (${MUT.length} mutations caught) - invoices to payroll, once; the CCO reviews only; products only when listed; leavers settled`);
