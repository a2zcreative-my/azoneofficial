/* v1.306.0 - HR WORKSPACE 4.0 (the CEO, 14-11-2026: "STRICT CEO DIRECTIVE -
   REMOVE DUPLICATION"; "proceed as per recommend", H-0 ... H-10 in
   claude/HR-WORKSPACE-4.0-BLUEPRINT.md). By DIRECT request against the whole
   worker on SQLite, and on the screens' source. Invented people only. Each
   rule is MUTATED.

   What must hold:
     - HR has four tabs and reads nothing Leave, Claims, Attendance, Payroll,
       Tasks or Users own; no approve / payroll action;
     - the written task report exists once, in Tasks > Reports & Archive, on
       the same route and for the same people; every old report is listed;
     - no payslip copy anywhere but Payroll; the /payslip route stays;
     - one company calendar and one holiday list - no new record type;
     - the joining checklist has one editor (HR) and keeps every step;
     - the HR audit history is HR events only, for hr_manage only;
     - no permission, tab access or table changed.

     node tests/hr4.mjs        (NOMUT=1 skips the mutations) */
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
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

async function runtime(workerBundle) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  /* the triggers hold ";" inside BEGIN ... END - apply 0194 and 0195 whole */
  for (const f of ["0194_asset_custody.sql", "0195_asset_care.sql"]) { try { db.exec(readFileSync(join(root, "worker/migrations", f), "utf8")); } catch { /* already there */ } }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes), last_row_id: Number(db.prepare("SELECT last_insert_rowid() AS id").get().id) } }),
    _run: () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = {
    DB: { prepare: shim, batch: async (list) => { db.exec("BEGIN"); try { const r = list.map((s) => s._run()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
    SESSION_PEPPER: "pepper", COMPANY_DOMAIN: "a2z.test", ALLOWED_ORIGINS: "https://portal.a2z.test",
    MEDIA: { put: async () => {}, head: async () => null, get: async () => null, list: async () => ({ objects: [] }), delete: async () => {} },
  };
  /* invented people: 1 CEO (owner), 2 super admin, 3 COO, 6 CCO, 7 HR, 9 a sales manager (15 and 16 report to 9), 17 reports to HR, 20 outside, 21 agent, 25 left */
  db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, totp_secret) VALUES
    (1,'Owner','Owner Person','owner@a2z.test','ceo',1,'x',1,'J'), (2,'Root','Root Person','root@a2z.test','super_admin',1,'x',1,'J'),
    (3,'Coo','Coo Person','coo@a2z.test','coo',1,'x',1,'J'), (6,'Cco','Cco Person','cco@a2z.test','cco',1,'x',1,'J'), (7,'Hr','Hr Person','hr@a2z.test','hr_admin',1,'x',1,'J'),
    (9,'Mgr','Aina Manager','aina@a2z.test','sales_marketing',1,'x',1,'J'), (15,'Lia','Lia Seller','lia@a2z.test','sales_marketing',1,'x',1,'J'),
    (16,'Ben','Ben Seller','ben@a2z.test','sales_marketing',1,'x',1,'J'), (17,'Eve','Eve Editor','eve@a2z.test','editor',1,'x',1,'J'),
    (20,'Out','Out Host','out@a2z.test','live_host',1,'x',1,'J'), (21,'Ros','Ros Agent','ros@a2z.test','agent',1,'x',1,'J'),
    (25,'Gone','Gone Person','gone@a2z.test','editor',0,'x',1,'J')`);
  db.exec(`UPDATE users SET reports_to = 9 WHERE id IN (15, 16); UPDATE users SET reports_to = 7 WHERE id = 17`);
  db.exec(`INSERT INTO system_meta (key, value) VALUES ('company_owner', '{"user_id":1,"set_by":2,"set_by_name":"Root","set_at":"2026-11-02 06:00:54","reason":"test"}')`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const worker = (await import(pathToFileURL(workerBundle).href + `?v=${Math.random()}`)).default;
  const tok = {};
  for (const id of [1, 2, 3, 6, 7, 9, 15, 16, 17, 20, 21]) {
    tok[id] = `t-${id}-${Math.random()}`;
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha(tok[id]), id);
  }
  const hdr = (uid) => ({ "content-type": "application/json", origin: "https://portal.a2z.test", cookie: `azone_session=${tok[uid]}; csrf_token=c1`, "x-csrf-token": "c1" });
  const call = async (path, uid, method = "GET", body) => {
    const r = await worker.fetch(new Request(`https://api.a2z.test/api/v1/staff${path}`, { method, headers: hdr(uid), body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    return { status: r.status, j, text };
  };
  const n = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0);
  const holder = (id) => db.prepare(`SELECT assigned_to FROM assets WHERE id = ?`).get(id)?.assigned_to ?? null;
  const statusOf = (id) => db.prepare(`SELECT status FROM assets WHERE id = ?`).get(id)?.status;
  const steps = (id) => db.prepare(`SELECT * FROM asset_custody WHERE asset_id = ? ORDER BY id`).all(id);
  const finance = () => ["cashflow_entries", "sales_documents", "invoice_payments", "commission_ledger", "journal_entries", "expenses"].map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");
  db.exec(`UPDATE users SET joined_on = date('now', '+8 hours', '-10 days'), onboarding_json = '{"offer_letter":true,"legacy_step":true}' WHERE id = 15`);
  /* reports written before HR 4.0 - every one must still be listed where they live now */
  db.exec(`INSERT INTO task_reports (period, report_date, content, created_by) VALUES ('daily', '2026-11-10', 'Called six hotels', 7), ('weekly', '2026-11-03', 'Week one summary', 3), ('monthly', '2026-10-01', 'October summary', 1)`);
  /* the audit log holds HR events and much else - only the HR events may come back */
  db.exec(`INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES
    (7, 'staff.letter_issue', 'hr_letters', '1', '{"ref":"A2Z/HR/2026/001"}'), (7, 'holiday.create', 'holidays', '4', NULL), (3, 'event.create', 'events', '2', NULL),
    (1, 'payroll.run', 'payroll', '1', '{"secret":"pay"}'), (1, 'asset.update', 'assets', '1', '{}'), (2, 'auth.login', 'users', '2', '{}'), (7, 'staff.document_delete', 'staff_documents', '9', '{}')`);

  try {
    /* ---- the HR audit history (H-9) ---- */
    const h = await call("/people/history", 7);
    const acts = (h.j?.entries ?? []).map((e) => e.action);
    ok(h.status === 200 && acts.includes("staff.letter_issue") && acts.includes("holiday.create") && acts.includes("event.create"), "HR reads the HR audit history", h.text.slice(0, 200));
    ok(acts.every((a) => HR_ACTIONS.includes(a)) && !/payroll|secret|auth\.login|asset\.update|document_delete/.test(h.text), "...HR events only - never payroll, sign-ins, assets or document deletions");
    ok((await call("/people/history", 3)).status === 403 && (await call("/people/history", 6)).status === 403 && (await call("/people/history", 15)).status === 403 && (await call("/people/history", 21)).status === 403, "the COO, the CCO, sales and an agent cannot read it (hr_manage, unchanged)");
    ok((await call("/people/history", 1)).status === 200 && (await call("/people/history", 2)).status === 200, "the CEO and the super admin can");

    /* ---- the written task reports, now in Tasks: the same route, the same people (H-1) ---- */
    const tr = await call("/task-reports", 7);
    ok(tr.status === 200 && tr.j.reports.length === 3 && ["Called six hotels", "Week one summary", "October summary"].every((c) => tr.text.includes(c)), "every report written before the move is still listed", tr.text.slice(0, 200));
    ok((await call("/task-reports", 3)).status === 200 && (await call("/task-reports", 6)).status === 200, "the COO and CCO still read them");
    ok((await call("/task-reports", 15)).status === 403 && (await call("/task-reports", 15, "POST", { period: "daily", report_date: "2026-11-14", content: "x" })).status === 403, "sales still cannot read or submit them (task_reports unchanged)");
    const sub = await call("/task-reports", 7, "POST", { period: "daily", report_date: "2026-11-14", content: "Moved and still working" });
    ok(sub.status === 201 && n(`SELECT COUNT(*) AS n FROM task_reports`) === 4, "HR still submits one", sub.text);

    /* ---- the joining checklist: one editor, nothing lost (H-3) ---- */
    const ov = await call("/people/overview", 7);
    const j15 = ov.j?.joining?.find((x) => x.id === 15);
    ok(j15 && j15.items?.offer_letter === true && j15.items?.legacy_step === true && !j15.open.includes("offer_letter"), "the overview sends each joiner's ticked steps, so the one editor keeps a step it does not list", JSON.stringify(j15));
    ok((await call("/users/15/onboarding", 15, "POST", { items: { contract: true } })).status === 403, "a salesperson cannot tick their own checklist (hr_manage, unchanged)");
    ok((await call("/users/15/onboarding", 7, "POST", { items: { ...j15.items, contract: true } })).status === 200 && JSON.parse(db.prepare(`SELECT onboarding_json AS j FROM users WHERE id = 15`).get().j).legacy_step === true, "HR ticks a step and the unlisted one survives");
  } catch (e) {
    out.push([false, `runtime: ${e?.stack ?? e}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

/* ---- the screens: one function, one module (source) ---- */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function sourceChecks(read) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const hr = strip(read("components/portal/hr-page.tsx")), ovw = strip(read("components/portal/hr-overview.tsx"));
  const both = hr + ovw;
  ok(/const VIEWS: readonly HrView\[\] = \["overview", "lifecycle", "calendar", "policies"\];/.test(hr) && /export type HrView = "overview" \| "lifecycle" \| "calendar" \| "policies";/.test(ovw), "HR has exactly four tabs: Overview, Employee Lifecycle, Calendar & Holidays, HR Policies & Settings");
  ok(!/\/staff\/(leave|claims|payroll|attendance|task-reports|payslip|users\?|dashboard\/ot)|\/staff\/users"|useDeskData|Approve Leave|Approve Claims|Process Payroll/.test(both), "HR reads no leave, claims, OT, attendance, payroll, task-report or role data and offers no approve / payroll action", (both.match(/\/staff\/(leave|claims|payroll|attendance|task-reports|payslip)[^"`]*/g) ?? []).join(" "));
  ok(!/PayslipCard|TaskReports|HrAdministration|"Your HR access"/.test(both), "HR draws no payslip summary, task report, launcher or permissions table");
  const all = ["components/portal/tasks.tsx", "components/portal/task-reports.tsx", "components/portal/hr-page.tsx", "components/admin/hr-admin-panel.tsx", "app/admin/page.tsx"].map((f) => strip(read(f))).join("\n");
  ok((all.match(/export function TaskReports\(/g) ?? []).length === 1 && /<TaskReports \/>/.test(strip(read("components/portal/tasks.tsx"))) && /\/staff\/task-reports/.test(read("components/portal/task-reports.tsx")), "the written task report exists ONCE, in Tasks > Reports & Archive, on the same route");
  ok(/setTabStart\(\{ tab: "Tasks", view: "reports" \}\); go\("Tasks"\);/.test(hr), "the old HR reports address is sent to Tasks > Reports & Archive");
  ok(!/function PayslipCard/.test(strip(read("components/admin/hr-admin-panel.tsx"))) && /path === "\/payslip" && method === "GET"/.test(read("worker/src/staff.ts")), "the payslip summary card is gone from HR and the admin console; its route stays (H-2, H-6)");
  ok(/<UpcomingEventsCard role=\{user\.role\} \/>/.test(hr) && /<HolidaysCard \/>/.test(hr) && !/method: "POST"[\s\S]{0,80}\/staff\/(holidays|events)|\/staff\/(holidays|events)"[\s\S]{0,40}method: "POST"/.test(hr), "the calendar is the one company calendar and the one holiday list - no second record");
  const pp = strip(read("components/portal/people-panel.tsx")), sd = strip(read("components/staff/staff-directory.tsx"));
  ok(/\/staff\/users\/\$\{id\}\/onboarding/.test(pp) && !/\/onboarding`, \{ method: "POST"/.test(sd) && /staff-onboarding-readonly/.test(sd), "the joining checklist has one editor, in HR; Staff Details shows it read-only (H-3)");
  ok(/send\(`\/staff\/users\/\$\{id\}\/onboarding`, "POST", \{ items: \{ \.\.\.items, \[key\]: on \} \}/.test(pp), "the HR editor sends the whole checklist back, so a step it does not list is kept");
  const perms = read("worker/src/permissions.ts");
  ok(['task_reports: ["super_admin", "admin", "hr_admin", "coo", "cco", "ceo"]', 'hr_manage: ["super_admin", "admin", "hr_admin", "ceo"]', 'events_manage: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"]', 'payroll_export: ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"]'].every((x) => perms.includes(x)) && read("lib/portal-tabs.ts").includes('HR: ["hr_admin", "coo", "cco", "ceo", "super_admin", "admin"],'), "no permission and no tab access changed");
  ok(/const LATEST_MIGRATION = "0195_asset_care";/.test(read("worker/src/index.ts")), "no migration: HR 4.0 adds no table");
  ok(/\/staff\/people\/history/.test(hr) && /if \(!HR\) return err\("forbidden", "HR access required", 403\);\s*const \{ results \} = await env\.DB\.prepare\(\s*`SELECT l\.id, l\.action/.test(read("worker/src/business.ts")), "the audit history is read through the one hr_manage route");
  ok(!/Illustrative|illustrative content|UI reference only/.test(both), "none of the reference's illustrative labels is copied");
  return out;
}

let fail = 0, n = 0;
const report = (list) => { for (const [p, m] of list) { n++; if (!p) { fail++; console.error(`FAIL ${m}`); } } };
const NOMUT = process.env.NOMUT === "1";
const HR_ACTIONS = JSON.parse(readFileSync(join(root, "worker/src/business.ts"), "utf8").match(/export const HR_HISTORY_ACTIONS = (\[[^\]]*\]);/)[1]);
const dir = mkdtempSync(join(tmpdir(), "hr4-"));
bundle(root, "worker/src/index.ts", join(dir, "worker.mjs"));
report(await runtime(join(dir, "worker.mjs")));
report(sourceChecks((f) => readFileSync(join(root, f), "utf8")));
const checks = n;
const B = "worker/src/business.ts";
const MUT = [
  [B, "the history without its gate", [["  if (path === \"/people/history\" && method === \"GET\") {\n    if (!HR) return err(\"forbidden\", \"HR access required\", 403);", "  if (path === \"/people/history\" && method === \"GET\") {"]]],
  [B, "the history reads the whole log", [["        WHERE l.action IN (${HR_HISTORY_ACTIONS.map((_, i) => `?${i + 1}`).join(\", \")})", "        WHERE l.action IN (${HR_HISTORY_ACTIONS.map((_, i) => `?${i + 1}`).join(\", \")}) OR 1 = 1"]]],
  [B, "the joiner's ticked steps dropped", [["joined_on: u.joined_on, items: done, open:", "joined_on: u.joined_on, open:"]]],
  ["components/portal/tasks.tsx", "the task report not drawn in Tasks", [["            <TaskReports />", ""]]],
  ["components/portal/hr-page.tsx", "a payroll link drawn as a payroll tile in HR", [["const VIEWS: readonly HrView[] = [\"overview\", \"lifecycle\", \"calendar\", \"policies\"];", "const VIEWS: readonly HrView[] = [\"overview\", \"lifecycle\", \"calendar\", \"policies\"]; const _p = \"/staff/payroll/runs\";"]]],
  ["components/staff/staff-directory.tsx", "a second checklist editor in Staff", [["data-testid=\"staff-onboarding-readonly\"", "data-testid=\"staff-onboarding\""]]],
  ["components/portal/people-panel.tsx", "the editor drops unlisted steps", [["{ items: { ...items, [key]: on } }", "{ items: { [key]: on } }"]]],
];
for (const [file, name, reps] of NOMUT ? [] : MUT) {
  n++;
  let src = readFileSync(join(root, file), "utf8");
  let applied = true;
  for (const [from, to] of reps) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
  if (!applied) { fail++; console.error(`FAIL mutation did not apply: ${name}`); continue; }
  let res;
  if (file.startsWith("worker/")) {
    const mdir = mkdtempSync(join(tmpdir(), "hr4-m-"));
    cpSync(join(root, "worker"), join(mdir, "worker"), { recursive: true, filter: (s) => !s.includes("node_modules") });
    cpSync(join(root, "package.json"), join(mdir, "package.json"));
    for (const d of ["lib", "constants", "types"]) { try { cpSync(join(root, d), join(mdir, d), { recursive: true }); } catch { /* not every folder exists */ } }
    writeFileSync(join(mdir, file), src);
    try { bundle(mdir, "worker/src/index.ts", join(mdir, "worker.mjs")); } catch { fail++; console.error(`FAIL mutation did not build: ${name}`); continue; }
    res = [...await runtime(join(mdir, "worker.mjs")), ...sourceChecks((f) => readFileSync(join(f === file ? mdir : root, f), "utf8"))];
    rmSync(mdir, { recursive: true, force: true });
  } else {
    res = sourceChecks((f) => (f === file ? src : readFileSync(join(root, f), "utf8")));
  }
  if (!res.some(([p]) => !p)) { fail++; console.error(`FAIL mutation not caught: ${name}`); }
}
rmSync(dir, { recursive: true, force: true });
if (fail) { console.error(`hr4: ${fail} of ${n} failed`); process.exit(1); }
console.log(`hr4: ${checks} checks passed (${NOMUT ? "mutations skipped" : `${MUT.length} mutations caught`}) - four HR tabs with nothing owned elsewhere; the written task report once, in Tasks, every old report kept; no payslip copy; one holiday list and one calendar; one joining-checklist editor that keeps every step; an HR-only audit history for hr_manage; no permission, tab or table changed`);
