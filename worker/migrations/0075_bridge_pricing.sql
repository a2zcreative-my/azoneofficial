-- 0075 — v1.35.0: the portal owns ELFIA's selling price.
--
-- CEO: "I want my system a2zcreative sync the prices and inventory to ELFIA."
-- The store's PORTAL-BRIDGE-SPEC.md has been waiting on our side of this since
-- v1.31.0: its 5-minute pull already accepts an optional price_cents per SKU,
-- and applies it straight onto the shop's price tag.
--
-- No foreign keys (house rule since v1.4.69). Money in integer sen.

-- Which items the ELFIA bridge is allowed to publish. Explicit beats the old
-- SKU-prefix LIKE: renaming a SKU must not silently add or drop a product
-- from a client-facing shop.
ALTER TABLE inventory_items ADD COLUMN bridge_enabled INTEGER NOT NULL DEFAULT 0;

-- The web selling price in sen. NULL = "no web-specific price" and the feed
-- falls back to unit_price_cents. Deliberately NOT unit_price_cents minus
-- live_rebate_cents: the live rebate is a TikTok LIVE mechanic (v1.4.164)
-- and must never leak onto the shop's price tag. A web discount is set here,
-- explicitly, as the net figure the customer actually pays.
ALTER TABLE inventory_items ADD COLUMN elfia_price_cents INTEGER;

-- Backfill exactly the set the old hard-coded LIKE was publishing, so the
-- first deploy changes nothing about WHICH items the store sees.
UPDATE inventory_items
   SET bridge_enabled = 1
 WHERE UPPER(REPLACE(sku, ' ', '')) LIKE 'ELFIA%'
    OR UPPER(REPLACE(sku, ' ', '')) LIKE 'LUMI%';

CREATE INDEX IF NOT EXISTS idx_inventory_bridge ON inventory_items (bridge_enabled);
