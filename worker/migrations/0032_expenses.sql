-- v1.4.87: company expenses — operating costs (rent, software, ads,
-- logistics …) recorded by the CEO/COO, separate from staff CLAIMS
-- (reimbursements, which route to the CEO for approval). No foreign keys
-- by policy.
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date TEXT NOT NULL,        -- ISO YYYY-MM-DD
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('rent','utilities','software','marketing','equipment','logistics','supplies','other')),
  amount_cents INTEGER NOT NULL,
  vendor TEXT,
  description TEXT,
  receipt_key TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
