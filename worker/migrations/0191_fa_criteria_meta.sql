-- 0191_fa_criteria_meta  v1.301.0
-- Financial Advisory 2.0 phase 4 (the CEO 13-11-2026, blueprint section 9 and decision D-4).
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- fa_criteria_meta  one row per bank criterion at most - its category (official bank
--                   criteria or banker-provided indicative), its confidence (high,
--                   medium, low), its review-due and expiry days, and for an indicative
--                   entry the banker, the day, the channel and the words they used.
--                   A criterion with no row reads as official with no dates, as before.
--                   Indicative entries are never used to match - only management turns
--                   them into official criteria, with a source, as a new version.

CREATE TABLE IF NOT EXISTS fa_criteria_meta (
  criterion_id INTEGER PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'official' CHECK (category IN ('official', 'banker_indicative')),
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  review_due_on TEXT,
  expires_on TEXT,
  banker_id INTEGER,
  heard_on TEXT,
  channel TEXT,
  exact_feedback TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
