-- v1.369.0 the A2Z Business Growth Check (the CEO, 18-11-2026, public form at /apply/business)
-- additive only: two new tables. No existing table, column or row is changed.
-- An enquiry is a lead record. It never creates a user, a customer or a sale.
-- A paid solution goes through the existing quotation, acceptance, invoice and payment verification.
CREATE TABLE IF NOT EXISTS business_growth_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  client_key TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT,
  business_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  industry_other TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  social_url TEXT,
  source TEXT NOT NULL,
  source_detail TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer TEXT,
  landing_path TEXT,
  challenges TEXT NOT NULL,
  challenge_other TEXT,
  urgent_problem TEXT NOT NULL,
  goal_90d TEXT NOT NULL,
  platforms TEXT NOT NULL,
  interests TEXT NOT NULL,
  contact_method TEXT NOT NULL DEFAULT 'whatsapp' CHECK (contact_method IN ('whatsapp', 'call', 'email')),
  contact_time TEXT NOT NULL,
  consent_contact INTEGER NOT NULL CHECK (consent_contact = 1),
  consent_privacy INTEGER NOT NULL CHECK (consent_privacy = 1),
  consent_marketing INTEGER NOT NULL DEFAULT 0 CHECK (consent_marketing IN (0, 1)),
  privacy_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  consent_ip_hash TEXT,
  consent_agent TEXT,
  lang TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'assigned', 'contacted', 'problem_identified', 'advice_delivered', 'qualified', 'follow_up', 'not_interested')),
  owner_id INTEGER REFERENCES users (id),
  picked_at TEXT,
  first_response_at TEXT,
  contact_attempts INTEGER NOT NULL DEFAULT 0,
  next_follow_up_on TEXT,
  problem_summary TEXT,
  advice_summary TEXT,
  advice_at TEXT,
  advice_by INTEGER REFERENCES users (id),
  outcome_reason TEXT,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users (id),
  quotation_id INTEGER,
  resubmissions INTEGER NOT NULL DEFAULT 0,
  last_submitted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_growth_status ON business_growth_enquiries (status, created_at);
CREATE INDEX IF NOT EXISTS ix_growth_owner ON business_growth_enquiries (owner_id, status);
CREATE INDEX IF NOT EXISTS ix_growth_whatsapp ON business_growth_enquiries (whatsapp, status);
CREATE TABLE IF NOT EXISTS business_growth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER NOT NULL REFERENCES business_growth_enquiries (id),
  actor_id INTEGER REFERENCES users (id),
  kind TEXT NOT NULL,
  body TEXT,
  channel TEXT,
  status_from TEXT,
  status_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_growth_events ON business_growth_events (enquiry_id, id);
CREATE TRIGGER IF NOT EXISTS growth_events_no_update BEFORE UPDATE ON business_growth_events BEGIN SELECT RAISE(ABORT, 'enquiry history is kept as it was'); END;
CREATE TRIGGER IF NOT EXISTS growth_events_no_delete BEFORE DELETE ON business_growth_events BEGIN SELECT RAISE(ABORT, 'enquiry history is kept'); END;
CREATE TRIGGER IF NOT EXISTS growth_enquiries_no_delete BEFORE DELETE ON business_growth_enquiries BEGIN SELECT RAISE(ABORT, 'an enquiry is kept; close it instead'); END;
