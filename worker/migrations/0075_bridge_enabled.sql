-- 0075 — v1.39.0: which items the ELFIA bridge publishes.
--
-- AUDIT B4 rule (AUDIT-2026-08-22.md): a migration file carries AT MOST ONE
-- non-idempotent statement, and nothing after it. SQLite has no
-- ADD COLUMN IF NOT EXISTS, so a half-applied multi-statement file replays
-- from the top, dies on "duplicate column", and — because deploy-api.sh runs
-- under set -e — wedges every future API deploy. One ALTER per file means a
-- half-apply IS a no-apply, and the replay always succeeds.
--
-- The flag replaces the old ELFIA%/LUMI% SKU-prefix LIKE: renaming a SKU
-- must not silently add or drop a product from a client-facing shop.

ALTER TABLE inventory_items ADD COLUMN bridge_enabled INTEGER NOT NULL DEFAULT 0;
