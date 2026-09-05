-- 0115 - v1.108.0 (roadmap phase 04c): Watchers.
--
-- Rules over data the company already holds, checked every hour on the cron
-- that already runs, delivered as the push and the in-app bell that already
-- exist. Stock below a line, an order paid and not shipped, a claim nobody
-- has decided, a hotel whose MOF or Halal certificate is about to lapse, an
-- asset warranty about to run out.
--
-- TWO SMALL TABLES.
--
-- watcher_settings: one row per watcher, whether it is on and the number it
-- watches against. The watchers themselves are code (worker/src/watchers.ts)
-- because a rule is logic and logic belongs where it can be tested. This
-- table holds only what the CEO may reasonably want to change without a
-- deploy - on or off, and the threshold. A watcher with no row uses its
-- built-in default, so a new watcher is live the day it is written.
--
-- watcher_open: every condition currently true, one row per finding, keyed
-- by a stable ref (e.g. stock:17). It exists so the same finding is pushed
-- ONCE, when it first appears, and not every hour until somebody fixes it -
-- a bell that rings hourly for the same thing is a bell people mute. When a
-- run no longer finds a ref, its row is deleted, and if the condition comes
-- back later it is new again and is pushed again.

CREATE TABLE IF NOT EXISTS watcher_settings (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  threshold INTEGER,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watcher_open (
  ref TEXT PRIMARY KEY,
  watcher TEXT NOT NULL,
  title TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_watcher_open_watcher ON watcher_open(watcher);
