/* v1.274.0 - the page frame is the same on every tab (the CEO, 10-11-2026:
   "do ensure that everything is standardize for all the tabs to ensure it
   follow the Globally css"; Pass 1: the page frame; the period once, in the
   sub-line).

   What it holds, as behaviour rather than spelling:
   1. a figure tile never carries its own period chip - the month picker says
      the period once and the sub-line says it in words;
   2. the tabs that drew their own figures (Attendance, Stokis) use the shared
      KpiTile; SummaryStat is kept for filter strips only (Content);
   3. Threads' page sections are the shared tab bar (LineTabs), its topics stay
      a pill row inside the card (by design, docs/INTERFACE-SYSTEM-V3.md 9);
   4. the chips that were hand-rolled are the shared chip tokens.
   Read only; changes nothing. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; } else { failed++; console.log(`  ✗ ${name}`); } };

function walk(dir, out = []) {
  for (const n of readdirSync(join(root, dir))) {
    const p = join(dir, n);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/* ---- 1. no period chip on a tile ---- */
const tile = read("components/ui/kpi-tile.tsx");
const props = tile.slice(tile.indexOf("export function KpiTile"), tile.indexOf("}) {", tile.indexOf("export function KpiTile")));
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
ok("KpiTile takes no period", !/\bperiod\b/.test(code(props)));
ok("KpiTile draws no period chip", !/css\.period/.test(tile) && !/\.period\s*\{/.test(read("components/ui/kpi-tile.module.css")));
const users = walk("components").concat(walk("app")).filter((p) => /<KpiTile\b/.test(read(p)));
const withPeriod = users.filter((p) => (read(p).match(/<KpiTile\b[\s\S]*?\/>/g) ?? []).some((t) => /\bperiod=/.test(t)));
ok(`no tile is handed a period (${withPeriod.join(", ") || "none"})`, withPeriod.length === 0);
ok("the tiles are used on several tabs", users.length >= 5);

/* the sub-line says the period in words where a period applies */
const eco = read("components/portal/ecommerce-panel.tsx");
ok("Ecommerce's month tiles say the period in the sub-line", (eco.match(/["`]This month · /g) ?? []).length >= 4 && /["`]Now · /.test(eco));
const acc = read("components/portal/accounting-panel.tsx");
ok("Accounting's money tiles say the month in the sub-line", (acc.match(/\$\{monthWord\(month\)\} · /g) ?? []).length >= 2);

/* ---- 2. one figure tile ---- */
const att = read("components/portal/attendance-panel.tsx");
const sto = read("components/portal/stokis-panel.tsx");
ok("Attendance's figures are KpiTiles", (att.match(/<KpiTile\b/g) ?? []).length >= 4 && !/<SummaryStat\b/.test(att));
ok("Stokis' figures are KpiTiles", (sto.match(/<KpiTile\b/g) ?? []).length >= 3 && !/<SummaryStat\b/.test(sto));
ok("Content keeps SummaryStat as its stage filter", /<SummaryStat\b/.test(read("components/portal/content-panel.tsx")));

/* ---- 3. one tab bar ---- */
const thr = read("components/portal/threads-panel.tsx");
ok("Threads' sections are the shared tab bar", /<LineTabs\b[^>]*value=\{section\}/.test(thr));
ok("Threads draws no second, hand-rolled section row: every pill is a topic", (thr.match(/\? tabPillOn\b/g) ?? []).length === (thr.match(/topic === t\.id \? tabPillOn/g) ?? []).length);

/* ---- 4. shared chips ---- */
const chipFiles = {
  "components/staff/staff-directory.tsx": /className=\{chipSm(Warn|Danger|Success)\}/g,
  "components/portal/events.tsx": /className=\{chipSmDanger\}/g,
  "components/portal/payroll-panel.tsx": /\$\{chipSmWarn\} \$\{chipAction\}/g,
};
for (const [p, re] of Object.entries(chipFiles)) ok(`${p} uses the shared chip tokens`, (read(p).match(re) ?? []).length >= 1);
ok("Staff Details' status chips are all tokens", (read("components/staff/staff-directory.tsx").match(/className=\{chipSm(Warn|Danger|Success)\}/g) ?? []).length >= 3);

ok("the guard is registered", /\["page-frame", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
