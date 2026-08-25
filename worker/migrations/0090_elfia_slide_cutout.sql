-- 0090 ELFIA slide cut-out (v1.50.0)
-- A carousel slide can carry a second picture: the model with her background
-- removed, drawn over the banner and rising above its top edge so she
-- appears to step out of it.
-- cutout_key        uploads/elfia/slides/cut-... the PNG itself
-- cutout_updated_at the store re-download gate, like image_updated_at
-- cutout_side       left or right, which end she stands at
-- cutout_scale      her height as a per cent of the banner, 100 to 160
-- Optional: without a cut-out the slide draws exactly as before.
-- Full rationale lives in CHANGELOG.md 1.50.0. Keep migrations plain ASCII
-- with no quotes or semicolons inside comments: the remote D1 API rejects
-- some files with "SQL code did not contain a statement", and
-- tests/migration-safety.mjs now enforces the rule.

ALTER TABLE elfia_slides ADD COLUMN cutout_key TEXT;

ALTER TABLE elfia_slides ADD COLUMN cutout_updated_at TEXT;

ALTER TABLE elfia_slides ADD COLUMN cutout_side TEXT NOT NULL DEFAULT 'right';

ALTER TABLE elfia_slides ADD COLUMN cutout_scale INTEGER NOT NULL DEFAULT 118;
