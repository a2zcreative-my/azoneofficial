-- 0227 - THE SALES PIPELINE (the CEO 21-11-2026, Sales Command Center Phase 3, decisions 1 and 4 of
-- 21-11-2026 and his answer As recommended on the seven Phase 3 decisions).
--   sales_opportunities       - one deal on one customer: title, owner, stage, estimated value, the
--                               service it is for (a Packages library id or other words, never a price),
--                               priority, next action and its date, expected close date, and when it
--                               closes the evidence it was won with or the reason it was lost.
--                               stage is new, qualified, proposal, negotiation, won or lost.
--                               won_basis is acceptance, invoice or override (override has its reason).
--                               version - the version an edit started from (a stale edit is refused).
--                               client_key - one deal per press, and qt:id for a confirmed suggestion.
--   opportunity_quotations    - the quotations a deal is quoted with. A quotation belongs to one deal at
--                               most while linked. Unlinking stamps unlinked_at, the row stays.
--   opportunity_stage_events  - every stage change with who and why. Append-only.
-- A deal is never revenue, a payment confirmation or commission. Nothing here touches sales_documents.
-- ADDITIVE ONLY: three new tables with their indexes and triggers. No existing table is altered.

CREATE TABLE IF NOT EXISTS sales_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  est_value_cents INTEGER CHECK (est_value_cents IS NULL OR est_value_cents >= 0),
  service TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  next_action TEXT,
  next_action_on TEXT,
  expected_close_on TEXT,
  lost_reason TEXT CHECK (lost_reason IS NULL OR lost_reason IN ('price', 'timing', 'competitor', 'no_budget', 'no_response', 'not_fit', 'other')),
  lost_note TEXT,
  won_basis TEXT CHECK (won_basis IS NULL OR won_basis IN ('acceptance', 'invoice', 'override')),
  won_doc_id INTEGER,
  override_reason TEXT,
  stage_since TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'suggestion')),
  version INTEGER NOT NULL DEFAULT 1,
  client_key TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_opportunities_key ON sales_opportunities (client_key);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_stage ON sales_opportunities (stage, owner_id);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_customer ON sales_opportunities (customer_id);
CREATE TRIGGER IF NOT EXISTS sales_opportunities_no_delete BEFORE DELETE ON sales_opportunities
BEGIN SELECT RAISE(ABORT, 'A deal is never deleted, it is lost with its reason'); END;

CREATE TABLE IF NOT EXISTS opportunity_quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES sales_opportunities(id),
  doc_id INTEGER NOT NULL REFERENCES sales_documents(id),
  linked_by INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  unlinked_at TEXT,
  unlinked_by INTEGER REFERENCES users(id),
  unlink_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_opportunity_quotations_live ON opportunity_quotations (doc_id) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_opportunity_quotations_opp ON opportunity_quotations (opportunity_id);
CREATE TRIGGER IF NOT EXISTS opportunity_quotations_no_delete BEFORE DELETE ON opportunity_quotations
BEGIN SELECT RAISE(ABORT, 'A quotation link is never deleted, it is unlinked'); END;

CREATE TABLE IF NOT EXISTS opportunity_stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES sales_opportunities(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT,
  basis TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_opportunity_stage_events ON opportunity_stage_events (opportunity_id, id);
CREATE INDEX IF NOT EXISTS idx_opportunity_stage_events_by ON opportunity_stage_events (created_by, created_at);
CREATE TRIGGER IF NOT EXISTS opportunity_stage_events_no_update BEFORE UPDATE ON opportunity_stage_events
BEGIN SELECT RAISE(ABORT, 'A stage record is never edited'); END;
CREATE TRIGGER IF NOT EXISTS opportunity_stage_events_no_delete BEFORE DELETE ON opportunity_stage_events
BEGIN SELECT RAISE(ABORT, 'A stage record is never deleted'); END;
