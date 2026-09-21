#!/usr/bin/env node
/**
 * Guard #93 — v1.172.2: TAILWIND IS RETIRED, AND STAYS RETIRED.
 *
 * The CEO, 21-09-2026: *"Retire Tailwind properly and update the project /
 * interface documentation so future work uses the new ERP interface
 * system."* The engine, its PostCSS plugin, the prettier plugin and
 * tailwind-merge left the project in one pass; the utility classes the
 * unmigrated screens still carry were compiled ONCE into
 * styles/legacy-utilities.css, a frozen, hand-owned stylesheet that only
 * shrinks (scripts/prune-legacy-utilities.mjs). New interface work is an
 * .erp-* class from styles/erp-v3.css, a semantic token, or a CSS Module
 * beside the component (docs/INTERFACE-SYSTEM-V3.md).
 *
 * What this guard holds shut, in order:
 *
 *   1. THE PIPELINE. No Tailwind package in package.json or pnpm-lock.yaml,
 *      no @tailwindcss/postcss in postcss.config.mjs, no prettier plugin, no
 *      tailwind-merge import anywhere in the source.
 *   2. THE STYLESHEETS. No @import "tailwindcss", @tailwind, @apply, @theme,
 *      @custom-variant, @config, @plugin, @utility, @variant, @source or
 *      theme() in any .css file, and no --tw-* custom property: the frozen
 *      sheet renamed its plumbing to --lu-* so a stray Tailwind fragment is
 *      recognisable.
 *   3. THE ORDER. globals.css imports the reset, the V3 system and the
 *      frozen sheet, in that order, under one cascade-layer declaration -
 *      that order is why a legacy utility still wins over a V3 class on a
 *      screen that has not migrated.
 *   4. NO NEW UTILITY. Every utility-looking token in a class string in
 *      app/, components/, lib/, hooks/ or constants/ must be a class the
 *      frozen sheet defines. Nothing generates CSS for a new one, so it
 *      would silently style nothing - this makes it fail the build instead.
 *   5. THE RATCHET. tests/legacy-utility-budget.json records, per file, how
 *      many legacy classes it references. A file may only go DOWN; a file
 *      not in the budget may reference none. Migrate a screen, prune, then
 *      `node tests/tailwind-retired.mjs --write-budget` records the new
 *      floor.
 *   6. THE MIGRATED SURFACES. The shell, the vocabulary and the priority
 *      screens reference no legacy utility at all.
 *
 * Negative-tested by: adding "tailwindcss" back to devDependencies; putting
 * `@import "tailwindcss";` at the top of globals.css; writing
 * `className="flex gap-7"` (gap-7 is not in the sheet) in a panel; adding a
 * `mt-2` to components/ui/data-table.tsx; raising a file's count above its
 * budget.
 *
 *   node tests/tailwind-retired.mjs
 *   node tests/tailwind-retired.mjs --write-budget
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCss, definedClasses, classTokensOf, isClassString, legacyRefsOf, looksLikeUtility, referencedTokens, stripComments, SOURCE_DIRS, walk } from "../scripts/legacy-utilities-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const writeBudget = process.argv.includes("--write-budget");

let passed = 0;
let failed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- 1. the pipeline -------------------------------------------------- */
const pkg = JSON.parse(read("package.json"));
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const BANNED = ["tailwindcss", "@tailwindcss/postcss", "@tailwindcss/node", "@tailwindcss/oxide", "@tailwindcss/vite", "@tailwindcss/cli", "tailwind-merge", "prettier-plugin-tailwindcss", "tailwindcss-animate", "tw-animate-css"];
const present = BANNED.filter((n) => n in deps);
ok("package.json declares no Tailwind package", present.length === 0, present.join(", "));
const lock = read("pnpm-lock.yaml");
const importers = lock.slice(0, lock.indexOf("\npackages:") > 0 ? lock.indexOf("\npackages:") : lock.length);
const lockHit = BANNED.filter((n) => new RegExp(`^\\s{2,}'?${n.replace(/[/.]/g, "\\$&")}'?:`, "m").test(importers));
ok("pnpm-lock.yaml lists no Tailwind package for this project", lockHit.length === 0, lockHit.join(", "));
const postcss = stripComments(read("postcss.config.mjs"));
ok("postcss.config.mjs runs no Tailwind plugin (an empty plugin list, on purpose)", !/tailwind/i.test(postcss) && /plugins:\s*\{\s*\}/.test(postcss));
const prettierrc = existsSync(join(root, ".prettierrc")) ? read(".prettierrc") : "";
ok(".prettierrc loads no Tailwind plugin", !/prettier-plugin-tailwindcss/.test(prettierrc));
ok("next.config.ts and eslint.config.mjs know nothing of Tailwind", !/tailwind/i.test(read("next.config.ts")) && !/tailwind/i.test(read("eslint.config.mjs")));

/* ---- 2. the stylesheets ----------------------------------------------- */
const cssFiles = [];
const walkCss = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== "node_modules") walkCss(p); } else if (n.endsWith(".css")) cssFiles.push(p); } };
for (const d of ["styles", "app", "components"]) walkCss(join(root, d));
const AT = /@(?:import\s+["']tailwindcss|tailwind\b|apply\b|theme\b|custom-variant\b|config\b|plugin\b|utility\b|variant\b|source\b|reference\b)/;
for (const f of cssFiles) {
  const body = stripComments(readFileSync(f, "utf8"));
  const rel = f.slice(root.length).replace(/\\/g, "/");
  ok(`${rel} carries no Tailwind at-rule`, !AT.test(body), (body.match(AT) ?? [""])[0]);
  ok(`${rel} calls no theme() and reads no --tw-* property`, !/\btheme\(/.test(body) && !/--tw-/.test(body));
}

/* ---- 3. the order ------------------------------------------------------- */
const globals = read("styles/globals.css");
ok("globals.css imports reset → V3 → frozen utilities under one layer order",
   /^@import "\.\/erp-reset\.css";\n@import "\.\/erp-v3\.css";\n@import "\.\/legacy-utilities\.css";\n@layer properties, theme, base, components, utilities;/m.test(globals));
ok("erp-reset.css declares the same layer order first", /^@layer properties, theme, base, components, utilities;/m.test(read("styles/erp-reset.css")));
const legacyCss = read("styles/legacy-utilities.css");
ok("the frozen sheet says it is frozen, in its header", /LEGACY UTILITIES - FROZEN/.test(legacyCss.slice(0, 400)));
ok("the frozen sheet is the utilities layer and nothing else", /^@layer utilities \{/m.test(legacyCss) && !/^@layer (?:base|components)/m.test(legacyCss));

/* ---- 4. no new utility, 5. the ratchet, 6. the migrated surfaces -------- */
const defined = definedClasses(parseCss(legacyCss));
ok("the frozen sheet parses and defines classes", defined.size > 500, String(defined.size));

/* tailwind-merge: the cn() helper joins, it no longer merges */
const utils = stripComments(read("lib/utils.ts"));
ok("lib/utils.ts cn() is clsx only", /import \{ clsx, type ClassValue \} from "clsx";/.test(utils) && /return clsx\(inputs\);/.test(utils) && !/tailwind-merge|twMerge/.test(utils));

const files = SOURCE_DIRS.flatMap((d) => walk(join(root, d))).map((f) => f.slice(root.length).replace(/\\/g, "/"));
const undefinedHits = [];
const counts = {};
const refsByFile = new Map();
for (const file of files) {
  const src = read(file);
  if (/tailwind-merge|twMerge|from ["']tailwindcss/.test(stripComments(src))) undefinedHits.push(`${file}: imports Tailwind`);
  const refs = legacyRefsOf(src, defined);
  refsByFile.set(file, refs);
  if (refs.size) counts[file] = refs.size;
  for (const lit of classTokensOf(src)) {
    if (!isClassString(lit, defined)) continue;
    for (const tok of lit.toks) if (looksLikeUtility(tok) && !defined.has(tok)) undefinedHits.push(`${file}: "${tok}"`);
  }
}
ok("no class string references a utility the frozen sheet does not define (nothing would style it)",
   undefinedHits.length === 0, [...new Set(undefinedHits)].slice(0, 8).join(" | "));

const budgetFile = join(root, "tests/legacy-utility-budget.json");
if (writeBudget) {
  writeFileSync(budgetFile, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2) + "\n");
  console.log(`wrote ${Object.keys(counts).length} file budgets to tests/legacy-utility-budget.json`);
}
const budget = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, "utf8")) : null;
ok("tests/legacy-utility-budget.json exists (the ratchet's floor)", !!budget);
if (budget) {
  const over = Object.entries(counts).filter(([f, n]) => n > (budget[f] ?? 0)).map(([f, n]) => `${f} ${budget[f] ?? 0}→${n}`);
  ok("no file references more legacy utilities than its budget (migrate, never add)", over.length === 0, over.slice(0, 8).join(", "));
  const under = Object.entries(budget).filter(([f, n]) => (counts[f] ?? 0) < n);
  if (under.length && !writeBudget) console.log(`  · ${under.length} file(s) are under budget - run \`node tests/tailwind-retired.mjs --write-budget\` to lower the floor: ${under.slice(0, 4).map(([f]) => f).join(", ")}${under.length > 4 ? "…" : ""}`);
}

const MIGRATED = [
  "app/layout.tsx",
  "app/portal/page.tsx",
  "components/layout/app-shell.tsx",
  "components/layout/side-nav.tsx",
  "components/ui/side-drawer.tsx",
  "components/ui/data-table.tsx",
  "components/ui/skeleton.tsx",
  "components/ui/empty-state.tsx",
  "components/ui/app-icon.tsx",
  "components/ui/row-button.tsx",
  "components/portal/page-shared.tsx",
  "components/portal/portal-skeleton.tsx",
  "components/portal/dashboard.tsx",
  "components/portal/attendance.tsx",
  "components/portal/web-orders-panel.tsx",
  "lib/ui-styles.ts",
  "lib/utils.ts",
];
for (const f of MIGRATED) {
  const n = counts[f] ?? 0;
  ok(`${f} references no legacy utility (a migrated surface stays migrated)`, n === 0,
     n ? `${n}: ${[...(refsByFile.get(f) ?? [])].slice(0, 6).join(" ")}` : "");
}
/* The Claims flow lives in role-panels.tsx beside unmigrated panels; its own
   block must be clean even though the file's budget is not zero. */
{
  const rp = read("components/portal/role-panels.tsx");
  const start = rp.indexOf("export function ClaimsPanel(");
  const end = rp.indexOf("function ExpensePie(");
  const block = rp.slice(start, end);
  const hits = legacyRefsOf(block, defined);
  ok("the Claims flow (role-panels.tsx ClaimsPanel) references no legacy utility", start > 0 && end > start && hits.size === 0, [...hits].slice(0, 8).join(" "));
}

console.log(`tailwind-retired: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
