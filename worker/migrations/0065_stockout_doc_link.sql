-- v1.4.263 — link a stock movement to the sales document that caused it.
--
-- A product INVOICE now deducts inventory the moment it is created (CEO:
-- "if sales invoice created, inventory should be deducted to tally the
-- inventory"). Each deduction is logged in manual_stockouts like any other
-- movement, and doc_id is what lets a deleted or reversed invoice put its
-- stock back precisely — remark-matching would break the first time a
-- document number appeared in a hand-typed remark.

ALTER TABLE manual_stockouts ADD COLUMN doc_id INTEGER;
