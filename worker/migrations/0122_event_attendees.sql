-- 0122 - v1.144.0: an event can name who has to be there.
--
-- The CEO, 09-09-2026, on a Brand2Market class for four people: "I want some
-- selected staff which is require to join the event only being notified."
-- Until now every event rang every bell, so a class for four interrupted
-- eleven, and the four people who had to be there could not tell their event
-- from the other nine.
--
-- The list lives in its own table rather than as a column of ids on events,
-- for the same reason the rest of this schema does: a row per person can be
-- indexed, counted and joined, and removing one person is a DELETE rather
-- than a string edit that can drop the wrong id.
--
-- NO FOREIGN KEYS, by policy since the v1.4.69 incident: reference by id and
-- resolve names with LEFT JOIN. The pair is the primary key, so inviting the
-- same person twice is impossible rather than merely unlikely.
--
-- AN EVENT WITH NO ROWS HERE STILL NOTIFIES EVERYONE. Every event that
-- existed before this migration has no rows, and every one of them was
-- announced to the whole floor - so "no list" has to keep meaning "everyone"
-- or this migration would silently rewrite the past.

CREATE TABLE IF NOT EXISTS event_attendees (
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_attendees_event ON event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_user ON event_attendees(user_id);
