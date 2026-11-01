-- 0164 - The Agent role and agent package requests, release 1.249.0.
-- The owner, 01-11-2026, approved: a real agent role (users rebuilt after
-- the PUSH.bat backup, every row and column kept), agents sign in to the
-- staff portal with a small menu, they see their own tasks and the active
-- packages and submit clients with the package they want. Sales and
-- Marketing read the requests, management reads and edits them. Agents are
-- never staff for payroll, attendance, leave or claims.
-- SQLite cannot widen a CHECK, so users is rebuilt the way Cloudflare D1
-- documents for a table other tables point at - foreign keys deferred, a new
-- table with every current column in the same order, a copy of every row,
-- the old table dropped and the new one renamed to users (every pointer to
-- users then finds the same ids), the two indexes recreated, deferral off.
-- No ON DELETE action points at users, so dropping it deletes nothing else.
PRAGMA defer_foreign_keys = true;
CREATE TABLE users_new6 (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'super_admin','admin',
    'editor','marketing','live_host',
    'hr_admin','sales_marketing',
    'ceo','coo','cco',
    'customer',
    'agent'
  )),
  is_active INTEGER NOT NULL DEFAULT 1,
  employee_id TEXT,
  position TEXT,
  department TEXT,
  phone TEXT,
  photo_media_id INTEGER REFERENCES media(id),
  employment_status TEXT NOT NULL DEFAULT 'permanent'
    CHECK (employment_status IN (
      'permanent','contract','part_time',
      'active','probation','resigned','terminated'
    )),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  birthday TEXT,
  id_issued_on TEXT,
  blood_type TEXT,
  full_name TEXT,
  photo_key TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  bank_name TEXT,
  bank_account TEXT,
  joined_on TEXT,
  ic_number TEXT,
  base_salary_cents INTEGER NOT NULL DEFAULT 0,
  left_on TEXT,
  rejoined_on TEXT,
  onboarding_json TEXT,
  address TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  emergency_relation TEXT,
  epf_no TEXT,
  socso_no TEXT,
  tax_no TEXT,
  totp_last_step INTEGER,
  reports_to INTEGER REFERENCES users(id),
  role_title TEXT,
  responsibilities TEXT,
  responsibilities_updated_at TEXT,
  responsibilities_updated_by INTEGER,
  google_sub TEXT,
  email_verified_at TEXT
);
INSERT INTO users_new6 (
  id, email, password_hash, name, role, is_active, employee_id, position,
  department, phone, photo_media_id, employment_status, created_at, birthday,
  id_issued_on, blood_type, full_name, photo_key, totp_secret, totp_enabled,
  bank_name, bank_account, joined_on, ic_number, base_salary_cents, left_on,
  rejoined_on, onboarding_json, address, emergency_name, emergency_phone,
  emergency_relation, epf_no, socso_no, tax_no, totp_last_step, reports_to,
  role_title, responsibilities, responsibilities_updated_at,
  responsibilities_updated_by, google_sub, email_verified_at
)
SELECT
  id, email, password_hash, name, role, is_active, employee_id, position,
  department, phone, photo_media_id, employment_status, created_at, birthday,
  id_issued_on, blood_type, full_name, photo_key, totp_secret, totp_enabled,
  bank_name, bank_account, joined_on, ic_number, base_salary_cents, left_on,
  rejoined_on, onboarding_json, address, emergency_name, emergency_phone,
  emergency_relation, epf_no, socso_no, tax_no, totp_last_step, reports_to,
  role_title, responsibilities, responsibilities_updated_at,
  responsibilities_updated_by, google_sub, email_verified_at
FROM users;
DROP TABLE users;
ALTER TABLE users_new6 RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_reports_to ON users(reports_to);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
PRAGMA defer_foreign_keys = false;
-- agent_requests: a client an agent brings in, a lead until Sales makes the
-- quotation in Sales. Release 1.250.0 (the agent portal brief, approved
-- 01-11-2026, claude/AGENT-PORTAL-AUDIT.md) widened it here because 0164 had
-- never run on any database. status is the request status only. The
-- quotation keeps its own revision, approval, issue and acceptance in Sales
-- and is never copied here. published_doc_id and published_revision say which
-- issued revision the agent was given. assigned_to is the salesperson who
-- handles it. client_key makes a retried submit return the same row.
CREATE TABLE IF NOT EXISTS agent_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id           INTEGER NOT NULL,
  client_name        TEXT    NOT NULL,
  contact_person     TEXT,
  client_phone       TEXT,
  client_email       TEXT,
  company            TEXT,
  package_id         INTEGER,
  package_version    INTEGER,
  custom             INTEGER NOT NULL DEFAULT 0,
  requirement        TEXT,
  issuer_code        TEXT,
  timeline           TEXT,
  budget_text        TEXT,
  note               TEXT,
  status             TEXT    NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'under_review', 'more_info', 'preparing', 'quotation_ready', 'with_client', 'revision_requested', 'acceptance_pending', 'won', 'not_proceeding')),
  assigned_to        INTEGER,
  quotation_id       INTEGER,
  published_doc_id   INTEGER,
  published_revision INTEGER,
  published_at       TEXT,
  published_by       INTEGER,
  next_follow_up_on  TEXT,
  manager_note       TEXT,
  client_key         TEXT,
  last_event_at      TEXT,
  last_event_by      INTEGER,
  last_event_text    TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  submitted_at       TEXT,
  updated_at         TEXT,
  updated_by         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_requests_agent ON agent_requests (agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_requests_status ON agent_requests (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_requests_key ON agent_requests (agent_id, client_key) WHERE client_key IS NOT NULL;
-- agent_request_events: the request timeline, append-only. kind names what
-- happened (submitted, update, comment, status, assign, published, shared,
-- sent, feedback, file, quotation). visibility agent is shown to the agent
-- who owns the request, internal never is. A correction is a new row that
-- points at the old one with corrects_id.
CREATE TABLE IF NOT EXISTS agent_request_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      INTEGER NOT NULL,
  actor_id        INTEGER,
  kind            TEXT    NOT NULL,
  visibility      TEXT    NOT NULL DEFAULT 'internal' CHECK (visibility IN ('agent', 'internal')),
  body            TEXT,
  client_feedback TEXT,
  blockers        TEXT,
  next_action     TEXT,
  follow_up_on    TEXT,
  status_from     TEXT,
  status_to       TEXT,
  channel         TEXT,
  corrects_id     INTEGER,
  client_key      TEXT,
  detail          TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_request_events_req ON agent_request_events (request_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_request_events_key ON agent_request_events (actor_id, client_key) WHERE client_key IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS agent_request_events_no_update BEFORE UPDATE ON agent_request_events
BEGIN SELECT RAISE(ABORT, 'request history is kept as it was'); END;
CREATE TRIGGER IF NOT EXISTS agent_request_events_no_delete BEFORE DELETE ON agent_request_events
BEGIN SELECT RAISE(ABORT, 'request history is kept as it was'); END;
-- agent_request_files: files on a request, stored the same way as task files
-- (private R2 plus a media row). visibility as for events.
CREATE TABLE IF NOT EXISTS agent_request_files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL,
  event_id     INTEGER,
  media_id     INTEGER NOT NULL,
  uploader_id  INTEGER NOT NULL,
  file_name    TEXT    NOT NULL,
  content_type TEXT,
  size_bytes   INTEGER,
  visibility   TEXT    NOT NULL DEFAULT 'internal' CHECK (visibility IN ('agent', 'internal')),
  client_key   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_request_files_req ON agent_request_files (request_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_request_files_key ON agent_request_files (uploader_id, client_key) WHERE client_key IS NOT NULL;
