-- 0228 - QUOTATIONS AND DEALS (the CEO 21-11-2026, Sales Command Center Phase 4, his answer As recommended
-- on the seven Phase 4 decisions).
--   opportunity_quotations.origin - how a quotation came to be on its deal: manual (Link quotation, or a
--                                   confirmed suggestion) or created (the quotation was made for the deal
--                                   and linked by the server when it was saved).
-- ADDITIVE ONLY: one new column with a default. No row is changed and nothing is removed.

ALTER TABLE opportunity_quotations ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'suggestion', 'created'));
