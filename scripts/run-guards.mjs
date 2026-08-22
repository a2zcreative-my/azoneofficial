/* The gate that stands between a change and a2zcreative.my.
 *
 * v1.34.0 — the deploy is automatic now (GitHub → Cloudflare), so nobody is
 * watching a .bat window and reading the output any more. That makes this
 * script the last thing between a mistake and live invoices, and it has to
 * behave accordingly:
 *
 *   - it runs EVERY browser-free guard, not a subset;
 *   - a guard that cannot run is a FAILURE, never a silent skip. A skipped
 *     check reads exactly like a passing one in a build log, and "it went
 *     green" is what people remember;
 *   - it prints which guards ran, so the log proves what was actually
 *     checked rather than asserting it.
 *
 * The four Playwright guards (bm-coverage, leaderboard-sales-floor,
 * location-scenarios, no-false-attendance) are NOT here: they drive a real
 * browser against a served build, which Cloudflare's build container has no
 * Chromium for. They are listed at the bottom of this file as the set that
 * still has to be run before a release, so their absence is on the record
 * instead of being quietly forgotten.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* Order matters only for readability — each of these is independent. */
const GUARDS = [
  ["brands-guard", "brand registry, client-permission gate, no hardcoded domains"],
  ["csrf-guard", "every state-changing endpoint is CSRF-protected"],
  ["doc-issuer-render", "quotations/DOs/invoices render under the right letterhead"],
  ["document-issuer-guard", "issuer is set at creation and never editable after"],
  ["origins-guard", "CORS origins match the deployed domains"],
  ["permissions-policy", "Android location permission policy is intact"],
  ["shift-sales-split", "sales are attributed to the right shift"],
  ["bridge-feed-guard", "the ELFIA feed sends the right price and nothing else"],
  ["bridge-idempotency", "a store movement applies exactly once, however often it retries"],
  ["no-public-signatures", "no real signature image is publicly downloadable"],
  ["sql-schema-check", "migrations and the code agree about the schema"],
  ["worker-compile-gate", "the API code actually compiles (the 19-08 outage)"],
];

/* worker-compile-gate needs the API's type definitions. Installing them here
   keeps the Cloudflare build command down to one line, and doing it out loud
   means the log shows why the build paused for ten seconds. */
if (!existsSync(join(root, "worker", "node_modules"))) {
  console.log("· installing the API's type definitions so its compile gate can run");
  const install = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--no-audit", "--no-fund"],
    { cwd: join(root, "worker"), stdio: "inherit" },
  );
  if (install.status !== 0) {
    console.error("\n[X] Could not install the API's dependencies, so its compile gate");
    console.error("    cannot run. Refusing to continue: shipping the API without that");
    console.error("    check is exactly what caused the 19-08 login outage.");
    process.exit(1);
  }
}

console.log(`\nRunning ${GUARDS.length} guards before anything is published.\n`);

const failed = [];
for (const [name, what] of GUARDS) {
  const file = join(root, "tests", `${name}.mjs`);
  process.stdout.write(`  ${name.padEnd(24)} `);

  if (!existsSync(file)) {
    /* A guard file that has gone missing is the worst case: the suite still
       reports a tidy row of passes, one of them for a check that no longer
       exists. Treat it as a failure, loudly. */
    console.log("MISSING");
    failed.push(`${name} — the guard file is not in this checkout`);
    continue;
  }

  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8" });
  if (run.status === 0) {
    console.log("ok");
  } else {
    console.log("FAILED");
    failed.push(`${name} — ${what}`);
    const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    if (out) console.log(out.split("\n").map((l) => `      ${l}`).join("\n"));
  }
}

if (failed.length) {
  console.error("\n============================================");
  console.error(` [X] ${failed.length} guard(s) failed — NOTHING will be published.`);
  console.error("============================================");
  for (const f of failed) console.error(`  · ${f}`);
  console.error("\nThe live system is untouched. Fix the above and push again.\n");
  process.exit(1);
}

console.log(`\n[OK] all ${GUARDS.length} guards passed.`);
console.log("Not covered here (they need a real browser — run before a release):");
console.log("  bm-coverage · leaderboard-sales-floor · location-scenarios · no-false-attendance");
console.log("  plus scratch/: footer-e2e · nav-fit-e2e · a2z-bm-e2e · portfolio-click-e2e · sales-desc-typing-e2e\n");
