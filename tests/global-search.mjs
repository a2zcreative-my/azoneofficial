#!/usr/bin/env node
/* Guard - v1.205.0: ONE SEARCH, ONE BELL, EVERY LINE OPENS ITS RECORD.
 *
 * The owner, 25-10-2026 (Global Search & Notifications): "Create a unified
 * search experience across existing modules, reusing their APIs and
 * database records ... Respect all existing role-based permissions,
 * especially HR, payroll and financial data ... Do not create duplicate
 * notifications, approval workflows, tasks or databases."
 *
 *   1. THE SEARCH IS RUN, NOT READ. worker/src/search.ts's handleSearch is
 *      bundled and run against the real schema (worker/migrations, in
 *      node:sqlite behind a small D1 stand-in) with seeded rows, for a live
 *      host, HR, the COO and the CEO:
 *        - every statement prepares against the schema (none falls back);
 *        - leave: the HR tier and the approvers find everyone's, everyone
 *          else only their own (leaveSeesAll - the GET /leave?all=1 rule);
 *          the reason is never searched and never returned;
 *        - claims: the GET /claims scope (claimScope), and no amount;
 *        - a role finds no source its tab is closed to; `only` narrows and
 *          never widens; `per` stops at 25.
 *   2. ONE COPY OF EACH READ RULE: the Leave and Claims lists and the search
 *      call the same two functions.
 *   3. THE PAGE AND THE BELL ONLY READ. No write from global-search.tsx;
 *      the bell's only write is the existing mark-read POST; the Approvals
 *      chip is the Desk's own list (useDeskData + splitDesk), never a queue
 *      of its own and never a decision.
 *   4. EVERY LINE OPENS ITS RECORD: recordOfRef reads the refs the worker
 *      writes; every tab a record kind lives in receives the focus from
 *      app/portal/page.tsx; every such module applies it for its own kind.
 *   5. THE WORDS ARE THE MODULES' OWN: the hotel stages are hotels-panel's;
 *      every hit kind has a module, a label and a palette group.
 *
 * Negative-tested by: letting everyone search all leave (1); returning the
 * claim amount (1); a second copy of the claims scope in search.ts (2); a
 * POST from the search page (3); dropping the Leave focus from page.tsx
 * (4); renaming a hotel stage on the page only (5).
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const dir = mkdtempSync(join(tmpdir(), "gsearch-"));
const bundle = async (file, name, extra = "") => {
  const out = join(dir, `${name}.mjs`);
  execSync(`npx esbuild "${join(root, file)}" --bundle --format=esm ${extra || "--platform=neutral"} --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
};

/* ---- the schema, migration by migration (tests/sql-schema-check.mjs's way) ---- */
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=OFF;");
db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);");
for (const f of readdirSync(join(root, "worker/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(root, "worker/migrations", f), "utf8");
  try { db.exec(sql); continue; } catch { /* statement by statement */ }
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/)) { const t = stmt.trim(); if (!t || t.startsWith("--")) continue; try { db.exec(t + ";"); } catch { /* already applied / seed */ } }
}
db.exec("DELETE FROM users; DELETE FROM leave_requests; DELETE FROM claims; DELETE FROM tasks; DELETE FROM hotels; DELETE FROM hotel_contacts; DELETE FROM customers; DELETE FROM sales_documents; DELETE FROM inventory_items; DELETE FROM assets;");

/* invented rows, every name tagged "Zq" so the query is unambiguous */
const ins = (sql, ...a) => db.prepare(sql).run(...a);
const U = { host: 1, sales: 2, hr: 3, coo: 4, ceo: 5 };
ins(`INSERT INTO users (id, email, password_hash, name, full_name, role, is_active, position, department, employee_id, phone, photo_key, employment_status) VALUES
  (1, 'h@x.test', 'x', 'Zq Host', 'Zq Host Binti A', 'live_host', 1, 'Live Host', 'Live', 'Z-1', '0171112222', 'staff/1.jpg', 'permanent'),
  (2, 's@x.test', 'x', 'Zq Sales', NULL, 'sales_marketing', 1, 'Sales Executive', 'Sales', 'Z-2', NULL, NULL, 'resigned'),
  (3, 'r@x.test', 'x', 'Zq Hr', NULL, 'hr_admin', 1, 'HR Admin', 'HR', 'Z-3', NULL, NULL, 'permanent'),
  (4, 'o@x.test', 'x', 'Zq Coo', NULL, 'coo', 1, 'COO', 'Management', 'Z-4', NULL, NULL, 'permanent'),
  (5, 'c@x.test', 'x', 'Zq Ceo', NULL, 'ceo', 1, 'CEO', 'Management', 'Z-5', NULL, NULL, 'permanent')`);
ins(`INSERT INTO leave_requests (id, user_id, type, start_date, end_date, days, reason, status, created_at) VALUES
  (11, 1, 'medical', '2026-09-20', '2026-09-21', 2, 'Zq zzsecret diagnosis', 'pending', '2026-09-18 01:00:00'),
  (12, 2, 'annual', '2026-09-22', '2026-09-22', 1, 'Family', 'approved', '2026-09-17 01:00:00')`);
ins(`INSERT INTO claims (id, user_id, claim_date, category, amount_cents, description, status, created_at) VALUES
  (21, 1, '2026-09-10', 'travel', 4500, 'Zq Grab to client', 'pending', '2026-09-10 01:00:00'),
  (22, 2, '2026-09-11', 'meal', 6200, 'Zq lunch', 'approved', '2026-09-11 01:00:00'),
  (23, 5, '2026-09-12', 'equipment', 18900, 'Zq ring light', 'pending', '2026-09-12 01:00:00')`);
ins(`INSERT INTO tasks (id, title, description, assigned_to, created_by, priority, deadline, status, progress, created_at) VALUES
  (31, 'Zq rundown', NULL, 1, 5, 'normal', '2026-09-10', 'open', 0, '2026-09-01 01:00:00'),
  (32, 'Zq banner', NULL, 2, 5, 'normal', '2026-09-30', 'in_progress', 0, '2026-09-02 01:00:00')`);
ins(`INSERT INTO hotels (id, state, hotel_name, company, address, is_active, stage, updated_at) VALUES (41, 'KEDAH', 'Zq Hotel', NULL, 'Alor Setar', 1, 'contacted', '2026-09-03 01:00:00')`);
ins(`INSERT INTO hotel_contacts (id, hotel_id, slot, person_name, phone) VALUES (42, 41, 1, 'Zq Contact', '0123334444')`);
ins(`INSERT INTO customers (id, company, contact_person, phone, created_at) VALUES (51, 'Zq Boutique', 'Zq Aina', '0174761019', '2026-08-01 01:00:00')`);
ins(`INSERT INTO sales_documents (id, doc_type, doc_number, customer_id, items, total_cents, payment_status, delivery_status, created_at) VALUES
  (61, 'INV', 'INV-ZQ-1', 51, '[]', 120000, 'unpaid', NULL, '2026-09-05 01:00:00'),
  (62, 'QT', 'QT-ZQ-2', 51, '[]', 450000, NULL, NULL, '2026-09-06 01:00:00')`);
ins(`INSERT INTO inventory_items (id, sku, name, stock, reorder_level, updated_at) VALUES (71, 'ZQ1', 'Zq Serum', 3, 5, '2026-09-07 01:00:00')`);
ins(`INSERT INTO assets (id, asset_tag, name, status, updated_at) VALUES (81, 'ZQ-CAM', 'Zq Camera', 'in_use', '2026-09-08 01:00:00')`);

/* the D1 stand-in: prepare/bind/all/first and batch; a statement that fails
   to prepare is recorded, so "a missing table costs its source" can never
   hide a typo here */
const sqlErrors = [];
const stmtOf = (sql, args = []) => ({
  bind: (...a) => stmtOf(sql, a),
  all: async () => { try { return { results: db.prepare(sql).all(...args) }; } catch (e) { sqlErrors.push(`${e.message} :: ${sql.slice(0, 90)}`); throw e; } },
  first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { sqlErrors.push(e.message); throw e; } },
  run: async () => ({ success: true }),
});
const env = { DB: { prepare: (sql) => stmtOf(sql), batch: async (list) => Promise.all(list.map((s) => s.all())) } };

const { handleSearch, sourcesFor } = await bundle("worker/src/search.ts", "search");
const run = async (uid, role, qs) => (await (await handleSearch(env, { id: uid, role }, new URLSearchParams(qs))).json());
const kinds = (r) => [...new Set(r.hits.map((h) => h.kind))].sort();

/* ---- 1. run, role by role ---- */
{
  const ceo = await run(U.ceo, "ceo", "q=zq&per=25");
  ok("every statement prepares against the migrated schema", sqlErrors.length === 0, sqlErrors.slice(0, 3).join(" | "));
  ok("the CEO finds every kind", ["asset", "claim", "client", "contact", "document", "hotel", "invoice", "leave", "staff", "stock", "task"].every((k) => kinds(ceo).includes(k)), kinds(ceo).join(","));
  ok("the CEO finds everyone's leave (a final approver)", ceo.hits.filter((h) => h.kind === "leave").length === 2);
  const leaveHit = ceo.hits.find((h) => h.kind === "leave");
  ok("a leave hit carries no reason", leaveHit && !JSON.stringify(ceo.hits.filter((h) => h.kind === "leave")).includes("zzsecret") && !("reason" in leaveHit));
  const secret = await run(U.ceo, "ceo", "q=zzsecret");
  ok("the leave reason is never searched", !secret.hits.some((h) => h.kind === "leave"), JSON.stringify(secret.hits));
  ok("a claim hit carries no amount", ceo.hits.filter((h) => h.kind === "claim").every((h) => !/RM|4500|45\.00|amount/.test(JSON.stringify(h))));
  ok("statuses are the records' own: a resigned person is 'left', an invoice its payment, stock low at its reorder level",
     ceo.hits.find((h) => h.kind === "staff" && h.id === 2)?.status === "left"
     && ceo.hits.find((h) => h.kind === "invoice")?.status === "unpaid"
     && ceo.hits.find((h) => h.kind === "stock")?.status === "low"
     && ceo.hits.find((h) => h.kind === "hotel")?.status === "contacted");
  ok("a staff hit carries the photo key, nothing more personal", (() => { const h = ceo.hits.find((x) => x.kind === "staff" && x.id === 1); return h?.photo === "staff/1.jpg" && !/0171112222|@x\.test/.test(JSON.stringify(h)); })());

  const host = await run(U.host, "live_host", "q=zq&per=25");
  ok("a live host finds no staff, hotel, client, document, invoice, asset or stock", kinds(host).every((k) => ["task", "leave", "claim"].includes(k)), kinds(host).join(","));
  ok("…only their own leave", host.hits.filter((h) => h.kind === "leave").map((h) => h.id).join() === "11");
  ok("…only their own claims", host.hits.filter((h) => h.kind === "claim").every((h) => h.id === 21));
  ok("…only their own tasks", host.hits.filter((h) => h.kind === "task").map((h) => h.id).join() === "31");
  const widen = await run(U.host, "live_host", "q=zq&only=staff,hotel,leave");
  ok("`only` narrows and never widens past the role", kinds(widen).join() === "leave", kinds(widen).join(","));

  const hr = await run(U.hr, "hr_admin", "q=zq&per=25");
  ok("HR finds everyone's leave (the HR stage)", hr.hits.filter((h) => h.kind === "leave").length === 2);
  ok("HR's claims are the GET /claims scope: own, the staff chain's and approved - not the CEO's pending one",
     hr.hits.filter((h) => h.kind === "claim").map((h) => h.id).sort().join() === "21,22", hr.hits.filter((h) => h.kind === "claim").map((h) => h.id).join());
  const coo = await run(U.coo, "coo", "q=zq&per=25");
  ok("the COO (a pre-approver) finds everyone's leave", coo.hits.filter((h) => h.kind === "leave").length === 2);
  const sales = await run(U.sales, "sales_marketing", "q=zq&per=25");
  ok("a sales executive finds only their own leave", sales.hits.filter((h) => h.kind === "leave").map((h) => h.id).join() === "12");

  for (let i = 0; i < 30; i++) ins(`INSERT INTO tasks (title, assigned_to, created_by, priority, status, progress, created_at) VALUES ('Zq bulk ${i}', 5, 5, 'normal', 'open', 0, '2026-09-01')`);
  const many = await run(U.ceo, "ceo", "q=zq bulk&per=99&only=task");
  ok("`per` stops at 25", many.hits.length === 25, String(many.hits.length));
  const short = await run(U.ceo, "ceo", "q=zq bulk");
  ok("the palette's default stays six a source", short.hits.filter((h) => h.kind === "task").length === 6);
  ok("sourcesFor is what the worker answered with", JSON.stringify([...sourcesFor("live_host")].sort()) === JSON.stringify([...host.sources].sort()));
}

/* ---- 2. one copy of each read rule ---- */
{
  const search = strip(read("worker/src/search.ts"));
  const staff = read("worker/src/staff.ts");
  ok("the Leave list and the search read leaveSeesAll", /const all = url\.searchParams\.get\("all"\) === "1" && leaveSeesAll\(user\.role\);/.test(staff) && /const allLeave = leaveSeesAll\(user\.role\);/.test(search));
  ok("the Claims list and the search read claimScope", /const mkScope = \(withPayee: boolean\) => claimScope\(user\.role, all, withPayee\);/.test(staff) && /claimScope\(user\.role, allClaims, true, "\?2"\)/.test(search));
  ok("no second copy of the claims scope", !/STAFF_CHAIN|payee_user_id = \?/.test(search) && !/const STAFF_CHAIN = /.test(staff));
  ok("the leave rule is the one it was", /return can\(role, "hr_manage"\) \|\| \(PREAPP_ROLES as readonly string\[\]\)\.includes\(role\) \|\| \(FINAL_ROLES as readonly string\[\]\)\.includes\(role\);/.test(read("worker/src/leave-chain.ts")));
}

/* ---- 3. the page and the bell only read ---- */
{
  const page = strip(read("components/portal/global-search.tsx"));
  const bell = strip(read("components/portal/notifications-panel.tsx"));
  ok("the search page never writes", !/method:\s*"(?:POST|PUT|PATCH|DELETE)"|csrfFetch/.test(page));
  ok("…and reads only /staff/search", [...page.matchAll(/api<[^>]*>\(`([^`?]+)/g)].every((m) => m[1] === "/staff/search"));
  const writes = [...bell.matchAll(/api\("([^"]+)", \{ method: "POST"/g)].map((m) => m[1]);
  ok("the bell's only write is the existing mark-read", writes.length === 1 && writes[0] === "/staff/notifications/read" && !/csrfFetch|method: "(?:PUT|PATCH|DELETE)"/.test(bell));
  ok("Approvals is the Desk's own list, read-only", /const desk = useDeskData\(\);/.test(bell) && /splitDesk\(desk\.data\?\.items \?\? \[\]\)\.decide/.test(bell) && !/<DeskQueue|\/decide|\/approve/.test(bell));
  ok("the Desk page is still where the queue is worked", /<DeskQueue/.test(read("components/portal/desk-page.tsx")));
}

/* ---- 4. every line opens its record ---- */
{
  const { recordOfRef, TAB_OF_KIND } = await bundle("lib/record-focus.ts", "focus", "--platform=node");
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok("leave:12 is leave 12", eq(recordOfRef("leave:12"), { kind: "leave", id: 12 }));
  ok("task:5:od:2026-09-18 is task 5", eq(recordOfRef("task:5:od:2026-09-18"), { kind: "task", id: 5 }));
  ok("task-close:5 is task 5", eq(recordOfRef("task-close:5"), { kind: "task", id: 5 }));
  ok("quote:9:2 is document 9", eq(recordOfRef("quote:9:2"), { kind: "document", id: 9 }));
  ok("claim:7 and stock:3", eq(recordOfRef("claim:7"), { kind: "claim", id: 7 }) && eq(recordOfRef("stock:3"), { kind: "stock", id: 3 }));
  ok("a day, a person's week or a watcher is no single record", recordOfRef("ot:9002:2026-09-21") === null && recordOfRef("watch:stock:17") === null && recordOfRef("announcement:3") === null && recordOfRef(null) === null);
  const page = read("app/portal/page.tsx");
  const tabs = [...new Set(Object.values(TAB_OF_KIND))];
  ok("every tab a record lives in receives the focus", tabs.every((t) => new RegExp(`=\\{focusOf\\("${t}"\\)\\}`).test(page)), tabs.filter((t) => !new RegExp(`focusOf\\("${t}"\\)`).test(page)).join(", "));
  const modules = { staff: "components/staff/staff-directory.tsx", hotel: "components/portal/hotels-panel.tsx", task: "components/portal/tasks.tsx", leave: "components/portal/leave.tsx", claim: "components/portal/role-panels.tsx", stock: "components/portal/role-panels.tsx", asset: "components/portal/assets-panel.tsx", document: "components/portal/sales.tsx", client: "components/portal/sales.tsx" };
  for (const [kind, file] of Object.entries(modules)) {
    ok(`${kind}: its module applies the focus for its own kind`, new RegExp(`useRecordFocus\\([a-zA-Z]+, [^,]+, \\(f\\) => \\{[\\s\\S]{0,700}?f\\.kind (?:!==|===) "${kind}"`).test(read(file)), file);
  }
  const prov = read("components/portal/portal-provider.tsx");
  ok("the focus lasts while its tab is open", /if \(focus && focus\.tab !== tab\) setFocus\(null\);/.test(prov));
  ok("choosing any tab closes the search page", /const setTab = useCallback<Dispatch<SetStateAction<TabName>>>\(\(v\) => \{ setSearchQ\(null\); setTabState\(v\); \}, \[\]\);/.test(prov));
  const bell = read("components/portal/notifications-panel.tsx");
  ok("a notification opens its record where the person may open the tab, else its tab and section", /if \(rec && tab && canOpen\(tab\)\) openRecord\(tab, rec\.kind, rec\.id\);\s*else if \(fallbackTab\)/.test(bell));
  ok("every notification kind the bell used to link still links", ["announcement", "ot", "attendance", "claim", "leave", "task", "watch"].every((k) => new RegExp(`${k}: \\{ tab: "`).test(bell)));
  const gs = read("components/portal/global-search.tsx");
  ok("a search row opens only where the tab strip already shows its tab", /if \(!m \|\| !canOpen\(h\.tab\)\) return;/.test(gs));
  const pal = read("components/layout/command-palette.tsx");
  ok("the palette: a hit opens its record, the tabs still come first for Enter", /onRecord\(h\)/.test(pal) && /const GROUP_ORDER = \["Pinned", "Recent", "Go to", "Actions", "Search",/.test(pal));
}

/* ---- 5. the words are the modules' own ---- */
{
  const gs = read("components/portal/global-search.tsx");
  const hp = read("components/portal/hotels-panel.tsx");
  const block = (src, name) => src.slice(src.indexOf(`const ${name}`), src.indexOf("};", src.indexOf(`const ${name}`)));
  const pairs = (b) => [...b.matchAll(/(\w+): \["([^"]+)", "([^"]+)"\]/g)].map((m) => m.slice(1).join("|")).join(";");
  ok("the hotel stages are hotels-panel's words", pairs(block(gs, "HOTEL_STAGE")) === pairs(block(hp, "STAGE_LABEL")) && pairs(block(hp, "STAGE_LABEL")).length > 20);
  const hitKinds = [...(read("worker/src/search.ts").match(/kind: "([^"]+)"(?: \| "[^"]+")*/)?.[0] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const pageKinds = [...gs.matchAll(/\{ kind: "([a-z]+)", label:/g)].map((m) => m[1]);
  ok("every hit kind has a module on the page", hitKinds.length >= 11 && hitKinds.every((k) => pageKinds.includes(k)), hitKinds.filter((k) => !pageKinds.includes(k)).join(","));
  ok("no sample figure from the mockup", !/Nursyazwani|AZOOA0|Hotel Grand Crystal|Prepare LIVE rundown|Double Tree|v2\.1\.0|Xiaomi/.test(gs + read("components/portal/notifications-panel.tsx")));
  ok("no enquiries module", !/enquir/i.test(strip(gs)));
}

ok("the guard is registered", /\["global-search", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
