-- 0020: TikTok Shop authorization tokens (v1.4.44)
--
-- After a seller authorizes the app, TikTok returns an access token (and a
-- refresh token). Order webhooks carry only an order_id + status, so the
-- token is required to call Get Order Detail and learn which SKUs and
-- quantities to move in inventory.

CREATE TABLE IF NOT EXISTS integration_tokens (
  provider TEXT PRIMARY KEY,            -- 'tiktok'
  shop_id TEXT,
  shop_cipher TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw webhook receipts: proves what TikTok actually sent, and lets an
-- unrecognised signature scheme be inspected instead of silently dropped.
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_type TEXT,
  order_ref TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  headers TEXT,
  body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_created ON webhook_events (created_at);
