-- 0016: Multi-item postage orders (v1.4.32)
--
-- One order ships many items in different quantities. Each line lives here;
-- creating the order deducts every line's stock (validated first — the whole
-- order is refused if ANY line lacks stock), and a return restocks every
-- line, once. The single-item columns on postage_records (0015) remain for
-- records created before this migration.

CREATE TABLE IF NOT EXISTS postage_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postage_id INTEGER NOT NULL REFERENCES postage_records(id),
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty INTEGER NOT NULL CHECK (qty >= 1)
);
CREATE INDEX IF NOT EXISTS idx_postage_items ON postage_items (postage_id);
