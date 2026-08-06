-- v1.4.233: an invoice created via Quotation → Invoice remembers its source
-- quotation, enabling a safe "undo conversion" (delete the accidental,
-- still-unpaid invoice; the quotation itself is never touched).
ALTER TABLE sales_documents ADD COLUMN converted_from INTEGER;
