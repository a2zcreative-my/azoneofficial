/* tests/tab-arrival.mjs - v1.181.3: AN ANIMATION MUST LET GO OF ITS TRANSFORM.
 *
 * The CEO's iPhone, 23-09-2026, on Claims: the whole tab turned grey and
 * blurred inside its own 16px gutters, and nothing else appeared. The
 * confirm dialog WAS open. It was centred ~1000px down the page.
 *
 * `position: fixed` means "the viewport" only while no ancestor has a
 * transform (or a filter, perspective, containment...). v1.177.0 gave every
 * tab root an arrival animation - `.erp-tab-page { animation: erp-deck-in
 * ... both }` - and `both` HOLDS the last keyframe after the animation ends.
 * The last keyframe says `transform: none`, but an interpolated transform
 * holds as an identity matrix, and an identity matrix is still a transform.
 * So every tab root stayed a containing block for good, and every confirm,
 * prompt and save toast opened from a tab (all of them render `fixed
 * inset-0` inside the tab) was sized to the TAB, not the screen: 415 x 1932
 * on Claims, 415 x 5109 on Attendance. The browser probe
 * (tests/browser/ui-audit.py, CAGE) found it on 27 of 29 tabs.
 *
 * This guard reads every stylesheet and fails on any animation that FILLS
 * FORWARDS (`forwards` or `both`) through keyframes that move a transform, a
 * filter or a perspective. Fill `backwards` - or none - and the animation
 * lets go when it ends. A fill that holds opacity only is harmless and is
 * allowed.
 *
 * It runs itself against eight planted stylesheets first, so a regex that
 * silently matches nothing cannot pass it.
 */

import { readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

/* A property that makes an element the containing block of its fixed
   descendants, when it is held at any value other than none. */
const CAGING = /\b(transform|translate|rotate|scale|filter|backdrop-filter|-webkit-backdrop-filter|perspective)\s*:/;

/** Every @keyframes name in a stylesheet whose frames move a caging property. */
function cagingKeyframes(css) {
  const names = new Set();
  const re = /@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g;
  for (let m; (m = re.exec(css)); ) {
    /* walk to the matching brace - keyframes nest one level of blocks */
    let depth = 1, i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    if (CAGING.test(css.slice(re.lastIndex, i))) names.add(m[1]);
  }
  return names;
}

/** Every declaration that fills forwards through a caging keyframe. */
function offenders(css, caging) {
  const out = [];
  const lines = css.split("\n");
  lines.forEach((line, n) => {
    const shorthand = /\banimation\s*:\s*([^;}]+)/.exec(line);
    if (shorthand) {
      const value = shorthand[1];
      /* several animations may be listed, comma-separated - but a timing
         function has commas of its own, so split only outside parentheses
         (the first draft split `cubic-bezier(0.2, 0, 0, 1) both` apart and
         the planted mutant of the real rule got through) */
      const parts = [];
      let depth = 0, cur = "";
      for (const ch of value) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
      }
      parts.push(cur);
      for (const one of parts) {
        const words = one.trim().split(/\s+/);
        if (!words.some((w) => w === "both" || w === "forwards")) continue;
        const name = words.find((w) => caging.has(w));
        if (name) out.push({ line: n + 1, text: line.trim(), name });
      }
    }
    const fill = /\banimation-fill-mode\s*:\s*([^;}]+)/.exec(line);
    if (fill && /\b(both|forwards)\b/.test(fill[1])) {
      /* the name is declared separately; look in the same rule */
      const open = css.lastIndexOf("{", css.split("\n").slice(0, n + 1).join("\n").length);
      const close = css.indexOf("}", open);
      const rule = css.slice(open, close);
      const nm = /\banimation-name\s*:\s*([\w-]+)/.exec(rule);
      if (nm && caging.has(nm[1])) out.push({ line: n + 1, text: line.trim(), name: nm[1] });
    }
  });
  return out;
}

/* ---- 0. the checker catches what it is for (planted stylesheets) ---- */
{
  const kf = "@keyframes lift { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }\n"
    + "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n";
  const planted = [
    [".a { animation: lift 200ms ease both; }", 1, "`both` through a transform"],
    [".a { animation: lift 200ms ease forwards; }", 1, "`forwards` through a transform"],
    [".a {\n  animation-name: lift;\n  animation-fill-mode: forwards;\n}", 1, "longhand fill"],
    [".a { animation: lift 200ms ease backwards; }", 0, "`backwards` lets go"],
    [".a { animation: lift 200ms ease; }", 0, "no fill lets go"],
    [".a { animation: fade 200ms ease both; }", 0, "holding opacity is harmless"],
    [".a { animation: lift 200ms cubic-bezier(0.2, 0, 0, 1) both; }", 1, "a timing function's commas do not hide the fill"],
    [".a { animation: fade 1s linear both, lift 200ms ease-out both; }", 1, "the second of two animations"],
  ];
  for (const [rule, want, what] of planted) {
    const css = kf + rule;
    ok(`self-test: ${what}`, offenders(css, cagingKeyframes(css)).length === want);
  }
}

/* ---- 1. every stylesheet in the app ---- */
const files = [
  ...globSync("styles/**/*.css", { cwd: root }),
  ...globSync("components/**/*.css", { cwd: root }),
  ...globSync("app/**/*.css", { cwd: root }),
].map((p) => p.replace(/\\/g, "/"));
ok("stylesheets found", files.length >= 5, `only ${files.length}`);

/* Keyframes are global: a module may use a name declared in erp-v3.css. */
const all = files.map((f) => [f, stripComments(read(f))]);
const caging = new Set();
for (const [, css] of all) for (const n of cagingKeyframes(css)) caging.add(n);
ok("the tab arrival keyframes are known to move a transform", caging.has("erp-deck-in"));

for (const [file, css] of all) {
  for (const o of offenders(css, caging)) {
    ok(`${file}:${o.line} lets go of its transform`, false,
      `\`${o.text}\` holds the last frame of ${o.name}, which moves a transform or filter; every position:fixed dialog inside it is then sized to this element, not the screen. Use \`backwards\`.`);
  }
}

/* ---- 2. the tab root, by name ---- */
const v3 = stripComments(read("styles/erp-v3.css"));
const tabPage = /\.erp-tab-page\s*\{\s*animation:\s*([^;]+);/.exec(v3);
ok(".erp-tab-page has its arrival animation", !!tabPage);
ok(".erp-tab-page's arrival fills backwards", !!tabPage && /\bbackwards\b/.test(tabPage[1]) && !/\b(both|forwards)\b/.test(tabPage[1]));

if (failed) {
  console.log(`\ntab-arrival: ${failed} failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`tab-arrival: ${passed} checks passed - no animation holds a transform on a container.`);
