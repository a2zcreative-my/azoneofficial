/** Linux WebKitGTK matrix runner. No deployments or production requests. */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const children = new Set();
function managedSpawn(...args) { const child = spawn(...args); children.add(child); child.once("close", () => children.delete(child)); return child; }
process.once("exit", () => { for (const child of children) stop(child); });
const python = process.env.BROWSER_PYTHON || "python3";
const probes = ["webkit-overflow.py", "table-shred.py", "ui-audit.py", "a11y-audit.py"];
const loadTs = async file => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(readFileSync(join(root, file), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString("base64")}`);
export async function scenarios(smoke = false) {
  const { ALL_TABS, canSeeTab } = await loadTs("lib/portal-tabs.ts");
  const { t } = await loadTs("lib/i18n.ts");
  const result = [];
  for (const role of ["ceo", "sales_marketing", "live_host"])
    for (const width of [390, 1280]) for (const lang of ["en", "ms"]) for (const theme of ["light", "dark"])
      result.push({ role, width, lang, theme, tabs: ALL_TABS.filter(tab => canSeeTab(role, tab)).map(tab => t(tab, lang)) });
  return smoke ? result.slice(0, 1) : result;
}
function stop(child) {
  try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill(); } catch { /* already stopped */ }
}
export function runProcess(command, args, { env = process.env, timeoutMs = 600000, cwd = root } = {}) {
  return new Promise(resolveResult => {
    const child = managedSpawn(command, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== "win32" });
    let output = "", timedOut = false, error = null;
    child.stdout?.on("data", data => { output += data; });
    child.stderr?.on("data", data => { output += data; });
    child.on("error", e => { error = e.message; });
    const timer = setTimeout(() => { timedOut = true; stop(child); }, timeoutMs);
    child.on("close", code => { clearTimeout(timer); stop(child); resolveResult({ code, timedOut, error, output }); });
  });
}
export function probePassed(result) {
  if (result.error || result.timedOut || result.code !== 0) return false;
  const matches = [...result.output.matchAll(/^BROWSER_PROBE_COMPLETE (.+)$/gm)];
  if (matches.length !== 1 || /\bskip(?:ped)?\b|not judged/i.test(result.output)) return false;
  try { return JSON.parse(matches[0][1]).findings === 0; } catch { return false; }
}
export function startFixture(dir, role) {
  return new Promise((resolveReady, reject) => {
    const child = managedSpawn(process.execPath, [join(root, "tests/browser/serve.mjs"), dir, "0"], { cwd: root, env: { ...process.env, ROLE: role }, windowsHide: true, detached: process.platform !== "win32" });
    let output = "", ready = false;
    const timer = setTimeout(() => { stop(child); reject(new Error("Fixture startup timed out")); }, 15000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); if (!ready) reject(new Error(`Fixture exited ${code}: ${output}`)); });
    child.stderr.on("data", data => { output += data; });
    child.stdout.on("data", data => {
      output += data;
      const match = output.match(/BROWSER_FIXTURE_READY (\d+)/);
      if (match && !ready) { ready = true; clearTimeout(timer); resolveReady({ url: `http://127.0.0.1:${match[1]}`, stop: () => stop(child) }); }
    });
  });
}
async function main() {
  const args = process.argv.slice(2);
  const reportDir = join(root, "browser-results"); mkdirSync(reportDir, { recursive: true });
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).stdout?.trim() ?? null;
  const report = { started_at: new Date().toISOString(), commit: git("rev-parse", "HEAD"), worktree: git("status", "--short"), scope: args.includes("--smoke") ? "smoke" : "full", status: "running", results: [] };
  const interrupted = () => {
    report.status = "failed"; report.error = "Browser run interrupted"; report.finished_at = new Date().toISOString();
    writeFileSync(join(reportDir, "latest.json"), JSON.stringify(report, null, 2) + "\n"); process.exit(130);
  };
  process.once("SIGINT", interrupted); process.once("SIGTERM", interrupted);
  try {
    if (!report.commit) throw new Error("Cannot identify the Git commit being tested");
    if (args.some(a => a !== "--smoke")) throw new Error("Usage: node scripts/run-browser-checks.mjs [--smoke]");
    if (process.platform !== "linux") throw new Error("WebKitGTK checks require Linux with Xvfb, WebKitWebDriver, MiniBrowser and Python Selenium. No browser checks ran.");
    for (const [command, flags] of [["xvfb-run", ["--help"]], ["WebKitWebDriver", ["--version"]], [python, ["-c", "import selenium"]]]) {
      const result = await runProcess(command, flags, { timeoutMs: 15000 });
      if (result.code !== 0 || result.error || result.timedOut) throw new Error(`Missing or unusable prerequisite: ${command}\n${result.output}`);
    }
    if (!existsSync("/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser")) throw new Error("MiniBrowser is missing at the probes' required Linux path.");
    const build = await runProcess(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "build"], { timeoutMs: 600000 });
    writeFileSync(join(reportDir, "build.log"), build.output);
    if (build.code !== 0 || build.error || build.timedOut) throw new Error("Fresh production build failed; see build.log");
    for (const scenario of await scenarios(args.includes("--smoke"))) {
      const id = `${scenario.role}-${scenario.width}-${scenario.lang}-${scenario.theme}`;
      console.log(`Browser scenario: ${id}`);
      const fixture = await startFixture(join(root, "out"), scenario.role);
      try {
        for (const probe of probes) {
          const result = await runProcess("xvfb-run", ["-a", python, join(root, "tests/browser", probe)], { env: { ...process.env, PYTHONUNBUFFERED: "1", PREVIEW_URL: fixture.url, WIDTH: String(scenario.width), LANG_UI: scenario.lang, THEME: scenario.theme, TABS: scenario.tabs.join(",") } });
          const log = `${id}-${probe}.log`; writeFileSync(join(reportDir, log), result.output);
          const coverage = await fetch(fixture.url + "/__fixture-status", { signal: AbortSignal.timeout(5000) }).then(r => r.json());
          const passed = probePassed(result) && coverage.role === scenario.role && coverage.missing.length === 0;
          report.results.push({ scenario: id, probe, passed, log, code: result.code, timedOut: result.timedOut, error: result.error, missing_fixtures: coverage.missing });
          if (!passed) throw new Error(`Browser check failed: ${id} / ${probe}; see ${log}`);
        }
      } finally { fixture.stop(); }
    }
    report.status = "passed";
  } catch (error) { report.status = "failed"; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { report.finished_at = new Date().toISOString(); writeFileSync(join(reportDir, "latest.json"), JSON.stringify(report, null, 2) + "\n"); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
