#!/usr/bin/env node
/* Guard #53 — v1.124.0: live UI says good / bad / needs-attention in TOKENS.
 *
 * The CEO's audit, 06-09-2026: *"standardizing all live UI status/callout
 * styling through lib/ui-styles.ts and the CSS semantic tokens; that will
 * remove most of the visible drift in one pass."*
 *
 * v1.5.0 introduced --success / --warning / --danger / --info and counted 338
 * raw palette classes to replace. The replacement was never finished, and
 * unfinished is the worst state to leave it in: a screen where two chips that
 * mean the same thing are different greens is worse than one where they are
 * both the same wrong green, because the difference reads as meaning. v1.124.0
 * converted the remaining 180. This guard is the ratchet — it exists so the
 * 181st is never written.
 *
 * THE RULE: in app/ and components/, a Tailwind class naming a raw colour
 * family (bg-green-600, text-amber-700, border-red-200, dark:bg-emerald-950…)
 * is a failure. Say it with a token: bg-success-soft / text-success,
 * bg-warning-soft / text-warning, bg-danger-soft / text-danger, bg-info-soft /
 * text-info, bg-plan / bg-celebrate-soft, or one of the chip helpers in
 * lib/ui-styles.ts. Tokens are theme-aware, so a converted chip also stops
 * being a bright block on a dark card — the second half of the same audit.
 *
 * THE ALLOWLIST — the raw colours that stay, each with a reason. This list is
 * the interesting part of the guard; adding to it should feel expensive.
 *
 *   WhatsApp green (sales.tsx)     a brand mark. The button is green because
 *                                  WhatsApp is green, not because sending a
 *                                  message went well. --success would make it
 *                                  a different green than the one customers
 *                                  recognise on the icon beside it.
 *   EVENT_COLORS (events.tsx)      a categorical palette: training / class /
 *                                  meeting / event. None of them is good or
 *                                  bad. Tokenising them would make the
 *                                  calendar claim a meeting is a warning.
 *   solid attention badges         bg-amber-500 with white text on the
 *                                  notification bell, unread counts and the
 *                                  announcements dot. --warning is an INK
 *                                  colour (#946300, tuned for 4.66:1 as text
 *                                  on a soft chip); as a solid fill under
 *                                  white text it is unreadable. The tile
 *                                  tokens exist for solid fills but there is
 *                                  no --tile-warning, and inventing one for
 *                                  five badges is a bigger change than this
 *                                  audit called for. Left as a known gap.
 *
 * Negative-tested by: adding `bg-emerald-100 text-emerald-800` to a panel;
 * adding a `dark:text-red-400`; putting a green back into a converted chip;
 * stripping both the wa.me href and the "WhatsApp" label from the button
 * that carries the green (the exemption reads the whole element, so either
 * piece of evidence is enough on its own).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const FAMILIES = "green|emerald|teal|lime|amber|yellow|orange|red|rose|pink|blue|sky|indigo|cyan|violet|purple|fuchsia";
const PROPS = "bg|text|border|ring|fill|stroke|from|to|via|decoration|outline|accent|shadow|divide|placeholder";
const RAW = new RegExp(`\\b(?:dark:)?(?:${PROPS})-(?:${FAMILIES})-\\d{2,3}\\b`, "g");

/* Allowlisted by WHAT MAKES THEM EXEMPT, never by line number — a line number
   is a promise the next edit breaks. `scope: "near"` widens the test to the
   surrounding element, because the thing that justifies the colour (the wa.me
   href) is a few lines below the className that carries it. */
const EXEMPT = [
  { why: "the WhatsApp brand mark", scope: "near", re: /wa\.me|whatsapp/i },
  { why: "EVENT_COLORS, a categorical palette", scope: "line", re: /^\s*(training|class|meeting|event):\s*"bg-/ },
  { why: "solid attention badge, white text on it", scope: "line", re: /bg-amber-500(?![-\w])(?![\s\S]*text-amber)/ },
];

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) { if (e !== "node_modules") walk(rel, out); }
    else if (/\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
};
/* Blank the comments but KEEP the line count, so a reported line number is
   the line the author will find in their editor. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");

const offenders = [];
let exempted = 0;
for (const f of [...walk("app"), ...walk("components")]) {
  const lines = stripComments(read(f)).split("\n");
  lines.forEach((line, i) => {
    RAW.lastIndex = 0;
    if (!RAW.test(line)) return;
    RAW.lastIndex = 0;
    const near = lines.slice(Math.max(0, i - 4), i + 7).join("\n");
    if (EXEMPT.some((e) => e.re.test(e.scope === "near" ? near : line))) { exempted++; return; }
    RAW.lastIndex = 0;
    offenders.push(`${f}:${i + 1} ${line.match(RAW).join(" ")}`);
  });
}

ok("no live UI paints a status with a raw Tailwind colour",
   offenders.length === 0,
   offenders.slice(0, 8).join(" | ") + (offenders.length > 8 ? ` … +${offenders.length - 8}` : ""));
ok("the allowlist is still doing work, not quietly covering everything",
   exempted > 0 && exempted < 20, `${exempted} exempt lines`);

/* ---- the token names are spelled correctly -------------------------- */
/* v1.124.0 — caught in the production CSS, not here: a bulk rename turned
   `bg-pink-500` into `bg-celebrate-soft0`, because `bg-pink-50` was replaced
   first and ate the prefix. Tailwind emits nothing for a class it does not
   recognise, so the birthday dots simply had no colour and every test above
   still passed. A misspelt token is invisible in a way a raw colour is not,
   which makes it worth its own check. */
const FAMS = "success|warning|danger|info|plan|celebrate|destructive|primary|secondary|muted|accent|border|card|popover";
const BAD = new RegExp(`\\b(?:${PROPS})-(?:${FAMS})(?:-soft)?[0-9]+\\b|\\b(?:${PROPS})-(?:${FAMS})-soft-\\w+`, "g");
const mangled = [];
for (const f of [...walk("app"), ...walk("components")]) {
  const lines = stripComments(read(f)).split("\n");
  lines.forEach((line, i) => {
    BAD.lastIndex = 0;
    const m = line.match(BAD);
    if (m) mangled.push(`${f}:${i + 1} ${m.join(" ")}`);
  });
}
ok("no token name was mangled by a rename — Tailwind emits nothing for those, silently",
   mangled.length === 0, mangled.slice(0, 6).join(" | "));

/* ---- the tokens the converted UI now depends on --------------------- */
const css = read("styles/globals.css");
const darkAt = css.indexOf(".dark {");
for (const fam of ["success", "warning", "danger", "info", "plan", "celebrate"]) {
  const light = new RegExp(`^\\s*--${fam}:`, "m").test(css.slice(0, darkAt));
  const soft = new RegExp(`^\\s*--${fam}-soft:`, "m").test(css.slice(0, darkAt));
  const dark = new RegExp(`^\\s*--${fam}:`, "m").test(css.slice(darkAt));
  const darkSoft = new RegExp(`^\\s*--${fam}-soft:`, "m").test(css.slice(darkAt));
  ok(`--${fam} is a complete pair in BOTH themes`, light && soft && dark && darkSoft,
     [light ? "" : "light", soft ? "" : "light-soft", dark ? "" : "dark", darkSoft ? "" : "dark-soft"].filter(Boolean).join(","));
  ok(`--${fam} reaches Tailwind as a utility`,
     new RegExp(`--color-${fam}:\\s*var\\(--${fam}\\)`).test(css)
     && new RegExp(`--color-${fam}-soft:\\s*var\\(--${fam}-soft\\)`).test(css));
}

/* ---- the chip helpers stay the one way to spell a chip -------------- */
const styles = read("lib/ui-styles.ts");
for (const chip of ["chipNeutral", "chipSuccess", "chipWarn", "chipDanger", "chipInfo"]) {
  ok(`${chip} is still exported from lib/ui-styles.ts`, new RegExp(`export const ${chip}\\b`).test(styles));
}
/* Each helper's own definition, not a fixed window after the first one — the
   fixed window silently stopped covering the later helpers as the file grew. */
const rawChips = ["chip", "chipNeutral", "chipSuccess", "chipWarn", "chipDanger", "chipInfo"]
  .map((c) => [c, styles.match(new RegExp(`export const ${c} = [^;]+;`))?.[0] ?? ""])
  .filter(([, def]) => new RegExp(`(?:${PROPS})-(?:${FAMILIES})-\\d`).test(def));
ok("the chip helpers are themselves written in tokens",
   rawChips.length === 0, rawChips.map(([c]) => c).join(","));

console.log(`${failed ? "✗" : "✓"} status-tokens: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
