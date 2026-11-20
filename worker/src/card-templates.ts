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
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { canUser } from "./permissions";
import { audit, err, json } from "./shared";
import { EDITABLE_STATES, KPI_OF, PACKAGES, TEMPLATE_LIMITS, canEditTemplate, checkTemplateInfo, templateCode, type TemplatePackage } from "../../lib/card-templates";

interface Row {
  id: number; code: string; name: string; description: string | null; category_id: number; format_id: number;
  language: string; packages: string; state: string; version: number; published_version: number | null;
  designer_id: number; created_at: string; updated_at: string;
  category_name: string | null; category_name_ms: string | null; format_name: string | null; format_name_ms: string | null;
  width_px: number | null; height_px: number | null; designer_name: string | null;
}
const SELECT = `SELECT t.*, c.name AS category_name, c.name_ms AS category_name_ms, f.name AS format_name, f.name_ms AS format_name_ms,
  f.width_px, f.height_px, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS designer_name
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
/** a code nobody holds: the name's, then -2, -3 ... */
async function freeCode(env: Env, name: string): Promise<string> {
  const base = templateCode(name);
  const { results } = await env.DB.prepare(`SELECT code FROM card_templates WHERE code = ?1 OR code LIKE ?2`).bind(base, `${base}-%`).all<{ code: string }>();
  const taken = new Set((results ?? []).map((r) => r.code));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function handleCardTemplates(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams,
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
    if (one && method === "GET") {
      const t = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(Number(one[1])).first<Row>();
      if (!t || (t.state === "archived" && t.designer_id !== user.id)) return err("not_found", "That template does not exist", 404);
      const { results } = await env.DB.prepare(
        `SELECT e.id, e.version, e.kind, e.note, e.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS actor_name
           FROM card_template_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.template_id = ?1 ORDER BY e.id DESC LIMIT 50`,
      ).bind(t.id).all<{ id: number; version: number; kind: string; note: string | null; created_at: string; actor_name: string | null }>();
      return json({ template: view(t, user), events: results ?? [] });
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
      let set: string, kind: string, note: string | null = null, detail: unknown = null, extra: unknown[] = [];
      if (method === "PUT") {
        if (!(EDITABLE_STATES as readonly string[]).includes(t.state)) return err("locked", "Only a draft or a returned template can be changed", 409);
        const { value, problems } = checkTemplateInfo(body ?? {}, await activeRules(env));
        if (!value) return invalid(problems);
        set = `name = ?4, description = ?5, category_id = ?6, format_id = ?7, language = ?8, packages = ?9`;
        extra = [value.name, value.description, value.category_id, value.format_id, value.language, JSON.stringify(value.packages)];
        kind = "edited"; detail = value;
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
      await env.DB.prepare(`INSERT INTO card_template_events (template_id, version, kind, actor_id, note, detail_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(id, next, kind, user.id, note, detail ? JSON.stringify(detail) : null).run();
      await audit(env, user.id, `card_template.${kind === "edited" ? "update" : kind === "archived" ? "archive" : "restore"}`, "card_templates", String(id), { code: t.code, version: next, ...(note ? { reason: note } : {}) });
      const fresh = await env.DB.prepare(`${SELECT} WHERE t.id = ?1`).bind(id).first<Row>();
      return json({ ok: true, template: view(fresh!, user) });
    }
  } catch (e) {
    if (notMigrated(e)) return err("migration_needed", "Digital card templates need database update 0222 - run PUSH-A2ZCREATIVE.bat", 409);
    throw e;
  }
  return err("not_found", "Not found", 404);
}
