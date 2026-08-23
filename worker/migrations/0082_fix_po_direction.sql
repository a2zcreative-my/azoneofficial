-- 0082 — v1.40.1 (audit S-3 / plan Q): data correction. erp.ts goods receipt
-- wrote its manual_stockouts trail row WITHOUT direction, so the 0064
-- default recorded every PO RECEIPT as an 'out' while the stock went IN.
-- The code now writes 'in' explicitly; this fixes history. Convergent —
-- a replay matches 0 rows. Scoped by the exact remark erp.ts writes
-- (asserted by tests/registry-parity.mjs so the literal cannot drift).

UPDATE manual_stockouts
   SET direction = 'in'
 WHERE direction = 'out'
   AND remark LIKE 'Goods receipt PO-%';
