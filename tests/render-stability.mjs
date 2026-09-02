/**
 * Render-stability guard (v1.79.0) — guard #30.
 *
 * A COMPONENT DECLARED INSIDE ANOTHER COMPONENT IS A NEW TYPE ON EVERY
 * RENDER. React compares element types to decide what to keep; a fresh
 * function identity every render means the type never matches, so the whole
 * subtree is unmounted and rebuilt instead of updated. State inside it
 * resets, and — the one people actually notice — an <input> inside it loses
 * focus after every keystroke, because the DOM node it was focused on no
 * longer exists.
 *
 * This shipped twice in one afternoon. The CEO asked for labels on the
 * document form's line items (his RM 12 discount had gone into the
 * whole-document box because two adjacent fields were both called
 * "Discount (RM)" and neither had a label on a phone). The fix wrapped each
 * field in a small `Cell` component — declared inside `Sales`, where it
 * would have made the unit-price box unusable: type a digit, lose the
 * caret. And `RightRail` had been carrying a `Section` declared the same way
 * for releases, rebuilding all three of its panels on every render. Nothing
 * in `Section` holds focus, which is precisely why nobody found it.
 *
 * That is the shape of this bug: harmless until somebody puts an input in
 * it, then baffling. Both are now at module scope.
 *
 * THE RULE: a Capitalised declaration whose body is JSX must sit at the top
 * level of its file. Helpers that RETURN JSX but are not components —
 * `const wrap = (node) => <div>{node}</div>`, `skelRows(3)` — are not caught
 * and should not be: they are called, not mounted as elements, so their
 * identity changing costs nothing. The capital letter is the line, because
 * it is also the line React uses.
 *
 *   node tests/render-stability.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(path.join(root, dir))) {
    if (e === "node_modules" || e === ".next") continue;
    const rel = `${dir}/${e}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
    else if (/\.tsx$/.test(e)) files.push(rel);
  }
};
for (const d of ["app", "components"]) walk(d);
ok("there are client files to check", files.length > 10, `found ${files.length}`);

/* An INDENTED declaration is a nested one — top-level declarations start at
   column 0. Crude, and deliberately so: it needs no parser, and the codebase
   is Prettier-formatted, so indentation is reliable here in a way it would
   not be in hand-formatted code. */
const NESTED =
  /^([ \t]+)(?:const\s+([A-Z]\w*)\s*(?::[^=]{0,200})?=\s*(?:\([^)]{0,400}\)|\w+)\s*(?::[^=]{0,200})?=>|function\s+([A-Z]\w*)\s*\()/gm;

const offenders = [];
for (const rel of files) {
  const src = readFileSync(path.join(root, rel), "utf8");
  const lineAt = (i) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(NESTED)) {
    const name = m[2] ?? m[3];
    const head = src.slice(m.index + m[0].length, m.index + m[0].length + 200);
    /* Its BODY must be JSX — an arrow returning an element, or a function
       whose first statement returns one. Checked against the 200 characters
       that follow the declaration, not a window around it: a `return (<` two
       hundred lines further down belongs to something else. */
    const isComponent =
      /^\s*\(?\s*</.test(head) ||
      /^[^{]{0,200}\{\s*(?:\/\*[\s\S]*?\*\/\s*)?return\s*\(?\s*</.test(head);
    if (!isComponent) continue;
    offenders.push(`${rel}:${lineAt(m.index)} (${name})`);
  }
}

ok(
  "no component is declared inside another component",
  offenders.length === 0,
  `${offenders.join(", ")} — React sees a new type each render and rebuilds the subtree, ` +
    "so state resets and any input inside loses focus on every keystroke; move it to module scope",
);

console.log(
  fails.length === 0
    ? `PASS — every component keeps its identity between renders (${pass} checks, ${files.length} files)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
