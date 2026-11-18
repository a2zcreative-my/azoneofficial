-- v1.368.0 - Live Reports test data for a LOCAL worker only (tests/browser/live-e2e.mjs).
-- Real-shaped, invented for the test database - never loaded into production.
INSERT OR IGNORE INTO customers (id, company, created_at) VALUES (501, 'ELFIA Official', datetime('now')), (502, 'AZ ONE Financing', datetime('now'));
INSERT OR IGNORE INTO sales_documents (id, doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents, created_at, delivery_cents, revision, issuer_code)
  VALUES (601, 'QT', 'QT-TEST-601', 501, '[]', 0, 0, 100000, datetime('now'), 0, 0, 'a2z'),
         (602, 'QT', 'QT-TEST-602', 502, '[]', 0, 0, 100000, datetime('now'), 0, 0, NULL);
INSERT OR IGNORE INTO projects (id, quotation_id, customer_id, status, title, version, created_at, updated_at)
  VALUES (701, 601, 501, 'in_progress', 'ELFIA Official - Live Selling', 1, datetime('now'), datetime('now')),
         (702, 602, 502, 'in_progress', 'AZ ONE Financing - Live', 1, datetime('now'), datetime('now')),
         (703, 601, 501, 'completed', 'ELFIA Old Campaign', 1, datetime('now'), datetime('now'));
-- a roster live yesterday, hosted by Aisyah (103)
INSERT OR IGNORE INTO live_sessions (id, session_date, start_time, end_time, platform, client_name, host_user_id, status, created_by)
  VALUES (801, date('now', '+8 hours', '-1 day'), '20:00', '21:30', 'tiktok', 'ELFIA Official', 103, 'completed', 101);
