/* v1.391.0 - GUARD: DIGITAL CARD RULES (Digital Cards Stage 2, the CEO 20-11-2026; migration 0221).
 *
 * Runs the REAL worker (bundled worker/src/index.ts) on every migration in an in-memory SQLite and
 * proves the rules that matter:
 *   - only card_format_admin (the CEO and the super admin) changes the card rules; the people who
 *     work on templates (card_template_view) read them for the Guidelines (v1.392.0)
 *   - the approved starting rules are seeded: 1080 x 1920 / 1920 x 1080 / 1080 x 1080, a 40 px safe
 *     margin, 10 MB a page, PNG and JPG; 1-10 pages a card, the Cover first and required
 *   - a save needs a reason and the version it started from (stale = 409, never an overwrite),
 *     is checked by the same lib/card-rules.ts the Guidelines draw from, bumps the version and
 *     writes exactly one history row and the audit; the history is never edited or deleted
 *   - nothing is deleted: the last format or category that is on cannot be switched off
 *   - DPI is never a rule (screen cards)
 * Plus the static wiring: the tab, its role default mirrors the capability, the migration probe.
 *
 *   node tests/card-rules.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeRuntime, root } from "./browser/portfolio-runtime.mjs";

const read = (f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF; the patterns are written with \n
const results = [];
const ok = (c, m, why = "") => results.push([!!c, why && !c ? `${m} - ${why}` : m]);

/* ---- 1. the one copy of the rules (lib/card-rules.ts), imported as shipped ---- */
const dir = mkdtempSync(join(tmpdir(), "cardrules-"));
execSync(`npx esbuild "${join(root, "lib/card-rules.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(dir, "r.mjs")}" --log-level=error`, { cwd: root, stdio: "inherit" });
const R = await import(pathToFileURL(join(dir, "r.mjs")).href);
rmSync(dir, { recursive: true, force: true });
const portrait = { width_px: 1080, height_px: 1920, margin_top: 40, margin_right: 40, margin_bottom: 40, margin_left: 40 };
ok(R.aspectLabel(1080, 1920) === "9:16" && R.aspectLabel(1920, 1080) === "16:9" && R.aspectLabel(1080, 1080) === "1:1", "the ratio reads 9:16, 16:9, 1:1");
ok(JSON.stringify(R.safeArea(portrait)) === JSON.stringify({ x: 40, y: 40, w: 1000, h: 1840 }), "the safe area of 1080 x 1920 with 40 px margins is 1000 x 1840 at (40, 40)");
ok(R.sizeLabel(10485760) === "10 MB", "10 MB reads 10 MB");
const good = { name: "Portrait", ...portrait, accepted_types: ["image/png", "image/jpeg"], max_bytes: 10485760 };
ok(R.checkFormat(good).value !== null, "the starting portrait format passes the check", JSON.stringify(R.checkFormat(good).problems));
ok(R.checkFormat({ ...good, margin_left: 300, margin_right: 300 }).problems.margin_left, "margins that eat half the width are refused");
ok(R.checkFormat({ ...good, accepted_types: ["image/svg+xml"] }).problems.accepted_types, "only PNG and JPG are accepted types");
ok(R.checkFormat({ ...good, width_px: 100 }).problems.width_px, "a canvas under 320 px is refused");
ok(!("dpi" in (R.checkFormat({ ...good, dpi: 72 }).value ?? {})) && !/\bdpi\s*[:=]/i.test(read("lib/card-rules.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "DPI is never a rule (screen cards)");
const cover = { title: "Cover", title_ms: "Muka depan", required: true };
ok(R.checkCategory({ name: "X", min_pages: 1, max_pages: 10, pages: [{ title: "Details", required: true }] }).problems.pages, "the first page must be the Cover");
ok(R.checkCategory({ name: "X", min_pages: 1, max_pages: 10, pages: [cover, { title: "Details", required: true }] }).problems.min_pages, "the least pages cannot be below the required pages");
ok(R.checkCategory({ name: "X", min_pages: 1, max_pages: 2, pages: [cover, { title: "A" }, { title: "B" }] }).problems.pages, "more listed pages than the most is refused");
ok(R.checkCategory({ name: "X", min_pages: 1, max_pages: 11, pages: [cover] }).problems.max_pages, "a card has at most 10 pages");
ok(R.checkCategory({ name: "X", min_pages: 1, max_pages: 10, pages: [{ ...cover, required: false }] }).value?.pages[0].required === true, "the Cover is always required, whatever is sent");

/* ---- 2. the real worker on every migration ---- */
const rt = await makeRuntime();
const { call, db } = rt;
try {
  let r = await call("/staff/card-rules", 1);
  ok(r.status === 200 && r.j?.can_edit === true, "the CEO reads the card rules and may edit them", r.text);
  const fm = Object.fromEntries((r.j?.formats ?? []).map((f) => [f.code, f]));
  ok(fm.portrait?.width_px === 1080 && fm.portrait?.height_px === 1920 && fm.landscape?.width_px === 1920 && fm.landscape?.height_px === 1080 && fm.square?.width_px === 1080 && fm.square?.height_px === 1080, "the three starting formats are seeded at their sizes");
  ok(Object.values(fm).every((f) => f.margin_top === 40 && f.margin_right === 40 && f.margin_bottom === 40 && f.margin_left === 40 && f.max_bytes === 10485760 && f.accepted_types.join() === "image/png,image/jpeg"), "each starts at a 40 px margin, 10 MB a page, PNG and JPG");
  const cats = r.j?.categories ?? [];
  ok(cats.length >= 7 && cats.every((c) => c.pages[0]?.title === "Cover" && c.pages[0]?.required && c.max_pages <= 10 && c.min_pages >= 1), "every category starts with a required Cover, 1 to 10 pages");
  ok(cats.every((c) => R.checkCategory(c).value !== null), "every seeded category passes the same check a save does");
  const wedding = cats.find((c) => c.code === "wedding");
  ok(wedding && wedding.pages.map((p) => `${p.title}:${p.required}`).join("|") === "Cover:true|Event Details:true|RSVP / Map:false", "Wedding: Cover and Event Details required, RSVP / Map optional");

  ok((await call("/staff/card-rules", 2)).status === 403, "HR, who does not work on templates, cannot read the card rules (403)");
  /* v1.392.0 - the designers and the COO / CCO read the rules (their Guidelines); they never change them */
  for (const [uid, who] of [[3, "the COO"], [4, "a sales & marketing designer"]]) {
    const rr = await call("/staff/card-rules", uid);
    ok(rr.status === 200 && rr.j?.can_edit === false, `${who} reads the card rules for the Guidelines, and may not edit them`, rr.text);
  }
  for (const [uid, who] of [[2, "HR"], [3, "the COO"], [4, "a sales & marketing designer"]]) {
    ok((await call(`/staff/card-rules/formats/${fm.portrait.id}`, uid, "PUT", { ...fm.portrait, reason: "trying to change it" })).status === 403, `${who} cannot change a format (403)`);
    ok((await call("/staff/card-rules/categories", uid, "POST", { name: "Nope", min_pages: 1, max_pages: 2, pages: [{ title: "Cover", required: true }], reason: "trying to add one" })).status === 403, `${who} cannot add a category (403)`);
  }

  const body = { ...fm.portrait, margin_top: 60, reason: "confirmed with the design team" };
  ok((await call(`/staff/card-rules/formats/${fm.portrait.id}`, 1, "PUT", { ...body, reason: "short" })).status === 422, "a save without a reason of 8+ characters is refused (422)");
  ok((await call(`/staff/card-rules/formats/${fm.portrait.id}`, 1, "PUT", { ...body, version: 9 })).status === 409, "a stale version is refused (409), never an overwrite");
  ok((await call(`/staff/card-rules/formats/${fm.portrait.id}`, 1, "PUT", { ...body, margin_bottom: 1500 })).status === 422, "a margin the server's check refuses is 422");
  r = await call(`/staff/card-rules/formats/${fm.portrait.id}`, 1, "PUT", body);
  ok(r.status === 200, "the CEO changes the portrait margin with a reason", r.text);
  const after = r.j?.formats?.find((f) => f.code === "portrait");
  ok(after?.margin_top === 60 && after?.version === 2, "the change is saved and the version moves to 2");
  ok((await call(`/staff/card-rules/formats/${fm.portrait.id}`, 1, "PUT", body)).status === 409, "the same save sent twice is refused the second time (409)");
  const hist = db.prepare(`SELECT * FROM card_rule_history WHERE entity = 'format' AND entity_id = ?`).all(fm.portrait.id);
  ok(hist.length === 1 && hist[0].version === 2 && hist[0].reason === "confirmed with the design team" && hist[0].actor_id === 1, "exactly one history row, with the version, the reason and who saved it");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'card_rules.format_update'`).get().n === 1, "the change is in the audit");
  let refused = false; try { db.exec(`UPDATE card_rule_history SET reason = 'x'`); } catch { refused = true; }
  let refusedDel = false; try { db.exec(`DELETE FROM card_rule_history`); } catch { refusedDel = true; }
  ok(refused && refusedDel, "the rule history is never edited or deleted (0221 triggers)");
  r = await call(`/staff/card-rules/history?entity=format&id=${fm.portrait.id}`, 1);
  ok(r.status === 200 && r.j?.history?.[0]?.version === 2 && r.j.history[0].snapshot?.margin_top === 60, "the history reads back the saved version");

  /* nothing is deleted; the last one on stays on */
  const v = (code) => db.prepare(`SELECT version FROM card_formats WHERE code = ?`).get(code).version;
  ok((await call(`/staff/card-rules/formats/${fm.landscape.id}`, 1, "PUT", { ...fm.landscape, active: false, version: v("landscape"), reason: "not used yet by design" })).status === 200, "a format can be switched off");
  ok((await call(`/staff/card-rules/formats/${fm.square.id}`, 1, "PUT", { ...fm.square, active: false, version: v("square"), reason: "not used yet by design" })).status === 200, "a second format can be switched off");
  const pnow = db.prepare(`SELECT * FROM card_formats WHERE code = 'portrait'`).get();
  ok((await call(`/staff/card-rules/formats/${fm.portrait.id}`, 1, "PUT", { ...body, margin_top: 60, active: false, version: pnow.version, reason: "switching the last one off" })).status === 422, "the last format that is on cannot be switched off");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM card_formats`).get().n === 3, "no format is ever deleted");

  /* a new rule: a code from its name, never twice */
  r = await call("/staff/card-rules/formats", 1, "POST", { name: "Story", width_px: 1080, height_px: 1350, margin_top: 40, margin_right: 40, margin_bottom: 40, margin_left: 40, accepted_types: ["image/png"], max_bytes: 5242880, reason: "for feed-sized cards" });
  ok(r.status === 200 && r.j?.formats?.some((f) => f.code === "story" && f.version === 1), "a new format is added with a code from its name", r.text);
  ok((await call("/staff/card-rules/formats", 1, "POST", { name: "Story", width_px: 1080, height_px: 1350, margin_top: 40, margin_right: 40, margin_bottom: 40, margin_left: 40, accepted_types: ["image/png"], max_bytes: 5242880, reason: "for feed-sized cards" })).status === 422, "the same name twice is refused");
  r = await call(`/staff/card-rules/categories/${wedding.id}`, 1, "PUT", { ...wedding, pages: [{ title: "Event Details", required: true }, ...wedding.pages], reason: "trying to move the cover" });
  ok(r.status === 422, "a category whose first page is not the Cover is refused");
  r = await call(`/staff/card-rules/categories/${wedding.id}`, 1, "PUT", { ...wedding, max_pages: 8, reason: "eight pages is enough" });
  ok(r.status === 200 && r.j?.categories?.find((c) => c.code === "wedding")?.max_pages === 8, "the CEO changes a category with a reason", r.text);
} finally {
  /* nothing to close: in-memory */
}

/* ---- 3. the wiring ---- */
const tabs = read("lib/portal-tabs.ts");
const perms = read("worker/src/permissions.ts");
const capRoles = (perms.match(/card_template_view:\s*\[([^\]]*)\]/) ?? [])[1]?.replace(/\s/g, "");
const tabRoles = (tabs.match(/"Digital Cards":\s*\[([^\]]*)\]/) ?? [])[1]?.replace(/\s/g, "");
ok(capRoles && capRoles === tabRoles, "the tab is drawn for exactly the roles that hold card_template_view", `${capRoles} vs ${tabRoles}`);
ok(/\{ id: "operations", title: "Operations", tabs: \["Tasks", "Assets", "Digital Cards", "Hotels"\] \}/.test(tabs), "Digital Cards sits in Operations after Assets");
ok(/"Digital Cards": \{ slug: "digital-cards" \}/.test(tabs), "the address is /portal/digital-cards");
ok(/key: "card_format_admin"[^}]*cap: "card_format_admin"/.test(perms), "the capability is on the Roles & Permissions catalogue");
ok(/"0221_card_rules",\n/.test(read("worker/src/index.ts")) && /\["0221 \(digital card rules/.test(read("worker/src/index.ts")), "the health check expects migration 0221");
const mig = read("worker/migrations/0221_card_rules.sql").replace(/--.*$/gm, "");
ok(!/\b(DROP|ALTER|DELETE FROM|UPDATE)\b/i.test(mig.replace(/BEFORE (UPDATE|DELETE) ON card_rule_history/g, "")), "0221 is additive only (no DROP, ALTER, DELETE or UPDATE of existing data)");
const ui = read("components/portal/digital-cards.tsx");
ok(/from "@\/lib\/card-rules"/.test(ui) && /safeArea\(/.test(ui) && /checkFormat\(/.test(ui) && /checkCategory\(/.test(ui), "the page draws and checks with the same lib/card-rules.ts as the server");
ok(!/#[0-9a-f]{3,8}\b/i.test(ui) && !/#[0-9a-f]{3,8}\b/i.test(read("components/portal/digital-cards.module.css")), "no colour is written into the page or its stylesheet (tokens only)");
ok(/<TabPage>/.test(ui) && /<LineTabs /.test(ui) && /<SideDrawer /.test(ui) && /<DrawerFoot /.test(ui), "the page uses the portal's TabPage, LineTabs and form drawer");

const failed = results.filter(([c]) => !c);
for (const [c, m] of results) console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
if (failed.length) { console.log(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log(`\n${results.length} check(s) passed.`);
