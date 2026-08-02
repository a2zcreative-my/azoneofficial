-- v1.4.93: who made the sale. Any staff member can be the salesperson on a
-- QT/DO/INV; defaults to the document's creator. No foreign key by policy.
ALTER TABLE sales_documents ADD COLUMN salesperson_id INTEGER;
