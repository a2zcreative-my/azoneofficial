/* THE POSITIONS LIST (v1.322.0) - runtime guard (the tasks-gate4.mjs harness): the WHOLE
 * worker bundled against SQLite with every migration applied (0204 included),
 * by direct request as each role. Invented fixtures only - no production data.
 *
 * The CEO, 16-11-2026: "Position list (Recommended)" (claude/POSITIONS-STAGE-0-AUDIT.md):
 *   P-1  one additive table and its kept change rows; users is not altered
 *   P-2  the staff record keeps its position as text; off-list titles are named
 *   P-3  only the CEO and the Super Admin keep the list - by direct request;
 *        everyone on staff reads it; a customer or an agent does not
 *   P-4  a position's access level is a link, never a key: adding, re-linking
 *        or renaming a position, or picking it, changes nobody's role
 *   P-5  rename (holders carried across only when asked, each audited as a
 *        staff-record change), retire and restore - never delete
 *   P-7  "Start from current positions" only when asked, the level read from
 *        the holders' own roles
 *
 *   node tests/positions.mjs           the current worker, then mutations
 *   NOMUT=1 node tests/positions.mjs   the current worker only
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
  const entry = join(srcRoot, "positions-entry.ts");
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
  const U = { ceo: 1, sa: 2, coo: 3, admin: 4, aina: 5, hr: 6, host: 7, cco: 8, agent: 9 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, base_salary_cents, joined_on) VALUES
    (1,'Alif','Alif Owner','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',900000,'2024-01-01'),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',800000,'2024-01-01'),
    (4,'Adm','Admin Clerk','admin@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',300000,'2024-01-01'),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',400000,'2024-01-01'),
    (7,'Farid','Farid Host','farid@a2z.test','live_host',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',250000,'2024-01-01'),
    (8,'Chen','Chen CCO','chen@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',700000,'2024-01-01'),
    (9,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP','permanent',0,'2024-01-01')`);
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
    db.exec(`UPDATE users SET position = 'Sales Executive' WHERE id = 5`);
    db.exec(`UPDATE users SET position = 'Live Host' WHERE id = 7`);
    db.exec(`UPDATE users SET position = 'HR Executive' WHERE id = 6`);
    const roles = () => db.prepare(`SELECT id, role FROM users ORDER BY id`).all().map((r) => `${r.id}:${r.role}`).join(",");
    const before = roles();

    /* ---------- P-3 who keeps it, who reads it ---------- */
    const l0 = await call("/positions", U.hr);
    ok(l0.status === 200 && l0.j?.can_manage === false && Array.isArray(l0.j?.positions) && l0.j.not_on_list.length === 0, "P-3 the HR admin reads the list, may not keep it, and is not told the off-list titles", fmt(l0.j));
    ok((await call("/positions", U.host)).status === 200, "P-3 every staff member reads it (a live host)");
    ok((await call("/positions", U.agent)).status === 403, "P-3 an agent (not staff) does not read it");
    for (const [who, uid] of [["the HR admin", U.hr], ["the COO", U.coo], ["the CCO", U.cco], ["the Admin", U.admin], ["a seller", U.aina]]) {
      ok((await call("/positions", uid, "POST", { name: "Intern", access_role: "editor" })).status === 403, `P-3 ${who} cannot add a position (direct request)`);
    }
    const lc = await call("/positions", U.ceo);
    ok(lc.j?.can_manage === true && lc.j.not_on_list.map((o) => o.name).sort().join("|") === "HR Executive|Live Host|Sales Executive", "P-2 the CEO sees the titles typed on records that are not on the list", fmt(lc.j?.not_on_list));

    /* ---------- add ---------- */
    const a = await call("/positions", U.ceo, "POST", { name: "  Senior   Graphic Designer ", access_role: "editor", department: "Creative" });
    ok(a.status === 201 && a.j?.id, "the CEO adds a position", fmt(a.j));
    const P1 = a.j?.id;
    ok(row(`SELECT name FROM staff_positions WHERE id = ?`, P1)?.name === "Senior Graphic Designer", "the name is tidied (spaces)");
    ok((await call("/positions", U.sa, "POST", { name: "senior graphic designer", access_role: "editor" })).status === 409, "a name already on the list is refused, whatever its case");
    ok((await call("/positions", U.ceo, "POST", { name: "Chief Wizard", access_role: "super_admin" })).status === 400, "a position cannot be linked to the Super Admin level");
    ok((await call("/positions", U.ceo, "POST", { name: "Shopper", access_role: "customer" })).status === 400, "…nor to the customer level");
    ok((await call("/positions", U.ceo, "POST", { name: "X", access_role: "editor" })).status === 400, "a one-letter name is refused");
    const s = await call("/positions", U.sa, "POST", { name: "Sales Executive", access_role: "sales_marketing" });
    ok(s.status === 201, "the Super Admin adds a position too");
    const P2 = s.j?.id;
    ok(roles() === before, "P-4 adding positions changed nobody's role");

    /* ---------- P-4 re-link: nobody's role moves ---------- */
    const r1 = await call(`/positions/${P2}`, U.ceo, "PATCH", { access_role: "marketing" });
    ok(r1.status === 200 && r1.j?.holders_with_other_access === 1 && r1.j?.moved === 0, "P-4 re-linking says how many holders now differ, and moves nobody", fmt(r1.j));
    ok(roles() === before && row(`SELECT role FROM users WHERE id = 5`)?.role === "sales_marketing", "P-4 the holder keeps her role after the re-link");
    ok((await call(`/positions/${P2}`, U.coo, "PATCH", { access_role: "sales_marketing" })).status === 403, "P-3 the COO cannot re-link (direct request)");

    /* ---------- P-5 rename: holders only when asked ---------- */
    const r2 = await call(`/positions/${P2}`, U.ceo, "PATCH", { name: "Sales Consultant" });
    ok(r2.status === 200 && r2.j?.moved === 0 && row(`SELECT position FROM users WHERE id = 5`)?.position === "Sales Executive", "P-5 a rename without asking leaves the records as they are", fmt(r2.j));
    const r3 = await call(`/positions/${P2}`, U.ceo, "PATCH", { name: "Senior Sales Consultant", rename_holders: true });
    ok(r3.status === 200 && r3.j?.moved === 0, "…and carries across only the people holding the CURRENT name", fmt(r3.j));
    db.exec(`UPDATE users SET position = 'Senior Sales Consultant' WHERE id = 5`);
    const r4 = await call(`/positions/${P2}`, U.ceo, "PATCH", { name: "Sales Lead", rename_holders: true });
    ok(r4.status === 200 && r4.j?.moved === 1 && row(`SELECT position FROM users WHERE id = 5`)?.position === "Sales Lead", "P-5 asked, the holders' records read the new name", fmt(r4.j));
    const hr = row(`SELECT detail FROM audit_log WHERE action = 'staff.hr_update' AND entity_id = '5' ORDER BY id DESC`);
    ok(String(hr?.detail ?? "").includes('"position":["Senior Sales Consultant","Sales Lead"]') && String(hr?.detail ?? "").includes("positions.rename"), "…each one audited as a staff-record change, before and after", String(hr?.detail));
    ok(roles() === before, "P-4 a rename changed nobody's role");
    ok((await call(`/positions/${P2}`, U.ceo, "PATCH", { name: "senior graphic designer" })).status === 409, "a rename onto another position's name is refused");

    /* ---------- P-5 retire, restore, never delete ---------- */
    ok((await call(`/positions/${P1}/retire`, U.hr, "POST", {})).status === 403, "P-3 the HR admin cannot retire a position");
    ok((await call(`/positions/${P1}/retire`, U.ceo, "POST", { reason: "Merged into Designer" })).status === 200, "the CEO retires a position");
    ok(!(await call("/positions", U.hr)).j.positions.some((p) => p.id === P1), "a retired position is not offered");
    ok((await call("/positions?all=1", U.ceo)).j.positions.some((p) => p.id === P1 && p.retired_at), "…the CEO still sees it with Show retired");
    ok((await call(`/positions/${P1}`, U.ceo, "PATCH", { name: "Designer" })).status === 409, "a retired position is restored before it is changed");
    ok((await call(`/positions/${P1}/restore`, U.sa, "POST", {})).status === 200 && !row(`SELECT retired_at FROM staff_positions WHERE id = ?`, P1)?.retired_at, "the Super Admin restores it");
    ok(throws(`DELETE FROM staff_positions WHERE id = ${P1}`), "0204 a position is never deleted");
    ok(throws(`UPDATE staff_position_changes SET note = 'x'`) && throws(`DELETE FROM staff_position_changes`), "0204 the change rows are kept as written");
    const ch = (await call(`/positions/${P2}/changes`, U.ceo)).j?.changes ?? [];
    ok(ch.map((c) => c.action).join(",") === "rename,rename,rename,relink,create", "every change is in the history, newest first", ch.map((c) => c.action).join(","));
    ok((await call(`/positions/${P2}/changes`, U.hr)).status === 403, "the history is the keepers' (direct request)");

    /* ---------- P-7 start from the records, only when asked ---------- */
    const sd = await call("/positions/seed", U.ceo, "POST", {});
    ok(sd.status === 200 && (sd.j?.added ?? []).sort().join("|") === "HR Executive|Live Host", "P-7 Start from current positions adds the titles typed on records, once each", fmt(sd.j));
    ok(row(`SELECT access_role FROM staff_positions WHERE name = 'Live Host'`)?.access_role === "live_host" && row(`SELECT access_role FROM staff_positions WHERE name = 'HR Executive'`)?.access_role === "hr_admin", "P-7 …each linked to the level its holders have now (never invented)");
    ok((await call("/positions/seed", U.coo, "POST", {})).status === 403, "P-3 the COO cannot seed the list");
    ok(roles() === before, "P-4 after everything, every role is as it was");

    /* ---------- the role door is unchanged ---------- */
    ok(!/staff_positions|positions_manage/.test(read("worker/src/permissions.ts").slice(read("worker/src/permissions.ts").indexOf("export function mayGrant"), read("worker/src/permissions.ts").indexOf("export function canManageAccount"))), "the role door (mayGrant) does not read positions");
    ok(!/UPDATE users SET[^`]*\brole\b/.test(read("worker/src/positions.ts")), "positions.ts never writes users.role");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e).slice(0, 400)); }
  globalThis.Date = RealDate;
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "positions-"));
const main = join(dir, "worker.mjs");
bundle(root, main);
report(await runtime(main, join(root, "worker/migrations")));
const checks = n;
if (process.env.NOMUT) {
  rmSync(dir, { recursive: true, force: true });
  if (fail) { console.error(`positions: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`positions: ${n} checks passed`); process.exit(0);
}
if (fail) { console.error(`positions: ${fail} of ${n} failed (mutations not run)`); process.exit(1); }

const MUT = [
  ["worker/src/permissions.ts", "the COO keeps the list", 'positions_manage: ["super_admin", "ceo"],', 'positions_manage: ["super_admin", "ceo", "coo"],'],
  ["worker/src/positions.ts", "anyone adds a position", '    if (path === "/positions" && method === "POST") {\n      if (!manage) return refuse();', '    if (path === "/positions" && method === "POST") {'],
  ["worker/src/positions.ts", "a rename moves every holder unasked", 'if (renamed && body?.rename_holders === true) {', 'if (renamed) {'],
  ["worker/src/positions.ts", "a re-link moves the holders' roles", 'const differ = Number(', 'await env.DB.prepare(`UPDATE users SET role = ?1 WHERE position = ?2 COLLATE NOCASE`).bind(role, name).run();\n      const differ = Number('],
  ["worker/src/positions.ts", "linked to the Super Admin level", 'export const POSITION_ACCESS_ROLES = ["editor",', 'export const POSITION_ACCESS_ROLES = ["super_admin", "editor",'],
  ["worker/src/positions.ts", "a retired position still offered", '${all ? "" : "WHERE p.retired_at IS NULL"}', ''],
  ["worker/src/positions.ts", "the off-list titles told to everyone", 'const off = manage ? (', 'const off = true ? ('],
  /* an agent is refused by the staff gate before positions.ts too, so its own line there is a second lock that no single mutation can show */
  ["worker/src/positions.ts", "the history open to everyone", 'if (m[2] === "changes" && method === "GET") {\n      if (!manage) return refuse();', 'if (m[2] === "changes" && method === "GET") {'],
  /* a rename onto another name is refused twice - by the check in positions.ts and by 0204's unique index - so no single mutation shows it; the check above holds both */
  ["worker/migrations/0204_staff_positions.sql", "a position can be deleted", "CREATE TRIGGER IF NOT EXISTS staff_positions_no_delete BEFORE DELETE ON staff_positions\nBEGIN SELECT RAISE(ABORT, 'A position is retired, never deleted'); END;", ""],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "positions-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"), join(mdir, "worker/migrations"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`positions: ${fail} of ${n} failed`); process.exit(1); }
console.log(`positions: ${checks} checks passed (${MUT.length} mutations caught) - the positions list: kept by the CEO and the Super Admin only (direct requests), read by staff, a position never changes a role, rename / retire / restore kept, never deleted`);
