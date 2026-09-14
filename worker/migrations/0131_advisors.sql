-- 0131 - the Advisors desks (v1.160.0). Five AI desks that advise and never
-- decide - see worker/src/advisors.ts. Proposals wait for the CEO and every
-- model call is written down with its tokens so the tab can show the spend.

CREATE TABLE IF NOT EXISTS ai_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id            INTEGER PRIMARY KEY,
  desk          TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  requested_by  INTEGER REFERENCES users(id),
  model         TEXT,
  status        TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  neurons       INTEGER NOT NULL DEFAULT 0,
  proposals     INTEGER NOT NULL DEFAULT 0,
  digest_hash   TEXT,
  note          TEXT,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_desk ON ai_runs (desk, id);

CREATE TABLE IF NOT EXISTS ai_proposals (
  id             INTEGER PRIMARY KEY,
  desk           TEXT NOT NULL,
  run_id         INTEGER REFERENCES ai_runs(id),
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  why            TEXT NOT NULL,
  plan           TEXT NOT NULL DEFAULT '[]',
  evidence       TEXT NOT NULL DEFAULT '[]',
  owner_hint     TEXT,
  expected       TEXT,
  measure        TEXT,
  priority       TEXT NOT NULL DEFAULT 'normal',
  status         TEXT NOT NULL DEFAULT 'proposed',
  draft          TEXT,
  triage         TEXT,
  entity         TEXT,
  entity_id      TEXT,
  fingerprint    TEXT NOT NULL,
  decision_note  TEXT,
  decided_by     INTEGER REFERENCES users(id),
  decided_at     TEXT,
  task_id        INTEGER,
  assigned_to    INTEGER,
  implemented_at TEXT,
  verify         TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_status ON ai_proposals (status, id);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_fp ON ai_proposals (fingerprint, id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id          INTEGER PRIMARY KEY,
  proposal_id INTEGER NOT NULL REFERENCES ai_proposals(id),
  from_desk   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'comment',
  body        TEXT NOT NULL,
  run_id      INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_lessons (
  id          INTEGER PRIMARY KEY,
  desk        TEXT NOT NULL,
  proposal_id INTEGER,
  lesson      TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
