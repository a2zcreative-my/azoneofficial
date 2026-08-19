/* v1.26.1 — CSRF regression guard (CEO: "Photo upload failed — CSRF token
   mismatch or missing", the THIRD outbreak of this bug class after v1.23.1
   fixed change-password/assets/payroll and this release fixed staff photos,
   vault docs, enquiry status/reply, admin media and the account enquiry).

   The worker rejects EVERY mutating request that carries a session cookie
   but no X-CSRF-Token header (worker/src/index.ts ~line 1328). The shared
   api() helper attaches the token automatically — raw fetch() calls do not.

   This guard scans all client code for fetch() calls with a mutating method
   and FAILS unless the call either goes through api()/makeApi() or visibly
   attaches X-CSRF-Token. New code should use api(); a raw fetch is only for
   binary bodies or querystring uploads, and must carry the header.
   Run: node tests/csrf-guard.mjs */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'components', 'lib'];
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!p.includes('node_modules')) walk(p); }
    else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
  }
};
for (const r of ROOTS) walk(r);

const bad = [];
let rawMutating = 0;
for (const file of files) {
  if (file === join('lib', 'api.ts')) continue; // the one place allowed to build the header
  const src = readFileSync(file, 'utf8');
  // every fetch( call site: take a 500-char window from the call
  let idx = -1;
  while ((idx = src.indexOf('fetch(', idx + 1)) !== -1) {
    // skip api()/makeApi wrappers named like refetch etc.
    const before = src[idx - 1];
    if (before && /[a-zA-Z0-9_$.]/.test(before)) continue; // e.g. "prefetch(", ".fetch(" on some client
    // span = the fetch(...) call itself (balanced parens), so the method
    // of the NEXT call can never bleed into this window (false positives).
    let depth = 0, end = idx + 5;
    for (let j = idx + 5; j < Math.min(src.length, idx + 4000); j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') { depth--; if (depth === 0) { end = j; break; } }
    }
    const win = src.slice(idx, end + 1);
    const m = win.match(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    if (!m) continue; // GET/HEAD — no CSRF needed
    rawMutating++;
    // v1.26.2: bare fetch() mutations are banned outright — even with a
    // hand-attached header they miss the self-heal retry. Use api() for
    // JSON, csrfFetch() for binary/custom-header uploads.
    const line = src.slice(0, idx).split('\n').length;
    bad.push(`${file}:${line} — bare ${m[1]} fetch() (use api() from lib/api, or csrfFetch() for binary uploads)`);
  }
}

console.log(`scanned ${files.length} files · ${rawMutating} raw mutating fetch() call(s) found`);
// Precondition: the extractor must still SEE mutating calls somewhere —
// csrfFetch call sites don't match bare fetch(, so verify the scanner works
// by checking lib/api.ts itself contains the canonical fetch call.
const apiSrc = readFileSync(join('lib', 'api.ts'), 'utf8');
if (!apiSrc.includes('fetch(')) {
  console.log('FAIL — lib/api.ts has no fetch() at all; the scan precondition broke');
  process.exit(2);
}
const csrfFetchSites = files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(/csrfFetch\(/g) || []).length, 0);
console.log(`csrfFetch() call sites: ${csrfFetchSites}`);
if (csrfFetchSites < 12) {
  console.log('FAIL — expected at least 12 csrfFetch() upload/mutation sites; the converted calls regressed');
  process.exit(1);
}
if (bad.length) {
  console.log('FAIL — mutating fetch() without CSRF header:\n - ' + bad.join('\n - '));
  process.exit(1);
}
console.log('PASS — every mutating fetch() carries X-CSRF-Token (or goes through api())');
