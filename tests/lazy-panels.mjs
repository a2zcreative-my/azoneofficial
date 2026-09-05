#!/usr/bin/env node
/* Guard #38 — v1.103.0 (roadmap phase 01): the tab panels are code-split.
 *
 * Measured 05-09-2026: zero dynamic imports in the project, so one bundle
 * carried every tab for every person - a live host opening the roster
 * downloaded Payroll, Accounting and the ELFIA catalogue editor to get there.
 * components/portal/lazy-panels.tsx wraps each off-first-screen panel in
 * next/dynamic; this guard is what stops the next new tab quietly being
 * imported statically again, which is how the first 28 got that way.
 *
 * Properties:
 *   1. NOTHING LAZY IS ALSO STATIC. Every module lazy-panels wraps is absent
 *      from page.tsx's static imports - a static import anywhere in the entry
 *      pulls the whole module back into the first bundle and the dynamic()
 *      beside it becomes decoration.
 *   2. EVERY WRAPPER POINTS AT SOMETHING REAL. The module exists on disk and
 *      exports the named component - `.then((m) => m.Foo)` on a missing Foo
 *      is undefined at runtime and a blank tab, not a type error.
 *   3. EVERY WRAPPER IS USED, AND THROUGH THE WRAPPER. page.tsx renders each
 *      one, and imports it from lazy-panels, not from its home module.
 *   4. THE FIRST SCREEN IS NOT DEFERRED. dashboard-cards, company-monitor and
 *      side-columns paint on load; wrapping them would add a round-trip to the
 *      one moment that matters most.
 *   5. THE FALLBACK IS A SKELETON (house rule #28), ssr is off, and the
 *      fallback is a module-scope component (rule #30).
 *
 * Negative-tested by: re-adding `import { PayrollPanel } from
 * ".../payroll-panel"` to page.tsx (1 fails); misspelling an export in a
 * wrapper (2 fails); wrapping dashboard-cards (4 fails); replacing the
 * skeleton with <p>Loading…</p> (5 fails).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const page = read("app/portal/page.tsx");
const lazy = read("components/portal/lazy-panels.tsx");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* every wrapper: export const Name = lazy(() => import("@/x").then((m) => m.Export)) */
const wrappers = [...lazy.matchAll(/export const (\w+) = lazy\(\(\) => import\("@\/([^"]+)"\)\.then\(\(m\) => m\.(\w+)\)\)/g)]
  .map((m) => ({ name: m[1], module: m[2], exported: m[3] }));
ok("lazy-panels wraps at least twenty panels", wrappers.length >= 20, `found ${wrappers.length}`);

/* ---- 1. nothing lazy is also static ---- */
{
  const staticImports = [...page.matchAll(/^import[\s\S]*?from "@\/([^"]+)";/gm)].map((m) => m[1]);
  for (const mod of new Set(wrappers.map((w) => w.module))) {
    ok(`page.tsx does not import ${mod} statically`, !staticImports.includes(mod),
       "a static import pulls the whole module back into the first bundle; the dynamic() beside it becomes decoration");
  }
}

/* ---- 2. every wrapper points at something real ---- */
for (const w of wrappers) {
  const file = ["tsx", "ts"].map((ext) => join(root, `${w.module}.${ext}`)).find(existsSync);
  ok(`${w.module} exists`, Boolean(file));
  if (!file) continue;
  const src = readFileSync(file, "utf8");
  ok(`${w.module} exports ${w.exported}`,
     new RegExp(`export (?:function|const) ${w.exported}\\b`).test(src),
     "m.Foo on a missing Foo is undefined at runtime - a blank tab, not a type error");
}

/* ---- 3. every wrapper is used, through the wrapper ---- */
{
  const fromLazy = /import \{([\s\S]*?)\} from "@\/components\/portal\/lazy-panels";/.exec(page);
  const imported = fromLazy ? [...fromLazy[1].matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]) : [];
  ok("page.tsx imports from lazy-panels", imported.length > 0);
  for (const w of wrappers) {
    ok(`${w.name} is imported from lazy-panels`, imported.includes(w.name));
    ok(`${w.name} is rendered somewhere`, new RegExp(`<${w.name}\\b`).test(page), "a wrapper nothing renders is a chunk nothing loads");
  }
}

/* ---- 4. the first screen is not deferred ---- */
for (const firstPaint of ["components/portal/dashboard-cards", "components/portal/company-monitor", "components/portal/side-columns", "components/portal/portal-skeleton"]) {
  ok(`${firstPaint} is NOT lazy`, !wrappers.some((w) => w.module === firstPaint),
     "deferring what the first screen needs adds a round-trip to the moment that matters most");
}

/* ---- 5. skeleton fallback, ssr off, module scope ---- */
{
  ok("the fallback is a skeleton", /function PanelSkeleton\(\)[\s\S]{0,400}?<Skel/.test(lazy));
  ok("the fallback never says Loading", !/Loading/.test(lazy.replace(/\/\*[\s\S]*?\*\//g, "")),
     "house rule #28");
  ok("the fallback is a module-scope component", /^function PanelSkeleton\(\)/m.test(lazy), "rule #30");
  ok("panels do not server-render", /ssr: false/.test(lazy),
     "the page is behind sign-in and prerenders to a skeleton; a server render of a panel can only cost build time");
  ok("one helper, so every wrapper gets the same fallback", /const lazy = </.test(lazy) && /loading: PanelSkeleton/.test(lazy));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — ${wrappers.length} panels arrive when their tab is opened, none of them twice, and the first screen is untouched (${passed} checks)`);
