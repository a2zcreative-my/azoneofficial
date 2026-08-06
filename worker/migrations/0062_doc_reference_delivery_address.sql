-- v1.4.243 — Malaysian-standard sales documents.
--
-- reference        : the buyer's own PO / quotation reference, printed in the
--                    document's meta strip. Prints "N/A" when empty (CEO).
-- delivery_address : ship-to, when it differs from the billing address. Kept
--                    per DOCUMENT (a customer can ship anywhere) with the
--                    customer record holding the usual default.
--
-- No foreign keys (v1.4.69 incident). All columns nullable — every existing
-- document stays valid and simply prints without them.

ALTER TABLE sales_documents ADD COLUMN reference TEXT;
ALTER TABLE sales_documents ADD COLUMN delivery_address TEXT;
ALTER TABLE customers ADD COLUMN delivery_address TEXT;
