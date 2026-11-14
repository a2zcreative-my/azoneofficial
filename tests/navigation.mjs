/* v1.287.0 - GLOBAL NAVIGATION (the CEO approved the navigation blueprint,
   12-11-2026: "Do as per your recommendation"; claude/NAVIGATION-BLUEPRINT.md).

   Held here, from the source and from lib/portal-tabs.ts itself (bundled and
   run), the browser half being tests/browser/nav-1.py:
     - the groups are the CEO's, in his order, with his modules in each;
     - every shown module has exactly ONE home (none twice, none orphaned);
     - there is no desktop More and no second cut of the registry;
     - the collapsed rail is one icon per group, each opening a labelled,
       keyboard-operable flyout;
     - routes and the role defaults are exactly what they were (navigation
       never changes who may open what - canSeeTab and the server do);
     - the phone bar is still Dashboard, Desk, On Shift, Tasks (+ More);
     - Users is shown as "Users & Security" on its unchanged URL.

     node tests/navigation.mjs */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => readFileSync(join(root, f), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let fail = 0, n = 0;
/* v1.304.0 - the calls below are ok(name, condition, why); the definition had them the other way round, so every check passed whatever it held */
const ok = (m, c, why = "") => { n++; if (!c) { fail++; console.error(`FAIL ${m}${why ? ` - ${String(why).slice(0, 300)}` : ""}`); } };

const dir = mkdtempSync(join(tmpdir(), "nav-"));
execSync(`npx esbuild "${join(root, "lib/portal-tabs.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(dir, "tabs.mjs")}" --log-level=error`, { cwd: root, stdio: "inherit" });
const T = await import(pathToFileURL(join(dir, "tabs.mjs")).href);
rmSync(dir, { recursive: true, force: true });

/* ---- the groups: the CEO's, in his order ---- */
const WANT = [
  ["Workspace", ["Dashboard", "Desk", "Announcements"]],
  ["Revenue", ["Sales", "Ecommerce", "Agents", "Financial Advisory"]],
  ["Operations", ["Tasks", "Inventory", "Assets", "Hotels"]],
  ["People", ["HR", "Staff Details", "Attendance", "On Shift", "Leave", "Claims", "Payroll"]],
  ["Finance", ["Finance", "Accounting", "Commission"]],
  ["ELFIA", ["ELFIA Store", "ELFIA Traffic"]],
  ["System", ["Companies", "Users", "Automation & Rules"]], // v1.293.0 - the watcher rules (Desk consolidation, D4)
  ["Account", ["Cards", "Profile"]],
];
ok("the groups are Workspace, Revenue, Operations, People, Finance, ELFIA, System, then Account", JSON.stringify(T.NAV_GROUPS.map((g) => g.title)) === JSON.stringify(WANT.map((w) => w[0])), T.NAV_GROUPS.map((g) => g.title).join(", "));
for (const [title, tabs] of WANT) {
  const g = T.NAV_GROUPS.find((x) => x.title === title);
  ok(`${title} holds ${tabs.join(", ")}`, g && JSON.stringify(g.tabs) === JSON.stringify(tabs), g?.tabs?.join(", "));
}
ok("Account is drawn in the name card's menu, not as a rail group", T.NAV_GROUPS.find((g) => g.title === "Account")?.placement === "account-menu");

/* ---- one home each ---- */
const shown = T.ALL_TABS.filter((t) => !T.PARKED_TABS.includes(t));
const placed = T.NAV_GROUPS.flatMap((g) => g.tabs);
const twice = placed.filter((t, i) => placed.indexOf(t) !== i);
ok("no module is placed in two groups", twice.length === 0, twice.join(", "));
ok("every shown module has a group (nothing falls to Other)", shown.every((t) => placed.includes(t)), shown.filter((t) => !placed.includes(t)).join(", "));
ok("no parked or unknown tab is placed", placed.every((t) => shown.includes(t)), placed.filter((t) => !shown.includes(t)).join(", "));
ok("the groups read as ALL_TABS in order (one sequence, not two)", JSON.stringify(placed) === JSON.stringify(shown));
const man = T.navManifest();
ok("the derived manifest has one entry per shown module, each with a group and a route", man.length === shown.length && man.every((e) => e.group && e.route), JSON.stringify(man.filter((e) => !e.group || !e.route)));

/* ---- routes and role defaults are unchanged ---- */
const ROUTES = { Dashboard: "home", Desk: "desk", Ecommerce: "ecommerce", Sales: "sales", Agents: "agents", "Financial Advisory": "financial-advisory", Inventory: "inventory", Assets: "assets", Hotels: "hotels", "ELFIA Store": "elfia-store", "ELFIA Traffic": "elfia-traffic", HR: "hr", Attendance: "attendance", "On Shift": "on-shift", Tasks: "tasks", Announcements: "news", "Staff Details": "staff", Leave: "leave", Claims: "claims", Payroll: "payroll", Finance: "finance", Accounting: "accounting", Commission: "commission", Companies: "companies", Cards: "cards", Profile: "profile", Users: "users", "Automation & Rules": "automation" }; // v1.293.0 - /portal/automation
ok("every URL is what it was (/portal/news, /portal/staff, /portal/users ...)", Object.entries(ROUTES).every(([t, s]) => T.TAB_ROUTE[t]?.slug === s) && Object.keys(T.TAB_ROUTE).length === Object.keys(ROUTES).length);
/* the default matrix as it stood in 1.286.0 (the blueprint's table): Y = drawn by default */
const ROLES = ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "marketing", "editor", "live_host", "admin", "super_admin", "agent"];
const MATRIX = {
  Dashboard: "YYYYYYYYYY-", Desk: "YYYYYYYYYY-", Announcements: "YYYYYYYYYY-", Sales: "YYYYY---YY-", Ecommerce: "YYYYYY--YY-", Agents: "YYY-Y----YY",
  "Financial Advisory": "YYY-Y----Y-", Tasks: "YYYYYYYYYY-", Inventory: "YYYYYY--YY-", Assets: "YYYYYYYYYY-", Hotels: "YYYY----YY-", // v1.304.0 - Assets for every staff member (My assets, the CEO D-4); the register stays asset_view on the server
  HR: "YYYY----YY-", "Staff Details": "YYYY----YY-", Attendance: "YYYYYYYYYY-", "On Shift": "YYYYYYYYYY-", Leave: "YYYYYYYYYY-", Claims: "YYYYYYYYYY-", Payroll: "YY------YY-",
  Finance: "YY------YY-", Accounting: "Y-------YY-", Commission: "YYY-Y---YY-", "ELFIA Store": "YYYYYY--YY-", "ELFIA Traffic": "YYYYYY--YY-",
  Companies: "YYY------Y-", Users: "YY------YY-", Cards: "YYY------Y-", Profile: "YYYYYYYYYYY",
};
const diffs = [];
for (const [tab, row] of Object.entries(MATRIX)) ROLES.forEach((r, i) => { const want = row[i] === "Y"; if (T.canSeeTab(r, tab) !== want) diffs.push(`${r}/${tab}`); });
ok("who may open what is exactly the 1.286.0 default for every role (navigation changed no access)", diffs.length === 0, diffs.join(", "));
ok("an agent still sees only the agent workspace and Profile", shown.filter((t) => T.canSeeTab("agent", t)).join(",") === "Agents,Profile");

/* ---- the phone bar ---- */
for (const role of ["ceo", "sales_marketing", "editor"]) {
  const vis = shown.filter((t) => T.canSeeTab(role, t));
  ok(`${role}: the phone bar is still Dashboard, Desk, On Shift, Tasks`, T.mobileNavStops(vis, { role }).map((s) => s.tab).join(",") === "Dashboard,Desk,On Shift,Tasks");
}

/* ---- the rail (source) ---- */
const nav = strip(read("components/layout/side-nav.tsx"));
const css = read("components/layout/side-nav.module.css");
const icons = read("components/layout/nav-icons.tsx");
ok("SECTIONS is NAV_GROUPS itself - one grouping for rail, phone and access card", /export const SECTIONS: \{ title: string; tabs: string\[\] \}\[\] = NAV_GROUPS;/.test(nav));
ok("no desktop More and no second cut (RAIL_PRIMARY retired)", !/RAIL_PRIMARY|moreItems|"More"|Ellipsis/.test(nav));
ok("the expanded rail draws every item of every group", /const shown = section\.items;/.test(nav));
ok("the group holding the open page cannot be folded away", /const open = collapsed \|\| !portalRail \|\| holdsActive \|\| !folded\.includes\(section\.title\);/.test(nav) && /disabled=\{holdsActive\}/.test(nav));
ok("the collapsed portal rail draws one button per group, named as a group, with aria-haspopup and aria-expanded",
  /\{groupRail && railGroups\.map/.test(nav) && /aria-haspopup="true" aria-expanded=\{open\}/.test(nav) && /`\$\{name\} group`/.test(nav));
ok("the group holding the open page wears the gold on the collapsed rail", /className=\{`erp-rail-item \$\{holds \? css\.groupOn : ""\}`\}/.test(nav) && /\.groupOn \{[^}]*background: var\(--gold-solid\)/.test(css));
ok("the flyout: arrow keys, Home/End, Escape back to the icon, Tab or an outside click closes it",
  /if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); closeFly\(true\); return; \}/.test(nav) && /if \(e\.key === "Tab"\) \{ setFly\(null\); return; \}/.test(nav)
  && /\["ArrowDown", "ArrowUp", "Home", "End"\]/.test(nav) && /document\.addEventListener\("mousedown", onDown\)/.test(nav));
ok("the flyout marks the open module and closes before it navigates", /aria-current=\{it\.name === active \? "page" : undefined\}/.test(nav) && /onClick=\{\(\) => \{ closeFly\(false\); onSelect\(it\.name\); \}\}/.test(nav));
ok("every rail group has its own icon, none borrowed from a module", T.NAV_GROUPS.filter((g) => g.placement !== "account-menu").every((g) => new RegExp(`\\b${g.id}: [A-Z]`).test(icons)));
ok("the flyout uses tokens only (no raw colour or radius)", !/#[0-9a-f]{3,8}\b/i.test(css.slice(css.indexOf(".flyout"))) && /\.flyout \{[^}]*border-radius: var\(--radius-control\)/.test(css));

/* ---- labels and the phone's More ---- */
const i18n = read("lib/i18n.ts");
ok("Users is shown as Users & Security (BM: Pengguna & Keselamatan), on its unchanged URL", /"Users": \{ en: "Users & Security", ms: "Pengguna & Keselamatan" \}/.test(i18n) && T.TAB_ROUTE.Users.slug === "users");
ok("Workspace has its BM heading", /Workspace: "Ruang Kerja"/.test(nav));
const shell = strip(read("components/portal/portal-shell.tsx"));
ok("the phone's More shows Projects in Operations, for the same people as the rail's shortcut", /section\.title === "Operations" && showProjects &&/.test(shell) && /setTabStart\(\{ tab: "Tasks", view: "projects" \}\); setTab\("Tasks"\); setMoreOpen\(false\);/.test(shell));

if (fail) { console.error(`navigation: ${fail} of ${n} failed`); process.exit(1); }
console.log(`navigation: ${n} checks passed - seven groups in the CEO's order, one home per module, no desktop More, group flyouts when collapsed, routes and access unchanged`);
