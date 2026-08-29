-- 0094 - v1.65.0: live cards. One counter per topic, bumped on every write.
--
-- The portal already streams notifications over SSE. What it could not do is
-- tell a card that the data behind it changed, so every card loaded once and
-- then went stale until somebody pressed reload. Two people on the same shift
-- would be looking at two different versions of the truth.
--
-- A topic is the first path segment of a staff route: tasks, leave, orders,
-- elfia, payroll and so on. `v` goes up by one whenever a write on that topic
-- succeeds. A card watching a topic reloads when its number moves, and that is
-- the whole protocol: no payload, no diffing, no ordering problems. A counter
-- that only ever increases cannot be applied out of order.
--
-- `at` is the wall clock of the last bump, kept for diagnosis rather than for
-- logic. Comparing clocks across a distributed edge is a trap. Comparing an
-- integer to the one you saw last is not.
--
-- Deliberately NOT one row per user. This says what changed, never who may
-- see it. Every card still fetches through its own authorised endpoint, so a
-- version bump can leak at most the fact that something in that topic moved.

CREATE TABLE IF NOT EXISTS data_versions (
  topic TEXT PRIMARY KEY,
  v     INTEGER NOT NULL DEFAULT 0,
  at    INTEGER NOT NULL DEFAULT 0
);
