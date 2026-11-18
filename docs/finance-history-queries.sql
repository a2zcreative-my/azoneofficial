-- Finance historical reconciliation, 01-06-2026 to today - READ ONLY (SELECT only). Cloudflare -> D1 -> azoneofficial -> Console. Run each query, send the tables back. (docs/FINANCE-HISTORY-GATE.md)
-- Q1 invoices issued, amount and outstanding, by month and company (void excluded)
SELECT substr(date(d.created_at,'+8 hours'),1,7) AS month, COALESCE(d.issuer_code,'azoo') AS company,
       COUNT(*) AS invoices, SUM(d.total_cents)/100.0 AS invoiced_rm,
       SUM(CASE WHEN d.payment_status = 'paid' THEN 0 ELSE d.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0) END)/100.0 AS outstanding_rm
  FROM sales_documents d
 WHERE d.doc_type = 'INV' AND COALESCE(d.payment_status,'') != 'void' AND date(d.created_at,'+8 hours') >= '2026-06-01'
 GROUP BY 1, 2 ORDER BY 1, 2;
-- Q2 receipts by month PAID and company: verified (Money In) vs awaiting
WITH inv AS (
  SELECT COALESCE(d.issuer_code,'azoo') AS co, substr(date(COALESCE(d.paid_at,d.created_at),'+8 hours'),1,7) AS m,
         d.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = d.id AND p.voided_at IS NULL), 0) AS amt,
         EXISTS (SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id = d.id AND k.revoked_at IS NULL) AS ver
    FROM sales_documents d WHERE d.doc_type = 'INV' AND d.payment_status = 'paid'),
part AS (
  SELECT COALESCE(d.issuer_code,'azoo') AS co, substr(p.received_on,1,7) AS m, p.amount_cents AS amt,
         (EXISTS (SELECT 1 FROM invoice_payment_reports x WHERE x.payment_id = p.id AND x.state = 'verified')
          OR (d.payment_status = 'paid' AND EXISTS (SELECT 1 FROM invoice_paid_confirmations k WHERE k.invoice_id = d.id AND k.revoked_at IS NULL))) AS ver
    FROM invoice_payments p JOIN sales_documents d ON d.id = p.invoice_id AND d.doc_type = 'INV' WHERE p.voided_at IS NULL)
SELECT m AS month, co AS company,
       SUM(CASE WHEN ver THEN amt ELSE 0 END)/100.0 AS verified_rm, SUM(CASE WHEN ver THEN 1 ELSE 0 END) AS verified_n,
       SUM(CASE WHEN ver THEN 0 ELSE amt END)/100.0 AS awaiting_rm, SUM(CASE WHEN ver THEN 0 ELSE 1 END) AS awaiting_n
  FROM (SELECT co, m, amt, ver FROM inv WHERE amt > 0 UNION ALL SELECT co, m, amt, ver FROM part)
 WHERE m >= '2026-06' GROUP BY 1, 2 ORDER BY 1, 2;
-- Q3 cash-book movements (not invoice rows, not transfers, not reversed) by month, kind and company
SELECT substr(COALESCE(c.effective_date, c.entry_date),1,7) AS month, c.type,
       COALESCE(b.company, mb.company, c.company, 'UNASSIGNED') AS company,
       CASE WHEN c.ref LIKE 'PAYROLL-%' THEN 'payroll' WHEN c.ref LIKE 'CLM-%' THEN 'claims' WHEN c.ref LIKE 'EXP-%' THEN 'expenses'
            WHEN c.ref LIKE 'ELF-%' THEN 'elfia' WHEN c.ref LIKE 'CN-%' THEN 'refunds' WHEN c.ref LIKE 'AGT-%' THEN 'agent payouts'
            WHEN c.ref LIKE 'RECON-%' THEN 'live' ELSE 'manual: ' || COALESCE(c.category,'') END AS kind,
       COUNT(*) AS rows, SUM(c.amount_cents)/100.0 AS rm,
       SUM(CASE WHEN COALESCE(c.bank_id, mk.bank_id) IS NULL THEN 1 ELSE 0 END) AS no_bank_rows
  FROM cashflow_entries c
  LEFT JOIN bank_accounts b ON b.id = c.bank_id
  LEFT JOIN cashbook_marks mk ON mk.item_key = 'CF:' || c.id
  LEFT JOIN bank_accounts mb ON mb.id = mk.bank_id
 WHERE c.ref NOT LIKE 'INV-%' AND c.transfer_id IS NULL AND c.reversal_of IS NULL
   AND c.id NOT IN (SELECT reversal_of FROM cashflow_entries WHERE reversal_of IS NOT NULL)
   AND COALESCE(c.effective_date, c.entry_date) >= '2026-06-01'
 GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
-- Q4 transfers between our own accounts (outside Money In / Out) by month
SELECT substr(COALESCE(effective_date, entry_date),1,7) AS month, type, COUNT(*) AS rows, SUM(amount_cents)/100.0 AS rm
  FROM cashflow_entries WHERE transfer_id IS NOT NULL AND COALESCE(effective_date, entry_date) >= '2026-06-01' GROUP BY 1, 2 ORDER BY 1, 2;
-- Q5 invoice rows the cash book still holds (Finance reads the invoices instead - not counted twice)
SELECT substr(entry_date,1,7) AS month, COUNT(*) AS rows, SUM(amount_cents)/100.0 AS rm
  FROM cashflow_entries WHERE ref LIKE 'INV-%' AND reversal_of IS NULL AND entry_date >= '2026-06-01' GROUP BY 1 ORDER BY 1;
-- Q6 duplicate risks: same day, direction and amount, more than once
SELECT COALESCE(effective_date, entry_date) AS day, type, amount_cents/100.0 AS rm, COUNT(*) AS n, group_concat(ref || ' / ' || COALESCE(description,''), ' | ') AS what
  FROM cashflow_entries WHERE reversal_of IS NULL AND ref NOT LIKE 'INV-%' AND transfer_id IS NULL AND COALESCE(effective_date, entry_date) >= '2026-06-01'
 GROUP BY 1, 2, amount_cents HAVING COUNT(*) > 1 ORDER BY 1;
-- Q7 receipts that cannot be dated or have no payment reference (missing supporting evidence)
SELECT d.doc_number, COALESCE(d.issuer_code,'azoo') AS company, d.total_cents/100.0 AS rm, date(COALESCE(d.paid_at,d.created_at),'+8 hours') AS paid_day,
       CASE WHEN TRIM(COALESCE(d.payment_ref,'')) = '' THEN 'no payment reference' ELSE '' END AS gap
  FROM sales_documents d WHERE d.doc_type = 'INV' AND d.payment_status = 'paid' AND TRIM(COALESCE(d.payment_ref,'')) = ''
   AND date(COALESCE(d.paid_at,d.created_at),'+8 hours') >= '2026-06-01' ORDER BY paid_day;
