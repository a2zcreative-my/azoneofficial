/* v1.396.0 - GUARD: THE FILES A2Z OS AND AZ ONE SHARE (Digital Cards Stage 7, the CEO 21-11-2026).
 *
 * lib/card-render.ts (the drawing of a card page) and lib/card-bridge-sign.ts (the feed signature) are
 * copied BYTE FOR BYTE into the AZ ONE storefront (src/shared/). lib/card-shared.sha256 lists their
 * SHA-256 and AZ ONE's own test checks its copies against the same list - so a change on one side that
 * is not made on the other fails a build. Change them here first, copy them to AZ ONE, update the list
 * in both repositories.
 *
 *   node tests/card-shared.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const results = [];
const ok = (c, m) => results.push([!!c, m]);
const list = readFileSync(join(root, "lib/card-shared.sha256"), "utf8").split("\n").filter((l) => /^[a-f0-9]{64}\s/.test(l)).map((l) => l.split(/\s+/));
ok(list.length === 2 && list.map(([, f]) => f).sort().join() === "card-bridge-sign.ts,card-render.ts", "the list names exactly the two shared files");
for (const [hash, file] of list) {
  const src = readFileSync(join(root, "lib", file));
  ok(createHash("sha256").update(src).digest("hex") === hash, `lib/${file} is the version listed (copy it to AZ ONE src/shared/ and update the list in both repositories if you changed it)`);
  ok(!/^\s*import\s/m.test(src.toString()), `lib/${file} imports nothing (AZ ONE copies it as it is)`);
}
const failed = results.filter(([c]) => !c);
for (const [c, m] of results) console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
if (failed.length) { console.log(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log(`\n${results.length} check(s) passed.`);
