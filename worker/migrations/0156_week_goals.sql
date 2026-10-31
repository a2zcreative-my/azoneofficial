-- 0156 - Weekly contribution goals and verified lead introductions. Additive
-- only - no existing row is changed.
-- A weekly target row gains a metric. Every existing row is revenue (the
-- default), so every target already set keeps its meaning. A goal that is a
-- count (quotations, follow-ups, qualified enquiries, introductions) keeps its
-- number in target_count. Rows stay insert-only with a reason, as in 0149.
ALTER TABLE sales_week_targets ADD COLUMN metric TEXT NOT NULL DEFAULT 'revenue';
ALTER TABLE sales_week_targets ADD COLUMN target_count INTEGER;
CREATE INDEX IF NOT EXISTS idx_week_targets_metric ON sales_week_targets (scope, user_id, metric, week_from);
-- An enquiry can name the staff member who introduced it, and records when
-- and by whom Sales marked it qualified - the moment an introduction counts.
ALTER TABLE enquiries ADD COLUMN referred_by INTEGER;
ALTER TABLE enquiries ADD COLUMN qualified_at TEXT;
ALTER TABLE enquiries ADD COLUMN qualified_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_enquiries_referred ON enquiries (referred_by, qualified_at);
CREATE INDEX IF NOT EXISTS idx_enquiries_qualified ON enquiries (qualified_by, qualified_at);
