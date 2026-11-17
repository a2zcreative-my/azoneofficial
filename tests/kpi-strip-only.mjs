/* v1.338.0 - THE CEO'S STRICT GLOBAL KPI STRIP ENFORCEMENT (17-11-2026):
   "The attached Tasks KPI strip is the ONLY approved KPI design ... If any KPI
   is still displayed as an independent card, the implementation has FAILED."

   The Tasks strip is KpiRow / KpiTile (components/ui/kpi-tile.tsx). Every row
   of figures is that strip: one card, connected segments, zero gap. This
   guard reads the source; tests/browser/kpi-strip-sweep.py walks every tab
   and view in a browser and fails on any figure still drawn as a card.

     1  the twenty-three figure rows this release converted are KpiRow strips, and
        their hand-made markup (tiles, lanes, figs, dl facts, stat cards) is gone
     2  no screen draws a figure tile by hand: no tileCard / erp-stat tile and
        no SummaryStrip / StatStrip outside the old shared definitions
     3  the strip lays out by its OWN width too (a strip in a half-width card
        takes fewer columns, never shreds a label) and a too-narrow segment
        drops its icon, never its figure
     4  the converted stylesheets keep no figure-card rule

   node tests/kpi-strip-only.mjs   (NOMUT=1 skips the mutation pass) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const walk = (d) => readdirSync(join(root, d)).flatMap((f) => { const p = join(d, f); return statSync(join(root, p)).isDirectory() ? walk(p) : [p]; });

/* [file, the strip it must draw (a regex on the source), hand-made markup that must be gone] */
const SURFACES = [
  ["components/portal/fulfilment-card.tsx", /<KpiRow label=\{L\("TikTok orders by status"/, /className=\{`\$\{css\.tile\}|css\.tiles\b/],
  ["components/portal/ecommerce-panel.tsx", /data-testid="fulfil-lanes">\s*<KpiRow label=\{L\("Fulfilment status"/, /className=\{`\$\{css\.lane\}|css\.laneCount|role="tablist" aria-label=\{L\("Fulfilment status"/],
  ["components/portal/executive-cards.tsx", /<KpiRow label=\{L\("What the week still needs"/, /<dl className=\{css\.sumFacts\}|<dl className=\{`\$\{css\.sumTrio\}/],
  ["components/portal/executive-cards.tsx", /<KpiRow label=\{L\("My week at a glance"/, /css\.sumTrio\b/],
  ["components/portal/executive-cards.tsx", /<KpiRow label=\{L\("Sales recovery figures"/, /<dl className=\{css\.recStats\}/],
  ["components/portal/executive-cards.tsx", /<KpiRow label=\{L\("My work", "Kerja saya"\)\} testid="my-work-strip">/, /css\.workRow|css\.workCell/],
  ["components/portal/executive-cards.tsx", /<KpiRow label=\{L\("Today's counts"/, /<dl className=\{css\.todayCounts\}/],
  ["components/portal/dashboard.tsx", /<KpiRow label=\{L\("My shift today"/, /shiftCss\.tileBtn|shiftCss\.tileWell/],
  ["components/portal/dashboard.tsx", /data-testid="month-figures">\s*<KpiRow/, /className=\{css\.stat\}|css\.statValue|css\.statsFull/],
  ["components/portal/on-shift.tsx", /<KpiRow label=\{L\("This week's figures"/, /css\.weekFig\b/],
  ["components/portal/on-shift.tsx", /<KpiRow label=\{L\("Team on shift figures"/, /css\.teamFig\b|css\.figValue/],
  ["components/portal/inventory-overview.tsx", /<KpiRow label=\{L\("TikTok stock out"/, /css\.fig\b|css\.figValue/],
  ["components/portal/inventory-overview.tsx", /<KpiRow label=\{L\("Manual movements, 30 days"/, /css\.figLabel/],
  ["components/staff/team-map.tsx", /<KpiRow label=\{L\("The team at a glance"/, /tm\.stat\b|tm\.statIcon|tm\.statText/],
  ["components/portal/leave4.tsx", /<KpiRow label=\{L\("My leave balance"/, /l4\.balCard|l4\.balHead/],
  ["components/portal/leave4.tsx", /<KpiRow label=\{L\("Leave management figures"/, /l4\.tile\b/],
  ["components/portal/users-overview.tsx", /<KpiRow label=\{L\("Accounts at a glance"/, /css\.kpi\b|css\.kpiValue/],
  ["components/portal/company-monitor.tsx", /<KpiRow label=\{L\("Task progress, company-wide"/, /tileCard/],
  ["components/portal/sales-discipline.tsx", /<KpiRow label=\{L\("This week at a glance"[^>]*testid="command-strip">/, /css\.tiles\b|css\.tValue/],
  ["components/portal/trading-desk.tsx", /<KpiRow label=\{L\("Sales revenue by channel"/, /tileCard|erp-stat-value/],
  ["components/portal/trading-desk.tsx", /<KpiRow label=\{L\("The company at a glance"/, /tileCard/],
  ["components/portal/one-desk.tsx", /<KpiRow label=\{L\("Waiting on you"/, /erp-stat|erp-tiles-2/],
  ["components/portal/content-panel.tsx", /<KpiRow label=\{L\("Content by stage"/, /<SummaryStat\b|<SummaryStrip\b/],
];
const CSS = [
  ["components/portal/fulfilment-card.module.css", ["tiles", "tile", "word", "n"]],
  ["components/portal/ecommerce-panel.module.css", ["lane", "laneOn", "laneCount"]],
  ["components/portal/executive.module.css", ["sumTrio", "workRow", "workCell"]],
  ["components/portal/on-shift.module.css", ["tileBtn", "tileWell", "weekFig", "teamFig", "figValue"]],
  ["components/portal/dashboard.module.css", ["stat", "statValue", "statsFull"]],
  ["components/portal/inventory-overview.module.css", ["fig", "figValue"]],
  ["components/staff/team-map.module.css", ["stat", "statIcon", "statText"]],
  ["components/portal/leave4.module.css", ["balCard", "balHead", "tile"]],
  ["components/portal/users-panel.module.css", ["kpi", "kpiValue", "kpiIcon"]],
  ["components/portal/sales-discipline.module.css", ["tValue", "tNote"]],
];

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  /* 1 */
  for (const [f, draws, gone] of SURFACES) {
    const s = strip(src[f]);
    ok(`${f}: the figures are the one KPI strip`, draws.test(s) && /from "@\/components\/ui\/kpi-tile"/.test(s));
    ok(`${f}: no hand-made figure markup is left`, !gone.test(s), (s.match(gone) ?? [])[0]);
  }
  /* 2 */
  const tsx = Object.keys(src).filter((f) => f.endsWith(".tsx") && !/components\/(ui\/stat-(tile|card)|portal\/tab-concept)\.tsx$/.test(f));
  const byHand = tsx.filter((f) => /\btileCard\b|className="erp-stat"|"erp-stat-value"|<SummaryStrip\b|<StatStrip\b|<StatTile\b|<StatCard\b/.test(strip(src[f])));
  ok("no screen draws a figure tile by hand (tileCard / erp-stat / SummaryStrip / StatStrip / StatTile / StatCard)", byHand.length === 0, byHand.join(", "));
  /* 3 */
  const kt = strip(src["components/ui/kpi-tile.tsx"]), kc = src["components/ui/kpi-tile.module.css"];
  ok("the strip sits in a frame that measures its own width", /<div className=\{css\.frame\}>\s*<div className=\{`\$\{css\.row\}/.test(kt) && /\.frame \{\s*container: kpistrip \/ inline-size;/.test(kc));
  ok("a narrow strip only ever takes fewer columns (five or more -> three; four -> two; then two)",
    /@container kpistrip \(max-width: 52rem\) \{\s*\.row\[data-cells="5"\][^}]*--cells: 3;/.test(kc) && /@container kpistrip \(max-width: 36rem\) \{\s*\.row\[data-cells="4"\] \{ --cells: 2; \}/.test(kc)
    && /@container kpistrip \(max-width: 30rem\) \{\s*\.row\[data-cells\] \{ --cells: 2; \}/.test(kc));
  ok("a too-narrow segment drops its icon, never its figure", /@container \(max-width: 11\.25rem\) \{\s*\.tile \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\.well \{\s*display: none;/.test(kc));
  ok("a page may put its own artwork in the well, the segment unchanged", /glyph\?: ReactNode;/.test(kt) && /\{glyph \?\? <AppIcon name=\{icon\} \/>\}/.test(kt));
  /* 4 */
  for (const [f, names] of CSS) {
    const c = strip(src[f]);
    const left = names.filter((n) => new RegExp(`\\.${n}(?![\\w-])`).test(c));
    ok(`${f}: no figure-card rule is left`, left.length === 0, left.join(", "));
  }
  return res;
}

const files = [...new Set([...walk("components"), ...walk("app")])].filter((f) => /\.(tsx|css)$/.test(f)).map((f) => relative(root, join(root, f)).replace(/\\/g, "/"));
const src = Object.fromEntries(files.map((f) => [f, read(f)]));
let failed = 0;
for (const [n, c, d] of checks(src)) { if (!c) failed++; console.log(`${c ? "  ✓" : "  ✗"} ${n}${c ? "" : d ? `  [${String(d).slice(0, 200)}]` : ""}`); }

/* mutations: each break must be caught */
if (!process.env.NOMUT && failed === 0) {
  const MUT = [
    ["the fulfilment tiles come back", "components/portal/fulfilment-card.tsx", "<KpiRow label={L(\"TikTok orders by status\"", "<div className={css.tiles}><KpiRow label={L(\"x\""],
    ["a lane is a card again", "components/portal/ecommerce-panel.tsx", "data-testid=\"fulfil-lanes\">", "data-testid=\"fulfil-lanes\"><button className={`${css.lane} x`} />"],
    ["Sales Recovery's dl returns", "components/portal/executive-cards.tsx", "<KpiRow label={L(\"Sales recovery figures\"", "<dl className={css.recStats}><KpiRow label={L(\"x\""],
    ["a tileCard tile on a screen", "components/portal/trading-desk.tsx", "<KpiRow label={L(\"The company at a glance\"", "<div className={tileCard} /><KpiRow label={L(\"The company at a glance\""],
    ["the frame is dropped", "components/ui/kpi-tile.tsx", "<div className={css.frame}>", "<div>"],
    ["a narrow segment keeps its icon", "components/ui/kpi-tile.module.css", "  .well {\n    display: none;\n  }\n}\n@media (max-width: 767px) {", "  .well {\n    opacity: 1;\n  }\n}\n@media (max-width: 767px) {"],
    ["a figure-card rule stays in Leave", "components/portal/leave4.module.css", ".bal { min-width: 0;", ".balCard { border: 1px solid; }\n.bal { min-width: 0;"],
    ["Users draws its cards again", "components/portal/users-overview.tsx", "<KpiRow label={L(\"Accounts at a glance\"", "<div className={css.kpi} /><KpiRow label={L(\"Accounts at a glance\""],
  ];
  for (const [name, f, from, to] of MUT) {
    if (!src[f].includes(from)) { console.log(`  ✗ mutation "${name}" could not be applied`); failed++; continue; }
    const broken = { ...src, [f]: src[f].replace(from, to) };
    const caught = checks(broken).some(([, c]) => !c);
    console.log(`${caught ? "  ✓" : "  ✗"} mutation caught: ${name}`);
    if (!caught) failed++;
  }
}
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log("\nkpi-strip-only: every figure row is the one KPI strip.");
