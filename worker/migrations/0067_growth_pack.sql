-- 0067: The growth pack (v1.4.273) — CEO approved ALL six ideas.
--   1. prospects.referred_by — the referral loop gets a field, so the
--      pipeline can show which channel actually closes.
--   2. client_report_links — a tokened, public, read-only monthly report
--      per client (same share-link idea as sales documents).
--   3. customers.quiet_alerted_on — dedupe flag for the "client gone
--      quiet" cron alert (cleared when a new session is booked).
-- No foreign keys (house rule since the v1.4.69 FK incident).

ALTER TABLE prospects ADD COLUMN referred_by TEXT;

CREATE TABLE IF NOT EXISTS client_report_links (
  customer_id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE customers ADD COLUMN quiet_alerted_on TEXT;
