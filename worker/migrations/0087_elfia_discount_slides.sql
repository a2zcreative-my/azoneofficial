-- 0087 — ELFIA discount + the carousel, run from the portal (v1.46.0).
--
-- The CEO, 25-08-2026: "there is a discount for me to update in the portal
-- … I also want to add for the collection photo which is to make the photo
-- of the carousel gallery … to make my staff easier to update all in one
-- finger tips in the portal."
--
-- elfia_discount_cents: a per-item web discount in sen. The feed keeps its
-- standing contract — price_cents is what the customer PAYS — so the
-- serializer sends net = web price − discount, and additionally
-- list_price_cents (the pre-discount number) so the shop can draw the
-- slashed price. Discount 0/NULL = no change to today's behaviour.
--
-- elfia_slides: the ELFIA storefront's hero carousel, authored here. The
-- portal is this table's ONLY owner — the store replaces its copy to match
-- the feed on every pull (photo downloads still gated by image_updated_at),
-- so removing a slide here removes it from the shop. Empty table = the shop
-- falls back to its own shipped campaign slides.

ALTER TABLE inventory_items ADD COLUMN elfia_discount_cents INTEGER;

CREATE TABLE IF NOT EXISTS elfia_slides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_key TEXT NOT NULL,             -- uploads/elfia/slides/… (public prefix)
  image_updated_at TEXT NOT NULL,      -- the store's re-download gate
  title TEXT,                          -- big line on the slide (optional)
  subtitle TEXT,                       -- small line under it (optional)
  sort INTEGER NOT NULL DEFAULT 100,   -- lower first
  active INTEGER NOT NULL DEFAULT 1,   -- 0 = kept but not sent to the store
  created_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
