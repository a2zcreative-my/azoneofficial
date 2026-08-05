-- v1.4.213: company asset / equipment register (team feedback via CEO).
-- Assets are never DELETEd — status moves to disposed/lost so history and
-- audit stay intact.
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag TEXT NOT NULL UNIQUE,          -- AZOA-001 style; auto-assigned when left blank
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',  -- electronics | furniture | vehicle | studio | other
  brand_model TEXT,
  serial_no TEXT,
  purchase_date TEXT,
  purchase_price_cents INTEGER,
  vendor TEXT,
  warranty_until TEXT,
  location TEXT,
  assigned_to INTEGER,                     -- users.id or NULL (unassigned/spare)
  status TEXT NOT NULL DEFAULT 'in_use',   -- in_use | spare | repair | lost | disposed
  condition_note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_assigned ON assets(assigned_to);
