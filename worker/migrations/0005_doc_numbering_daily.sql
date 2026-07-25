-- 0005: Date-based document numbering (v1.2.7)
-- New format: {TYPE}{YYYYMMDD}-{NN}-AZOO  e.g. DO20260725-01-AZOO
-- The old yearly doc_counters table stays untouched — legacy numbers
-- (QT202600001) remain valid forever and are never renumbered.

CREATE TABLE IF NOT EXISTS doc_counters_daily (
  doc_type TEXT NOT NULL,
  day TEXT NOT NULL,            -- YYYYMMDD (Asia/Kuala_Lumpur)
  counter INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, day)
);
