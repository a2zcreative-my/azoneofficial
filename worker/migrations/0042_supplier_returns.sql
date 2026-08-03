-- v1.4.148: supplier returns — rejected/defective stock sent back to the
-- supplier, with the costing tracked so the company can claim the money back.
-- No FOREIGN KEYs (house rule since the v1.4.69 incident): item_id references
-- inventory_items.id by value; sku/item_name are snapshots so the record
-- stays meaningful even if the item is later renamed or removed.
CREATE TABLE IF NOT EXISTS supplier_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  sku TEXT NOT NULL,
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL,
  reason TEXT,
  return_date TEXT NOT NULL,           -- ISO yyyy-mm-dd
  status TEXT NOT NULL DEFAULT 'outstanding',  -- outstanding | credited
  credited_at TEXT,
  credited_cents INTEGER,              -- what the supplier actually refunded
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_date ON supplier_returns (return_date);
