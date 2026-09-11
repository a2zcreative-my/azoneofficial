-- 0127 - v1.155.0: Sales Performance - the accountability register.
--
-- The CEO, 11-09-2026: one page that answers whether a staff member actually
-- worked on sales today, without relying on what they claim. The rules the
-- whole page is built on - no evidence means no automatic KPI credit, no
-- actual order means no revenue credit, no tracking number means the
-- shipment is not complete, and nothing unverified counts toward the score.
--
-- WHAT IS NEW AND WHAT IS REUSED. Orders are invoices (sales_documents INV).
-- Shipments are postage_records. Customers are customers. Attendance is
-- attendance_records. Those tables are read, never copied. What did not exist
-- is added here: the social post evidence register, the approved company
-- accounts it is checked against, customer engagements and follow-ups,
-- promotions, the few activities that fit none of those, and the daily
-- closing with its system snapshot.
--
-- Every table is soft-deleted and every write is audited through audit_log.
-- No FOREIGN KEY constraints, by house rule - ids are referenced and joined.

CREATE TABLE IF NOT EXISTS sp_social_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_accounts_key ON sp_social_accounts(platform, handle);

CREATE TABLE IF NOT EXISTS sp_social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  account_handle TEXT,
  account_match INTEGER NOT NULL DEFAULT 0,
  product TEXT,
  description TEXT,
  evidence_key TEXT,
  posted_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending',
  flags TEXT,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  metrics_status TEXT NOT NULL DEFAULT 'reported',
  promotion_id INTEGER,
  verified_by INTEGER,
  verified_at TEXT,
  verify_note TEXT,
  last_check_at TEXT,
  last_check_http INTEGER,
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_posts_key ON sp_social_posts(url_key);
CREATE INDEX IF NOT EXISTS idx_sp_posts_user ON sp_social_posts(user_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_sp_posts_status ON sp_social_posts(status);

CREATE TABLE IF NOT EXISTS sp_engagements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  customer_id INTEGER,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_key TEXT NOT NULL,
  happened_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  product TEXT,
  action_taken TEXT,
  follow_up_on TEXT,
  outcome TEXT,
  outcome_at TEXT,
  order_doc_id INTEGER,
  notes TEXT,
  evidence_key TEXT,
  promotion_id INTEGER,
  source_post_id INTEGER,
  status TEXT NOT NULL DEFAULT 'reported',
  verified_by INTEGER,
  verified_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sp_eng_user ON sp_engagements(user_id, happened_at);
CREATE INDEX IF NOT EXISTS idx_sp_eng_follow ON sp_engagements(follow_up_on);
CREATE INDEX IF NOT EXISTS idx_sp_eng_order ON sp_engagements(order_doc_id);

CREATE TABLE IF NOT EXISTS sp_promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  product TEXT,
  platform TEXT,
  promo_type TEXT,
  start_on TEXT NOT NULL,
  end_on TEXT,
  user_id INTEGER NOT NULL,
  customers_reached INTEGER,
  result TEXT,
  notes TEXT,
  evidence_key TEXT,
  status TEXT NOT NULL DEFAULT 'reported',
  verified_by INTEGER,
  verified_at TEXT,
  deleted_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sp_promo_user ON sp_promotions(user_id, start_on);

CREATE TABLE IF NOT EXISTS sp_other_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  happened_at TEXT NOT NULL,
  customer_name TEXT,
  product TEXT,
  action TEXT NOT NULL,
  result TEXT,
  evidence_key TEXT,
  status TEXT NOT NULL DEFAULT 'reported',
  verified_by INTEGER,
  verified_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sp_other_user ON sp_other_activities(user_id, happened_at);

CREATE TABLE IF NOT EXISTS sp_daily_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  main_achievement TEXT,
  blockers TEXT,
  follow_up_tomorrow TEXT,
  plan_tomorrow TEXT,
  remarks TEXT,
  no_activity_reason TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_closing_day ON sp_daily_closings(user_id, day);
