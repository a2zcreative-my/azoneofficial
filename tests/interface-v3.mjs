#!/usr/bin/env node
/* Guard #92 - v1.172.1: PORTAL INTERFACE SYSTEM V3 - the migration boundary.
 *
 * The portal has an in-house design system now: named classes in
 * styles/erp-v3.css, exposed to TypeScript through lib/ui-styles.ts.
 * Tailwind stays as a compatibility layer for the surfaces that have not
 * been migrated. This guard keeps the boundary honest:
 *
 *   1. the system exists - the named classes a screen is told to reach for
 *      are really defined, and defined ONCE, in tokens, not raw colours;
 *   2. the vocabulary resolves to the system - `card` is "erp-card", not a
 *      utility string that could drift again;
 *   3. the MIGRATED surfaces stay migrated - no hand-rolled card, input,
 *      select, chip or button geometry in the files V3 touched. A legacy
 *      panel may still carry its old utilities (it is listed nowhere here);
 *      a migrated one may not slide back;
 *   4. the PWA shell keeps its safe areas - the bottom nav pads by the
 *      home-indicator inset, the content clears the nav, the sheet clears
 *      both;
 *   5. the three retired tabs stay retired - none of the registries, the
 *      sidebar, the icon map, the strings or the page can name them again;
 *   6. every guard that existed before this one still runs (the registry
 *      is checked, not this file's memory of it).
 *
 * Run: node tests/interface-v3.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n");
/* Block comments are blanked line-for-line (so line numbers hold). A `/*`
   glued to a word - the `image/*` in an accept attribute - is not a comment. */
const stripComments = (s) =>
  s.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");

let passed = 0;
let failed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* ---- 1. the system exists, once, in tokens ---------------------------- */
const v3 = read("styles/erp-v3.css");
const globals = read("styles/globals.css");
/* v1.172.2 (Tailwind retired): globals.css opens with the three sheets in
   cascade order - the reset (base), the V3 system (components), the frozen
   legacy utilities (utilities) - and no engine import. tests/tailwind-retired.mjs
   holds the retirement itself; this line holds the ORDER, which is what
   makes a legacy utility still win over a V3 class until its screen migrates. */
ok("globals.css imports the reset, then the V3 layer, then the frozen utilities - and no engine",
   /^@import "\.\/erp-reset\.css";\n@import "\.\/erp-v3\.css";\n@import "\.\/legacy-utilities\.css";\n@layer properties, theme, base, components, utilities;/m.test(globals)
   && !/@import "tailwindcss"/.test(globals));
const CLASSES = [
  "erp-card", "erp-card-compact", "erp-card-inset", "erp-card-accent", "erp-stat", "erp-stat-value", "erp-stat-label",
  "erp-action-card", "erp-card-head", "erp-row", "erp-note", "erp-listbox", "erp-sheet", "erp-modal", "erp-menu", "erp-toast",
  "erp-zone", "erp-zone-label", "erp-field", "erp-field-row", "erp-label", "erp-help", "erp-error", "erp-input", "erp-input-sm",
  "erp-select", "erp-textarea", "erp-check", "erp-segmented", "erp-button-ghost", "erp-button-success", "erp-icon-button-ghost",
  "erp-chip", "erp-chip-sm", "erp-chip-neutral", "erp-chip-success", "erp-chip-warning", "erp-chip-danger", "erp-chip-info", "erp-chip-action",
  "erp-th", "erp-td", "erp-th-num", "erp-td-num", "erp-toolbar", "erp-toolbar-group", "erp-action-bar", "erp-filter-chip",
  "erp-topbar", "erp-topbar-title", "erp-bottom-nav", "erp-bottom-nav-item", "erp-bottom-nav-icon", "erp-bottom-nav-label",
  "erp-rail", "erp-rail-item", "erp-rail-group-label", "erp-rail-tip", "erp-drawer", "erp-drawer-head", "erp-drawer-body", "erp-drawer-foot",
];
for (const c of CLASSES) {
  ok(`.${c} is defined in styles/erp-v3.css`, new RegExp(`\\.${c.replace(/-/g, "\\-")}(?![\\w-])[^{]*\\{`).test(v3));
}
/* A V3 name may be SCOPED in globals.css (`.erp-shift-hero .erp-chip`) but
   never defined there as itself. */
const dup = CLASSES.filter((c) => new RegExp(`^\\s*\\.${c.replace(/-/g, "\\-")}(?![\\w-])[^{,]*\\{`, "m").test(globals));
ok("no V3 class is ALSO defined in globals.css (one owner per name)", dup.length === 0, dup.join(", "));
/* Colours: only tokens. A raw hex in the V3 file is a second palette. */
const v3Body = stripComments(v3).replace(/url\("data:[^"]*"\)/g, "");
const rawHex = v3Body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
ok("the V3 layer states no colour of its own - every fill and ink is a semantic token", rawHex.filter((h) => h !== "#fff").length === 0, [...new Set(rawHex)].join(", "));
ok("the control height is one token, 44px, and the dense control 36px", /--erp-control-h: 44px;/.test(v3) && /--erp-control-h-sm: 36px;/.test(v3));
/* v1.177.0 - the family may MOVE (12px -> 14px with the command deck); what
   it may never do is disagree with itself. Read both and compare. */
{
  const cardR = v3.match(/--erp-radius-card: (\d+)px;/)?.[1];
  const surfR = globals.match(/\.erp-workspace \{\s*--surface-radius: (\d+)px;/)?.[1];
  ok("the card radius is ONE token and the workspace utilities read the same value",
     !!cardR && cardR === surfR, `erp-v3 ${cardR ?? "?"}px vs globals ${surfR ?? "?"}px`);
}
ok("the 44px button contract still lives in globals.css (tests/interface-system.mjs reads it there)", /\.erp-button \{[\s\S]*?min-height: 44px;/.test(globals) && !/\.erp-button \{[^}]*min-height/.test(v3));
ok("the busy state is a real state, not a prop somebody has to remember", /\.erp-button\[aria-busy="true"\]/.test(v3) && /erp-spin/.test(v3));
ok("an input reads 16px on a phone (iOS does not zoom it) and 14px on the desk", /\.erp-input \{[\s\S]*?font-size: 1rem;/.test(v3) && /@media \(min-width: 768px\) \{ \.erp-input \{ font-size: 0\.875rem; \} \}/.test(v3));

/* ---- 1b. elevated surfaces sit on the PAGE (v1.174.2) ------------------
   A surface that carries its own tokens (.erp-shift-hero, .erp-action-bar)
   redefines --card and friends for everything in its DOM subtree - and a
   position: fixed toast rendered from inside it is in that subtree. The
   CEO's phone showed "Already clocked out" as a 6%-white ghost band with
   white text across the grey page. The page's values are captured on :root
   and every elevated surface re-anchors to them. */
const pageCapture = v3Body.match(/:root \{([^}]*)\}/);
const captured = [...(pageCapture?.[1] ?? "").matchAll(/--erp-page-([a-z-]+): var\(--([a-z-]+)\);/g)].map((m) => [m[1], m[2]]);
ok(":root captures the page's surface tokens as --erp-page-*", captured.length >= 12 && captured.every(([a, b]) => a === b), captured.map(([a, b]) => `${a}<-${b}`).join(", "));
for (const t of ["card", "card-foreground", "foreground", "muted-foreground", "border", "secondary", "primary", "success", "warning", "danger"]) {
  ok(`--erp-page-${t} is captured from --${t}`, captured.some(([a, b]) => a === t && b === t));
}
/* Every captured token must be DECLARED on the light theme's :root in
   globals.css - a var() to a token that does not exist there would make the
   capture guaranteed-invalid, and the elevated surface would lose that
   token entirely instead of inheriting it. */
const lightRoot = stripComments(globals).match(/^:root \{([\s\S]*?)^\}/m)?.[1] ?? "";
const missing = captured.map(([, b]) => b).filter((b) => !new RegExp(`^\\s*--${b.replace(/-/g, "\\-")}:`, "m").test(lightRoot));
ok("every captured token is declared on the light theme's :root (the capture can never be guaranteed-invalid)", missing.length === 0, missing.join(", "));
const elevated = v3Body.match(/\.erp-sheet, \.erp-modal, \.erp-menu, \.erp-toast \{([^}]*)\}/);
ok("the sheet, modal, menu and toast re-anchor to the page's tokens in ONE rule", Boolean(elevated));
for (const [a] of captured) {
  ok(`the elevated surfaces re-anchor --${a} to --erp-page-${a}`, new RegExp(`--${a.replace(/-/g, "\\-")}: var\\(--erp-page-${a.replace(/-/g, "\\-")}\\);`).test(elevated?.[1] ?? ""));
}
const toastRule = v3Body.match(/\.erp-toast \{([^}]*)\}/)?.[1] ?? "";
ok("the toast is a card in the middle of the screen, never a band across it (max-width, wrapping text)", /max-width: min\(2\drem, calc\(100% - \drem\)\);/.test(toastRule) && /overflow-wrap: anywhere;/.test(toastRule) && /box-sizing: border-box;/.test(toastRule));
/* The reason the rule exists must still be true - the hero keeps its own
   tokens (v1.170.0); nobody "fixes" the toast by flattening the hero. */
ok("the shift hero still carries its own surface tokens (the toast rule does not take them away)", /\.erp-shift-hero \{[^}]*--card: rgba\(255, 255, 255, 0\.06\);[^}]*--card-foreground: #fff;/.test(stripComments(globals)));

/* ---- 2. the vocabulary resolves to the system ------------------------- */
const styles = read("lib/ui-styles.ts");
const MAP = {
  card: "erp-card", compactCard: "erp-card erp-card-compact", insetCard: "erp-card-inset", accentCard: "erp-card erp-card-accent",
  tileCard: "erp-stat", modalCard: "erp-modal", sheetCard: "erp-sheet", toastCard: "erp-toast", menuCard: "erp-menu",
  inputClass: "erp-input", inputClassSm: "erp-input erp-input-sm", selectClass: "erp-input erp-select",
  textareaClass: "erp-input erp-textarea", selectClassSm: "erp-input erp-input-sm erp-select",
  fieldRow: "erp-field-row", fieldLabel: "erp-label", th: "erp-th", td: "erp-td", thR2: "erp-th erp-th-num", tdR2: "erp-td erp-td-num",
  rowHead: "erp-card-head", listRow: "erp-row", listBox: "erp-listbox", chip: "erp-chip", chipAction: "erp-chip-action",
  btnQuiet: "erp-button erp-button-ghost", btnSuccess: "erp-button erp-button-success", iconBtnQuiet: "erp-icon-button erp-icon-button-ghost",
};
for (const [name, value] of Object.entries(MAP)) {
  const m = styles.match(new RegExp(`export const ${name} =\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)?"([^"]*)";`));
  ok(`ui-styles ${name} is "${value}"`, m?.[1] === value, m ? `is "${m[1]}"` : "not found as a plain string");
}
ok("chip variants compose from the base and end in a V3 tone", /export const chipSuccess = `\$\{chip\} erp-chip-success`;/.test(styles) && /export const chipSmWarn = `\$\{chipSm\} erp-chip-warning`;/.test(styles));
/* No exported vocabulary entry may spell a control or a surface out in raw
   utilities any more - that is how three paddings happened in the first place. */
const rawVocab = [...styles.matchAll(/export const (\w+) =\s*(?:\/\*[\s\S]*?\*\/\s*)?"([^"]*)";/g)]
  .filter(([, , val]) => /\b(?:border-input|bg-card|rounded-(?:lg|xl|2xl|card|panel)|px-\d|py-\d|h-\d)\b/.test(val));
ok("no vocabulary entry spells a surface or control out in raw utilities", rawVocab.length === 0, rawVocab.map(([, n]) => n).join(", "));
/* v1.172.2: and none carries ANY utility - every exported string is erp-* names only. */
const utilVocab = [...styles.matchAll(/export const (\w+) =\s*(?:\/\*[\s\S]*?\*\/\s*)?"([^"]*)";/g)]
  .filter(([, , val]) => val.split(/\s+/).some((t) => t && !/^erp-[\w-]+$/.test(t)));
ok("every plain-string vocabulary entry is erp-* names only (Tailwind retired)", utilVocab.length === 0, utilVocab.map(([, n, v]) => `${n}="${v}"`).join(", "));

/* ---- 3. the migrated surfaces stay migrated --------------------------- */
const MIGRATED = [
  "app/portal/page.tsx",
  "components/layout/side-nav.tsx",
  "components/layout/command-palette.tsx",
  "components/ui/data-table.tsx",
  "components/ui/side-drawer.tsx",
  "components/ui/empty-state.tsx",
  "components/portal/page-shared.tsx",
  "components/portal/dashboard.tsx",
  "components/portal/web-orders-panel.tsx",
  "components/portal/finance-panels.tsx",
  "components/portal/commission-panels.tsx",
  "components/portal/accounting-panel.tsx",
  "components/portal/attendance.tsx",
  "components/portal/role-panels.tsx",
  "components/portal/hankeis-panel.tsx",
];
const RULES = [
  ["a hand-rolled text control (border-input outside the vocabulary)", /className=(?:"|\{`)[^"`]*\bborder-input\b/],
  ["a hand-rolled card surface (border-border + bg-card + rounded)", /className=(?:"|\{`)[^"`]*\bborder-border\b[^"`]*\bbg-card\b[^"`]*\brounded/],
  ["a hand-rolled chip (rounded-full + px + text-[1?] outside erp-chip)", /className=(?:"|\{`)(?![^"`]*erp-)[^"`]*\brounded-full\b[^"`]*\bpx-[\d.]+\b[^"`]*\btext-(?:xs|\[1[01]px\])/],
  ["a bespoke button height on a labelled button", /<button[^>]*className=(?:"|\{`)(?![^"`]*erp-)[^"`]*\bh-(?:7|8|9|10|11)\b[^"`]*\brounded/],
  ["a raw Tailwind palette colour", /\b(?:bg|text|border)-(?:amber|emerald|red|green|blue|slate|gray|zinc|neutral|stone|yellow|indigo|violet|purple|pink|rose|sky|cyan|teal|lime|orange)-\d{2,3}\b/],
];
for (const f of MIGRATED) {
  if (!existsSync(join(root, f))) { ok(`${f} exists`, false); continue; }
  const src = stripComments(read(f));
  for (const [what, re] of RULES) {
    const m = src.match(re);
    ok(`${f}: no ${what}`, !m, m ? `"${m[0].slice(0, 80)}"` : "");
  }
}
/* The specific surfaces V3 rebuilt use their names. */
const page = stripComments(read("app/portal/page.tsx"));
ok("the portal header is the V3 topbar", /<header className="erp-topbar[^"]*"/.test(page));
ok("the bottom nav items are V3 items", /className="erp-bottom-nav-item"/.test(page) && /className="erp-bottom-nav-icon"/.test(page) && /className="erp-bottom-nav-label"/.test(page));
const rail = stripComments(read("components/layout/side-nav.tsx"));
ok("the sidebar is the V3 rail", /className="erp-rail"/.test(rail) && /className="erp-rail-item"/.test(rail) && /className="erp-rail-group-label"/.test(rail));
const drawer = stripComments(read("components/ui/side-drawer.tsx"));
ok("the drawer is the V3 drawer", /erp-drawer-backdrop/.test(drawer) && /className="erp-drawer-head"/.test(drawer) && /className="erp-drawer-body"/.test(drawer));
const table = stripComments(read("components/ui/data-table.tsx"));
ok("the table toolbar, filter chips and action bar are V3", /className="erp-toolbar"/.test(table) && /"erp-filter-chip"/.test(table) && /className=\{`erp-action-bar /.test(table) && /className="erp-check"/.test(table));
const shared = stripComments(read("components/portal/page-shared.tsx"));
ok("the zone label is the V3 zone", /className="erp-zone"/.test(shared) && /className="erp-zone-label"/.test(shared));
const claims = stripComments(read("components/portal/role-panels.tsx"));
ok("the claim type switch is the V3 segmented control", /className="erp-segmented erp-mt-3" role="group"/.test(claims));
ok("the claim form's call to action is a pill", /<a href="#claim-form" className=\{btnSmPrimary\}>/.test(claims));
ok("a submitted claim returns its author to the list", /id="claims-list"/.test(claims) && (claims.match(/revealAnchor\("claims-list"\);/g) ?? []).length >= 2, String((claims.match(/revealAnchor\("claims-list"\)/g) ?? []).length));
const dash = stripComments(read("components/portal/dashboard.tsx"));
ok("the shift hero says the state of the day as one chip", /erp-chip-success" : hasOut \? "erp-chip-neutral" : "erp-chip-warning"/.test(dash));
ok("the hero's buttons keep the one 44px height on the On Shift tab too", !/min-h-14 text-base/.test(dash));

/* ---- 4. the PWA shell keeps its safe areas ---------------------------- */
/* v1.172.2: the two formulas are the named classes (tests/pwa-calendar.mjs
   checks the numbers); here, that the vocabulary still points at them. */
ok("the bottom nav pads by the home-indicator inset", /export const mobileBottomNav = "erp-bottom-nav";/.test(styles) && /\.erp-bottom-nav \{[^}]*padding-bottom: max\(env\(safe-area-inset-bottom, 0px\), 6px\);/.test(v3));
ok("the page clears the nav by the same formula", /export const mobileAppBottomClearance = "erp-page-clearance";/.test(styles) && /\.erp-page-clearance \{ padding-bottom: calc\(5rem \+ max\(env\(safe-area-inset-bottom, 0px\), 6px\)\); \}/.test(v3));
ok("the bottom sheet clears the nav AND the inset", /\.erp-sheet \{[\s\S]*?padding: 1rem 1rem calc\(4\.5rem \+ env\(safe-area-inset-bottom, 0px\)\);/.test(v3));
ok("the drawer's footer clears the inset", /\.erp-drawer-foot \{[^}]*env\(safe-area-inset-bottom, 0px\)/.test(v3));
ok("the topbar pads by the status-bar inset (kept inline for tests/shell-scroll.mjs)", /<header className="erp-topbar[^"]*"\s*\n?\s*style=\{\{ paddingTop: "calc\(var\(--hdr-pt\) \+ env\(safe-area-inset-top, 0px\)\)" \}\}/.test(page));
ok("the bottom-nav item is a 60px stop with an ellipsised label", /\.erp-bottom-nav-item \{[\s\S]*?min-height: 60px;/.test(v3) && /\.erp-bottom-nav-label \{[\s\S]*?text-overflow: ellipsis;/.test(v3));

/* ---- 5. the retired tabs stay retired --------------------------------- */
const RETIRED = ["Reconciliation", "Ads Fund", "Purchasing"];
const registries = {
  "lib/portal-tabs.ts": /const ALL_TABS = \[([\s\S]*?)\] as const;/,
  "components/layout/side-nav.tsx": /export const SECTIONS[\s\S]*?^\];/m,
  "components/layout/nav-icons.tsx": /export const TAB_ICON[\s\S]*?^\};/m,
  "lib/i18n.ts": /DICT[\s\S]*/,
  "components/portal/lazy-panels.tsx": /[\s\S]*/,
  "worker/src/staff.ts": /const TAB_ACCESS_TABS = \[[^\]]*\]/,
};
for (const [f, re] of Object.entries(registries)) {
  const m = stripComments(read(f)).match(re);
  const hit = RETIRED.filter((t) => m && new RegExp(`"${t}"`).test(m[0]));
  ok(`${f} does not name a retired tab`, m && hit.length === 0, hit.join(", "));
}
ok("the page draws no retired panel", !/activeTab === "(?:Reconciliation|Ads Fund|Purchasing)"/.test(page));
ok("the retired panel file is gone", !existsSync(join(root, "components/portal/purchasing-panels.tsx")));
ok("PUSH.bat still deletes it on release", /components\\portal\\purchasing-panels\.tsx/.test(read("PUSH.bat")));

/* ---- 6. nothing was removed to make room ------------------------------ */
const registry = read("scripts/run-guards.mjs");
const names = [...registry.matchAll(/^\s*\["([a-z0-9-]+)", "/gm)].map((m) => m[1]).filter((n) => n !== "install");
for (const g of ["interface-system", "card-vocabulary", "status-tokens", "users-ui", "pwa-calendar", "shell-scroll", "registry-parity", "production-safety", "hankeis", "csv-export", "tailwind-retired", "tab-concept"]) {
  ok(`guard ${g} is still registered`, names.includes(g));
}
ok("every registered guard still has its file", names.every((n) => existsSync(join(root, `tests/${n}.mjs`))), names.filter((n) => !existsSync(join(root, `tests/${n}.mjs`))).join(", "));
ok("the registry grew to at least 95 (v1.172.2 added tailwind-retired, v1.173.0 tab-concept, v1.174.0 staff-responsibilities)", names.length >= 95, String(names.length));

console.log(`interface-v3: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
