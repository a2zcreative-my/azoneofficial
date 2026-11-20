-- 0223 - DIGITAL CARD TEMPLATE PAGES (the CEO 21-11-2026, Digital Cards programme Stage 4).
-- The template editor - Template Info, Design Specs and Upload Pages - saved on the server at
-- every step, so a draft survives a refresh, another device or a closed tab.
--   card_template_pages   - the planned pages of a template in their order. The plan starts
--                           from the category rule - the Cover first and always required. A page
--                           holds its uploaded artwork once the server has checked it - the real
--                           type, the exact canvas size, the size limit and the SHA-256 of the
--                           bytes. The files are private, under private/card-templates/ in MEDIA.
--   card_templates.step   - the step of the editor the designer reached.
--   card_templates.specs_key and specs_confirmed_at - the format and category rule versions the
--                           designer confirmed on Design Specs. A rule changed since then means
--                           the designer confirms the specs again.
-- A page is planned, renamed, moved or removed only while its template is a draft or returned -
-- the triggers hold that whatever calls the database.
-- ADDITIVE ONLY: one new table with its index and triggers, and three nullable or defaulted
-- columns on card_templates.

CREATE TABLE IF NOT EXISTS card_template_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES card_templates(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 10),
  title TEXT NOT NULL,
  title_ms TEXT,
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  r2_key TEXT,
  mime TEXT,
  width_px INTEGER,
  height_px INTEGER,
  bytes INTEGER,
  sha256 TEXT,
  file_name TEXT,
  uploaded_by INTEGER,
  uploaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_card_template_pages_template ON card_template_pages (template_id, position);

CREATE TRIGGER IF NOT EXISTS card_template_pages_locked_update BEFORE UPDATE ON card_template_pages
WHEN (SELECT state FROM card_templates WHERE id = OLD.template_id) NOT IN ('draft', 'returned')
BEGIN SELECT RAISE(ABORT, 'Pages change only while the template is a draft or returned'); END;
CREATE TRIGGER IF NOT EXISTS card_template_pages_locked_delete BEFORE DELETE ON card_template_pages
WHEN (SELECT state FROM card_templates WHERE id = OLD.template_id) NOT IN ('draft', 'returned')
BEGIN SELECT RAISE(ABORT, 'Pages change only while the template is a draft or returned'); END;
CREATE TRIGGER IF NOT EXISTS card_template_pages_locked_insert BEFORE INSERT ON card_template_pages
WHEN (SELECT state FROM card_templates WHERE id = NEW.template_id) NOT IN ('draft', 'returned')
BEGIN SELECT RAISE(ABORT, 'Pages change only while the template is a draft or returned'); END;

ALTER TABLE card_templates ADD COLUMN step INTEGER NOT NULL DEFAULT 1;
ALTER TABLE card_templates ADD COLUMN specs_key TEXT;
ALTER TABLE card_templates ADD COLUMN specs_confirmed_at TEXT;
