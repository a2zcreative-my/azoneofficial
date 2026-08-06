-- v1.4.234: a sales document is for ONE business line — 'product' (ELFIA
-- goods) or 'service' (agency services). Kept as a tag; the form and the
-- printed document follow it, and Delivery Orders are product-only.
ALTER TABLE sales_documents ADD COLUMN kind TEXT;
