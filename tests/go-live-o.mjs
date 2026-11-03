/* TASK CLOSURE & REOPEN (v1.256.0) - runtime guard: the WHOLE worker bundled
 * against SQLite with every migration applied (0169 included), by direct
 * request as each role. Fixed clock: Tuesday 03-11-2026, 12:00 Malaysia.
 *
 * The owner's "Task Progress Timeline 2.1, Status Updates, Closure & Reopen
 * Workflow", claude/TASK-CLOSURE-AUDIT.md and his "approved" (03-11-2026):
 * D1 a manager may close with deliverables open, with a reason (recorded as
 * an exception); D2 whoever may close a task reopens it, a cancelled one
 * only a manager; D3 migration 0169 adds closed / closed_with_exception /
 * reopened to the append-only progress record; D4 the old dropdown PATCH
 * no longer closes or reopens. The brief's tests A-I are named in each check.
 *
 *   node tests/go-live-o.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-o.mjs   a given bundle (the 1.255.0 bundle must FAIL)
 */
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = (srcRoot, out) => {
  const entry = join(srcRoot, "golive-o-entry.ts");
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

/* ---- 0169 copies the progress record exactly (run before the worker) ---- */
function migrationCopy() {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of MIGS.filter((x) => x < "0169")) applyFile(db, f);
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES (1, 'A', 'a@a.test', 'ceo', 1, 'x')`);
  db.exec(`INSERT INTO tasks (id, title, assigned_to, created_by, status) VALUES (1, 'T', 1, 1, 'in_progress')`);
  for (let i = 0; i < 25; i++) db.prepare(`INSERT INTO task_updates (task_id, author_id, kind, body, progress_snapshot, progress_source, client_key, created_at) VALUES (1, 1, ?, ?, ?, 'manual', ?, ?)`)
    .run(["progress", "blocker", "review_request", "review_approved", "cancel"][i % 5], `row ${i}`, i * 4, i % 3 ? null : `k${i}`, `2026-11-0${1 + (i % 3)} 0${i % 9}:00:00`);
  const before = sha(JSON.stringify(db.prepare(`SELECT * FROM task_updates ORDER BY id`).all()));
  applyFile(db, MIGS.find((x) => x.startsWith("0169")));
  const after = sha(JSON.stringify(db.prepare(`SELECT * FROM task_updates ORDER BY id`).all()));
  ok(before === after, "0169 copies every progress row exactly - same ids, same content");
  let blocked = 0;
  try { db.exec(`UPDATE task_updates SET body = 'x' WHERE id = 1`); } catch { blocked++; }
  try { db.exec(`DELETE FROM task_updates WHERE id = 1`); } catch { blocked++; }
  ok(blocked === 2, "0169 keeps the record append-only (update and delete refused)");
  let fine = true; try { db.exec(`INSERT INTO task_updates (task_id, author_id, kind, body) VALUES (1, 1, 'reopened', 'r')`); } catch { fine = false; }
  ok(fine && db.prepare(`SELECT MAX(id) AS m FROM task_updates`).get().m === 26, "0169 takes the new kinds and continues the numbering");
  let dup = false; try { db.exec(`INSERT INTO task_updates (task_id, author_id, kind, body, client_key) VALUES (1, 1, 'progress', 'again', 'k0')`); } catch { dup = true; }
  ok(dup, "0169 keeps the once-only key per author");
  /* v1.257.0 - 0170 the same way: every row copied, reported_progress empty, still append-only */
  const COLS = "id, task_id, project_id, author_id, kind, body, completed_work, blockers, next_action, status_to, stage_to, progress_snapshot, progress_source, corrects_id, client_key, created_at";
  const b70 = sha(JSON.stringify(db.prepare(`SELECT ${COLS} FROM task_updates ORDER BY id`).all()));
  applyFile(db, MIGS.find((x) => x.startsWith("0170")));
  ok(b70 === sha(JSON.stringify(db.prepare(`SELECT ${COLS} FROM task_updates ORDER BY id`).all())) && db.prepare(`SELECT COUNT(*) AS n FROM task_updates WHERE reported_progress IS NOT NULL`).get().n === 0, "0170 copies every progress row exactly; no reported percentage is invented");
  let b2 = 0;
  try { db.exec(`UPDATE task_updates SET body = 'x' WHERE id = 1`); } catch { b2++; }
  try { db.exec(`DELETE FROM task_updates WHERE id = 1`); } catch { b2++; }
  let w2 = 0;
  try { db.exec(`INSERT INTO task_updates (task_id, author_id, kind, body, corrects_id) VALUES (1, 1, 'withdrawn', 'mistake', 2)`); } catch { w2 = -1; }
  try { db.exec(`INSERT INTO task_updates (task_id, author_id, kind, body, corrects_id) VALUES (1, 1, 'withdrawn', 'again', 2)`); } catch { w2 += 1; }
  let r2 = false; try { db.exec(`INSERT INTO task_updates (task_id, author_id, kind, body, reported_progress) VALUES (1, 1, 'progress', 'x', 140)`); } catch { r2 = true; }
  ok(b2 === 2 && w2 === 1 && r2, "0170 keeps the record append-only, withdraws an update once, and takes only 0-100 as a reported percentage");
  return out;
}

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of MIGS) applyFile(db, f);
  let barrier = null;
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => {
      const r = st.get(...b) ?? null;
      if (barrier && sql.includes(barrier.sql)) { barrier.n += 1; if (barrier.n >= 2) barrier.go(); await barrier.p; }
      return r;
    }, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }), _run: () => st.run(...b) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, get: async () => null, head: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  if (!globalThis.FixedLengthStream) globalThis.FixedLengthStream = class extends TransformStream { constructor() { super(); } };
  const RealDate = globalThis.Date;
  const fixed = Date.parse("2026-11-03T04:00:00Z");
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const U = { ceo: 1, coo: 3, aina: 5, lia: 6, farid: 14 };
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, employment_status, joined_on) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${SECRET}','Management','permanent','2020-01-01'),
    (3,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${SECRET}','Management','permanent','2020-01-01'),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01'),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${SECRET}','Sales','permanent','2020-01-01'),
    (14,'Farid','Farid Zulkifli','farid@a2z.test','live_host',1,'x',1,'${SECRET}','Live','permanent','2020-01-01')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const h = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const task = (id) => db.prepare(`SELECT status, stage, progress FROM tasks WHERE id = ?`).get(id);
  const rows = (id, kind) => n(`SELECT COUNT(*) AS n FROM task_updates WHERE task_id = ? AND kind = ?`, id, kind);
  const told = (uid, like) => n(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message LIKE ?`, uid, like);
  const items = async (id, uid) => (await call(`/tasks/${id}/items`, uid)).j?.items ?? [];
  const tick = async (id, uid, title) => { const it = (await items(id, uid)).find((x) => x.title === title); await call(`/tasks/${id}/items/${it?.id}/toggle`, uid, "POST", {}); };
  const detail = async (id, uid) => (await call(`/tasks/${id}`, uid)).j;
  const S = "Delivered the signed forms to the bank counter";
  const race = (sqlPart) => { let go; const p = new Promise((r) => { go = r; }); barrier = { n: 0, p, go, sql: sqlPart }; };
  /* The browser fixture (tests/browser/task-closure-fixture.json) is these
     answers, captured on the first unmutated run with TASK_CLOSURE_OUT=<file>:
     a self-set task ready to close, and the same task closed - as its owner sees them. */
  const cap = {};
  const capture = async (key, uid, id) => {
    if (!process.env.TASK_CLOSURE_OUT) return;
    cap[key] = { detail: (await call(`/tasks/${id}`, uid)).j, updates: (await call(`/tasks/${id}/updates`, uid)).j, files: (await call(`/tasks/${id}/files`, uid)).j,
      activity: (await call(`/tasks/${id}/activity`, uid)).j, comments: (await call(`/tasks/${id}/comments`, uid)).j, list: ((await call(`/tasks`, uid)).j?.tasks ?? []).filter((t) => t.id === id) };
  };
  try {
    /* ---------- A. basic closure: 1/1 deliverables, self-set ---------- */
    const a1 = (await call(`/tasks`, U.lia, "POST", { title: "Send the quotation to Zainab Kitchen", deadline: "2026-11-01", items: ["Send QT-2026-0019"] })).j?.id;
    await tick(a1, U.lia, "Send QT-2026-0019");
    let d = await detail(a1, U.lia);
    ok(d?.can?.close === true && d.task.next === "close_ready" && d.task.progress === 100 && d.task.status !== "completed", "A/D at 1/1 the task is not closed by itself - the next step is to close it, and the owner may", JSON.stringify([d?.can?.close, d?.task?.next, d?.task?.status]));
    await capture("ready", U.lia, a1);
    ok((await call(`/tasks/${a1}/close`, U.lia, "POST", { summary: "done" })).j?.error?.code === "summary_required" && task(a1).status !== "completed", "A a completion summary is required (10+ characters)");
    const c1 = await call(`/tasks/${a1}/close`, U.lia, "POST", { summary: S });
    const row = db.prepare(`SELECT author_id, kind, body, status_to, progress_snapshot, created_at FROM task_updates WHERE task_id = ? ORDER BY id DESC LIMIT 1`).get(a1);
    ok(c1.status === 200 && task(a1).status === "completed" && task(a1).stage === null && row?.kind === "closed" && row.author_id === U.lia && row.body === S && row.status_to === "completed" && row.created_at,
      "A closed: status Closed, the closing actor, time and summary on the record", JSON.stringify([c1.status, row]));
    d = await detail(a1, U.lia);
    /* SQLite stamps the real clock: the days late are from the closing row's own (Malaysia) date to the due date 01-11 */
    const lateA = Math.round((Date.parse(new RealDate(Date.parse(`${row.created_at.replace(" ", "T")}Z`) + 8 * 3600000).toISOString().slice(0, 10)) - Date.parse("2026-11-01")) / 86400000);
    ok(lateA >= 1 && d.task.closure?.by === "Lia Seller" && d.task.closure?.summary === S && d.task.closure?.late_days === lateA && d.task.timeline?.at(-1)?.key === "closed" && d.task.timeline.at(-1).state === "done" && d.task.next === "closed",
      "A the task shows Closed with who, when, the summary - the days after its due date - and the timeline ends in Closed", JSON.stringify(d.task.closure));
    await capture("closed", U.lia, a1);
    const listA = (await call(`/tasks`, U.lia)).j?.tasks?.find((t) => t.id === a1);
    const arch = (await call(`/tasks?archive=1`, U.lia)).j?.tasks?.find((t) => t.id === a1);
    ok(listA?.status === "completed" && listA.closed_late_days === lateA && !!listA.closed_at && arch?.status === "completed", "A/G My Tasks and the archive carry the same Closed record, with how late it was");
    const act = (await call(`/tasks/${a1}/activity`, U.lia)).j?.activity ?? [];
    ok(act.some((e) => e.text === "Closed the task"), "A the activity shows the closure");

    /* ---------- B. 1/2 deliverables: blocked, named; the exception is management's (D1) ---------- */
    const b1 = (await call(`/tasks`, U.lia, "POST", { title: "Open a business account", items: ["Fill the form", "Submit at the branch"] })).j?.id;
    await tick(b1, U.lia, "Fill the form");
    const bb = await call(`/tasks/${b1}/close`, U.lia, "POST", { summary: S });
    ok(bb.status === 409 && bb.j?.error?.code === "deliverables_outstanding" && bb.j?.outstanding?.map((x) => x.title).join() === "Submit at the branch" && task(b1).status !== "completed" && task(b1).progress === 50 && rows(b1, "closed") === 0,
      "B 1/2: closing is refused, the open deliverable named, the progress kept at 50%", bb.text.slice(0, 160));
    ok((await call(`/tasks/${b1}/close`, U.lia, "POST", { summary: S, exception: true, exception_reason: "The branch is closed this week" })).status === 403 && task(b1).status !== "completed", "B an ordinary staff member cannot close with an exception");
    ok((await call(`/tasks/${b1}/close`, U.ceo, "POST", { summary: S, exception: true })).j?.error?.code === "reason_required", "B the exception needs its reason");
    const bx = await call(`/tasks/${b1}/close`, U.ceo, "POST", { summary: S, exception: true, exception_reason: "The client cancelled the branch visit" });
    const bxr = db.prepare(`SELECT kind, body, blockers FROM task_updates WHERE task_id = ? ORDER BY id DESC LIMIT 1`).get(b1);
    ok(bx.status === 200 && bxr?.kind === "closed_with_exception" && /cancelled the branch visit/.test(bxr.body) && /Submit at the branch/.test(bxr.blockers) && n(`SELECT COUNT(*) AS n FROM task_items WHERE task_id = ? AND done = 1`, b1) === 1 && task(b1).progress === 50,
      "B the CEO closes it as an exception - recorded with the reason and what was open; nothing is ticked for him, progress stays 50%", JSON.stringify(bxr));

    /* ---------- C. review required: a task somebody else set ---------- */
    const c = (await call(`/tasks`, U.ceo, "POST", { title: "Prepare the TEKUN forms", assigned_to: U.farid, items: ["Prepare documents"] })).j?.id;
    await call(`/tasks/${c}/assistants`, U.ceo, "POST", { user_id: U.aina });
    await tick(c, U.farid, "Prepare documents");
    const fd = await detail(c, U.farid);
    ok(fd.can.close === false && fd.can.request_review === true && fd.task.next === "submit_review", "C the assignee may not close it - his next step is Ready for Review", JSON.stringify([fd.can.close, fd.task.next]));
    ok((await call(`/tasks/${c}/close`, U.farid, "POST", { summary: S })).status === 403 && task(c).status !== "completed", "C/F the assignee's own close is refused by the server");
    const before = sha(JSON.stringify([task(c), db.prepare(`SELECT COUNT(*) AS n FROM task_updates`).get()]));
    ok((await call(`/tasks/${c}/close`, U.aina, "POST", { summary: S })).status === 403 && (await call(`/tasks/${c}/reopen`, U.lia, "POST", { reason: "I want to reopen this one" })).status === 403
      && sha(JSON.stringify([task(c), db.prepare(`SELECT COUNT(*) AS n FROM task_updates`).get()])) === before, "F a helper and a stranger are refused - no status or record changes");
    const rq = await call(`/tasks/${c}/updates`, U.farid, "POST", { kind: "review_request", body: "Forms ready for your check" });
    ok(rq.status === 201 && task(c).stage === "review" && task(c).status === "in_progress" && told(U.ceo, "%Ready for review: Prepare the TEKUN forms%") === 1, "C Ready for Review: not closed yet, and the reviewer is told");
    ok((await call(`/tasks/${c}`, U.farid, "PATCH", { status: "open" })).status === 200 && task(c).stage === "review", "C the old status route no longer withdraws a review in passing (stage kept)");
    const ap = await call(`/tasks/${c}/close`, U.ceo, "POST", {});
    ok(ap.status === 200 && task(c).status === "completed" && rows(c, "review_approved") === 1 && told(U.farid, "%Approved: Prepare the TEKUN forms%") === 1, "C the reviewer approves - the task closes, the person who did it is told", ap.text.slice(0, 140));

    /* ---------- D. 100% reported, no checklist: explained, never auto-closed ---------- */
    const dd = (await call(`/tasks`, U.lia, "POST", { title: "Register the company (partnership)" })).j?.id;
    await call(`/tasks/${dd}/updates`, U.lia, "POST", { kind: "progress", body: "All documents submitted", progress: 100 });
    const ddd = await detail(dd, U.lia);
    ok(task(dd).status === "in_progress" && task(dd).progress === 100 && ddd.task.next === "close_ready" && ddd.can.close === true, "D reported 100%: still In Progress; the screen's next step is Close task, and it is offered");

    /* ---------- E. reopening (D2) ---------- */
    ok((await call(`/tasks/${a1}/reopen`, U.lia, "POST", { reason: "short" })).j?.error?.code === "reason_required", "E a reason is required");
    const ro = await call(`/tasks/${a1}/reopen`, U.lia, "POST", { reason: "Zainab asked for a revised quotation" });
    d = await detail(a1, U.lia);
    ok(ro.status === 200 && task(a1).status === "in_progress" && task(a1).stage === null && task(a1).progress === 100 && rows(a1, "closed") === 1 && rows(a1, "reopened") === 1 && n(`SELECT COUNT(*) AS n FROM task_items WHERE task_id = ? AND done = 1`, a1) === 1
      && d.task.id === a1 && d.task.closure === null && (await call(`/tasks`, U.lia)).j?.tasks?.find((t) => t.id === a1)?.status === "in_progress",
      "E reopened: back In Progress, same task, the closing record kept, the checklist untouched, back in the active list", ro.text.slice(0, 140));
    ok(d.task.timeline.find((s) => s.key === "in_progress")?.flags?.reopened_by === "Lia Seller", "E the timeline says who reopened it, and why");
    const cx = (await call(`/tasks`, U.lia, "POST", { title: "Old flyer reprint" })).j?.id;
    await call(`/tasks/${cx}/review`, U.ceo, "POST", { decision: "cancel", reason: "The client dropped the reprint" });
    ok(task(cx).stage === "cancelled" && (await call(`/tasks/${cx}/reopen`, U.lia, "POST", { reason: "I want to do it after all" })).status === 403
      && (await call(`/tasks/${cx}/reopen`, U.ceo, "POST", { reason: "The client wants the reprint again" })).status === 200 && task(cx).status === "in_progress",
      "E a cancelled task is reopened by management only (D2)");

    /* ---------- the old dropdown (D4) ---------- */
    ok((await call(`/tasks/${dd}`, U.lia, "PATCH", { status: "completed", progress: 100 })).j?.error?.code === "close_required" && task(dd).status === "in_progress", "D4 the old dropdown no longer closes a task");
    ok((await call(`/tasks/${c}`, U.farid, "PATCH", { status: "in_progress" })).j?.error?.code === "reopen_required" && task(c).status === "completed", "D4 ...nor reopens one - the assignee cannot undo his reviewer's approval");

    /* ---------- H. history is never rewritten ---------- */
    const h = (await call(`/tasks`, U.lia, "POST", { title: "TEKUN - DEHANA", items: ["Prepare the paperwork"] })).j?.id;
    await tick(h, U.lia, "Prepare the paperwork");
    await call(`/tasks/${h}/updates`, U.lia, "POST", { kind: "progress", body: "Paperwork ready" });
    await call(`/tasks/${h}/items`, U.lia, "POST", { title: "Wait for TEKUN Kulai to review" });
    const hu = (await call(`/tasks/${h}/updates`, U.lia)).j?.updates ?? [];
    const hd = await detail(h, U.lia);
    ok(hu[0]?.progress_snapshot === 100 && hu[0]?.progress_source === "checklist" && hd.task.progress === 50 && hd.can.close === true && hd.task.next === "outstanding" && (hd.task.outstanding ?? []).length === 1,
      "H the 100% reported when the checklist was 1/1 stays as it was; a new deliverable makes it 50% and the screen names what is open", JSON.stringify([hu[0]?.progress_snapshot, hd.task.progress, hd.task.next]));

    /* ---------- I. close twice at once, and a retry ---------- */
    const i1 = (await call(`/tasks`, U.lia, "POST", { title: "Post the brochure" })).j?.id;
    race("SELECT * FROM tasks WHERE id = ?1");
    const both = await Promise.all([call(`/tasks/${i1}/close`, U.lia, "POST", { summary: S }), call(`/tasks/${i1}/close`, U.lia, "POST", { summary: S })]);
    barrier = null;
    ok(both.map((r) => r.status).sort().join() === "200,409" && rows(i1, "closed") === 1 && n(`SELECT COUNT(*) AS n FROM tasks WHERE title = 'Post the brochure'`) === 1, "I two presses at once: one closure, one record, the other refused", JSON.stringify(both.map((r) => [r.status, r.text.slice(0, 60)])));
    const i2 = (await call(`/tasks`, U.ceo, "POST", { title: "Book the venue", assigned_to: U.farid })).j?.id;
    const k = { summary: S, client_key: "press-1-0123456789" };
    const r1 = await call(`/tasks/${i2}/close`, U.ceo, "POST", k), r2 = await call(`/tasks/${i2}/close`, U.ceo, "POST", k);
    ok(r1.status === 200 && r2.j?.existing === true && rows(i2, "closed") === 1 && told(U.farid, "%Closed: Book the venue%") === 1, "I a retry of the same press records nothing twice and tells nobody twice");

    /* ---------- J (1.257.0). edit and withdraw, history kept; a reported % beside the checklist ---------- */
    const j = (await call(`/tasks`, U.ceo, "POST", { title: "MARA - DANANITA DEHANA", assigned_to: U.farid, items: ["Submit the MARA form"] })).j?.id;
    const ju = (await call(`/tasks/${j}/updates`, U.farid, "POST", { kind: "progress", body: "Documentation submitted to MARA", next_action: "Wait for the officer", reported_progress: 60 })).j?.id;
    ok(ju && task(j).progress === 0 && db.prepare(`SELECT reported_progress, progress_snapshot, progress_source FROM task_updates WHERE id = ?`).get(ju)?.reported_progress === 60
      && (await detail(j, U.farid)).task.reported?.value === 60, "J a reported 60% is kept on the update; the official progress stays the checklist (0/1 = 0%)");
    ok((await call(`/tasks/${j}/updates`, U.farid, "POST", { kind: "progress", body: "x", reported_progress: 140 })).status === 400 && (await call(`/tasks/${j}/updates`, U.farid, "POST", { kind: "progress", body: "x", progress: 60 })).j?.error?.code === "progress_from_checklist", "J the reported % is 0-100, and typing the official % on a checklist task is still refused");
    const jc = (await call(`/tasks/${j}/updates`, U.farid, "POST", { kind: "correction", corrects_id: ju, body: "683768" })).j?.id;
    const ed = await call(`/tasks/${j}/updates/${ju}/edit`, U.farid, "POST", { body: "Documentation submitted to MARA Johor", next_action: "Wait for the officer's visit" });
    const orig = db.prepare(`SELECT body, next_action FROM task_updates WHERE id = ?`).get(ju);
    let ups = (await call(`/tasks/${j}/updates`, U.farid)).j?.updates ?? [];
    const one = ups.find((x) => x.id === ju);
    ok(ed.status === 201 && orig.body === "Documentation submitted to MARA" && one?.edits?.at(-1)?.body === "Documentation submitted to MARA Johor" && one.edits.at(-1).next_action === "Wait for the officer's visit" && !ups.some((x) => x.kind === "edit"),
      "J the author edits his update: the new text shows, the original stays exactly as written, the edit is not an entry of its own", JSON.stringify(one?.edits));
    await call(`/tasks/${j}/assistants`, U.ceo, "POST", { user_id: U.aina });
    ok((await call(`/tasks/${j}/updates/${ju}/edit`, U.lia, "POST", { body: "Not mine" })).status === 403 && (await call(`/tasks/${j}/updates/${jc}/withdraw`, U.aina, "POST", { reason: "Not mine either" })).status === 403
      && (await call(`/tasks/${j}/updates/${ju}/edit`, U.aina, "POST", { body: "Helper rewrites it" })).status === 403, "J nobody else edits or withdraws it - not a stranger, not even a helper on the task");
    ok((await call(`/tasks/${j}/updates/${jc}/withdraw`, U.farid, "POST", { reason: "no" })).status === 400, "J a withdrawal needs its reason");
    const st0 = JSON.stringify(task(j));
    const wd = await call(`/tasks/${j}/updates/${jc}/withdraw`, U.ceo, "POST", { reason: "Typed my authenticator code by mistake" });
    ups = (await call(`/tasks/${j}/updates`, U.farid)).j?.updates ?? [];
    ok(wd.status === 200 && ups.find((x) => x.id === jc)?.withdrawn?.reason === "Typed my authenticator code by mistake" && ups.find((x) => x.id === jc)?.withdrawn?.by === "Alif Farhan"
      && db.prepare(`SELECT body FROM task_updates WHERE id = ?`).get(jc)?.body === "683768" && JSON.stringify(task(j)) === st0,
      "J management withdraws the mistaken '683768' entry: the timeline says who and why, the original is still in the record, the task did not move");
    ok((await call(`/tasks/${j}/updates/${jc}/withdraw`, U.ceo, "POST", { reason: "Typed it twice by mistake" })).status === 409 && ups.find((x) => x.id === jc)?.can_edit === false, "J an update is withdrawn once, and is then no longer editable");
    const lst = (await call(`/tasks?all=1`, U.ceo)).j?.tasks?.find((t) => t.id === j);
    ok(lst?.latest_update?.id === ju && lst.latest_update.body === "Documentation submitted to MARA Johor", "J the task list's latest update is the edited one - never the withdrawn entry", JSON.stringify(lst?.latest_update));
    const dc = (await call(`/tasks/${a1}/updates`, U.lia)).j?.updates?.find((x) => x.kind === "closed");
    ok(dc && dc.can_edit === false && (await call(`/tasks/${a1}/updates/${dc.id}/withdraw`, U.lia, "POST", { reason: "I closed it by mistake" })).status === 409, "J a decision (a closure) is never edited or withdrawn - the next decision changes it");
    await capture("edits", U.ceo, j);
    if (process.env.TASK_CLOSURE_OUT) writeFileSync(process.env.TASK_CLOSURE_OUT, JSON.stringify({ captured_from: "tests/go-live-o.mjs", owner: U.lia, edits_viewer: U.ceo, views: cap }, null, 1));
    const jcount = (await detail(j, U.farid)).task.counts.updates;
    ok(jcount === 1, "J the Updates count leaves out edits and withdrawn entries", String(jcount));
  } catch (e) {
    ok(false, `the run did not finish: ${e?.stack ?? e}`);
  } finally { globalThis.Date = RealDate; }
  return out;
}

let n = 0, fail = 0;
const report = (res) => { for (const [p, m] of res) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const dir = mkdtempSync(join(tmpdir(), "golive-o-"));
const main = given ?? join(dir, "worker.mjs");
if (!given) bundle(root, main);
report(migrationCopy());
report(await runtime(main));
const checks = n;
if (given || process.env.NOMUT) {
  if (fail) { console.error(`go-live-o: ${fail} of ${n} failed`); process.exit(1); }
  console.log(`go-live-o: ${n} checks passed`); process.exit(0);
}
const MUT = [
  ["worker/src/tasks-progress.ts", "deliverables are not checked on closing", "    if (left.length) {\n      if (!input.exception) {", "    if (false) {\n      if (!input.exception) {"],
  ["worker/src/tasks-progress.ts", "anyone who closes may reopen a cancelled task", `t.stage === "cancelled" ? a.manage : a.review`, "a.review"],
  ["worker/src/tasks-progress.ts", "the assignee closes the task set for him", "close: a.open && a.review,", "close: a.open && (a.review || a.assignee),"],
  ["worker/src/tasks-progress.ts", "the closure row is written whatever the state", "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?1 AND status = ?12 AND stage IS ?13)`,", "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE ?12 IS NOT NULL OR ?13 IS NULL`,"],
  ["worker/src/tasks-progress.ts", "a reopen needs no reason", `    if (reason.length < 10) return err("reason_required", "Say why the task is reopened`, `    if (false) return err("reason_required", "Say why the task is reopened`],
  ["worker/src/tasks-progress.ts", "no completion summary", "if (!approving && summary.length < 10) return err(", "if (false) return err("],
  ["worker/src/tasks-progress.ts", "staff close with an exception", `      if (!can.close_exception) return err("forbidden",`, `      if (false) return err("forbidden",`],
  ["worker/src/staff.ts", "the old dropdown closes a task", `      if (body.status === "completed") return err("close_required",`, `      if (false) return err("close_required",`],
  ["worker/src/tasks-progress.ts", "anyone edits or withdraws an update", "  if (u.author_id !== user.id && !a.manage) return err(", "  if (false) return err("],
  ["worker/src/tasks-progress.ts", "a withdrawn update is still the latest", "                           AND NOT EXISTS (SELECT 1 FROM task_updates w WHERE w.corrects_id = y.id AND w.kind = 'withdrawn') GROUP BY y.task_id)`,", "                           GROUP BY y.task_id)`,"],
  ["worker/src/tasks-progress.ts", "a reported % becomes the official progress", "  if (reported === null && cl.n === 0 && typeof body?.progress", "  if (reported !== null) progress = reported;\n  if (reported === null && cl.n === 0 && typeof body?.progress"],
  ["worker/src/tasks-progress.ts", "a decision can be withdrawn", `export const EDITABLE_KINDS = ["progress",`, `export const EDITABLE_KINDS = ["closed", "progress",`],
  ["worker/src/tasks-progress.ts", "reopening resets the progress", `kind = "reopened"; text = reason; nextStatus = "in_progress"; nextStage = null;`, `kind = "reopened"; text = reason; nextStatus = "in_progress"; nextStage = null; progress = 0;`],
];
for (const [file, name, from, to] of MUT) {
  n++;
  const src = readFileSync(join(root, file), "utf8");
  if (!src.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-o-m-"));
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
if (fail) { console.error(`go-live-o: ${fail} of ${n} failed`); process.exit(1); }
console.log(`go-live-o: ${checks} checks passed (${MUT.length} mutations caught) - task closure: one transition for every status move; 100% never closes a task; closing needs a summary and every deliverable (a manager's exception, with the reason, recorded); a task set by somebody else goes through Ready for Review and its reviewer; reopening needs a reason and keeps the closing record, the checklist and the progress; a cancelled task is reopened by management only; the old dropdown neither closes nor reopens; two presses or a retry make one closure; 0169 copies the progress record exactly and keeps it append-only`);
