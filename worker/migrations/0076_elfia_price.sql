-- 0076 — v1.39.0: the web selling price, in sen. NULL = the feed falls back
-- to unit_price_cents. Deliberately NOT unit_price_cents minus
-- live_rebate_cents: the live rebate is a TikTok LIVE mechanic (v1.4.164)
-- and must never leak onto the shop's price tag.
-- One ALTER, nothing else (audit B4 rule — see 0075).

ALTER TABLE inventory_items ADD COLUMN elfia_price_cents INTEGER;
