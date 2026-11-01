-- 0162 - Signatures and stamps per person and per company, release 1.248.0.
-- The owner brief of 01-11-2026 and his answers in
-- claude/SIGNATURES-AUDIT.md: a signature belongs to a PERSON, is used only
-- after that person confirms it and the owner approves it, a company stamp is
-- its own asset per company, signing authority is granted per company and
-- per document type, and an issued document keeps the exact assets it was
-- signed with. Sales documents only - leave and claim forms keep the role
-- chops of 0118. Additive only - new nullable columns on signature_assets
-- three new tables and one new nullable column on quotation_approvals, no
-- existing row changed.
-- signature_assets gains: user_id (the person, NULL for the 0118 role chops),
-- kind (signature or stamp, NULL for the role chops), status (pending,
-- active, retired - NULL for the role chops, which keep their 0118 rules),
-- consented_at (the person confirmed it is their signature, with their
-- authenticator code), approved_by and approved_at (the owner approved it,
-- with his), note.
ALTER TABLE signature_assets ADD COLUMN user_id INTEGER;
ALTER TABLE signature_assets ADD COLUMN kind TEXT;
ALTER TABLE signature_assets ADD COLUMN status TEXT;
ALTER TABLE signature_assets ADD COLUMN consented_at TEXT;
ALTER TABLE signature_assets ADD COLUMN approved_by INTEGER;
ALTER TABLE signature_assets ADD COLUMN approved_at TEXT;
ALTER TABLE signature_assets ADD COLUMN note TEXT;
CREATE INDEX IF NOT EXISTS idx_signature_assets_user ON signature_assets (user_id, issuer_code, status);
-- signing_authorities: who may PREPARE (sign as the preparer) or APPROVE a
-- document, for one company, for the document types listed (comma list of
-- QT, INV, DO). Append-only: a change is a new row, a removal sets
-- revoked_at. Never inferred from a job title.
CREATE TABLE IF NOT EXISTS signing_authorities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  issuer_code TEXT    NOT NULL,
  capacity    TEXT    NOT NULL CHECK (capacity IN ('prepare', 'approve')),
  doc_types   TEXT    NOT NULL,
  granted_by  INTEGER,
  granted_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  reason      TEXT,
  revoked_at  TEXT,
  revoked_by  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_signing_authorities_user ON signing_authorities (user_id, issuer_code, capacity, revoked_at);
-- signing_policies: one row per company, written by the owner. personal = 1
-- switches that company sales documents from the 0118 role chops to the
-- personal signatures (until then nothing changes on a document). stamp_on
-- lists the document types the stamp may appear on. Whether a quotation
-- needs an approval stays the one rule of 0144 (the CEO approval limit).
CREATE TABLE IF NOT EXISTS signing_policies (
  issuer_code          TEXT PRIMARY KEY,
  personal             INTEGER NOT NULL DEFAULT 0 CHECK (personal IN (0, 1)),
  stamp_on             TEXT    NOT NULL DEFAULT '',
  updated_by           INTEGER,
  updated_at           TEXT
);
-- quotation_approvals (0144) gains the approver signature asset used when a
-- personal-signing company approves - the approval and its signature are one
-- row, never a second approval table.
ALTER TABLE quotation_approvals ADD COLUMN signature_asset_id INTEGER;
-- document_issuances: the moment a revision is first shared or printed -
-- the preparer, approver and stamp assets it carries are fixed here, with a
-- SHA-256 of the document content, so a later signature replacement never
-- changes what was issued. One per revision. Append-only.
CREATE TABLE IF NOT EXISTS document_issuances (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id             INTEGER NOT NULL,
  revision           INTEGER NOT NULL DEFAULT 0,
  issuer_code        TEXT,
  preparer_id        INTEGER,
  preparer_asset_id  INTEGER,
  approver_id        INTEGER,
  approver_asset_id  INTEGER,
  stamp_asset_id     INTEGER,
  content_sha256     TEXT,
  issued_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  issued_by          INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_issuances_once ON document_issuances (doc_id, revision);
CREATE TRIGGER IF NOT EXISTS document_issuances_no_update BEFORE UPDATE ON document_issuances
BEGIN SELECT RAISE(ABORT, 'an issued document keeps its signatures'); END;
CREATE TRIGGER IF NOT EXISTS document_issuances_no_delete BEFORE DELETE ON document_issuances
BEGIN SELECT RAISE(ABORT, 'an issued document keeps its signatures'); END;
-- The 0118 role chops (kind NULL) stay exactly as uploaded - nothing here
-- or anywhere changes one, and the database refuses it.
CREATE TRIGGER IF NOT EXISTS signature_assets_role_rows_frozen BEFORE UPDATE ON signature_assets
WHEN OLD.kind IS NULL
BEGIN SELECT RAISE(ABORT, 'a role signature is kept as it was uploaded'); END;
