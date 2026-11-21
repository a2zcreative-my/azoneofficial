-- 0230 - THE SALES PLAYBOOK (the CEO 21-11-2026, Sales Command Center Phase 7, his answer As recommended on
-- the nine Phase 7 decisions, worker/src/playbook.ts and lib/playbook.ts).
--   playbook_entries  - one row per entry. The draft column is the working copy the CEO, COO and CCO edit. Staff
--                       read only the PUBLISHED version named by published_version. An entry is never deleted - it
--                       is archived with a reason.
--   playbook_versions - every published version, written once and never edited or deleted (triggers). Bringing
--                       an old version back copies it into the draft, and it is published again as a new version.
--   playbook_files    - SOP and Templates attachments (private, MEDIA private/playbook/). A file belongs to the
--                       versions that list it. It is never deleted, so an old version keeps its files.
-- No price column anywhere: prices come only from the Packages library (decision 3).
-- ADDITIVE ONLY: three new tables and their triggers. No existing row is changed.
CREATE TABLE IF NOT EXISTS playbook_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL CHECK (section IN ('quick', 'product', 'scripts', 'objections', 'training', 'discovery', 'proposal', 'closing', 'practices', 'sop')),
  kind TEXT NOT NULL CHECK (kind IN ('guide', 'script', 'objection', 'questions', 'checklist')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  draft TEXT NOT NULL,
  draft_files TEXT NOT NULL DEFAULT '[]',
  has_draft INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  archived_by INTEGER,
  archive_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_playbook_section ON playbook_entries (section, status, sort);

CREATE TABLE IF NOT EXISTS playbook_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES playbook_entries(id),
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL,
  restored_from INTEGER,
  published_by INTEGER NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_id, version)
);

CREATE TABLE IF NOT EXISTS playbook_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES playbook_entries(id),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER,
  uploaded_by INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_playbook_files_entry ON playbook_files (entry_id);

CREATE TRIGGER IF NOT EXISTS playbook_versions_no_update BEFORE UPDATE ON playbook_versions
BEGIN SELECT RAISE(ABORT, 'a published playbook version is never changed'); END;
CREATE TRIGGER IF NOT EXISTS playbook_versions_no_delete BEFORE DELETE ON playbook_versions
BEGIN SELECT RAISE(ABORT, 'a published playbook version is never deleted'); END;
CREATE TRIGGER IF NOT EXISTS playbook_entries_no_delete BEFORE DELETE ON playbook_entries
BEGIN SELECT RAISE(ABORT, 'a playbook entry is archived, never deleted'); END;
CREATE TRIGGER IF NOT EXISTS playbook_files_no_delete BEFORE DELETE ON playbook_files
BEGIN SELECT RAISE(ABORT, 'a playbook file is kept for the versions that list it'); END;
CREATE TRIGGER IF NOT EXISTS playbook_files_no_update BEFORE UPDATE ON playbook_files
BEGIN SELECT RAISE(ABORT, 'a playbook file is written once'); END;
