-- 0092 - v1.62.0 (CEO: "in Leave I want to update on the eligible also"):
-- correcting the days already taken, without inventing leave records.
--
-- used is summed from approved leave_requests. When that sum is wrong, for
-- example leave approved by mistake, or taken on the ground and never
-- applied for, the eligible figure is wrong with it, and there was no way to
-- fix it short of editing the leave history of a member of staff.
--
-- Editing the history is the wrong fix: those rows are the record of who
-- asked, who approved, and when. used_adjust is added to the summed total
-- instead, so the correction is visible AS a correction and the original
-- applications stay exactly as they were filed.
--
-- Single ALTER, nothing else in this file (audit B4 rule).

ALTER TABLE leave_balances ADD COLUMN used_adjust REAL NOT NULL DEFAULT 0;
