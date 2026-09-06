#!/usr/bin/env node
/* Guard #54 — v1.125.0: a bordered box gets its surface from a NAME.
 *
 * The CEO, 06-09-2026, on the Inventory row: *"Some card-like inner rows use
 * borders and rounded corners inside real cards … without names, every
 * bordered rounded box competes visually with actual cards."*
 *
 * `card` in lib/ui-styles.ts already said "one padding, everywhere", and it
 * was true of everything that called it. The drift lived in the thirty
 * surfaces that never could: a rail widget, a dialog panel, a bottom sheet, a
 * detail box inside a card. None of them is a page card, so each one spelled
 * `rounded-?? border border-border bg-card p-?` by hand — five radii and four
 * paddings across the app, every one of them looking like a card that had got
 * it wrong. v1.125.0 gave them names (see the vocabulary comment in
 * ui-styles.ts) and converted them. This guard is what stops the thirty-first.
 *
 * THE RULE: in app/ and components/, a class string that combines
 * `border-border` + `bg-card` + a radius + padding must come from
 * lib/ui-styles.ts. Composition is fine and expected — `${modalCard}
 * max-h-[90vh]`, `${accentCard} border-t-brand` — what is banned is spelling
 * the surface out again.
 *
 * THE ALLOWLIST, each with a reason:
 *   sales.tsx (the document form)  those blocks are PAPER, deliberately. The
 *                                  Create-document form was shaped like the
 *                                  printed invoice in v1.120.0 so staff can
 *                                  see what they are filling in; a paper
 *                                  block that looked like a house card would
 *                                  undo the whole point of it.
 *   staff-directory.tsx (hero)     a decorative header — half-opacity border,
 *                                  translucent fill, backdrop blur, 24px
 *                                  radius. It is not a card and must not
 *                                  start looking like one.
 *   dashboard.tsx (quick action)   the quick-action tile: left-aligned with a
 *                                  min-height so two-line labels do not make
 *                                  the grid jump. tileCard is centred and
 *                                  content-height; this is its own shape.
 *   elfia-store-panel.tsx (toggle) the border and fill are CONDITIONAL — they
 *                                  are how the row shows on/off. It is state,
 *                                  drawn with the card's colours, not a card.
 *
 * It also holds the rule that started this: a card's own expandable detail
 * opens INSIDE the card, never as a sibling card. The Inventory status strip
 * broke a two-card row into three the moment somebody tapped "Low".
 *
 * Negative-tested by: hand-rolling a card surface in a panel; wrapping the
 * Inventory detail back in its own bordered box; restoring the component's
 * two-contract `fill` prop.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- 1. the vocabulary exists and is documented as one ---------------- */
const styles = read("lib/ui-styles.ts");
const NAMES = ["card", "compactCard", "insetCard", "accentCard", "tileCard", "modalCard", "sheetCard", "toastCard"];
for (const n of NAMES) {
  ok(`${n} is exported from lib/ui-styles.ts`, new RegExp(`export const ${n}\\s*=`).test(styles));
}
/* Named things that are never used are worse than no name: they read as the
   standard while the code does something else. */
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) { if (e !== "node_modules") walk(rel, out); }
    else if (/\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
};
const files = [...walk("app"), ...walk("components")];
const sources = new Map(files.map((f) => [f, read(f)]));
for (const n of NAMES) {
  const uses = [...sources.values()].filter((s) => new RegExp(`\\b${n}\\b`).test(s)).length;
  ok(`${n} is actually used`, uses > 0, "an unused name reads as the standard while the code does otherwise");
}
ok("the vocabulary is written down where the next person will read it",
   /THE CARD VOCABULARY/.test(styles) && NAMES.every((n) => new RegExp(`^\\s{5}${n}\\s`, "m").test(styles)));

/* ---- 2. nobody spells a card surface out by hand ---------------------- */
const SURFACE = /"[^"]*border-border[^"]*bg-card[^"]*"|"[^"]*bg-card[^"]*border-border[^"]*"|`[^`]*border-border[^`]*bg-card[^`]*`|`[^`]*bg-card[^`]*border-border[^`]*`/g;
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
/* Matched by what makes them exempt, not by line number. */
const EXEMPT = [
  { why: "the document form is paper, not a card", re: /rounded-md/ },
  { why: "the staff-directory hero is decorative", re: /backdrop-blur/ },
  { why: "the quick-action tile has its own shape", re: /min-h-\[64px\]/ },
  { why: "the ELFIA toggle draws state, not a card", re: /\$\{on \?/ },
];
const handRolled = [];
for (const [f, raw] of sources) {
  stripComments(raw).split("\n").forEach((line, i) => {
    SURFACE.lastIndex = 0;
    for (const m of line.match(SURFACE) ?? []) {
      if (!/rounded/.test(m)) continue;
      if (!/\bp-[\d.]|\bpx-[\d.]|\bpy-[\d.]|\bpt-[\d.]/.test(m)) continue;
      if (EXEMPT.some((e) => e.re.test(m))) continue;
      handRolled.push(`${f}:${i + 1} ${m.slice(0, 70)}`);
    }
  });
}
ok("no card surface is spelled out by hand — they come from lib/ui-styles.ts",
   handRolled.length === 0, handRolled.slice(0, 6).join(" | "));

/* ---- 3. the rule that started this ------------------------------------ */
const mon = read("components/portal/company-monitor.tsx");
const strip = mon.slice(mon.indexOf("export function InventoryStatusCard"));
const body = strip.slice(0, strip.indexOf("\n}\n") + 3);

ok("the status strip has ONE card contract, not two",
   /export function InventoryStatusCard\(\)/.test(body),
   "a `fill` prop meant the same component drew a house card or an inline pill");
ok("the strip IS the house card",
   /\$\{card\} w-full/.test(body));
/* The property: whatever the open state, the strip renders exactly one
   surface. A second `bg-card` inside it is the sibling mini-card returning. */
const surfaces = (body.match(/bg-card|\$\{card\}|\$\{compactCard\}|\$\{insetCard\}/g) ?? []).length;
ok("opening an item list does not add a second card to the row",
   surfaces === 1, `${surfaces} card surfaces in one component`);
ok("the items open inside the card, under a rule",
   /\{open && \(\s*<div className="border-border mt-3 border-t pt-3">/.test(body));

/* and the row it sits in is still a two-cell grid */
const panels = read("components/portal/role-panels.tsx");
const row = panels.slice(panels.indexOf('<ZoneLabel>{L("Stock now"'), panels.indexOf('<ZoneLabel>{L("Stock now"') + 1400);
ok("the Stock now row is two cells, whatever is expanded",
   /grid grid-cols-1 items-stretch gap-3[^"]*\$\{statusCard \? "md:grid-cols-2" : ""\}/.test(row));

console.log(`${failed ? "✗" : "✓"} card-vocabulary: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
