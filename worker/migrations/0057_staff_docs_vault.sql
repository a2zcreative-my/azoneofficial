-- 0057: Staff document vault + onboarding checklist + system meta (v1.4.191)
-- Contracts, offer letters, resignation letters get a home in R2 with an
-- index here. onboarding_json holds the per-staff checklist state.
CREATE TABLE IF NOT EXISTS staff_documents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',  -- contract / offer_letter / resignation / other
  label TEXT,
  r2_key TEXT NOT NULL,
  filename TEXT,
  size INTEGER,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_documents_user ON staff_documents(user_id);
ALTER TABLE users ADD COLUMN onboarding_json TEXT;
-- Simple key/value for system bookkeeping (e.g. last off-site backup export).
CREATE TABLE IF NOT EXISTS system_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
