-- 0078 — v1.38.0: data correction (IMPLEMENTATION-PLAN.md item S-3).
--
-- erp.ts goods receipt wrote its manual_stockouts trail row WITHOUT the
-- direction column, so every PO ever received was recorded as direction
-- 'out' (the 0064 default) while the stock actually went IN. The code now
-- writes direction = 'in'; this fixes the historical rows. Scoped by the
-- exact remark erp.ts writes ("Goods receipt PO-…") so no genuine stock-out
-- can be touched.

UPDATE manual_stockouts
   SET direction = 'in'
 WHERE direction = 'out'
   AND remark LIKE 'Goods receipt PO-%';
