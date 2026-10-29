-- 0150: Sales commission - versioned policy and the entitlement ledger
-- (v1.224.0, the Commission brief from the owner and his answers, 29-10-2026,
-- claude/COMMISSION-AUDIT.md). Additive only: three new tables and their
-- indexes. No existing row or table is changed.
--
-- commission_policies - one row per policy version, inserted and never
-- edited in its terms. A draft becomes active only when the CEO or super
-- admin approves it. The version in force for an invoice is the active one
-- with the latest effective_from on or before the day the money landed.
-- rate_bp is in basis points (1000 = 10.00 percent) so no floating point
-- reaches money.
--
-- commission_ledger - one row per commission event (earn or reverse). The
-- money columns are written once. source_key is unique, so a retried or
-- replayed event can only ever write one row. status moves held money along:
-- eligible, review, included (in a payroll month), paid (bank run done) or
-- void. payroll_month is set once, by a conditional write.
--
-- commission_settings_log - every switch of the payroll link, with who,
-- when and why (the switch itself lives in business_settings).

CREATE TABLE IF NOT EXISTS commission_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'rejected')),
  effective_from TEXT NOT NULL,
  rate_kind TEXT NOT NULL DEFAULT 'percent' CHECK (rate_kind IN ('percent', 'fixed')),
  rate_bp INTEGER,
  fixed_cents INTEGER,
  basis TEXT NOT NULL DEFAULT 'net_of_tax_delivery' CHECK (basis IN ('net_of_tax_delivery', 'invoice_total')),
  payment_rule TEXT NOT NULL DEFAULT 'paid_in_full_confirmed',
  renewal_rule TEXT NOT NULL DEFAULT 'every_paid',
  refund_rule TEXT NOT NULL DEFAULT 'review',
  cutoff_rule TEXT NOT NULL DEFAULT 'month_end_carry_forward',
  leaver_rule TEXT NOT NULL DEFAULT 'final_payroll_or_settle',
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by INTEGER,
  approved_at TEXT,
  rejected_by INTEGER,
  rejected_at TEXT,
  reject_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_policy_active_from
  ON commission_policies (effective_from) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS commission_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('earn', 'reverse')),
  invoice_id INTEGER NOT NULL,
  confirmation_id INTEGER,
  credit_note_id INTEGER,
  parent_id INTEGER,
  user_id INTEGER,
  policy_id INTEGER,
  basis_cents INTEGER NOT NULL DEFAULT 0,
  rate_bp INTEGER,
  fixed_cents INTEGER,
  amount_cents INTEGER NOT NULL,
  paid_day TEXT,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'review', 'included', 'paid', 'void')),
  eligible_at TEXT NOT NULL DEFAULT (datetime('now')),
  payroll_month TEXT,
  included_at TEXT,
  paid_out_at TEXT,
  note TEXT,
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comm_ledger_invoice ON commission_ledger (invoice_id);
CREATE INDEX IF NOT EXISTS idx_comm_ledger_user ON commission_ledger (user_id, status);
CREATE INDEX IF NOT EXISTS idx_comm_ledger_month ON commission_ledger (payroll_month, status);
CREATE INDEX IF NOT EXISTS idx_comm_ledger_conf ON commission_ledger (confirmation_id);

CREATE TABLE IF NOT EXISTS commission_settings_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
