-- 0221 - DIGITAL CARD RULES (the CEO 20-11-2026, Digital Cards programme Stage 2, plan in the
-- Stage 0 audit, decisions D1-D9). The rules every digital card template is checked against.
--   card_formats         - a design canvas: width x height in pixels, safe margins, accepted
--                          file types, the per-page size limit. Screen cards: DPI is NOT a rule.
--   card_category_rules  - the page count of a category (1-10) and its suggested pages, each
--                          required or optional. The first page is always the Cover, always required.
--   card_rule_history    - every saved version of a rule with the reason and who saved it.
--                          Append-only: a step is never edited or deleted (the 0219 pattern).
-- Values are seeded as the approved starting rules (D9) and are edited in the portal
-- (Digital Cards then Card Rules) by card_format_admin. The worker validates every save.
-- Templates are NOT here - they come in a later stage and will reference a format by id.
-- ADDITIVE ONLY: three new tables, their indexes, triggers and seed rows.

CREATE TABLE IF NOT EXISTS card_formats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ms TEXT,
  width_px INTEGER NOT NULL CHECK (width_px BETWEEN 320 AND 6000),
  height_px INTEGER NOT NULL CHECK (height_px BETWEEN 320 AND 6000),
  margin_top INTEGER NOT NULL DEFAULT 0 CHECK (margin_top >= 0),
  margin_right INTEGER NOT NULL DEFAULT 0 CHECK (margin_right >= 0),
  margin_bottom INTEGER NOT NULL DEFAULT 0 CHECK (margin_bottom >= 0),
  margin_left INTEGER NOT NULL DEFAULT 0 CHECK (margin_left >= 0),
  accepted_types TEXT NOT NULL DEFAULT '["image/png","image/jpeg"]',
  max_bytes INTEGER NOT NULL CHECK (max_bytes BETWEEN 102400 AND 26214400),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (margin_left + margin_right < width_px AND margin_top + margin_bottom < height_px)
);

CREATE TABLE IF NOT EXISTS card_category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ms TEXT,
  min_pages INTEGER NOT NULL CHECK (min_pages BETWEEN 1 AND 10),
  max_pages INTEGER NOT NULL CHECK (max_pages BETWEEN 1 AND 10),
  pages_json TEXT NOT NULL,
  allow_reorder INTEGER NOT NULL DEFAULT 0 CHECK (allow_reorder IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (min_pages <= max_pages)
);

CREATE TABLE IF NOT EXISTS card_rule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('format', 'category')),
  entity_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity, entity_id, version)
);
CREATE INDEX IF NOT EXISTS ix_card_rule_history_entity ON card_rule_history (entity, entity_id, id);
CREATE TRIGGER IF NOT EXISTS card_rule_history_no_update BEFORE UPDATE ON card_rule_history
BEGIN SELECT RAISE(ABORT, 'A rule history step is never edited'); END;
CREATE TRIGGER IF NOT EXISTS card_rule_history_no_delete BEFORE DELETE ON card_rule_history
BEGIN SELECT RAISE(ABORT, 'A rule history step is never deleted'); END;

-- The approved starting rules (D9) - 40 px safe margin on every side, 10 MB a page, PNG or JPG.
INSERT OR IGNORE INTO card_formats (code, name, name_ms, width_px, height_px, margin_top, margin_right, margin_bottom, margin_left, max_bytes, sort)
VALUES
  ('portrait', 'Portrait', 'Potret', 1080, 1920, 40, 40, 40, 40, 10485760, 1),
  ('landscape', 'Landscape', 'Landskap', 1920, 1080, 40, 40, 40, 40, 10485760, 2),
  ('square', 'Square', 'Segi empat sama', 1080, 1080, 40, 40, 40, 40, 10485760, 3);

-- Pages per category - 1 to 10, the Cover always first and required (D9).
INSERT OR IGNORE INTO card_category_rules (code, name, name_ms, min_pages, max_pages, pages_json, allow_reorder, sort)
VALUES
  ('wedding', 'Wedding', 'Perkahwinan', 2, 10, '[{"title":"Cover","title_ms":"Muka depan","required":true},{"title":"Event Details","title_ms":"Butiran majlis","required":true},{"title":"RSVP / Map","title_ms":"RSVP / Peta","required":false}]', 1, 1),
  ('engagement', 'Engagement', 'Pertunangan', 1, 10, '[{"title":"Cover","title_ms":"Muka depan","required":true},{"title":"Event Details","title_ms":"Butiran majlis","required":false}]', 1, 2),
  ('birthday', 'Birthday', 'Hari jadi', 1, 10, '[{"title":"Cover","title_ms":"Muka depan","required":true},{"title":"Event Details","title_ms":"Butiran majlis","required":false}]', 1, 3),
  ('aqiqah', 'Aqiqah', 'Akikah', 1, 10, '[{"title":"Cover","title_ms":"Muka depan","required":true},{"title":"Event Details","title_ms":"Butiran majlis","required":false}]', 1, 4),
  ('graduation', 'Graduation', 'Konvokesyen', 1, 10, '[{"title":"Cover","title_ms":"Muka depan","required":true},{"title":"Event Details","title_ms":"Butiran majlis","required":false}]', 1, 5),
  ('event', 'Event', 'Acara', 1, 10, '[{"title":"Cover","title_ms":"Muka depan","required":true},{"title":"Event Details","title_ms":"Butiran majlis","required":false}]', 1, 6),
  ('corporate', 'Corporate', 'Korporat', 1, 10, '[{"title":"Cover","title_ms":"Muka depan","required":true},{"title":"Programme","title_ms":"Atur cara","required":false}]', 1, 7);
