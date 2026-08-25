-- 0085 — v1.44.0: PDPA marketing consent, as it arrives from the ELFIA
-- store's orders feed (store migration 0012 / spec § C).
--
-- 1 = the buyer ticked the marketing box on the store; 0 = they did not, or
-- they withdrew (the store re-sends the order with the flag cleared and the
-- feed's upsert overwrites it here — withdrawal reaches this table within
-- one poll). The portal's marketing list is built ONLY from rows where this
-- is 1: everyone else gave their details to receive a parcel, not promotions.
--
-- Single ALTER, nothing else in this file (audit B4 rule: one non-idempotent
-- statement per migration — a half-apply is a no-apply).

ALTER TABLE web_orders ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0;
