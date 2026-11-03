-- 0168 - Agent partnership commission, release 1.255.0.
-- The owner approved claude/AGENT-COMMISSION-AUDIT.md revision 3 on 03-11-2026.
-- A direct sale pays the verified closer 10 percent. A qualified agent sale pays
-- the agent 7 percent and the verified closer 3 percent of the eligible net
-- sales value. Uncertain attribution is held for review, never paid as direct.
-- Additive only. No existing row is changed. Policy v1 keeps NULL agent rates,
-- so nothing about agents applies until the CEO approves a version with them.
-- Every existing ledger row reads recipient_role closer, which is what it is.
-- commission_attributions holds one row per paid confirmation - the
-- classification, its reason codes and the evidence snapshot. The evidence is
-- never rewritten and a decision is recorded once.
-- agent_assignments is the standing agent to salesperson history, append-only.
-- agent_payouts is the agent payout batch - authorised, then settled with the
-- bank reference, or cancelled before settlement. A settled or cancelled batch
-- is final.
-- commission_disputes is the management flag that an agent attribution on an
-- invoice or a customer is disputed. It is cleared once, with a reason.
ALTER TABLE commission_policies ADD COLUMN agent_rate_bp INTEGER;
ALTER TABLE commission_policies ADD COLUMN agent_closer_rate_bp INTEGER;
ALTER TABLE commission_policies ADD COLUMN agent_renewal_rule TEXT;
ALTER TABLE commission_policies ADD COLUMN agent_mismatch_reason TEXT;
ALTER TABLE commission_ledger ADD COLUMN recipient_role TEXT NOT NULL DEFAULT 'closer' CHECK (recipient_role IN ('closer', 'agent'));
ALTER TABLE commission_ledger ADD COLUMN attribution_id INTEGER;
ALTER TABLE commission_ledger ADD COLUMN agent_request_id INTEGER;
ALTER TABLE commission_ledger ADD COLUMN payout_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_ledger_live_role
  ON commission_ledger (confirmation_id, recipient_role) WHERE kind = 'earn' AND status != 'void';
CREATE INDEX IF NOT EXISTS idx_comm_ledger_payout ON commission_ledger (payout_id);
CREATE INDEX IF NOT EXISTS idx_comm_ledger_role ON commission_ledger (recipient_role, user_id, status);
CREATE TABLE IF NOT EXISTS commission_attributions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_id    INTEGER NOT NULL UNIQUE,
  invoice_id         INTEGER NOT NULL,
  customer_id        INTEGER,
  classification     TEXT    NOT NULL CHECK (classification IN ('direct', 'partnership', 'review')),
  reasons            TEXT,
  agent_id           INTEGER,
  agent_request_id   INTEGER,
  quotation_id       INTEGER,
  published_revision INTEGER,
  invoiced_revision  INTEGER,
  accepted_name      TEXT,
  accepted_at        TEXT,
  assigned_to        INTEGER,
  closer_id          INTEGER,
  policy_id          INTEGER,
  paid_day           TEXT,
  eligible_cents     INTEGER,
  agent_cents        INTEGER,
  closer_cents       INTEGER,
  evidence           TEXT,
  write_key          TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  decision           TEXT    CHECK (decision IN ('partnership', 'direct', 'none')),
  decision_key       TEXT,
  decision_policy_id INTEGER,
  decided_by         INTEGER,
  decided_at         TEXT,
  decision_note      TEXT,
  closed_at          TEXT,
  closed_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_comm_attr_invoice ON commission_attributions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_comm_attr_customer ON commission_attributions (customer_id, classification);
CREATE INDEX IF NOT EXISTS idx_comm_attr_agent ON commission_attributions (agent_id);
CREATE TRIGGER IF NOT EXISTS commission_attributions_evidence_kept BEFORE UPDATE ON commission_attributions WHEN NEW.classification IS NOT OLD.classification OR NEW.evidence IS NOT OLD.evidence OR NEW.reasons IS NOT OLD.reasons OR NEW.agent_id IS NOT OLD.agent_id OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.eligible_cents IS NOT OLD.eligible_cents OR NEW.agent_cents IS NOT OLD.agent_cents OR NEW.closer_cents IS NOT OLD.closer_cents BEGIN SELECT RAISE(ABORT, 'the attribution evidence is kept as it was'); END;
CREATE TRIGGER IF NOT EXISTS commission_attributions_decided_once BEFORE UPDATE ON commission_attributions WHEN OLD.decision IS NOT NULL OR OLD.closed_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'an attribution is decided once'); END;
CREATE TRIGGER IF NOT EXISTS commission_attributions_no_delete BEFORE DELETE ON commission_attributions BEGIN SELECT RAISE(ABORT, 'attribution history is kept'); END;
CREATE TABLE IF NOT EXISTS agent_assignments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id       INTEGER NOT NULL,
  salesperson_id INTEGER NOT NULL,
  effective_from TEXT    NOT NULL,
  set_by         INTEGER NOT NULL,
  reason         TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_agent ON agent_assignments (agent_id, effective_from, id);
CREATE TRIGGER IF NOT EXISTS agent_assignments_no_update BEFORE UPDATE ON agent_assignments BEGIN SELECT RAISE(ABORT, 'assignment history is kept as it was'); END;
CREATE TRIGGER IF NOT EXISTS agent_assignments_no_delete BEFORE DELETE ON agent_assignments BEGIN SELECT RAISE(ABORT, 'assignment history is kept as it was'); END;
CREATE TABLE IF NOT EXISTS agent_payouts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_key       TEXT    NOT NULL UNIQUE,
  agent_id       INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized', 'settled', 'cancelled')),
  amount_cents   INTEGER,
  row_count      INTEGER,
  note           TEXT,
  authorized_by  INTEGER NOT NULL,
  authorized_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  settled_by     INTEGER,
  settled_at     TEXT,
  settled_on     TEXT,
  bank_ref       TEXT,
  proof_note     TEXT,
  cancelled_by   INTEGER,
  cancelled_at   TEXT,
  cancel_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_payouts_agent ON agent_payouts (agent_id, status);
CREATE TRIGGER IF NOT EXISTS agent_payouts_final BEFORE UPDATE ON agent_payouts WHEN OLD.status != 'authorized' BEGIN SELECT RAISE(ABORT, 'a settled or cancelled payout is final'); END;
CREATE TRIGGER IF NOT EXISTS agent_payouts_amount_once BEFORE UPDATE ON agent_payouts WHEN OLD.amount_cents IS NOT NULL AND (NEW.amount_cents IS NOT OLD.amount_cents OR NEW.row_count IS NOT OLD.row_count OR NEW.agent_id IS NOT OLD.agent_id) BEGIN SELECT RAISE(ABORT, 'a payout amount is fixed when it is authorised'); END;
CREATE TRIGGER IF NOT EXISTS agent_payouts_no_delete BEFORE DELETE ON agent_payouts BEGIN SELECT RAISE(ABORT, 'payout history is kept'); END;
CREATE TABLE IF NOT EXISTS commission_disputes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT    NOT NULL CHECK (scope IN ('invoice', 'customer')),
  ref_id       INTEGER NOT NULL,
  reason       TEXT    NOT NULL,
  created_by   INTEGER NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  cleared_by   INTEGER,
  cleared_at   TEXT,
  clear_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_comm_disputes_ref ON commission_disputes (scope, ref_id);
CREATE TRIGGER IF NOT EXISTS commission_disputes_kept BEFORE UPDATE ON commission_disputes WHEN OLD.cleared_at IS NOT NULL OR NEW.reason IS NOT OLD.reason OR NEW.scope IS NOT OLD.scope OR NEW.ref_id IS NOT OLD.ref_id BEGIN SELECT RAISE(ABORT, 'a dispute is cleared once and never rewritten'); END;
CREATE TRIGGER IF NOT EXISTS commission_disputes_no_delete BEFORE DELETE ON commission_disputes BEGIN SELECT RAISE(ABORT, 'dispute history is kept'); END;
