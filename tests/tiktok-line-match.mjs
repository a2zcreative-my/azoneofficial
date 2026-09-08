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
import { fileURLToPath, pathToFileURL } from "node:url";

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

const dir = mkdtempSync(join(tmpdir(), "linematch-"));
const out = join(dir, "line-match.mjs");
execSync(`npx esbuild "${join(root, "worker/src/line-match.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const lm = await import(pathToFileURL(out).href);

/* ---- 1. the CEO's two orders, against a catalogue like his ---------- */
const shop = [
  { id: 1, name: "Bawal lumi Lilac" }, { id: 2, name: "Bawal lumi Sky" }, { id: 3, name: "Bawal lumi Aurora" },
  { id: 4, name: "Bawal lumi Dusty Olive" }, { id: 5, name: "Bawal lumi Champainge Sand" }, { id: 6, name: "Bawal lumi Luxe" },
  { id: 7, name: "Shawl chiffon Lilac" },
];
const idOf = (m) => (m.kind === "one" ? m.item.id : m.kind);
{
  ok("TT-585940128734282812: BAWAL LUMI COTTON VOILE Lilac is Bawal lumi Lilac",
     idOf(lm.matchByWords("BAWAL LUMI COTTON VOILE Lilac", shop)) === 1, "the order that started this");
  ok("TT-585921569986544660: BAWAL COTTON VOILE Sky is Bawal lumi Sky",
     idOf(lm.matchByWords("BAWAL COTTON VOILE Sky", shop)) === 2);
  ok("the fabric between the brand and the shade is what broke the old rule",
     !"bawal lumi cotton voile lilac".includes("bawal lumi lilac"), "the substring rule can never find it");
  ok("a two-word shade needs both words: Dusty Olive",
     idOf(lm.matchByWords("BAWAL LUMI COTTON VOILE Dusty Olive", shop)) === 4
     && lm.matchByWords("BAWAL LUMI COTTON VOILE Olive", shop).kind === "none",
     "'Olive' alone must not move Dusty Olive's stock");
  ok("the shade chooses the family", idOf(lm.matchByWords("BAWAL LUMI COTTON VOILE Lilac", shop)) === 1);
  ok("...and 'SHAWL CHIFFON Lilac' is the shawl", idOf(lm.matchByWords("SHAWL CHIFFON PREMIUM Lilac", shop)) === 7);
  ok("a line that names only the shade, with two lilacs in stock, is AMBIGUOUS - refused, both named",
     JSON.stringify(lm.matchByWords("Lilac", shop)) === JSON.stringify({ kind: "ambiguous", names: ["Bawal lumi Lilac", "Shawl chiffon Lilac"] }),
     "a rule that can move the wrong stock is worse than one that moves none");
  ok("a whole name present beats one with a generic word the line never said",
     idOf(lm.matchByWords("BAWAL COTTON VOILE Sky", [...shop, { id: 9, name: "Bawal Sky" }])) === 9);
  ok("a shade of a different name matches nothing", lm.matchByWords("BAWAL LUMI COTTON VOILE Midnight", shop).kind === "none");
  ok("fused words still count (lumiMahogany)", lm.matchByWords("Bawal lumiMahogany", [{ id: 1, name: "Bawal lumi Mahogany" }]).kind === "one");
  ok("family and fabric words are generic, the shade is not",
     lm.distinctive("Bawal lumi Cotton Voile Lilac").join() === "lilac" && lm.GENERIC_WORDS.has("lumi") && lm.GENERIC_WORDS.has("voile"));
  ok("an item with no distinctive word never matches by words", lm.matchByWords("Bawal lumi", [{ id: 1, name: "Bawal lumi" }]).kind === "none",
     "'Bawal lumi' would otherwise match every LUMI line");
  ok("the SKU rule is the store's: LUMI001 is LUMI 001", lm.skuKey("lumi 001") === "LUMI001" && lm.skuKey("LUMI001") === "LUMI001");
}

/* ---- 1b. v1.139.0 - A SUBSTRING IS NOT A WORD -------------------------
   The 08-09 audit ran the shipped rule over shade-only names and found it
   deducting a different real product, unattended, every thirty minutes: the
   squashed-line fallback matched any three-letter word ANYWHERE inside the
   line with its spaces removed. */
{
  const t = (line, cat) => lm.matchByWords(line, cat);
  ok("Tangerine does not deduct a Tan", t("SHAWL CHIFFON Tangerine", [{ id: 9, name: "Shawl Tan" }]).kind === "none");
  ok("Cashmere does not deduct an ASH", t("BAWAL Cashmere Black", [{ id: 9, name: "Bawal ASH" }]).kind === "none");
  ok("Rosewood does not deduct a ROSE", t("BAWAL LUMI COTTON VOILE Rosewood", [{ id: 9, name: "ROSE" }]).kind === "none");
  ok("...and the fused-word case still works, because the fusion is undone in words()",
     lm.words("Bawal lumiMahogany").join(" ") === "bawal lumi mahogany");
  ok("a digit is distinctive however short: Bidang 50 does not deduct a Bidang 45",
     t("BAWAL BIDANG 50 Black", [{ id: 9, name: "Bawal Bidang 45 Black" }]).kind === "none"
     && idOf(t("BAWAL BIDANG 45 Black", [{ id: 9, name: "Bawal Bidang 45 Black" }])) === 9);
  ok("Rose Gold takes ROSE GOLD, not ROSE",
     idOf(t("BAWAL COTTON VOILE Rose Gold", [{ id: 9, name: "ROSE" }, { id: 10, name: "ROSE GOLD" }])) === 10);
}

/* ---- 1c. v1.139.0 - THE CATALOGUE IS THE DICTIONARY -------------------
   A word the LINE says must be in the item too - but only a word the shop
   itself uses. A listing is full of words that are not product names, and
   requiring those would refuse every honest order. */
{
  ok("a seller's own words do not block an order: CLOSET SALE Black is BLACK",
     idOf(lm.matchByWords("CLOSET SALE Black", [{ id: 1, name: "BLACK" }])) === 1);
  ok("...nor does READY STOCK", idOf(lm.matchByWords("READY STOCK BAWAL LUMI Lilac", shop)) === 1);
  ok("...nor a size the shop does not track",
     idOf(lm.matchByWords("BAWAL LUMI Lilac Bidang 45", [{ id: 1, name: "Bawal lumi Lilac" }])) === 1);
  ok("but a word that names one of the shop's own products DOES block it",
     lm.matchByWords("BAWAL LUMI Dusty Olive", [{ id: 1, name: "Bawal lumi Olive" }, { id: 4, name: "Bawal lumi Dusty Olive" }]).item?.id === 4,
     "when both shades are real products, 'dusty' is the whole difference");
  ok("shape words are generic, so a bidang is not a shade", lm.GENERIC_WORDS.has("bidang") && lm.GENERIC_WORDS.has("size"));
  /* The case the coverage rule exists for: the specific product does NOT win
     on whole-name coverage, because the line never names its family. Without
     the line-side rule the shorter, more generic name scores higher and the
     wrong shade moves. */
  ok("a compound shade beats the plain one even when the line names no family",
     idOf(lm.matchByWords("COTTON VOILE Rose Gold",
       [{ id: 1, name: "ROSE" }, { id: 2, name: "Bawal lumi Rose Gold" }])) === 2,
     "ROSE would otherwise score 1/1 whole-name against Rose Gold's 2/4");
  ok("...and with only the plain one in stock the order is refused, not guessed",
     lm.matchByWords("COTTON VOILE Rose Gold", [{ id: 1, name: "ROSE" }, { id: 3, name: "GOLD" }]).kind !== "one",
     "two products are named and neither is the pair");
}

/* ---- 2. the wiring --------------------------------------------------- */
const ix = read("worker/src/index.ts");
ok("the worker imports the shipped rule", /import \{ matchByWords, skuKey as lineSkuKey \} from "\.\/line-match"/.test(ix));
ok("a SKU is tried by the store's key before the name is looked at",
   /WHERE sku_key = \?1 LIMIT 1`,\s*\n\s*\)\.bind\(lineSkuKey\(sku\)\)/.test(ix));
/* v1.139.0 - the word rule runs FIRST now. Behind the exact-name shortcut it
   could never refuse an ambiguity or break a tie, because the shortcut had
   already picked a row by rowid. */
ok("the word rule runs over the whole catalogue BEFORE any name shortcut",
   /const m = matchByWords\(`\$\{name\} \$\{variant\}`\.trim\(\), catalogue\);[\s\S]{0,600}?for \(const cand of \[variant, name\]\)/.test(ix),
   "the exact step used to answer first, with LIMIT 1 and no ordering");
ok("...and the unsafe substring step is gone", !/instr\(lower\(\?1\), lower\(trim\(name\)\)\)/.test(ix));
ok("the exact-name fallback exists only for a name made entirely of generic words, and refuses a tie",
   /if \(exact\.length === 1\) return \{ kind: "one"[\s\S]{0,160}?if \(exact\.length > 1\) return \{ kind: "ambiguous"/.test(ix));
ok("an ambiguous line is its own outcome, not 'not in inventory'",
   /if \(m\.kind === "ambiguous"\) return m;/.test(ix) && /NOT deducted — ambiguous, rename one item so only one fits/.test(ix));
ok("a line matched by words says so on the card, with what it matched",
   /matched by words: \$\{wordMatched\.join/.test(ix) && /wordMatched\.push\(`\$\{item\.name\} ← \$\{l\.name\}`\)/.test(ix));
const doors = (ix.match(/await resolveTiktokLines\(env, /g) ?? []).length;
ok("ONE resolver behind all three doors - first import, the retry on every sync, the webhook", doors === 3, `found ${doors}`);
ok("no door keeps a loop of its own", !/const item = await matchInventoryItem\(env, l\.sku/.test(ix.replace(/async function resolveTiktokLines[\s\S]*?\n\}\n/, "")));
/* v1.139.0 - the retry is per LINE. Gating on "this order has no movements
   at all" meant an order with one matched line and one ambiguous line
   counted as done the moment the first line moved, and was never looked at
   again however many times the SKU was fixed. */
ok("the retry on every sync heals the LINES that have not moved yet",
   /const pendingR = rr\.resolved\.filter\(\(l\) => !doneR\.has\(l\.id\)\);/.test(ix)
   && /deductLines\(env, exists\.id, pendingR, orderRef, actorId, "tiktok_retry"\)/.test(ix),
   "the CEO's two orders are healed by the next Sync from TikTok, not by hand");
ok("...and one deduct helper serves all three doors, skipping lines already recorded",
   /async function deductLines\(/.test(ix)
   && /const done = new Set\(\(already \?\? \[\]\)\.map/.test(ix)
   && (ix.match(/await deductLines\(env, /g) ?? []).length === 3);
ok("a guarded update that moved nothing is never reported as a deduction",
   /if \(movedR > 0\) rNotes\.push\(`✔ stock deducted on retry/.test(ix) && /if \(movedR > 0\) retried \+= 1;/.test(ix));
/* v1.139.0 - one order, one record. */
ok("both doors insert against the 0121 unique index and do nothing if they lose the race",
   (ix.match(/INSERT OR IGNORE INTO postage_records/g) ?? []).length === 2
   && /if \(!rec\) \{ skipped \+= 1; continue; \}/.test(ix)
   && /if \(!rec\) return json\(\{ ok: true, duplicate: true \}\);/.test(ix)
   && /CREATE UNIQUE INDEX IF NOT EXISTS idx_postage_order_ref ON postage_records\(order_ref\);/.test(read("worker/migrations/0121_postage_order_ref_unique.sql")));
ok("a cancellation seen by the SYNC puts the pieces back, once",
   /if \(uiNow === "returned" && !exists\.restocked\) \{[\s\S]{0,200}?await restockOrder\(/.test(ix)
   && /WHERE id = \?1 AND COALESCE\(restocked, 0\) = 0/.test(ix)
   && (ix.match(/await restockOrder\(env, /g) ?? []).length === 2,
   "only the webhook ever restocked, so a cancellation the webhook missed left the shelf short for good");
ok("AWAITING_SHIPMENT is a parcel that has not moved, on both doors",
   /: stNow\.includes\("await"\) \? "preparing"/.test(ix));
ok("two variants sharing one seller SKU stay two lines",
   /const key = `\$\{sku\}\|\$\{variant \|\| name\}`\.toLowerCase\(\);/.test(ix));
ok("all-or-nothing survives: a shortage on one line holds the order, an unmatched line is just not moved",
   /deductible: shortages\.length === 0 && resolved\.length > 0/.test(ix));
ok("a returned order still never deducts", /const canDeduct = deductible && uiNow !== "returned";/.test(ix));

/* ---- 3. v1.136.0 - the family breaks a tie ---------------------------
   CEO, 08-09-2026: "I want to have a category ... either shawl or bawal".
   The shop names its items by shade alone (BLACK, KHAKI, CHAMPAGNE), so two
   items called Lilac are otherwise indistinguishable - and the line says
   which family it is. */
{
  const shades = [
    { id: 1, name: "LILAC", category: "Bawal" },
    { id: 2, name: "LILAC", category: "Shawl" },
    { id: 3, name: "CHAMPAGNE", category: "Bawal" },
  ];
  ok("two items named LILAC, one bawal one shawl: the BAWAL line takes the bawal",
     idOf(lm.matchByWords("BAWAL LUMI COTTON VOILE Lilac", shades)) === 1);
  ok("...and the SHAWL line takes the shawl", idOf(lm.matchByWords("SHAWL CHIFFON PREMIUM Lilac", shades)) === 2);
  ok("a line naming NEITHER family is still ambiguous - a tie is not a guess",
     lm.matchByWords("COTTON VOILE Lilac", shades).kind === "ambiguous");
  ok("a shade in one family only needs no tie-break", idOf(lm.matchByWords("SHAWL CHIFFON Champagne", shades)) === 3);
  ok("an uncategorised pair is still ambiguous",
     lm.matchByWords("BAWAL LUMI Lilac", [{ id: 1, name: "LILAC" }, { id: 2, name: "LILAC" }]).kind === "ambiguous",
     "the fix for that is to file them, which is what the category column is for");
  ok("the family never widens the match: a bawal category cannot make a wrong shade fit",
     lm.matchByWords("BAWAL LUMI COTTON VOILE Midnight", shades).kind === "none");
  /* v1.139.0 - a family is matched as a WORD, never inside one. */
  ok("a family called Set is not found inside CLOSET",
     lm.matchByWords("CLOSET SALE Black", [{ id: 1, name: "BLACK", category: "Set" }, { id: 2, name: "BLACK", category: "Single" }]).kind === "ambiguous");
  ok("the matcher is given the family, tolerant of 0120 not being applied",
     /SELECT id, stock, name, unit_price_cents, category FROM inventory_items/.test(ix)
     && /catch \{\s*\n\s*const r = await env\.DB\.prepare\(\s*\n\s*`SELECT id, stock, name, unit_price_cents FROM inventory_items/.test(ix));
}

console.log(`${failed ? "✗" : "✓"} tiktok-line-match: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
