-- Existing partial days remain unresolved until reviewed by management
ALTER TABLE leave_requests ADD COLUMN day_part TEXT CHECK (day_part IN ('full', 'first_half', 'second_half'));
ALTER TABLE leave_requests ADD COLUMN coverage_json TEXT;
