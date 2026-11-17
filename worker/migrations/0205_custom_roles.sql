-- v1.350.0 custom roles (docs/CUSTOM-ROLES-STAGE-0-AUDIT.md option A)
-- additive only: one new table and one nullable column. users.role and its CHECK are unchanged.
-- a custom role is a named column of the role_permissions cells on top of one working base role
CREATE TABLE IF NOT EXISTS custom_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE CHECK (key GLOB 'cr_*'),
  name TEXT NOT NULL,
  description TEXT,
  base_role TEXT NOT NULL CHECK (base_role IN ('hr_admin', 'sales_marketing', 'marketing', 'editor', 'live_host')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_custom_roles_name ON custom_roles (lower(name));
ALTER TABLE users ADD COLUMN custom_role_id INTEGER REFERENCES custom_roles (id);
CREATE INDEX IF NOT EXISTS ix_users_custom_role ON users (custom_role_id);
