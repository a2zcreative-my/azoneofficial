#!/usr/bin/env node
/* Guard #50 — v1.124.0: the paper palette has ONE owner, and paper does not
 * follow the theme.
 *
 * The audit that prompted this found the brand navy written out ten times
 * (`#1a2946` in six files, `#1A2946` in four) and the gold nine (`#C9A227`
 * eight, `#c9a227` once), with the rule-line `#e8ebf1` copied into both the
 * live pages and the print templates. Nothing rendered wrong — every copy
 * happened to agree — but nothing MADE them agree, so the eleventh document
 * would have been navy-ish.
 *
 * There are two legitimate spellings of the palette, because there are two
 * kinds of consumer:
 *
 *   lib/doc-theme.ts     literal hex, for the print builders. They write a
 *                        standalone HTML document into a new window or an
 *                        iframe; that document cannot see the app stylesheet.
 *   --doc-* in globals   for /doc and /report, which render paper INSIDE the
 *                        app and so can use classes.
 *
 * This guard asserts the PROPERTIES that make that pair safe:
 *
 *   1. The two spellings agree, key for key, value for value.
 *   2. The --doc-* variables are declared ONCE. A theme block that redefined
 *      one would make a customer's invoice follow their phone's dark mode —
 *      the PDF they save would not be the document we sent.
 *   3. The two public paper pages have an explicit light ground. /report had
 *      none: it inherited bg-background and, in dark mode, printed navy ink
 *      on a near-black page.
 *   4. Nobody outside lib/doc-theme.ts spells a brand colour as literal hex,
 *      except the two documented cases below.
 *
 * ALLOWLIST — the raw brand hex that is allowed to remain, and why:
 *   app/layout.tsx        the viewport export is serialised at BUILD time,
 *                         before any stylesheet exists, so it cannot read a
 *                         variable. tests/theme-color.mjs pins it to the
 *                         light value instead.
 *   role-panels PIE_COLORS a categorical chart palette. Its slices are keyed
 *                         by expense category, not by brand role; two of them
 *                         happen to be navy and gold. Tokenising two of eight
 *                         would leave a palette that is half tokens and half
 *                         hex, which is worse than a palette.
 *
 * Negative-tested by: changing --doc-navy in globals.css (1); adding
 * `--doc-gold: #fff` under .dark (2); dropping bg-white from /report's main
 * (3); putting `#1a2946` back into lib/doc-template.ts (4).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const theme = read("lib/doc-theme.ts");
const css = read("styles/globals.css");

/* ---- 1. the two spellings agree -------------------------------------- */
/* camelCase key in TS <-> kebab-case variable in CSS. */
const tsPairs = new Map();
for (const m of theme.matchAll(/^\s*(\w+):\s*"(#[0-9a-fA-F]{6})",/gm)) tsPairs.set(m[1], m[2].toLowerCase());
const cssPairs = new Map();
for (const m of css.matchAll(/^\s*--doc-([a-z-]+):\s*(#[0-9a-fA-F]{6});/gm)) cssPairs.set(m[1], m[2].toLowerCase());

ok("lib/doc-theme.ts exports a palette", tsPairs.size >= 8, `${tsPairs.size} colours`);
ok("globals.css declares the --doc-* palette", cssPairs.size >= 8, `${cssPairs.size} variables`);

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const mismatched = [...tsPairs].filter(([k, v]) => cssPairs.get(kebab(k)) !== v);
ok("every colour in lib/doc-theme.ts has the same value in globals.css",
   mismatched.length === 0,
   mismatched.map(([k, v]) => `${k}=${v} vs --doc-${kebab(k)}=${cssPairs.get(kebab(k)) ?? "missing"}`).join(", "));

const orphans = [...cssPairs.keys()].filter((k) => ![...tsPairs.keys()].some((t) => kebab(t) === k));
ok("no --doc-* variable exists without an owner in lib/doc-theme.ts", orphans.length === 0, orphans.join(","));

/* ---- 2. paper does not follow the theme ------------------------------ */
/* Everything after the first `.dark {` or a `[data-theme=...]` selector is a
   theme override. A --doc-* declaration in there is the bug this prevents. */
const firstOverride = Math.min(
  ...[css.indexOf(".dark {"), css.search(/\[data-theme="/)].filter((i) => i > 0),
);
const overrides = css.slice(firstOverride);
ok("the theme blocks were found", Number.isFinite(firstOverride) && firstOverride > 0);
const themedDoc = [...overrides.matchAll(/--doc-[a-z-]+\s*:/g)].map((m) => m[0]);
ok("no theme block redefines a --doc-* colour — paper is paper in every theme",
   themedDoc.length === 0, themedDoc.join(","));

for (const k of cssPairs.keys()) {
  const n = [...css.matchAll(new RegExp(`^\\s*--doc-${k}\\s*:`, "gm"))].length;
  if (n !== 1) ok(`--doc-${k} is declared exactly once`, false, `${n} declarations`);
}
ok("each --doc-* colour is declared exactly once", true);

/* ---- 3. the public paper pages have their own light ground ----------- */
const docPage = read("app/doc/page.tsx");
const report = read("app/report/page.tsx");
ok("/doc paints its own page ground", /bg-\[var\(--doc-page\)\]/.test(docPage));
const mains = [...report.matchAll(/<main className="([^"]*)"/g)].map((m) => m[1]);
ok("/report has its <main> elements", mains.length >= 3, `${mains.length} found`);
ok("every /report screen paints a white ground — a client in dark mode still gets paper",
   mains.length > 0 && mains.every((c) => /\bbg-white\b/.test(c)),
   mains.filter((c) => !/\bbg-white\b/.test(c)).join(" | "));
ok("both paper pages read their colours from the --doc-* variables",
   /var\(--doc-navy\)/.test(docPage) && /var\(--doc-navy\)/.test(report) && /var\(--doc-gold\)/.test(report));

/* ---- 4. nobody else spells a brand colour --------------------------- */
const BRAND = /#(?:1a2946|c9a227|e8cb6b|e8ebf1|f6f7fa|5b6472|8a93a6|f4f6fb)\b/i;
const ALLOW = new Set(["lib/doc-theme.ts", "styles/globals.css", "app/layout.tsx"]);
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) { if (e !== "node_modules") walk(rel, out); }
    else if (/\.(ts|tsx|css)$/.test(e)) out.push(rel);
  }
  return out;
};
const files = [...walk("app"), ...walk("components"), ...walk("lib"), ...walk("styles")];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");
const offenders = [];
for (const f of files) {
  if (ALLOW.has(f)) continue;
  const body = stripComments(read(f));
  for (const line of body.split("\n")) {
    if (!BRAND.test(line)) continue;
    if (/PIE_COLORS|rent:\s*"#/.test(line)) continue; // documented: categorical chart palette
    offenders.push(`${f}: ${line.trim().slice(0, 80)}`);
  }
}
ok("no file outside the palette's owners spells a brand colour as hex",
   offenders.length === 0, offenders.slice(0, 6).join(" | "));

/* the print builders take it from the module, not from a copy */
for (const f of ["lib/doc-template.ts", "lib/receipt-print.ts", "components/portal/sales.tsx",
                 "components/portal/leave.tsx", "components/portal/role-panels.tsx",
                 "components/staff/staff-directory.tsx", "components/admin/hr-admin-panel.tsx"]) {
  const s = read(f);
  ok(`${relative(".", f)} builds its document from DOC`,
     /from "@\/lib\/doc-theme"/.test(s) && /\$\{DOC\.\w+\}/.test(s));
}

console.log(`${failed ? "✗" : "✓"} doc-theme: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
