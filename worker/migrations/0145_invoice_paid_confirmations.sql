-- 0145 - the CEO or COO confirmation that the money of an invoice is real
-- (the owner, Payroll 2.0 brief, 28-10-2026: only an authorized CEO or COO
-- may confirm the Paid status after payment verification. His answers: CEO,
-- COO and super admin confirm, and commission counts only on an invoice paid
-- in full and confirmed).
--
-- Recording a payment stays where it is (sales_documents.payment_status,
-- invoice_payments). This table is the second, separate step: who checked
-- the money, how much, when, and against which reference. It never changes
-- an invoice. A confirmation is revoked with a stamp and a reason, never
-- deleted, and an invoice has at most ONE live confirmation (the partial
-- unique index), so a retried request cannot confirm it twice.

CREATE TABLE IF NOT EXISTS invoice_paid_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment_ref TEXT,
  paid_at TEXT,
  confirmed_by INTEGER NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by INTEGER,
  revoke_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_confirm_live
  ON invoice_paid_confirmations (invoice_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_paid_confirm_when
  ON invoice_paid_confirmations (confirmed_at);
