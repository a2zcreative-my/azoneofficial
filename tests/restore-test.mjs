/* v1.375.0 - THE MONTHLY RESTORE TEST NEVER TOUCHES THE LIVE DATABASE (the CEO, 18-11-2026:
   "Last restore test - Not recorded"; his answer "Yes, build it").

   scripts/restore-test.mjs (PUSH.bat restore-test) exports production, restores the export
   into a NEW temporary D1 database, counts every table, deletes the temporary database and
   writes ONE status row. These checks hold the safety of that script and the honesty of
   the System health tile that shows its result.

     node tests/restore-test.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const F = { script: "scripts/restore-test.mjs", push: "PUSH.bat", srv: "worker/src/security-status.ts", ui: "components/portal/security-status.tsx" };

function checks(src) {
  const out = [];
  const ok = (name, cond) => out.push([Boolean(cond), name]);
  const s = src.script;
  ok("the temporary database has its own name pattern, refused if it could be production", /const TEMP = `a2z-restore-test-\$\{stamp\}`;/.test(s) && /if \(TEMP === PROD \|\| !\/\^a2z-restore-test-\\d\{14\}\$\/\.test\(TEMP\)\)/.test(s));
  ok("the restore loads ONLY into the temporary database", /\["d1", "execute", TEMP, "--remote", "--yes", `--file=\$\{exportFile\}`\]/.test(s) && !/"d1", "execute", PROD[^\]]*--file/.test(s));
  ok("only the temporary database is ever deleted", /\["d1", "delete", TEMP,/.test(s) && !/"d1", "delete", PROD/.test(s));
  ok("production is only exported (a read) and given one status row", /\["d1", "export", PROD, "--remote"/.test(s) && /if \(db === PROD && !\/\^\\s\*\(SELECT\|INSERT INTO system_meta\)\/i\.test\(sql\)\) throw/.test(s) && /INSERT INTO system_meta \(key, value\) VALUES \('restore_test_last'/.test(s));
  ok("the temporary database is deleted in finally - also after a failure", /\} finally \{[\s\S]*\["d1", "delete", TEMP,/.test(s));
  ok("the export (every record, bank details included) is deleted when the test ends", /\} finally \{[\s\S]*rmSync\(exportFile, \{ force: true \}\)/.test(s));
  ok("a config change by d1 create is put back", /if \(readFileSync\(tomlPath, "utf8"\) !== tomlBefore\) \{ writeFileSync\(tomlPath, tomlBefore\);/.test(s));
  ok("PASSED only when every table's count equals the export and none is missing", /const passed = diffs\.length === 0 && missing\.length === 0 && names\.length > 0;/.test(s));
  ok("PUSH.bat restore-test runs it and publishes nothing", /if \/I "%~1"=="restore-test" \(\n  pushd "%PORTAL%"\n  call node scripts\\restore-test\.mjs[\s\S]*?exit \/b !RT_EXIT!\n\)/.test(src.push));
  ok("System health reads the recorded row, never invents one", /key = 'restore_test_last'/.test(src.srv) && /restore_test: restoreTest/.test(src.srv) && !/restoreRecorded = false/.test(src.ui));
  ok("the tile says Not recorded / Failed / Due / Passed from that row", /L\("Not recorded", "Tidak direkodkan"\)/.test(src.ui) && /L\("Failed", "Gagal"\)/.test(src.ui) && /L\("Due", "Perlu diuji"\)/.test(src.ui) && /L\("Passed", "Lulus"\)/.test(src.ui) && /rtAge > 45 \* 24/.test(src.ui));
  return out;
}

const SRC = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, read(p)]));
const base = checks(SRC);
let failed = 0;
for (const [pass, name] of base) if (!pass) { failed++; console.log(`  ✗ ${name}`); }
const MUT = [
  ["script", "the restore loaded into production", '["d1", "execute", TEMP, "--remote", "--yes", `--file=${exportFile}`]', '["d1", "execute", PROD, "--remote", "--yes", `--file=${exportFile}`]'],
  ["script", "production deleted instead", '["d1", "delete", TEMP, "--skip-confirmation"]', '["d1", "delete", PROD, "--skip-confirmation"]'],
  ["script", "passed despite a mismatch", "const passed = diffs.length === 0 && missing.length === 0 && names.length > 0;", "const passed = true;"],
  ["script", "any write to production allowed", 'if (db === PROD && !/^\\s*(SELECT|INSERT INTO system_meta)/i.test(sql)) throw', "if (false) throw"],
  ["ui", "the tile invents a pass", 'L("Passed", "Lulus")', 'L("OK", "OK")'],
];
let caught = 0;
if (!process.env.NOMUT) for (const [k, name, from, to] of MUT) {
  if (!SRC[k].includes(from)) { failed++; console.log(`  ✗ mutation did not apply: ${name}`); continue; }
  if (checks({ ...SRC, [k]: SRC[k].replace(from, to) }).some(([p]) => !p)) caught++; else { failed++; console.log(`  ✗ mutation not caught: ${name}`); }
}
if (failed) { console.log(`restore-test: ${failed} failed`); process.exit(1); }
console.log(`restore-test: ${base.length} checks passed${process.env.NOMUT ? "" : ` (${caught} mutations caught)`} - the monthly restore test loads and deletes only a temporary database, writes production one status row, and the tile shows only what it recorded`);
