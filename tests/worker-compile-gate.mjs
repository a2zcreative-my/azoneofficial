/* v1.29.1 — the guard that would have prevented the 19-08 outage.
 *
 * What happened: v1.29.0 added host-aware Google OAuth to worker/src/index.ts
 * and referenced `url.protocol` at the top level of route(). But `url` is a
 * local of fetch(); route() only receives (request, env, path). The line was
 * never typechecked, because:
 *
 *   - the ROOT tsconfig.json has  "exclude": ["node_modules", "worker"]  —
 *     `pnpm typecheck` and `next build` never look at the API worker at all;
 *   - `wrangler deploy` bundles with esbuild, which STRIPS types without
 *     resolving them, so an undefined identifier compiles happily.
 *
 * So a ReferenceError shipped to production. Every request whose handler sits
 * below that line threw "url is not defined": /auth/me, /staff/*, /health.
 * Sign-in itself succeeded, then /auth/me 500'd, and the portal bounced the
 * CEO back to /login in a loop that looked exactly like a wrong password.
 *
 * Since v1.165.0 the old strict errors are resolved. Every TypeScript error
 * and any failed compiler process now block the release.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerTsconfig = join(root, "worker", "tsconfig.json");

if (!existsSync(workerTsconfig)) {
  console.error("[X] worker/tsconfig.json is missing — this is not a full delivery.");
  process.exit(1);
}

/* Prefer a locally installed tsc (worker's own, then the root's). Falling back
   to `npx tsc` would silently download a different compiler version, or hang
   waiting for a "install this package?" prompt inside a double-clicked .bat. */
const candidates = [
  join(root, "worker", "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"),
  join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"),
];
const tsc = candidates.find((p) => existsSync(p));

if (!tsc) {
  console.error("[X] TypeScript is not installed, so the API code cannot be checked.");
  console.error("    Run this first:   cd worker  &&  npm install");
  process.exit(1);
}

const run = spawnSync(tsc, ["--noEmit", "-p", workerTsconfig], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
});

const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
const lines = output.split(/\r?\n/).filter(Boolean);

/* Missing @cloudflare/workers-types would make every Worker global (Response,
   Request, D1Database) look undefined and turn this gate into a false alarm.
   Detect that case explicitly and say what to do instead of dumping 400
   bogus errors. */
if (lines.some((l) => /TS2688|Cannot find type definition file/.test(l))) {
  console.error("[X] The API's type definitions are not installed, so the check cannot run.");
  console.error("    Run this first:   cd worker  &&  npm install");
  process.exit(1);
}

const fatal = lines.filter((l) => /error TS\d+/.test(l));

if (fatal.length > 0 || run.status !== 0) {
  console.error("");
  console.error("[X] THE API TYPE CHECK FAILED.");
  console.error("");
  for (const l of fatal) console.error("    " + l);
  if (!fatal.length) console.error(output || String(run.error || "TypeScript did not complete."));
  console.error("");
  console.error("    Nothing was deployed. Send these lines over.");
  process.exit(1);
}

console.log("[OK] API strict type check passed with no ignored errors.");
process.exit(0);
