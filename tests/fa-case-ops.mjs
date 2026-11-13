/* v1.299.0 - FINANCIAL ADVISORY 2.0, PHASE 2 (the CEO, 13-11-2026: "Phase 2
   now" on claude/FINANCIAL-ADVISORY-2.0-BLUEPRINT.md; D-2, D-4, D-6 as
   recommended): a case's priority, its management override, the case update
   form (a follow-up is an ordinary Task), what a case waits on, its blocker,
   and how it closed - by DIRECT request against the whole worker on SQLite
   with every migration applied (0189, 0190 included). Invented people only.
   Each rule is also MUTATED.

     node tests/fa-case-ops.mjs        (NOMUT=1 skips the mutations) */
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

/* the pure rules first (worker/src/fa-priority.ts), bundled as the worker uses them */
async function rules(file) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const P = await import(pathToFileURL(file).href + `?v=${Math.random()}`);
  const base = { stage: "prescreen", next_follow_up: null, review_pending: false, review_at: null, banker_status: "not_contacted", banker_docs_at: null, last_update: "2026-11-13 02:00:00", waiting_on: null, blocker_urgent: false };
  const at = (x, today = "2026-11-13") => P.priorityOf({ ...base, ...x }, today);
  ok(at({}).level === "normal" && at({}).reasons.length === 0, "nothing pending: Normal");
  ok(at({ projected_dsr_bp: 9500, current_dsr_bp: 9000 }).level === "normal", "a very high DSR on the row changes nothing - the DSR is never a priority");
  ok(at({ next_follow_up: "2026-11-13" }).level === "high", "a follow-up due today: High");
  ok(at({ next_follow_up: "2026-11-11" }).level === "high", "a follow-up 2 days late: still High");
  ok(at({ next_follow_up: "2026-11-10" }).level === "critical" && /overdue 3 days/.test(at({ next_follow_up: "2026-11-10" }).reasons[0]), "a follow-up 3 days late: Critical, with the reason", JSON.stringify(at({ next_follow_up: "2026-11-10" })));
  ok(at({ review_pending: true, review_at: "2026-11-10 02:00:00" }).level === "high", "a review waiting 3 working days (Mon, Tue, Wed... from a Tuesday): High");
  ok(at({ review_pending: true, review_at: "2026-11-07 02:00:00" }).level === "critical", "a review waiting more than 3 working days: Critical");
  ok(P.workingDaysFrom("2026-11-13", "2026-11-16") === 1, "a weekend is not a working day (Fri -> Mon = 1)");
  ok(at({ banker_status: "documents_required", banker_docs_at: "2026-11-09 01:00:00" }).level === "high" && at({ banker_status: "documents_required", banker_docs_at: "2026-11-07 01:00:00" }).level === "critical", "banker documents: High, Critical after 5 days");
  ok(at({ blocker_urgent: true }).level === "critical", "an urgent blocker: Critical");
  ok(at({ last_update: "2026-11-05 01:00:00" }).level === "high" && at({ last_update: "2026-11-06 01:00:00" }).level === "normal", "no update for more than 7 days: High (7 days is still Normal)");
  ok(at({ waiting_on: "paused" }).level === "low", "paused by management: Low");
  ok(at({ waiting_on: "client", next_follow_up: "2026-11-21" }).level === "low" && at({ waiting_on: "client", next_follow_up: "2026-11-20" }).level === "normal", "waiting on the client, follow-up more than 7 days away: Low");
  ok(at({ stage: "closed", next_follow_up: "2026-11-01" }) === null, "a closed case has no priority");
  ok(P.mytDayOf("2026-11-12 17:30:00") === "2026-11-13", "a stored UTC time is read as the Malaysian day");
  const src = readFileSync(join(root, "worker/src/fa-priority.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/dsr|projected|current_dsr/i.test(src), "the DSR is never an input to priority");
  return out;
}

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

  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const later = (d) => new Date(Date.now() + 8 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
  try {
    const mk = async (uid, name, phone) => (await call("/fa/cases", uid, "POST", { product: "personal_financing", issuer_code: "a2z", new_customer: { name, phone } })).j.id;
    const c9 = await mk(9, "Encik Satu", "012-111 1111");
    const c15 = await mk(15, "Puan Dua", "012-222 2222");
    const c1 = await mk(1, "Tuan Tiga", "012-333 3333");
    const row = async (uid, id) => (await call("/fa/cases", uid)).j.cases.find((r) => r.id === id);

    /* ---- the computed priority on the list ---- */
    let r9 = await row(9, c9);
    ok(r9 && r9.priority === "normal" && r9.priority_auto === "normal" && Array.isArray(r9.priority_why), "a fresh case is Normal, worked out on read", JSON.stringify(r9));

    /* ---- the case update form ---- */
    const up = (uid, id, body) => call(`/fa/cases/${id}/updates`, uid, "POST", body);
    const u1 = await up(9, c9, { comment: "Client will send the payslip", follow_up_on: today, follow_up_title: "Collect the payslip", waiting_on: "client", next_action: "Run the DSR when the payslip lands" });
    ok(u1.status === 201 && u1.j?.task_id, "the owner records a comment, a follow-up, waiting-on and the next action", u1.text.slice(0, 200));
    const task = db.prepare(`SELECT title, deadline, link_kind, link_id, assigned_to FROM tasks WHERE id = ?`).get(u1.j.task_id);
    ok(task && task.link_kind === "fa_case" && task.link_id === c9 && task.deadline === today && /Collect the payslip/.test(task.title) && !/Encik/.test(task.title), "the follow-up is an ordinary Task linked to the case, titled with the reference not the client", JSON.stringify(task));
    const ups = db.prepare(`SELECT kind, author_id, author_role, created_at FROM fa_case_updates WHERE case_id = ? ORDER BY id`).all(c9);
    ok(ups.map((x) => x.kind).join(",") === "comment,follow_up,next_action,waiting_on" && ups.every((x) => x.author_id === 9 && x.author_role === "sales_marketing" && x.created_at), "each part is its own row with its author and time", JSON.stringify(ups));
    r9 = await row(9, c9);
    ok(r9.priority === "high" && r9.waiting_on === "client" && r9.ops_next_action && r9.next_follow_up === today, "a follow-up due today makes the case High; waiting-on and next action show on the list", JSON.stringify(r9).slice(0, 300));
    let thrown = "";
    try { db.prepare(`UPDATE fa_case_updates SET body = 'x' WHERE case_id = ?`).run(c9); } catch (e) { thrown = String(e); }
    ok(/append only/.test(thrown), "the update history cannot be rewritten (trigger)");
    thrown = "";
    try { db.prepare(`DELETE FROM fa_case_updates WHERE case_id = ?`).run(c9); } catch (e) { thrown = String(e); }
    ok(/append only/.test(thrown), "the update history cannot be deleted (trigger)");
    ok((await up(9, c9, { follow_up_on: later(-1), follow_up_title: "Too late" })).j?.error?.code === "invalid_input", "a follow-up cannot be set in the past");
    ok((await up(9, c9, { follow_up_on: later(2), follow_up_title: "x" })).j?.error?.code === "invalid_input", "a follow-up says what it is");
    ok((await up(9, c9, { waiting_on: "paused" })).status === 403, "only management pauses a case");
    ok((await up(9, c9, { waiting_on: "nowhere" })).j?.error?.code === "invalid_input", "waiting-on takes only the known values");
    ok((await up(9, c9, {})).j?.error?.code === "invalid_input", "an empty update is refused");
    ok((await up(9, c9, { blocker: "Ok" })).j?.error?.code === "invalid_input", "a blocker is described");
    const ub = await up(9, c9, { blocker: "Employer letter not issued yet", blocker_urgent: true });
    ok(ub.status === 201 && (await row(9, c9)).priority === "critical", "an urgent blocker makes the case Critical");
    ok((await up(9, c9, { blocker: "" })).status === 201 && (await row(9, c9)).blocker === null, "a blocker is cleared by sending it empty");
    ok((await up(9, c9, { document_id: 99999 })).j?.error?.code === "invalid_input", "a supporting document must be on this case");

    /* ---- scope: another salesperson, HR, an agent, an assisting member ---- */
    ok((await up(15, c9, { comment: "Not mine" })).status === 403 && (await call(`/fa/cases/${c9}`, 15)).status === 403, "another salesperson cannot read or update the case (direct request)");
    ok((await up(7, c9, { comment: "HR" })).status === 403 && (await up(21, c9, { comment: "Agent" })).status === 403 && (await up(22, c9, { comment: "Admin" })).status === 403, "HR, an agent and an admin get nothing");
    await call(`/fa/cases/${c9}/members`, 9, "POST", { user_id: 15 });
    const mem = await up(15, c9, { comment: "Called the client, payslip on Monday" });
    ok(mem.status === 201, "an assisting member may comment", mem.text.slice(0, 160));
    ok((await up(15, c9, { next_action: "Change it" })).status === 403 && (await up(15, c9, { follow_up_on: later(1), follow_up_title: "Mine" })).status === 403, "an assisting member cannot change the next action or set a follow-up");

    /* ---- the management override ---- */
    const pr = (uid, id, body) => call(`/fa/cases/${id}/priority`, uid, "PUT", body);
    ok((await pr(9, c9, { priority: "low", reason: "I think it can wait" })).status === 403, "Sales cannot override priority on their own case");
    const s15 = await pr(15, c9, { priority: "low", reason: "I am only assisting on it" });
    ok(s15.status === 403 && s15.j?.error?.code === "forbidden", "an assisting salesperson cannot override priority either (fa_priority is management only)", s15.text);
    ok((await pr(3, c9, { priority: "low", reason: "short" })).j?.error?.code === "invalid_input", "an override needs a reason of 10 characters or more");
    ok((await pr(3, c9, { priority: "urgent", reason: "Not a known level at all" })).j?.error?.code === "invalid_input", "only the four levels");
    const po = await pr(6, c9, { priority: "low", reason: "Client asked us to wait until December" });
    r9 = await row(9, c9);
    ok(po.status === 200 && r9.priority === "low" && r9.priority_auto === "high" && r9.priority_reason === "Client asked us to wait until December" && r9.priority_by === "Cco Person", "the CCO overrides with a reason; the computed level stays beside it", JSON.stringify(r9).slice(0, 400));
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'fa.priority_override'`).get().n === 1 && db.prepare(`SELECT COUNT(*) AS n FROM fa_case_updates WHERE case_id = ? AND kind = 'priority'`).get(c9).n === 1, "the override is audited and on the case history");
    ok((await pr(1, c1, { priority: "high", reason: "My own case, but I am the owner" })).status === 200, "the verified owner account may set its own case");
    await call(`/fa/cases/${c15}`, 1, "PATCH", { owner_id: 3 });
    const self = await pr(3, c15, { priority: "critical", reason: "My own case, raising it now" });
    ok(self.status === 403 && self.j?.error?.code === "self_approval", "a manager cannot override a case they own", self.text);
    const cl = await pr(6, c9, { priority: null, reason: "Client is ready again after the call" });
    ok(cl.status === 200 && (await row(9, c9)).priority === (await row(9, c9)).priority_auto, "clearing returns to the computed priority");

    /* ---- how a case closes ---- */
    ok((await call(`/fa/cases/${c9}`, 9, "PATCH", { stage: "closed", closed_reason: "Client changed mind", closed_kind: "lost" })).j?.error?.code === "invalid_input", "a closing kind is completed, not proceeding or withdrawn");
    const cz = await call(`/fa/cases/${c9}`, 9, "PATCH", { stage: "closed", closed_reason: "Client withdrew the request", closed_kind: "withdrawn" });
    r9 = await row(9, c9);
    ok(cz.status === 200 && r9.closed_kind === "withdrawn" && r9.priority === null, "a withdrawn case closes as Withdrawn and has no priority", JSON.stringify(r9).slice(0, 200));
    ok(db.prepare(`SELECT new_value FROM fa_case_updates WHERE case_id = ? AND kind = 'closed'`).get(c9)?.new_value === "withdrawn", "the closing is on the case history");
    ok((await up(9, c9, { comment: "After closing" })).j?.error?.code === "invalid_state", "a closed case takes no updates");
    ok((await call(`/fa/cases/${c1}`, 1, "PATCH", { stage: "closed", closed_reason: "Old style close with a reason" })).status === 200, "a close without a kind still works (Phase 1 callers)");

    /* ---- the picture carries it; nothing else moved ---- */
    const pic = await call(`/fa/cases/${c9}`, 9);
    ok(pic.status === 200 && Array.isArray(pic.j?.updates) && pic.j.updates.length >= 8 && pic.j.updates.every((x) => x.author && x.created_at) && pic.j.row?.id === c9, "the case shows its update history with authors and times", JSON.stringify(pic.j?.updates?.slice(0, 2)));
    ok(pic.j?.can?.priority === false && (await call(`/fa/cases/${c9}`, 6)).j?.can?.priority === true, "the screen is told who may override (server-decided)");
    ok(finance() === before, "Finance, invoices, payments, commission and journals untouched", `${before} -> ${finance()}`);
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const dir = mkdtempSync(join(tmpdir(), "fao-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
bundle(root, "worker/src/fa-priority.ts", join(dir, "prio.mjs"));
report(await rules(join(dir, "prio.mjs")));
report(await runtime(join(dir, "worker.mjs")));
const checks = n;
const F = "worker/src/fa.ts", P = "worker/src/fa-priority.ts";
const MUT = [
  [F, "a member changes everything", [["    if (!edit && Object.values(want).some(Boolean)) return err(", "    if (false) return err("]]],
  [F, "a follow-up in the past", [["if (!validDay(b.follow_up_on) || b.follow_up_on < mytToday())", "if (!validDay(b.follow_up_on))"]]],
  [F, "a second follow-up engine", [["      const row = await env.DB.prepare(`INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id) VALUES (?1, ?2, ?3, ?4, 'normal', ?5, 'fa_case', ?6) RETURNING id`)\n        .bind(`${c.case_ref}: ${fuTitle}`", "      const row = await env.DB.prepare(`INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id) VALUES (?1, ?2, ?3, ?4, 'normal', ?5, 'fa_other', ?6) RETURNING id`)\n        .bind(`${c.case_ref}: ${fuTitle}`"]]],
  [F, "Sales pauses", [["    if (waiting === \"paused\" && !isAll(user)) return err(", "    if (false) return err("]]],
  [F, "an update not logged", [["    if (comment) await logUpdate(env, c.id, user, \"comment\", { body: comment });", ""]]],
  [F, "Sales overrides priority", [["    if (!can(user.role, \"fa_priority\")) return err(\"forbidden\", \"Only management overrides a case's priority\", 403);", ""]]],
  [F, "an override on your own case", [["    if (c.owner_id === user.id && !isExecutiveOwner(user)) {\n      await audit(env, user.id, \"auth.self_approval_refused\", \"fa_cases\", String(c.id), { action: \"fa.priority_override\" });", "    if (false) {\n      await audit(env, user.id, \"auth.self_approval_refused\", \"fa_cases\", String(c.id), { action: \"fa.priority_override\" });"]]],
  [F, "an override with no reason", [["    if (reason.length < 10) return err(\"invalid_input\", \"Give the reason (at least 10 characters).\", 400);", ""]]],
  [F, "the override hides the computed level", [["return { ...r, priority: over ?? auto?.level ?? null, priority_auto: auto?.level ?? null,", "return { ...r, priority: over ?? auto?.level ?? null, priority_auto: over ?? auto?.level ?? null,"]]],
  [F, "any closing kind", [["        if (b.closed_kind !== undefined && !(CLOSED_KINDS as readonly string[]).includes(String(b.closed_kind))) return err(", "        if (false) return err("]]],
  [P, "a DSR makes a case high", [["  if (x.blocker_urgent) critical.push(\"Urgent blocker\");", "  if (x.blocker_urgent) critical.push(\"Urgent blocker\");\n  if ((x as unknown as { projected_dsr_bp?: number }).projected_dsr_bp) high.push(\"High DSR\");"]]],
  [P, "weekends count as working days", [["if (w !== 0 && w !== 6) n++;", "n++;"]]],
  [P, "a 2-day-late follow-up is critical", [["if (late != null && late > R.followUpCriticalDays)", "if (late != null && late >= R.followUpCriticalDays)"]]],
  ["worker/src/permissions.ts", "Sales holds fa_priority", [['  fa_priority: ["ceo", "coo", "cco"],', '  fa_priority: ["ceo", "coo", "cco", "sales_marketing"],']]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "fao-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), src);
  try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  bundle(mdir, "worker/src/fa-priority.ts", join(mdir, "prio.mjs"));
  const res = [...(await rules(join(mdir, "prio.mjs"))), ...(await runtime(join(mdir, "worker.mjs")))];
  rmSync(mdir, { recursive: true, force: true });
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`fa-case-ops: ${fail} of ${n} failed`); process.exit(1); }
console.log(`fa-case-ops: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - priority worked out from records (never the DSR), a management override with a reason and never on your own case, case updates append-only with author and time, a follow-up is a Task, closed as completed, not proceeding or withdrawn`);
