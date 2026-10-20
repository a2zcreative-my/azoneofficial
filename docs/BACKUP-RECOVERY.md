# Backup verification and recovery

Updated: 12 October 2026. Cap safeguard, recovery manifest, verifier and synthetic restore drill are included in committed release source 3e42644 (1.181.9). Public API/login report 1.181.9; actual production backup/restore behaviour was not exercised.

## Export contract

The scheduled and manual JSON exports use `runBackup` in `worker/src/index.ts`. Existing `generated_at`, `database` and `tables` fields and gzip delivery remain; a new `manifest` field is additive. Successful exports retain the existing 30-object retention policy.

Each table reads at most 50,001 rows. The sentinel row detects a table over the 50,000-row export limit and rejects the export before any R2 write or retention. Unsupported table names also fail instead of silently being skipped. Metadata read failures or a mismatch between schema table names and exported tables likewise prevent publication. Errors use the existing error log and manual `backup_failed` response.

Manifest version 1 contains:

- Worker version, table/row totals and per-table row counts and SHA-256 checksums.
- SQL definitions for application tables, explicit indexes, views and triggers, plus the migration table definition. SQLite internal objects and Cloudflare internal objects are excluded.
- Applied `d1_migrations` rows and `sqlite_sequence` values, preserving deleted-ID high-water marks for recovery.
- A checksum of schema, migration and sequence metadata.
- Explicit `sequential-table-reads` consistency and `references-only` attachments declarations.

Checksums cover UTF-8 `JSON.stringify` output in the saved row/key order. They detect accidental changes; they are not signatures or proof of authenticity. Keep the original compressed export. Reordering JSON keys can cause verification to fail even if values are unchanged.

## Read-only verification

For an export already downloaded through the existing authorised backup flow:

```sh
node scripts/verify-backup.mjs /path/to/backup.json.gz
```

The verifier prints only version, counts and recovery limitations, never records. It performs no network calls and executes no embedded SQL. It exits nonzero for unsupported/absent manifests, mismatched counts, missing tables, altered rows or metadata, malformed gzip and decompressed input above its 128 MiB tool limit. This tool limit does not solve Worker export memory limits.

Legacy exports have no manifest and are explicitly rejected as unverifiable by this tool. They remain readable JSON; rejection does not itself mean corruption, nor does it make old exports complete. Historical successful exports could have been truncated before the cap safeguard.

## Isolated recovery drill

```sh
node tests/backup-completeness.mjs
node tests/backup-restore.mjs
```

Both tests execute the shipped export function. The completeness test uses D1/R2 doubles for empty, small, exact-limit, oversized, read-failure, metadata-failure and unsupported-table scenarios. The restore drill uses actual in-memory SQLite databases with synthetic schema and records; R2 storage remains a double. It verifies the manifest, reconstructs schema/data, creates indexes/views/triggers after loading rows, restores sequence metadata, then checks integrity, foreign keys, rows, totals, constraints and the next generated ID. It also tests altered metadata/data and the verifier CLI.

The drill is a regression test, not a general restore command. It only executes SQL from its own synthetic schema. Never execute SQL embedded in an untrusted backup. Neither test reads production data or writes a remote database. Both are registered in the mandatory guard runner.

## Remaining limitations and next work

1. **Consistency:** independent table and metadata reads are not a single snapshot. The table-name comparison detects some schema drift, not concurrent writes, altered definitions or cross-table inconsistencies. A successful checksum verifies the captured payload, not its point-in-time consistency.
2. **Scale:** the 50,000-row cap and aggregate-memory design remain. Measure actual table sizes, response bytes and memory before designing larger exports. Do not simply increase the cap.
3. **Recovery coverage:** the synthetic drill is not a real D1/R2 restore. Validate actual application schemas and representative data in an isolated environment, including any future BLOB/generated/virtual-table cases and numeric precision limits.
4. **Attachments:** the export retains attachment keys, not file bodies. Document and test their separate recovery process.
5. **Operations:** verify production backup age/counts and agree recovery point/time objectives. Old backups are preserved on cap/metadata failure, but may be stale or incomplete.

Cloudflare's [D1 import/export documentation](https://developers.cloudflare.com/d1/best-practices/import-export-data/) describes a full schema/data SQL export option. Evaluate it for larger recovery jobs: the documented export blocks other database requests and has virtual-table and numeric-precision limitations. No remote export, import or restore was run here.

Use PROJECT-STATE for the latest validation status and release evidence. Deployment still follows `PUSH.bat`; release version evidence is not production recovery verification.

Validation on 12 October 2026: all 106 guards passed, Worker strict typecheck passed, and diff whitespace checks passed. No frontend build, browser sweep, deployment or real D1/R2 restore was performed.
