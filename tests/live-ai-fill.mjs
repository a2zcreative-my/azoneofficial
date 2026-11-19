/* 19-11-2026 - LIVE REPORTS: THE AI FILLS, STAFF TYPE THE REST (the CEO: "Duration, AI read 60,
 * but the textbox appear 1 ... Manual filled should only the textbox that AI doesnt filled and
 * require manual to insert by staff"). Runtime guard on the live-own harness: the WHOLE worker
 * bundled against SQLite with every migration, the screenshot AI stood in by the local test fake.
 *   - before any reading, staff type every figure
 *   - a reading writes the figures it read into the draft (60 replaces the typed 1)
 *   - the draft refuses a different value for an AI figure; the figures the AI did not read stay typed
 *   - a newer screenshot's reading wins for the figures it read; the older reading keeps the rest
 *   - submit writes the AI's figures again (a draft typed before this rule is corrected)
 *   - the reviewer is told which figures the AI read; a reading that found nothing fills nothing
 *
 *   node tests/live-ai-fill.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "live-ai-fill-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const applyAll = (db, migDir) => {
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    let buf = "";
    for (const st of readFileSync(join(migDir, f), "utf8").split(/;\s*\n/)) {
      buf = buf ? `${buf};\n${st}` : st;
      if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
      try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
      buf = "";
    }
  }
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(0)]);

async function runtime(workerBundle, migDir) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  const realClock = new DatabaseSync(":memory:");
  const pinTs = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const fn of ["datetime", "date", "time", "julianday"]) db.function(fn, { varargs: true }, (...a) => realClock.prepare(`SELECT ${fn}(${(a.length ? a : ["now"]).map(() => "?").join(",")}) AS v`).get(...(a.length ? a : ["now"]).map((x) => (typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  db.function("strftime", { varargs: true }, (...a) => realClock.prepare(`SELECT strftime(${a.map(() => "?").join(",")}) AS v`).get(...a.map((x, i) => (i > 0 && typeof x === "string" && x.toLowerCase() === "now" ? pinTs() : x))).v);
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-10T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  applyAll(db, migDir);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const stored = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "http://127.0.0.1:8787", LIVE_AI_TEST_FAKE: '{"gmv": 250.5, "orders": 0, "duration_min": 60}',
    MEDIA: { put: async (k, body) => { if (body && typeof body === "object" && "getReader" in body) await new Response(body).arrayBuffer(); stored.set(k, true); }, get: async (k) => (stored.has(k) ? { body: "x", httpMetadata: { contentType: "image/png" }, arrayBuffer: async () => PNG.buffer } : null), head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6, host: 7, cco: 8 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (7,'Farid','Farid Host','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',250000,'2024-01-01'),
    (8,'Chen','Chen CCO','chen@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  for (let c = 1; c <= 4; c++) db.exec(`INSERT INTO customers (id, company, contact_person, created_by) VALUES (${c}, 'Client ${c} Sdn Bhd', 'Contact ${c}', 5)`);
  const ITEMS = (cents) => JSON.stringify([{ name: "Website", qty: 1, unit_price_cents: cents }]);
  const doc = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind, issuer_code, payment_ref)
                          VALUES (?, 'INV', ?, ?, ?, 0, 0, ?, ?, ?, '2026-11-02 01:00:00', 5, 5, 'service', ?, ?)`);
  doc.run(101, "INV-T-101", 1, ITEMS(100000), 100000, "paid", "2026-11-05 02:00:00", "a2z", "MBB-101");   // A2Z, paid, to be verified by the CEO
  doc.run(102, "INV-T-102", 2, ITEMS(50000), 50000, "paid", "2026-11-06 02:00:00", "azoo", "MBB-102");   // AZ ONE, paid, not verified
  doc.run(103, "INV-T-103", 3, ITEMS(90000), 90000, "unpaid", null, "a2z", null);                         // A2Z, a part payment of RM 300
  db.exec(`INSERT INTO invoice_payments (id, invoice_id, amount_cents, received_on, reference, created_by) VALUES (7, 103, 30000, '2026-11-07', 'MBB-P7', 3)`);
  /* the payroll example: the bank run booked RM 13,161.66; payroll now totals RM 13,156.66 */
  db.exec(`INSERT INTO payroll_entries (user_id, month, basic_cents, commission_cents, allowance_cents, deduction_cents, net_cents) VALUES (5, '2026-08', 1315666, 0, 0, 0, 1315666)`);
  db.exec(`INSERT INTO payroll_payments (month, paid_by, paid_at) VALUES ('2026-08', 3, '2026-09-04 02:24:00')`);
  db.exec(`INSERT INTO cashflow_entries (id, entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key) VALUES (50, '2026-09-04', 'out', 'salaries', 1316166, 'Payroll bank run 2026-08', 'PAYROLL-2026-08', 3, '2026-09-04', 'PAYROLL-2026-08')`);
  /* an agent payout settled by Finance (Commission 5.0, K-5) */
  db.exec(`INSERT INTO cashflow_entries (id, entry_date, type, category, amount_cents, description, ref, created_by, effective_date, source_key) VALUES (51, '2026-11-09', 'out', 'agent_commission', 7000, 'Agent commission payout AGT-9 - Ros', 'AGT-9', 3, '2026-11-09', 'AGT-9')`);

  const app = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); }
  const hdr = (uid, extra = {}) => ({ origin: "http://127.0.0.1:8787", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", ...extra });
  const call = async (p, uid, method = "GET", body) => {
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1/staff${p}`, { method, headers: hdr(uid), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const attach = async (id, uid) => (await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/expenses/${id}/evidence`, { method: "POST", headers: hdr(uid, { "content-type": "image/png", "content-length": String(PNG.length) }), body: PNG }), env, { waitUntil() {} })).status;
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  const view = async (company = "all", uid = U.ceo, from = "2026-11-01", to = "2026-11-30") => (await call(`/erp/cashbook?from=${from}&to=${to}&company=${company}`, uid)).j;
  const fmt = (x) => JSON.stringify(x)?.slice(0, 300);
  const upload = async (rid, uid, type = "image/png", bytes = PNG) => (await app.fetch(new Request(`https://api.a2z.test/api/v1/staff/live-reports/${rid}/files`, { method: "POST", headers: hdr(uid, { "content-type": type, "content-length": String(bytes.length), "x-file-name": "gmv.png" }), body: bytes }), env, { waitUntil() {} })).status;
  const throws = (sql) => { try { db.exec(sql); return false; } catch { return true; } };
  const money = () => ["sales_documents", "invoice_payments", "cashflow_entries", "journal_entries", "payroll_entries", "commission_ledger", "agent_payouts"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  try {
    db.exec(`INSERT INTO system_meta (key, value) VALUES ('live_ai_settings', '{"enabled":true,"cap":30,"ceiling":8000}')`);
    const base = { session_date: "2026-11-09", start_time: "15:00", end_time: "17:00", platform: "tiktok", role: "host" };
    const own = await call("/live-reports/unplanned", U.host, "POST", { ...base, company: "a2z" });
    const R = own.j?.id;
    ok(own.status === 201 && R, "an own live is recorded", own.text.slice(0, 200));
    const draft = () => row(`SELECT draft_gmv_cents AS gmv, draft_orders AS orders, draft_duration_min AS dur, draft_items_sold AS items FROM live_reports WHERE id = ?`, R);
    /* before any reading: everything is typed */
    ok((await call(`/live-reports/${R}/draft`, U.host, "PUT", { gmv: "100", orders: 3, duration_min: 1 })).status === 200 && draft().dur === 1, "before the AI reads, staff type every figure");
    ok((await call(`/live-reports/${R}`, U.host)).j?.ai_keys?.length === 0, "…and no figure is marked as the AI's");
    /* the AI reads: its figures go into the boxes */
    ok((await upload(R, U.host)) === 201, "a screenshot is attached");
    const F1 = row(`SELECT id FROM live_report_files WHERE report_id = ? ORDER BY id DESC`, R)?.id;
    const rd = await call(`/live-reports/${R}/files/${F1}/read`, U.host, "POST", {});
    ok(rd.status === 200 && rd.j?.manual === false, "the AI reads the screenshot", rd.text.slice(0, 200));
    ok(JSON.stringify(rd.j?.filled?.sort()) === JSON.stringify(["duration_min", "gmv", "orders"]), "…and says which figures it filled", fmt(rd.j?.filled));
    const d1 = draft();
    ok(d1.dur === 60 && d1.orders === 0 && d1.gmv === 25050, "the AI's figures replace what was typed (duration 1 -> 60, orders 3 -> 0, GMV RM 250.50)", fmt(d1));
    const det = (await call(`/live-reports/${R}`, U.host)).j;
    ok(JSON.stringify([...(det?.ai_keys ?? [])].sort()) === JSON.stringify(["duration_min", "gmv", "orders"]), "the report marks the AI's figures", fmt(det?.ai_keys));
    /* a figure the AI read cannot be typed over; the others are still typed */
    const over = await call(`/live-reports/${R}/draft`, U.host, "PUT", { duration_min: 1 });
    ok(over.status === 409 && over.j?.error?.code === "ai_filled" && draft().dur === 60, "typing over an AI figure is refused", over.text.slice(0, 200));
    ok((await call(`/live-reports/${R}/draft`, U.host, "PUT", { orders: 0, items_sold: 5 })).status === 200 && draft().items === 5, "the same value is accepted, and a figure the AI did not read is typed");
    /* a newer, clearer screenshot wins for what it reads */
    env.LIVE_AI_TEST_FAKE = '{"duration_min": 120}';
    await upload(R, U.host);
    const F2 = row(`SELECT id FROM live_report_files WHERE report_id = ? ORDER BY id DESC`, R)?.id;
    await call(`/live-reports/${R}/files/${F2}/read`, U.host, "POST", {});
    const d2 = draft();
    ok(d2.dur === 120 && d2.gmv === 25050 && d2.orders === 0 && d2.items === 5, "a newer reading wins for the figure it read; the rest stay", fmt(d2));
    /* a reading that finds nothing fills nothing */
    env.LIVE_AI_TEST_FAKE = '{}';
    await upload(R, U.host);
    const F3 = row(`SELECT id FROM live_report_files WHERE report_id = ? ORDER BY id DESC`, R)?.id;
    const r3 = await call(`/live-reports/${R}/files/${F3}/read`, U.host, "POST", {});
    ok(r3.j?.manual === true && JSON.stringify(draft()) === JSON.stringify(d2), "a reading that found no figures changes nothing", fmt(r3.j));
    /* submit: the AI's figures are what is frozen, even if a draft was typed over before the rule */
    db.exec(`UPDATE live_reports SET draft_duration_min = 1 WHERE id = ${R}`);
    const sub = await call(`/live-reports/${R}/submit`, U.host, "POST", {});
    ok(sub.j?.version === 1, "the report is submitted", sub.text.slice(0, 200));
    const v1 = row(`SELECT gmv_cents AS gmv, orders, duration_min AS dur, items_sold AS items FROM live_report_versions WHERE report_id = ? AND version = 1`, R);
    ok(v1.dur === 120 && v1.gmv === 25050 && v1.orders === 0 && v1.items === 5, "the submitted version carries the AI's figures and the typed ones", fmt(v1));
    const rev = (await call(`/live-reports/${R}`, U.ceo)).j;
    ok(JSON.stringify([...(rev?.ai_keys ?? [])].sort()) === JSON.stringify(["duration_min", "gmv", "orders"]), "the reviewer is told which figures the AI read", fmt(rev?.ai_keys));
    /* no AI at all: a report is still typed by hand */
    env.LIVE_AI_TEST_FAKE = "";
    const man = await call("/live-reports/unplanned", U.aina, "POST", { ...base, session_date: "2026-11-08", company: "a2z" });
    const M = man.j?.id;
    ok((await call(`/live-reports/${M}/draft`, U.aina, "PUT", { gmv: 40, duration_min: 90 })).status === 200 && (await upload(M, U.aina)) === 201 && (await call(`/live-reports/${M}/submit`, U.aina, "POST", {})).j?.version === 1, "with no reading, every figure is typed and submitted");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "liveai-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`live-ai-fill: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - live reports: the AI fills the figures it reads and they stay its own; staff type only the rest (${n} checks)`);
