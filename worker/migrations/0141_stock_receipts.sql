-- 0141 - receiving stock from a supplier (ERP roadmap phase 2).
--
-- Purchasing stays retired (owner, 20-10-2026). Stock comes in through a
-- Receive stock form on Inventory: who supplied it, which lines, at what
-- cost. Each line raises the shelf through the same manual movement log a
-- manual stock in already writes, and may move the unit cost of the item to the
-- moving average. A receipt may carry what is owed to the supplier and when,
-- so a later phase can list creditors. It writes no expense and no cash
-- entry: the profit and loss and the cash book read exactly as before.
-- A receipt is voided, never deleted. Its lines keep the stock and cost each
-- item had before and after, so a void can say what it undid.
-- reorder_level and reorder_qty are optional per item. Empty means the
-- portal behaves as it always has: the low stock rule stays at its own line.

CREATE TABLE IF NOT EXISTS stock_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL,
  received_on TEXT NOT NULL,
  reference TEXT,
  note TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0,
  bill_due_on TEXT,
  bill_paid_on TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at TEXT,
  voided_by INTEGER,
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_receipts_received
  ON stock_receipts (received_on, voided_at);

CREATE TABLE IF NOT EXISTS stock_receipt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  sku TEXT,
  item_name TEXT,
  qty INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  stock_before INTEGER,
  stock_after INTEGER,
  cost_before_cents INTEGER,
  cost_after_cents INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stock_receipt_lines_receipt
  ON stock_receipt_lines (receipt_id);

CREATE INDEX IF NOT EXISTS idx_stock_receipt_lines_item
  ON stock_receipt_lines (item_id, receipt_id);

ALTER TABLE inventory_items ADD COLUMN reorder_level INTEGER;
ALTER TABLE inventory_items ADD COLUMN reorder_qty INTEGER;
