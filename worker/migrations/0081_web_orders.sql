-- 0081 — v1.39.0: web orders pulled from the ELFIA store (bridge feed C).
-- Fully replayable — every statement IF NOT EXISTS (audit B4 rule).
--
-- The portal READS these; the store owns the order. Upsert key is
-- (store, order_number) — the same order reappears on every status change.
-- A cancelled order's pieces already came back through the movements feed:
-- nothing reading these tables may ever touch inventory_items.

CREATE TABLE IF NOT EXISTS web_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  store             TEXT    NOT NULL DEFAULT 'elfia',
  order_number      TEXT    NOT NULL,
  status            TEXT    NOT NULL,
  customer_name     TEXT,
  phone             TEXT,
  address           TEXT,
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  shipping_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  payment_method    TEXT,
  tracking_no       TEXT,
  tracking_courier  TEXT,
  placed_at         TEXT,
  store_updated_at  TEXT,
  paid_seen_at      TEXT,               -- when THIS portal first saw it paid — stamped ONLY after a successful cash booking (audit B2)
  booked_cents      INTEGER,            -- the amount actually booked to cashflow/GL at that moment; revenue reads this, so a later store-side amendment cannot make /revenue and cash disagree (audit M3)
  refund_flagged_at TEXT,               -- paid order later cancelled: flagged for a HUMAN money decision, never auto-reversed (OD-17b — matches the "paid invoices cannot be silently cancelled" rule)
  customer_id       INTEGER,
  first_seen_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  synced_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_orders_no
  ON web_orders (store, order_number);
CREATE INDEX IF NOT EXISTS idx_web_orders_status ON web_orders (status, store_updated_at);
CREATE INDEX IF NOT EXISTS idx_web_orders_placed ON web_orders (placed_at);
CREATE INDEX IF NOT EXISTS idx_web_orders_phone  ON web_orders (phone);

CREATE TABLE IF NOT EXISTS web_order_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL,
  store_product_id INTEGER,
  name             TEXT,
  sku              TEXT,
  sku_key          TEXT,
  qty              INTEGER NOT NULL DEFAULT 0,
  price_cents      INTEGER NOT NULL DEFAULT 0  -- FROZEN price actually charged at purchase
);
CREATE INDEX IF NOT EXISTS idx_web_order_lines_order ON web_order_lines (order_id);
