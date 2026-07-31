-- 0007: Role modules (v1.4.4)
--
-- Adds the data behind the expanded role set:
--   hr_admin        — attendance verification, task reports, docs, leave admin, birthdays
--   sales_marketing — inventory, postage tracking, marketing materials
--   cco             — business development pipeline + strategy
--   coo (existing)  — daily operational/sales reports + strategy
--   ceo             — read-only overview of everything
--
-- Additive only: nothing existing is altered destructively.

-- Staff birthdays (HR maintains; dashboard surfaces upcoming ones)
ALTER TABLE users ADD COLUMN birthday TEXT; -- ISO date, year optional convention: YYYY-MM-DD

-- Inventory (sales & marketing keep stock truthful in real time)
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_stock', -- in_stock | low | out_of_stock | discontinued
  note TEXT,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Postage / shipment tracking records
CREATE TABLE IF NOT EXISTS postage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT NOT NULL,
  courier TEXT,
  tracking_no TEXT,
  status TEXT NOT NULL DEFAULT 'preparing', -- preparing | shipped | in_transit | delivered | returned
  note TEXT,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Marketing material requests / production status
CREATE TABLE IF NOT EXISTS material_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | in_progress | done | rejected
  requested_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Business development pipeline (CCO)
CREATE TABLE IF NOT EXISTS bd_pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | pending | kiv | closed_won | closed_lost
  value_note TEXT,          -- deal size / scope, free text
  strategy TEXT,            -- approach notes
  next_action TEXT,
  owner_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily operational + sales reports (COO)
CREATE TABLE IF NOT EXISTS ops_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,             -- YYYY-MM-DD
  operational_summary TEXT NOT NULL,
  sales_summary TEXT,
  strategy_note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (report_date, created_by)
);

-- Task reports (HR: daily / weekly / monthly)
CREATE TABLE IF NOT EXISTS task_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,                  -- daily | weekly | monthly
  report_date TEXT NOT NULL,             -- YYYY-MM-DD the report covers (start of period)
  content TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_postage_status ON postage_records (status);
CREATE INDEX IF NOT EXISTS idx_bd_status ON bd_pipeline (status);
CREATE INDEX IF NOT EXISTS idx_ops_date ON ops_reports (report_date);
CREATE INDEX IF NOT EXISTS idx_task_reports_date ON task_reports (report_date);
