-- v1.21.0 — seed the office geofence (AZ ONE HQ).
--
-- The CEO supplied the coordinates (1.544418427439, 103.71003343205108) and
-- chose "allow but flag" enforcement: with a fence configured, every punch
-- REQUIRES location (anti-cheating), and staff punches outside the radius are
-- recorded but flagged "outside office" in management views. CEO/COO/CCO are
-- exempt from the flag; their location is still captured.
--
-- This deliberately reverses the earlier "never auto-seed" decision
-- (SHELL-DECISION-HISTORY): under the old semantics a seeded fence would have
-- LOCKED staff out; under allow-but-flag it cannot lock anyone out, so
-- seeding just turns the location requirement + flags on out of the box.
-- The fence stays editable/clearable in Users → Office geofence.
--
-- INSERT OR IGNORE: idempotent, and a fence the CEO already set wins.
INSERT OR IGNORE INTO system_meta (key, value) VALUES (
  'attendance_geofence',
  '{"lat":1.544418427439,"lng":103.71003343205108,"radius_m":120,"label":"AZ ONE HQ"}'
);
