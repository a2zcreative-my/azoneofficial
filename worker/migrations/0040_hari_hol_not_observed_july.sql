-- v1.4.122 (CEO's instruction, 02-08-2026): Hari Hol Almarhum Sultan Iskandar
-- (21-07-2026) was NOT observed — the team reported to work (first day for
-- most was 20-07). The company replaces it in August on a date to be set via
-- the HR holiday calendar. Removing the July entry makes July 2026 = 23
-- working days, so incomplete-month deductions compute correctly (leaving it
-- would over-pay every prorated slip).
DELETE FROM holidays WHERE holiday_date = '2026-07-21' AND name = 'Hari Hol Almarhum Sultan Iskandar';
