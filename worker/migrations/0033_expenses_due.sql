-- v1.4.88: recurring expenses + payment due tracking. A recurring expense
-- (rent, internet, printer rental …) recorded once reappears in later months
-- as "due" until recorded; due_day + paid_at let the CEO/COO see what must
-- be paid before its due date, payroll-style.
ALTER TABLE expenses ADD COLUMN recurring INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN due_day INTEGER;
ALTER TABLE expenses ADD COLUMN paid_at TEXT;
