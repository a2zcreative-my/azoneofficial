-- v1.4.251 — a manual stock movement can now go IN as well as OUT, and both
-- carry a mandatory reason.
--
-- Until now only OUTs were logged (0049): stock coming back in — a supplier
-- restock, a customer return, or a stock count that found MORE than the system
-- said — moved the number with nothing recorded about why. That is exactly the
-- case the CEO hit when asking how to correct a variance.
--
-- DEFAULT 'out' keeps every existing row meaning precisely what it meant
-- before, so the stock-out totals and the Avg sold @ are unchanged.

ALTER TABLE manual_stockouts ADD COLUMN direction TEXT NOT NULL DEFAULT 'out';
