/** Recovery evidence for the bounded JSON export; not a snapshot guarantee. */
export interface BackupSchema { type: string; name: string; tbl_name: string; sql: string }

export async function backupManifest(db: D1Database, tables: Record<string, unknown[]>, version: string) {
  const { results: schema } = await db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND type IN ('table', 'index', 'trigger', 'view')
       AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       AND tbl_name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
     ORDER BY type, name`,
  ).all<BackupSchema>();
  const actual = schema.filter(s => s.type === "table" && s.name !== "d1_migrations").map(s => s.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(tables).sort())) {
    throw new Error("Backup schema changed or does not match exported tables; no backup was published.");
  }
  const { results: migrations } = await db.prepare("SELECT * FROM d1_migrations ORDER BY id LIMIT 50001").all();
  if (migrations.length > 50000) throw new Error("Backup migration history exceeds the export limit.");
  const sequenceTable = await db.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'").first();
  const sequences = sequenceTable
    ? (await db.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name LIMIT 50001").all<{ name: string; seq: number }>()).results
    : [];
  if (sequences.length > 50000) throw new Error("Backup sequence metadata exceeds the export limit.");
  const metadata = { schema, migrations, sequences };
  const entries: Record<string, { rows: number; sha256: string }> = {};
  for (const [name, rows] of Object.entries(tables)) entries[name] = { rows: rows.length, sha256: await digest(rows) };
  return {
    version: 1,
    worker_version: version,
    consistency: "sequential-table-reads",
    attachments: "references-only",
    row_limit: 50000,
    table_count: Object.keys(entries).length,
    row_count: Object.values(entries).reduce((sum, t) => sum + t.rows, 0),
    tables: entries,
    metadata,
    metadata_sha256: await digest(metadata),
  };
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
