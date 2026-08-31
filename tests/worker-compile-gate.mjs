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
 * This gate runs the REAL TypeScript compiler over worker/src and fails the
 * deploy on undefined names only (TS2304 / TS2552). It deliberately does NOT
 * fail on the worker's other pre-existing strict-mode complaints (TS2532
 * "possibly undefined" and friends, ~40 of them today): a gate that cries
 * wolf gets bypassed, and this one must be trusted enough to keep in the
 * deploy path. Undefined names are never intentional and are always fatal at
 * runtime, which is exactly the class of bug that caused the outage.
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

/* v1.77.0 — TS2448 and TS2454 join the fatal list.
 *
 * The CEO clicked a "no clock-in" chip and got "Something went wrong". The
 * route read WORK_DAY_MINUTES, a `const` declared about a hundred lines
 * FURTHER DOWN the same function: a temporal dead zone, ReferenceError, 500.
 * Twice in two days — /payroll/absences was the same shape.
 *
 * This gate ran over that code and passed it. Not because it could not see it
 * — tsc reports it precisely, as TS2448 — but because it was being counted
 * among the "pre-existing strict-mode warnings ignored by design". It is not
 * one of those. `url is not defined` (TS2304) and `used before its
 * declaration` (TS2448) are the same bug wearing different hats: an
 * identifier that is not there at the moment the line runs, esbuild strips
 * the types and ships it, and the first person to press the button gets a
 * 500. The tolerated list is for opinions about strictness, not for names
 * that will not exist.
 *
 * There are zero of these in the worker today, so promoting them costs
 * nothing and shuts the door that let two through. */
const fatal = lines.filter((l) => /error TS2304|error TS2552|error TS2448|error TS2454/.test(l));
const tolerated = lines.filter((l) => /error TS\d+/.test(l)).length - fatal.length;

if (fatal.length > 0) {
  console.error("");
  console.error("[X] THE API CODE USES A NAME THAT IS NOT THERE YET.");
  console.error("    Either it does not exist at all, or it is declared further");
  console.error("    down than the line that reads it. Both throw at runtime on");
  console.error("    every affected request — the 19-08 login outage was the");
  console.error("    first kind, the 31-08 attendance 500 was the second.");
  console.error("");
  for (const l of fatal) console.error("    " + l);
  console.error("");
  console.error("    Nothing was deployed. Send these lines over.");
  process.exit(1);
}

console.log(`[OK] API code has no undefined names (${tolerated} pre-existing strict-mode warnings ignored by design).`);
process.exit(0);
