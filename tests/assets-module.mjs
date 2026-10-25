#!/usr/bin/env node
/* Guard - v1.210.0: ONE ASSET TAG. ONE AUTHORITATIVE ASSET RECORD. MULTIPLE
 * CONNECTED VIEWS.
 *
 * The owner's Assets brief, 25-10-2026, and the audit before it. He approved
 * the screen plan, the two worker fixes (the holder's full name; the
 * warranty alert's out-of-service rule), and "not now" for a per-asset
 * history route. So this guard holds:
 *
 *   1. ONE API. The Assets page reads and writes /staff/assets only (and
 *      reads the audit log the server already gates); no inventory, expense
 *      or purchase write from the page, and the worker's asset routes are
 *      the ones there were.
 *   2. NO NEW MONEY. The value is the recorded purchase price; lost and
 *      disposed are out of the totals (one rule, the drawer says so); no
 *      depreciation is computed anywhere on the page.
 *   3. THE FIVE STATUSES are the five there are, on both sides.
 *   4. THE DRAWER ONLY POINTS. Its commands are the page's own: startEdit
 *      (the same save()), openStatusChange (lost/disposed still ask), remove
 *      (the soft removal); Edit and status are offered to canEdit, removal to
 *      canRemove - the server's hr_manage answer.
 *   5. ONE NAME, ONE RULE. GET /assets sends the holder's full name; the
 *      warranty alert skips lost and disposed, the page's own "active".
 *   6. "Held by someone not on the staff list" is judged only once the list
 *      has loaded.
 *
 * Negative-tested by: a POST to /staff/inventory from the page (1); a
 * depreciation figure (2); a sixth status (3); a PATCH from the drawer (4);
 * u.name back in GET /assets, 'retired' back in the watcher (5); dropping the
 * loaded check (6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\{\s*\}/g, "{}");

const src = read("components/portal/assets-panel.tsx");
const code = strip(src);
const staff = read("worker/src/staff.ts");
const watchers = read("worker/src/watchers.ts");

/* ---- 1. one API ---- */
{
  const calls = [...code.matchAll(/api(?:<[^>]*>)?\(\s*`([^`]+)`/g)].map((m) => m[1]);
  const allowed = [/^\/staff\/assets$/, /^\/staff\/assets\/\$\{editId\}$/, /^\/staff\/assets\/\$\{a\.id\}$/, /^\/audit\?action=asset\.&limit=300$/];
  const odd = calls.filter((c) => !allowed.some((re) => re.test(c)));
  ok("the page calls /staff/assets and the audit read, nothing else", calls.length >= 5 && odd.length === 0, odd.join(", "));
  ok("…reads the register and the staff list through the shared cached reads", /useCachedApi<\{ assets: Asset\[\]; can_remove\?: boolean \}>\("\/staff\/assets", true, \["assets"\]\)/.test(code) && /useCachedApi<\{ staff: StaffLite\[\] \}>\("\/staff\/staff-list", true, \["users"\]\)/.test(code));
  ok("no inventory, expense or purchase write from the page", !/\/staff\/(inventory|expenses|purchases|finance|accounting)/.test(code));
  const routes = staff.split("path.match(/^\\/assets").slice(1).map((x) => x.slice(0, x.indexOf("$/"))).sort();
  ok("the worker's per-asset route is the one there was (no history route)", JSON.stringify(routes) === JSON.stringify(["\\/(\\d+)"]), JSON.stringify(routes));
  ok("…and an asset creates no expense", !/INSERT INTO (expenses|journal|purchases)/.test(staff.slice(staff.indexOf('if (path === "/assets" && method === "POST")'), staff.indexOf('if (path === "/assets" && method === "POST")') + 4000)));
}

/* ---- 2. no new money ---- */
{
  ok("the value is the recorded price, lost and disposed excluded", /const totalValue = assets\.filter\(\(a\) => a\.status !== "disposed" && a\.status !== "lost"\)\s*\.reduce\(\(s, a\) => s \+ \(a\.purchase_price_cents \?\? 0\), 0\);/.test(code) && /const active = \(a: Asset\) => a\.status !== "disposed" && a\.status !== "lost";/.test(code));
  ok("no depreciation is computed", !/deprec[a-z]*\s*[=*(]|net book|book value|nbv/i.test(code) && /No depreciation is calculated\./.test(src));
  ok("the drawer's value is the field itself", /<dt>\{L\("Recorded value", "Nilai direkodkan"\)\}<\/dt><dd>\{a\.purchase_price_cents != null \? rm\(a\.purchase_price_cents\)/.test(code));
}

/* ---- 3. five statuses ---- */
{
  const ui = [...(code.match(/const STATUSES = \[([^\n]*)\] as const;/) ?? [])[1]?.matchAll(/\["([a-z_]+)"/g) ?? []].map((m) => m[1]);
  ok("the page's statuses are the worker's", JSON.stringify(ui) === JSON.stringify(["in_use", "spare", "repair", "lost", "disposed"]) && /\["in_use", "spare", "repair", "lost", "disposed"\]\.includes\(body\.status\)/.test(staff), ui.join());
}

/* ---- 4. the drawer only points ---- */
{
  const at = code.indexOf("const warr = a.warranty_until");
  const drawer = at < 0 ? "" : code.slice(at, code.indexOf("</SideDrawer>", at));
  ok("the drawer makes no request of its own except reading the audit log", drawer.length > 500 && !/api\(|csrfFetch|method:/.test(drawer) && /onClick=\{\(\) => void loadAudit\(\)\}/.test(drawer));
  ok("its commands are the page's own, behind the page's own gates", /\{canEdit && <button type="button" className=\{btnClass\} onClick=\{\(\) => startEdit\(a\)\}>/.test(drawer) && /\{canEdit && <button type="button" className=\{btnSm\} onClick=\{\(\) => openStatusChange\(a\)\}>/.test(drawer) && /\{canRemove && <button type="button" className=\{rowBtnDanger\} onClick=\{\(\) => \{ setDetailId\(null\); void remove\(a\); \}\}>/.test(drawer));
  ok("the gates are the server's hr_manage answer", /const canRemove = register\.data\?\.can_remove === true;/.test(code) && /const canEdit = canRemove;/.test(code) && /can_remove: can\(user\.role, "hr_manage"\)/.test(staff));
  ok("lost and disposed still ask first", /if \(nextStatus !== a\.status && \(nextStatus === "lost" \|\| nextStatus === "disposed"\)\) \{/.test(code));
  ok("Add and Edit are the same save() in a drawer", (code.match(/const save = async/g) ?? []).length === 1 && /<SideDrawer\s+open=\{openForm && canEdit\}/.test(code) && /onClick=\{\(\) => void save\(\)\}/.test(code));
  ok("a search hit opens the asset's drawer", /useRecordFocus\(focus, loaded, \(f\) => \{[\s\S]{0,400}?if \(a\) openDetail\(a\);/.test(code));
}

/* ---- 5. one name, one rule ---- */
{
  ok("GET /assets sends the holder's full name", /SELECT a\.\*, COALESCE\(NULLIF\(TRIM\(u\.full_name\), ''\), u\.name\) AS assigned_name FROM assets a/.test(staff) && !/SELECT a\.\*, u\.name AS assigned_name/.test(staff));
  ok("the warranty alert skips lost and disposed, the page's own rule", /COALESCE\(status, ''\) NOT IN \('disposed', 'lost'\)/.test(watchers) && !/'retired'/.test(watchers));
}

/* ---- 6. off the staff list, only once the list is known ---- */
ok("'not on the staff list' waits for the list", /const offList = \(a: Asset\) => people\.data != null && a\.assigned_to != null/.test(code));

ok("no sample data from the reference", !/MacBook Pro 14|A2Z-LPT|Dell Latitude 5440|HP LaserJet|Perodua Myvi|WXX1234|Sony A7 IV|284,500|210,800|73,700/.test(src));
ok("the guard is registered", /\["assets-module", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
