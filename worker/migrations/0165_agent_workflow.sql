-- 0165 - The agent portal workflow, release 1.250.1.
-- The owner approved the agent portal brief on 01-11-2026 (release 1.250.0,
-- claude/AGENT-PORTAL-AUDIT.md). Release 1.250.0 put these tables into 0164,
-- but the live database had already applied 0164 with release 1.249.0, so
-- they never reached it. 0164 is back to exactly what the live database ran
-- and this migration upgrades the 1.249.0 tables in place. Every request and
-- every history row is kept.
-- agent_requests is rebuilt because SQLite cannot widen a CHECK. Nothing
-- points at it with a foreign key. The five old statuses map to the new ones
-- new to submitted, contacted to under_review, quoted to preparing (nothing
-- was ever published to an agent), won to won and lost to not_proceeding.
-- agent_request_events gains its new columns, the old rows read internal.
-- agent_request_files is new. sales_documents and customers are not changed.
CREATE TABLE agent_requests_new (
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
INSERT INTO agent_requests_new (id, agent_id, client_name, client_phone, client_email, company, package_id, package_version, note, status, assigned_to, quotation_id, manager_note, last_event_at, last_event_by, created_at, submitted_at, updated_at, updated_by)
SELECT id, agent_id, client_name, client_phone, client_email, company, package_id, package_version, note,
       CASE status WHEN 'new' THEN 'submitted' WHEN 'contacted' THEN 'under_review' WHEN 'quoted' THEN 'preparing' WHEN 'won' THEN 'won' WHEN 'lost' THEN 'not_proceeding' ELSE 'submitted' END,
       assigned_to, quotation_id, manager_note, COALESCE(updated_at, created_at), COALESCE(updated_by, agent_id), created_at, created_at, updated_at, updated_by
  FROM agent_requests;
DROP TABLE agent_requests;
ALTER TABLE agent_requests_new RENAME TO agent_requests;
CREATE INDEX IF NOT EXISTS idx_agent_requests_agent ON agent_requests (agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_requests_status ON agent_requests (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_requests_key ON agent_requests (agent_id, client_key) WHERE client_key IS NOT NULL;
ALTER TABLE agent_request_events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('agent', 'internal'));
ALTER TABLE agent_request_events ADD COLUMN body TEXT;
ALTER TABLE agent_request_events ADD COLUMN client_feedback TEXT;
ALTER TABLE agent_request_events ADD COLUMN blockers TEXT;
ALTER TABLE agent_request_events ADD COLUMN next_action TEXT;
ALTER TABLE agent_request_events ADD COLUMN follow_up_on TEXT;
ALTER TABLE agent_request_events ADD COLUMN status_from TEXT;
ALTER TABLE agent_request_events ADD COLUMN status_to TEXT;
ALTER TABLE agent_request_events ADD COLUMN channel TEXT;
ALTER TABLE agent_request_events ADD COLUMN corrects_id INTEGER;
ALTER TABLE agent_request_events ADD COLUMN client_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_request_events_key ON agent_request_events (actor_id, client_key) WHERE client_key IS NOT NULL;
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
