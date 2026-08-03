-- 0048: Manual sales (v1.4.169)
-- A manual "Out −" with a sold price entered is a SALE (e.g. walk-in /
-- offline sale at a live venue) and must count in total sales. A manual out
-- WITHOUT a price stays a plain stock correction (damage, samples) and is
-- deliberately excluded so corrections never inflate revenue.
-- No FOREIGN KEYs by house rule — item referenced by id + snapshot columns.
CREATE TABLE IF NOT EXISTS manual_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  sku TEXT,
  item_name TEXT,
  qty INTEGER NOT NULL,
  unit_sale_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manual_sales_created ON manual_sales (created_at);
