-- 0121 - v1.139.0: one order, one record.
--
-- postage_records.order_ref has been the identity of a TikTok order since
-- 0007 and has never been unique. Both doors that create one - the webhook
-- and the 30 minute sync - read SELECT id FROM postage_records WHERE
-- order_ref = ? and then INSERT if nothing came back. Between those two
-- statements the other door can do the same thing, and an order that arrives
-- while a sync is walking its 300 order window is recorded twice and its
-- stock deducted twice.
--
-- The index makes that impossible rather than unlikely. Both routes are
-- changed in the same release to INSERT OR IGNORE and to skip the deduction
-- when no row comes back, so the loser of the race does nothing at all
-- instead of failing.
--
-- Duplicates that already exist are folded first: the OLDEST row of each
-- order_ref is kept because its postage_items rows are the ones the register
-- and the stock out report already count, and the later copies are deleted
-- with their line items. Nothing is deducted or added back here - a shelf
-- that was double deducted stays as it is, and the CEO corrects it with
-- Manual in, which is a movement with a reason on it.

DELETE FROM postage_items
 WHERE postage_id IN (
   SELECT p.id FROM postage_records p
    WHERE p.order_ref IS NOT NULL
      AND p.id > (SELECT MIN(q.id) FROM postage_records q WHERE q.order_ref = p.order_ref)
 );

DELETE FROM postage_records
 WHERE order_ref IS NOT NULL
   AND id > (SELECT MIN(q.id) FROM postage_records q WHERE q.order_ref = postage_records.order_ref);

CREATE UNIQUE INDEX IF NOT EXISTS idx_postage_order_ref ON postage_records(order_ref);
