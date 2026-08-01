-- 0022: IC number / NRIC (v1.4.51)
--
-- Malaysian identity card number for staff records, printed on the payslip
-- (I/C # row, as on standard MY payslips) and on the staff badge.

ALTER TABLE users ADD COLUMN ic_number TEXT;
