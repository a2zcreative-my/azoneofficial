-- 0009: Role model cleanup (v1.4.14)
--
-- The role set was reduced to: super_admin, admin, editor, marketing,
-- live_host, hr_admin, sales_marketing, ceo, coo, cco, customer.
-- Removed: managing_director, business_dev, finance_admin, live_manager.
--
-- SAFETY: any existing account still on a removed role is reassigned to a
-- sensible neighbour so no one is left on a role the app no longer knows.
-- Adjust individually afterwards in /admin -> Users if these defaults are not
-- right for a specific person.
--   managing_director -> admin        (closest authority level)
--   business_dev      -> cco          (business development now lives with CCO)
--   finance_admin     -> hr_admin     (documentation/finance duties)
--   live_manager      -> live_host    (live operations)
UPDATE users SET role = 'admin'     WHERE role = 'managing_director';
UPDATE users SET role = 'cco'       WHERE role = 'business_dev';
UPDATE users SET role = 'hr_admin'  WHERE role = 'finance_admin';
UPDATE users SET role = 'live_host' WHERE role = 'live_manager';

-- Rebuild the CHECK constraint to the final role set (SQLite can't alter it).
CREATE TABLE users_new4 (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'super_admin','admin',
    'editor','marketing','live_host',
    'hr_admin','sales_marketing',
    'ceo','coo','cco',
    'customer'
  )),
  is_active INTEGER NOT NULL DEFAULT 1,
  employee_id TEXT,
  position TEXT,
  department TEXT,
  phone TEXT,
  photo_media_id INTEGER REFERENCES media(id),
  employment_status TEXT NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('active','probation','resigned','terminated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  birthday TEXT
);
INSERT INTO users_new4 SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new4 RENAME TO users;
