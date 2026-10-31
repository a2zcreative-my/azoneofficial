#!/usr/bin/env node
/* scripts/restore-media.mjs - v1.244.0 (go-live Release D).
 *
 * MEDIA RECOVERY BY KEY. Media is copied every 30 minutes to the backups
 * bucket (worker/src/backup-store.ts):
 *     media/current/<key>          the latest copy
 *     media/versions/<day>/<key>   a copy an edit replaced (90 days)
 *     media/deleted/<day>/<key>    a copy of a deleted object (90 days)
 *
 * This script PRINTS the wrangler commands that bring the chosen objects
 * back into the live media bucket (download from backups, upload to media),
 * and with --run executes them on this computer. Keys come from --keys, or
 * from media/index.json (downloaded) filtered by --prefix. Each file's
 * SHA-256 is checked against the index before it is uploaded when the index
 * is given. Nothing is deleted anywhere.
 *
 *   node scripts/restore-media.mjs --keys staff/12/photo.jpg[,..] [--from current|versions/2026-11-02|deleted/2026-11-02]
 *   node scripts/restore-media.mjs --index index.json --prefix receipts/2026-10/ [--run]
 */
import { wrangler } from "./wrangler-exec.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BACKUP_BUCKET = "azoneofficial-backups";
export const MEDIA_BUCKET = "azoneofficial";

export function plan(keys, from = "current") {
  if (!/^(current|versions\/\d{4}-\d{2}-\d{2}|deleted\/\d{4}-\d{2}-\d{2})$/.test(from)) throw new Error(`--from must be current, versions/<day> or deleted/<day>`);
  return keys.map((key) => {
    if (!key || key.startsWith("/") || key.includes("..") || key.startsWith("backups/")) throw new Error(`refusing key ${key}`);
    return { key, source: `${BACKUP_BUCKET}/media/${from}/${key}`, target: `${MEDIA_BUCKET}/${key}` };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  let tmp = null;
  try {
    const index = opt("--index") ? JSON.parse(readFileSync(opt("--index"), "utf8")).objects ?? [] : null;
    let keys = (opt("--keys") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!keys.length && index && opt("--prefix")) keys = index.filter((o) => o.key.startsWith(opt("--prefix"))).map((o) => o.key);
    if (!keys.length) throw new Error("name the objects: --keys a,b or --index index.json --prefix <p>");
    const steps = plan(keys, opt("--from") ?? "current");
    const sha = new Map((index ?? []).map((o) => [o.key, o.sha256]));
    if (!args.includes("--run")) {
      console.log(`# ${steps.length} object(s) - review, then run with --run (or paste these):`);
      for (const s of steps) {
        console.log(`npx wrangler r2 object get "${s.source}" --remote --file "restore.tmp"`);
        console.log(`npx wrangler r2 object put "${s.target}" --remote --file "restore.tmp"`);
      }
      process.exit(0);
    }
    tmp = mkdtempSync(join(tmpdir(), "restore-media-"));
    const sh = (a) => wrangler(a); // v1.244.0 (fix) - no shell (keys may hold spaces); see wrangler-exec.mjs
    let done = 0;
    for (const [i, s] of steps.entries()) {
      const f = join(tmp, `o${i}`);
      if (sh(["r2", "object", "get", s.source, "--remote", "--file", f]).status !== 0) { console.error(`  [X] could not download ${s.source}`); continue; }
      const want = sha.get(s.key);
      if (want && createHash("sha256").update(readFileSync(f)).digest("hex") !== want) { console.error(`  [X] ${s.key}: SHA-256 differs from the index - not uploaded`); continue; }
      if (sh(["r2", "object", "put", s.target, "--remote", "--file", f]).status !== 0) { console.error(`  [X] could not upload ${s.target}`); continue; }
      done++; console.log(`  [OK] ${s.key}`);
    }
    console.log(`${done} of ${steps.length} restored`);
    process.exitCode = done === steps.length ? 0 : 1;
  } catch (e) {
    console.error(`restore-media: ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}
