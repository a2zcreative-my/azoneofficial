-- 0079 — v1.39.0: normalised SKU match key, so the store's 'LUMI001' finds
-- the portal's 'LUMI 001'. One ALTER, nothing else (audit B4 rule).
--
-- AUDIT M8: the key is COMPUTED IN JS (bridge-core skuKey — Unicode
-- uppercase, ALL whitespace stripped) and bound as a value by every route
-- that writes a SKU; SQL expressions are only the coarse backfill in 0080.
-- The movements handler carries an expression fallback for rows whose key
-- is stale or NULL, so a mismatch degrades to a slower match, never a lost
-- sale.

ALTER TABLE inventory_items ADD COLUMN sku_key TEXT;
