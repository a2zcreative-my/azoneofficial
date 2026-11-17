/* ROLES V2, STAGE 1 (v1.355.0, docs/ROLES-V2-PLAN.md) - runtime guard: the WHOLE worker
 * (index.ts, bundled) against SQLite with every migration applied, by direct request.
 *
 * The CEO, 17-11-2026: "permission roles that for me to create by myself or super
 * admin without hardcoded ... add or remove the roles based on the operation needed".
 *
 *   1 the roles table holds the twelve code roles; R-1 protected; R-4 seeds; R-5 choices
 *   2 only the CEO and the super admin manage roles (R-6), with a reason and the code
 *   3 names and pages are checked on the server
 *   4 a role is created with NO base role - blank or a copy, never a protected capability
 *   5 it is one more column of the same cells, saved through the one door
 *   6 stage 1 never gives it to a person: the role door and users.role both refuse
 *   7 edit: rename, pages, the staff switch - audited; the key never changes
 *   8 protected and code roles stay put, on the server AND in the database (0208 triggers)
 *   9 delete strips its cells; the history stays
 *  10 the custom roles of 1.350.0 keep working on their base role
 *  STAGE 2 (v1.356.0): 11-15 a holder's pages are their role's list (and the access review agrees);
 *     every staff list obeys counts_as_staff, from one fragment; 2FA for every own role; a held role stays
 *  STAGE 3 (v1.358.0): 6 the role door GIVES an own role (role_custom, reason, code; the database checks
 *     the key); 16-17 a claim from an own role waits on the claimant's chart manager, then the CEO;
 *     18 HR review is a permission; 19 "Make it your own role"; 20 the users rebuild kept every column
 * Then mutated copies must each fail a check.  NOMUT=1 skips the mutations.
 *
 *   node tests/roles-v2.mjs
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
  const R = "Setting up the warehouse team";
  const rl = (uid, method, path, body = {}) => call(`/staff/access/roles${path}`, uid, method, { reason: R, totp: code(), ...body });
  const policy = async (uid = ID.ceo) => (await call("/staff/access/policy", uid)).j;
  const auditN = (a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(a).n;
  const lastAudit = (a) => { const r = db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(a); return r ? { ...JSON.parse(r.detail ?? "{}"), _by: r.user_id, _target: r.entity } : null; };
  const rawCells = () => JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'role_permissions'`).get()?.value ?? "{}").perms ?? {};
  const row = (k) => db.prepare(`SELECT * FROM roles WHERE key = ?`).get(k);
  const dbRefuses = (sql) => { try { db.exec(sql); return false; } catch { return true; } };

  try {
    /* 1 the roles table: the twelve code roles, R-1 protected, R-4 staff by today's lists */
    const p0 = await policy(ID.ceo);
    const t0 = p0?.role_table ?? [];
    const kind = Object.fromEntries(t0.map((x) => [x.key, x.kind]));
    ok(t0.length === 12 && p0.roles_stage === 3, "1 the policy carries the twelve code roles and the stage", JSON.stringify(t0.map((x) => x.key)));
    ok(["super_admin", "ceo", "coo", "cco", "agent", "customer"].every((k) => kind[k] === "protected") && ["admin", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"].every((k) => kind[k] === "builtin"), "1 R-1: Super Admin, CEO, COO, CCO, Agent and Customer are protected; the other six are code roles", JSON.stringify(kind));
    const staffOn = t0.filter((x) => x.counts_as_staff).map((x) => x.key).sort().join();
    ok(staffOn === ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host"].sort().join(), "1 R-4: counts-as-staff seeds match today's attendance and payroll roles", staffOn);
    const choices = p0?.role_tab_choices ?? [];
    const always = (p0?.tabs ?? []).filter((x) => x.always).map((x) => x.tab);
    ok(choices.length > 10 && always.length > 0 && !always.some((a) => choices.includes(a)), "1 R-5: the pages a role may list exclude the ones every role always sees", JSON.stringify({ choices: choices.length, always }));

    /* 2 who may manage: the CEO and the super admin (R-6), nobody else */
    for (const r of ["coo", "cco", "hr_admin", "admin", "editor"]) ok((await rl(ID[r], "POST", "", { name: "Try " + r })).status === 403, `2 ${r} cannot create a role`);
    ok((await call("/staff/access/roles", ID.ceo, "POST", { name: "Warehouse Clerk", totp: code() })).j?.error?.code === "reason_required", "2 creating needs a reason");
    const noT = await call("/staff/access/roles", ID.ceo, "POST", { name: "Warehouse Clerk", reason: R });
    ok(noT.status === 401 && noT.j?.error?.code === "totp_required", "2 ...and the authenticator code", JSON.stringify(noT.j));

    /* 3 the name and the pages are checked on the server */
    ok((await rl(ID.ceo, "POST", "", { name: "x" })).status === 400, "3 a name is at least 3 characters");
    ok((await rl(ID.ceo, "POST", "", { name: "Marketing" })).status === 409 && (await rl(ID.ceo, "POST", "", { name: "CEO" })).status === 409, "3 a role cannot take a code role's name");
    ok((await rl(ID.ceo, "POST", "", { name: "Bad Pages", tabs: ["NoSuchTab"] })).status === 400, "3 a page that is not a portal tab is refused");
    ok((await rl(ID.ceo, "POST", "", { name: "Bad Pages", tabs: [always[0]] })).status === 400, "3 an always-visible page is not a choice");
    ok((await rl(ID.ceo, "POST", "", { name: "Bad Copy", copy_from: "nobody" })).status === 400, "3 copying from an unknown role is refused");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM roles WHERE kind = 'own'`).get().n === 0 && auditN("role.create") === 0, "3 nothing refused was written");

    /* 4 create with no base role: blank, and as a copy */
    const pages = choices.slice(0, 3);
    const c1 = await rl(ID.ceo, "POST", "", { name: "Warehouse Clerk", description: "Receives stock", tabs: pages });
    ok(c1.status === 201 && c1.j?.key === "r_warehouse_clerk" && c1.j.cells === 0, "4 the CEO creates Warehouse Clerk with no base role and blank permissions", JSON.stringify(c1.j));
    const w = row("r_warehouse_clerk");
    ok(w?.kind === "own" && w.counts_as_staff === 1 && JSON.parse(w.tabs).join() === pages.join() && w.description === "Receives stock", "4 R-4 on by default; R-5 the chosen pages are stored", JSON.stringify(w));
    ok(!Object.values(rawCells()).some((v) => v.includes("r_warehouse_clerk")), "4 blank means no cell holds it");
    const la = lastAudit("role.create");
    ok(la?.key === "r_warehouse_clerk" && la.reason === R && la._by === ID.ceo && la._target === "roles", "4 the creation is audited with the reason and who", JSON.stringify(la));
    const c2 = await rl(ID.super_admin, "POST", "", { name: "Field Seller", copy_from: "sales_marketing", counts_as_staff: false });
    ok(c2.status === 201 && c2.j?.cells > 0 && row(c2.j.key)?.counts_as_staff === 0, "4 the super admin creates through the same door; a copy takes the other role's cells; the staff switch can be off", JSON.stringify(c2.j));
    const fs = c2.j?.key;
    const forb = ["role_custom", "owner_designate", "backup_download", "role_any", "exec_accounts", "role_top", "content_manage"];
    const cells = rawCells();
    ok(!forb.some((cap) => (cells[cap] ?? []).includes(fs)), "4 a copy never takes a protected capability", JSON.stringify(forb.filter((cap) => (cells[cap] ?? []).includes(fs))));
    const c3 = await rl(ID.ceo, "POST", "", { name: "Deputy Office", copy_from: "ceo" });
    const cells3 = rawCells();
    ok(c3.status === 201 && c3.j?.cells > 0 && !forb.some((cap) => (cells3[cap] ?? []).includes(c3.j.key)), "4 even a copy of the CEO never takes a protected capability", JSON.stringify(forb.filter((cap) => (cells3[cap] ?? []).includes(c3.j?.key))));
    ok((await rl(ID.ceo, "POST", "", { name: "warehouse clerk" })).status === 409, "4 names are unique, case-insensitive");
    ok((await rl(20, "POST", "", { name: "Packing Lead" })).status === 201, "2 a CEO-role account that is not the owner creates too (identical access)");

    /* 5 one more column of the same cells */
    const p1 = await policy(ID.ceo);
    ok(p1?.role_table?.filter((x) => x.kind === "own").length === 4 && p1.edited_count === 0, "5 the own roles are in the policy; the edited count does not count their columns", String(p1?.edited_count));
    ok(p1.actions.find((a) => a.cap === "claims_submit")?.roles?.includes(fs), "5 the copied column shows in the published cells");
    const save = (body) => call("/staff/access/policy", ID.ceo, "POST", { reason: R, totp: code(), ...body });
    const cur = (cap) => p1.actions.find((a) => a.cap === cap && a.editable)?.roles ?? [];
    const sv = await save({ changes: [{ cap: "hotels_manage", roles: [...cur("hotels_manage"), "r_warehouse_clerk"] }] });
    ok(sv.status === 200 && (rawCells().hotels_manage ?? []).includes("r_warehouse_clerk"), "5 the CEO switches a cell on for the own role through the one save door", JSON.stringify(sv.j));
    ok((await save({ changes: [{ cap: "role_any", roles: [...cur("role_any"), "r_warehouse_clerk"] }] })).status === 409, "5 a protected capability is refused for an own role");
    /* a record written around the door (or before this release) cannot put an own role on a protected cell */
    const rec = JSON.parse(db.prepare(`SELECT value FROM system_meta WHERE key = 'role_permissions'`).get().value);
    rec.perms.exec_accounts = [...(rec.perms.exec_accounts ?? ["super_admin"]), fs];
    db.prepare(`UPDATE system_meta SET value = ? WHERE key = 'role_permissions'`).run(JSON.stringify(rec));
    ok(!(await policy(ID.ceo)).actions.find((a) => a.cap === "exec_accounts")?.roles?.includes(fs), "5 a stored own column on a protected cell is ignored on read");
    ok((await call("/staff/access/policy", ID.coo, "POST", { reason: R, totp: code(), changes: [{ cap: "hotels_manage", roles: cur("hotels_manage") }] })).status === 403, "5 the COO cannot switch cells");

    /* 6 STAGE 3: the role door gives an own role - role_custom, a reason, the code; the database checks the key */
    ok((await call(`/staff/users/22/role`, ID.coo, "POST", { role: "r_warehouse_clerk", reason: R, totp: code() })).status === 403, "6 the COO cannot give an own role (R-6)");
    ok((await call(`/staff/users/22/role`, ID.ceo, "POST", { role: "r_warehouse_clerk", reason: "short", totp: code() })).status === 400, "6 a reason is required");
    ok((await call(`/staff/users/22/role`, ID.ceo, "POST", { role: "r_nobody_has_this", reason: R, totp: code() })).status === 400, "6 an unknown role is refused");
    const g = await call(`/staff/users/22/role`, ID.ceo, "POST", { role: "r_warehouse_clerk", reason: R, totp: code() });
    ok(g.status === 200 && db.prepare(`SELECT role FROM users WHERE id = 22`).get().role === "r_warehouse_clerk", "6 the CEO gives an own role through the role door", JSON.stringify(g.j));
    ok(lastAudit("role.assign")?.to === "r_warehouse_clerk" && lastAudit("role.assign")?.from === "marketing", "6 the change is audited from and to");
    const back = await call(`/staff/users/22/role`, ID.ceo, "POST", { role: "marketing", reason: R, totp: code() });
    ok(back.status === 200 && db.prepare(`SELECT role FROM users WHERE id = 22`).get().role === "marketing", "6 and takes it away again through the same door", JSON.stringify(back.j));
    ok(dbRefuses(`UPDATE users SET role = 'r_not_a_role' WHERE id = 22`) && dbRefuses(`UPDATE users SET role = 'boss' WHERE id = 22`), "6 users.role refuses a key the roles table does not hold (0209 triggers)");

    /* 7 edit */
    const e0 = await rl(ID.ceo, "PATCH", "/r_warehouse_clerk", { name: "Warehouse Clerk" , description: "Receives stock", tabs: pages, counts_as_staff: true });
    ok(e0.status === 200 && e0.j?.unchanged === true, "7 nothing changed = nothing written", JSON.stringify(e0.j));
    const more = choices.slice(1, 5);
    const e1 = await rl(ID.ceo, "PATCH", "/r_warehouse_clerk", { name: "Stock Clerk", tabs: more, counts_as_staff: false });
    const w2 = row("r_warehouse_clerk");
    ok(e1.status === 200 && w2.name === "Stock Clerk" && w2.counts_as_staff === 0 && JSON.parse(w2.tabs).join() === more.join() && w2.key === "r_warehouse_clerk", "7 rename, re-page and the staff switch; the key stays", JSON.stringify(w2));
    const lu = lastAudit("role.update");
    ok(lu?.name_from === "Warehouse Clerk" && lu.tabs_added?.length > 0 && lu.tabs_removed?.length > 0 && lu.counts_as_staff === false, "7 the change is audited, page by page", JSON.stringify(lu));
    ok((await rl(ID.ceo, "PATCH", `/${fs}`, { name: "Stock Clerk" })).status === 409, "7 a rename cannot take another role's name");
    ok((await rl(ID.coo, "PATCH", "/r_warehouse_clerk", { name: "Coo Rename" })).status === 403, "7 the COO cannot edit a role");

    /* 8 protected and code roles stay put - on the server and in the database */
    for (const k of ["ceo", "super_admin", "agent", "hr_admin", "editor"]) {
      ok((await rl(ID.ceo, "PATCH", `/${k}`, { tabs: [] })).status === 409, `8 ${k} is not changed through the roles door`);
      ok((await rl(ID.super_admin, "POST", `/${k}/delete`)).status === 409, `8 ${k} is not deleted`);
    }
    ok(dbRefuses(`DELETE FROM roles WHERE key = 'ceo'`) && dbRefuses(`DELETE FROM roles WHERE key = 'hr_admin'`), "8 the database will not delete a code role");
    ok(dbRefuses(`UPDATE roles SET name = 'Boss' WHERE key = 'ceo'`), "8 the database will not rename a protected role");
    ok(dbRefuses(`UPDATE roles SET key = 'r_x' WHERE key = 'r_warehouse_clerk'`) && dbRefuses(`UPDATE roles SET kind = 'protected' WHERE key = 'r_warehouse_clerk'`), "8 a key and its kind never change");
    ok(dbRefuses(`INSERT INTO roles (key, name, kind) VALUES ('warehouse', 'Bare Key', 'own')`) && dbRefuses(`INSERT INTO roles (key, name, kind) VALUES ('r_fake', 'Fake Code', 'builtin')`), "8 an own role is r_ and only an own role is r_");
    ok(dbRefuses(`DELETE FROM roles WHERE key = (SELECT role FROM users WHERE id = 1)`), "8 the database will not delete a role somebody holds");

    /* 9 delete: its cells go with it, the history stays */
    const d1 = await rl(ID.ceo, "POST", "/r_warehouse_clerk/delete");
    ok(d1.status === 200 && !row("r_warehouse_clerk") && !Object.values(rawCells()).some((v) => v.includes("r_warehouse_clerk")), "9 delete removes the role and strips its column from every cell", JSON.stringify(d1.j));
    ok(lastAudit("role.delete")?.key === "r_warehouse_clerk" && auditN("role.create") >= 3 && auditN("role.update") >= 1, "9 the delete is audited and the earlier history stays");
    ok((await rl(ID.ceo, "POST", "/r_warehouse_clerk/delete")).status === 404, "9 a deleted role is gone");
    ok((await rl(ID.coo, "POST", `/${fs}/delete`)).status === 403 && !!row(fs), "9 the COO cannot delete a role");

    /* 10 the custom roles of 1.350.0 still work on their base role */
    const cr1 = await call("/staff/access/custom-roles", ID.ceo, "POST", { name: "Inventory Clerk", base_role: "editor", reason: R, totp: code() });
    ok(cr1.status === 201 && (await call(`/staff/users/23/role`, ID.ceo, "POST", { role: cr1.j?.key, reason: R, totp: code() })).status === 200, "10 a 1.350.0 custom role is still created and given", JSON.stringify(cr1.j));
    ok((await rl(ID.ceo, "POST", "", { name: "Inventory Clerk" })).status === 409, "10 an own role cannot take a custom role's name");

    /* ---- STAGE 2 (v1.356.0): pages and staff counts read the role ---- */
    const sp = await rl(ID.ceo, "POST", "", { name: "Packing Crew", tabs: ["Inventory", "Tasks"] });
    const so = await rl(ID.ceo, "POST", "", { name: "Outside Helper", tabs: ["Tasks"], counts_as_staff: false });
    ok(sp.status === 201 && so.status === 201, "11 two own roles: one staff, one not", JSON.stringify([sp.j, so.j]));
    /* a person who holds each - written past users.role's CHECK, as stage 3 will allow */
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents) VALUES
      (30,'Pack One','pack1@a2z.test','${sp.j.key}',1,'x',1,'${SECRET}',150000), (31,'Out One','out1@a2z.test','${so.j.key}',1,'x',1,'${SECRET}',0), (32,'Pack Nofa','pack2@a2z.test','${sp.j.key}',1,'x',0,NULL,0)`);
    db.exec("PRAGMA ignore_check_constraints = OFF");
    for (const id of [30, 31, 32]) { tok[id] = `t-${id}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id); }
    /* pages: each person gets their own role's list, and only theirs; a code role gets none */
    const t30 = (await call("/staff/tabs/access", 30)).j;
    ok(Object.keys(t30?.role_tabs ?? {}).join() === sp.j.key && [...(t30.role_tabs[sp.j.key] ?? [])].sort().join() === "Inventory,Tasks", "12 R-5: a holder gets exactly their own role's pages", JSON.stringify(t30?.role_tabs));
    ok(JSON.stringify((await call("/staff/tabs/access", ID.editor)).j?.role_tabs) === "{}", "12 a code role gets no list (its rules stay)");
    const rv = (await call("/staff/access/review", ID.ceo)).j;
    const pr = (rv?.people ?? []).find((x) => x.id === 30);
    ok(pr && pr.tabs.includes("Inventory") && pr.tabs.includes("Tasks") && !pr.tabs.includes("Payroll") && pr.tabs.includes("Dashboard"), "12 the access review reads the same list (plus the pages every role sees)", JSON.stringify(pr));
    await rl(ID.ceo, "PATCH", `/${sp.j.key}`, { tabs: ["Tasks"] });
    ok(JSON.stringify((await call("/staff/tabs/access", 30)).j?.role_tabs?.[sp.j.key]) === JSON.stringify(["Tasks"]), "12 changing the role's pages changes what its holders get");
    /* staff counts (R-4): on = in the staff lists, off = out of them */
    const sl = (await call("/staff/staff-list", ID.ceo)).j?.staff ?? [];
    ok(sl.some((x) => x.id === 30) && !sl.some((x) => x.id === 31), "13 R-4: the staff list holds the staff role's person, not the outside one", JSON.stringify(sl.map((x) => x.id)));
    const mon = (await call("/staff/attendance/monitor", ID.ceo)).j;
    const monIds = JSON.stringify(mon).match(/"user_id":(\d+)|"id":(\d+)/g)?.join() ?? "";
    ok(/\b30\b/.test(monIds) && !/\b31\b/.test(monIds), "13 the attendance monitor counts the staff role's person, not the outside one", monIds.slice(0, 200));
    await rl(ID.ceo, "PATCH", `/${so.j.key}`, { counts_as_staff: true });
    ok(((await call("/staff/staff-list", ID.ceo)).j?.staff ?? []).some((x) => x.id === 31), "13 turning the switch on brings its people into the staff lists");
    await rl(ID.ceo, "PATCH", `/${so.j.key}`, { counts_as_staff: false });
    ok(!((await call("/staff/staff-list", ID.ceo)).j?.staff ?? []).some((x) => x.id === 31), "13 ...and off takes them out");
    /* 2FA: an own role is held to it like every staff role */
    ok((await call("/auth/me", 32)).j?.user?.requires_2fa === true && (await call("/auth/me", 30)).j?.user?.requires_2fa === false, "14 a holder without 2FA must set it up; with it, is through");
    /* a held role cannot be deleted */
    ok((await rl(ID.ceo, "POST", `/${sp.j.key}/delete`)).status === 409 && !!row(sp.j.key), "14 a role somebody holds is not deleted");
    /* one source: every staff list in the worker carries the switch */
    const srcs = readdirSync(join(root, "worker/src")).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(root, "worker/src", f), "utf8")]);
    const bare = [];
    for (const [f, src] of srcs) for (const m of src.matchAll(/((?:\$\{\w+\}|\b[a-z]\w*\.)?)role NOT IN \(('[a-z_]+'(?:\s*,\s*'[a-z_]+')*)\)/g)) {
      if (!/'customer'|'agent'/.test(m[2])) continue;
      if (!src.slice(m.index + m[0].length, m.index + m[0].length + 140).includes(`${m[1]}role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`)) bare.push(`${f}: ${m[0]}`);
    }
    ok(bare.length === 0, "15 one source: every staff list carries the counts-as-staff switch", bare.slice(0, 5).join(" | "));
    ok((readFileSync(join(root, "worker/src/staff.ts"), "utf8").match(/OR u\.role IN \(SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 1\)\)/g) ?? []).length === 3, "15 the three named staff lists take in the staff own roles");

    /* ---- STAGE 3 (v1.358.0): approvals by the Organisation chart (R-3), assignment, conversion ---- */
    const fc = await rl(ID.ceo, "POST", "", { name: "Field Crew", tabs: ["Claims", "Tasks"], copy_from: "marketing" });
    db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, totp_enabled, totp_secret, base_salary_cents, reports_to) VALUES
      (33,'Field One','field1@a2z.test','marketing',1,'x',1,'${SECRET}',150000,22), (34,'Field Two','field2@a2z.test','marketing',1,'x',1,'${SECRET}',150000,1)`);
    for (const id of [33, 34]) { tok[id] = `t-${id}`; db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(tok[id]).digest("hex"), id); }
    for (const id of [33, 34]) ok((await call(`/staff/users/${id}/role`, ID.ceo, "POST", { role: fc.j?.key, reason: R, totp: code() })).status === 200, `16 person ${id} is given Field Crew`);
    db.exec(`UPDATE users SET reports_to = 1 WHERE id = 22`); // the manager is on the chart under the CEO
    let kn = 0; const ck = () => `rolesv2-claim-key-${String(++kn).padStart(4, "0")}`;
    const lc1 = await call("/staff/claims", 33, "POST", { claim_date: "2026-11-16", amount: 25, purpose: "Advance for travel", claim_type: "salary_advance", payroll_month: "2026-12", submission_key: ck() });
    const lc1id = lc1.j?.id ?? db.prepare(`SELECT MAX(id) AS id FROM claims WHERE user_id = 33`).get().id;
    const lc1row = db.prepare(`SELECT * FROM claims WHERE id = ?`).get(lc1id);
    ok(lc1.status < 300 && lc1row?.line_approver_id === 22, "16 R-3: the claim waits on the claimant's manager on the Organisation chart, fixed on the claim", JSON.stringify([lc1.status, lc1.j, lc1row?.line_approver_id]));
    const lc2 = await call("/staff/claims", 34, "POST", { claim_date: "2026-11-16", amount: 30, purpose: "Parking at the client", submission_key: ck() });
    const lc2row = db.prepare(`SELECT * FROM claims WHERE user_id = 34 ORDER BY id DESC LIMIT 1`).get();
    ok(lc2.status < 300 && lc2row?.line_approver_id === null, "16 a person who reports to the CEO goes straight to the CEO", JSON.stringify([lc2.status, lc2row?.line_approver_id]));
    const mine22 = (await call("/staff/claims", 22)).j;
    const lseen = (mine22?.claims ?? mine22?.rows ?? (Array.isArray(mine22) ? mine22 : [])).find((x) => x.id === lc1id);
    ok(lseen && lseen.waiting_on === "manager" && lseen.my_turn === true && (lseen.actions ?? []).includes("preapprove"), "16 the manager reads it, it is their turn, and pre-approve is offered", JSON.stringify(lseen ? { w: lseen.waiting_on, t: lseen.my_turn, a: lseen.actions } : mine22).slice(0, 300));
    const desk22 = JSON.stringify((await call("/staff/desk", 22)).j ?? {});
    ok(desk22.includes(`claim:${lc1id}`), "16 the manager's Desk lists it");
    ok(!JSON.stringify((await call("/staff/desk", ID.coo)).j ?? {}).includes(`claim:${lc1id}`), "16 the COO's Desk does not (it is not theirs)");
    ok((await call(`/staff/claims/${lc1id}/preapprove`, ID.coo, "POST", {})).status === 403, "17 the COO cannot pre-approve it - only the named manager");
    ok((await call(`/staff/claims/${lc1id}/preapprove`, 23, "POST", {})).status === 403, "17 nor another member of staff");
    const learly = await call(`/staff/claims/${lc1id}/decide`, ID.ceo, "POST", { action: "approve", totp: code() });
    ok(learly.status === 400 && learly.j?.error?.code === "reason_required", "17 the CEO approving before the manager states why (an override)", JSON.stringify(learly.j));
    const lpre = await call(`/staff/claims/${lc1id}/preapprove`, 22, "POST", {});
    ok(lpre.status === 200 && db.prepare(`SELECT pre_approved_by FROM claims WHERE id = ?`).get(lc1id).pre_approved_by === 22, "17 the manager pre-approves", JSON.stringify(lpre.j));
    const ceoQ = (await call("/staff/claims", ID.ceo)).j;
    const atCeo = (ceoQ?.claims ?? ceoQ?.rows ?? (Array.isArray(ceoQ) ? ceoQ : [])).find((x) => x.id === lc1id);
    ok(atCeo && atCeo.waiting_on === "ceo", "17 then it waits on the CEO, the final step", JSON.stringify(atCeo?.waiting_on));
    /* 18 HR review is a permission (claims_hr_review), not a role name */
    const hrCap = (await policy(ID.ceo)).actions.find((a) => a.cap === "claims_hr_review");
    ok(hrCap && (hrCap.roles ?? []).includes("hr_admin"), "18 HR review of staff claims is a switch in the matrix, on for HR", JSON.stringify(hrCap));
    /* 19 "Make it your own role": a 1.350.0 custom role, its cells and its holders, in one step */
    const crKey = cr1.j?.key; const crId = cr1.j?.id;
    const crCells = Object.entries(rawCells()).filter(([, v]) => v.includes(crKey)).map(([k]) => k);
    ok((await call(`/staff/access/custom-roles/${crId}/convert`, ID.coo, "POST", { reason: R, totp: code() })).status === 403, "19 the COO cannot convert a custom role");
    const lcv = await call(`/staff/access/custom-roles/${crId}/convert`, ID.ceo, "POST", { name: "Stock Keeper", reason: R, totp: code() });
    const lnk = lcv.j?.key;
    const u23 = db.prepare(`SELECT role, custom_role_id FROM users WHERE id = 23`).get();
    ok(lcv.status === 200 && lnk && u23.role === lnk && u23.custom_role_id === null, "19 the holder moves onto the new own role", JSON.stringify([lcv.j, u23]));
    ok(crCells.length > 0 && crCells.every((k) => (rawCells()[k] ?? []).includes(lnk)), "19 every cell of the custom role is the new role's", JSON.stringify(crCells));
    ok(row(lnk)?.kind === "own" && JSON.parse(row(lnk).tabs).length > 0 && db.prepare(`SELECT active FROM custom_roles WHERE id = ?`).get(crId).active === 0, "19 it has its base role's pages; the custom role is deactivated, not deleted");
    ok(lastAudit("role.convert")?.to === lnk, "19 the conversion is audited");
    /* 20 the 0209 rebuild: every column kept, the role checked against the roles table, not a fixed list */
    const lcols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
    ok(["custom_role_id", "recovery_rotation_required", "reports_to", "totp_secret", "google_sub"].every((c) => lcols.includes(c)), "20 the users rebuild kept every column", lcols.join());
    ok(!/CHECK\s*\(\s*role/i.test(db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'users'`).get().sql), "20 users.role has no fixed list any more");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const dir = mkdtempSync(join(tmpdir(), "roles-v2-"));
bundle(root, join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const MUT = [
  ["worker/src/staff.ts", "anybody manages roles", '    if (!allows(user, "role_custom")) return err("forbidden", "Only the CEO and the super admin manage roles.", 403);', ""],
  ["worker/src/staff.ts", "the code is skipped on create", 'const su = await requireFreshTotp(env, user, body?.totp, err, "create a role");', "const su = null;"],
  ["worker/src/staff.ts", "a code role is changed through the roles door", '    if (cur && cur.kind !== "own") return err("role_protected",', '    if (false) return err("role_protected",'],
  ["worker/src/staff.ts", "a copy takes a protected capability", "          if (CUSTOM_FORBIDDEN.has(String(cap))) continue;\n          const now = (rec.perms[cap] ?? PERMS[cap]!) as readonly string[];\n          if (!now.includes(from)) continue;\n          rec.perms[cap] = [...now, nk]", "          const now = (rec.perms[cap] ?? PERMS[cap]!) as readonly string[];\n          if (!now.includes(from)) continue;\n          rec.perms[cap] = [...now, nk]"],
  ["worker/src/staff.ts", "anyone who may change a staff role gives an own role", '      if (!allows(user, "role_custom")) return err("forbidden", "Only the CEO and the super admin give a role they made.", 403);', ""],
  ["worker/src/staff.ts", "a claim from an own role skips the manager", "if (sup && sup.id !== user.id && sup.role !== \"ceo\") lineApprover = sup.id;", "if (sup && false) lineApprover = sup.id;"],
  ["worker/src/staff.ts", "anyone pre-approves a line claim", '      if (user.id !== Number(cp.line_approver_id)) return err("forbidden",', '      if (false) return err("forbidden",'],
  ["worker/src/staff.ts", "the CEO skips the manager silently", '(row.payee_user_id === row.line_approver_id ? waived : skipped).push("manager pre-approval");', 'waived.push("manager pre-approval");'],
  ["worker/src/desk.ts", "the Desk hides a line claim from its manager", '  if (chain === "line") return claim.line_approver_id && claim.line_approver_id === viewer.id && !claim.pre_approved_at ? "pre_approve" : null;', ''],
  ["worker/src/staff.ts", "conversion leaves the holders behind", "        env.DB.prepare(`UPDATE users SET role = ?1, custom_role_id = NULL WHERE custom_role_id = ?2`).bind(nk, cur.id),", ""],
  ["worker/src/staff.ts", "an own role's column is not a known role on save", "    const crKeys = await extraRoleKeys(env); // v1.355.0", "    const crKeys = await customRoleKeys(env); // v1.355.0"],
  ["worker/src/staff.ts", "delete leaves the cells behind", "      for (const cap of Object.keys(rec.perms)) {\n        const v = rec.perms[cap]!;\n        if (!v.includes(cur.key as Role)) continue;\n        cells++;", "      for (const cap of [] as string[]) {\n        const v = rec.perms[cap]!;\n        if (!v.includes(cur.key as Role)) continue;\n        cells++;"],
  ["worker/src/staff.ts", "a page outside the portal is accepted", "      if (ask.some((t) => !ROLE_TAB_CHOICES.includes(t))) return \"bad\";", ""],
  ["worker/src/permissions.ts", "an own role on a protected cell is kept", "(isExtraKey(r) && !CUSTOM_FORBIDDEN.has(k))", "(isExtraKey(r))"],
  ["lib/portal-tabs.ts", "an own role sees the code rules instead of its list", "  if (OWN_ROLE_RE.test(role)) return (ROLE_TABS[role] ?? []).includes(tab);", ""],
  ["worker/src/staff.ts", "a person is not handed their role's pages", "role_tabs: myRoleTabs, role_names", "role_tabs: {}, role_names"],
  ["worker/src/staff.ts", "the staff list ignores the switch", "(u.role NOT IN ('customer', 'super_admin', 'admin') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0))\n         AND u.role != 'agent'", "(u.role NOT IN ('customer', 'super_admin', 'admin'))\n         AND u.role != 'agent'"],
  ["worker/src/permissions.ts", "an own role skips 2FA", "|| isOwnKey(role); }", "; }"],
  ["worker/src/staff.ts", "creation is not audited", '      await audit(env, user.id, "role.create", "roles"', '      if (0) await audit(env, user.id, "role.create", "roles"'],
];
for (const [file, name, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  n++;
  const src = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "roles-v2-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src.replace(from, to));
  try { bundle(mdir, join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
if (fail) { console.error(`roles-v2: ${fail} of ${n} failed`); process.exit(1); }
console.log(`roles-v2: ${checks} checks passed (${process.env.NOMUT === "1" ? "mutations skipped" : `${MUT.length} mutations caught`}) - stage 3: an own role is given through the role door and its claims wait on the chart manager before the CEO; stage 2: a holder's sidebar is their own role's page list and every staff list obeys its staff switch (2FA always); stage 1: the CEO and the super admin create, edit and delete their own roles with no base role (pages, staff switch, blank or copied cells), protected and code roles stay put on the server and in the database`);
