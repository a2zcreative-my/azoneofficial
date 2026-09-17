import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function git(repo, args, allowed = [0]) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true });
  if (result.error || !allowed.includes(result.status)) {
    throw new Error(result.error?.message || result.stderr?.trim() || `git ${args[0]} failed (${result.status})`);
  }
  return { code: result.status, output: result.stdout.trim() };
}

export function saveAndPush(repo, message, run = git) {
  const branch = run(repo, ["symbolic-ref", "--short", "HEAD"]).output;
  const remote = run(repo, ["config", "--get", `branch.${branch}.remote`]).output;
  const merge = run(repo, ["config", "--get", `branch.${branch}.merge`]).output;
  if (!remote || remote === "." || !merge.startsWith("refs/heads/")) throw new Error("A remote tracking branch is required");
  run(repo, ["add", "-A"]);
  const staged = run(repo, ["diff", "--cached", "--quiet"], [0, 1]);
  if (staged.code === 1) run(repo, ["commit", "-m", message]);
  run(repo, ["push", remote, `HEAD:${merge}`]);
  const local = run(repo, ["rev-parse", "HEAD"]).output;
  const remoteHead = run(repo, ["ls-remote", "--exit-code", remote, merge]).output.split(/\s+/)[0];
  if (local !== remoteHead) throw new Error("The remote revision does not match the deployed checkout");
  return local;
}

export async function verifyHealth(url, request = fetch) {
  const response = await request(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
  const health = await response.json();
  const required = url.includes("elfiaofficialstore.my") ? ["ok", "db", "r2", "migrations_current"] : ["ok", "db"];
  if (required.some(key => health[key] !== true)) throw new Error(`Health check failed: ${required.filter(key => health[key] !== true).join(", ")}`);
  return health;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, target, message] = process.argv.slice(2);
    if (mode === "save") console.log(`GitHub verified: ${saveAndPush(target, message)}`);
    else if (mode === "health") console.log(JSON.stringify(await verifyHealth(target)));
    else throw new Error("Usage: verify-release.mjs save <repository> <message> | health <url>");
  } catch (error) {
    console.error(`Release verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
