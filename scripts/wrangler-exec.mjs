/* scripts/wrangler-exec.mjs - v1.244.0 (fix of 31-10-2026, before the first deploy). Run wrangler from a release script
 * WITHOUT a shell and without npx.
 *
 * Why: on Windows, Node (since the April 2024 security release, CVE-2024-
 * 27980) refuses to start a .cmd or .bat file without `shell: true` - so
 * `execFileSync("npx.cmd", ...)` throws `spawnSync npx.cmd EINVAL`. That is
 * exactly how PUSH.bat stopped at [6/8] on 31-10-2026 (the data pre-flight
 * could not read the migration ledger). Turning the shell on is not the fix:
 * cmd.exe would then re-read every argument, and an SQL statement full of
 * quotes, commas and angle brackets is not safe to hand to it.
 *
 * So the script runs the SAME node that is running it on wrangler's own
 * JavaScript entry (node_modules/wrangler/bin/wrangler.js, in worker/ or the
 * repository root - the copy `npx wrangler` would have used), with the
 * arguments passed exactly as given. No .cmd, no shell, on every platform.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const workerDir = join(repoRoot, "worker");

export function wranglerBin() {
  for (const base of [workerDir, repoRoot]) {
    const bin = join(base, "node_modules", "wrangler", "bin", "wrangler.js");
    if (existsSync(bin)) return bin;
  }
  throw new Error("wrangler is not installed in worker/ or the repository root - run the install step of PUSH.bat first");
}

/** spawnSync-shaped result: { status, stdout, stderr, error }. Never throws
    for a non-zero exit; throws only if wrangler is not installed. */
export function wrangler(args, opts = {}) {
  const r = spawnSync(process.execPath, [wranglerBin(), ...args], {
    cwd: workerDir, encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, CI: "true" }, ...opts,
  });
  releaseLog(`wrangler ${args.map((a) => (a.length > 80 ? `${a.slice(0, 77).replace(/\s+/g, " ")}...` : a)).join(" ")} -> ${r.error ? `ERROR ${r.error.message}` : `exit ${r.status}`}`, r.status === 0 && !r.error ? "" : `${r.stderr ?? ""}\n${r.stdout ?? ""}`);
  return r;
}

/** v1.244.0 (fix) - every wrangler call and every release-script outcome is
    appended to backups/release-log.txt (gitignored, this computer only), so
    a stop in PUSH.bat can be read afterwards without copying the screen.
    Wrangler's own output is kept only for a failure, the last 25 lines,
    colour codes removed. Never fatal. */
export function releaseLog(line, detail = "") {
  try {
    const dir = join(repoRoot, "backups");
    mkdirSync(dir, { recursive: true });
    const tail = String(detail).replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean).slice(-25);
    appendFileSync(join(dir, "release-log.txt"), `${new Date().toISOString()} ${line}\n${tail.map((l) => `    | ${l}\n`).join("")}`);
  } catch { /* logging never stops a release */ }
}
