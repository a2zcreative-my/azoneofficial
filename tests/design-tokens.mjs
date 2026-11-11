/* v1.276.0 - A2Z OS 3.0 DESIGN TOKENS RATCHET (claude/UIUX-3.0-BLUEPRINT.md,
   approved by the CEO 10-11-2026; first asked for in the 4.0 plan, 1 Nov).

   The system has one token file and one vocabulary; what drifts is the raw
   numbers a module types instead. This guard counts four kinds of drift per
   file and holds each count to the budget in tests/design-tokens-budget.json:
   a count may FALL (migrate a screen, then --write-budget records the new
   floor) but never RISE, and a file that is not in the budget may hold none.

     hex      a literal colour (#1a2946) outside styles/ - colours are tokens
     bp       a media query on a width other than 640 / 768 / 1024 / 1280
              (or their -1 max-width twins 639 / 767 / 1023 / 1279)
     radius   a raw border-radius length in a CSS Module (not var(--radius-*))
     dialog   a hand-made role="dialog" outside components/ui

   It also holds the 3.0 foundation itself: the shared components exist, use
   tokens only, and the KPI tile draws its figure at the one tile size.

     node tests/design-tokens.mjs                 check
     node tests/design-tokens.mjs --write-budget  record today's counts (only after a migration lowered them) */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? `  [${String(detail).slice(0, 300)}]` : ""}`); } };

function walk(dir, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const n of readdirSync(abs)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    /* v1.277.0 - built with "/" on purpose, never path.join: on Windows join
       writes "components\\ui\\x.tsx", which matched no budget key and made
       every file look new (the first PUSH.bat run, 11-11-2026) */
    const p = `${dir}/${n}`;
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [...walk("components"), ...walk("app")];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ALLOWED_BP = new Set(["640", "768", "1024", "1280", "639", "767", "1023", "1279"]);

const counts = {};
const add = (f, k, n) => { if (!n) return; (counts[f] ??= {})[k] = ((counts[f] ?? {})[k] ?? 0) + n; };
for (const f of files) {
  const src = stripComments(read(f));
  add(f, "hex", (src.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/g) ?? []).length);
  if (f.endsWith(".css")) {
    for (const m of src.matchAll(/@media[^{]*/g)) for (const px of m[0].matchAll(/(\d+)px/g)) if (!ALLOWED_BP.has(px[1])) add(f, "bp", 1);
    if (f.endsWith(".module.css")) add(f, "radius", (src.match(/border-radius:\s*(?!\s|var\()[^;]*\d(?:px|rem)/g) ?? []).length);
  }
  if (f.endsWith(".tsx") && !f.startsWith("components/ui/")) add(f, "dialog", (src.match(/role="dialog"/g) ?? []).length);
}

const budgetFile = join(root, "tests/design-tokens-budget.json");
if (process.argv.includes("--write-budget")) {
  writeFileSync(budgetFile, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2) + "\n");
  console.log(`  budget written: ${Object.keys(counts).length} files`);
  process.exit(0);
}
const budget = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, "utf8")) : {};
ok("the budget file exists", existsSync(budgetFile));
ok("paths read the same on Windows and Linux (forward slashes, as the budget keys)", files.every((f) => !f.includes("\\")) && Object.keys(budget).every((k) => !k.includes("\\")) && files.includes("components/ui/side-drawer.tsx"));
const over = [];
for (const [f, c] of Object.entries(counts)) for (const [k, n] of Object.entries(c)) {
  const allowed = budget[f]?.[k] ?? 0;
  if (n > allowed) over.push(`${f} ${k} ${n} > ${allowed}`);
}
ok("no file holds more raw colours, odd breakpoints, raw radii or hand-made dialogs than its budget", over.length === 0, over.join("; "));
const total = (k) => Object.values(counts).reduce((a, c) => a + (c[k] ?? 0), 0);
const btotal = (k) => Object.values(budget).reduce((a, c) => a + (c[k] ?? 0), 0);
for (const k of ["hex", "bp", "radius", "dialog"]) ok(`total ${k} at or under budget (${total(k)} / ${btotal(k)})`, total(k) <= btotal(k));

/* ---- the 3.0 foundation ---- */
const g = read("styles/globals.css");
ok("the 3.0 layout tokens are named once", ["--control-h:", "--control-h-touch:", "--row-h:", "--page-pad-x:", "--card-pad:", "--grid-gap:", "--type-kpi-tile-size:"].every((t) => g.includes(t)));
const kt = read("components/ui/kpi-tile.module.css");
ok("the KPI tile draws its figure at the one tile size, not the 30px hero", /clamp\(1\.125rem, 9cqi, var\(--type-kpi-tile-size\)\)/.test(kt) && !/var\(--type-kpi-lg-size\)/.test(stripComments(kt)));
ok("no page re-sizes the tile figure through the old hero token", !files.some((f) => f.endsWith(".module.css") && /--type-kpi-lg-size:/.test(stripComments(read(f)))));
const comps = {
  "components/ui/status-chip.tsx": ["StatusChip", "statusOf", "STATUS_MAP"],
  "components/ui/work-row.tsx": ["WorkRow"],
  "components/ui/table-card.tsx": ["TableCard"],
  "components/ui/error-state.tsx": ["ErrorState"],
  "components/ui/form-field.tsx": ["FormField"],
  "components/ui/switch.tsx": ["Switch"],
};
for (const [f, names] of Object.entries(comps)) ok(`${f} exports ${names.join(", ")}`, existsSync(join(root, f)) && names.every((n) => new RegExp(`export (?:function|const) ${n}\\b`).test(read(f))));
const ui3 = stripComments(read("components/ui/ui3.module.css"));
ok("the 3.0 components use tokens only (no colour, no raw radius)", !/#[0-9a-fA-F]{3,6}\b/.test(ui3) && !/border-radius:\s*(?!\s|var\()/.test(ui3));
const sc = read("components/ui/status-chip.tsx");
ok("a status the map does not know is shown in neutral with its own words, never guessed into a colour", /return \{ tone: "neutral", label:/.test(sc));
ok("the six commission stages have one word each", ["estimated", "pending", "eligible", "included", "paid", "reversed"].every((k) => new RegExp(`\\b${k}: \\[`).test(sc.slice(sc.indexOf("commission: {"), sc.indexOf("account: {")))));
ok("a payment that is only reported is never green", /reported: \["warning"/.test(sc) && /verified: \["success"/.test(sc));
const ff = read("components/ui/form-field.tsx");
ok("a field's hint and error are tied to the control and the error is words", /aria-describedby/.test(ff) && /aria-invalid/.test(ff) && /role="alert"/.test(ff));
const sw = read("components/ui/switch.tsx");
ok("the switch is a real switch that says On / Off", /role="switch"/.test(sw) && /aria-checked=\{checked\}/.test(sw) && /"On", "Hidup"/.test(sw));
const sd = read("components/ui/side-drawer.tsx");
ok("a drawer holding unsaved typing asks before it closes (X, Escape, backdrop)", /dirty\?: boolean/.test(sd) && (sd.match(/requestClose/g) ?? []).length >= 3 && /if \(dirty\) setAsking\(true\); else onClose\(\);/.test(sd) && /Discard your changes\?/.test(sd));
const tc = read("components/ui/table-card.tsx");
ok("a table card shows loading as a skeleton, failure with Retry, and scrolls inside itself", /SkelTable/.test(tc) && /ErrorState onRetry/.test(tc) && /css\.scroll/.test(tc) && /\.scroll \{\s*overflow-x: auto;/.test(read("components/ui/ui3.module.css")));
const lt = read("components/ui/line-tabs.tsx");
ok("a page tab can carry the count of what waits behind it", /\[key, label, count\]/.test(lt) && /css\.count/.test(lt));
ok("the guard is registered", /\["design-tokens", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
