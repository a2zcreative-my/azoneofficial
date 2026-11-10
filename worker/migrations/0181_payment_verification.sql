-- 0181 - Sales payment verification (v1.272.0).
--
-- The CEO, 10-11-2026 (claude/PAYMENT-VERIFICATION-AUDIT.md, answers P1 to P9
-- all as recommended): the COO, CCO and sales staff REPORT a payment with its
-- proof, and every payment needs the CEO verification before it is money.
--
-- ADDITIVE ONLY. Two new tables, no existing table, column or row changes.
--
-- invoice_payment_reports holds what a person reported. It is not money: a
-- report becomes money only when the CEO verifies it, and then the server
-- writes ONE row into invoice_payments (0140), the existing payment record,
-- and links it here (payment_id, unique). A rejected report never reaches
-- invoice_payments. When verified payments reach the invoice total the
-- server marks the invoice paid the existing way.
--
-- invoice_payment_events is the payment timeline. Rows are only added, never
-- changed or removed (two triggers refuse it). event_key, when set, is
-- unique, so a retried step writes its event once.
--
-- state: reported, evidence_checked, clarify, verified, rejected, reversed.
-- issuer_code: the company of the invoice when it was reported (a2z or azoo).
-- Amounts in sen (whole cents). received_on is a Malaysian date, YYYY-MM-DD.

CREATE TABLE IF NOT EXISTS invoice_payment_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  issuer_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  received_on TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  note TEXT,
  ref_key TEXT,
  over_cents INTEGER NOT NULL DEFAULT 0,
  dup_of INTEGER,
  proof_key TEXT,
  proof_type TEXT,
  state TEXT NOT NULL DEFAULT 'reported',
  reported_by INTEGER NOT NULL,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_by INTEGER,
  evidence_at TEXT,
  evidence_note TEXT,
  question TEXT,
  answer TEXT,
  decided_by INTEGER,
  decided_at TEXT,
  verify_method TEXT,
  verified_cents INTEGER,
  bank_id INTEGER,
  dup_reason TEXT,
  reason TEXT,
  payment_id INTEGER,
  reversed_by INTEGER,
  reversed_at TEXT,
  reverse_reason TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_reports_payment
  ON invoice_payment_reports (payment_id) WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pay_reports_invoice
  ON invoice_payment_reports (invoice_id, state);

CREATE INDEX IF NOT EXISTS idx_pay_reports_state
  ON invoice_payment_reports (state, reported_at);

CREATE INDEX IF NOT EXISTS idx_pay_reports_ref
  ON invoice_payment_reports (ref_key);

CREATE TABLE IF NOT EXISTS invoice_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  report_id INTEGER,
  event TEXT NOT NULL,
  actor_id INTEGER,
  amount_cents INTEGER,
  detail TEXT,
  event_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_events_key
  ON invoice_payment_events (event_key) WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pay_events_invoice
  ON invoice_payment_events (invoice_id, id);

CREATE TRIGGER IF NOT EXISTS invoice_payment_events_no_update BEFORE UPDATE ON invoice_payment_events
BEGIN SELECT RAISE(ABORT, 'Payment history is append only'); END;

CREATE TRIGGER IF NOT EXISTS invoice_payment_events_no_delete BEFORE DELETE ON invoice_payment_events
BEGIN SELECT RAISE(ABORT, 'Payment history is append only'); END;
