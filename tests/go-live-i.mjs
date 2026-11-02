/* CEO BUSINESS ADMINISTRATION (v1.251.0) - runtime guard: the WHOLE worker
 * bundled against SQLite with every migration applied, by direct request as
 * each role, a fake send_email binding. Fixed clock: Monday 02-11-2026,
 * 12:00 Malaysia time (the authenticator clock steps 31 s per code).
 *
 * The owner's brief "CEO Full Administrative Authority, Users Management
 * Restructure & Global PWA Overflow Fix", claude/CEO-ADMIN-USERS-AUDIT.md,
 * his answers D1-D4 and his "Approved" (02-11-2026). Each check names the
 * brief's required functional test (section 13, tests 1-22) it proves; the
 * phone and desktop tests (17-20) are tests/browser/users-admin.py and the
 * overflow sweep.
 *
 * The root cause it pins (C0): production had no company-owner record, so
 * the CEO was refused every owner door. Without the designation the CEO is
 * refused - and now TOLD why; with it, every action works, each with a
 * reason and his authenticator code, and is audited.
 *
 *   node tests/go-live-i.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-i.mjs   a given bundle (the 1.250.2 bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "golive-i-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MIGS = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
const applyFile = (db, f) => {
  const src = readFileSync(join(root, "worker/migrations", f), "utf8");
  let buf = "";
  for (const st of src.split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch { /* an older statement the later ones replace */ }
    buf = "";
  }
};
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of MIGS) applyFile(db, f);
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const sent = [];
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
    EMAIL: { send: async (m) => { sent.push(m); } }, MAIL_FROM: "A2Z Creative Marketing <hello@a2zcreative.my>",
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  let fixed = Date.parse("2026-11-02T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const U = { ceo: 1, sa: 2, coo: 3, cco: 4, sales: 5, hr: 6, host: 7, editor: 11, cust: 9, agent: 21 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, employment_status, google_sub, email_verified_at, base_salary_cents) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','permanent','g-1',NULL,900000),
    (2,'Root','System Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}','permanent',NULL,NULL,0),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','permanent',NULL,NULL,800000),
    (4,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${SECRET}','permanent',NULL,NULL,800000),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','permanent',NULL,NULL,300000),
    (6,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}','permanent',NULL,NULL,400000),
    (7,'Hafiz','Hafiz Host','hafiz@a2z.test','live_host',1,'x',1,'${SECRET}','part_time',NULL,NULL,0),
    (11,'Eddy','Eddy Editor','eddy@a2z.test','editor',1,'x',1,'${SECRET}','permanent',NULL,NULL,250000),
    (9,'Mara','Mara Dananita','mara@gmail.com','customer',1,'oauth$x',0,NULL,'permanent','g-9',NULL,0),
    (21,'Ros','Ros Agent','ros.agent@gmail.com','agent',1,'x',1,'${SECRET}','permanent','g-21',NULL,0)`);
  /* records that must come through untouched: two signature assets, a paid invoice, a payslip line */
  db.exec(`INSERT INTO signature_assets (issuer_code, role, version, r2_key, sha256, uploaded_by) VALUES ('a2z', 'ceo', 1, 'sig/a2z-ceo-1.png', 'abc', 2), ('azoo', 'stamp', 1, 'sig/azoo-stamp-1.png', 'def', 2)`);
  try { db.exec(`INSERT INTO customers (id, company, contact_person, phone, email, created_by) VALUES (1, 'Kasih Rabiah Enterprise', 'Puan Rabiah', '0123456789', 'rabiah@kasih.test', 5)`); } catch { /* shape differs */ }
  try { db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, salesperson_id, created_by, created_at, issuer_code, payment_status, paid_at) VALUES (80, 'INV', 'INV-A2Z-80', 1, '[]', 70000, 5, 5, '2026-10-01 01:00:00', 'a2z', 'paid', '2026-10-05 01:00:00')`); } catch { /* shape differs */ }
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  const session = (id) => { tok[id] = `t-${id}-${Math.random()}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id); };
  for (const id of Object.values(U)) session(id);
  const call = async (path, uid, method = "GET", body) => {
    const h = { origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const audited = (action, entityId) => n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND (? IS NULL OR entity_id = ?)`, action, entityId ?? null, entityId === undefined ? null : String(entityId)) > 0;
  const R = "Monthly access review by the owner";
  const sigs = () => sha(JSON.stringify(db.prepare(`SELECT * FROM signature_assets ORDER BY id`).all()));
  const money = () => sha(JSON.stringify([
    (() => { try { return db.prepare(`SELECT id, payment_status, paid_at, salesperson_id, total_cents FROM sales_documents ORDER BY id`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
  ]));
  const sigs0 = sigs(); const money0 = money();
  try {
    /* ---------- C0 THE ROOT CAUSE: no owner record, the CEO is refused - and told why ---------- */
    const off = [
      [`/staff/users/9/role`, "POST", { role: "agent", reason: R, totp: code() }, "giving Agent access"],
      [`/staff/accounts/5`, "GET", undefined, "opening an account"],
      [`/staff/accounts/5/suspend`, "POST", { suspend: true, reason: R, totp: code() }, "suspending"],
      [`/staff/access/policy`, "POST", { changes: [{ cap: "hankeis_view", roles: ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor"] }], reason: R, totp: code() }, "editing what roles may do"],
      [`/users`, "POST", { invite: true, name: "New Ops", email: "newops@a2z.test", role: "coo", reason: R, totp: code() }, "creating a COO account"],
    ];
    for (const [p, m, b, what] of off) {
      const r = await call(p, U.ceo, m, b);
      ok(r.status === 403 && /owner authority is off/i.test(r.j?.error?.message ?? ""), `C0 without the owner record the CEO is refused ${what} - and the refusal says the owner authority is off`, `${r.status} ${r.text.slice(0, 160)}`);
    }
    ok(one(`SELECT role FROM users WHERE id = 9`).role === "customer" && one(`SELECT is_active FROM users WHERE id = 5`).is_active === 1 && n(`SELECT COUNT(*) AS n FROM users WHERE email = 'newops@a2z.test'`) === 0, "C0 ...and nothing changed");
    /* the documented one-time switch: the super admin names the owner (reason + code), audited */
    const des = await call(`/staff/owner`, U.sa, "POST", { user_id: U.ceo, reason: "Owner designation for the CEO (D1)", totp: code() });
    ok(des.status === 200 && audited("owner.designate"), "C0 the super admin names the CEO company owner once - audited as owner.designate", `${des.status} ${des.text.slice(0, 160)}`);
    ok((await call(`/auth/me`, U.ceo)).j?.user?.is_owner === true, "C0 the next request carries the owner authority (no new account, no new role)");
    ok((await call(`/staff/owner`, U.ceo, "POST", { user_id: U.ceo, reason: "I name myself the owner", totp: code() })).status === 403, "14 the owner cannot name the owner (recovery stays with the super admin)");

    /* ---------- 1 invite ---------- */
    const inv0 = { name: "Nadia Amira", email: "nadia@a2z.test", role: "sales_marketing", invite: true };
    ok((await call(`/users`, U.ceo, "POST", { ...inv0, reason: R })).status === 401, "1 an invitation asks for the inviter's authenticator code");
    ok((await call(`/users`, U.ceo, "POST", { ...inv0, reason: "short", totp: code() })).j?.error?.code === "reason_required", "1 ...and a reason");
    ok((await call(`/users`, U.ceo, "POST", { ...inv0, role: "agent", reason: R, totp: code() })).status === 400, "1 an Agent is never invited - it comes from a verified customer");
    ok((await call(`/users`, U.ceo, "POST", { ...inv0, role: "super_admin", reason: R, totp: code() })).status === 400, "1 ...nor a Super Admin");
    const sent0 = sent.length;
    const inv = await call(`/users`, U.ceo, "POST", { ...inv0, reason: R, totp: code() });
    const newId = inv.j?.id;
    ok(inv.status === 201 && inv.j?.invited === true && inv.j?.emailed === true && !inv.j?.link && one(`SELECT role, is_active FROM users WHERE id = ?`, newId ?? 0)?.role === "sales_marketing", "1 the CEO invites a new user - the account exists with its role", `${inv.status} ${inv.text.slice(0, 160)}`);
    ok(sent.length === sent0 + 1 && sent.at(-1)?.to === "nadia@a2z.test" && /set-password#token=/.test(sent.at(-1)?.text ?? "") && n(`SELECT COUNT(*) AS n FROM account_tokens WHERE user_id = ? AND kind = 'set_password' AND used_at IS NULL`, newId ?? 0) === 1, "1 ...and only the new person gets the single-use set-password link (only its hash is stored)");
    ok(audited("user.create", newId) && JSON.parse(one(`SELECT detail FROM audit_log WHERE action = 'user.create' AND entity_id = ?`, String(newId)).detail).invite === true, "21 the invitation is in the audit history, with the reason");
    const mail = env.EMAIL; env.EMAIL = undefined;
    const inv2 = await call(`/users`, U.ceo, "POST", { name: "Ops Two", email: "ops2@a2z.test", role: "coo", invite: true, reason: R, totp: code() });
    env.EMAIL = mail;
    ok(inv2.status === 201 && inv2.j?.emailed === false && /\/set-password#token=[0-9a-f]+/.test(inv2.j?.link ?? ""), "1 with email off the owner invites a COO and gets the link once, to hand over", `${inv2.status} ${inv2.text.slice(0, 160)}`);
    ok((await call(`/users`, U.sales, "POST", { name: "X", email: "x@a2z.test", role: "editor", invite: true, reason: R, totp: code() })).status === 403, "11 Sales cannot invite");
    ok((await call(`/users`, U.coo, "POST", { name: "X", email: "x@a2z.test", role: "editor", invite: true, reason: R, totp: code() })).status === 403, "11 ...nor the COO");

    /* ---------- 2 login email ---------- */
    const em = await call(`/staff/accounts/5/email`, U.ceo, "POST", { new_email: "aina.new@a2z.test", route: "email", reason: R, totp: code() });
    ok(em.status === 200 && em.j?.applied === false && one(`SELECT email FROM users WHERE id = 5`).email === "aina@a2z.test" && n(`SELECT COUNT(*) AS n FROM email_changes WHERE user_id = 5 AND status = 'pending'`) === 1 && n(`SELECT COUNT(*) AS n FROM users WHERE email LIKE 'aina%'`) === 1, "2 the CEO starts a verified login email change - pending until the new address confirms, no second account", `${em.status} ${em.text.slice(0, 160)}`);

    /* ---------- 3 role change (the drawer's picker + the route) ---------- */
    const sheet = await call(`/staff/accounts/6`, U.ceo);
    const allowed = sheet.j?.roles_allowed ?? [];
    ok(sheet.status === 200 && allowed.includes("marketing") && allowed.includes("cco") && !allowed.includes("hr_admin") && !allowed.includes("super_admin"), "3 the drawer offers the roles the owner may give this person (not their own, never Super Admin)", JSON.stringify(allowed));
    const rc = await call(`/staff/users/6/role`, U.ceo, "POST", { role: "marketing", reason: R, employment_status: "permanent", totp: code() });
    ok(rc.status === 200 && one(`SELECT role FROM users WHERE id = 6`).role === "marketing" && audited("staff.role_change", 6), "3 the CEO changes an employee's business role - audited", `${rc.status} ${rc.text.slice(0, 160)}`);
    const rx = await call(`/staff/users/7/role`, U.ceo, "POST", { role: "cco", reason: R });
    ok(rx.status === 401, "3 an executive role asks for the owner's authenticator code", `${rx.status}`);
    ok((await call(`/staff/users/${U.ceo}/role`, U.ceo, "POST", { role: "coo", reason: R, totp: code() })).status === 400, "14 nobody changes their own role");

    /* ---------- 4 + 10 a module permission, granted and revoked, live on the next request ---------- */
    const capsOf = async (uid) => (await call(`/auth/me`, uid)).j?.user?.caps ?? [];
    ok(!(await capsOf(U.editor)).includes("hankeis_view"), "4 before: an Editor cannot open Hankei's");
    const hv = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing"];
    const g1 = await call(`/staff/access/policy`, U.ceo, "POST", { changes: [{ cap: "hankeis_view", roles: [...hv, "editor"] }], reason: R, totp: code() });
    ok(g1.status === 200 && (await capsOf(U.editor)).includes("hankeis_view") && audited("permissions.change"), "4 + 10 the CEO grants a module permission - the Editor holds it on their next request, audited", `${g1.status} ${g1.text.slice(0, 160)}`);
    const g2 = await call(`/staff/access/policy`, U.ceo, "POST", { changes: [{ cap: "hankeis_view", roles: hv }], reason: R, totp: code() });
    ok(g2.status === 200 && !(await capsOf(U.editor)).includes("hankeis_view"), "4 + 10 ...and revokes it - gone on the next request");
    ok((await call(`/staff/access/policy`, U.coo, "POST", { changes: [{ cap: "hankeis_view", roles: [...hv, "editor"] }], reason: R, totp: code() })).status === 403, "11 the COO cannot edit what roles may do");

    /* ---------- 5 company access (D2: by role, shown as both companies) ---------- */
    ok(sheet.j?.account?.id === 6 && (await call(`/staff/users`, U.ceo)).status === 200, "5 company access is by role for every account (D2) - the account and both companies' records are reached through the one role rule");

    /* ---------- 6 Agent access ---------- */
    db.exec(`UPDATE users SET email_verified_at = datetime('now') WHERE id = 9`);
    const ag = await call(`/staff/users/9/role`, U.ceo, "POST", { role: "agent", reason: R, totp: code() });
    ok(ag.status === 200 && one(`SELECT role FROM users WHERE id = 9`).role === "agent", "6 the CEO grants an eligible (verified) customer Agent access", `${ag.status} ${ag.text.slice(0, 160)}`);

    /* ---------- 7 suspend and reactivate ---------- */
    session(U.host);
    const su = await call(`/staff/accounts/7/suspend`, U.ceo, "POST", { suspend: true, reason: R, totp: code() });
    ok(su.status === 200 && one(`SELECT is_active FROM users WHERE id = 7`).is_active === 0 && n(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 7`) === 0 && audited("user.suspend", 7), "7 the CEO suspends an account - signed out, audited", `${su.status} ${su.text.slice(0, 160)}`);
    const rs = await call(`/staff/accounts/7/suspend`, U.ceo, "POST", { suspend: false, reason: R, totp: code() });
    ok(rs.status === 200 && one(`SELECT is_active FROM users WHERE id = 7`).is_active === 1 && audited("user.restore", 7), "7 ...and reactivates it - the account and its history are the same");

    /* ---------- 8 revoke sessions ---------- */
    session(U.sales);
    ok((await call(`/auth/me`, U.sales)).status === 200, "8 before: Aina is signed in");
    const rv = await call(`/staff/accounts/5/sessions/revoke`, U.ceo, "POST", { all: true, reason: R, totp: code() });
    ok(rv.status === 200 && n(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 5`) === 0 && (await call(`/auth/me`, U.sales)).status === 401 && audited("user.force_logout", 5), "8 the CEO revokes every session - the next request is signed out, audited", `${rv.status} ${rv.text.slice(0, 120)}`);
    session(U.sales);

    /* ---------- 9 MFA recovery ---------- */
    const mf = await call(`/staff/accounts/11/reset-2fa`, U.ceo, "POST", { reason: R, identity_checked: "Alif, video call", totp: code() });
    const ed = one(`SELECT totp_enabled, totp_secret FROM users WHERE id = 11`);
    ok(mf.status === 200 && ed.totp_enabled === 0 && ed.totp_secret === null && !/JBSW|secret/i.test(mf.text) && audited("auth.2fa_reset_by_admin", 11), "9 the CEO starts a controlled MFA recovery - re-enrol at the next sign-in, no secret shown, audited", `${mf.status} ${mf.text.slice(0, 120)}`);
    db.exec(`UPDATE users SET totp_enabled = 1, totp_secret = '${SECRET}' WHERE id = 11`);

    /* ---------- 11-13 who cannot ---------- */
    for (const [uid, who] of [[U.coo, "the COO"], [U.cco, "the CCO"], [U.sales, "Sales"]]) {
      ok((await call(`/staff/accounts/6`, uid)).status === 403 && (await call(`/staff/accounts/6/suspend`, uid, "POST", { suspend: true, reason: R, totp: code() })).status === 403, `11 ${who} cannot open or suspend an account`);
    }
    ok((await call(`/staff/users/5/role`, U.cco, "POST", { role: "agent", reason: R, totp: code() })).status === 403, "11 the CCO cannot give a role");
    for (const p of ["/staff/users", "/staff/accounts/5", "/staff/access/policy", "/audit"]) ok((await call(p, U.agent)).status === 403, `12 an Agent cannot reach the internal Users API (${p})`);
    ok((await call(`/users`, U.agent, "POST", { name: "X", email: "y@a2z.test", role: "editor", invite: true, reason: R, totp: code() })).status === 403, "12 ...nor create an account");
    const ccoCaps = await capsOf(U.cco);
    ok(!ccoCaps.includes("confirm_paid") && !ccoCaps.includes("payroll_release"), "13 after every role and permission change above, the CCO still cannot mark Paid or release payroll", ccoCaps.filter((c) => /paid|payroll/.test(c)).join(","));
    const cr = await call(`/staff/users/7/role`, U.ceo, "POST", { role: "cco", reason: R, totp: code() });
    session(U.host);
    const hostCaps = await capsOf(U.host);
    ok(cr.status === 200 && !hostCaps.includes("confirm_paid") && !hostCaps.includes("payroll_release"), "13 a person made CCO does not acquire Invoice Paid or payroll release", `${cr.status} ${hostCaps.filter((c) => /paid|payroll/.test(c)).join(",")}`);

    /* ---------- 14 the protected recovery path ---------- */
    ok((await call(`/staff/users/2/role`, U.ceo, "POST", { role: "coo", reason: R, totp: code() })).status === 403, "14 the owner cannot demote the Super Admin (the recovery account)");
    ok((await call(`/staff/accounts/2/suspend`, U.ceo, "POST", { suspend: true, reason: R, totp: code() })).status === 403 && one(`SELECT is_active FROM users WHERE id = 2`).is_active === 1, "14 ...nor suspend it");
    ok((await call(`/staff/accounts/2/suspend`, U.sa, "POST", { suspend: true, reason: R, totp: code() })).status === 400 || one(`SELECT is_active FROM users WHERE id = 2`).is_active === 1, "14 the last Super Admin with 2FA is never switched off - not even by itself");
    ok((await call(`/staff/accounts/1`, U.ceo)).status === 403 || (await call(`/staff/accounts/1/suspend`, U.ceo, "POST", { suspend: true, reason: R, totp: code() })).status !== 200, "14 the owner cannot lock his own account out");

    /* ---------- 21 the audit trail, whole and for one person ---------- */
    const at = await call(`/audit?target=7`, U.ceo);
    const rows = at.j?.entries ?? [];
    ok(at.status === 200 && rows.length >= 3 && rows.every((e) => (e.entity === "users" && e.entity_id === "7") || /Hafiz/.test(e.user_name ?? "")) && rows.some((e) => e.action === "user.suspend"), "21 Audit History for one person lists only what was done to or by that account", JSON.stringify(rows.slice(0, 3)));
    for (const a of ["user.create", "auth.password_link_issued", "user.email_change_requested", "staff.role_change", "permissions.change", "user.suspend", "user.restore", "user.force_logout", "auth.2fa_reset_by_admin", "owner.designate"]) ok(audited(a), `21 ${a} is in the existing audit history`);

    /* ---------- 15-16 nothing else moved ---------- */
    ok(sigs() === sigs0, "15 every signature and stamp record is exactly as it was");
    ok(money() === money0, "16 no invoice, Paid status, commission or payroll row changed");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-i-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(await runtime(main));
const checks = n;
if (given || process.env.NOMUT) {
  if (fail) { console.error(`go-live-i: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-i: ${n} checks passed`); process.exit(0);
}

const MUT = [
  ["worker/src/permissions.ts", "every CEO-role account is the owner", "  return actor.is_owner === true && actor.role === \"ceo\" && OWNER_GRANTS.includes(perm);", "  return actor.role === \"ceo\" && OWNER_GRANTS.includes(perm);"],
  ["worker/src/index.ts", "an invitation needs no authenticator code", "      const su = await requireFreshTotp(env, user, body.totp, errorResponse, \"create this account\");\n      if (su) return su;", ""],
  ["worker/src/index.ts", "an invitation makes an Agent", "      if ([\"customer\", \"agent\", \"super_admin\"].includes(roleWantedC)) return errorResponse(", "      if (false) return errorResponse("],
  ["worker/src/index.ts", "one person's audit is everyone's", "    const rows = Number.isInteger(target) && target > 0", "    const rows = false"],
  ["worker/src/staff.ts", "the refusal hides why", "    ? \" Your owner authority is off: the Super Admin names you company owner once (signed in as the Super Admin: /admin > Users > Company owner), then this works for you.\"", "    ? \"\""],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-i-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "w.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "w.mjs"));
  const bad = res.filter(([p]) => !p).map(([, m]) => m);
  if (!bad.length) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${bad.slice(0, 2).join("; ")}`);
  rmSync(mdir, { recursive: true, force: true });
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`go-live-i: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-i: ${checks} checks passed (${MUT.length} mutations caught) - the CEO's business administration: refused and told why until the owner is named, then invite, login email, roles, permissions live on the next request, Agent access, suspend and restore, sessions, MFA recovery - each with a reason, his code and an audit line; the Super Admin and the last recovery path protected; no signature, stamp, invoice, commission or payroll record moved`);
