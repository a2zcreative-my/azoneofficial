-- 0073 (v1.28.0): per-document legal issuer.
--
-- A2Z CREATIVE MARKETING (SSM 202603003468 / CA0414729-A) and AZ ONE
-- OFFICIAL (SSM 202603168673 / JM1046169-H) are SEPARATE legal entities.
-- From v1.28.0 the operating issuer is A2Z, but a document must forever
-- show the entity that issued it — an invoice issued by AZ ONE may not be
-- re-rendered under A2Z's name and bank account later, and vice versa.
--
-- issuer_code semantics:
--   NULL   = legacy row, issued before the switch  -> AZ ONE OFFICIAL
--   'a2z'  = issued by A2Z CREATIVE MARKETING
--   'azoo' = explicitly AZ ONE (reserved for future consultancy-issued docs)
--
-- The worker stamps 'a2z' at creation/release time. Deliberately NO DEFAULT:
-- SQLite backfills a constant DEFAULT onto existing rows, which would
-- silently rebrand every historical document — exactly what must not happen.
-- No CHECK (house rule since 0044: changing a CHECK means rebuilding the
-- table) and no FK (house rule since v1.4.69).

ALTER TABLE sales_documents  ADD COLUMN issuer_code TEXT;
ALTER TABLE receipts         ADD COLUMN issuer_code TEXT;
ALTER TABLE credit_notes     ADD COLUMN issuer_code TEXT;
ALTER TABLE claims           ADD COLUMN issuer_code TEXT;
ALTER TABLE leave_requests   ADD COLUMN issuer_code TEXT;
ALTER TABLE payslip_releases ADD COLUMN issuer_code TEXT;
