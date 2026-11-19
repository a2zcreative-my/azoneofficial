-- 0219 - A PORTFOLIO REVIEW (the CEO 19-11-2026 - Send for approval goes to the CEO and the super admin,
-- pre-checked first by the COO or CCO on the reporting chart).
-- When a person sends their own portfolio for approval, the nearest COO or CCO above them on the
-- Organisation chart pre-checks it first (OK, or returned with a note) - then the CEO and the super
-- admin are asked to publish it. Someone with no COO or CCO above them goes straight to approval.
-- One row per step, never edited or deleted. The latest row of a portfolio is where its review stands.
-- ADDITIVE ONLY: one new table and its triggers.
CREATE TABLE IF NOT EXISTS staff_portfolio_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES staff_portfolios(id),
  version INTEGER NOT NULL,
  step TEXT NOT NULL CHECK (step IN ('submitted', 'prechecked', 'returned')),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  assignee_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- version = the portfolio version when the step was taken. assignee_id = the pre-checker a submission waits on, NULL = the approvers.
CREATE INDEX IF NOT EXISTS ix_portfolio_reviews_portfolio ON staff_portfolio_reviews (portfolio_id, id);
CREATE TRIGGER IF NOT EXISTS staff_portfolio_reviews_no_update BEFORE UPDATE ON staff_portfolio_reviews
BEGIN SELECT RAISE(ABORT, 'A review step is never edited'); END;
CREATE TRIGGER IF NOT EXISTS staff_portfolio_reviews_no_delete BEFORE DELETE ON staff_portfolio_reviews
BEGIN SELECT RAISE(ABORT, 'A review step is never deleted'); END;
