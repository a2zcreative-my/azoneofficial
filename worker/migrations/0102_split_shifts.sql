-- 0102 - v1.80.0: a working day can have TWO blocks, not one.
--
-- The CEO, 02-09-2026:
--   this one need to change since it is not working correctly flow which is
--   require 8 hours, 11:00am to 5:00pm then continue work at 8:30pm to
--   10:30pm
--
-- 0099 gave every weekday ONE start and ONE end, which is the shape of an
-- office day and not the shape of this company. A live host works the
-- afternoon, goes home, and comes back for the evening broadcast. 11:00-17:00
-- is six hours, and the eight hours he is owed only appear when 20:30-22:30
-- is part of the same day.
--
-- Written as one window, that day had to be entered as 11:00-22:30, and
-- everything downstream believed it. Eleven and a half scheduled hours. An
-- early-out flag on anybody who left at 17:00 as instructed. A part-time host
-- paid by the clock for three and a half hours he spent at home.
--
-- SEVEN MORE PAIRS OF COLUMNS, NOT A SEGMENTS TABLE. A child table would take
-- any number of blocks per day and is the textbook answer. It is not the
-- right one here. The resolver reads every pattern in ONE query and answers
-- from memory - that is v1.77.0, and the reason the Payroll tab stopped
-- taking a minute to load - and a segments table turns that into a join it
-- would have to keep sorted per day. Nobody has asked for a third block. The
-- day that changes, this becomes a table and the resolver keeps its shape.
--
-- NULL means what it meant in 0099: nothing scheduled. A NULL second block is
-- a day with one block, which is every day the company had before this
-- migration - so applying this changes no existing schedule and no existing
-- flag.
--
-- FOURTEEN ALTERs IN ONE FILE. The audit B4 rule is one non-idempotent
-- statement per migration, because a half-applied migration is unrecoverable.
-- These fourteen are the exception the rule allows for: they are one logical
-- change, they touch one table, ADD COLUMN cannot fail on data, and D1
-- records the file as applied only when all of them succeed. Splitting them
-- into fourteen files would give fourteen chances for the set to be half
-- applied, which is the outcome B4 exists to prevent.

ALTER TABLE shift_patterns ADD COLUMN mon_start2 INTEGER;
ALTER TABLE shift_patterns ADD COLUMN mon_end2   INTEGER;
ALTER TABLE shift_patterns ADD COLUMN tue_start2 INTEGER;
ALTER TABLE shift_patterns ADD COLUMN tue_end2   INTEGER;
ALTER TABLE shift_patterns ADD COLUMN wed_start2 INTEGER;
ALTER TABLE shift_patterns ADD COLUMN wed_end2   INTEGER;
ALTER TABLE shift_patterns ADD COLUMN thu_start2 INTEGER;
ALTER TABLE shift_patterns ADD COLUMN thu_end2   INTEGER;
ALTER TABLE shift_patterns ADD COLUMN fri_start2 INTEGER;
ALTER TABLE shift_patterns ADD COLUMN fri_end2   INTEGER;
ALTER TABLE shift_patterns ADD COLUMN sat_start2 INTEGER;
ALTER TABLE shift_patterns ADD COLUMN sat_end2   INTEGER;
ALTER TABLE shift_patterns ADD COLUMN sun_start2 INTEGER;
ALTER TABLE shift_patterns ADD COLUMN sun_end2   INTEGER;
