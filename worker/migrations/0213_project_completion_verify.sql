-- v1.382.0 - the project completion chain (the CEO, 18-11-2026).
-- A project that a staff member says is done is pre-verified by the COO or CCO,
-- then confirmed by the CEO. A request by the COO or CCO goes straight to the CEO.
-- The CEO completes a project directly. The request already has its columns
-- (0159 completion_requested_at and completion_requested_by) and this adds the verification.
-- Additive: two nullable columns, nothing rewritten.
ALTER TABLE projects ADD COLUMN completion_verified_at TEXT;
ALTER TABLE projects ADD COLUMN completion_verified_by INTEGER;
