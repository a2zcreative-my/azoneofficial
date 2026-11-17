-- 0208 - ROLES V2, STAGE 1 (docs/ROLES-V2-PLAN.md), release 1.355.0.
-- The CEO, 17-11-2026: roles the owner or the super admin create and remove,
-- without them being hard-coded. Decisions R-1 to R-6 are in the plan.
-- ADDITIVE ONLY: one new table and its rules. users, users.role with its CHECK
-- and custom_roles (0205) are unchanged. An own role cannot be given to a
-- person until the stages that make pages, staff counts and approvals read
-- the role (plan, stages 2 and 3), and the users rebuild waits for that stage.
CREATE TABLE IF NOT EXISTS roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  -- protected = R-1, never deleted, name and place fixed. builtin = a code
  -- role the later stages free (R-2). own = made by the owner, key r_ slug
  kind TEXT NOT NULL CHECK (kind IN ('protected', 'builtin', 'own')),
  -- R-4: counts as company staff (payroll, headcount, attendance, rosters)
  counts_as_staff INTEGER NOT NULL DEFAULT 1 CHECK (counts_as_staff IN (0, 1)),
  -- R-5: the sidebar pages, a JSON list of tab names. NULL = the built-in tab rules
  tabs TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT,
  CHECK (kind != 'own' OR (key GLOB 'r_*' AND length(key) BETWEEN 4 AND 42)),
  CHECK (kind = 'own' OR key NOT GLOB 'r_*')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_roles_name ON roles (lower(name));

-- the twelve roles of today, as the code has them. counts_as_staff = who the
-- attendance and payroll lists hold today (ATTENDANCE_STAFF_ROLES)
INSERT OR IGNORE INTO roles (key, name, kind, counts_as_staff) VALUES
  ('super_admin', 'Super Admin', 'protected', 0),
  ('ceo', 'CEO', 'protected', 1),
  ('coo', 'COO', 'protected', 1),
  ('cco', 'CCO', 'protected', 1),
  ('agent', 'Agent', 'protected', 0),
  ('customer', 'Customer', 'protected', 0),
  ('admin', 'Admin', 'builtin', 0),
  ('hr_admin', 'HR Admin', 'builtin', 1),
  ('sales_marketing', 'Sales & Marketing', 'builtin', 1),
  ('marketing', 'Marketing', 'builtin', 1),
  ('editor', 'Editor', 'builtin', 1),
  ('live_host', 'Live Host', 'builtin', 1);

-- the rules, held by the database whatever a route does
CREATE TRIGGER IF NOT EXISTS roles_keep_code_roles BEFORE DELETE ON roles
  WHEN OLD.kind != 'own'
  BEGIN SELECT RAISE(ABORT, 'role_protected'); END;
CREATE TRIGGER IF NOT EXISTS roles_keep_held BEFORE DELETE ON roles
  WHEN EXISTS (SELECT 1 FROM users WHERE role = OLD.key)
  BEGIN SELECT RAISE(ABORT, 'role_in_use'); END;
CREATE TRIGGER IF NOT EXISTS roles_key_fixed BEFORE UPDATE OF key, kind ON roles
  WHEN NEW.key != OLD.key OR NEW.kind != OLD.kind
  BEGIN SELECT RAISE(ABORT, 'role_key_fixed'); END;
CREATE TRIGGER IF NOT EXISTS roles_protected_name BEFORE UPDATE OF name ON roles
  WHEN OLD.kind = 'protected' AND NEW.name != OLD.name
  BEGIN SELECT RAISE(ABORT, 'role_protected'); END;
