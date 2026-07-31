-- 0013: Staff photo for the ID badge (v1.4.23)
-- Stores the R2 key of the staff photo (kept under private/staff-photos/ so
-- serving requires staff auth). Badge is portrait from this release.

ALTER TABLE users ADD COLUMN photo_key TEXT;
