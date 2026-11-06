/* PHASE 0, P0-B - THE ELFIA BOOKING COLUMNS (v1.271.0). Schema guard.
 *
 * Production web_orders was made before 0081 carried booked_cents and
 * refund_flagged_at (claude/PHASE0-SAFETY-REVIEW.md), so a paid ELFIA order
 * could not be booked there. 0179 and 0180 add one column each.
 *
 *   shape      a production-shaped database (every migration to 0178, then
 *              the two columns taken away, as production has them) takes
 *              0179 and 0180 and ends with both columns
 *   queries    every worker SQL statement that names either column compiles
 *              on that repaired database - and some of them fail on the
 *              drifted one, so this guard can see the drift at all
 *   one each   each migration is exactly one ALTER statement (rule B4)
 *   preflight  the PUSH.bat data pre-flight reads the column with the query
 *              it uses, and reports it present or absent correctly
 *   probe      the System health probe for 0179-0180 reads both columns
 *   fresh      on a database built fresh (0081 already has both columns) the
 *              ALTER fails - which is why the pre-flight and the release
 *              notes say to mark them applied there
 * Then mutated copies must each fail a check. No data, only the schema.
 *
 *   node tests/elfia-columns.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const MIG = join(root, "worker/migrations");
const COLS = ["booked_cents", "refund_flagged_at"];
const NEW = ["0179_web_orders_booked_cents.sql", "0180_web_orders_refund_flag.sql"];

const applyFile = (db, text) => { for (const st of text.split(/;\s*\n/)) { try { db.exec(st); } catch { /* as every whole-worker guard: a statement SQLite reads differently */ } } };
const columns = (db) => db.prepare(`SELECT name FROM pragma_table_info('web_orders')`).all().map((r) => r.name);
const statements = (text) => text.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);

function check(src) {
  const out = [];
  const ok = (c, m, why = "") => out.push([!!c, why && !c ? `${m} - ${why}` : m]);
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

  /* a production-shaped database */
  const prod = new DatabaseSync(":memory:");
  for (const f of files.filter((f) => f < "0179")) applyFile(prod, readFileSync(join(MIG, f), "utf8"));
  for (const c of COLS) prod.exec(`ALTER TABLE web_orders DROP COLUMN ${c}`);
  ok(COLS.every((c) => !columns(prod).includes(c)), "the production-shaped database lacks both columns, as production does");

  /* the worker's statements that name the columns */
  const sql = [];
  for (const f of readdirSync(join(root, "worker/src")).filter((f) => f.endsWith(".ts"))) {
    const text = src[`worker/src/${f}`] ?? readFileSync(join(root, "worker/src", f), "utf8");
    for (const m of text.matchAll(/`([^`]*)`/g)) {
      const q = m[1];
      if (!COLS.some((c) => q.includes(c)) || q.includes("${") || !/^\s*(SELECT|UPDATE|INSERT|WITH)\b/i.test(q)) continue;
      sql.push([f, q]);
    }
  }
  ok(sql.length >= 4, "the worker statements that name the columns are found", String(sql.length));
  const failsDrifted = sql.filter(([, q]) => { try { prod.prepare(q); return false; } catch { return true; } });
  ok(failsDrifted.length > 0, "some of them fail on the drifted database - the guard sees the drift");

  /* the PUSH.bat pre-flight query, before */
  const pre = src["scripts/migration-preflight.mjs"] ?? readFileSync(join(root, "scripts/migration-preflight.mjs"), "utf8");
  const preSql = /sql: `(SELECT name FROM pragma_table_info\('web_orders'\) WHERE name = '\$\{col\}')`/.exec(pre)?.[1];
  ok(!!preSql, "the pre-flight checks the column with pragma_table_info");
  const preQ = (c) => (preSql ?? "SELECT 1 WHERE 0").replace("${col}", c);
  ok(COLS.every((c) => prod.prepare(preQ(c)).all().length === 0), "the pre-flight sees both columns absent before the migrations");
  for (const [mig, col] of [["0179_web_orders_booked_cents", "booked_cents"], ["0180_web_orders_refund_flag", "refund_flagged_at"]]) {
    ok(new RegExp(`\\["${mig}", "${col}"\\]`).test(pre), `the pre-flight pairs ${mig} with ${col}`);
  }

  /* the two migrations */
  for (const f of NEW) {
    const text = src[`worker/migrations/${f}`] ?? readFileSync(join(MIG, f), "utf8");
    const sts = statements(text);
    ok(sts.length === 1 && /^ALTER TABLE web_orders ADD COLUMN \w+ (INTEGER|TEXT)$/.test(sts[0]), `${f} is exactly one ALTER`, JSON.stringify(sts));
    ok(/^[\x00-\x7f]*$/.test(text) && !/[';"]/.test(text.split("\n").filter((l) => l.trimStart().startsWith("--")).join("")), `${f} comments are plain ASCII with no quote or semicolon`);
    applyFile(prod, text);
  }
  ok(COLS.every((c) => columns(prod).includes(c)), "after 0179 and 0180 the production-shaped database has both columns");
  ok(COLS.every((c) => prod.prepare(preQ(c)).all().length === 1), "the pre-flight would now see them present");
  const stillFail = sql.filter(([, q]) => { try { prod.prepare(q); return false; } catch { return true; } });
  ok(stillFail.length === 0, "every worker statement that names the columns compiles on the repaired database", stillFail.map(([f, q]) => `${f}: ${q.trim().slice(0, 80)}`).join(" | "));

  /* the health probe and the migration list */
  const idx = src["worker/src/index.ts"] ?? readFileSync(join(root, "worker/src/index.ts"), "utf8");
  const probe = /\["0179-0180[^"]*", `([^`]+)`\]/.exec(idx)?.[1];
  ok(!!probe, "System health has a probe for 0179-0180");
  try { prod.prepare(probe ?? "SELECT nope FROM web_orders").all(); ok(true, "the probe reads both columns on the repaired database"); } catch (e) { ok(false, "the probe reads both columns on the repaired database", String(e)); }
  ok(COLS.every((c) => (probe ?? "").includes(c)), "the probe names both columns");
  ok(/LATEST_MIGRATION = "0180_web_orders_refund_flag"/.test(idx), "LATEST_MIGRATION is 0180");
  ok(NEW.every((f) => idx.includes(`"${f.replace(".sql", "")}"`)), "both migrations are in the expected list");

  /* a fresh database already has the columns */
  const fresh = new DatabaseSync(":memory:");
  for (const f of files.filter((f) => f < "0179")) applyFile(fresh, readFileSync(join(MIG, f), "utf8"));
  let freshFails = 0;
  for (const f of NEW) { try { fresh.exec(statements(readFileSync(join(MIG, f), "utf8"))[0]); } catch { freshFails++; } }
  ok(freshFails === 2, "on a fresh database the ALTERs fail (0081 made the columns) - mark 0179 and 0180 applied there");
  return out;
}

const report = (rows) => rows.filter(([p]) => !p).map(([, m]) => m);
const base = check({});
const bad = report(base);
for (const m of bad) console.log(`FAIL ${m}`);
if (bad.length) { console.log(`elfia-columns: ${bad.length} of ${base.length} failed`); process.exit(1); }

if (!process.env.NOMUT) {
  const read = (p) => readFileSync(join(root, p), "utf8");
  const MUTS = [
    ["0179 adds the wrong column", { "worker/migrations/0179_web_orders_booked_cents.sql": read("worker/migrations/0179_web_orders_booked_cents.sql").replace("booked_cents INTEGER", "booked_amount INTEGER") }],
    ["0180 has two statements", { "worker/migrations/0180_web_orders_refund_flag.sql": read("worker/migrations/0180_web_orders_refund_flag.sql") + "\nALTER TABLE web_orders ADD COLUMN extra TEXT;\n" }],
    ["a migration comment carries a quote", { "worker/migrations/0179_web_orders_booked_cents.sql": "-- the order's money\n" + read("worker/migrations/0179_web_orders_booked_cents.sql") }],
    ["the pre-flight pairs the wrong column", { "scripts/migration-preflight.mjs": read("scripts/migration-preflight.mjs").replace('["0180_web_orders_refund_flag", "refund_flagged_at"]', '["0180_web_orders_refund_flag", "booked_cents"]') }],
    ["the probe drops a column", { "worker/src/index.ts": read("worker/src/index.ts").replace("SELECT booked_cents, refund_flagged_at FROM web_orders LIMIT 0", "SELECT booked_cents FROM web_orders LIMIT 0") }],
    ["LATEST_MIGRATION stays at 0178", { "worker/src/index.ts": read("worker/src/index.ts").replace('LATEST_MIGRATION = "0180_web_orders_refund_flag"', 'LATEST_MIGRATION = "0178_passkeys"') }],
  ];
  let caught = 0;
  for (const [name, src] of MUTS) { if (report(check(src)).length) caught++; else console.log(`MUTATION NOT CAUGHT: ${name}`); }
  if (caught !== MUTS.length) { console.log(`elfia-columns: ${MUTS.length - caught} mutation(s) survived`); process.exit(1); }
  console.log(`elfia-columns: ${base.length} checks passed (${caught} mutations caught) - production gains the two ELFIA booking columns, one ALTER each, checked before the apply`);
} else console.log(`elfia-columns: ${base.length} checks passed`);
