/* worker/src/backup-manifest.ts - THE NIGHTLY DATABASE EXPORT, IN PAGES.

   v1.244.0 (go-live audit F7, Release D; the owner's decision D-9 of
   31-10-2026: "DB 30 nights, media 90 days, audit never").

   Until 1.243.0 the whole database was read into ONE JSON object, and any
   table past 50,000 rows stopped the backup entirely ("no backup was
   published") - audit_log and notifications were heading there. Now:

   - every table is read in rowid order, at most PAGE_ROWS rows per query,
     with no cap on the table;
   - the rows go into pages of at most PAGE_ROWS rows (small tables share a
     page). A page is NDJSON: a `{"$table":"name"}` line opens a run of that
     table's rows, one JSON object per line; the text ends with a newline, so
     gzipped pages can be concatenated into one download and still split;
   - each page carries its own SHA-256 (of the text before gzip), and each
     table a SHA-256 over its chunks (a chunk = that table's rows inside one
     page; the table hash is the SHA-256 of its chunk hashes, newline-joined).
     scripts/verify-backup.mjs recomputes all of them;
   - the manifest is written LAST. A prefix without a manifest is not a
     backup: runBackup removes its own partial pages on failure, and the
     retention sweep removes any leftover after two days.

   Consistency is unchanged: tables are read one after another (the D1 API
   offers no read transaction across queries), so a row written during the
   export may appear in one table and not in another. The pre-release SQL
   export (scripts/release-backup.mjs) is the point-in-time copy. */

export interface BackupSchema { type: string; name: string; tbl_name: string; sql: string }

export const PAGE_ROWS = 20000;

export interface PageInfo { key: string; rows: number; lines: number; bytes: number; gz_bytes: number; sha256: string }
export interface ChunkInfo { page: number; rows: number; sha256: string }
export interface TableEntry { rows: number; sha256: string; chunks: ChunkInfo[] }

export interface PagedManifest {
  version: 2;
  format: "ndjson-pages";
  database: "azoneofficial";
  generated_at: string;
  worker_version: string;
  consistency: "sequential-table-reads";
  attachments: "references-only";
  page_rows: number;
  pages: PageInfo[];
  table_count: number;
  row_count: number;
  tables: Record<string, TableEntry>;
  metadata: { schema: BackupSchema[]; migrations: unknown[]; sequences: { name: string; seq: number }[] };
  metadata_sha256: string;
}

type Db = D1Database;

export async function sha256Hex(value: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function gzipText(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

/** The tables a backup must carry: every application table (not SQLite's,
    not Cloudflare's, not the migration ledger - that goes in the metadata). */
export async function backupTables(db: Db): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       AND name != 'd1_migrations'
     ORDER BY name`,
  ).all<{ name: string }>();
  const names = results.map((t) => t.name);
  for (const n of names) {
    if (!/^[A-Za-z0-9_]+$/.test(n)) throw new Error("Backup encountered an unsupported table name; no backup was published.");
  }
  return names;
}

/**
 * Export the database as gzipped NDJSON pages, handing each finished page to
 * `put` (key, gzipped bytes). Returns the manifest; the caller writes it last.
 * Throws on any failure - the caller removes what was put.
 */
export async function exportPaged(
  db: Db, put: (key: string, body: ArrayBuffer) => Promise<void>, prefix: string, version: string, pageRows = PAGE_ROWS,
): Promise<PagedManifest> {
  const generatedAt = new Date().toISOString();
  const names = await backupTables(db);
  const tables: Record<string, TableEntry> = {};
  const pages: PageInfo[] = [];

  let lines: string[] = [];
  let pageCount = 0;              // rows in the open page
  let chunkTable: string | null = null;
  let chunkLines: string[] = [];
  const pendingChunks: { table: string; rows: number; text: string }[] = [];

  const closeChunk = () => {
    if (chunkTable !== null && chunkLines.length > 0) pendingChunks.push({ table: chunkTable, rows: chunkLines.length, text: chunkLines.join("\n") });
    chunkTable = null; chunkLines = [];
  };
  const flush = async () => {
    closeChunk();
    if (lines.length === 0) return;
    const index = pages.length + 1;
    const text = lines.join("\n") + "\n";
    const key = `${prefix}p${String(index).padStart(5, "0")}.ndjson.gz`;
    const gz = await gzipText(text);
    await put(key, gz);
    pages.push({ key, rows: pageCount, lines: lines.length, bytes: new TextEncoder().encode(text).byteLength, gz_bytes: gz.byteLength, sha256: await sha256Hex(text) });
    for (const c of pendingChunks) tables[c.table]!.chunks.push({ page: index, rows: c.rows, sha256: await sha256Hex(c.text) });
    pendingChunks.length = 0;
    lines = []; pageCount = 0;
  };

  for (const name of names) {
    tables[name] = { rows: 0, sha256: "", chunks: [] };
    let after: number | null = null;
    for (;;) {
      const room = pageRows - pageCount;
      const res: D1Result<Record<string, unknown>> = await db.prepare(
        `SELECT rowid AS "__backup_rowid", * FROM "${name}" WHERE (?1 IS NULL OR rowid > ?1) ORDER BY rowid LIMIT ?2`,
      ).bind(after, room).all<Record<string, unknown>>();
      const results: Record<string, unknown>[] = res.results;
      if (results.length === 0) break;
      if (chunkTable !== name) {
        closeChunk();
        chunkTable = name;
        lines.push(JSON.stringify({ $table: name }));
      }
      for (const r of results) {
        after = Number(r.__backup_rowid);
        delete r.__backup_rowid;
        const line = JSON.stringify(r);
        lines.push(line); chunkLines.push(line);
      }
      pageCount += results.length;
      tables[name]!.rows += results.length;
      if (pageCount >= pageRows) await flush();
      if (results.length < room) break;
    }
  }
  await flush();
  for (const t of Object.values(tables)) t.sha256 = await sha256Hex(t.chunks.map((c) => c.sha256).join("\n"));

  const metadata = await backupMetadata(db, names);
  const rowCount = Object.values(tables).reduce((s, t) => s + t.rows, 0);
  return {
    version: 2, format: "ndjson-pages", database: "azoneofficial", generated_at: generatedAt, worker_version: version,
    consistency: "sequential-table-reads", attachments: "references-only", page_rows: pageRows,
    pages, table_count: names.length, row_count: rowCount, tables,
    metadata, metadata_sha256: await sha256Hex(JSON.stringify(metadata)),
  };
}

/** The schema, migration ledger and AUTOINCREMENT counters a restore needs. */
async function backupMetadata(db: Db, names: string[]): Promise<PagedManifest["metadata"]> {
  const { results: schema } = await db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND type IN ('table', 'index', 'trigger', 'view')
       AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       AND tbl_name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
     ORDER BY type, name`,
  ).all<BackupSchema>();
  const actual = schema.filter((s) => s.type === "table" && s.name !== "d1_migrations").map((s) => s.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) {
    throw new Error("Backup schema changed or does not match exported tables; no backup was published.");
  }
  const { results: migrations } = await db.prepare("SELECT * FROM d1_migrations ORDER BY id").all();
  const sequenceTable = await db.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'").first();
  const sequences = sequenceTable
    ? (await db.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all<{ name: string; seq: number }>()).results
    : [];
  return { schema, migrations, sequences };
}
