/* tests/tab-concept.mjs — guard #94 (v1.173.0): EVERY TAB READS LIKE THE DASHBOARD.
 *
 * The CEO, 21-09-2026: *"All the tabs should responsive with PWA and also Web
 * view and the tabs should work like Dashboard concept style designed"*, and
 * chose all three of the Dashboard's habits:
 *
 *   (a) ZONES + CARD GRID - a tab body is a stack of zones, each opened by
 *       one small-caps caption (ZoneLabel), each zone a tight stack or a grid
 *       of cards; the same rhythm, one thing per card;
 *   (b) SUMMARY FIRST, DETAIL BELOW - the figures (tiles, a status strip)
 *       before the lists, forms and tables;
 *   (c) PILL ROWS INSTEAD OF STACKED CARDS - several things on one topic in
 *       one card, one at a time, behind the shared pill row; bodies hidden,
 *       never unmounted.
 *
 * components/portal/tab-concept.tsx makes that shape buildable (TabPage,
 * TabZone, SummaryStrip, SummaryStat, PillCard) and docs/INTERFACE-SYSTEM-V3.md
 * §8 is the written contract. This guard holds every tab in lib/portal-tabs.ts
 * to it, reading the SOURCE the way the other structure guards do
 * (tests/tab-zones.mjs, tests/desk-tabs.mjs): a tab that drifts back to one
 * long card, or a new tab that skips the zones, fails the build.
 *
 *   1. THE PRIMITIVES exist, render the shared caption and the shared pill
 *      row, and hide (never unmount) the panes.
 *   2. THE CLASSES exist in styles/erp-v3.css and are responsive the way the
 *      shell is: one column on a phone, side by side from 1024px; the tile
 *      grid 2 → 3 → 4/6 across.
 *   3. EVERY TAB has a stacked root and at least one captioned zone, in the
 *      file that draws its body.
 *   4. THE SUMMARY TIER is present on every tab that has figures to show.
 *   5. NO TAB ROOT is a bare legacy stack any more, and no restructured tab
 *      hand-rolls the pill.
 *   6. THE REFERENCE (the Dashboard) still reads in zones with a pill row.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- 1. the primitives ---- */
ok("tab-concept.tsx exists", existsSync(join(root, "components/portal/tab-concept.tsx")));
const tc = read("components/portal/tab-concept.tsx");
for (const name of ["TabPage", "TabZone", "SummaryStrip", "SummaryStat", "PillCard"]) {
  ok(`tab-concept exports ${name}`, new RegExp(`export function ${name}[<(]`).test(tc));
}
ok("TabPage is the shared stack", /className=\{`erp-stack erp-tab-page \$\{className\}`\}/.test(tc));
ok("TabZone is a tight stack opened by the shared ZoneLabel", /<section id=\{id\} className=\{`erp-stack-tight erp-tab-zone \$\{className\}`\}>\s*<ZoneLabel>\{label\}<\/ZoneLabel>/.test(tc)
   && /import \{ SectionTabs, ZoneLabel \} from "@\/components\/portal\/page-shared";/.test(tc));
ok("TabZone's card grid is the zone-grid class, never a Tailwind grid", /const COLS = \{ 1: "", 2: "erp-zone-grid-2", 3: "erp-zone-grid-3" \} as const;/.test(tc) && !/grid-cols-/.test(tc));
ok("SummaryStrip draws the shared tile grid", /"erp-tiles"/.test(tc) && /erp-tiles-6/.test(tc));
ok("SummaryStat is a plain figure until something is behind it, then a button", /if \(!onClick\) return <div className=\{cls\}/.test(tc) && /<button type="button" className=\{`\$\{cls\} erp-stat-button`\} onClick=\{onClick\}/.test(tc));
ok("SummaryStat never shows a false zero while loading", /busy \? <span className="erp-stat-busy"/.test(tc));
ok("PillCard switches with the shared SectionTabs and hides, never unmounts, its panes", /<SectionTabs value=\{value\} onChange=\{onChange\} tabs=\{tabs\} \/>/.test(tc) && /<div key=\{k\} hidden=\{value !== k\} className="erp-pane">\{panes\[k\]\}<\/div>/.test(tc));
ok("tab-concept carries no utility class (Tailwind is retired)", !/className="(?:[^"]* )?(?:mt-\d|flex|grid|space-y-\d|text-sm|gap-\d)(?: [^"]*)?"/.test(tc));

/* ---- 2. the classes ---- */
const v3 = read("styles/erp-v3.css");
for (const cls of [".erp-tab-page", ".erp-tab-zone", ".erp-zone-grid-2", ".erp-zone-grid-3", ".erp-tiles", ".erp-tiles-6", ".erp-stat-button", ".erp-stat-active", ".erp-stat-hint", ".erp-stat-busy", ".erp-pane", ".erp-pill-card-head", ".erp-zone-hint", ".erp-table-scroll", ".erp-chip-count"]) {
  ok(`erp-v3.css defines ${cls}`, v3.includes(cls));
}
ok("a zone's card grid is one column on a phone and two from 1024px",
   /\.erp-zone-grid-2, \.erp-zone-grid-3 \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/.test(v3)
   && /@media \(min-width: 1024px\) \{\s*\.erp-zone-grid-2 \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/.test(v3));
ok("the tile grid is 2 across on a phone, 3 from 640px, 4 from 1024px",
   /\.erp-tiles \{ display: grid; gap: 0\.5rem; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/.test(v3)
   && /@media \(min-width: 640px\) \{\s*\.erp-tiles \{ gap: 0\.75rem; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/.test(v3)
   && /\.erp-tiles \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/.test(v3));
ok("a hidden pane is display:none whatever else styles it", /\.erp-pane\[hidden\] \{ display: none; \}/.test(v3));
ok("a figure's tone colours the value only, from tokens", /\.erp-stat-danger \.erp-stat-value \{ color: var\(--danger\); \}/.test(v3) && /\.erp-stat-success \.erp-stat-value \{ color: var\(--success\); \}/.test(v3));
ok("StatStrip (the StatTile strip) is the same tile grid", /export function StatStrip\(\{ children, className = "" \}[^)]*\) \{\s*return <div className=\{`erp-tiles \$\{className\}`\}>/.test(read("components/ui/stat-tile.tsx")));

/* ---- 3. every tab ---- */
const tabsSrc = read("lib/portal-tabs.ts");
const allTabs = tabsSrc.slice(tabsSrc.indexOf("export const ALL_TABS = ["), tabsSrc.indexOf("] as const;", tabsSrc.indexOf("export const ALL_TABS = [")))
  .split("\n").map((l) => l.trim()).filter((l) => /^"[^"]+",$/.test(l)).map((l) => l.slice(1, -2));
ok("the tab registry was read", allTabs.length >= 25, String(allTabs.length));

const page = read("app/portal/page.tsx");
const blockOf = (tab) => {
  const a = page.indexOf(`{activeTab === "${tab}" &&`);
  if (a < 0) return "";
  const b = page.indexOf("\n          {activeTab === \"", a + 10);
  return page.slice(a, b < 0 ? page.indexOf("</main>", a) : b);
};

/* the file(s) that draw each tab's body; the page block itself counts */
const BODY = {
  "Dashboard": ["components/portal/dashboard.tsx"],
  "On Shift": ["components/portal/dashboard.tsx"],
  "Ecommerce": [],
  "Sales": ["components/portal/sales.tsx"],
  "Enquiries": ["components/portal/enquiries-panel.tsx"],
  "Sales Performance": ["components/portal/sales-performance-panel.tsx"],
  "Hankeis": ["components/portal/hankeis-panel.tsx"],
  "Inventory": ["components/portal/role-panels.tsx#InventoryPanel"],
  "Assets": ["components/portal/assets-panel.tsx"],
  "Hotels": ["components/portal/hotels-panel.tsx#HotelsPanel"],
  "Threads": ["components/portal/threads-panel.tsx#ThreadsPanel"],
  "ELFIA Store": ["components/portal/elfia-store-panel.tsx#ElfiaStorePanel"],
  "Web Orders": ["components/portal/web-orders-panel.tsx"],
  "ELFIA Traffic": ["components/portal/elfia-traffic-panel.tsx"],
  "HR": ["components/portal/role-panels.tsx#HrPanel"],
  "Attendance": [],
  "Tasks": ["components/portal/tasks.tsx"],
  "Announcements": ["components/portal/announcements.tsx#Announcements"],
  "Staff Details": ["components/staff/staff-directory.tsx#StaffDirectory"],
  "Leave": ["components/portal/leave.tsx#Leave"],
  "Claims": ["components/portal/role-panels.tsx#ClaimsPanel"],
  "Payroll": ["components/portal/payroll-panel.tsx#PayrollPanel"],
  "Finance": ["components/portal/role-panels.tsx#ExpensesPanel", "components/portal/finance-panels.tsx#CashFlowPanel"],
  "Commission": ["components/portal/commission-panels.tsx#CommissionPanel"],
  "Accounting": ["components/portal/accounting-panel.tsx#AccountingPanel"],
  "Companies": ["components/portal/companies-panel.tsx#CompaniesPanel"],
  "Cards": ["components/portal/cards-panel.tsx#CardsPanel"],
  "Profile": [],
  "Users": [],
  "Stokis": ["components/portal/stokis-panel.tsx"],
  "Content": ["components/portal/content-panel.tsx"],
};
const componentOf = (src, name) => {
  const s = src.indexOf(`export function ${name}(`);
  if (s < 0) return "";
  const e = src.indexOf("\n}\n", s);
  return src.slice(s, e < 0 ? src.length : e);
};
const bodyOf = (tab) => {
  const parts = [blockOf(tab)];
  for (const ref of BODY[tab] ?? []) {
    const [file, comp] = ref.split("#");
    const src = read(file);
    parts.push(comp ? componentOf(src, comp) : src);
  }
  return parts.join("\n");
};
ok("every registered tab is mapped to its body", allTabs.every((t) => t in BODY), allTabs.filter((t) => !(t in BODY)).join(", "));
for (const tab of allTabs) {
  const body = bodyOf(tab);
  ok(`${tab}: the page draws it`, blockOf(tab).length > 0);
  const stacked = /<TabPage[\s>]/.test(body) || /erp-stack erp-tab-page/.test(body) || /className=\{css\.(?:ecomStack|page)\}/.test(body);
  ok(`${tab}: the body is a stack of zones (TabPage or the shared stack)`, stacked);
  const captions = (body.match(/<TabZone label=|<ZoneLabel>/g) ?? []).length;
  ok(`${tab}: at least one captioned zone`, captions >= 1, `${captions} caption(s)`);
  ok(`${tab}: no bare legacy stack at its root`, !/return \(\s*(?:\/\*[\s\S]*?\*\/\s*)?<div className="(?:space-y-4 md:space-y-6|space-y-3 md:space-y-4|grid grid-cols-1 gap-4|flex flex-col gap-4 md:gap-6|min-w-0 space-y-5)">/.test(body));
}

/* ---- 4. the summary tier ---- */
const SUMMARY = ["Sales", "Enquiries", "Sales Performance", "Hankeis", "Inventory", "Assets", "Hotels", "Web Orders", "ELFIA Traffic", "Tasks", "Announcements", "Staff Details", "Leave", "Claims", "Finance", "Commission", "Accounting", "Stokis", "Content"];
for (const tab of SUMMARY) {
  const body = bodyOf(tab);
  ok(`${tab}: figures before records (SummaryStrip / StatStrip / StatTile / tiles)`, /<SummaryStrip|<StatStrip|<StatTile|erp-tiles|css\.kpis|LEAVE_TYPES\.map|grid-cols-3 gap-2|<InventoryStatusCard|statusCard/.test(body));
}
const enq = read("components/portal/enquiries-panel.tsx");
ok("a summary figure is a door: Enquiries' figures set the filter they count", /<SummaryStat label=\{L\("Waiting", "Menunggu"\)\}[^\n]*onClick=\{\(\) => setFilter\("new"\)\} active=\{filter === "new"\}/.test(enq));
const claims = componentOf(read("components/portal/role-panels.tsx"), "ClaimsPanel");
ok("Claims' figures scope the list, by claim date, this month", /const monthScope = \(canDecide \? claims : claims\.filter\(\(c\) => c\.user_id === userId\)\)\.filter\(\(c\) => \(c\.claim_date \?\? ""\)\.slice\(0, 7\) === nowMytMonth\);/.test(claims) && /onClick=\{\(\) => scopeList\("pending"\)\}/.test(claims));
const tasks = read("components/portal/tasks.tsx");
ok("Tasks' overdue figure uses the list's own rule (deadline before today, not completed)", /const overdueCount = openTasks\.filter\(\(t\) => !!t\.deadline && t\.deadline < todayISO\)\.length;/.test(tasks));
ok("a figure that is not known yet is busy, never 0", /busy=\{!loaded\}/.test(tasks) && /busy=\{view\.loading\}/.test(enq));

/* ---- 5. pill rows, not hand-rolled ---- */
for (const [file, src] of [["leave.tsx", read("components/portal/leave.tsx")], ["threads-panel.tsx", read("components/portal/threads-panel.tsx")], ["companies-panel.tsx", read("components/portal/companies-panel.tsx")], ["hankeis-panel.tsx", read("components/portal/hankeis-panel.tsx")]]) {
  ok(`${file} switches with the shared pill (tabPill / tabPillOn), not a hand-rolled one`, /tabPillOn : tabPill/.test(src) && !/bg-primary text-primary-foreground rounded-full px-3 py-1/.test(src));
}
ok("Leave's chooser still toggles off (v1.92.0) and wears the shared pill", /className=\{mgmt === "company" \? tabPillOn : tabPill\}\s*onClick=\{\(\) => setMgmt\(mgmt === "company" \? "" : "company"\)\}/.test(read("components/portal/leave.tsx")));
ok("the Dashboard's Work overview, the Sales work card and Inventory's Record card keep their pill rows", /<SectionTabs value=\{aroundTab\}/.test(read("components/portal/dashboard.tsx")) && /<SectionTabs value=\{workTab\}/.test(read("components/portal/sales.tsx")) && /<SectionTabs value=\{recordTab\}/.test(read("components/portal/role-panels.tsx")));

/* ---- 6. the reference ---- */
const dash = read("components/portal/dashboard.tsx");
ok("the Dashboard still reads in four zones", (dash.match(/<ZoneLabel>/g) ?? []).length >= 4);
ok("the Dashboard's figures come before its records (the month card before Around me)", dash.indexOf("<MonthAttendanceCard") > 0 && dash.indexOf("<MonthAttendanceCard") < dash.indexOf('L("Around me"'));
ok("the Dashboard's zones are the shared tight stack", (dash.match(/<section className="erp-stack-tight">/g) ?? []).length >= 4);

/* ---- the page ---- */
ok("page.tsx imports the concept", /import \{ TabPage, TabZone \} from "@\/components\/portal\/tab-concept";/.test(page));
ok("Attendance: TODAY, WAITING ON ME, THE ROSTER, SETUP", /label=\{L\("Today", "Hari ini"\)\}/.test(blockOf("Attendance")) && /label=\{L\("Waiting on me", "Menunggu saya"\)\}>/.test(blockOf("Attendance")) && /label=\{L\("The roster", "Jadual"\)\}/.test(blockOf("Attendance")) && /label=\{L\("Setup", "Tetapan"\)\}/.test(blockOf("Attendance")));
ok("Users: ACCOUNTS, then ACCESS AND LOCATIONS two up", /label=\{L\("Accounts", "Akaun"\)\}/.test(blockOf("Users")) && /label=\{L\("Access and locations", "Akses dan lokasi"\)\} cols=\{2\}/.test(blockOf("Users")));
ok("Profile: MY DETAILS, MY PAY, SECURITY AND PRIVACY", ["My details", "My pay", "Security and privacy"].every((c) => blockOf("Profile").includes(`label={L("${c}"`)));
ok("Finance: THIS MONTH (cash) then the expense zones from the panel", /label=\{L\("This month", "Bulan ini"\)\}>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<CashFlowPanel \/>/.test(blockOf("Finance")) && /<ExpensesPanel reporting=\{<PnlCard \/>\} \/>/.test(blockOf("Finance")));
ok("no page block keeps a bare erp-stack root beside the concept", !/{activeTab === "[^"]+" && \(\s*<div className="erp-stack">/.test(page));

/* ---- registration ---- */
const runner = read("scripts/run-guards.mjs");
ok("tab-concept is registered in the guard runner", /\["tab-concept", "/.test(runner));
ok("INTERFACE-SYSTEM-V3.md documents the tab concept (§8)", /## 8\./.test(read("docs/INTERFACE-SYSTEM-V3.md")) && /TabZone/.test(read("docs/INTERFACE-SYSTEM-V3.md")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
