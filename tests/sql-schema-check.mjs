/* v1.25.2 — SQL schema check.
 *
 * Three production 500s in two days were the same bug: a query naming a
 * column the database does not have (`c.name` in /clients/summary,
 * `suspended` in /hosts). SQLite only complains when the statement RUNS, so
 * both shipped green and failed silently on live for weeks.
 *
 * This builds the real cumulative schema from worker/migrations/*.sql, pulls
 * every SQL literal out of worker/src/*.ts, and asks SQLite to PREPARE each
 * one. Preparing resolves table and column names without touching data, so a
 * typo is caught here instead of in the CEO's error log.
 *
 * Run:  node tests/sql-schema-check.mjs      (exit 1 = something is wrong)
 */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIG = "worker/migrations";
const SRC = ["worker/src/index.ts", "worker/src/staff.ts", "worker/src/erp.ts", "worker/src/m2e.ts", "worker/src/webpush.ts", "worker/src/bridge.ts"]; // v1.36.0: + the ELFIA bridge module

/* ---- 1. the real schema, migration by migration ---- */
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=OFF;");
// Cloudflare creates this one itself on every D1 database.
db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);");
let applied = 0;
for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(`${MIG}/${f}`, "utf8");
  /* Whole file first — sqlite handles multi-statement scripts and, crucially,
     triggers whose bodies contain their own semicolons. Only if the file as a
     whole fails (an ALTER that a later migration already covers, a data seed
     referencing runtime rows) do we retry statement by statement, so one bad
     line cannot silently drop the rest of the file's tables. */
  try { db.exec(sql); applied++; continue; } catch { /* fall through */ }
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/)) {
    const t = stmt.trim();
    if (!t || t.startsWith("--")) continue;
    try { db.exec(t + ";"); applied++; } catch { /* already applied / seed */ }
  }
}
const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n;
if (tables < 40) { console.error(`Schema build failed — only ${tables} tables. Aborting rather than passing vacuously.`); process.exit(2); }

/* ---- 2. every SQL literal the worker prepares ---- */
const checked = [], skipped = [], failures = [];
for (const file of SRC) {
  let src; try { src = readFileSync(file, "utf8"); } catch { continue; }
  const re = /\.prepare\(\s*`([\s\S]*?)`\s*,?\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const raw = m[1];
    const line = src.slice(0, m.index).split("\n").length;
    if (raw.includes("${")) { skipped.push({ file, line, why: "dynamic" }); continue; }
    const sql = raw.replace(/\?\d+/g, "NULL").replace(/\s+/g, " ").trim();
    if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH)/i.test(sql)) { skipped.push({ file, line, why: "non-DML" }); continue; }
    checked.push({ file, line, sql });
    try { db.prepare(sql); }
    catch (e) {
      const msg = String(e.message ?? e);
      // only schema mistakes; ignore parser quirks from placeholder swapping
      if (/no such (column|table)|has no column/i.test(msg)) failures.push({ file, line, sql, err: msg });
    }
  }
}

console.log(`SQL schema check — ${tables} tables built from ${applied} migration chunks`);
console.log(`${checked.length} queries verified, ${skipped.length} skipped (dynamic or non-DML)`);
if (failures.length === 0) { console.log("PASS — every checked query matches the migrated schema"); process.exit(0); }
console.log(`\nFAIL — ${failures.length} quer${failures.length === 1 ? "y" : "ies"} name something the database does not have:\n`);
for (const f of failures) console.log(`  ${f.file}:${f.line}\n    ${f.err}\n    ${f.sql.slice(0, 140)}…\n`);
process.exit(1);
