-- 0074 (v1.30.0): a client's own brand — their website and their logo.
--
-- CEO: "I just want that customer or client can have a option to click on
-- their logo then will redirecting to their own domain."
--
-- Doing this per CUSTOMER rather than in code is what makes it systematic:
-- ELFIA is simply the first client to have a website and a mark on file, and
-- the tenth client works the same way without a deploy. It also keeps the
-- separation the CEO asked for — a client's brand lives on the CLIENT ROW,
-- never in the A2Z site's own constants.
--
--   website  — canonical URL including scheme, e.g. https://elfiaofficialstore.my
--   logo_key — R2 object key, same convention as users.photo_key. The bytes
--              live in the MEDIA bucket; the row stores only the key.
--
-- Additive, no DEFAULT (nothing to backfill), no CHECK and no FK — house
-- rules since 0044 / v1.4.69.

ALTER TABLE customers ADD COLUMN website  TEXT;
ALTER TABLE customers ADD COLUMN logo_key TEXT;
