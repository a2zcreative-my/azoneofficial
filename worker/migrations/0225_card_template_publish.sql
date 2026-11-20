-- 0225 - DIGITAL CARD REVIEW, PUBLISHING AND THE AZ ONE FEED (the CEO 21-11-2026, Digital Cards Stage 6).
-- Designer submits -> the COO or CCO pre-checks -> the CEO or the super admin publishes.
--   card_template_versions - what was submitted, frozen. version_no counts submissions of one template
--                            1, 2, 3 and so on. manifest_json is the whole design at that moment - the
--                            information, format, pages with their SHA-256 and fields - and
--                            content_hash is the SHA-256 of the manifest AZ ONE receives. Never
--                            edited, never deleted - a customer card stays on the version it was made from.
--   card_template_sync     - what A2Z OS has told AZ ONE - one row per publish or unpublish, in order.
--                            AZ ONE reads them with its cursor through the signed feed, then reports back.
--                            status - pending until AZ ONE reads it, sent once read, imported or failed
--                            only when AZ ONE says so. A retry is a new row naming the one it repeats.
--   card_templates.review_version_no, prechecked_by, prechecked_at - the version under review and
--                            who pre-checked it.
-- ADDITIVE ONLY: two new tables with their indexes and triggers, and three nullable columns.

CREATE TABLE IF NOT EXISTS card_template_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES card_templates(id),
  version_no INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_card_template_versions ON card_template_versions (template_id, version_no);
CREATE TRIGGER IF NOT EXISTS card_template_versions_no_update BEFORE UPDATE ON card_template_versions
BEGIN SELECT RAISE(ABORT, 'A submitted version is never edited'); END;
CREATE TRIGGER IF NOT EXISTS card_template_versions_no_delete BEFORE DELETE ON card_template_versions
BEGIN SELECT RAISE(ABORT, 'A submitted version is never deleted'); END;

CREATE TABLE IF NOT EXISTS card_template_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES card_templates(id),
  code TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish', 'unpublish')),
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'imported', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  retry_of INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  acked_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_card_template_sync_template ON card_template_sync (template_id, id);
CREATE TRIGGER IF NOT EXISTS card_template_sync_no_delete BEFORE DELETE ON card_template_sync
BEGIN SELECT RAISE(ABORT, 'A sync record is never deleted'); END;

ALTER TABLE card_templates ADD COLUMN review_version_no INTEGER;
ALTER TABLE card_templates ADD COLUMN prechecked_by INTEGER;
ALTER TABLE card_templates ADD COLUMN prechecked_at TEXT;
