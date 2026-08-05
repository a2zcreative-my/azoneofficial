-- v1.4.213: HR profile fields the record was missing (CEO: "insert another
-- details which is important"): emergency contact + home address for duty
-- of care, and the statutory numbers payroll will need the moment the
-- pending KWSP/SOCSO registration completes.
ALTER TABLE users ADD COLUMN address TEXT;
ALTER TABLE users ADD COLUMN emergency_name TEXT;
ALTER TABLE users ADD COLUMN emergency_phone TEXT;
ALTER TABLE users ADD COLUMN emergency_relation TEXT;
ALTER TABLE users ADD COLUMN epf_no TEXT;
ALTER TABLE users ADD COLUMN socso_no TEXT;
ALTER TABLE users ADD COLUMN tax_no TEXT;
