-- 0088 — how a carousel photo is FRAMED, decided here (v1.47.0).
--
-- The CEO, 25-08-2026, looking at the carousel card: "I want to adjustable
-- the photo so that I can focus on what I want. it is look too zoom and
-- which is cause the photo cant be seen the overall!!"
--
-- The shop's hero is a wide letterbox (21:9 on a desktop, 4:3 on a phone).
-- A tall group photo dropped into it gets cropped, and until now the crop
-- was fixed — the store always kept the middle-ish top of the picture, so
-- heads came off. Two controls fix that, and BOTH belong here, because the
-- person choosing the photo is the person who knows what matters in it.
--
-- focus_x / focus_y: 0-100 per cent, the point that must stay visible when
-- the photo is cropped. 50/50 is the middle; the ELFIA tab sets it by
-- clicking the spot on the photo itself. This is CSS object-position on the
-- store side — no re-encoding, the original file is never touched, so the
-- framing can be changed as often as she likes at no cost.
--
-- fit: 'cover' crops to fill the hero (the default, and what a photographed
-- banner wants). 'contain' shows the WHOLE photo, letterboxed — her "cant be
-- seen the overall" case, for a picture that must not lose its edges.
--
-- Old rows get the sensible middle, so nothing already on the shop moves
-- until someone deliberately reframes it.

ALTER TABLE elfia_slides ADD COLUMN focus_x INTEGER NOT NULL DEFAULT 50;
ALTER TABLE elfia_slides ADD COLUMN focus_y INTEGER NOT NULL DEFAULT 50;
ALTER TABLE elfia_slides ADD COLUMN fit TEXT NOT NULL DEFAULT 'cover';
