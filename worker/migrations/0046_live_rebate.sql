-- 0046: TikTok Live rebate per inventory item (v1.4.164)
-- The rebate announced during a TikTok Live ("harga live") — the item's
-- effective live price = unit_price_cents − live_rebate_cents, shown as its
-- own NET (LIVE) column. Informational for pricing decisions: actual TikTok
-- revenue keeps coming from the amounts buyers really paid (order sync).
ALTER TABLE inventory_items ADD COLUMN live_rebate_cents INTEGER NOT NULL DEFAULT 0;
