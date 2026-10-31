#!/usr/bin/env node
/* scripts/restore-rows.mjs - v1.244.0 (go-live Release D).
 *
 * ROW-LEVEL RECOVERY, AS STATEMENTS FOR A PERSON TO READ. Takes a verified
 * backup and the rows to bring back (one table, by id or another column) and
 * WRITES an SQL file. It never connects to anything and never runs the SQL.
 *
 * The default statement is a plain INSERT: if the row still exists the
 * statement fails and nothing is overwritten. `--replace` writes INSERT OR
 * REPLACE instead (the file says so at the top) - for putting back a row
 * whose values were damaged; use it only after reading the file.
 *
 *   node scripts/restore-rows.mjs <backup> --table invoice_payments --ids 41,42 [--key id] [--replace] [--out rows.sql]
 *
 * The owner applies the reviewed file himself (docs/RESTORE.md section 2):
 *   npx wrangler d1 execute azoneofficial --remote --file rows.sql
 * after a pre-change export, with the CEO's written approval, audited by
 * hand in the change note.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadBackup } from "./verify-backup.mjs";

const q = (name) => { if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unsupported name ${name}`); return `"${name}"`; };
const lit = (v) => v === null || v === undefined ? "NULL"
  : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL")
  : typeof v === "boolean" ? (v ? "1" : "0")
  : `'${String(typeof v === "object" ? JSON.stringify(v) : v).replace(/'/g, "''")}'`;

export function rowStatements(backup, table, key, ids, replace = false) {
  const rows = backup.tables[table];
  if (!rows) throw new Error(`the backup has no table ${table}`);
  const want = new Set(ids.map(String));
  const hit = rows.filter((r) => want.has(String(r[key])));
  const missing = [...want].filter((id) => !hit.some((r) => String(r[key]) === id));
  const verb = replace ? "INSERT OR REPLACE" : "INSERT";
  const lines = [
    `-- restore-rows: ${hit.length} row(s) of ${table} by ${key} from the backup of ${backup.summary.generated_at ?? "(pre-1.244 backup)"}`,
    `-- ${replace ? "INSERT OR REPLACE - an existing row with the same key is OVERWRITTEN" : "INSERT - a row that still exists makes its statement fail; nothing is overwritten"}`,
    "-- review every value before applying; take an export first (PUSH.bat does one before each release)",
    ...(missing.length ? [`-- not in the backup: ${missing.join(", ")}`] : []),
  ];
  for (const r of hit) {
    const keys = Object.keys(r);
    lines.push(`${verb} INTO ${q(table)} (${keys.map(q).join(", ")}) VALUES (${keys.map((k) => lit(r[k])).join(", ")});`);
  }
  return { sql: lines.join("\n") + "\n", found: hit.length, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const src = args[0], table = opt("--table"), ids = (opt("--ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!src || !table || !ids.length) throw new Error("usage: node scripts/restore-rows.mjs <backup> --table <name> --ids 1,2 [--key id] [--replace] [--out rows.sql]");
    const r = rowStatements(loadBackup(src), table, opt("--key") ?? "id", ids, args.includes("--replace"));
    if (opt("--out")) { writeFileSync(opt("--out"), r.sql); console.log(`${r.found} row(s) written to ${opt("--out")}${r.missing.length ? `; not in the backup: ${r.missing.join(", ")}` : ""}`); }
    else process.stdout.write(r.sql);
  } catch (e) {
    console.error(`restore-rows: ${e.message}`);
    process.exitCode = 1;
  }
}
