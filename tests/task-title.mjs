/* v1.289.0 - EDIT TASK TITLE (the CEO, 12-11-2026, image 02: "edit the main
   Task Title without disrupting anything else"; claude/TASK-TITLE-BLUEPRINT.md,
   T1 a closed task is reopened first, T3 the other person is told). By direct
   request against the whole worker on SQLite with every migration applied.
   Invented people only. Each rule is also MUTATED.

     node tests/task-title.mjs        (NOMUT=1 skips the mutations) */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, entry, out) => execSync(`npx esbuild "${join(srcRoot, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4, 5, 6, 7, 8]);
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

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
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const store = new Map();
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: {
      put: async (key, body, opts) => { store.set(key, { buf: Buffer.from(await new Response(body).arrayBuffer()), ct: opts?.httpMetadata?.contentType }); },
      head: async () => null, get: async (key) => (store.has(key) ? { body: store.get(key).buf, httpMetadata: { contentType: store.get(key).ct } } : null),
      list: async () => ({ objects: [] }), delete: async () => {},
    },
  };
  /* invented people: 1 CEO, 2 super admin, 3 COO, 6 CCO, 7 HR, 9 and 15 sales, 21 an agent, 22 admin */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'JBSWY3DPEHPK3PXP'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'JBSWY3DPEHPK3PXP'), (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'JBSWY3DPEHPK3PXP'), (9,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'JBSWY3DPEHPK3PXP'), (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'JBSWY3DPEHPK3PXP'),
    (22,'Adm','Adm Person','adm@a2z.test','admin',1,'x',1,'JBSWY3DPEHPK3PXP')`);
  db.exec(`INSERT INTO customers (id, company, phone) VALUES (1, 'Existing Client One', '019-888 7777')`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 15, 21, 22]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid, ct = "application/json") => ({ "content-type": ct, origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* a file */ }
    return { status: r.status, j, text };
  };
  const upload = async (caseId, uid, kind) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff/fa/cases/${caseId}/documents?kind=${kind}&date=2026-11-10`, { method: "POST", headers: { ...hdr(uid, "image/png"), "content-length": String(PNG.length) }, body: PNG }), env, { waitUntil() {} });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: r.status, j, text: t };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  const before = finance();

  const snap = (id) => JSON.stringify(Object.fromEntries(Object.entries(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id)).filter(([k]) => !["title", "updated_at"].includes(k))));
  const kids = (id) => ["task_items", "task_updates", "task_assistants", "task_files", "task_blocks"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t} WHERE task_id = ?`, id); } catch { return -1; } }).join(",");
  const title = (id) => db.prepare(`SELECT title FROM tasks WHERE id = ?`).get(id).title;
  try {
    const OLD = "Tugasan Mingguan (2/11-6/11)", NEW = "Tugasan Mingguan";
    const mk = await call("/tasks", 1, "POST", { title: OLD, assigned_to: 9, start_date: "2026-11-02", deadline: "2026-11-06", priority: "normal" });
    const tid = mk.j?.id;
    ok(mk.status < 300 && tid, "the CEO sets a task for a salesperson", mk.text);
    const twin = (await call("/tasks", 1, "POST", { title: OLD, assigned_to: 15, start_date: "2026-11-09", deadline: "2026-11-13" })).j?.id;
    for (const t of ["Sediakan pelan", "Kemas kini status", "Sediakan laporan"]) await call(`/tasks/${tid}/items`, 1, "POST", { title: t });
    await call(`/tasks/${tid}/assistants`, 1, "POST", { user_id: 15 });
    db.prepare(`INSERT INTO task_updates (task_id, author_id, kind, body) VALUES (?, 9, 'note', 'Laporan dalam draf akhir')`).run(tid);
    const s0 = snap(tid), k0 = kids(tid);
    ok(k0.split(",")[0] === "3" && k0.split(",")[2] === "1", "the task has its checklist, an update and a helper", k0);

    /* T: who may rename */
    const asst = await call(`/tasks/${tid}`, 15, "PATCH", { title: "Helper rename" });
    ok(asst.status === 403 && title(tid) === OLD, "a helper (assisting staff) cannot rename the task", asst.text);
    ok((await call(`/tasks/${tid}`, 21, "PATCH", { title: "Agent rename" })).status === 403 && title(tid) === OLD, "someone unrelated cannot rename it");
    ok((await call(`/tasks/${tid}`, 9, "PATCH", { title: "   " })).status === 400 && title(tid) === OLD, "an empty title is refused, not ignored");
    ok((await call(`/tasks/${tid}`, 9, "PATCH", { title: "x".repeat(201) })).status === 400, "a title over 200 characters is refused");

    /* the assignee renames: only the title moves */
    const n0 = n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1`);
    const r1 = await call(`/tasks/${tid}`, 9, "PATCH", { title: NEW });
    ok(r1.status === 200 && title(tid) === NEW, "the assignee renames the task in place", r1.text);
    ok(snap(tid) === s0, "the task id, dates, assignee, status, progress, priority and project link are unchanged", `${s0} vs ${snap(tid)}`);
    ok(kids(tid) === k0, "the checklist, updates, helpers, files and roster blocks are unchanged", `${k0} vs ${kids(tid)}`);
    ok(n(`SELECT COUNT(*) AS n FROM tasks`) === 2 && title(twin) === OLD, "no task is created, and another task with the same old title is untouched");
    const note = db.prepare(`SELECT message FROM notifications WHERE user_id = 1 ORDER BY id DESC LIMIT 1`).get();
    ok(n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1`) === n0 + 1 && note?.message.includes(OLD) && note.message.includes(NEW), "the person who set it is told the old and the new title (T3)", note?.message);
    const act = (await call(`/tasks/${tid}/activity`, 9)).j?.activity ?? [];
    const te = act.find((e) => e.kind === "task.title");
    ok(te && te.text.includes(`"${OLD}"`) && te.text.includes(`"${NEW}"`) && te.by, "Activity History: Title updated, old and new, with who and when", JSON.stringify(te));
    const au = db.prepare(`SELECT user_id, detail FROM audit_log WHERE action = 'task.update' AND entity_id = ? ORDER BY id DESC LIMIT 1`).get(String(tid));
    ok(au?.user_id === 9 && JSON.parse(au.detail).changed.title[0] === OLD, "the audit row keeps the old title and the editor");
    const list = (await call("/tasks", 9)).j;
    ok(JSON.stringify(list).includes(`"${NEW}"`) && !JSON.stringify(list).includes(`"${OLD}"`), "the assignee's task list shows the new title, not the old", JSON.stringify(list).slice(0, 200));
    const det = (await call(`/tasks/${tid}`, 9)).j;
    ok(det?.task?.title === NEW && det?.can?.edit === true, "the task's own record shows the new title and Edit for the assignee");
    ok((await call(`/tasks/${tid}`, 15)).j?.can?.edit === false, "the helper's record says no Edit");

    /* a manager renames: the assignee is told */
    const n9 = n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 9`);
    const r2 = await call(`/tasks/${tid}`, 3, "PATCH", { title: "Tugasan Mingguan - Laporan" });
    ok(r2.status === 200 && n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 9`) === n9 + 1, "a manager (COO) renames it and the assignee is told", r2.text);
    ok(snap(tid) === s0 && kids(tid) === k0, "still nothing else moved");

    /* T1: a closed task is reopened first */
    db.prepare(`UPDATE tasks SET status = 'completed' WHERE id = ?`).run(tid);
    const s1 = snap(tid);
    const r3 = await call(`/tasks/${tid}`, 1, "PATCH", { title: "After closing" });
    ok(r3.status === 409 && r3.j?.error?.code === "reopen_required" && title(tid) === "Tugasan Mingguan - Laporan", "a closed task cannot be renamed, even by the CEO - reopen it first (T1)", r3.text);
    ok((await call(`/tasks/${tid}`, 9, "PATCH", { deadline: "2026-11-20" })).status === 409 && snap(tid) === s1, "nor can its dates change while it is closed");
    ok((await call(`/tasks/${tid}`, 9)).j?.can?.edit === false, "the closed task's record offers no Edit");
  } catch (e) { ok(false, "the run threw", String(e?.stack ?? e)); }
  finally { globalThis.fetch = realFetch; db.close(); }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "ttl-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const S = "worker/src/staff.ts", P = "worker/src/tasks-progress.ts";
const MUT = [
  [S, "a closed task renamed", [['if (row.status === "completed") return err("reopen_required", "This task is closed', 'if (false) return err("reopen_required", "This task is closed']]],
  [S, "an empty title ignored", [['    if (typeof body?.title === "string" && body.title.trim() === "") return err(', '    if (false) return err(']]],
  [S, "nobody told", [['      if (to) await notify(env, to, "task", `✏ ${user.name} renamed a task', '      if (false) await notify(env, to, "task", `✏ ${user.name} renamed a task']]],
  [S, "a helper renames", [['    if (row.assigned_to !== user.id && !manages) {\n      return projGate ?? err("forbidden", "Not your task", 403);', '    if (false) {\n      return projGate ?? err("forbidden", "Not your task", 403);']]],
  [P, "no title entry in Activity", [['    if (d.changed?.title) add({ key: `a${r.id}t`', '    if (false) add({ key: `a${r.id}t`']]],
  [S, "the rename moves the dates", [['sets.push(`title = ?${sets.length + 1}`); vals.push(String(body!.title).trim());', 'sets.push(`title = ?${sets.length + 1}`); vals.push(String(body!.title).trim()); sets.push(`deadline = ?${sets.length + 1}`); vals.push(null);']]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "ttl-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`task-title: ${fail} of ${n} failed`); process.exit(1); }
console.log(`task-title: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - the title changes in place and nothing else moves; helpers and outsiders cannot rename; a closed task is reopened first; the other person is told; Activity keeps old and new`);
