-- 0157 - Invoice void lifecycle and one live invoice per quotation (go-live
-- audit B2, the owner decision D-2 of 31-10-2026). Additive only - no
-- existing row is changed.
-- A numbered invoice is never deleted. It is voided: voided_at says when,
-- voided_by who, void_reason why (the row also carries payment_status void).
-- An invoice raised to replace a voided one names it in replaces_doc_id.
ALTER TABLE sales_documents ADD COLUMN voided_at TEXT;
ALTER TABLE sales_documents ADD COLUMN voided_by INTEGER;
ALTER TABLE sales_documents ADD COLUMN void_reason TEXT;
ALTER TABLE sales_documents ADD COLUMN replaces_doc_id INTEGER;
-- Exactly one live invoice may exist per quotation. The index is partial, so
-- voided invoices and invoices raised without a quotation are not counted.
-- It is created only when no quotation already has two live invoices - the
-- release pre-flight (PUSH.bat) checks that first.
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_live_per_qt ON sales_documents (converted_from)
  WHERE doc_type = 'INV' AND converted_from IS NOT NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_documents_voided ON sales_documents (doc_type, voided_at);
