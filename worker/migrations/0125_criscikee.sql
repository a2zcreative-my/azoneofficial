-- 0125 - v1.149.0: Criscikee, the crispy chicken skin - who tried it, which
-- flavour, how much they liked it, and why.
--
-- The CEO, 10-09-2026: a new product line needs its own tab, and the tab has
-- one job - to answer WHO is trying Criscikee, WHAT flavour they prefer, HOW
-- MUCH they like it, and WHY. Two tables do that.
--
-- criscikee_flavors is CONFIGURATION, not data. The four rows seeded below
-- are the launch flavours - the Flavors screen adds, renames and retires them.
-- A flavour is never deleted - is_active = 0 keeps every review that ever
-- named it readable. Reviews reference a flavour BY ID, never by name, so a
-- rename touches one row and every chart follows.
--
-- criscikee_reviews is the feedback itself. The rules that matter:
--
--   age_group is STORED, and it is derived by the worker from age, never sent
--   by the browser. Storing it makes every GROUP BY a plain column read, and
--   deriving it server-side means the boundaries live in one place
--   (worker/src/criscikee.ts) and a form cannot file a 27-year-old under
--   18-24 by mistake or on purpose.
--
--   comment is what the customer said, verbatim. Nothing rewrites it.
--
--   sentiment is classified by the worker when the review is saved, with the
--   reasons kept beside it (sentiment_reasons) the way the Threads study
--   keeps my_reasons - a verdict nobody can check is a verdict nobody trusts.
--   sentiment_source says whether a person overrode it. When an AI replaces
--   the classifier one day, nothing here changes shape.
--
--   reviewed_on is the Malaysian calendar day the customer gave the feedback,
--   so a tasting entered the morning after still lands on the right day.
--
--   DELETE IS SOFT. is_deleted = 1, audited with what the row said. A review
--   is a customer speaking and a mis-click is not a reason to lose it.
--
-- NO FOREIGN KEYS, by policy since the v1.4.69 incident: reference by id and
-- resolve names with LEFT JOIN.
--
-- The CHECK lists below are the same closed lists worker/src/criscikee.ts and
-- lib/criscikee.ts carry, and tests/criscikee.mjs holds the three together.

CREATE TABLE IF NOT EXISTS criscikee_flavors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_criscikee_flavors_name ON criscikee_flavors(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_criscikee_flavors_active ON criscikee_flavors(is_active, sort_order);

CREATE TABLE IF NOT EXISTS criscikee_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flavor_id INTEGER NOT NULL,
  age INTEGER NOT NULL CHECK (age BETWEEN 3 AND 110),
  age_group TEXT NOT NULL CHECK (age_group IN ('under_18', '18_24', '25_34', '35_44', '45_54', '55_plus')),
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'undisclosed')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  impression TEXT NOT NULL CHECK (impression IN ('loved_it', 'good', 'average', 'not_my_taste')),
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  sentiment_source TEXT NOT NULL DEFAULT 'auto' CHECK (sentiment_source IN ('auto', 'manual')),
  sentiment_reasons TEXT,
  reviewed_on TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_criscikee_reviews_flavor ON criscikee_reviews(flavor_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_criscikee_reviews_live ON criscikee_reviews(is_deleted, reviewed_on);
CREATE INDEX IF NOT EXISTS idx_criscikee_reviews_segment ON criscikee_reviews(is_deleted, flavor_id, gender, age_group);

-- The launch flavours. Explicit ids and OR IGNORE, so applying this file
-- twice changes nothing and a renamed flavour keeps its id.

INSERT OR IGNORE INTO criscikee_flavors (id, name, description, sort_order) VALUES
(1, 'Original', 'The plain crispy skin, lightly salted', 1),
(2, 'BBQ', 'Smoky-sweet barbecue seasoning', 2),
(3, 'Spicy', 'Chilli heat on the crisp', 3),
(4, 'Cheese', 'Savoury cheese dusting', 4);
