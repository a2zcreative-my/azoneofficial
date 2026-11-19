/* v1.388.0 - POSITION & RESPONSIBILITIES AS RECORDS (the CEO, 19-11-2026,
 * migration 0215). "Build this as a reusable staff profile data system, not
 * merely a visual table enhancement. Position and Responsibilities must be
 * stored once and reused throughout A2Z OS, including future staff portfolio
 * cards."
 *
 * WHERE EACH FACT LIVES (stored once):
 *   - the position        users.position, chosen from the positions list (0204).
 *                         Never an access level: nothing here reads or writes
 *                         users.role.
 *   - responsibilities    staff_responsibilities, one row each, in order, with
 *                         Key (shown on a compact card, at most 5) and Public
 *                         (may appear on a public card; off until ticked).
 *   - templates           position_responsibility_templates, per position. A
 *                         person's list is a COPY: editing it never changes
 *                         the template, and editing a template never changes
 *                         anybody's list (the CEO: "Allow individual
 *                         customization without changing the original template").
 *   - photo, name, department, staff ID - the staff record, read live.
 *
 * Every reader takes its list from here: GET /users and GET /profile build the
 * old `responsibilities` text from these rows (staff.ts), and `portfolioOf()`
 * is the one shape a portfolio card reads. users.responsibilities is kept as
 * the text before the 0215 conversion and is no longer written.
 *
 * WHO: a person's list - responsibilities_edit (the CEO and the HR tier, as
 * before), working staff only. Templates - responsibility_templates (the CEO,
 * the Super Admin, the COO and the CCO - the CEO's answer, 19-11-2026). The
 * screen hides what a person may not press; this file refuses it.
 *
 * NEVER OVERWRITTEN WITHOUT CONFIRMATION: a save names the list it started
 * from (`version`). A list changed by somebody else in the meantime is refused
 * with 409 `changed` and the screen asks again. In the database, a save
 * deletes the old rows only while they are still the version it read, and
 * inserts its own rows only while no other save's rows are left (batch_key) -
 * so two saves at the same moment can never stack two lists. Every save is
 * audited with the list before and after. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { canUser } from "./permissions";
import { audit, err, json } from "./shared";

/** For a staff-list SELECT over `users u`: the list as one text, one per line
    (what every older reader of users.responsibilities expects), and as JSON
    items with their flags. Ordered as the list is ordered. */
export const RESP_TEXT_SQL = `(SELECT group_concat(r.text, char(10)) FROM (SELECT text FROM staff_responsibilities WHERE user_id = u.id ORDER BY sort_order, id) r)`;
export const RESP_ITEMS_SQL = `(SELECT json_group_array(json_object('id', r.id, 'text', r.text, 'is_key', r.is_key, 'is_public', r.is_public)) FROM (SELECT id, text, is_key, is_public FROM staff_responsibilities WHERE user_id = u.id ORDER BY sort_order, id) r)`;

export const RESP_LIMITS = { text: 200, items: 30, key: 5, title: 120 } as const;

export type RespItem = { id: number; text: string; is_key: number; is_public: number; template_position_id: number | null; sort_order: number };
export type TemplateItem = { id: number; text: string; sort_order: number };

/** the portfolio card's one shape - everything it shows, read from the record */
export type StaffPortfolio = {
  user_id: number;
  photo_key: string | null;
  name: string;
  full_name: string | null;
  /** the main professional title: the position, else the role title, else null */
  title: string | null;
  position: string | null;
  role_title: string | null;
  department: string | null;
  staff_id: string | null;
  /** up to five, for the compact card: those marked Key, else the first five */
  key: string[];
  /** the whole list, for the expanded portfolio */
  responsibilities: string[];
  /** the ones ticked Public - what a public card may show */
  public: string[];
  is_active: boolean;
};

const versionOf = (rows: { id: number }[]) => `${rows.length}:${rows.reduce((m, r) => Math.max(m, r.id), 0)}`;
const VERSION_SQL = (table: string, col: string) => `(SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM ${table} WHERE ${col} = ?1)`;
const oneLine = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/^\s*[-•*]\s*/, "").trim() : "");
function pendingMigration(e: unknown): Response | null {
  return /no such table|no such column/i.test(String(e))
    ? err("migration_pending", "Responsibilities need migration 0215 - run PUSH.bat, then try again", 503)
    : null;
}
const staffOnly = (user: StaffUser) => user.role !== "customer" && user.role !== "agent";

export async function itemsOf(env: Env, userId: number): Promise<RespItem[]> {
  return (await env.DB.prepare(
    `SELECT id, text, is_key, is_public, template_position_id, sort_order FROM staff_responsibilities WHERE user_id = ?1 ORDER BY sort_order, id`,
  ).bind(userId).all<RespItem>()).results ?? [];
}
async function templateOf(env: Env, positionId: number): Promise<TemplateItem[]> {
  return (await env.DB.prepare(
    `SELECT id, text, sort_order FROM position_responsibility_templates WHERE position_id = ?1 ORDER BY sort_order, id`,
  ).bind(positionId).all<TemplateItem>()).results ?? [];
}

/** The portfolio of one person, built from the staff record and the list -
    the one place a card reads. `null` when there is no such staff record. */
export async function portfolioOf(env: Env, userId: number): Promise<StaffPortfolio | null> {
  const u = await env.DB.prepare(
    `SELECT id, name, full_name, photo_key, position, role_title, department, employee_id, is_active FROM users
      WHERE id = ?1 AND role NOT IN ('customer', 'agent') AND role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`,
  ).bind(userId).first<{ id: number; name: string; full_name: string | null; photo_key: string | null; position: string | null; role_title: string | null; department: string | null; employee_id: string | null; is_active: number }>();
  if (!u) return null;
  const items = await itemsOf(env, userId);
  const marked = items.filter((i) => i.is_key);
  const position = u.position?.trim() || null;
  const roleTitle = u.role_title?.trim() || null;
  return {
    user_id: u.id, photo_key: u.photo_key, name: u.name, full_name: u.full_name,
    title: position ?? roleTitle, position, role_title: roleTitle,
    department: u.department?.trim() || null, staff_id: u.employee_id?.trim() || null,
    key: (marked.length ? marked : items).slice(0, RESP_LIMITS.key).map((i) => i.text),
    responsibilities: items.map((i) => i.text),
    public: items.filter((i) => i.is_public).map((i) => i.text),
    is_active: Boolean(u.is_active),
  };
}

/** Read and clean the list a save sends. A string list (the old editor's
    shape) is accepted: the first five Key, none Public. */
function readItems(raw: unknown): { items: { text: string; is_key: 0 | 1; is_public: 0 | 1; template_position_id: number | null }[] } | { error: string } {
  if (raw == null) return { items: [] };
  if (!Array.isArray(raw)) return { error: "items must be a list" };
  const items: { text: string; is_key: 0 | 1; is_public: 0 | 1; template_position_id: number | null }[] = [];
  for (const [n, r] of raw.entries()) {
    const o = typeof r === "string" ? { text: r, is_key: n < RESP_LIMITS.key } : (r ?? {}) as Record<string, unknown>;
    if (typeof o.text !== "string") return { error: "each responsibility must be text" };
    const text = oneLine(o.text);
    if (!text) continue;
    if (text.length > RESP_LIMITS.text) return { error: `Each responsibility is at most ${RESP_LIMITS.text} characters` };
    const tp = Number(o.template_position_id);
    items.push({ text, is_key: o.is_key ? 1 : 0, is_public: o.is_public ? 1 : 0, template_position_id: Number.isInteger(tp) && tp > 0 ? tp : null });
  }
  if (items.length > RESP_LIMITS.items) return { error: `At most ${RESP_LIMITS.items} responsibilities - write the job, not the manual` };
  if (items.filter((i) => i.is_key).length > RESP_LIMITS.key) return { error: `At most ${RESP_LIMITS.key} key responsibilities - the card shows five` };
  return { items };
}

/** Replace one list whole, guarded twice (see the header). Returns false when
    the list was not the version the save started from. */
async function replaceList(env: Env, o: {
  table: "staff_responsibilities" | "position_responsibility_templates"; col: "user_id" | "position_id"; owner: number; version: string;
  rows: { text: string; is_key?: number; is_public?: number; template_position_id?: number | null }[]; by: number;
}): Promise<boolean> {
  const batchKey = crypto.randomUUID();
  const person = o.table === "staff_responsibilities";
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM ${o.table} WHERE ${o.col} = ?1 AND ${VERSION_SQL(o.table, o.col)} = ?2`).bind(o.owner, o.version),
    ...o.rows.map((r, i) => person
      ? env.DB.prepare(
        `INSERT INTO staff_responsibilities (user_id, sort_order, text, is_key, is_public, template_position_id, batch_key, created_by)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
          WHERE NOT EXISTS (SELECT 1 FROM staff_responsibilities WHERE user_id = ?1 AND batch_key != ?7)`,
      ).bind(o.owner, i + 1, r.text, r.is_key ?? 0, r.is_public ?? 0, r.template_position_id ?? null, batchKey, o.by)
      : env.DB.prepare(
        `INSERT INTO position_responsibility_templates (position_id, sort_order, text, batch_key, created_by)
         SELECT ?1, ?2, ?3, ?4, ?5
          WHERE NOT EXISTS (SELECT 1 FROM position_responsibility_templates WHERE position_id = ?1 AND batch_key != ?4)`,
      ).bind(o.owner, i + 1, r.text, batchKey, o.by)),
    env.DB.prepare(`SELECT COUNT(*) AS mine, (SELECT COUNT(*) FROM ${o.table} WHERE ${o.col} = ?1) AS total FROM ${o.table} WHERE ${o.col} = ?1 AND batch_key = ?2`).bind(o.owner, batchKey),
  ];
  const res = await env.DB.batch(stmts);
  const last = (res[res.length - 1]?.results?.[0] ?? {}) as { mine?: number; total?: number };
  /* written = every row of mine is in, and nobody else's is left */
  return Number(last.mine ?? 0) === o.rows.length && Number(last.total ?? 0) === o.rows.length;
}

export async function handleResponsibilities(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response | null> {
  const person = path.match(/^\/users\/(\d+)\/responsibilities$/);
  const portfolio = path.match(/^\/portfolio\/(\d+)$/);
  const tpl = path.match(/^\/responsibilities\/templates(?:\/(\d+))?$/);
  if (!person && !portfolio && !tpl) return null;
  if (!staffOnly(user)) return err("forbidden", "Staff only", 403);
  const mayEdit = canUser(user, "responsibilities_edit");
  const mayTemplates = canUser(user, "responsibility_templates");
  try {
    /* ---------------- the templates: every working staff member reads them ---------------- */
    if (tpl && !tpl[1] && method === "GET") {
      const positions = (await env.DB.prepare(
        `SELECT id, name, department FROM staff_positions WHERE retired_at IS NULL ORDER BY sort_order, name COLLATE NOCASE`,
      ).all<{ id: number; name: string; department: string | null }>()).results ?? [];
      const rows = (await env.DB.prepare(
        `SELECT id, position_id, text, sort_order FROM position_responsibility_templates ORDER BY position_id, sort_order, id`,
      ).all<TemplateItem & { position_id: number }>()).results ?? [];
      return json({
        templates: positions.map((p) => {
          const items = rows.filter((r) => r.position_id === p.id);
          return { position_id: p.id, position: p.name, department: p.department, items: items.map((i) => ({ id: i.id, text: i.text })), version: versionOf(items) };
        }),
        can_manage: mayTemplates,
        limits: RESP_LIMITS,
      });
    }
    if (tpl && tpl[1] && method === "PUT") {
      if (!mayTemplates) return err("forbidden", "Only the CEO, the Super Admin, the COO and the CCO keep the responsibility templates", 403);
      const pid = Number(tpl[1]);
      const pos = await env.DB.prepare(`SELECT id, name, retired_at FROM staff_positions WHERE id = ?1`).bind(pid).first<{ id: number; name: string; retired_at: string | null }>();
      if (!pos) return err("not_found", "No such position", 404);
      if (pos.retired_at) return err("retired", "This position is retired - restore it first", 409);
      const got = readItems(body?.items);
      if ("error" in got) return err("invalid_input", got.error, 400);
      const before = await templateOf(env, pid);
      const version = typeof body?.version === "string" ? body.version : "";
      if (version !== versionOf(before)) return err("changed", "Somebody changed this template since you opened it - it has been reloaded; check it and save again", 409);
      const done = await replaceList(env, { table: "position_responsibility_templates", col: "position_id", owner: pid, version, rows: got.items, by: user.id });
      if (!done) return err("changed", "Somebody changed this template since you opened it - it has been reloaded; check it and save again", 409);
      await audit(env, user.id, "staff.responsibility_template_update", "staff_positions", String(pid), {
        position: pos.name, before: before.map((i) => i.text), after: got.items.map((i) => i.text),
      });
      const after = await templateOf(env, pid);
      return json({ ok: true, position_id: pid, items: after.map((i) => ({ id: i.id, text: i.text })), version: versionOf(after) });
    }

    /* ---------------- one person's list ---------------- */
    if (person && method === "GET") {
      const id = Number(person[1]);
      if (id !== user.id && !canUser(user, "hr_manage") && !canUser(user, "exec_view")) return err("forbidden", "HR access required", 403);
      const p = await env.DB.prepare(
        `SELECT u.id, u.name, u.position, u.department, u.role_title, u.is_active, u.responsibilities_updated_at,
                (SELECT w.name FROM users w WHERE w.id = u.responsibilities_updated_by) AS updated_by_name,
                (SELECT sp.id FROM staff_positions sp WHERE sp.name = TRIM(u.position) COLLATE NOCASE AND sp.retired_at IS NULL) AS position_id
           FROM users u WHERE u.id = ?1 AND u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`,
      ).bind(id).first<{ id: number; name: string; position: string | null; department: string | null; role_title: string | null; is_active: number; responsibilities_updated_at: string | null; updated_by_name: string | null; position_id: number | null }>();
      if (!p) return err("not_found", "Staff not found", 404);
      const items = await itemsOf(env, id);
      const template = p.position_id ? await templateOf(env, p.position_id) : [];
      return json({
        user_id: p.id, position: p.position, position_id: p.position_id, department: p.department, role_title: p.role_title,
        items, version: versionOf(items),
        template: p.position_id ? { position_id: p.position_id, position: p.position, items: template.map((t) => ({ id: t.id, text: t.text })) } : null,
        updated_at: p.responsibilities_updated_at, updated_by_name: p.updated_by_name,
        can_edit: mayEdit && Boolean(p.is_active), limits: RESP_LIMITS,
      });
    }
    if (person && (method === "PUT" || method === "PATCH")) {
      if (!mayEdit) return err("forbidden", "Only the CEO and the HR tier write roles and responsibilities", 403);
      const id = Number(person[1]);
      const b = body ?? {};
      if (b.role_title !== undefined && b.role_title !== null && typeof b.role_title !== "string") return err("invalid_input", "role_title must be text", 400);
      const title = typeof b.role_title === "string" ? b.role_title.trim().slice(0, RESP_LIMITS.title) : "";
      /* the new editor sends items; an older screen still sends `responsibilities` lines */
      const got = readItems(b.items !== undefined ? b.items : typeof b.responsibilities === "string" ? b.responsibilities.split(/\r?\n/) : b.responsibilities);
      if ("error" in got) return err("invalid_input", got.error, 400);
      const p = await env.DB.prepare(`SELECT id, name, is_active, role_title FROM users WHERE id = ?1 AND role NOT IN ('customer', 'agent') AND role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`)
        .bind(id).first<{ id: number; name: string; is_active: number; role_title: string | null }>();
      if (!p) return err("not_found", "Staff not found", 404);
      if (!p.is_active) return err("inactive", "Roles and responsibilities are kept for working staff - this record is not active", 409);
      const before = await itemsOf(env, id);
      const version = typeof b.version === "string" ? b.version : "";
      /* NEVER OVERWRITTEN WITHOUT CONFIRMATION - a save names the list it started from */
      if (version !== versionOf(before)) return err("changed", "Somebody changed these responsibilities since you opened them - they have been reloaded; check them and save again", 409);
      const done = await replaceList(env, { table: "staff_responsibilities", col: "user_id", owner: id, version, rows: got.items, by: user.id });
      if (!done) return err("changed", "Somebody changed these responsibilities since you opened them - they have been reloaded; check them and save again", 409);
      await env.DB.prepare(`UPDATE users SET role_title = ?1, responsibilities_updated_at = datetime('now'), responsibilities_updated_by = ?2 WHERE id = ?3`)
        .bind(title || null, user.id, id).run();
      await audit(env, user.id, "staff.responsibilities_update", "users", String(id), {
        person: p.name,
        role_title_before: p.role_title, role_title_after: title || null,
        responsibilities_before: before.map((i) => `${i.is_key ? "[key] " : ""}${i.is_public ? "[public] " : ""}${i.text}`),
        responsibilities_after: got.items.map((i) => `${i.is_key ? "[key] " : ""}${i.is_public ? "[public] " : ""}${i.text}`),
      });
      const after = await itemsOf(env, id);
      return json({ ok: true, role_title: title || null, items: after, version: versionOf(after), responsibilities: after.map((i) => i.text), updated_by_name: user.name ?? null });
    }

    /* ---------------- the portfolio: the one shape a card reads ---------------- */
    if (portfolio && method === "GET") {
      const id = Number(portfolio[1]);
      if (id !== user.id && !canUser(user, "hr_manage") && !canUser(user, "exec_view")) return err("forbidden", "HR access required", 403);
      const pf = await portfolioOf(env, id);
      return pf ? json({ portfolio: pf }) : err("not_found", "Staff not found", 404);
    }
    return null;
  } catch (e) {
    const p = pendingMigration(e);
    if (p) return p;
    throw e;
  }
}
