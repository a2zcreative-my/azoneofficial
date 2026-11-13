/**
 * v1.296.0 - ECOMMERCE v2.0, RELEASE E-1 (CEO directive "A2Z OS - ECOMMERCE
 * v2.0", 12-11-2026; "approve continuously", 13-11-2026;
 * claude/ECOMMERCE-V2-AUDIT.md, E1 as recommended: the written layout).
 * Frontend only: no worker route, no webhook, no stock or finance rule.
 *
 * What must stay true:
 *   A  the six views are in the address (Back / Forward); a view this person
 *      may not open is never drawn, and its address opens the Overview
 *   B  the Overview is the directive's: four figures, each with its period
 *      and definition; Needs Attention beside the Fulfilment Summary; Recent
 *      Orders beside Stock Alerts - in DOM order, no CSS reordering
 *   C  no figure is invented: the sales tile is called gross, never net; every
 *      alert has records behind it; stock alerts are Inventory's own statuses
 *   D  the fulfilment lifecycle is said: returned / cancelled is an outcome
 *   E  the page still writes nothing (no order, stock movement or sale)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const FILES = { panel: "components/portal/ecommerce-panel.tsx", css: "components/portal/ecommerce-panel.module.css", ful: "components/portal/fulfilment-card.tsx", portal: "app/portal/page.tsx" };

function checks(f) {
  const out = [];
  const ok = (name, c, d = "") => out.push([name, Boolean(c), d]);
  const p = strip(f.panel);
  const ov = p.slice(p.indexOf('{view === "overview" && ('), p.indexOf('{view === "orders" &&'));

  ok("A the view is in the address", /useTabViewAddress\("Ecommerce", view, setView, allowed\);/.test(p) && /startView=\{startOf\("Ecommerce"\)\}/.test(f.portal));
  ok("A Stock and Analytics are opened only by those who may", /\(v !== "stock" \|\| canStock\) && \(v !== "analytics" \|\| canRevenue \|\| canAnalytics\)/.test(p) && /const view: View = allowed\(asked\) \? asked : "overview";/.test(p));
  ok("A the guard is stable", /const allowed = useCallback\(/.test(p));

  const order = ["{tiles}", "{alertCard}", "<FulfilmentCard", '<TikTokOrders mode="recent"', "{canStock && stockAlerts}"].map((s) => ov.indexOf(s));
  ok("B the directive's order: figures, attention, fulfilment, recent orders, stock alerts", order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), order.join(" < "));
  ok("B four figures, each saying its period", (p.match(/<KpiTile /g) ?? []).length === 4 && (p.match(/["`]This month · |"Now · /g) ?? []).length >= 4);
  ok("B no CSS reordering", !/(?<![\w-])order:\s*-?\d/.test(f.css) && /\.bottomGrid \{/.test(f.css));

  ok("C the sales figure is gross and says so, never net", /label=\{L\("TikTok sales \(gross\)"/.test(p) && /before TikTok fees/.test(p) && !/Net Sales|net sales/.test(p));
  ok("C every alert is counted from a record", /const refused = tt\.status\?\.failed_events_7d \?\? 0;/.test(p) && /if \(f && n\("returned"\) > 0\)/.test(p) && !/alerts\.push\(\{ key: "[a-z]+", icon: "[a-z]+", tone: "[a-z]+",\s*text: L\("[^`]*\d/.test(p));
  ok("C stock alerts are Inventory's own statuses, worst first", /items\.filter\(\(i\) => i\.status === "out_of_stock" \|\| i\.status === "low"\)/.test(p) && /<StockChip status=\{i\.status\} \/>/.test(p) && /short\.slice\(0, 5\)/.test(p));

  ok("D the lifecycle is said, and returned / cancelled named together", /data-testid="fulfilment-lifecycle"/.test(f.ful) && /\["returned", "Returned \/ cancelled"/.test(f.ful));

  ok("E the page writes nothing", !/\bapi\(|csrfFetch|method:\s*"(POST|PATCH|PUT|DELETE)"/.test(p));
  return out;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);
const MUT = [
  ["the address forgotten", "panel", 'useTabViewAddress("Ecommerce", view, setView, allowed);', ""],
  ["Stock for anyone", "panel", '(v !== "stock" || canStock)', '(v !== "stock" || true)'],
  ["stock alerts above recent orders", "panel", '<TikTokOrders mode="recent" title={L("Recent orders", "Pesanan terkini")} onViewAll={() => openOrders()} reloadKey={reloadKey} />\n            {canStock && stockAlerts}', '{canStock && stockAlerts}\n            <TikTokOrders mode="recent" title={L("Recent orders", "Pesanan terkini")} onViewAll={() => openOrders()} reloadKey={reloadKey} />'],
  ["called net", "panel", 'label={L("TikTok sales (gross)"', 'label={L("TikTok Net Sales"'],
  ["an invented alert", "panel", "  const refused = tt.status?.failed_events_7d ?? 0;", '  const refused = 3;'],
  ["low stock guessed", "panel", 'i.status === "out_of_stock" || i.status === "low")', 'i.stock < 10)'],
  ["a CSS reorder", "css", ".bottomGrid {\n  display: grid;", ".bottomGrid {\n  order: -1;\n  display: grid;"],
  ["the lifecycle dropped", "ful", 'data-testid="fulfilment-lifecycle"', 'data-x="y"'],
  ["a write from the page", "panel", "  const reloadKey =", '  const touch = () => fetch("/api/v1/staff/inventory", { method: "POST" });\n  const reloadKey ='],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\necom2: ${failed.length} failed`); process.exit(1); }
console.log(`ecom2: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
