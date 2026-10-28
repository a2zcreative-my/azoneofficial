-- 0146 - News and Announcements 2.0 (the owner, 28-10-2026, his answers to
-- claude/NEWS-ANNOUNCEMENTS-AUDIT.md)
--
-- 1. The memo category. The form and the API have offered memo since
--    v1.4.215 but the table kept the five-value CHECK from 0003, so a memo
--    was never saved. SQLite cannot alter a CHECK, so announcements is
--    rebuilt with every row and every id kept, as 0138 did for claims.
-- 2. New columns, all optional: important, pinned, the departments a post
--    is for (NULL means all staff), the To line, the memo date, the
--    publisher name taken from the login at publish time, and a version
--    number with who edited it last. Old posts keep their text as it was.
-- 3. Acknowledgements per version. announcement_acks is rebuilt with the
--    version in its key, so one person acknowledges each version once.
--    Every existing acknowledgement is copied as version 1 with its own
--    time. The new table has no foreign key to announcements, so the old
--    announcements table can be dropped without touching acknowledgements -
--    the worker checks the post exists before saving one.
-- 4. announcement_versions keeps the text each version replaced, so what a
--    person acknowledged can always be shown again.
-- 5. announcement_files lists attachments stored in R2, removed by stamp.

CREATE TABLE announcements_new (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'news'
    CHECK (category IN ('news','meeting','holiday','kpi','training','memo')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  important INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  audience TEXT,
  to_line TEXT,
  memo_date TEXT,
  from_name TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  updated_by INTEGER
);

INSERT INTO announcements_new (id, title, body, category, created_by, created_at)
SELECT id, title, body, category, created_by, created_at FROM announcements;

CREATE TABLE announcement_acks_new (
  announcement_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  acked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, user_id, version)
);

INSERT INTO announcement_acks_new (announcement_id, user_id, version, acked_at)
SELECT announcement_id, user_id, 1, acked_at FROM announcement_acks;

DROP TABLE announcement_acks;

DROP TABLE announcements;

ALTER TABLE announcements_new RENAME TO announcements;

ALTER TABLE announcement_acks_new RENAME TO announcement_acks;

CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at);

CREATE INDEX IF NOT EXISTS idx_announcement_acks_user ON announcement_acks(user_id, announcement_id);

CREATE TABLE IF NOT EXISTS announcement_versions (
  announcement_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  to_line TEXT,
  memo_date TEXT,
  replaced_by INTEGER,
  replaced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, version)
);

CREATE TABLE IF NOT EXISTS announcement_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_announcement_files_post ON announcement_files(announcement_id, removed_at);
