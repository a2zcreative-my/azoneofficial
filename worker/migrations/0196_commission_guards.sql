-- v1.311.0 - COMMISSION WORKSPACE 5.0, P3 (the CEO, 15-11-2026: approve as
-- per recommend, K-2 in claude/COMMISSION-WORKSPACE-5.0-BLUEPRINT.md).
--
-- THE DATABASE KEEPS WHAT THE CODE ALREADY PROMISED. Until now only the
-- worker kept an approved policy version and a written entitlement unchanged,
-- so a future bug or a hand-typed SQL could have rewritten a rate or an
-- amount. These triggers refuse it at the source. ADDITIVE: no table, column
-- or row is changed, and every route of the engine already writes within
-- these rules (a draft is approved or rejected once, a row moves its status
-- and grows its note but never its amount, a correction is a new reversal).
--
-- Policy versions
--   * an active or rejected version is never updated
--   * the terms of a draft never change (only its approval or rejection is
--     written, once)
--   * no version and no package rule is ever deleted, and a package rule is
--     never edited
-- Entitlements (commission_ledger)
--   * the money and its key never change: source key, kind, invoice,
--     confirmation, parent, credit note, policy, basis, rate, fixed amount,
--     amount, recipient role
--   * a paid or void row is final
--   * no row is ever deleted

CREATE TRIGGER IF NOT EXISTS commission_policy_final
BEFORE UPDATE ON commission_policies
WHEN OLD.status != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'an approved or rejected commission policy version is never changed - draft a new version');
END;

CREATE TRIGGER IF NOT EXISTS commission_policy_terms_kept
BEFORE UPDATE ON commission_policies
WHEN NEW.version IS NOT OLD.version OR NEW.name IS NOT OLD.name OR NEW.effective_from IS NOT OLD.effective_from
  OR NEW.rate_kind IS NOT OLD.rate_kind OR NEW.rate_bp IS NOT OLD.rate_bp OR NEW.fixed_cents IS NOT OLD.fixed_cents
  OR NEW.basis IS NOT OLD.basis OR NEW.payment_rule IS NOT OLD.payment_rule OR NEW.renewal_rule IS NOT OLD.renewal_rule
  OR NEW.refund_rule IS NOT OLD.refund_rule OR NEW.cutoff_rule IS NOT OLD.cutoff_rule OR NEW.leaver_rule IS NOT OLD.leaver_rule
  OR NEW.product_rule IS NOT OLD.product_rule OR NEW.agent_rate_bp IS NOT OLD.agent_rate_bp
  OR NEW.agent_closer_rate_bp IS NOT OLD.agent_closer_rate_bp OR NEW.agent_renewal_rule IS NOT OLD.agent_renewal_rule
  OR NEW.reason IS NOT OLD.reason OR NEW.created_by IS NOT OLD.created_by
BEGIN
  SELECT RAISE(ABORT, 'a commission policy version keeps the terms it was drafted with');
END;

CREATE TRIGGER IF NOT EXISTS commission_policy_no_delete
BEFORE DELETE ON commission_policies
BEGIN
  SELECT RAISE(ABORT, 'commission policy history is kept');
END;

CREATE TRIGGER IF NOT EXISTS commission_policy_packages_no_update
BEFORE UPDATE ON commission_policy_packages
BEGIN
  SELECT RAISE(ABORT, 'a package rule keeps the terms of its version');
END;

CREATE TRIGGER IF NOT EXISTS commission_policy_packages_no_delete
BEFORE DELETE ON commission_policy_packages
BEGIN
  SELECT RAISE(ABORT, 'a package rule keeps the terms of its version');
END;

CREATE TRIGGER IF NOT EXISTS commission_ledger_money_kept
BEFORE UPDATE ON commission_ledger
WHEN NEW.source_key IS NOT OLD.source_key OR NEW.kind IS NOT OLD.kind OR NEW.invoice_id IS NOT OLD.invoice_id
  OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.parent_id IS NOT OLD.parent_id OR NEW.credit_note_id IS NOT OLD.credit_note_id
  OR NEW.policy_id IS NOT OLD.policy_id OR NEW.basis_cents IS NOT OLD.basis_cents OR NEW.rate_bp IS NOT OLD.rate_bp
  OR NEW.fixed_cents IS NOT OLD.fixed_cents OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.recipient_role IS NOT OLD.recipient_role
BEGIN
  SELECT RAISE(ABORT, 'a commission entitlement keeps its amount - a correction is a reversal row');
END;

CREATE TRIGGER IF NOT EXISTS commission_ledger_final
BEFORE UPDATE ON commission_ledger
WHEN OLD.status IN ('paid', 'void') AND NEW.status IS NOT OLD.status
BEGIN
  SELECT RAISE(ABORT, 'a paid or void commission entitlement is final');
END;

CREATE TRIGGER IF NOT EXISTS commission_ledger_no_delete
BEFORE DELETE ON commission_ledger
BEGIN
  SELECT RAISE(ABORT, 'commission history is kept');
END;
