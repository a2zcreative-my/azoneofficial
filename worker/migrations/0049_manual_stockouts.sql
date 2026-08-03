-- 0049: Manual stock-out traceability (v1.4.170)
-- Every manual "Out −" now records WHO took WHAT out, WHEN and WHY —
-- the remark is mandatory so no stock ever leaves the shelf unexplained.
-- unit_sale_cents is filled when the out was also a sale (Sold @ entered);
-- NULL means a plain correction (damage / samples / count fix).
-- No FOREIGN KEYs by house rule — item referenced by id + snapshot columns.
CREATE TABLE IF NOT EXISTS manual_stockouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  sku TEXT,
  item_name TEXT,
  qty INTEGER NOT NULL,
  unit_sale_cents INTEGER,
  remark TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manual_stockouts_created ON manual_stockouts (created_at);
