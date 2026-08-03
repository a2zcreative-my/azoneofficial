-- v1.4.149: a supplier can resolve a return by REPLACEMENT (goods back)
-- instead of a credit (money back). replaced_qty accumulates partial
-- deliveries; when it reaches the full qty the row's status becomes
-- 'replaced'. Replacement value (replaced_qty × unit cost) reduces the
-- outstanding claim the same way a credit does.
ALTER TABLE supplier_returns ADD COLUMN replaced_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_returns ADD COLUMN replaced_at TEXT;
