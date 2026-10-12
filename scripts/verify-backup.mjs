/** Read-only verifier. Does not execute embedded SQL or contact any service. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requireValid = (condition, message) => { if (!condition) throw new Error(message); };
export function verifyBackup(backup) {
  const m = backup?.manifest;
  requireValid(m?.version === 1, "Missing or unsupported manifest; legacy exports cannot be verified by this tool.");
  requireValid(backup.database === "azoneofficial", "Unexpected database.");
  requireValid(m.consistency === "sequential-table-reads" && m.attachments === "references-only", "Unsupported recovery contract.");
  const names = Object.keys(backup.tables ?? {}).sort();
  requireValid(JSON.stringify(names) === JSON.stringify(Object.keys(m.tables ?? {}).sort()), "Manifest table list mismatch.");
  let rows = 0;
  for (const name of names) {
    const data = backup.tables[name], entry = m.tables[name];
    requireValid(Array.isArray(data) && Number.isSafeInteger(entry.rows) && entry.rows >= 0 && data.length === entry.rows, `Row count mismatch: ${name}`);
    requireValid(hash(data) === entry.sha256, `Checksum mismatch: ${name}`);
    rows += data.length;
  }
  requireValid(m.table_count === names.length && m.row_count === rows, "Manifest totals mismatch.");
  requireValid(m.metadata && Array.isArray(m.metadata.schema) && Array.isArray(m.metadata.migrations) && Array.isArray(m.metadata.sequences), "Missing recovery metadata.");
  requireValid(hash(m.metadata) === m.metadata_sha256, "Metadata checksum mismatch.");
  const schemaTables = m.metadata.schema.filter(s => s.type === "table" && s.name !== "d1_migrations").map(s => s.name).sort();
  requireValid(JSON.stringify(schemaTables) === JSON.stringify(names), "Schema table list mismatch.");
  return { tables: names.length, rows, worker_version: m.worker_version, consistency: m.consistency, attachments: m.attachments };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValid(process.argv.length === 3, "Usage: node scripts/verify-backup.mjs <backup.json.gz>");
    // Limit decompression to prevent an accidental oversized input exhausting memory.
    const data = JSON.parse(gunzipSync(readFileSync(process.argv[2]), { maxOutputLength: 128 * 1024 * 1024 }).toString("utf8"));
    console.log(JSON.stringify({ verified: true, ...verifyBackup(data) }));
  } catch (error) {
    console.error(`Backup verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
