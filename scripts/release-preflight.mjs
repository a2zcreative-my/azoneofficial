#!/usr/bin/env node
/**
 * Shared release handoff check used by PUSH.bat.
 *
 * The default is deliberately strict: a deploy must not clean, commit, or
 * publish a worktree while another contributor may still be editing it.
 * `--allow-dirty` is an explicit, auditable escape hatch for an approved
 * emergency release.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const root = resolve(valueAfter("--root") ?? process.cwd());
const role = valueAfter("--role") ?? "portal";
const allowDirty = args.includes("--allow-dirty");
const fail = (message) => {
  console.error(`\n[X] RELEASE PREFLIGHT FAILED: ${message}`);
  process.exitCode = 1;
};

if (!existsSync(resolve(root, ".git"))) {
  fail(`no Git repository found at ${root}`);
  process.exit();
}

if (role === "portal") {
  for (const file of ["CLAUDE.md", "docs/PROJECT-STATE.md", "CHANGELOG.md", "PUSH.bat"]) {
    if (!existsSync(resolve(root, file))) fail(`required handoff file is missing: ${file}`);
  }
}

let status = "";
try {
  status = execFileSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch {
  fail(`could not read Git status at ${root}`);
  process.exit();
}

if (status && !allowDirty) {
  console.error("\n[X] RELEASE PREFLIGHT FAILED: the worktree is not clean.");
  console.error("    Another contributor may still be editing these files:");
  console.error(status);
  console.error("    Review, commit, or intentionally hand off the changes first.");
  console.error("    Emergency override: PUSH.bat allow-dirty");
  process.exitCode = 1;
  process.exit();
}

if (status && allowDirty) {
  console.warn("\n[!] Dirty worktree explicitly allowed by the caller:");
  console.warn(status);
}

if (role === "portal") {
  const state = readFileSync(resolve(root, "docs/PROJECT-STATE.md"), "utf8");
  if (!state.includes("Release status:")) fail("docs/PROJECT-STATE.md has no release status marker");
  if (!state.includes("Production:")) fail("docs/PROJECT-STATE.md has no production version marker");
}

if (!process.exitCode) console.log(`[ok] release preflight passed (${role})`);
