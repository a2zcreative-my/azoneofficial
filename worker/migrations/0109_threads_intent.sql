-- 0109 - v1.98.0: is the post ASKING for the thing, or SELLING it.
--
-- The CEO, 05-09-2026:
--   I want study case posting which is for me to find if there is anyone
--   users in Malaysia looking for the keywords or posting that the keywords
--   that I want to find so that I can do some research on the requirement
--   and demand for my business study
--
-- Demand and supply read differently. Somebody LOOKING writes a question -
-- ada tak, mana nak cari, any recommendation, berapa harga. Somebody
-- SELLING writes an offer - ready stock, RM 39, DM to order, free postage.
-- Both mention the same keyword, and a count of the keyword alone cannot
-- tell the two apart. So each harvested post is read for its intent at
-- harvest time and the verdict is kept here:
--
--   asking  - the writer wants the thing (demand)
--   selling - the writer offers the thing (supply)
--   other   - talks about it without wanting or offering
--
-- NULL means not scored yet (rows from before 0109), and the study route
-- scores those the first time the topic is opened.
--
-- last_note on the topic is a plain observation about the last run that is
-- NOT an error and must not be painted red - the one it exists for: every
-- post that came back belongs to an account connected to this app, which is
-- what a Meta app still in Development mode returns.

ALTER TABLE threads_topic_posts ADD COLUMN intent TEXT;
ALTER TABLE threads_topics ADD COLUMN last_note TEXT;

CREATE INDEX IF NOT EXISTS idx_threads_topic_posts_intent ON threads_topic_posts(topic_id, intent);
