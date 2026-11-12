#!/usr/bin/env node
/* Guard - v1.209.0: ONE TASK RECORD, ONE SOURCE OF TRUTH, MULTIPLE CONNECTED
 * VIEWS.
 *
 * The owner's Tasks brief, 25-10-2026, and the audit before it. He approved
 * the screen plan, Edit through the route that already exists, "not now" for
 * comments, and "not now, add a guard" for the two server reads (a task's
 * event trail; the archive past the newest 200). So this guard holds:
 *
 *   1. ONE API. The Tasks page reads and writes only the task routes that
 *      exist (list, create, update, delete, checklist, tick, acknowledge). No
 *      comment call from any screen, no new task route in the worker.
 *   2. EDIT IS THE EXISTING UPDATE. The drawer's Save sends the changed
 *      fields through the same update() and PATCH /staff/tasks/:id the status
 *      control uses; reassignment is offered to managers only and the worker
 *      still refuses it to everyone else.
 *   3. CREATE IS THE SAME CREATE, now in a drawer from the + button (and the
 *      Dashboard's quick action still opens it).
 *   4. THE CALENDAR IS THE DEADLINES ALREADY LOADED - no request, no event.
 *   5. THE THREE STATUSES ARE THE THREE THERE ARE (open, in_progress shown
 *      as In progress since v1.247.1 (it was "Pending" - the project table and the task drawer said In Progress), completed shown as Closed).
 *   6. A COUNT AND ITS LIST AGREE. The Reports card's "Not acknowledged"
 *      list uses the server's rule (set by someone else, not closed, no ack),
 *      not a field the API never sent.
 *   7. THE ARCHIVE SAYS HOW FAR BACK IT GOES - the same 200 / 100 the board
 *      read is limited to.
 *   8. A search hit, a notification or a Desk item opens the task's drawer.
 *
 * Negative-tested by: a GET of /comments from tasks.tsx (1); a PATCH from the
 * drawer that is not update() (2); a fetch in the calendar (4); a "review"
 * status (5); the old acknowledged_at filter (6); LIMIT 300 on the server (7).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\{\s*\}/g, "{}");

const src = read("components/portal/tasks.tsx");
const code = strip(src);
const staff = read("worker/src/staff.ts");

/* ---- 1. one API ---- */
{
  const calls = [...code.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`/g)].map((m) => m[1]);
  const allowed = [/^\/staff\/tasks$/, /^\/staff\/tasks\/\$\{id\}\/items$/, /^\/staff\/tasks\/\$\{taskId\}\/items\/\$\{itemId\}\/toggle$/, /^\/staff\/tasks\/\$\{taskId\}\/items$/,
    /^\/staff\/tasks\/\$\{id\}\/ack$/, /^\/staff\/tasks\/\$\{id\}$/, /^\/staff\/tasks\/\$\{t\.id\}$/, /^\/staff\/tasks\/\$\{focusedTask\}\/items$/,
    /* v1.246.0 (audit A9) - the archive pages the closed tasks past the board's newest 300 */
    /^\/staff\/tasks\?archive=1\$\{canManage \? "&all=1" : ""\}\$\{qs\}$/,
    /* v1.246.2 - the quotations a task is set under; the checklist edited (add, rename, remove) */
    /^\/staff\/projects\/quotations$/, /^\/staff\/projects\?scope=\$\{sc\}$/, /* v1.250.1 - the Deadlines calendar reads the project list (projects.ts GET /projects) */ /^\/staff\/tasks\/\$\{t\.id\}\/items$/, /^\/staff\/tasks\/\$\{t\.id\}\/items\/\$\{renaming\.id\}$/, /^\/staff\/tasks\/\$\{t\.id\}\/items\/\$\{it\.id\}$/];
  const odd = calls.filter((c) => !allowed.some((re) => re.test(c)));
  ok("the Tasks page calls only the task routes that exist", calls.length >= 7 && odd.length === 0, odd.join(", "));
  ok("…and reads the board through the one cached read the Dashboard shares", /useCachedApi<\{ tasks: Task\[\] \}>\(`\/staff\/tasks\$\{canManage \? "\?all=1" : ""\}`, true, \["tasks"\]\)/.test(code));
  const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []);
  const commenters = [...walk("components"), ...walk("app"), ...walk("lib")].filter((f) => /tasks\/\$\{[^}]+\}\/comments/.test(read(f)));
  /* v1.246.0 - the owner's brief of 01-11-2026 (part 8) asked for the comments: ONE component reads and posts them */
  ok("one screen reads and posts task comments - the task's Updates & Comments (task-progress.tsx)", commenters.length === 1 && /task-progress\.tsx$/.test(commenters[0] ?? ""), commenters.join(", "));
  const routes = staff.split("path.match(/^\\/tasks").slice(1).map((x) => x.slice(0, x.indexOf("$/"))).sort();
  const want = ["\\/(\\d+)", "\\/(\\d+)\\/ack", "\\/(\\d+)\\/comments", "\\/(\\d+)\\/items", "\\/(\\d+)\\/items(?:\\/(\\d+))?", "\\/(\\d+)\\/items\\/(\\d+)\\/toggle", "\\/(\\d+)\\/remind", "\\/mail-log\\/(\\d+)\\/retry"].sort(); // v1.247.0 - the manual reminder and the email retry; v1.246.2 - the checklist edit route (POST add, PATCH rename, DELETE remove)
  ok("the worker's task routes are the ones there were (no events or archive read)", JSON.stringify(routes) === JSON.stringify(want), JSON.stringify(routes));
}

/* ---- 2. edit is the existing update ---- */
{
  const drawer = code.slice(code.indexOf("const saveEdit = async"), code.indexOf("return (", code.indexOf("const saveEdit = async")));
  ok("Save sends the changed fields through update()", /if \(await update\(t\.id, patch\)\) setEditing\(null\);/.test(drawer) && !/api\(|csrfFetch|method:/.test(drawer));
  ok("reassignment is offered to managers only", /if \(canManage && editing\.assigned_to && editing\.assigned_to !== t\.assigned_to\) patch\.assigned_to = editing\.assigned_to;/.test(drawer) && /\{canManage && \(\s*<Sub t=\{L\("Assigned to"/.test(code));
  /* v1.289.0 (T1) - and only while the task is open: a closed task is reopened first */
  ok("Edit is shown to the assignee or a manager while the task is open (the route's own rule)", /const canEdit = \(mine \|\| canManage\) && t\.status !== "completed";/.test(code) && /if \(row\.status === "completed"\) return err\("reopen_required", "This task is closed/.test(staff) && /const manages = projOfTask \? !projGate : can\(user\.role, "team_manage"\);/.test(staff) && /if \(row\.assigned_to !== user\.id && !manages\) \{\s*return projGate \?\? err\("forbidden", "Not your task", 403\);/.test(staff)); // v1.246.0 (T-4) - a project task: its Owner and project_manage only
  ok("…and the worker still refuses a reassignment to anyone else", /if \(!manages\) \{\s*return err\("forbidden", "Only management \(or the Project Owner, on a project task\) can reassign a task", 403\);/.test(staff)); // v1.246.0 (T-4)
  ok("update() is the one PATCH on the task; the checklist rename is the other (v1.246.2)", (code.match(/method: "PATCH"/g) ?? []).length === 2 && /items\/\$\{renaming\.id\}`, \{ method: "PATCH"/.test(code));
}

/* ---- 3. create is the same create ---- */
{
  ok("one create(), one POST", (code.match(/method: "POST",\s*body: JSON\.stringify\(payload\)/g) ?? []).length === 1 && (code.match(/const create = async/g) ?? []).length === 1);
  ok("the + button and the Dashboard's quick action open the create drawer", /<TabAction icon="add" onClick=\{\(\) => setCreateOpen\(true\)\}>/.test(code) && /useState\(\(\) => initialView === "create"\)/.test(code) && /<SideDrawer open=\{createOpen\}/.test(code));
}

/* ---- 4. the calendar is the deadlines already loaded ---- */
{
  const cal = code.slice(code.indexOf('L("Deadlines", "Tarikh akhir")') - 400, code.indexOf("REPORTS & ARCHIVE") > 0 ? code.indexOf('aria-label={L("Reports and archive"') : undefined);
  const block = src.slice(src.indexOf("=== CALENDAR ==="), src.indexOf("=== REPORTS & ARCHIVE ==="));
  ok("the Calendar reads the board's own rows", /const scope = canManage \? tasks : myTasks;/.test(block) && /t\.deadline && t\.deadline\.startsWith\(calMonth\)/.test(block));
  ok("…makes no request and writes nothing", !/\bapi\(|useCachedApi|fetch\(|method:/.test(strip(block)) && cal.length > 0);
  ok("…and a task on it opens the task", /onClick=\{\(\) => void openChecklist\(t\.id\)\}/.test(block));
}

/* ---- 5. the three statuses ---- */
{
  const sel = code.slice(code.indexOf("const statusSelect"), code.indexOf("const ackControl"));
  /* v1.256.0 (claude/TASK-CLOSURE-AUDIT.md D4) - the row's status is shown, not chosen: the dropdown that
     closed and reopened with no summary or reason is gone; Update opens the one Add Status Update form */
  ok("the status control shows the state and one Update action - no dropdown that closes or reopens", /<StateChip status=\{t\.status\}/.test(sel) && !/<select/.test(sel) && /setSheetFor\(t\.id\)/.test(sel));
  ok("the worker's list is the same three", /\["open", "in_progress", "completed"\]\.includes\(body\.status\)/.test(staff));
  ok("the boards draw those three columns", /\(\["open", "in_progress", "completed"\] as const\)\.map/.test(code));
}

/* ---- 6. a count and its list agree ---- */
{
  const mon = strip(read("components/portal/company-monitor.tsx"));
  ok("Not acknowledged lists the rows the server counted", /pick === "unacked" \? \(t\.status !== "completed" && t\.created_by != null && t\.created_by !== t\.assigned_to && t\.acknowledged === 0\)/.test(mon) && !/acknowledged_at/.test(mon));
  ok("…the server's count is the same rule", /t\.status != 'completed' AND t\.created_by IS NOT NULL AND t\.created_by != t\.assigned_to\s*AND NOT EXISTS \(SELECT 1 FROM task_events e WHERE e\.task_id = t\.id AND e\.kind = 'ack'\)/.test(staff));
}

/* ---- 7. the archive says how far back it goes ---- */
{
  /* v1.246.0 (audit A9) - every OPEN task, never cut; the closed ones newest
     300 at a time, the archive pages further on a press (go-live-t proves it) */
  ok("the board read is every open task and the newest 300 closed", /AND t\.status != 'completed' ORDER BY t\.created_at DESC`\)/.test(staff) && /AND t\.status = 'completed' ORDER BY t\.id DESC LIMIT 300`\)/.test(staff));
  ok("…and the archive says so, and loads older ones", /Every open task is on the board; the newest \$\{closed\.length \+ older\.length\} closed ones are searched here\./.test(src) && /Load older closed tasks/.test(src));
}

/* ---- 8. a link opens the drawer ---- */
ok("a search hit, a notification or a Desk item opens the task's drawer", /useRecordFocus\(focus, loaded, \(f\) => \{[\s\S]{0,500}?setOpenTask\(t\.id\)/.test(code));
ok("the drawer is the record (data-record) and closes cleanly", /<div className=\{tk\.detail\} data-record=\{`task:\$\{t\.id\}`\}>/.test(code) && /const closeDetail = \(\) => \{ setOpenTask\(null\); setItems\(null\); setEditing\(null\);(?: setSheetFor\(null\);)? \};/.test(code));

ok("no sample data from the reference", !/Nur Dini Farhana|Nursyazwani|Zul Hisyam|Mohamad Izzudin|Zolkefli|Draft rundown structure|Website product update|TikTok content series/.test(src));
ok("the guard is registered", /\["tasks-module", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
