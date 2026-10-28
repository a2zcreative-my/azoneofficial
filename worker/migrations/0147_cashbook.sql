-- 0147 - Finance and Cash Flow 2.0 (the owner, 28-10-2026, answering the
-- Finance audit in claude/FINANCE-AUDIT.md: approve 0147, show true dates and
-- flag issues, money in by the Sales rule, Expenses as its own tab).
--
-- ADDITIVE ONLY. No existing row is changed, moved or deleted.
--
-- cashflow_entries gains
--   effective_date  the day the money really moved, written by new bookings
--                   only. Old rows keep NULL and the screen reads their true
--                   date from the source record instead.
--   source_key      the booking key of a NEW row, unique. Old rows keep NULL,
--                   so the index cannot fail on history. A retried or doubled
--                   request finds the key taken and books nothing.
--   reversal_of     a reversal row points at the row it cancels. Undoing a
--                   payment adds one of these, it never deletes the original.
--   reverse_reason  why, in the words of whoever reversed it.
--   transfer_id     the two halves of a move between two company accounts.
--
-- bank_accounts gains an opening balance and the day it was true, entered by
-- the CEO or COO, and an updated_at stamp. A book balance is shown only for
-- an account that has one. Nothing invents a balance.
--
-- cashbook_marks holds what a person decided about one Finance item that has
-- no row of its own to carry it - which bank a receipt landed in, or that an
-- exception was reviewed - with who and when. One row per item.

ALTER TABLE cashflow_entries ADD COLUMN effective_date TEXT;
ALTER TABLE cashflow_entries ADD COLUMN source_key TEXT;
ALTER TABLE cashflow_entries ADD COLUMN reversal_of INTEGER;
ALTER TABLE cashflow_entries ADD COLUMN reverse_reason TEXT;
ALTER TABLE cashflow_entries ADD COLUMN transfer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cashflow_source_key
  ON cashflow_entries (source_key) WHERE source_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cashflow_one_reversal
  ON cashflow_entries (reversal_of) WHERE reversal_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cashflow_ref ON cashflow_entries (ref);

ALTER TABLE bank_accounts ADD COLUMN opening_balance_cents INTEGER;
ALTER TABLE bank_accounts ADD COLUMN opening_on TEXT;
ALTER TABLE bank_accounts ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS cashbook_marks (
  item_key TEXT PRIMARY KEY,
  bank_id INTEGER,
  bank_note TEXT,
  bank_by INTEGER,
  bank_at TEXT,
  reviewed_note TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT
);
