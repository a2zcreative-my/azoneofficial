#!/usr/bin/env node
/**
 * DATA PRE-FLIGHT FOR A MIGRATION - v1.242.0 (go-live Release B, decision D-2).
 *
 * Run by PUSH.bat from the worker folder, right before
 * `wrangler d1 migrations apply`. It reads production (read-only: one SELECT
 * per check through `wrangler d1 execute --remote --json`) and STOPS the
 * release when a pending migration could not be applied to the data as it
 * stands - so the deploy never half-lands with the migration failed and the
 * worker published.
 *
 * Checks (one per migration that needs one):
 *   0157_invoice_void_once  the partial unique index ux_inv_live_per_qt
 *                           allows one live invoice per quotation. Any
 *                           quotation that already has two or more invoices
 *                           would make CREATE UNIQUE INDEX fail. Every such
 *                           pair is printed; the CEO decides which one goes
 *                           (on the live 1.241.0 worker an unpaid duplicate
 *                           is deleted from Sales -> Documents, audited) and
 *                           runs PUSH.bat again.
 *
 * A check whose migration is already applied is skipped (the ledger says so).
 * `--skip-data-preflight` is an explicit, logged override.
 *
 *   node scripts/migration-preflight.mjs            (cwd: worker/)
 */
import { wrangler, releaseLog } from "./wrangler-exec.mjs";

const args = process.argv.slice(2);
const DB = "azoneofficial";
const skip = args.includes("--skip-data-preflight");

/* v1.244.0 (fix) - wrangler is run without a shell (scripts/wrangler-exec.mjs):
   `execFileSync("npx.cmd", ...)` is refused by Node on Windows (EINVAL),
   which stopped PUSH.bat here on 31-10-2026 before anything was applied. */
function d1(sql) {
  const r = wrangler(["d1", "execute", DB, "--remote", "--json", "--command", sql], { stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const all = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
    const text = /"text":\s*"((?:[^"\\]|\\.)*)"/.exec(all)?.[1]
      ?? all.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/WARNING|^[{}\[\]]+$/.test(l)).slice(-2).join(" | ");
    throw new Error(`wrangler exit ${r.status}: ${text}`);
  }
  const out = String(r.stdout).replace(/\x1b\[[0-9;]*m/g, "");
  /* the JSON array starts a line; a notice before it ("[WARNING] ...",
     an update banner) must not be taken for it */
  const m = /^\s*\[\s*(\{|\])/m.exec(out);
  if (!m) throw new Error(`wrangler returned no JSON: ${out.trim().split("\n").slice(-2).join(" | ")}`);
  const start = m.index + m[0].indexOf("[");
  const parsed = JSON.parse(out.slice(start));
  return parsed?.[0]?.results ?? [];
}

const CHECKS = [
  {
    migration: "0157_invoice_void_once",
    name: "one live invoice per quotation (ux_inv_live_per_qt)",
    sql: `SELECT i.converted_from AS quotation_id, q.doc_number AS quotation, GROUP_CONCAT(i.doc_number, ', ') AS invoices, COUNT(*) AS n
            FROM sales_documents i LEFT JOIN sales_documents q ON q.id = i.converted_from
           WHERE i.doc_type = 'INV' AND i.converted_from IS NOT NULL AND COALESCE(i.payment_status, '') != 'void'
           GROUP BY i.converted_from HAVING COUNT(*) > 1`,
    explain: (rows) => [
      `${rows.length} quotation(s) have more than one invoice. Migration 0157 creates a UNIQUE index that allows one live invoice per quotation, so it cannot be applied until each pair is resolved:`,
      ...rows.map((r) => `   - ${r.quotation ?? `QT #${r.quotation_id}`}: ${r.invoices}`),
      "   The CEO decides which invoice of each pair stands. On the current worker an UNPAID duplicate can be deleted from Sales -> Documents (audited); a paid one needs a credit note. Then run PUSH.bat again.",
    ],
  },
];

if (skip) {
  console.warn("[!] data pre-flight skipped by the caller (--skip-data-preflight)");
  process.exit(0);
}

let applied = new Set();
try {
  applied = new Set(d1(`SELECT name FROM d1_migrations`).map((r) => String(r.name)));
} catch (e) {
  console.error(`\n[X] DATA PRE-FLIGHT FAILED: could not read the migration ledger (${String(e).split("\n")[0]})`);
  console.error("    The full message is in backups\\release-log.txt. Nothing was applied or published.");
  releaseLog(`pre-flight FAILED reading the ledger: ${String(e).split("\n")[0]}`);
  process.exit(1);
}

let failed = false;
for (const c of CHECKS) {
  if ([...applied].some((n) => n.startsWith(c.migration))) { console.log(`[ok] ${c.migration} already applied - ${c.name}: nothing to check`); continue; }
  let rows;
  try { rows = d1(c.sql); } catch (e) {
    console.error(`\n[X] DATA PRE-FLIGHT FAILED: the check for ${c.migration} could not run (${String(e).split("\n")[0]})`);
    failed = true; continue;
  }
  if (rows.length === 0) { console.log(`[ok] ${c.migration} - ${c.name}: the data allows it`); continue; }
  failed = true;
  console.error(`\n[X] DATA PRE-FLIGHT FAILED before ${c.migration}:`);
  for (const line of c.explain(rows)) console.error(`    ${line}`);
}
if (failed) { releaseLog("pre-flight FAILED (see above)"); console.error("\n    Nothing was deployed and no migration was applied."); process.exit(1); }
releaseLog("pre-flight passed");
console.log("[ok] data pre-flight passed");
