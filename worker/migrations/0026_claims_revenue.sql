-- v1.4.75: (1) staff expense claims — submitted by management roles, every
-- decision made by the CEO; (2) TikTok order amounts so the dashboard can
-- show real sales revenue. No foreign keys by policy since v1.4.69.
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  claim_date TEXT NOT NULL,          -- ISO YYYY-MM-DD (expense date)
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('travel','meal','accommodation','equipment','medical','other')),
  amount_cents INTEGER NOT NULL,
  description TEXT,
  receipt_key TEXT,                  -- R2 object (optional receipt photo)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

ALTER TABLE postage_records ADD COLUMN order_amount_cents INTEGER;
