#!/usr/bin/env node
/* Guard - v1.203.0: THE DASHBOARD OVERVIEW IS A WINDOW, NOT A SECOND SYSTEM.
 *
 * The owner, 24-10-2026 (A2Z OS 2.0): "FOLLOW THE DESIGN. USE REAL DATA.
 * REUSE EXISTING MODULES. ZERO UNNECESSARY DUPLICATION." The overview
 * (components/portal/dashboard-overview.tsx) draws the reference's cards from
 * the modules' own reads. This guard holds the rules that make that true:
 *
 *   1. ONE SALES FIGURE. The headline is the Sales floor's sum - TikTok +
 *      paid invoices + other shipments + manual sales - the same four
 *      channels trading-desk.tsx adds. The month bars are the revenue lines
 *      (stokis and ELFIA web orders too) and say so in a caption.
 *   2. ONE TASK RULE. Open / Pending / Closed / Overdue come from
 *      lib/task-figures.ts, which the Tasks page reads too, over the same
 *      board view (?all=1 for the managing roles).
 *   3. NOTHING WRITES. No POST, PUT, PATCH or DELETE from the overview.
 *   4. EACH READ ONLY FOR WHO MAY MAKE IT. The audit trail and the system
 *      health are asked for only by the tier the worker answers (CEO, admin,
 *      super admin - rank 3 and up); revenue only by the worker's
 *      revenue_view roles; the team monitor only by the managing roles.
 *   5. NO SAMPLE DATA, NO INVENTED FIGURES. None of the reference's numbers;
 *      no uptime percentage; no module-usage figures; no enquiries tile (the
 *      Enquiries tab was retired in v1.183.0).
 *   6. NOTHING OF MY DAY IS LOST. The zones are still the Dashboard's, still
 *      in DASHBOARD_ZONES order, on the My Day view; the clock-first job opens
 *      there.
 *   7. QUICK ACTIONS OPEN EXISTING WORKFLOWS, gated by the tab strip.
 *
 * Negative-tested by: adding stokis to revenueMonthTotals (1 fails);
 * counting overdue with <= in lib/task-figures (2 fails); adding a POST to
 * the overview (3 fails); asking /audit for every role (4 fails); writing
 * "99.9%" into the status card (5 fails); defaulting every job to the
 * overview (6 fails).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const ov = read("components/portal/dashboard-overview.tsx");
const code = strip(ov);
const desk = read("components/portal/trading-desk.tsx");
const dash = read("components/portal/dashboard.tsx");
const perms = read("worker/src/permissions.ts");
const index = read("worker/src/index.ts");
const tasks = read("components/portal/tasks.tsx");
const lib = read("lib/task-figures.ts");
const list = (src, re) => [...((src.match(re) ?? [])[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();

/* ---- 1. one sales figure ---- */
{
  const fn = ov.slice(ov.indexOf("export function revenueMonthTotals"), ov.indexOf("\n}\n", ov.indexOf("export function revenueMonthTotals")));
  const channels = (s) => [...s.matchAll(/rev\??\.(\w+)/g)].map((m) => m[1]);
  const mine = [...new Set(channels(fn.slice(fn.indexOf("const total"), fn.indexOf("const last"))))].sort();
  const floor = desk.slice(desk.indexOf("const monthTotal = rev"), desk.indexOf("const lastTotal = rev"));
  const theirs = [...new Set(channels(floor))].sort();
  ok("the headline adds the Sales floor's four channels, no more and no fewer", JSON.stringify(mine) === JSON.stringify(theirs) && mine.length === 4, `${mine} vs ${theirs}`);
  ok("the headline and the tile both read revenueMonthTotals", (code.match(/revenueMonthTotals\(rev\)/g) ?? []).length >= 1 && /const sales = rev \? revenueMonthTotals\(rev\) : null;/.test(code));
  ok("a change against last month is only shown when last month had sales", /const delta = last > 0 \?/.test(fn));
  ok("the bars are the revenue lines, and the caption says they include stokis and ELFIA web orders", /rev\?\.overall\?\.months/.test(code) && /stokis and ELFIA web orders included/.test(ov));
}

/* ---- 2. one task rule ---- */
{
  ok("the overdue rule lives in lib/task-figures.ts", /const overdueCount = openTasks\.filter\(\(t\) => !!t\.deadline && t\.deadline < todayISO\)\.length;/.test(lib));
  ok("the Tasks page and the overview both read it", /taskFigures\(tasks, todayISO\)/.test(tasks) && /taskFigures\(tasks, today\)/.test(code));
  ok("the overview reads the board the Tasks page reads", /useCachedApi<\{ tasks: Task\[\] \}>\(`\/staff\/tasks\$\{manage \? "\?all=1" : ""\}`, true, \["tasks"\]\)/.test(code)
     && /useCachedApi<\{ tasks: Task\[\] \}>\(`\/staff\/tasks\$\{canManage \? "\?all=1" : ""\}`, true, \["tasks"\]\)/.test(tasks));
}

/* ---- 3. nothing writes ---- */
ok("the overview never writes", !/method:\s*"(?:POST|PUT|PATCH|DELETE)"/.test(code));

/* ---- 4. each read only for who may make it ---- */
{
  const adminTier = list(code, /const ADMIN_TIER = \[([^\]]*)\]/);
  const rank = Object.fromEntries([...index.matchAll(/^\s+([a-z_]+): (\d),?$/gm)].map((m) => [m[1], Number(m[2])]));
  const workerTier = Object.entries(rank).filter(([, n]) => n >= 3).map(([r]) => r).sort();
  ok("the audit trail and health are asked for by exactly the tier the worker answers (rank 3+)", JSON.stringify(adminTier) === JSON.stringify(workerTier), `${adminTier} vs ${workerTier}`);
  ok("…and only when this person is in it", /if \(adminTier\) \{[\s\S]{0,200}?"\/audit\?limit=60"[\s\S]{0,300}?"\/system\/health"/.test(code));
  const revenue = list(code, /const REVENUE_READERS = \[([^\]]*)\]/);
  const workerRevenue = list(perms, /revenue_view: \[([^\]]*)\]/);
  ok("revenue is read by the worker's revenue_view roles only", JSON.stringify(revenue) === JSON.stringify(workerRevenue), `${revenue} vs ${workerRevenue}`);
  ok("…and the request is not made for anyone else", /useCachedApi<RevenueData>\(canRevenue \? "\/staff\/revenue" : null, canRevenue\)/.test(code));
  ok("the team monitor is the Dashboard's own request, for the managing roles", /if \(!MANAGE_ROLES\.includes\(user\.role\)\) return;[\s\S]{0,200}?"\/staff\/attendance\/monitor"/.test(dash)
     && /monitor=\{MANAGE_ROLES\.includes\(user\.role\) \? monitor : null\}/.test(dash));
  ok("a summary figure is drawn only when the worker sent it", /typeof sum\.open_quotations === "number"/.test(code) && /if \(typeof v === "number" && can\(tab\)\)/.test(code));
}

/* ---- 5. no sample data, no invented figures ---- */
{
  ok("none of the reference's sample figures", !/128,?450|1,?238|99\.[89]|Shopee Live Campaign|TikTok Content Series|Prepare LIVE rundown/.test(ov));
  const statusCard = code.slice(code.indexOf("const statusCard"), code.indexOf("return (", code.indexOf("const statusCard")));
  ok("no percentage anywhere in the status card, and it says uptime is not measured", statusCard.length > 500 && !/%/.test(statusCard) && /Uptime is not measured here/.test(ov));
  ok("no enquiries tile and no module-usage figures", !/Total Enquiries|Module Usage|enquir/i.test(code));
}

/* ---- 6. nothing of My Day is lost ---- */
{
  ok("the zones are still drawn, in DASHBOARD_ZONES order", /\{shiftOnly \? zoneShift : DASHBOARD_ZONES\[lead\]\.map\(\(k\) => <Fragment key=\{k\}>\{ZONES\[k\]\}<\/Fragment>\)\}/.test(dash));
  ok("the clock-first job opens on My Day, the others on the overview", /const view: "overview" \| "day" = dashView \?\? \(lead === "shift" \? "day" : "overview"\);/.test(dash));
  ok("the zones only leave the screen under the overview (still mounted)", /\.page\[data-view="overview"\] > \[data-zone\] \{\s*display: none;/.test(read("components/portal/dashboard.module.css")));
  ok("On Shift is untouched: no overview, no tabs", /data-view=\{shiftOnly \? undefined : view\}/.test(dash) && /\{shiftOnly \? \(/.test(dash));
}

/* ---- 7. quick actions open existing workflows ---- */
{
  ok("each action is gated by the tab strip, except the clock (everyone's)", [...code.matchAll(/\{ key: "([a-z]+)", icon: [^}]*show: ([^}]+) \}/g)].every(([, k, show]) => k === "clock" ? /true/.test(show) : /can\("/.test(show)));
  ok("create quotation is the Sales tab's own entry", /onCreateQuotation \? onCreateQuotation\(\) : go\("Sales"\)/.test(code));
  ok("task, leave and claim open their own forms", /openAt\("Tasks", "create"\)/.test(code) && /openAt\("Leave", "apply"\)/.test(code) && /openAt\("Claims", "submit"\)/.test(code));
  const provider = read("components/portal/portal-provider.tsx");
  ok("…and the start view is dropped when another tab is chosen", /if \(tabStart && tabStart\.tab !== tab\) setTabStart\(null\);/.test(provider));
}

/* ---- v1.213.0: no exact repeats between Overview and My Day ----
   The owner, 27-10-2026: "Keep both, remove exact repeats only"; move the
   Leave Application card to the Overview; the buttons under the clock go
   (Quick Actions keeps them). The Company card stays on My Day. */
{
  const dashCode = strip(dash);
  ok("Apply leave and Create quotation are the Overview's Quick Actions only, not under the clock",
     !/tr\("Apply leave", lang\)\}\s*<\/button>[\s\S]{0,900}?\{otButtons\}/.test(dashCode) && !/tr\("Create quotation", lang\)/.test(dashCode)
     && /\{otButtons && <div className=\{shiftCss\.quick\}>\{otButtons\}<\/div>\}/.test(dashCode)
     && /key: "leave", icon: "holiday", label: L\("Apply leave"/.test(code) && /key: "quote", icon: "document", label: L\("Create quotation"/.test(code));
  ok("the month's leave applications are one card, on the Overview under Upcoming & Pending",
     !/LeaveMonthCard/.test(dashCode) && (code.match(/<LeaveMonthCard /g) ?? []).length === 1
     && /<div className=\{ov\.column\}>\s*\{upcomingCard\}\s*<LeaveMonthCard go=\{go\} \/>/.test(code));
  ok("The Company card stays on My Day (the owner kept it)", /<TradingDesk user=\{user\} go=\{go\} lang=\{lang\} mode="pulse" \/>/.test(dash));
}

/* ---- registration ---- */
ok("the guard is registered", /\["dashboard-overview", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
