-- 0124 - v1.148.0: WHY the stock moved, as data rather than as prose.
--
-- The CEO, 09-09-2026, looking at RM 1,025.00 of sales on a day with zero
-- TikTok orders: "the manual stock out price sales should not recorded as a
-- sales which is I need to review that the total of price that I hold under
-- my stock manual which is internal use for marketing and need to revert
-- back when the marketing use completed"
--
-- WHAT WENT WRONG. Since v1.4.169 the rule was: a price makes an out a sale.
-- The reason the person picked - Internal use, Damaged, Sample - was glued
-- onto the front of the remark as TEXT and never read back by anything. So
-- ten pieces taken out for a marketing shoot, recorded correctly as Internal
-- use with the price filled in, became ten sales and RM 1,025.00 of revenue
-- that nobody was ever paid.
--
-- purpose is that reason, machine readable, so the code can act on it. Only
-- sold_offline may ever create a manual_sales row from now on.
--
-- returned_at is the other half of his sentence. Stock lent to marketing
-- comes BACK. Reverting the row already puts the pieces on the shelf, but
-- revert means the record was a mistake, and a loan closing is not a
-- mistake - an audit trail that cannot tell them apart is worth less than
-- one that can.
--
-- NULLABLE, no default, on purpose. NULL purpose means a row written before
-- this migration whose reason could not be read back - which the backfill
-- below leaves alone rather than guessing at, because guessing here would
-- silently reclassify money.

ALTER TABLE manual_stockouts ADD COLUMN purpose TEXT;
ALTER TABLE manual_stockouts ADD COLUMN returned_at TEXT;

-- BACKFILL from the reason the modal wrote at the front of every remark.
-- The separator it used is a dash outside ASCII, so these match the reason
-- word only, and direction tells the two variance reasons apart.

UPDATE manual_stockouts SET purpose = 'variance_missing'
 WHERE purpose IS NULL AND COALESCE(direction, 'out') = 'out' AND remark LIKE 'Stock count variance%';

UPDATE manual_stockouts SET purpose = 'variance_found'
 WHERE purpose IS NULL AND direction = 'in' AND remark LIKE 'Stock count variance%';

UPDATE manual_stockouts SET purpose = 'damaged'
 WHERE purpose IS NULL AND remark LIKE 'Damaged%';

UPDATE manual_stockouts SET purpose = 'sample'
 WHERE purpose IS NULL AND remark LIKE 'Sample or giveaway%';

UPDATE manual_stockouts SET purpose = 'internal_use'
 WHERE purpose IS NULL AND remark LIKE 'Internal use%';

UPDATE manual_stockouts SET purpose = 'sold_offline'
 WHERE purpose IS NULL AND remark LIKE 'Sold offline%';

UPDATE manual_stockouts SET purpose = 'restock'
 WHERE purpose IS NULL AND remark LIKE 'Restock from supplier%';

UPDATE manual_stockouts SET purpose = 'customer_return'
 WHERE purpose IS NULL AND remark LIKE 'Customer return%';

UPDATE manual_stockouts SET purpose = 'sample_return'
 WHERE purpose IS NULL AND remark LIKE 'Returned from sample%';

UPDATE manual_stockouts SET purpose = 'correction'
 WHERE purpose IS NULL AND remark LIKE 'Data entry correction%';

-- NOTHING IS UN-SOLD HERE. The rows this reclassifies still have their
-- manual_sales rows and still count in revenue. Deleting money rows inside a
-- migration would change what the company earned with no record of who
-- decided it and no chance to look first. The panel now shows what is
-- affected and the CEO removes it from sales himself, audited.

CREATE INDEX IF NOT EXISTS idx_manual_stockouts_purpose ON manual_stockouts (purpose);
