#!/usr/bin/env node
/* v1.337.0 - TASKS > REPORTS & ARCHIVE AND THE TASK EMAIL WORKSPACE (the CEO,
   17-11-2026: "Reorganize Reports & Archive into focused views ... Move Submit
   Report into a clickable modal/drawer ... Fix the broken email preview ...
   Keep email configuration in an appropriate authorized settings workspace. Do
   not create duplicate notification engines").

   What this holds, in the source (the email engine's behaviour - triggers,
   recipients, the record link only for someone who may open it - is
   tests/go-live-m.mjs, run against the whole worker):
     W1  Reports & Archive is ONE strip, ONE view switch and four views -
         Submitted Reports, Team Performance, Completed Tasks, Task History -
         each hidden, never unmounted; reports for task_reports, the team for
         the managing roles
     W2  Submit Report is a drawer; daily, weekly and monthly stay; the same
         POST /staff/task-reports; a failed submit keeps the draft and says why
     W3  Task History reads the existing activity route - no new read, no write
     W4  the task email settings left Tasks for System > Automation & Rules,
         drawn for the CEO, COO, CCO and super admin only (as on Tasks)
     W5  the preview is fetched and drawn with srcDoc in a sandboxed frame; the
         API keeps X-Frame-Options: DENY (the cause of the broken preview was an
         iframe src pointed at the API)
     W6  nothing claims delivery: "Accepted by Cloudflare", the sender "proven"
         only by an accepted message, and Send test disabled until configured
     W7  one engine: the workspace calls only the existing task-mail routes
   Each rule is proven to catch its own breakage (the mutation pass).

     node tests/task-email-workspace.mjs     (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = {
  tasks: "components/portal/tasks.tsx", reports: "components/portal/task-reports.tsx", history: "components/portal/task-history.tsx",
  mail: "components/portal/task-mail-panel.tsx", auto: "components/portal/automation-rules.tsx", index: "worker/src/index.ts", page: "app/portal/page.tsx",
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const { tasks, reports, history, mail, auto, index, page } = src;
  const zone = tasks.slice(tasks.indexOf("{/* ============================ REPORTS & ARCHIVE"), tasks.indexOf("{/* ========================== CREATE / ASSIGN TASK"));
  /* W1 */
  ok("W1 one strip of four: Reports Submitted, Awaiting Review, Archived Tasks, Task Attention",
    (zone.match(/<KpiTile /g) ?? []).length === 4 && ['cell="submitted"', 'cell="awaiting"', 'cell="archived"', 'cell="attention"'].every((c) => zone.includes(c)) && /<KpiRow label=\{L\("Reports figures"/.test(zone));
  ok("W1 one view switch, four views in the brief's order, each for whom it was drawn before",
    /<PillSwitch testid="rep-view"/.test(zone)
    && /\.\.\.\(canTaskReports \? \[\["reports", L\("Submitted Reports"[\s\S]*?\.\.\.\(canManage \? \[\["team", L\("Team Performance"[\s\S]*?\["completed", L\("Completed Tasks"[\s\S]*?\["history", L\("Task History"/.test(tasks));
  ok("W1 only the active view shows; the others are hidden, never unmounted",
    ['hidden={rep !== "reports"}', 'hidden={rep !== "team"}', 'hidden={rep !== "completed"}', 'hidden={rep !== "history"}'].every((h) => zone.includes(h)));
  ok("W1 the old anchors still land: task-archive opens Completed Tasks, task-reports opens Submitted Reports",
    /if \(anchor === "task-archive"\) \{ setRepView\("completed"\); return; \}/.test(tasks) && /if \(anchor === "task-reports"\) \{ setRepView\("reports"\); return; \}/.test(tasks));
  /* W2 */
  ok("W2 Submit Report is a drawer from the register's head; daily, weekly and monthly stay",
    /<SideDrawer open=\{formOpen\}/.test(reports) && /data-testid="report-submit-open"/.test(reports)
    && /<option value="daily">/.test(reports) && /<option value="weekly">/.test(reports) && /<option value="monthly">/.test(reports));
  ok("W2 the same route, and a failed submit keeps the draft and says why",
    /api<\{ error\?: \{ message\?: string \} \}>\(`\/staff\/task-reports`, \{ method: "POST", body: JSON\.stringify\(draft\) \}\)/.test(reports)
    && /if \(!res\.ok\) \{ setProblem\(/.test(reports) && !/window\.alert/.test(reports));
  ok("W2 the review stays management's, never the author's", /can\.review && !reviewed\(shown\) && shown\.created_by !== can\.me/.test(reports));
  /* W3 */
  ok("W3 Task History reads the existing activity route and writes nothing",
    /api<\{ activity: Ev\[\]; error\?: \{ message\?: string \} \}>\(`\/staff\/tasks\/\$\{shown\.id\}\/activity`\)/.test(history) && !/method: "(POST|PUT|PATCH|DELETE)"/.test(history));
  /* W4 */
  ok("W4 the task email settings left Tasks (one link to the settings workspace)",
    !/<TaskMailPanel|TaskEmailSettings|task-mail-panel/.test(strip(tasks)) && /setTabStart\(\{ tab: "Automation & Rules", view: "email" \}\)/.test(tasks));
  ok("W4 in System > Automation & Rules, for the CEO, COO, CCO and super admin only",
    /const MAIL_ROLES = \["ceo", "coo", "cco", "super_admin"\];/.test(auto) && /\{mail && \(\s*<div hidden=\{view !== "email"\}>/.test(auto) && /<TaskEmailSettings \/>/.test(auto) && /<TaskEmailLog \/>/.test(auto)
    && /initialView=\{startOf\("Automation & Rules"\)\}/.test(page));
  /* W5 */
  ok("W5 the preview is read as text and drawn with srcDoc in a sandboxed frame, never an iframe src at the API",
    /fetch\(`\/api\/v1\/staff\/tasks\/mail-preview\?kind=\$\{kind\}`, \{ credentials: "include" \}\)/.test(mail) && /srcDoc=\{shown\.html\} sandbox=""/.test(mail) && !/src=\{`\/api\/v1\/staff\/tasks\/mail-preview/.test(mail));
  ok("W5 the API keeps X-Frame-Options: DENY", /headers\.set\("X-Frame-Options", "DENY"\);/.test(index));
  /* W6 */
  ok("W6 nothing claims delivery: accepted is Cloudflare's, the sender is proven only by an accepted message, the test waits for configuration",
    /accepted: L\("Accepted by Cloudflare"/.test(mail) && /const proven = dg\?\.last_test\?\.status === "accepted" \|\| !!dg\?\.last_accepted;/.test(mail)
    && /disabled=\{busy !== null \|\| !ready\}/.test(mail) && /only a received message proves delivery/.test(mail));
  /* W7 */
  const routes = [...strip(mail).matchAll(/["`]\/(?:api\/v1\/)?staff\/([a-z/\-]+)/g)].map((m) => m[1]);
  ok("W7 one engine: only the existing task-mail routes (and the staff list for choosing people)",
    routes.length > 0 && routes.every((r) => /^tasks\/mail-(settings|log|preview|test|broadcast)|^tasks\/mail-log\/$|^staff-list$/.test(r)), routes.join(", "));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["two views shown at once", "tasks", 'hidden={rep !== "history"}', 'hidden={false}'],
  ["the archive anchor lost", "tasks", 'if (anchor === "task-archive") { setRepView("completed"); return; }', ""],
  ["Submit Report back on the page", "reports", "<SideDrawer open={formOpen}", "<div data-open={formOpen}"],
  ["monthly reporting dropped", "reports", '<option value="monthly">', '<option value="month">'],
  ["a failed submit loses the draft", "reports", "if (!res.ok) { setProblem(", "if (!res.ok) { setDraft((d) => ({ ...d, content: \"\" })); setProblem("],
  ["the settings back on Tasks", "tasks", '<div hidden={rep !== "history"} data-testid="task-history">', '<TaskMailPanel />\n        <div hidden={rep !== "history"} data-testid="task-history">'],
  ["the Admin sees task email", "auto", 'const MAIL_ROLES = ["ceo", "coo", "cco", "super_admin"];', 'const MAIL_ROLES = ["ceo", "coo", "cco", "super_admin", "admin"];'],
  ["the preview back to iframe src", "mail", "srcDoc={shown.html} sandbox=\"\"", "src={`/api/v1/staff/tasks/mail-preview?kind=${kind}`} sandbox=\"\""],
  ["DENY dropped to make the preview work", "index", 'headers.set("X-Frame-Options", "DENY");', 'headers.set("X-Frame-Options", "SAMEORIGIN");'],
  ["a test before the sender exists", "mail", "disabled={busy !== null || !ready}", "disabled={busy !== null}"],
  ["a second engine", "mail", 'void api<SettingsReply & { error?: { message?: string } }>("/staff/tasks/mail-settings")', 'void api<SettingsReply & { error?: { message?: string } }>("/staff/notifications/email-settings")'],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\ntask-email-workspace: ${failed.length} failed`); process.exit(1); }
console.log(`task-email-workspace: ${res.length} checks passed (${caught} mutations caught)`);
