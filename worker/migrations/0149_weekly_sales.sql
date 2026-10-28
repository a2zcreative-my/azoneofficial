-- 0149 - Weekly sales targets, week results and recovery plans, and a link from
-- a task to the sales record it is about. Additive only - no existing row is
-- changed.
-- A weekly target is a row from a week onward. A change is a NEW row with a
-- reason, and the latest row for a week wins, so history is kept. A NULL
-- amount records that the target is not set from that week.
CREATE TABLE IF NOT EXISTS sales_week_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('person', 'team', 'company')),
  user_id INTEGER,
  team TEXT,
  week_from TEXT NOT NULL,
  target_cents INTEGER,
  reason TEXT NOT NULL,
  set_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_week_targets ON sales_week_targets (scope, user_id, team, week_from);
-- The result of a week, written once when the week has ended. user_id 0 is
-- the company line.
CREATE TABLE IF NOT EXISTS sales_week_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_from TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  target_cents INTEGER,
  basis_cents INTEGER NOT NULL,
  confirmed_cents INTEGER NOT NULL,
  status TEXT,
  figures TEXT NOT NULL,
  finalised_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_week_results_once ON sales_week_results (week_from, user_id);
-- One recovery plan per person per week, drafted by the person, reviewed by
-- the CEO, COO or super admin.
CREATE TABLE IF NOT EXISTS sales_recovery_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  week_from TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  actions TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  gap_cents INTEGER,
  submitted_at TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_once ON sales_recovery_plans (user_id, week_from);
-- A task may name the sales record it is about: a customer, an enquiry, a
-- quotation or a recovery plan. Both columns stay empty for every other task.
ALTER TABLE tasks ADD COLUMN link_kind TEXT;
ALTER TABLE tasks ADD COLUMN link_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_link ON tasks (link_kind, link_id, assigned_to);
