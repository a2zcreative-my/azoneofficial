-- 0185_fa_dsr  v1.288.0
-- Financial Advisory DSR pre-check and management review.
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- fa_reviews     submissions for management review and the decisions on them
--                (proceed, request_info, concern, unsuitable, withdrawn), append only
-- fa_item_meta   per commitment line - lender, last four digits, reference and
--                remaining months - for the duplicate guard and the
--                consolidation totals, written once with the line

CREATE TABLE IF NOT EXISTS fa_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  assessment_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('submitted', 'proceed', 'request_info', 'concern', 'unsuitable', 'withdrawn')),
  reason TEXT,
  next_action TEXT,
  actor_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_reviews_case
  ON fa_reviews (case_id, id);

CREATE INDEX IF NOT EXISTS idx_fa_reviews_action
  ON fa_reviews (action, id);

CREATE TABLE IF NOT EXISTS fa_item_meta (
  item_id INTEGER PRIMARY KEY,
  lender_bank_id INTEGER,
  lender_name TEXT,
  account_last4 TEXT,
  facility_ref TEXT,
  remaining_months INTEGER,
  duplicate_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS fa_reviews_no_update BEFORE UPDATE ON fa_reviews
BEGIN SELECT RAISE(ABORT, 'fa_reviews is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_reviews_no_delete BEFORE DELETE ON fa_reviews
BEGIN SELECT RAISE(ABORT, 'fa_reviews is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_item_meta_no_delete BEFORE DELETE ON fa_item_meta
BEGIN SELECT RAISE(ABORT, 'fa_item_meta rows are kept'); END;
