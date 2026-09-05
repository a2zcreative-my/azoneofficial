#!/usr/bin/env node
/* Guard #36 — v1.100.0: the hotel directory.
 *
 * CEO, 05-09-2026, with 1. DATA HOTEL.xlsx: *"make sure that it is being
 * listed by State ... phone number based on Malaysia format ... Validate the
 * state based on the tabsheet of the excel ... Tabs only visible for ceo,
 * cco, coo, hr_admin, super admin, admin."*
 *
 * Four properties, each of which is a way the list could quietly go wrong:
 *
 *   1. ONE STATE VOCABULARY. The workbook's fifteen sheet names live in the
 *      migration's CHECK constraint, in MY_STATES in the worker, and in the
 *      map's tiles. Three copies of a closed list is three chances to lose a
 *      state - and a hotel filed under a state no view groups by is a hotel
 *      nobody rings. The three are compared here, name for name.
 *   2. A PHONE IS MALAYSIAN. formatMyPhone is run, for real, over the shapes
 *      the workbook actually contained.
 *   3. THE TIER THE CEO NAMED. hotels_view and hotels_manage, in the worker
 *      matrix and in the client's TAB_ROLES, are exactly the six roles.
 *   4. DELETE IS SOFT AND EVERY MUTATION IS AUDITED.
 *
 * Negative-tested by: dropping SARAWAK from MY_STATES; returning the raw
 * string from formatMyPhone; adding sales_marketing to hotels_view; turning
 * the soft delete into a DELETE FROM.
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const src = read("worker/src/hotels.ts");
const mig = read("worker/migrations/0111_hotels.sql");
const perms = read("worker/src/permissions.ts");
const tabs = read("lib/portal-tabs.ts");
const panel = read("components/portal/hotels-panel.tsx");
const staff = read("worker/src/staff.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- run the real module ---- */
const dir = mkdtempSync(join(tmpdir(), "hotels-"));
const out = join(dir, "hotels.mjs");
execSync(`npx esbuild ${join(root, "worker/src/hotels.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`,
  { cwd: root, stdio: "inherit" });
const { MY_STATES, formatMyPhone, cleanEmail } = await import(pathToFileURL(out).href);

/* ---- 1. one state vocabulary, in three places ---- */
{
  ok("the worker carries fifteen states", Array.isArray(MY_STATES) && MY_STATES.length === 15,
     `got ${MY_STATES?.length}`);
  const check = /CHECK \(state IN \(([\s\S]*?)\)\)/.exec(mig);
  const inMigration = check ? [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  ok("the migration's CHECK holds the same fifteen, name for name",
     inMigration.length === 15 && MY_STATES.every((s) => inMigration.includes(s)),
     `migration has ${inMigration.length}: ${inMigration.filter((s) => !MY_STATES.includes(s)).join(", ") || "same names"}`);
  const tiles = [...panel.matchAll(/\{ state: "([^"]+)", short:/g)].map((m) => m[1]);
  ok("the map draws a tile for every state and invents none",
     tiles.length === 15 && MY_STATES.every((s) => tiles.includes(s)),
     `map has ${tiles.length}: ${tiles.filter((s) => !MY_STATES.includes(s)).join(", ") || "same names"}`);
  ok("a state off the list is refused with the list in the message",
     /state must be one of: \$\{MY_STATES\.join\(", "\)\}/.test(src),
     "a hotel filed under an invented state disappears from every view that groups by state");
}

/* ---- 2. a phone is stored in Malaysian form ---- */
{
  const cases = [
    ["0174761019", "017-476 1019"],
    ["017-4761019", "017-476 1019"],
    ["+60 17 476 1019", "017-476 1019"],
    ["60174761019", "017-476 1019"],
    ["0340428000", "03-4042 8000"],
    ["03-4051 9191", "03-4051 9191"],
    ["088123456", "088-123 456"],
    ["04-7708888", "04-770 8888"],
    ["011-26424288", "011-2642 4288"],
  ];
  for (const [given, want] of cases) {
    ok(`phone "${given}" -> ${want}`, formatMyPhone(given) === want, `got ${formatMyPhone(given)}`);
  }
  ok("an ext survives", formatMyPhone("03-20266060 Ext :7200") === "03-2026 6060 ext 7200",
     `got ${formatMyPhone("03-20266060 Ext :7200")}`);
  ok("empty is nothing", formatMyPhone("") === null && formatMyPhone(null) === null);
  ok("a number it cannot read is KEPT, not dropped", formatMyPhone("call the front desk") === "call the front desk",
     "a bad number somebody can read and fix beats a good number the parser ate");
  ok("an email that is not one is refused", cleanEmail("not an email") === null && cleanEmail("A@B.com") === "a@b.com");
}

/* ---- 3. the tier the CEO named ---- */
{
  const SIX = ["super_admin", "admin", "ceo", "coo", "cco", "hr_admin"].sort();
  const rolesOf = (text, key) => {
    const m = new RegExp(`${key}: \\[([^\\]]*)\\]`).exec(text);
    return m ? [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort() : [];
  };
  ok("hotels_view is exactly the six roles", JSON.stringify(rolesOf(perms, "hotels_view")) === JSON.stringify(SIX),
     rolesOf(perms, "hotels_view").join(", "));
  ok("hotels_manage is exactly the six roles", JSON.stringify(rolesOf(perms, "hotels_manage")) === JSON.stringify(SIX),
     rolesOf(perms, "hotels_manage").join(", "));
  ok("the client's tab mirrors the worker", JSON.stringify(rolesOf(tabs, "Hotels")) === JSON.stringify(SIX),
     rolesOf(tabs, "Hotels").join(", "));
  ok("the whole module is behind hotels_view",
     /if \(!can\(user\.role, "hotels_view"\)\) return err\("forbidden"/.test(src));
  ok("every write needs hotels_manage",
     [...src.matchAll(/method === "(POST|PUT|DELETE)"/g)].length >= 3
     && [...src.matchAll(/if \(!manage\) return err\("forbidden"/g)].length >= 3,
     "a viewer could edit somebody else's territory");
  ok("the staff dispatch has the door",
     /path === "\/hotels" \|\| path\.startsWith\("\/hotels\/"\)/.test(staff));
}

/* ---- 4. delete is soft, and every mutation is audited ---- */
{
  ok("delete is a soft delete", /UPDATE hotels SET is_active = 0/.test(src) && !/DELETE FROM hotels\b/.test(src),
     "a contact list is weeks of somebody's work and a mis-click is not a reason to lose it");
  for (const a of ["hotel.create", "hotel.update", "hotel.delete"]) {
    ok(`${a} is audited`, src.includes(`"${a}"`));
  }
  ok("the deletion records WHAT it removed", /audit\(env, user\.id, "hotel\.delete"[\s\S]{0,120}?hotel_name: before\.hotel_name/.test(src),
     "an id in an audit log nobody can resolve to a name is an audit log nobody reads");
  ok("the panel confirms before deleting", /await confirm\(\{[\s\S]{0,700}?variant: "danger"/.test(panel));
  ok("the panel reports either way", /toast\(L\("Removed"[\s\S]{0,200}?toast\(L\("Not removed"/.test(panel));
  ok("the panel uses the portal's own styles, not bespoke buttons",
     /from "@\/components\/ui\/row-button"/.test(panel) && /from "@\/lib\/ui-styles"/.test(panel)
     && !/className="[^"]*bg-\[#/.test(panel),
     "the CEO asked for edit and delete on the global style");
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — one state vocabulary, Malaysian phone numbers, the tier the CEO named, and nothing deleted for good (${passed} checks)`);
