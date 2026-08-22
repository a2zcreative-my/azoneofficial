/* v1.38.0 (IMPLEMENTATION-PLAN.md S-1) — five real handwritten signatures
   were publicly downloadable from /signatures/ for an unknown period, with
   no login, referenced from approved leave and claim forms. They now live in
   the private R2 vault behind authenticated routes.

   This guard is the part that stops the leak COMING BACK:
   1. nothing under public/signatures/ may be a real image (only the 1x1
      placeholders that soften stale cached HTML, or nothing at all);
   2. no client code may reference the old public path again — the vault
      routes (/api/v1/staff/signature/…, /api/v1/public/doc-signature) are
      the only sanctioned sources.

   Run: node tests/no-public-signatures.mjs */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); failed++; };
const ok = (msg) => console.log(`ok   ${msg}`);

/* 1. public/signatures holds nothing that could be a signature. A real scan
   is tens of KB; the transparent placeholder is 70 bytes. 1KB is the line. */
const DIR = "public/signatures";
if (existsSync(DIR)) {
  for (const f of readdirSync(DIR)) {
    const size = statSync(join(DIR, f)).size;
    if (f.endsWith(".png") && size > 1024) {
      fail(`${DIR}/${f} is ${size} bytes — a real image is back in the public folder`);
    }
  }
  ok("public/signatures contains no real image");
} else {
  ok("public/signatures does not exist");
}

/* 2. No client code fetches the old public path. */
const scan = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { scan(p); continue; }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const src = readFileSync(p, "utf8");
    /* the sanctioned routes contain "/signature/" (singular) or
       "doc-signature"; the forbidden pattern is the bare public folder */
    const bad = src.match(/[`"'/]\/signatures\//);
    if (bad) fail(`${p} still references the public /signatures/ path`);
  }
};
for (const d of ["app", "components", "lib"]) scan(d);
if (failed === 0) ok("no client code references the public /signatures/ path");

/* 3. The vault routes exist in the worker (a rename would silently blank
   every signed document). */
const worker = readFileSync("worker/src/staff.ts", "utf8") + readFileSync("worker/src/index.ts", "utf8");
if (!worker.includes("private/signatures/") || !worker.includes("sigServe")) {
  fail("the staff signature vault route is missing from the worker");
} else ok("staff vault route present");
if (!worker.includes("/api/v1/public/doc-signature")) {
  fail("the token-scoped public doc-signature route is missing");
} else ok("token-scoped public route present");

if (failed) { console.error(`\n${failed} signature-exposure check(s) failed.`); process.exit(1); }
console.log("\nno-public-signatures: all checks passed.");
