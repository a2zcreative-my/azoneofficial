/* THE COMPANY OWNER (v1.236.0) - runtime guard: the WHOLE worker (index.ts,
 * bundled) against SQLite with every migration applied, by direct request.
 *
 * The owner's brief, 30-10-2026 (claude/CEO-OWNER-ACCESS-AUDIT.md): "CEO =
 * FULL AUTHORIZED COMPANY ADMINISTRATIVE ACCESS. SUPER ADMIN = TECHNICAL /
 * RECOVERY ADMINISTRATION. ONE CENTRAL AUTHORIZATION SYSTEM. NO
 * UNAUTHORIZED PRIVILEGE ESCALATION." Answers: one designated owner; the
 * owner manages the Admin role only (super admin accounts and the CEO role
 * stay the super admin's); roles stay code-defined.
 *
 * The brief's sixteen cases, numbered as in the brief:
 *   before a super admin names the owner nothing changes; naming needs a
 *   super admin, a reason, an authenticator code and a CEO account with 2FA
 *   1 the owner reads Roles & Permissions        2 manages a working role
 *   3 assigns an executive role (code + reason)  4 grants technical Admin
 *   5 uses a newly named administrative action   6/7 CEO and COO confirm Paid
 *   8/9 the CCO cannot confirm Paid or release payroll
 *   10 nobody escalates themselves               11 a customer reaches nothing
 *   12 super admin recovery stays whole          14 matrix = direct requests
 *   15 every change is in the audit history, nothing rewritten
 *   16 a second CEO-role account gains nothing; customers stay separate
 *   (13, desktop and phone, is the browser run.)
 * Then mutated copies must each fail a check.
 *
 *   node tests/owner-access.mjs
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totpAt = (ms) => { const c = Math.floor(ms / 30000); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };

async function runtime(workerBundle, staffBundle) {
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
  const U = {
    ceo: 1, coo: 2, cco: 3, hr_admin: 4, sales_marketing: 5, marketing: 6, admin: 7, super_admin: 8, customer: 9, editor: 10, live_host: 11, ceo2: 12, nora: 13, root2: 14,
  };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES
    (1,'Alif','alif@a2z.test','ceo',1,'x',1,'${SECRET}',0),(2,'Ops','ops@a2z.test','coo',1,'x',1,'${SECRET}',0),
    (3,'Com','com@a2z.test','cco',1,'x',1,'${SECRET}',0),(4,'Hana','hana@a2z.test','hr_admin',1,'x',1,'${SECRET}',200000),
    (5,'Aina','aina@gmail.com','sales_marketing',1,'x',1,'${SECRET}',210000),(6,'Mia','mia@gmail.com','marketing',1,'x',1,'${SECRET}',200000),
    (7,'Tech','tech@a2z.test','admin',1,'x',1,'${SECRET}',0),(8,'Root','root@a2z.test','super_admin',1,'x',1,'${SECRET}',0),
    (9,'Shop','shop@gmail.com','customer',1,'x',0,NULL,0),(10,'Ed','ed@a2z.test','editor',1,'x',1,'${SECRET}',200000),
    (11,'Lia','lia@gmail.com','live_host',1,'x',1,'${SECRET}',150000),(12,'Second','ceo2@a2z.test','ceo',1,'x',0,NULL,0),
    (13,'Nora','nora@a2z.test','editor',1,'x',1,'${SECRET}',200000),(14,'Root2','root2@a2z.test','super_admin',1,'x',1,'${SECRET}',0)`);
  db.exec(`INSERT INTO customers (id, company, created_by) VALUES (1,'Kedai',5)`);
  const inv = db.prepare(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, payment_status, paid_at, created_at, created_by, salesperson_id, kind) VALUES (?,'INV',?,1,'[{"name":"Live","qty":1,"unit_price_cents":10000}]',0,0,10000,'paid','2026-10-29 02:00:00','2026-10-20 02:00:00',5,5,'service')`);
  for (let i = 0; i < 4; i++) inv.run(100 + i, `INV-${i}`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-10-30T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const { lastRecoveryAdmin } = await import(pathToFileURL(staffBundle).href + `?v=${Math.random()}`);
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const headers = { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", origin: "https://x" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const role = (id) => db.prepare(`SELECT role FROM users WHERE id = ?`).get(id)?.role;
  const auditN = (a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...r, d: JSON.parse(r.detail ?? "{}") } : null; };
  const R = "Restructure approved by the CEO";

  try {
    /* before the owner is named: exactly today's behaviour */
    const pre = await call("/staff/users/4/role", U.ceo, "POST", { role: "cco", reason: R, totp: code() });
    ok(pre.status === 403, "before an owner is named, the CEO still cannot give an executive role", `${pre.status} ${JSON.stringify(pre.j)}`);
    ok((await call("/users/7/revoke-sessions", U.ceo, "POST", { totp: code() })).status === 403, "...nor sign out the Admin account");
    ok(!(await call("/auth/me", U.ceo)).j?.user?.is_owner, "...and /auth/me does not call the CEO the owner");
    const pol0 = await call("/staff/access/policy", U.ceo);
    const a0 = (k) => pol0.j?.actions?.find((a) => a.key === k);
    ok(pol0.status === 200 && pol0.j.owner === null && pol0.j.me_owner === false, "the matrix says no owner is named");
    ok(a0("role_any")?.roles?.join() === "super_admin" && a0("role_any").owner_grant === true && a0("exec_accounts")?.owner_grant && a0("tech_admin")?.owner_grant, "the three owner rows: super admin by role, the owner by grant", JSON.stringify(a0("role_any")));
    ok(a0("backup")?.roles?.join() === "super_admin" && !a0("backup").owner_grant && !a0("owner_designate").owner_grant, "backup and naming the owner stay technical only");
    ok(a0("audit_read")?.roles?.join() === "ceo,admin,super_admin", "the full audit log: CEO, Admin, super admin (unchanged)", String(a0("audit_read")?.roles));
    ok(a0("confirm_paid")?.cond?.ceo && a0("confirm_paid").na.includes("super_admin"), "Confirm Paid is conditional for the CEO and not applicable to the super admin");

    /* naming the owner - the recovery procedure */
    ok((await call("/staff/owner", U.ceo, "POST", { user_id: 1, reason: R, totp: code() })).status === 403, "the CEO cannot name himself the owner");
    ok((await call("/staff/owner", U.coo, "POST", { user_id: 2, reason: R, totp: code() })).status === 403, "the COO cannot name an owner");
    ok((await call("/staff/owner", U.super_admin, "POST", { user_id: 1, reason: "short", totp: code() })).status === 400, "naming the owner needs a reason");
    ok((await call("/staff/owner", U.super_admin, "POST", { user_id: 4, reason: R, totp: code() })).j?.error?.message?.includes("CEO role"), "only a CEO-role account can be the owner");
    ok((await call("/staff/owner", U.super_admin, "POST", { user_id: 12, reason: R, totp: code() })).j?.error?.code === "no_2fa", "a CEO account without 2FA cannot be the owner");
    const noCode = await call("/staff/owner", U.super_admin, "POST", { user_id: 1, reason: R });
    ok(noCode.status === 401 && noCode.j?.error?.code === "totp_required", "naming the owner asks the super admin for an authenticator code", `${noCode.status} ${JSON.stringify(noCode.j)}`);
    const named = await call("/staff/owner", U.super_admin, "POST", { user_id: 1, reason: "Alif is the founder and owner of A2Z", totp: code() });
    ok(named.status === 200 && lastAudit("owner.designate")?.d?.to === 1 && lastAudit("owner.designate").d.reason.includes("founder"), "the super admin names the owner - audited with the reason", JSON.stringify(named.j));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND kind = 'security'`).get().n === 1, "the owner is told");
    const me = await call("/auth/me", U.ceo);
    ok(me.j?.user?.is_owner === true, "/auth/me now says the CEO is the owner", JSON.stringify(me.j?.user));

    /* 1 */
    const pol = await call("/staff/access/policy", U.ceo);
    ok(pol.status === 200 && pol.j.me_owner === true && pol.j.owner?.user_id === 1 && pol.j.owner.verified, "1 the owner reads Roles & Permissions, marked verified");
    ok((await call("/staff/owner", U.ceo)).j?.owner?.verified === true && (await call("/staff/owner", U.ceo)).j?.can_designate === false, "1 ...sees who the owner is and cannot re-name it");
    /* 2 */
    const w = await call("/staff/users/6/role", U.ceo, "POST", { role: "editor" });
    ok(w.status === 200 && role(6) === "editor", "2 the owner changes an ordinary staff role (no code needed, as before)", JSON.stringify(w.j));
    await call("/staff/users/6/role", U.ceo, "POST", { role: "marketing" });
    /* 3 */
    ok((await call("/staff/users/4/role", U.ceo, "POST", { role: "cco", totp: code() })).j?.error?.code === "reason_required", "3 an executive role needs a reason");
    const noT = await call("/staff/users/4/role", U.ceo, "POST", { role: "cco", reason: R });
    ok(noT.status === 401 && noT.j?.error?.code === "totp_required", "3 ...and the owner's authenticator code");
    const ex = await call("/staff/users/4/role", U.ceo, "POST", { role: "cco", reason: R, totp: code() });
    ok(ex.status === 200 && role(4) === "cco" && lastAudit("staff.role_change")?.d?.by_owner === true && lastAudit("staff.role_change").d.privileged && lastAudit("staff.role_change").d.reason === R, "3 the owner assigns an executive role - audited by_owner with the reason", JSON.stringify(lastAudit("staff.role_change")?.d));
    ok((await call("/staff/users/4/role", U.ceo, "POST", { role: "hr_admin", reason: R, totp: code() })).status === 200 && role(4) === "hr_admin", "3 ...and takes it back the same way");
    ok((await call("/staff/users/4/role", U.ceo, "POST", { role: "ceo", reason: R, totp: code() })).status === 403 && role(4) === "hr_admin", "3 the owner cannot give anyone the CEO role");
    ok((await call("/staff/users/5/role", U.ceo, "POST", { role: "customer", reason: "Left the company", totp: code() })).status === 200 && role(5) === "customer", "3 the owner manages customer accounts (role_any)");
    ok((await call("/staff/users/5/role", U.ceo, "POST", { role: "sales_marketing", reason: "Rejoined the sales team", totp: code() })).status === 200 && role(5) === "sales_marketing", "3 ...and promotes a customer back to staff");
    /* 4 */
    ok((await call("/staff/users/6/role", U.ceo, "POST", { role: "admin", reason: R, totp: code() })).j?.error?.code === "domain_policy", "4 the Admin role still needs a company email");
    const g = await call("/staff/users/13/role", U.ceo, "POST", { role: "admin", reason: "Nora runs the website now", totp: code() });
    ok(g.status === 200 && role(13) === "admin", "4 the owner grants technical Admin access", JSON.stringify(g.j));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'security' AND message LIKE '%Admin access given%' AND user_id IN (8, 14, 2)`).get().n === 3, "4 every super admin and the COO are told");
    ok((await call("/staff/users/13/role", U.ceo, "POST", { role: "editor", reason: "Website handed back to marketing", totp: code() })).status === 200 && role(13) === "editor", "4 ...and revokes it");
    ok((await call("/staff/users/8/role", U.ceo, "POST", { role: "admin", reason: R, totp: code() })).status === 403 && role(8) === "super_admin", "4 the owner cannot touch a super admin account");
    ok((await call("/users/8", U.ceo, "PATCH", { is_active: false, totp: code() })).status === 403, "4 ...on the /admin door either");
    ok((await call("/users/13", U.ceo, "PATCH", { role: "super_admin", reason: R, totp: code() })).status === 403, "4 ...and cannot mint a super admin");
    /* 5 */
    const rs0 = await call("/users/7/revoke-sessions", U.ceo, "POST", {});
    ok(rs0.status === 401 && rs0.j?.error?.code === "totp_required", "5 a newly named action (sign out the Admin account) asks for the code", `${rs0.status} ${JSON.stringify(rs0.j)}`);
    ok((await call("/users/7/revoke-sessions", U.ceo, "POST", { totp: code() })).status === 200, "5 ...and then works for the owner");
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 7, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[7]).digest("hex"));
    const mk = await call("/users", U.ceo, "POST", { email: "newcoo@a2z.test", name: "New COO", role: "coo", password: "a-long-password-1", reason: "Second operations officer", totp: code() });
    ok(mk.status === 201 || mk.status === 200, "5 the owner creates a COO account", `${mk.status} ${JSON.stringify(mk.j)}`);
    ok((await call("/users", U.ceo, "POST", { email: "x@a2z.test", name: "X", role: "super_admin", password: "a-long-password-1", reason: R, totp: code() })).status === 403, "5 ...but never a super admin account");
    ok((await call("/audit?limit=5", U.ceo)).status === 200, "5 the owner reads the full audit log");

    /* 6 7 8 9 */
    const c6 = await call("/staff/docs/100/confirm-paid", U.ceo, "POST", { amount_cents: 10000, checked: true });
    ok(c6.status === 201, "6 the CEO confirms a genuinely paid invoice", `${c6.status} ${JSON.stringify(c6.j)}`);
    const c7 = await call("/staff/docs/101/confirm-paid", U.coo, "POST", { amount_cents: 10000, checked: true });
    ok(c7.status === 201, "7 the COO confirms a genuinely paid invoice", `${c7.status} ${JSON.stringify(c7.j)}`);
    ok((await call("/staff/docs/102/confirm-paid", U.cco, "POST", { amount_cents: 10000, checked: true })).status === 403, "8 the CCO cannot confirm Paid");
    ok((await call("/staff/payroll/release", U.cco, "POST", { month: "2026-09" })).status === 403, "9 the CCO cannot release payroll");
    ok((await call("/staff/docs/103/confirm-paid", U.super_admin, "POST", { amount_cents: 10000, checked: true })).status === 403, "the super admin is still not a business approver");

    /* 10 */
    ok((await call("/staff/users/5/role", U.sales_marketing, "POST", { role: "ceo" })).status === 400 && role(5) === "sales_marketing", "10 staff cannot change their own role");
    ok((await call("/staff/users/6/role", U.sales_marketing, "POST", { role: "admin" })).status === 403, "10 ...nor anyone else's");
    ok((await call("/users/5", U.sales_marketing, "PATCH", { role: "admin" })).status === 403, "10 ...on the /admin door either");
    ok((await call("/users/1", U.ceo, "PATCH", { role: "super_admin", reason: R, totp: code() })).status >= 400 && role(1) === "ceo", "10 the owner cannot raise himself");
    ok((await call("/staff/users/4/role", U.coo, "POST", { role: "cco", reason: R, totp: code() })).status === 403, "10 the COO gains no owner power");
    ok((await call("/staff/users/4/role", U.admin, "POST", { role: "cco", reason: R, totp: code() })).status === 403, "10 nor the Admin account");
    /* 11 */
    ok((await call("/staff/users", U.customer)).status === 403 && (await call("/users", U.customer)).status === 403 && (await call("/staff/access/policy", U.customer)).status === 403 && (await call("/staff/owner", U.customer)).status === 403, "11 a customer reaches no Users route");
    /* 12 */
    ok((await call("/users/12", U.super_admin, "PATCH", { role: "coo" })).status === 200 && role(12) === "coo", "12 the super admin still changes any role, without the owner's steps");
    await call("/users/12", U.super_admin, "PATCH", { role: "ceo" });
    ok((await call("/users/14", U.super_admin, "PATCH", { is_active: false })).status === 200, "12 a super admin can retire another while one with 2FA remains");
    ok(await lastRecoveryAdmin(env, 8) === true && await lastRecoveryAdmin(env, 1) === false, "12 the last active super admin is recognised as the last recovery account");
    db.exec(`UPDATE users SET is_active = 1 WHERE id = 14`);
    ok(await lastRecoveryAdmin(env, 8) === false, "12 ...and is free again once another exists");
    /* tabs: the owner is pinned */
    const mine = (await call("/staff/tabs/access", U.ceo)).j;
    ok(mine?.owner_pinned && mine.mine.allow.includes("Payroll") && mine.mine.allow.includes("Users") && mine.mine.deny.length === 0, "the owner's tab strip is pinned to everything the CEO role sees");
    ok((await call("/staff/tabs/access/person", U.super_admin, "POST", { user_id: 1, tab: "Payroll", mode: "deny", reason: "Testing a lock-out" })).j?.error?.code === "owner_pinned", "an exception cannot hide a tab from the owner");
    ok((await call("/staff/tabs/access", U.ceo, "POST", { tab: "Finance", roles: ["coo"] })).j?.error?.code === "owner_pinned", "a role rule cannot drop the CEO from a tab");
    ok((await call("/staff/tabs/access", U.ceo, "POST", { tab: "Finance", roles: ["ceo", "coo"] })).status === 200, "...while other roles can still be changed");
    await call("/staff/tabs/access", U.ceo, "POST", { tab: "Finance", reset: true });

    /* 14 - the matrix equals direct requests, role by role */
    const act = (k) => pol.j.actions.find((a) => a.key === k);
    db.exec(`UPDATE users SET totp_enabled = 1, totp_secret = '${SECRET}' WHERE id = 12`);
    for (const [r, id] of Object.entries({ ceo: 1, coo: 2, cco: 3, hr_admin: 4, marketing: 6, admin: 7, editor: 10, live_host: 11, super_admin: 8 })) {
      const res = await call("/staff/users/5/role", id, "POST", { role: "cco", reason: R, totp: code() });
      const want = act("role_any").roles.includes(r) || (r === "ceo" && act("role_any").owner_grant);
      ok((res.status === 200) === want, `14 role_any: ${r} ${want ? "allowed" : "refused"} as the matrix says`, `${res.status} ${JSON.stringify(res.j)}`);
      if (res.status === 200) await call("/staff/users/5/role", U.super_admin, "POST", { role: "sales_marketing" });
      const rv = await call("/users/3/revoke-sessions", id, "POST", { totp: code() });
      const wantX = act("exec_accounts").roles.includes(r) || (r === "ceo" && act("exec_accounts").owner_grant);
      ok((rv.status === 200) === wantX, `14 exec_accounts: ${r} as the matrix says`, String(rv.status));
      db.prepare(`INSERT OR IGNORE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 3, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[3]).digest("hex"));
    }
    /* 16 */
    ok(!(await call("/auth/me", U.ceo2)).j?.user?.is_owner, "16 a second CEO-role account with 2FA is not the owner");
    ok((await call("/staff/users/4/role", U.ceo2, "POST", { role: "cco", reason: R, totp: code() })).status === 403, "16 ...and gains no owner power");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM company_memberships`).get().n === 0 && role(9) === "customer", "16 no company membership was created and the customer stayed a customer");

    /* 15 - the history */
    const before = db.prepare(`SELECT id, action, detail FROM audit_log ORDER BY id`).all();
    ok(auditN("staff.role_change") >= 8 && auditN("owner.designate") === 1 && auditN("user.force_logout") >= 1, "15 every change is in the audit log", `${auditN("staff.role_change")} ${auditN("owner.designate")} ${auditN("user.force_logout")}`);
    const rev = await call("/staff/access/review", U.ceo);
    ok(rev.j?.history?.some((h) => h.action === "owner.designate") && rev.j.history.some((h) => h.action === "staff.role_change"), "15 the access history shows the owner and the role changes");
    const cleared = await call("/staff/owner", U.super_admin, "POST", { clear: true, reason: "Rollback rehearsal for the release", totp: code() });
    ok(cleared.status === 200 && !(await call("/auth/me", U.ceo)).j?.user?.is_owner, "rollback: the super admin clears the owner and the CEO is back to today's rights");
    ok((await call("/staff/users/4/role", U.ceo, "POST", { role: "cco", reason: R, totp: code() })).status === 403, "rollback: ...the owner's doors close again");
    const after = db.prepare(`SELECT id, action, detail FROM audit_log ORDER BY id`).all();
    ok(JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before) && auditN("owner.clear") === 1, "15 nothing in the history was rewritten; the clear is added");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const build = (srcRoot, dir) => { bundle(srcRoot, "worker/src/index.ts", join(dir, "worker.mjs")); bundle(srcRoot, "worker/src/staff.ts", join(dir, "staff.mjs")); };
const dir = mkdtempSync(join(tmpdir(), "owner-"));
build(root, dir);
report(await runtime(join(dir, "worker.mjs"), join(dir, "staff.mjs")));
const checks = n;

const MUT = [
  ["worker/src/index.ts", "any CEO-role account counts as the owner", "is_owner = Number((JSON.parse(row.owner_meta) as { user_id?: unknown }).user_id) === row.id;", "is_owner = true;"],
  ["worker/src/staff.ts", "the owner's authenticator code is skipped", 'if (user.role === "super_admin" || !user.is_owner) return null;', "return null;"],
  ["worker/src/permissions.ts", "the owner may name the owner", 'export const OWNER_GRANTS: readonly (keyof typeof PERMS)[] = ["exec_accounts", "role_any", "tech_admin_grant", "account_email", "account_recovery"];', 'export const OWNER_GRANTS: readonly (keyof typeof PERMS)[] = ["exec_accounts", "role_any", "tech_admin_grant", "account_email", "account_recovery", "owner_designate"];'],
  ["worker/src/permissions.ts", "the owner may give the CEO role", 'if (d === "super_only") return actor.role === "super_admin";', 'if (d === "super_only") return actor.role === "super_admin" || allows(actor, "role_any");'],
  ["worker/src/permissions.ts", "no change counts as privileged", 'return { ok: true, privileged: roleDoor(target.role) !== "role_assign" || roleDoor(to) !== "role_assign" };', "return { ok: true, privileged: false };"],
  ["worker/src/permissions.ts", "executive accounts back to super admin only", 'if (role === "admin" || role === "coo" || role === "cco") return allows(actor, "exec_accounts");', 'if (role === "admin" || role === "coo" || role === "cco") return actor.role === "super_admin";'],
  ["worker/src/staff.ts", "an exception can hide a tab from the owner", 'if (mode === "deny" && target.role === "ceo" && (await readOwner(env))?.user_id === targetId) {', "if (false) {"],
  ["worker/src/staff.ts", "the last recovery admin check always passes", "  return Number(others?.n ?? 0) === 0;\n}", "  return false;\n}"],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "owner-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { build(mdir, mdir); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"), join(mdir, "staff.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`owner-access: ${fail} of ${n} failed`); process.exit(1); }
console.log(`owner-access: ${checks} checks passed (${MUT.length} mutations caught) - one verified owner on the one permission source; super admin keeps recovery; nobody escalates themselves`);
