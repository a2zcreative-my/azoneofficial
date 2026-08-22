-- 0077 — v1.37.0: web orders pulled from the ELFIA store (bridge feed C).
--
-- The portal READS these; it never creates or edits one — the store owns the
-- order. The same order reappears on every status change (paid → shipped →
-- completed), so the upsert key is (store, order_number). A cancelled order's
-- pieces have ALREADY come back through the movements feed — nothing reading
-- these tables may ever touch inventory_items.
--
-- No foreign keys (house rule since v1.4.69).

CREATE TABLE IF NOT EXISTS web_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  store             TEXT    NOT NULL DEFAULT 'elfia',
  order_number      TEXT    NOT NULL,
  status            TEXT    NOT NULL,   -- pending_payment|payment_review|paid|shipped|completed|cancelled
  customer_name     TEXT,
  phone             TEXT,
  address           TEXT,
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  shipping_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  payment_method    TEXT,
  tracking_no       TEXT,
  tracking_courier  TEXT,
  placed_at         TEXT,               -- the store's created_at
  store_updated_at  TEXT,               -- the store's updated_at (drives the cursor)
  paid_seen_at      TEXT,               -- when THIS portal first saw it paid — revenue month
  customer_id       INTEGER,            -- CRM link (Track C matching); NULL until then
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
  order_id         INTEGER NOT NULL,     -- web_orders.id
  store_product_id INTEGER,              -- the store's product id, informational
  name             TEXT,
  sku              TEXT,
  sku_key          TEXT,
  qty              INTEGER NOT NULL DEFAULT 0,
  price_cents      INTEGER NOT NULL DEFAULT 0  -- FROZEN price actually charged at purchase
);
CREATE INDEX IF NOT EXISTS idx_web_order_lines_order ON web_order_lines (order_id);
