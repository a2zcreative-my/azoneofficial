-- 0086 — the ELFIA tab (v1.45.0).
--
-- The CEO, 25-08-2026: "on portal I want an option for me to upload the photo
-- and also to bridge directly to ELFIA … should create a new tab for ELFIA on
-- the inventory which is sync inventory, photo upload, description and
-- product."
--
-- Until now the feed could only DESCRIBE an item the store already had.
-- These four columns let the portal be the item's author: the store creates
-- a product it has never seen (hidden, pending the CEO's Publish over there)
-- from the feed's name + price, and dresses it with the photo, description
-- and collection set HERE, in the portal's ELFIA tab.
--
--   elfia_category    'bawal' | 'shawl' — which ELFIA collection the item
--                     belongs to. NULL = the store defaults to bawal.
--   elfia_description The write-up the ELFIA product page shows. Owned by
--                     the portal for portal-created products only — the
--                     store never lets the feed overwrite a description
--                     typed in its own /admin.
--   elfia_image_key   R2 key of the product photo, under uploads/elfia/
--                     (the PUBLIC media prefix — a product photo is public
--                     by definition; nothing else in the bucket is exposed).
--   elfia_image_updated_at
--                     Set on every upload. Travels in the feed as
--                     image_updated_at; the store re-downloads ONLY when it
--                     changes, so the 5-minute cron repeats it for free.
--
-- All four default NULL: an item nobody has dressed keeps behaving exactly
-- as before, and the feed omits the fields (spec rule: absent = the store
-- keeps what it has).

ALTER TABLE inventory_items ADD COLUMN elfia_category TEXT;
ALTER TABLE inventory_items ADD COLUMN elfia_description TEXT;
ALTER TABLE inventory_items ADD COLUMN elfia_image_key TEXT;
ALTER TABLE inventory_items ADD COLUMN elfia_image_updated_at TEXT;
