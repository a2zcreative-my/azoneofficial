/**
 * WHAT LEFT THE SHELF, AND WHAT IT COST — guard #66, v1.147.0.
 *
 * The CEO, 09-09-2026, on the manual stock movement modal: *"this one should
 * RM per unit instead, then I should visible to view what is the cost that I
 * need to aware for the internal or correction."* Two complaints in one line.
 * The money on a movement was printed bare, so a −4 pcs row at RM 25 a unit
 * read as if RM 25 had left the building when the sale was RM 100; and a
 * movement that was NOT a sale — internal use, a sample, a damaged piece, a
 * stock-count variance — showed a grey "correction" chip with no money on it
 * at all. The shelf got shorter and nothing said what that was worth.
 *
 * THE PROPERTIES, not the implementation:
 *   1. MONEY ON A MOVEMENT SAYS PER UNIT *AND* LINE TOTAL. Either number
 *      alone is ambiguous on a multi-piece row, and that ambiguity is the
 *      whole complaint.
 *   2. A NON-SALE MOVEMENT IS VALUED AT COST, NOT AT THE SELLING PRICE.
 *      Valuing a correction at what it sells for would overstate the loss by
 *      the whole margin — which is a number a decision gets made on.
 *   3. "NOBODY HAS SAID YET" IS NOT "FREE". The column is nullable with no
 *      default, unset rows are counted and NAMED, and the total says out loud
 *      that it is lower than the truth. A missing cost silently read as zero
 *      is the one failure that would make the figure lie while looking right.
 *   4. A COST SAVE CARRIES NOTHING ELSE. It is written by its own UPDATE, so
 *      saving a cost can never write back a stale stock count — the v1.139.0
 *      lesson, which cost a day of TikTok deductions.
 *   5. SALES ARE NOT IN THE "WITHOUT A SALE" TOTAL, AND NEITHER ARE REVERTED
 *      ROWS. A sale is revenue and is counted elsewhere; a reverted row came
 *      back onto the shelf.
 *   6. THE COST IS SAID WHERE THE DECISION IS MADE. In the modal, while the
 *      movement is being recorded — not only in the list afterwards.
 *   7. THE LIST SURVIVES THE DEPLOY-BEFORE-MIGRATE WINDOW. The code lands
 *      before 0123 runs; the audit trail must not go blank in between.
 *   8. THE MIGRATION IS REGISTERED THE HOUSE WAY — LATEST_MIGRATION,
 *      EXPECTED_MIGRATIONS, and a /system/health probe.
 *
 * Negative-tested by: printing only the unit price on the sale chip (1);
 * valuing corrections at unit_sale_cents (2); giving the column DEFAULT 0 and
 * dropping the unnamed-row count (3); folding unit_cost_cents into the shared
 * stock UPDATE (4); dropping the reverted filter (5); removing the modal hint
 * (6); and deleting the fallback read (7).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname (Windows: "C:\\C:\\Users\\..."). */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const panel = read("components/portal/role-panels.tsx");
const migration = read("worker/migrations/0123_inventory_unit_cost.sql");

/* The three regions this guard is about, sliced out so a rule proved here is
   proved about the right code and not about some neighbour of it. */
const patchInv = (() => {
  const i = staff.indexOf("const invMatch = path.match(/^\\/inventory\\/(\\d+)$/)");
  const j = staff.indexOf('"/inventory/', i + 200);
  return i >= 0 && j > i ? staff.slice(i, j) : "";
})();
const getOuts = (() => {
  const i = staff.indexOf('if (path === "/inventory/manual-outs" && method === "GET")');
  const j = staff.indexOf('if (path === "/inventory/tiktok-out"', i);
  return i >= 0 && j > i ? staff.slice(i, j) : "";
})();
const modal = (() => {
  const i = panel.indexOf("{outModal && (");
  const j = panel.indexOf("Date of stock in", i);
  return i >= 0 && j > i ? panel.slice(i, j) : "";
})();

ok("the PATCH, the movements read and the modal were all found",
   patchInv.length > 0 && getOuts.length > 0 && modal.length > 0,
   "the checks below would pass on nothing");

/* ---- 1. per unit AND line total ---- */
{
  ok("the sale chip prints the unit price and the line total",
     /rmBare\(o\.unit_sale_cents\)\}\{L\("\/unit"[\s\S]{0,40}?rmBare\(o\.unit_sale_cents \* o\.qty\)/.test(panel),
     "a 4-piece row at RM 25 read as if RM 25 left the building");
  ok("the cost chip does the same",
     /rmBare\(o\.item_cost_cents\)\}\{L\("\/unit"[\s\S]{0,40}?rmBare\(o\.item_cost_cents \* o\.qty\)/.test(panel));
  ok("the price box on the form says which one it wants",
     /Sold @ \(RM\/unit/.test(modal),
     "the stored figure has always been per unit; the label never said so");
}

/* ---- 2. a non-sale movement is valued at COST ---- */
{
  ok("each movement row carries the item's cost from the item table",
     /i\.unit_cost_cents AS item_cost_cents/.test(getOuts) && /LEFT JOIN inventory_items i ON i\.id = m\.item_id/.test(getOuts));
  ok("the correction chip shows the cost, not the selling price",
     /o\.item_cost_cents != null[\s\S]{0,400}?rmBare\(o\.item_cost_cents\)/.test(panel) &&
     !/correction[\s\S]{0,200}?rmBare\(o\.unit_sale_cents\)/.test(panel),
     "valuing a correction at the selling price overstates the loss by the whole margin");
  ok("the migration says why the cost had to exist at all",
     /overstated the loss by the whole margin/i.test(migration));
}

/* ---- 3. "nobody has said yet" is not "free" ---- */
{
  ok("the column is nullable with no default",
     /ADD COLUMN unit_cost_cents INTEGER;/.test(migration) &&
     !/unit_cost_cents INTEGER[^;]*(NOT NULL|DEFAULT)/i.test(migration),
     "DEFAULT 0 would make every un-costed piece free on a total the CEO acts on");
  ok("the migration writes the reason down where the column lives",
     /NULLABLE ON PURPOSE/i.test(migration));
  ok("rows with no cost are counted",
     /const unknown = outs\.filter\(\(o\) => o\.item_cost_cents == null\)\.length/.test(panel));
  ok("and named on the screen, not left silent",
     /\$\{unknown\} of them cannot be valued yet/.test(panel) && /lower than the truth/.test(panel),
     "a total that quietly understates is worse than no total");
  ok("the sum only adds a cost it actually has",
     /o\.item_cost_cents != null \? o\.item_cost_cents \* o\.qty : 0/.test(panel));
  ok("an empty box clears the cost rather than storing zero",
     /unit_cost: null/.test(panel) && /const clearsCost = body\.unit_cost === null/.test(patchInv));
  ok("and a cleared cost is written as NULL, not as 0",
     /\.bind\(clearsCost \? null : costU,/.test(patchInv));
}

/* ---- 4. a cost save carries nothing else ---- */
{
  ok("the cost is written by its own UPDATE",
     /UPDATE inventory_items SET unit_cost_cents = \?1, updated_by = \?2, updated_at = datetime\('now'\) WHERE id = \?3/.test(patchInv));
  ok("that UPDATE touches neither stock nor price nor status",
     !/unit_cost_cents = \?1[^`]*\b(stock|status|unit_price_cents)\b/.test(patchInv),
     "the v1.139.0 lesson: a save that carried a stale stock count undid a day of TikTok deductions");
  ok("and it only runs when the caller said something about the cost",
     /if \(costU !== null \|\| clearsCost\) \{/.test(patchInv));
  /* each stock/price statement on its own - from "UPDATE" to the backtick
     that ends its template literal - so the separate cost UPDATE that follows
     a few lines later cannot be mistaken for part of it */
  const stockStatements = [...patchInv.matchAll(/UPDATE inventory_items SET \$\{setStockSql\}[^`]*/g)].map((m) => m[0]);
  ok("both stock/price UPDATEs were found", stockStatements.length === 2,
     `found ${stockStatements.length}`);
  ok("neither of the stock/price UPDATEs mentions the cost",
     stockStatements.length === 2 && stockStatements.every((s) => !s.includes("unit_cost_cents")),
     "folding it in would mean every price save also wrote a cost");
  ok("the audit trail records a cost change",
     /unit_cost_cents: clearsCost \? null : costU/.test(patchInv));
}

/* ---- 5. sales and reverted rows are out of the without-a-sale total ---- */
{
  ok("the total counts only live, un-sold movements",
     /manualOuts\.filter\(\(o\) => !o\.reverted && o\.unit_sale_cents == null\)/.test(panel),
     "a sale is revenue counted elsewhere; a reverted row came back on the shelf");
  ok("stock that went back IN is separated from stock that went out",
     /live\.filter\(\(o\) => o\.direction !== "in"\)/.test(panel) && /live\.filter\(\(o\) => o\.direction === "in"\)/.test(panel),
     "netting them would hide a loss behind an unrelated receipt");
  ok("the band says what it is counting", /What left the shelf without a sale/.test(panel));
}

/* ---- 6. the cost is said where the decision is made ---- */
{
  ok("the modal shows the cost while the movement is being recorded",
     /outModal\.dir === "out" && outModal\.price\.trim\(\) === ""/.test(modal) &&
     /it\.unit_cost_cents != null/.test(modal),
     "the list afterwards is not the moment somebody decides whether to take the piece");
  ok("it shows per unit and the line total there too",
     /rmBare\(it\.unit_cost_cents\)[\s\S]{0,200}?rmBare\(it\.unit_cost_cents \* n\)/.test(modal));
  ok("no cost on the item is said as such, not as free",
     /No Cost\/unit is set for this item/.test(modal));
  ok("the hint is only on a movement that is not a sale",
     !/outModal\.dir === "in"[\s\S]{0,120}?unit_cost_cents/.test(modal),
     "nothing costs the company anything on the way IN");
  ok("the stock list can set it in the first place",
     /Cost\/unit/.test(panel) && /unit_cost: v/.test(panel));
}

/* ---- 7. the list survives deploy-before-migrate ---- */
{
  ok("a read that cannot join the cost still returns the movements",
     /catch \{[\s\S]{0,900}?SELECT m\.\*, u\.name AS created_by_name\s*\n\s*FROM manual_stockouts m/.test(getOuts),
     "the audit trail must not go blank between the code deploying and 0123 running");
  ok("saving a cost before the migration names the right migration",
     /unit_cost_cents.*\? "0123_inventory_unit_cost"/.test(patchInv),
     "sending somebody to 0046 for a cost error has them apply a migration that cannot fix it");
}

/* ---- 8. the migration is registered the house way (the triple bump) ---- */
{
  ok("LATEST_MIGRATION names it", /const LATEST_MIGRATION = "0123_inventory_unit_cost"/.test(index));
  ok("EXPECTED_MIGRATIONS lists it", /"0123_inventory_unit_cost",/.test(index));
  ok("a health probe can name it", /unit_cost_cents FROM inventory_items LIMIT 1/.test(index));
}

console.log(failed === 0
  ? `movement-cost: ${passed} checks passed.`
  : `\n${failed} movement-cost check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
