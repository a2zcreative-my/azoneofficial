-- 0089 ELFIA slide zoom (v1.48.0)
-- One number replaces the crop/no-crop switch on a carousel slide.
-- zoom is a per cent: 100 means the whole photo fits inside the shop banner
-- with nothing cut off, and higher values grow it so the banner crops.
-- Applied as a CSS transform on the store side, so the file is never
-- re-encoded and re-framing costs nothing.
-- The older fit column stays and is kept in step by the writer, so a store
-- that has not learned about zoom still behaves sensibly.
-- Full rationale lives in CHANGELOG.md 1.48.0. Keep migrations plain ASCII
-- with no quotes or semicolons inside comments: the remote D1 API rejects
-- some files with "SQL code did not contain a statement", and
-- tests/migration-safety.mjs now enforces the rule.

ALTER TABLE elfia_slides ADD COLUMN zoom INTEGER NOT NULL DEFAULT 100;
