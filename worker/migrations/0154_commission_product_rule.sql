-- 0154: Commission product rule per policy version
-- (v1.232.0, the Commission 2.1 brief from the owner and his answers,
-- 30-10-2026, claude/COMMISSION-2.1-AUDIT.md: "Services earn, products if
-- listed"). Additive only: one new column, no row changed by hand.
--
-- commission_policies.product_rule - what a line with no package rule earns.
-- listed_only: a service line earns the default rate, a product line (one
-- with an inventory SKU, or any line of a product document) earns only when
-- a package rule of the version lists it. The column default applies the
-- owner decision to every version, including one already approved, before
-- the commission start day of 2026-11-01 - no commission has been earned
-- under any version yet, so nothing earned changes.

ALTER TABLE commission_policies ADD COLUMN product_rule TEXT NOT NULL DEFAULT 'listed_only';
