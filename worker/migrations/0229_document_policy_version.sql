-- 0229 - QUOTATION AND INVOICE POLICIES SEPARATED (the CEO 21-11-2026, v1.402.0).
--   sales_documents.policy_version - which policy wording the document was issued with.
--     NULL = issued before v1.402.0 - it keeps the Payment and No Refund Policy on its paper,
--            its PDF and its acceptance page, as it was sent and accepted.
--     2    = issued from v1.402.0 - a quotation carries the Quotation Validity Policy, an
--            invoice the Payment and Refund Policy.
-- ADDITIVE ONLY: one new nullable column. No row is changed, nothing is removed, and no
-- quotation gets a validity date it did not already have.

ALTER TABLE sales_documents ADD COLUMN policy_version INTEGER;
