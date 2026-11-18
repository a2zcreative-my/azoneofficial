#!/usr/bin/env node
/* scripts/restore-test.mjs - v1.375.0 (the CEO, 18-11-2026: "Last restore test - Not recorded";
 * his answer: "Yes, build it"). Run on the office PC:   PUSH.bat restore-test   (monthly)
 *
 * PROVES THE DATABASE CAN BE BROUGHT BACK, without touching the live one:
 *
 *   1. a fresh FULL export of production (wrangler d1 export - a read);
 *   2. a NEW, TEMPORARY D1 database (a2z-restore-test-<stamp>) is created;
 *   3. the export is loaded into it (the documented restore path, docs/RESTORE.md section 3);
 *   4. every table is counted in the temporary database and compared with the rows the
 *      export holds for it - any difference fails the test;
 *   5. the temporary database is DELETED (always, also after a failure);
 *   6. the result is written to production as ONE status row
 *      (system_meta 'restore_test_last'), which System health shows on "Last restore test".
 *
 * The ONLY write to production is that status row. The live database is never loaded,
 * changed or deleted: every load and delete names the temporary database, and the script
 * refuses to run if that name could ever be the production one. The export holds every
 * record (bank details included), so it is kept in backups\ (gitignored) only until the
 * test ends, then deleted. Everything is logged to backups\restore-test.log.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, workerDir, wrangler, redact } from "./wrangler-exec.mjs";

const PROD = "azoneofficial";
const backups = join(repoRoot, "backups");
const tomlPath = join(workerDir, "wrangler.toml");
const started = Date.now();
const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "");
const TEMP = `a2z-restore-test-${stamp}`;
const exportFile = join(backups, `restore-test-src-${stamp}.sql`);
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

mkdirSync(backups, { recursive: true });
const log = (line) => appendFileSync(join(backups, "restore-test.log"), `${new Date().toISOString()} ${version} ${line}\n`);
const say = (line) => { console.log(line); log(line.trim()); };
const tail = (r) => redact(`${r.stderr ?? ""}\n${r.stdout ?? ""}`).replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).filter((l) => l.trim()).slice(-4).join(" | ");

/* the temporary name can never be the production database, by construction and by check */
if (TEMP === PROD || !/^a2z-restore-test-\d{14}$/.test(TEMP)) { console.error("refusing: the temporary database name is not a restore-test name"); process.exit(2); }
const tomlBefore = readFileSync(tomlPath, "utf8");

/** wrangler d1 execute --json -> the rows of the first result */
function query(db, sql) {
  if (db === PROD && !/^\s*(SELECT|INSERT INTO system_meta)/i.test(sql)) throw new Error("refusing a non-status write to production");
  const r = wrangler(["d1", "execute", db, "--remote", "--json", "--yes", "--command", sql]);
  if (r.status !== 0) throw new Error(`query on ${db} failed: ${tail(r)}`);
  const text = String(r.stdout ?? "");
  const json = JSON.parse(text.slice(text.indexOf("[")));
  return json?.[0]?.results ?? [];
}

let created = false, result = null;
try {
  console.log("");
  console.log("  RESTORE TEST");
  console.log("  ============");
  console.log("  The live database is only READ (one status row is written at the end).");
  console.log(`  Temporary database: ${TEMP} (deleted when the test ends)`);
  console.log("");

  /* 1. a fresh full export of production */
  say("  [1/5] Exporting the live database (a read)...");
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    rmSync(exportFile, { force: true });
    const r = wrangler(["d1", "export", PROD, "--remote", `--output=${exportFile}`]);
    ok = r.status === 0 && existsSync(exportFile) && statSync(exportFile).size > 0;
    if (!ok) { log(`export attempt ${attempt} failed: ${tail(r)}`); if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 15000); }
  }
  if (!ok) throw new Error("the live database could not be exported (3 attempts) - check the internet connection");
  const sql = readFileSync(exportFile, "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  /* the rows the export holds, per table (wrangler writes one INSERT per row, one per line) */
  const expected = {};
  for (const line of sql.split("\n")) {
    const m = /^INSERT INTO "?([A-Za-z0-9_]+)"?[\s(]/.exec(line);
    if (m) expected[m[1]] = (expected[m[1]] ?? 0) + 1;
  }
  const tablesInExport = [...sql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?["`]?([A-Za-z0-9_]+)["`]?/gm)].map((m) => m[1]).filter((t) => !t.startsWith("_cf_") && !t.startsWith("sqlite_"));
  say(`        ${(sql.length / 1048576).toFixed(1)} MB, ${tablesInExport.length} tables, ${Object.values(expected).reduce((a, b) => a + b, 0).toLocaleString("en-MY")} rows, SHA-256 ${sha.slice(0, 16)}...`);

  /* 2. a new, empty, temporary database */
  say(`  [2/5] Creating the temporary database ${TEMP}...`);
  const c = wrangler(["d1", "create", TEMP]);
  if (c.status !== 0) throw new Error(`the temporary database could not be created: ${tail(c)}`);
  created = true;
  /* wrangler must not have bound it into the portal's config */
  if (readFileSync(tomlPath, "utf8") !== tomlBefore) { writeFileSync(tomlPath, tomlBefore); log("wrangler.toml was changed by d1 create - restored"); }

  /* 3. load the export into it (the documented restore path) */
  say("  [3/5] Restoring the export into the temporary database (a few minutes)...");
  const load = wrangler(["d1", "execute", TEMP, "--remote", "--yes", `--file=${exportFile}`]);
  if (load.status !== 0) throw new Error(`the restore into the temporary database failed: ${tail(load)}`);

  /* 4. count every table there and compare with the export */
  say("  [4/5] Counting every table in the restored copy...");
  const names = query(TEMP, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").map((r) => r.name);
  const missing = tablesInExport.filter((t) => !names.includes(t));
  const counts = {};
  for (let i = 0; i < names.length; i += 40) {
    const part = names.slice(i, i + 40);
    for (const r of query(TEMP, part.map((n) => `SELECT '${n}' AS t, COUNT(*) AS n FROM "${n}"`).join(" UNION ALL "))) counts[r.t] = Number(r.n);
  }
  const diffs = names.filter((t) => (counts[t] ?? 0) !== (expected[t] ?? 0)).map((t) => `${t} ${counts[t] ?? 0}/${expected[t] ?? 0}`);
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const d of diffs.slice(0, 20)) say(`        row count differs: ${d}`);
  for (const t of missing) say(`        table missing after the restore: ${t}`);
  const passed = diffs.length === 0 && missing.length === 0 && names.length > 0;
  result = { ok: passed, source: `live export ${stamp} (sha256 ${sha.slice(0, 12)})`, tables: names.length, rows, mismatched: diffs.length + missing.length,
    reason: passed ? null : `${diffs.length} table(s) with a different row count, ${missing.length} missing`, seconds: 0, by: "PUSH.bat restore-test" };
  say(`        ${names.length} tables, ${rows.toLocaleString("en-MY")} rows - ${passed ? "every table matches" : "MISMATCH"}`);
} catch (e) {
  result = { ok: false, source: `live export ${stamp}`, tables: 0, rows: 0, mismatched: 0, reason: String(e?.message ?? e).slice(0, 200), seconds: 0, by: "PUSH.bat restore-test" };
  say(`  [X] ${result.reason}`);
} finally {
  /* 5. the temporary database is ALWAYS deleted; the export file too */
  if (created) {
    say(`  [5/5] Deleting the temporary database ${TEMP}...`);
    const d = wrangler(["d1", "delete", TEMP, "--skip-confirmation"]);
    if (d.status !== 0) {
      const d2 = wrangler(["d1", "delete", TEMP, "-y"]);
      if (d2.status !== 0) { say(`  [!] Could not delete ${TEMP} - delete it in Cloudflare > Storage & databases > D1: ${tail(d2)}`); if (result) result.reason = `${result.reason ?? "passed"}; temporary database ${TEMP} still to delete by hand`; }
    }
  }
  rmSync(exportFile, { force: true });
  if (readFileSync(tomlPath, "utf8") !== tomlBefore) { writeFileSync(tomlPath, tomlBefore); log("wrangler.toml restored"); }
}

/* 6. the ONE write to production: the status row System health shows */
result.seconds = Math.round((Date.now() - started) / 1000);
const record = { at: new Date().toISOString(), ...result };
try {
  const v = JSON.stringify(record).replace(/'/g, "''");
  query(PROD, `INSERT INTO system_meta (key, value) VALUES ('restore_test_last', '${v}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  say(`  Recorded on System health: ${record.ok ? "PASSED" : "FAILED"} (${record.seconds}s).`);
} catch (e) {
  say(`  [!] The result could not be recorded on System health: ${String(e?.message ?? e).slice(0, 160)}`);
}
console.log("");
console.log(record.ok ? "  [OK] RESTORE TEST PASSED - the backup can be brought back." : "  [X] RESTORE TEST FAILED - send backups\\restore-test.log to Claude.");
process.exit(record.ok ? 0 : 1);
