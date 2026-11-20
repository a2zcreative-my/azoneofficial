-- 0222 - DIGITAL CARD TEMPLATES (the CEO 20-11-2026, Digital Cards programme Stage 3).
-- The template master record kept by A2Z OS - the one source of every template design.
--   card_templates        - one row per template - its information, category and format, who
--                           designed it and where it stands - draft, in review, returned,
--                           published, unpublished or archived. Pages, zones, versions and the
--                           review steps arrive in later stages beside this row.
--   card_template_events  - what happened to a template and who did it. Append-only - a step
--                           is never edited or deleted (the 0219 pattern). The kinds are
--                           checked by the worker so later stages add theirs without a rebuild.
-- A template is never deleted. A draft its designer no longer wants is archived.
-- packages = the AZ ONE packages the design is offered under (silver, gold, diamond, D2).
-- ADDITIVE ONLY: two new tables, their indexes and triggers.

CREATE TABLE IF NOT EXISTS card_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER NOT NULL REFERENCES card_category_rules(id),
  format_id INTEGER NOT NULL REFERENCES card_formats(id),
  language TEXT NOT NULL DEFAULT 'both' CHECK (language IN ('en', 'ms', 'both')),
  packages TEXT NOT NULL DEFAULT '["silver","gold","diamond"]',
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'in_review', 'returned', 'published', 'unpublished', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  designer_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);
CREATE INDEX IF NOT EXISTS ix_card_templates_state ON card_templates (state, updated_at);
CREATE INDEX IF NOT EXISTS ix_card_templates_designer ON card_templates (designer_id, state);

CREATE TABLE IF NOT EXISTS card_template_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES card_templates(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  actor_id INTEGER,
  note TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_card_template_events_template ON card_template_events (template_id, id);
CREATE TRIGGER IF NOT EXISTS card_template_events_no_update BEFORE UPDATE ON card_template_events
BEGIN SELECT RAISE(ABORT, 'A template event is never edited'); END;
CREATE TRIGGER IF NOT EXISTS card_template_events_no_delete BEFORE DELETE ON card_template_events
BEGIN SELECT RAISE(ABORT, 'A template event is never deleted'); END;
CREATE TRIGGER IF NOT EXISTS card_templates_no_delete BEFORE DELETE ON card_templates
BEGIN SELECT RAISE(ABORT, 'A template is never deleted - archive it'); END;
