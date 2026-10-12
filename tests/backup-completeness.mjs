/** Executes the shipped backup function against isolated D1/R2 doubles.
 * No Cloudflare account, network request or production data is used.
 */
import assert from "node:assert/strict";
import { verifyBackup } from "../scripts/verify-backup.mjs";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireWorker = createRequire(join(root, "worker", "package.json"));
const { buildSync } = requireWorker("esbuild");
const dir = mkdtempSync(join(tmpdir(), "backup-completeness-"));
const output = join(dir, "backup.mjs");

function fixture(counts, failRead = false, metadataFailure = false) {
  const writes = [], deletes = [], errors = [], audits = [];
  let lists = 0;
  const env = {
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async all() {
            if (metadataFailure && sql.includes("SELECT type, name")) throw new Error("isolated metadata failure");
            if (sql.includes("SELECT type, name")) return { results: Object.keys(counts).map(name => ({ type: "table", name, tbl_name: name, sql: `CREATE TABLE ${name} (id INTEGER, value TEXT)` })) };
            if (sql.includes("FROM d1_migrations")) return { results: [] };
            if (sql.includes("sqlite_master")) return { results: Object.keys(counts).map(name => ({ name })) };
            const match = sql.match(/SELECT \* FROM "([^"]+)" LIMIT (\d+)/);
            assert.ok(match, `Unexpected all query: ${sql}`);
            if (failRead) throw new Error("isolated read failure");
            return { results: Array.from({ length: Math.min(counts[match[1]], Number(match[2])) }, (_, i) => ({ id: i + 1, value: `row-${i + 1}` })) };
          },
          async first() { assert.ok(sql.includes("error_log") || sql.includes("sqlite_sequence")); return null; },
          async run() {
            if (sql.includes("INSERT INTO error_log")) errors.push(args);
            else if (sql.includes("INSERT INTO audit_log")) audits.push(args);
            else assert.ok(sql.includes("DELETE FROM error_log"), `Unexpected run query: ${sql}`);
            return { success: true };
          },
        };
      },
    },
    MEDIA: {
      async put(key, body) { writes.push({ key, body }); },
      async list() { lists++; return { objects: Array.from({ length: 31 }, (_, i) => ({ key: `backups/db-${String(i).padStart(3, "0")}.json.gz` })) }; },
      async delete(key) { deletes.push(key); },
    },
  };
  return { env, writes, deletes, errors, audits, get lists() { return lists; } };
}

try {
  buildSync({ entryPoints: [join(root, "worker", "src", "index.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { runBackup } = await import(pathToFileURL(output).href);
  for (const count of [0, 1, 50000]) {
    const f = fixture({ records: count });
    const result = await runBackup(f.env, null);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.rows, count);
    assert.equal(f.writes.length, 1);
    const saved = JSON.parse(gunzipSync(new Uint8Array(f.writes[0].body)).toString());
    assert.equal(saved.tables.records.length, count);
    assert.equal(verifyBackup(saved).rows, count);
    if (count) assert.equal(saved.tables.records.at(-1).id, count);
    assert.equal(f.audits.length, 1);
    assert.equal(f.errors.length, 0);
    assert.equal(f.deletes.length, 1, "successful export retains the existing retention policy");
  }
  for (const count of [50001, 70000]) {
    const f = fixture({ earlier: 2, oversized: count });
    const result = await runBackup(f.env, 7);
    assert.equal(result.ok, false, "oversized tables must not report backup success");
    assert.match(result.message, /oversized.*50000/);
    assert.equal(f.writes.length, 0, "no partial backup may replace today's copy");
    assert.equal(f.lists, 0, "retention must not run after rejection");
    assert.equal(f.deletes.length, 0);
    assert.equal(f.audits.length, 0, "no success audit on rejection");
    assert.equal(f.errors.length, 1, "failure remains visible in the existing error log");
    assert.equal(f.errors[0][0], "backup");
  }
  const failed = fixture({ records: 1 }, true);
  assert.equal((await runBackup(failed.env, null)).ok, false);
  assert.equal(failed.writes.length, 0);
  assert.equal(failed.deletes.length, 0);
  assert.equal(failed.errors.length, 1);
  const metadataFailed = fixture({ records: 1 }, false, true);
  assert.equal((await runBackup(metadataFailed.env, null)).ok, false);
  assert.equal(metadataFailed.writes.length, 0, "metadata failure must not publish an unverifiable backup");
  assert.equal(metadataFailed.lists, 0);
  assert.equal(metadataFailed.errors.length, 1);
  const unsupported = fixture({ "unsupported-name": 1 });
  assert.equal((await runBackup(unsupported.env, null)).ok, false, "unsupported names must fail instead of silently skipping a table");
  assert.equal(unsupported.writes.length, 0);
  console.log("backup-completeness: passed empty, small, exact-limit, over-limit, later-table overflow and read-failure scenarios");
} finally {
  // Only the concrete directory created by mkdtemp above is removed.
  assert.equal(resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")), true);
  rmSync(dir, { recursive: true, force: true });
}
