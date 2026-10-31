#!/usr/bin/env node
/* scripts/restore-drill.mjs - v1.244.0 (go-live Release D, plan section 5).
 *
 * THE RESTORE DRILL. Takes a backup (the one-file download, a folder of
 * pages + manifest.json, or a pre-1.244 single file), VERIFIES it, rebuilds
 * the whole database in a NEW local SQLite file, and proves the rebuild:
 *
 *   - every table's row count equals the manifest;
 *   - PRAGMA integrity_check is ok and foreign_key_check is reported;
 *   - 12 business figures computed by SQL on the rebuilt database equal the
 *     same figures computed from the backup's own rows;
 *   - with --media-index and --media-dir: every downloaded media file's
 *     SHA-256 equals the one recorded when it was copied (sample of 20 by
 *     default).
 *
 * It never touches production. With --sql it ALSO writes the INSERT script a
 * fresh, empty D1 database can be loaded from (docs/RESTORE.md, section 3) -
 * it refuses to name the production database anywhere.
 *
 *   node scripts/restore-drill.mjs <backup> [--db drill.sqlite] [--sql restore.sql]
 *        [--media-index index.json --media-dir folder [--sample 20]]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { loadBackup } from "./verify-backup.mjs";

const q = (name) => { if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unsupported name ${name}`); return `"${name}"`; };
const lit = (v) => v === null || v === undefined ? "NULL"
  : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL")
  : typeof v === "boolean" ? (v ? "1" : "0")
  : `'${String(typeof v === "object" ? JSON.stringify(v) : v).replace(/'/g, "''")}'`;

/** The 12 figures: [label, table, "count" | column to sum]. */
export const FIGURES = [
  ["accounts", "users", "count"],
  ["customers", "customers", "count"],
  ["sales documents", "sales_documents", "count"],
  ["sales documents total (cents)", "sales_documents", "total_cents"],
  ["invoice part payments (cents)", "invoice_payments", "amount_cents"],
  ["stock on hand (units)", "inventory_items", "stock"],
  ["attendance punches", "attendance_records", "count"],
  ["payroll net (cents)", "payroll_entries", "net_cents"],
  ["commission ledger (cents)", "commission_ledger", "amount_cents"],
  ["cash book (cents)", "cashflow_entries", "amount_cents"],
  ["leave requests", "leave_requests", "count"],
  ["audit trail rows", "audit_log", "count"],
];

export function figuresFromRows(tables) {
  return FIGURES.map(([label, t, op]) => {
    const rows = tables[t];
    if (!rows) return [label, null];
    return [label, op === "count" ? rows.length : rows.reduce((s, r) => s + (Number(r[op]) || 0), 0)];
  });
}
export function figuresFromDb(db) {
  return FIGURES.map(([label, t, op]) => {
    try {
      const sql = op === "count" ? `SELECT COUNT(*) AS v FROM ${q(t)}` : `SELECT COALESCE(SUM(${q(op)}), 0) AS v FROM ${q(t)}`;
      return [label, Number(db.prepare(sql).get().v)];
    } catch { return [label, null]; }
  });
}

/** Rebuild into `db` (an open node:sqlite database). */
export function restoreInto(db, backup) {
  const schema = backup.metadata.schema;
  db.exec("PRAGMA foreign_keys = OFF; BEGIN");
  for (const s of schema.filter((x) => x.type === "table")) db.exec(s.sql);
  const insertRows = (name, rows) => {
    for (const row of rows) {
      const keys = Object.keys(row);
      if (!keys.length) continue;
      db.prepare(`INSERT INTO ${q(name)} (${keys.map(q).join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
        .run(...keys.map((k) => (row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k])));
    }
  };
  for (const [name, rows] of Object.entries(backup.tables)) insertRows(name, rows);
  if (!schema.some((s) => s.type === "table" && s.name === "d1_migrations")) {
    db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
  }
  insertRows("d1_migrations", backup.metadata.migrations);
  if (backup.metadata.sequences.length) {
    db.exec("DELETE FROM sqlite_sequence");
    insertRows("sqlite_sequence", backup.metadata.sequences);
  }
  /* indexes, views and triggers after the data, so no business trigger fires on the load */
  for (const type of ["index", "view", "trigger"]) for (const s of schema.filter((x) => x.type === type)) db.exec(s.sql);
  db.exec("COMMIT");
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const fk = db.prepare("PRAGMA foreign_key_check").all().length;
  db.exec("PRAGMA foreign_keys = ON");
  return { integrity, foreign_key_violations: fk };
}

/** The same rebuild as one SQL script, for a FRESH D1 database. */
export function restoreSql(backup) {
  const out = ["-- restore script written by scripts/restore-drill.mjs", "-- load ONLY into a NEW, EMPTY database (docs/RESTORE.md section 3)", "PRAGMA defer_foreign_keys = true;"];
  const schema = backup.metadata.schema;
  for (const s of schema.filter((x) => x.type === "table")) out.push(`${s.sql};`);
  for (const [name, rows] of Object.entries(backup.tables)) {
    for (const row of rows) {
      const keys = Object.keys(row);
      if (keys.length) out.push(`INSERT INTO ${q(name)} (${keys.map(q).join(",")}) VALUES (${keys.map((k) => lit(row[k])).join(",")});`);
    }
  }
  if (!schema.some((x) => x.type === "table" && x.name === "d1_migrations")) out.push("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);");
  for (const m of backup.metadata.migrations) {
    const keys = Object.keys(m);
    if (keys.length) out.push(`INSERT INTO "d1_migrations" (${keys.map(q).join(",")}) VALUES (${keys.map((k) => lit(m[k])).join(",")});`);
  }
  /* the AUTOINCREMENT counters; if the loader refuses these lines, delete
     them - each counter then continues from the highest id present */
  for (const s of backup.metadata.sequences) out.push(`UPDATE sqlite_sequence SET seq = ${lit(s.seq)} WHERE name = ${lit(s.name)};`, `INSERT INTO sqlite_sequence (name, seq) SELECT ${lit(s.name)}, ${lit(s.seq)} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ${lit(s.name)});`);
  for (const type of ["index", "view", "trigger"]) for (const s of schema.filter((x) => x.type === type)) out.push(`${s.sql};`);
  return out.join("\n") + "\n";
}

export function checkMedia(indexPath, dir, sample = 20) {
  const index = JSON.parse(readFileSync(indexPath, "utf8")).objects ?? [];
  const files = new Set(readdirSync(dir, { recursive: true }).map((f) => String(f).replace(/\\/g, "/")));
  const pick = index.filter((o) => o.sha256 && files.has(o.key)).slice(0, sample);
  const bad = pick.filter((o) => createHash("sha256").update(readFileSync(join(dir, o.key))).digest("hex") !== o.sha256).map((o) => o.key);
  return { checked: pick.length, bad };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const src = args[0];
  if (!src || src.startsWith("--")) { console.error("usage: node scripts/restore-drill.mjs <backup> [--db file.sqlite] [--sql restore.sql] [--media-index index.json --media-dir folder]"); process.exit(2); }
  let tmp = null;
  try {
    const backup = loadBackup(src);
    console.log(`verified: ${backup.summary.tables} tables, ${backup.summary.rows} rows (format ${backup.summary.format})`);
    const dbPath = opt("--db") ?? join((tmp = mkdtempSync(join(tmpdir(), "restore-drill-"))), "drill.sqlite");
    if (existsSync(dbPath)) throw new Error(`${dbPath} exists - the drill restores into a NEW file only`);
    const db = new DatabaseSync(dbPath);
    const r = restoreInto(db, backup);
    let mismatched = 0;
    for (const [name, rows] of Object.entries(backup.tables)) {
      const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`).get().n);
      if (n !== rows.length) { mismatched++; console.log(`  row count differs: ${name} ${n} vs ${rows.length}`); }
    }
    const a = figuresFromRows(backup.tables), b = figuresFromDb(db);
    const figs = a.map(([label, v], i) => ({ label, backup: v, restored: b[i][1], equal: v === b[i][1] }));
    for (const f of figs) console.log(`  ${f.equal ? "=" : "X"} ${f.label}: ${f.backup} / ${f.restored}`);
    let media = null;
    if (opt("--media-index") && opt("--media-dir")) media = checkMedia(opt("--media-index"), opt("--media-dir"), Number(opt("--sample") ?? 20));
    if (opt("--sql")) {
      if (/azoneofficial(?![-_])/i.test(opt("--sql"))) throw new Error("refusing a file name that names the production database");
      writeFileSync(opt("--sql"), restoreSql(backup));
      console.log(`  restore script written: ${opt("--sql")}`);
    }
    db.close();
    const ok = r.integrity === "ok" && mismatched === 0 && figs.every((f) => f.equal) && (!media || media.bad.length === 0);
    console.log(JSON.stringify({ drill: ok ? "passed" : "FAILED", integrity: r.integrity, foreign_key_violations: r.foreign_key_violations, tables_mismatched: mismatched, figures_equal: figs.filter((f) => f.equal).length, media }));
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error(`Restore drill failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}
