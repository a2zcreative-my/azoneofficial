-- 0160 - A quotation acceptance recorded by staff, release 1.246.3. The
-- owner, 01-11-2026: once the client agrees to proceed, and only then, a
-- project can start. Until now the only acceptance was the customer own
-- on the shared link. A salesperson who hears the yes on WhatsApp, by phone
-- or on a signed purchase order now records it against the current
-- revision, naming who agreed and how. Additive only - three nullable
-- columns on the existing acceptance table, no existing row changed.
-- channel: link (the customer on the shared link - the rows that exist
-- today have NULL and mean the same), whatsapp, email, phone, signed,
-- in_person. recorded_by: the staff member who recorded it, NULL for the
-- customer own acceptance. note: the reference the salesperson was given.
ALTER TABLE quotation_acceptances ADD COLUMN channel TEXT;
ALTER TABLE quotation_acceptances ADD COLUMN recorded_by INTEGER;
ALTER TABLE quotation_acceptances ADD COLUMN note TEXT;
