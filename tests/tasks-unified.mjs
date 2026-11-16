/* v1.321.0 - TASKS UNIFIED WORKSPACE (the CEO's "A2Z OS - Tasks Module
   Unified Workspace Redesign", 16-11-2026) - the rules the brief sets,
   read from the source.

     - shared pieces: one compact strip (MetricStrip, shared with Sales -
       sales-shell re-exports it, it does not draw a second one), one
       pagination (10 / 15 / 25 / 50), one filter panel (a region in the
       page's flow, never a dialog), one compact table, one toolbar, one
       task drawer, one stepper
     - Overview: the strip, the priority queue with its pages, ONE
       secondary panel switched between three (Staff Performance or My
       Today, Recent Activity, Quick Actions); nothing it held before is gone
       (the week's closures and the workflow are relocated into it)
     - My Tasks: the list 35% and the task 65% from 1024px; below that the
       list, a task opens full screen; My Day kept whole, folded under it
     - All Tasks: the strip, the toolbar (search, status, Filters with
       department, assignee, project, priority and the due range, Columns),
       sortable headers, 15 rows a page by default, a row opens the drawer,
       the workforce cards behind Insights
     - the task pane: the stepper, the decisions outside the sections, the
       five sections in the brief's order, ONE update composer (the
       drawer's own form, the same comment and update routes), loading and
       error states; it reads what a person may do from the server's `can`
       - never a role, never a second approval rule
     - the four steps stay four: To Do, In Progress, Review, Done
     - tokens only, the house breakpoints only

   node tests/tasks-unified.mjs   (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = {
  tasks: "components/portal/tasks.tsx", ws: "components/portal/task-workspace.tsx", wsCss: "components/portal/task-workspace.module.css",
  tp: "components/portal/task-progress.tsx", table: "components/portal/task-table.tsx", tableCss: "components/portal/task-table.module.css",
  t2Css: "components/portal/tasks2.module.css", strip: "components/ui/metric-strip.tsx", stripCss: "components/ui/kpi-tile.module.css" /* v1.323.0 - MetricStrip draws through the one KPI strip */,
  pager: "components/ui/pagination-controls.tsx", pagerCss: "components/ui/pagination-controls.module.css",
  filt: "components/ui/filter-popover.tsx", filtCss: "components/ui/filter-popover.module.css", shell: "components/portal/sales-shell.tsx",
  flow: "lib/task-flow.ts", guards: "scripts/run-guards.mjs",
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ""; const j = s.indexOf(b, i + a.length); return j < 0 ? s.slice(i) : s.slice(i, j); };

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const tasks = strip(src.tasks), ws = strip(src.ws), tp = strip(src.tp), table = strip(src.table);
  const overview = between(tasks, '{view === "overview" && (() => {', '<TabZone label={L("My work"');
  const mine = between(tasks, '<MetricStrip testid="mine-strip"', '<TabZone label={L("The work"');
  const all = between(tasks, '<MetricStrip testid="all-strip"', '{view === "calendar"');

  /* ---- the shared pieces ---- */
  ok("v1.323.0 - the compact strip IS the one KPI strip: MetricStrip draws KpiRow + KpiTile and keeps no stylesheet of its own", /<KpiRow label=\{label\} testid=\{testid\}>/.test(strip(src.strip)) && /<KpiTile /.test(strip(src.strip)) && !/metric-strip\.module\.css/.test(src.strip));
  ok("one compact strip, shared: Sales re-exports the ui strip and draws none of its own", /export function MetricStrip\(/.test(src.strip) && /export \{ MetricStrip, type StripCell \} from "@\/components\/ui\/metric-strip";/.test(src.shell) && !/function MetricStrip/.test(src.shell) && !/^\.strip\b/m.test(read("components/portal/sales-shell.module.css")));
  ok("one pagination: 10, 15, 25 or 50 rows", /export const PAGE_SIZES = \[10, 15, 25, 50\] as const;/.test(src.pager));
  ok("the filter panel lies in the page (a region), never a dialog", /role="region"/.test(src.filt) && !/role="dialog"|aria-modal/.test(src.filt) && /e\.key === "Escape"/.test(src.filt));
  ok("one task drawer: the pane in the side drawer, full screen on a phone", /export function TaskDetailDrawer\(/.test(ws) && /<SideDrawer open onClose=\{onClose\} wide full title=\{title\}/.test(ws) && /<TaskWorkspace key=\{taskId\} layout="drawer"/.test(ws));
  ok("one stepper", /export function StatusStepper\(/.test(ws) && (ws.match(/<StatusStepper /g) ?? []).length === 1);

  /* ---- Overview ---- */
  ok("Overview: the compact strip, no large figure cards", /<MetricStrip testid="overview-strip"/.test(overview) && !/<KpiRow|<KpiTile/.test(overview));
  ok("Overview: the priority queue, a page at a time (10 to start)", /<OverviewTable rows=\{ovRows\.slice\(/.test(overview) && /<PaginationControls testid="overview-pages"/.test(overview) && /const \[ovSize, setOvSize\] = useState<PageSize>\(10\);/.test(tasks));
  ok("Overview: ONE secondary panel, switched between three", /* v1.323.0 (D-2) - three contents are three tabs: the one LineTabs row */ /<div data-testid="overview-panel-switch">\s*(?:\{\}\s*)?<LineTabs [^>]*value=\{ovPanel\}/.test(overview) && /\["people",[^\]]*\],\s*\["activity",[^\]]*\],\s*\["actions",[^\]]*\],/.test(overview) && (overview.match(/ovPanel === "/g) ?? []).length === 3);
  ok("Overview: nothing dropped - performance (managers) or my day, the week's closures, activity, quick links and the workflow are all in the panel", ["<StaffPerformance ", "<MyToday ", "<WeeklySummary ", "<ActivityFeed ", "<QuickLinks ", "<WorkflowStrip />"].every((x) => overview.includes(x)) && /\{canManage\s*\? <StaffPerformance/.test(overview));
  ok("Overview: the extra filters (project, department, staff) behind Filters; status stays in reach", /<FilterPopover testid="overview-more"/.test(overview) && /value=\{ovAbout\}/.test(overview) && /value=\{ovDept\}/.test(overview) && /value=\{ovWho\}/.test(overview) && /aria-label=\{L\("Status", "Status"\)\} value=\{ovStatus\}/.test(overview));

  /* ---- My Tasks ---- */
  ok("My Tasks: the list and the task side by side from 1024px", /const besideOk = view === "mine" && mineMode === "list" && isLg;/.test(tasks) && /@media \(min-width: 1024px\) \{[^@]*\.mine \{ grid-template-columns: minmax\(0, 35fr\) minmax\(0, 65fr\); \}/.test(src.t2Css));
  ok("My Tasks: below 1024px the full list; a task opens on its own (the drawer)", /if \(!besideOk\) return list;/.test(mine) && /onPick=\{\(id\) => void openChecklist\(id, besideOk \? "beside" : "open"\)\}/.test(mine));
  ok("My Tasks: My Day kept whole, folded under the list", /<details className=\{t2\.disclose\} data-testid="my-day">[\s\S]*<MyDayCards /.test(mine));

  /* ---- All Tasks ---- */
  ok("All Tasks: the compact strip and ONE register", /<MetricStrip testid="all-strip"/.test(all) && !/<KpiRow|<KpiTile/.test(all) && (all.match(/<CompactTaskTable /g) ?? []).length === 1 && !/renderTasks\(/.test(all));
  ok("All Tasks: the toolbar - search, status, Filters, Columns", /<TaskToolbar q=\{q\}/.test(all) && /\{statusFilter\}/.test(all) && /<FilterPopover testid="all-filters"/.test(all) && /<ColumnPicker /.test(all));
  ok("All Tasks: Filters holds department, assignee, project, priority and the due range", ["value={deptF}", "value={whoF}", "value={aboutF}", "value={prioF}", "value={dueFrom}", "value={dueTo}"].every((x) => all.includes(x)));
  ok("the due range filters on the due date, both ends kept", /\.filter\(\(t\) => !opts\.more \|\| !dueFrom \|\| \(!!t\.deadline && t\.deadline >= dueFrom\)\)/.test(tasks) && /\.filter\(\(t\) => !opts\.more \|\| !dueTo \|\| \(!!t\.deadline && t\.deadline <= dueTo\)\)/.test(tasks));
  ok("All Tasks: sortable headers, a second press turns the order round", /sort=\{sortK\} dir=\{sortDirOf\(sortK, sortRev\)\} onSort=\{\(k\) => sortBy\(k as SortK\)\}/.test(all) && /const sortBy = \(k: SortK\) => \{ if \(k === sortK\) setSortRev\(\(v\) => !v\); else \{ setSortK\(k\); setSortRev\(false\); \}/.test(tasks) && /return sortRev \? -n : n;/.test(tasks));
  ok("All Tasks: 15 rows a page to start, 10 / 25 / 50 to choose", /const \[allSize, setAllSize\] = useState<PageSize>\(15\);/.test(tasks) && /page=\{allPage\} size=\{allSize\} onPage=\{setAllPage\}/.test(all));
  ok("All Tasks: a row opens the task; its commands do not", /onOpen=\{\(id\) => void openChecklist\(id\)\}/.test(all) && /onClick=\{\(\) => onOpen\(r\.id\)\}/.test(table) && /onClick=\{c\.cmds \? \(e\) => e\.stopPropagation\(\) : undefined\}/.test(table));
  ok("All Tasks: every row command kept - Edit, Update, Delete", /data-testid="row-edit"/.test(tasks) && /data-testid="row-update" onClick=\{\(\) => \{ setSheetFor\(t\.id\); void openChecklist\(t\.id\); \}\}/.test(tasks) && /\{deleteBtn\(t\)\}/.test(between(tasks, "{ key: \"actions\"", "\n  ];")));
  ok("All Tasks: the workforce cards behind Insights", /\{insights && \(\s*<div className=\{t2\.insights\} data-testid="all-insights">\s*<WorkloadCard [\s\S]*?\/>\s*<DepartmentCard [\s\S]*?\/>\s*<QuickApprovals /.test(all) && /const \[insights, setInsights\] = useState\(false\);/.test(tasks));
  ok("All Tasks: still for those who manage the team only", /\{canManage && \(\s*<TabZone label=\{L\("The work", "Kerja"\)\}/.test(tasks));

  /* ---- the task pane ---- */
  const pane = between(ws, "export function TaskWorkspace(", "export function TaskDetailDrawer(");
  ok("the pane: Details, Checklist, Updates, Files, Activity - in that order", ["\"details\", L(\"Details\"", "\"checklist\", L(\"Checklist\"", "\"updates\", L(\"Updates\"", "\"files\", L(\"Files\"", "\"activity\", L(\"Activity\""].map((x) => pane.indexOf(x)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])));
  ok("the pane: the decisions sit above the sections, never behind a tab", pane.indexOf("<ReviewBar d={d} bare") > 0 && pane.indexOf("<ReviewBar d={d} bare") < pane.indexOf("<LineTabs value={sec}"));
  ok("the pane: ONE update composer - the drawer's own form inside the Updates box", (pane.match(/<UpdateSheet /g) ?? []).length === 1 && /composer=\{composerSheet \? \{ open: sheet\.open,/.test(pane) && /composer\?: \{ open: boolean; setOpen: \(v: boolean\) => void; sheet: ReactNode \}/.test(tp));
  ok("the composer posts where it always did: comments to /comments (with the @mentions), updates to /updates", /`\/staff\/tasks\/\$\{t\.id\}\/comments`, \{ method: "POST", body: JSON\.stringify\(\{ comment: body, mentions \}\) \}/.test(tp) && /`\/staff\/tasks\/\$\{t\.id\}\/updates`, \{ method: "POST", body: JSON\.stringify\(\{ kind: "progress", body \}\) \}/.test(tp));
  ok("the pane shows loading and error states", /data-state="loading" aria-busy><SkelRows/.test(pane) && /data-state="error"><Problem text=\{error\} \/>/.test(pane));
  ok("the pane decides nothing itself: what a person may do is the server's `can`, never a role", /const canForm = \(d\.can\.update \|\| d\.can\.close\)/.test(pane) && !/\.role\b|"ceo"|"CEO"|isCeo|canManage/.test(ws));
  ok("no task page and nothing written into the address", !/layout="page"|data-layout="page"|pushState/.test(tasks + ws));
  ok("the four steps stay four", /export const FLOW: readonly FlowKey\[\] = \["todo", "in_progress", "review", "done"\];/.test(src.flow));

  /* ---- the house rules ---- */
  const css = [src.wsCss, src.tableCss, src.t2Css, src.stripCss, src.pagerCss, src.filtCss];
  ok("tokens only: no literal colour in the new screens", css.every((c) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(c)));
  ok("the house breakpoints only", css.every((c) => (c.match(/@media \((?:min|max)-width: (\d+)px\)/g) ?? []).every((m) => /: (640|768|1024|1280|639|767|1023|1279)px\)/.test(m))));
  ok("no hand-made dialog in the new screens", ![src.table, src.ws, src.filt, src.pager, src.strip].some((s) => /role="dialog"/.test(s)));
  ok("the guard is registered", /\["tasks-unified", "/.test(src.guards));
  return res;
}

const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(src);
const failed = res.filter((r) => !r[1]);
for (const [name, , detail] of failed) console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
if (failed.length) { console.log(`tasks-unified: ${failed.length} of ${res.length} FAILED`); process.exit(1); }

/* ---- every rule catches its own breakage ---- */
const MUT = [
  ["Sales draws its own strip again", "shell", 'export { MetricStrip, type StripCell } from "@/components/ui/metric-strip";', "export function MetricStrip() { return null; }"],
  ["a 20-row page size", "pager", "[10, 15, 25, 50]", "[10, 15, 20, 50]"],
  ["the filter panel turned into a dialog", "filt", 'role="region"', 'role="dialog"'],
  ["the Overview's figures back in big cards", "tasks", '<MetricStrip testid="overview-strip"', '<KpiRow label="x"></KpiRow><MetricStrip testid="overview-strip"'],
  ["Recent Activity dropped from the panel", "tasks", "{ovPanel === \"activity\" && <ActivityFeed rows={ovScope} onOpen={(id) => void openChecklist(id)} />}", ""],
  ["the workflow dropped", "tasks", "<WorkflowStrip />", ""],
  ["Staff Performance shown to everyone", "tasks", "{canManage\n                ? <StaffPerformance", "{true\n                ? <StaffPerformance"],
  ["the split only from 1280px", "tasks", 'mineMode === "list" && isLg;', 'mineMode === "list" && isXl;'],
  ["My Day dropped", "tasks", "<MyDayCards mine={myTasks}", "<span data-x={myTasks.length}"],
  ["the due range drops undated tasks the wrong way", "tasks", "(!!t.deadline && t.deadline >= dueFrom)", "(!t.deadline || t.deadline >= dueFrom)"],
  ["the department filter left out", "tasks", 'value={deptF}', 'value={""}'],
  ["a header that only sorts one way", "tasks", "return sortRev ? -n : n;", "return n;"],
  ["25 rows a page to start", "tasks", "useState<PageSize>(15)", "useState<PageSize>(25)"],
  ["a row command that also opens the task", "table", "onClick={c.cmds ? (e) => e.stopPropagation() : undefined}", "onClick={undefined}"],
  ["Insights opened by default", "tasks", "const [insights, setInsights] = useState(false);", "const [insights, setInsights] = useState(true);"],
  ["Delete dropped from the row", "tasks", "{deleteBtn(t)}\n        </span>\n      );\n    } },", "\n        </span>\n      );\n    } },"],
  ["the decisions hidden behind a tab", "ws", '<div data-testid="ws-decide"><ReviewBar d={d} bare onChanged={changed} onUpdate={() => toForm("review")} onClose={() => toForm("closed")} /></div>\n', ""],
  ["a second update form in the pane", "ws", "<StatusStepper d={d} />", "<UpdateSheet inline d={d} onClose={() => undefined} onDone={() => undefined} /><StatusStepper d={d} />"],
  ["comments posted somewhere new", "tp", "`/staff/tasks/${t.id}/comments`, { method: \"POST\"", "`/staff/tasks/${t.id}/notes`, { method: \"POST\""],
  ["the pane deciding by role", "ws", "const canForm = (d.can.update || d.can.close)", "const canForm = (d.can.update || d.can.close || d.task.assignee === \"CEO\")"],
  ["a fifth step", "flow", '["todo", "in_progress", "review", "done"]', '["todo", "in_progress", "review", "overdue", "done"]'],
  ["a literal colour", "tableCss", "color: var(--info); }", "color: #1d4ed8; }"],
  ["a breakpoint of its own", "t2Css", "@media (min-width: 1024px) {\n  .insights", "@media (min-width: 1100px) {\n  .insights"],
];
let caught = 0;
if (process.env.NOMUT !== "1") {
  for (const [name, file, from, to] of MUT) {
    if (!src[file].includes(from)) { console.log(`  ✗ mutation "${name}": its anchor is gone from ${FILES[file]}`); process.exit(1); }
    const r = checks({ ...src, [file]: src[file].replace(from, to) });
    if (r.every((x) => x[1])) { console.log(`  ✗ mutation NOT caught: ${name}`); process.exit(1); }
    caught++;
  }
}
console.log(`tasks-unified: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
