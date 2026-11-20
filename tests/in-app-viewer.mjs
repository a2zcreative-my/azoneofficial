// v1.391.0 - a file the portal holds opens INSIDE the page (the shared viewer, Back returns
// to the record), never in a new tab. The owner, 20-11-2026: "when I view the screenshot, it
// opens new tabs instead of reviewing in the same tab and returning after review".
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, never URL.pathname: on Windows .pathname is "/C:/..." and join() made "C:\\C:\\..." (the 20-11-2026 push)
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let failed = 0, passed = 0;
const check = (ok, name) => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } };
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
});
const files = ["components", "app/portal", "app/admin", "app/account"].flatMap((d) => { try { return walk(join(ROOT, d)); } catch { return []; } });

// 1. No anchor to a held file opens a new tab.
const bad = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    const href = /href=\{([^}]*)\}/.exec(m[0])?.[1] ?? "";
    if (/\/api\/v1\/|fileUrl\(|fileSrc\(|fileHref\(|\/cards\/.*\.png/.test(href) || href === "src" || href === "url")
      bad.push(`${relative(ROOT, f)}: ${m[0].slice(0, 90)}`);
  }
}
check(bad.length === 0, `no portal file link opens a new tab${bad.length ? " - " + bad.join(" | ") : ""}`);

// 2. The places that open files use the one viewer.
const USES = ["live-reports.tsx", "task-progress.tsx", "agents-panel.tsx", "tasks5.tsx", "leave.tsx", "finance-panels.tsx", "project-workspace.tsx", "chat/chat-panel.tsx", "cards-panel.tsx"];
for (const u of USES) {
  const s = readFileSync(join(ROOT, "components/portal", u), "utf8");
  check(/from "@\/components\/ui\/open-file"/.test(s) && /onClick=\{viewFile\(/.test(s), `${u} opens its files in the in-page viewer`);
}

// 3. The helper: a plain click previews, a modified click keeps the browser's behaviour.
const h = readFileSync(join(ROOT, "components/ui/open-file.ts"), "utf8");
check(/openDocumentPreview\(/.test(h) && /credentials: "same-origin"/.test(h), "openFile reads the file with the session and shows it in the shared viewer");
check(/e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey/.test(h) && /e\.preventDefault\(\)/.test(h), "a modified click is left to the browser; a plain click stays on the page");
check(!/window\.open|target/.test(h), "the helper never opens a window");
const v = readFileSync(join(ROOT, "components/ui/document-preview.tsx"), "utf8");
check(/This file cannot be shown here\. Use Download/.test(v), "a file the viewer cannot draw says so and offers Download");
check(/history\.pushState/.test(readFileSync(join(ROOT, "components/ui/app-dialog.tsx"), "utf8")), "the viewer takes the Back button, so Back returns to the record");

console.log(`\nin-app-viewer: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
