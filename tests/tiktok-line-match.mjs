#!/usr/bin/env node
/* Guard #61 — v1.135.0: a TikTok line finds its inventory item by its distinctive words.
 *
 * CEO, 07-09-2026, on two shipped orders stuck on "No stock movement
 * recorded · not in inventory (SKU or name): 1× BAWAL LUMI COTTON VOILE
 * Lilac": *"LUMI was not deducted from the inventory which is it is not
 * correct. it is supposed to deduct automatically!!!"*
 *
 * The listing says "BAWAL LUMI COTTON VOILE" + "Lilac"; the item is "Bawal
 * lumi Lilac". The old rule wanted the item name INSIDE the listing as one
 * string, and the fabric sat in the middle. The rule is RUN here, on his two
 * orders, against the shipped worker/src/line-match.ts - then the wiring:
 * one resolver for the three doors (first import, the retry on every sync,
 * the webhook), the SKU key the store uses, and an ambiguous line refused.
 *
 * Run: node --experimental-strip-types tests/tiktok-line-match.mjs
 *
 * Negative-tested by: matching on any one distinctive word instead of all;
 * letting a tie pick the first; treating "lumi" as distinctive; pointing one
 * of the three doors back at its own loop; dropping the sku_key step.
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const dir = mkdtempSync(join(tmpdir(), "linematch-"));
const out = join(dir, "line-match.mjs");
execSync(`npx esbuild ${join(root, "worker/src/line-match.ts")} --bundle --format=esm --platform=neutral --outfile=${out} --log-level=error`, { cwd: root, stdio: "inherit" });
const lm = await import(pathToFileURL(out).href);

/* ---- 1. the CEO's two orders, against a catalogue like his ---------- */
const shop = [
  { id: 1, name: "Bawal lumi Lilac" }, { id: 2, name: "Bawal lumi Sky" }, { id: 3, name: "Bawal lumi Aurora" },
  { id: 4, name: "Bawal lumi Dusty Olive" }, { id: 5, name: "Bawal lumi Champainge Sand" }, { id: 6, name: "Bawal lumi Luxe" },
  { id: 7, name: "Shawl chiffon Lilac" },
];
{
  const m = lm.matchByWords("BAWAL LUMI COTTON VOILE Lilac", shop);
  ok("TT-585940128734282812: BAWAL LUMI COTTON VOILE Lilac is Bawal lumi Lilac", m.kind === "one" && m.item.id === 1,
     `got ${JSON.stringify(m)} - the order that started this`);
  const s = lm.matchByWords("BAWAL COTTON VOILE Sky", shop);
  ok("TT-585921569986544660: BAWAL COTTON VOILE Sky is Bawal lumi Sky", s.kind === "one" && s.item.id === 2);
  ok("the fabric between the brand and the shade is what broke the old rule",
     !"bawal lumi cotton voile lilac".includes("bawal lumi lilac"), "the substring rule can never find it");
  ok("a two-word shade needs both words: Dusty Olive",
     lm.matchByWords("BAWAL LUMI COTTON VOILE Dusty Olive", shop).item?.id === 4
     && lm.matchByWords("BAWAL LUMI COTTON VOILE Olive", shop).kind === "none",
     "'Olive' alone must not move Dusty Olive's stock");
  ok("the shade chooses the family: lilac with 'bawal lumi' in the line is the bawal, not the shawl",
     lm.matchByWords("BAWAL LUMI COTTON VOILE Lilac", shop).item?.id === 1);
  ok("...and 'SHAWL CHIFFON Lilac' is the shawl", lm.matchByWords("SHAWL CHIFFON PREMIUM Lilac", shop).item?.id === 7);
  ok("a line that names only the shade, with two lilacs in stock, is AMBIGUOUS - refused, both named",
     JSON.stringify(lm.matchByWords("Lilac", shop)) === JSON.stringify({ kind: "ambiguous", names: ["Bawal lumi Lilac", "Shawl chiffon Lilac"] }),
     "a rule that can move the wrong stock is worse than one that moves none");
  ok("a whole name present beats one with a generic word the line never said",
     lm.matchByWords("BAWAL COTTON VOILE Sky", [...shop, { id: 9, name: "Bawal Sky" }]).item?.id === 9);
  ok("a shade of a different name matches nothing", lm.matchByWords("BAWAL LUMI COTTON VOILE Midnight", shop).kind === "none");
  ok("fused words still count (lumiMahogany)", lm.matchByWords("Bawal lumiMahogany", [{ id: 1, name: "Bawal lumi Mahogany" }]).kind === "one");
  ok("family and fabric words are generic, the shade is not",
     lm.distinctive("Bawal lumi Cotton Voile Lilac").join() === "lilac" && lm.GENERIC_WORDS.has("lumi") && lm.GENERIC_WORDS.has("voile"));
  ok("an item with no distinctive word never matches by words", lm.matchByWords("Bawal lumi", [{ id: 1, name: "Bawal lumi" }]).kind === "none",
     "'Bawal lumi' would otherwise match every LUMI line");
  ok("a two-letter word is never distinctive", lm.distinctive("Bawal lumi XL").length === 0);
  ok("the SKU rule is the store's: LUMI001 is LUMI 001", lm.skuKey("lumi 001") === "LUMI001" && lm.skuKey("LUMI001") === "LUMI001");
}

/* ---- 2. the wiring --------------------------------------------------- */
const ix = read("worker/src/index.ts");
ok("the worker imports the shipped rule", /import \{ matchByWords, skuKey as lineSkuKey \} from "\.\/line-match"/.test(ix));
ok("a SKU is tried by the store's key before the name is looked at",
   /WHERE sku_key = \?1 LIMIT 1`,\s*\n\s*\)\.bind\(lineSkuKey\(sku\)\)/.test(ix));
ok("the words rule runs over the whole catalogue, after the exact and contains rules",
   /instr\(lower\(\?1\), lower\(trim\(name\)\)\) > 0 LIMIT 2[\s\S]{0,1200}?const m = matchByWords\(name, everything \?\? \[\]\);/.test(ix));
ok("an ambiguous line is its own outcome, not 'not in inventory'",
   /if \(m\.kind === "ambiguous"\) return m;/.test(ix) && /NOT deducted — ambiguous, rename one item so only one fits/.test(ix));
ok("a line matched by words says so on the card, with what it matched",
   /matched by words: \$\{wordMatched\.join/.test(ix) && /wordMatched\.push\(`\$\{item\.name\} ← \$\{l\.name\}`\)/.test(ix));
const doors = (ix.match(/await resolveTiktokLines\(env, /g) ?? []).length;
ok("ONE resolver behind all three doors - first import, the retry on every sync, the webhook", doors === 3, `found ${doors}`);
ok("no door keeps a loop of its own", !/const item = await matchInventoryItem\(env, l\.sku/.test(ix.replace(/async function resolveTiktokLines[\s\S]*?\n\}\n/, "")));
ok("the retry on every sync still heals a movement-less order against CURRENT inventory",
   /if \(\(moved\?\.n \?\? 0\) === 0\) \{\s*\n\s*const rLines = groupLineItems\(o\.line_items \?\? \[\]\);\s*\n\s*const rr = await resolveTiktokLines\(env, rLines\);/.test(ix)
   && /if \(rr\.deductible\) \{/.test(ix),
   "the CEO's two orders are healed by the next Sync from TikTok, not by hand");
ok("all-or-nothing survives: a shortage on one line holds the order, an unmatched line is just not moved",
   /deductible: shortages\.length === 0 && resolved\.length > 0/.test(ix));
ok("a returned order still never deducts", /const canDeduct = deductible && uiNow !== "returned";/.test(ix));

console.log(`${failed ? "✗" : "✓"} tiktok-line-match: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
