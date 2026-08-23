-- 0080 — v1.39.0: backfill + index for 0079. Convergent: the WHERE clause
-- makes a replay a no-op, and existing human-set values are never clobbered.
-- The index is deliberately NOT unique — two existing SKUs may already
-- normalise identically ('LUMI 001' vs 'lumi001'); a unique index would
-- refuse to build and wedge the deploy (audit B4). Collisions are surfaced
-- on the bridge health card instead, and matching orders by id keeps the
-- pick deterministic.

UPDATE inventory_items
   SET sku_key = UPPER(REPLACE(sku, ' ', ''))
 WHERE sku_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_sku_key ON inventory_items (sku_key);
