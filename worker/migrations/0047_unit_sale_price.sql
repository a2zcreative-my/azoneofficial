-- 0047: Actual TikTok sold price per stock movement (v1.4.166)
-- Each TikTok line carries sale_price (what the buyer really paid per unit,
-- after live rebates/discounts). Stored on the movement so:
--   rebate = inventory list price − actual sold price   (computed, not typed)
-- and the per-item live pricing (live_rebate_cents, v1.4.164) is now
-- AUTO-SYNCED from the latest firm order instead of manual entry.
ALTER TABLE postage_items ADD COLUMN unit_sale_cents INTEGER;
