-- 0070 (v1.9.0): selfie clock-in. The punch can carry a selfie stored in R2
-- under private/attendance/ (owner + HR/management can view). Optional —
-- a punch without a selfie stays valid.
ALTER TABLE attendance_records ADD COLUMN selfie_key TEXT;
