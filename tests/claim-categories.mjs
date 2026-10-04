/* tests/claim-categories.mjs - v1.181.7: THE FORM, THE API AND THE TABLE AGREE.
 *
 * hr_admin, 29-09-2026: she could not claim for stationery. The form offered
 * eight categories and the API accepted all eight (v1.150.0), but the claims
 * table still carried the six-value CHECK written in migration 0026. The row
 * for a claim whose first line was Stationery or Client meeting broke the
 * constraint; INSERT OR IGNORE swallowed that like a duplicate, and the
 * person saw "The claim could not be created". Nobody could claim stationery
 * for weeks, and no guard noticed, because every guard compared the code with
 * the code. Migration 0138 rebuilt the table with the full list.
 *
 * This guard holds the three lists to one another, from source:
 *
 *   1. the categories the claim form offers  (components/portal/role-panels.tsx)
 *   2. the categories the API accepts        (worker/src/staff.ts CLAIM_CATS)
 *   3. the categories the table allows       (the LATEST migration that sets
 *                                              the claims category CHECK)
 *
 * and every category the form offers has a Malay label. It plants a mismatch
 * first, so a parser that finds nothing cannot pass it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

const quoted = (s) => [...s.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
const same = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

const panels = read("components/portal/role-panels.tsx");
const staff = read("worker/src/staff.ts");

const formList = quoted(/const CLAIM_CATEGORIES = \[([^\]]+)\] as const;/.exec(panels)?.[1] ?? "");
const apiList = quoted(/const CLAIM_CATS = \[([^\]]+)\];/.exec(staff)?.[1] ?? "");

/* the last migration, in order, whose claims table carries a category CHECK */
const migDir = join(root, "worker", "migrations");
const migs = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
let tableList = [], tableFrom = "";
for (const f of migs) {
  const sql = readFileSync(join(migDir, f), "utf8");
  if (!/CREATE TABLE (?:IF NOT EXISTS )?claims(?:_new\w*)?\s*\(/.test(sql)) continue;
  const m = /category TEXT[^,\n]*CHECK \(category IN \(([^)]*)\)\)/.exec(sql);
  if (m) { tableList = quoted(m[1]); tableFrom = f; }
}

/* ---- 0. the comparison can fail ---- */
ok("self-test: a missing category is a mismatch", !same(["a", "b"], ["a"]));
ok("self-test: the same set in another order matches", same(["a", "b"], ["b", "a"]));

ok("the form's list was found", formList.length >= 6, JSON.stringify(formList));
ok("the API's list was found", apiList.length >= 6, JSON.stringify(apiList));
ok("the table's CHECK was found", tableList.length >= 6, JSON.stringify(tableList));

ok("the API accepts exactly what the form offers", same(formList, apiList),
  `form ${JSON.stringify(formList)} vs API ${JSON.stringify(apiList)}`);
ok(`the table (${tableFrom}) allows exactly what the API accepts`, same(apiList, tableList),
  `API ${JSON.stringify(apiList)} vs table ${JSON.stringify(tableList)} - a category the table refuses is a claim that is silently never saved`);
ok("stationery can be claimed end to end", formList.includes("stationery") && apiList.includes("stationery") && tableList.includes("stationery"));

/* every offered category has a Malay label */
const bm = /stationery: "Alat tulis"/.test(panels) ? panels : "";
for (const c of formList) {
  const key = c.includes(" ") ? `"${c}"` : c;
  ok(`the category "${c}" has a Malay label`, bm.includes(`${key}: "`) || panels.includes(`"${c}": "`), "add it to the BM category labels");
}

/* a refused insert is reported, not dressed up as a duplicate */
ok("a refused claim insert is logged and said plainly",
  /"claim_insert_refused"/.test(staff) && /The claim was not saved - nothing was submitted/.test(staff));

if (failed) {
  console.log(`\nclaim-categories: ${failed} failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`claim-categories: ${passed} checks passed - the form, the API and the table allow the same ${apiList.length} categories.`);
