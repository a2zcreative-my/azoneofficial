/* v1.392.0 - GUARD: DIGITAL CARD TEMPLATES (Digital Cards Stage 3, the CEO 21-11-2026; migration 0222).
 *
 * Runs the REAL worker (bundled worker/src/index.ts) on every migration in an in-memory SQLite and
 * proves the rules that matter:
 *   - Digital Cards is for the designers (Sales & Marketing, decision D1), the COO and CCO, the CEO
 *     and the super admin; HR and other staff are refused
 *   - only card_template_manage creates a template; the COO and CCO read but never create
 *   - a template is created as its designer's draft and only that designer changes it, only as a
 *     draft or returned, with the version it started from (stale = 409)
 *   - the four strip figures are real counts by state (archived counts nowhere), and each list
 *     answers its own question (all / mine / review / published)
 *   - a template is never deleted (archived instead, with a reason); every change is one
 *     append-only event and the audit
 *   - a draft cannot use a format or category that is switched off
 * Plus the wiring: the tab mirrors card_template_view, the page uses the one KPI strip.
 *
 *   node tests/card-templates.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeRuntime, root } from "./browser/portfolio-runtime.mjs";

const read = (f) => readFileSync(join(root, f), "utf8");
const results = [];
const ok = (c, m, why = "") => results.push([!!c, why && !c ? `${m} - ${why}` : m]);

/* ---- 1. the shared rules (lib/card-templates.ts), as shipped ---- */
const dir = mkdtempSync(join(tmpdir(), "cardtpl-"));
execSync(`npx esbuild "${join(root, "lib/card-templates.ts")}" --bundle --format=esm --platform=neutral --outfile="${join(dir, "t.mjs")}" --log-level=error`, { cwd: root, stdio: "inherit" });
const T = await import(pathToFileURL(join(dir, "t.mjs")).href);
rmSync(dir, { recursive: true, force: true });
const act = { categories: [1, 2], formats: [1, 2] };
const good = { name: "Elegant Navy Wedding", category_id: 1, format_id: 1, language: "both", packages: ["gold", "silver"] };
ok(T.checkTemplateInfo(good, act).value?.packages.join() === "silver,gold", "template information passes; packages kept in Silver, Gold, Diamond order");
ok(T.checkTemplateInfo({ ...good, format_id: 9 }, act).problems.format_id, "a format that is off (or unknown) is refused");
ok(T.checkTemplateInfo({ ...good, packages: [] }, act).problems.packages, "at least one package");
ok(T.checkTemplateInfo({ ...good, name: "x".repeat(61) }, act).problems.name, "a name of at most 60 characters");
ok(T.templateCode("Elegant Navy Wedding!") === "elegant-navy-wedding", "the code is the name, kebab-cased");
ok(!T.canEditTemplate({ state: "draft", designer_id: 2 }, 1, true) && T.canEditTemplate({ state: "returned", designer_id: 1 }, 1, true) && !T.canEditTemplate({ state: "in_review", designer_id: 1 }, 1, true),
  "only the designer edits, and only a draft or a returned template");
ok(JSON.stringify(T.KPI_OF.total) === JSON.stringify(["draft", "in_review", "returned", "published", "unpublished"]), "Total counts every state but archived");

/* ---- 2. the real worker on every migration ---- */
const rt = await makeRuntime();
const { call, db } = rt;
/* invented: a second designer (sales & marketing) and a CCO, beside the harness's people */
db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, department, position, employment_status, joined_on) VALUES
  (21, 'Dina', 'Dina Designer', 'dina@a2zcreative.my', 'sales_marketing', 1, 'x', 1, 'Sales', 'Designer', 'permanent', '2025-01-01'),
  (22, 'Izz', 'Izz CCO', 'cco@a2zcreative.my', 'cco', 1, 'x', 1, 'Management', 'CCO', 'permanent', '2020-01-01')`);
const { createHash } = await import("node:crypto");
for (const id of [21, 22]) db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(createHash("sha256").update(`t-${id}`).digest("hex"), id);
rt.tok[21] = "t-21"; rt.tok[22] = "t-22";
const callAs = async (path, uid, method = "GET", body) => {
  const headers = { origin: "https://portal.a2z.test", cookie: `azone_session=t-${uid}; csrf_token=c1`, "x-csrf-token": "c1", "content-type": "application/json" };
  const r = await rt.worker.fetch(new Request(`https://api.a2z.test/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), rt.env);
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, j, text: text.slice(0, 300) };
};
const as = (uid) => (uid === 21 || uid === 22 ? (p, m, b) => callAs(p, uid, m, b) : (p, m, b) => call(p, uid, m, b));
const SAM = as(4), DINA = as(21), CEO = as(1), COO = as(3), HR = as(2), CCO = as(22);

let r = await SAM("/staff/card-templates/summary");
ok(r.status === 200 && r.j?.total === 0 && r.j?.can_create === true, "a designer opens Digital Cards: no templates yet, may create", r.text);
ok((await HR("/staff/card-templates/summary")).status === 403, "HR is refused (403)");
ok((await as(11)("/staff/card-templates/summary")).status === 403, "a live host is refused (403)");
r = await COO("/staff/card-templates/summary");
ok(r.status === 200 && r.j?.can_create === false, "the COO reads Digital Cards and may not create");
ok((await CCO("/staff/card-templates/summary")).status === 200, "the CCO reads Digital Cards");

const rules = (await CEO("/staff/card-rules")).j;
const wedding = rules.categories.find((c) => c.code === "wedding");
const portrait = rules.formats.find((f) => f.code === "portrait");
const square = rules.formats.find((f) => f.code === "square");
const info = { name: "Elegant Navy Wedding", description: "Navy and gold florals", category_id: wedding.id, format_id: portrait.id, language: "both", packages: ["silver", "gold", "diamond"] };
ok((await COO("/staff/card-templates", "POST", info)).status === 403, "the COO cannot create a template (403)");
r = await SAM("/staff/card-templates", "POST", info);
ok(r.status === 201 && r.j?.template?.state === "draft" && r.j.template.designer_id === 4 && r.j.template.code === "elegant-navy-wedding", "the designer creates a draft that is theirs", r.text);
const t1 = r.j?.template;
r = await DINA("/staff/card-templates", "POST", { ...info, format_id: square.id });
ok(r.status === 201 && r.j?.template?.code === "elegant-navy-wedding-2", "the same name twice gets its own code (-2)", r.text);
const t2 = r.j?.template;

ok((await DINA(`/staff/card-templates/${t1.id}`, "PUT", { ...info, name: "Taken over", version: t1.version })).status === 403, "another designer cannot change it (403)");
ok((await CEO(`/staff/card-templates/${t1.id}`, "PUT", { ...info, name: "Taken over", version: t1.version })).status === 403, "not even the CEO changes a designer's draft (403)");
ok((await SAM(`/staff/card-templates/${t1.id}`, "PUT", { ...info, version: 7 })).status === 409, "a stale version is refused (409)");
r = await SAM(`/staff/card-templates/${t1.id}`, "PUT", { ...info, name: "Elegant Navy Wedding II", version: t1.version });
ok(r.status === 200 && r.j?.template?.name === "Elegant Navy Wedding II" && r.j.template.version === 2 && r.j.template.code === "elegant-navy-wedding", "the designer changes the information; the version moves and the code stays", r.text);

/* a rule switched off cannot be chosen any more */
const sq = (await CEO("/staff/card-rules")).j.formats.find((f) => f.code === "square");
ok((await CEO(`/staff/card-rules/formats/${sq.id}`, "PUT", { ...sq, active: false, reason: "not offered for now" })).status === 200, "(setup) the CEO switches Square off");
ok((await SAM("/staff/card-templates", "POST", { ...info, format_id: sq.id })).status === 422, "a new draft cannot use a format that is off (422)");

/* the figures and the lists */
db.prepare(`UPDATE card_templates SET state = 'in_review' WHERE id = ?`).run(t2.id); // a later stage submits; here the state is set directly
r = await SAM("/staff/card-templates/summary");
ok(r.j?.total === 2 && r.j?.drafts === 1 && r.j?.in_review === 1 && r.j?.published === 0 && r.j?.mine === 1, "the strip counts by state: 2 total, 1 draft, 1 pending review, 0 published; 1 of my drafts", JSON.stringify(r.j));
ok((await SAM("/staff/card-templates?view=mine")).j?.templates?.map((t) => t.id).join() === String(t1.id), "My Drafts lists only my own drafts");
ok((await COO("/staff/card-templates?view=review")).j?.templates?.map((t) => t.id).join() === String(t2.id), "Pending Review lists what is in review");
ok((await COO("/staff/card-templates?view=all&q=navy")).j?.templates?.length === 2, "the search finds both by name");
ok((await DINA(`/staff/card-templates/${t2.id}`, "PUT", { ...info, version: 1 })).status === 409, "a template in review cannot be edited (409)");

/* never deleted: archived, with a reason, and brought back */
const cur = (await SAM(`/staff/card-templates/${t1.id}`)).j?.template;
ok((await SAM(`/staff/card-templates/${t1.id}/archive`, "POST", { version: cur.version, reason: "short" })).status === 422, "archiving needs a reason of 8+ characters");
r = await SAM(`/staff/card-templates/${t1.id}/archive`, "POST", { version: cur.version, reason: "a duplicate of another design" });
ok(r.status === 200 && r.j?.template?.state === "archived", "the designer archives their draft", r.text);
r = await SAM("/staff/card-templates/summary");
ok(r.j?.total === 1 && r.j?.drafts === 0, "an archived template counts nowhere");
ok((await COO(`/staff/card-templates/${t1.id}`)).status === 404, "another person does not see an archived draft");
ok((await SAM("/staff/card-templates?view=archived")).j?.templates?.length === 1, "the designer finds it under My Drafts -> Archived");
r = await SAM(`/staff/card-templates/${t1.id}/restore`, "POST", { version: r.j ? (await SAM(`/staff/card-templates/${t1.id}`)).j.template.version : 0 });
ok(r.status === 200 && r.j?.template?.state === "draft", "the designer brings it back as a draft", r.text);
let refused = false; try { db.exec(`DELETE FROM card_templates WHERE id = ${t1.id}`); } catch { refused = true; }
ok(refused, "a template row is never deleted (0222 trigger)");
let evEdit = false; try { db.exec(`UPDATE card_template_events SET note = 'x'`); } catch { evEdit = true; }
ok(evEdit, "the template history is never edited (0222 trigger)");
const ev = db.prepare(`SELECT kind FROM card_template_events WHERE template_id = ? ORDER BY id`).all(t1.id).map((e) => e.kind).join(",");
ok(ev === "created,edited,archived,restored", "every change is one history event", ev);
ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'card_template.%'`).get().n === 5, "and one audit row (2 creates, an update, an archive, a restore)");
r = await COO(`/staff/card-templates/${t1.id}`);
ok(r.status === 200 && r.j?.template?.can_edit === false && r.j.events.length === 4, "the COO reads the template and its history, and cannot edit it");

/* ---- 3. the wiring ---- */
const tabs = read("lib/portal-tabs.ts"), perms = read("worker/src/permissions.ts");
const capRoles = (perms.match(/card_template_view:\s*\[([^\]]*)\]/) ?? [])[1]?.replace(/\s/g, "");
const tabRoles = (tabs.match(/"Digital Cards":\s*\[([^\]]*)\]/) ?? [])[1]?.replace(/\s/g, "");
ok(capRoles === tabRoles && /"sales_marketing"/.test(capRoles ?? ""), "the tab is drawn for exactly card_template_view, which includes Sales & Marketing (D1)", `${capRoles} vs ${tabRoles}`);
ok(/card_template_manage:\s*\["super_admin", "ceo", "sales_marketing"\]/.test(perms) && !/card_template_manage:[^\]]*"coo"/.test(perms), "the designers create; the COO and CCO do not");
ok(/key: "card_template_view"[^}]*cap: "card_template_view"/.test(perms) && /key: "card_template_manage"[^}]*cap: "card_template_manage"/.test(perms), "both capabilities are on the Roles & Permissions catalogue");
const ui = read("components/portal/digital-cards.tsx");
ok(/<KpiRow /.test(ui) && (ui.match(/<KpiTile /g) ?? []).length === 4 && /\/staff\/card-templates\/summary/.test(ui), "the four figures are the one KPI strip, read from the server's counts");
ok(["Templates", "My Drafts", "Pending Review", "Published", "Guidelines"].every((w) => ui.includes(`L("${w}"`)), "the five views of the brief: Templates, My Drafts, Pending Review, Published, Guidelines");
ok(/from "@\/lib\/card-templates"/.test(ui) && /checkTemplateInfo\(/.test(ui), "the page checks the information with the same lib/card-templates.ts as the server");
const mig = read("worker/migrations/0222_card_templates.sql").replace(/--.*$/gm, "");
ok(!/\b(DROP|ALTER)\b/i.test(mig), "0222 is additive only");

const failed = results.filter(([c]) => !c);
for (const [c, m] of results) console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
if (failed.length) { console.log(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log(`\n${results.length} check(s) passed.`);
