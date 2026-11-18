-- v1.371.0 one reference for every public form (the CEO, 18-11-2026)
-- A2Z-DDMM then the running number of that Malaysia day, shared by /apply/business and /apply/partner,
-- so two records never carry the same reference. additive only - one new table, nothing existing changes.
CREATE TABLE IF NOT EXISTS public_ref_counters (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
