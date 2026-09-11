/**
 * A TYPO LEAVES THE REGISTER; A THING THAT EXISTED NEVER DOES — guard #75,
 * v1.153.0.
 *
 * The CEO, 11-09-2026, on the asset register: *"need to have an option to
 * delete if there is a typo error there or amendment require to fill new
 * one"*. Since 0058 the register had no delete at all - a real asset is
 * marked lost or disposed so its history stays - which left no way out for
 * a row that never described a real thing.
 *
 * THE PROPERTIES, not the implementation:
 *   1. THE REMOVAL IS SOFT. The row keeps its id; deleted_at and deleted_by
 *      are set (0126); no DELETE FROM assets anywhere.
 *   2. IT IS AUDITED WITH THE WHOLE RECORD, so a removed typo can be read
 *      back - the tag, a reason, and the row as it was.
 *   3. THE TAG IS FREED. asset_tag is UNIQUE; the corrected entry must be
 *      able to take the tag the typo held. The removed row's tag is suffixed
 *      and the original is in the audit snapshot.
 *   4. THE REGISTER, THE SEARCH AND THE WARRANTY WATCHER STOP SEEING IT -
 *      and all three still answer on a database that has not applied 0126
 *      (the deploy-before-migrate window).
 *   5. IT IS THE REGISTER-KEEPER'S POWER (hr_manage - the tier that creates
 *      and edits), it asks first, and both outcomes toast.
 *   6. IT IS NOT A SECOND WAY TO RETIRE A REAL ASSET: the dialog says lost
 *      and disposed remain what they are, and the card text says so too.
 *   7. THE MIGRATION IS REGISTERED THE HOUSE WAY (triple bump).
 *
 * Negative-tested by: a hard DELETE FROM assets (1); dropping the snapshot
 * from the audit (2); not suffixing the tag (3); dropping the fallback read
 * in the register (4); opening the route to exec_view (5); removing the
 * "lost or disposed" sentence from the dialog (6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const watchers = read("worker/src/watchers.ts");
const search = read("worker/src/search.ts");
const panel = read("components/portal/assets-panel.tsx");
const migration = read("worker/migrations/0126_assets_soft_delete.sql");

const route = staff.slice(staff.indexOf('if (assetPatch && method === "DELETE")'), staff.indexOf('if (assetPatch && method === "DELETE")') + 2200);

/* ---- 1. soft ---- */
{
  ok("the migration adds deleted_at and deleted_by", /ADD COLUMN deleted_at TEXT/.test(migration) && /ADD COLUMN deleted_by INTEGER/.test(migration));
  ok("there is a DELETE route on /assets/:id", route.length > 100);
  ok("it sets deleted_at and deleted_by, never DELETE FROM assets", /SET deleted_at = datetime\('now'\), deleted_by = \?1/.test(route) && !/DELETE FROM assets/.test(staff));
  ok("removing twice is refused", /if \(row\.deleted_at\) return err\(/.test(route));
}

/* ---- 2. audited with the whole record ---- */
{
  ok("the audit row carries the tag, a reason and the row as it was", /audit\(env, user\.id, "asset\.remove", "assets", idD, \{ tag: tagD, reason: reasonD, snapshot: row \}\)/.test(route));
  ok("the row is read BEFORE it is changed", route.indexOf("SELECT * FROM assets WHERE id = ?1") < route.indexOf("SET deleted_at"));
}

/* ---- 3. the tag is freed ---- */
{
  ok("the removed row's tag is suffixed so the corrected entry can take it", /asset_tag = asset_tag \|\| '#DEL' \|\| id/.test(route));
  ok("auto-numbering ignores removed rows", /asset_tag LIKE 'AZOA-%' AND asset_tag NOT LIKE '%#DEL%'/.test(staff));
}

/* ---- 4. hidden everywhere, with the pre-0126 fallback ---- */
{
  const get = staff.slice(staff.indexOf('if (path === "/assets" && method === "GET")'), staff.indexOf('if (path === "/assets" && method === "POST")'));
  ok("the register hides removed rows", /WHERE a\.deleted_at IS NULL/.test(get));
  ok("and still answers before 0126 has run", /try \{ results = [\s\S]*?sqlA\(true\)[\s\S]*?catch \{ results = [\s\S]*?sqlA\(false\)/.test(get));
  ok("the warranty watcher skips removed rows", /AND deleted_at IS NULL/.test(watchers) && /sqlW\(false\)/.test(watchers));
  ok("search never returns a removed row (by the tag mark, so the batch survives pre-0126)", /AND asset_tag NOT LIKE '%#DEL%'/.test(search) && !/deleted_at/.test(search.slice(search.indexOf('allowed.has("asset")'), search.indexOf('allowed.has("asset")') + 900)));
}

/* ---- 5. the register-keeper's power, asked first, both outcomes said ---- */
{
  ok("only hr_manage may remove", /if \(!can\(user\.role, "hr_manage"\)\) return err\("forbidden"/.test(route) && !/exec_view/.test(route));
  ok("the register says who may remove", /can_remove: can\(user\.role, "hr_manage"\)/.test(staff));
  ok("the button appears only for them", /\{canRemove && \(/.test(panel));
  ok("it asks first, in red", /await confirm\(\{[\s\S]*?variant: "danger"/.test(panel));
  ok("success toasts and reloads", /showToast\(L\("Entry removed", "Entri dibuang"\)[\s\S]*?load\(\);/.test(panel));
  ok("failure toasts", /showToast\(L\("Not removed", "Tidak dibuang"\)/.test(panel));
  ok("the confirm dialog is rendered beside the toast", /\{toastNode\}\s*\{confirmNode\}/.test(panel));
}

/* ---- 6. not a second way to retire a real asset ---- */
{
  ok("the dialog says a real asset is marked lost or disposed instead", /A real asset that is gone should be marked lost or disposed instead/.test(panel));
  ok("the card text keeps the rule and names the exception", /A real asset is never deleted: mark it lost or disposed/.test(panel) && /An entry typed by mistake can be removed/.test(panel));
}

/* ---- 7. the triple bump ---- */
{
  const latest = index.match(/const LATEST_MIGRATION = "(\d{4})_/);
  ok("LATEST_MIGRATION is 0126 or newer", !!latest && Number(latest[1]) >= 126, latest ? latest[1] : "missing");
  ok("EXPECTED_MIGRATIONS lists it", /"0126_assets_soft_delete",/.test(index));
  ok("a health probe can name it", /SELECT deleted_at FROM assets LIMIT 1/.test(index));
}

console.log(failed === 0
  ? `asset-remove: ${passed} checks passed.`
  : `\n${failed} asset-remove check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
