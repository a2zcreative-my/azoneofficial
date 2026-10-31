/** Synthetic restore drill: two in-memory SQLite databases, no remote access.
 * v1.244.0 (go-live Release D, F7) - the backup is the PAGED export: the
 * pages and manifest the worker writes are read back, verified (page, chunk,
 * table and metadata SHA-256) and restored; the same corruption cases fail;
 * the one-file download (manifest line + pages) verifies through the CLI. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { verifyBackup, verifyPaged } from "../scripts/verify-backup.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { buildSync } = createRequire(join(root, "worker", "package.json"))("esbuild");
const dir = mkdtempSync(join(tmpdir(), "backup-restore-"));
const source = new DatabaseSync(":memory:"), restored = new DatabaseSync(":memory:");
const plain = value => JSON.parse(JSON.stringify(value));
const quoted = name => { assert.match(name, /^[A-Za-z0-9_]+$/); return `"${name}"`; };

try {
  source.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, applied_at TEXT);
    INSERT INTO d1_migrations VALUES (1, 'synthetic.sql', '2026-10-12');
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id), amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), note TEXT, attachment_key TEXT);
    CREATE INDEX invoices_client ON invoices(client_id);
    CREATE VIEW invoice_totals AS SELECT client_id, SUM(amount_cents) AS total FROM invoices GROUP BY client_id;
    CREATE TRIGGER invoice_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'immutable invoice'); END;
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, entity TEXT, entity_id TEXT, detail TEXT);
    CREATE TABLE empty_register (id INTEGER PRIMARY KEY);
    INSERT INTO clients VALUES (1, 'Synthetic Customer');
    INSERT INTO clients VALUES (90, 'Deleted ID');
    DELETE FROM clients WHERE id = 90;
    INSERT INTO invoices VALUES (7, 1, 12999, 'Unicode: café / Melayu; quote '' and newline', 'synthetic/receipt.png');
    INSERT INTO invoices VALUES (8, 1, 1, NULL, NULL);
  `);
  const db = {
    prepare(sql) {
      let values = [];
      const positions = [...sql.matchAll(/\?(\d+)/g)].map(m => Number(m[1]) - 1);
      const statement = source.prepare(sql.replace(/\?\d+/g, "?"));
      const args = () => positions.length ? positions.map(i => values[i]) : values;
      return {
        bind(...args) { values = args; return this; },
        async all() { return { results: plain(statement.all(...args())) }; },
        async first() { return plain(statement.get(...args()) ?? null); },
        async run() { statement.run(...args()); return { success: true }; },
      };
    },
  };
  const bundle = join(dir, "worker.mjs");
  buildSync({ entryPoints: [join(root, "worker/src/index.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { runBackup } = await import(pathToFileURL(bundle).href);
  const stored = new Map();
  const result = await runBackup({ DB: db, MEDIA: {
    async put(key, bytes) { stored.set(key, typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(new Uint8Array(bytes))); },
    async head(key) { return stored.has(key) ? { key, size: stored.get(key).length, uploaded: new Date(), customMetadata: {} } : null; },
    async list() { return { objects: [], delimitedPrefixes: [], truncated: false }; },
    async delete() { throw new Error("Unexpected deletion"); },
  } }, null);
  assert.equal(result.ok, true, JSON.stringify(result));
  const manifestKey = [...stored.keys()].find((k) => k.endsWith("/manifest.json"));
  const manifest = JSON.parse(stored.get(manifestKey).toString());
  const pageTexts = manifest.pages.map((p) => gunzipSync(stored.get(p.key)).toString());
  const verified = verifyPaged(manifest, pageTexts);
  const backup = { manifest, tables: verified.tables };
  assert.equal(verified.summary.rows, 3);
  assert.equal(backup.manifest.metadata.migrations[0].name, "synthetic.sql");
  assert.equal(backup.manifest.metadata.sequences.find(s => s.name === "clients").seq, 90);

  // SQL comes only from the schema created above, never an external backup.
  const schema = backup.manifest.metadata.schema;
  restored.exec("PRAGMA foreign_keys = OFF; BEGIN");
  for (const s of schema.filter(s => s.type === "table")) restored.exec(s.sql);
  const insertRows = (name, rows) => {
    for (const row of rows) {
      const keys = Object.keys(row);
      restored.prepare(`INSERT INTO ${quoted(name)} (${keys.map(quoted).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map(k => row[k]));
    }
  };
  for (const [name, rows] of Object.entries(backup.tables)) insertRows(name, rows);
  insertRows("d1_migrations", backup.manifest.metadata.migrations);
  restored.exec("DELETE FROM sqlite_sequence");
  insertRows("sqlite_sequence", backup.manifest.metadata.sequences);
  // Indexes and triggers follow data loading so restore does not fire business triggers.
  for (const type of ["index", "view", "trigger"]) for (const s of schema.filter(s => s.type === type)) restored.exec(s.sql);
  assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  restored.exec("COMMIT; PRAGMA foreign_keys = ON");
  for (const [name, rows] of Object.entries(backup.tables)) assert.deepEqual(plain(restored.prepare(`SELECT * FROM ${quoted(name)}`).all()), rows);
  assert.equal(restored.prepare("SELECT total FROM invoice_totals").get().total, 13000);
  assert.equal(restored.prepare("INSERT INTO clients(name) VALUES ('After restore')").run().lastInsertRowid, 91);
  assert.throws(() => restored.exec("DELETE FROM invoices WHERE id=7"), /immutable invoice/);
  assert.throws(() => restored.exec("INSERT INTO invoices(client_id,amount_cents) VALUES(999,1)"), /FOREIGN KEY/);
  assert.throws(() => restored.exec("INSERT INTO invoices(client_id,amount_cents) VALUES(1,-1)"), /CHECK/);

  const damage = (fn) => { const m = structuredClone(manifest), p = [...pageTexts]; fn(m, p); return () => verifyPaged(m, p); };
  for (const change of [
    (m, p) => { p[0] = p[0].replace('"amount_cents":12999', '"amount_cents":13000'); },
    (m, p) => { const l = p[0].split("\n"); l.splice(l.length - 2, 1); p[0] = l.join("\n"); },
    (m) => { delete m.tables.clients; },
    (m) => { m.metadata.schema[0].sql += " -- changed"; },
    (m) => { m.metadata.migrations[0].name = "wrong.sql"; },
    (m) => { m.metadata.sequences[0].seq++; },
    (m) => { m.row_count++; },
    (m) => { m.tables.invoices.sha256 = "0".repeat(64); },
  ]) assert.throws(damage(change));
  assert.throws(() => verifyBackup({ tables: backup.tables }), /legacy/);
  /* the one-file download: the manifest line, then every page as stored */
  const filename = join(dir, "synthetic.ndjson.gz");
  writeFileSync(filename, Buffer.concat([gzipSync(JSON.stringify({ $manifest: manifest }) + "\n"), ...manifest.pages.map((p) => stored.get(p.key))]));
  const cli = spawnSync(process.execPath, [join(root, "scripts/verify-backup.mjs"), filename], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).verified, true);
  assert.equal(JSON.parse(cli.stdout).rows, 3);
  writeFileSync(filename, "not gzip");
  assert.notEqual(spawnSync(process.execPath, [join(root, "scripts/verify-backup.mjs"), filename]).status, 0);
  console.log("backup-restore: synthetic SQLite restore from the paged export, totals, constraints, deleted-ID sequence, metadata, corruption and verifier CLI (one-file download) passed");
} finally {
  source.close(); restored.close();
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  rmSync(dir, { recursive: true, force: true });
}
