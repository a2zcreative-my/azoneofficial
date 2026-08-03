-- 0045: Delivery / postage fee on sales documents (v1.4.160)
-- Malaysian SME flow: the Quotation quotes the delivery charge, the Invoice
-- bills it; the Delivery Order carries goods + quantities only (no charges).
-- Fee is added AFTER discount and tax (delivery is a pass-through charge,
-- not part of the taxable goods value for a non-SST-registered business).
ALTER TABLE sales_documents ADD COLUMN delivery_cents INTEGER NOT NULL DEFAULT 0;
