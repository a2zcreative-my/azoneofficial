#!/usr/bin/env node
/* Guard #63 — v1.137.0: the Users tab is drawn from the shared vocabulary, and
 * its phone view is a design rather than an inheritance.
 *
 * CEO, 08-09-2026: *"review Users UI/UX for webview and mobile apps view which
 * is globally css/style use."*
 *
 * The panel was moved verbatim out of the 605 KB portal page in v1.114.0 and
 * never adopted the vocabulary that arrived with it: ONE token imported
 * (`card`) and the rest hand-rolled — eight chips at a size no other panel
 * uses, `fieldLabel` retyped twice, a Save button that was `btnClass` minus
 * its hover and disabled states, and two selects in a spelling found nowhere
 * else, because until v1.137.0 there was no `selectClass` to use.
 *
 * The rules this holds, in the order they matter:
 *   1. nothing in this file spells out a look that has a name;
 *   2. the four names added for it exist, are documented and are USED — an
 *      unused name reads as the standard while the code does otherwise;
 *   3. one filtered list feeds both renderings, so the phone and the desk can
 *      never show different people;
 *   4. a row action is a real tap target with a real name;
 *   5. the identity (name, email) is never the part that gets squeezed;
 *   6. exactly one editor is displayed at a time.
 *
 * Run: node --experimental-strip-types tests/users-ui.mjs
 *
 * Negative-tested by: putting a hand-rolled chip back; dropping selectClass
 * for the old literal; making the row action a bare glyph again; letting the
 * chips shrink the identity; searching only one of the two lists; removing
 * the Save button's busy state.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const styles = read("lib/ui-styles.ts");
const raw = read("components/portal/users-panel.tsx");
/* Comments describe the OLD look on purpose — this file's header quotes the
   classes it replaced. Strip them, or the guard fails on its own history. */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");

/* ---- 1. the new names exist, are documented, and are used ------------- */
const NEW = ["selectClass", "chipSm", "listBox", "iconBtn"];
for (const n of NEW) ok(`${n} is exported from lib/ui-styles.ts`, new RegExp(`export const ${n}\\s*=`).test(styles));
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) { if (e !== "node_modules") walk(rel, out); }
    else if (/\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
};
const sources = [...walk("app"), ...walk("components")].map(read);
/* chipSm is a BASE the five variants compose from; the variants are what a
   panel writes. Everything else has to appear in real UI. */
for (const n of NEW.filter((n) => n !== "chipSm")) {
  ok(`${n} is actually used`, sources.some((s) => new RegExp(`\\b${n}\\b`).test(s)),
     "an unused name reads as the standard while the code does otherwise");
}
ok("chipSm is the base its five variants compose from, and those are used",
   /chipSmNeutral = `\$\{chipSm\}/.test(styles) && sources.some((s) => /\bchipSmNeutral\b/.test(s)));
ok("each one says why it exists, where the next person will read it",
   /THE SELECT, at last/.test(styles) && /THE LIST BOX/.test(styles) && /THE ROW ACTION/.test(styles)
   && /the DENSE chip/.test(styles));
ok("the row action is a real tap target on a phone before it is a small one on a desk",
   /export const iconBtn =[\s\S]{0,300}?h-11 w-11[\s\S]{0,120}?sm:h-7 sm:w-7/.test(styles),
   "44px is the platform minimum; the old ✎ was about 12x14");

/* ---- 2. nothing in the panel spells out a look that has a name -------- */
ok("no hand-rolled chip", !/rounded-full px-[\d.]+ py-(px|[\d.]+) text-\[10px\]/.test(src),
   "the old chips were a size no other panel uses, so the same chip read smaller here");
ok("no hand-rolled select or input", !/border-input/.test(src),
   "twelve select spellings across six files is why selectClass exists");
ok("no retyped field label", !/text-\[11px\] font-medium">\s*\{L\("Role"/.test(src) && /className=\{fieldLabel\}/.test(src));
ok("no hand-rolled primary button", !/bg-primary text-primary-foreground/.test(src) && /\$\{btnClass\}/.test(src));
ok("no hand-rolled bordered list", !/divide-y[^"]*rounded-lg border"/.test(src) && /\$\{listBox\}/.test(src));
ok("the vocabulary is imported, not approximated",
   /from "@\/lib\/ui-styles"/.test(src)
   && ["btnClass", "card", "chipSmDanger", "chipSmNeutral", "chipSmWarn", "fieldLabel", "iconBtn", "inputClassSm", "listBox", "selectClass", "sheetCard"]
        .every((n) => new RegExp(`\\b${n}\\b`).test(src)));

/* ---- 3. one list, both renderings ------------------------------------ */
ok("the find box filters BOTH lists",
   /const staffRows = allStaff\.filter\(match\);/.test(src) && /const customerRows = allCustomers\.filter\(match\);/.test(src),
   "a search that only narrows the list you happen to be looking at is a trap");
ok("...over name, email and role", /u\.email\.toLowerCase\(\)\.includes\(needle\)[\s\S]{0,200}?u\.role\.replace/.test(src));
ok("a phone shows one list at a time, a desk still shows both",
   /<SectionTabs className="lg:hidden"/.test(src)
   && /tab === "staff" \? "" : "hidden"\} lg:block/.test(src)
   && /tab === "customers" \? "" : "hidden"\} mt-4 lg:mt-0 lg:block/.test(src),
   "two lists of their own height stacked inside the page scroll was two scroll traps before the log");
ok("both headings carry a count, and say 'shown of all' while a search is on",
   /const countOf = \(shown, all\) =>|countOf = \(shown: number, all: number\)/.test(src)
   && (src.match(/countOf\(/g) ?? []).length >= 4,
   "a heading that only ever says 3 cannot be told from a list that lost nine rows");
ok("each list tells 'none yet' from 'none matching'",
   /allStaff\.length === 0[\s\S]{0,200}?No staff account matches that/.test(src)
   && /allCustomers\.length === 0[\s\S]{0,200}?No customer account matches that/.test(src));
ok("one row function draws both lists", (src.match(/accountRow\(u, "/g) ?? []).length === 2
   && /const accountRow = \(u: Account, kind: "staff" \| "customer"\)/.test(src));

/* ---- 4. the row, on a phone ------------------------------------------ */
ok("every row action carries a name, not a glyph",
   /aria-label=\{kind === "staff"[\s\S]{0,320}?Change role for \$\{properName/.test(src)
   && /className=\{iconBtn\}/.test(src) && !/>✎</.test(src));
ok("the identity is never the part that gets squeezed",
   /order-3 flex w-full flex-wrap items-center gap-1 sm:order-1 sm:w-auto/.test(src),
   "chips at shrink-0 beside a flex-1 identity turned a name into 'Siti N...' at 390px");
ok("the name and the email get a line each", /truncate text-sm font-medium">\{properName[\s\S]{0,160}?truncate text-xs">\{u\.email\}/.test(src));
ok("left / rejoined dates are on screen, not in a tooltip",
   /\{\(u\.left_on \|\| u\.rejoined_on\) && \(/.test(src) && !/title=\{`\$\{u\.left_on/.test(src),
   "a phone cannot show a title= tooltip at all");
ok("a role reads as its own name — CEO, not Ceo; HR Admin, not Hr Admin",
   /const ROLE_LABEL: Record<string, string> = \{[\s\S]{0,200}?ceo: "CEO"/.test(src) && !/\bcapitalize\b/.test(src));

/* ---- 5. one editor at a time, and it cannot be pressed twice ---------- */
ok("the desk panel and the phone sheet are the SAME fields",
   (src.match(/roleFields\(/g) ?? []).length === 2 && /const roleFields = \(u: Account\)/.test(src),
   "declared once, rendered twice - they cannot offer different choices");
ok("exactly one of them is ever displayed",
   /mt-2 hidden w-full grid-cols-2 items-end gap-2 rounded-lg p-2 md:grid/.test(src)
   && /className="fixed inset-0 z-50 md:hidden"/.test(src),
   "hidden is the ONLY base display class on the desk panel - the v1.15.0 lesson");
ok("the phone editor is the house bottom sheet, dismissable",
   /\$\{sheetCard\}|className=\{sheetCard\}/.test(src) && /role="dialog" aria-modal="true"/.test(src)
   && /aria-label=\{L\("Close", "Tutup"\)\}/.test(src));
ok("Save cannot be pressed twice",
   /if \(saving\) return;/.test(src) && /disabled=\{saving\}/.test(src) && /Saving…/.test(src),
   "the old button was btnClass minus its disabled state, and had no busy flag at all");

/* ---- 6. the honest small things -------------------------------------- */
ok("a failed load reads as a failure", /className="text-destructive mt-2 text-xs font-medium"/.test(src),
   "it was text-warning; every other panel calls a failed load destructive");
ok("the activity skeleton is the shape of what arrives",
   /\{!eventsLoaded && <SkelRows rows=\{5\} \/>\}/.test(src) && !/SkelTable/.test(src),
   "SkelTable drew three columns that never appeared - these are divided rows");
ok("the 2FA nudge counts in words a person would say",
   /active account without 2FA[\s\S]{0,200}?active accounts without 2FA/.test(src));

console.log(`${failed ? "✗" : "✓"} users-ui: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
