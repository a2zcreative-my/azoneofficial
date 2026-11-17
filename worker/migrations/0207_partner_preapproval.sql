-- v1.354.0 partner applications: the COO / CCO pre-approval (the CEO, 17-11-2026, staff-only partner application management)
-- additive only: two nullable columns on partner_applications (0206). No row, CHECK or trigger changes.
-- A shortlisted application with preapproved_at set reads as Pre-Approved and waits for the final decision of the CEO.
ALTER TABLE partner_applications ADD COLUMN preapproved_by INTEGER REFERENCES users (id);
ALTER TABLE partner_applications ADD COLUMN preapproved_at TEXT;
