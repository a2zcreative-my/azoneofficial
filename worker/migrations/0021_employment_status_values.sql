-- 0021: Employment status values (v1.4.46)
--
-- v1.4.43 introduced permanent / contract / part_time in the UI, but the
-- users table still carried the original CHECK
-- ('active','probation','resigned','terminated') — every save of the new
-- values failed with a constraint error ("Something went wrong").
-- SQLite cannot alter a CHECK, so the table is rebuilt (same dance as 0009),
-- keeping every column added since: id_issued_on/blood_type (0010),
-- full_name (0012), photo_key (0013), totp_secret/enabled (0018),
-- bank_name/bank_account/joined_on (0019).

CREATE TABLE users_new5 (
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
  employment_status TEXT NOT NULL DEFAULT 'permanent'
    CHECK (employment_status IN (
      'permanent','contract','part_time',
      'active','probation','resigned','terminated'
    )),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  birthday TEXT,
  id_issued_on TEXT,
  blood_type TEXT,
  full_name TEXT,
  photo_key TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  bank_name TEXT,
  bank_account TEXT,
  joined_on TEXT
);

INSERT INTO users_new5 (
  id, email, password_hash, name, role, is_active, employee_id, position,
  department, phone, photo_media_id, employment_status, created_at, birthday,
  id_issued_on, blood_type, full_name, photo_key, totp_secret, totp_enabled,
  bank_name, bank_account, joined_on
)
SELECT
  id, email, password_hash, name, role, is_active, employee_id, position,
  department, phone, photo_media_id, employment_status, created_at, birthday,
  id_issued_on, blood_type, full_name, photo_key, totp_secret, totp_enabled,
  bank_name, bank_account, joined_on
FROM users;

PRAGMA defer_foreign_keys = TRUE;
PRAGMA legacy_alter_table = ON;

ALTER TABLE users RENAME TO _users_old;
ALTER TABLE users_new5 RENAME TO users;
-- DROP TABLE _users_old; -- Retained to avoid D1/SQLite FK constraint bugs on DROP

-- Current staff default to 'permanent' (legacy 'active' said only "employed").
-- probation/resigned/terminated are left untouched.
UPDATE users SET employment_status = 'permanent' WHERE employment_status = 'active';
