-- 0012: Staff full name (v1.4.22)
--
-- The badge card needs the person's full legal name (e.g. "Mohd Alif Farhan
-- Bin Nazarudin") separate from the short display name the account uses.
-- blood_type is retired from the UI and badge in the same release; the column
-- stays (append-only schema policy) but is no longer shown or edited.

ALTER TABLE users ADD COLUMN full_name TEXT;
