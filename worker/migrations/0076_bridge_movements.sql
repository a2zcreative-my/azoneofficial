-- 0076 — v1.36.0: inbound movements from the ELFIA store, and the append-only
-- stock ledger they write into.
--
-- The store pushes every web sale as a movement (delta −2 = sold two pieces,
-- +2 = an unpaid order cancelled and the pieces came back) and RETRIES any
-- movement the portal does not acknowledge — losing a sale is worse than
-- sending it twice. So the portal's side of the contract is dedupe:
-- UNIQUE(source, event_id) + INSERT … ON CONFLICT DO NOTHING is the whole
-- safety mechanism. A repeated event_id is answered "ignored" and applied
-- ZERO times. Get this wrong and the same two scarves are deducted twice.
--
-- No foreign keys (house rule since v1.4.69).

CREATE TABLE IF NOT EXISTS bridge_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL DEFAULT 'elfia',  -- room for a second store later
  event_id     TEXT    NOT NULL,                  -- the store's UUID (idempotency key)
  sku          TEXT    NOT NULL,                  -- exactly as the store sent it
  sku_key      TEXT    NOT NULL,                  -- UPPER(REPLACE(sku,' ','')) — the match key
  delta        INTEGER NOT NULL,                  -- negative = sold, positive = cancelled back
  reason       TEXT,                              -- 'order' | 'cancel' (informational)
  reference    TEXT,                              -- the store's order number, may be NULL
  occurred_at  TEXT,                              -- UTC, as the store recorded it
  outcome      TEXT    NOT NULL,                  -- 'applied' | 'unknown_sku'
  item_id      INTEGER,                           -- inventory_items.id when matched
  received_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_events_id
  ON bridge_events (source, event_id);
CREATE INDEX IF NOT EXISTS idx_bridge_events_sku  ON bridge_events (sku_key);
CREATE INDEX IF NOT EXISTS idx_bridge_events_recv ON bridge_events (received_at);

-- The append-only stock ledger (IMPLEMENTATION-PLAN.md Track E's foundation,
-- built here because the bridge needs it first). Every bridge movement writes
-- one row; Track E routes the other six mutation sites through it and
-- backfills history. Never UPDATEd, never DELETEd — a mistake is corrected
-- by a compensating row, which is what keeps the trail believable.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL,
  sku           TEXT,
  delta         INTEGER NOT NULL,          -- signed; + in, − out (the APPLIED delta after clamping)
  balance_after INTEGER,                   -- the count immediately after this row
  source        TEXT    NOT NULL,          -- 'elfia' | 'manual' | 'invoice' | 'tiktok' | 'po' | 'return' | 'stocktake'
  ref_type      TEXT,                      -- 'bridge_event' | 'doc' | 'po' | 'stockout' | …
  ref_id        TEXT,                      -- the id in that system
  reason        TEXT,
  created_by    INTEGER,                   -- users.id; NULL for machine movements
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_item ON stock_ledger (item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_src  ON stock_ledger (source, ref_id);

-- Normalised match key so the store's 'LUMI001' finds the portal's 'LUMI 001'
-- without a per-movement table scan. Maintained by every code path that
-- writes inventory_items.sku (create + edit; PATCH never touches sku).
ALTER TABLE inventory_items ADD COLUMN sku_key TEXT;
UPDATE inventory_items SET sku_key = UPPER(REPLACE(sku, ' ', ''));
CREATE INDEX IF NOT EXISTS idx_inventory_sku_key ON inventory_items (sku_key);
