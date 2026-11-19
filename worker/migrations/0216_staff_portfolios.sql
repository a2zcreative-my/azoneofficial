-- 0216 - STAFF PORTFOLIOS (v1.389.0, the CEO 19-11-2026: the Staff Portfolio Card Generator).
-- One portfolio per staff member, kept beside the staff record and never instead of it:
-- the name, position, department, photo and responsibilities are read from users at the
-- moment they are shown, so a change on the staff record reaches the card and the page.
-- What the portfolio adds is only what the staff record does not hold: a tagline, an
-- introduction, specialties, contact details the CEO has approved for the public, and the
-- work (project images and videos). The responsibilities shown are the ones ticked Public
-- on the list of that person (staff_responsibilities, 0215), read live - never copied here.
-- Draft -> Published -> Unpublished. Publishing freezes what the public may see
-- in published_json, and later draft edits stay private until the next publish.
-- The address /portfolio/<slug> never changes once published, so a printed QR keeps working.
-- ADDITIVE ONLY: two new tables, their indexes and triggers.
CREATE TABLE IF NOT EXISTS staff_portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'unpublished')),
  template TEXT NOT NULL DEFAULT 'navy',
  tagline TEXT,
  intro TEXT,
  specialties TEXT,
  expertise TEXT,
  experience TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  show_email INTEGER NOT NULL DEFAULT 0,
  show_phone INTEGER NOT NULL DEFAULT 0,
  socials TEXT,
  portrait_key TEXT,
  portrait_source_key TEXT,
  photo_crop TEXT,
  published_json TEXT,
  published_at TEXT,
  published_by INTEGER,
  published_version INTEGER,
  unpublished_at TEXT,
  unpublished_by INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_portfolios_user ON staff_portfolios (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_portfolios_slug ON staff_portfolios (slug COLLATE NOCASE);
CREATE TRIGGER IF NOT EXISTS staff_portfolios_no_delete BEFORE DELETE ON staff_portfolios
BEGIN SELECT RAISE(ABORT, 'A portfolio is unpublished, never deleted'); END;
-- the work shown on a portfolio: a project image or a video, with its words
CREATE TABLE IF NOT EXISTS staff_portfolio_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  title TEXT NOT NULL,
  description TEXT,
  media_key TEXT,
  media_type TEXT,
  video_url TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  removed_at TEXT,
  removed_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_staff_portfolio_items_portfolio ON staff_portfolio_items (portfolio_id, sort_order, id);
CREATE TRIGGER IF NOT EXISTS staff_portfolio_items_no_delete BEFORE DELETE ON staff_portfolio_items
BEGIN SELECT RAISE(ABORT, 'A portfolio item is removed, never deleted'); END;
