-- 0151: Notification switches per person
-- (v1.226.0, the Shift Reminders brief from the owner and his answers,
-- 30-10-2026, claude/SHIFT-REMINDERS-AUDIT.md). Additive only: one new
-- table and no existing row or table is changed.
--
-- notification_prefs - one row per person and switch, written only when a
-- person changes a switch. No row means the default, which is ON. The keys
-- in use are shift_clock_in (the reminder before a shift starts) and
-- shift_clock_out (the reminders before and at the end of a shift while
-- still clocked in). enabled is 1 or 0.

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id    INTEGER NOT NULL,
  pref_key   TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, pref_key)
);
