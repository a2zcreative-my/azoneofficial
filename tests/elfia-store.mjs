/* ELFIA STORE 2.0 (v1.235.0) - runtime guard: the WHOLE worker (index.ts,
 * bundled - the store's feed lives there) against SQLite with every
 * migration applied. Nothing here calls the live store: fetch is stubbed.
 *
 * The owner's brief and answers, 30-10-2026 (claude/ELFIA-STORE-AUDIT.md):
 * three tabs; price, discount, publish, bulk changes and Update now for the
 * CEO, COO and super admin (content stays with Inventory); one explicit Save;
 * "Only show Synced when the actual integration response ... supports it."
 *
 *   1 one product record: the feed serves exactly the published,
 *     non-discontinued Inventory items, unchanged; stock is Inventory's
 *   2 the customer price is web (or list) price minus a discount below it,
 *     never the TikTok rebate; an ended flash sale is full price; a discount
 *     not below the price is refused on BOTH routes (discount and price)
 *   3 who may change what the live shop charges or shows - by direct request
 *   4 "Connected" is a recorded READ by the store, made only with the key;
 *     a product is "waiting" until the store reads after its change; a
 *     failed Update now is never recorded as applied
 *   5 photos: a replacement never deletes the old file; history and Restore
 *     only ever point at this product's own keys
 * Then mutated copies must each fail a check.
 *
 *   node tests/elfia-store.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => execSync(`npx esbuild "${join(srcRoot, "worker/src/index.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const KEY = "bridge-key-for-tests";

async function runtime(workerBundle) {
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
  const files = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://x", ELFIA_BRIDGE_KEY: KEY, ELFIA_STORE_URL: "https://store.test",
    MEDIA: { put: async (k, v) => { files.set(k, v); }, head: async (k) => (files.has(k) ? { key: k } : null), get: async (k) => (files.has(k) ? { body: files.get(k), httpMetadata: {} } : null) },
  };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Boss','b@a2z.test','ceo',1,'x',1,'S'),(2,'Ops','o@a2z.test','coo',1,'x',1,'S'),(3,'Mkt','m@a2z.test','marketing',1,'x',1,'S'),
    (4,'Aina','a@a2z.test','sales_marketing',1,'x',1,'S'),(5,'Shop','c@x.test','customer',1,'x',0,NULL),(6,'Com','cc@a2z.test','cco',1,'x',1,'S')`);
  db.exec(`INSERT INTO inventory_items (id, sku, name, stock, status, unit_price_cents, live_rebate_cents, bridge_enabled, elfia_price_cents, elfia_discount_cents, elfia_category) VALUES
    (1,'ELF001','ELFIAWEAR BLACK',13,'active',1600,300,1,1400,350,'Shawl'),
    (2,'ELF002','ELFIAWEAR MAROON',8,'active',1600,0,1,NULL,NULL,'Bawal'),
    (3,'ELF003','ELFIAWEAR SILVER',0,'discontinued',1600,0,1,1400,NULL,'Shawl'),
    (4,'ELF004','ELFIAWEAR MOCHA',5,'active',1600,0,0,1400,NULL,'Shawl'),
    (5,'ELF005','ELFIAWEAR PURPLE',9,'active',1600,0,1,1400,350,'Shawl')`);
  db.exec(`UPDATE inventory_items SET elfia_flash_until = '2026-09-01 00:00:00' WHERE id = 5`);
  const before = JSON.stringify(db.prepare(`SELECT id, sku, name, stock, status, bridge_enabled, elfia_price_cents, elfia_discount_cents FROM inventory_items ORDER BY id`).all());
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-30T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const at = (iso) => { fixed = new RealDate(iso).getTime(); };
  let storeAnswer = { status: 200, body: { created: 0, updated: 2, prices: 1 } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { if (String(url).startsWith("https://store.test")) return new Response(JSON.stringify(storeAnswer.body), { status: storeAnswer.status }); throw new Error(`no network in tests: ${url}`); };
  const mod = await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`);
  const worker = mod.default;
  const tok = {};
  for (const id of [1, 2, 3, 4, 5, 6]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id);
  }
  const call = async (path, uid, method = "GET", body, raw) => {
    const headers = { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": raw ? raw.type : "application/json" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: raw ? raw.body : body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const feed = async (key = KEY) => {
    const r = await worker.fetch(new Request("https://api.a2z.test/api/v1/bridge/elfia-inventory", { headers: { "X-Bridge-Key": key } }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const meta = (k) => db.prepare(`SELECT value FROM system_meta WHERE key = ?`).get(k)?.value ?? null;
  const row = (id) => db.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(id);

  try {
    /* 4a - a read is recorded only with the key */
    const bad = await feed("wrong-key");
    ok(bad.status === 401 && meta("elfia_feed_last_read") === null, "a feed request with a wrong key is refused and records nothing", String(bad.status));
    let h = (await call("/staff/inventory/bridge-health", 1)).j;
    ok(h?.key_configured === true && h.feed_last_read_at === null, "before any read: the key is set, no read recorded (not 'Connected')", JSON.stringify(h));

    /* 1/2 - the feed */
    at("2026-10-30T02:00:00Z");
    const f = await feed();
    const bySku = Object.fromEntries((f.j?.items ?? []).map((x) => [x.sku, x]));
    ok(f.status === 200 && Object.keys(bySku).sort().join() === "ELF001,ELF002,ELF005", "the feed serves exactly the published, non-discontinued items", Object.keys(bySku).join());
    ok(bySku.ELF001?.price_cents === 1050 && bySku.ELF001.list_price_cents === 1400, "customer pays RM 14.00 - RM 3.50 = RM 10.50, to the sen", JSON.stringify(bySku.ELF001));
    ok(bySku.ELF002?.price_cents === 1600, "no web price: the list price; the TikTok rebate never applies online");
    ok(bySku.ELF005?.price_cents === 1400 && !bySku.ELF005.list_price_cents, "an ended flash sale charges the full price");
    ok(bySku.ELF001.stock === 13 && bySku.ELF002.stock === 8, "stock is Inventory's, unchanged");
    ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(meta("elfia_feed_last_read") ?? "") && meta("elfia_feed_last_count") === "3", "the store's read is recorded (the database clock, to the ms), with the count it was handed", String(meta("elfia_feed_last_read")));
    ok(JSON.stringify(db.prepare(`SELECT id, sku, name, stock, status, bridge_enabled, elfia_price_cents, elfia_discount_cents FROM inventory_items ORDER BY id`).all()) === before, "reading the feed changes no product");

    /* 3 - who may change what */
    ok((await call("/staff/inventory/2/bridge", 3, "PATCH", { bridge_enabled: false })).status === 403, "Marketing cannot unpublish");
    ok((await call("/staff/inventory/2/bridge", 4, "PATCH", { elfia_price: 12 })).status === 403, "Sales & Marketing cannot set a web price");
    ok((await call("/staff/inventory/2/bridge", 6, "PATCH", { elfia_price: 12 })).status === 403, "the CCO cannot set a web price");
    ok((await call("/staff/inventory/2/elfia", 3, "PATCH", { discount: 2 })).status === 403, "Marketing cannot set a discount");
    ok((await call("/staff/elfia/bulk-discount", 3, "POST", { ids: [1, 2], mode: "amount", value: 1 })).status === 403
      && (await call("/staff/elfia/bulk-price", 4, "POST", { ids: [1], mode: "set", value: 9 })).status === 403
      && (await call("/staff/elfia/flash-sale", 3, "POST", { ids: [1], until: null })).status === 403, "bulk discount, bulk price and flash sale are refused outside CEO/COO/SA");
    ok((await call("/staff/elfia/sync-now", 3, "POST", {})).status === 403, "Marketing cannot press Update the shop now");
    ok((await call("/staff/inventory/2/elfia", 3, "PATCH", { description: "Soft chiffon, easy to style" })).status === 200 && row(2).elfia_description === "Soft chiffon, easy to style", "Marketing still writes descriptions (the owner: content stays)");
    ok((await call("/staff/inventory/2/elfia", 5, "PATCH", { description: "hack" })).status === 403, "a customer is refused");
    ok(JSON.stringify(db.prepare(`SELECT bridge_enabled, elfia_price_cents, elfia_discount_cents FROM inventory_items ORDER BY id`).all()) === JSON.stringify(JSON.parse(before).map((r) => ({ bridge_enabled: r.bridge_enabled, elfia_price_cents: r.elfia_price_cents, elfia_discount_cents: r.elfia_discount_cents }))), "every refusal changed nothing");

    /* 2 - discount vs price, both ways */
    ok((await call("/staff/inventory/1/elfia", 2, "PATCH", { discount: 14 })).status === 400, "a discount equal to the price is refused");
    const lower = await call("/staff/inventory/1/bridge", 2, "PATCH", { elfia_price: 3.5 });
    ok(lower.status === 400 && row(1).elfia_price_cents === 1400, "a web price at or under the standing discount is refused (the shop would ignore the discount)", `${lower.status} ${JSON.stringify(lower.j)}`);
    db.exec(`UPDATE inventory_items SET unit_price_cents = 300 WHERE id = 1`);
    ok((await call("/staff/inventory/1/bridge", 1, "PATCH", { elfia_price: "" })).status === 400 && row(1).elfia_price_cents === 1400, "clearing to a list price under the discount is refused too");
    db.exec(`UPDATE inventory_items SET unit_price_cents = 1600 WHERE id = 1`);

    /* 4b - waiting and read */
    at("2026-10-30T02:10:00Z");
    ok((await call("/staff/inventory/2/bridge", 1, "PATCH", { elfia_price: 15 })).status === 200 && row(2).elfia_price_cents === 1500, "the CEO sets a web price");
    let act = (await call("/staff/elfia/activity", 3)).j;
    ok(act?.waiting?.some((w) => w.sku === "ELF002") && !act.waiting.some((w) => w.sku === "ELF004"), "the change waits for the store's next read", JSON.stringify(act?.waiting));
    await new Promise((r) => setTimeout(r, 1100)); // the read lands in a later second than the change
    await feed();
    act = (await call("/staff/elfia/activity", 3)).j;
    ok(act && !act.waiting.some((w) => w.sku === "ELF002") && act.changed.ELF002 < act.feed_last_read_at, "after the store reads, it is read - not before", JSON.stringify(act?.waiting));
    at("2026-10-30T02:12:00Z");
    await call("/staff/elfia/bulk-discount", 2, "POST", { ids: [2, 4], mode: "amount", value: 1 });
    act = (await call("/staff/elfia/activity", 3)).j;
    ok(act?.waiting?.some((w) => w.sku === "ELF002") && act.waiting.some((w) => w.sku === "ELF004"), "a bulk change marks every product it touched as waiting", JSON.stringify(act?.waiting));

    /* 4c - Update now: only the store's own answer counts */
    storeAnswer = { status: 500, body: { error: "busy" } };
    const fail = await call("/staff/elfia/sync-now", 1, "POST", {});
    h = (await call("/staff/inventory/bridge-health", 1)).j;
    ok(fail.status === 502 && h.last_sync_now === null, "a failed Update now is reported failed, and nothing is recorded as applied", `${fail.status} ${JSON.stringify(h.last_sync_now)}`);
    storeAnswer = { status: 200, body: { created: 0, updated: 2, prices: 1 } };
    const good = await call("/staff/elfia/sync-now", 2, "POST", {});
    h = (await call("/staff/inventory/bridge-health", 1)).j;
    ok(good.status === 200 && h.last_sync_now?.result?.updated === 2 && h.last_sync_now.who === "Ops", "a successful Update now records the store's own answer, and who asked", JSON.stringify(h.last_sync_now));
    ok(h.feed_last_read_at === meta("elfia_feed_last_read") && h.feed_last_count === 3 && h.store_url === "https://store.test", "health carries the last read, its count and the shop's address");

    /* 5 - photos */
    const up = (uid, bytes) => call("/staff/inventory/1/elfia/photo", uid, "POST", undefined, { type: "image/png", body: new Uint8Array(bytes) });
    at("2026-10-30T03:00:00Z");
    const p1 = await up(3, [1, 2, 3]);
    at("2026-10-30T03:05:00Z");
    const p2 = await up(3, [4, 5, 6]);
    ok(p1.status === 201 && p2.status === 201 && files.has(p1.j.image_key) && files.has(p2.j.image_key) && row(1).elfia_image_key === p2.j.image_key, "a replacement is a new file; the old file is kept", `${p1.status} ${p2.status}`);
    const hist = (await call("/staff/inventory/1/elfia/photos", 3)).j?.photos ?? [];
    ok(hist.length === 2 && hist[0].current && hist[1].key === p1.j.image_key && !hist[1].current, "the photo history lists both, newest first", JSON.stringify(hist));
    const markBefore = row(1).elfia_image_updated_at;
    at("2026-10-30T03:10:00Z");
    const rs = await call("/staff/inventory/1/elfia/photo/restore", 3, "POST", { key: p1.j.image_key });
    ok(rs.status === 200 && row(1).elfia_image_key === p1.j.image_key && row(1).elfia_image_updated_at !== markBefore, "Restore points back at the earlier file, with a new marker so the store re-downloads", JSON.stringify(rs.j));
    ok((await call("/staff/inventory/1/elfia/photo/restore", 3, "POST", { key: "uploads/elfia/2-123.png" })).status === 400, "a key of another product is refused");
    ok((await call("/staff/inventory/1/elfia/photo/restore", 3, "POST", { key: "uploads/elfia/1-999.png" })).status === 400, "a key not in this product's history is refused");
    ok((await call("/staff/inventory/1/elfia", 3, "PATCH", { remove_photo: true })).status === 200 && files.has(p1.j.image_key) && files.has(p2.j.image_key), "removing a photo from the shop deletes no file");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'inventory.elfia_photo_restore'`).get().n === 1, "a restore is audited");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
  }
  return out;
}

function source() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
  const perms = read("worker/src/permissions.ts");
  const prod = read("components/portal/elfia-products.tsx");
  const panel = read("components/portal/elfia-store-panel.tsx");
  const roles = (src, re) => { const m = src.match(re); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort().join() : null; };
  ok(roles(perms, /elfia_publish: \[([^\]]*)\]/) === "ceo,coo,super_admin" && roles(prod, /ELFIA_PUBLISH_ROLES: readonly string\[\] = \[([^\]]*)\]/) === "ceo,coo,super_admin", "the screen's price/publish roles equal the server's");
  ok(/L\("Overview", "Gambaran"\)/.test(panel) && /L\("Products & Pricing", "Produk & Harga"\)/.test(panel) && /L\("Publishing & Sync", "Penerbitan & Segerak"\)/.test(panel) && !/L\("Orders"|L\("Customers"|L\("Discounts"/.test(panel), "three tabs - and no Orders, Customers or Discounts tab");
  ok(/if \(!\(await confirm\(\{ title: L\(`Change the discount on/.test(panel) && /if \(!\(await confirm\(\{ title: L\(`Change the web price of/.test(panel) && /Cut out the background on up to/.test(panel), "bulk discount, bulk price and Cut out ALL each ask first, with a preview");
  ok(!/onBlur=\{/.test(prod), "the drawer has no save-on-blur - one explicit Save");
  ok(/conn === "reading"/.test(panel) && !/key_configured && \(\s*<>\s*<span className=\{chipSuccess\}>\{L\("Connected"/.test(panel), "'Connected' rests on a recorded read, not on the key being set");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "elfia-"));
bundle(root, join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
report(source());

const MUT = [
  ["worker/src/permissions.ts", "Marketing may publish and price again", 'elfia_publish: ["super_admin", "ceo", "coo"],', 'elfia_publish: ["super_admin", "ceo", "coo", "cco", "marketing", "sales_marketing"],'],
  ["worker/src/staff.ts", "a price under the discount is accepted", "if (d > 0 && nextBase > 0 && d >= nextBase) {", "if (false) {"],
  ["worker/src/staff.ts", "the discount gate is dropped", 'if (hasDiscount && !can(user.role, "elfia_publish"))', "if (false)"],
  ["worker/src/index.ts", "the feed read is not recorded", "env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('elfia_feed_last_read', strftime('%Y-%m-%d %H:%M:%f', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),", ""],
  ["worker/src/staff.ts", "waiting ignores the store's read", "const waiting = [...changed].filter(([, at]) => !lastRead || at >= lastRead.slice(0, 19))", "const waiting = [...changed].filter(() => false)"],
  ["worker/src/staff.ts", "Restore accepts any key", 'if (!known) return err("invalid_input", "That photo is not in this product\'s history", 400);', ""],
  ["worker/src/staff.ts", "a failed Update now is recorded", 'return err("store_refused",', 'await audit(env, user.id, "elfia.sync_now", "inventory_items", null, {}); return err("store_refused",'],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "elfia-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`elfia-store: ${fail} of ${n} failed`); process.exit(1); }
console.log(`elfia-store: ${n} checks passed (${MUT.length} mutations caught) - one product record, the feed's price, the owner's roles, a recorded read before 'Connected', photos never lost`);
