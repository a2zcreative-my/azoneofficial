#!/usr/bin/env node
/* Guard #37 — v1.101.0: the organisation chart.
 *
 * CEO, 05-09-2026: *"I want to add infographic for each staff reported to who
 * which is either CEO, COO or CCO. I will assigned by myself and organized it
 * based on who is their HOD to make it like organisation."*
 *
 * Five properties, each one a way the chart could quietly go wrong:
 *
 *   1. NOBODY FALLS OFF. Every active person is on the chart or in the tray -
 *      exactly one of the two, exactly once. A reporting line pointing at a
 *      leaver, at a stranger, at themselves, or round a loop must leave the
 *      person VISIBLE and waiting, never vanished. This is run for real,
 *      against data shaped like each of those failures.
 *   2. A LOOP STRANDS NOBODY AND HANGS NOTHING. buildOrg and divisionOf are
 *      run on a ring written straight into the data. The descent cannot reach
 *      a ring (one parent each, and the root is nobody child), so the danger
 *      is not recursion - it is five people on no chart at all. They must all
 *      end up in the tray, and divisionOf, which DOES walk into a ring, must
 *      still return.
 *   3. THE SERVER REFUSES WHAT THE PICKER HIDES. The worker checks self-
 *      assignment and walks the line up before writing; descendantsOf hides
 *      exactly the same choices in the select.
 *   4. THE THREE THE CEO NAMED, IN BOTH PLACES. PERMS.org_assign and
 *      ORG_ASSIGN_ROLES are the same three - and deliberately do NOT include
 *      admin, super_admin or hr_admin.
 *   5. THE CHANGE IS RECORDED AND REPORTED. Audited with both names in the
 *      worker; a toast on success AND on refusal in the client (house rule
 *      #25), and migration 0113 registered in all three places.
 *
 * Negative-tested by: dropping the sweep that puts unreached people in the
 * tray (1 and 2 fail); removing the hop limit from divisionOf (2 hangs, and
 * the runner is killed rather than looping); returning an empty set from
 * descendantsOf (3 fails); adding hr_admin to org_assign (4 fails); deleting
 * the worker cycle walk (3 fails); removing the failure toast (5 fails).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const perms = read("worker/src/permissions.ts");
const staff = read("worker/src/staff.ts");
const panel = read("components/staff/org-chart.tsx");
const directory = read("components/staff/staff-directory.tsx");
const index = read("worker/src/index.ts");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- run the real module ---- */
const dir = mkdtempSync(join(tmpdir(), "org-"));
const out = join(dir, "org-tree.mjs");
execSync(`npx esbuild ${join(root, "lib/org-tree.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`,
  { cwd: root, stdio: "inherit" });
const { buildOrg, divisionOf, descendantsOf, ORG_ASSIGN_ROLES, isHere } = await import(pathToFileURL(out).href);

const P = (id, role, reports_to = null, employment_status = "permanent") =>
  ({ id, name: `P${id}`, role, reports_to, employment_status });

/* ---- 1. nobody falls off ---- */
{
  /* A company shaped like the real one, plus every broken line at once:
     8 points at a leaver, 9 at an id that does not exist, 10 at itself,
     11 and 12 at each other, 13 at nobody. */
  const people = [
    P(1, "ceo"), P(2, "coo", 1), P(3, "cco", 1),
    P(4, "hr_admin", 2), P(5, "sales_marketing", 4), P(6, "marketing", 3),
    P(7, "editor", 999999),                       // stranger
    P(8, "live_host", 90),                        // a leaver
    P(90, "coo", 1, "resigned"),                  // the leaver
    P(9, "marketing", null),                      // never assigned
    P(10, "editor", 10),                          // themselves
    P(11, "marketing", 12), P(12, "marketing", 11), // a closed loop
  ];
  const { root: tree, unassigned } = buildOrg(people);
  const onChart = [];
  (function walk(n) { onChart.push(n.u.id); n.children.forEach(walk); })(tree);

  const active = people.filter(isHere).map((p) => p.id);
  const seen = [...onChart, ...unassigned.map((u) => u.id)];
  ok("every active person is somewhere", active.every((id) => seen.includes(id)),
     `missing: ${active.filter((id) => !seen.includes(id)).join(", ")}`);
  ok("nobody is in two places at once", new Set(seen).size === seen.length,
     `duplicated: ${seen.filter((id, i) => seen.indexOf(id) !== i).join(", ")}`);
  ok("the leaver is on neither", !seen.includes(90),
     "somebody who resigned is not in the organisation");
  ok("the CEO is the root", tree?.u.id === 1, `root is ${tree?.u.id}`);
  ok("a line to a leaver leaves the person waiting, not gone", unassigned.some((u) => u.id === 8));
  ok("a line to a stranger leaves the person waiting, not gone", unassigned.some((u) => u.id === 7));
  ok("a line to themselves leaves the person waiting, not gone", unassigned.some((u) => u.id === 10));
  ok("a closed loop leaves BOTH waiting, not gone",
     unassigned.some((u) => u.id === 11) && unassigned.some((u) => u.id === 12),
     "a pair pointing at each other is the shape that used to disappear");
  ok("a real line puts somebody on the chart", onChart.includes(5) && onChart.includes(4),
     "the HOD and their person");

  /* the division is read by walking up, not stored */
  const byId = new Map(people.filter(isHere).map((u) => [u.id, u]));
  ok("a person two levels down is in their division head's division",
     divisionOf(byId.get(5), byId) === "coo", divisionOf(byId.get(5), byId) ?? "null");
  ok("a division head is their own division", divisionOf(byId.get(3), byId) === "cco");
  ok("somebody with no line has no division", divisionOf(byId.get(9), byId) === null);
}

/* ---- 2. a loop cannot hang the page ---- */
{
  /* A ring of five with nothing outside it but the CEO. divisionOf walks UP,
     so it walks straight into the ring: without its hop limit this never
     returns and the runner is killed rather than looping the CI forever. And
     the five must still be somewhere a person can see them. */
  /* NOT ONE OF THEM IS A CEO, COO OR CCO. A ring with a division head in it
     short-circuits divisionOf on the first hop and proves nothing; this ring
     has no exit, so the upward walk goes round it until the hop limit stops
     it. That is the whole point of the hop limit. */
  const ring = [P(1, "ceo"), P(2, "marketing", 6), P(3, "marketing", 2), P(4, "marketing", 3),
                P(5, "marketing", 4), P(6, "marketing", 5)];
  const started = Date.now();
  const { root: tree, unassigned } = buildOrg(ring);
  const byId = new Map(ring.map((u) => [u.id, u]));
  const divisions = ring.filter((u) => u.id !== 1).map((u) => divisionOf(u, byId));
  const ms = Date.now() - started;
  ok("a ring of five returns, and quickly", ms < 1000, `${ms}ms`);
  ok("a person in a ring has no division, rather than a wrong one",
     divisions.every((d) => d === null), divisions.join(", "));
  ok("the ring does not join the chart", tree?.children.length === 0,
     `${tree?.children.length} children hang off a CEO nobody reports to`);
  ok("the whole ring is in the tray", [2, 3, 4, 5, 6].every((id) => unassigned.some((u) => u.id === id)),
     "five people invisible is worse than five people waiting");
}

/* ---- 3. the server refuses what the picker hides ---- */
{
  const people = [P(1, "ceo"), P(2, "coo", 1), P(3, "hr_admin", 2), P(4, "marketing", 3)];
  const below2 = descendantsOf(2, people);
  ok("the picker hides everybody below you", below2.has(3) && below2.has(4),
     "offering your own report as your manager is offering a loop");
  ok("the picker does not hide your peers or your seniors", !below2.has(1) && !below2.has(2));
  ok("descendantsOf terminates on a ring",
     (() => { const r = [P(1, "a", 2), P(2, "b", 1)]; const t = Date.now(); descendantsOf(1, r); return Date.now() - t < 1000; })());

  ok("the worker refuses self-assignment",
     /if \(managerId === id\) \{[\s\S]{0,200}?Nobody reports to themselves/.test(staff),
     "a person reporting to themselves is a one-node loop");
  ok("the worker WALKS THE LINE UP before writing",
     /let cursor: number \| null = managerId;[\s\S]{0,400}?if \(cursor === id\)[\s\S]{0,300}?loop/.test(staff),
     "a loop cannot be seen by looking at the two people involved");
  ok("that walk has a hop limit of its own", /hop < 64/.test(staff),
     "a cycle already in the data must not hang the walk that is there to find cycles");
  ok("the worker refuses a manager who is not a staff record",
     /if \(!manager\) return err\("not_found", "That manager is not a staff record"/.test(staff));
  ok("clearing a line is allowed", /reports_to must be a staff id, or null to clear it/.test(staff));
}

/* ---- 4. the three the CEO named, in both places ---- */
{
  const THREE = ["cco", "ceo", "coo"];
  const m = /org_assign: \[([^\]]*)\]/.exec(perms);
  const worker = m ? [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort() : [];
  ok("org_assign is exactly ceo, coo and cco", JSON.stringify(worker) === JSON.stringify(THREE),
     worker.join(", ") || "org_assign is not in PERMS");
  ok("the client's list is the same three",
     JSON.stringify([...ORG_ASSIGN_ROLES].sort()) === JSON.stringify(THREE),
     [...ORG_ASSIGN_ROLES].join(", "));
  for (const r of ["admin", "super_admin", "hr_admin"]) {
    ok(`${r} is deliberately NOT allowed to set a reporting line`, !worker.includes(r),
       "the CEO said he assigns it himself, and named who else may");
  }
  ok("the route is behind org_assign",
     /if \(!can\(user\.role, "org_assign"\)\)[\s\S]{0,160}?403\)/.test(staff));
  ok("the client passes the viewer's role in", /role=\{user\.role\}/.test(read("app/portal/page.tsx")));
  ok("the client hides the control it may not use",
     /canAssign=\{canAssign && !readOnly\}/.test(directory) && /ORG_ASSIGN_ROLES\.includes\(role\)/.test(directory));
  ok("a viewer who may not assign is still told who places people",
     /The CEO, COO or CCO places these/.test(panel),
     "a tray of unplaced people with no explanation reads as a bug");
}

/* ---- 4b. the chart is the portal's own style, and bilingual ---- */
{
  ok("the chart is built on the portal's card, not a bespoke box",
     /from "@\/lib\/ui-styles"/.test(panel) && /className=\{card\}/.test(panel));
  ok("no hardcoded brand colours",
     !/#[0-9a-fA-F]{6}/.test(panel) && !/className="[^"]*bg-\[#/.test(panel),
     "a division colour that is a hex is a division colour a re-brand misses");
  ok("the division colours are mixed from the brand",
     /var\(--gold-solid\)/.test(panel) && /var\(--primary\)/.test(panel) && /color-mix/.test(panel));
  const bare = [...panel.matchAll(/>\s*([A-Z][A-Za-z][^<>{}\n]{6,})\s*</g)].map((m) => m[1].trim());
  ok("every sentence on the chart goes through L(en, ms)", bare.length === 0,
     bare.slice(0, 3).join(" | "));
  ok("the chart skips leavers", /export const isHere/.test(read("lib/org-tree.ts")) && /filter\(isHere\)/.test(panel),
     "an org chart with a resigned box in the middle of it describes a company that does not exist");
}

/* ---- 4c. the line is changed FROM the chart (v1.101.1) ----
   CEO, 05-09-2026: *"for Organisation, I want to edit back if I want to
   change their reporting to HOD."* It was already possible in v1.101.0 - from
   a panel that shipped collapsed at the bottom of the page, which is to say
   it was not. */
{
  ok("a box on the chart carries its own control for changing the line",
     /canAssign && !isRoot/.test(panel) && /onEdit\(editing \? null : u\)/.test(panel),
     "a control the CEO had to ask for is a control nobody could find");
  ok("the top of the chart does not offer one",
     /Nobody sits above the top of the chart/.test(panel),
     "the root has no manager, so the control there can only ever be refused");
  ok("the card does not nest a button inside a button",
     /function OrgCard\([\s\S]{0,900}?return \(\s*<span/.test(panel),
     "browsers silently un-nest it and one of the two presses stops working");
  ok("the picker opens in a bar under the chart, not over a box",
     /fixed to the bottom of the CARD|bottom of the CARD/i.test(panel) || /editing && canAssign/.test(panel),
     "the chart scrolls sideways; a popover pinned to a box sails off with it");
  ok("choosing a manager writes it and closes the bar",
     /onPick=\{\(m\) => \{ onAssign\(editing\.id, m\); setEditing\(null\); \}\}/.test(panel));
  ok("the full table is open by default", /useState\(true\);/.test(panel) && /const \[showAll, setShowAll\]/.test(panel),
     "it shipped collapsed and the CEO had to ask where the control was");
  ok("the instruction line says how to change a line", /Press the pencil on a box/.test(panel));
}

/* ---- 5. the change is recorded, reported, and the column exists ---- */
{
  ok("the assignment is audited", /audit\(env, user\.id, "staff\.reports_to"/.test(staff));
  ok("the audit carries BOTH names, not only ids",
     /staff\.reports_to[\s\S]{0,400}?from_name[\s\S]{0,200}?to_name/.test(staff),
     "an id nobody can resolve a year later is a line nobody reads");
  ok("the client reports a refusal", /showToast\(L\("Not changed"/.test(directory));
  ok("the client reports a success", /showToast\(L\("Reporting line set"/.test(directory));
  ok("clearing a line says so rather than saying nothing",
     /no longer on the chart/.test(directory));

  ok("migration 0113 exists", read("worker/migrations/0113_reports_to.sql").includes("ADD COLUMN reports_to"));
  ok("0113 is in EXPECTED_MIGRATIONS", index.includes('"0113_reports_to",'));
  ok("LATEST_MIGRATION names it", /const LATEST_MIGRATION = "0113_reports_to"/.test(index));
  ok("the staff list actually selects reports_to", /SELECT \$\{CORE\}, u\.reports_to FROM users u/.test(staff));
  ok("a database without 0113 still returns the OTHER columns",
     /no such column[\s\S]{0,300}?0113 reports_to missing[\s\S]{0,300}?SELECT \$\{CORE\} FROM users u/.test(staff),
     "one new column should cost one new column, not seven profile fields");
  ok("the tab says so rather than failing silently",
     /pending_migration[\s\S]{0,160}?migration 0113 applies/.test(staff));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — nobody falls off the chart, a loop cannot hang it, the three the CEO named, and every change recorded (${passed} checks)`);
