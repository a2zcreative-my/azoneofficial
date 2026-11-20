/* v1.393.0 - GUARD: THE DIGITAL CARD TEMPLATE EDITOR (Digital Cards Stage 4, the CEO 21-11-2026; migration 0223).
 *
 * Template Info -> Design Specs -> Upload Pages, saved on the server at every step. Runs the REAL
 * worker (bundled worker/src/index.ts) on every migration in an in-memory SQLite and proves:
 *   - the step is kept on the server; Upload Pages opens only after Design Specs is confirmed,
 *     and a rule the CEO changed since asks for the confirmation again
 *   - the first visit to Upload Pages plans the pages from the category (the Cover first)
 *   - a page file is judged by its own bytes (lib/card-image.ts): PNG/JPG only, the exact canvas,
 *     CMYK refused, the size limit, the SHA-256 recorded; a refused file stores nothing
 *   - only the designer writes, at the version they started from; nothing changes once the
 *     template is in review (the 0223 triggers hold that in the database too)
 *   - required pages stay and keep their titles, the Cover stays first, the category limits hold
 *   - artwork stays private: it opens only through Digital Cards, never through /media/file
 *   - the format and category freeze once artwork is uploaded; a format changed later shows on
 *     the pages it no longer fits
 * Plus the shared reader itself, and the wiring.
 *
 *   node tests/card-template-pages.mjs
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeRuntime, root } from "./browser/portfolio-runtime.mjs";

const read = (f) => readFileSync(join(root, f), "utf8");
const results = [];
const ok = (c, m, why = "") => results.push([!!c, why && !c ? `${m} - ${why}` : m]);

/* invented image headers - only the bytes the reader looks at are real; the rest is padding */
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const png = (w, h, fill = 7, extra = 64) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0, ...new Array(extra).fill(fill)]);
const jpg = (w, h, comps = 3, fill = 9) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, comps, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, ...new Array(64).fill(fill), 0xff, 0xd9]);
const sha = (b) => createHash("sha256").update(b).digest("hex");

/* ---- 1. the shared reader and rules, as shipped ---- */
const dir = mkdtempSync(join(tmpdir(), "cardpg-"));
for (const [f, out] of [["lib/card-image.ts", "i.mjs"], ["lib/card-templates.ts", "t.mjs"]])
  execSync(`npx esbuild "${join(root, f)}" --bundle --format=esm --platform=neutral --outfile="${join(dir, out)}" --log-level=error`, { cwd: root, stdio: "inherit" });
const I = await import(pathToFileURL(join(dir, "i.mjs")).href);
const T = await import(pathToFileURL(join(dir, "t.mjs")).href);
rmSync(dir, { recursive: true, force: true });
const F = { width_px: 1080, height_px: 1920, accepted_types: ["image/png", "image/jpeg"], max_bytes: 10485760 };
let h = I.readImageHeader(png(1080, 1920));
ok(h.mime === "image/png" && h.width === 1080 && h.height === 1920, "a PNG's size is read from its IHDR", JSON.stringify(h));
h = I.readImageHeader(jpg(1080, 1920));
ok(h.mime === "image/jpeg" && h.width === 1080 && h.height === 1920 && h.components === 3, "a JPEG's size is read from its start-of-frame", JSON.stringify(h));
ok(I.readImageHeader(new TextEncoder().encode("<svg></svg>")).error === "not_image", "anything else is not an image, whatever its name");
ok(I.pageFileProblems(I.readImageHeader(png(1080, 1920)), 5000, F).length === 0, "the exact canvas passes");
ok(/exactly 1080 × 1920/.test(I.pageFileProblems(I.readImageHeader(png(1081, 1920)), 5000, F)[0] ?? ""), "one pixel off is refused, with both sizes named");
ok(/CMYK/.test(I.pageFileProblems(I.readImageHeader(jpg(1080, 1920, 4)), 5000, F).join()), "a CMYK JPEG is refused");
ok(/limit is 10 MB/.test(I.pageFileProblems(I.readImageHeader(png(1080, 1920)), 11 * 1048576, F).join()), "a file over the format's limit is refused");
ok(/tepat 1080 × 1920/.test(I.pageFileProblems(I.readImageHeader(png(1, 1)), 10, F, "ms")[0] ?? ""), "the reasons read in BM too");
const rule = { min_pages: 2, max_pages: 4, allow_reorder: true, pages: [{ title: "Cover", title_ms: "Muka depan", required: true }, { title: "Event Details", title_ms: null, required: true }, { title: "RSVP / Map", title_ms: null, required: false }] };
const cur = [{ id: 1, title: "Cover", title_ms: null, required: true }, { id: 2, title: "Event Details", title_ms: null, required: true }, { id: 3, title: "RSVP / Map", title_ms: null, required: false }];
ok(T.initialPlan(rule).map((p) => p.title).join() === "Cover,Event Details,RSVP / Map", "the first plan is the category's pages, in order");
ok(T.checkPagePlan(cur, [{ id: 1 }, { id: 3 }], rule).problem?.includes("Event Details is a required page"), "a required page cannot be removed");
ok(/stays the first page/.test(T.checkPagePlan(cur, [{ id: 2 }, { id: 1 }, { id: 3 }], rule).problem ?? ""), "the Cover stays first");
ok(T.checkPagePlan(cur, [{ id: 1, title: "Front" }, { id: 2 }], rule).value?.[0].title === "Cover", "a required page keeps its title");
ok(/same title/.test(T.checkPagePlan(cur, [{ id: 1 }, { id: 2 }, { id: 3 }, { title: "rsvp / map" }], rule).problem ?? ""), "two pages cannot share a title");
ok(/at most 4/.test(T.checkPagePlan(cur, [{ id: 1 }, { id: 2 }, { id: 3 }, { title: "A" }, { title: "B" }], rule).problem ?? ""), "the category's maximum holds");
ok(/keeps its pages in order/.test(T.checkPagePlan(cur, [{ id: 1 }, { id: 3 }, { id: 2 }], { ...rule, allow_reorder: false }).problem ?? ""), "a category that keeps its order refuses a move");
ok(T.specsKey({ id: 1, version: 2 }, { id: 3, version: 1 }) === "1:2:3:1", "the specs key names the rule versions confirmed");

/* ---- 2. the real worker on every migration ---- */
const rt = await makeRuntime();
const { call, db, objects } = rt;
db.exec(`INSERT INTO users (id, name, full_name, email, role, is_active, password_hash, totp_enabled, department, position, employment_status, joined_on) VALUES
  (21, 'Dina', 'Dina Designer', 'dina@a2zcreative.my', 'sales_marketing', 1, 'x', 1, 'Sales', 'Designer', 'permanent', '2025-01-01')`);
db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, datetime('now', '+12 hours'), datetime('now'))`).run(sha("t-21"), 21);
rt.tok[21] = "t-21";
const as = (uid) => (p, m, b, type) => call(p, uid, m, b, type);
const SAM = as(4), DINA = as(21), CEO = as(1), COO = as(3), HR = as(2);

const rules = (await CEO("/staff/card-rules")).j;
const wedding = rules.categories.find((c) => c.code === "wedding");
const portrait = rules.formats.find((f) => f.code === "portrait");
const landscape = rules.formats.find((f) => f.code === "landscape");
let r = await SAM("/staff/card-templates", "POST", { name: "Navy Wedding", category_id: wedding.id, format_id: portrait.id, language: "both", packages: ["silver"] });
const id = r.j?.template?.id;
r = await SAM(`/staff/card-templates/${id}`);
ok(r.j?.editor?.step === 1 && r.j.editor.plan_started === false && r.j.editor.specs_ok === false && r.j.editor.format?.code === "portrait", "a new draft starts at Template Info, nothing planned, specs not yet confirmed", r.text);
let v = r.j?.template?.version;
const step = (who, s, extra = {}) => who(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: s, ...extra });
ok((await COO(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: 2 })).status === 403, "the COO cannot move a designer's editor (403)");
ok((await DINA(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: 2 })).status === 403, "another designer cannot either (403)");
r = await step(SAM, 3);
ok(r.status === 409 && r.j?.error?.code === "specs_needed", "Upload Pages waits for Design Specs to be confirmed (409)", r.text);
r = await step(SAM, 2);
ok(r.status === 200 && r.j.editor.step === 2, "the step is saved on the server");
v = r.j.template.version;
ok((await SAM(`/staff/card-templates/${id}/step`, "PUT", { version: v - 1, step: 2 })).status === 409, "the old version is refused after that save (409)");
r = await step(SAM, 3, { specs_confirmed: true });
ok(r.status === 200 && r.j.editor.step === 3 && r.j.editor.specs_ok === true, "confirming the specs opens Upload Pages", r.text);
const pages = r.j?.editor?.pages ?? [];
ok(pages.map((p) => `${p.title}${p.required ? "*" : ""}`).join() === "Cover*,Event Details*,RSVP / Map", "the pages are planned from the Wedding rule: Cover and Event Details required, RSVP / Map optional", pages.map((p) => p.title).join());
ok(r.j.editor.missing.length === 3, "nothing is uploaded yet: all three pages are still to finish");
v = r.j.template.version;
const cover = pages[0], details = pages[1], rsvp = pages[2];
const up = (who, page, bytes, type = "image/png", ver = v) => who(`/staff/card-templates/${id}/pages/${page.id}/file?version=${ver}`, "PUT", bytes, type);

/* refused files change nothing */
const before = objects.size;
r = await up(SAM, cover, png(1080, 1350));
ok(r.status === 422 && r.j?.error?.code === "invalid_page" && /exactly 1080 × 1920/.test(r.j.error.message), "a page of the wrong size is refused with both sizes named (422)", r.text);
r = await up(SAM, cover, new TextEncoder().encode("GIF89a not an image we take"), "image/png");
ok(r.status === 422, "a file that only CLAIMS to be a PNG is refused (422)");
ok((await up(SAM, cover, jpg(1080, 1920, 4), "image/jpeg")).status === 422, "a CMYK JPEG is refused (422)");
const big = new Uint8Array(10485760 + 10); big.set(png(1080, 1920));
ok((await up(SAM, cover, big)).status === 413, "a file over 10 MB is refused (413)");
ok((await up(SAM, cover, png(1080, 1920), "image/png", v - 1)).status === 409, "an upload at an old version is refused (409)");
ok((await up(DINA, cover, png(1080, 1920))).status === 403, "another designer cannot upload (403)");
ok(objects.size === before && (await SAM(`/staff/card-templates/${id}`)).j.template.version === v, "none of the refusals stored a file or moved the version");

/* a good page */
const art = png(1080, 1920, 1);
r = await up(SAM, cover, art);
const c1 = r.j?.editor?.pages?.[0];
ok(r.status === 200 && c1?.has_file && c1.sha256 === sha(art) && c1.width_px === 1080 && c1.problems.length === 0, "a page of the exact canvas is taken, with its SHA-256", r.text);
const key = [...objects.keys()].find((k) => k.startsWith(`private/card-templates/${id}/page-${cover.id}-`));
ok(key && Buffer.compare(objects.get(key).bytes, Buffer.from(art)) === 0, "the file is stored privately, byte for byte", key);
v = r.j.template.version;
r = await up(SAM, details, art);
ok(r.j?.editor?.pages?.[0].duplicate && r.j.editor.pages[1].duplicate, "the same artwork on two pages is flagged on both");
v = r.j.template.version;
const art2 = jpg(1080, 1920, 3, 5);
r = await up(SAM, details, art2, "image/jpeg");
ok(r.status === 200 && r.j.editor.pages[1].mime === "image/jpeg" && !r.j.editor.pages[0].duplicate, "a page is replaced; a JPG is taken too");
v = r.j.template.version;
ok([...objects.keys()].filter((k) => k.startsWith(`private/card-templates/${id}/page-${details.id}-`)).length === 2, "the replaced file stays in storage (the history names it)");
const ev = db.prepare(`SELECT note, detail_json FROM card_template_events WHERE template_id = ? AND kind = 'page_uploaded' ORDER BY id`).all(id);
ok(ev.length === 3 && JSON.parse(ev[2].detail_json).replaced === sha(art), "every upload is one history event, naming the file it replaced");
ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'card_template.page_upload'`).get().n === 3, "and one audit row");

/* private artwork */
r = await COO(`/staff/card-templates/${id}/pages/${cover.id}/image`);
ok(r.status === 200 && r.type === "image/png" && Buffer.compare(r.buf, Buffer.from(art)) === 0, "the COO opens the artwork through Digital Cards");
ok((await HR(`/staff/card-templates/${id}/pages/${cover.id}/image`)).status === 403, "HR does not (403)");
ok((await CEO(`/media/file/${encodeURIComponent(key)}`)).status === 403, "/media/file never serves template artwork, even to the CEO (403)");

/* the plan */
const plan = (list, ver = v) => SAM(`/staff/card-templates/${id}/pages`, "PUT", { version: ver, pages: list });
ok((await plan([{ id: cover.id }, { id: rsvp.id }])).status === 422, "a required page cannot be removed (422)");
ok((await plan([{ id: details.id }, { id: cover.id }, { id: rsvp.id }])).status === 422, "the Cover cannot leave the first place (422)");
r = await plan([{ id: cover.id }, { id: details.id }, { id: rsvp.id, title: "RSVP" }, { title: "Gallery" }]);
ok(r.status === 200 && r.j.editor.pages.map((p) => p.title).join() === "Cover,Event Details,RSVP,Gallery", "an optional page is renamed and a new one added", r.text);
v = r.j.template.version;
const gallery = r.j.editor.pages[3];
r = await up(SAM, gallery, png(1080, 1920, 3));
v = r.j.template.version;
r = await plan([{ id: cover.id }, { id: details.id }, { id: gallery.id }, { id: rsvp.id }]);
ok(r.status === 200 && r.j.editor.pages.map((p) => p.title).join() === "Cover,Event Details,Gallery,RSVP", "pages move where the category allows it");
v = r.j.template.version;
r = await plan([{ id: cover.id }, { id: details.id }, { id: rsvp.id }]);
ok(r.status === 200 && r.j.editor.pages.length === 3 && [...objects.keys()].some((k) => k.includes(`page-${gallery.id}-`)), "an optional page is removed; its file stays in storage");
v = r.j.template.version;
ok(r.j.editor.missing.length === 1 && /RSVP/.test(r.j.editor.missing[0]), "one page is still to finish: RSVP", JSON.stringify(r.j.editor.missing));
r = await up(SAM, rsvp, png(1080, 1920, 4));
ok(r.status === 200 && r.j.editor.missing.length === 0, "with every page in and fitting, nothing is missing");
v = r.j.template.version;

/* artwork freezes the format and category; the CEO's later change shows */
const t0 = (await SAM(`/staff/card-templates/${id}`)).j.template;
ok((await SAM(`/staff/card-templates/${id}`, "PUT", { ...t0, format_id: landscape.id, version: v })).j?.error?.code === "pages_uploaded", "the format cannot change once artwork is uploaded (409)");
r = await SAM(`/staff/card-templates/${id}`, "PUT", { ...t0, name: "Navy Wedding Classic", version: v });
ok(r.status === 200 && r.j.template.name === "Navy Wedding Classic", "the name still can");
v = r.j.template.version;
const pf = (await CEO("/staff/card-rules")).j.formats.find((f) => f.code === "portrait");
r = await CEO(`/staff/card-rules/formats/${pf.id}`, "PUT", { ...pf, height_px: 1350, reason: "testing a taller card is refused" });
ok(r.status === 200, "(setup) the CEO changes the Portrait format to 1080 × 1350", r.text);
r = await SAM(`/staff/card-templates/${id}`);
ok(r.j.editor.specs_ok === false && r.j.editor.pages.every((p) => p.problems.some((x) => /1080 × 1350/.test(x))), "the change asks for the specs again, and every page now says it no longer fits");
v = r.j.template.version;
ok((await step(SAM, 3)).j?.error?.code === "specs_needed", "Upload Pages waits for the new specs to be confirmed");

/* in review: nothing moves, in the worker or the database */
db.prepare(`UPDATE card_templates SET state = 'in_review' WHERE id = ?`).run(id);
ok((await up(SAM, cover, art)).status === 409 && (await plan([{ id: cover.id }, { id: details.id }])).status === 409, "a template in review takes no page change (409)");
let refused = false; try { db.exec(`DELETE FROM card_template_pages WHERE template_id = ${id}`); } catch { refused = true; }
let refused2 = false; try { db.exec(`UPDATE card_template_pages SET title = 'x' WHERE template_id = ${id}`); } catch { refused2 = true; }
ok(refused && refused2, "the 0223 triggers refuse a page change in review, whatever calls the database");

/* before any artwork: a new category is a new plan */
r = await SAM("/staff/card-templates", "POST", { name: "Second Draft", category_id: wedding.id, format_id: landscape.id, language: "en", packages: ["gold"] });
const id2 = r.j.template.id; let v2 = r.j.template.version;
r = await SAM(`/staff/card-templates/${id2}/step`, "PUT", { version: v2, step: 3, specs_confirmed: true });
v2 = r.j.template.version;
ok(r.j.editor.pages.length === 3, "(setup) a second draft is planned");
const birthday = rules.categories.find((c) => c.code === "birthday");
const t2 = r.j.template;
r = await SAM(`/staff/card-templates/${id2}`, "PUT", { ...t2, category_id: birthday.id, version: v2 });
ok(r.status === 200, "before any artwork the category can change", r.text);
r = await SAM(`/staff/card-templates/${id2}`);
ok(r.j.editor.step === 2 && r.j.editor.pages.length === 0 && r.j.editor.specs_ok === false, "and the designer goes back to Design Specs, with a new plan to come");

/* ---- 3. the wiring ---- */
const staff = read("worker/src/staff.ts"), idx = read("worker/src/index.ts"), ui = read("components/portal/digital-cards.tsx");
ok(/!\/\^\\\/card-templates\\\/\\d\+\\\/pages\\\/\\d\+\\\/file\$\/\.test\(path\)/.test(staff) && /handleCardTemplates\(env, path, method, body, user, new URL\(request\.url\)\.searchParams, request\)/.test(staff), "the page upload is a raw body, read by the Digital Cards door");
ok(/key\.startsWith\("private\/card-templates\/"\)/.test(idx), "/media/file refuses private/card-templates/");
ok(/"0223_card_template_pages",/.test(idx) && /\["0223 \(digital card template pages/.test(idx), "0223 is in the expected list and probed (v1.394.0: 0224 follows it)");
const mig = read("worker/migrations/0223_card_template_pages.sql").replace(/--.*$/gm, "");
ok(!/\bDROP\b/i.test(mig) && (mig.match(/ALTER TABLE/g) ?? []).length === 3 && (mig.match(/ALTER TABLE card_templates ADD COLUMN/g) ?? []).length === 3, "0223 is additive: a new table and three added columns");
ok(readdirSync(join(root, "worker/migrations")).filter((f) => f.startsWith("0223")).length === 1, "one 0223");
ok(/readImageHeader\(/.test(ui) && /pageFileProblems\(/.test(ui) && /csrfFetch\(`\/api\/v1\/staff\/card-templates\/\$\{t\.id\}\/pages\/\$\{p\.id\}\/file\?version=/.test(ui), "the page checks a file with the same reader before it sends it, through csrfFetch");
ok(/<DrawerSteps steps=\{STEP_NAMES\(\)\}/.test(ui) && /Template Info.*Design Specs.*Upload Pages/s.test(ui), "the editor is one form drawer with the three steps of the brief");

const failed = results.filter(([c]) => !c);
for (const [c, m] of results) console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
if (failed.length) { console.log(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log(`\n${results.length} check(s) passed.`);
