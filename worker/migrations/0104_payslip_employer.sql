-- 0104 - v1.85.0: the payslips that never got the memo.
--
-- The CEO, 03-09-2026, on his August payslip:
--   payslip capture AZ ONE OFFICIAL instead of A2Z Creative Marketing
--
-- He is right, and the code was not wrong. v1.28.0 built the whole mechanism:
-- a payslip carries the employer of record stamped on its month row in
-- payslip_releases, and the renderer resolves it. NULL means a month released
-- before the switch, which renders as AZ ONE OFFICIAL forever - and that rule
-- is deliberate, because a payslip may not be retroactively rebranded onto an
-- entity that did not employ the person that month.
--
-- WHAT WENT WRONG IS NARROWER THAN THAT. The release route stamps the code
-- inside a try, with a fallback INSERT for a database that had not applied
-- 0073 yet. The fallback writes no issuer_code at all. So a month released in
-- that window records NULL - not because it was an AZ ONE month, but because
-- the column was not there to write to - and reads as AZ ONE forever, with
-- nothing on any screen to say so.
--
-- THE CORRECTION, AND ITS LIMIT. A2Z CREATIVE MARKETING has employed since
-- 19-08-2026 - the CEO decision recorded in lib/issuers.ts, "A2Z invoices,
-- A2Z employs". So months from 2026-08 onward are A2Z payslips and are
-- corrected here. Months BEFORE that are left exactly as they are: they were
-- AZ ONE months, they say AZ ONE, and that is not a bug to fix.
--
-- Only rows still NULL are touched. A month somebody deliberately stamped
-- azoo keeps its stamp - this repairs an absence, it does not overrule a
-- decision.
--
-- Data-only: no CREATE, no ALTER, nothing to probe.

UPDATE payslip_releases
   SET issuer_code = 'a2z'
 WHERE issuer_code IS NULL
   AND month >= '2026-08';
