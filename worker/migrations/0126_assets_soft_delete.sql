-- 0126 - v1.153.0: an asset entered by mistake can be removed.
--
-- The CEO, 11-09-2026, on the register: need to have an option to delete if
-- there is a typo error there or amendment require to fill new one.
--
-- The rule since 0058 stands - an asset that EXISTED is never deleted, it is
-- marked lost or disposed so the history stays. This is for the row that
-- never described a real thing: a tag typed twice, a locker entered as a
-- laptop. Soft, like every other removal in the portal - the row keeps its
-- id and its audit trail, the register stops showing it, and the tag is
-- freed so the corrected entry can take it.
--
-- Two ALTERs, one logical change, one table, ADD COLUMN cannot fail on data.
ALTER TABLE assets ADD COLUMN deleted_at TEXT;
ALTER TABLE assets ADD COLUMN deleted_by INTEGER;
