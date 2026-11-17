/* CUSTOM ROLES (v1.350.0) - runtime guard: the WHOLE worker (index.ts, bundled)
 * against SQLite with every migration applied, by direct request.
 *
 * The CEO, 17-11-2026 ("A2Z OS - CUSTOM ROLE MANAGEMENT"): create, edit,
 * duplicate, assign, deactivate and delete custom roles inside the existing
 * Roles & Permissions tab; the CEO and the super admin with IDENTICAL access;
 * the existing permission engine (no second RBAC); built-in roles protected;
 * delete only when unused or after reassignment; enforced on the server and
 * written to the audit history; /admin and the portal never disagree.
 *
 *   1 the CEO (owner or not) and the super admin manage custom roles; the COO,
 *     HR and staff do not - on every action
 *   2 every change needs a reason and the authenticator code, and is audited
 *   3 a custom role stands on one working base role; never on an executive,
 *     technical, agent or customer role; never on a protected capability
 *   4 a custom role IS a column of the same cells: what the cells say is what
 *     the server allows, for the person holding it, from the next request
 *   5 assigning goes through the one role door; the person keeps the base role
 *   6 deactivated = the people fall back to the base role at once; a
 *     deactivated role cannot be given
 *   7 delete is refused while anybody holds it unless they are moved; deleting
 *     strips the column from every cell; the audit history stays
 *   8 a system role change - in the portal or in /admin - clears the custom role
 *   9 the KPI strip's "edited" count does not count custom columns
 * Then mutated copies must each fail a check.  NOMUT=1 skips the mutations.
 *
 *   node tests/custom-roles.mjs
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
    (20,'Second CEO','ceo2@a2z.test','ceo',1,'x',1,'${SECRET}',0), (22,'Clerk Two','clerk2@a2z.test','marketing',1,'x',1,'${SECRET}',0), (23,'Clerk Three','clerk3@a2z.test','marketing',1,'x',1,'${SECRET}',0)`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":10,"set_by_name":"super_admin","set_at":"2026-10-30 02:00:00","reason":"Founder and owner"}')`);
  const RealDate = globalThis.Date; let fixed = new RealDate("2026-11-17T02:00:00Z").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const code = () => { fixed += 31000; return totpAt(fixed); };
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [...Object.values(ID), 20, 22, 23]) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id);
  }
  const call = async (path, uid, method = "GET", body, api = "/api/v1") => {
    const headers = { cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json", origin: "https://x" };
    const r = await worker.fetch(new Request(`https://api.a2z.test${api}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const R = "Restructuring the warehouse team";
  const cr = (uid, method, path, body = {}) => call(`/staff/access/custom-roles${path}`, uid, method, { reason: R, totp: code(), ...body });
  const policy = async (uid = ID.ceo) => (await call("/staff/access/policy", uid)).j;
  const cell = async (cap, uid = ID.ceo) => (await policy(uid))?.actions?.find((a) => a.cap === cap && a.editable);
  const caps = async (uid) => (await call("/auth/me", uid)).j?.user?.caps ?? [];
  const meUser = async (uid) => (await call("/auth/me", uid)).j?.user ?? {};
  const auditN = (a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...JSON.parse(r.detail ?? "{}"), _by: r.user_id } : null; };
  const userRow = (id) => db.prepare(`SELECT role, custom_role_id FROM users WHERE id = ?`).get(id);
  const HV = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"];
  const rawCells = () => JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'role_permissions'`).get()?.value ?? "{}").perms ?? {};
  const hotels = (uid) => call("/staff/hotels", uid);
  const assign = (uid, target, role) => call(`/staff/users/${target}/role`, uid, "POST", { role, reason: R, totp: code() });
  let n = 0;

  try {
    /* 1 who may manage */
    const p0 = await policy(ID.ceo);
    ok(p0?.can_manage_custom === true && Array.isArray(p0.custom_roles) && p0.custom_roles.length === 0 && p0.custom_bases?.join() === "hr_admin,sales_marketing,marketing,editor,live_host", "1 the CEO may manage custom roles; none exist; the five working base roles are offered", JSON.stringify({ m: p0?.can_manage_custom, b: p0?.custom_bases }));
    ok((await policy(ID.super_admin))?.can_manage_custom === true && (await policy(20))?.can_manage_custom === true, "1 the super admin and a CEO-role account have the same access");
    ok((await policy(ID.coo))?.can_manage_custom === false, "1 the COO reads the policy but cannot manage custom roles");
    for (const r of ["coo", "cco", "hr_admin", "admin", "editor"]) ok((await cr(ID[r], "POST", "", { name: "Try " + r, base_role: "editor" })).status === 403, `1 ${r} cannot create a custom role`);
    ok(!(await caps(ID.coo)).includes("role_custom") && (await caps(ID.ceo)).includes("role_custom") && (await caps(ID.super_admin)).includes("role_custom"), "1 /auth/me: role_custom is the CEO's and the super admin's");

    /* 2 reason + code */
    ok((await call("/staff/access/custom-roles", ID.ceo, "POST", { name: "Inventory Clerk", base_role: "editor", totp: code() })).j?.error?.code === "reason_required", "2 creating needs a reason");
    const noT = await call("/staff/access/custom-roles", ID.ceo, "POST", { name: "Inventory Clerk", base_role: "editor", reason: R });
    ok(noT.status === 401 && noT.j?.error?.code === "totp_required", "2 ...and the authenticator code", JSON.stringify(noT.j));

    /* 3 base roles */
    for (const b of ["ceo", "coo", "cco", "admin", "super_admin", "agent", "customer", ""]) ok((await cr(ID.ceo, "POST", "", { name: "Bad base " + (b || "none"), base_role: b })).status === 400, `3 a custom role never stands on ${b || "no base role"}`);
    ok((await cr(ID.ceo, "POST", "", { name: "x", base_role: "editor" })).status === 400, "3 a name is at least 3 characters");
    ok((await cr(ID.ceo, "POST", "", { name: "Marketing", base_role: "editor" })).status === 409, "3 a custom role cannot take a built-in role's name");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM custom_roles`).get().n === 0 && auditN("role.create") === 0, "nothing refused was written");

    /* create - the CEO (owner) */
    const c1 = await cr(ID.ceo, "POST", "", { name: "Inventory Clerk", description: "Receives and counts stock", base_role: "editor" });
    ok(c1.status === 201 && c1.j?.key === "cr_inventory_clerk" && c1.j.cells > 0, "the CEO creates Inventory Clerk on the editor base, starting from the editor's cells", JSON.stringify(c1.j));
    const clerk = { id: c1.j?.id, key: c1.j?.key };
    ok(lastAudit("role.create")?.key === clerk.key && lastAudit("role.create").reason === R && lastAudit("role.create")._by === ID.ceo, "2 the creation is audited with the reason and who");
    /* create - the super admin, the same door */
    const c2 = await cr(ID.super_admin, "POST", "", { name: "Sales Coordinator", base_role: "sales_marketing", template: "sales_marketing" });
    ok(c2.status === 201 && lastAudit("role.create")?._by === ID.super_admin, "1 the super admin creates Sales Coordinator through the same door", JSON.stringify(c2.j));
    ok((await cr(20, "POST", "", { name: "Live Assistant", base_role: "live_host" })).status === 201, "1 a CEO-role account that is not the owner creates too (identical access)");
    ok((await cr(ID.super_admin, "POST", "", { name: "inventory clerk", base_role: "editor" })).status === 409, "3 names are unique, case-insensitive");

    const p1 = await policy(ID.ceo);
    ok(p1?.custom_roles?.length === 3 && p1.custom_roles.some((c) => c.key === clerk.key && c.base_role === "editor" && c.active && c.description === "Receives and counts stock"), "the new roles are in the policy the Role Directory reads", JSON.stringify(p1?.custom_roles));
    ok(p1?.edited_count === 0, "9 the KPI strip's edited count does not count the custom columns", String(p1?.edited_count));
    const editorCaps = await caps(ID.editor);
    const tv = p1.actions.find((a) => a.cap === "claims_submit");
    ok(tv?.roles?.includes(clerk.key) && !p1.actions.find((a) => a.cap === "hotels_manage")?.roles?.includes(clerk.key), "4 the clerk's column copies the editor's cells - and only those");
    ok(p1.actions.find((a) => a.cap === "role_any")?.custom_forbidden === true && p1.actions.find((a) => a.cap === "claims_submit")?.custom_forbidden === false, "3 the policy marks which cells a custom role can never hold");

    /* 5 assign through the one role door */
    ok((await call(`/staff/users/22/role`, ID.coo, "POST", { role: clerk.key, reason: R, totp: code() })).status === 403, "5 the COO cannot give a custom role");
    ok((await call(`/staff/users/22/role`, ID.ceo, "POST", { role: clerk.key, totp: code() })).j?.error?.code === "reason_required", "5 giving it needs a reason");
    ok((await call(`/staff/users/22/role`, ID.ceo, "POST", { role: clerk.key, reason: R })).status === 401, "5 ...and the code");
    ok((await assign(ID.ceo, 22, "cr_no_such_role")).status === 400, "5 an unknown custom role is refused");
    const a1 = await assign(ID.ceo, 22, clerk.key);
    ok(a1.status === 200 && userRow(22).role === "editor" && userRow(22).custom_role_id === clerk.id, "5 the person gets the base role and the custom role", JSON.stringify({ a: a1.j, u: userRow(22) }));
    ok(lastAudit("role.assign")?.to === clerk.key && lastAudit("role.assign").from === "marketing", "2 the assignment is audited from -> to");
    ok((await assign(ID.super_admin, 23, clerk.key)).status === 200, "1 the super admin assigns through the same door");
    const m22 = await meUser(22);
    ok(m22.role === "editor" && m22.custom_role === clerk.key && m22.custom_role_name === "Inventory Clerk", "5 the session knows the custom role and its name", JSON.stringify({ r: m22.role, c: m22.custom_role }));
    const c22 = await caps(22);
    ok(c22.join() === editorCaps.join(), "4 copied from the editor, the clerk holds exactly the editor's capabilities", `${c22.length} vs ${editorCaps.length}`);
    ok((await call("/staff/accounts/22", ID.ceo)).j?.custom_role?.key === clerk.key, "the account sheet shows the custom role");
    ok((await call("/staff/accounts/7", ID.ceo)).j?.roles_allowed?.includes(clerk.key), "6 the assignment dropdown offers the active custom role");

    /* 4 the cells ARE the permission */
    ok((await hotels(22)).status === 403, "4 before: the clerk cannot open the hotel directory");
    ok((await call("/staff/access/policy", 20, "POST", { reason: R, totp: code(), changes: [{ cap: "hotels_view", roles: [...HV, "editor"] }] })).status === 403, "1 a CEO who is not the owner cannot change a built-in role's cell");
    const e1 = await call("/staff/access/policy", 20, "POST", { reason: R, totp: code(), changes: [{ cap: "hotels_view", roles: [...HV, clerk.key] }, { cap: "hotels_manage", roles: [...HV, clerk.key] }] });
    ok(e1.status === 200, "4 ...but the CEO and the super admin edit a custom role's column with the existing editor", JSON.stringify(e1.j));
    ok((await hotels(22)).status === 200 && (await hotels(ID.editor)).status === 403, "4 after: the clerk opens the hotel directory on the very next request; a plain editor still cannot");
    ok((await caps(22)).includes("hotels_view") && !(await caps(ID.editor)).includes("hotels_view"), "4 /auth/me says the same");
    ok((await policy())?.edited_count === 0, "9 still no built-in cell counted as edited");
    const lk = await call("/staff/access/policy", ID.ceo, "POST", { reason: R, totp: code(), changes: [{ cap: "role_any", roles: ["super_admin", clerk.key] }] });
    ok(lk.status === 409 || lk.status === 400, "3 a protected capability can never be given to a custom role", `${lk.status} ${JSON.stringify(lk.j)}`);
    const sm = db.prepare(`SELECT value FROM system_meta WHERE key = 'role_permissions'`).get();
    db.exec(`UPDATE system_meta SET value = '${JSON.stringify({ ...JSON.parse(sm.value), perms: { ...JSON.parse(sm.value).perms, role_custom: ["super_admin", "ceo", clerk.key], role_any: ["super_admin", clerk.key] } }).replace(/'/g, "''")}' WHERE key = 'role_permissions'`);
    ok(!(await caps(22)).includes("role_custom") && !(await caps(22)).includes("role_any") && (await caps(ID.ceo)).includes("role_custom"), "3 a stored record that names a custom role on a protected cell gives it nothing");
    ok(!(await policy())?.actions?.find((a) => a.cap === "role_any")?.roles?.includes(clerk.key), "3 ...and the matrix does not show it there");
    db.exec(`UPDATE system_meta SET value = '${sm.value.replace(/'/g, "''")}' WHERE key = 'role_permissions'`);

    /* edit */
    const ed = await cr(ID.super_admin, "PATCH", `/${clerk.id}`, { name: "Stock Clerk", description: "Receives, counts and returns stock" });
    ok(ed.status === 200 && db.prepare(`SELECT name FROM custom_roles WHERE id = ?`).get(clerk.id).name === "Stock Clerk" && lastAudit("role.update")?.name_to === "Stock Clerk", "the super admin renames it; audited before and after", JSON.stringify(ed.j));
    ok((await cr(ID.coo, "PATCH", `/${clerk.id}`, { name: "Hijack" })).status === 403, "1 the COO cannot edit a custom role");
    ok((await meUser(22)).custom_role_name === "Stock Clerk", "the new name reaches the person at once");

    /* 6 deactivate */
    const d1 = await cr(ID.ceo, "PATCH", `/${clerk.id}`, { active: false });
    ok(d1.status === 200 && lastAudit("role.disable")?.people === 2, "6 the CEO deactivates it; audited with how many people it affects");
    const m22d = await meUser(22);
    ok(!m22d.custom_role && m22d.role === "editor" && (await caps(22)).join() === editorCaps.join() && (await hotels(22)).status === 403, "6 deactivated: the people fall back to the base role at once", JSON.stringify({ c: m22d.custom_role }));
    ok(userRow(22).custom_role_id === clerk.id, "6 ...and keep the link, so activating brings it back");
    ok((await assign(ID.ceo, ID.editor, clerk.key)).j?.error?.code === "role_inactive", "6 a deactivated role cannot be given");
    ok(!(await call("/staff/accounts/7", ID.ceo)).j?.roles_allowed?.includes(clerk.key), "6 ...nor is it offered in the dropdown");
    ok((await cr(ID.super_admin, "PATCH", `/${clerk.id}`, { active: true })).status === 200 && auditN("role.enable") === 1 && (await hotels(22)).status === 200, "6 the super admin activates it; the people have it again");

    /* duplicate */
    const dup = await cr(ID.ceo, "POST", `/${clerk.id}/duplicate`, { name: "Stock Clerk (Night)" });
    ok(dup.status === 201 && lastAudit("role.duplicate")?.from === clerk.key, "duplicate: a new role with the source's cells, audited", JSON.stringify(dup.j));
    const dupKey = dup.j?.key, dupId = dup.j?.id;
    ok((await cell("hotels_manage"))?.roles?.includes(dupKey) && rawCells().hotels_view?.includes(dupKey) && db.prepare(`SELECT base_role FROM custom_roles WHERE id = ?`).get(dupId)?.base_role === "editor", "duplicate keeps the base role and the hotel cell");

    /* 7 delete */
    const del0 = await cr(ID.ceo, "POST", `/${clerk.id}/delete`);
    ok(del0.status === 409 && del0.j?.error?.code === "in_use", "7 delete is refused while two people hold it and nobody says where they go");
    ok((await cr(ID.ceo, "POST", `/${clerk.id}/delete`, { reassign_to: c2.j?.id })).status === 400, "7 people move only to a custom role on the SAME base role");
    ok((await cr(ID.coo, "POST", `/${clerk.id}/delete`, { reassign_to: dupId })).status === 403, "1 the COO cannot delete");
    const del1 = await cr(ID.ceo, "POST", `/${clerk.id}/delete`, { reassign_to: dupId });
    ok(del1.status === 200 && userRow(22).custom_role_id === dupId && userRow(23).custom_role_id === dupId && !db.prepare(`SELECT 1 FROM custom_roles WHERE id = ?`).get(clerk.id), "7 with a reassignment the people move, then the role is deleted", JSON.stringify(del1.j));
    ok(!(await policy())?.actions?.some((a) => a.roles?.includes(clerk.key)) && !Object.values(rawCells()).some((v) => v.includes(clerk.key)), "7 the deleted column is gone from every cell");
    ok(lastAudit("role.delete")?.moved?.length === 2 && lastAudit("role.delete").moved_to === dupKey && auditN("role.create") === 3, "7 the deletion is audited (who moved where) and the history stays");
    ok((await hotels(22)).status === 200 && (await meUser(22)).custom_role === dupKey, "7 the moved people hold the new role's permissions");
    const lv = p1.custom_roles.find((c) => c.name === "Live Assistant");
    ok((await cr(ID.super_admin, "POST", `/${lv.id}/delete`)).status === 200, "7 an unused custom role is deleted without a reassignment");
    const del2 = await cr(ID.ceo, "POST", `/${dupId}/delete`, { reassign_to: "base" });
    ok(del2.status === 200 && userRow(22).custom_role_id === null && userRow(22).role === "editor" && (await hotels(22)).status === 403, "7 or the people go back to the base role", JSON.stringify(del2.j));

    /* 8 a system role change clears a custom role - portal and /admin */
    const c3 = await cr(ID.ceo, "POST", "", { name: "Hotel Desk", base_role: "marketing", template: "marketing" });
    ok((await assign(ID.ceo, 22, c3.j?.key)).status === 200 && userRow(22).role === "marketing", "8 a custom role can move someone to its base role");
    const sys = await assign(ID.ceo, 22, "editor");
    ok(sys.status === 200 && userRow(22).custom_role_id === null && lastAudit("staff.role_change")?.custom_role_cleared === c3.j?.id, "8 the portal's role door: a system role clears the custom role, audited", JSON.stringify({ s: sys.j, u: userRow(22), a: lastAudit("staff.role_change") }));
    ok((await assign(ID.ceo, 23, c3.j?.key)).status === 200 && userRow(23).custom_role_id === c3.j?.id, "8 (given again for the /admin check)");
    const adm = await call("/users/23", ID.super_admin, "PATCH", { role: "editor", reason: R, totp: code() });
    ok(adm.status === 200 && userRow(23).role === "editor" && userRow(23).custom_role_id === null, "8 /admin: a role change there clears the custom role too", `${adm.status} ${JSON.stringify(adm.j)} ${JSON.stringify(userRow(23))}`);
    db.exec(`UPDATE users SET custom_role_id = ${c3.j?.id}, role = 'editor' WHERE id = 23`);
    ok(!(await meUser(23)).custom_role, "8 a custom role whose base no longer matches the person's role is ignored at sign-in");
    db.exec(`UPDATE users SET custom_role_id = NULL WHERE id = 23`);
    ok((await assign(ID.ceo, ID.ceo, c3.j?.key)).j?.error?.code === "self_change", "5 nobody gives themselves a custom role");
    ok((await assign(ID.ceo, ID.super_admin, c3.j?.key)).status === 403, "5 a super admin account never takes a custom role from the portal");
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
const dir = mkdtempSync(join(tmpdir(), "custom-roles-"));
bundle(root, join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const MUT = [
  ["worker/src/permissions.ts", "a stored custom column on a protected cell is kept", "(isCustomKey(r) && !CUSTOM_FORBIDDEN.has(k))", "(isCustomKey(r))"],
  ["worker/src/permissions.ts", "a custom role is ignored (the base role decides)", "  if (s.custom_role && isCustomKey(s.custom_role)) return !CUSTOM_FORBIDDEN.has(String(perm)) && rolesFor(perm).includes(s.custom_role as Role);", ""],
  ["worker/src/staff.ts", "anybody manages custom roles", '    if (!allows(user, "role_custom")) return err("forbidden", "Only the CEO and the super admin manage custom roles.", 403);', ""],
  ["worker/src/staff.ts", "the code is skipped on create", 'const su = await requireFreshTotp(env, user, body?.totp, err, cur ? "duplicate a custom role" : "create a custom role");', "const su = null;"],
  ["worker/src/staff.ts", "delete ignores the people holding it", '      if (cur.users.length > 0 && to === null) return err("in_use",', '      if (false) return err("in_use",'],
  ["worker/src/staff.ts", "a system role change keeps the custom role", "    if (heldCustom) await env.DB.prepare(`UPDATE users SET custom_role_id = NULL WHERE id = ?1`).bind(id).run(); // v1.350.0", ""],
  ["worker/src/index.ts", "a deactivated role still applies", "c.id = u.custom_role_id AND c.active = 1 AND c.base_role = u.role) AS custom_role,", "c.id = u.custom_role_id AND c.base_role = u.role) AS custom_role,"],
  ["worker/src/staff.ts", "creation is not audited", '      await audit(env, user.id, cur ? "role.duplicate" : "role.create"', '      if (0) await audit(env, user.id, cur ? "role.duplicate" : "role.create"'],
];
for (const [file, name, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "custom-roles-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`custom-roles: ${fail} of ${n} failed`); process.exit(1); }
console.log(`custom-roles: ${checks} checks passed (${process.env.NOMUT === "1" ? "mutations skipped" : `${MUT.length} mutations caught`}) - the CEO and the super admin create, edit, duplicate, assign, deactivate and delete custom roles on the one permission engine; audited; /admin and the portal agree`);
