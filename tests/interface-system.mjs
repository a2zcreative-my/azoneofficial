#!/usr/bin/env node
/* Guard #89 - v1.169.0: one interaction system on PWA and web. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
const css = read("styles/globals.css");
const styles = read("lib/ui-styles.ts");
const rows = read("components/ui/row-button.tsx");
const dashboard = read("components/portal/dashboard.tsx");
const migratedActions = [
  "components/portal/role-panels.tsx",
  "components/portal/sales.tsx",
  "components/portal/payroll-panel.tsx",
  "components/portal/roster-board.tsx",
  "components/portal/connection-status-card.tsx",
  "components/ui/confirm-dialog.tsx",
  "components/ui/prompt-dialog.tsx",
].map(read).join("\n");

let passed = 0;
let failed = 0;
const ok = (label, condition) => {
  if (condition) passed++;
  else { failed++; console.log(`  x ${label}`); }
};

ok("labelled commands have one 44px pill base",
  /\.erp-button \{[\s\S]*?min-height: 44px;[\s\S]*?border-radius: 9999px;/.test(css));
ok("icon commands have one 44px circular base",
  /\.erp-icon-button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?border-radius: 9999px;/.test(css));
ok("button states use the existing semantic palette",
  ["primary", "secondary", "danger", "positive", "warning", "accent", "inverse"].every((name) => css.includes(`.erp-button-${name}`))
  && /var\(--primary\)/.test(css) && /var\(--gold-solid\)/.test(css));
ok("shared portal buttons all compose from the global CSS contract",
  ["btnClass", "btnClassBlock", "btnGhost", "btnSm", "btnSmPrimary", "btnSmWarning", "btnSmInverse", "btnQuick", "btnQuickPrimary", "btnHero", "btnHeroPrimary", "iconBtn", "iconBtnInverse", "tabPill", "tabPillOn"]
    .every((name) => new RegExp(`export const ${name} =[\\s\\S]{0,100}?erp-(button|icon-button)`).test(styles)));
ok("shared actions no longer shrink on desktop",
  !/export const (btnClass|btnGhost|btnSm|btnQuick|iconBtn|tabPill)[\s\S]{0,180}?(md:min-h|sm:h-7|md:h-9)/.test(styles));
ok("record-row commands use the same pill contract",
  (rows.match(/erp-button erp-button-/g) ?? []).length === 5);
ok("high-use operational actions no longer own compact button geometry",
  !/<(?:button|label|a)[^>]*className="[^"]*inline-flex h-(?:7|8|9|10|11)[^"]*rounded/.test(migratedActions)
  && !migratedActions.includes('className="rounded-lg bg-white/15 px-2.5 py-1'));
ok("Dashboard has one focused shift hero",
  /className=\{`erp-shift-hero/.test(dashboard)
  && /btnHeroPrimary/.test(dashboard) && /btnHero/.test(dashboard));
/* v1.171.0 (the CEO: "clean off my dashboard and resort it based on it own
   function"): the four-tile strip is gone - its figures live in the month
   card - and the events are the work overview's fourth pill. */
ok("Dashboard's month is one card, not a strip plus a card plus a chart",
  !/erp-dashboard-stat/.test(dashboard) && !/erp-dashboard-stat/.test(css)
  && (dashboard.match(/<MonthAttendanceCard /g) ?? []).length === 1
  && /daysPresent=\{daysPresent\} hours=\{monthHours\}/.test(dashboard));
ok("Tasks, leave, news and events share one work overview",
  /useState<"tasks" \| "leave" \| "news" \| "events">\("tasks"\)/.test(dashboard)
  && /<SectionTabs value=\{aroundTab\}/.test(dashboard)
  && /<div hidden=\{aroundTab !== "events"\}/.test(dashboard)
  && !/\ballTasks\b/.test(dashboard));
ok("the company palette remains unchanged",
  /--brand-primary: #1a2946;/.test(css)
  && /--brand-accent: #c8a96a;/.test(css)
  && /--gold-solid: #c9a227;/.test(css));

if (failed) {
  console.log(`\ninterface-system: ${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`interface-system: ${passed} checks passed.`);
}
