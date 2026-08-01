-- v1.4.71: buyer city (only — never the full address) captured from TikTok
-- orders so staff can see roughly where each parcel is headed.
ALTER TABLE postage_records ADD COLUMN buyer_city TEXT;
