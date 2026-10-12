/** Browser-free tests for orchestration; these are NOT a WebKit sweep. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { scenarios, runProcess, probePassed, startFixture } from "../scripts/run-browser-checks.mjs";
import { fixture } from "./browser/fixture.mjs";

const good = { code: 0, timedOut: false, error: null, output: 'BROWSER_PROBE_COMPLETE {"findings":0}\n' };
assert.equal(probePassed(good), true);
for (const patch of [
  { code: 1 }, { code: null }, { timedOut: true }, { error: "spawn failed" },
  { output: "" }, { output: 'BROWSER_PROBE_COMPLETE {"findings":1}\n' },
  { output: good.output + "skip Sales\n" }, { output: good.output + good.output },
  { output: "BROWSER_PROBE_COMPLETE invalid\n" },
]) assert.equal(probePassed({ ...good, ...patch }), false);
const matrix = await scenarios();
assert.equal(matrix.length, 24);
assert.equal(new Set(matrix.map(s => [s.role,s.width,s.lang,s.theme].join('/'))).size, 24);
assert.equal((await scenarios(true)).length, 1);
for (const s of matrix) {
  assert.ok(s.tabs.length > 0);
  assert.ok(!s.tabs.includes("Threads"));
  if (s.lang === "ms") assert.ok(s.tabs.includes("Papan Pemuka") && s.tabs.includes("Syif Saya"));
}
assert.ok(matrix.find(s => s.role === "ceo" && s.lang === "en").tabs.length > matrix.find(s => s.role === "live_host" && s.lang === "en").tabs.length);
assert.equal((await runProcess(process.execPath, ["-e", "process.exit(3)"])).code, 3);
assert.ok((await runProcess("definitely-not-a-browser-test-command", [], { timeoutMs: 1000 })).error);
assert.equal((await runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 })).timedOut, true);
const missing = [];
fixture("/auth/me", undefined, { onMissing: p => missing.push(p) });
fixture("/staff/inventory", undefined, { onMissing: p => missing.push(p) });
assert.deepEqual(missing, []);
fixture("/unimplemented-for-test", undefined, { onMissing: p => missing.push(p) });
assert.deepEqual(missing, ["/unimplemented-for-test"]);
const dir = mkdtempSync(join(tmpdir(), "browser-harness-"));
let server;
try {
  writeFileSync(join(dir, "portal.html"), "<main>synthetic</main>");
  server = await startFixture(dir, "live_host");
  assert.equal(await fetch(server.url + "/portal").then(r => r.text()), "<main>synthetic</main>");
  assert.equal((await fetch(server.url + "/api/v1/auth/me").then(r => r.json())).user.role, "live_host");
  await fetch(server.url + "/api/v1/unimplemented-for-test");
  const coverage = await fetch(server.url + "/__fixture-status").then(r => r.json());
  assert.equal(coverage.role, "live_host");
  assert.deepEqual(coverage.missing, ["/unimplemented-for-test"]);
} finally {
  server?.stop();
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  rmSync(dir, { recursive: true, force: true });
}
console.log("browser-harness: matrix, translations, failed/incomplete/skipped probes, timeout, missing tools and fixture coverage passed; no browser sweep performed");
