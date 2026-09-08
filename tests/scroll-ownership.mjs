#!/usr/bin/env node
/* Guard #51 — v1.124.0: the document scroll has exactly two owners, and both
 * of them say so.
 *
 * The audit found `html { overflow-y: scroll }` in styles/globals.css and a
 * second rule, `html.shell-locked { overflow: hidden }`, injected from inside
 * components/layout/app-shell.tsx. Both are correct and BOTH SHOULD STAY —
 * app-shell's v1.88.1 note makes the case that a class whose CSS lives in
 * another file stops working the day that file is tidied, and it is right.
 * The problem was never the split; it was that neither file mentioned the
 * other, so the ownership model existed only in whoever last touched it.
 *
 * v1.124.0 wrote the model down in both places. This guard is what keeps the
 * written model true:
 *
 *   1. globals.css owns the DEFAULT: the document scrolls, gutter reserved.
 *   2. app-shell owns the ONE exception, and it is doubly scoped — by a class
 *      (so it applies only while the shell is mounted) and by a min-width
 *      media query (so the phone, which scrolls the document by design, is
 *      never locked). An unscoped version of this rule is the bug that leaves
 *      a customer's phone frozen after the shell unmounts.
 *   3. No third owner. Nothing else overrides <html> overflow, in CSS or by
 *      touching documentElement.style — a modal locks BODY.
 *   4. Each side names the other, so the model is discoverable from either.
 *
 * Negative-tested by: dropping the media query from app-shell's rule (2);
 * adding `html { overflow: hidden }` to globals.css (3); adding
 * `document.documentElement.style.overflow = "hidden"` to a panel (3);
 * removing the cross-reference from globals.css (4).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

const css = read("styles/globals.css");
const shell = read("components/layout/app-shell.tsx");

/* ---- 1. the default owner -------------------------------------------- */
ok("globals.css keeps the document scrolling, with the gutter reserved",
   /html\s*\{[^}]*overflow-y:\s*scroll[^}]*scrollbar-gutter:\s*stable/s.test(css));

/* ---- 2. the one exception, doubly scoped ----------------------------- */
const rule = shell.match(/@media \(min-width: (\d+)px\) \{\s*html\.shell-locked[^`]*\}/);
ok("app-shell still carries its own lock rule", !!rule);
ok("the lock is behind a min-width media query — phones are never locked",
   !!rule && Number(rule[1]) >= 640, rule ? `${rule[1]}px` : "");
ok("the lock is class-scoped, so it ends when the shell unmounts",
   /html\.shell-locked/.test(shell)
   && /classList\.add\("shell-locked"\)/.test(shell)
   && /return \(\) => document\.documentElement\.classList\.remove\("shell-locked"\)/.test(shell));

/* ---- 3. no third owner ----------------------------------------------- */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/* In CSS: any `html…{ … overflow… }` block other than the two known ones. */
const cssBody = stripComments(css);
/* Any `html…{…}` block, wherever it sits — a bare rule, one nested in a
   @media, one hanging off a theme selector. Deliberately NOT anchored to the
   previous rule's closing brace: matchAll would eat that brace and let a
   second rule immediately after the first slip past unseen. */
const htmlBlocks = [...cssBody.matchAll(/html[^{};@]*\{([^}]*)\}/g)]
  .filter((m) => /overflow(-[xy])?\s*:/.test(m[1]))
  .map((m) => m[0].split("{")[0].trim());
ok("styles/ declares html overflow in exactly one place",
   htmlBlocks.length === 1, htmlBlocks.join(" | "));

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) { if (e !== "node_modules") walk(rel, out); }
    else if (/\.(ts|tsx|css)$/.test(e)) out.push(rel);
  }
  return out;
};
const files = [...walk("app"), ...walk("components"), ...walk("lib"), ...walk("styles")];
const thirdParties = [];
for (const f of files) {
  const body = stripComments(read(f));
  /* a component writing the scroll directly, bypassing the model entirely */
  if (/documentElement\s*\.\s*style\s*\.\s*(overflow|overflowY)\b/.test(body)) thirdParties.push(`${f} (documentElement.style)`);
  /* a second injected html-overflow rule */
  if (f !== "components/layout/app-shell.tsx" && f !== "styles/globals.css"
      && /html[^`{]*\{[^}]*overflow\s*:/.test(body)) thirdParties.push(`${f} (injected html rule)`);
}
ok("nothing else takes ownership of the document scroll", thirdParties.length === 0, thirdParties.join(", "));

/* ---- 4. each side names the other ------------------------------------ */
/* The full path, not the bare filename: the point is that a reader of
   globals.css can FIND the other owner without knowing where it lives. */
ok("globals.css points at the exception, by path",
   /components\/layout\/app-shell\.tsx/.test(css));
ok("app-shell points back at the default",
   /styles\/globals\.css/.test(shell));
ok("the model tells the next person where a modal belongs",
   /lock(s)? BODY/i.test(css) && /BODY, never <html>/i.test(shell));

console.log(`${failed ? "✗" : "✓"} scroll-ownership: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
