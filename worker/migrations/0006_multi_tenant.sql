-- 0006: Multi-tenant CMS (v1.3.0)
--
-- One Worker and one D1 database now serve several client sites. Every piece
-- of editable content carries a `site` key so azoneofficial.com and
-- elfia.com.my cannot read or overwrite each other's content.
--
-- Existing rows are backfilled to 'azoneofficial' — nothing is lost, and the
-- agency site behaves exactly as before.

ALTER TABLE site_content ADD COLUMN site TEXT NOT NULL DEFAULT 'azoneofficial';
ALTER TABLE portfolio_items ADD COLUMN site TEXT NOT NULL DEFAULT 'azoneofficial';
ALTER TABLE posts ADD COLUMN site TEXT NOT NULL DEFAULT 'azoneofficial';
ALTER TABLE testimonials ADD COLUMN site TEXT NOT NULL DEFAULT 'azoneofficial';
ALTER TABLE enquiries ADD COLUMN site TEXT NOT NULL DEFAULT 'azoneofficial';
ALTER TABLE products ADD COLUMN site TEXT NOT NULL DEFAULT 'elfia';

-- site_content was keyed by `key` alone; it must now be unique per (site, key).
CREATE TABLE site_content_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL DEFAULT 'azoneofficial',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site, key)
);

INSERT INTO site_content_new (site, key, value, updated_by, updated_at)
  SELECT site, key, value, updated_by, updated_at FROM site_content;

DROP TABLE site_content;
ALTER TABLE site_content_new RENAME TO site_content;

CREATE INDEX IF NOT EXISTS idx_site_content_site ON site_content (site);
CREATE INDEX IF NOT EXISTS idx_portfolio_site ON portfolio_items (site);
CREATE INDEX IF NOT EXISTS idx_posts_site ON posts (site);
CREATE INDEX IF NOT EXISTS idx_testimonials_site ON testimonials (site);
CREATE INDEX IF NOT EXISTS idx_enquiries_site ON enquiries (site);
CREATE INDEX IF NOT EXISTS idx_products_site ON products (site);

-- Seed the statistics key so editors have somewhere to publish real figures.
-- Empty array = the site shows qualitative trust signals instead of zeroes.
INSERT OR IGNORE INTO site_content (site, key, value)
  VALUES ('azoneofficial', 'stats.items', '[]');
