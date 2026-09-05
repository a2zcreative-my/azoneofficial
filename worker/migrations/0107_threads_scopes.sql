-- 0107 - v1.96.2: what a connected account was allowed to do, written down.
--
-- The CEO, 05-09-2026, pressing Search now on a topic:
--   An unknown error occurred
--
-- Meta answers a Threads token that lacks a permission with its generic
-- error, not with a message that names the permission. The A2Z account was
-- connected under 1.94, before threads_keyword_search was on the list, so
-- its token cannot search - and nothing in the database said so, because
-- 0105 kept the token and forgot the scopes it was minted with.
--
-- This column holds the scope string the worker ASKED FOR at connect time.
-- It is written on every connect and reconnect, so an account whose row
-- still reads NULL was connected before this release and is treated as
-- lacking search. The Study section can then say "reconnect" before a
-- search is spent, instead of after Meta refuses one.

ALTER TABLE threads_accounts ADD COLUMN granted_scopes TEXT;
