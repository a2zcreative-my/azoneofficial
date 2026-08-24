-- 0084 — v1.43.0 (CEO: "for ELFIA, I want to have a traffic to see which
-- user that visit my pages … a new map like Operations map … a new tab for
-- ELFIA traffic").
--
-- One table, zero ALTERs (audit B4 rule — IF NOT EXISTS, fully replayable):
-- the portal's copy of the store's daily traffic aggregates, pulled over
-- bridge feed D (see PORTAL-BRIDGE-SPEC.md § D) on the same 5-minute cron
-- as web orders.
--
-- WHAT NEVER ARRIVES HERE, by decision OD-20a: anything about a person.
-- The store sends per-day counts by state/city/page only — no IPs, no
-- visitor hashes, no cookies ever existed upstream. "Which user" is
-- answered with WHERE and HOW MANY, never WHO.
--
-- Grain: one row per (day, state, city, path). The row with
-- state='' , city='' , path='' is the store's whole-day total, whose
-- `visitors` is the day's TRUE unique count (per-group visitor counts must
-- never be summed across rows — travellers overlap between groups).
-- Days at or before the feed's `final_through` are final; the running day
-- is REPLACED whole on every poll, never added to.

CREATE TABLE IF NOT EXISTS web_traffic_daily (
  day      TEXT    NOT NULL,             -- Malaysian calendar day, YYYY-MM-DD
  state    TEXT    NOT NULL,             -- "Selangor" … / "Outside Malaysia" / '' = day total
  city     TEXT    NOT NULL DEFAULT '',
  path     TEXT    NOT NULL DEFAULT '',
  visits   INTEGER NOT NULL DEFAULT 0,   -- page views
  visitors INTEGER NOT NULL DEFAULT 0,   -- distinct daily visitors in this group
  PRIMARY KEY (day, state, city, path)
);
