-- 0052: Enquiry category (v1.4.181)
-- Customers pick what their enquiry is about (package & pricing, live
-- commerce services, order & delivery, collaboration, general) so staff
-- triage at a glance.
ALTER TABLE enquiries ADD COLUMN category TEXT;
