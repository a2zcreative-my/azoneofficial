/* v1.394.0 - GUARD: DIGITAL CARD EDITABLE CONTENT AND THE RENDERER (Digital Cards Stage 5, the CEO 21-11-2026; migration 0224).
 *
 * The fields a customer fills in, and the ONE renderer that draws them (lib/card-render.ts), which
 * AZ ONE copies in Stage 7 so the customer's card is the designer's preview. Proves:
 *   - the renderer has no imports, places everything in canvas units scaled with the frame, clips
 *     each field, escapes customer text, draws no sample on a customer card and no placeholder
 *   - the card fonts are self-hosted woff2 files with their licences, and the stylesheet IS the
 *     renderer's fontFaceCss()
 *   - a field sits inside the safe area, uses a card font and a 6-digit colour, has a sample that
 *     fits its limit, and its key is unique in the whole template (one value per key on a card)
 *   - Editable Content opens only when every page is in and fits; only the designer saves, at their
 *     version; a removed page takes its fields; nothing moves in review (0224 triggers)
 *   - a format changed later shows the fields that no longer fit
 *
 *   node tests/card-zones.mjs
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeRuntime, root } from "./browser/portfolio-runtime.mjs";

const read = (f) => readFileSync(join(root, f), "utf8");
const results = [];
const ok = (c, m, why = "") => results.push([!!c, why && !c ? `${m} - ${why}` : m]);

/* ---- 1. the renderer, the fonts and the field rules, as shipped ---- */
const src = read("lib/card-render.ts");
ok(!/^\s*import\s/m.test(src) && !/\bfetch\(|document\.|window\./.test(src), "the renderer imports nothing and touches no page or network - AZ ONE can copy it byte for byte");
const dir = mkdtempSync(join(tmpdir(), "cardz-"));
for (const [f, out] of [["lib/card-render.ts", "r.mjs"], ["lib/card-templates.ts", "t.mjs"]])
  execSync(`npx esbuild "${join(root, f)}" --bundle --format=esm --platform=neutral --outfile="${join(dir, out)}" --log-level=error`, { cwd: root, stdio: "inherit" });
const R = await import(pathToFileURL(join(dir, "r.mjs")).href);
const T = await import(pathToFileURL(join(dir, "t.mjs")).href);
rmSync(dir, { recursive: true, force: true });
const page = { width: 1080, height: 1920 };
const zone = (o = {}) => ({ key: "names", page_id: 1, kind: "text", label: "Names", label_ms: "Nama", x: 140, y: 640, w: 800, h: 160, font: "greatvibes", weight: 400, size: 108, colour: "#e9d9a6", align: "center", max_chars: 40, required: true, sample: "Aiman & Nadia", sample_ms: "Aiman dan Nadia", ...o });
let [b] = R.pageBoxes(page, [zone()], {}, { mode: "preview" });
ok(b.left === "12.963%" && b.top === "33.3333%" && b.width === "74.0741%" && b.fontSize === "10cqw", "a field is placed in percent of the canvas and sized in container units (108 px on 1080 = 10cqw)", JSON.stringify(b));
ok(b.text === "Aiman & Nadia" && R.pageBoxes(page, [zone()], {}, { mode: "preview", lang: "ms" })[0].text === "Aiman dan Nadia", "the preview shows the sample, in the card's language");
ok(R.pageBoxes(page, [zone()], {}, { mode: "output" })[0].text === "", "a customer card never shows the designer's sample");
ok(R.pageBoxes(page, [zone()], { names: "Ali & Siti" }, { mode: "output" })[0].text === "Ali & Siti", "it shows the customer's words");
ok(R.pageBoxes(page, [zone()], { names: "x".repeat(99) }, {})[0].text.length === 40, "and never more than the field allows");
const html = R.renderPageHTML("/art.png", page, [zone()], { names: `<script>alert(1)</script>` }, { mode: "output" });
ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "customer text is escaped in the HTML renderer");
ok(/container-type:inline-size/.test(html) && /aspect-ratio:1080 \/ 1920/.test(html) && /overflow:hidden/.test(html), "the frame keeps the artwork's ratio, measures in its own width, and every field clips");
ok(!R.renderPageHTML("javascript:alert(1)", page, [], {}).includes("javascript:"), "an unsafe artwork address is dropped");
ok(R.boxStyle({ ...b, color: "red;background:url(x)" }).color === "#000000", "a colour that is not #rrggbb never reaches the style");
const photo = zone({ key: "photo", kind: "image", sample: "" });
ok(R.pageBoxes(page, [photo], {}, { mode: "preview" })[0].placeholder && !R.pageBoxes(page, [photo], {}, { mode: "output" })[0].placeholder, "an empty photo field is a placeholder in the preview only");
ok(R.pageBoxes(page, [zone()], {}, { longest: true })[0].text.replace(/\s/g, "").length === 40, "Longest text fills a field with all the characters it allows");
const fontsCss = read("public/card-fonts/card-fonts.css");
ok(fontsCss.endsWith(R.fontFaceCss("/card-fonts/")), "public/card-fonts/card-fonts.css is the renderer's fontFaceCss() - one list of fonts");
const files = R.FONT_KEYS.flatMap((k) => R.CARD_FONTS[k].weights.map((w) => `public/card-fonts/${R.CARD_FONTS[k].file}-latin-${w}-normal.woff2`));
ok(files.every((f) => existsSync(join(root, f)) && readFileSync(join(root, f)).subarray(0, 4).toString() === "wOF2"), "every card font is a self-hosted woff2 file", files.filter((f) => !existsSync(join(root, f))).join());
ok(R.FONT_KEYS.every((k) => /SIL Open Font License/.test(read(`public/card-fonts/${R.CARD_FONTS[k].file}-OFL.txt`))), "each font ships with its SIL Open Font License");
const F = { width_px: 1080, height_px: 1920, margin_top: 40, margin_right: 40, margin_bottom: 40, margin_left: 40 };
ok(T.checkZones([zone()], 1, F).value?.[0].key === "names", "a good field passes");
ok(/outside the safe area/.test(T.checkZones([zone({ x: 20 })], 1, F).problem ?? ""), "a field reaching into the margin is refused");
ok(/already uses the name "names"/.test(T.checkZones([zone()], 1, F, ["names"]).problem ?? ""), "a key used on another page is refused (one value per key on a card)");
ok(/longer than the 5 characters/.test(T.checkZones([zone({ max_chars: 5 })], 1, F).problem ?? ""), "a sample longer than the field's limit is refused");
ok(/choose a colour/.test(T.checkZones([zone({ colour: "gold" })], 1, F).problem ?? ""), "a colour must be #rrggbb");
ok(/card fonts/.test(T.checkZones([zone({ font: "comic" })], 1, F).problem ?? ""), "only the card fonts");
ok(T.checkZones([zone({ font: "playfair", weight: 500 })], 1, F).value?.[0].weight === 400, "a weight the font does not have becomes its nearest");
const c = T.clampZone({ x: -50, y: 1900, w: 5000, h: 10 }, F);
ok(c.x === 40 && c.w === 1000 && c.h === 24 && c.y + c.h === 1880, "a dragged box is kept inside the safe area", JSON.stringify(c));
const nz = T.newZone("text", 1, F, ["name"]);
ok(nz.key === "name_2" && T.checkZones([nz], 1, F).value, "a new field is valid as it is made, with a key nobody uses", nz.key);

/* ---- 2. the real worker on every migration ---- */
const rt = await makeRuntime();
const { call, db } = rt;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const SAM = (p, m, b, ty) => call(p, 4, m, b, ty), CEO = (p, m, b) => call(p, 1, m, b), COO = (p, m, b) => call(p, 3, m, b);
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const png = (fill) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(1080), ...be32(1920), 8, 6, 0, 0, 0, 0, 0, 0, 0, ...new Array(64).fill(fill)]);
const rules = (await CEO("/staff/card-rules")).j;
const wedding = rules.categories.find((x) => x.code === "wedding"), portrait = rules.formats.find((x) => x.code === "portrait");
let r = await SAM("/staff/card-templates", "POST", { name: "Gold Wedding", category_id: wedding.id, format_id: portrait.id, language: "both", packages: ["gold"] });
const id = r.j.template.id; let v = r.j.template.version;
r = await SAM(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: 3, specs_confirmed: true }); v = r.j.template.version;
const pages = r.j.editor.pages;
ok((await SAM(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: 4 })).j?.error?.code === "pages_incomplete", "Editable Content waits until every page is in (409)");
for (const [i, p] of pages.entries()) { r = await SAM(`/staff/card-templates/${id}/pages/${p.id}/file?version=${v}`, "PUT", png(i + 1), "image/png"); v = r.j.template.version; }
r = await SAM(`/staff/card-templates/${id}/step`, "PUT", { version: v, step: 4 });
ok(r.status === 200 && r.j.editor.step === 4 && r.j.editor.zones.length === 0 && /at least one field/.test(r.j.editor.zones_missing[0] ?? ""), "with every page in, Editable Content opens and asks for a first field", r.text);
v = r.j.template.version;
const put = (who, pageId, zones, ver = v) => who(`/staff/card-templates/${id}/zones`, "PUT", { version: ver, page_id: pageId, zones });
ok((await put(COO, pages[0].id, [zone()])).status === 403, "the COO cannot place fields (403)");
ok((await put(SAM, pages[0].id, [zone()], v - 1)).status === 409, "a stale version is refused (409)");
ok((await put(SAM, pages[0].id, [zone({ y: 1890 })])).status === 422, "a field outside the safe area is refused by the server (422)");
r = await put(SAM, pages[0].id, [zone(), zone({ key: "date", kind: "date", label: "Date", y: 1240, h: 90, font: "montserrat", weight: 600, size: 44, sample: "12 December 2026", sample_ms: "12 Disember 2026" })]);
ok(r.status === 200 && r.j.editor.zones.map((x) => x.key).join() === "names,date" && r.j.editor.zones_missing.length === 0, "the designer saves the Cover's fields; nothing is missing", r.text);
v = r.j.template.version;
ok((await put(SAM, pages[1].id, [zone({ label: "Names again" })])).j?.error?.fields?.zones?.includes('already uses the name "names"'), "a key already on the Cover is refused on another page (422)");
r = await put(SAM, pages[2].id, [zone({ key: "rsvp", label: "RSVP note", kind: "multiline", max_chars: 120, sample: "Kindly reply by 1 December" })]);
v = r.j.template.version;
ok(r.j.editor.zones.length === 3, "fields on a third page");
ok(db.prepare(`SELECT COUNT(*) AS n FROM card_template_events WHERE template_id = ? AND kind = 'zones_saved'`).get(id).n === 2 && db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'card_template.zones'`).get().n === 2, "each save is one history event and one audit row");
r = await SAM(`/staff/card-templates/${id}/pages`, "PUT", { version: v, pages: [{ id: pages[0].id }, { id: pages[1].id }] });
ok(r.status === 200 && r.j.editor.zones.length === 2 && !r.j.editor.zones.some((x) => x.key === "rsvp"), "removing a page removes its fields", r.text);
v = r.j.template.version;
r = await put(SAM, pages[0].id, [zone()]);
ok(r.status === 200 && r.j.editor.zones.map((x) => x.key).join() === "names", "saving a page replaces that page's fields (the date is gone)");
v = r.j.template.version;
/* the CEO widens the margins: the field that no longer fits says so */
const pf = (await CEO("/staff/card-rules")).j.formats.find((x) => x.code === "portrait");
r = await CEO(`/staff/card-rules/formats/${pf.id}`, "PUT", { ...pf, margin_left: 200, reason: "testing wider margins on a field" });
ok(r.status === 200, "(setup) the CEO widens the left margin to 200 px", r.text);
r = await SAM(`/staff/card-templates/${id}`);
ok(r.j.editor.zones_missing.some((x) => /Names: now outside the safe area/.test(x)), "the field that no longer fits is named");
db.prepare(`UPDATE card_templates SET state = 'in_review' WHERE id = ?`).run(id);
ok((await put(SAM, pages[0].id, [zone({ x: 220, w: 700 })], r.j.template.version)).status === 409, "a template in review takes no field change (409)");
let refused = false; try { db.exec(`DELETE FROM card_template_zones WHERE template_id = ${id}`); } catch { refused = true; }
ok(refused, "the 0224 triggers refuse a field change in review, whatever calls the database");

/* ---- 3. the wiring ---- */
const ui = read("components/portal/card-zones.tsx"), idx = read("worker/src/index.ts");
ok(/pageBoxes\(/.test(ui) && /boxStyle\(b\)/.test(ui) && /frameStyle\(page\)/.test(ui), "the portal draws a card with the renderer's boxes and styles - no second layout");
ok(/clampZone\(/.test(ui) && /newZone\(/.test(ui), "dragging and new fields use the shared rules");
ok(/href="\/card-fonts\/card-fonts\.css"/.test(ui), "the card fonts load from our own site");
ok(/EDITOR_STEPS = 4/.test(read("lib/card-templates.ts")), "the editor has four steps now");
ok(/"0224_card_template_zones",/.test(idx) && /\["0224 \(digital card editable content\)/.test(idx), "0224 is in the expected list and probed (v1.395.0: 0225 follows it)");
const mig = read("worker/migrations/0224_card_template_zones.sql").replace(/--.*$/gm, "");
ok(!/\b(DROP|ALTER)\b/i.test(mig), "0224 is additive only");

const failed = results.filter(([x]) => !x);
for (const [x, m] of results) console.log(`${x ? "  ✓" : "  ✗"} ${m}`);
if (failed.length) { console.log(`\n${failed.length} check(s) failed.`); process.exit(1); }
console.log(`\n${results.length} check(s) passed.`);
