/**
 * HANKEI'S COMMERCE - the failure cases. v1.163.0.
 *
 * These are not assertions about strings in source files. The module is
 * bundled and RUN against a real SQLite database (node:sqlite) with
 * migration 0135 applied verbatim, behind a D1-shaped shim whose `batch()`
 * is a genuine transaction. Every UNIQUE constraint, every conditional
 * `INSERT ... WHERE EXISTS` and every `meta.changes` in the module is
 * therefore exercised by the database itself, not by a mock that agrees
 * with me.
 *
 * The list is the one the brief asks for, in order, plus the ones the
 * design suggested on the way.
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  x ${label}${why ? ` - ${why}` : ""}`); }
};
const section = (t) => console.log(`\n  ${t}`);

/* ══════════════════════════════════════════════════════════════════════
   1. bundle the real modules
   ══════════════════════════════════════════════════════════════════════ */
const dir = mkdtempSync(join(tmpdir(), "hk-"));
const stubUrl = (p) => pathToFileURL(p).href;
/* notify() is the only runtime import from staff.ts; everything else the
   modules use is real. */
writeFileSync(join(dir, "staff.js"), `export const notified = []; export async function notify(env, userId, kind, message, ref) { notified.push({ userId, kind, message, ref }); }`);
for (const f of ["hankeis.ts", "hankeis-api.ts", "hankeis-core.ts", "shared.ts", "permissions.ts"]) {
  let src = read(`worker/src/${f}`);
  src = src.replace('from "./staff"', `from "${stubUrl(join(dir, "staff.js"))}"`);
  writeFileSync(join(dir, f), src);
}
const entry = join(dir, "entry.ts");
writeFileSync(entry, `export * as HK from "./hankeis";\nexport * as API from "./hankeis-api";\nexport * as CORE from "./hankeis-core";\n`);
const out = join(dir, "bundle.mjs");
execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --external:*/staff.js --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const { HK, API, CORE } = await import(pathToFileURL(out).href);
/* the same module instance the bundle imports, so notify() calls are visible */
const { notified } = await import(stubUrl(join(dir, "staff.js")));

/* ══════════════════════════════════════════════════════════════════════
   2. a real database behind a D1-shaped shim
   ══════════════════════════════════════════════════════════════════════ */
/* The portal tables the module touches. Trimmed to the columns it reads -
   the real ones carry more, and nothing here depends on the difference. */
const FIXTURE = `
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, full_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, sku TEXT, name TEXT, stock INTEGER DEFAULT 0, status TEXT DEFAULT 'active');
CREATE TABLE stock_ledger (id INTEGER PRIMARY KEY, item_id INTEGER, sku TEXT, delta INTEGER, balance_after INTEGER, source TEXT, ref_type TEXT, ref_id TEXT, reason TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE error_log (id INTEGER PRIMARY KEY, source TEXT, message TEXT, path TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER, window_start TEXT);
CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, message TEXT, ref TEXT, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE data_versions (topic TEXT PRIMARY KEY, v INTEGER DEFAULT 0, at INTEGER DEFAULT 0);
`;
const MIGRATION = read("worker/migrations/0135_hankeis_commerce.sql");

/** D1's shape over node:sqlite. batch() is one real transaction. */
function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(FIXTURE);
  db.exec(MIGRATION);
  const norm = (sql) => sql.replace(/\?(\d+)/g, "?$1"); // node:sqlite supports ?N natively
  const bindArgs = (sql, binds) => {
    /* ?N is positional-by-number: build the array node:sqlite wants by
       resolving each occurrence, so a statement that uses ?1 twice works. */
    const used = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
    if (used.length === 0) return binds;
    return used.map((n) => binds[n - 1] ?? null);
  };
  const prep = (sql) => {
    const plain = sql.replace(/\?(\d+)/g, "?");
    return {
      _sql: sql, _binds: [],
      bind(...b) { this._binds = b.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)); return this; },
      _args() { return bindArgs(this._sql, this._binds); },
      async first(_col) {
        const st = db.prepare(plain);
        const r = st.get(...this._args());
        return r === undefined ? null : r;
      },
      async all() {
        const st = db.prepare(plain);
        return { results: st.all(...this._args()), success: true };
      },
      async run() {
        const st = db.prepare(plain);
        const r = st.run(...this._args());
        return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
      },
    };
  };
  /* D1 runs one batch at a time against the database; two overlapping
     batches are serialised, not interleaved. The queue below is that, and
     it is what makes the concurrency cases below a fair test rather than a
     shim artefact. */
  let queue = Promise.resolve();
  return {
    _db: db,
    prepare: (sql) => prep(norm(sql)),
    batch(stmts) {
      const run = queue.then(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const res = [];
          for (const s of stmts) res.push(await s.run());
          db.exec("COMMIT");
          return res;
        } catch (e) { db.exec("ROLLBACK"); throw e; }
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}
/** R2, enough of it. */
function makeR2() {
  const store = new Map();
  return {
    _store: store,
    async put(key, body, opts) { store.set(key, { body: body instanceof Uint8Array ? body : new Uint8Array(body), ct: opts?.httpMetadata?.contentType }); },
    async get(key) { const v = store.get(key); return v ? { body: v.body, httpMetadata: { contentType: v.ct } } : null; },
    async head(key) { return store.has(key) ? {} : null; },
  };
}

const CEO = { id: 1, role: "ceo", name: "Alif" };
const FINANCE = { id: 2, role: "coo", name: "Zolkefli" };
const SALES = { id: 3, role: "sales_marketing", name: "Nasuha" };
const PACKER = { id: 4, role: "hr_admin", name: "Dini" };
const EDITOR = { id: 5, role: "editor", name: "Mira" };

async function freshEnv({ stock = 100 } = {}) {
  const env = { DB: makeDb(), MEDIA: makeR2() };
  const q = (sql, ...b) => env.DB._db.prepare(sql).run(...b);
  q(`INSERT INTO users (id,name,full_name,role) VALUES (1,'Alif','Alif','ceo'),(2,'Zol','Zol','coo'),(3,'Nasuha','Nasuha','sales_marketing'),(4,'Dini','Dini','hr_admin'),(5,'Mira','Mira','editor')`);
  q(`INSERT INTO inventory_items (id,sku,name,stock) VALUES (10,'HK-SEA-ORI','Seaweed Original',?)`, stock);
  q(`INSERT INTO hk_settings (key,value) VALUES ('recipient_name','HANKEIS ENTERPRISE'),('receiving_account','Maybank 5123xxxx1234'),('qr_image_key','hk/qr/static.png'),('shipping_flat_cents','800'),('reservation_minutes','1440')`);
  q(`INSERT INTO hk_products (id,sku,name,unit_price_cents,inventory_item_id,is_active) VALUES (1,'HK-SEA-ORI','Seaweed Original',1200,10,1)`);
  q(`INSERT INTO hk_packages (id,code,name,eligibility,min_qty,price_cents,is_active) VALUES (1,'AGT-10','Agent Box 10',   'agent',1,9000,1),(2,'STK-50','Stockist Carton','stockist',1,40000,1)`);
  q(`INSERT INTO hk_customers (id,name,phone,category,telegram_user_id) VALUES (1,'Aminah','0121234567','retail',777001),(2,'Bahtiar','0129876543','agent',777002)`);
  q(`INSERT INTO hk_addresses (id,customer_id,line1,is_default) VALUES (1,1,'12 Jalan Melur',1),(2,2,'88 Jalan Mawar',1)`);
  q(`INSERT INTO hk_api_clients (id,name,token_hash,scopes,is_active) VALUES (1,'astra',?,'catalogue customers orders receipts status events',1)`,
    await HK.sha256Hex(new TextEncoder().encode("test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa")));
  return env;
}
const TOKEN = "test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(0x41)]);
const JPEG2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(0x42)]);
const row = (env, sql, ...b) => env.DB._db.prepare(sql).get(...b);
const rows = (env, sql, ...b) => env.DB._db.prepare(sql).all(...b);

const apiReq = (method, path, { body, token = TOKEN, idem, ct = "application/json", raw } = {}) => {
  const headers = { Authorization: `Bearer ${token}` };
  if (idem) headers["Idempotency-Key"] = idem;
  let init = { method, headers };
  if (raw) { headers["content-type"] = ct; headers["content-length"] = String(raw.byteLength); init.body = raw; }
  else if (body !== undefined) { headers["content-type"] = ct; init.body = JSON.stringify(body); }
  return new Request(`https://a2zcreative.my/api/v1/hankeis${path}`, init);
};
const call = async (env, method, path, opts = {}) => {
  /* index.ts hands the module `url.pathname` with the mount stripped - never
     a query string. The helper does the same, or the routes would not match. */
  const pathname = path.split("?")[0];
  const res = await API.handleHankeisApi(env, apiReq(method, path, opts), pathname);
  let json = null; try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json };
};
const staff = async (env, user, method, path, body = null, params = "") => {
  const url = `https://a2zcreative.my/api/v1/staff/hankeis${path}${params}`;
  const res = await HK.handleHankeis(env, new Request(url, { method }), path, method, body, user, new URLSearchParams(params.replace(/^\?/, "")));
  let json = null; try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json };
};
/** One order, ready for money. */
async function anOrder(env, { customer = 1, qty = 2 } = {}) {
  const r = await HK.createOrder(env, { customer_id: customer, address_id: customer, lines: [{ product_id: 1, qty }], channel: "portal", created_by: 3 });
  if (!r.ok) throw new Error(`fixture order failed: ${r.message}`);
  return r;
}
const GOOD_VERIFY = (order_id, extra = {}) => ({
  order_id, receiving_account: "Maybank 5123xxxx1234", bank_reference: "MB240920ABC123",
  amount_cents: 3200, bank_time: "2026-09-20 11:02:13", attested_bank_checked: true, ...extra,
});

/* ══════════════════════════════════════════════════════════════════════
   the cases
   ══════════════════════════════════════════════════════════════════════ */

section("A receipt is evidence, never proof");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const up = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram", client_id: 1, declared_amount_cents: 3200, declared_reference: "MB240920ABC123" });
  ok("a convincing receipt is stored", up.ok === true && up.receipt_id > 0);
  const after = row(env, `SELECT payment_state, fulfilment_state FROM hk_orders WHERE id=?`, o.order_id);
  ok("...and the payment is NOT verified - it is awaiting_review", after.payment_state === "awaiting_review", after.payment_state);
  ok("...and fulfilment has not moved", after.fulfilment_state === "not_ready", after.fulfilment_state);
  ok("...even though the declared amount matches the total exactly", up.ok && row(env, `SELECT declared_amount_cents FROM hk_receipts WHERE id=?`, up.receipt_id).declared_amount_cents === 3200);
  const ship = await staff(env, PACKER, "POST", `/orders/${o.order_id}/ship`, { courier: "J&T", tracking_no: "JT1" });
  ok("...and it cannot be shipped", ship.status === 409 && /not verified/i.test(ship.json.error.message), JSON.stringify(ship.json));
}

section("An OCR extraction is an aid, never a verification");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  /* register a PERFECT extraction: right amount, right recipient, high confidence */
  CORE.registerOcrAdapter({
    name: "test-engine",
    async extract() { return { amount_cents: 3200, datetime: "2026-09-20 11:02", recipient: "HANKEIS ENTERPRISE", reference: "MB240920ABC123", confidence: 0.99, engine: "test-engine" }; },
  });
  const up = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram", client_id: 1 });
  const r = row(env, `SELECT ocr_state, ocr_amount_cents, ocr_confidence FROM hk_receipts WHERE id=?`, up.receipt_id);
  ok("the extraction is recorded with its confidence", r.ocr_state === "done" && r.ocr_amount_cents === 3200 && r.ocr_confidence === 0.99);
  ok("...and the payment is still only awaiting_review", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "awaiting_review");
  CORE.registerOcrAdapter(null);
  ok("with no engine registered, nothing is fabricated", CORE.ocrAvailable() === false);
  const env2 = await freshEnv();
  const o2 = await anOrder(env2);
  const up2 = await HK.storeReceipt(env2, { order_id: o2.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram" });
  const r2 = row(env2, `SELECT ocr_state, ocr_amount_cents, ocr_recipient FROM hk_receipts WHERE id=?`, up2.receipt_id);
  ok("...the receipt says 'unavailable' and every extracted field is NULL", r2.ocr_state === "unavailable" && r2.ocr_amount_cents === null && r2.ocr_recipient === null);
}

section("Only an authorised reviewer can approve");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  for (const [who, actor] of [["a sales person", SALES], ["a packer", PACKER], ["an editor", EDITOR]]) {
    const r = await HK.verifyPayment(env, actor, GOOD_VERIFY(o.order_id));
    ok(`${who} cannot verify`, r.ok === false && r.code === "forbidden", JSON.stringify(r));
  }
  ok("the order is untouched", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "awaiting_payment");
  const good = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id));
  ok("finance can", good.ok === true, JSON.stringify(good));
}

section("The integration credential cannot approve, at all");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const no = await call(env, "POST", `/orders/${o.order_no}/verify`, { body: { attested_bank_checked: true, bank_reference: "X" } });
  ok("there is no verify route on the integration surface", no.status === 404, `${no.status}`);
  const paths = ["/orders/HK-1/approve", "/payments/verify", "/admin/verify", "/settings"];
  for (const p of paths) {
    const r = await call(env, "POST", p, { body: {} });
    ok(`no privileged route at ${p}`, r.status === 404 || r.status === 403, `${r.status}`);
  }
  const src = read("worker/src/hankeis-api.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const setsPaymentState = [...code.matchAll(/\bSET\b([\s\S]*?)(\bWHERE\b|`)/g)].some((m) => /payment_state\s*=/.test(m[1]));
  ok("...and the module never writes payment_state at all", !setsPaymentState, "a SET clause touches payment_state");
}

section("One customer cannot reach another customer's order or receipt");
{
  const env = await freshEnv();
  const mine = await anOrder(env, { customer: 1 });
  const theirs = await anOrder(env, { customer: 2 });
  const peek = await call(env, "GET", `/orders/${theirs.order_no}?telegram_user_id=777001`);
  ok("a stranger's order reads as not found, not forbidden", peek.status === 404, `${peek.status}`);
  const upload = await call(env, "POST", `/orders/${theirs.order_no}/receipt?telegram_user_id=777001`, { raw: JPEG, ct: "image/jpeg" });
  ok("a stranger cannot attach a receipt to it", upload.status === 404, `${upload.status}`);
  const own = await call(env, "GET", `/orders/${mine.order_no}?telegram_user_id=777001`);
  ok("the owner can read their own", own.status === 200 && own.json.order_no === mine.order_no);
  const direct = await HK.storeReceipt(env, { order_id: theirs.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram" });
  ok("...and the shared helper refuses a mismatched customer even when called directly", direct.ok === false && direct.code === "forbidden");
}

section("Client-supplied prices are ignored");
{
  const env = await freshEnv();
  const r = await call(env, "POST", "/orders", {
    idem: "px-1",
    body: { telegram_user_id: 777001, address_id: 1, lines: [{ product_id: 1, qty: 2, unit_price_cents: 1, price_cents: 1, line_total_cents: 1 }], total_cents: 2, subtotal_cents: 2, shipping_cents: 0 },
  });
  ok("the order is created", r.status === 201, JSON.stringify(r.json));
  ok("...at the catalogue price, not the client's", r.json.total_cents === 3200, `${r.json.total_cents}`);
  const line = row(env, `SELECT unit_price_cents, line_total_cents FROM hk_order_lines WHERE order_id=(SELECT id FROM hk_orders WHERE order_no=?)`, r.json.order_no);
  ok("...and the stored line snapshot is the server price", line.unit_price_cents === 1200 && line.line_total_cents === 2400);
  const q = await call(env, "POST", "/quote", { body: { telegram_user_id: 777001, lines: [{ product_id: 1, qty: 1, unit_price_cents: 1 }] } });
  ok("a quote is equally unimpressed", q.json.total_cents === 2000, `${q.json.total_cents}`);
}

section("A customer cannot put themselves on privileged pricing");
{
  const env = await freshEnv();
  const claim = await call(env, "POST", "/customers", { body: { telegram_user_id: 777001, name: "Aminah", category: "stockist" } });
  ok("the mapping call ignores a category it was sent", claim.json.category === "retail", claim.json.category);
  const order = await call(env, "POST", "/orders", { body: { telegram_user_id: 777001, address_id: 1, lines: [{ package_id: 2, qty: 1 }] } });
  ok("a retail customer is refused a stockist package", order.status === 400 && order.json.error.code === "not_eligible", JSON.stringify(order.json));
  const agent = await call(env, "POST", "/orders", { body: { telegram_user_id: 777002, address_id: 2, lines: [{ package_id: 1, qty: 1 }] } });
  ok("an agent may buy the agent package", agent.status === 201, JSON.stringify(agent.json));
  const agentStockist = await call(env, "POST", "/orders", { body: { telegram_user_id: 777002, address_id: 2, lines: [{ package_id: 2, qty: 1 }] } });
  ok("...but not the stockist one", agentStockist.status === 400 && agentStockist.json.error.code === "not_eligible");
  const staffChange = await staff(env, SALES, "POST", "/customers/1/category", { category: "stockist" });
  ok("a sales person cannot promote a customer either", staffChange.status === 403, `${staffChange.status}`);
  const ceoChange = await staff(env, CEO, "POST", "/customers/1/category", { category: "stockist", reason: "signed the stockist agreement" });
  ok("...the owner can, and it is audited", ceoChange.status === 200 && row(env, `SELECT COUNT(*) c FROM audit_log WHERE action='hankeis.customer_category'`).c === 1);
}

section("The same bank transaction cannot verify two orders");
{
  const env = await freshEnv();
  const a = await anOrder(env);
  const b = await anOrder(env);
  const first = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(a.order_id));
  ok("the first allocation succeeds", first.ok === true, JSON.stringify(first));
  const second = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(b.order_id));
  ok("the same reference on another order is refused", second.ok === false && second.code === "already_allocated", JSON.stringify(second));
  ok("...naming the order it already paid for", second.ok === false && second.message.includes(a.order_no), second.ok ? "" : second.message);
  ok("the second order is untouched", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, b.order_id).payment_state === "awaiting_payment");
  ok("there is exactly one allocation row", row(env, `SELECT COUNT(*) c FROM hk_bank_allocations`).c === 1);
  /* and the constraint holds even if the pre-check is bypassed */
  let threw = false;
  try {
    env.DB._db.prepare(`INSERT INTO hk_bank_allocations (receiving_account,bank_reference,amount_cents,bank_time,order_id,verified_by) VALUES (?,?,?,?,?,?)`)
      .run("Maybank 5123xxxx1234", "MB240920ABC123", 3200, "x", b.order_id, 2);
  } catch { threw = true; }
  ok("...and the database refuses it at the constraint, not only in code", threw);
  /* a different receiving account may legitimately reuse a reference */
  const c = await anOrder(env);
  const other = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(c.order_id, { receiving_account: "Maybank 9999xxxx0000" }));
  ok("the same reference in a DIFFERENT account is allowed", other.ok === true, JSON.stringify(other));
}

section("Concurrent approvals produce one verification");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  /* both reviewers read the order before either writes - the interleaving
     that a read-then-write design loses to */
  const [r1, r2] = await Promise.all([
    HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { bank_reference: "MB-AAA-111" })),
    HK.verifyPayment(env, CEO, GOOD_VERIFY(o.order_id, { bank_reference: "MB-BBB-222" })),
  ]);
  const wins = [r1, r2].filter((r) => r.ok).length;
  ok("exactly one wins", wins === 1, `${wins} winners: ${JSON.stringify([r1, r2])}`);
  ok("the loser is told, and told nothing changed", [r1, r2].some((r) => !r.ok && /another reviewer|already/i.test(r.message)));
  ok("one allocation row exists", row(env, `SELECT COUNT(*) c FROM hk_bank_allocations WHERE order_id=?`, o.order_id).c === 1);
  ok("one payment_verified event exists", row(env, `SELECT COUNT(*) c FROM hk_outbox WHERE order_id=? AND event_type='payment.verified'`, o.order_id).c === 1);
  ok("the order is verified exactly once in the trail", row(env, `SELECT COUNT(*) c FROM hk_payment_events WHERE order_id=? AND action='payment_verified'`, o.order_id).c === 1);
}

section("A retried order creation produces one order");
{
  const env = await freshEnv();
  const body = { telegram_user_id: 777001, address_id: 1, lines: [{ product_id: 1, qty: 1 }] };
  const a = await call(env, "POST", "/orders", { body, idem: "tg-update-4821" });
  const b = await call(env, "POST", "/orders", { body, idem: "tg-update-4821" });
  const c = await call(env, "POST", "/orders", { body, idem: "tg-update-4821" });
  ok("the first creates", a.status === 201);
  ok("the retries replay the same answer", b.json.order_no === a.json.order_no && c.json.order_no === a.json.order_no);
  ok("...and only one order exists", row(env, `SELECT COUNT(*) c FROM hk_orders`).c === 1);
  const different = await call(env, "POST", "/orders", { body: { ...body, lines: [{ product_id: 1, qty: 9 }] }, idem: "tg-update-4821" });
  ok("the same key with a different body is a conflict, not a silent replay", different.status === 409 && different.json.error.code === "idempotency_conflict");
  const receipt1 = await call(env, "POST", `/orders/${a.json.order_no}/receipt?telegram_user_id=777001`, { raw: JPEG, ct: "image/jpeg", idem: "tg-receipt-1" });
  const receipt2 = await call(env, "POST", `/orders/${a.json.order_no}/receipt?telegram_user_id=777001`, { raw: JPEG, ct: "image/jpeg", idem: "tg-receipt-1" });
  ok("a retried receipt upload stores one receipt", receipt1.status === 201 && receipt2.json.receipt_id === receipt1.json.receipt_id && row(env, `SELECT COUNT(*) c FROM hk_receipts`).c === 1);
}

section("Stock cannot be oversold through concurrent reservations");
{
  const env = await freshEnv({ stock: 5 });
  const results = await Promise.all([
    HK.createOrder(env, { customer_id: 1, address_id: 1, lines: [{ product_id: 1, qty: 3 }], channel: "portal", created_by: 3 }),
    HK.createOrder(env, { customer_id: 1, address_id: 1, lines: [{ product_id: 1, qty: 3 }], channel: "portal", created_by: 3 }),
  ]);
  const won = results.filter((r) => r.ok).length;
  ok("only one of two orders for 3 of 5 succeeds", won === 1, `${won} won: ${JSON.stringify(results.map((r) => r.ok || r.code))}`);
  const reserved = row(env, `SELECT COALESCE(SUM(qty),0) q FROM hk_reservations WHERE released_at IS NULL`).q;
  ok("...and 3 are reserved, never 6", reserved === 3, `${reserved}`);
  ok("the refused order left no row behind", row(env, `SELECT COUNT(*) c FROM hk_orders`).c === 1);
  const third = await HK.createOrder(env, { customer_id: 1, address_id: 1, lines: [{ product_id: 1, qty: 3 }], channel: "portal", created_by: 3 });
  ok("a third is refused with the item named", third.ok === false && third.code === "out_of_stock" && /Seaweed Original/.test(third.message));
  const two = await HK.createOrder(env, { customer_id: 1, address_id: 1, lines: [{ product_id: 1, qty: 2 }], channel: "portal", created_by: 3 });
  ok("...but the remaining 2 can still be sold", two.ok === true);
  /* a multi-line order that fails on its second line leaves nothing held */
  env.DB._db.prepare(`INSERT INTO inventory_items (id,sku,name,stock) VALUES (11,'HK-SEA-SPY','Spicy',0)`).run();
  env.DB._db.prepare(`INSERT INTO hk_products (id,sku,name,unit_price_cents,inventory_item_id,is_active) VALUES (2,'HK-SEA-SPY','Spicy',1200,11,1)`).run();
  const before = row(env, `SELECT COALESCE(SUM(qty),0) q FROM hk_reservations WHERE released_at IS NULL`).q;
  const partial = await HK.createOrder(env, { customer_id: 1, address_id: 1, lines: [{ product_id: 1, qty: 1 }, { product_id: 2, qty: 1 }], channel: "portal", created_by: 3 });
  ok("a part-fillable order is refused whole", partial.ok === false && partial.code === "out_of_stock");
  ok("...and holds nothing", row(env, `SELECT COALESCE(SUM(qty),0) q FROM hk_reservations WHERE released_at IS NULL`).q === before);
}

section("Late payments and mismatched amounts stay in review");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  env.DB._db.prepare(`UPDATE hk_orders SET expires_at=datetime('now','-2 days'), order_state='expired' WHERE id=?`).run(o.order_id);
  const late = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { amount_cents: 3000, bank_reference: "MB-LATE-1" }));
  ok("the money is recorded - it really did arrive", late.ok === true, JSON.stringify(late));
  ok("...and both problems are raised as exceptions", late.ok && late.exceptions.map((e) => e.kind).sort().join(",") === "late_payment,underpaid", late.ok ? JSON.stringify(late.exceptions) : "");
  const after = row(env, `SELECT payment_state, fulfilment_state FROM hk_orders WHERE id=?`, o.order_id);
  ok("...and fulfilment is on hold, not ready to pack", after.fulfilment_state === "on_hold", after.fulfilment_state);
  const ship = await staff(env, PACKER, "POST", `/orders/${o.order_id}/ship`, { courier: "J&T", tracking_no: "JT9" });
  ok("...so it cannot be shipped while the exception is open", ship.status === 409 && /exception/i.test(ship.json.error.message), JSON.stringify(ship.json));
  const over = await anOrder(env);
  const o2 = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(over.order_id, { amount_cents: 5000, bank_reference: "MB-OVER-1" }));
  ok("an overpayment is an exception too", o2.ok && o2.exceptions.some((e) => e.kind === "overpaid"));
  const clean = await anOrder(env);
  const o3 = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(clean.order_id, { bank_reference: "MB-CLEAN-1" }));
  ok("an exact, timely payment goes straight to the packing queue", o3.ok && o3.exceptions.length === 0 && o3.fulfilment_state === "ready_to_pack");
}

section("A reviewer cannot invent an identifier to get past the form");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  for (const ref of ["n/a", "-", "TEST", "0", "abc"]) {
    const r = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { bank_reference: ref }));
    ok(`"${ref}" is refused as a bank reference`, r.ok === false && r.code === "no_reference", JSON.stringify(r));
  }
  const noAttest = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { attested_bank_checked: false }));
  ok("approval without the attestation is refused", noAttest.ok === false && noAttest.code === "attestation_required");
  const noAccount = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { receiving_account: "" }));
  ok("...and without naming the receiving account", noAccount.ok === false && noAccount.code === "no_account");
  const badAmount = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { amount_cents: 0 }));
  ok("...and without the banked amount", badAmount.ok === false && badAmount.code === "bad_amount");
  ok("the order never moved", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "awaiting_payment");
  const clar = await staff(env, SALES, "POST", `/orders/${o.order_id}/clarify`, { reason: "Resit tidak jelas - sila hantar tangkapan skrin penuh" });
  ok("the honest alternative is available to sales", clar.status === 200 && row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "clarification_required");
}

section("Rejecting a receipt keeps the history and never claims the bank failed");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const first = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram" });
  const rej = await staff(env, SALES, "POST", `/receipts/${first.receipt_id}/reject`, { reason: "Gambar kabur, nombor rujukan tidak dapat dibaca" });
  ok("a receipt can be rejected as unusable evidence", rej.status === 200);
  ok("...the order goes to clarification, not to a failure state", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "clarification_required");
  const ev = row(env, `SELECT payload FROM hk_outbox WHERE event_type='receipt.rejected' AND order_id=?`, o.order_id);
  ok("...and the customer message says so explicitly", /BUKAN bermakna pembayaran anda gagal/.test(ev.payload), ev.payload.slice(0, 120));
  const second = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG2, declaredType: "image/jpeg", via: "telegram" });
  ok("a replacement can be uploaded", second.ok === true);
  ok("...and the rejected one is still on the record", row(env, `SELECT COUNT(*) c FROM hk_receipts WHERE order_id=?`, o.order_id).c === 2);
  ok("...with its reason and reviewer kept", row(env, `SELECT state, reject_reason, reviewed_by FROM hk_receipts WHERE id=?`, first.receipt_id).reviewed_by === 3);
  ok("...and the order is back in review", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "awaiting_review");
}

section("Exact duplicate uploads are flagged, and the limit of matching is stated");
{
  const env = await freshEnv();
  const a = await anOrder(env);
  const b = await anOrder(env);
  const r1 = await HK.storeReceipt(env, { order_id: a.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram" });
  const r2 = await HK.storeReceipt(env, { order_id: b.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram" });
  ok("the second upload of the same file names the first", r2.ok && r2.duplicate_of === r1.receipt_id, JSON.stringify(r2));
  ok("...but it is still stored and still only awaiting_review", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, b.order_id).payment_state === "awaiting_review");
  const r3 = await HK.storeReceipt(env, { order_id: b.order_id, customer_id: 1, bytes: JPEG2, declaredType: "image/jpeg", via: "telegram" });
  ok("a different file is not flagged", r3.ok && r3.duplicate_of === null);
  const core = read("worker/src/hankeis-core.ts");
  ok("the code states that an edited copy evades exact matching", /resized or re-saved copy has a\s*\n?\s*\*?\s*different hash/i.test(core) || /resized or edited/i.test(read("worker/src/hankeis.ts")) || /different hash and will not match/.test(read("worker/migrations/0135_hankeis_commerce.sql")));
}

section("An unverified order cannot be shipped, and a verified one can");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const early = await staff(env, PACKER, "POST", `/orders/${o.order_id}/ship`, { courier: "J&T", tracking_no: "JT1" });
  ok("awaiting_payment cannot ship", early.status === 409);
  await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram" });
  const reviewing = await staff(env, PACKER, "POST", `/orders/${o.order_id}/ship`, { courier: "J&T", tracking_no: "JT1" });
  ok("awaiting_review cannot ship either", reviewing.status === 409);
  await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id));
  const noAuth = await staff(env, EDITOR, "POST", `/orders/${o.order_id}/ship`, { courier: "J&T", tracking_no: "JT1" });
  ok("...and an editor cannot ship a verified one", noAuth.status === 403);
  const stockBefore = row(env, `SELECT stock FROM inventory_items WHERE id=10`).stock;
  const ship = await staff(env, PACKER, "POST", `/orders/${o.order_id}/ship`, { courier: "J&T", tracking_no: "JT123456" });
  ok("a verified order ships", ship.status === 200, JSON.stringify(ship.json));
  ok("...stock leaves at despatch, through the portal ledger", row(env, `SELECT stock FROM inventory_items WHERE id=10`).stock === stockBefore - 2);
  ok("...with a ledger row naming the order", row(env, `SELECT reason FROM stock_ledger WHERE ref_type='hk_order'`).reason.includes(o.order_no));
  ok("...and the reservation is released", row(env, `SELECT COUNT(*) c FROM hk_reservations WHERE order_id=? AND released_at IS NULL`, o.order_id).c === 0);
}

section("A verified payment cannot be downgraded by a replay");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id));
  const again = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { bank_reference: "MB-SECOND-1" }));
  ok("a second approval is refused", again.ok === false && again.code === "bad_state");
  const lateReceipt = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG2, declaredType: "image/jpeg", via: "telegram" });
  ok("a late receipt upload is refused rather than resetting the state", lateReceipt.ok === false && lateReceipt.code === "already_verified");
  ok("the payment is still verified", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "verified");
  const clar = await staff(env, SALES, "POST", `/orders/${o.order_id}/clarify`, { reason: "late question" });
  ok("...and sales cannot drag it back to clarification", clar.status === 409, `${clar.status}`);
  ok("the state machine says the same thing on its own", CORE.canPaymentTransition("verified", "awaiting_review", "staff").ok === false);
  ok("...and refuses even finance a downgrade that is not a refund", CORE.canPaymentTransition("verified", "awaiting_payment", "finance").ok === false);
}

section("A notification failure never changes a payment");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id));
  const before = row(env, `SELECT payment_state, fulfilment_state FROM hk_orders WHERE id=?`, o.order_id);
  const claim = await call(env, "POST", "/events/claim", { body: { limit: 10, visibility_seconds: 30 } });
  const verified = claim.json.events.find((e) => e.event_type === "payment.verified");
  ok("the event is there to claim", Boolean(verified));
  const nack = await call(env, "POST", "/events/nack", { body: { event_id: verified.event_id, error: "Telegram 502" } });
  ok("a failed delivery can be returned", nack.status === 200);
  const after = row(env, `SELECT payment_state, fulfilment_state FROM hk_orders WHERE id=?`, o.order_id);
  ok("...and the payment is untouched", after.payment_state === before.payment_state && after.fulfilment_state === before.fulfilment_state);
  ok("...and the event is back in the queue for another try", row(env, `SELECT state, attempts, last_error FROM hk_outbox WHERE event_id=?`, verified.event_id).state === "pending");
  /* ten failures and it is dead-lettered, still without touching the order */
  for (let i = 0; i < 12; i++) {
    const c = await call(env, "POST", "/events/claim", { body: { limit: 10 } });
    const e = c.json.events.find((x) => x.event_id === verified.event_id);
    if (!e) break;
    await call(env, "POST", "/events/nack", { body: { event_id: verified.event_id, error: "still failing" } });
  }
  ok("a permanently failing event is dead-lettered, not retried for ever", row(env, `SELECT state FROM hk_outbox WHERE event_id=?`, verified.event_id).state === "dead");
  ok("...and the payment is STILL verified", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "verified");
}

section("The outbox is at-least-once, claimed safely, and acknowledged once");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const c1 = await call(env, "POST", "/events/claim", { body: { limit: 50, visibility_seconds: 600 } });
  ok("order.created is queued", c1.json.events.some((e) => e.event_type === "order.created"));
  const c2 = await call(env, "POST", "/events/claim", { body: { limit: 50 } });
  ok("a claimed event is not handed out twice while the claim is live", c2.json.events.length === 0, JSON.stringify(c2.json.events.map((e) => e.event_type)));
  const ids = c1.json.events.map((e) => e.event_id);
  const ack = await call(env, "POST", "/events/ack", { body: { event_ids: ids } });
  ok("acknowledging marks them delivered", ack.json.acknowledged === ids.length);
  const ack2 = await call(env, "POST", "/events/ack", { body: { event_ids: ids } });
  ok("...and a repeated ack is harmless", ack2.json.acknowledged === 0);
  ok("the response tells the adapter what delivery guarantee it has", c1.json.delivery === "at-least-once");
  ok("every event carries an id, a type, a version and a timestamp", c1.json.events.every((e) => e.event_id && e.event_type && e.payload_version === 1 && e.payload.occurred_at));
  /* a lapsed claim returns - which is precisely why it is at-least-once */
  const env2 = await freshEnv();
  await anOrder(env2);
  await call(env2, "POST", "/events/claim", { body: { limit: 5, visibility_seconds: 10 } });
  env2.DB._db.prepare(`UPDATE hk_outbox SET claim_expires_at=datetime('now','-1 minute')`).run();
  const again = await call(env2, "POST", "/events/claim", { body: { limit: 5 } });
  ok("a lapsed claim returns to the queue", again.json.events.length > 0 && again.json.events[0].attempts === 2);
}

section("Receipt files are validated by content, stored unguessably, served safely");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const htmlAsJpeg = new TextEncoder().encode("<html><script>alert(1)</script></html>" + "x".repeat(100));
  const bad = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: htmlAsJpeg, declaredType: "image/jpeg", via: "telegram" });
  ok("an HTML file claiming to be a JPEG is refused", bad.ok === false && bad.code === "unreadable", JSON.stringify(bad));
  const pdfAsJpeg = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(200).fill(0x20)]);
  const mism = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: pdfAsJpeg, declaredType: "image/jpeg", via: "telegram" });
  ok("a PDF renamed to .jpg is refused", mism.ok === false && mism.code === "type_mismatch");
  const realPdf = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: pdfAsJpeg, declaredType: "application/pdf", via: "telegram" });
  ok("an honest PDF is accepted", realPdf.ok === true);
  ok("the key is a UUID under hk/receipts, not the order number", CORE.RECEIPT_KEY_RE.test(realPdf.key) && !realPdf.key.includes(o.order_no));
  const tiny = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), declaredType: "image/jpeg", via: "telegram" });
  ok("a truncated file is refused", tiny.ok === false && tiny.code === "too_small");
  const serve = await staff(env, SALES, "GET", "/receipt-file", null, `?key=${encodeURIComponent(realPdf.key)}`);
  ok("a known key is served to staff", serve.status === 200);
  const guess = await staff(env, SALES, "GET", "/receipt-file", null, `?key=${encodeURIComponent("hk/receipts/00000000-0000-0000-0000-000000000000")}`);
  ok("an unknown key is not", guess.status === 404);
  const traversal = await staff(env, SALES, "GET", "/receipt-file", null, `?key=${encodeURIComponent("../../backups/2026-09-01.gz")}`);
  ok("a traversal attempt is refused before it reaches R2", traversal.status === 400);
  const res = await HK.handleHankeis(env, new Request(`https://x/?key=${encodeURIComponent(realPdf.key)}`), "/receipt-file", "GET", null, SALES, new URLSearchParams(`key=${realPdf.key}`));
  ok("...and an untrusted file is served sandboxed and never cached", res.headers.get("Content-Security-Policy").includes("sandbox") && res.headers.get("Cache-Control").includes("no-store") && res.headers.get("X-Content-Type-Options") === "nosniff");
  const overCap = [];
  for (let i = 0; i < 8; i++) overCap.push(await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(i)]), declaredType: "image/jpeg", via: "telegram" }));
  ok("a customer cannot pile receipts on one order for ever", overCap.some((r) => !r.ok && r.code === "too_many"));
}

section("The static QR works with no Telegram credentials and no OCR");
{
  CORE.registerOcrAdapter(null);
  const env = await freshEnv();
  ok("no OCR engine is configured", CORE.ocrAvailable() === false);
  const o = await anOrder(env);
  const snap = JSON.parse(row(env, `SELECT pay_snapshot FROM hk_orders WHERE id=?`, o.order_id).pay_snapshot);
  ok("the order carries a payment snapshot", snap.recipient_name === "HANKEIS ENTERPRISE" && snap.qr_image_key === "hk/qr/static.png");
  ok("...including the sentence that uploading is not paying, in BM", /BUKAN pengesahan pembayaran/.test(snap.disclaimer_bm));
  const up = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "portal", uploaded_by: 3 });
  ok("a receipt can be taken", up.ok === true);
  const v = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { receipt_id: up.receipt_id }));
  ok("a payment can be verified", v.ok === true, JSON.stringify(v));
  const shipped = await staff(env, PACKER, "POST", `/orders/${o.order_id}/ship`, { courier: "J&T", tracking_no: "JT777" });
  ok("...and the order can be shipped - the whole loop runs with neither", shipped.status === 200);
  ok("the snapshot is frozen: changing the recipient later does not rewrite it", (() => {
    env.DB._db.prepare(`UPDATE hk_settings SET value='SOMEONE ELSE' WHERE key='recipient_name'`).run();
    const again = JSON.parse(row(env, `SELECT pay_snapshot FROM hk_orders WHERE id=?`, o.order_id).pay_snapshot);
    return again.recipient_name === "HANKEIS ENTERPRISE";
  })());
}

section("Expiry releases stock; the QR does not expire with it");
{
  const env = await freshEnv({ stock: 3 });
  const o = await anOrder(env, { qty: 3 });
  ok("stock is held", row(env, `SELECT COALESCE(SUM(qty),0) q FROM hk_reservations WHERE released_at IS NULL`).q === 3);
  env.DB._db.prepare(`UPDATE hk_orders SET expires_at=datetime('now','-1 hour') WHERE id=?`).run(o.order_id);
  const swept = await HK.expireOrders(env);
  ok("the sweep expires it", swept.expired === 1);
  ok("...and releases the stock for somebody else", row(env, `SELECT COALESCE(SUM(qty),0) q FROM hk_reservations WHERE released_at IS NULL`).q === 0);
  const other = await HK.createOrder(env, { customer_id: 2, address_id: 2, lines: [{ product_id: 1, qty: 3 }], channel: "portal", created_by: 3 });
  ok("...which is now sellable", other.ok === true);
  const late = await HK.storeReceipt(env, { order_id: o.order_id, customer_id: 1, bytes: JPEG, declaredType: "image/jpeg", via: "telegram" });
  ok("a LATE payment on the expired order is still accepted for review", late.ok === true, JSON.stringify(late));
  const v = await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id, { amount_cents: 4400, bank_reference: "MB-LATE-9" }));
  ok("...and can be verified, into the exception workflow", v.ok === true && v.exceptions.some((e) => e.kind === "late_payment"));
  ok("...with fulfilment held so stock is re-checked by a human", row(env, `SELECT fulfilment_state FROM hk_orders WHERE id=?`, o.order_id).fulfilment_state === "on_hold");
  ok("the customer message says the QR did not expire", /Kod QR tidak tamat tempoh/.test(row(env, `SELECT payload FROM hk_outbox WHERE event_type='order.expired'`).payload));
}

section("Refunds record an external transfer, they do not make one");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(o.order_id));
  const confirmFirst = await staff(env, FINANCE, "POST", `/orders/${o.order_id}/refund`, { amount_cents: 3200, confirm_external: true, external_reference: "MB-REF-1" });
  ok("a confirmation without a request is refused", confirmFirst.status === 409);
  const req = await staff(env, FINANCE, "POST", `/orders/${o.order_id}/refund`, { amount_cents: 3200, reason: "customer changed mind" });
  ok("a refund request is recorded", req.status === 201);
  ok("...and says plainly that it is not a refund", /not a refund/i.test(req.json.note));
  ok("the payment is still verified until the money actually moves", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "verified");
  const noRef = await staff(env, FINANCE, "POST", `/orders/${o.order_id}/refund`, { amount_cents: 3200, confirm_external: true });
  ok("confirming without the bank reference of the transfer you made is refused", noRef.status === 400);
  const done = await staff(env, FINANCE, "POST", `/orders/${o.order_id}/refund`, { amount_cents: 3200, confirm_external: true, external_reference: "MB-REF-77" });
  ok("confirming with it is recorded", done.status === 200 && /did not move any money/i.test(done.json.note));
  ok("...and only then is the payment refunded", row(env, `SELECT payment_state FROM hk_orders WHERE id=?`, o.order_id).payment_state === "refunded");
  const sales = await staff(env, SALES, "POST", `/orders/${o.order_id}/refund`, { amount_cents: 1 });
  ok("sales cannot touch refunds", sales.status === 403);
}

section("Settings, credentials and the audit trail");
{
  const env = await freshEnv();
  const bySales = await staff(env, SALES, "PUT", "/settings", { recipient_name: "ATTACKER SDN BHD" });
  ok("sales cannot change where the money goes", bySales.status === 403);
  const byFinance = await staff(env, FINANCE, "PUT", "/settings", { recipient_name: "ATTACKER SDN BHD" });
  ok("...nor can finance", byFinance.status === 403);
  const byOwner = await staff(env, CEO, "PUT", "/settings", { recipient_name: "HANKEIS ENTERPRISE (2026)" });
  ok("the owner can", byOwner.status === 200);
  const a = row(env, `SELECT action, detail FROM audit_log WHERE action='hankeis.payment_destination_changed'`);
  ok("...and it is audited as a payment-destination change, with before and after", Boolean(a) && JSON.parse(a.detail).recipient_name.from === "HANKEIS ENTERPRISE" && JSON.parse(a.detail).recipient_name.to === "HANKEIS ENTERPRISE (2026)");
  ok("...and the other officers are notified", notified.some((n) => n.kind === "hankeis" && /payment destination changed/i.test(n.message)), JSON.stringify(notified.slice(0, 2)));
  const tok = await staff(env, CEO, "POST", "/clients", { name: "Astra Telegram adapter", scopes: ["catalogue", "orders"] });
  ok("the owner can mint an integration token", tok.status === 201 && tok.json.token.startsWith("hk_"));
  ok("...and only its hash is stored", row(env, `SELECT token_hash FROM hk_api_clients WHERE name='Astra Telegram adapter'`).token_hash !== tok.json.token);
  const bySalesTok = await staff(env, SALES, "POST", "/clients", { name: "sneaky" });
  ok("sales cannot mint one", bySalesTok.status === 403);
  const revoked = await staff(env, CEO, "POST", `/clients/${tok.json.id}/revoke`, {});
  ok("...and can revoke it", revoked.status === 200);
  const dead = await call(env, "GET", "/catalogue", { token: tok.json.token });
  ok("a revoked token stops working", dead.status === 401);
  const scoped = await call(env, "POST", "/events/claim", { token: TOKEN, body: {} });
  ok("a token with the events scope may claim", scoped.status === 200);
  const noScope = await (async () => {
    env.DB._db.prepare(`UPDATE hk_api_clients SET scopes='catalogue' WHERE id=1`).run();
    return call(env, "POST", "/orders", { body: { telegram_user_id: 777001, lines: [{ product_id: 1, qty: 1 }] } });
  })();
  ok("...and one without the scope may not order", noScope.status === 403 && noScope.json.error.code === "forbidden");
  const noToken = await call(env, "GET", "/catalogue", { token: "hk_wrongwrongwrongwrongwrongwrong" });
  ok("a wrong token is refused", noToken.status === 401);
}

section("Staff permissions are enforced on every route, not only the UI");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const cases = [
    ["viewing the dashboard", EDITOR, "GET", "", null, 403],
    ["creating an order", EDITOR, "POST", "/orders", { customer_id: 1, lines: [] }, 403],
    ["creating a product", SALES, "POST", "/products", { sku: "X", name: "X", unit_price_cents: 1 }, 403],
    ["resolving an exception", SALES, "POST", "/exceptions/1/resolve", { resolution: "x" }, 403],
    ["correcting an extraction", SALES, "POST", "/receipts/1/correct", { corrected_amount_cents: 1 }, 403],
  ];
  for (const [what, actor, method, path, body, want] of cases) {
    const r = await staff(env, actor, method, path, body);
    ok(`${what} is refused for ${actor.role}`, r.status === want, `${r.status}`);
  }
  const view = await staff(env, SALES, "GET", "");
  ok("a sales person can see the dashboard", view.status === 200);
  ok("...and is told what they may do", view.json.can.order === true && view.json.can.verify === false && view.json.can.admin === false);
}

section("The dashboard counts money only from verified payments");
{
  const env = await freshEnv();
  const paid = await anOrder(env);
  const unpaid = await anOrder(env);
  const cancelled = await anOrder(env);
  await HK.verifyPayment(env, FINANCE, GOOD_VERIFY(paid.order_id));
  await staff(env, SALES, "POST", `/orders/${cancelled.order_id}/cancel`, { reason: "duplicate" });
  const d = await staff(env, CEO, "GET", "");
  ok("verified sales are counted", d.json.money.verified_cents === 3200, `${d.json.money.verified_cents}`);
  ok("...an unpaid order is not", unpaid.total_cents === 3200 && d.json.money.verified_cents === 3200);
  ok("...and a cancelled one is shown apart, not folded in", d.json.money.cancelled_cents === 3200, `${d.json.money.cancelled_cents}`);
  ok("the queues are counted", d.json.counts.awaiting_payment === 1 && d.json.counts.to_pack === 1);
  ok("setup gaps are visible", d.json.setup.qr_configured === true && d.json.setup.ocr_available === false);
}

section("The receiving account reaches the reviewer's form, and nobody else");
{
  const env = await freshEnv();
  const o = await anOrder(env);
  const ACCOUNT = "Maybank 5123xxxx1234";

  const asFinance = await staff(env, FINANCE, "GET", `/orders/${o.order_id}`);
  ok("a reviewer is told which of our accounts to look in", asFinance.json.receiving_account === ACCOUNT, String(asFinance.json.receiving_account));

  const asSales = await staff(env, SALES, "GET", `/orders/${o.order_id}`);
  ok("a sales person opening the same order is not", asSales.status === 200 && asSales.json.receiving_account === null, String(asSales.json.receiving_account));

  /* the customer-facing snapshot says only that an account is configured */
  const snap = JSON.parse(row(env, `SELECT pay_snapshot FROM hk_orders WHERE id=?`, o.order_id).pay_snapshot);
  ok("the order's payment snapshot never stores the account", snap.receiving_account_label === "configured" && !JSON.stringify(snap).includes("5123"), JSON.stringify(snap));

  /* and the integration surface never returns it, in any field */
  const viaApi = await call(env, "GET", `/orders/${o.order_no}?telegram_user_id=777001`);
  ok("the Telegram surface can read the order", viaApi.status === 200, JSON.stringify(viaApi.json));
  ok("...and its whole response carries no account number", !JSON.stringify(viaApi.json).includes("5123"), JSON.stringify(viaApi.json?.payment_instructions ?? {}));
  ok("...while still telling the customer who to pay", viaApi.json.payment_instructions.recipient_name === "HANKEIS ENTERPRISE", JSON.stringify(viaApi.json.payment_instructions));
}

section("Every setting the owner can change actually changes something");
{
  const env = await freshEnv();
  const put = await staff(env, CEO, "PUT", "/settings", { shipping_mode: "quote" });
  ok("the owner can switch shipping to quoted", put.status === 200 && put.json.changed.includes("shipping_mode"), JSON.stringify(put.json));
  const q = await HK.createOrder(env, { customer_id: 1, address_id: 1, lines: [{ product_id: 1, qty: 1 }], channel: "portal", created_by: 3 });
  ok("...and a new order then waits for a shipping price", q.ok && row(env, `SELECT order_state FROM hk_orders WHERE id=?`, q.order_id).order_state === "quote_required", JSON.stringify(q));
  const d = await staff(env, CEO, "GET", "");
  ok("...and the dashboard counts it in that queue", d.json.counts.quote_required === 1, `${d.json.counts.quote_required}`);

  /* every key the settings form offers must be a key the worker accepts */
  const FORM_KEYS = ["recipient_name", "receiving_account", "qr_image_key", "shipping_mode", "shipping_flat_cents",
    "shipping_free_over_cents", "reservation_minutes", "max_receipts_per_order", "uploads_per_hour", "catalogue_key", "pay_instructions_bm"];
  const defaults = Object.keys(HK.SETTING_DEFAULTS);
  ok("the settings form offers exactly the keys the worker knows", FORM_KEYS.length === defaults.length && FORM_KEYS.every((k) => defaults.includes(k)),
    `form=${FORM_KEYS.length} worker=${defaults.length}: ${defaults.filter((k) => !FORM_KEYS.includes(k)).join(",") || "-"}`);
  const junk = await staff(env, CEO, "PUT", "/settings", { brand_name: "Something" });
  ok("...and an unknown key is not quietly stored", junk.status === 400 || (junk.json.changed ?? []).length === 0, JSON.stringify(junk.json));
}

section("The bot can send the QR picture, and nothing else about the account");
{
  const env = await freshEnv();
  /* nothing in the bucket yet */
  const before = await API.handleHankeisApi(env, apiReq("GET", "/qr"), "/qr");
  ok("a missing QR file is an honest 404, not a broken image", before.status === 404 || before.status === 503, `${before.status}`);

  await env.MEDIA.put("hk/qr/static.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
  const res = await API.handleHankeisApi(env, apiReq("GET", "/qr"), "/qr");
  ok("the configured QR is served to the bot", res.status === 200 && res.headers.get("content-type") === "image/png", `${res.status}`);
  ok("...and is not sniffable into something else", res.headers.get("x-content-type-options") === "nosniff");
  const body = new Uint8Array(await res.arrayBuffer());
  ok("...byte for byte", body.length === 7 && body[0] === 0x89);

  const noToken = await API.handleHankeisApi(env, apiReq("GET", "/qr", { token: "wrong-token-aaaaaaaaaaaaaaaaaaaaa" }), "/qr");
  ok("...but not to an unknown caller", noToken.status === 401, `${noToken.status}`);
}

console.log(failed === 0 ? `\nhankeis: ${passed} checks passed.` : `\n${failed} hankeis check(s) failed (${passed} passed).`);
process.exitCode = failed === 0 ? 0 : 1;
