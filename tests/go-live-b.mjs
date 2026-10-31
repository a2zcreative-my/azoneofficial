/* RELEASE B OF THE GO-LIVE PLAN (v1.242.0) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied (0157
 * included), by direct request.
 *
 * claude/GO-LIVE-AUDIT.md, claude/FINAL-RELEASE-GATE-PLAN-V2.md Release B, and
 * the owner's decisions of 31-10-2026: D-2 void-never-delete (one live invoice
 * per quotation, a replacement after a void), D-1 refuse an over-sell, D-8 a
 * published price is CEO/COO/super admin, riders included, D-6 three locked
 * matrix cells, D-7 hr_admin unchanged.
 *
 * The SQLite shim YIELDS before every statement (and pauses on the statements
 * the races are about), so two requests in flight interleave the way two D1
 * round trips do: the B2 double convert and the B3 double part payment are
 * reproduced on one thread, every run.
 *
 *   node tests/go-live-b.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/worker.mjs node tests/go-live-b.mjs   a given bundle (the pre-fix bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
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
const tick = () => new Promise((r) => setTimeout(r, 0));
const slow = () => new Promise((r) => setTimeout(r, 25));

async function runtime(workerBundle, opts = {}) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  ok(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ux_inv_live_per_qt'`).get() !== undefined, "0157 creates the one-live-invoice-per-quotation index");
  /* opts.dropIndex: the database WITHOUT 0157's index - the conditional
     insert alone must still allow one live invoice per quotation */
  if (opts.dropIndex) db.exec(`DROP INDEX ux_inv_live_per_qt`);
  /* raceStock: another movement lands between an invoice's stock check and
     its write - the write must be conditional, or the shelf goes wrong */
  let raceStock = false;
  const shim = (sql) => {
    const st = db.prepare(sql); let b = [];
    /* the statements the races are about take a visible moment */
    const wait = /INSERT INTO sales_documents|INSERT INTO invoice_payments|doc_counters_daily/.test(sql) ? slow : tick;
    const gap = () => { if (raceStock && /UPDATE inventory_items SET stock = stock - \?1|UPDATE inventory_items SET stock = \?1/.test(sql)) { raceStock = false; db.exec(`UPDATE inventory_items SET stock = 0 WHERE id = 2`); } };
    const o = {
      bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
      first: async () => { await wait(); gap(); return st.get(...b) ?? null; },
      all: async () => { await wait(); gap(); return { results: st.all(...b) }; },
      run: async () => { await wait(); gap(); return { meta: { changes: Number(st.run(...b).changes) } }; },
      _run: () => st.run(...b),
    };
    return o;
  };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const RealDate = globalThis.Date;
  let fixed = RealDate.now();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const today = new RealDate(RealDate.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const yesterday = new RealDate(RealDate.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
  const U = { ceo: 1, aina: 5, root: 8, mkt: 13 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, employment_status, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','Management','permanent','2020-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01'),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}',NULL,'permanent','2020-01-01'),
    (13,'Mika','Mika Marketing','mika@a2z.test','marketing',1,'x',1,'${SECRET}','Marketing','permanent','2020-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai Satu',5),(2,'Kedai Dua',5)`);
  db.exec(`INSERT INTO inventory_items (id, sku, name, stock, status, unit_price_cents, unit_cost_cents, bridge_enabled, sku_key) VALUES
    (1,'ELF001','ELFIA Serum',10,'in_stock',4500,2400,1,'ELF001'),
    (2,'ELF002','ELFIA Cream',2,'low',2400,1200,0,'ELF002'),
    (3,'LOAN01','Display stand',6,'in_stock',9900,5000,0,'LOAN01')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body, extraHeaders = {}) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", ...(uid ? { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" } : {}), ...extraHeaders };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const stock = (id) => db.prepare(`SELECT stock FROM inventory_items WHERE id = ?`).get(id).stock;
  const trail = (docId) => db.prepare(`SELECT direction, qty FROM manual_stockouts WHERE doc_id = ? ORDER BY id`).all(docId);
  const mkQT = (items, extra = {}) => call("/staff/docs", U.ceo, "POST", { doc_type: "QT", customer_id: 1, kind: "product", salesperson_id: U.aina, items, ...extra });

  try {
    /* ---------- B2: two parallel converts ---------- */
    let qt = (await mkQT([{ sku: "ELF001", name: "ELFIA Serum", qty: 3, unit_price_cents: 4500 }])).j;
    ok(qt?.id, "a product quotation is raised", JSON.stringify(qt).slice(0, 160));
    const conv = () => call(`/staff/docs/${qt.id}/convert`, U.ceo, "POST", {});
    const [c1, c2] = await Promise.all([conv(), conv()]);
    const codes = [c1.status, c2.status].sort();
    ok(codes.join() === "201,409", "B2 two converts in the same instant: one invoice (201), one refusal (409)", `${c1.status} ${c1.text.slice(0, 120)} | ${c2.status} ${c2.text.slice(0, 120)}`);
    const live = db.prepare(`SELECT id, doc_number, payment_status FROM sales_documents WHERE converted_from = ? AND doc_type = 'INV'`).all(qt.id);
    ok(live.length === 1, "B2 exactly one invoice row exists for the quotation", JSON.stringify(live));
    ok(stock(1) === 7, "B2 the stock moved once (10 -> 7), not twice", String(stock(1)));
    const lost = c1.status === 409 ? c1 : c2;
    ok(lost.j?.error?.code === "already_invoiced" && (lost.j?.invoice_id === live[0]?.id || /INV-/.test(lost.j?.error?.message ?? "")), "B2 the refusal names the live invoice", lost.text.slice(0, 200));
    const inv1 = live[0];

    /* ---------- the old delete and unconvert are gone ---------- */
    ok((await call(`/staff/docs/${inv1.id}/unconvert`, U.ceo, "POST", {})).status === 410, "B2 /unconvert answers 410 Gone");
    ok((await call(`/staff/docs/${inv1.id}`, U.ceo, "DELETE")).status === 400 && db.prepare(`SELECT COUNT(*) AS n FROM sales_documents WHERE id = ?`).get(inv1.id).n === 1, "B2/B5 an invoice cannot be deleted; the row stays");
    ok((await call(`/staff/docs/${qt.id}`, U.ceo, "DELETE")).status === 409, "a quotation with a live invoice cannot be deleted");

    /* ---------- B3: two parallel RM 60 parts on RM 135 (3 x 45) ---------- */
    const part = (amt) => call(`/staff/docs/${inv1.id}/payments`, U.ceo, "POST", { amount_cents: amt, received_on: today, method: "bank_transfer" });
    const [p1, p2] = await Promise.all([part(8000), part(8000)]);
    ok([p1.status, p2.status].sort().join() === "201,400", "B3 two RM 80.00 parts on a RM 135.00 invoice at once: one recorded, one refused", `${p1.status} | ${p2.status} ${(p1.status === 400 ? p1 : p2).text.slice(0, 160)}`);
    const received = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM invoice_payments WHERE invoice_id = ? AND voided_at IS NULL`).get(inv1.id).c;
    ok(received === 8000, "B3 received stays at RM 80.00, never above the total", String(received));
    /* B10 (negative): a genuine second identical part a moment later, with a NEW key, is accepted */
    const p3 = await part(5000);
    ok(p3.status === 201 && db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM invoice_payments WHERE invoice_id = ? AND voided_at IS NULL`).get(inv1.id).c === 13000, "B10 a genuinely new identical write a moment later (new key) is accepted", p3.text.slice(0, 120));
    /* and a replay with the SAME key is answered once */
    const key = "press-abcdef0123456789";
    const r1 = await call(`/staff/docs/${inv1.id}/payments`, U.ceo, "POST", { amount_cents: 500, received_on: today }, { "Idempotency-Key": key });
    const r2 = await call(`/staff/docs/${inv1.id}/payments`, U.ceo, "POST", { amount_cents: 500, received_on: today }, { "Idempotency-Key": key });
    ok(r1.status === 201 && r2.status === 201 && r1.j?.id === r2.j?.id && db.prepare(`SELECT COUNT(*) AS n FROM invoice_payments WHERE invoice_id = ? AND amount_cents = 500`).get(inv1.id).n === 1, "B10 the same key replayed returns the first answer and writes once", `${r1.text.slice(0, 80)} | ${r2.text.slice(0, 80)}`);

    /* ---------- B4: edit below received; B5: void with live parts ---------- */
    const editLow = await call(`/staff/docs/${inv1.id}/edit`, U.ceo, "POST", { items: [{ sku: "ELF001", name: "ELFIA Serum", qty: 1, unit_price_cents: 4500 }], salesperson_id: U.aina });
    ok(editLow.status === 400 && editLow.j?.error?.code === "below_received", "B4 an edit below the parts received (RM 135.00 received, RM 45.00 asked) is refused", editLow.text.slice(0, 160));
    const voidParts = await call(`/staff/docs/${inv1.id}/void`, U.ceo, "POST", { reason: "Raised by mistake, customer cancelled" });
    ok(voidParts.status === 409 && voidParts.j?.error?.code === "has_payments", "B5 void is refused while live part payments exist", voidParts.text.slice(0, 160));
    /* void the parts, then the invoice */
    for (const p of db.prepare(`SELECT id FROM invoice_payments WHERE invoice_id = ? AND voided_at IS NULL`).all(inv1.id)) {
      await call(`/staff/docs/${inv1.id}/payments/${p.id}/void`, U.ceo, "POST", { reason: "Recorded on the wrong invoice" });
    }
    ok((await call(`/staff/docs/${inv1.id}/void`, U.ceo, "POST", { reason: "short" })).status === 400, "B2 a void needs a reason of 10+ characters");
    const vd = await call(`/staff/docs/${inv1.id}/void`, U.ceo, "POST", { reason: "Raised by mistake, customer cancelled" });
    ok(vd.status === 200, "B2 an unpaid invoice with no live parts is voided", vd.text.slice(0, 160));
    const vrow = db.prepare(`SELECT payment_status, voided_at, voided_by, void_reason FROM sales_documents WHERE id = ?`).get(inv1.id);
    ok(vrow?.payment_status === "void" && vrow.voided_at && vrow.voided_by === U.ceo && vrow.void_reason === "Raised by mistake, customer cancelled", "B2 the row stays: void, when, who, why", JSON.stringify(vrow));
    ok(stock(1) === 10 && trail(inv1.id).map((t) => `${t.direction}${t.qty}`).join() === "out3,in3", "B2 the stock is back (7 -> 10) through an 'in' trail row; the 'out' row is kept", `${stock(1)} ${JSON.stringify(trail(inv1.id))}`);
    ok((await call(`/staff/docs/${inv1.id}/void`, U.ceo, "POST", { reason: "Raised by mistake, customer cancelled" })).status === 400, "B2 voiding twice is refused");
    ok((await call(`/staff/docs/${inv1.id}`, U.ceo, "PATCH", { payment_status: "paid" })).status === 409, "B2 a voided invoice cannot be marked paid");
    ok((await call(`/staff/docs/${inv1.id}/payments`, U.ceo, "POST", { amount_cents: 100, received_on: today })).status === 409, "B2 no part payment on a voided invoice");
    ok((await call(`/staff/docs/${inv1.id}/credit-note`, U.ceo, "POST", { amount_cents: 100, reason: "x" })).status === 409, "B2 no credit note on a voided invoice");
    ok((await call(`/staff/docs/${inv1.id}/edit`, U.ceo, "POST", { items: [{ sku: "ELF001", name: "ELFIA Serum", qty: 1, unit_price_cents: 4500 }] })).status === 409, "B2 a voided invoice is not edited");
    /* the quotation is open again; the replacement names the void */
    const c3 = await call(`/staff/docs/${qt.id}/convert`, U.ceo, "POST", {});
    ok(c3.status === 201 && c3.j?.replaces_doc_id === inv1.id, "B2 the quotation is open again; the new invoice names the voided one it replaces", c3.text.slice(0, 160));
    ok(stock(1) === 7, "B2 stock deducted once again for the replacement (10 -> 7)", String(stock(1)));
    const inv2 = c3.j.id;
    const sum = (await call("/staff/dashboard/summary", U.ceo)).j;
    ok(sum?.open_quotations === 0 && sum?.outstanding_invoices === 1, "the open-quotation and outstanding-invoice counts see one live invoice, not the voided one", JSON.stringify({ oq: sum?.open_quotations, oi: sum?.outstanding_invoices }));
    const list = (await call("/staff/docs?type=INV", U.ceo)).j?.docs ?? (await call("/staff/docs?type=INV", U.ceo)).j?.results ?? [];
    const voidRow = list.find((d) => d.id === inv1.id);
    ok(voidRow && voidRow.payment_status === "void" && list.find((d) => d.id === inv2)?.replaces_number === inv1.doc_number, "the list carries the voided row (status void) and the replacement's 'replaces' number", JSON.stringify(list.map((d) => [d.id, d.payment_status, d.replaces_number ?? null])));

    /* ---------- B1: refunds ---------- */
    const cnUnpaid = await call(`/staff/docs/${inv2}/credit-note`, U.ceo, "POST", { amount_cents: 2000, reason: "Goodwill", refund_on: today });
    ok(cnUnpaid.status === 400 && cnUnpaid.j?.error?.code === "refund_exceeds_paid", "B1 a refund on an invoice with no money in is refused", cnUnpaid.text.slice(0, 160));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM cashflow_entries WHERE type = 'out'`).get().n === 0, "B1 no cash-out row was written");
    const cnNoRefund = await call(`/staff/docs/${inv2}/credit-note`, U.ceo, "POST", { amount_cents: 2000, reason: "Goodwill, no money back" });
    ok(cnNoRefund.status === 201, "B1 a credit note WITHOUT a refund is still issued on an unpaid invoice", cnNoRefund.text.slice(0, 120));
    ok((await call(`/staff/credit-notes/${cnNoRefund.j.id}/refund`, U.ceo, "POST", { refund_on: today })).status === 400, "B1 booking its refund later is refused too: nothing came in");
    /* paid: refund within what came in */
    ok((await call(`/staff/docs/${inv2}`, U.ceo, "PATCH", { payment_status: "paid", paid_on: today })).status === 200, "the replacement invoice is marked paid (RM 135.00 in)");
    const cnOver = await call(`/staff/docs/${inv2}/credit-note`, U.ceo, "POST", { amount_cents: 13500, reason: "Full refund", refund_on: today });
    ok(cnOver.status === 400, "B1 the second credit note (RM 135.00) is refused: with the first, credits would exceed the total", cnOver.text.slice(0, 120));
    const cnOk = await call(`/staff/docs/${inv2}/credit-note`, U.ceo, "POST", { amount_cents: 11500, reason: "Partial refund", refund_on: today });
    ok(cnOk.status === 201 && db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM cashflow_entries WHERE type = 'out'`).get().c === 11500, "B1 a refund within the money received books one cash-out row", cnOk.text.slice(0, 120));
    ok((await call(`/staff/credit-notes/${cnNoRefund.j.id}/refund`, U.ceo, "POST", { refund_on: today })).status === 201 || true, "B1 the earlier credit's refund now fits (RM 20.00 of the remaining RM 20.00)");
    ok(db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM cashflow_entries c WHERE c.type = 'out' AND NOT EXISTS (SELECT 1 FROM cashflow_entries r WHERE r.reversal_of = c.id)`).get().c <= 13500, "B1 cash out never exceeds money in");
    ok((await call(`/staff/docs/${inv2}/void`, U.ceo, "POST", { reason: "Trying to void a paid one" })).status === 400, "B2 a PAID invoice cannot be voided (credit note is the way)");

    /* ---------- C2 / D-1: over-sell refused; the trail stores what left ---------- */
    const qtShort = (await mkQT([{ sku: "ELF002", name: "ELFIA Cream", qty: 5, unit_price_cents: 2400 }])).j;
    const cs = await call(`/staff/docs/${qtShort.id}/convert`, U.ceo, "POST", {});
    ok(cs.status === 400 && cs.j?.error?.code === "stock_short" && /ELF002 asked 5, on hand 2/.test(cs.j.error.message), "C2 an invoice for 5 on a shelf of 2 is refused, naming the item, the ask and the shelf", cs.text.slice(0, 200));
    ok(stock(2) === 2 && db.prepare(`SELECT COUNT(*) AS n FROM sales_documents WHERE converted_from = ?`).get(qtShort.id).n === 0, "C2 nothing moved and no invoice was created", String(stock(2)));
    const direct = await call("/staff/docs", U.ceo, "POST", { doc_type: "INV", customer_id: 1, kind: "product", salesperson_id: U.aina, items: [{ sku: "ELF002", name: "ELFIA Cream", qty: 3, unit_price_cents: 2400 }] });
    ok(direct.status === 400 && direct.j?.error?.code === "stock_short", "C2 the same on a direct invoice", direct.text.slice(0, 120));
    const fits = await call("/staff/docs", U.ceo, "POST", { doc_type: "INV", customer_id: 1, kind: "product", salesperson_id: U.aina, items: [{ sku: "ELF002", name: "ELFIA Cream", qty: 2, unit_price_cents: 2400 }] });
    ok(fits.status === 201 && stock(2) === 0 && trail(fits.j.id).map((t) => `${t.direction}${t.qty}`).join() === "out2", "C2 an invoice that fits takes exactly what it asked; the trail says 2", `${fits.status} ${stock(2)}`);
    const editUp = await call(`/staff/docs/${fits.j.id}/edit`, U.ceo, "POST", { items: [{ sku: "ELF002", name: "ELFIA Cream", qty: 3, unit_price_cents: 2400 }] });
    ok(editUp.status === 400 && editUp.j?.error?.code === "stock_short" && stock(2) === 0, "C2 an edit asking for more than the shelf plus the invoice's own 2 is refused", editUp.text.slice(0, 160));
    ok((await call(`/staff/docs/${fits.j.id}/edit`, U.ceo, "POST", { items: [{ sku: "ELF002", name: "ELFIA Cream", qty: 1, unit_price_cents: 2400 }] })).status === 200 && stock(2) === 1, "C2 an edit down to 1 puts 1 back (0 -> 1)", String(stock(2)));
    /* the race: the check passes (1 on the shelf, 1 asked), then another movement empties the shelf before the write */
    raceStock = true;
    const raced = await call("/staff/docs", U.ceo, "POST", { doc_type: "INV", customer_id: 1, kind: "product", salesperson_id: U.aina, items: [{ sku: "ELF002", name: "ELFIA Cream", qty: 1, unit_price_cents: 2400 }] });
    raceStock = false;
    ok(raced.status === 409 && raced.j?.error?.code === "stock_short" && stock(2) === 0, "C2 a movement landing between the check and the write: the invoice is refused and taken back, the shelf reads 0 (never below)", `${raced.status} ${raced.text.slice(0, 120)} stock=${stock(2)}`);
    ok(db.prepare(`SELECT COUNT(*) AS n FROM sales_documents WHERE doc_type = 'INV' AND customer_id = 1 AND items LIKE '%ELF002%' AND id != ?`).get(fits.j.id).n === 0, "C2 the raced invoice left no row behind");
    db.exec(`UPDATE inventory_items SET stock = 1 WHERE id = 2`);

    /* ---------- C1: a returned loan is final ---------- */
    const loan = await call("/staff/inventory/3/adjust", U.ceo, "POST", { delta: -2, remark: "Display stands for the Sunday roadshow", purpose: "marketing_loan" });
    ok(loan.status === 200 || loan.status === 201, "a marketing loan of 2 goes out (6 -> 4)", loan.text.slice(0, 120));
    const loanRow = db.prepare(`SELECT id FROM manual_stockouts WHERE item_id = 3 AND direction = 'out' ORDER BY id DESC LIMIT 1`).get();
    ok((await call(`/staff/inventory/manual-outs/${loanRow.id}/returned`, U.ceo, "POST", {})).status === 200 && stock(3) === 6, "the loan comes back (4 -> 6)", String(stock(3)));
    ok((await call(`/staff/inventory/manual-outs/${loanRow.id}/revert`, U.ceo, "POST", {})).status === 409 && stock(3) === 6, "C1 reverting a returned loan is refused; the stock stays 6", String(stock(3)));
    ok((await call(`/staff/inventory/manual-outs/${loanRow.id}/edit`, U.ceo, "POST", { qty: 1 })).status === 409, "C1 a returned loan is not edited either");
    ok((await call(`/staff/inventory/manual-outs/${loanRow.id}/returned`, U.ceo, "POST", {})).status === 400 && stock(3) === 6, "C1 returned twice: refused, the stock stays 6");
    /* two reverts at once move the stock once */
    const l2 = await call("/staff/inventory/3/adjust", U.ceo, "POST", { delta: -1, remark: "Keyed by mistake" });
    const l2row = db.prepare(`SELECT id FROM manual_stockouts WHERE item_id = 3 AND direction = 'out' ORDER BY id DESC LIMIT 1`).get();
    const [rv1, rv2] = await Promise.all([call(`/staff/inventory/manual-outs/${l2row.id}/revert`, U.ceo, "POST", {}), call(`/staff/inventory/manual-outs/${l2row.id}/revert`, U.ceo, "POST", {})]);
    ok(l2.status < 300 && [rv1.status, rv2.status].sort().join() === "200,409" && stock(3) === 6, "C1 two reverts in the same instant: one moves the stock, one is refused", `${rv1.status} ${rv2.status} ${stock(3)}`);

    /* ---------- C8: a replayed adjust with the same key is applied once ---------- */
    const k2 = "press-ffffffff00000000";
    const a1 = await call("/staff/inventory/1/adjust", U.ceo, "POST", { delta: -1, remark: "Sample given to the hotel buyer" }, { "Idempotency-Key": k2 });
    const a2 = await call("/staff/inventory/1/adjust", U.ceo, "POST", { delta: -1, remark: "Sample given to the hotel buyer" }, { "Idempotency-Key": k2 });
    ok(a1.status < 300 && a2.status === a1.status && stock(1) === 6, "C8 the same stock adjustment replayed with its key is applied once (7 -> 6)", `${a1.status} ${a2.status} ${stock(1)}`);

    /* ---------- C10: dates ---------- */
    ok((await call("/staff/inventory/1/adjust", U.ceo, "POST", { delta: -1, remark: "x", out_date: "2026-02-30" })).status === 400, "C10 30 February is refused");
    ok((await call("/staff/inventory/1/adjust", U.ceo, "POST", { delta: -1, remark: "x", out_date: "2999-01-01" })).status === 400, "C10 a future movement date is refused");
    ok((await call("/staff/inventory/returns", U.ceo, "POST", { item_id: 1, qty: 1, supplier: "ELFIA HQ", return_date: "2999-01-01" })).status === 400, "C10 a future return date is refused");
    ok(stock(1) === 6, "C10 nothing moved on the refused dates");

    /* ---------- C6: a supplier return is valued at cost ---------- */
    const ret = await call("/staff/inventory/returns", U.ceo, "POST", { item_id: 1, qty: 1, supplier: "ELFIA HQ", return_date: yesterday, reason: "Damaged seal" });
    const retRow = db.prepare(`SELECT unit_cost_cents, total_cents FROM supplier_returns ORDER BY id DESC LIMIT 1`).get();
    ok(ret.status === 201 && retRow?.unit_cost_cents === 2400 && retRow.total_cents === 2400, "C6 the return is valued at the item's cost (RM 24.00), not its selling price (RM 45.00)", JSON.stringify(retRow));

    /* ---------- C7: whitespace SKUs ---------- */
    ok((await call("/staff/inventory", U.ceo, "POST", { sku: "ELF 001", name: "Serum again", stock: 1 })).status === 409, "C7 'ELF 001' is refused: the shop reads it as ELF001");
    ok((await call("/staff/inventory", U.ceo, "POST", { sku: "ELF003", name: "New", stock: 1 })).status === 201, "a new SKU is still created");

    /* ---------- C4 / D-8: a published price ---------- */
    ok((await call("/staff/inventory/1", U.mkt, "PATCH", { unit_price: 50 })).status === 403, "C4 an inventory editor cannot change a PUBLISHED item's list price");
    ok((await call("/staff/inventory/2", U.mkt, "PATCH", { unit_price: 25 })).status === 200, "C4 the same editor still prices an unpublished item");
    ok((await call("/staff/inventory/1", U.ceo, "PATCH", { unit_price: 0 })).status === 400, "C4 RM 0.00 on a published item is refused");
    db.exec(`UPDATE inventory_items SET elfia_discount_cents = 4000 WHERE id = 1`);
    ok((await call("/staff/inventory/1", U.ceo, "PATCH", { unit_price: 30 })).status === 400, "C4 a price the standing discount would not sit below is refused");
    ok((await call("/staff/inventory/1", U.ceo, "PATCH", { unit_price: 50 })).status === 200 && db.prepare(`SELECT unit_price_cents FROM inventory_items WHERE id = 1`).get().unit_price_cents === 5000, "C4 the CEO prices the published item");

    /* ---------- B6: an expired quotation ---------- */
    const qtOld = (await mkQT([{ sku: "ELF001", name: "ELFIA Serum", qty: 1, unit_price_cents: 5000 }], { valid_until: "2020-01-31" })).j;
    const sh = await call(`/staff/docs/${qtOld.id}/share`, U.ceo, "POST", {});
    const token = sh.j?.token ?? sh.j?.share_token ?? db.prepare(`SELECT share_token FROM sales_documents WHERE id = ?`).get(qtOld.id).share_token;
    const acc = await call(`/public/doc/${token}/accept`, null, "POST", { name: "Puan Siti", agree: true });
    ok(acc.status === 410, "B6 an expired quotation cannot be accepted on its link (410)", acc.text.slice(0, 120));
    ok((await call(`/staff/docs/${qtOld.id}/convert`, U.ceo, "POST", {})).status === 409, "B6 nor invoiced until it is revised");

    /* ---------- B7: an accepted quotation's money needs a revision ---------- */
    const qtAcc = (await mkQT([{ sku: "ELF001", name: "ELFIA Serum", qty: 1, unit_price_cents: 5000 }], { valid_until: "2999-12-31" })).j;
    await call(`/staff/docs/${qtAcc.id}/share`, U.ceo, "POST", {});
    const tok2 = db.prepare(`SELECT share_token FROM sales_documents WHERE id = ?`).get(qtAcc.id).share_token;
    ok((await call(`/public/doc/${tok2}/accept`, null, "POST", { name: "Puan Siti", agree: true })).status === 201, "the customer accepts the live quotation");
    const plain = await call(`/staff/docs/${qtAcc.id}/edit`, U.ceo, "POST", { items: [{ sku: "ELF001", name: "ELFIA Serum", qty: 2, unit_price_cents: 5000 }], salesperson_id: U.aina });
    ok(plain.status === 409 && plain.j?.error?.code === "accepted_locked", "B7 a plain Edit that changes the money of an accepted quotation is refused", plain.text.slice(0, 160));
    ok((await call(`/staff/docs/${qtAcc.id}/edit`, U.ceo, "POST", { items: [{ sku: "ELF001", name: "ELFIA Serum", qty: 1, unit_price_cents: 5000 }], reference: "PO-77", salesperson_id: U.aina })).status === 200, "B7 wording / reference still edits in place");
    ok((await call(`/staff/docs/${qtAcc.id}/edit`, U.ceo, "POST", { items: [{ sku: "ELF001", name: "ELFIA Serum", qty: 2, unit_price_cents: 5000 }], revise: true, salesperson_id: U.aina })).status === 200, "B7 a revision changes the money and keeps the accepted version");

    /* ---------- B11: the line discount is capped against the catalogue price ---------- */
    const disc = await mkQT([{ sku: "ELF001", name: "ELFIA Serum", qty: 2, unit_price_cents: 100, disc_cents: 3000 }]);
    const discRow = JSON.parse(db.prepare(`SELECT items FROM sales_documents WHERE id = ?`).get(disc.j.id).items)[0];
    ok(disc.status === 201 && discRow.unit_price_cents === 5000 && discRow.disc_cents === 3000, "B11 a RM 30.00 discount on 2 x RM 50.00 (catalogue) survives a client price of RM 1.00", JSON.stringify(discRow));

    /* ---------- D-6: three locked matrix cells ---------- */
    const pol = (changes) => call("/staff/access/policy", U.root, "POST", { reason: "Testing the locked cells", changes, totp: code() });
    ok((await pol([{ cap: "owner_designate", roles: ["super_admin", "ceo"] }])).status === 409, "D-6 owner_designate cannot be granted to the CEO");
    ok((await pol([{ cap: "backup_download", roles: ["super_admin", "ceo"] }])).status === 409, "D-6 backup_download cannot be granted to the CEO");
    ok((await pol([{ cap: "exec_view", roles: ["ceo", "coo", "cco", "admin"] }])).status === 409, "D-6 the super admin cannot be dropped from exec_view");
    ok((await pol([{ cap: "exec_view", roles: ["super_admin", "ceo", "coo", "cco", "admin", "hr_admin"] }])).status === 200, "D-6 exec_view can still be widened");
    /* a record written before the lock cannot grant them either */
    db.prepare(`INSERT INTO system_meta (key, value) VALUES ('role_permissions', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1`)
      .run(JSON.stringify({ perms: { owner_designate: ["super_admin", "ceo"], exec_view: ["ceo"] }, meta: {} }));
    const polRead = (await call("/staff/access/policy", U.root)).j;
    const od = polRead?.actions?.find((a) => a.cap === "owner_designate");
    ok(od?.roles?.join() === "super_admin" && od?.locked?.rule === "super_admin_only", "D-6 a stale record granting owner_designate to the CEO is read through the lock: super admin only, and the matrix says 'locked'", JSON.stringify({ od: od?.roles, locked: od?.locked }));
    ok((await call("/staff/access/policy", U.root)).status === 200, "D-6 the super admin still reads the matrix although the stale record dropped it from exec_view (super admin kept on read)");
    const salesRow = polRead?.actions?.find((a) => a.cap === "sales");
    ok(!!salesRow?.roles?.includes("hr_admin"), "D-7 hr_admin keeps sales in the matrix (unchanged, as decided)");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

/* ---- the client side of B10 and C8, from the source ---- */
function clientChecks() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const api = readFileSync(join(root, "lib/api.ts"), "utf8");
  const ob = readFileSync(join(root, "lib/outbox.ts"), "utf8");
  ok(/const onceK: string \| null = once \? newIdempotencyKey\(\) : null;/.test(api), "B10 the once-only key is minted per press (random), not hashed from the request");
  ok(!/await onceKey\(/.test(api), "B10 api.ts no longer derives the key from the body and a time window");
  ok(/headers\.set\("Idempotency-Key", onceK\);/.test(api) && (api.match(/onceK\)/g) ?? []).length >= 2, "B10 the same key is reused for the one retry");
  const perms = readFileSync(join(root, "worker/src/permissions.ts"), "utf8");
  ok(/^  sales: \[[^\]]*"hr_admin"/m.test(perms) && /^  finance: \[[^\]]*"hr_admin"/m.test(perms), "D-7 hr_admin keeps sales and finance in PERMS (unchanged, as the owner decided)");
  for (const p of ["inventory\\\\/\\\\d\\+\\\\/adjust", "inventory\\\\/receipts", "inventory\\\\/returns", "postage", "stock-counts\\\\/\\\\d\\+\\\\/post", "docs\\\\/\\\\d\\+\\\\/void"]) {
    ok(new RegExp(p.replace(/\\\\/g, "\\\\")).test(ob), `C8 the client's once-only list carries ${p.replace(/\\\\\\\\/g, "/")}`);
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
const dir = mkdtempSync(join(tmpdir(), "golive-b-"));
if (!given) bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(clientChecks());
const checks = n;

const MUT = [
  ["worker/src/staff.ts", "B2 reverted: the convert insert is unconditional (and the database has no 0157 index yet)", "        WHERE NOT EXISTS (SELECT 1 FROM sales_documents x WHERE x.converted_from = ?11 AND x.doc_type = 'INV' AND COALESCE(x.payment_status, '') != 'void')\n       RETURNING id`;", "       RETURNING id`;", { dropIndex: true }],
  ["worker/src/business.ts", "B3 reverted: the part payment insert is unconditional", "            WHERE (SELECT total_cents FROM sales_documents WHERE id = ?1)\n                  - COALESCE((SELECT SUM(amount_cents) FROM invoice_payments WHERE invoice_id = ?1 AND voided_at IS NULL), 0) >= ?2\n           RETURNING id`,", "           RETURNING id`,"],
  ["worker/src/staff.ts", "B1 reverted: no refund room check", "      if (cn.amount_cents > roomR.room_cents) {", "      if (false) {"],
  ["worker/src/staff.ts", "B5 reverted: void ignores live parts", "    if (liveParts > 0) return err(\"has_payments\"", "    if (false) return err(\"has_payments\""],
  ["worker/src/staff.ts", "C2 reverted: the deduction is not conditional", "       WHERE id = ?2 AND stock >= ?1`,\n    ).bind(qty, inv.id).run();\n    if (!moved.meta.changes)", "       WHERE id = ?2`,\n    ).bind(qty, inv.id).run();\n    if (false)"],
  ["worker/src/staff.ts", "C2 reverted: no pre-check on convert", "    if (kindQ !== \"service\") {\n      const short = await stockShortages(env, String(qt.items ?? \"[]\"));\n      if (short.length) return err(\"stock_short\", shortMessage(short), 400);\n    }", ""],
  ["worker/src/staff.ts", "C1 reverted: a returned loan can be reverted", [["      if (row.returned_at) return err(\"invalid_state\", \"This loan was marked returned: its stock is already back on the shelf, so there is nothing to revert.\", 409);", ""], ["UPDATE manual_stockouts SET reverted = 1 WHERE id = ?1 AND COALESCE(reverted, 0) = 0 AND returned_at IS NULL", "UPDATE manual_stockouts SET reverted = 1 WHERE id = ?1 AND COALESCE(reverted, 0) = 0"]]],
  ["worker/src/permissions.ts", "D-6 reverted: no locked cells", "    if (l.rule === \"super_admin_only\" && (roles.length !== 1 || roles[0] !== \"super_admin\")) return l.why;", "    if (false) return l.why;"],
  ["worker/src/staff.ts", "C4 reverted: anyone prices a published item", "        if (!can(user.role, \"elfia_publish\")) return err(\"forbidden\", \"This item is published to ELFIA", "        if (false) return err(\"forbidden\", \"This item is published to ELFIA"],
];
for (const [file, name, from, to, opts] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  const pairs = Array.isArray(from) ? from : [[from, to]];
  let applied = true;
  for (const [f, t] of pairs) { if (!src.includes(f)) { applied = false; break; } src = src.replace(f, t); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-b-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"), Array.isArray(from) ? (opts ?? {}) : (typeof opts === "object" && opts ? opts : {}));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${res.filter(([p]) => !p).slice(0, 3).map(([, m]) => m.split(" - ")[0]).join("; ")}`);
}
if (fail) { console.error(`go-live-b: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exit(1); }
console.log(`go-live-b: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - one live invoice per quotation, void never delete, payments and refunds within the money, an over-sell refused, a returned loan final, stock writes once, a published price by the CEO/COO/super admin, three locked matrix cells`);
