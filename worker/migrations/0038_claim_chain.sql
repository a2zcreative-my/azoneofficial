-- v1.4.106: role-based claim approval chains (mirrors the leave chain).
--   marketing / sales_marketing / editor / live_host:
--     HR review -> COO pre-approval -> CEO final
--   hr_admin: CCO pre-approval -> CEO final
--   coo / cco: CEO final only
-- Tracked as dated stamps; status stays pending until the CEO decides.
-- No foreign keys by policy — reference by id + LEFT JOIN.
ALTER TABLE claims ADD COLUMN hr_reviewed_by INTEGER;
ALTER TABLE claims ADD COLUMN hr_reviewed_at TEXT;
ALTER TABLE claims ADD COLUMN pre_approved_by INTEGER;
ALTER TABLE claims ADD COLUMN pre_approved_at TEXT;
