/* v1.391.0 - DIGITAL CARD RULES (Digital Cards Stage 2, the CEO 20-11-2026; migration 0221).
 *
 * The formats (design canvases) and the pages per category that every digital card
 * template will be checked against. One door in staff.ts: /card-rules...
 *
 *   GET  /card-rules                     formats + categories (+ can_edit)
 *   POST /card-rules/formats             add a format          (card_format_admin)
 *   PUT  /card-rules/formats/:id         change a format       (card_format_admin)
 *   POST /card-rules/categories          add a category        (card_format_admin)
 *   PUT  /card-rules/categories/:id      change a category     (card_format_admin)
 *   GET  /card-rules/history?entity=&id= the saved versions of one rule
 *
 * Rules:
 * - the values are checked by lib/card-rules.ts, the same file the Guidelines are drawn
 *   from; a save carries a reason (8+ characters) and the version it was based on - a
 *   stale version is 409 "changed", never an overwrite;
 * - every save writes one card_rule_history row (append-only, 0221 triggers) and the audit;
 * - nothing is deleted: a rule is switched off (active = 0), and the last active format or
 *   category cannot be switched off;
 * - Stage 2 reads are card_format_admin too (the tab is the CEO's and the super admin's
 *   until the templates arrive in Stage 3). DPI is never a rule (screen cards, D9).
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { canUser } from "./permissions";
import { audit, err, json } from "./shared";
import { CARD_TYPES, LIMITS, checkCategory, checkFormat, codeOf, type CardCategory, type CardFormat, type CardPage, type CardType } from "../../lib/card-rules";

type FormatRow = Omit<CardFormat, "accepted_types" | "active"> & { accepted_types: string; active: number; updated_by_name: string | null };
type CategoryRow = Omit<CardCategory, "pages" | "active" | "allow_reorder"> & { pages_json: string; active: number; allow_reorder: number; updated_by_name: string | null };

const parse = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };
export const formatOf = (r: FormatRow): CardFormat => ({
  ...r, active: r.active === 1,
  accepted_types: parse<string[]>(r.accepted_types, []).filter((t): t is CardType => (CARD_TYPES as readonly string[]).includes(t)),
});
export const categoryOf = (r: CategoryRow): CardCategory => {
  const { pages_json, ...rest } = r;
  return { ...rest, active: r.active === 1, allow_reorder: r.allow_reorder === 1, pages: parse<CardPage[]>(pages_json, []) };
};

const FORMAT_SQL = `SELECT f.*, u.name AS updated_by_name FROM card_formats f LEFT JOIN users u ON u.id = f.updated_by`;
const CATEGORY_SQL = `SELECT c.*, u.name AS updated_by_name FROM card_category_rules c LEFT JOIN users u ON u.id = c.updated_by`;

/** the rules, for this module and for the template stages that follow */
export async function loadCardRules(env: Env): Promise<{ formats: CardFormat[]; categories: CardCategory[] }> {
  const [f, c] = await Promise.all([
    env.DB.prepare(`${FORMAT_SQL} ORDER BY f.sort, f.id`).all<FormatRow>(),
    env.DB.prepare(`${CATEGORY_SQL} ORDER BY c.sort, c.id`).all<CategoryRow>(),
  ]);
  return { formats: (f.results ?? []).map(formatOf), categories: (c.results ?? []).map(categoryOf) };
}

const notMigrated = (e: unknown) => /no such table|no such column/i.test(String((e as Error)?.message ?? e));
const migrationNeeded = () => err("migration_needed", "Digital card rules need database update 0221 - run PUSH-A2ZCREATIVE.bat", 409);
const reasonOf = (body: Record<string, unknown> | null) => {
  const r = typeof body?.reason === "string" ? body.reason.trim() : "";
  return r.length >= LIMITS.reason && r.length <= 500 ? r : null;
};
const invalid = (problems: Record<string, string>) =>
  json({ error: { code: "invalid", message: Object.values(problems)[0] ?? "Check the highlighted fields", fields: problems } }, 422);

/** the UPDATE (guarded by the version it started from) and its history row in ONE batch; whether
    it landed is read back from the history (the row exists only if the update did), so a lost
    race - another save took this version first - is "changed", never a second write */
async function applyGuarded(env: Env, entity: "format" | "category", id: number, version: number, actor: number, stmts: D1PreparedStatement[]): Promise<boolean> {
  try { await env.DB.batch(stmts); }
  catch (e) { if (/UNIQUE/i.test(String((e as Error)?.message ?? e))) return false; throw e; }
  const h = await env.DB.prepare(`SELECT actor_id FROM card_rule_history WHERE entity = ?1 AND entity_id = ?2 AND version = ?3`).bind(entity, id, version).first<{ actor_id: number | null }>();
  return h?.actor_id === actor;
}

export async function handleCardRules(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams,
): Promise<Response | null> {
  if (path !== "/card-rules" && !path.startsWith("/card-rules/")) return null;
  const admin = canUser(user, "card_format_admin");
  if (!admin) return err("forbidden", "Only the CEO and the super admin manage the digital card rules", 403);
  try {
    if (path === "/card-rules" && method === "GET") {
      return json({ ...(await loadCardRules(env)), can_edit: admin, limits: LIMITS, types: CARD_TYPES });
    }

    if (path === "/card-rules/history" && method === "GET") {
      const entity = params.get("entity");
      const id = Number(params.get("id"));
      if ((entity !== "format" && entity !== "category") || !Number.isInteger(id) || id <= 0) return err("invalid", "entity (format or category) and id are required", 400);
      const { results } = await env.DB.prepare(
        `SELECT h.id, h.version, h.snapshot_json, h.reason, h.created_at, u.name AS actor_name
           FROM card_rule_history h LEFT JOIN users u ON u.id = h.actor_id
          WHERE h.entity = ?1 AND h.entity_id = ?2 ORDER BY h.id DESC LIMIT 50`,
      ).bind(entity, id).all<{ id: number; version: number; snapshot_json: string; reason: string; created_at: string; actor_name: string | null }>();
      return json({ history: (results ?? []).map((r) => ({ ...r, snapshot: parse<Record<string, unknown>>(r.snapshot_json, {}), snapshot_json: undefined })) });
    }

    const fm = path.match(/^\/card-rules\/formats(?:\/(\d+))?$/);
    if (fm && (method === "POST" || method === "PUT")) {
      const isNew = method === "POST";
      if (isNew === Boolean(fm[1])) return err("not_found", "Not found", 404);
      const reason = reasonOf(body);
      if (!reason) return invalid({ reason: `Say why, in at least ${LIMITS.reason} characters` });
      const { value, problems } = checkFormat(body ?? {});
      if (!value) return invalid(problems);
      const types = JSON.stringify(value.accepted_types);
      if (isNew) {
        const code = codeOf(value.name);
        if (!code) return invalid({ name: "Use letters or numbers in the name" });
        const taken = await env.DB.prepare(`SELECT id FROM card_formats WHERE code = ?1`).bind(code).first();
        if (taken) return invalid({ name: "A format with this name already exists" });
        const row = await env.DB.prepare(
          `INSERT INTO card_formats (code, name, name_ms, width_px, height_px, margin_top, margin_right, margin_bottom, margin_left, accepted_types, max_bytes, sort, active, updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, datetime('now')) RETURNING id`,
        ).bind(code, value.name, value.name_ms, value.width_px, value.height_px, value.margin_top, value.margin_right, value.margin_bottom, value.margin_left, types, value.max_bytes, value.sort, value.active ? 1 : 0, user.id).first<{ id: number }>();
        await env.DB.prepare(`INSERT INTO card_rule_history (entity, entity_id, version, snapshot_json, reason, actor_id) VALUES ('format', ?1, 1, ?2, ?3, ?4)`)
          .bind(row!.id, JSON.stringify({ code, ...value }), reason, user.id).run();
        await audit(env, user.id, "card_rules.format_create", "card_formats", String(row!.id), { code, reason });
        return json({ ok: true, id: row!.id, ...(await loadCardRules(env)) });
      }
      const id = Number(fm[1]);
      const version = Number(body?.version);
      const cur = await env.DB.prepare(`${FORMAT_SQL} WHERE f.id = ?1`).bind(id).first<FormatRow>();
      if (!cur) return err("not_found", "That format no longer exists", 404);
      if (!Number.isInteger(version) || version !== cur.version) return err("changed", "Someone saved this format since you opened it - reload and try again", 409);
      if (!value.active && cur.active === 1) {
        const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM card_formats WHERE active = 1 AND id != ?1`).bind(id).first<{ n: number }>();
        if (!n?.n) return invalid({ active: "At least one format must stay on" });
      }
      const next = cur.version + 1;
      const applied = await applyGuarded(env, "format", id, next, user.id, [
        env.DB.prepare(
          `UPDATE card_formats SET name = ?1, name_ms = ?2, width_px = ?3, height_px = ?4, margin_top = ?5, margin_right = ?6, margin_bottom = ?7, margin_left = ?8,
             accepted_types = ?9, max_bytes = ?10, sort = ?11, active = ?12, version = ?13, updated_by = ?14, updated_at = datetime('now')
           WHERE id = ?15 AND version = ?16`,
        ).bind(value.name, value.name_ms, value.width_px, value.height_px, value.margin_top, value.margin_right, value.margin_bottom, value.margin_left, types, value.max_bytes, value.sort, value.active ? 1 : 0, next, user.id, id, cur.version),
        env.DB.prepare(
          `INSERT INTO card_rule_history (entity, entity_id, version, snapshot_json, reason, actor_id)
           SELECT 'format', ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM card_formats WHERE id = ?1 AND version = ?2)`,
        ).bind(id, next, JSON.stringify({ code: cur.code, ...value }), reason, user.id),
      ]);
      if (!applied) return err("changed", "Someone saved this format since you opened it - reload and try again", 409);
      const before = formatOf(cur);
      const changed = Object.fromEntries(Object.entries(value).filter(([k, v]) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)).map(([k, v]) => [k, [(before as unknown as Record<string, unknown>)[k], v]]));
      await audit(env, user.id, "card_rules.format_update", "card_formats", String(id), { code: cur.code, version: next, reason, changed });
      return json({ ok: true, id, ...(await loadCardRules(env)) });
    }

    const cm = path.match(/^\/card-rules\/categories(?:\/(\d+))?$/);
    if (cm && (method === "POST" || method === "PUT")) {
      const isNew = method === "POST";
      if (isNew === Boolean(cm[1])) return err("not_found", "Not found", 404);
      const reason = reasonOf(body);
      if (!reason) return invalid({ reason: `Say why, in at least ${LIMITS.reason} characters` });
      const { value, problems } = checkCategory(body ?? {});
      if (!value) return invalid(problems);
      const pages = JSON.stringify(value.pages);
      if (isNew) {
        const code = codeOf(value.name);
        if (!code) return invalid({ name: "Use letters or numbers in the name" });
        const taken = await env.DB.prepare(`SELECT id FROM card_category_rules WHERE code = ?1`).bind(code).first();
        if (taken) return invalid({ name: "A category with this name already exists" });
        const row = await env.DB.prepare(
          `INSERT INTO card_category_rules (code, name, name_ms, min_pages, max_pages, pages_json, allow_reorder, sort, active, updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now')) RETURNING id`,
        ).bind(code, value.name, value.name_ms, value.min_pages, value.max_pages, pages, value.allow_reorder ? 1 : 0, value.sort, value.active ? 1 : 0, user.id).first<{ id: number }>();
        await env.DB.prepare(`INSERT INTO card_rule_history (entity, entity_id, version, snapshot_json, reason, actor_id) VALUES ('category', ?1, 1, ?2, ?3, ?4)`)
          .bind(row!.id, JSON.stringify({ code, ...value }), reason, user.id).run();
        await audit(env, user.id, "card_rules.category_create", "card_category_rules", String(row!.id), { code, reason });
        return json({ ok: true, id: row!.id, ...(await loadCardRules(env)) });
      }
      const id = Number(cm[1]);
      const version = Number(body?.version);
      const cur = await env.DB.prepare(`${CATEGORY_SQL} WHERE c.id = ?1`).bind(id).first<CategoryRow>();
      if (!cur) return err("not_found", "That category no longer exists", 404);
      if (!Number.isInteger(version) || version !== cur.version) return err("changed", "Someone saved this category since you opened it - reload and try again", 409);
      if (!value.active && cur.active === 1) {
        const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM card_category_rules WHERE active = 1 AND id != ?1`).bind(id).first<{ n: number }>();
        if (!n?.n) return invalid({ active: "At least one category must stay on" });
      }
      const next = cur.version + 1;
      const applied = await applyGuarded(env, "category", id, next, user.id, [
        env.DB.prepare(
          `UPDATE card_category_rules SET name = ?1, name_ms = ?2, min_pages = ?3, max_pages = ?4, pages_json = ?5, allow_reorder = ?6, sort = ?7, active = ?8,
             version = ?9, updated_by = ?10, updated_at = datetime('now') WHERE id = ?11 AND version = ?12`,
        ).bind(value.name, value.name_ms, value.min_pages, value.max_pages, pages, value.allow_reorder ? 1 : 0, value.sort, value.active ? 1 : 0, next, user.id, id, cur.version),
        env.DB.prepare(
          `INSERT INTO card_rule_history (entity, entity_id, version, snapshot_json, reason, actor_id)
           SELECT 'category', ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM card_category_rules WHERE id = ?1 AND version = ?2)`,
        ).bind(id, next, JSON.stringify({ code: cur.code, ...value }), reason, user.id),
      ]);
      if (!applied) return err("changed", "Someone saved this category since you opened it - reload and try again", 409);
      const before = categoryOf(cur);
      const changed = Object.fromEntries(Object.entries(value).filter(([k, v]) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)).map(([k, v]) => [k, [(before as unknown as Record<string, unknown>)[k], v]]));
      await audit(env, user.id, "card_rules.category_update", "card_category_rules", String(id), { code: cur.code, version: next, reason, changed });
      return json({ ok: true, id, ...(await loadCardRules(env)) });
    }
  } catch (e) {
    if (notMigrated(e)) return migrationNeeded();
    throw e;
  }
  return err("not_found", "Not found", 404);
}
