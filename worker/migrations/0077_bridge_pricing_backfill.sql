-- 0077 — v1.39.0: backfill + index for 0075/0076. Every statement here is
-- convergent — a replay after a half-apply changes nothing and errors never.
--
-- The backfill grants bridge_enabled to exactly the set the old hard-coded
-- LIKE was publishing, so the first deploy changes nothing about WHICH items
-- the store sees. Scoped by "= 0" so a re-run cannot re-enable an item a
-- human has since unticked.

UPDATE inventory_items
   SET bridge_enabled = 1
 WHERE bridge_enabled = 0
   AND (UPPER(REPLACE(sku, ' ', '')) LIKE 'ELFIA%'
     OR UPPER(REPLACE(sku, ' ', '')) LIKE 'LUMI%');

CREATE INDEX IF NOT EXISTS idx_inventory_bridge ON inventory_items (bridge_enabled);
