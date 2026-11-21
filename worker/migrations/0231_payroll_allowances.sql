-- 0231 - PAYROLL ALLOWANCES (the CEO 21-11-2026, As recommended on D1-D8 of
-- docs/PAYROLL-ALLOWANCES-STAGE-0-AUDIT.md, worker/src/payroll-allowances.ts).
--   payroll_allowance_types   - the named types the CEO sets up (parking, transport, ...). Never deleted
--                               (trigger): a type is retired with active = 0.
--   payroll_allowance_amounts - each persons fixed MONTHLY amount of a type. One row per (person, type).
--   payroll_allowance_events  - append-only history of every type and amount change (triggers).
--   payroll_entries.allowance_items - the breakdown frozen on a monthly row when it is SAVED, so a payslip
--                               itemises what was paid even after the setup changes. NULL on every existing row.
-- The net formula is unchanged: payroll_entries.allowance_cents stays the one allowance term in net.
-- ADDITIVE ONLY: three new tables, their triggers and one nullable column. No existing row is changed.
CREATE TABLE IF NOT EXISTS payroll_allowance_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en TEXT NOT NULL,
  name_ms TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_allowance_type_name ON payroll_allowance_types (lower(name_en));

CREATE TABLE IF NOT EXISTS payroll_allowance_amounts (
  user_id INTEGER NOT NULL REFERENCES users(id),
  type_id INTEGER NOT NULL REFERENCES payroll_allowance_types(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, type_id)
);

CREATE TABLE IF NOT EXISTS payroll_allowance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('type_create', 'type_update', 'type_retire', 'type_restore', 'amount_set')),
  type_id INTEGER NOT NULL,
  user_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  by_user INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_allowance_events_user ON payroll_allowance_events (user_id, at);

CREATE TRIGGER IF NOT EXISTS payroll_allowance_types_no_delete BEFORE DELETE ON payroll_allowance_types
BEGIN SELECT RAISE(ABORT, 'an allowance type is never deleted - retire it'); END;
CREATE TRIGGER IF NOT EXISTS payroll_allowance_events_no_update BEFORE UPDATE ON payroll_allowance_events
BEGIN SELECT RAISE(ABORT, 'allowance history is never changed'); END;
CREATE TRIGGER IF NOT EXISTS payroll_allowance_events_no_delete BEFORE DELETE ON payroll_allowance_events
BEGIN SELECT RAISE(ABORT, 'allowance history is never deleted'); END;

ALTER TABLE payroll_entries ADD COLUMN allowance_items TEXT;
