-- 0051: Claim payee (v1.4.173)
-- When HR raises a claim on behalf of a staff member, the CEO needs to know
-- WHO to actually pay. Internal remark only — never printed on the claim
-- form; visible to the CEO/admin tier (payment) and hr_admin (records).
-- No FOREIGN KEY by house rule — user referenced by id + LEFT JOIN.
ALTER TABLE claims ADD COLUMN payee_user_id INTEGER;
