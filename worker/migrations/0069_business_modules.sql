-- 0069 (v1.7.0): Stokis network, Content management, Receipts & Credit Notes.
-- No foreign keys (house rule since the v1.4.69 incident). Every table is
-- IF NOT EXISTS so a re-run is safe. The Sales Pipeline reuses the existing
-- prospects table (0066/0067) — the new "negotiation" stage is just a value.

/* ===== Stokis (reseller network) ===== */
CREATE TABLE IF NOT EXISTS stokis (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  company        TEXT,
  phone          TEXT,
  email          TEXT,
  location       TEXT,
  status         TEXT NOT NULL DEFAULT 'active',   -- active | inactive
  commission_pct REAL NOT NULL DEFAULT 0,          -- % on their purchases
  notes          TEXT,
  joined_at      TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stokis_status ON stokis(status);

-- Each purchase/order a stokis makes from AZ ONE (drives balance + monthly sales).
CREATE TABLE IF NOT EXISTS stokis_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  stokis_id      INTEGER NOT NULL,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  qty            INTEGER,
  note           TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',   -- paid | unpaid
  ordered_at     TEXT NOT NULL DEFAULT (date('now', '+8 hours')),
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stokis_orders_sid ON stokis_orders(stokis_id);

CREATE TABLE IF NOT EXISTS stokis_targets (
  stokis_id    INTEGER NOT NULL,
  month        TEXT NOT NULL,                       -- YYYY-MM
  target_cents INTEGER NOT NULL,
  set_by       INTEGER,
  PRIMARY KEY (stokis_id, month)
);

/* ===== Content management (live-commerce production pipeline) ===== */
CREATE TABLE IF NOT EXISTS content_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'video',     -- video | reel | live | campaign | other
  platform       TEXT NOT NULL DEFAULT 'tiktok',    -- tiktok | shopee | instagram | facebook | other
  stage          TEXT NOT NULL DEFAULT 'idea',      -- idea | script | shoot | edit | approval | posted
  scheduled_date TEXT,                              -- YYYY-MM-DD (MYT)
  script         TEXT,
  caption        TEXT,
  campaign       TEXT,
  assigned_to    INTEGER,
  performance    TEXT,                              -- metrics / notes after posting
  posted_at      TEXT,
  notes          TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_content_stage ON content_items(stage);
CREATE INDEX IF NOT EXISTS idx_content_sched ON content_items(scheduled_date);

/* ===== Receipts & Credit Notes (extend QT -> INV -> Payment) ===== */
CREATE TABLE IF NOT EXISTS receipts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number TEXT UNIQUE NOT NULL,
  invoice_id     INTEGER NOT NULL,
  invoice_number TEXT,
  customer_id    INTEGER,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_ref    TEXT,
  paid_at        TEXT,
  share_token    TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_inv ON receipts(invoice_id);

CREATE TABLE IF NOT EXISTS credit_notes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cn_number      TEXT UNIQUE NOT NULL,
  invoice_id     INTEGER NOT NULL,
  invoice_number TEXT,
  customer_id    INTEGER,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  reason         TEXT,
  share_token    TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cn_inv ON credit_notes(invoice_id);
