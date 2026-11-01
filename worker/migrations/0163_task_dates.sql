-- 0163 - A task has a start date and a due date, release 1.248.0.
-- The owner, 01-11-2026: a task under a project reads as a span of work
-- (start and end), the same as the project itself. tasks.deadline stays the
-- due date (end) with every reminder, overdue rule and report that reads
-- it. start_date is new, nullable, and a task without one shows its due
-- date only, as today. Additive only - no existing row is changed.
ALTER TABLE tasks ADD COLUMN start_date TEXT;
