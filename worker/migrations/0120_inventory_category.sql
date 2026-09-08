-- 0120 - v1.136.0: the item OWN category, so the stock list can be read one
-- family at a time.
--
-- The CEO, 08-09-2026: I want to have a category based on their category
-- which is either shawl or bawal so that I can easily review based on the
-- category that I choose.
--
-- Free text, not a fixed list: bawal and shawl are what the shop sells today
-- and the next thing it sells should not need a migration. Backfilled from
-- the ELFIA collection wherever one is already set, so the grouping the CEO
-- built for the shop is not typed a second time here.
--
-- elfia_category is left exactly as it is and keeps its own job: which
-- collection an item appears in ON THE SHOP. This column is the warehouse
-- answer to what kind of thing an item is, and it is the one the stock list,
-- the CSV count sheet and the TikTok line matcher read.
ALTER TABLE inventory_items ADD COLUMN category TEXT;

UPDATE inventory_items
   SET category = trim(elfia_category)
 WHERE category IS NULL
   AND elfia_category IS NOT NULL
   AND trim(elfia_category) != '';
