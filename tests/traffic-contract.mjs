/* v1.43.0 — the ELFIA Traffic feed's one rule: a day the store re-sends
   REPLACES the day we hold, it never adds to it.

   The store re-sends today on every 5-minute poll as a running total (feed D,
   PORTAL-BRIDGE-SPEC.md § D). If the portal ever accumulated instead of
   replacing, the map would climb all day on its own — 288 polls, 288× the
   real traffic — and it would look like success. Nothing else in the system
   would contradict it. Hence a guard.

   Same harness discipline as bridge-idempotency: the REAL schema built from
   worker/migrations into node:sqlite, and the REAL statements extracted out
   of worker/src/bridge.ts, so what is proven here is the shipped code.

   Also proven: the cursor only ever moves forward and only to a day the
   store calls final; the poller writes to nothing but its own table; and the
   day-total row (state = '') is never mixed into the per-state map figures.

   Run: node tests/traffic-contract.mjs */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let failed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`ok   ${label}`);
  else { console.log(`FAIL ${label}\n     got  ${g}\n     want ${w}`); failed++; }
};
const fail = (msg) => { console.log(`FAIL ${msg}`); failed++; };

/* ---- schema: the real migrations, in order ---- */
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=OFF;");
db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);");
for (const f of readdirSync("worker/migrations").filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(`worker/migrations/${f}`, "utf8");
  try { db.exec(sql); continue; } catch { /* statement-wise below */ }
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/)) {
    const t = stmt.trim();
    if (!t || t.startsWith("--")) continue;
    try { db.exec(t + ";"); } catch { /* already applied / seed */ }
  }
}
try { db.prepare("SELECT day, state, city, path, visits, visitors FROM web_traffic_daily LIMIT 1").get(); }
catch (e) { console.log(`FAIL 0084 did not create web_traffic_daily as expected: ${e}`); process.exit(1); }

/* ---- the SHIPPED statements, extracted from bridge.ts ---- */
const src = readFileSync("worker/src/bridge.ts", "utf8");
const poller = src.slice(src.indexOf("export async function pollElfiaTraffic"));
if (!poller) { console.log("FAIL pollElfiaTraffic is gone from bridge.ts"); process.exit(1); }
const body = poller.slice(0, poller.indexOf("\n}\n") + 2);

const delMatch = body.match(/DELETE FROM web_traffic_daily WHERE day = \?\d/);
const insMatch = body.match(/INSERT OR REPLACE INTO web_traffic_daily[\s\S]*?VALUES \([^)]*\)/);
if (!delMatch) fail("the per-day DELETE is no longer in pollElfiaTraffic — a re-sent day would ADD to itself and the map would inflate all day");
if (!insMatch) fail("the web_traffic_daily INSERT is no longer in pollElfiaTraffic — this guard must be updated WITH the code");
if (!delMatch || !insMatch) process.exit(1);

/* The DELETE must be batched WITH the inserts: two separate awaits would
   leave a reader looking at an empty day mid-poll. */
if (!/env\.DB\.batch\(\[\s*env\.DB\.prepare\(`DELETE FROM web_traffic_daily/.test(body)) {
  fail("the DELETE + INSERTs are no longer one env.DB.batch() — a poll would expose an empty day to readers");
}

const delSql = delMatch[0].replace(/\?\d/g, "?");
const insSql = insMatch[0].replace(/\?\d/g, "?");

/* ---- a replica of the poller's per-day write, using those statements ---- */
const writeDay = (day, rows) => {
  db.prepare(delSql).run(day);
  for (const r of rows) db.prepare(insSql).run(day, r.state, r.city, r.path, r.visits, r.visitors);
};
const dayTotal = (day) =>
  db.prepare("SELECT visits, visitors FROM web_traffic_daily WHERE day = ? AND state = ''").get(day) ?? null;
const stateVisits = (day) =>
  db.prepare("SELECT state, SUM(visits) AS visits FROM web_traffic_daily WHERE day = ? AND state != '' GROUP BY state ORDER BY state").all(day)
    .map((r) => [r.state, r.visits]);

const noon = [
  { state: "", city: "", path: "", visits: 100, visitors: 40 },
  { state: "Selangor", city: "Shah Alam", path: "/", visits: 60, visitors: 25 },
  { state: "Johor", city: "Johor Bahru", path: "/", visits: 40, visitors: 15 },
];
writeDay("2026-08-24", noon);
eq("first pull of a running day is stored as sent", dayTotal("2026-08-24"), { visits: 100, visitors: 40 });

/* The identical payload again — the ordinary case, five minutes later with
   no new visitors. THE test: numbers must not move. */
writeDay("2026-08-24", noon);
eq("re-pulling the SAME running day changes nothing (no accumulation)", dayTotal("2026-08-24"), { visits: 100, visitors: 40 });
eq("…and per-state figures are unchanged too", stateVisits("2026-08-24"), [["Johor", 40], ["Selangor", 60]]);

/* Evening: more traffic, and Johor has gone quiet — its row is ABSENT from
   the new payload. A replace must drop it; an upsert-only poller would leave
   the stale 40 sitting on the map for ever. */
writeDay("2026-08-24", [
  { state: "", city: "", path: "", visits: 180, visitors: 70 },
  { state: "Selangor", city: "Shah Alam", path: "/", visits: 150, visitors: 60 },
]);
eq("a later pull of the running day replaces the totals", dayTotal("2026-08-24"), { visits: 180, visitors: 70 });
eq("a state missing from the new payload disappears (no stale rows)", stateVisits("2026-08-24"), [["Selangor", 150]]);

/* A duplicate key inside ONE payload must not throw the whole day away. */
writeDay("2026-08-25", [
  { state: "Perak", city: "Ipoh", path: "/", visits: 5, visitors: 5 },
  { state: "Perak", city: "Ipoh", path: "/", visits: 7, visitors: 6 },
]);
eq("a duplicate key inside one payload survives (last wins)", stateVisits("2026-08-25"), [["Perak", 7]]);

/* Yesterday must be untouched by today's writes. */
eq("a different day is never touched by another day's pull", dayTotal("2026-08-24"), { visits: 180, visitors: 70 });

/* ---- the reader's rule: the day-total row is not a state ---- */
{
  const mapRows = db.prepare(
    "SELECT state, SUM(visits) AS visits FROM web_traffic_daily WHERE state != '' AND day >= ? GROUP BY state",
  ).all("2026-08-24");
  if (mapRows.some((r) => r.state === "")) fail("the day-total row leaked into the per-state map figures — every state would be double-counted");
  else console.log("ok   the day-total row (state = '') stays out of the per-state figures");
  const staff = readFileSync("worker/src/staff.ts", "utf8");
  if (!/FROM web_traffic_daily\s*\n\s*WHERE state = '' AND day >= \?\d/.test(staff)) {
    fail("/staff/web-traffic no longer reads the day totals from the state = '' rows — visitor counts would be summed across overlapping groups");
  } else console.log("ok   /staff/web-traffic reads uniques from the day-total row, never by summing groups");
}

/* ---- cursor discipline ---- */
if (!/data\.final_through\s*>\s*cursor/.test(body)) {
  fail("the traffic cursor no longer requires final_through > cursor — a stale feed answer could rewind it and re-pull settled days");
} else console.log("ok   the cursor advances forward only, and only to a day the store calls final");
if (/metaSet\(env, TRAFFIC_CURSOR_KEY, (?!.*final_through)[^)]*running/.test(body)) {
  fail("the cursor is being set from the RUNNING day — today would stop refreshing before it was final");
}

/* ---- blast radius: this poller owns exactly one table ---- */
{
  const writes = [...body.matchAll(/(?:INSERT(?: OR REPLACE)? INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/gi)]
    .map((m) => m[1].toLowerCase());
  const allowed = new Set(["web_traffic_daily", "system_meta"]);
  const stray = [...new Set(writes)].filter((t) => !allowed.has(t));
  if (stray.length) fail(`pollElfiaTraffic writes to ${stray.join(", ")} — traffic is a map, it must never touch stock, orders or money`);
  else console.log("ok   pollElfiaTraffic writes only to web_traffic_daily (+ its cursor in system_meta)");
}

/* ---- no per-person data may enter the portal (OD-20a) ---- */
{
  const cols = db.prepare("SELECT name FROM pragma_table_info('web_traffic_daily')").all().map((r) => r.name);
  const forbidden = cols.filter((c) => /ip|visitor_id|hash|email|phone|customer|session|cookie|user_agent/i.test(c));
  if (forbidden.length) fail(`web_traffic_daily carries ${forbidden.join(", ")} — OD-20a is anonymous AGGREGATES only`);
  else console.log("ok   web_traffic_daily carries no column that could identify a visitor (OD-20a)");
}

if (failed) { console.error(`\n${failed} traffic-contract check(s) failed.`); process.exit(1); }
console.log("\ntraffic-contract: a re-sent day replaces, never accumulates.");
