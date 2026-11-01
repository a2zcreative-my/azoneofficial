/* AGENTS AND TASK-UPDATE EMAILS (v1.249.0) - runtime guard: the WHOLE worker
 * (index.ts) bundled against SQLite with every migration applied (0164
 * included), by direct request as each role, a fake Cloudflare send_email
 * binding. Fixed clock: Sunday 01-11-2026, 12:00 Malaysia time.
 *
 * The owner's request (01-11-2026), claude/TASK-UPDATES-AGENT-AUDIT.md and his
 * answers: agents sign in to the staff portal with a small menu; a real
 * `agent` role (users rebuilt); agents see their own tasks and the active
 * packages and submit clients; Sales sees the requests, management edits
 * them; the CEO writes task updates to staff, COO/CCO read the log, and the
 * matrix decides who may send. Commission for agents is a separate brief.
 *
 *   node tests/go-live-g.mjs                                  the current worker, then mutations
 *   WORKER_BUNDLE=/path/bundle.mjs node tests/go-live-g.mjs   a given bundle (the 1.248.0 bundle must FAIL)
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
  const entry = join(srcRoot, "golive-g-entry.ts");
  writeFileSync(entry, `export { default } from "./worker/src/index.ts";\nexport { drainMailOutbox } from "./worker/src/task-mail.ts";\n`);
  try { execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" }); }
  finally { rmSync(entry, { force: true }); }
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const NOW = Date.parse("2026-11-01T04:00:00Z");
const MIGS = readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort();
const applyFile = (db, f, strict = false) => {
  const src = readFileSync(join(root, "worker/migrations", f), "utf8");
  let buf = "";
  for (const st of src.split(/;\s*\n/)) {
    buf = buf ? `${buf};\n${st}` : st;
    if (/CREATE TRIGGER/i.test(buf) && !/\bEND\s*$/i.test(buf.trim())) continue;
    try { db.exec(buf); } catch (e) { if (strict) throw e; }
    buf = "";
  }
};

/* the table rebuild itself: every row and column the same afterwards */
function migrationChecks() {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const mig = MIGS.find((f) => f.startsWith("0164"));
  ok(!!mig, "G0 migration 0164 (the agent role) exists");
  if (!mig) return out;
  const db = new DatabaseSync(":memory:");
  for (const f of MIGS.filter((f) => f < "0164")) applyFile(db, f);
  db.exec(`INSERT INTO users (id, email, password_hash, name, role, totp_secret, reports_to, google_sub, base_salary_cents, full_name, bank_account) VALUES
    (1, 'alif@a2z.test', 'h', 'Alif', 'ceo', 'S', NULL, 'g-1', 900000, 'Alif Farhan', '1234'),
    (2, 'aina@a2z.test', 'h', 'Aina', 'sales_marketing', NULL, 1, NULL, 300000, NULL, NULL),
    (3, 'shop@gmail.com', 'h', 'Shop', 'customer', NULL, NULL, NULL, 0, NULL, NULL)`);
  db.exec(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', 2, '2030-01-01')`);
  const rows0 = JSON.stringify(db.prepare(`SELECT * FROM users ORDER BY id`).all());
  const cols0 = db.prepare(`PRAGMA table_info(users)`).all().map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}`).join(",");
  const idx0 = db.prepare(`SELECT name FROM sqlite_master WHERE tbl_name = 'users' AND type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name).join(",");
  let threw = null;
  try { db.exec("BEGIN"); applyFile(db, mig, true); db.exec("COMMIT"); } catch (e) { threw = String(e); try { db.exec("ROLLBACK"); } catch { /* none */ } }
  ok(!threw, "G1 the users rebuild applies cleanly", threw ?? "");
  ok(JSON.stringify(db.prepare(`SELECT * FROM users ORDER BY id`).all()) === rows0, "G2 every user row is byte-for-byte the same after the rebuild (passwords, 2FA, salary, bank, reporting line)");
  ok(db.prepare(`PRAGMA table_info(users)`).all().map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}`).join(",") === cols0, "G3 every column, type and default is kept, in the same order");
  ok(db.prepare(`SELECT name FROM sqlite_master WHERE tbl_name = 'users' AND type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name).join(",") === idx0, "G4 the users indexes are recreated");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get().n === 1 && db.prepare(`PRAGMA foreign_key_check`).all().length === 0, "G5 nothing that points at a user is lost or left dangling");
  let agentOk = true; try { db.exec(`INSERT INTO users (id, email, password_hash, name, role) VALUES (9, 'ag@x.test', 'h', 'Ag', 'agent')`); } catch { agentOk = false; }
  let badRefused = false; try { db.exec(`INSERT INTO users (id, email, password_hash, name, role) VALUES (10, 'b@x.test', 'h', 'B', 'boss')`); } catch { badRefused = true; }
  ok(agentOk && badRefused, "G6 the role 'agent' is accepted; an unknown role is still refused");
  return out;
}

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
  const RealDate = globalThis.Date;
  let fixed = NOW;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const U = { ceo: 1, coo: 2, cco: 3, hr: 4, aina: 5, lia: 6, root: 8, shop: 9, agent: 20, agent2: 21, ed: 11 };
  const S = "JBSWY3DPEHPK3PXP";
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret, department, employment_status, joined_on, base_salary_cents) VALUES
    (1,'Alif','Alif Farhan','alif@a2z.test','ceo',1,'x',1,'${S}','Management','permanent','2020-01-01',900000),
    (2,'Ops','Ops Lead','ops@a2z.test','coo',1,'x',1,'${S}','Management','permanent','2020-01-01',800000),
    (3,'Cee','Cee Officer','cco@a2z.test','cco',1,'x',1,'${S}','Management','permanent','2020-01-01',800000),
    (4,'Hana','Hana HR','hana@a2z.test','hr_admin',1,'x',1,'${S}','HR','permanent','2020-01-01',400000),
    (5,'Aina','Aina Seller','aina@a2z.test','sales_marketing',1,'x',1,'${S}','Sales','permanent','2020-01-01',300000),
    (6,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'${S}','Sales','permanent','2020-01-01',300000),
    (8,'Root','Root','root@a2z.test','super_admin',1,'x',1,'${S}',NULL,'permanent','2020-01-01',0),
    (9,'Shop','Shop','shop@gmail.com','customer',1,'x',0,NULL,NULL,'permanent',NULL,0),
    (11,'Ed','Ed Editor','ed@a2z.test','editor',1,'x',1,'${S}','Marketing','permanent','2020-01-01',250000),
    (20,'Zul','Zul Agent','zul.agent@gmail.com','agent',1,'x',1,'${S}',NULL,'permanent','2026-10-01',0),
    (21,'Ros','Ros Agent','ros.agent@gmail.com','agent',1,'x',1,'${S}',NULL,'permanent','2026-10-01',0)`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1}')`);
  db.exec(`INSERT INTO customers (id, company, contact_person, phone, email, created_by) VALUES (1, 'ABC Sdn Bhd', 'Mr. Ahmad', '0123456789', 'ahmad@abc.test', 5)`);
  db.exec(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, salesperson_id, created_by, created_at, issuer_code) VALUES (50, 'QT', 'QT-T-50', 1, '[]', 70000, 5, 5, '2026-10-31 01:00:00', 'azoo')`);
  db.exec(`INSERT INTO sales_packages (id, name, category, description, kind, issuers, status, current_version, updated_by) VALUES
    (1, '10 Video Content', 'Video', '10 short videos', 'service', 'azoo', 'active', 1, 1),
    (2, 'Old Draft', 'Video', 'not offered', 'service', 'a2z', 'draft', 1, 1),
    (3, 'Gone Package', 'Design', 'archived', 'service', 'a2z', 'archived', 1, 1)`);
  db.exec(`INSERT INTO sales_package_versions (package_id, version, items, discount_cents, subtotal_cents, total_cents, created_by) VALUES
    (1, 1, '[{"name":"Video Content 30s","qty":10,"unit_price_cents":7000}]', 0, 70000, 70000, 1),
    (2, 1, '[]', 0, 0, 0, 1), (3, 1, '[]', 0, 0, 0, 1)`);
  db.exec(`INSERT INTO tasks (id, title, assigned_to, created_by, priority, deadline, status) VALUES
    (100, 'Promote the video package at the expo', 20, 1, 'high', '2026-11-05', 'open'),
    (101, 'Aina: follow up ABC', 5, 1, 'normal', '2026-10-30', 'in_progress'),
    (102, 'Lia: deck', 6, 1, 'normal', NULL, 'open')`);
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`));
  const app = worker.default;
  const tok = {};
  for (const id of Object.values(U)) {
    tok[id] = `t-${id}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const call = async (path, uid, method = "GET", body) => {
    const h = { "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" };
    const r = await app.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const money = () => sha(JSON.stringify([
    db.prepare(`SELECT * FROM sales_documents ORDER BY id`).all(),
    (() => { try { return db.prepare(`SELECT * FROM commission_ledger ORDER BY id`).all(); } catch { return []; } })(),
    (() => { try { return db.prepare(`SELECT * FROM payroll_entries ORDER BY rowid`).all(); } catch { return []; } })(),
    db.prepare(`SELECT id, role, base_salary_cents FROM users ORDER BY id`).all(),
  ]));
  const money0 = money();
  try {
    /* ---------- what an agent can reach ---------- */
    const tk = await call(`/staff/tasks`, U.agent);
    ok(tk.status === 200 && (tk.j?.tasks ?? []).length === 1 && tk.j.tasks[0].id === 100, "A1 an agent sees the task given to them - and only that one", tk.text.slice(0, 160));
    ok((await call(`/staff/tasks/101`, U.agent)).status >= 403, "A2 an agent cannot open somebody else's task");
    ok((await call(`/staff/tasks`, U.agent, "POST", { title: "My own", assigned_to: U.aina })).status === 403, "A3 an agent does not set tasks");
    const pk = await call(`/staff/agent/packages`, U.agent);
    ok(pk.status === 200 && pk.j?.packages?.length === 1 && pk.j.packages[0].name === "10 Video Content" && pk.j.packages[0].total_cents === 70000 && pk.j.packages[0].lines[0].qty === 10, "A4 an agent sees the ACTIVE packages to promote (no draft, no archived), with the price and what is in them", pk.text.slice(0, 200));
    for (const [p, what] of [["/staff/docs", "quotations and invoices"], ["/staff/customers", "customers"], ["/staff/commission/summary", "commission"], ["/staff/payroll/entries?month=2026-10", "payroll"], ["/staff/users", "staff accounts"], ["/staff/staff-list", "the staff list"], ["/staff/dashboard/summary", "the company dashboard"], ["/staff/packages", "the package editor library"], ["/staff/attendance", "attendance"], ["/staff/leave", "leave"], ["/staff/claims", "claims"], ["/staff/desk", "the Desk"], ["/staff/search?q=a", "search"], ["/staff/docs/50", "a quotation"]]) {
      const r = await call(p, U.agent);
      ok(r.status === 403, `A5 an agent is refused ${what} (${p})`, `${r.status}`);
    }
    ok((await call(`/staff/profile`, U.agent)).status === 200, "A6 an agent opens their own Profile");

    /* ---------- an agent submits a client ---------- */
    ok((await call(`/staff/agent/requests`, U.agent, "POST", { client_name: "Puan Rina", client_phone: "0129998888", package_id: 2 })).status === 400, "R1 a draft package cannot be requested - only active ones");
    ok((await call(`/staff/agent/requests`, U.agent, "POST", { client_name: "Puan Rina", package_id: 1 })).status === 400, "R2 a phone or an email is required so Sales can reach the client");
    const r1 = await call(`/staff/agent/requests`, U.agent, "POST", { client_name: "Puan Rina", client_phone: "0129998888", company: "Rina Bakery", package_id: 1, note: "Wants it before CNY" });
    ok(r1.status === 201 && n(`SELECT COUNT(*) AS n FROM agent_requests WHERE agent_id = 20 AND package_version = 1 AND status = 'submitted'`) === 1, "R3 an agent submits a client with the package (version kept), status Submitted (v1.250.0 statuses)", r1.text.slice(0, 120));
    const r1b = await call(`/staff/agent/requests`, U.agent, "POST", { client_name: "puan rina", client_phone: "0129998888", package_id: 1 });
    ok(r1b.j?.existing === true && n(`SELECT COUNT(*) AS n FROM agent_requests`) === 1, "R4 the same client and package twice in a day is one request");
    await call(`/staff/agent/requests`, U.agent2, "POST", { client_name: "Encik Kamal", client_email: "kamal@x.test", package_id: 1 });
    const mine = await call(`/staff/agent/requests`, U.agent);
    ok(mine.status === 200 && mine.j?.requests?.length === 1 && mine.j.requests[0].client_name === "Puan Rina", "R5 an agent sees only their own requests");
    ok((await call(`/staff/agent/requests/${n(`SELECT id AS n FROM agent_requests WHERE agent_id = 21`)}`, U.agent)).status === 404, "R6 another agent's request does not exist for them");
    ok((await call(`/staff/agent/requests`, U.aina, "POST", { client_name: "X", client_phone: "1", package_id: 1 })).status === 403, "R7 Sales do not submit as an agent");

    /* ---------- Sales reads, management edits ---------- */
    const sales = await call(`/staff/agent/requests`, U.aina);
    ok(sales.status === 200 && sales.j?.requests?.length === 2 && sales.j.can_manage === false, "S1 Sales & Marketing see every agent's request, read only");
    const rid = r1.j?.id;
    ok((await call(`/staff/agent/requests/${rid}`, U.aina, "PATCH", { status: "contacted" })).status === 403, "S2 Sales cannot edit a request");
    ok((await call(`/staff/agent/requests`, U.ed)).status === 403 && (await call(`/staff/agent/requests`, U.hr)).status === 403, "S3 an editor or HR admin does not see agents' requests");
    ok((await call(`/staff/agent/requests/${rid}`, U.coo, "PATCH", { assigned_to: U.ed })).status === 400, "S4 follow-up goes to a salesperson or management, not anyone");
    const ed = await call(`/staff/agent/requests/${rid}`, U.coo, "PATCH", { status: "under_review", assigned_to: U.aina, quotation_id: 50, manager_note: "Quoted RM700" });
    ok(ed.status === 200 && db.prepare(`SELECT status, assigned_to, quotation_id FROM agent_requests WHERE id = ?`).get(rid)?.quotation_id === 50, "S5 the COO (management) sets status, the follow-up salesperson and the quotation it became");
    const hist = await call(`/staff/agent/requests/${rid}`, U.agent);
    ok(hist.j?.history?.length === 3 && hist.j.history.every((e) => e.visibility === "agent") && !("manager_note" in (hist.j?.request ?? {})) && !("quotation_id" in (hist.j?.request ?? {})) && hist.j?.request?.status === "under_review", "S6 the agent sees what happened (the history) but never the team's private note, internal entries or the linked draft quotation", JSON.stringify(hist.j).slice(0, 300));
    let frozen = false; try { db.exec(`UPDATE agent_request_events SET kind = 'x'`); } catch { frozen = true; }
    ok(frozen, "S7 a request's history cannot be edited");

    /* ---------- agents are not staff ---------- */
    ok(!(await call(`/staff/staff-list`, U.ceo)).j?.staff?.some((s) => s.role === "agent") && (await call(`/staff/staff-list?agents=1`, U.ceo)).j?.staff?.some((s) => s.role === "agent"), "N1 agents are left out of staff pickers (never a salesperson) - and offered only where tasks are given");
    const t2 = await call(`/staff/tasks`, U.ceo, "POST", { title: "Hand out flyers", assigned_to: U.agent2 });
    ok(t2.status === 201, "N2 management can give an agent a task", t2.text.slice(0, 120));
    ok(money() === money0, "N3 no sales document, commission, payroll row or salary changes because agents exist");

    /* ---------- creating an agent ---------- */
    ok((await call(`/staff/users`, U.hr, "POST", { email: "new.agent@gmail.com", name: "New Agent", password: "a-long-password-1", role: "agent" })).status === 403, "C1 HR cannot create an agent account");
    ok((await call(`/staff/users`, U.coo, "POST", { email: "new.agent@gmail.com", name: "New Agent", password: "a-long-password-1", role: "agent" })).status === 403, "C2 the COO cannot either");
    const mk = await call(`/staff/users`, U.ceo, "POST", { email: "new.agent@gmail.com", name: "New Agent", password: "a-long-password-1", role: "agent" });
    ok(mk.status === 201 && db.prepare(`SELECT role FROM users WHERE email = 'new.agent@gmail.com'`).get()?.role === "agent", "C3 the company owner creates an agent with a personal email", mk.text.slice(0, 160));
    ok((await call(`/staff/users`, U.hr, "POST", { email: "new.staff@gmail.com", name: "New Staff", password: "a-long-password-1", role: "editor" })).status === 400, "C4 staff accounts still need the company email");

    /* ---------- task-update emails ---------- */
    ok((await call(`/staff/tasks/mail-broadcast`, U.coo, "POST", { subject: "Week plan", message: "Please update all tasks", to: "open_work" })).status === 403, "E1 the COO cannot send a task update (the CEO by default)");
    const pv = await call(`/staff/tasks/mail-broadcast`, U.ceo, "POST", { subject: "Week plan", message: "Please update all tasks today", to: "open_work", preview: true });
    ok(pv.status === 200 && pv.j?.recipients >= 3 && /Week plan/.test(pv.j?.subject ?? "") && n(`SELECT COUNT(*) AS n FROM mail_outbox WHERE kind = 'broadcast'`) === 0, "E2 the CEO previews it - nothing is queued", pv.text.slice(0, 160));
    const bc = await call(`/staff/tasks/mail-broadcast`, U.ceo, "POST", { subject: "Week plan", message: "Please update all tasks today", to: "open_work" });
    const rows = db.prepare(`SELECT user_id, body_text FROM mail_outbox WHERE kind = 'broadcast' ORDER BY user_id`).all();
    ok(bc.status === 200 && rows.length >= 3, "E3 everyone with open tasks gets one email", bc.text.slice(0, 160));
    const aina = rows.find((r) => r.user_id === 5)?.body_text ?? "";
    ok(/Please update all tasks today/.test(aina) && /Aina: follow up ABC/.test(aina) && !/Lia: deck/.test(aina) && !/expo/.test(aina), "E4 each email carries the message and ONLY that person's own tasks", aina.slice(0, 300));
    ok(/Promote the video package/.test(rows.find((r) => r.user_id === 20)?.body_text ?? ""), "E5 an agent with an open task gets theirs too");
    const again = await call(`/staff/tasks/mail-broadcast`, U.ceo, "POST", { subject: "Again", message: "Second time now", to: [5] });
    ok(again.j?.queued === 0 && again.j?.skipped?.[0]?.why === "already sent a task update this hour", "E6 once per person per hour");
    ok((await call(`/staff/tasks/mail-log`, U.cco)).status === 200 && (await call(`/staff/tasks/mail-log`, U.cco)).j?.rows?.some((r) => r.kind === "broadcast"), "E7 the CCO sees the sent updates in the log (read only)");
    ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'task.mail_broadcast'`).get().n === 2, "E8 every send is audited (the second, refused for the hour, too)");
    await worker.drainMailOutbox(env);
    ok(sent.length >= 3 && sent.every((m) => m.from === "A2Z Creative Marketing <hello@a2zcreative.my>"), "E10 the updates go out from hello@a2zcreative.my on the next pass");
  } catch (e) {
    ok(false, `the run threw: ${String(e?.stack ?? e).slice(0, 400)}`);
  } finally {
    globalThis.Date = RealDate;
  }
  return out;
}

function sourceChecks() {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const agent = readFileSync(join(root, "worker/src/agent.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+(sales_documents|customers|commission_ledger|payroll_entries|users)\b/i.test(agent), "agent.ts writes no sales document, customer, commission, payroll or user row");
  const tabs = readFileSync(join(root, "lib/portal-tabs.ts"), "utf8");
  ok(/AGENT_TABS: readonly string\[\] = \["Tasks", "Agents", "Profile"\]/.test(tabs) && /if \(role === "agent"\) return AGENT_TABS\.includes\(tab\);/.test(tabs), "an agent's menu is Tasks, Agents and Profile - above every override");
  const staff = readFileSync(join(root, "worker/src/staff.ts"), "utf8");
  ok(/export const staffRolesSql = \(alias = ""\) =>\s*`\$\{alias\}role NOT IN \('customer', 'agent', 'super_admin'\)`/.test(staff), "agents are never counted as staff (payroll, attendance, headcount)");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { if (!m) continue; n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const given = process.env.WORKER_BUNDLE;
const NOMUT = process.env.NOMUT === "1" || !!given;
if (!given) report(migrationChecks());
const dir = mkdtempSync(join(tmpdir(), "golive-g-"));
if (!given) bundle(root, join(dir, "worker.mjs"));
report(await runtime(given ?? join(dir, "worker.mjs")));
if (!given) report(sourceChecks());
const checks = n;
try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }

const MUT = [
  ["worker/src/index.ts", "the agent gate is gone", '    if (user.role === "agent" && !AGENT_STAFF_PATHS.some((rx) => rx.test(sub))) {', "    if (false) {"],
  ["worker/src/agent.ts", "an agent sees every request", "      if (!staff) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(user.id); }", "      if (false) { where.push(`r.agent_id = ?${binds.length + 1}`); binds.push(user.id); }"],
  ["worker/src/agent.ts", "Sales edits requests", "      if (!handler) return err(\"forbidden\", \"The assigned salesperson or management changes a request; Sales & Marketing read and comment\", 403);", ""],
  ["worker/src/agent.ts", "draft packages are offered", "          WHERE p.status = 'active' ORDER BY p.category, p.name`,", "          WHERE 1 = 1 ORDER BY p.category, p.name`,"],
  ["worker/src/agent.ts", "the private note reaches the agent", "        return json({ request: { ...agentView(r as unknown as Record<string, unknown>), ...base }", "        return json({ request: { ...(r as unknown as Record<string, unknown>), ...base }"],
  ["worker/src/task-mail.ts", "everyone's tasks in every email", "    `SELECT title, status, progress, deadline FROM tasks WHERE assigned_to = ?1 AND status != 'completed'", "    `SELECT title, status, progress, deadline FROM tasks WHERE (assigned_to = ?1 OR 1 = 1) AND status != 'completed'"],
  ["worker/src/task-mail.ts", "updates repeat at will", "    if (recent) { out.skipped.push({ id, why: \"already sent a task update this hour\" }); continue; }", ""],
  ["worker/src/staff.ts", "anybody sends a task update", "    if (!can(user.role, \"task_mail_send\")) return err(\"forbidden\", \"Sending a task update is for the CEO (Roles & Permissions decides)\", 403);", ""],
  ["worker/src/staff.ts", "HR creates agents", "    if (agentNew ? !mayGrant(user, \"agent\") : !can(user.role, \"hr_manage\"))", "    if (!can(user.role, \"hr_manage\"))"],
  ["worker/src/staff.ts", "agents become salespeople in the pickers", "         AND (u.role != 'agent' OR ?1 = 1)", "         AND (1 = 1 OR ?1 = 1)"],
];
for (const [file, name, from, to] of NOMUT ? [] : MUT) {
  n++;
  const srcT = readFileSync(join(root, file), "utf8");
  if (!srcT.includes(from)) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  const mdir = mkdtempSync(join(tmpdir(), "golive-g-m-"));
  cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(root, "package.json"), join(mdir, "package.json"));
  for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
  writeFileSync(join(mdir, file), srcT.replace(from, to));
  try { bundle(mdir, join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
  const res = await runtime(join(mdir, "worker.mjs"));
  try { rmSync(mdir, { recursive: true, force: true }); } catch { /* temp */ }
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
  else console.log(`caught: ${name} -> ${res.filter(([p]) => !p).slice(0, 2).map(([, m]) => m.split(" - ")[0]).join("; ")}`);
}
if (fail) { console.error(`go-live-g: ${fail} of ${n} failed${given ? ` (bundle: ${given})` : ""}`); process.exitCode = 1; }
else console.log(`go-live-g: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - the users table rebuilt with every row and column kept; an agent reaches only their own tasks, the active packages and their own requests; Sales reads and management edits the requests; agents are never staff for payroll or pickers; the owner alone creates agents; the CEO's task update gives each person only their own tasks, once an hour, audited, read by COO and CCO`);
