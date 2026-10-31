/* THE EDITABLE MATRIX (v1.237.0) - runtime guard: the WHOLE worker (index.ts,
 * bundled) against SQLite with every migration applied, by direct request.
 *
 * The owner, 31-10-2026 (claude/EDITABLE-PERMISSIONS-AUDIT.md): the Roles &
 * Permissions matrix "require to be editable for me as a CEO which is I have
 * a right as a Super Admin". Answers: the company owner and the super admin
 * edit; no locks; approval chains stay fixed.
 *
 *   1 only the verified owner and the super admin may edit - not the COO, not
 *     a CEO-role account that is not the owner
 *   2 a save needs a reason and the editor's authenticator code
 *   3 a saved cell IS the permission: the server allows (and refuses) exactly
 *     what the matrix now says, for every role, from the next request on
 *   4 /auth/me hands each person their resulting capabilities
 *   5 only staff roles can be named; an unknown permission is refused
 *   6 rules that are not cells still hold (never confirm your own sale)
 *   7 every change is audited before and after; one cell or all of them go
 *     back to the default; an unreadable record means the defaults
 * Then mutated copies must each fail a check.
 *
 *   node tests/matrix-edit.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => execSync(`npx esbuild "${join(srcRoot, "worker/src/index.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

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
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://x",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }) },
  };
  const ROLES = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "admin", "super_admin"];
  const ID = Object.fromEntries(ROLES.map((r, i) => [r, i + 1]));
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES ${ROLES.map((r, i) => `(${i + 1},'${r}','${r}@a2z.test','${r}',1,'x',1,'${SECRET}',200000)`).join(",")},
    (20,'Second CEO','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}',0), (21,'Shop','shop@gmail.com','customer',1,'x',0,NULL,0)`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai',5)`);
  const inv = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind) VALUES (?,'INV',?,1,'[{"name":"Live","qty":1,"unit_price_cents":10000}]',0,0,10000,?,?,'2026-10-20 02:00:00',5,5,'service')`);
  for (let i = 0; i < 12; i++) inv.run(100 + i, `INV-${i}`, "unpaid", null);
  inv.run(200, "INV-OWN", "paid", "2026-10-29 02:00:00");
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":10,"set_by_name":"super_admin","set_at":"2026-10-30 02:00:00","reason":"Founder and owner"}')`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-31T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [...Object.values(ID), 20, 21]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", origin: "https://x" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const edit = (uid, body) => call("/staff/access/policy", uid, "POST", { reason: "Restructuring who does what", totp: code(), ...body });
  const act = async (key, uid = ID.ceo) => (await call("/staff/access/policy", uid)).j?.actions?.find((a) => a.key === key);
  const auditN = (a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? JSON.parse(r.detail ?? "{}") : null; };
  let n = 0;
  const release = (uid) => call("/staff/payroll/release", uid, "POST", { month: "2026-09" });
  const unrelease = (uid) => call("/staff/payroll/release", uid, "POST", { month: "2026-09", undo: true });

  try {
    /* defaults: exactly the code */
    const p0 = await call("/staff/access/policy", ID.ceo);
    ok(p0.j?.can_edit_actions === true && p0.j.edited_count === 0, "the verified owner may edit; nothing is edited yet", JSON.stringify({ c: p0.j?.can_edit_actions, n: p0.j?.edited_count }));
    const rel0 = p0.j?.actions?.find((a) => a.key === "payroll_release");
    ok(rel0?.editable && rel0.cap === "payroll_release" && rel0.roles.join() === "ceo,coo,super_admin" && rel0.default_roles.join() === "ceo,coo,super_admin" && !rel0.edited, "a former fixed list is now an editable cell, with its default", JSON.stringify(rel0));
    ok(p0.j?.actions?.find((a) => a.key === "tab_access")?.editable === false, "who edits the matrix is not itself a cell");
    ok((await call("/staff/access/policy", ID.super_admin)).j?.can_edit_actions === true && (await call("/staff/access/policy", ID.coo)).j?.can_edit_actions === false, "the super admin may edit; the COO only reads");

    /* 1 who may edit */
    ok((await edit(ID.coo, { changes: [{ cap: "payroll_release", roles: ["cco"] }] })).status === 403, "1 the COO cannot edit the matrix");
    ok((await edit(20, { changes: [{ cap: "payroll_release", roles: ["cco"] }] })).status === 403, "1 a CEO-role account that is not the owner cannot edit");
    ok((await edit(ID.cco, { changes: [{ cap: "payroll_release", roles: ["cco"] }] })).status === 403, "1 the CCO cannot give itself a permission");
    ok((await edit(21, { changes: [{ cap: "payroll_release", roles: ["cco"] }] })).status === 403, "1 a customer reaches nothing");
    /* 2 reason and code */
    ok((await call("/staff/access/policy", ID.ceo, "POST", { changes: [{ cap: "payroll_release", roles: ["ceo"] }], totp: code() })).j?.error?.code === "reason_required", "2 a save needs a reason");
    const noT = await call("/staff/access/policy", ID.ceo, "POST", { changes: [{ cap: "payroll_release", roles: ["ceo"] }], reason: "Restructuring who does what" });
    ok(noT.status === 401 && noT.j?.error?.code === "totp_required", "2 ...and the editor's authenticator code");
    /* 5 only staff roles, only real permissions */
    ok((await edit(ID.ceo, { changes: [{ cap: "payroll_release", roles: ["customer"] }] })).status === 400, "5 a customer can never be given a staff permission");
    ok((await edit(ID.ceo, { changes: [{ cap: "make_me_rich", roles: ["ceo"] }] })).status === 400, "5 an unknown permission is refused");
    ok(auditN("permissions.change") === 0 && !db.prepare(`SELECT 1 FROM system_meta WHERE key = 'role_permissions'`).get(), "nothing refused was written");

    /* 3 the owner gives the CCO payroll release and takes Mark paid from the COO */
    ok((await release(ID.cco)).status === 403, "3 before: the CCO cannot release payslips");
    ok((await act("payroll_release"))?.needs === "payroll_process", "3 the matrix says releasing also needs processing payroll (the route checks both)");
    const e1 = await edit(ID.ceo, { changes: [{ cap: "payroll_release", roles: ["ceo", "coo", "cco", "super_admin"] }, { cap: "payroll_process", roles: ["super_admin", "admin", "ceo", "coo", "cco"] }, { cap: "invoice_payment", roles: ["ceo", "super_admin"] }] });
    ok(e1.status === 200 && e1.j?.changed?.length === 3, "3 the owner saves three cells in one batch", JSON.stringify(e1.j));
    const relA = await release(ID.cco);
    ok(relA.status !== 403, "3 after: the CCO releases payslips - on the very next request", String(relA.status));
    if (relA.status !== 403) await unrelease(ID.cco);
    const mpCoo = await call("/staff/docs/100", ID.coo, "PATCH", { payment_status: "paid", paid_on: "2026-10-29" });
    ok(mpCoo.status === 403, "3 after: the COO can no longer mark an invoice paid", String(mpCoo.status));
    ok((await call("/staff/docs/101", ID.ceo, "PATCH", { payment_status: "paid", paid_on: "2026-10-29" })).status !== 403, "3 the CEO still can");
    const relRow = await act("payroll_release");
    ok(relRow?.edited && relRow.roles.join() === "ceo,coo,cco,super_admin" && relRow.default_roles.join() === "ceo,coo,super_admin" && relRow.edit_meta?.reason === "Restructuring who does what", "3 the matrix shows the edited cell, its default and who changed it", JSON.stringify(relRow));
    /* 3/14 matrix = direct request, role by role, for the edited cell */
    const rr = (await act("payroll_release")).roles;
    const rp = (await act("payroll_process")).roles;
    for (const r of ROLES) {
      const res = await release(ID[r]);
      const want = rr.includes(r) && rp.includes(r);
      ok((res.status !== 403) === want, `3 release payslips: ${r} ${want ? "allowed" : "refused"} as the edited matrix says`, String(res.status));
      if (res.status !== 403) await unrelease(ID[r]);
    }
    /* 4 caps */
    const me = await call("/auth/me", ID.cco);
    ok(me.j?.user?.caps?.includes("payroll_release") && !me.j.user.caps.includes("invoice_payment"), "4 /auth/me tells the CCO it may now release payslips", JSON.stringify(me.j?.user?.caps?.slice(0, 8)));
    ok(!(await call("/auth/me", ID.coo)).j?.user?.caps?.includes("invoice_payment"), "4 ...and tells the COO Mark paid is gone");
    /* 6 rules that are not cells */
    await edit(ID.super_admin, { changes: [{ cap: "confirm_paid", roles: ["ceo", "coo", "sales_marketing"] }] });
    const own = await call("/staff/docs/200/confirm-paid", ID.sales_marketing, "POST", { amount_cents: 10000, checked: true });
    ok(own.status === 403 && /own sale/.test(own.j?.error?.message ?? ""), "6 given Confirm Paid, a salesperson still never confirms their own sale", `${own.status} ${JSON.stringify(own.j)}`);
    ok(lastAudit("permissions.change")?.by_owner === false && lastAudit("permissions.change").to === "ceo coo sales_marketing", "7 the super admin's edit is audited as the super admin's");
    /* 7 history, reset */
    ok(auditN("permissions.change") === 4 && lastAudit("permissions.change").from === "ceo coo", "7 every changed cell is audited with before and after");
    const rv = await call("/staff/access/review", ID.ceo);
    ok(rv.j?.history?.some((h) => h.action === "permissions.change"), "7 the access history shows the matrix edits");
    const r1 = await edit(ID.ceo, { changes: [{ cap: "invoice_payment", reset: true }] });
    ok(r1.status === 200 && !(await act("invoice_payment"))?.edited && (await call("/staff/docs/102", ID.coo, "PATCH", { payment_status: "paid", paid_on: "2026-10-29" })).status !== 403, "7 one cell goes back to its default - the COO marks paid again");
    const ra = await edit(ID.ceo, { reset_all: true });
    const p1 = await call("/staff/access/policy", ID.ceo);
    ok(ra.status === 200 && p1.j?.edited_count === 0 && (await release(ID.cco)).status === 403 && auditN("permissions.reset_all") === 1, "7 Reset all: every role is back to the code's defaults, audited");
    db.exec(`UPDATE system_meta SET value = '{"perms":{"invoice_payment":["ceo","customer"]},"meta":{}}' WHERE key = 'role_permissions'`);
    ok(!(await call("/auth/me", 21)).j?.user?.caps?.includes("invoice_payment"), "5 a customer written into a stored cell still holds nothing");
    db.exec(`UPDATE system_meta SET value = 'not json' WHERE key = 'role_permissions'`);
    ok((await call("/staff/access/policy", ID.ceo)).status === 200 && (await release(ID.cco)).status === 403 && (await release(ID.coo)).status !== 403, "7 an unreadable record means the defaults, never an outage");
    n = out.length;
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "matrix-"));
bundle(root, join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const MUT = [
  ["worker/src/permissions.ts", "can() ignores the saved matrix", "  return rolesFor(perm).includes(role as Role);", "  return PERMS[perm]!.includes(role as Role);"],
  ["worker/src/staff.ts", "anyone may edit the matrix", 'if (!(user.role === "super_admin" || user.is_owner === true)) return err("forbidden", "Only the company owner or the super admin edits what roles may do", 403);', ""],
  ["worker/src/staff.ts", "the editor's code is skipped", 'const su = await requireFreshTotp(env, user, body?.totp, err, "change what roles may do");', "const su = null;"],
  ["worker/src/permissions.ts", "a customer can be named in a cell", "out[k] = [...new Set(v.map(String).filter((r) => POLICY_ROLE_SET.includes(r)))] as Role[];", "out[k] = [...new Set(v.map(String))] as Role[];"],
  ["worker/src/index.ts", "the saved matrix is not loaded for a request", "try { setPermissionOverrides(row.perm_meta ? (JSON.parse(row.perm_meta) as { perms?: unknown }).perms : null); } catch { setPermissionOverrides(null); }", "setPermissionOverrides(null);"],
  ["worker/src/staff.ts", "a changed cell is not audited", '      for (const d of done) await audit(env, user.id, "permissions.change"', '      for (const d of []) await audit(env, user.id, "permissions.change"'],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "matrix-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`matrix-edit: ${fail} of ${n} failed`); process.exit(1); }
console.log(`matrix-edit: ${checks} checks passed (${MUT.length} mutations caught) - the owner and the super admin edit the matrix; every saved cell is the permission the server enforces; audited, reversible`);
