#!/usr/bin/env node
/* Guard #55 — v1.126.0: rendered UI draws icons, not emoji.
 *
 * The CEO's icon audit, 06-09-2026: emoji in the navigation, in card headings,
 * on action buttons, in status messages. Three of those four were real and are
 * fixed. The first — *"probably the biggest professionalism issue because
 * navigation is always visible"* — was already fixed in v1.16.0; what he read
 * was the DEPRECATED `ICONS` map that v1.16.0 left behind in sidebar-nav.tsx,
 * which no file imported and which rendered nowhere. Dead code that survives a
 * migration gets read as current. It is deleted, and that is half the point of
 * this guard existing: the next audit should be able to trust what it greps.
 *
 * THE RULE:
 *
 *   An emoji that DECORATES rendered UI becomes an <AppIcon>.
 *   An emoji that IS CONTENT stays an emoji.
 *
 * Content is text that leaves the app for somewhere React cannot follow — a
 * CSV cell, a printed claim form, the public marketing pages. An <svg> in a
 * CSV is a broken cell, so the rule is not "no emoji", it is "no emoji where
 * an icon would have worked".
 *
 * A trap worth naming, because it caught two strings here: a sentence that
 * refers to a BUTTON by its glyph ("press 💸 Mark paid", "the 💳 button now
 * fills them in") stops making sense the moment the button becomes an icon.
 * Those were rewritten to name the button in words, which is what a person
 * reading a toast can actually match against the screen.
 *
 * Typographic marks are NOT emoji and are deliberately untouched: → ✓ ✕ ▲ ▼ ↩
 * ≡ ◷ ☑ ☐. They are punctuation doing a job, they are monochrome, and they
 * inherit colour already. The rating star (\u2605) left this set in v1.152.2 -
 * see the check below.
 *
 * ALLOWLIST — the pictographs that stay, each with its reason:
 *   home/showcase.tsx, live-showcase.tsx   the public marketing pages. Those
 *                                          emoji are a drawing of a chat
 *                                          window; they are the content.
 *   role-panels.tsx (printed claim form)   `☑ Yes` inside a document written
 *                                          into a print window — no React.
 *   purchasing-panels StatTile icon=""     a set of typographic tile marks
 *                                          (≡ ◷ $ ⚖) that read as one set.
 *   sales.tsx stock-note builder           returns a STRING joined into other
 *                                          text; there is no element to hang
 *                                          an icon on.
 *
 * Negative-tested by: putting an emoji back in a card heading; re-adding the
 * ICONS map to sidebar-nav; using a raw lucide icon instead of AppIcon in a
 * panel; pointing a PanelTitle at an icon name the map does not have.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". These
   guards had only ever run in Cloudflare's Linux build container, where the
   two happen to be the same string; the day PUSH.bat started running them on
   the CEO's own PC, 49 of them failed at once on a bug that was never about
   the code they check. */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* Pictographs only. The typographic marks above are deliberately absent. */
/* \u2605/\u2606 (\u2605 \u2606) are rating stars — typographic, not pictographic. */
const PICTO = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{2604}\u{2607}-\u{26FF}]|[\u{2705}\u{274C}\u{23F0}-\u{23F3}\u{2B06}\u{2B07}]/u;
/* Block comments blanked line-for-line, and line comments wherever they sit —
   a trailing `// … 🔐 card` is a comment too. The `(?<!:)` keeps `https://`
   from being read as one. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(?<!:)\/\/.*$/gm, "");

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) { if (e !== "node_modules") walk(rel, out); }
    else if (/\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
};
const files = [...walk("app"), ...walk("components")];

/* Allowlisted by WHAT MAKES THEM CONTENT, never by line number. */
const EXEMPT = [
  { why: "the public marketing pages draw a chat window", re: /^components\/home\// , file: true },
  { why: "written into a print window — no React there", line: /document\.write|<td class=|<tr>/ },
  { why: "a set of typographic tile marks", line: /icon="[^"]"/ },
  { why: "joined into a string, no element to hang an icon on", line: /^\s*L?\(?`?[⚠] ?(NOT in inventory|TIADA|short|kurang)/ },
];

const offenders = [];
for (const f of files) {
  if (EXEMPT.some((e) => e.file && e.re.test(f))) continue;
  stripComments(read(f)).split("\n").forEach((line, i) => {
    if (!PICTO.test(line)) return;
    if (EXEMPT.some((e) => e.line && e.line.test(line.trim()))) return;
    offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 70)}`);
  });
}
ok("rendered UI carries no emoji — it carries icons",
   offenders.length === 0,
   offenders.slice(0, 6).join(" | ") + (offenders.length > 6 ? ` … +${offenders.length - 6}` : ""));

/* v1.152.2 (CEO, 11-09-2026: "star rate should use svg!"). A RATING STAR is
   a drawing after all: it is a picture of how much somebody liked a thing,
   and a font's \u2605 is a different picture on every phone. It leaves the
   typographic set above and becomes the `star` icon everywhere it is
   rendered. A dialog message or an <option> - places that cannot hold an
   SVG - say it in words ("4/5", "5 stars") instead. */
const stars = [];
for (const f of files) {
  stripComments(read(f)).split("\n").forEach((line, i) => {
    if (/[\u2605\u2606]/.test(line)) stars.push(`${f}:${i + 1} ${line.trim().slice(0, 70)}`);
  });
}
ok("a rating star is the SVG star, never the \u2605 glyph",
   stars.length === 0,
   stars.slice(0, 6).join(" | ") + (stars.length > 6 ? ` … +${stars.length - 6}` : ""));

/* ---- the dead map that misled the audit is gone --------------------- */
const sidebar = read("components/layout/sidebar-nav.tsx");
ok("sidebar-nav no longer carries a glyph map",
   !/export const ICONS/.test(sidebar),
   "a deprecated export nobody deletes gets read as current — this one was");
ok("the rails still render the SVG icon component", /<TabIcon name=/.test(sidebar));

/* ---- one map, and every name in it resolves ------------------------- */
const iconFile = read("components/ui/app-icon.tsx");
const known = new Set([...iconFile.matchAll(/^\s{2}(\w+):\s*\w+,/gm)].map((m) => m[1]));
ok("the icon map is a real map", known.size >= 30, `${known.size} names`);

const used = new Set();
for (const f of files) {
  const body = stripComments(read(f));
  for (const m of body.matchAll(/<AppIcon\s+name="(\w+)"/g)) used.add(m[1]);
  for (const m of body.matchAll(/<PanelTitle\s+icon="(\w+)"/g)) used.add(m[1]);
  for (const m of body.matchAll(/icon:\s*"(\w+)"[,\s]/g)) if (/AppIconName|app-icon/.test(body)) used.add(m[1]);
}
const unknown = [...used].filter((n) => !known.has(n));
ok("every icon a screen asks for exists in the map", unknown.length === 0, unknown.join(","));
ok("the map is being used", used.size >= 20, `${used.size} distinct icons on screen`);

/* ---- nobody reaches past the map ------------------------------------ */
/* A panel importing lucide directly is how a second icon set starts: a
   different size, a different stroke, and no one place to change either. */
/* Scoped to the SIGNED-IN surfaces. The public marketing pages have their own
   look and their own icons and are not part of this system. */
const SIGNED_IN = /^(app\/(portal|admin|account)\/|components\/(portal|admin|staff|security)\/)/;
const direct = files.filter((f) => SIGNED_IN.test(f) && /from "lucide-react"/.test(stripComments(read(f))));
ok("no signed-in screen imports lucide directly — it goes through AppIcon",
   direct.length === 0, direct.join(", "));

/* ---- one size, one weight ------------------------------------------- */
ok("AppIcon fixes the size and the stroke in one place",
   /h-4 w-4/.test(iconFile) && /strokeWidth=\{1\.75\}/.test(iconFile));
ok("AppIcon is always aria-hidden — the word beside it is the label",
   /<Glyph aria-hidden/.test(iconFile));
ok("PanelTitle renders the same heading with or without an icon",
   /text-sm font-semibold/.test(iconFile) && /icon \?/.test(iconFile));

/* ---- the trap: prose that named a button by its glyph --------------- */
const prose = [...files].map((f) => stripComments(read(f))).join("\n");
ok("no message tells somebody to press a glyph that is no longer on screen",
   !/press\s+[\u{1F300}-\u{1FAFF}]|the\s+[\u{1F300}-\u{1FAFF}]\s+button/u.test(prose));

console.log(`${failed ? "✗" : "✓"} app-icons: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
