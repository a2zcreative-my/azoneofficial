#!/usr/bin/env node
/* v1.172.2 - shrink styles/legacy-utilities.css to what the tree still uses.
 *
 * The sheet is FROZEN: nothing generates it and nothing may be added to it.
 * When a screen migrates to .erp-* classes or a CSS Module, the utilities it
 * alone referenced become dead weight. This script finds every class the
 * sheet defines that no string in app/, components/, lib/, hooks/ or
 * constants/ references any more, and removes those rules (and any @media
 * block that is left empty). It never adds, never edits a surviving rule.
 *
 *   node scripts/prune-legacy-utilities.mjs          report only
 *   node scripts/prune-legacy-utilities.mjs --write  rewrite the sheet
 *
 * Then run `node tests/tailwind-retired.mjs --write-budget` so the ratchet
 * records the new, lower counts, and `npm run guard`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCss, serialize, definedClasses, prune, referencedTokens } from "./legacy-utilities-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const write = process.argv.includes("--write");
const file = join(root, "styles/legacy-utilities.css");
const css = readFileSync(file, "utf8");

const nodes = parseCss(css);
const defined = definedClasses(nodes);
const referenced = new Set();
for (const set of referencedTokens(root).values()) for (const t of set) referenced.add(t);
const dead = [...defined].filter((c) => !referenced.has(c)).sort();

console.log(`legacy-utilities.css defines ${defined.size} classes; ${dead.length} are no longer referenced.`);
if (dead.length) console.log("  " + dead.join("\n  "));
if (!write) { console.log(dead.length ? "\nRun with --write to remove them." : "\nNothing to prune."); process.exit(0); }

const keep = new Set([...defined].filter((c) => referenced.has(c)));
const pruned = prune(nodes, keep);
/* keep the header comment and the :root block exactly; re-count for the header */
let out = serialize(pruned);
out = out.replace(/\((\d+) selectors\)/, `(${definedClasses(pruned).size} selectors)`);
writeFileSync(file, out);
console.log(`\nWrote ${file}: ${definedClasses(pruned).size} classes remain.`);
