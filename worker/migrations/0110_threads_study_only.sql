-- 0110 - v1.99.0: Threads is a study room, not an archive of the account.
--
-- The CEO, 05-09-2026:
--   remove library since this is not supposed to view by my staff. the
--   objective for this Threads to make them to find a study case based on
--   the market research and the demand based on the keywords that they
--   want. and the data should not keep too much since it is only for 7 days
--   for them to study. Additionally, you need to make sure that D1 from
--   Cloudflare not hold so much data for the Threads research
--
-- WHAT GOES. The three tables that held the account OWN history: every post
-- it ever published, a metrics snapshot per post per day, and a follower
-- count per day. Two reasons, and either alone would do. They are the
-- personal posts of the person who connected the account, which the staff
-- were never meant to read. And they were the part of Threads that GREW
-- without limit - one row per post per day, forever - which is the opposite
-- of what a research tool that keeps a week of findings should cost.
--
-- WHAT STAYS. threads_accounts (the connection - the token stays in
-- integration_tokens as before), threads_topics (what is being studied),
-- threads_topic_posts (public posts found for a topic) and threads_searches
-- (the weekly quota count). From this release the worker deletes a found
-- post 7 days after it was found and a search record after 8 (the quota is
-- a rolling 7-day window and needs one day of slack), and caps a topic at
-- 400 posts. The database therefore holds at most one week of study, and
-- the size of that week is bounded by the search allowance itself.
--
-- The sync columns on threads_accounts describe the history import that no
-- longer exists. They are left in place rather than dropped - a column that
-- is never written costs nothing, and dropping columns is where a migration
-- goes wrong - and are set to their idle values here so no row claims an
-- import is still running.

DROP TABLE IF EXISTS threads_post_metrics;
DROP TABLE IF EXISTS threads_account_metrics;
DROP TABLE IF EXISTS threads_posts;

UPDATE threads_accounts SET sync_state = 'idle', sync_cursor = NULL, sync_error = NULL, last_sync_at = NULL;

-- The retention rule, applied once now so the first purge is not a surprise.
DELETE FROM threads_topic_posts WHERE found_at < datetime('now', '-7 days');
DELETE FROM threads_searches WHERE ran_at < datetime('now', '-8 days');

CREATE INDEX IF NOT EXISTS idx_threads_topic_posts_found ON threads_topic_posts(found_at);
