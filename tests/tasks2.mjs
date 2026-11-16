/* v1.319.0 - TASKS 2.0, STAGE 1 (the CEO's seven pictures, 15-11-2026;
   claude/TASKS-2.0-STAGE-0-AUDIT.md, "Proceed the recommend": T2-1 to T2-21
   as recommended). SCREENS ONLY - this guard holds that it stayed so.

   The real module (lib/task-flow.ts) is bundled and RUN:
     - four words and no fifth: To Do, In Progress, Review, Done; Waiting for
       Client, Blocked and Cancelled are tags (T2-5);
     - overdue is a marker on an open task, never on a done one (T2-6);
     - the Overview's order is overdue, due today, priority, soonest;
     - Staff Performance counts closed this week ÷ held this week, a
       cancelled task left out, a task closed before Monday not held (T2-14);
     - the week's closures are counted on the Malaysian day.
   And on the source:
     - nothing is stored for any of it, and no task route was added;
     - one open task, drawn three ways (drawer on a phone, beside My Tasks,
       full page) from one set of parts; the page writes no record into the
       address;
     - one update form: the page draws the drawer's own UpdateSheet, and
       every button posts through its one submit;
     - the status menu offers only what the server's `can` allows (T2-7);
     - Staff Performance is drawn for management only;
     - the new screens use tokens and the house breakpoints only.
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/tasks2.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = {
  flow: "lib/task-flow.ts", tp: "components/portal/task-progress.tsx", ws: "components/portal/task-workspace.tsx", wsCss: "components/portal/task-workspace.module.css",
  t2: "components/portal/tasks2.tsx", t2Css: "components/portal/tasks2.module.css", tasks: "components/portal/tasks.tsx",
  prog: "worker/src/tasks-progress.ts",
};

let n = 0;
async function load(flowSrc) {
  const dir = mkdtempSync(join(tmpdir(), "tasks2-"));
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib/task-flow.ts"), flowSrc);
  const out = join(dir, `flow-${n++}.mjs`);
  execSync(`npx esbuild "${join(dir, "lib/task-flow.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
}

async function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const F = await load(src.flow);
  const TODAY = "2026-11-18"; // a Wednesday; the week is Mon 16 - Sun 22
  const T = (id, o = {}) => ({ id, status: "open", stage: null, priority: "normal", deadline: null, progress: 0, assigned_to: 1, assignee: "A", ...o });

  /* ---- the four words and the tags (T2-5) ---- */
  const grid = [["open", null], ["open", "blocked"], ["open", "waiting_client"], ["open", "review"], ["in_progress", null], ["in_progress", "blocked"], ["in_progress", "waiting_client"], ["in_progress", "review"], ["completed", null], ["completed", "cancelled"], ["completed", "review"]];
  const flows = grid.map(([s, g]) => F.flowOf(s, g));
  ok("every stored status and stage lands on one of four steps, or on none when cancelled", JSON.stringify(flows) === JSON.stringify(["todo", "todo", "todo", "review", "in_progress", "in_progress", "in_progress", "review", "done", null, "done"]), JSON.stringify(flows));
  ok("the steps are exactly four, in order", JSON.stringify(F.FLOW) === JSON.stringify(["todo", "in_progress", "review", "done"]));
  ok("Blocked, Waiting for Client and Cancelled are tags beside the word", F.tagKeyOf("in_progress", "blocked") === "blocked" && F.tagKeyOf("open", "waiting_client") === "waiting_client" && F.tagKeyOf("completed", "cancelled") === "cancelled" && F.flowOf("in_progress", "blocked") === "in_progress");
  ok("a task in review or done carries no tag; a done task is never tagged blocked", F.tagKeyOf("in_progress", "review") === null && F.tagKeyOf("completed", null) === null && F.tagKeyOf("completed", "blocked") === null);

  /* ---- overdue is a marker (T2-6) ---- */
  const late = F.rowFacts(T(1, { deadline: "2026-11-17", status: "in_progress" }), TODAY);
  const lateDone = F.rowFacts(T(2, { deadline: "2026-11-01", status: "completed" }), TODAY);
  const soon = F.rowFacts(T(3, { deadline: "2026-11-21" }), TODAY), far = F.rowFacts(T(4, { deadline: "2026-11-22" }), TODAY), due = F.rowFacts(T(5, { deadline: TODAY }), TODAY);
  ok("an open task past its due date is overdue and keeps its own step", late.overdue && late.flow === "in_progress" && !late.soon);
  ok("a done task is never overdue or due soon", !lateDone.overdue && !lateDone.soon && lateDone.done);
  ok("due soon is today to three days ahead, never an overdue task", soon.soon && due.soon && !due.overdue && !far.soon);
  ok("progress is drawn between 0 and 100", F.rowFacts(T(6, { progress: 140 }), TODAY).pct === 100 && F.rowFacts(T(7, { progress: -5 }), TODAY).pct === 0);

  /* ---- the Overview's order ---- */
  const order = F.byUrgency2([
    T(10, { deadline: "2026-12-01", priority: "low" }), T(11, { deadline: TODAY, priority: "low" }), T(12, { deadline: "2026-11-10", priority: "low" }),
    T(13, { deadline: "2026-11-30", priority: "urgent" }), T(14, { status: "completed", deadline: "2026-11-01", priority: "urgent" }), T(15, { deadline: "2026-11-25", priority: "normal" }),
  ], TODAY).map((t) => t.id);
  ok("the most pressing first: overdue, due today, the higher priority, the sooner due; done tasks last", JSON.stringify(order) === JSON.stringify([12, 11, 13, 15, 10, 14]), JSON.stringify(order));

  /* ---- Staff Performance (T2-14) ---- */
  const rows = [
    T(20, { assigned_to: 1, assignee: "Aina", status: "completed", closed_at: "2026-11-17 03:00:00" }),          // closed Tue (MYT 11:00)
    T(21, { assigned_to: 1, assignee: "Aina", status: "in_progress" }),
    T(22, { assigned_to: 1, assignee: "Aina", status: "completed", closed_at: "2026-11-13 03:00:00" }),          // closed last Friday: not held this week
    T(23, { assigned_to: 1, assignee: "Aina", status: "completed", stage: "cancelled", closed_at: "2026-11-17 03:00:00" }), // cancelled: left out
    T(24, { assigned_to: 2, assignee: "Badrul", status: "open" }),
    T(25, { assigned_to: 2, assignee: "Badrul", status: "completed", closed_at: "2026-11-15 17:30:00" }),        // Sun 17:30 UTC = Mon 01:30 MYT: this week
    T(26, { assigned_to: undefined, status: "open" }),
  ];
  const perf = F.staffPerformance(rows, TODAY);
  const aina = perf.find((p) => p.id === 1), bad = perf.find((p) => p.id === 2);
  ok("held this week = open now, or closed since Monday; closed = closed since Monday", aina?.held === 2 && aina?.closed === 1 && aina?.pct === 50, JSON.stringify(aina));
  ok("a cancelled task and a task closed before Monday are not counted", aina?.held === 2);
  ok("the week turns on the Malaysian day (Sunday 17:30 UTC is Monday here)", bad?.held === 2 && bad?.closed === 1, JSON.stringify(bad));
  ok("a task with nobody assigned scores nobody; the list is ranked by the share closed", perf.length === 2 && perf.every((p) => p.pct === 50) && perf[0].name === "Aina");

  /* ---- the week's closures ---- */
  const wk = F.weeklyDone(rows, TODAY);
  ok("seven days, Monday first, each closure on its Malaysian day; a cancelled task is not a closure", wk.length === 7 && wk[0].day === "2026-11-16" && wk[0].n === 1 && wk[1].n === 1 && wk.slice(2).every((d) => d.n === 0), JSON.stringify(wk));
  ok("closed this week is the sum of those days", F.closedThisWeek(rows, TODAY) === 2);

  /* ---- the source: screens only ---- */
  const { tp, ws, t2, tasks, flow } = src;
  ok("nothing is stored or fetched by the rules module", !/fetch\(|api\(|localStorage|import /.test(flow));
  ok("the new screen pieces write nothing", !/csrfFetch|method: "(POST|PUT|PATCH|DELETE)"/.test(t2) && !/csrfFetch|method: "(POST|PUT|PATCH|DELETE)"|api</.test(ws));
  ok("the status chip is the word and, beside it, the tag", /\{flow && <span className=\{FLOW_CHIP\[flow\]\}>\{flowWord\(flow\)\}<\/span>\}\s*\{tag && <span className=\{tag\.cls\} data-testid="state-tag">/.test(tp));
  ok("the words are To Do, In Progress, Review, Done", /k === "done" \? L\("Done", "Selesai"\) : k === "review" \? L\("Review", "Semakan"\) : k === "in_progress" \? L\("In Progress", "Sedang Berjalan"\) : L\("To Do", "Belum Mula"\)/.test(tp));
  ok("the workspace is built from the drawer's own pieces (no second task engine)", /import \{[^}]*ActivityPanel[^}]*FilesPanel[^}]*ReviewBar[^}]*UpdateSheet[^}]*UpdatesComments[^}]*useTaskDetail[^}]*\} from "@\/components\/portal\/task-progress";/s.test(ws));
  /* v1.321.0 - ONE composer: the drawer's UpdateSheet, inline, carried inside the Updates box (no second Update Task card) */
  ok("one update form: the pane draws the drawer's UpdateSheet, inline, inside the one composer", /<UpdateSheet key=\{`\$\{t\.id\}:\$\{sheet\.n\}`\} inline d=\{d\}/.test(ws) && (ws.match(/<UpdateSheet/g) ?? []).length === 1 && /composer=\{composerSheet \? \{ open: sheet\.open,/.test(ws) && !/ws-update/.test(ws));
  const inl = tp.slice(tp.indexOf('data-testid="inline-actions"'), tp.indexOf("<div className={tp.sticky}>", tp.indexOf('data-testid="inline-actions"')));
  ok("its three buttons post through the form's one submit - never a route of their own", (inl.match(/void submit\(/g) ?? []).length === 3 && !/api</.test(inl) && /onClick=\{\(\) => void submit\("review"\)\}/.test(inl) && /onClick=\{\(\) => void submit\("closed"\)\}/.test(inl));
  ok("each button is drawn only when the server lets this person", /\{d\.can\.request_review && state !== "review" && <button/.test(inl) && /\{d\.can\.close && !closing && <button/.test(inl) && /\{\(d\.can\.update \|\| \(closing && d\.can\.close\)\) && <button/.test(inl));
  ok("Mark Done still needs the completion summary and every deliverable (the sheet's own checks run for it)", /const state = as \?\? stateNow; const closing = state === "closed";/.test(tp) && /if \(!approving && text\.trim\(\)\.length < 10\)/.test(tp) && /if \(outstanding\.length && !exception\)/.test(tp));
  const menu = ws.slice(ws.indexOf("function movesOf("), ws.indexOf("function Card("));
  ok("the status menu offers only the moves the server allows (T2-7)", /\["in_progress", [^\]]*d\.can\.update\]/.test(menu) && /\["review", [^\]]*d\.can\.request_review\]/.test(menu) && /\["closed", [^\]]*!!d\.can\.close\]/.test(menu) && /\.filter\(\(m\) => m\[2\]\)/.test(menu) && /if \(d\.task\.status === "completed"\) return \[\];/.test(menu));
  ok("choosing a move opens the form on it - the menu itself changes nothing", /onChange=\{\(e\) => \{ if \(e\.target\.value\) onPick\(e\.target\.value as Move\); \}\}/.test(menu) && !/api</.test(menu));
  /* v1.321.0 (the Unified Workspace) - one pane in two places: beside My Tasks from 1024px, the drawer everywhere else */
  ok("ONE open task, drawn two ways: beside My Tasks (from 1024px), the task drawer everywhere else", /const besideOk = view === "mine" && mineMode === "list" && isLg;/.test(tasks) && /const present: "drawer" \| "beside" \| null = !detail \? null : openHow === "beside" \? \(besideOk \? "beside" : null\) : "drawer";/.test(tasks));
  ok("…from one set of parts (information, checklist, foot)", /return \{ t, subtitle, foot, info, check \};/.test(tasks) && (tasks.match(/info=\{detail\.info\} checklist=\{detail\.check\} foot=\{detail\.foot\}/g) ?? []).length === 2 && !/TaskProgressTabs/.test(tasks));
  ok("the task writes no record into the address", !/pushState/.test(tasks) && !/searchParams\.set\("(task|id)"/.test(tasks));
  ok("Staff Performance is drawn for management only (T2-14)", /\{canManage\s*\? <StaffPerformance tasks=\{tasks\}/.test(tasks) && /: <MyToday mine=\{myTasks\}/.test(tasks));
  ok("the Overview counts its own scope: the team for management, your own otherwise", /const ovScope = canManage \? tasks : myTasks;/.test(tasks));
  ok("the board has four columns, the four steps", /\{FLOW\.map\(\(k\) => \{\s*const all = rows\.filter\(\(t\) => flowOf\(t\.status, t\.stage \?\? null\) === k\);/.test(t2));
  ok("no task route was added for these screens", !/v1\.319\.0/.test(src.prog));
  for (const [name, css] of [["task-workspace", src.wsCss], ["tasks2", src.t2Css]]) {
    const widths = [...css.matchAll(/@media \((min|max)-width: (\d+)px\)/g)].map((m) => `${m[1]}:${m[2]}`);
    ok(`${name}.module.css: the house breakpoints only`, widths.every((w) => ["min:640", "min:768", "min:1024", "min:1280", "max:639", "max:767", "max:1023", "max:1279"].includes(w)), widths.join(" "));
    ok(`${name}.module.css: tokens only - no literal colour`, !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css));
  }
  return res;
}

const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = await checks(src);
const failed = res.filter((r) => !r[1]);
for (const [name, , detail] of failed) console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
if (failed.length) { console.log(`tasks2: ${failed.length} of ${res.length} FAILED`); process.exit(1); }

/* ---- every rule catches its own breakage ---- */
const MUT = [
  ["a blocked task shown as a fifth status", "flow", 'if (stage === "review") return "review";', 'if (stage === "review") return "review";\n  if (stage === "blocked") return null;'],
  ["a cancelled task shown as Done", "flow", 'return stage === "cancelled" ? null : "done";', 'return "done";'],
  ["a done task marked overdue", "flow", "const overdue = !done && !!t.deadline && t.deadline < today;", "const overdue = !!t.deadline && t.deadline < today;"],
  ["due today counted as overdue", "flow", "const overdue = !done && !!t.deadline && t.deadline < today;", "const overdue = !done && !!t.deadline && t.deadline <= today;"],
  ["a cancelled task counted in Staff Performance", "flow", 'if (t.assigned_to == null || t.stage === "cancelled") continue;', "if (t.assigned_to == null) continue;"],
  ["last week's closures counted as held", "flow", 'if (t.status === "completed" && (!closedDay || closedDay < mon)) continue;', ""],
  ["the week counted on the UTC day", "flow", "new Date(ms + 8 * 3600000)", "new Date(ms)"],
  ["priority put before the due date", "flow", "x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]", "x[0] - y[0] || x[3] - y[3] || x[1] - y[1] || x[2] - y[2]"],
  ["a second update form in the pane", "ws", "<StatusStepper d={d} />", "<UpdateSheet inline d={d} onClose={() => undefined} onDone={() => undefined} /><StatusStepper d={d} />"],
  ["Mark Done shown to someone the server refuses", "tp", "{d.can.close && !closing && <button", "{!closing && <button"],
  ["Mark Done without the summary check", "tp", "if (!approving && text.trim().length < 10)", "if (false)"],
  ["a status menu that offers every move", "ws", ".filter((m) => m[2])", ""],
  ["Staff Performance shown to everyone", "tasks", "{canManage\n                ? <StaffPerformance", "{true\n                ? <StaffPerformance"],
  ["the task's id written into the address", "tasks", "const closeDetail = () => { setOpenTask(null);", 'const closeDetail = () => { window.history.pushState({}, "", "?task=1"); setOpenTask(null);'],
  ["a second set of parts for the pane", "tasks", '<TaskWorkspace key={detail.t.id} layout="pane" taskId={detail.t.id} info={detail.info}', '<TaskWorkspace key={detail.t.id} layout="pane" taskId={detail.t.id} info={null}'],
  ["a literal colour in the new screens", "t2Css", "color: var(--danger); }", "color: #c00; }"],
  ["a breakpoint of its own", "wsCss", "@media (max-width: 639px)", "@media (max-width: 600px)"], // v1.326.0 - the facts' 1024px rule became a container query (the pane's width)
];
let caught = 0;
if (process.env.NOMUT !== "1") {
  for (const [name, file, from, to] of MUT) {
    if (!src[file].includes(from)) { console.log(`  ✗ mutation "${name}": its anchor is gone from ${FILES[file]}`); process.exit(1); }
    const broken = { ...src, [file]: src[file].replace(from, to) };
    let r; try { r = await checks(broken); } catch { caught++; continue; }
    if (r.every((x) => x[1])) { console.log(`  ✗ mutation NOT caught: ${name}`); process.exit(1); }
    caught++;
  }
}
console.log(`tasks2: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
