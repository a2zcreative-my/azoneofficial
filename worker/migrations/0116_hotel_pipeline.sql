-- 0116 - v1.110.0 (roadmap phase 05): the hotel list becomes a pipeline.
--
-- The roadmap, 05-09-2026: the company holds 442 hotels and 690 named
-- contacts on one tab, and enquiries, quotations and invoices on another, and
-- nothing connects them - so the most valuable asset in the system is a phone
-- book. Three additions turn it into a pipeline.
--
-- CALLS. One row per conversation: who rang, when, which contact, how it went
-- and what happens next. The call log is the sales work made visible, and the
-- next_at date is what turns the list into a worklist - a hotel whose follow-up
-- date has passed is on the desk and in the Watchers.
--
-- THE LINK TO A CLIENT. A hotel that buys becomes a customer row, and the
-- quotations and invoices already hang off customers. hotels.customer_id is
-- the one join that lets the map colour a state by revenue instead of by count
-- and lets a hotel page show the documents in its name. A hotel with no client
-- yet has NULL here, which is most of them.
--
-- STAGE. Where each hotel is: lead (never contacted), contacted, quoted, won,
-- lost, dormant. The first three advance by themselves - a call moves a lead
-- to contacted, a linked quotation moves it to quoted, a paid invoice to won -
-- and the last two are a person saying so. Stored rather than derived so that
-- lost and dormant can exist at all, and indexed so the pipeline view is one
-- GROUP BY.
--
-- last_contact_at is denormalised from the newest call, because the list is
-- sorted and filtered by it on every open and a MAX() over the call log for
-- 442 hotels each time is the kind of query that is fine until it is not.

CREATE TABLE IF NOT EXISTS hotel_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  contact_id INTEGER REFERENCES hotel_contacts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  called_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome TEXT NOT NULL CHECK (outcome IN ('spoke', 'no_answer', 'callback', 'not_interested', 'meeting', 'sent_quote', 'won', 'lost')),
  notes TEXT,
  next_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hotel_calls_hotel ON hotel_calls(hotel_id, called_at);
CREATE INDEX IF NOT EXISTS idx_hotel_calls_next ON hotel_calls(next_at);

ALTER TABLE hotels ADD COLUMN customer_id INTEGER REFERENCES customers(id);
ALTER TABLE hotels ADD COLUMN stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead', 'contacted', 'quoted', 'won', 'lost', 'dormant'));
ALTER TABLE hotels ADD COLUMN last_contact_at TEXT;
ALTER TABLE hotels ADD COLUMN next_at TEXT;
ALTER TABLE hotels ADD COLUMN owner_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_hotels_stage ON hotels(stage);
CREATE INDEX IF NOT EXISTS idx_hotels_next ON hotels(next_at);
