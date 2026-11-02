#!/usr/bin/env node
/* scripts/release-backup.mjs - v1.244.0 (go-live Release D, decision D-4).
 *
 * Run by PUSH.bat on the owner's computer. Three jobs:
 *
 *   check-bucket   the backups bucket the API worker binds
 *                  (azoneofficial-backups, worker/wrangler.toml) exists. If
 *                  it does not, the release stops BEFORE any migration or
 *                  publish and says the one command that creates it.
 *   export         a FULL SQL export of the production database, taken
 *                  BEFORE the migrations: backups/pre-<version>-<time>.sql
 *                  plus <file>.sha256. A failed or empty export stops the
 *                  release. `--skip` is the logged emergency override
 *                  ("PUSH.bat skip-pre-export").
 *   archive-site   copies the built site (out/) to backups/site-<version>/
 *                  and keeps the newest five, so a rollback can republish
 *                  exactly what was live. Never fatal.
 *
 * backups/ is gitignored: the export holds every record, bank details
 * included. Nothing here writes to production - `wrangler d1 export` reads.
 * It never prints a credential.
 */
import { wrangler as runWrangler, releaseLog, redact } from "./wrangler-exec.mjs";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "worker");
const backups = join(root, "backups");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const BUCKET = "azoneofficial-backups";
const DB = "azoneofficial";
const KEEP_SITES = 5;
const [mode, ...rest] = process.argv.slice(2);

const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const log = (line) => {
  mkdirSync(backups, { recursive: true });
  appendFileSync(join(backups, "release-backup.log"), `${new Date().toISOString()} ${version} ${line}\n`);
};
/* v1.244.0 (fix) - no shell, no npx.cmd (Node refuses .cmd without a shell on
   Windows: EINVAL); scripts/wrangler-exec.mjs runs wrangler's own entry */
const wrangler = (args) => runWrangler(args, { cwd: worker });

if (mode === "check-bucket") {
  const r = wrangler(["r2", "bucket", "list"]);
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (r.error || r.status !== 0) {
    console.error(`  [X] Could not list the R2 buckets (${r.error ? r.error.message : `wrangler exit ${r.status}`}). Nothing was changed.`);
    const why = String(r.stderr || r.stdout || "").replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).filter((l) => l.trim()).slice(-4);
    for (const l of why) console.error(`      ${l.trim()}`);
    console.error(`      (the full message is in backups\\release-log.txt)`);
    process.exit(1);
  }
  if (!new RegExp(`(^|\\s|")${BUCKET}($|\\s|")`, "m").test(out)) {
    console.error(`  [X] The backups bucket "${BUCKET}" does not exist yet.`);
    console.error(`      This release binds it (worker/wrangler.toml), so publishing would fail half way.`);
    console.error(`      Create it once, then run PUSH.bat again:`);
    console.error(`          cd worker`);
    console.error(`          npx wrangler r2 bucket create ${BUCKET}`);
    console.error(`      Nothing was applied or published.`);
    releaseLog(`check-bucket: ${BUCKET} does not exist yet - stopped`);
    process.exit(1);
  }
  releaseLog(`check-bucket: ${BUCKET} exists`);
  console.log(`  [OK] backups bucket ${BUCKET} exists`);
  process.exit(0);
}

if (mode === "export") {
  if (rest.includes("--skip")) {
    log("export SKIPPED by the caller (skip-pre-export)");
    console.warn("  [!] pre-release SQL export SKIPPED (skip-pre-export) - recorded in backups/release-backup.log");
    process.exit(0);
  }
  mkdirSync(backups, { recursive: true });
  const file = join(backups, `pre-${version}-${stamp()}.sql`);
  console.log(`  Exporting the production database to backups\\${file.split(/[\\/]/).pop()} ...`);
  /* v1.254.0 (the owner, 02-11-2026: the 1.253.0 release stopped at
     "[ERROR] terminated") - Cloudflare built the export, then the download
     of it was cut part way. A cut download is a network event, not a bad
     database, so the export is asked for again, up to three times, with a
     pause between. A half-written file is deleted before the next try and
     after the last, so a partial copy can never pass for a backup. The rule
     is unchanged: no complete export, no release. */
  const ATTEMPTS = 3;
  const valid = () => {
    if (!existsSync(file) || statSync(file).size === 0) return null;
    const b = readFileSync(file);
    return /CREATE TABLE/i.test(b.subarray(0, Math.min(b.length, 4 * 1024 * 1024)).toString("utf8")) ? b : null;
  };
  const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let r = null;
  let body = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    rmSync(file, { force: true });
    r = wrangler(["d1", "export", DB, "--remote", `--output=${file}`]);
    body = r.status === 0 ? valid() : null;
    if (body) break;
    rmSync(file, { force: true });
    log(`export attempt ${attempt} of ${ATTEMPTS} failed (wrangler exit ${r.status})`);
    if (attempt < ATTEMPTS) {
      console.warn(`  [!] The export download did not finish (attempt ${attempt} of ${ATTEMPTS}) - trying again in ${attempt * 15} seconds...`);
      pause(attempt * 15000);
    }
  }
  if (!body) {
    log(`export FAILED after ${ATTEMPTS} attempts (wrangler exit ${r.status})`);
    console.error(`  [X] The pre-release export failed ${ATTEMPTS} times (wrangler exit ${r.status}). Nothing was applied or published.`);
    console.error(`      This is usually the internet connection dropping during the download. Run PUSH.bat again in a few minutes.`);
    if (r.stderr) console.error(redact(String(r.stderr)).split("\n").filter((l) => l.trim()).slice(-5).map((l) => `      ${l}`).join("\n"));
    process.exit(1);
  }
  const sha = createHash("sha256").update(body).digest("hex");
  writeFileSync(`${file}.sha256`, `${sha}  ${file.split(/[\\/]/).pop()}\n`);
  log(`export OK ${file.split(/[\\/]/).pop()} ${body.length} bytes sha256 ${sha}`);
  console.log(`  [OK] ${(body.length / 1048576).toFixed(1)} MB, SHA-256 ${sha.slice(0, 16)}...`);
  process.exit(0);
}

if (mode === "archive-site") {
  try {
    const out = join(root, "out");
    if (!existsSync(join(out, "index.html"))) throw new Error("no out/index.html");
    mkdirSync(backups, { recursive: true });
    const dest = join(backups, `site-${version}`);
    rmSync(dest, { recursive: true, force: true });
    cpSync(out, dest, { recursive: true });
    const sites = readdirSync(backups).filter((d) => /^site-\d+\.\d+\.\d+$/.test(d))
      .map((d) => ({ d, t: statSync(join(backups, d)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const old of sites.slice(KEEP_SITES)) rmSync(join(backups, old.d), { recursive: true, force: true });
    log(`site archived to backups/site-${version}`);
    console.log(`  [OK] built site kept in backups\\site-${version}`);
  } catch (e) {
    console.warn(`  [!] the built site was not archived (${e.message}) - the release continues`);
  }
  process.exit(0);
}

console.error("usage: node scripts/release-backup.mjs check-bucket | export [--skip] | archive-site");
process.exit(2);
