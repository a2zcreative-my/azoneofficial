/* DEPOSIT BILLING (v1.273.0). Runtime guard: the WHOLE worker (index.ts,
 * bundled) against SQLite with every migration applied, by direct request
 * (the CEO, 10-11-2026: "Build deposit billing" - any % or amount, service
 * quotations only, commission per paid invoice, the RM 75 / RM 37.50 case
 * counted as its 50% deposit).
 *
 *   parts      a service quotation is invoiced as a deposit (a share or an
 *              amount), progress and the balance; never past its total, even
 *              when two invoices are raised at the same moment; a voided part
 *              frees its amount again; each part keeps the quotation's line
 *              names and its lines add up to exactly what it bills
 *   product    a product quotation is still ONE invoice; a part is refused
 *   edit       an invoice billed alongside others cannot be edited past the
 *              quotation; the server stamps its share on every edit
 *   the case   an invoice converted whole and then edited down (RM 75 -> RM
 *              37.50) is the deposit: the balance can be invoiced from it
 *   seen       the quotation row says how much is invoiced and in how many
 *              invoices; the Sales summary counts what is left to invoice
 *   commission each paid and confirmed part earns on its own share: a percent
 *              on its own basis, a fixed amount only its share, rounded down
 *              - the parts never earn more than the whole sale
 *   schema     0182 keeps one live invoice per PRODUCT quotation (index); the
 *              0157 index that held it for every quotation is gone
 * Then mutated copies must each fail a check. Invented people only.
 *
 *   node tests/deposit-billing.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently, or a column 0081 already made */ } }
  }
  /* a race: both requests read what is billed before either writes */
  let barrier = null;
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => {
      if (barrier && sql.includes(barrier.sql)) { const got = st.get(...b) ?? null; barrier.n++; if (barrier.n >= 2) barrier.go(); await barrier.p; return got; }
      return st.get(...b) ?? null;
    }, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  /* invented people: 1 the CEO (owner), 3 COO, 6 CCO (the closer), 9 sales */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'${SECRET}'),
    (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'${SECRET}'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'${SECRET}'),
    (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'${SECRET}'),
    (9,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  db.exec(`INSERT INTO commission_policies (id, version, name, status, effective_from, rate_kind, rate_bp, basis, reason, created_by, approved_by, approved_at)
           VALUES (1, 1, 'Sales commission 2026', 'active', '2026-11-01', 'percent', 1000, 'net_of_tax_delivery', 'Approved 10 percent', 1, 1, '2026-10-30 02:00:00')`);
  /* a FIXED rule on one package line: RM 20.00 per video, whatever the price */
  db.exec(`INSERT INTO commission_policy_packages (policy_id, package_name, match_key, rule, rate_bp, fixed_cents) VALUES (1, 'Video', 'video', 'fixed', NULL, 2000)`);
  db.exec(`INSERT INTO customers (id, company) VALUES (1, 'Ayam Client Sdn Bhd')`);
  const qt = (id, kind, items, { discount = 0, tax = 0, sp = 6 } = {}) => {
    const sub = items.reduce((a, l) => a + l.qty * l.unit_price_cents, 0);
    const total = Math.round((sub - discount) * (1 + tax / 100));
    db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, created_at, created_by, salesperson_id, kind, issuer_code, revision)
                VALUES (?, 'QT', ?, 1, ?, ?, ?, ?, '2026-11-09 03:00:00', 6, ?, ?, 'a2z', 0)`).run(id, `QT-T-${id}`, JSON.stringify(items), discount, tax, total, sp, kind);
    return total;
  };
  qt(301, "service", [{ name: "Video", qty: 1, unit_price_cents: 7500, sub: ["Video 30 saat"] }]);
  qt(302, "product", [{ name: "Banner", qty: 1, unit_price_cents: 10000 }]);
  qt(303, "service", [{ name: "Website", qty: 1, unit_price_cents: 10000 }]);
  qt(304, "service", [{ name: "Website", qty: 1, unit_price_cents: 10000 }]);
  qt(305, "service", [{ name: "Post", qty: 3, unit_price_cents: 1000 }, { name: "Logo", qty: 1, unit_price_cents: 2500 }], { discount: 500 });
  qt(306, "service", [{ name: "Logo", qty: 1, unit_price_cents: 10000 }], { tax: 8 });
  qt(307, "service", [{ name: "Video Promosi Produk", qty: 1, unit_price_cents: 7500 }]);
  qt(308, "service", [{ name: "Logo", qty: 1, unit_price_cents: 20000 }]);

  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-10T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 3, 6, 9]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const conv = (q, body = {}, who = 6) => call(`/docs/${q}/convert`, who, "POST", body);
  const doc = (id) => db.prepare(`SELECT * FROM sales_documents WHERE id = ?`).get(id);
  const lines = (id) => JSON.parse(doc(id).items);
  const lineSum = (id) => lines(id).reduce((a, l) => a + l.qty * l.unit_price_cents, 0);
  const live = (q) => db.prepare(`SELECT id, total_cents FROM sales_documents WHERE converted_from = ? AND doc_type = 'INV' AND COALESCE(payment_status, '') != 'void' ORDER BY id`).all(q);
  const billed = (q) => live(q).reduce((a, r) => a + r.total_cents, 0);
  const row = async (q) => (await call("/docs?type=QT", 6)).j?.docs?.find((d) => d.id === q);
  const earn = (inv) => db.prepare(`SELECT user_id, amount_cents FROM commission_ledger WHERE invoice_id = ? AND kind = 'earn' AND status != 'void'`).all(inv);
  const payAndConfirm = async (inv) => {
    const p = await call(`/docs/${inv}`, 1, "PATCH", { payment_status: "paid", payment_method: "bank_transfer", paid_on: "2026-11-10" });
    const c = await call(`/docs/${inv}/confirm-paid`, 1, "POST", { amount_cents: doc(inv).total_cents, checked: true, payment_ref: `MBB-${inv}` });
    return [p.status, c.status];
  };

  try {
    /* ---------- schema ---------- */
    ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ux_inv_live_per_product_qt'`).get(), "0182 holds one live invoice per PRODUCT quotation");
    ok(!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ux_inv_live_per_qt'`).get(), "the 0157 index that held it for every quotation is gone");

    /* ---------- a deposit, then the balance ---------- */
    const d1 = await conv(301, { share_bp: 5000 });
    const i1 = d1.j?.id;
    ok(d1.status === 201 && doc(i1)?.total_cents === 3750 && d1.j?.left_cents === 3750, "a 50% deposit invoice of the RM 75.00 quotation bills RM 37.50", d1.text.slice(0, 200));
    ok(/^Deposit 50% of QT-T-301$/.test(doc(i1).reference ?? ""), "it says it is the 50% deposit of the quotation", doc(i1).reference);
    ok(lines(i1)[0].name === "Video" && lineSum(i1) === 3750 && lines(i1)[0].sub?.[0] === "Video 30 saat", "it keeps the quotation's line (name and package text) at its share");
    ok(lines(i1)[0].part_cents === 3750 && lines(i1)[0].part_of_cents === 7500, "it carries its share of the quotation for commission");
    const r1 = await row(301);
    ok(r1?.invoiced_cents === 3750 && r1?.invoice_count === 1, "the quotation row says RM 37.50 invoiced in 1 invoice", JSON.stringify(r1 ?? {}).slice(0, 200));
    const sm = await call("/docs/summary", 1);
    ok(sm.j?.to_invoice?.n >= 1 && sm.j?.to_invoice?.cents >= 3750, "the Sales summary counts what is left to invoice", JSON.stringify(sm.j?.to_invoice));
    const over = await conv(301, { amount_cents: 4000 });
    ok(over.status === 400 && over.j?.error?.code === "over_quotation" && over.j?.left_cents === 3750, "an invoice past what is left is refused before anything is written, saying RM 37.50 is left", over.text.slice(0, 200));
    ok((await conv(301, { share_bp: 0 })).status === 400 && (await conv(301, { amount_cents: 12.5 })).status === 400, "a share of 0 or a fraction of a sen is refused");
    const d2 = await conv(301);
    const i2 = d2.j?.id;
    ok(d2.status === 201 && doc(i2)?.total_cents === 3750 && /^Balance 50% of QT-T-301$/.test(doc(i2).reference ?? "") && billed(301) === 7500, "with no amount the balance is invoiced: RM 37.50, named the balance", d2.text.slice(0, 200));
    ok((await conv(301)).j?.error?.code === "already_invoiced", "a fully invoiced quotation offers no more");

    /* ---------- a product quotation stays one invoice ---------- */
    ok((await conv(302, { share_bp: 5000 })).status === 400, "a product quotation is never billed in parts");
    const p1 = await conv(302);
    ok(p1.status === 201 && doc(p1.j.id).total_cents === 10000, "a product quotation is invoiced whole, as before", p1.text.slice(0, 160));
    ok((await conv(302)).j?.error?.code === "already_invoiced", "...and only once");

    /* ---------- two parts at the same moment ---------- */
    { let go; const p = new Promise((r) => { go = r; }); barrier = { n: 0, p, go, sql: "SELECT COALESCE(SUM(total_cents), 0) AS c FROM sales_documents WHERE converted_from = ?1 AND doc_type = 'INV'" }; }
    const race = await Promise.all([conv(303, { share_bp: 6000 }), conv(303, { share_bp: 6000 })]);
    barrier = null;
    ok(race.map((r) => r.status).sort().join() === "201,409" && billed(303) === 6000 && race.some((r) => r.j?.error?.code === "over_quotation"), "two 60% invoices raised at once: one is made, the other refused", race.map((r) => `${r.status} ${r.text.slice(0, 80)}`).join(" | "));
    const v = await call(`/docs/${live(303)[0].id}/void`, 6, "POST", { reason: "Raised by mistake for the test" });
    ok(v.status === 200 && billed(303) === 0 && (await conv(303, { share_bp: 6000 })).status === 201, "voiding a part frees its amount again", v.text.slice(0, 120));

    /* ---------- editing a part ---------- */
    await conv(304, { share_bp: 5000 });
    const b = await conv(304, { share_bp: 3000 });
    const edit = (id, cents) => call(`/docs/${id}/edit`, 6, "POST", { items: [{ name: "Website", qty: 1, unit_price_cents: cents }], customer_id: 1, salesperson_id: 6, discount_cents: 0, tax_percent: 0 });
    const e1 = await edit(b.j.id, 6000);
    ok(e1.j?.error?.code === "over_quotation" && doc(b.j.id).total_cents === 3000, "an edit that takes the parts past the quotation is refused", e1.text.slice(0, 160));
    const e2 = await edit(b.j.id, 5000);
    ok(e2.status === 200 && doc(b.j.id).total_cents === 5000 && lines(b.j.id)[0].part_cents === 5000 && lines(b.j.id)[0].part_of_cents === 10000, "an edit within it is saved, and the server stamps the new share", e2.text.slice(0, 160));

    /* ---------- several lines, a discount, a tax ---------- */
    const m = await conv(305, { share_bp: 3333 });
    ok(m.status === 201 && doc(m.j.id).total_cents === 1667 && lineSum(m.j.id) === 1667 && lines(m.j.id).map((l) => l.name).join() === "Post,Logo", "33.33% of RM 50.00 (two lines, a discount) bills RM 16.67 and its lines add up to exactly that", JSON.stringify(lines(m.j.id)));
    const t = await conv(306, { share_bp: 5000 });
    ok(t.status === 201 && doc(t.j.id).total_cents === 5400 && lineSum(t.j.id) === 5000 && doc(t.j.id).tax_percent === 8, "50% of RM 108.00 with 8% tax: RM 50.00 + tax = RM 54.00, exactly", JSON.stringify(doc(t.j.id)).slice(0, 200));
    let gap = null;
    for (let a = 100; a < 5000 && gap === null; a++) if (![a - 2, a - 1, a, a + 1, a + 2].map((x) => Math.round(Math.round(a / 1.08 + (x - a)) * 1.08)).includes(a)) gap = a;
    if (gap !== null) ok((await conv(306, { amount_cents: gap })).status === 400, "an amount that 8% tax cannot reach to the sen is refused, with the nearest amounts");

    /* ---------- the RM 75 / RM 37.50 case ---------- */
    const w = await conv(307);
    const ew = await call(`/docs/${w.j.id}/edit`, 6, "POST", { items: [{ name: "Pembayaran 50% : Video Promosi Produk", qty: 1, unit_price_cents: 3750 }], customer_id: 1, salesperson_id: 6, discount_cents: 0, tax_percent: 0 });
    ok(ew.status === 200 && doc(w.j.id).total_cents === 3750, "an invoice converted whole and edited to RM 37.50 (as on 09-11)", ew.text.slice(0, 160));
    const r7 = await row(307);
    ok(r7?.invoiced_cents === 3750 && r7?.invoiced_as, "the quotation shows RM 37.50 of RM 75.00 invoiced");
    const bal = await conv(307);
    ok(bal.status === 201 && doc(bal.j.id).total_cents === 3750 && billed(307) === 7500 && lines(bal.j.id)[0].name === "Video Promosi Produk", "the balance RM 37.50 is invoiced from it, with the quotation's own line", bal.text.slice(0, 200));
    /* v1.300.0 (the CEO, 13-11-2026: "only 1 invoice appear recorded while the other one was not appear") */
    const r7b = await row(307), inv1 = doc(w.j.id).doc_number, inv2 = doc(bal.j.id).doc_number;
    ok(r7b?.invoice_count === 2 && r7b?.invoiced_list === `${inv1} + ${inv2}`, "the fully invoiced quotation names BOTH invoices, oldest first - not only the latest", JSON.stringify({ list: r7b?.invoiced_list, inv1, inv2 }));
    const qp = await call("/projects/by-quotation/307", 6);
    ok(qp.status === 200 && qp.j?.quotation_state?.invoice === `${inv1} + ${inv2}` && qp.j?.quotation_state?.label === "invoiced", "the quotation page names both invoices too", qp.text.slice(0, 240));
    const invs = (await call("/docs?type=INV", 6)).j?.docs ?? [];
    const i7a = invs.find((d) => d.id === w.j.id), i7b = invs.find((d) => d.id === bal.j.id);
    ok(i7a?.converted_from_number === doc(307).doc_number && i7b?.converted_from_number === doc(307).doc_number && i7a.part_no === 1 && i7a.part_of === 2 && i7b.part_no === 2 && i7b.part_of === 2, "each invoice says which quotation it came from and which part it is (1 of 2, 2 of 2)", JSON.stringify([i7a?.converted_from_number, i7a?.part_no, i7a?.part_of, i7b?.part_no, i7b?.part_of]));

    /* ---------- commission per paid part ---------- */
    ok((await payAndConfirm(i1)).join() === "200,201" && (await payAndConfirm(i2)).join() === "200,201", "both parts of QT-T-301 are paid and confirmed");
    const f1 = earn(i1), f2 = earn(i2);
    ok(f1.length === 1 && f1[0].amount_cents === 1000 && f2.length === 1 && f2[0].amount_cents === 1000, "a fixed RM 20.00 rule pays each 50% part RM 10.00 - RM 20.00 for the sale, not RM 40.00", JSON.stringify([f1, f2]));
    const g1 = await conv(308, { share_bp: 4000 }), g2 = await conv(308);
    await payAndConfirm(g1.j.id); await payAndConfirm(g2.j.id);
    const h = [...earn(g1.j.id), ...earn(g2.j.id)].map((r) => r.amount_cents);
    ok(h.join() === "800,1200", "10% on a 40% part (RM 8.00) and on the 60% balance (RM 12.00): RM 20.00, 10% of the sale", JSON.stringify(h));
    ok(earn(i1)[0].user_id === 6, "the closer of the quotation earns it");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "dep-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;

const S = "worker/src/staff.ts", C = "worker/src/commission.ts";
const MUT = [
  ["worker/src/projects.ts", "the quotation page names only the latest invoice", [["`SELECT GROUP_CONCAT(doc_number, ' + ') AS list FROM (SELECT doc_number FROM sales_documents WHERE doc_type = 'INV' AND converted_from = ?1 AND COALESCE(payment_status, '') != 'void' ORDER BY id)`", "`SELECT doc_number AS list FROM sales_documents WHERE doc_type = 'INV' AND converted_from = ?1 AND COALESCE(payment_status, '') != 'void' ORDER BY id DESC LIMIT 1`"]]],
  [S, "only the latest invoice named on the quotation", [["COALESCE(i.payment_status, '') != 'void' ORDER BY i.id) x) AS invoiced_list", "COALESCE(i.payment_status, '') != 'void' ORDER BY i.id DESC LIMIT 1) x) AS invoiced_list"]]],
  [S, "an invoice forgets its quotation", [["(SELECT q.doc_number FROM sales_documents q WHERE q.id = d.converted_from) AS converted_from_number", "NULL AS converted_from_number"]]],
  [S, "the sum rule is not in the insert", [["? `(SELECT COALESCE(SUM(x.total_cents), 0) FROM sales_documents x WHERE x.converted_from = ?11 AND x.doc_type = 'INV' AND COALESCE(x.payment_status, '') != 'void') + ?7 <= ${qtTotalC}`", "? `1 = 1`"]]],
  [S, "a product quotation is billed in parts", [["    if (!splitQ && (askShare !== undefined || askAmount !== undefined)) {", "    if (false) {"]]],
  [S, "more than is left is accepted", [["    if (splitQ && billC > leftQ) {", "    if (false) {"]]],
  [S, "a part copies the whole quotation", [["    const wholeQ = !splitQ || (billedQ === 0 && billC === qtTotalC);", "    const wholeQ = true;"]]],
  [S, "the remainder is not spread", [["  for (let k = 0; short > 0 && order.length; k = (k + 1) % order.length, short--) parts[order[k]![1]]! += 1;", "  void order; void short;"]]],
  [S, "an edit passes the quotation", [["      if (sibE && Number(sibE.n) > 0 && Number(sibE.others) + totalE > Number(sibE.qt_total)) {", "      if (false) {"]]],
  [S, "an edit keeps the form's share", [["        for (const l of itemsE as Array<Record<string, unknown>>) { l.orig_qty = l.qty; l.part_cents = totalE; l.part_of_cents = Number(sibE.qt_total); }", "        void itemsE;"]]],
  [S, "nothing to invoice is counted", [["          WHERE q.doc_type = 'QT' AND q.kind = 'service' AND b.billed < q.total_cents", "          WHERE 1 = 0"]]],
  [S, "every service quotation is invoiced once", [["    if (already && !splitQ) return err(\"already_invoiced\"", "    if (already) return err(\"already_invoiced\""]]],
  [C, "a fixed rule pays in full on every part", [["  const fixedShare = (x: number) => (isPart ? Math.floor((x * partC) / partOf) : x);", "  const fixedShare = (x: number) => x;"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "dep-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`deposit-billing: ${fail} of ${n} failed`); process.exit(1); }
console.log(`deposit-billing: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - a service quotation is billed in parts, never past its total; commission per paid part, never more than the sale`);
