/* v1.313.0 - A2Z OS TASKS WORKSPACE 5.0, Gate 3 (the CEO's "Approved as per
   recommendations both", 15-11-2026; claude/TASKS-WORKSPACE-5.0-BLUEPRINT.md).

   What this holds, in the source (the browser half is tests/browser/tasks5.py):
     - six tabs in the board's order, the view in the address, the phone's
       view switch;
     - Gate 3 is screens only: the new pieces read and never write; the one
       engine's routes are the ones there were;
     - the calendar is the work already recorded - no calendar table, no
       Client Meetings (TK-10), Sunday first;
     - the Live Host card pretends no form, no GMV figure (TK-1, TK-14);
     - At Risk is the written rule (TK-8), priority words are TK-3's;
     - nothing reads "Recurring" (TK-6); Edit is the existing edit, open
       tasks only, for the assignee or management;
     - the server's two read additions say no more than they should.
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/tasks5.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FILES = {
  tasks: "components/portal/tasks.tsx",
  t5: "components/portal/tasks5.tsx",
  t2: "components/portal/tasks2.tsx", ws: "components/portal/task-workspace.tsx", // v1.319.0 - Tasks 2.0 Stage 1: the card list and the task beside it
  pw: "components/portal/project-workspace.tsx",
  staff: "worker/src/staff.ts",
  projects: "worker/src/projects.ts",
  progress: "components/portal/task-progress.tsx",
};

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const t = src.tasks, t5 = strip(src.t5);

  ok("six views, in the board's order", /const TASK_VIEWS: readonly TaskView\[\] = \["overview", "mine", "all", "projects", "calendar", "reports"\];/.test(t)
    && /\["overview", L\("Overview"[\s\S]*?\["mine", L\("My Tasks"[\s\S]*?\["all", L\("All Tasks"[\s\S]*?\["projects", L\("Projects"[\s\S]*?\["calendar", L\("Calendar"[\s\S]*?\["reports", L\("Reports & Archive"/.test(t));
  ok("the view is in the address (Back and Forward)", /useTabViewAddress\("Tasks", view, setView, isTaskView\);/.test(t));
  ok("the phone reads the view switch with Create Task", /<ViewSwitch value=\{view\} onChange=\{\(k\) => go\(k\)\} label=\{L\("Tasks view"/.test(t) && /data-testid="tasks-view-bar"/.test(t));
  ok("All Tasks only for management (the server answers ?all=1 for them alone)", /\.\.\.\(canManage \? \[\["all", L\("All Tasks"/.test(t) && /useCachedApi<\{ tasks: Task\[\] \}>\(`\/staff\/tasks\$\{canManage \? "\?all=1" : ""\}`/.test(t));

  /* v1.315.0 (Gate 4) - the one writer in these pieces is the Live Host Report, through its own routes */
  const lhc = t5.slice(t5.indexOf("export function LiveHostCard("));
  const beforeLh = t5.slice(0, t5.indexOf("export function LiveHostCard(")).replace(/^import .*$/gm, "");
  ok("the Tasks 5.0 pieces write only through the Live Host Report's routes", !/method:|csrfFetch|fetch\(/.test(beforeLh) && (lhc.match(/(?:api|csrfFetch)(?:<[^>]*>)?\(`([^`]+)`, \{ method:/g) ?? []).every((x) => /\/live-reports/.test(x)) && /method: "POST"/.test(lhc));
  ok("…and read only the routes there are (items, roster, live sessions, live reports)", (t5.match(/api<[^>]*>\(`([^`]+)`/g) ?? []).every((x) => /\/staff\/tasks\/\$\{id\}\/items|\/staff\/roster\?week=|\/staff\/live-reports/.test(x))
    && (t5.match(/useCachedApi<[^>]*>\(([^,]+),/g) ?? []).every((x) => /\/staff\/roster\?week=|"\/staff\/live-sessions"/.test(x)));

  const cal = t5.slice(t5.indexOf("export function WorkCalendar("), t5.indexOf("export function LiveHostCard("));
  ok("the calendar's kinds are the records there are - no Client Meetings (TK-10)", /const KIND_WORD: Record<EvKind, \[string, string\]> = \{ task: \["Tasks", "Tugasan"\], due: \["Deadlines", "Tarikh akhir"\], review: \["Reviews", "Semakan"\], live: \["Live Sessions", "Sesi Live"\], mile: \["Milestones", "Pencapaian"\] \};/.test(t5) && !/Client Meeting|Mesyuarat Pelanggan/.test(t5));
  ok("Sunday first, as the board", /const lead = new Date\(`\$\{first\}T00:00:00Z`\)\.getUTCDay\(\);/.test(cal) && /\[\["Sun", "Ahd"\], \["Mon", "Isn"\]/.test(cal));
  ok("a phone reads the agenda, never the shrunk grid", /<div className=\{t5\.deskOnly\}>/.test(cal) && /className=\{mode === "list" \? "" : t5\.phoneOnly\} data-testid="cal-agenda"/.test(cal));

  const lh = t5.slice(t5.indexOf("export function LiveHostCard("));
  ok("the Live Host card says reported GMV is never sales, cash, commission or payroll", /Reported GMV is the host's figure - it is never verified sales, cash, an invoice paid, commission or payroll\./.test(lh));
  ok("…takes screenshots as images, from the camera on a phone", /accept="image\/jpeg,image\/png,image\/webp" capture="environment"/.test(lh));
  ok("…a return or a reopen asks the reviewer for the words", /required: true, confirmLabel: action === "return"/.test(lh));
  ok("…and the Reports figure counts the reports, not a promise", /label=\{L\("Live Host Sessions", "Sesi Hos Live"\)\} value=\{liveRows\.data \? liveThisMonth : ""\}/.test(t));

  ok("At Risk is the written rule (TK-8): an overdue task, past due, or due in 7 days under 50%", /if \(\(r\.late \?\? 0\) > 0\) return \{ word: L\("At Risk"/.test(src.pw) && /if \(r\.due_date && r\.due_date < today\) return \{ word: L\("At Risk"/.test(src.pw) && /r\.due_date <= week && r\.progress < 50\) return \{ word: L\("At Risk"/.test(src.pw));
  ok("normal reads Medium (TK-3), review reads Review", /export const prioWord = \(p: string\) => \(p === "normal" \? L\("Medium", "Sederhana"\)/.test(t5) && /k === "review" \? L\("Review", "Semakan"\)/.test(src.progress));
  ok("nothing claims a recurring series (TK-6)", !/Recurring task|Tugasan berulang/.test(t5 + strip(t) + strip(src.t2) + strip(src.ws)));
  /* v1.321.0 - All Tasks draws its rows through CompactTaskTable (allCols): every row that offers Edit keeps the one rule */
  const editables = (t.match(/const editable = [^;]*;/g) ?? []).filter((x) => x.includes("isMine(t)"));
  ok("Edit is the existing edit, offered on open tasks to the assignee or management", editables.length >= 1 && editables.every((x) => x === 'const editable = (isMine(t) || canManage) && t.status !== "completed";') && /\{editable && \(\s*<button[^>]*data-testid="row-edit"/.test(t));
  /* v1.319.0 (Tasks 2.0 Stage 1) - the preview became the task itself beside the list: a card only chooses it */
  ok("a checklist is never closure: a card in the list only chooses the task shown beside it", /<MyTaskCards rows=\{mineRows\} picked=\{present === "beside" \? openTask : null\} onPick=\{\(id\) => void openChecklist\(id, besideOk \? "beside" : "open"\)\}/.test(t));

  ok("the staff picker adds the department and still no phone, IC, bank or salary", /u\.role, u\.position, u\.department, u\.employment_status FROM users u\s+WHERE u\.is_active = 1/.test(src.staff) && !/u\.(phone|ic_number|bank_account|salary)[^\n]*FROM users u\s+WHERE u\.is_active = 1 AND \$\{currentStaffSql/.test(src.staff));
  ok("the project list counts overdue project tasks for At Risk, a read only", /AND t\.status != 'completed' AND t\.deadline < date\('now', '\+8 hours'\)\) AS late,/.test(src.projects));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

/* the mutation pass: each breakage must be caught */
const MUT = [
  ["the view taken off the address", "tasks", 'useTabViewAddress("Tasks", view, setView, isTaskView);', ""],
  ["a write slipped into the calendar", "t5", "void Promise.all(key.split(\",\").filter(Boolean).map((w) => api<Roster>(`/staff/roster?week=${w}`)))", "void Promise.all(key.split(\",\").filter(Boolean).map((w) => api<Roster>(`/staff/roster?week=${w}`, { method: \"POST\" })))"],
  ["Client Meetings invented", "t5", 'mile: ["Milestones", "Pencapaian"] };', 'mile: ["Milestones", "Pencapaian"], meet: ["Client Meetings", "Mesyuarat Pelanggan"] };'],
  ["Monday first again", "t5", "const lead = new Date(`${first}T00:00:00Z`).getUTCDay();", "const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;"],
  ["the GMV disclaimer dropped", "t5", "Reported GMV is the host's figure - it is never verified sales, cash, an invoice paid, commission or payroll.", "Reported GMV."],
  ["At Risk without the overdue tasks", "pw", "if ((r.late ?? 0) > 0) return", "if (false) return"],
  ["Edit on a closed task", "tasks", 'const editable = (isMine(t) || canManage) && t.status !== "completed";', "const editable = isMine(t) || canManage;"],
  ["the staff picker exposes the phone", "staff", "u.role, u.position, u.department, u.employment_status FROM users u", "u.role, u.position, u.department, u.phone, u.employment_status FROM users u"],
  ["a recurring label invented", "t2", '{m.project && <small>{L("Project", "Projek")}: {m.project}</small>}', '<small>{L("Recurring task", "Tugasan berulang")}</small>{m.project && <small>{L("Project", "Projek")}: {m.project}</small>}'],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\ntasks5: ${failed.length} failed`); process.exit(1); }
console.log(`tasks5: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
