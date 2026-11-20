/* v1.392.0 - DIGITAL CARD TEMPLATES (Digital Cards Stage 3, the CEO 21-11-2026; migration 0222).
 *
 * The template master records kept by A2Z OS. One door in staff.ts: /card-templates...
 *
 *   GET  /card-templates/summary          the four strip figures (card_template_view)
 *   GET  /card-templates?view=&q=&category=  all | mine | review | published (card_template_view)
 *   GET  /card-templates/:id              one template and its history (card_template_view)
 *   POST /card-templates                  a new draft (card_template_manage)
 *   PUT  /card-templates/:id              change your own draft (designer, draft/returned, version)
 *   POST /card-templates/:id/archive      archive your own draft (reason)
 *   POST /card-templates/:id/restore      bring your own archived draft back
 *
 * Rules: a template is never deleted (0222 trigger); only its designer changes it, and only as
 * a draft or returned; every change carries the version it started from (stale = 409) and
 * writes one card_template_events row (append-only) and the audit. The information is checked
 * by lib/card-templates.ts, shared with the portal. Pages, review and publishing are later stages.
 *
 * v1.393.0 - Stage 4: the editor (migration 0223). Every step is saved here, so a draft survives a
 * refresh or another device:
 *   PUT  /card-templates/:id/step         {version, step, specs_confirmed?} - Design Specs is
 *                                         confirmed against the rule versions of that moment
 *                                         (specsKey); entering Upload Pages plans the pages from
 *                                         the category the first time
 *   PUT  /card-templates/:id/pages        {version, pages} - add, rename, remove or move pages
 *                                         (checkPagePlan: required pages stay, the Cover first)
 *   PUT  /card-templates/:id/pages/:p/file?version=  the raw PNG/JPG body of one page - read by
 *                                         lib/card-image.ts on the server: the real type, the exact
 *                                         canvas size, CMYK refused, the size limit, the SHA-256
 *   GET  /card-templates/:id/pages/:p/image           the page's artwork (card_template_view)
 * Files live under private/card-templates/<id>/ in MEDIA and are never served by /media/file.
 * A replaced file stays in storage; the history names its SHA-256.
 *
 * v1.394.0 - Stage 5: Editable Content (migration 0224). The fields a customer fills in, placed on
 * a page in canvas pixels and drawn by lib/card-render.ts (the one renderer, AZ ONE gets a copy):
 *   PUT  /card-templates/:id/zones        {version, page_id, zones} - one page's fields, checked by
 *                                         lib/card-templates.ts checkZones (inside the safe area,
 *                                         a card font, a key unique in the template, a sample)
 * Step 4 opens only when every page is in and fits; a removed page takes its fields with it.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { canUser } from "./permissions";
import { audit, err, json } from "./shared";
import { loadCardRules } from "./card-rules";
import { pageFileProblems, readImageHeader } from "../../lib/card-image";
import { EDITABLE_STATES, EDITOR_STEPS, KPI_OF, PACKAGES, TEMPLATE_LIMITS, canEditTemplate, checkPagePlan, checkTemplateInfo, checkZones, initialPlan, pagesReady, specsKey, templateCode, zonesReady, type PlanPage, type TemplatePackage } from "../../lib/card-templates";
import type { CardZone } from "../../lib/card-render";

interface Row {
  id: number; code: string; name: string; description: string | null; category_id: number; format_id: number;
  language: string; packages: string; state: string; version: number; published_version: number | null;
  designer_id: number; created_at: string; updated_at: string;
  step: number; specs_key: string | null; specs_confirmed_at: string | null; pages_done: number; pages_total: number;
  category_name: string | null; category_name_ms: string | null; format_name: string | null; format_name_ms: string | null;
  width_px: number | null; height_px: number | null; designer_name: string | null;
}
const SELECT = `SELECT t.*, c.name AS category_name, c.name_ms AS category_name_ms, f.name AS format_name, f.name_ms AS format_name_ms,
  f.width_px, f.height_px, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS designer_name,
  (SELECT COUNT(*) FROM card_template_pages p WHERE p.template_id = t.id AND p.r2_key IS NOT NULL) AS pages_done,
  (SELECT COUNT(*) FROM card_template_pages p WHERE p.template_id = t.id) AS pages_total
  FROM card_templates t LEFT JOIN card_category_rules c ON c.id = t.category_id LEFT JOIN card_formats f ON f.id = t.format_id LEFT JOIN users u ON u.id = t.designer_id`;
const packagesOf = (s: string): TemplatePackage[] => { try { const a = JSON.parse(s); return Array.isArray(a) ? PACKAGES.filter((p) => a.includes(p)) : []; } catch { return []; } };
const view = (r: Row, user: StaffUser) => ({
  ...r, packages: packagesOf(r.packages), mine: r.designer_id === user.id,
  can_edit: canEditTemplate(r, user.id, canUser(user, "card_template_manage")),
});
const placeholders = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `?${i + from}`).join(", ");
const notMigrated = (e: unknown) => /no such table|no such column/i.test(String((e as Error)?.message ?? e));
const invalid = (problems: Record<string, string>) =>
  json({ error: { code: "invalid", message: Object.values(problems)[0] ?? "Check the highlighted fields", fields: problems } }, 422);

async function activeRules(env: Env) {
  const [c, f] = await Promise.all([
    env.DB.prepare(`SELECT id FROM card_category_rules WHERE active = 1`).all<{ id: number }>(),
    env.DB.prepare(`SELECT id FROM card_formats WHERE active = 1`).all<{ id: number }>(),
  ]);
  return { categories: (c.results ?? []).map((r) => r.id), formats: (f.results ?? []).map((r) => r.id) };
}
interface PageRow {
  id: number; template_id: number; position: number; title: string; title_ms: string | null; required: number;
  r2_key: string | null; mime: string | null; width_px: number | null; height_px: number | null; bytes: number | null;
  sha256: string | null; file_name: string | null; uploaded_at: string | null;
}
const pageRows = async (env: Env, id: number) =>
  (await env.DB.prepare(`SELECT * FROM card_template_pages WHERE template_id = ?1 ORDER BY position, id`).bind(id).all<PageRow>()).results ?? [];
interface ZoneRow { id: number; page_id: number; sort: number; key: string; kind: string; label: string; label_ms: string | null; x: number; y: number; w: number; h: number; font: string; weight: number; size: number; colour: string; align: string; max_chars: number; required: number; sample: string; sample_ms: string | null }
const zoneRows = async (env: Env, id: number) =>
  (await env.DB.prepare(`SELECT z.* FROM card_template_zones z JOIN card_template_pages p ON p.id = z.page_id WHERE z.template_id = ?1 ORDER BY p.position, z.sort, z.id`).bind(id).all<ZoneRow>()).results ?? [];
const zoneOf = (r: ZoneRow): CardZone => ({
  key: r.key, page_id: r.page_id, kind: r.kind as CardZone["kind"], label: r.label, label_ms: r.label_ms, x: r.x, y: r.y, w: r.w, h: r.h,
  font: r.font as CardZone["font"], weight: r.weight, size: r.size, colour: r.colour, align: r.align as CardZone["align"],
  max_chars: r.max_chars, required: Boolean(r.required), sample: r.sample, sample_ms: r.sample_ms,
});
const planOf = (rows: PageRow[]): PlanPage[] => rows.map((r) => ({ id: r.id, title: r.title, title_ms: r.title_ms, required: Boolean(r.required) }));
const changed = () => err("changed", "This template was saved since you opened it - reload and try again", 409);

/** one template, its history, and its editor: the step, the specs, the pages and what still stops them */
async function detail(env: Env, id: number, user: StaffUser): Promise<Response> {
  const t = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(id).first<Row>();
  if (!t || (t.state === "archived" && t.designer_id !== user.id)) return err("not_found", "That template does not exist", 404);
  const [{ results: events }, rows, rules, zrows] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id, e.version, e.kind, e.note, e.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS actor_name
         FROM card_template_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.template_id = ?1 ORDER BY e.id DESC LIMIT 50`,
    ).bind(t.id).all<{ id: number; version: number; kind: string; note: string | null; created_at: string; actor_name: string | null }>(),
    pageRows(env, t.id),
    loadCardRules(env),
    zoneRows(env, t.id),
  ]);
  const zones = zrows.map(zoneOf);
  const format = rules.formats.find((f) => f.id === t.format_id) ?? null;
  const category = rules.categories.find((c) => c.id === t.category_id) ?? null;
  const shaCount = new Map<string, number>();
  for (const r of rows) if (r.sha256) shaCount.set(r.sha256, (shaCount.get(r.sha256) ?? 0) + 1);
  const pages = rows.map((r) => ({
    id: r.id, position: r.position, title: r.title, title_ms: r.title_ms, required: Boolean(r.required), has_file: Boolean(r.r2_key),
    mime: r.mime, width_px: r.width_px, height_px: r.height_px, bytes: r.bytes, sha256: r.sha256, file_name: r.file_name, uploaded_at: r.uploaded_at,
    /* a file is judged against the format as it is NOW - a format changed after the upload shows here */
    problems: r.r2_key && format ? pageFileProblems({ mime: (r.mime ?? "image/png") as "image/png", width: r.width_px ?? 0, height: r.height_px ?? 0, components: 3 }, r.bytes ?? 0, format) : [],
    duplicate: Boolean(r.sha256 && (shaCount.get(r.sha256) ?? 0) > 1),
  }));
  const keyNow = format && category ? specsKey(format, category) : null;
  return json({
    template: view(t, user), events: events ?? [],
    editor: {
      step: t.step ?? 1, steps: EDITOR_STEPS, format, category,
      specs_ok: Boolean(keyNow && t.specs_key === keyNow), specs_confirmed_at: t.specs_confirmed_at,
      rules_on: Boolean(format?.active && category?.active),
      pages, plan_started: rows.length > 0,
      missing: category ? pagesReady(pages, category) : ["The category of this template no longer exists"],
      /* v1.394.0 - the fields, and what still stops Editable Content (a format changed since shows here) */
      zones, zones_missing: format ? zonesReady(zones, format) : [],
    },
  });
}

/** claim the next version of a template the caller may change; false when someone saved first */
async function claim(env: Env, t: Row, user: StaffUser, set = "", args: unknown[] = []): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE card_templates SET ${set ? `${set}, ` : ""}version = ?1, updated_at = datetime('now'), updated_by = ?2 WHERE id = ?3 AND version = ?4`)
    .bind(t.version + 1, user.id, t.id, t.version, ...args).run();
  return Boolean(r.meta.changes);
}
const event = (env: Env, t: Row, user: StaffUser, kind: string, note: string | null, detailJson: unknown) =>
  env.DB.prepare(`INSERT INTO card_template_events (template_id, version, kind, actor_id, note, detail_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(t.id, t.version + 1, kind, user.id, note, detailJson == null ? null : JSON.stringify(detailJson)).run();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** a code nobody holds: the name's, then -2, -3 ... */
async function freeCode(env: Env, name: string): Promise<string> {
  const base = templateCode(name);
  const { results } = await env.DB.prepare(`SELECT code FROM card_templates WHERE code = ?1 OR code LIKE ?2`).bind(base, `${base}-%`).all<{ code: string }>();
  const taken = new Set((results ?? []).map((r) => r.code));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function handleCardTemplates(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams, request?: Request,
): Promise<Response | null> {
  if (path !== "/card-templates" && !path.startsWith("/card-templates/")) return null;
  if (!canUser(user, "card_template_view")) return err("forbidden", "Digital Cards is for the designers, the COO and CCO, the CEO and the super admin", 403);
  const manage = canUser(user, "card_template_manage");
  try {
    if (path === "/card-templates/summary" && method === "GET") {
      const { results } = await env.DB.prepare(`SELECT state, COUNT(*) AS n FROM card_templates GROUP BY state`).all<{ state: string; n: number }>();
      const by = Object.fromEntries((results ?? []).map((r) => [r.state, r.n]));
      const sum = (states: readonly string[]) => states.reduce((a, s) => a + (by[s] ?? 0), 0);
      const mine = await env.DB.prepare(`SELECT COUNT(*) AS n FROM card_templates WHERE designer_id = ?1 AND state IN (${placeholders(EDITABLE_STATES.length, 2)})`)
        .bind(user.id, ...EDITABLE_STATES).first<{ n: number }>();
      return json({ total: sum(KPI_OF.total), drafts: sum(KPI_OF.drafts), in_review: sum(KPI_OF.in_review), published: sum(KPI_OF.published), mine: mine?.n ?? 0, can_create: manage });
    }

    if (path === "/card-templates" && method === "GET") {
      const v = params.get("view") ?? "all";
      const where: string[] = [];
      const args: unknown[] = [];
      const bind = (x: unknown) => { args.push(x); return `?${args.length}`; };
      if (v === "mine") where.push(`t.designer_id = ${bind(user.id)} AND t.state IN ('draft', 'returned')`);
      else if (v === "review") where.push(`t.state = 'in_review'`);
      else if (v === "published") where.push(`t.state = 'published'`);
      else if (v === "archived") where.push(`t.state = 'archived' AND t.designer_id = ${bind(user.id)}`);
      else where.push(`t.state != 'archived'`);
      const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 60);
      if (q) { const like = bind(`%${q.replace(/[%_]/g, "")}%`); where.push(`(LOWER(t.name) LIKE ${like} OR LOWER(t.code) LIKE ${like} OR LOWER(COALESCE(t.description, '')) LIKE ${like})`); }
      const cat = Number(params.get("category"));
      if (Number.isInteger(cat) && cat > 0) where.push(`t.category_id = ${bind(cat)}`);
      const { results } = await env.DB.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC, t.id DESC LIMIT 200`).bind(...args).all<Row>();
      return json({ templates: (results ?? []).map((r) => view(r, user)), view: v, can_create: manage });
    }

    const one = path.match(/^\/card-templates\/(\d+)$/);
    if (one && method === "GET") return await detail(env, Number(one[1]), user);

    /* v1.393.0 - a page's artwork, for everyone who may open Digital Cards (the archive rule as above) */
    const img = path.match(/^\/card-templates\/(\d+)\/pages\/(\d+)\/image$/);
    if (img && method === "GET") {
      const t = await env.DB.prepare(`SELECT id, state, designer_id FROM card_templates WHERE id = ?1`).bind(Number(img[1])).first<{ id: number; state: string; designer_id: number }>();
      if (!t || (t.state === "archived" && t.designer_id !== user.id)) return err("not_found", "That template does not exist", 404);
      const pg = await env.DB.prepare(`SELECT r2_key, mime FROM card_template_pages WHERE id = ?1 AND template_id = ?2`).bind(Number(img[2]), t.id).first<{ r2_key: string | null; mime: string | null }>();
      if (!pg?.r2_key) return err("not_found", "No artwork on this page yet", 404);
      const obj = await env.MEDIA.get(pg.r2_key);
      if (!obj) return err("not_found", "The artwork is missing from storage", 404);
      return new Response(obj.body, { headers: {
        "Content-Type": pg.mime ?? "application/octet-stream", "X-Content-Type-Options": "nosniff",
        /* the URL carries the file's SHA-256, so a replaced page is a new URL */
        "Cache-Control": "private, max-age=86400", "Content-Disposition": "inline",
      } });
    }

    /* v1.393.0 - the editor's writes: the designer's own draft or returned template, at its version */
    const ed = path.match(/^\/card-templates\/(\d+)\/(step|pages|zones)(?:\/(\d+)\/file)?$/);
    if (ed && method === "PUT") {
      const id = Number(ed[1]);
      const t = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(id).first<Row>();
      if (!t || (t.state === "archived" && t.designer_id !== user.id)) return err("not_found", "That template does not exist", 404);
      if (!manage || t.designer_id !== user.id) return err("forbidden", "Only the designer of this template changes it", 403);
      if (!(EDITABLE_STATES as readonly string[]).includes(t.state)) return err("locked", "Only a draft or a returned template can be changed", 409);
      const version = Number(ed[3] ? params.get("version") : body?.version);
      if (!Number.isInteger(version) || version !== t.version) return changed();
      const rules = await loadCardRules(env);
      const format = rules.formats.find((f) => f.id === t.format_id);
      const category = rules.categories.find((c) => c.id === t.category_id);
      if (!format || !category) return err("rules_missing", "The format or category of this template no longer exists", 409);
      const keyNow = specsKey(format, category);

      if (ed[2] === "step") {
        const step = Number(body?.step);
        if (!Number.isInteger(step) || step < 1 || step > EDITOR_STEPS) return invalid({ step: `A step from 1 to ${EDITOR_STEPS}` });
        const confirm = body?.specs_confirmed === true;
        if (step === 3 && !confirm && t.specs_key !== keyNow) return err("specs_needed", "Confirm the design specs first - they changed or were not confirmed yet", 409);
        if (step >= 2 && !(format.active && category.active)) return err("rules_off", "The format or category of this template is switched off - choose another in Template Info", 409);
        if (step === 4) {
          const have = await pageRows(env, id);
          const left = have.length ? pagesReady(have.map((r) => ({ title: r.title, has_file: Boolean(r.r2_key), problems: r.r2_key ? pageFileProblems({ mime: (r.mime ?? "image/png") as "image/png", width: r.width_px ?? 0, height: r.height_px ?? 0, components: 3 }, r.bytes ?? 0, format) : [] })), category) : ["no pages"];
          if (t.specs_key !== keyNow || left.length) return err("pages_incomplete", "Finish Upload Pages first - every page needs its artwork, at the right size", 409);
        }
        const rows = step === 3 ? await pageRows(env, id) : [];
        const ok = confirm
          ? await claim(env, t, user, `step = ?5, specs_key = ?6, specs_confirmed_at = datetime('now')`, [step, keyNow])
          : await claim(env, t, user, `step = ?5`, [step]);
        if (!ok) return changed();
        if (confirm) {
          await event(env, t, user, "specs_confirmed", null, { format: format.code, format_version: format.version, category: category.code, category_version: category.version });
          await audit(env, user.id, "card_template.specs_confirm", "card_templates", String(id), { code: t.code, specs: keyNow });
        }
        if (step === 3 && !rows.length) {
          const plan = initialPlan(category);
          await env.DB.batch(plan.map((p, i) => env.DB.prepare(`INSERT INTO card_template_pages (template_id, position, title, title_ms, required) VALUES (?1, ?2, ?3, ?4, ?5)`)
            .bind(id, i + 1, p.title, p.title_ms, p.required ? 1 : 0)));
          await env.DB.prepare(`INSERT INTO card_template_events (template_id, version, kind, actor_id, note, detail_json) VALUES (?1, ?2, 'pages_planned', ?3, NULL, ?4)`)
            .bind(id, t.version + 1, user.id, JSON.stringify(plan.map((p) => p.title))).run();
        }
        return await detail(env, id, user);
      }

      const rows = await pageRows(env, id);
      if (!rows.length) return err("no_pages", "Open Upload Pages first - the pages are set up there", 409);

      if (ed[2] === "zones") {
        const page = rows.find((r) => r.id === Number(body?.page_id));
        if (!page) return err("not_found", "That page is not part of this template", 404);
        const others = (await zoneRows(env, id)).filter((z) => z.page_id !== page.id).map((z) => z.key);
        const { value, problem } = checkZones(body?.zones, page.id, format, others);
        if (!value) return invalid({ zones: problem! });
        if (!(await claim(env, t, user))) return changed();
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM card_template_zones WHERE template_id = ?1 AND page_id = ?2`).bind(id, page.id),
          ...value.map((z, i) => env.DB.prepare(
            `INSERT INTO card_template_zones (template_id, page_id, sort, key, kind, label, label_ms, x, y, w, h, font, weight, size, colour, align, max_chars, required, sample, sample_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`,
          ).bind(id, page.id, i, z.key, z.kind, z.label, z.label_ms, z.x, z.y, z.w, z.h, z.font, z.weight, z.size, z.colour, z.align, z.max_chars, z.required ? 1 : 0, z.sample, z.sample_ms)),
        ]);
        await event(env, t, user, "zones_saved", page.title, { page: page.title, fields: value.map((z) => z.key) });
        await audit(env, user.id, "card_template.zones", "card_templates", String(id), { code: t.code, page: page.title, fields: value.map((z) => z.key) });
        return await detail(env, id, user);
      }

      if (!ed[3]) {
        const { value, problem } = checkPagePlan(planOf(rows), body?.pages, category);
        if (!value) return invalid({ pages: problem! });
        if (!(await claim(env, t, user))) return changed();
        const keep = new Set(value.filter((p) => p.id != null).map((p) => p.id!));
        const removed = rows.filter((r) => !keep.has(r.id));
        const stmts: D1PreparedStatement[] = [];
        for (const r of removed) {
          stmts.push(env.DB.prepare(`DELETE FROM card_template_zones WHERE page_id = ?1 AND template_id = ?2`).bind(r.id, id)); // v1.394.0 - a page takes its fields with it
          stmts.push(env.DB.prepare(`DELETE FROM card_template_pages WHERE id = ?1 AND template_id = ?2`).bind(r.id, id));
        }
        value.forEach((p, i) => stmts.push(p.id != null
          ? env.DB.prepare(`UPDATE card_template_pages SET position = ?1, title = ?2, title_ms = ?3 WHERE id = ?4 AND template_id = ?5`).bind(i + 1, p.title, p.title_ms, p.id, id)
          : env.DB.prepare(`INSERT INTO card_template_pages (template_id, position, title, title_ms, required) VALUES (?1, ?2, ?3, ?4, 0)`).bind(id, i + 1, p.title, p.title_ms)));
        await env.DB.batch(stmts);
        await event(env, t, user, "pages_changed", null, {
          order: value.map((p) => p.title), removed: removed.map((r) => ({ title: r.title, sha256: r.sha256 })), added: value.filter((p) => p.id == null).map((p) => p.title),
        });
        await audit(env, user.id, "card_template.pages", "card_templates", String(id), { code: t.code, pages: value.map((p) => p.title) });
        return await detail(env, id, user);
      }

      /* one page's artwork: raw body, read on the server */
      const page = rows.find((r) => r.id === Number(ed[3]));
      if (!page) return err("not_found", "That page is not part of this template", 404);
      if (!request?.body) return invalid({ file: "Choose a PNG or JPG file" });
      const declared = Number(request.headers.get("Content-Length") ?? "");
      if (Number.isFinite(declared) && declared > format.max_bytes) return err("too_large", `The file is larger than the ${Math.round(format.max_bytes / 1048576)} MB limit`, 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > format.max_bytes) return err("too_large", `The file is larger than the ${Math.round(format.max_bytes / 1048576)} MB limit`, 413);
      const header = readImageHeader(bytes);
      const problems = pageFileProblems(header, bytes.length, format);
      if (problems.length || "error" in header) return json({ error: { code: "invalid_page", message: problems[0] ?? "Not a PNG or JPG image", problems } }, 422);
      const sha = await sha256Hex(bytes);
      if (!(await claim(env, t, user))) return changed();
      const key = `private/card-templates/${id}/page-${page.id}-${sha.slice(0, 16)}.${header.mime === "image/png" ? "png" : "jpg"}`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: header.mime }, customMetadata: { sha256: sha, template: t.code } });
      const fileName = (request.headers.get("X-File-Name") ?? "").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || null;
      await env.DB.prepare(
        `UPDATE card_template_pages SET r2_key = ?1, mime = ?2, width_px = ?3, height_px = ?4, bytes = ?5, sha256 = ?6, file_name = ?7, uploaded_by = ?8, uploaded_at = datetime('now')
          WHERE id = ?9 AND template_id = ?10`,
      ).bind(key, header.mime, header.width, header.height, bytes.length, sha, fileName, user.id, page.id, id).run();
      await event(env, t, user, "page_uploaded", page.title, { page: page.title, position: page.position, sha256: sha, width: header.width, height: header.height, bytes: bytes.length, replaced: page.sha256 });
      await audit(env, user.id, "card_template.page_upload", "card_templates", String(id), { code: t.code, page: page.title, sha256: sha, replaced: page.sha256 });
      return await detail(env, id, user);
    }

    if (path === "/card-templates" && method === "POST") {
      if (!manage) return err("forbidden", "Only Sales & Marketing (the designers), the CEO and the super admin create templates", 403);
      const { value, problems } = checkTemplateInfo(body ?? {}, await activeRules(env));
      if (!value) return invalid(problems);
      const code = await freeCode(env, value.name);
      const row = await env.DB.prepare(
        `INSERT INTO card_templates (code, name, description, category_id, format_id, language, packages, designer_id, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) RETURNING id`,
      ).bind(code, value.name, value.description, value.category_id, value.format_id, value.language, JSON.stringify(value.packages), user.id).first<{ id: number }>();
      await env.DB.prepare(`INSERT INTO card_template_events (template_id, version, kind, actor_id, detail_json) VALUES (?1, 1, 'created', ?2, ?3)`)
        .bind(row!.id, user.id, JSON.stringify(value)).run();
      await audit(env, user.id, "card_template.create", "card_templates", String(row!.id), { code });
      const t = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(row!.id).first<Row>();
      return json({ ok: true, template: view(t!, user) }, 201);
    }

    const act = path.match(/^\/card-templates\/(\d+)(?:\/(archive|restore))?$/);
    if (act && (method === "PUT" || (method === "POST" && act[2]))) {
      const id = Number(act[1]);
      const t = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(id).first<Row>();
      if (!t || (t.state === "archived" && t.designer_id !== user.id)) return err("not_found", "That template does not exist", 404);
      if (!manage || t.designer_id !== user.id) return err("forbidden", "Only the designer of this template changes it", 403);
      const version = Number(body?.version);
      if (!Number.isInteger(version) || version !== t.version) return err("changed", "This template was saved since you opened it - reload and try again", 409);
      const next = t.version + 1;
      let set: string, kind: string, note: string | null = null, detail: unknown = null, extra: unknown[] = [], replan = false;
      if (method === "PUT") {
        if (!(EDITABLE_STATES as readonly string[]).includes(t.state)) return err("locked", "Only a draft or a returned template can be changed", 409);
        const { value, problems } = checkTemplateInfo(body ?? {}, await activeRules(env));
        if (!value) return invalid(problems);
        set = `name = ?4, description = ?5, category_id = ?6, format_id = ?7, language = ?8, packages = ?9`;
        extra = [value.name, value.description, value.category_id, value.format_id, value.language, JSON.stringify(value.packages)];
        kind = "edited"; detail = value;
        /* v1.393.0 - artwork is made for one format and category: they change only before any is uploaded,
           and a change sends the designer back to Design Specs with a new page plan */
        if (value.category_id !== t.category_id || value.format_id !== t.format_id) {
          if (t.pages_done > 0) return err("pages_uploaded", "Artwork is already uploaded for this format and category - start a new template for another one", 409);
          set += `, step = MIN(step, 2)`;
          replan = t.pages_total > 0;
        }
      } else {
        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
        if (act[2] === "archive") {
          if (!(EDITABLE_STATES as readonly string[]).includes(t.state)) return err("locked", "Only a draft or a returned template can be archived", 409);
          if (reason.length < TEMPLATE_LIMITS.reason || reason.length > 500) return invalid({ reason: `Say why, in at least ${TEMPLATE_LIMITS.reason} characters` });
          set = `state = 'archived'`; kind = "archived"; note = reason;
        } else {
          if (t.state !== "archived") return err("locked", "Only an archived template can be brought back", 409);
          set = `state = 'draft'`; kind = "restored"; note = reason || null;
        }
      }
      const r = await env.DB.prepare(`UPDATE card_templates SET ${set}, version = ?1, updated_at = datetime('now'), updated_by = ?2 WHERE id = ?3 AND version = ${t.version}`)
        .bind(next, user.id, id, ...extra).run();
      if (!r.meta.changes) return err("changed", "This template was saved since you opened it - reload and try again", 409);
      if (replan) {
        await env.DB.prepare(`DELETE FROM card_template_zones WHERE template_id = ?1 AND page_id IN (SELECT id FROM card_template_pages WHERE template_id = ?1 AND r2_key IS NULL)`).bind(id).run();
        await env.DB.prepare(`DELETE FROM card_template_pages WHERE template_id = ?1 AND r2_key IS NULL`).bind(id).run();
      }
      await env.DB.prepare(`INSERT INTO card_template_events (template_id, version, kind, actor_id, note, detail_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(id, next, kind, user.id, note, detail ? JSON.stringify(detail) : null).run();
      await audit(env, user.id, `card_template.${kind === "edited" ? "update" : kind === "archived" ? "archive" : "restore"}`, "card_templates", String(id), { code: t.code, version: next, ...(note ? { reason: note } : {}) });
      const fresh = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(id).first<Row>();
      return json({ ok: true, template: view(fresh!, user) });
    }
  } catch (e) {
    if (notMigrated(e)) return err("migration_needed", "Digital card templates need database updates 0222 to 0224 - run PUSH-A2ZCREATIVE.bat", 409);
    throw e;
  }
  return err("not_found", "Not found", 404);
}
