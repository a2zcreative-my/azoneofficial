-- v1.4.101: staff lifecycle + claim payment + inventory pricing + payroll
-- payment tracking. No foreign keys by policy.
-- Staff lifecycle: resigned/terminated already pass the users CHECK (kept in
-- 0021); these dates drive payroll inclusion.
ALTER TABLE users ADD COLUMN left_on TEXT;       -- effective resignation/termination date
ALTER TABLE users ADD COLUMN rejoined_on TEXT;   -- re-join date (payroll resumes)
-- Claims: CEO marks an approved claim as PAID with the payment date.
ALTER TABLE claims ADD COLUMN paid_at TEXT;
-- Inventory: price per unit (sen).
ALTER TABLE inventory_items ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0;
-- Payroll payment tracking for the Expenses "Payments due" card.
CREATE TABLE IF NOT EXISTS payroll_payments (
  month TEXT PRIMARY KEY,                        -- YYYY-MM (the payroll month paid)
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_by INTEGER
);
