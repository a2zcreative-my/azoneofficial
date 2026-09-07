-- 0119 - v1.134.0: working-hour CATEGORIES, and an overtime record the CEO can amend.
--
-- The CEO, 07-09-2026:
--   working hour should be category for me to update which is normal
--   working hour, afternoon working hour (11:00am to 5:00pm and at home
--   8:30pm to 10:30pm) and evening working hour (2:00pm to 10:00pm) so
--   that easy for me to control
--   OT once approved will directly be recorded into the payroll and at the
--   same time recorded at attendance for a manual amendment if needed (CEO)
--
-- 1. A pattern carries a CATEGORY (normal, afternoon, evening or custom) so
--    the three shapes the company actually works are named once and assigned
--    by name. Existing patterns are categorised by their Monday hours, so the
--    ones already built keep working and simply gain their label. The two
--    named shapes are seeded only when no pattern already has those hours.
--
-- 2. An overtime punch remembers who amended it and when. Amendment is CEO
--    only - the trail is what makes a changed figure on a payslip explainable.

ALTER TABLE shift_patterns ADD COLUMN category TEXT NOT NULL DEFAULT 'custom';

UPDATE shift_patterns SET category = 'normal' WHERE is_default = 1;
UPDATE shift_patterns SET category = 'afternoon'
  WHERE category = 'custom' AND mon_start = 660 AND mon_end = 1020 AND mon_start2 = 1230;
UPDATE shift_patterns SET category = 'evening'
  WHERE category = 'custom' AND mon_start = 840 AND mon_end = 1320 AND mon_start2 IS NULL;

-- Afternoon: 11:00-17:00 at the office, 20:30-22:30 at home, Mon-Fri. Half
-- day after 13:00 (two hours into the shift, as the office pattern has it).
INSERT INTO shift_patterns
  (name, category, mon_start, mon_end, tue_start, tue_end, wed_start, wed_end,
   thu_start, thu_end, fri_start, fri_end, sat_start, sat_end, sun_start, sun_end,
   half_day_minutes, break_minutes,
   mon_start2, mon_end2, tue_start2, tue_end2, wed_start2, wed_end2,
   thu_start2, thu_end2, fri_start2, fri_end2)
SELECT 'Afternoon (11:00-17:00 + home 20:30-22:30)', 'afternoon',
   660, 1020, 660, 1020, 660, 1020, 660, 1020, 660, 1020, NULL, NULL, NULL, NULL,
   780, 60,
   1230, 1350, 1230, 1350, 1230, 1350, 1230, 1350, 1230, 1350
WHERE NOT EXISTS (SELECT 1 FROM shift_patterns WHERE category = 'afternoon');

-- Evening: 14:00-22:00, Mon-Fri. Half day after 16:00.
INSERT INTO shift_patterns
  (name, category, mon_start, mon_end, tue_start, tue_end, wed_start, wed_end,
   thu_start, thu_end, fri_start, fri_end, sat_start, sat_end, sun_start, sun_end,
   half_day_minutes, break_minutes)
SELECT 'Evening (14:00-22:00)', 'evening',
   840, 1320, 840, 1320, 840, 1320, 840, 1320, 840, 1320, NULL, NULL, NULL, NULL,
   960, 60
WHERE NOT EXISTS (SELECT 1 FROM shift_patterns WHERE category = 'evening');

ALTER TABLE ot_records ADD COLUMN amended_by INTEGER;
ALTER TABLE ot_records ADD COLUMN amended_at TEXT;
