/* 19-11-2026 - CORRECT ATTENDANCE FROM THE PERSON'S DAY (the CEO: "on attendance & record I should
 * be able to perform correction"). Runtime guard on the live-own harness (whole worker, every
 * migration) plus the drawer's source:
 *   - HR / CEO change a punch's time, remove a punch and add a missing one, through the existing
 *     routes; each is marked on the punch and the reason is kept in the audit log
 *   - nobody corrects their own record; a seller cannot correct at all; no time in the future
 *   - the drawer's Corrections tab carries the controls only for attendance_correct and not on
 *     your own record, and asks for a reason before each change
 *
 *   node tests/attendance-correct.mjs
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
  const entry = join(srcRoot, "attendance-correct-entry.ts");
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
    const P = db.prepare(`INSERT INTO attendance_records (user_id, type, created_at) VALUES (?, ?, ?) RETURNING id`);
    const inId = P.get(5, "clock_in", "2026-11-09 07:31:00").id;   // 15:31 MYT - punched late
    const dup = P.get(5, "clock_in", "2026-11-09 07:40:00").id;    // a second press
    const audits = (a) => db.prepare(`SELECT detail FROM audit_log WHERE action = ? ORDER BY id`).all(a).map((r) => r.detail);
    /* change a time */
    const ed = await call(`/attendance/${inId}`, U.hr, "PATCH", { myt: "2026-11-09 09:02", reason: "Phone had no signal at the door" });
    ok(ed.status === 200, "HR changes the time of a punch", ed.text.slice(0, 200));
    const r1 = row(`SELECT created_at, amended_by FROM attendance_records WHERE id = ?`, inId);
    ok(r1.created_at === "2026-11-09 01:02:00" && r1.amended_by === U.hr, "the punch now reads 09:02 MYT and is marked amended by HR", fmt(r1));
    ok(/"reason":"Phone had no signal at the door"/.test(audits("attendance.amend").at(-1) ?? ""), "the reason is kept in the audit log");
    ok((await call(`/attendance/${inId}`, U.hr, "PATCH", { myt: "2026-11-11 09:00", reason: "future test" })).status === 400, "a time in the future is refused");
    /* remove a punch */
    const del = await call(`/attendance/${dup}?reason=${encodeURIComponent("Pressed twice by mistake")}`, U.ceo, "DELETE");
    ok(del.status === 200 && !row(`SELECT id FROM attendance_records WHERE id = ?`, dup), "the CEO removes a duplicate punch", del.text.slice(0, 200));
    ok(/"reason":"Pressed twice by mistake"/.test(audits("attendance.delete").at(-1) ?? ""), "…with its reason in the audit log");
    /* add a missing clock-out */
    const add = await call(`/attendance/manual`, U.coo, "POST", { user_id: 5, type: "clock_out", myt: "2026-11-09 17:10", reason: "Forgot to clock out" });
    ok(add.status === 201 && row(`SELECT manual_by FROM attendance_records WHERE user_id = 5 AND type = 'clock_out'`)?.manual_by === U.coo, "the COO adds the missing clock-out, marked manual", add.text.slice(0, 200));
    ok(/"reason":"Forgot to clock out"/.test(audits("attendance.manual").at(-1) ?? ""), "…with its reason in the audit log");
    const day = (await call(`/attendance/day?date=2026-11-09`, U.ceo)).j?.staff?.find((x) => x.id === 5);
    ok(day && (day.punches ?? []).length === 2 && day.punches.some((x) => x.source === "amended") && day.punches.some((x) => x.source === "manual"), "the day shows the amended clock-in and the manual clock-out", fmt(day?.punches));
    /* who may not */
    const selfPunch = P.get(6, "clock_in", "2026-11-09 01:00:00").id;
    ok((await call(`/attendance/${selfPunch}`, U.hr, "PATCH", { myt: "2026-11-09 08:30", reason: "my own record" })).status === 403, "nobody corrects their own record");
    ok((await call(`/attendance/manual`, U.hr, "POST", { user_id: 6, type: "clock_out", myt: "2026-11-09 17:00", reason: "my own record" })).status === 403, "…nor adds to it");
    ok((await call(`/attendance/${inId}`, U.aina, "PATCH", { myt: "2026-11-09 08:00", reason: "I want to" })).status === 403, "a seller cannot correct attendance");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

/* the drawer */
{
  const out2 = [];
  const ok2 = (c, m) => out2.push([!!c, m]);
  const rec = readFileSync(join(root, "components/portal/attendance-records.tsx"), "utf8");
  const cor = readFileSync(join(root, "components/portal/attendance-correct.tsx"), "utf8");
  ok2(/const canCorrect = holds\("attendance_correct", \[[^\]]*\]\.includes\(user\.role\)\) && target\?\.id !== user\.id;/.test(rec), "the drawer offers corrections for attendance_correct, never on your own record");
  ok2(/\{canCorrect \? <DayCorrections /.test(rec), "the Corrections tab carries the correction controls");
  ok2(/method: "PATCH", body: JSON\.stringify\(\{ myt: `\$\{editDay\} \$\{editTime\}`, reason: why\.trim\(\) \}\)/.test(cor) && /\?reason=\$\{encodeURIComponent\(why\.trim\(\)\)\}`, \{ method: "DELETE" \}/.test(cor) && /"\/staff\/attendance\/manual", \{ method: "POST"/.test(cor), "the three existing routes, each with the reason");
  ok2((cor.match(/disabled=\{busy \|\| [^}]*okReason\(/g) ?? []).length === 3, "no change is sent without a reason (5+ characters)");
  ok2(/variant: "danger"/.test(cor), "a removal asks first");
  globalThis.__drawer = out2;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
report(globalThis.__drawer);
const dir = mkdtempSync(join(tmpdir(), "attcor-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`attendance-correct: ${fail} of ${n} failed`); process.exit(1); }
console.log(`PASS - attendance corrections from the person's day: change, remove, add - each with its reason; never your own record (${n} checks)`);
