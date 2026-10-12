/** Synthetic restore drill: two in-memory SQLite databases, no remote access. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { verifyBackup } from "../scripts/verify-backup.mjs";

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
  let stored;
  const result = await runBackup({ DB: db, MEDIA: {
    async put(_key, bytes) { stored = new Uint8Array(bytes); },
    async list() { return { objects: [] }; },
    async delete() { throw new Error("Unexpected deletion"); },
  } }, null);
  assert.equal(result.ok, true, JSON.stringify(result));
  const backup = JSON.parse(gunzipSync(stored).toString());
  assert.equal(verifyBackup(backup).rows, 3);
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

  for (const change of [
    b => b.tables.invoices[0].amount_cents++,
    b => b.tables.invoices.pop(),
    b => { delete b.tables.clients; },
    b => b.manifest.metadata.schema[0].sql += " -- changed",
    b => b.manifest.metadata.migrations[0].name = "wrong.sql",
    b => b.manifest.metadata.sequences[0].seq++,
    b => b.manifest.row_count++,
  ]) {
    const damaged = structuredClone(backup); change(damaged);
    assert.throws(() => verifyBackup(damaged));
  }
  assert.throws(() => verifyBackup({ tables: backup.tables }), /legacy/);
  const filename = join(dir, "synthetic.json.gz");
  writeFileSync(filename, stored);
  const cli = spawnSync(process.execPath, [join(root, "scripts/verify-backup.mjs"), filename], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).verified, true);
  writeFileSync(filename, "not gzip");
  assert.notEqual(spawnSync(process.execPath, [join(root, "scripts/verify-backup.mjs"), filename]).status, 0);
  console.log("backup-restore: synthetic SQLite restore, totals, constraints, deleted-ID sequence, metadata, corruption and verifier CLI passed");
} finally {
  source.close(); restored.close();
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  rmSync(dir, { recursive: true, force: true });
}
