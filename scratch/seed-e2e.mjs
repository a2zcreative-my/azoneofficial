/**
 * Seed the LOCAL e2e database for the ELFIA bridge rigs (v1.51.0).
 *
 * Every rig in scratch/ needs the same three things and, until now, a human
 * had to remember them: a signed-in CEO, a session cookie the rigs already
 * hardcode, and a few inventory items to publish. Wiping .wrangler/state to
 * re-apply migrations therefore broke every rig with an unhelpful
 * "Cannot read properties of undefined". This script puts them back.
 *
 *   cd worker
 *   npx wrangler d1 migrations apply azoneofficial --local --config wrangler.e2e.toml
 *   cd ..
 *   node scratch/seed-e2e.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8300
 *
 * LOCAL ONLY. It writes through `wrangler d1 execute --local`; there is no
 * path in here that can touch the real database, and the password hash is a
 * throwaway that no live account shares.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const WORKER = new URL("../worker", import.meta.url).pathname;
const run = (sql) => execFileSync("npx", [
  "wrangler", "d1", "execute", "azoneofficial", "--local",
  "--config", "wrangler.e2e.toml", "--command", sql,
], { cwd: WORKER, stdio: "pipe" });

/* The rigs send `azone_session=e2etoken`; the worker stores sessions as the
   sha256 of the token, never the token itself. */
const SESSION_ID = createHash("sha256").update("e2etoken").digest("hex");

const statements = [
  `INSERT OR REPLACE INTO users (id, email, password_hash, name, role, is_active, totp_secret)
   VALUES (1, 'ceo@e2e.local', 'x', 'Test', 'ceo', 1, 'E2ETESTSECRET234567')`,

  `INSERT OR REPLACE INTO sessions (id, user_id, expires_at)
   VALUES ('${SESSION_ID}', 1, datetime('now', '+30 days'))`,

  `INSERT OR IGNORE INTO inventory_items (sku, name, stock, status, unit_price_cents, bridge_enabled, elfia_category, elfia_description)
   VALUES ('LUMI 001', 'Bawal Premium — Dusty Rose', 24, 'in_stock', 4900, 1, 'bawal',
           'Soft rose gradient with pearl-white flow lines. Lightweight, opaque, holds its shape all day.')`,

  `INSERT OR IGNORE INTO inventory_items (sku, name, stock, status, unit_price_cents, bridge_enabled, elfia_category, elfia_description)
   VALUES ('SHWL 001', 'Shawl Premium — Beige', 8, 'in_stock', 5500, 1, 'shawl',
           'Long-cut, lightweight and opaque. Finished by hand.')`,

  `INSERT OR IGNORE INTO inventory_items (sku, name, stock, status, unit_price_cents, bridge_enabled, elfia_category)
   VALUES ('SHWL 002', 'Shawl Premium — Taupe', 5, 'in_stock', 5500, 1, 'shawl')`,
];

for (const sql of statements) run(sql);

console.log(`seeded: ceo user 1, session e2etoken (${SESSION_ID.slice(0, 12)}…), 3 inventory items`);
