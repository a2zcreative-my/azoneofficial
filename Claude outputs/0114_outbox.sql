-- 0114 - v1.105.0 (roadmap phase 03): the outbox, server side.
--
-- The phone now keeps a write it cannot deliver - a clock-in in a lift, a
-- task ticked in a basement - and sends it when the signal is back
-- (lib/outbox.ts). Two columns of truth have to exist here for that to be
-- safe rather than merely convenient.
--
-- IDEMPOTENCY KEYS. Every queueable write carries a key minted when the
-- button was pressed. The first answer is stored under (key, user) and
-- every later attempt with the same key gets that answer back - the handler
-- does not run. Without this, a request that reached us but whose reply died in
-- the tunnel becomes a second clock-in when the phone replays it. The body is
-- the JSON we answered with, capped at 20 KB in the worker. Keys older than
-- seven days are purged nightly - a phone forgets its queue after 48 hours,
-- so nothing can arrive under a week-old key.
--
-- WHEN IT REALLY REACHED US. A punch sent late is recorded at the time the
-- phone said (created_at) and marked pending for the CEO to approve - his
-- decision, 05-09-2026: nothing lost, nothing trusted blindly. offline_sent_at
-- is the moment it actually arrived, so the register can show BOTH times and
-- the gap between them, and an approver can see that 09:02 was pressed at
-- 09:02 and delivered at 09:41, not typed in at 09:41.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

ALTER TABLE attendance_records ADD COLUMN offline_sent_at TEXT;
