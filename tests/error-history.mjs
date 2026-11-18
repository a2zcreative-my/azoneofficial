/* v1.375.0 - A FIXED ERROR IS HISTORY, NOT AN ALARM (the CEO, 18-11-2026: "still not
   resolved this error! still appear in the dashboard!" - a server error fixed in 1.372.0
   kept the Dashboard's red alert on for 24 hours, because only page errors carried the
   version that tells an old fault from a live one).

     node tests/error-history.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const F = { shared: "worker/src/shared.ts", index: "worker/src/index.ts", sec: "worker/src/security-status.ts", ui: "components/admin/system-health.tsx" };

function checks(src) {
  const out = [];
  const ok = (name, cond) => out.push([Boolean(cond), name]);
  ok("the shared error writer stamps the engine version on a row that has none", /let ENGINE_VERSION = "";/.test(src.shared) && /`v\$\{ENGINE_VERSION\} \$\{message\}`/.test(src.shared));
  ok("the index error writer stamps it too", /`v\$\{pkg\.version\} \$\{message\}`/.test(src.index));
  ok("the engine sets the version once at start-up", /setEngineVersion\(pkg\.version\);/.test(src.index));
  ok("a page's own report (already stamped) is left as it is", /\/\^v\\d\+\\\.\\d\+\\\.\\d\+\\b\/\.test\(message\) \? message/.test(src.shared + src.index));
  ok("API Health counts live errors only, by the same rule", /errors24h = rows\.filter\(\(r\) => isLiveError\(r\.message, pkg\.version\)\)\.length/.test(src.sec));
  ok("a row from an older version is history on the server", /if \(m\) return !olderThan\(m\[1\]!, engine\);/.test(src.sec));
  ok("a row from an older version is history on the screen (Dashboard alert)", /if \(m\) return newerVersion\(APP_VERSION, m\[1\]!\) \? m\[1\]! : null;/.test(src.ui) && /export const liveError = \(message: string\) => reportedBy\(message\) === null;/.test(src.ui));
  ok("the 3030 screenshot-AI row, fixed in 1.372.0, is named as fixed in BOTH places", /3030: Unable to add image\/, from: "1\.371\.0"/.test(src.sec) && /3030: Unable to add image\/, from: "1\.371\.0"/.test(src.ui));
  return out;
}

const SRC = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, read(p)]));
const base = checks(SRC);
let failed = 0;
for (const [pass, name] of base) if (!pass) { failed++; console.log(`  ✗ ${name}`); }
const MUT = [
  ["sec", "API Health counts every row again", "errors24h = rows.filter((r) => isLiveError(r.message, pkg.version)).length", "errors24h = rows.length"],
  ["shared", "the version stamp dropped", "`v${ENGINE_VERSION} ${message}`", "message"],
  ["index", "the version never set", "setEngineVersion(pkg.version);", ""],
];
let caught = 0;
if (!process.env.NOMUT) for (const [k, name, from, to] of MUT) {
  if (!SRC[k].includes(from)) { failed++; console.log(`  ✗ mutation did not apply: ${name}`); continue; }
  if (checks({ ...SRC, [k]: SRC[k].replace(from, to) }).some(([p]) => !p)) caught++; else { failed++; console.log(`  ✗ mutation not caught: ${name}`); }
}
if (failed) { console.log(`error-history: ${failed} failed`); process.exit(1); }
console.log(`error-history: ${base.length} checks passed${process.env.NOMUT ? "" : ` (${caught} mutations caught)`} - every error row carries its version; a fault of an older release is history on the Dashboard and in API Health`);
