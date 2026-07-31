-- 0015: Postage <-> inventory stock movement (v1.4.31)
--
-- A postage record (shipment) can name the inventory item + quantity it
-- ships; creating it deducts stock automatically (stock OUT). Marking the
-- shipment 'returned' puts the quantity back (stock IN), once. Status
-- (in_stock/low/out_of_stock) recomputes on every movement.

ALTER TABLE postage_records ADD COLUMN inventory_item_id INTEGER REFERENCES inventory_items(id);
ALTER TABLE postage_records ADD COLUMN qty INTEGER;
ALTER TABLE postage_records ADD COLUMN restocked INTEGER NOT NULL DEFAULT 0;
