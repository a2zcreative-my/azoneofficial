-- v1.315.0 - TASKS WORKSPACE 5.0, GATE 4 (the CEO, 15-11-2026: approved as per
-- recommendations). An operational report has a type and is reviewed by
-- management (the CEO, COO or CCO, never its author). A report written before
-- this release reads as submitted: its content, date and author stay as they
-- were. ADDITIVE ONLY: nullable columns and one index.
ALTER TABLE task_reports ADD COLUMN kind TEXT;
ALTER TABLE task_reports ADD COLUMN status TEXT;
ALTER TABLE task_reports ADD COLUMN reviewed_by INTEGER;
ALTER TABLE task_reports ADD COLUMN reviewed_at TEXT;
ALTER TABLE task_reports ADD COLUMN review_note TEXT;
CREATE INDEX IF NOT EXISTS idx_task_reports_status ON task_reports (status, report_date);
