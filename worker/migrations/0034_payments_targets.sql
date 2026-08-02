-- v1.4.90: invoice payments + sales KPI targets.
-- Payments: an invoice marked paid records HOW (bank transfer) and WHEN —
-- revenue then counts on a payment-received basis.
-- Targets: the company's monthly sales KPI, shown as progress on the
-- revenue card. No foreign keys by policy.
ALTER TABLE sales_documents ADD COLUMN payment_method TEXT;
ALTER TABLE sales_documents ADD COLUMN payment_ref TEXT;
ALTER TABLE sales_documents ADD COLUMN paid_at TEXT;
CREATE TABLE IF NOT EXISTS sales_targets (
  month TEXT PRIMARY KEY,            -- YYYY-MM
  target_cents INTEGER NOT NULL,
  set_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
