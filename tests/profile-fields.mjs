/* tests/profile-fields.mjs - v1.181.4: THE PROFILE CARD ONLY READS WHAT THE API SENDS.
 *
 * The CEO's phone, 23-09-2026, on Profile: a navy circle with an "A" in it,
 * directly under a topbar showing his real photo. The card has drawn the
 * photo from `profile.photo_key` since v1.4.141, and GET /staff/profile has
 * never selected `photo_key` - so the field was always undefined and the
 * card always fell back to the initial. Nothing failed; the value simply
 * never arrived, and a missing field looks exactly like an empty one.
 *
 * This guard reads every `profile.<field>` (and every key the card lists for
 * its detail grid) in components/portal/profile.tsx and requires each to be
 * named in GET /profile's SELECT in worker/src/staff.ts. The fields that
 * arrived with migration 0137 must be in the full SELECT; every other field
 * must ALSO be in the pre-0137 fallback SELECT, so a database mid-migration
 * still draws the photo and the details.
 *
 * It plants a field the API does not send first, so a regex that matches
 * nothing cannot pass it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

/* Fields that exist only from migration 0137; the fallback SELECT may omit them. */
const FROM_0137 = new Set(["role_title", "responsibilities", "responsibilities_updated_at"]);

function fieldsRead(tsx) {
  const found = new Set();
  for (const m of tsx.matchAll(/\bprofile\.([a-z_]+)\b/g)) found.add(m[1]);
  /* the detail grid: [ "email", "role", ... ].map((k) => ... profile[k] */
  const grid = /\[\s*((?:"[a-z_]+",?\s*)+)\]\.map\(\(k\)/.exec(tsx);
  if (grid) for (const m of grid[1].matchAll(/"([a-z_]+)"/g)) found.add(m[1]);
  return found;
}

function selects(worker) {
  const start = worker.indexOf('if (path === "/profile" && method === "GET")');
  const end = worker.indexOf('if (path === "/profile" && method === "PATCH")', start);
  const handler = start >= 0 && end > start ? worker.slice(start, end) : "";
  return [...handler.matchAll(/SELECT([\s\S]*?)FROM users/g)]
    .map((m) => new Set(m[1].split(",").map((c) => c.trim()).filter(Boolean)));
}

const tsx = read("components/portal/profile.tsx");
const worker = read("worker/src/staff.ts");
const used = fieldsRead(tsx);
const sel = selects(worker);

/* ---- 0. the checker catches a field the API does not send ---- */
{
  const planted = fieldsRead(`${tsx}\n{profile.not_a_column}`);
  ok("self-test: a planted field is seen", planted.has("not_a_column"));
  ok("self-test: a planted field is not in the SELECT", sel.length > 0 && !sel[0].has("not_a_column"));
}

ok("the card reads its fields (found some)", used.size >= 8, `only ${[...used].join(", ")}`);
ok("the card reads photo_key", used.has("photo_key"));
ok("GET /profile has its full and fallback SELECTs", sel.length === 2, `found ${sel.length}`);

if (sel.length === 2) {
  const [full, fallback] = sel;
  for (const f of used) {
    ok(`GET /profile selects ${f}`, full.has(f),
      `profile.tsx reads profile.${f} but the SELECT never names it, so it always arrives undefined`);
    if (!FROM_0137.has(f)) {
      ok(`GET /profile's pre-0137 fallback selects ${f}`, fallback.has(f),
        `a database before migration 0137 would lose profile.${f}`);
    }
  }
}

if (failed) {
  console.log(`\nprofile-fields: ${failed} failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`profile-fields: ${passed} checks passed - every field the Profile card reads is one the API sends.`);
