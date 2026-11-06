-- 1.271.0 Phase 0 B - the second column of the same schema drift (see 0179)
-- claude/PHASE0-SAFETY-REVIEW.md - the CEO approved Phase 0 on 06-11-2026
--
-- refund_flagged_at marks a paid ELFIA order that was later cancelled, for a person to
-- decide the money - never reversed automatically. The ELFIA poll reads it for every order.
--
-- Additive only. The column starts empty. No existing row is changed.
-- One statement per file (rule B4 in 0075). A database built from scratch already has
-- this column from 0081 - mark this file applied there instead of running it.
ALTER TABLE web_orders ADD COLUMN refund_flagged_at TEXT;
