-- 0209 - ROLES V2, STAGE 3 (docs/ROLES-V2-PLAN.md), release 1.358.0.
-- The CEO, 17-11-2026, R-3: a role he makes is given to people, and their
-- claims go to their manager on the Organisation chart, then the CEO.
-- 1. users.role loses its fixed list of twelve names. A role must instead be
--    a row of the roles table (0208), checked by two triggers - so a role the
--    owner makes can be held, and a name nobody made still cannot.
--    SQLite cannot drop a CHECK, so users is rebuilt the way 0164 did it and
--    Cloudflare D1 documents for a table others point at: foreign keys
--    deferred, a new table with EVERY current column in the same order (45,
--    after 0177 and 0205), a copy of every row, the old table dropped and the
--    new one renamed to users (every pointer to users then finds the same
--    ids), the four indexes recreated, deferral off. No ON DELETE action
--    points at users, so dropping it deletes nothing else. PUSH.bat takes the
--    database backup before any migration runs.
-- 2. claims.line_approver_id - the manager who pre-approves a claim by
--    someone on an own role, fixed when the claim is made (additive).
PRAGMA defer_foreign_keys = true;
-- The 0208 trigger roles_keep_held names users. While users is swapped it would
-- point at nothing and the rename refuses, so it is dropped here and made again
-- below, unchanged.
DROP TRIGGER IF EXISTS roles_keep_held;
CREATE TABLE users_new9 (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
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
  joined_on TEXT,
  ic_number TEXT,
  base_salary_cents INTEGER NOT NULL DEFAULT 0,
  left_on TEXT,
  rejoined_on TEXT,
  onboarding_json TEXT,
  address TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  emergency_relation TEXT,
  epf_no TEXT,
  socso_no TEXT,
  tax_no TEXT,
  totp_last_step INTEGER,
  reports_to INTEGER REFERENCES users(id),
  role_title TEXT,
  responsibilities TEXT,
  responsibilities_updated_at TEXT,
  responsibilities_updated_by INTEGER,
  google_sub TEXT,
  email_verified_at TEXT,
  recovery_rotation_required INTEGER,
  custom_role_id INTEGER REFERENCES custom_roles (id)
);
INSERT INTO users_new9 (
  id, email, password_hash, name, role, is_active, employee_id, position,
  department, phone, photo_media_id, employment_status, created_at,
  birthday, id_issued_on, blood_type, full_name, photo_key, totp_secret,
  totp_enabled, bank_name, bank_account, joined_on, ic_number,
  base_salary_cents, left_on, rejoined_on, onboarding_json, address,
  emergency_name, emergency_phone, emergency_relation, epf_no, socso_no,
  tax_no, totp_last_step, reports_to, role_title, responsibilities,
  responsibilities_updated_at, responsibilities_updated_by, google_sub,
  email_verified_at, recovery_rotation_required, custom_role_id
)
SELECT
  id, email, password_hash, name, role, is_active, employee_id, position,
  department, phone, photo_media_id, employment_status, created_at,
  birthday, id_issued_on, blood_type, full_name, photo_key, totp_secret,
  totp_enabled, bank_name, bank_account, joined_on, ic_number,
  base_salary_cents, left_on, rejoined_on, onboarding_json, address,
  emergency_name, emergency_phone, emergency_relation, epf_no, socso_no,
  tax_no, totp_last_step, reports_to, role_title, responsibilities,
  responsibilities_updated_at, responsibilities_updated_by, google_sub,
  email_verified_at, recovery_rotation_required, custom_role_id
FROM users;
DROP TABLE users;
ALTER TABLE users_new9 RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_reports_to ON users(reports_to);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_users_custom_role ON users (custom_role_id);
CREATE INDEX IF NOT EXISTS ix_users_role ON users (role);
PRAGMA defer_foreign_keys = false;
CREATE TRIGGER IF NOT EXISTS roles_keep_held BEFORE DELETE ON roles
  WHEN EXISTS (SELECT 1 FROM users WHERE role = OLD.key)
  BEGIN SELECT RAISE(ABORT, 'role_in_use'); END;
CREATE TRIGGER IF NOT EXISTS users_role_known_insert BEFORE INSERT ON users
  WHEN NOT EXISTS (SELECT 1 FROM roles WHERE key = NEW.role)
  BEGIN SELECT RAISE(ABORT, 'unknown_role'); END;
CREATE TRIGGER IF NOT EXISTS users_role_known_update BEFORE UPDATE OF role ON users
  WHEN NOT EXISTS (SELECT 1 FROM roles WHERE key = NEW.role)
  BEGIN SELECT RAISE(ABORT, 'unknown_role'); END;
ALTER TABLE claims ADD COLUMN line_approver_id INTEGER REFERENCES users (id);
