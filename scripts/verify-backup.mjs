/** Read-only verifier. Does not execute embedded SQL or contact any service.
 *
 * v1.244.0 (go-live Release D, F7) - two formats:
 *   version 1  the single JSON object written up to 1.243.0 (verifyBackup)
 *   version 2  the paged export (worker/src/backup-manifest.ts), either as
 *              the one-file download (`azoo-db-<stamp>.ndjson.gz`: the
 *              manifest line, then every page) or as a folder holding
 *              manifest.json and the page files (verifyPaged)
 * Every page's SHA-256, every table's chunk hashes and table hash, the row
 * counts and the metadata hash are recomputed; any difference fails.
 *
 *   node scripts/verify-backup.mjs <backup.json.gz | azoo-db-....ndjson.gz | folder>
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { basename, join, resolve } from "node:path";

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

const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Split the one-file download into its manifest and page texts. */
export function splitBundle(text) {
  requireValid(text.startsWith('{"$manifest":'), "Not a paged backup download (no manifest line).");
  const nl = text.indexOf("\n");
  const manifest = JSON.parse(text.slice(0, nl)).$manifest;
  requireValid(manifest?.version === 2 && Array.isArray(manifest.pages), "Unsupported manifest in the download.");
  let at = nl + 1;
  const pages = [];
  for (const p of manifest.pages) {
    let end = at;
    for (let i = 0; i < p.lines; i++) {
      end = text.indexOf("\n", end);
      requireValid(end !== -1, `Page ${p.key} is cut short.`);
      end += 1;
    }
    pages.push(text.slice(at, end));
    at = end;
  }
  requireValid(at === text.length, "Extra data after the last page.");
  return { manifest, pages };
}

/** Verify a paged backup and return its rows by table. */
export function verifyPaged(manifest, pageTexts) {
  const m = manifest;
  requireValid(m?.version === 2 && m.format === "ndjson-pages", "Missing or unsupported manifest.");
  requireValid(m.database === "azoneofficial", "Unexpected database.");
  requireValid(m.consistency === "sequential-table-reads" && m.attachments === "references-only", "Unsupported recovery contract.");
  requireValid(Array.isArray(m.pages) && pageTexts.length === m.pages.length, "Page count mismatch.");
  const tables = Object.fromEntries(Object.keys(m.tables ?? {}).map((n) => [n, []]));
  const chunks = Object.fromEntries(Object.keys(m.tables ?? {}).map((n) => [n, []]));
  m.pages.forEach((p, i) => {
    const text = pageTexts[i];
    requireValid(typeof text === "string" && text.endsWith("\n"), `Page ${p.key} is not a complete page.`);
    requireValid(sha(text) === p.sha256, `Checksum mismatch: page ${p.key}`);
    const lines = text.slice(0, -1).split("\n");
    requireValid(lines.length === p.lines, `Line count mismatch: page ${p.key}`);
    let cur = null, buf = [], rows = 0;
    const close = () => { if (cur !== null) chunks[cur].push({ page: i + 1, rows: buf.length, sha256: sha(buf.join("\n")) }); buf = []; };
    for (const line of lines) {
      const o = JSON.parse(line);
      if (o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 1 && typeof o.$table === "string") {
        close(); cur = o.$table;
        requireValid(cur in tables, `Page ${p.key} names a table the manifest does not: ${cur}`);
        continue;
      }
      requireValid(cur !== null, `Page ${p.key} has a row before any table.`);
      tables[cur].push(o); buf.push(line); rows++;
    }
    close();
    requireValid(rows === p.rows, `Row count mismatch: page ${p.key}`);
  });
  let total = 0;
  for (const [name, entry] of Object.entries(m.tables)) {
    requireValid(Number.isSafeInteger(entry.rows) && tables[name].length === entry.rows, `Row count mismatch: ${name}`);
    requireValid(JSON.stringify(chunks[name]) === JSON.stringify(entry.chunks), `Chunk mismatch: ${name}`);
    requireValid(sha(entry.chunks.map((c) => c.sha256).join("\n")) === entry.sha256, `Checksum mismatch: ${name}`);
    total += entry.rows;
  }
  const names = Object.keys(m.tables).sort();
  requireValid(m.table_count === names.length && m.row_count === total, "Manifest totals mismatch.");
  requireValid(m.metadata && Array.isArray(m.metadata.schema) && Array.isArray(m.metadata.migrations) && Array.isArray(m.metadata.sequences), "Missing recovery metadata.");
  requireValid(sha(JSON.stringify(m.metadata)) === m.metadata_sha256, "Metadata checksum mismatch.");
  const schemaTables = m.metadata.schema.filter((s) => s.type === "table" && s.name !== "d1_migrations").map((s) => s.name).sort();
  requireValid(JSON.stringify(schemaTables) === JSON.stringify(names), "Schema table list mismatch.");
  return { summary: { format: 2, tables: names.length, rows: total, pages: m.pages.length, worker_version: m.worker_version, generated_at: m.generated_at, consistency: m.consistency, attachments: m.attachments }, tables };
}

const LIMIT = 1024 * 1024 * 1024;
/** Read any backup (v1 file, v2 download, v2 folder): verified, with its rows.
    Returns { summary, manifest, tables, metadata }. */
export function loadBackup(path) {
  if (statSync(path).isDirectory()) {
    const manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8"));
    const pages = (manifest.pages ?? []).map((p) => gunzipSync(readFileSync(join(path, basename(p.key))), { maxOutputLength: LIMIT }).toString("utf8"));
    const v = verifyPaged(manifest, pages);
    return { ...v, manifest, metadata: manifest.metadata };
  }
  const text = gunzipSync(readFileSync(path), { maxOutputLength: LIMIT }).toString("utf8");
  if (text.startsWith('{"$manifest":')) {
    const { manifest, pages } = splitBundle(text);
    const v = verifyPaged(manifest, pages);
    return { ...v, manifest, metadata: manifest.metadata };
  }
  const data = JSON.parse(text);
  const summary = { format: 1, ...verifyBackup(data) };
  return { summary, manifest: data.manifest, tables: data.tables, metadata: data.manifest.metadata };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValid(process.argv.length === 3, "Usage: node scripts/verify-backup.mjs <backup.json.gz | azoo-db-....ndjson.gz | folder>");
    console.log(JSON.stringify({ verified: true, ...loadBackup(process.argv[2]).summary }));
  } catch (error) {
    console.error(`Backup verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
