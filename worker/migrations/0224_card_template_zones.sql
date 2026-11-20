-- 0224 - DIGITAL CARD EDITABLE CONTENT (the CEO 21-11-2026, Digital Cards programme Stage 5).
-- The fields a customer fills in on a card - names, dates, venue, a photo - placed on a page of a
-- template in canvas pixels, with the font, size, colour and alignment they are drawn in and the
-- sample shown until the customer types. The artwork never holds the customer text - these do.
--   card_template_zones  - one row per field. key names the value on a customer card and is
--                          unique in its template. A field sits inside the safe area of the format
--                          - the worker checks it with lib/card-templates.ts checkZones.
-- Fields change only while their template is a draft or returned - the triggers hold that
-- whatever calls the database.
-- ADDITIVE ONLY: one new table with its indexes and triggers.

CREATE TABLE IF NOT EXISTS card_template_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES card_templates(id),
  page_id INTEGER NOT NULL REFERENCES card_template_pages(id),
  sort INTEGER NOT NULL DEFAULT 0,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'multiline', 'date', 'image')),
  label TEXT NOT NULL,
  label_ms TEXT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  font TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 400,
  size INTEGER NOT NULL,
  colour TEXT NOT NULL,
  align TEXT NOT NULL DEFAULT 'center' CHECK (align IN ('left', 'center', 'right')),
  max_chars INTEGER NOT NULL,
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  sample TEXT NOT NULL DEFAULT '',
  sample_ms TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_card_template_zones_key ON card_template_zones (template_id, key);
CREATE INDEX IF NOT EXISTS ix_card_template_zones_page ON card_template_zones (page_id, sort);

CREATE TRIGGER IF NOT EXISTS card_template_zones_locked_update BEFORE UPDATE ON card_template_zones
WHEN (SELECT state FROM card_templates WHERE id = OLD.template_id) NOT IN ('draft', 'returned')
BEGIN SELECT RAISE(ABORT, 'Fields change only while the template is a draft or returned'); END;
CREATE TRIGGER IF NOT EXISTS card_template_zones_locked_delete BEFORE DELETE ON card_template_zones
WHEN (SELECT state FROM card_templates WHERE id = OLD.template_id) NOT IN ('draft', 'returned')
BEGIN SELECT RAISE(ABORT, 'Fields change only while the template is a draft or returned'); END;
CREATE TRIGGER IF NOT EXISTS card_template_zones_locked_insert BEFORE INSERT ON card_template_zones
WHEN (SELECT state FROM card_templates WHERE id = NEW.template_id) NOT IN ('draft', 'returned')
BEGIN SELECT RAISE(ABORT, 'Fields change only while the template is a draft or returned'); END;
