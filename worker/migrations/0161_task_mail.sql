-- 0161 - Task email notifications, release 1.247.0. The owner brief of
-- 01-11-2026 (claude/TASK-EMAIL-AUDIT.md): one official sender, the email
-- leg of the ONE notification engine. Additive only - one new table, no
-- existing row or table changed. Settings live in the existing system_meta.
-- mail_outbox: every email the portal decides to send, one row each, with
-- its delivery state. ref is the idempotency key - the same key the in-app
-- bell uses for the same event - so a retried request, a second cron pass or
-- a redeploy can never queue the same email twice (unique index). status
-- moves queued, sending, accepted (Cloudflare took it - NOT inbox delivery),
-- failed (will retry, not_before says when), dead (gave up, or capped, or
-- expired before the sender was configured). last_error keeps the provider
-- answer verbatim. created_by and reason are set for a manual reminder.
CREATE TABLE IF NOT EXISTS mail_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  to_email    TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  ref         TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body_text   TEXT    NOT NULL,
  body_html   TEXT,
  status      TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'accepted', 'failed', 'dead')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  not_before  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT,
  created_by  INTEGER,
  reason      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mail_outbox_ref ON mail_outbox (ref);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_status ON mail_outbox (status, not_before);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_user ON mail_outbox (user_id, created_at);
