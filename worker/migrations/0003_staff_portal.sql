-- AZ ONE OFFICIAL — Staff Portal (BMS) schema
-- Covers: staff roles/profiles, attendance, leave, announcements, tasks,
-- CRM, sales documents (QT/DO/INV) with auto-numbering, notifications.

-- 1) Rebuild users with expanded role set + staff profile fields
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'super_admin','admin','editor','marketing',
    'managing_director','coo','business_dev','finance_admin','live_manager','live_host'
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
INSERT INTO users_new (id, email, password_hash, name, role, is_active, created_at)
  SELECT id, email, password_hash, name, role, is_active, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 2) Attendance
CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('clock_in','clock_out','break_in','break_out')),
  ip TEXT,
  user_agent TEXT,
  gps TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records(user_id, created_at);

-- 3) Leave
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('annual','medical','emergency','unpaid','replacement')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  reason TEXT,
  mc_media_id INTEGER REFERENCES media(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by INTEGER REFERENCES users(id),
  review_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id, status);

CREATE TABLE IF NOT EXISTS leave_balances (
  user_id INTEGER NOT NULL REFERENCES users(id),
  year INTEGER NOT NULL,
  type TEXT NOT NULL,
  entitled REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year, type)
);

-- 4) Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'news'
    CHECK (category IN ('news','meeting','holiday','kpi','training')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcement_acks (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  acked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, user_id)
);

-- 5) Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed')),
  progress INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  attachment_media_id INTEGER REFERENCES media(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6) CRM
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7) Sales documents (QT / DO / INV) + auto numbering
CREATE TABLE IF NOT EXISTS sales_documents (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('QT','DO','INV')),
  doc_number TEXT UNIQUE NOT NULL,           -- e.g. QT202600001
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  items TEXT NOT NULL,                        -- JSON: [{name, qty, unit_price_cents}]
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  valid_until TEXT,                           -- QT
  delivery_status TEXT,                       -- DO: pending/delivered
  payment_status TEXT,                        -- INV: unpaid/paid/overdue
  due_date TEXT,                              -- INV
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS doc_counters (
  doc_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);

-- 8) Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  ref TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
