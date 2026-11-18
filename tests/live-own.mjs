/* v1.385.0 - LIVE REPORTS: THE PROJECT IS OPTIONAL (the CEO, 18-11-2026: "Live report should
 * Live TikTok or Live for Project instead of only tight with Project! Project is option if require
 * or any project that need to link with."). Runtime guard on the tasks-gate4 harness: the WHOLE
 * worker bundled against SQLite with every migration, by direct request as each role.
 *   - an own live (no project) is recorded with its company chosen, never guessed
 *   - an own live with no company is refused; a submit with no company is refused
 *   - an own live of AZ ONE is not merged into an own live of A2Z at the same time
 *   - the same own live reported twice is joined, never made twice (GMV counted once)
 *   - a report takes a project on, and takes it off again
 *   - a live for a project still needs an ACTIVE project
 *
 *   node tests/live-own.mjs
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
  const entry = join(srcRoot, "live-own-entry.ts");
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
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async (k, body) => { if (body && typeof body === "object" && "getReader" in body) await new Response(body).arrayBuffer(); stored.set(k, true); }, get: async (k) => (stored.has(k) ? { body: "x", httpMetadata: { contentType: "image/png" } } : null), head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
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
  const hdr = (uid, extra = {}) => ({ origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", ...extra });
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
    db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, created_at, created_by, salesperson_id, kind, issuer_code) VALUES (302, 'QT', 'QT-T-302', 4, '[]', 0, 0, 50000, '2026-10-01 01:00:00', 5, 5, 'service', 'a2z'), (303, 'QT', 'QT-T-303', 4, '[]', 0, 0, 50000, '2026-10-01 01:00:00', 5, 5, 'service', 'a2z')`);
    db.exec(`INSERT INTO projects (id, quotation_id, customer_id, owner_id, status, title, deliverables, version, created_by) VALUES (2, 302, 4, 5, 'in_progress', 'Live Selling', '[]', 1, 1)`);
    db.exec(`INSERT INTO projects (id, quotation_id, customer_id, owner_id, status, title, deliverables, version, created_by) VALUES (3, 303, 4, 5, 'completed', 'Old Package', '[]', 1, 1)`);
    const base = { session_date: "2026-11-09", start_time: "15:00", end_time: "17:00", platform: "tiktok", role: "host" };
    const m0 = money();
    ok((await call("/live-reports/unplanned", U.host, "POST", { ...base })).j?.error?.code === "company_required", "an own live with no company is refused");
    ok((await call("/live-reports/unplanned", U.host, "POST", { ...base, company: "elfia" })).j?.error?.code === "company_required", "…and with a company that is not A2Z or AZ ONE");
    const own = await call("/live-reports/unplanned", U.host, "POST", { ...base, project_id: null, company: "azoo" });
    ok(own.status === 201 && own.j?.id, "an own live (no project) is recorded", own.text.slice(0, 200));
    const R = own.j?.id, S = own.j?.session_id;
    ok(row(`SELECT project_id, unplanned, client_name FROM live_sessions WHERE id = ?`, S)?.project_id === null && row(`SELECT unplanned FROM live_sessions WHERE id = ?`, S)?.unplanned === 1, "…on the roster as Unplanned with no project");
    ok(row(`SELECT company FROM live_reports WHERE id = ?`, R)?.company === "azoo", "…its report carries the company chosen");
    const again = await call("/live-reports/unplanned", U.aina, "POST", { ...base, start_time: "15:30", company: "azoo", role: "co_host" });
    ok(again.status === 409 && again.j?.existing && again.j?.session_id === S, "the same own live (company, platform, time) is joined, never made twice", again.text.slice(0, 200));
    const other = await call("/live-reports/unplanned", U.aina, "POST", { ...base, company: "a2z", role: "host" });
    ok(other.status === 201 && other.j?.session_id !== S, "an A2Z own live at the same time is its own live, never merged into AZ ONE's", other.text.slice(0, 200));
    ok((await call("/live-reports/unplanned", U.host, "POST", { ...base, session_date: "2026-11-08", project_id: 3 })).j?.error?.code === "project_required", "a live for a project still needs an ACTIVE project");
    const pj = await call("/live-reports/unplanned", U.host, "POST", { ...base, session_date: "2026-11-08", project_id: 2 });
    ok(pj.status === 201 && row(`SELECT company FROM live_reports WHERE id = ?`, pj.j?.id)?.company === "a2z", "a live for a project takes the project's company", pj.text.slice(0, 200));
    /* the own live submits with no project */
    ok((await call(`/live-reports/${R}/draft`, U.host, "PUT", { gmv: "120.00" })).status === 200, "the host keeps the own live's draft");
    await upload(R, U.host);
    const sub = await call(`/live-reports/${R}/submit`, U.host, "POST", {});
    ok(sub.j?.version === 1, "an own live is submitted without a project", sub.text.slice(0, 200));
    ok(row(`SELECT company, project_id FROM live_report_versions WHERE report_id = ? AND version = 1`, R)?.company === "azoo" && row(`SELECT project_id FROM live_report_versions WHERE report_id = ? AND version = 1`, R)?.project_id === null, "…the version keeps its company and no project");
    /* a report takes a project on, and off again; no company means no submit */
    const O = other.j?.id;
    ok((await call(`/live-reports/${O}/draft`, U.aina, "PUT", { project_id: 2 })).status === 200 && row(`SELECT project_id FROM live_sessions WHERE id = ?`, other.j?.session_id)?.project_id === 2, "a report links a project afterwards");
    ok((await call(`/live-reports/${O}/draft`, U.aina, "PUT", { company: "azoo" })).status === 400, "…and then the company comes from the project");
    ok((await call(`/live-reports/${O}/draft`, U.aina, "PUT", { project_id: null, company: null })).status === 200 && row(`SELECT project_id FROM live_sessions WHERE id = ?`, other.j?.session_id)?.project_id === null, "…and takes it off again (an own live)");
    await call(`/live-reports/${O}/draft`, U.aina, "PUT", { gmv: 50 }); await upload(O, U.aina);
    ok((await call(`/live-reports/${O}/submit`, U.aina, "POST", {})).j?.error?.code === "company_required", "an own live with no company is never submitted");
    ok((await call(`/live-reports/${O}/draft`, U.aina, "PUT", { company: "a2z" })).status === 200 && (await call(`/live-reports/${O}/submit`, U.aina, "POST", {})).j?.version === 1, "…once its company is chosen, it is");
    /* a roster live with no project is reported as an own live */
    db.exec(`INSERT INTO live_sessions (id, session_date, start_time, end_time, platform, host_user_id, status, created_by) VALUES (90, '2026-11-07', '20:00', '22:00', 'tiktok', 7, 'completed', 1)`);
    const RL = (await call("/live-reports", U.host, "POST", { session_id: 90 })).j?.id;
    await call(`/live-reports/${RL}/draft`, U.host, "PUT", { gmv: 10, company: "a2z" }); await upload(RL, U.host);
    ok((await call(`/live-reports/${RL}/submit`, U.host, "POST", {})).j?.version === 1, "a roster live with no project is submitted as an own live");
    ok(money() === m0, "reported GMV touches no sales, payment, cash, journal, payroll or commission row", `${m0} -> ${money()}`);
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "liveown-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`live-own: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - live reports: an own live or a live for a project; the company is always named, never guessed (${checks} checks)`);
