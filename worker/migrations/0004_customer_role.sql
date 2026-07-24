-- Add 'customer' role for public account holders (general login system)
CREATE TABLE users_new2 (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'super_admin','admin','editor','marketing',
    'managing_director','coo','business_dev','finance_admin','live_manager','live_host',
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_new2 SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new2 RENAME TO users;
