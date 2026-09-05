-- 0106 - v1.96.0: study cases. What OTHER people post about a subject.
--
-- The CEO, 05-09-2026, with the A2Z account newly connected:
--   I want to view only for study case on Product and Service like Hotel,
--   product for Tudung
--
-- WHAT THIS IS NOT. It is not more of our own account. 0105 holds what we
-- published and what it earned. This holds what a SUBJECT looks like on
-- Threads - hotels, tudung, whatever the next client sells - so a pitch or
-- a content plan starts from what the niche actually does rather than from
-- an opinion about it.
--
-- WHERE THE POSTS COME FROM. The Threads keyword search, which returns
-- PUBLIC posts by anyone. Two things follow from that and both are written
-- into the design rather than discovered later:
--
--   1. NO VIEW COUNTS. Insights belong to the account that owns a post, so
--      a post by a stranger arrives as text, author, time, format and
--      link, nothing else. Every finding here is about the WRITING -
--      length, language, hook, format, hour - and never about reach. A
--      column for views would be a column that is always null.
--
--   2. THE SEARCH IS RATIONED. Threads allows roughly 500 queries per
--      rolling 7 days for the whole app. threads_searches records every
--      call so the portal can count what is left and refuse before Meta
--      does - a quota you discover by being cut off is a quota nobody can
--      plan around.
--
-- A topic is kept, not just run: the same words next week are a comparable
-- reading, and a post already seen is not stored twice.

CREATE TABLE IF NOT EXISTS threads_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  query TEXT NOT NULL,
  -- keyword (words in the post) or tag (a topic tag)
  search_type TEXT NOT NULL DEFAULT 'keyword',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at TEXT,
  last_error TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS threads_topic_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES threads_topics(id),
  media_id TEXT NOT NULL,
  username TEXT,
  text TEXT,
  permalink TEXT,
  media_type TEXT,
  published_at TEXT,
  -- the same plain rules 0105 applies to our own posts, so a finding about
  -- the niche and a finding about us are measured the same way
  char_count INTEGER NOT NULL DEFAULT 0,
  has_number_hook INTEGER NOT NULL DEFAULT 0,
  has_question_hook INTEGER NOT NULL DEFAULT 0,
  has_cta INTEGER NOT NULL DEFAULT 0,
  has_media INTEGER NOT NULL DEFAULT 0,
  language_guess TEXT,
  found_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_topic_posts_unique
  ON threads_topic_posts(topic_id, media_id);
CREATE INDEX IF NOT EXISTS idx_threads_topic_posts_published
  ON threads_topic_posts(topic_id, published_at);

-- One row per call to the keyword search, for the rolling 7-day count.
CREATE TABLE IF NOT EXISTS threads_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER REFERENCES threads_topics(id),
  ran_by INTEGER REFERENCES users(id),
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  found INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_threads_searches_ran_at ON threads_searches(ran_at);
