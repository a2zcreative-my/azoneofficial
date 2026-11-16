/* v1.323.0 - THE GLOBAL UI SYSTEM (the CEO's "A2Z OS - Complete Global UI
   System Restructuring", 16-11-2026; Phase A audit claude/UI-SYSTEM-STAGE-0-AUDIT.md,
   decisions D-1..D-7 approved "as per recommend"). The rules of the shared
   foundation, read from the source. The browser half is tests/browser/ui-system.py.

     R-1 / D-1 / D-5  ONE KPI strip: KpiRow is the card (the workspace card's
                      border, radius and shadow), a KpiTile is a segment of
                      it and never a card of its own; it counts its own cells;
                      two a row below 1024px with an odd last one across the
                      row; MetricStrip draws through it and keeps no style;
                      no module re-lays the strip
     D-1              ONE card radius: inside the workspace --radius-card,
                      --radius-panel and --radius-card-v2 are --surface-radius
     D-2              ONE view switch (PillSwitch, the master's segmented
                      toggle) and ONE tab row (LineTabs); the migrated screens
                      (Tasks, Desk) keep no private switch style; the rest
                      may only fall (a ratchet, Phase D)
     D-4              FillPanel: from 1024px only, never below its minimum,
                      never hiding anything (no overflow: hidden), and the
                      page keeps scrolling on a phone and a tablet
     the house rules  tokens only, the house breakpoints only, no dialog
                      made by hand in the shared pieces; nothing global hides
                      an overflow

   node tests/ui-system.mjs   (NOMUT=1 skips the mutation pass) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = {
  kpi: "components/ui/kpi-tile.tsx", kpiCss: "components/ui/kpi-tile.module.css", strip: "components/ui/metric-strip.tsx",
  panel: "components/ui/panel.tsx", panelCss: "components/ui/panel.module.css",
  fill: "components/ui/fill-panel.tsx", fillCss: "components/ui/fill-panel.module.css",
  globals: "styles/globals.css", v3: "styles/erp-v3.css",
  desk: "components/portal/desk-page.tsx", deskCss: "components/portal/desk-page.module.css",
  tasks: "components/portal/tasks.tsx", tasks5: "components/portal/tasks5.tsx",
  t2Css: "components/portal/tasks2.module.css", t5Css: "components/portal/tasks5.module.css",
  guards: "scripts/run-guards.mjs",
  /* v1.324.0 - Phase D, group 1: Sales, Payroll, Finance */
  sales: "components/portal/sales.tsx", salesShell: "components/portal/sales-shell.tsx", salesWs: "components/portal/sales-workspace.tsx",
  salesEnq: "components/portal/sales-enquiries.tsx", payments: "components/portal/payments-panel.tsx", qa: "components/portal/quote-approval.tsx",
  payroll: "components/portal/payroll-panel.tsx", finance: "components/portal/finance-panels.tsx", lineTabs: "components/ui/line-tabs.tsx",
  dashCss: "components/portal/dashboard-overview.module.css",
  /* v1.325.0 - Phase D, group 2: HR, Staff, Leave, Claims */
  leave: "components/portal/leave.tsx", leave4: "components/portal/leave4.tsx", claims: "components/portal/role-panels.tsx", claimsOv: "components/portal/claims-overview.tsx",
  staffDir: "components/staff/staff-directory.tsx", people: "components/portal/people-panel.tsx", drawer: "components/ui/side-drawer.tsx", health: "components/admin/system-health.tsx",
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const block = (css, sel) => { const i = css.indexOf(`${sel} {`); return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1); };

/* ---- the scan: every component and app file ---- */
const walk = (dir, out = []) => {
  for (const n of readdirSync(join(root, dir))) {
    const p = join(dir, n);
    if (statSync(join(root, p)).isDirectory()) walk(p, out); else out.push(relative(root, join(root, p)).replace(/\\/g, "/"));
  }
  return out;
};
const ALL = [...walk("components"), ...walk("app")];
const tsx = ALL.filter((f) => f.endsWith(".tsx"));
const css = ALL.filter((f) => f.endsWith(".module.css"));
const SWITCH_CLASS = /^\.(pills|seg|segBtn|toggle|toggleBtn|switch|modeSwitch|viewSwitch)\b[^{,]*\{/gm;
const scan = {
  /* a KpiTile is drawn only inside the strip */
  tileOutsideRow: tsx.filter((f) => f !== FILES.kpi && /<KpiTile\b/.test(read(f)) && !/<KpiRow\b|<MetricStrip\b/.test(read(f))),
  /* a module that re-lays the strip's segments */
  stripRelaid: css.filter((f) => f !== FILES.kpiCss && (/\.kpi\w*\s*(>|\s)\s*(div|\*|\[role)/.test(read(f)) || /data-kpi-strip|kpi-tile_/.test(read(f)))),
  /* hand-made tab rows outside components/ui */
  tablists: tsx.filter((f) => !f.startsWith("components/ui/")).reduce((n, f) => n + (read(f).match(/role="tablist"/g) ?? []).length, 0),
  /* private switch styles outside components/ui */
  switchRules: css.filter((f) => !f.startsWith("components/ui/")).reduce((n, f) => n + (read(f).match(SWITCH_CLASS) ?? []).length, 0),
  switchFiles: css.filter((f) => !f.startsWith("components/ui/") && SWITCH_CLASS.test(read(f)) && (SWITCH_CLASS.lastIndex = 0, true)),
  metricStripCss: ALL.includes("components/ui/metric-strip.module.css"),
};
/* the ratchets: today's counts (16-11-2026, after the Phase C pilot). They may only fall:
   Phase D moves each screen onto LineTabs / PillSwitch and lowers them. */
const BUDGET = { tablists: 13, switchRules: 42 }; // v1.324.0 group 1: 18 -> 15, 49 -> 45; v1.325.0 group 2 (HR, Staff, Leave, Claims): -> 13, 42

function checks(src, sc) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const kpi = strip(src.kpi), kpiCss = src.kpiCss;

  /* ---- R-1 / D-1 / D-5: the one KPI strip ---- */
  ok("KpiRow is the strip: it counts its own cells and marks itself", /data-cells=\{n\}/.test(kpi) && /data-kpi-strip=""/.test(kpi) && /const n = segments\(children\)/.test(kpi));
  ok("a fragment's figures are counted one by one", /isValidElement\(c\) \? 0 : c\.type === Fragment \? segments\(/.test(kpi));
  ok("a KpiTile is a segment, never a card of its own", !/erp-card/.test(kpi) && !/\bcard\b/.test(kpi.slice(kpi.indexOf("export function KpiTile"))));
  const row = block(kpiCss, ".row");
  ok("the strip is the workspace card: its border, radius and shadow", /border: 1px solid var\(--border\);/.test(row) && /border-radius: var\(--erp-radius-card/.test(row) && /box-shadow: var\(--erp-shadow-card/.test(row) && /background: var\(--card\);/.test(row));
  ok("segments are connected: no gap, a hairline between them", !/\bgap:/.test(row) && /\.tile \{[^}]*box-shadow: 1px 0 0 var\(--border\), 0 1px 0 var\(--border\);/.test(kpiCss) && /\.tile \{[^}]*border-radius: 0;/.test(kpiCss));
  ok("D-5: two a row below 1024px, an odd last one across the row; three from 1024px", /@media \(max-width: 1023px\) \{\s*\.row, \.row\[data-cells\] \{ --cells: 2; \}[\s\S]{0,120}?\.row > :last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/.test(kpiCss) && /@media \(max-width: 1279px\) \{\s*\.row\[data-cells="5"\][^}]*--cells: 3;/.test(kpiCss));
  ok("D-5: no figure hidden - nothing in the strip is display: none but the phone's icon well", (kpiCss.match(/display: none;/g) ?? []).length === 1 && /\.well \{\s*display: none;\s*\}/.test(kpiCss));
  ok("a filter in force is the master's gold wash and underline", /\.press\[aria-pressed="true"\] \{[^}]*inset 0 -2px 0 var\(--gold-solid\)/.test(kpiCss));
  ok("MetricStrip draws through the one strip and keeps no stylesheet", /<KpiRow label=\{label\} testid=\{testid\}>/.test(strip(src.strip)) && /<KpiTile /.test(strip(src.strip)) && !/\.module\.css/.test(src.strip) && !sc.metricStripCss);
  ok("every KpiTile is drawn inside a strip", sc.tileOutsideRow.length === 0, sc.tileOutsideRow.join(", "));
  ok("no module re-lays the strip's segments", sc.stripRelaid.length === 0, sc.stripRelaid.join(", "));

  /* ---- D-1: one card radius ---- */
  const ws = block(src.globals, ".erp-workspace");
  ok("D-1: inside the workspace every card radius is the one surface radius", /--surface-radius: 18px;/.test(ws) && /--radius-card: var\(--surface-radius\);/.test(ws) && /--radius-panel: var\(--surface-radius\);/.test(ws) && /--radius-card-v2: var\(--surface-radius\);/.test(ws));
  ok("controls share one radius token", /--radius-control: 12px;/.test(src.globals) && /--erp-radius-control: var\(--radius-control, 12px\);/.test(src.v3));

  /* ---- D-2: one view switch, one tab row ---- */
  const panel = strip(src.panel);
  ok("PillSwitch is the view switch: pressed buttons in a labelled group, each with its own test id", /export function PillSwitch</.test(panel) && /role="group" aria-label=\{label\}/.test(panel) && /aria-pressed=\{k === value\}/.test(panel) && /data-testid=\{testid \? `\$\{testid\}-\$\{k\}` : undefined\}/.test(panel));
  ok("on a phone the switch is one row that slides sideways (never a block of lines)", /@media \(max-width: 767px\) \{\s*\.pills \{ flex-wrap: nowrap; overflow-x: auto;/.test(src.panelCss));
  ok("its selected option is the master's raised white segment on a muted track", /\.pills \{[^}]*background: var\(--muted\);/.test(src.panelCss) && /\.pills button\[aria-pressed="true"\] \{[^}]*background: var\(--card\);/.test(src.panelCss));
  ok("Tasks: every view switch is PillSwitch, the Overview's panel switch is LineTabs", ["overview-mode", "mine-mode", "all-mode"].every((t) => new RegExp(`<PillSwitch testid="${t}"`).test(src.tasks)) && /<div data-testid="overview-panel-switch">\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<LineTabs /.test(src.tasks) && /<PillSwitch testid="cal-mode"/.test(src.tasks5));
  ok("Desk: the inbox filters are PillSwitch, with their counts", /<PillSwitch testid="inbox" label=\{L\("Show", "Tunjuk"\)\} value=\{filter\} options=\{pills\}/.test(src.desk) && /counts=\{known \?/.test(src.desk) && !/className=\{css\.pills\}/.test(src.desk));
  ok("the migrated screens keep no private switch style", ![src.deskCss, src.t2Css, src.t5Css].some((c) => SWITCH_CLASS.test(c) && (SWITCH_CLASS.lastIndex = 0, true)) && !/^\.pillN\b/m.test(src.deskCss) && !/^\.figures?\b/m.test(src.deskCss));
  ok(`hand-made tab rows outside components/ui may only fall (${sc.tablists} <= ${BUDGET.tablists})`, sc.tablists <= BUDGET.tablists);
  ok(`private switch styles may only fall (${sc.switchRules} <= ${BUDGET.switchRules})`, sc.switchRules <= BUDGET.switchRules, sc.switchFiles.join(", "));

  /* ---- D-4: the primary panel fills the screen ---- */
  const fill = strip(src.fill);
  ok("D-4: FillPanel acts from 1024px only; a phone and a tablet keep the page's scroll", /window\.matchMedia\("\(min-width: 1024px\)"\)/.test(fill) && /if \(!wide\.matches\) \{ setH\(null\); return; \}/.test(fill));
  ok("D-4: below its minimum it lets the page scroll instead", /const MIN_PX = 320;/.test(fill) && /setH\(room >= MIN_PX \? Math\.floor\(room\) : null\)/.test(fill));
  ok("D-4: whatever follows the panel (its pager, a note) stays on the screen", /if \(r\.height > 0 && r\.top >= nb - 1\) below = Math\.max\(below, r\.bottom\);/.test(fill) && /sc\.clientHeight - top - tail - FOOT_PX/.test(fill));
  ok("D-4: it scrolls, it never hides", /\.fill\[data-fill="on"\] \{[^}]*overflow-y: auto;/.test(src.fillCss) && !/overflow(-[xy])?: hidden|overflow: clip/.test(src.fillCss));
  ok("Tasks: the Overview's queue and the panel beside it each fill; the pager stays outside", /<FillPanel testid="overview-fill"><OverviewTable /.test(src.tasks) && /<FillPanel testid="overview-panel-body" className=\{t2\.railBody\}>/.test(src.tasks) && src.tasks.indexOf('testid="overview-fill"') < src.tasks.indexOf('<PaginationControls testid="overview-pages"'));
  ok("Desk: the inbox and Completed fill the panel; the pager stays outside it", (src.desk.match(/<FillPanel testid="(inbox|done)-panel">/g) ?? []).length === 2 && src.desk.indexOf('testid="inbox-panel"') < src.desk.indexOf("className={css.pager}"));

  /* ---- Phase D, group 1 (v1.324.0): Sales, Payroll, Finance ---- */
  const g1 = [src.sales, src.salesShell, src.salesWs, src.salesEnq, src.payments, src.payroll, src.finance].map(strip);
  ok("group 1 draws no tab row by hand and no pressed-button switch of its own", g1.every((c) => !/role="tablist"/.test(c)) && ![src.salesWs, src.salesEnq, src.finance].some((c) => /role="group" aria-label=\{L\("(Period|Which enquiries|Kind)"/.test(c)));
  ok("its sub-tabs are LineTabs, keeping their test ids", /<LineTabs label=\{L\("Documents", "Dokumen"\)\} testid="docs-tab"/.test(src.sales) && /<LineTabs label=\{L\("Customers and follow-ups"[^>]*testid="cust"/.test(src.salesShell) && /<LineTabs label=\{L\("Payments", "Bayaran"\)\} value=\{tab\} onChange=\{setTab\} testid="pay-tab"/.test(src.payments) && /data-testid=\{testid \? `\$\{testid\}-\$\{k\}` : undefined\}/.test(src.lineTabs));
  ok("its view switches are PillSwitch (the closed-sales period, which enquiries, the kind of transaction with its reason when it cannot be chosen)", /<PillSwitch testid="closed-period"/.test(src.salesWs) && /<PillSwitch testid="enq-view"/.test(src.salesEnq) && /<PillSwitch testid="add-kind"[\s\S]{0,400}?disabled=\{banks\.length < 2 \?/.test(src.finance) && /disabled=\{disabled\?\.\[k\] != null\} title=\{disabled\?\.\[k\] \?\? undefined\}/.test(src.panel));
  ok("its inline forms open in the drawer with the same fields and routes (the approval limit, the base salaries, Add Expense)",
    /<SideDrawer open=\{open\}[\s\S]{0,200}?dirty="auto"/.test(src.qa) && /\/staff\/quotes\/approval\/limit`, \{ method: "PUT"/.test(src.qa)
    && /<SideDrawer open=\{baseOpen\}[\s\S]{0,200}?dirty="auto"/.test(src.payroll) && /api\(`\/payroll\/base`, \{ method: "POST"/.test(src.payroll)
    && /<SideDrawer open=\{openForm\}[\s\S]{0,200}?dirty="auto"/.test(src.finance) && /staffApi<[^>]*>\(`\/expenses`, \{ method: "POST"/.test(src.finance) && !/<details[^>]*data-testid="expense-form"/.test(src.finance));
  ok("its long lists fill the screen on a desktop (documents, worklist, payroll grid and history, ledger, months)", /<FillPanel testid="docs-fill">/.test(src.sales) && (src.salesShell.match(/<FillPanel>/g) ?? []).length === 2
    && /<FillPanel id="payroll-table" testid="payroll-fill" className=\{`erp-table-scroll/.test(src.payroll) && /<FillPanel testid="payroll-history-fill"/.test(src.payroll)
    && /<FillPanel testid="tx-fill"/.test(src.finance) && /<FillPanel testid="report-months-fill"/.test(src.finance));
  ok("Reconciliation's two figures are the one KPI strip", /<KpiRow label=\{L\("Reconciliation figures"[^>]*testid="recon-figures">/.test(src.finance) && !/bigTile|bigNum/.test(src.finance));
  ok("the Dashboard's cards sit 12px apart on a desktop (the CEO: tighten so it fits)", /@media \(min-width: 1024px\) \{\s*\.page\.page,[^{]*\.page > \.grid \{\s*gap: var\(--space-3\);/.test(src.dashCss));

  /* ---- Phase D, group 2 (v1.325.0): HR, Staff, Leave, Claims ---- */
  const claimsPanel = strip(src.claims).slice(strip(src.claims).indexOf("export function ClaimsPanel("));
  ok("D-3: Apply Leave is a button that opens the same three steps in the drawer, never a tab", !/\["apply", L\("Apply Leave"/.test(src.leave) && /<SideDrawer open=\{applyOpen\}[\s\S]{0,200}?dirty=\{applyDone \? false : "auto"\}/.test(src.leave) && /<ApplyLeave4 types=\{LEAVE_TYPES\} toast=\{showLeaveToast\} submit=\{submitLeave\}/.test(src.leave) && /if \(v === "apply"\) \{ setApplyDone\(false\); setApplyOpen\(true\); return; \}/.test(src.leave));
  ok("D-3: an address that still asks for the old view opens the drawer (?view=apply, ?view=submit)", /if \(view === "apply"\) \{ setView\("overview"\);/.test(src.leave) && /if \(view === "submit"\) \{ setView\("overview"\); setSubmitOpen\(true\); \}/.test(claimsPanel));
  ok("D-3: Submit Claim is a button that opens the same form in the drawer, never a tab; a submit closes it", !/\["submit", L\("Submit Claim"/.test(claimsPanel) && /<SideDrawer open=\{submitOpen\}/.test(claimsPanel) && /if \(v === "submit"\) \{ setSubmitOpen\(true\); return; \}/.test(claimsPanel) && (claimsPanel.match(/setView\("mine"\); setSubmitOpen\(false\);/g) ?? []).length === 2 && !/<TabZone label=\{L\("Submit", "Hantar"\)\}/.test(claimsPanel));
  ok("group 2's switches are PillSwitch (claims, claim type, report basis, half day, calendar view, directory layout, roles filter)", ["claims-seg", "claim-type"].every((t) => claimsPanel.includes(`<PillSwitch testid="${t}"`)) && /<PillSwitch testid="claims-basis"/.test(src.claimsOv) && /<PillSwitch testid="apply-half"/.test(src.leave4) && /<PillSwitch testid="cal"/.test(src.leave) && /<PillSwitch testid="dir-layout"/.test(src.staffDir) && /<PillSwitch testid="roles-filter"/.test(src.staffDir) && ![claimsPanel, src.claimsOv].some((c) => /className="erp-segmented/.test(c)));
  ok("group 2's sub-tabs are LineTabs (profile and record sections, the lifecycle)", (src.staffDir.match(/<LineTabs label=\{L\("(Profile|Record) sections"/g) ?? []).length === 2 && /<LineTabs label=\{L\("Joining, leaving and letters"/.test(src.people) && !/role="tablist"/.test(strip(src.staffDir)) && !/<SectionTabs/.test(src.people));
  ok("group 2's long lists fill the screen on a desktop (the leave register, the staff directory)", /<FillPanel testid="leave-register-fill"/.test(src.leave) && /<FillPanel testid="staff-dir-fill"/.test(src.staffDir));
  ok("the drawer takes dirty as one value (auto until saved)", /dirty\?: boolean \| "auto";/.test(src.drawer));
  ok("System health marks an error a page of an OLDER version reported, never editing the record", /const reportedBy = \(message: string\)/.test(src.health) && /newerVersion\(APP_VERSION, m\[1\]!\)/.test(src.health) && /data-testid="err-older"/.test(src.health));

  /* ---- the house rules ---- */
  const mine = [src.kpiCss, src.panelCss, src.fillCss];
  ok("tokens only in the shared pieces", mine.every((c) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(c)));
  ok("the house breakpoints only", mine.every((c) => (c.match(/@media \((?:min|max)-width: (\d+)px\)/g) ?? []).every((m) => /: (640|768|1024|1280|639|767|1023|1279)px\)/.test(m))));
  ok("no hand-made dialog in the shared pieces", ![src.kpi, src.strip, src.fill, src.panel].some((s) => /role="dialog"/.test(s)));
  /* the one global clip is v1.23.8's body pair (iOS ignores hidden on body); it
     predates this brief and is reported to the owner, never widened. The sweeps
     (tests/browser/overflow-sweep.py, ui-system.py) measure spills under it. */
  const globalClips = [...strip(src.globals).matchAll(/(?:^|\n)\s*(html|body|\.erp-workspace|\.erp-main|main)\s*\{([^}]*)\}/g)].filter((m) => /overflow(-[xy])?: (hidden|clip)/.test(m[2]));
  ok("nothing new global hides an overflow (only v1.23.8's body pair)", globalClips.length === 1 && globalClips[0][1] === "body" && (globalClips[0][2].match(/overflow(-[xy])?: (hidden|clip)/g) ?? []).length === 2);
  ok("the guard is registered", /\["ui-system", "/.test(src.guards));
  return res;
}

const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(src, scan);
const failed = res.filter((r) => !r[1]);
for (const [name, , detail] of failed) console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
if (failed.length) { console.log(`ui-system: ${failed.length} of ${res.length} FAILED`); process.exit(1); }

/* ---- every rule catches its own breakage ---- */
const MUT = [
  ["a tile is a card again", "kpi", 'className={`${css.tile} ', 'className={`erp-card ${css.tile} '],
  ["the strip loses its shadow", "kpiCss", "box-shadow: var(--erp-shadow-card, none);", "box-shadow: none;"],
  ["a gap between the segments", "kpiCss", "  min-width: 0;\n  overflow: hidden;", "  gap: 0.75rem;\n  min-width: 0;\n  overflow: hidden;"],
  ["one a row on a phone", "kpiCss", ".row, .row[data-cells] { --cells: 2; }", ".row, .row[data-cells] { --cells: 1; }"],
  ["an odd last figure stranded at half width", "kpiCss", ".row > :last-child:nth-child(odd) { grid-column: 1 / -1; }", ".row > :last-child:nth-child(odd) { grid-column: auto; }"],
  ["a figure hidden on a phone", "kpiCss", "  .sub {\n    white-space: normal;\n  }", "  .sub {\n    display: none;\n  }"],
  ["the strip counts a fragment as one", "kpi", "c.type === Fragment", "c.type === null"],
  ["MetricStrip draws its own cards", "strip", "<KpiRow label={label} testid={testid}>", "<div className=\"erp-card\">"],
  ["a second card radius", "globals", "--radius-panel: var(--surface-radius);", "--radius-panel: 14px;"],
  ["the switch wraps into a block on a phone", "panelCss", ".pills { flex-wrap: nowrap; overflow-x: auto;", ".pills { flex-wrap: wrap; overflow-x: auto;"],
  ["the view switch without its pressed state", "panel", "aria-pressed={k === value}", "data-on={k === value}"],
  ["the Desk's pills back by hand", "desk", '<PillSwitch testid="inbox" label={L("Show", "Tunjuk")}', '<div className={css.pills} /><PillSwitch testid="inbox" label={L("Show", "Tunjuk")}'],
  ["a private toggle back in Tasks", "t2Css", "\n", "\n.toggle { display: flex; }\n"],
  ["FillPanel on a phone", "fill", '"(min-width: 1024px)"', '"(min-width: 0px)"'],
  ["FillPanel constrains a panel too small to use", "fill", "room >= MIN_PX ?", "room >= 0 ?"],
  ["the pager pushed off the screen", "fill", "sc.clientHeight - top - tail - FOOT_PX", "sc.clientHeight - top - FOOT_PX"],
  ["a column beside the panel counted as below it", "fill", "r.top >= nb - 1", "r.bottom > 0"],
  ["FillPanel hides instead of scrolling", "fillCss", "overflow-y: auto;", "overflow-y: hidden;"],
  ["the Tasks queue no longer fills", "tasks", '<FillPanel testid="overview-fill">', "<div>"],
  ["the inbox no longer fills", "desk", '<FillPanel testid="inbox-panel">', "<div>"],
  ["a literal colour in the strip", "kpiCss", "background: var(--card);\n  border: 1px solid var(--border);", "background: #ffffff;\n  border: 1px solid var(--border);"],
  ["a breakpoint of its own", "kpiCss", "@media (max-width: 767px) {\n  .tile", "@media (max-width: 700px) {\n  .tile"],
  ["a Payments tab row by hand again", "payments", '<LineTabs label={L("Payments", "Bayaran")} value={tab} onChange={setTab} testid="pay-tab"', '<div role="tablist" /><LineTabs label={L("Payments", "Bayaran")} value={tab} onChange={setTab} testid="pay-tab"'],
  ["the period switch by hand again", "salesWs", '<PillSwitch testid="closed-period"', '<div role="group" aria-label={L("Period", "Tempoh")} /><PillSwitch testid="closed-period"'],
  ["Add Expense back on the page", "finance", '<SideDrawer open={openForm}', '<SideDrawer open={true}'],
  ["the base salaries drawer without its warning", "payroll", '<SideDrawer open={baseOpen} onClose={() => { setBaseOpen(false); setBaseDraft({ ...base }); }} dirty="auto"', '<SideDrawer open={baseOpen} onClose={() => { setBaseOpen(false); setBaseDraft({ ...base }); }}'],
  ["the payroll grid no longer fills", "payroll", '<FillPanel id="payroll-table"', '<FillPanel data-x="1" id="payroll-table"'],
  ["a disabled option with no reason", "panel", "title={disabled?.[k] ?? undefined}", ""],
  ["the Dashboard's 16px gap back", "dashCss", "gap: var(--space-3);\n  }\n}", "gap: var(--space-4);\n  }\n}"],
  ["Apply Leave back as a tab", "leave", '...(!hourly ? ([["mine", L("My Leave"', '...(!hourly ? ([["apply", L("Apply Leave", "Mohon Cuti"), "x"], ["mine", L("My Leave"'],
  ["Apply Leave closes without asking", "leave", 'dirty={applyDone ? false : "auto"}', "dirty={false}"],
  ["Submit Claim back on the page", "claims", '<SideDrawer open={submitOpen}', '<SideDrawer open={true}'],
  ["a submitted claim leaves the drawer open", "claims", 'setView("mine"); setSubmitOpen(false); // v1.310.0', 'setView("mine"); // v1.310.0'],
  ["the claim type by hand again", "claims", '<PillSwitch testid="claim-type"', '<div className="erp-segmented" /><PillSwitch testid="claim-type"'],
  ["an old error read as live", "health", 'newerVersion(APP_VERSION, m[1]!)', 'false'],
  ["the page frame hides a spill", "globals", ".erp-workspace {", ".erp-workspace { overflow-x: hidden; } .erp-workspace {"],
];
let caught = 0;
if (process.env.NOMUT !== "1") {
  for (const [name, file, from, to] of MUT) {
    if (!src[file].includes(from)) { console.log(`  ✗ mutation "${name}": its anchor is gone from ${FILES[file]}`); process.exit(1); }
    const r = checks({ ...src, [file]: src[file].replace(from, to) }, scan);
    if (r.every((x) => x[1])) { console.log(`  ✗ mutation NOT caught: ${name}`); process.exit(1); }
    caught++;
  }
  /* the ratchets and the scan */
  for (const [name, sc] of [
    ["a tile drawn outside a strip", { ...scan, tileOutsideRow: ["components/portal/x.tsx"] }],
    ["a module re-lays the strip", { ...scan, stripRelaid: ["components/portal/x.module.css"] }],
    ["one more hand-made tab row", { ...scan, tablists: BUDGET.tablists + 1 }],
    ["one more private switch", { ...scan, switchRules: BUDGET.switchRules + 1 }],
    ["MetricStrip's stylesheet back", { ...scan, metricStripCss: true }],
  ]) {
    if (checks(src, sc).every((x) => x[1])) { console.log(`  ✗ mutation NOT caught: ${name}`); process.exit(1); }
    caught++;
  }
}
console.log(`ui-system: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
