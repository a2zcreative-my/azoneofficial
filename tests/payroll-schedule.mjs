/* PAYROLL SCHEDULE AND TEST ACCOUNTS (v1.384.0) - runtime guard: the WHOLE worker against SQLite.
 * The CEO, 18-11-2026: "Generate payslips & Release to staff every each of 5th except on weekend or public
 * holiday which is the payroll done before it" and "Testing Account should not appear as a staff since it is
 * testing account using CCO roles for morning briefing".   node tests/payroll-schedule.mjs */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fakeGoogle } from "./lib/fake-google.mjs"; // v1.265.0 - Google is OpenID Connect now

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
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const mails = [];
  let mailFails = false;
  const MAIL = { send: async (m) => { if (mailFails) throw new Error("smtp down"); mails.push(m); } };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "azoneofficial.com", COMPANY_DOMAINS: "azoneofficial.com,a2zcreative.my", ALLOWED_ORIGINS: "https://portal.a2z.test",
    GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const U = { ceo: 1, coo: 2, hr_admin: 4, super_admin: 8, customer: 9, ceo2: 12, aina: 5, mia: 6, nora: 13, ed: 10, lia: 11, zul: 15, agent: 16, tech: 7, test: 17 };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES
    (1,'Alif','alif@azoneofficial.com','ceo',1,'x',1,'${SECRET}',0),(2,'Ops','ops@azoneofficial.com','coo',1,'x',1,'${SECRET}',0),
    (4,'Hana','hana@azoneofficial.com','hr_admin',1,'x',1,'${SECRET}',200000),
    (5,'Aina Sofea binti Kamal','aina@gmail.com','sales_marketing',1,'x',1,'${SECRET}',210000),(6,'Mia','mia@azoneofficial.com','marketing',1,'x',1,'${SECRET}',200000),
    (7,'Tech','tech@azoneofficial.com','admin',1,'x',1,'${SECRET}',0),(8,'Root','root@azoneofficial.com','super_admin',1,'x',1,'${SECRET}',0),
    (9,'Shop','shop@azoneofficial.com','customer',1,'x',0,NULL,0),(10,'Ed','ed@azoneofficial.com','editor',1,'x',1,'${SECRET}',200000),
    (11,'Lia','lia@yahoo.com','live_host',1,'x',1,'${SECRET}',150000),(12,'Second','ceo2@azoneofficial.com','ceo',1,'x',1,'${SECRET}',0),
    (13,'Nora','nora@azoneofficial.com','editor',1,'x',1,'${SECRET}',200000),(15,'Zul','zul@azoneofficial.com','editor',1,'oauth$google',0,NULL,0),
    (16,'Agent','agent@azoneofficial.com','agent',1,'x',0,NULL,0),(17,'Testing Account','testing@gmail.com','cco',1,'x',1,'${SECRET}',0)`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai',13)`);
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, created_at, created_by, salesperson_id, kind) VALUES (100,'INV','INV-1',1,'[]',0,0,10000,'unpaid','2026-10-20 02:00:00',13,13,'service')`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-31T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  /* Google, as the worker sees it (v1.265.0: discovery, PKCE, a signed ID token) */
  const G = fakeGoogle({ clientId: "cid" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => (await G.fetch(u, init)) ?? new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  const signIn = (id) => {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  };
  for (const id of Object.values(U)) signIn(id);
  const call = async (path, uid, method = "GET", body) => {
    const headers = { "content-type": "application/json", origin: "https://portal.a2z.test", ...(uid ? { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" } : {}) };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* a redirect */ }
    return { status: r.status, j, text, loc: r.headers.get("location"), cookies: r.headers.get("set-cookie") ?? "" };
  };
  /* the whole round trip: start (PKCE, nonce, state, binding cookie), the
     person picks their Google account, the callback */
  const google = async (sub, email) => {
    const st = await worker.fetch(new Request(`https://api.a2z.test/api/v1/auth/google`), env);
    const bind = /azone_g_bind=([0-9a-f]{64})/.exec(st.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const { code, state } = G.authorize(st.headers.get("location") ?? "https://x.invalid/", { sub, email });
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/auth/google/callback?code=${code}&state=${state}`, { headers: { cookie: `azone_g_bind=${bind}` } }), env);
    /* v1.266.1 - a failure carries a reference (&ref=A-1B2C3D); compare the page */
    return { status: r.status, loc: (r.headers.get("location") ?? "").replace(/&ref=[SGTA]-[0-9A-F]{6}$/, ""), ref: /&ref=([SGTA]-[0-9A-F]{6})$/.exec(r.headers.get("location") ?? "")?.[1] ?? null, cookies: r.headers.get("set-cookie") ?? "" };
  };
  /* v1.264.0 - the code step after a Google sign-in: the challenge is the
     HttpOnly twofa_ch cookie the callback set, sent back the way a browser
     would (the page's script never sees it) */
  const verifyG = async (cookies, c) => {
    const ch = /twofa_ch=([^;]+)/.exec(cookies)?.[1];
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/auth/2fa/verify`, { method: "POST", headers: { "content-type": "application/json", origin: "https://portal.a2z.test", ...(ch ? { cookie: `twofa_ch=${ch}` } : {}) }, body: JSON.stringify({ code: c }) }), env);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text, cookies: r.headers.get("set-cookie") ?? "" };
  };
  const R = "Testing account for the morning brief, not a real staff member";
  const audits = (a) => db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id`).all(a).map((r) => ({ ...r, d: JSON.parse(r.detail ?? "{}") }));
  try {
    /* ---- the payslip date: the 5th, or the working day BEFORE a weekend or public holiday ---- */
    const rel = async (m) => (await call(`/staff/payroll?month=${m}`, U.ceo)).j?.release?.available_from;
    ok((await rel("2026-09")) === "2026-10-05 10:00", "a 5th on a working day stays the 5th (Mon 5 Oct 2026)", await rel("2026-09"));
    ok((await rel("2026-11")) === "2026-12-04 10:00", "a Saturday 5th moves to the Friday before (5 Dec 2026 -> 4 Dec)", await rel("2026-11"));
    ok((await rel("2027-08")) === "2027-09-03 10:00", "a Sunday 5th moves to the Friday before (5 Sep 2027 -> 3 Sep)", await rel("2027-08"));
    db.exec(`INSERT INTO holidays (holiday_date, name) VALUES ('2027-01-05', 'Test holiday'), ('2027-01-04', 'Test holiday 2'), ('2027-01-01', 'New Year')`);
    ok((await rel("2026-12")) === "2026-12-31 10:00", "a public holiday 5th (and a holiday before it) moves back to the working day before: 5 Jan 2027 -> 31 Dec 2026", await rel("2026-12"));

    /* ---- a test account is not staff ---- */
    ok((await call("/staff/owner", U.super_admin, "POST", { user_id: 1, reason: "Alif is the founder and owner of A2Z", totp: code() })).status === 200, "the super admin names the owner");
    const listed = async () => ((await call("/staff/users", U.ceo)).j?.users ?? []).find((u) => u.id === U.test);
    const picker = async () => ((await call("/staff/staff-list", U.ceo)).j?.staff ?? (await call("/staff/staff-list", U.ceo)).j?.users ?? []).some((u) => u.id === U.test);
    const base = async () => ((await call("/staff/payroll/base", U.ceo)).j?.base ?? []).some((u) => u.user_id === U.test);
    ok((await listed())?.not_staff === 0 && (await picker()) && (await base()), "before: the testing account is on the staff list, the pickers and payroll");
    const M = (uid, b) => call(`/staff/accounts/${U.test}/not-staff`, uid, "POST", b);
    ok((await M(U.hr_admin, { not_staff: true, reason: R, totp: code() })).status === 403, "HR cannot mark an account as not staff");
    ok((await M(U.coo, { not_staff: true, reason: R, totp: code() })).status === 403, "nor the COO");
    ok((await M(U.ceo, { not_staff: true, reason: "short" })).j?.error?.code === "reason_required", "a reason is required");
    ok((await M(U.ceo, { not_staff: true, reason: R })).status === 401, "the authenticator code is required");
    const on = await M(U.ceo, { not_staff: true, reason: R, totp: code() });
    ok(on.status === 200 && on.j?.not_staff === true, "the owner marks the testing account as a test account", on.text.slice(0, 200));
    ok(db.prepare(`SELECT role FROM users WHERE id = ?`).get(U.test).role === "cco", "its role is untouched (the CCO's morning brief and screens stay)");
    ok((await listed())?.not_staff === 1, "the staff list marks it not staff (the Staff tab and Payroll leave it out)");
    ok(!(await picker()), "it is no longer in the staff pickers");
    ok(!(await base()), "it is no longer in the payroll base list");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND role IN ('ceo', 'coo', 'cco')`).get().n >= 3, "the morning brief's recipients (by role) still include it");
    ok((await call(`/staff/accounts/${U.test}`, U.ceo)).j?.account?.not_staff === true, "the account sheet says so");
    ok(audits("user.not_staff").length === 1 && audits("user.not_staff")[0].d.reason === R, "audited with the reason");
    { const me = await call(`/staff/accounts/1/not-staff`, U.ceo, "POST", { not_staff: true, reason: R, totp: code() }); ok(me.status >= 400 && !JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'not_staff_accounts'`).get()?.value ?? "[]").includes(1), "never your own account (and a CEO account is the super admin's)", me.text.slice(0, 120)); }
    db.exec(`INSERT OR REPLACE INTO system_meta (key, value) VALUES ('not_staff_accounts', 'not json')`);
    ok((await picker()), "a damaged list excludes nobody (it never breaks the staff lists)");
    db.exec(`INSERT OR REPLACE INTO system_meta (key, value) VALUES ('not_staff_accounts', '[17]')`);
    const off = await M(U.ceo, { not_staff: false, reason: "It is a real staff account after all", totp: code() });
    ok(off.status === 200 && (await picker()) && (await base()) && audits("user.staff_again").length === 1, "counted as staff again: back everywhere, audited", off.text.slice(0, 160));
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
const dir = mkdtempSync(join(tmpdir(), "psched-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const MUT = [
  ["worker/src/staff.ts", "a weekend 5th moves to the day after again", "    d.setUTCDate(d.getUTCDate() - 1);\n  }\n  return `${d.toISOString().slice(0, 10)} 10:00`;", "    d.setUTCDate(d.getUTCDate() + 1);\n  }\n  return `${d.toISOString().slice(0, 10)} 10:00`;"],
  ["worker/src/staff.ts", "the staff lists ignore the test-account list", "     AND ${notStaffSql(alias)})`;\n/** v1.225.0", "     AND 1 = 1)`;\n/** v1.225.0"],
  ["worker/src/staff.ts", "payroll ignores the test-account list", "     OR (${alias}rejoined_on IS NOT NULL AND ${alias}rejoined_on <= date('now', '+8 hours')))\n     AND ${notStaffSql(alias)})`;\n\n/** HEADCOUNT", "     OR (${alias}rejoined_on IS NOT NULL AND ${alias}rejoined_on <= date('now', '+8 hours')))\n     AND 1 = 1)`;\n\n/** HEADCOUNT"],
  ["worker/src/staff.ts", "no code needed to mark a test account", 'const su = await requireFreshTotp(env, user, body?.totp, err, "change who counts as staff");', "const su = null;"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "psched-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
/* the page draws the schedule from the server's date, not a second rule */
n++; const pp = readFileSync(join(root, "components/portal/payroll-panel.tsx"), "utf8");
if (!/const first = new Date\(Date\.UTC\(yy!, mm!, 1\)\)/.test(pp) || !/const relDay = release\?\.available_from\?\.slice\(0, 10\)/.test(pp)) { fail++; console.error("FAIL the timeline reads the 1st of the next month and the server's release day"); }
n++; if (!/x\.role !== "super_admin" && !\(x as \{ not_staff\?: number \}\)\.not_staff/.test(pp)) { fail++; console.error("FAIL the Payroll page leaves a test account out"); }
if (fail) { console.error(`payroll-schedule: ${fail} of ${n} failed`); process.exit(1); }
console.log(`payroll-schedule: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - payslips on the 5th or the working day before; a test account keeps its role and is never staff`);
