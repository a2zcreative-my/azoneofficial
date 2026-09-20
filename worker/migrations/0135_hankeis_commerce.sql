-- 0135 - Hankeis Commerce (v1.163.0). Ordering and MANUAL payment
-- verification for the seaweed-snack brand. Additive only: nothing here
-- touches an existing table, and every default is safe on an empty install.
--
-- The rule the whole schema serves: a receipt is EVIDENCE, never proof. A
-- payment becomes verified only when an authorised human has opened the
-- receiving account in Maybank, found the transaction, and allocated it
-- here. hk_bank_allocations is that record, and its UNIQUE index is what
-- stops one bank transaction paying for two orders.

-- ---------- settings: one row per key, audited on change ----------
CREATE TABLE IF NOT EXISTS hk_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- catalogue ----------
-- inventory_item_id links a Hankei product to the portal stock master, so
-- stock stays in ONE place. NULL means the product is not stock-tracked.
CREATE TABLE IF NOT EXISTS hk_products (
  id                INTEGER PRIMARY KEY,
  sku               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  flavour           TEXT,
  description       TEXT,
  image_key         TEXT,
  unit_price_cents  INTEGER NOT NULL DEFAULT 0,
  inventory_item_id INTEGER REFERENCES inventory_items(id),
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort              INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A package is a priced bundle for a customer tier. eligibility is the
-- LOWEST category allowed to buy it - the server checks it, never the client.
CREATE TABLE IF NOT EXISTS hk_packages (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  eligibility  TEXT NOT NULL DEFAULT 'retail' CHECK (eligibility IN ('retail','agent','stockist')),
  min_qty      INTEGER NOT NULL DEFAULT 1,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hk_package_lines (
  id         INTEGER PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES hk_packages(id),
  product_id INTEGER NOT NULL REFERENCES hk_products(id),
  qty        INTEGER NOT NULL DEFAULT 1
);

-- ---------- customers ----------
-- Retail buyers, agents and stockists. Deliberately NOT the portal customers
-- table, which is the B2B client list behind sales_documents.
-- telegram_user_id is the NUMERIC Telegram id, never the mutable username.
CREATE TABLE IF NOT EXISTS hk_customers (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL,
  phone                TEXT,
  email                TEXT,
  category             TEXT NOT NULL DEFAULT 'retail' CHECK (category IN ('retail','agent','stockist')),
  telegram_user_id     INTEGER UNIQUE,
  notes                TEXT,
  created_by           INTEGER REFERENCES users(id),
  created_via          TEXT NOT NULL DEFAULT 'portal',
  category_changed_by  INTEGER REFERENCES users(id),
  category_changed_at  TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_customers_phone ON hk_customers (phone);

CREATE TABLE IF NOT EXISTS hk_addresses (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES hk_customers(id),
  label       TEXT,
  recipient   TEXT,
  phone       TEXT,
  line1       TEXT NOT NULL,
  line2       TEXT,
  postcode    TEXT,
  city        TEXT,
  state       TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- orders ----------
-- THREE independent states, on purpose. A shipped order is not proof of
-- payment and a verified payment is not proof of despatch.
--   order_state      quote_required open expired cancelled completed
--   payment_state    awaiting_payment awaiting_review clarification_required verified refunded
--   fulfilment_state not_ready ready_to_pack packing shipped delivered on_hold
-- pay_snapshot is the JSON copy of what the customer was shown when the
-- order was raised - recipient name, instructions, QR key - so a later
-- settings change can never rewrite history.
CREATE TABLE IF NOT EXISTS hk_orders (
  id               INTEGER PRIMARY KEY,
  order_no         TEXT NOT NULL UNIQUE,
  customer_id      INTEGER NOT NULL REFERENCES hk_customers(id),
  address_id       INTEGER REFERENCES hk_addresses(id),
  channel          TEXT NOT NULL DEFAULT 'portal',
  order_state      TEXT NOT NULL DEFAULT 'open',
  payment_state    TEXT NOT NULL DEFAULT 'awaiting_payment',
  fulfilment_state TEXT NOT NULL DEFAULT 'not_ready',
  subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  shipping_cents   INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  shipping_mode    TEXT NOT NULL DEFAULT 'flat',
  pay_snapshot     TEXT,
  reserved_until   TEXT,
  expires_at       TEXT,
  note             TEXT,
  created_by       INTEGER REFERENCES users(id),
  client_id        INTEGER REFERENCES hk_api_clients(id),
  cancelled_at     TEXT,
  cancel_reason    TEXT,
  completed_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_orders_state ON hk_orders (payment_state, order_state);
CREATE INDEX IF NOT EXISTS idx_hk_orders_customer ON hk_orders (customer_id, id);

-- Every line carries a PRICE SNAPSHOT. Re-pricing the catalogue later must
-- never change what a customer was asked to pay.
CREATE TABLE IF NOT EXISTS hk_order_lines (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES hk_orders(id),
  product_id        INTEGER REFERENCES hk_products(id),
  package_id        INTEGER REFERENCES hk_packages(id),
  name_snapshot     TEXT NOT NULL,
  sku_snapshot      TEXT,
  qty               INTEGER NOT NULL,
  unit_price_cents  INTEGER NOT NULL,
  line_total_cents  INTEGER NOT NULL,
  inventory_item_id INTEGER REFERENCES inventory_items(id)
);
CREATE INDEX IF NOT EXISTS idx_hk_order_lines_order ON hk_order_lines (order_id);

-- ---------- stock reservations ----------
-- inventory_items has no reservation column, so availability is
-- stock MINUS the live reservations here. One row per order line.
CREATE TABLE IF NOT EXISTS hk_reservations (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES hk_orders(id),
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty               INTEGER NOT NULL,
  expires_at        TEXT NOT NULL,
  released_at       TEXT,
  release_reason    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_res_item ON hk_reservations (inventory_item_id, released_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_hk_res_order ON hk_reservations (order_id);

-- ---------- receipts ----------
-- sha256 finds EXACT duplicate uploads. A resized or re-saved copy has a
-- different hash and will not match - it is an aid, not a fraud verdict.
-- The ocr_ columns exist so a future engine has somewhere to write. While
-- no engine is configured ocr_state stays unavailable and every field is
-- NULL - the portal must never display an extraction that was not made.
CREATE TABLE IF NOT EXISTS hk_receipts (
  id                     INTEGER PRIMARY KEY,
  order_id               INTEGER NOT NULL REFERENCES hk_orders(id),
  customer_id            INTEGER NOT NULL REFERENCES hk_customers(id),
  r2_key                 TEXT NOT NULL UNIQUE,
  content_type           TEXT NOT NULL,
  bytes                  INTEGER NOT NULL,
  sha256                 TEXT NOT NULL,
  uploaded_via           TEXT NOT NULL DEFAULT 'portal',
  uploaded_by            INTEGER REFERENCES users(id),
  client_id              INTEGER REFERENCES hk_api_clients(id),
  declared_amount_cents  INTEGER,
  declared_reference     TEXT,
  state                  TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted','accepted','rejected','superseded')),
  reject_reason          TEXT,
  reviewed_by            INTEGER REFERENCES users(id),
  reviewed_at            TEXT,
  ocr_state              TEXT NOT NULL DEFAULT 'unavailable' CHECK (ocr_state IN ('unavailable','pending','done','failed')),
  ocr_engine             TEXT,
  ocr_amount_cents       INTEGER,
  ocr_datetime           TEXT,
  ocr_recipient          TEXT,
  ocr_reference          TEXT,
  ocr_confidence         REAL,
  ocr_raw                TEXT,
  corrected_amount_cents INTEGER,
  corrected_reference    TEXT,
  corrected_by           INTEGER REFERENCES users(id),
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_receipts_order ON hk_receipts (order_id, id);
CREATE INDEX IF NOT EXISTS idx_hk_receipts_hash ON hk_receipts (sha256);

-- ---------- the manual bank check ----------
-- One row per bank transaction a reviewer has matched in Maybank. The UNIQUE
-- index is the guarantee: the same transaction cannot pay for two orders.
-- It is scoped to the receiving account because two different accounts may
-- legitimately use the same reference string.
-- attested_bank_checked records that the reviewer opened the bank record
-- itself, rather than only reading the customer receipt.
CREATE TABLE IF NOT EXISTS hk_bank_allocations (
  id                   INTEGER PRIMARY KEY,
  receiving_account    TEXT NOT NULL,
  bank_reference       TEXT NOT NULL,
  amount_cents         INTEGER NOT NULL,
  bank_time            TEXT NOT NULL,
  order_id             INTEGER NOT NULL REFERENCES hk_orders(id),
  receipt_id           INTEGER REFERENCES hk_receipts(id),
  attested_bank_checked INTEGER NOT NULL DEFAULT 0,
  note                 TEXT,
  verified_by          INTEGER NOT NULL REFERENCES users(id),
  verified_at          TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_at          TEXT,
  reversed_by          INTEGER REFERENCES users(id),
  reversal_reason      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hk_bank_alloc_unique ON hk_bank_allocations (receiving_account, bank_reference);
CREATE INDEX IF NOT EXISTS idx_hk_bank_alloc_order ON hk_bank_allocations (order_id);

-- ---------- review trail ----------
CREATE TABLE IF NOT EXISTS hk_payment_events (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES hk_orders(id),
  receipt_id  INTEGER REFERENCES hk_receipts(id),
  action      TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT,
  actor_id    INTEGER REFERENCES users(id),
  actor_kind  TEXT NOT NULL DEFAULT 'staff',
  reason      TEXT,
  meta        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_pay_events_order ON hk_payment_events (order_id, id);

-- ---------- exceptions and refunds ----------
CREATE TABLE IF NOT EXISTS hk_exceptions (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES hk_orders(id),
  kind         TEXT NOT NULL,
  detail       TEXT,
  amount_cents INTEGER,
  state        TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  opened_by    INTEGER REFERENCES users(id),
  opened_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by  INTEGER REFERENCES users(id),
  resolved_at  TEXT,
  resolution   TEXT
);
CREATE INDEX IF NOT EXISTS idx_hk_exceptions_open ON hk_exceptions (state, order_id);

-- A portal status is not money. confirmed_* records that a human moved the
-- funds outside this system and says so.
CREATE TABLE IF NOT EXISTS hk_refunds (
  id                 INTEGER PRIMARY KEY,
  order_id           INTEGER NOT NULL REFERENCES hk_orders(id),
  amount_cents       INTEGER NOT NULL,
  reason             TEXT,
  state              TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','confirmed','cancelled')),
  requested_by       INTEGER REFERENCES users(id),
  requested_at       TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_by       INTEGER REFERENCES users(id),
  confirmed_at       TEXT,
  external_reference TEXT
);

-- ---------- fulfilment ----------
CREATE TABLE IF NOT EXISTS hk_shipments (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES hk_orders(id),
  courier     TEXT,
  tracking_no TEXT,
  note        TEXT,
  shipped_by  INTEGER REFERENCES users(id),
  shipped_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_shipments_order ON hk_shipments (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hk_shipments_one_per_order ON hk_shipments (order_id);

-- ---------- integration ----------
-- token_hash is SHA-256 of the bearer token. The plaintext is shown once at
-- creation and never stored, so a database leak yields no usable credential.
CREATE TABLE IF NOT EXISTS hk_api_clients (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL DEFAULT '',
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  revoked_at   TEXT,
  revoked_by   INTEGER REFERENCES users(id)
);

-- Idempotency for server-to-server retries, scoped to the calling client so
-- one client can never replay or read the answer of another client.
CREATE TABLE IF NOT EXISTS hk_idempotency (
  id            INTEGER PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES hk_api_clients(id),
  idem_key      TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status        INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hk_idem_unique ON hk_idempotency (client_id, idem_key);

-- The notification outbox. Written in the SAME batch as the business change
-- it describes, so a verified payment and its event either both exist or
-- neither does. Delivery is at-least-once: a claim that is not acked before
-- claim_expires_at returns to the queue.
CREATE TABLE IF NOT EXISTS hk_outbox (
  id               INTEGER PRIMARY KEY,
  event_id         TEXT NOT NULL UNIQUE,
  event_type       TEXT NOT NULL,
  payload_version  INTEGER NOT NULL DEFAULT 1,
  order_id         INTEGER REFERENCES hk_orders(id),
  customer_id      INTEGER REFERENCES hk_customers(id),
  telegram_user_id INTEGER,
  payload          TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','delivered','dead')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  claimed_by       INTEGER REFERENCES hk_api_clients(id),
  claimed_at       TEXT,
  claim_expires_at TEXT,
  delivered_at     TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_outbox_queue ON hk_outbox (state, id);

-- Order numbering, one counter row per year prefix. Kept out of hk_settings
-- so a settings edit can never collide with a running sequence.
CREATE TABLE IF NOT EXISTS hk_counters (
  name    TEXT PRIMARY KEY,
  value   INTEGER NOT NULL DEFAULT 0
);
