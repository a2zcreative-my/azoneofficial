-- 0184_fa_registry  v1.286.0
-- Financial Advisory bank, branch and banker registry, stage 1.
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- 0183 is applied in production and is left exactly as it ran.
-- fa_banks            one row per bank, found again by name_key
-- fa_localities       the management place list, state district city
-- fa_branches         one row per branch, closed or renamed but never deleted
-- fa_bank_products    what a bank offers, at branches or centrally
-- fa_bankers          one row per banker, work contact only, no login
-- fa_banker_verifications  identity and referral facts, append only
-- fa_banker_branches  dated assignments, ended never rewritten
-- fa_banker_products  the products a banker handles
-- fa_matches fa_allocations fa_enquiries fa_disclosures fa_applications  stage 2, unused
-- fa_registry_events  every registry change, append only
-- fa_criteria_terms   the registry bank and the age amount tenure ranges of one criterion
-- fa_note_links       the directory banker and branch of one banker note
-- The free text fa_bank_contacts and fa_contact_log of 0183 stay untouched.

CREATE TABLE IF NOT EXISTS fa_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'commercial' CHECK (kind IN ('commercial', 'islamic', 'dfi', 'cooperative', 'other')),
  website TEXT,
  official_phone TEXT,
  official_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'retired')),
  owner_id INTEGER,
  source TEXT,
  last_verified_on TEXT,
  verified_by INTEGER,
  retired_reason TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_banks_name
  ON fa_banks (name_key);

CREATE TABLE IF NOT EXISTS fa_localities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL,
  district TEXT NOT NULL,
  city TEXT NOT NULL,
  place_key TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_localities_key
  ON fa_localities (place_key);

CREATE TABLE IF NOT EXISTS fa_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  code TEXT,
  address TEXT,
  postcode TEXT NOT NULL,
  locality_id INTEGER NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'temporarily_closed', 'closed', 'renamed')),
  status_note TEXT,
  renamed_to INTEGER,
  latitude REAL,
  longitude REAL,
  coord_source TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  last_verified_on TEXT,
  verified_by INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_branches_key
  ON fa_branches (bank_id, name_key, postcode);

CREATE TABLE IF NOT EXISTS fa_bank_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('personal_financing', 'debt_consolidation')),
  channel TEXT NOT NULL DEFAULT 'branch' CHECK (channel IN ('branch', 'central')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  source TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_bank_products_key
  ON fa_bank_products (bank_id, product);

CREATE TABLE IF NOT EXISTS fa_bankers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  position TEXT,
  work_email TEXT,
  email_key TEXT,
  work_phone TEXT,
  phone_key TEXT,
  preferred_channel TEXT,
  relationship_type TEXT NOT NULL DEFAULT 'direct' CHECK (relationship_type IN ('direct', 'referral', 'central_unit', 'other')),
  owner_id INTEGER,
  availability TEXT NOT NULL DEFAULT 'unknown' CHECK (availability IN ('available', 'limited', 'unavailable', 'unknown')),
  availability_on TEXT,
  unavailable_until TEXT,
  case_limit INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'left')),
  status_reason TEXT,
  notes TEXT,
  duplicate_reason TEXT,
  registered_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_bankers_email
  ON fa_bankers (email_key) WHERE email_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fa_bankers_bank
  ON fa_bankers (bank_id, status);

CREATE TABLE IF NOT EXISTS fa_banker_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banker_id INTEGER NOT NULL,
  fact TEXT NOT NULL CHECK (fact IN ('identity', 'referral')),
  method TEXT NOT NULL,
  evidence TEXT,
  restrictions TEXT,
  verified_on TEXT NOT NULL,
  next_review_on TEXT NOT NULL,
  verified_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_banker_verifications
  ON fa_banker_verifications (banker_id, fact, id);

CREATE TABLE IF NOT EXISTS fa_banker_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banker_id INTEGER NOT NULL,
  branch_id INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  coverage TEXT NOT NULL DEFAULT 'branch' CHECK (coverage IN ('branch', 'districts', 'states', 'national')),
  coverage_areas TEXT,
  effective_from TEXT NOT NULL,
  ended_on TEXT,
  end_reason TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_banker_branches
  ON fa_banker_branches (banker_id, ended_on);

CREATE TABLE IF NOT EXISTS fa_banker_products (
  banker_id INTEGER NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('personal_financing', 'debt_consolidation')),
  PRIMARY KEY (banker_id, product)
);

CREATE TABLE IF NOT EXISTS fa_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  assessment_id INTEGER,
  status TEXT NOT NULL,
  result TEXT NOT NULL,
  run_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fa_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  product TEXT NOT NULL,
  bank_id INTEGER NOT NULL,
  bank_product_id INTEGER,
  banker_id INTEGER NOT NULL,
  branch_id INTEGER,
  match_id INTEGER,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'secondary')),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'pending_review', 'assigned', 'awaiting_consent', 'ready', 'cancelled', 'reassigned')),
  reason TEXT,
  reassigned_from INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_allocations_primary
  ON fa_allocations (case_id, product) WHERE role = 'primary' AND state IN ('draft', 'pending_review', 'assigned', 'awaiting_consent', 'ready');

CREATE INDEX IF NOT EXISTS idx_fa_allocations_banker
  ON fa_allocations (banker_id, state);

CREATE TABLE IF NOT EXISTS fa_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  allocation_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  banker_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'not_sent' CHECK (state IN ('not_sent', 'sent', 'acknowledged', 'information_requested', 'feedback_received', 'not_supported', 'closed')),
  sent_at TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_enquiries_allocation
  ON fa_enquiries (allocation_id);

CREATE TABLE IF NOT EXISTS fa_disclosures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  banker_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  consent_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  purpose TEXT NOT NULL,
  sent_by INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_disclosures_doc
  ON fa_disclosures (enquiry_id, document_id);

CREATE TABLE IF NOT EXISTS fa_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  bank_id INTEGER NOT NULL,
  bank_product_id INTEGER,
  product TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'conditional_offer', 'officially_approved', 'declined', 'withdrawn', 'disbursed')),
  bank_reference TEXT,
  evidence_id INTEGER,
  submitted_on TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_applications_active
  ON fa_applications (case_id, bank_id, product) WHERE status NOT IN ('declined', 'withdrawn');

CREATE TABLE IF NOT EXISTS fa_registry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('bank', 'branch', 'banker', 'locality', 'product')),
  entity_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  actor_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_registry_events
  ON fa_registry_events (entity, entity_id, id);

CREATE TABLE IF NOT EXISTS fa_criteria_terms (
  criterion_id INTEGER PRIMARY KEY,
  bank_id INTEGER NOT NULL,
  bank_product_id INTEGER,
  min_age INTEGER,
  max_age INTEGER,
  min_amount_cents INTEGER,
  max_amount_cents INTEGER,
  min_tenure_months INTEGER,
  max_tenure_months INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_criteria_terms_bank
  ON fa_criteria_terms (bank_id);

CREATE TABLE IF NOT EXISTS fa_note_links (
  note_id INTEGER PRIMARY KEY,
  banker_id INTEGER,
  branch_id INTEGER,
  enquiry_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_note_links_banker
  ON fa_note_links (banker_id);

CREATE TRIGGER IF NOT EXISTS fa_criteria_terms_no_delete BEFORE DELETE ON fa_criteria_terms
BEGIN SELECT RAISE(ABORT, 'fa_criteria_terms rows are kept'); END;

CREATE TRIGGER IF NOT EXISTS fa_note_links_no_update BEFORE UPDATE ON fa_note_links
BEGIN SELECT RAISE(ABORT, 'fa_note_links is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_note_links_no_delete BEFORE DELETE ON fa_note_links
BEGIN SELECT RAISE(ABORT, 'fa_note_links is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_registry_events_no_update BEFORE UPDATE ON fa_registry_events
BEGIN SELECT RAISE(ABORT, 'The registry history is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_registry_events_no_delete BEFORE DELETE ON fa_registry_events
BEGIN SELECT RAISE(ABORT, 'The registry history is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_banker_verifications_no_update BEFORE UPDATE ON fa_banker_verifications
BEGIN SELECT RAISE(ABORT, 'Verification records are append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_banker_verifications_no_delete BEFORE DELETE ON fa_banker_verifications
BEGIN SELECT RAISE(ABORT, 'Verification records are append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_disclosures_no_update BEFORE UPDATE ON fa_disclosures
BEGIN SELECT RAISE(ABORT, 'Disclosure records are append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_disclosures_no_delete BEFORE DELETE ON fa_disclosures
BEGIN SELECT RAISE(ABORT, 'Disclosure records are append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_banks_no_delete BEFORE DELETE ON fa_banks
BEGIN SELECT RAISE(ABORT, 'Banks are retired, never deleted'); END;

CREATE TRIGGER IF NOT EXISTS fa_branches_no_delete BEFORE DELETE ON fa_branches
BEGIN SELECT RAISE(ABORT, 'Branches are closed, never deleted'); END;

CREATE TRIGGER IF NOT EXISTS fa_bankers_no_delete BEFORE DELETE ON fa_bankers
BEGIN SELECT RAISE(ABORT, 'Bankers are made inactive, never deleted'); END;

CREATE TRIGGER IF NOT EXISTS fa_banker_branches_no_delete BEFORE DELETE ON fa_banker_branches
BEGIN SELECT RAISE(ABORT, 'Assignment history is kept'); END;
