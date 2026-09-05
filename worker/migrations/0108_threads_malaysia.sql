-- 0108 - v1.97.0: which harvested posts are from Malaysia, as far as the post
-- itself says so.
--
-- The CEO, 05-09-2026, with the first study case on screen:
--   I want to search and filter the Threads post by malaysia users which is
--   for me to do some research based on their post regarding on the Study
--   cases that I want to view. this is to helping me to boost my product
--   for marketing purposes!
--
-- WHAT THREADS DOES NOT TELL US. A public post carries no country. There is
-- no location on the author, no country filter on the search, and no field
-- that could be asked for. So "Malaysian" cannot be a fact read off Meta.
--
-- WHAT THE POST ITSELF GIVES AWAY. Malay wording that is Malay rather than
-- Indonesian (tak, nak, dah, kat, korang - not gak, banget, aja), prices in
-- RM, a Malaysian place named (KL, Johor, Penang, Sabah, Langkawi ...),
-- Manglish (lah, kan, weh). Each is a signal, added up in the worker at
-- harvest time. my_signal is 1 when the sum clears the bar and the post does
-- not read as Indonesian. my_reasons keeps WHY in a few words, so the CEO
-- can see what tipped it rather than trust a number.
--
-- Rows harvested before this column carry my_reasons NULL and are scored the
-- first time the study is opened. Nothing about a person is looked up or
-- kept: this is the text of a public post and nothing else.

ALTER TABLE threads_topic_posts ADD COLUMN my_signal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads_topic_posts ADD COLUMN my_reasons TEXT;

CREATE INDEX IF NOT EXISTS idx_threads_topic_posts_my ON threads_topic_posts(topic_id, my_signal);
