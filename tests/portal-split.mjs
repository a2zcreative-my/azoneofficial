#!/usr/bin/env node
/* Guard #48 — v1.114.0 (housekeeping): the portal page stays split.
 *
 * The CEO, 05-09-2026: *"do housekeeping based on the requirement and ensure
 * that dont remove/housekeeping that can cause my system corrupted or
 * damaged!"* app/portal/page.tsx was 605 KB / 14,117 lines; it is now the
 * shell (PortalPage) plus fourteen component files under components/portal/,
 * moved verbatim. This guard keeps it that way: a component declared back
 * inside page.tsx, or a component file growing past a page's worth, is the
 * giant re-forming one paste at a time.
 *
 *   1. page.tsx declares exactly ONE component - the shell.
 *   2. page.tsx stays under a quarter of its old size.
 *   3. Every split file exists, is a client component, and exports at least
 *      one component; none is larger than the largest domain was on the day
 *      of the split (Sales, with room).
 *   4. Nothing was lost: every component the shell renders is exported by
 *      exactly one split file (or was always its own module).
 *
 * Negative-tested by: pasting a `function Foo() {}` component back into
 * page.tsx (1); deleting `"use client"` from a split file (3).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PORTAL_SOURCE_FILES } from "./lib/portal-source.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const page = read("app/portal/page.tsx");
const componentDecls = [...page.matchAll(/^(?:export default )?function ([A-Z][A-Za-z0-9]*)\(/gm)].map((m) => m[1]);
ok("page.tsx declares exactly one component, the shell", componentDecls.length === 1 && componentDecls[0] === "PortalPage", componentDecls.join(","));
ok("page.tsx stays under a quarter of its old 14,117 lines", page.split("\n").length < 3500, `${page.split("\n").length} lines`);

const split = PORTAL_SOURCE_FILES.filter((f) => f !== "app/portal/page.tsx");
const exported = new Map();
for (const f of split) {
  ok(`${f} exists`, existsSync(join(root, f)));
  if (!existsSync(join(root, f))) continue;
  const src = read(f);
  ok(`${f} is a client component file`, src.startsWith('"use client";'));
  const comps = [...src.matchAll(/^export function ([A-Z][A-Za-z0-9]*)\(/gm)].map((m) => m[1]);
  ok(`${f} exports at least one component`, comps.length > 0 || f.endsWith("page-shared.tsx"));
  ok(`${f} is not itself a giant`, src.split("\n").length <= 4500, `${src.split("\n").length} lines`);
  for (const c of comps) exported.set(c, [...(exported.get(c) ?? []), f]);
}
const dup = [...exported].filter(([, fs]) => fs.length > 1);
ok("no component is declared in two split files", dup.length === 0, dup.map(([c, fs]) => `${c}: ${fs.join(", ")}`).join("; "));

/* every component the shell renders comes from somewhere it imports */
/* a JSX tag follows whitespace, "(", "{", ">" or a line start - a generic
   like useState<TabName>() follows an identifier and is not one */
const rendered = new Set([...page.matchAll(/(?<=^|[\s({>])<([A-Z][A-Za-z0-9]*)[\s/>]/gm)].map((m) => m[1]));
const imported = new Set([
  ...[...page.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(" as ").pop().trim()).filter(Boolean)),
  ...[...page.matchAll(/import\s+([A-Z][A-Za-z0-9]*)\s+from/g)].map((m) => m[1]),
]);
const orphans = [...rendered].filter((c) => !imported.has(c) && c !== "PortalPage" && !componentDecls.includes(c));
ok("every component the shell renders is imported", orphans.length === 0, orphans.join(","));

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — the portal page is a shell and fourteen domain files, and stays that way (${passed} checks)`);
