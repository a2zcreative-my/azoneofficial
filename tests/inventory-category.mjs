#!/usr/bin/env node
/* Guard #62 — v1.136.0: the stock list reads one family at a time.
 *
 * CEO, 08-09-2026: *"for inventory live status I want to have a category
 * based on their category which is either shawl or bawal so that I can
 * easily review based on the category that I choose. it is also same to the
 * Mobile apps view"*
 *
 * Four things have to hold, and the fourth is the one that makes it a
 * REVIEW rather than a filter:
 *   1. the category is the item's own field, set and cleared in one place;
 *   2. ONE strip narrows the desk table and the phone list together - they
 *      draw from the same list, so they cannot disagree;
 *   3. the items nobody has filed yet are reachable, or they are invisible
 *      work;
 *   4. the footer total and the CSV count sheet follow the CHOSEN category.
 *      A total that still sums the whole shelf while the screen shows one
 *      family is a wrong number in bold type.
 *
 * Run: node --experimental-strip-types tests/inventory-category.mjs
 *
 * Negative-tested by: totalling sortedItems again; exporting sortedItems;
 * dropping the Uncategorised chip; putting the strip inside the md: table;
 * letting the edit route COALESCE the category (which makes it unclearable);
 * leaving the table at ten columns.
 */
import { readFileSync } from "node:fs";
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

const rp = read("components/portal/role-panels.tsx");
const staff = read("worker/src/staff.ts");
const mig = read("worker/migrations/0120_inventory_category.sql");
const ix = read("worker/src/index.ts");

/* ---- 1. the field ---------------------------------------------------- */
ok("the item has a category of its own", /ALTER TABLE inventory_items ADD COLUMN category TEXT;/.test(mig));
ok("...backfilled from the collection the CEO already set for the shop, so nothing is typed twice",
   /SET category = trim\(elfia_category\)[\s\S]{0,200}?WHERE category IS NULL/.test(mig));
ok("...and the shop's own collection is left alone", !/DROP COLUMN elfia_category|SET elfia_category/.test(mig),
   "elfia_category answers which collection an item appears in ON THE SHOP - a different question");
ok("the migration is on all three registers",
   /"0120_inventory_category",/.test(ix)
   && /SELECT category FROM inventory_items LIMIT 1/.test(ix)
   && /const LATEST_MIGRATION = "01\d\d_/.test(ix),
   "EXPECTED_MIGRATIONS and the probe list carry 0120; LATEST_MIGRATION names whichever migration is last (registry-parity checks that separately)");
ok("a category is SET by sending the key, so it can also be cleared",
   /const hasCat = body !== null && typeof body === "object" && "category" in \(body as object\)/.test(staff)
   && /newCat = c === "" \? null : c;/.test(staff)
   && /UPDATE inventory_items SET category = \?1 WHERE id = \?2/.test(staff),
   "COALESCE would make an empty box mean 'leave it', and a wrongly filed item could never be unfiled");
ok("...capped, and a database without 0120 says so instead of failing silently",
   /A category is at most 40 characters/.test(staff) && /0120, inventory category/.test(staff));
ok("filing an item is on the record", /"inventory\.edit", "inventory_items"[\s\S]{0,300}?category: hasCat \? newCat/.test(staff));
ok("a new item can be filed as it is added", /UPDATE inventory_items SET category = \?1 WHERE sku = \?2/.test(staff)
   && /list="inv-categories"[\s\S]{0,200}?value=\{invDraft\.category\}/.test(rp));

/* ---- 2. one strip, both views ---------------------------------------- */
ok("the strip is the item's family, counted, one chip per family",
   /const invCats = \[\.\.\.new Map\(items\.map\(catOf\)\.filter\(Boolean\)\.map\(\(c\) => \[c\.toLowerCase\(\), c\]\)\)\.values\(\)\]/.test(rp),
   "0120 backfills the shop's lowercase collection, so typing Bawal beside bawal made two chips for one family");
ok("...and choosing one is case-insensitive throughout",
   /catOf\(it\)\.toLowerCase\(\) === invCat\.toLowerCase\(\)/.test(rp)
   && /const known = invCats\.find\(\(c\) => c\.toLowerCase\(\) === cat\.toLowerCase\(\)\);/.test(rp));
{
  /* Both renderings draw from visibleItems, and nothing else: the phone list
     (md:hidden) and the desk table (md:block) are one list, filtered once. */
  const cardAt = rp.indexOf('{L("Inventory — live status & stock"');
  const endAt = rp.indexOf("</tfoot>", cardAt);
  const card = rp.slice(cardAt, endAt);
  const draws = (card.match(/\{visibleItems\.map\(/g) ?? []).length;
  const phone = card.indexOf("md:hidden");
  const table = card.indexOf("<table className=");
  const firstDraw = card.indexOf("{visibleItems.map(");
  ok("the desk table and the phone list are the SAME filtered list",
     /const visibleItems = sortedItems\.filter\([\s\S]{0,700}?catOf\(it\)\.toLowerCase\(\) === invCat\.toLowerCase\(\)/.test(rp)
     && draws === 2 && phone > 0 && phone < firstDraw && firstDraw < table,
     `the CEO asked for the phone too; one list is how they cannot drift apart (draws ${draws})`);
}
const stripAt = rp.indexOf('aria-label={L("Show one category"');
const phoneAt = rp.indexOf("md:hidden");
ok("...and the strip is above both, not inside the desktop table", stripAt > 0 && stripAt < phoneAt,
   "a control that lives inside md:block is not on a phone at all");
ok("the items nobody has filed yet are one chip away",
   /const uncatCount = items\.filter\(\(it\) => !catOf\(it\)\)\.length;/.test(rp)
   && /Uncategorised/.test(rp) && /uncatCount > 0 \?/.test(rp));
ok("the strip only appears once there is something to choose between",
   /\{\(invCats\.length > 0 \|\| uncatCount > 0\) && \(/.test(rp));
ok("the category is typed once and picked thereafter",
   /<datalist id="inv-categories">/.test(rp) && /list="inv-categories"[\s\S]{0,400}?key=\{`cat:\$\{it\.category \?\? ""\}`\}/.test(rp),
   "keyed on the SAVED value - the v1.132.0 rule: a box shows what the database holds");
ok("the find box also searches the family", /catOf\(it\)\.toLowerCase\(\)\.includes\(needle\)/.test(rp));
ok("the phone card shows the family it is in", /className="bg-secondary text-muted-foreground mt-1 inline-block rounded-full[\s\S]{0,120}?\{catOf\(it\)\}/.test(rp));
ok("the column can be sorted, and unfiled items sort last either way",
   /case "category": \{[\s\S]{0,200}?if \(!ca !== !cb\) return ca \? -1 : 1;/.test(rp));

/* ---- 3. the numbers follow the choice -------------------------------- */
ok("the footer totals WHAT IS ON SCREEN", /const tot = visibleItems\.reduce\(/.test(rp),
   "summing the whole shelf under a one-family view is a wrong number in bold type");
ok("...and says which set it is when it is not everything",
   /visibleItems\.length === items\.length\s*\n\s*\? L\("TOTAL — stock on hand"/.test(rp)
   && /\$\{visibleItems\.length\}\/\$\{items\.length\}/.test(rp));
ok("the CSV count sheet holds the rows on screen", /for \(const it of visibleItems\) \{/.test(rp),
   "counting one family means downloading that family");
ok("...with the family in a column of its own, and named in the file",
   /L\("Category", "Kategori"\), L\("Price\/unit \(RM\)"/.test(rp)
   && /it\.sku, it\.name, \(it\.category \?\? ""\)\.trim\(\), rmBare\(price\)/.test(rp)
   && /azoo-stock-count-\$\{invCat && invCat !== "\\u0000none"/.test(rp));
ok("...and the sheet says which view it is, so a partial count is never read as a full one",
   /Every category[\s\S]{0,200}?Uncategorised items only/.test(rp));

/* ---- 4. the table still lines up ------------------------------------- */
{
  const i = rp.indexOf('<table className="tbl-sticky w-full min-w-[1000px]');
  const blk = rp.slice(i, rp.indexOf("</table>", i));
  const head = blk.slice(blk.indexOf("<thead>"), blk.indexOf("</thead>"));
  const body = blk.slice(blk.indexOf("<tbody>"), blk.indexOf("</tbody>"));
  const foot = blk.slice(blk.indexOf("<tfoot>"));
  /* the first two columns come from ONE mapped <th> over [sku, name] */
  const heads = (head.match(/<th[ >\n]/g) ?? []).length + 1;
  const bodies = (body.match(/<td[ >\n]/g) ?? []).length;
  const footCells = (foot.match(/<td[ >\n]/g) ?? []).length
    + (foot.match(/colSpan=\{(\d+)\}/g) ?? []).reduce((n, m) => n + Number(m.match(/\d+/)[0]) - 1, 0);
  /* v1.147.0 - the PROPERTY is that the three agree, not that they agree on
     eleven. Pinning the number meant that adding a Cost/unit column failed
     this guard for the wrong reason - it reported "not eleven" when the real
     fault was a footer left one cell behind. The count is now read off the
     head, and the head is the thing the other two are held to. */
  ok("the table has a head to measure", heads >= 8, `head ${heads}`);
  ok("head, body and footer all carry the same number of columns",
     heads === bodies && heads === footCells,
     `head ${heads}, body ${bodies}, foot ${footCells} - a footer one cell short puts every total under the wrong heading`);
  const skel = rp.match(/SkelTable rows=\{6\} cols=\{(\d+)\}/);
  ok("the skeleton is the shape of the table it stands in",
     !!skel && Number(skel[1]) === heads,
     skel ? `skeleton ${skel[1]}, table ${heads}` : "no SkelTable found");
}

/* ---- 5. the family also settles a TikTok line (v1.135.0's tie) -------- */
ok("two items sharing a shade name are told apart by their family",
   /const byCat = tied\.filter/.test(read("worker/src/line-match.ts"))
   && /if \(byCat\.length === 1\) return \{ kind: "one", item: byCat\[0\]!\.item \};/.test(read("worker/src/line-match.ts")),
   "a shop that names items by shade alone (BLACK, KHAKI, CHAMPAGNE) has nothing else to tell two Lilacs apart");

/* ---- 6. v1.139.0 - A SAVE CHANGES WHAT IT SAYS IT CHANGES ---------------
   The 08-09 audit: the price box on an inventory row sent `stock: it.stock`
   beside the new price - the count as it stood when the PAGE WAS LOADED -
   and the route set stock absolutely. So editing a price ten minutes after
   opening the tab silently undid every TikTok deduction and every bridge
   movement since, and the trail recorded only "inventory.update". */
ok("the price box sends the price, and nothing about the count",
   /await api\(`\/inventory\/\$\{it\.id\}`, \{ method: "PATCH", body: JSON\.stringify\(\{ unit_price: v \}\) \}\)/.test(rp)
   && !/JSON\.stringify\(\{ stock: it\.stock/.test(rp),
   "re-sending a stale count is how a deduction gets undone by somebody editing a price");
ok("...and the route leaves the count alone when the body does not carry one",
   /stock = COALESCE\(\?1, stock\)/.test(staff)
   && /const setsStock = typeof body\.stock === "number";/.test(staff)
   && /status = CASE WHEN COALESCE\(\?1, stock\) = 0 THEN 'out_of_stock'/.test(staff),
   "the status is recomputed from whatever the count ends as, so a price-only save leaves no stale 'low'");
ok("...and says in the trail which of the two it changed",
   /"inventory\.update", "inventory_items", invMatch\[1\],\s*\n?\s*\{ \.\.\.\(setsStock \? \{ stock \} : \{\}\)/.test(staff));

console.log(`${failed ? "✗" : "✓"} inventory-category: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
