-- 0055: In-app enquiry replies (v1.4.191)
-- Staff answer inside the portal; the customer reads the reply on /account
-- instead of only a status word.
ALTER TABLE enquiries ADD COLUMN reply TEXT;
ALTER TABLE enquiries ADD COLUMN replied_by INTEGER;
ALTER TABLE enquiries ADD COLUMN replied_at TEXT;
