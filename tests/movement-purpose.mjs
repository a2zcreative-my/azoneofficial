/**
 * A REASON, NOT A PRICE BOX, DECIDES WHAT A SALE IS — guard #67, v1.148.0.
 *
 * The CEO, 09-09-2026, looking at a dashboard reading RM 1,025.00 of sales
 * on a day with zero TikTok orders: *"the manual stock out price sales
 * should not recorded as a sales which is I need to review that the total of
 * price that I hold under my stock manual which is internal use for
 * marketing and need to revert back when the marketing use completed."*
 *
 * Ten pieces went out for a marketing shoot. They were recorded correctly -
 * reason "Internal use" - and a price was typed in beside them. Since
 * v1.4.169 the rule had been "a price is what makes an out a sale", and the
 * reason was pasted into the remark as prose that nothing ever read back. So
 * ten loans became ten sales, and RM 1,025.00 of income the company was
 * never paid went into today's figure, the month, and the KPI bar.
 *
 * THE PROPERTIES, not the implementation:
 *   1. THE REASON DECIDES. Exactly one purpose is a sale. A price on any
 *      other movement is the VALUE of the pieces and must not reach
 *      manual_sales. This is the whole bug.
 *   2. THE REASON SURVIVES AS DATA. Prose in a remark cannot be acted on and
 *      cannot be trusted - somebody edits the remark and the classification
 *      is gone. It is a column, and a fixed set of keys.
 *   3. A LOAN IS NOT A LOSS AND NOT A SALE. Stock at a shoot has not left
 *      the company. It has its own register with its own total, and it is
 *      excluded from "what left the shelf without a sale" - the same pieces
 *      must never be counted as lost and lent at once.
 *   4. A RETURN IS NOT A REVERT. Both put stock back; one says the record
 *      was a mistake and the other says a loan closed as planned. An audit
 *      trail that cannot tell them apart is worth less than one that can.
 *      Only a loan can be returned - marking a damaged piece "returned"
 *      would put stock on the shelf that does not exist.
 *   5. NO MIGRATION SILENTLY REWRITES REVENUE. 0124 reclassifies movements
 *      and moves no money: what the company earned is not changed inside a
 *      schema step with nobody looking. The affected rows are named on
 *      screen and cleared on the CEO's word, audited, CEO/COO only.
 *   6. OLD ROWS KEEP THEIR OLD MEANING. A movement written before 0124 has
 *      no purpose; treating a missing purpose as "not a sale" would erase
 *      historic revenue on sight.
 *   7. STOCK MOVES ATOMICALLY. The return path adds with `stock = stock + ?`
 *      rather than reading a count and writing an absolute figure back - the
 *      v1.139.0 incident, which undid a day of TikTok deductions.
 *   8. THE MIGRATION IS REGISTERED THE HOUSE WAY (the triple bump).
 *
 * Negative-tested by: letting any purpose create a sale (1); dropping the
 * purpose column from the insert (2); counting loans in the loss band (3);
 * allowing a damaged row to be returned (4); deleting manual_sales inside
 * the migration (5); treating a null purpose as not-a-sale (6); and making
 * the return read-then-write the stock (7).
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
const migration = read("worker/migrations/0124_movement_purpose.sql");

const adjust = (() => {
  const i = staff.indexOf("const invAdjust = path.match");
  const j = staff.indexOf("checkLowStock(Number(invAdjust[1]))", i);
  return i >= 0 && j > i ? staff.slice(i, j) : "";
})();
const returned = (() => {
  const i = staff.indexOf('if (action === "returned")');
  const j = staff.indexOf('if (action === "revert")', i);
  return i >= 0 && j > i ? staff.slice(i, j) : "";
})();
const misSoldPost = (() => {
  const i = staff.indexOf('if (path === "/inventory/mis-sold" && method === "POST")');
  const j = staff.indexOf('if (path === "/inventory/on-loan"', i);
  return i >= 0 && j > i ? staff.slice(i, j) : "";
})();

ok("the adjust route, the return action and the un-sell route were all found",
   adjust.length > 0 && returned.length > 0 && misSoldPost.length > 0,
   "the checks below would pass on nothing");

/* ---- 1. the reason decides, not the price box ---- */
{
  ok("exactly one purpose is a sale",
     /export const SALE_PURPOSES = \["sold_offline"\]/.test(staff),
     "a second sale reason is a second way for a loan to become income");
  ok("the sale is gated on the purpose, not merely on a price",
     /const isSale = priceC !== null && \(purpose === null \|\| purpose === "sold_offline"\)/.test(adjust));
  ok("only that decides whether manual_sales is written",
     /const saleC = isSale \? priceC : null/.test(adjust) &&
     /if \(saleC !== null\) \{[\s\S]{0,600}?INSERT INTO manual_sales/.test(adjust),
     "this is the exact line that booked a marketing shoot as RM 1,025 of revenue");
  ok("a purpose the code does not know is refused rather than trusted",
     /MOVE_PURPOSES\.includes\(purposeRaw\)/.test(adjust));
  ok("the price is still KEPT on a non-sale movement",
     /const args = \[.*Math\.abs\(delta\), priceC,/.test(adjust),
     "he asked to review what the stock he is holding is worth - discarding the figure would answer the wrong question");
  ok("the form stops calling it a sale when the reason is not one",
     /Value @ \(RM\/unit, optional\) — NOT a sale/.test(panel) && /PURPOSE_OF\[outModal\.reason\] === SALE_PURPOSE/.test(panel));
  ok("and the chip in the records does the same",
     /const isSaleRow = o\.unit_sale_cents != null && \(o\.purpose == null \|\| o\.purpose === SALE_PURPOSE\)/.test(panel));
}

/* ---- 2. the reason survives as data ---- */
{
  ok("the movement stores its purpose", /INSERT INTO manual_stockouts[^`]*purpose\)/.test(adjust));
  ok("the column exists", /ALTER TABLE manual_stockouts ADD COLUMN purpose TEXT;/.test(migration));
  ok("the browser sends a key, not the label somebody reads",
     /PURPOSE_OF\[outModal\.reason\]/.test(panel) && /const PURPOSE_OF: Record<string, string>/.test(panel));
  ok("existing rows are classified from the reason they were written with",
     /UPDATE manual_stockouts SET purpose = 'internal_use'/.test(migration) &&
     /UPDATE manual_stockouts SET purpose = 'sold_offline'/.test(migration));
  ok("a row whose reason cannot be read is left alone, not guessed at",
     /WHERE purpose IS NULL AND/.test(migration) && /rather than guessing/i.test(migration));
  ok("marketing is its own reason, not folded into internal use",
     /"Marketing \/ content shoot — coming back"/.test(panel) && /marketing_loan/.test(panel));
}

/* ---- 3. a loan is not a loss and not a sale ---- */
{
  ok("what is out on loan has one definition", /export const LOAN_PURPOSES = \["marketing_loan", "internal_use"\]/.test(staff));
  ok("and one SQL for what has not come back",
     /export const onLoanSql = \(a = ""\)/.test(staff) && /returned_at IS NULL/.test(staff));
  ok("that fragment takes an alias rather than being string-surgeried at the call site",
     /onLoanSql\("m\."\)/.test(staff) && !/ON_LOAN_SQL\.replace/.test(staff),
     "a regex over SQL is one bad match away from selecting the wrong rows");
  ok("the register totals it at cost AND at retail",
     /cost_cents: costCents, retail_cents: retailCents/.test(staff),
     "what it cost is the exposure; what it retails for is the shelf value walking around");
  ok("items with no cost are counted and named there too",
     /no_cost: noCost/.test(staff) && /have no Cost\/unit set, so the cost figure is lower than the truth/.test(panel));
  ok("loans are excluded from what left the shelf without a sale",
     /return !LOAN_PURPOSES\.includes\(o\.purpose \?\? ""\)/.test(panel),
     "the same pieces must never read as lost and lent at the same time");
  ok("and so are loans that already came back",
     /if \(o\.reverted \|\| o\.returned_at\) return false/.test(panel));
  ok("the panel shows the total he asked for", /Out with marketing \/ internal use — still to come back/.test(panel));
}

/* ---- 4. a return is not a revert ---- */
{
  ok("returned is its own action", /\(edit\|revert\|delete\|returned\)/.test(staff));
  ok("it is recorded in its own column, not as reverted",
     /UPDATE manual_stockouts SET returned_at = datetime\('now'\)/.test(returned) &&
     !/SET reverted = 1/.test(returned));
  ok("only a loan can be returned",
     /LOAN_PURPOSES\.includes\(row\.purpose \?\? ""\)/.test(returned),
     "marking a damaged piece returned would put stock on the shelf that does not exist");
  ok("an already-returned row cannot be returned twice",
     /if \(row\.returned_at\) return err\("invalid_state"/.test(returned),
     "twice would add the stock twice");
  ok("nor can a reverted one", /if \(isReverted\) return err\("invalid_state"/.test(returned));
  ok("it is audited as a return, not as a revert",
     /"inventory\.manual_out_returned"/.test(staff));
  ok("the records list says which happened",
     /✓ returned — back on the shelf/.test(panel) && /↩ reverted — stock restored/.test(panel));
}

/* ---- 5. no migration silently rewrites revenue ---- */
{
  ok("the migration deletes no money", !/DELETE FROM manual_sales/i.test(migration));
  ok("and says so where the next reader will look", /NOTHING IS UN-SOLD HERE/.test(migration));
  ok("the affected rows are named on screen before anything is removed",
     /Counted as revenue, but recorded as not a sale/.test(panel));
  ok("removing them is CEO or COO only",
     /\["super_admin", "ceo", "coo"\]\.includes\(user\.role\)[\s\S]{0,200}?remove revenue that was recorded in error/.test(misSoldPost));
  ok("and it is audited with what was removed",
     /"inventory\.mis_sold_cleared"[\s\S]{0,160}?rows: removed, cents/.test(misSoldPost));
  ok("the movement itself survives the un-selling",
     /UPDATE manual_stockouts SET sale_id = NULL/.test(misSoldPost) && !/DELETE FROM manual_stockouts/.test(misSoldPost),
     "the stock still left the shelf - only the revenue was wrong");
}

/* ---- 6. old rows keep their old meaning ---- */
{
  ok("a movement with no purpose is still read the old way, in the worker",
     /purpose === null \|\| purpose === "sold_offline"/.test(adjust));
  ok("and in the panel", /o\.purpose == null \|\| o\.purpose === SALE_PURPOSE/.test(panel));
  ok("the un-sell list never touches a row with no purpose",
     /m\.purpose IS NOT NULL/.test(staff),
     "a pre-0124 sale would otherwise be swept away as mis-booked");
  ok("the column is nullable, so there is such a thing as not knowing",
     !/purpose TEXT[^;]*(NOT NULL|DEFAULT)/i.test(migration));
}

/* ---- 7. stock moves atomically ---- */
{
  ok("the return adds to the count in SQL rather than writing a figure it read",
     /UPDATE inventory_items SET stock = stock \+ \?1/.test(returned),
     "read-then-write is the v1.139.0 incident: a sync landing in the gap is overwritten");
  ok("and the status is recomputed from where the count ENDED",
     /SET status = CASE WHEN stock = 0/.test(returned));
  ok("a missing item is noticed rather than silently doing nothing",
     /if \(!upd\.meta\.changes\) return err\("not_found"/.test(returned));
}

/* ---- 8. the triple bump ---- */
{
  /* v1.149.0 - the moving line, asserted the way event-attendees and
     movement-cost now do: registered, and never rewound past. */
  const latest = index.match(/const LATEST_MIGRATION = "(\d{4})_/);
  ok("LATEST_MIGRATION is set and is 0124 or newer", !!latest && Number(latest[1]) >= 124,
     latest ? `LATEST_MIGRATION is ${latest[1]}` : "not found");
  ok("EXPECTED_MIGRATIONS lists it", /"0124_movement_purpose",/.test(index));
  ok("a health probe can name it", /SELECT purpose FROM manual_stockouts LIMIT 1/.test(index));
}

console.log(failed === 0
  ? `movement-purpose: ${passed} checks passed.`
  : `\n${failed} movement-purpose check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
