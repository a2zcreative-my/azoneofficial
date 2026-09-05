-- 0117 - v1.111.0: the hotel pipeline speaks review outreach, not sales.
--
-- The CEO, 05-09-2026, on the follow-up watcher that v1.110.0 added: Hotels
-- is not a list of companies to sell marketing to. It is a separate venture -
-- the review-content business, hotel and Airbnb stays, in the manner of a
-- food reviewer - and the pipeline built an hour earlier spoke the wrong
-- language: quoted, won, invoices.
--
-- So the vocabulary changes, and nothing else does. A stage is still a stage
-- and a call is still a call - the words are the ones this business uses:
--
--   stage:   lead (not contacted) - contacted - agreed (a stay is agreed) -
--            reviewed (the stay happened) - published (the review is out) -
--            declined
--   outcome: spoke, no_answer, callback, declined, agreed, stayed, published
--
-- SQLite cannot alter a CHECK constraint in place, so the stage column is
-- rebuilt beside itself and swapped, and the call log is rebuilt as a table.
-- The rows that exist (all of them lead, unless somebody logged a call in
-- the hour v1.110.0 was live) are carried across with the nearest word.
--
-- review_url is new: where the published review lives. It is also the probe
-- for this migration - the rest of the schema has the same names before and
-- after, so only a new column can tell the two apart.
--
-- hotels.customer_id from 0116 stays as a column nobody reads. It carries a
-- foreign key, which SQLite will not drop, and an unused nullable column costs
-- nothing. Should a hotel ever also buy something, it is there.

DROP INDEX IF EXISTS idx_hotels_stage;

ALTER TABLE hotels ADD COLUMN stage_new TEXT NOT NULL DEFAULT 'lead' CHECK (stage_new IN ('lead', 'contacted', 'agreed', 'reviewed', 'published', 'declined'));

UPDATE hotels SET stage_new = CASE stage
  WHEN 'contacted' THEN 'contacted'
  WHEN 'quoted' THEN 'agreed'
  WHEN 'won' THEN 'published'
  WHEN 'lost' THEN 'declined'
  WHEN 'dormant' THEN 'declined'
  ELSE 'lead' END;

ALTER TABLE hotels DROP COLUMN stage;

ALTER TABLE hotels RENAME COLUMN stage_new TO stage;

ALTER TABLE hotels ADD COLUMN review_url TEXT;

CREATE INDEX IF NOT EXISTS idx_hotels_stage ON hotels(stage);

CREATE TABLE IF NOT EXISTS hotel_calls_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  contact_id INTEGER REFERENCES hotel_contacts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  called_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome TEXT NOT NULL CHECK (outcome IN ('spoke', 'no_answer', 'callback', 'declined', 'agreed', 'stayed', 'published')),
  notes TEXT,
  next_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO hotel_calls_new (id, hotel_id, contact_id, user_id, called_at, outcome, notes, next_at, created_at)
SELECT id, hotel_id, contact_id, user_id, called_at,
  CASE outcome
    WHEN 'not_interested' THEN 'declined'
    WHEN 'lost' THEN 'declined'
    WHEN 'meeting' THEN 'agreed'
    WHEN 'sent_quote' THEN 'agreed'
    WHEN 'won' THEN 'published'
    ELSE outcome END,
  notes, next_at, created_at
FROM hotel_calls;

DROP TABLE hotel_calls;

ALTER TABLE hotel_calls_new RENAME TO hotel_calls;

CREATE INDEX IF NOT EXISTS idx_hotel_calls_hotel ON hotel_calls(hotel_id, called_at);
CREATE INDEX IF NOT EXISTS idx_hotel_calls_next ON hotel_calls(next_at);
