-- 0105 - v1.89.0: the Threads workspace, phase 1 - connect and import.
--
-- The CEO, 04-09-2026, after a walkthrough video of a Threads content tool:
--   for Threads I want new tabs all in 1 tabs for the Threads with
--   minimalist interface
--
-- WHAT THIS PHASE HOLDS. The account itself, every post it has ever
-- published (imported from the Threads API, paged), and a daily snapshot
-- of each post and of the account. Nothing here is written by a person -
-- drafts, scheduling and publishing arrive in 0106. Phase 1 is the half
-- that de-risks everything after it, because once the history and the
-- numbers are in this database every later phase is reading our own rows.
--
-- WHERE THE TOKEN LIVES. Not here. The long-lived token goes into the
-- existing integration_tokens table under provider = threads:<user id>, the
-- same shelf the TikTok Shop token sits on, so the refresh cron already has
-- one place to look and the /posts route can never SELECT it by accident.
--
-- SNAPSHOTS, NOT COUNTERS. A post row never carries its own view count. The
-- count lives in threads_post_metrics keyed by the day it was captured, and
-- a day is never overwritten - so views at day 1, day 7 and day 30 remain
-- answerable later, which the above-baseline pill in the video needs and a
-- single mutable number could never give.
--
-- TRAITS AT IMPORT. char_count and the hook flags are computed by plain
-- rules when a post lands, so phase 3 (why this worked) is SQL over these
-- columns and not a model with an opinion.

CREATE TABLE IF NOT EXISTS threads_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threads_user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_label TEXT,
  connected_by INTEGER REFERENCES users(id),
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  token_expires_at TEXT,
  last_sync_at TEXT,
  sync_error TEXT,
  -- idle, importing (history pages still to fetch), done
  sync_state TEXT NOT NULL DEFAULT 'idle',
  -- the paging cursor of an import in progress
  sync_cursor TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS threads_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES threads_accounts(id),
  media_id TEXT NOT NULL UNIQUE,
  text TEXT,
  -- TEXT_POST, IMAGE, VIDEO, CAROUSEL_ALBUM, REPOST_FACADE, AUDIO
  media_type TEXT NOT NULL DEFAULT 'TEXT_POST',
  permalink TEXT,
  published_at TEXT NOT NULL,
  is_reply INTEGER NOT NULL DEFAULT 0,
  is_quote INTEGER NOT NULL DEFAULT 0,
  -- imported (from the Threads history) or portal (published from here, 0106)
  source TEXT NOT NULL DEFAULT 'imported',
  status TEXT NOT NULL DEFAULT 'published',
  content_item_id INTEGER REFERENCES content_items(id),
  language_guess TEXT,
  char_count INTEGER NOT NULL DEFAULT 0,
  has_number_hook INTEGER NOT NULL DEFAULT 0,
  has_question_hook INTEGER NOT NULL DEFAULT 0,
  has_cta INTEGER NOT NULL DEFAULT 0,
  has_media INTEGER NOT NULL DEFAULT 0,
  -- the newest snapshot, denormalised so a list sorts without a join
  views INTEGER,
  likes INTEGER,
  replies INTEGER,
  reposts INTEGER,
  quotes INTEGER,
  shares INTEGER,
  metrics_at TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threads_posts_account_published
  ON threads_posts(account_id, published_at);

CREATE TABLE IF NOT EXISTS threads_post_metrics (
  post_id INTEGER NOT NULL REFERENCES threads_posts(id),
  captured_on TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  replies INTEGER,
  reposts INTEGER,
  quotes INTEGER,
  shares INTEGER,
  PRIMARY KEY (post_id, captured_on)
);

CREATE TABLE IF NOT EXISTS threads_account_metrics (
  account_id INTEGER NOT NULL REFERENCES threads_accounts(id),
  captured_on TEXT NOT NULL,
  followers INTEGER,
  views INTEGER,
  PRIMARY KEY (account_id, captured_on)
);
