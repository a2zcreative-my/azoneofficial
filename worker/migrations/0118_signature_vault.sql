-- 0118 - v1.127.0 - the signature vault gets the two dimensions it was missing.
--
-- THE BUG THIS FIXES, in one sentence: every document already knows which
-- legal entity issued it, and the signature vault did not.
--
-- migration 0073 put issuer_code on all six document tables, and every
-- renderer resolves the letterhead, the registration number, the registered
-- address and the bank account from it. The vault was keyed by ROLE alone --
-- private/signatures/ceo-sign.png, five files. One CEO chop for two
-- companies. So re-printing a legacy AZ ONE invoice produced AZ ONE
-- letterhead, AZ ONE bank account and the A2Z-era stamp: a document that
-- contradicts itself, carrying the wrong entity name on the chop of the
-- entity that is liable for it.
--
-- The second missing dimension is VERSION, and it is the same bug. A key with
-- no dimensions can only ever hold the current file, so replacing a chop
-- silently changed every document already issued and approved under the old
-- one. A signature that changes after the fact is not a signature.
--
-- WHY THERE IS NO NEW COLUMN ON THE SIX DOCUMENT TABLES.
-- The obvious design records, per document, which asset signed it. It needs
-- six ALTERs, a backfill nobody can compute honestly for rows signed before
-- this table existed, and a write on every approval path. Instead the vault
-- is resolved TEMPORALLY: for a document issued at time T, the signature is
-- the newest version of that entity+role uploaded at or before T. That is a
-- pure function of data every row already carries, it needs no backfill, and
-- it gives "old documents keep the version they were signed with" for free --
-- upload v3 tomorrow and the approval from yesterday still resolves to v2, because
-- v3 did not exist when it was signed.
--
-- Rows here are APPEND-ONLY. Nothing updates r2_key and nothing deletes a
-- version: an old document must be able to resolve its own chop forever.
-- retired_at marks a chop as no longer offered for NEW documents (a resigned
-- officer, a compromised scan) without removing it from the ones it signed.

CREATE TABLE IF NOT EXISTS signature_assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Values a2z or azoo -- the same codes as documents.issuer_code (0073).
  issuer_code TEXT    NOT NULL,
  -- ceo, coo, cco, hr_admin, sales_marketing -- the app role, underscored.
  role        TEXT    NOT NULL,
  -- 1, 2, 3 ... per entity+role. Never reused, never renumbered.
  version     INTEGER NOT NULL,
  -- private R2 object key. Immutable once written.
  r2_key      TEXT    NOT NULL,
  -- SHA-256 of the PNG bytes, so a swapped object in R2 is detectable.
  sha256      TEXT,
  uploaded_by INTEGER,
  -- The instant this chop became the current one. THIS is what temporal
  -- resolution compares a document date against, so it is never rewritten.
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Set when the chop stops being offered for NEW documents. Documents
  -- already signed with it still resolve to it.
  retired_at  TEXT
);

-- One row per entity+role+version, so a double upload cannot create two
-- version 2s that resolve differently on two different days.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signature_assets_ver
  ON signature_assets (issuer_code, role, version);

-- The resolution query: newest uploaded_at at or before the document date,
-- for one entity and one role.
CREATE INDEX IF NOT EXISTS idx_signature_assets_at
  ON signature_assets (issuer_code, role, uploaded_at);
