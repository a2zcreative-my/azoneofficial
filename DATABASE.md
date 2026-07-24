# Database

**Provisioned:** Cloudflare D1 `azoneofficial` — id `d9df2d7a-8303-4396-a4ee-a26836a4c9a8`. Media bucket: R2 `azoneofficial`.
Migration `worker/migrations/0001_init.sql` implements the schema below. Apply with `pnpm migrate:prod` from `/worker`.

Target: **Cloudflare D1 (SQLite)**. Media binaries in **R2**, referenced by key.

## Schema draft v1

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- argon2id
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','editor','marketing')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                  -- random 256-bit token id
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE site_content (             -- editable website content
  key TEXT PRIMARY KEY,                 -- e.g. 'home.hero.headline'
  value TEXT NOT NULL,                  -- JSON
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  price_cents INTEGER,                  -- MYR cents; NULL = "announced live"
  inventory INTEGER,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  seo_title TEXT, seo_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  r2_key TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','document','logo')),
  alt TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_media (
  product_id INTEGER NOT NULL REFERENCES products(id),
  media_id INTEGER NOT NULL REFERENCES media(id),
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, media_id)
);

CREATE TABLE portfolio_items (
  id INTEGER PRIMARY KEY,
  client TEXT NOT NULL,
  summary TEXT, result TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE posts (                    -- blog
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published')),
  publish_at TEXT,
  category TEXT, tags TEXT,             -- tags: JSON array
  featured_media_id INTEGER REFERENCES media(id),
  seo_title TEXT, seo_description TEXT,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE testimonials (
  id INTEGER PRIMARY KEY,
  author TEXT NOT NULL, company TEXT, position TEXT,
  review TEXT NOT NULL, rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  photo_media_id INTEGER REFERENCES media(id),
  is_published INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE enquiries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','closed')),
  assigned_to INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,                 -- e.g. 'product.update'
  entity TEXT, entity_id TEXT,
  detail TEXT,                          -- JSON diff
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Migration policy
- Numbered SQL migrations in `/migrations`, applied via `wrangler d1 migrations`
- Every schema change documented here + CHANGELOG.md
