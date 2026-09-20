#!/usr/bin/env node
/**
 * HANKEI'S - the integration simulator. v1.163.0. DEVELOPMENT ONLY.
 *
 * This file is not imported by the portal, the worker or any guard. It
 * exists so that whoever builds the Telegram bot can watch the whole
 * customer journey happen - map a customer, quote, order, upload a receipt,
 * poll the status, claim and acknowledge events - and see the exact bytes
 * on the wire, WITHOUT a Telegram token, a bot, or a deployment.
 *
 *   node scripts/hankeis-simulator.mjs
 *       Offline. Bundles the real worker modules and runs them against an
 *       in-memory SQLite database with migration 0135 applied. Nothing
 *       leaves the machine. Use this to learn the contract.
 *
 *   node scripts/hankeis-simulator.mjs --base https://<host>/api/v1/hankeis \
 *                                      --token hk_live_xxx --telegram-id 123456789
 *       Live. The same journey over HTTP against a running worker, with an
 *       integration token minted in the portal (Hankei's -> Settings ->
 *       integration credentials). It creates REAL orders in whatever
 *       database that worker is bound to, so point it at a preview or a
 *       staging deployment, never at the live one you take money in.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *   There is no --verify flag, and adding one is not possible: the
 *   integration API has no endpoint that marks a payment verified. The last
 *   step below TRIES to move an order forward with the bot's own credential
 *   and prints the refusal, because that refusal is the product.
 */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = arg("base");
const TOKEN = arg("token");
const TG = Number(arg("telegram-id", "770000001"));
const LIVE = Boolean(BASE);

if (LIVE && !TOKEN) { console.error("--base needs --token (mint one in the portal: Hankei's -> Settings)."); process.exit(2); }
if (!Number.isInteger(TG) || TG <= 0) { console.error("--telegram-id must be a positive integer - the NUMERIC Telegram user id, never a @username."); process.exit(2); }

const C = { dim: "\u001b[2m", b: "\u001b[1m", g: "\u001b[32m", r: "\u001b[31m", y: "\u001b[33m", x: "\u001b[0m" };
const step = (n, t) => console.log(`\n${C.b}${n}. ${t}${C.x}`);
const show = (method, path, status, body) => {
  const colour = status >= 200 && status < 300 ? C.g : C.r;
  console.log(`   ${C.dim}${method} ${path}${C.x}  ${colour}${status}${C.x}`);
  const text = JSON.stringify(body, null, 2) ?? "";
  console.log(text.split("\n").map((l) => `   ${C.dim}|${C.x} ${l}`).join("\n"));
};

/* ──────────────────────────────────────────────────────────────────────
   the two transports
   ────────────────────────────────────────────────────────────────────── */
let request; // (method, path, { body, raw, ct, idem }) -> { status, json }

if (LIVE) {
  request = async (method, path, { body, raw, ct = "application/json", idem } = {}) => {
    const headers = { Authorization: `Bearer ${TOKEN}` };
    if (idem) headers["Idempotency-Key"] = idem;
    const init = { method, headers };
    if (raw) { headers["content-type"] = ct; init.body = raw; }
    else if (body !== undefined) { headers["content-type"] = ct; init.body = JSON.stringify(body); }
    const res = await fetch(`${BASE}${path}`, init);
    let json = null; try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, json };
  };
  console.log(`${C.y}LIVE MODE${C.x} - real orders will be created at ${BASE}`);
} else {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "hk-sim-"));
  const stubUrl = (p) => pathToFileURL(p).href;
  writeFileSync(join(dir, "staff.js"), `export async function notify() {}`);
  for (const f of ["hankeis.ts", "hankeis-api.ts", "hankeis-core.ts", "shared.ts", "permissions.ts"]) {
    writeFileSync(join(dir, f), readFileSync(join(root, "worker/src", f), "utf8").replace('from "./staff"', `from "${stubUrl(join(dir, "staff.js"))}"`));
  }
  writeFileSync(join(dir, "entry.ts"), `export * as HK from "./hankeis";\nexport * as API from "./hankeis-api";\n`);
  const out = join(dir, "bundle.mjs");
  execSync(`npx esbuild "${join(dir, "entry.ts")}" --bundle --format=esm --platform=neutral --external:*/staff.js --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit", shell: true });
  const { HK, API } = await import(pathToFileURL(out).href);

  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, full_name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, sku TEXT, name TEXT, stock INTEGER DEFAULT 0, status TEXT DEFAULT 'active');
    CREATE TABLE stock_ledger (id INTEGER PRIMARY KEY, item_id INTEGER, sku TEXT, delta INTEGER, balance_after INTEGER, source TEXT, ref_type TEXT, ref_id TEXT, reason TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE error_log (id INTEGER PRIMARY KEY, source TEXT, message TEXT, path TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER, window_start TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, message TEXT, ref TEXT, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE data_versions (topic TEXT PRIMARY KEY, v INTEGER DEFAULT 0, at INTEGER DEFAULT 0);
  `);
  db.exec(readFileSync(join(root, "worker/migrations/0135_hankeis_commerce.sql"), "utf8"));

  const prep = (sql) => {
    const plain = sql.replace(/\?(\d+)/g, "?");
    const used = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
    return {
      _b: [],
      bind(...b) { this._b = b.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)); return this; },
      _a() { return used.length ? used.map((n) => this._b[n - 1] ?? null) : this._b; },
      async first() { const r = db.prepare(plain).get(...this._a()); return r === undefined ? null : r; },
      async all() { return { results: db.prepare(plain).all(...this._a()), success: true }; },
      async run() { const r = db.prepare(plain).run(...this._a()); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    };
  };
  let queue = Promise.resolve();
  const DB = {
    prepare: prep,
    batch(stmts) {
      const run = queue.then(async () => {
        db.exec("BEGIN IMMEDIATE");
        try { const res = []; for (const s of stmts) res.push(await s.run()); db.exec("COMMIT"); return res; }
        catch (e) { db.exec("ROLLBACK"); throw e; }
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const r2 = new Map();
  const MEDIA = {
    async put(k, b, o) { r2.set(k, { body: b instanceof Uint8Array ? b : new Uint8Array(b), ct: o?.httpMetadata?.contentType }); },
    async get(k) { const v = r2.get(k); return v ? { body: v.body, httpMetadata: { contentType: v.ct } } : null; },
    async head(k) { return r2.has(k) ? {} : null; },
  };
  const env = { DB, MEDIA };

  /* a shop to order from */
  const q = (sql, ...b) => db.prepare(sql).run(...b);
  q(`INSERT INTO users (id,name,full_name,role) VALUES (1,'Owner','Owner','ceo'),(2,'Finance','Finance','coo')`);
  q(`INSERT INTO inventory_items (id,sku,name,stock) VALUES (1,'HK-SER-30','Serum 30ml',40),(2,'HK-CLN','Cleanser',40)`);
  q(`INSERT INTO hk_settings (key,value) VALUES ('recipient_name','HANKEIS ENTERPRISE'),('receiving_account','Maybank 5123xxxx1234'),('qr_image_key','hk/qr/static.png'),('shipping_flat_cents','800')`);
  q(`INSERT INTO hk_products (id,sku,name,unit_price_cents,inventory_item_id,is_active,sort) VALUES (1,'HK-SER-30','Serum 30ml',12900,1,1,1),(2,'HK-CLN','Cleanser',5000,2,1,2)`);
  const SIM_TOKEN = "sim-token-development-only-0000000000";
  q(`INSERT INTO hk_api_clients (id,name,token_hash,scopes,is_active) VALUES (1,'simulator',?,'catalogue customers orders receipts status events',1)`,
    await HK.sha256Hex(new TextEncoder().encode(SIM_TOKEN)));

  request = async (method, path, { body, raw, ct = "application/json", idem } = {}) => {
    const headers = { Authorization: `Bearer ${SIM_TOKEN}` };
    if (idem) headers["Idempotency-Key"] = idem;
    const init = { method, headers };
    if (raw) { headers["content-type"] = ct; headers["content-length"] = String(raw.byteLength); init.body = raw; }
    else if (body !== undefined) { headers["content-type"] = ct; init.body = JSON.stringify(body); }
    const req = new Request(`https://example.invalid/api/v1/hankeis${path}`, init);
    const res = await API.handleHankeisApi(env, req, path.split("?")[0]);
    let json = null; try { json = await res.clone().json(); } catch { /* not json */ }
    return { status: res.status, json };
  };
  globalThis.__hkOffline = { env, HK, db };
  console.log(`${C.dim}Offline mode - the real worker modules over an in-memory database. Nothing leaves this machine.${C.x}`);
}

const call = async (method, path, opts) => { const r = await request(method, path, opts); show(method, path, r.status, r.json); return r; };

/* ──────────────────────────────────────────────────────────────────────
   the journey a Telegram bot makes
   ────────────────────────────────────────────────────────────────────── */
step(1, "Is the integration up? (no token needed for this one)");
await call("GET", "/health");

step(2, "/start - bind this Telegram user to a customer record");
console.log(`   ${C.dim}The numeric id from message.from.id. Never the @username: a username can be changed and re-registered by somebody else.${C.x}`);
const who = await call("POST", "/customers", { body: { telegram_user_id: TG, name: "Simulated Customer", phone: "0120000000" } });
if (who.status >= 400) { console.error("\nCould not map a customer - stopping."); process.exit(1); }

step(3, "Show the menu");
const cat = await call("GET", "/catalogue");
const first = cat.json?.products?.[0];
if (!first) { console.error("\nNo products in the catalogue - add one in the portal first."); process.exit(1); }

step(4, "Price the basket BEFORE promising anything");
console.log(`   ${C.dim}Prices and eligibility are decided by the server from the customer's own category. Anything the bot sends as a price is ignored.${C.x}`);
await call("POST", "/quote", { body: { telegram_user_id: TG, lines: [{ product_id: first.id, qty: 2, unit_price_cents: 1 }] } });

step(5, "Place the order - with an Idempotency-Key, and send it TWICE");
const key = `sim-${Date.now()}`;
const made = await call("POST", "/orders", { idem: key, body: { telegram_user_id: TG, lines: [{ product_id: first.id, qty: 2 }] } });
const again = await call("POST", "/orders", { idem: key, body: { telegram_user_id: TG, lines: [{ product_id: first.id, qty: 2 }] } });
const orderNo = made.json?.order_no;
console.log(`   ${made.json?.order_no && made.json.order_no === again.json?.order_no ? `${C.g}Same order number both times - the retry created nothing.${C.x}` : `${C.r}Two different orders. Check the Idempotency-Key.${C.x}`}`);

step(6, "Read the order back - this is what the bot shows the customer");
console.log(`   ${C.dim}payment_instructions carries the recipient NAME and the QR key, never an account number. message_bm is ready to send as-is.${C.x}`);
await call("GET", `/orders/${orderNo}?telegram_user_id=${TG}`);

step(7, "The customer sends a photo - forward the FILE BYTES, not a file_id");
console.log(`   ${C.dim}POST the raw image body with its content-type. The type is checked by magic bytes, so a .jpg that is really something else is refused.${C.x}`);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(400).fill(0x41)]);
const up = await call("POST", `/orders/${orderNo}/receipt?telegram_user_id=${TG}`, { raw: JPEG, ct: "image/jpeg" });
console.log(`   ${C.y}Read that "note" field aloud: the upload is evidence, not payment. Tell the customer exactly that.${C.x}`);

step(8, "Poll the order - it is AWAITING REVIEW, not paid");
const afterUpload = await call("GET", `/orders/${orderNo}?telegram_user_id=${TG}`);
console.log(`   ${afterUpload.json?.payment_state === "awaiting_review" ? `${C.g}payment_state = awaiting_review. A person has to find this in the bank.${C.x}` : `${C.r}Unexpected state: ${afterUpload.json?.payment_state}${C.x}`}`);

step(9, "Another customer's order is invisible - a wrong owner answers exactly like a wrong number");
console.log(`   ${C.dim}A second, fully mapped customer asks for the first one's order number. 404, identical to an order that does not exist, so the API cannot be used to discover order numbers.${C.x}`);
await call("POST", "/customers", { body: { telegram_user_id: TG + 1, name: "Someone Else" } });
await call("GET", `/orders/${orderNo}?telegram_user_id=${TG + 1}`);
await call("GET", `/orders/HK-991231-9999?telegram_user_id=${TG + 1}`);

step(10, "Drain the outbox - this is how the bot learns anything changed");
console.log(`   ${C.dim}claim -> send -> ack. A claim that is never acked is redelivered, so delivery is AT LEAST once: make sending idempotent on event id.${C.x}`);
const claimed = await call("POST", "/events/claim", { body: { limit: 10 } });
for (const e of claimed.json?.events ?? []) {
  console.log(`   ${C.dim}-> would send to Telegram user ${e.telegram_user_id ?? "(unmapped)"}: [${e.event_type}] ${String(e.payload?.message_bm ?? "").slice(0, 90)}${C.x}`);
}
if ((claimed.json?.events ?? []).length) await call("POST", "/events/ack", { body: { event_ids: claimed.json.events.map((e) => e.event_id) } });

step(11, "Try to mark the payment verified with the bot's own credential");
console.log(`   ${C.dim}There is no endpoint for it. These are the two an integration might reach for.${C.x}`);
await call("POST", `/orders/${orderNo}/verify`, { body: { verified: true } });
await call("POST", `/orders/${orderNo}/status`, { body: { payment_state: "verified" } });
console.log(`   ${C.g}404 / 405 / 403 is the correct answer. Only a signed-in staff member holding hankeis_verify can move money-state, in the portal, after reading Maybank.${C.x}`);

step(12, "What a verification looks like when a person does it");
if (LIVE) {
  console.log(`   ${C.dim}Not simulated in live mode - that would write a bank allocation into a real database. Do it in the portal and watch step 10 deliver payment.verified.${C.x}`);
} else {
  const { env, HK, db } = globalThis.__hkOffline;
  const id = db.prepare(`SELECT id FROM hk_orders WHERE order_no = ?`).get(orderNo).id;
  const r = await HK.verifyPayment(env, { id: 2, role: "coo", name: "Finance" }, {
    order_id: id, receiving_account: "Maybank 5123xxxx1234", bank_reference: "MB260920SIM001",
    amount_cents: db.prepare(`SELECT total_cents FROM hk_orders WHERE id = ?`).get(id).total_cents,
    bank_time: "2026-09-20 11:02:13", attested_bank_checked: true,
  });
  console.log(`   ${C.dim}verifyPayment(finance actor, what the reviewer READ IN THE BANK) -> ${JSON.stringify(r)}${C.x}`);
  const twice = await HK.verifyPayment(env, { id: 2, role: "coo", name: "Finance" }, {
    order_id: id, receiving_account: "Maybank 5123xxxx1234", bank_reference: "MB260920SIM001",
    amount_cents: 100, bank_time: "2026-09-20 11:05:00", attested_bank_checked: true,
  });
  console.log(`   ${C.dim}the same order a second time -> ${JSON.stringify(twice)}${C.x}`);
  /* the case that actually matters: a DIFFERENT order, the SAME bank
     transaction. This is the one a unique index has to stop, because the
     state check above cannot see it. */
  const second = await HK.createOrder(env, { customer_id: 1, lines: [{ product_id: 1, qty: 1 }], channel: "portal", created_by: 1 });
  const reused = await HK.verifyPayment(env, { id: 2, role: "coo", name: "Finance" }, {
    order_id: second.order_id, receiving_account: "Maybank 5123xxxx1234", bank_reference: "MB260920SIM001",
    amount_cents: second.total_cents, bank_time: "2026-09-20 11:02:13", attested_bank_checked: true,
  });
  console.log(`   ${C.dim}a DIFFERENT order, the same bank reference -> ${JSON.stringify(reused)}${C.x}`);
  console.log(`   ${C.g}One bank transaction pays for one order, and it is a UNIQUE index on (receiving_account, bank_reference) that says so - not a check the code could forget.${C.x}`);
  const post = await call("GET", `/orders/${orderNo}?telegram_user_id=${TG}`);
  console.log(`   ${post.json?.payment_state === "verified" ? `${C.g}The customer now sees payment_state = verified, with message_bm to match.${C.x}` : `${C.r}Still ${post.json?.payment_state}${C.x}`}`);
  const evs = await call("POST", "/events/claim", { body: { limit: 10 } });
  console.log(`   ${C.dim}and the bot picks up: ${(evs.json?.events ?? []).map((e) => e.event_type).join(", ") || "(nothing)"}${C.x}`);
}

console.log(`\n${C.b}Done.${C.x} The contract this walked through is written up in TELEGRAM_HANDOFF.md.\n`);
