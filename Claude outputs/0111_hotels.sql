-- 0111 - v1.100.0: the hotel directory, listed by state.
--
-- The CEO, 05-09-2026, with 1. DATA HOTEL.xlsx:
--   add new tabs for save all this data list, make sure that it is being
--   listed by State and make sure that I have the Name of Hotel, Name of
--   Company, contact person ... include their name, phone number based on
--   Malaysia format and their email. Validate the state based on the
--   tabsheet of the excel.
--
-- WHAT THIS IS. A sales list: who to call at every hotel in Malaysia the
-- company might sell to, kept by state because that is how the workbook was
-- kept and how the territory is worked.
--
-- STATE IS A CLOSED LIST. The workbook has one sheet per state and the sheet
-- names ARE the vocabulary - fifteen of them, Kuala Lumpur and Putrajaya
-- included as the federal territories they are. The CHECK below is that list
-- written down, so a typo cannot invent a sixteenth state and quietly hide a
-- hotel from every view that groups by state. worker/src/hotels.ts holds the
-- same list for the API and tests/hotels-guard.mjs holds the two together.
--
-- CONTACTS ARE THEIR OWN TABLE. The workbook gives most hotels three contact
-- columns and Selangor four, so a fixed set of columns on the hotel row would
-- be wrong on one sheet the day it was written. One row per person, numbered
-- by the column it came from.
--
-- SOFT DELETE. is_active = 0 rather than DELETE: a hotel someone removes by
-- accident is a contact list somebody spent a week building.

CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL CHECK (state IN (
    'KUALA LUMPUR', 'SELANGOR', 'PUTRAJAYA', 'NEGERI SEMBILAN', 'JOHOR',
    'MELAKA', 'KEDAH', 'PERAK', 'PERLIS', 'TERENGGANU', 'PULAU PINANG',
    'PAHANG', 'KELANTAN', 'SABAH', 'SARAWAK')),
  hotel_name TEXT NOT NULL,
  company TEXT,
  address TEXT,
  rooms INTEGER,
  stars TEXT,
  mof_validity TEXT,
  halal_validity TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hotels_state ON hotels(state, hotel_name);
CREATE INDEX IF NOT EXISTS idx_hotels_active ON hotels(is_active);

CREATE TABLE IF NOT EXISTS hotel_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  -- which contact column of the workbook this person came from
  slot INTEGER NOT NULL DEFAULT 1,
  person_name TEXT,
  -- Malaysian form: 01X-XXX XXXX mobile, 0X-XXXX XXXX landline
  phone TEXT,
  phone2 TEXT,
  email TEXT
);

CREATE INDEX IF NOT EXISTS idx_hotel_contacts_hotel ON hotel_contacts(hotel_id, slot);
