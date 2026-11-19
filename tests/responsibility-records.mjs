/* v1.388.0 - POSITION & RESPONSIBILITIES AS RECORDS (the CEO, 19-11-2026,
 * migration 0215, worker/src/responsibilities.ts). Runs the real worker
 * against every migration on node:sqlite:
 *
 *   R1  the conversion: each line written before 0215 becomes one item, in
 *       order, cleaned; the first five Key, none Public; the old text is kept
 *   R2  every reader takes the list from the records: GET /users builds the old
 *       text and the items from them, GET /profile the text
 *   R3  a person's list: responsibilities_edit only (the COO and the CCO are
 *       refused), working staff only, at most 5 Key and 30 items, audited
 *       before and after
 *   R4  NEVER OVERWRITTEN WITHOUT CONFIRMATION: a save names the version it
 *       started from; a stale version is refused (409 changed) and nothing
 *       changes; two saves from one version - the second is refused
 *   R5  templates: the CEO, the Super Admin, the COO and the CCO keep them
 *       (HR is refused); a person's list is a copy - editing either never
 *       changes the other
 *   R6  the portfolio: one shape (photo, name, position as the title,
 *       department, staff ID, up to 5 key, all, the public ones), read by the
 *       person or HR / an executive, refused to anyone else
 *   R7  the position stays the staff record's text and no access level moves
 *   R8  the screen: the one KPI strip, compact collapsible departments with
 *       Staff / Position / Responsibilities / Status / Actions, View more, the
 *       ONE editor drawer for both tabs, templates only for their keepers
 *
 *   node tests/responsibility-records.mjs
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => readFileSync(join(root, f), "utf8");
const res = [];
const ok = (c, m, why = "") => res.push([!!c, why && !c ? `${m} - ${why}` : m]);

/* ---------- the database: every migration before 0215, the old text, then 0215 ---------- */
const db = new DatabaseSync(":memory:");
const run = (f) => { for (const st of read(`worker/migrations/${f}`).split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } } };
const migs = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
for (const f of migs.filter((x) => x < "0215")) run(f);
db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash, position, department, employee_id, photo_key) VALUES
  (1,'Boss','b@x.t','ceo',1,'x','Chief Executive Officer','Management','AZ00A001','p/boss.jpg'),
  (2,'Ops','o@x.t','coo',1,'x',NULL,'Management',NULL,NULL),
  (3,'Comm','c@x.t','cco',1,'x',NULL,'Management',NULL,NULL),
  (4,'Aina','a@x.t','sales_marketing',1,'x','Sales Executive','Sales and Marketing','AZ00A002','p/aina.jpg'),
  (5,'Tech','t@x.t','super_admin',1,'x',NULL,NULL,NULL,NULL),
  (6,'Hana','h@x.t','hr_admin',1,'x','HR Executive','HR and Admin','AZ00A007',NULL),
  (7,'Host','l@x.t','live_host',1,'x','Live Host','Sales and Marketing','AZ00A008',NULL),
  (8,'Gone','g@x.t','sales_marketing',0,'x','Sales Executive','Sales and Marketing','AZ00A009',NULL)`);
db.exec(`UPDATE users SET responsibilities = '- Drive sales' || char(13) || char(10) || char(10) || '• Manage enquiries  ' || char(10) || '* Prepare quotations' || char(10) || 'Follow up' || char(10) || 'Report weekly' || char(10) || 'Keep the CRM', responsibilities_updated_by = 1 WHERE id = 4`);
db.exec(`UPDATE users SET responsibilities = 'Host live sessions' WHERE id = 7`);
db.exec(`INSERT INTO staff_positions (id, name, access_role, department) VALUES (10, 'Sales Executive', 'sales_marketing', 'Sales and Marketing'), (11, 'Live Host', 'live_host', 'Sales and Marketing')`);
const before4 = db.prepare(`SELECT responsibilities FROM users WHERE id = 4`).get().responsibilities;
for (const f of migs.filter((x) => x >= "0215")) run(f);

/* R1 */
const conv = db.prepare(`SELECT text, is_key, is_public, sort_order FROM staff_responsibilities WHERE user_id = 4 ORDER BY sort_order`).all();
ok(JSON.stringify(conv.map((r) => r.text)) === JSON.stringify(["Drive sales", "Manage enquiries", "Prepare quotations", "Follow up", "Report weekly", "Keep the CRM"]),
  "R1: each line became one item, in order, bullets / blanks / spaces / carriage returns cleaned", JSON.stringify(conv.map((r) => r.text)));
ok(conv.map((r) => r.is_key).join("") === "111110" && conv.every((r) => r.is_public === 0), "R1: the first five are Key, none is Public (the CEO's answer)");
ok(db.prepare(`SELECT responsibilities FROM users WHERE id = 4`).get().responsibilities === before4, "R1: the old text is kept untouched");
ok(db.prepare(`SELECT COUNT(*) AS n FROM staff_responsibilities WHERE user_id IN (1, 2, 3, 5, 6)`).get().n === 0, "R1: nobody gets an item they never had");
const mig = read("worker/migrations/0215_responsibility_items.sql").replace(/^--.*$/gm, "");
ok(!/\b(DROP|DELETE|UPDATE|ALTER TABLE users)\b/i.test(mig), "R1: 0215 is additive - no drop, delete, update or change to users");

/* R8 - the screen (static) */
const dir = read("components/staff/staff-directory.tsx");
const blk = read("components/staff/responsibilities.tsx");
const zone = dir.slice(dir.indexOf("DEPARTMENTS & ROLES ====="), dir.indexOf("STAFF RECORDS ====="));
ok(/<KpiRow label=\{L\("Positions and responsibilities"/.test(zone) && (zone.match(/<KpiTile /g) ?? []).length === 6 && !/<KpiTile[^>]*\bvalue=\{\d+\}/.test(zone), "R8: the figures are the one KPI strip, six tiles, none typed");
ok(["Staff", "Position", "Responsibilities", "Status"].every((h) => zone.includes(`<th>{L("${h}"`)) && /<th><span className=\{sp\.srOnly\}>\{L\("Actions"/.test(zone), "R8: the table is Staff, Position, Responsibilities, Status, Actions");
ok(/aria-expanded=\{isOpen\}/.test(zone) && /data-testid="roles-expand"/.test(zone) && /data-testid="roles-collapse"/.test(zone) && /\{isOpen && \(/.test(zone), "R8: each department collapses; Expand all / Collapse all");
ok(/data-testid="roles-search"/.test(zone) && /data-testid="roles-dept"/.test(zone) && /<PillSwitch testid="roles-filter"/.test(zone), "R8: search, a department and a status");
ok(/className=\{sp\.respText\} title=\{sum\.line\}/.test(zone) && /data-testid="roles-more"/.test(zone) && /text-overflow: ellipsis/.test(read("components/staff/staff-page.module.css")), "R8: the key responsibilities on one line, truncated, with View more");
ok(/<ResponsibilitiesDrawer open=\{respFor !== null\}/.test(zone) && /<ResponsibilitiesDrawer open=\{editing\}/.test(blk) && (dir.match(/<ResponsibilitiesBlock /g) ?? []).length === 1,
  "R8: Departments & Roles and Staff Records open the SAME editor drawer");
ok(/holds\("responsibility_templates", \["super_admin", "ceo", "coo", "cco"\]\.includes\(role\)\) && \(/.test(zone) && /<TemplatesDrawer open=\{tplOpen\}/.test(zone), "R8: the templates button only for their keepers (the server refuses the rest)");
ok(/data-testid="roles-edit"/.test(zone) && /canEditResponsibilities && Boolean\(u\.is_active\) && !isGone\(u\) && \(/.test(zone), "R8: Edit responsibilities only for the HR tier, on working staff");
ok(/if \(rows\.some\(\(r\) => r\.text\.trim\(\)\) && !\(await confirm\(\{/.test(blk) && /r\.data\?\.error\?\.code === "changed"/.test(blk) && /await load\(userId\);/.test(blk), "R8: replacing a list with a template asks first; a 'changed' refusal reloads and says so");
ok(/dirty=\{dirty\}/.test(blk), "R8: closing the editor with unsaved changes asks first");
ok(!/#[0-9a-fA-F]{3,6}\b/.test(read("components/staff/responsibilities.module.css")) && !/className="(?:[^"]* )?(?:mt-\d|flex|grid|text-sm|gap-\d)(?: [^"]*)?"/.test(blk), "R8: tokens and shared classes only, no colour and no utility class");
ok(/`\/staff\/portfolio\/\$\{userId\}`/.test(blk) && /keyResponsibilities\(items\)/.test(blk), "R8: the portfolio card reads the one portfolio route; a list summary uses the server's own key rule");

/* ---------- the real worker ---------- */
const out = join(mkdtempSync(join(tmpdir(), "resprec-")), "staff.mjs");
execSync(`npx esbuild "${join(root, "worker/src/staff.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
  bind: (...a) => { b = a.map((x) => (x === undefined ? null : typeof x === "boolean" ? Number(x) : x)); return o; },
  first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
  run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }),
  _do: () => (/^\s*SELECT/i.test(sql) ? { results: st.all(...b) } : { results: [], meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
let hold = null; // R4: hold a batch so a second save can start from the same version
const env = { DB: { prepare: shim, batch: async (list) => {
  if (hold) { const h = hold; hold = null; await h(); }
  db.exec("BEGIN"); try { const r = list.map((s) => s._do()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
} } };
const ROLE = { 1: "ceo", 2: "coo", 3: "cco", 4: "sales_marketing", 5: "super_admin", 6: "hr_admin", 7: "live_host" };
const { handleStaff } = await import(pathToFileURL(out).href);
const call = async (p, id = 1, method = "GET", body) => {
  const r = await handleStaff(new Request(`https://x/api/v1/staff${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, p.split("?")[0], { id, role: ROLE[id], name: `u${id}`, is_owner: id === 1 });
  return { status: r?.status ?? 404, j: r ? await r.json().catch(() => null) : null };
};
const list = (uid) => db.prepare(`SELECT text, is_key, is_public FROM staff_responsibilities WHERE user_id = ? ORDER BY sort_order, id`).all(uid);

try {
  /* R2 */
  const users = await call("/users", 1);
  const aina = users.j?.users?.find((u) => u.id === 4);
  ok(users.status === 200 && aina?.responsibilities === conv.map((r) => r.text).join("\n"), "R2: GET /users builds the old text from the records, in order", JSON.stringify(aina?.responsibilities));
  ok(Array.isArray(aina?.responsibility_items) && aina.responsibility_items.length === 6 && aina.responsibility_items[0].text === "Drive sales" && aina.responsibility_items[0].is_key === 1,
    "R2: GET /users carries each item with its flags, parsed", JSON.stringify(aina?.responsibility_items)?.slice(0, 120));
  ok(users.j?.users?.find((u) => u.id === 1)?.responsibility_items?.length === 0, "R2: a person with none has an empty list, never a made-up one");
  const prof = await call("/profile", 4);
  ok(prof.j?.profile?.responsibilities === aina.responsibilities, "R2: GET /profile reads the same list");

  /* R3 */
  const got = await call("/users/4/responsibilities", 6);
  ok(got.status === 200 && got.j?.items?.length === 6 && got.j?.version && got.j?.can_edit === true && got.j?.template?.position_id === 10, "R3: HR reads the list, its version, and the template of the person's position", JSON.stringify(got.j)?.slice(0, 160));
  for (const id of [2, 3, 7]) {
    const r = await call("/users/4/responsibilities", id, "PUT", { items: [{ text: "x" }], version: got.j.version });
    ok(r.status === 403, `R3: the ${ROLE[id]} may not write a person's list (403)`, String(r.status));
  }
  ok((await call("/users/7/responsibilities", 2)).status === 200, "R3: the COO may read it (an executive)");
  ok((await call("/users/4/responsibilities", 7)).status === 403, "R3: a live host may not read somebody else's");
  ok((await call("/users/7/responsibilities", 7)).status === 200, "R3: but reads their own");
  const six = Array.from({ length: 6 }, (_, i) => ({ text: `Item ${i + 1}`, is_key: true }));
  ok((await call("/users/4/responsibilities", 6, "PUT", { items: six, version: got.j.version })).status === 400, "R3: six Key items are refused - the card shows five");
  ok((await call("/users/4/responsibilities", 6, "PUT", { items: Array.from({ length: 31 }, (_, i) => `L${i}`), version: got.j.version })).status === 400, "R3: thirty-one items are refused");
  ok((await call("/users/8/responsibilities", 6, "PUT", { items: [], version: "0:0" })).status === 409, "R3: a leaver's list is not written (409)");
  ok(JSON.stringify(list(4).map((r) => r.text)) === JSON.stringify(conv.map((r) => r.text)), "R3: none of those refusals changed anything");
  const save = await call("/users/4/responsibilities", 6, "PUT", { role_title: "Senior", version: got.j.version, items: [
    { text: "Close deals", is_key: true, is_public: true, template_position_id: 10 }, { text: "  - Train juniors ", is_key: true }, { text: "" }, { text: "Keep the CRM" }] });
  ok(save.status === 200 && JSON.stringify(list(4)) === JSON.stringify([{ text: "Close deals", is_key: 1, is_public: 1 }, { text: "Train juniors", is_key: 1, is_public: 0 }, { text: "Keep the CRM", is_key: 0, is_public: 0 }]),
    "R3: a save replaces the list whole, cleaned, with its flags", JSON.stringify([save.status, list(4)]));
  const au = db.prepare(`SELECT detail FROM audit_log WHERE action = 'staff.responsibilities_update' ORDER BY id DESC LIMIT 1`).get();
  ok(au && /Drive sales/.test(au.detail) && /\[key\] \[public\] Close deals/.test(au.detail), "R3: audited, with the list before and after (and the flags)");
  ok(db.prepare(`SELECT role_title, responsibilities_updated_by FROM users WHERE id = 4`).get().responsibilities_updated_by === 6, "R3: who wrote it is stamped on the record");

  /* R4 */
  const stale = await call("/users/4/responsibilities", 1, "PUT", { items: [{ text: "Overwrite!" }], version: got.j.version });
  ok(stale.status === 409 && stale.j?.error?.code === "changed" && list(4)[0].text === "Close deals", "R4: a save from an old version is refused (409 changed) and nothing changes", JSON.stringify(stale.j));
  ok((await call("/users/4/responsibilities", 1, "PUT", { items: [{ text: "No version" }] })).status === 409, "R4: a save that names no version is refused too");
  const v = (await call("/users/4/responsibilities", 1)).j.version;
  let second;
  hold = async () => { second = await call("/users/4/responsibilities", 6, "PUT", { items: [{ text: "Second" }], version: v }); };
  const first = await call("/users/4/responsibilities", 1, "PUT", { items: [{ text: "First" }, { text: "First b" }], version: v });
  ok([first.status, second?.status].sort().join(",") === "200,409" && list(4).every((r) => r.text !== "Second" || list(4).length === 1) && !(list(4).some((r) => r.text === "Second") && list(4).some((r) => r.text === "First")),
    "R4: two saves from one version - one is written, the other refused; the lists never stack", JSON.stringify([first.status, second?.status, list(4).map((r) => r.text)]));

  /* R5 */
  const tg = await call("/responsibilities/templates", 7);
  const sx = tg.j?.templates?.find((t) => t.position_id === 10);
  ok(tg.status === 200 && sx && sx.items.length === 0 && tg.j.can_manage === false, "R5: every staff member reads the templates; a live host may not keep them");
  for (const id of [6, 7, 4]) ok((await call("/responsibilities/templates/10", id, "PUT", { items: ["a"], version: sx.version })).status === 403, `R5: the ${ROLE[id]} may not change a template (403)`);
  const before = JSON.stringify(list(4));
  for (const id of [1, 5, 2, 3]) {
    const cur = (await call("/responsibilities/templates", id)).j.templates.find((t) => t.position_id === 10);
    const r = await call("/responsibilities/templates/10", id, "PUT", { items: ["Drive monthly sales", "Answer enquiries", `Kept by ${ROLE[id]}`], version: cur.version });
    ok(r.status === 200 && r.j.items.length === 3, `R5: the ${ROLE[id]} keeps the templates`, JSON.stringify(r.j)?.slice(0, 120));
  }
  ok(JSON.stringify(list(4)) === before, "R5: changing a template never changes anybody's list");
  ok((await call("/responsibilities/templates/10", 1, "PUT", { items: ["x"], version: sx.version })).status === 409, "R5: a template saved from an old version is refused");
  const tplNow = db.prepare(`SELECT text FROM position_responsibility_templates WHERE position_id = 10 ORDER BY sort_order`).all().map((r) => r.text);
  const v4 = (await call("/users/4/responsibilities", 1)).j.version;
  await call("/users/4/responsibilities", 1, "PUT", { items: [{ text: "Drive monthly sales (ELFIA accounts)", template_position_id: 10, is_key: true }], version: v4 });
  ok(JSON.stringify(db.prepare(`SELECT text FROM position_responsibility_templates WHERE position_id = 10 ORDER BY sort_order`).all().map((r) => r.text)) === JSON.stringify(tplNow), "R5: customising a person's copy never changes the template");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'staff.responsibility_template_update'`).get().n === 4, "R5: every template change is audited");
  db.exec(`UPDATE staff_positions SET retired_at = datetime('now') WHERE id = 11`);
  ok((await call("/responsibilities/templates/11", 1, "PUT", { items: ["x"], version: "0:0" })).status === 409, "R5: a retired position's template is not changed");

  /* R6 */
  await call("/users/4/responsibilities", 1, "PUT", { version: (await call("/users/4/responsibilities", 1)).j.version, items: [
    { text: "A", is_key: false }, { text: "B", is_key: true, is_public: true }, { text: "C" }, { text: "D", is_public: true }] });
  const pf = await call("/portfolio/4", 1);
  const p = pf.j?.portfolio;
  ok(pf.status === 200 && p?.title === "Sales Executive" && p.position === "Sales Executive" && p.department === "Sales and Marketing" && p.staff_id === "AZ00A002" && p.photo_key === "p/aina.jpg" && p.name === "Aina",
    "R6: the portfolio reads photo, name, position (as the title), department and staff ID from the record", JSON.stringify(p)?.slice(0, 200));
  ok(JSON.stringify(p?.key) === '["B"]' && JSON.stringify(p?.responsibilities) === '["A","B","C","D"]' && JSON.stringify(p?.public) === '["B","D"]', "R6: key = the ones marked Key, all of them in order, public = the ones ticked", JSON.stringify([p?.key, p?.public]));
  await call("/users/4/responsibilities", 1, "PUT", { version: (await call("/users/4/responsibilities", 1)).j.version, items: ["1", "2", "3", "4", "5", "6", "7"].map((t) => ({ text: t })) });
  ok(JSON.stringify((await call("/portfolio/4", 1)).j?.portfolio?.key) === '["1","2","3","4","5"]', "R6: none marked Key - the compact card takes the first five");
  ok((await call("/portfolio/4", 7)).status === 403 && (await call("/portfolio/7", 7)).status === 200 && (await call("/portfolio/4", 2)).status === 200, "R6: read by the person, HR or an executive - nobody else");
  db.exec(`UPDATE users SET department = 'Marketing', position = 'Senior Sales Executive' WHERE id = 4`);
  const p2 = (await call("/portfolio/4", 1)).j?.portfolio;
  ok(p2?.department === "Marketing" && p2?.title === "Senior Sales Executive", "R6: change the staff record and the portfolio follows - nothing is copied");

  /* R7 */
  ok(db.prepare(`SELECT role FROM users WHERE id = 4`).get().role === "sales_marketing", "R7: no save moved anybody's access level");
  const src = read("worker/src/responsibilities.ts");
  ok(!/UPDATE users SET[^`]*\brole\s*=|UPDATE users SET[^`]*\bposition\s*=/.test(src) && !/UPDATE users SET[^`]*responsibilities\s*=/.test(src), "R7: the file never writes users.role, users.position, or the old text");
  const perms = read("worker/src/permissions.ts");
  ok(/responsibility_templates: \["super_admin", "ceo", "coo", "cco"\],/.test(perms) && /responsibilities_edit: \["super_admin", "admin", "hr_admin", "ceo"\],/.test(perms), "R7: templates are the CEO's four; a person's list keeps the HR tier");
} catch (e) {
  ok(false, "the run finished", String(e?.stack ?? e).slice(0, 400));
}

const failed = res.filter(([p]) => !p);
for (const [p, m] of res) if (!p) console.log(`  FAIL ${m}`);
console.log(`responsibility-records: ${res.length - failed.length}/${res.length} checks passed`);
process.exit(failed.length ? 1 : 0);
