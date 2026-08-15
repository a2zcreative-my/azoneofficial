-- 0071 — ERP core (v1.18.0, programme phases 4–7)
-- One migration, five module groups. Everything is additive: no existing
-- table is touched, so rolling this forward on production cannot disturb
-- current behaviour. Money is INTEGER CENTS throughout (the sales_documents
-- convention); dates are TEXT ISO; booleans are 0/1.

-- ============ Phase 4 — the unified order model ============
-- One header + typed lines. `kind` on the LINE is what unifies Product and
-- Services: a product line carries sku/qty/unit price/cost, a service line
-- carries host/hours/rate. One pipeline, one revenue basis, one commission
-- basis — Reconciliation and Commission both hang off this.
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no      TEXT NOT NULL UNIQUE,
  customer    TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product','service','mixed')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','fulfilled','cancelled')),
  source      TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('tiktok','shopee','lazada','direct','stokis')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  notes       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders (source, created_at);

CREATE TABLE IF NOT EXISTS order_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('product','service')),
  title       TEXT NOT NULL,
  -- product fields
  sku         TEXT,
  qty         REAL,
  unit_price_cents INTEGER,
  cost_cents  INTEGER,
  -- service fields
  host_id     INTEGER,
  starts_at   TEXT,
  ends_at     TEXT,
  hours       REAL,
  rate_cents  INTEGER,
  line_total_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines (order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_host ON order_lines (host_id);

-- ============ Phase 5 — Cash Flow + Reconciliation ============
CREATE TABLE IF NOT EXISTS bank_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  bank        TEXT NOT NULL DEFAULT '',
  number_masked TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cashflow_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date  TEXT NOT NULL,                 -- YYYY-MM-DD (MYT business date)
  type        TEXT NOT NULL CHECK (type IN ('in','out')),
  category    TEXT NOT NULL DEFAULT '',
  bank_id     INTEGER REFERENCES bank_accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  description TEXT NOT NULL DEFAULT '',
  ref         TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cashflow_date ON cashflow_entries (entry_date);

-- Estimated vs actual per order/channel — the DZI reference's screen.
CREATE TABLE IF NOT EXISTS reconciliations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL,                 -- YYYY-MM
  channel     TEXT NOT NULL DEFAULT 'tiktok' CHECK (channel IN ('tiktok','shopee','lazada','direct','stokis')),
  order_id    INTEGER REFERENCES orders(id), -- optional link to the unified order
  order_no    TEXT NOT NULL DEFAULT '',
  customer    TEXT NOT NULL DEFAULT '',
  est_sales_cents    INTEGER NOT NULL DEFAULT 0,
  actual_sales_cents INTEGER NOT NULL DEFAULT 0,
  actual_cost_cents  INTEGER NOT NULL DEFAULT 0,
  fees_cents         INTEGER NOT NULL DEFAULT 0,
  shipping_cents     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled','disputed')),
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recon_period ON reconciliations (period, channel);

-- ============ Phase 6 — Commission + Ads Fund ============
CREATE TABLE IF NOT EXISTS commission_rates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id     INTEGER NOT NULL,
  percent     REAL NOT NULL DEFAULT 0,       -- % of the service line total
  per_hour_cents INTEGER NOT NULL DEFAULT 0, -- flat add per live hour
  effective_from TEXT NOT NULL,              -- YYYY-MM-DD
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comm_rates_host ON commission_rates (host_id, effective_from);

CREATE TABLE IF NOT EXISTS commission_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id     INTEGER NOT NULL,
  order_id    INTEGER REFERENCES orders(id),
  period      TEXT NOT NULL,                 -- YYYY-MM
  basis_cents INTEGER NOT NULL DEFAULT 0,    -- what the % applied to
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid')),
  note        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comm_entries ON commission_entries (period, host_id);

CREATE TABLE IF NOT EXISTS ads_fund_allocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL,                 -- YYYY-MM
  channel     TEXT NOT NULL DEFAULT 'tiktok',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  notes       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ads_fund_claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  allocation_id INTEGER NOT NULL REFERENCES ads_fund_allocations(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by  INTEGER,
  decided_at  TEXT,
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ads_claims ON ads_fund_claims (allocation_id, status);

-- ============ Phase 7 — Purchasing + Accounting ============
CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  po_no       TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
  items       TEXT NOT NULL DEFAULT '[]',    -- JSON [{title, qty, unit_cents}] — same pattern as sales_documents.items
  total_cents INTEGER NOT NULL DEFAULT 0,
  expected_date TEXT,
  notes       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders (supplier_id, status);

CREATE TABLE IF NOT EXISTS gl_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date  TEXT NOT NULL,                 -- YYYY-MM-DD
  memo        TEXT NOT NULL DEFAULT '',
  ref         TEXT NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES gl_accounts(id),
  debit_cents  INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_acct ON journal_lines (account_id);

-- Starter chart of accounts — Malaysian SME shape. INSERT OR IGNORE so a
-- re-run (or an existing code) never errors.
INSERT OR IGNORE INTO gl_accounts (code, name, type) VALUES
  ('1000', 'Cash on hand',            'asset'),
  ('1100', 'Bank — operating',        'asset'),
  ('1200', 'Accounts receivable',     'asset'),
  ('1300', 'Inventory',               'asset'),
  ('2000', 'Accounts payable',        'liability'),
  ('2100', 'SST payable',             'liability'),
  ('3000', 'Owner equity',            'equity'),
  ('4000', 'Sales — products',        'income'),
  ('4100', 'Sales — live services',   'income'),
  ('5000', 'Cost of goods sold',      'expense'),
  ('6000', 'Marketing & ads',         'expense'),
  ('6100', 'Salaries & commission',   'expense'),
  ('6200', 'Rent & utilities',        'expense'),
  ('6300', 'Platform fees',           'expense'),
  ('6900', 'Other expenses',          'expense');
