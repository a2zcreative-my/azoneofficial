-- 0172 - A follow-up names the document it is about and records what the
-- customer said, release 1.262.0 (claude/SALES-RECOVERY-AUDIT.md revision 2,
-- section 5 and section 8, Phase 1 - Sales discipline).
-- Additive only. No existing row is changed and every new column is nullable,
-- so a follow-up written before this release stays valid and reads as before.
-- doc_id names the quotation or invoice the follow-up is about. Before this a
-- follow-up named only the customer.
-- outcome is the code the owner chose when closing it - for a quotation one of
-- interested, negotiating, waiting, accepted, lost, no_response - for an
-- invoice one of promised, paid, disputed, no_response. Nothing sets it by
-- itself and it never changes the document.
-- obstacle is the reason or obstacle the owner wrote, required for lost.
-- One OPEN follow-up per document - the partial index lets a document hold
-- many closed ones and at most one that is still open.
ALTER TABLE customer_followups ADD COLUMN doc_id INTEGER;
ALTER TABLE customer_followups ADD COLUMN outcome TEXT;
ALTER TABLE customer_followups ADD COLUMN obstacle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_followups_open_doc ON customer_followups (doc_id)
  WHERE doc_id IS NOT NULL AND done_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_followups_doc ON customer_followups (doc_id);
