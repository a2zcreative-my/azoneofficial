-- 0182 - Deposit billing for service quotations (v1.273.0).
--
-- The CEO, 10-11-2026: build deposit billing - any percent or amount, service
-- quotations only, commission per paid invoice.
--
-- 0157 allowed ONE live invoice per quotation. A service quotation may now be
-- billed in parts (a deposit, progress, the balance). The worker refuses any
-- part that would take the live invoices of a quotation past its total, in
-- the same statement that writes the invoice.
--
-- A product quotation keeps exactly one live invoice, because its stock moves
-- with the invoice. The new index below holds that for product invoices only.
-- It is created before the old one is dropped, so the rule for products is
-- never absent. No row is changed. The new index cannot fail on existing data
-- because the old index was stricter than it.

CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_live_per_product_qt ON sales_documents (converted_from)
  WHERE doc_type = 'INV' AND converted_from IS NOT NULL AND voided_at IS NULL AND COALESCE(kind, 'product') != 'service';

DROP INDEX IF EXISTS ux_inv_live_per_qt;
