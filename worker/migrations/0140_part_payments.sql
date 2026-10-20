-- 0140 - part payments recorded against an invoice.
--
-- A customer pays an invoice in parts. Each part is recorded here with the
-- day it was received, and the invoice shows what has come in and what is
-- left. Recording a part changes nothing else: the invoice stays unpaid,
-- aging, revenue, commission and cash flow are untouched, until somebody
-- marks the invoice paid exactly as before. Approved by the CEO 20-10-2026.
-- A recorded part is never deleted. It is voided, with who, when and why.
-- received_on is a Malaysian calendar date, YYYY-MM-DD.

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  received_on TEXT NOT NULL,
  method TEXT,
  reference TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at TEXT,
  voided_by INTEGER,
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON invoice_payments (invoice_id, voided_at);
