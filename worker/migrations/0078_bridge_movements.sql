-- 0078 — v1.39.0: inbound movements from the ELFIA store, and the
-- append-only stock ledger they write into. Every statement IF NOT EXISTS —
-- fully replayable (audit B4 rule).
--
-- The store retries any movement the portal does not acknowledge — losing a
-- sale is worse than sending it twice — so UNIQUE(source, event_id) is the
-- whole safety mechanism. AUDIT B1: a row can legitimately sit at
-- outcome='pending' if the worker dies mid-apply; the handler treats a
-- pending conflict as a FIRST ATTEMPT (apply now), never as "ignored".

CREATE TABLE IF NOT EXISTS bridge_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL DEFAULT 'elfia',
  event_id     TEXT    NOT NULL,                  -- the store's UUID (idempotency key)
  sku          TEXT    NOT NULL,                  -- exactly as the store sent it
  sku_key      TEXT    NOT NULL,                  -- normalised match key
  delta        INTEGER NOT NULL,                  -- negative = sold, positive = cancelled back
  reason       TEXT,                              -- informational, free text (spec: delta carries the direction)
  reference    TEXT,                              -- the store's order number, may be NULL
  occurred_at  TEXT,                              -- UTC, as the store recorded it
  outcome      TEXT    NOT NULL,                  -- 'pending' | 'applied' | 'unknown_sku'
  item_id      INTEGER,
  received_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_events_id
  ON bridge_events (source, event_id);
CREATE INDEX IF NOT EXISTS idx_bridge_events_sku  ON bridge_events (sku_key);
CREATE INDEX IF NOT EXISTS idx_bridge_events_recv ON bridge_events (received_at);
-- reference is the join key for the Web Orders drawer's "what did this order
-- do to my count" panel (audit minor: was an unindexed full scan).
CREATE INDEX IF NOT EXISTS idx_bridge_events_ref  ON bridge_events (reference);

-- Append-only. Never UPDATEd, never DELETEd — corrections are compensating
-- rows. Track E routes the other six mutation sites through it and backfills.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL,
  sku           TEXT,
  delta         INTEGER NOT NULL,          -- the APPLIED delta after clamping
  balance_after INTEGER,
  source        TEXT    NOT NULL,          -- 'elfia' | 'manual' | 'invoice' | 'tiktok' | 'po' | 'return' | 'stocktake'
  ref_type      TEXT,
  ref_id        TEXT,
  reason        TEXT,
  created_by    INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_item ON stock_ledger (item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_src  ON stock_ledger (source, ref_id);
