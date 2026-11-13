/* v1.293.0 - A2Z OS DESK CONSOLIDATION (the CEO's directive, 12-11-2026;
   decisions K1-K4 and D1-D6; claude/DESK-CONSOLIDATION-BLUEPRINT.md).

   What this holds, in the source (the browser half is tests/browser/desk5.py):
     - exactly two views, Overview and Action Inbox, the view in the address
       (tab and view only);
     - no Quick Actions card; Introduce a lead and Report a problem kept on the
       greeting line (D1); Active Alerts only for the roles that read the
       rules (D2); Overdue counts decisions and responses, not tasks (D3);
     - Priority Actions are five, overdue first; My Tasks are three;
     - the Desk writes nothing and calls no decide route: a row OPENS the
       record (K2), the exact record where the module can open one;
     - no severity is shown (none is recorded, K3);
     - Completed is read only when chosen, from a route that reads only the
       signed-in person's own decisions and writes nothing (D5);
     - the watcher rules are System -> Automation & Rules (D4), for the five
       roles that read them today; the server still lets only the CEO and the
       super admin change one.
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/desk5.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const FILES = {
  desk: "components/portal/desk-page.tsx",
  css: "components/portal/desk-page.module.css",
  view: "lib/tab-view.ts",
  tabs: "lib/portal-tabs.ts",
  auto: "components/portal/automation-rules.tsx",
  watchCard: "components/portal/watchers-card.tsx",
  worker: "worker/src/desk.ts",
  staff: "worker/src/staff.ts",
  watchers: "worker/src/watchers.ts",
  page: "app/portal/page.tsx",
};
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ""; const j = s.indexOf(b, i + a.length); return s.slice(i, j < 0 ? s.length : j); };

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const desk = strip(src.desk), view = strip(src.view), tabs = strip(src.tabs), auto = strip(src.auto), card = strip(src.watchCard);
  const worker = strip(src.worker), staff = strip(src.staff), page = strip(src.page);

  /* ---- two views, in the address ---- */
  ok("exactly two views, Overview and Action Inbox",
    /const isDeskView = \(v: string \| null\): v is View => v === "overview" \|\| v === "inbox";/.test(desk) && /type View = "overview" \| "inbox";/.test(desk)
    && (between(desk, "<LineTabs value={view}", "/>").match(/\["[a-z]+", L\(/g) ?? []).length === 2);
  ok("the view is in the address (tab and view only), so Back and Forward move between them",
    /useTabViewAddress\("Desk", view, setView, isDeskView\);/.test(desk)
    && (between(view, "export function tabViewUrl(", "\n}\n").match(/searchParams\.set\(/g) ?? []).length === 2
    && /window\.history\.pushState\(\{ tabView: view \}, "", tabViewUrl\(tab, view\)\)/.test(view) && /window\.addEventListener\("popstate", onPop\)/.test(view)
    && /startView=\{startOf\("Desk"\)\}/.test(page));
  ok("tabs on a wide screen, one selector on a phone",
    /<div className="erp-desktop-only" data-testid="desk-tabs">\s*<LineTabs/.test(desk) && /data-testid="desk-view-bar">\s*<ViewSwitch/.test(desk));

  /* ---- the Overview ---- */
  ok("K1 - no Quick Actions card", !/Quick actions|Tindakan pantas|css\.qa\b|qaGrid/.test(desk));
  ok("D1 - Introduce a lead and Report a problem stay, on the greeting line",
    /<IntroduceLeadAction trigger=\{\(open\) => linkBtn\(L\("Introduce a lead"/.test(desk) && /<ReportProblem tab="Desk" trigger=\{\(open\) => linkBtn\(L\("Report a problem"/.test(desk)
    && desk.indexOf('data-testid="desk-greet"') < desk.indexOf("<IntroduceLeadAction") && desk.indexOf("<ReportProblem") < desk.indexOf('data-testid="desk-figures"'));
  ok("D2 - Active Alerts only for the roles that read the rules; three figures otherwise",
    /\{p\.exec && figure\("alerts", "warning", "info"/.test(desk) && /data-figures=\{p\.exec \? 4 : 3\}/.test(desk) && /const exec = WATCHER_ROLES\.includes\(user\.role\);/.test(desk));
  ok("D3 - Overdue Actions counts decisions and responses, never my tasks twice",
    /const work = \[\.\.\.decide, \.\.\.attention\]\.sort\(byPriority\);/.test(desk) && /const overdueN = work\.filter\(\(i\) => i\.overdue\)\.length;/.test(desk)
    && /figure\("overdue", "time", "bad", p\.known \? p\.overdueN : null/.test(desk));
  ok("every figure is the length of the list it opens",
    /figure\("decide", "orders", "gold", p\.known \? p\.decide\.length : null/.test(desk) && /\(\) => p\.toInbox\("decide"\)\)/.test(desk)
    && /figure\("tasks", "success", "ok", p\.known \? p\.myTasks\.length : null/.test(desk) && /findings=\{findings\.length\}/.test(desk));
  ok("Priority Actions: five, overdue first then the longest waiting; My Tasks: three",
    /const PRIORITY = 5;/.test(desk) && /p\.work\.slice\(0, PRIORITY\)/.test(desk) && /const MY_TASKS = 3;/.test(desk)
    && /const byPriority = \(a: DeskItem, b: DeskItem\) => \(a\.overdue === b\.overdue \? \(a\.since \?\? ""\)\.localeCompare\(b\.since \?\? ""\) : a\.overdue \? -1 : 1\);/.test(desk));
  ok("K3 - no severity is shown (none is recorded); an alert is a count and its oldest",
    !/severity|Severity|keterukan/.test(desk) && /<strong>\{g\.label\} — \{g\.n\}<\/strong>/.test(desk) && /oldest \$\{waited\(g\.oldest\)\}/.test(desk));

  /* ---- what the Desk may not do ---- */
  ok("K2 - the Desk writes nothing and calls no decide route",
    !/\bapi\(|makeApi|csrfFetch|method:\s*"(POST|PATCH|PUT|DELETE)"/.test(desk) && !/\/decide|\/approve|\/reject|\/ack\b/.test(desk));
  const rec = between(desk, "export function recordOf(", "\n}\n");
  ok("K2 - a row opens the record itself where the module can (Leave, Claims, Tasks, a quotation, News, stock), else the module",
    /case "leave": return \{ tab: "Leave", kind: "leave", id: n \};/.test(rec) && /case "claim": return \{ tab: "Claims", kind: "claim", id: n \};/.test(rec)
    && /case "task": case "task-close": return \{ tab: "Tasks", kind: "task", id: n \};/.test(rec) && /case "quote": return \{ tab: "Sales", kind: "document", id: n \};/.test(rec)
    && /case "announcement": return \{ tab: "Announcements", kind: "announcement", id: n \};/.test(rec) && /case "stock": return \{ tab: "Inventory", kind: "stock", id: n \};/.test(rec)
    && /if \(r\) \{ openRecord\(r\.tab, r\.kind, r\.id\); go\(r\.tab\); return; \}\s*go\(tab\);/.test(desk));
  ok("the inbox's four lists are the desk's own split and the watchers' own findings - nothing invented",
    /const rows: InboxRow\[\] = \[\.\.\.decide\.map\(\(i\) => fromItem\(i, "decide"\)\), \.\.\.attention\.map\(\(i\) => fromItem\(i, "respond"\)\), \.\.\.findings\.map\(fromFinding\)\];/.test(desk)
    && /const findings: Finding\[\] = useMemo\(\(\) => \(exec \? watch\.data\?\.open \?\? \[\] : \[\]\), \[exec, watch\.data\]\);/.test(desk));
  ok("an inbox row shows request + reference, module, requester, submitted, waiting, priority, status and the next action",
    ["Request", "Module", "Requester / owner", "Submitted", "Waiting", "Priority", "Status", "Next action"].every((w) => desk.includes(`L("${w}"`))
    && /const PAGE = 20;/.test(desk) && /placeholder=\{L\("Search request, reference or person/.test(desk));

  /* ---- Completed ---- */
  ok("D5 - Completed is read only when it is chosen",
    /useCachedApi<\{ items: Done\[\]; days: number \}>\("\/staff\/desk\/completed", filter === "done"/.test(desk));
  const done = between(worker, "export async function deskCompleted(", "\nexport async function handleDeskCompleted(");
  ok("the Completed route reads only the signed-in person's own decisions",
    /WHERE d\.actor_id = \?1 AND/.test(done) && /WHERE user_id = \?1 AND action IN/.test(done)
    && (done.match(/\.bind\(user\.id, since/g) ?? []).length === 2);
  ok("the Completed route writes nothing", done.length > 1500 && !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(done.replace(/\/\*[\s\S]*?\*\//g, "")) && !/audit\(/.test(done));
  ok("the route is a GET behind the staff sign-in", /if \(path === "\/desk\/completed" && method === "GET"\) \{\s*return handleDeskCompleted\(env, user, new URL\(request\.url\)\.searchParams\);/.test(staff));

  /* ---- Automation & Rules ---- */
  ok("D4 - the rules are System -> Automation & Rules, for the five roles that read them today",
    /\{ id: "system", title: "System", tabs: \["Companies", "Users", "Automation & Rules"\] \}/.test(tabs)
    && /"Automation & Rules": \["ceo", "coo", "cco", "super_admin", "admin"\],/.test(tabs)
    && /<WatchersCard role=\{role\} go=\{go\} section="rules" bare \/>/.test(auto)
    && /\{activeTab === "Automation & Rules" && <AutomationRulesPage role=\{user\.role\}/.test(page));
  ok("D4 - only the CEO and the super admin change a rule, on the screen and on the server",
    /const canEdit = role === "ceo" \|\| role === "super_admin";/.test(card)
    && /if \(user\.role !== "ceo" && user\.role !== "super_admin"\) return json\(\{ error: \{ code: "forbidden", message: "Only the CEO changes a watcher" \} \}, 403\);/.test(strip(src.watchers)));
  ok("the rules left the Desk", !/section="rules"/.test(desk) && !/L\("Watcher Settings"/.test(desk));
  return res;
}

/* ---- the Completed route, run for real against SQLite with every migration ---- */
import { readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
async function runtime() {
  const out = [];
  const ok = (name, c, d = "") => out.push([name, Boolean(c), d]);
  const dir = mkdtempSync(join(tmpdir(), "desk5-"));
  const bundle = join(dir, "desk.mjs");
  execSync(`npx esbuild "${join(root, "worker/src/desk.ts")}" --bundle --format=esm --platform=neutral --outfile="${bundle}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const st of readFileSync(join(root, "worker/migrations", f), "utf8").split(/;\s*\n/)) { try { db.exec(st); } catch { /* a statement SQLite reads differently */ } }
  }
  const shim = (sql) => { const st = db.prepare(sql); let b = []; const o = {
    bind: (...a) => { b = a.map((x) => (x === undefined ? null : x)); return o; },
    first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }),
    run: async () => ({ meta: { changes: Number(st.run(...b).changes) } }) }; return o; };
  const env = { DB: { prepare: shim } };
  db.exec(`INSERT INTO users (id, name, email, role, is_active, password_hash) VALUES (1,'Chief','c@x.t','ceo',1,'x'),(2,'Ops','o@x.t','coo',1,'x'),(3,'Aina','a@x.t','sales_marketing',1,'x')`);
  db.exec(`INSERT INTO leave_requests (id, user_id, type, start_date, end_date, days, status) VALUES (1,3,'annual','2026-11-02','2026-11-03',2,'approved')`);
  db.exec(`INSERT INTO leave_decisions (leave_id, step_no, kind, actor_id, created_at) VALUES (1,1,'approved',1,datetime('now','-2 days')),(1,1,'returned',2,datetime('now','-3 days')),(1,1,'resubmitted',3,datetime('now','-3 days'))`);
  db.exec(`INSERT INTO claims (id, user_id, claim_date, amount_cents, status) VALUES (1,3,'2026-11-01',8640,'rejected')`);
  db.exec(`INSERT INTO audit_log (user_id, action, entity, entity_id, detail, created_at) VALUES
    (1,'claim.reject','claims','1',NULL,datetime('now','-1 days')),
    (2,'claim.approve','claims','1',NULL,datetime('now','-1 days')),
    (1,'ot.decide','users','3','{"date":"2026-11-05","decision":"replacement"}',datetime('now','-1 days')),
    (1,'leave.apply','leave_requests','1',NULL,datetime('now','-1 days')),
    (1,'claim.approve','claims','1',NULL,datetime('now','-60 days'))`);
  const count = () => db.prepare(`SELECT (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM leave_decisions) + (SELECT COUNT(*) FROM claims) AS n`).get().n;
  const before = count();
  const { deskCompleted } = await import(pathToFileURL(bundle).href + `?v=${Math.random()}`);
  const mine = await deskCompleted(env, { id: 1 });
  const ids = mine.items.map((i) => `${i.tab}:${i.decision}`).sort();
  ok("Completed (run): the CEO sees exactly his own three decisions of the last 30 days", JSON.stringify(ids) === JSON.stringify(["Attendance:approved", "Claims:rejected", "Leave:approved"]), ids.join(","));
  ok("Completed (run): a leave decision opens the leave record; a claim opens the claim", mine.items.some((i) => i.tab === "Leave" && i.record?.kind === "leave" && i.record.id === 1) && mine.items.some((i) => i.tab === "Claims" && i.record?.kind === "claim" && i.who === "Aina"));
  ok("Completed (run): overtime given as replacement leave reads approved, with replacement leave said", mine.items.some((i) => i.tab === "Attendance" && /replacement leave/.test(i.title)));
  const coo = await deskCompleted(env, { id: 2 });
  ok("Completed (run): the COO sees only his own (a return and an approval), never the CEO's", coo.items.length === 2 && coo.items.every((i) => ["returned", "approved"].includes(i.decision)), coo.items.map((i) => i.decision).join(","));
  const staff = await deskCompleted(env, { id: 3 });
  ok("Completed (run): a person who decided nothing sees nothing (a resubmission is not a decision)", staff.items.length === 0, staff.items.length);
  ok("Completed (run): reading wrote nothing", count() === before);
  return out;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = [...checks(base), ...(await runtime())];
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["a third view", "desk", 'type View = "overview" | "inbox";', 'type View = "overview" | "inbox" | "settings";'],
  ["a record put in the address", "view", 'u.searchParams.set("view", view);', 'u.searchParams.set("view", view);\n  u.searchParams.set("rec", "1");'],
  ["views no longer history entries", "view", 'else if (cur !== view) window.history.pushState({ tabView: view }, "", tabViewUrl(tab, view));', 'else if (cur !== view) window.history.replaceState({ tabView: view }, "", tabViewUrl(tab, view));'],
  ["the Quick Actions card back", "desk", '<TabZone label={L("At a glance", "Sepintas lalu")}>', '<TabZone label={L("At a glance", "Sepintas lalu")}><section>{L("Quick actions", "Tindakan pantas")}</section>'],
  ["Report a problem dropped", "desk", '<ReportProblem tab="Desk" trigger={(open) => linkBtn(L("Report a problem", "Laporkan masalah"), open)} />', ""],
  ["Active Alerts shown to everyone", "desk", '{p.exec && figure("alerts", "warning", "info"', '{figure("alerts", "warning", "info"'],
  ["tasks counted as overdue actions", "desk", "const work = [...decide, ...attention].sort(byPriority);", "const work = [...decide, ...attention, ...myTasks].sort(byPriority);"],
  ["ten priority actions", "desk", "const PRIORITY = 5;", "const PRIORITY = 10;"],
  ["a severity invented", "desk", "<strong>{g.label} — {g.n}</strong>", "<strong>{g.label} — {g.n} · severity high</strong>"],
  ["an approve call from the Desk", "desk", "const toInbox = (f: InboxFilter) =>", "const approve = () => fetch(\"/staff/leave/1/approve\", { method: \"POST\" });\n  const toInbox = (f: InboxFilter) =>"],
  ["a row that only opens the tab", "desk", "if (r) { openRecord(r.tab, r.kind, r.id); go(r.tab); return; }", "if (r) { go(r.tab); return; }"],
  ["invented inbox rows", "desk", "...findings.map(fromFinding)];", "...findings.map(fromFinding), { key: \"x\" } as unknown as InboxRow];"],
  ["Completed read on every visit", "desk", '"/staff/desk/completed", filter === "done"', '"/staff/desk/completed", true'],
  ["someone else's decisions listed", "worker", "WHERE user_id = ?1 AND action IN", "WHERE action IN"],
  ["a write in the Completed route", "worker", "items.sort((x, y) =>", "await env.DB.prepare(`UPDATE audit_log SET detail = NULL`).run();\n  items.sort((x, y) =>"],
  ["the rules shown to every role", "tabs", '"Automation & Rules": ["ceo", "coo", "cco", "super_admin", "admin"],', '"Automation & Rules": ["ceo", "coo", "cco", "super_admin", "admin", "sales_marketing"],'],
  ["the COO allowed to change a rule", "watchCard", 'const canEdit = role === "ceo" || role === "super_admin";', 'const canEdit = role === "ceo" || role === "super_admin" || role === "coo";'],
  ["the rules back on the Desk", "desk", "</TabPage>", '<WatchersCard role={user.role} go={go} section="rules" bare /></TabPage>'],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\ndesk5: ${failed.length} failed`); process.exit(1); }
console.log(`desk5: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
