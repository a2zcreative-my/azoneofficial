# Backup and restore — A2Z staff portal

Version 1.244.0 (go-live Release D). The owner's decisions of 31-10-2026: **D-4** backups bucket now, staging later; **D-9** keep 30 nightly database backups, keep media versions and deleted copies for 90 days, never prune the audit trail.

Every procedure here is run by the owner (or someone he names in writing) on his own computer. Nothing in this document runs automatically against production, and no step deletes production data.

## 1. What is backed up, where, and for how long

| What | When | Where | Kept |
|---|---|---|---|
| Whole database, every table, in pages of 20,000 rows, each page and table with a SHA-256 | nightly 03:20 MYT, and **Back up now** on the System health card | bucket `azoneofficial-backups`, `db/db-<YYYY-MM-DD-HHMMSS>/` (pages, then `manifest.json` last) | newest **30** complete backups |
| Full SQL export of the production database | every `PUSH.bat`, **before** any migration | this computer, `backups\pre-<version>-<time>.sql` + `.sha256` (gitignored) | until you delete it |
| Built website of each release | every `PUSH.bat`, before publishing | this computer, `backups\site-<version>\` | newest 5 |
| Every photo, receipt and document (media bucket `azoneofficial`) | every 30 minutes, 40 objects a pass, new or changed only | `azoneofficial-backups`, `media/current/<key>` with its SHA-256 | while the original exists |
| The copy an edit replaced | when the change is copied | `media/versions/<day>/<key>` | **90 days** |
| The copy of an object deleted from the media bucket | weekly check (Sunday) | `media/deleted/<day>/<key>` | **90 days** |
| Full media index (key, size, SHA-256) | weekly check (Sunday) | `media/index.json` | always the latest |
| Audit trail (`audit_log`) | inside every database backup | — | **never pruned** |

Pruned automatically: read notifications older than 90 days (unread ones stay), expired rate-limit rows. Nothing else.

The System health card shows the last backup, the media copy (objects, still to copy, last pass) and the last weekly check (objects without a current copy, damaged copies). A damaged copy or a missing one the copy says it has finished is also written to the error log.

**Consistency.** The nightly export reads tables one after another; a change made during the export may appear in one table and not another. The pre-release SQL export is the point-in-time copy.

## 2. Bring back a few rows (row-level)

Use when a record was deleted or damaged and the rest of the database is fine.

1. On the System health card, press **Off-site copy** (super admin). You get `azoo-db-<stamp>.ndjson.gz`, one file.
2. Check it: `node scripts/verify-backup.mjs azoo-db-<stamp>.ndjson.gz` — it must print `"verified":true`.
3. Write the statements: `node scripts/restore-rows.mjs azoo-db-<stamp>.ndjson.gz --table invoice_payments --ids 41,42 --out rows.sql`
   The file has a plain `INSERT` per row: if the row still exists, that statement fails and nothing is overwritten. `--replace` writes `INSERT OR REPLACE` instead, for a row whose values were damaged; the file says so at the top.
4. **Read every value in `rows.sql`.** Get the CEO's written approval naming the rows.
5. Take a fresh export first: `cd worker` then `npx wrangler d1 export azoneofficial --remote --output=..\backups\before-restore.sql`
6. Apply: `npx wrangler d1 execute azoneofficial --remote --file ..\rows.sql`
7. Record in the change note what was restored, from which backup, and why. Check the screen that shows the record.

Money rows (payments, refunds, cash book) affect totals: after restoring one, open the invoice, the Cash book and the month's figures and confirm they read as before the loss.

## 3. Bring back the whole database

Use only when the database itself is lost or corrupted. **Never load a backup into the live database on top of live data.**

1. Download the newest backup (section 2, step 1) and verify it.
2. Rehearse locally: `node scripts/restore-drill.mjs azoo-db-<stamp>.ndjson.gz --sql restore.sql`
   It rebuilds the database in a new local SQLite file, checks integrity, compares every table's row count with the manifest and 12 business figures (accounts, customers, sales documents and their total, part payments, stock on hand, punches, payroll net, commission, cash book, leave requests, audit rows), and writes `restore.sql`. It must print `"drill":"passed"`.
3. Create a **new, empty** D1 database: `cd worker` then `npx wrangler d1 create azoneofficial-restore-<date>`
4. Load it: `npx wrangler d1 execute azoneofficial-restore-<date> --remote --file ..\restore.sql`
   The script also writes the migration ledger, so the next `PUSH.bat` applies nothing twice. If the loader refuses the `sqlite_sequence` lines near the end, delete them and load again: each counter then continues from the highest id present.
5. Point the API at it: in `worker/wrangler.toml` change the `database_id` (and name) of the `DB` binding to the new database, then publish with `PUSH.bat`. The old database is left as it is, for investigation.
6. Read-only smoke: health, sign-in, Dashboard, Sales, Payroll lists; the 12 figures on screen match the drill.

**Cloudflare Time Travel** (restoring the D1 database to a minute in the last 30 days) is used only on the CEO's written instruction, with the data written after that minute named as lost.

## 4. Bring back media

1. Find the key: from the record (a photo or receipt key), or download `media/index.json`:
   `npx wrangler r2 object get azoneofficial-backups/media/index.json --remote --file index.json`
2. Print the commands: `node scripts/restore-media.mjs --keys staff/12/photo.jpg` (or `--index index.json --prefix receipts/2026-10/`)
   An edited object's earlier copy: `--from versions/<day>`; a deleted one: `--from deleted/<day>`.
3. Review, then `--run` (with `--index index.json` each file's SHA-256 is checked before it is uploaded). Nothing is deleted anywhere.

## 5. The restore drill (before go-live, then quarterly)

Witnessed by the owner. On this computer:

1. Download the newest backup; `node scripts/verify-backup.mjs <file>` → verified.
2. `node scripts/restore-drill.mjs <file>` → passed; keep the printed figures.
3. Download `media/index.json` and 20 objects listed in it into a folder (`npx wrangler r2 object get azoneofficial-backups/media/current/<key> --remote --file <folder>/<key>`), then
   `node scripts/restore-drill.mjs <file> --media-index index.json --media-dir <folder>` → every SHA-256 equal.
4. Compare two or three of the drill's figures with the live screens (e.g. stock on hand, the number of customers).
5. Write the date, the backup stamp and the result in the change note.

Loading the drill into a staging D1 (section 3 against a staging database) is the full rehearsal; it waits for the staging environment (D-4: "staging later").

## 6. Before the first deploy of 1.244.0 (once)

Create the backups bucket:

```
cd worker
npx wrangler r2 bucket create azoneofficial-backups
```

`PUSH.bat` checks that it exists and stops — before any migration or publish — if it does not. The last 30 single-file backups from before 1.244.0 stay in the media bucket under `backups/`; the new backups do not touch them.
