-- v1.351.0 partner interest applications (the CEO, 17-11-2026, A2Z OS - CREATE PARTNER INTEREST APPLICATION)
-- additive only: two new tables. No existing table, column or row is changed.
-- A public application is a screening record. It never creates a user, a customer or an agent account.
CREATE TABLE IF NOT EXISTS partner_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  client_key TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  age_range TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  location TEXT NOT NULL,
  contact_method TEXT NOT NULL DEFAULT 'whatsapp' CHECK (contact_method IN ('whatsapp', 'email', 'call')),
  best_time TEXT,
  source TEXT NOT NULL,
  source_detail TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referred_before INTEGER NOT NULL CHECK (referred_before IN (0, 1)),
  intro_per_week TEXT NOT NULL,
  customer_groups TEXT NOT NULL,
  groups_other TEXT,
  lead_channels TEXT NOT NULL,
  channels_other TEXT,
  approach TEXT NOT NULL,
  time_available TEXT NOT NULL,
  screening_window TEXT NOT NULL,
  ack_independent INTEGER NOT NULL CHECK (ack_independent = 1),
  ack_terms INTEGER NOT NULL CHECK (ack_terms = 1),
  privacy_ack INTEGER NOT NULL CHECK (privacy_ack = 1),
  marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0, 1)),
  lang TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'assigned', 'screening', 'shortlisted', 'approved', 'rejected', 'on_hold', 'activated')),
  owner_id INTEGER REFERENCES users (id),
  picked_at TEXT,
  first_response_at TEXT,
  next_follow_up_on TEXT,
  recommended_by INTEGER REFERENCES users (id),
  approved_by INTEGER REFERENCES users (id),
  approved_at TEXT,
  agreement_signed_on TEXT,
  agreement_note TEXT,
  agent_user_id INTEGER REFERENCES users (id),
  activated_by INTEGER REFERENCES users (id),
  activated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_partner_apps_status ON partner_applications (status, created_at);
CREATE INDEX IF NOT EXISTS ix_partner_apps_owner ON partner_applications (owner_id, status);
CREATE INDEX IF NOT EXISTS ix_partner_apps_contact ON partner_applications (lower(email), phone);
CREATE TABLE IF NOT EXISTS partner_application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES partner_applications (id),
  actor_id INTEGER REFERENCES users (id),
  kind TEXT NOT NULL,
  body TEXT,
  channel TEXT,
  status_from TEXT,
  status_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_partner_app_events ON partner_application_events (application_id, id);
CREATE TRIGGER IF NOT EXISTS partner_app_events_no_update BEFORE UPDATE ON partner_application_events BEGIN SELECT RAISE(ABORT, 'application history is kept as it was'); END;
CREATE TRIGGER IF NOT EXISTS partner_app_events_no_delete BEFORE DELETE ON partner_application_events BEGIN SELECT RAISE(ABORT, 'application history is kept'); END;
CREATE TRIGGER IF NOT EXISTS partner_apps_no_delete BEFORE DELETE ON partner_applications BEGIN SELECT RAISE(ABORT, 'an application is kept; reject it instead'); END;
