-- 0053: Hourly payroll for part-time live hosts (v1.4.183)
-- CEO rule: a live host is part-time, contract or permanent. PART-TIME live
-- hosts are paid by the hour — RM15.00/hour — for the clocked time of the
-- month (first clock-in to last clock-out per day). No OT for them; contract
-- and permanent live hosts keep OT eligibility.
-- hourly_minutes: the month's clocked minutes the pay was computed from.
-- hourly_rate_cents: the rate used (1500 = RM15.00) — stored so historic
-- slips stay correct if the rate ever changes.
ALTER TABLE payroll_entries ADD COLUMN hourly_minutes INTEGER;
ALTER TABLE payroll_entries ADD COLUMN hourly_rate_cents INTEGER;
