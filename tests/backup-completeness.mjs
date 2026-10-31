/** Executes the shipped backup function against isolated D1/R2 doubles.
 * No Cloudflare account, network request or production data is used.
 *
 * v1.244.0 (go-live Release D, F7; the owner's decision D-9) - the export is
 * PAGED: a table past 50,000 rows is no longer refused, it is written in
 * pages of 20,000 and verified. What this guard always held stays held: a
 * failed read, a metadata failure or an unsupported table name publishes
 * NOTHING (no manifest, and the run's own pages removed), prunes nothing,
 * writes no success audit and leaves the failure in the error log. Retention
 * (the newest 30 complete backups) runs only after a success.
 */
import assert from "node:assert/strict";
import { verifyPaged } from "../scripts/verify-backup.mjs";
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
const LEGACY = Array.from({ length: 31 }, (_, i) => `backups/db-2026-08-${String(i + 1).padStart(2, "0")}.json.gz`);

function fixture(counts, failRead = false, metadataFailure = false) {
  const store = new Map(LEGACY.map((k) => [k, new Uint8Array([1])]));
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
            const match = sql.match(/SELECT rowid AS "__backup_rowid", \* FROM "([^"]+)" WHERE \(\?1 IS NULL OR rowid > \?1\) ORDER BY rowid LIMIT \?2/);
            assert.ok(match, `Unexpected all query: ${sql}`);
            if (failRead) throw new Error("isolated read failure");
            const after = args[0] ?? 0, limit = Number(args[1]);
            assert.ok(limit > 0 && limit <= 20000, "a page query never asks for more than a page");
            const n = Math.max(0, Math.min(counts[match[1]] - after, limit));
            return { results: Array.from({ length: n }, (_, i) => ({ __backup_rowid: after + i + 1, id: after + i + 1, value: `row-${after + i + 1}` })) };
          },
          async first() { assert.ok(sql.includes("error_log") || sql.includes("sqlite_sequence"), `Unexpected first query: ${sql}`); return null; },
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
      async put(key, body, opts) { const b = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body); writes.push({ key, body: b, opts }); store.set(key, b); },
      async head(key) { return store.has(key) ? { key, size: store.get(key).byteLength, uploaded: new Date(), customMetadata: {} } : null; },
      async get(key) { return store.has(key) ? { key, text: async () => new TextDecoder().decode(store.get(key)) } : null; },
      async list(opts) {
        lists++;
        const keys = [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort();
        const prefixes = new Set(), objects = [];
        for (const k of keys) {
          const rest = k.slice((opts.prefix ?? "").length);
          if (opts.delimiter && rest.includes("/")) prefixes.add((opts.prefix ?? "") + rest.slice(0, rest.indexOf("/") + 1));
          else objects.push({ key: k, size: store.get(k).byteLength, uploaded: new Date() });
        }
        return { objects, delimitedPrefixes: [...prefixes], truncated: false };
      },
      async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) { deletes.push(k); store.delete(k); } },
    },
  };
  return { env, store, writes, deletes, errors, audits, get lists() { return lists; } };
}

try {
  buildSync({ entryPoints: [join(root, "worker", "src", "index.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { runBackup } = await import(pathToFileURL(output).href);
  for (const count of [0, 1, 20000, 50000, 50001, 70000]) {
    const f = fixture({ records: count });
    const result = await runBackup(f.env, null);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.rows, count);
    const pages = Math.ceil(count / 20000);
    assert.equal(result.pages, pages, `${count} rows are ${pages} page(s)`);
    const manifestW = f.writes.find((w) => w.key.endsWith("/manifest.json"));
    assert.ok(manifestW && f.writes.at(-1) === manifestW, "the manifest is written last");
    assert.equal(f.writes.length, pages + 1);
    const manifest = JSON.parse(new TextDecoder().decode(manifestW.body));
    const texts = manifest.pages.map((p) => gunzipSync(f.writes.find((w) => w.key === p.key).body).toString());
    const v = verifyPaged(manifest, texts);
    assert.equal(v.summary.rows, count);
    assert.equal(v.tables.records.length, count);
    if (count) assert.equal(v.tables.records.at(-1).id, count, "the last row is in it - nothing truncated");
    assert.ok(v.tables.records.every((r, i) => r.id === i + 1 && !("__backup_rowid" in r)), "rows in order, without the paging column");
    assert.equal(f.audits.length, 1);
    assert.equal(f.errors.length, 0);
    assert.equal(f.deletes.length, 2, "retention keeps the newest 30 complete backups (31 old + this one = 2 removed)");
    assert.ok(f.deletes.every((k) => LEGACY.slice(0, 2).includes(k)), "the two oldest are the ones removed");
  }
  const two = fixture({ earlier: 2, later: 45000 });
  const r2 = await runBackup(two.env, 7);
  assert.equal(r2.ok, true);
  assert.equal(r2.rows, 45002);
  for (const [name, f] of [
    ["read failure", fixture({ records: 30000 }, true)],
    ["metadata failure", fixture({ records: 30000 }, false, true)],
    ["unsupported name", fixture({ "unsupported-name": 1 })],
  ]) {
    const result = await runBackup(f.env, null);
    assert.equal(result.ok, false, `${name} must not report backup success`);
    assert.ok(!f.writes.some((w) => w.key.endsWith("manifest.json")), `${name}: no manifest - nothing is published`);
    assert.ok(![...f.store.keys()].some((k) => !LEGACY.includes(k)), `${name}: the run's own pages are removed`);
    assert.ok(LEGACY.every((k) => f.store.has(k)), `${name}: every earlier backup stays (retention does not run)`);
    assert.equal(f.audits.length, 0, `${name}: no success audit`);
    assert.equal(f.errors.length, 1, `${name}: the failure is in the error log`);
    assert.equal(f.errors[0][0], "backup");
  }
  console.log("backup-completeness: passed empty, small, one-page, 50,000, past-50,000 and 70,000-row (paged, verified) scenarios, a later big table, retention, and read, metadata and name failures (nothing published, nothing pruned)");
} finally {
  // Only the concrete directory created by mkdtemp above is removed.
  assert.equal(resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")), true);
  rmSync(dir, { recursive: true, force: true });
}
