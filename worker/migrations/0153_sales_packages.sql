-- 0153: Sales packages - a library of service packages for quotations
-- (v1.231.0, the Sales Packages brief from the owner and his answers,
-- 30-10-2026, claude/SALES-PACKAGES-AUDIT.md: managers CEO, COO, CCO and
-- super admin, service lines only, prices editable on the quotation and
-- flagged customized, "Build it"). Additive only: two new tables and three
-- nullable columns, no existing row is changed.
--
-- sales_packages - one row per package. issuers lists the legal entities it
-- may be quoted under (a2z, azoo or both, comma separated). status is draft,
-- active or archived. current_version points at its newest version.
--
-- sales_package_versions - the lines of a package as they were at one
-- version, written once and never edited. items is the same JSON line shape a
-- quotation stores (name, qty, unit_price_cents, uom, disc_cents, sub).
-- Changing the lines or prices writes the next version.
--
-- sales_documents.package_id, package_version, package_customized - which
-- package and version a quotation was made from, and whether its lines
-- differ from that version. The quotation keeps its own lines as before, so
-- a later change to a package never changes a saved document.

CREATE TABLE IF NOT EXISTS sales_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  notes TEXT,
  kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service')),
  issuers TEXT NOT NULL DEFAULT 'a2z',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_package_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  items TEXT NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (package_id, version)
);

CREATE INDEX IF NOT EXISTS idx_sales_packages_status ON sales_packages (status);

ALTER TABLE sales_documents ADD COLUMN package_id INTEGER;
ALTER TABLE sales_documents ADD COLUMN package_version INTEGER;
ALTER TABLE sales_documents ADD COLUMN package_customized INTEGER;

CREATE INDEX IF NOT EXISTS idx_docs_package ON sales_documents (package_id);
