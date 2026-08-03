-- 0050: Manual stock-out lifecycle (v1.4.172)
-- out_date  : the DATE the stock actually went out (backdatable, MYT) —
--             created_at stays as the recording timestamp. Sales totals
--             attribute by out_date when present.
-- reverted  : 1 after "Revert" — stock went back on the shelf and any sale
--             was removed from the totals, but the ROW STAYS for the audit
--             trail (traceability is the whole point of this card).
-- sale_id   : links the stock-out to its manual_sales row so Edit/Revert/
--             Delete can keep the revenue totals exactly in step.
ALTER TABLE manual_stockouts ADD COLUMN out_date TEXT;
ALTER TABLE manual_stockouts ADD COLUMN reverted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manual_stockouts ADD COLUMN sale_id INTEGER;
ALTER TABLE manual_sales ADD COLUMN out_date TEXT;
