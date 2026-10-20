-- 0139 - a quotation can be revised in place.
--
-- A customer asks for one more item after the quotation has gone out. The
-- quotation keeps its number and gains a revision count, and the version
-- the customer was holding is kept in sales_document_revisions as it was,
-- so the earlier figure can still be shown and printed.
-- revision counts the revisions issued, 0 for an original.
-- revised_at is when the latest revision was issued, in Malaysia time
-- because it is printed as the revision date. NULL for an original.
-- snapshot is the whole document row, as JSON, exactly as it stood before
-- that revision replaced it. One row per replaced version.

ALTER TABLE sales_documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_documents ADD COLUMN revised_at TEXT;

CREATE TABLE IF NOT EXISTS sales_document_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  replaced_at TEXT NOT NULL DEFAULT (datetime('now')),
  replaced_by INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_revisions_once
  ON sales_document_revisions (doc_id, revision);
