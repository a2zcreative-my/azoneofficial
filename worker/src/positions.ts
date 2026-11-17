/* v1.322.0 - THE POSITIONS LIST (the CEO, 16-11-2026: "for the position, I want
 * to add my ownself for the roles which is can be linked with Super Admin for
 * CEO, this is allowed me to add and edit the roles"; his choice: "Position
 * list (Recommended)" - claude/POSITIONS-STAGE-0-AUDIT.md, P-1 to P-7).
 *
 * The CEO and the Super Admin (positions_manage) keep a list of positions:
 * add, rename, re-link, retire, restore. Every working staff member reads it,
 * to pick from it on the forms they may already use.
 *
 * A POSITION'S ACCESS LEVEL IS A LINK, NEVER A KEY (P-4). Nothing here writes
 * users.role. Choosing a position for someone, or re-linking a position, changes
 * nobody's access: when the levels differ the screen offers the one role door
 * (POST /staff/users/:id/role) with all of its own rules.
 *
 * The staff record keeps its position as TEXT (P-2): everything that reads
 * users.position today reads it unchanged. A rename may carry the people who
 * hold the old name across - only when asked, each one a staff-record change
 * audited as the HR form audits it (staff.hr_update, with the before and after).
 *
 * Nothing is deleted (P-5): 0204's triggers refuse a deleted position and an
 * edited or deleted change row. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { can, canUser } from "./permissions";
import { audit, err, json } from "./shared";

/** the access levels a position may be linked to - the role door's own list, less the shopper */
export const POSITION_ACCESS_ROLES = ["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "coo", "cco", "agent", "admin", "ceo"] as const;

type Position = {
  id: number; name: string; access_role: string; department: string | null; sort_order: number;
  created_at: string; updated_at: string | null; retired_at: string | null;
};

const clean = (v: unknown, n: number): string | null => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, n) : null);
function pending(e: unknown): Response | null {
  return /no such table|no such column/i.test(String(e)) ? err("pending_migration", "Run PUSH.bat so migration 0204 applies, then retry", 409) : null;
}
async function positionOf(env: Env, id: number): Promise<Position | null> {
  return await env.DB.prepare(`SELECT * FROM staff_positions WHERE id = ?1`).bind(id).first<Position>();
}
async function nameTaken(env: Env, name: string, except: number): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT 1 AS x FROM staff_positions WHERE name = ?1 COLLATE NOCASE AND id != ?2`).bind(name, except).first());
}
async function logChange(env: Env, user: StaffUser, p: { id: number }, action: string, o: { old_name?: string | null; new_name?: string | null; old_access_role?: string | null; new_access_role?: string | null; note?: string | null }) {
  await env.DB.prepare(
    `INSERT INTO staff_position_changes (position_id, action, old_name, new_name, old_access_role, new_access_role, note, actor_id, actor_role) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(p.id, action, o.old_name ?? null, o.new_name ?? null, o.old_access_role ?? null, o.new_access_role ?? null, o.note ?? null, user.id, user.role).run();
}

export async function handlePositions(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (path !== "/positions" && !path.startsWith("/positions/")) return null;
  if (user.role === "customer" || user.role === "agent") return err("forbidden", "Staff only", 403);
  const manage = canUser(user, "positions_manage");
  const refuse = () => err("forbidden", "Only the CEO or the Super Admin keeps the positions list", 403);
  try {
    /* ---------------- the list: everyone on staff reads it ---------------- */
    if (path === "/positions" && method === "GET") {
      const all = manage && params.get("all") === "1";
      const rows = (await env.DB.prepare(
        `SELECT p.id, p.name, p.access_role, p.department, p.sort_order, p.created_at, p.updated_at, p.retired_at,
                (SELECT COUNT(*) FROM users u WHERE u.is_active = 1 AND u.position = p.name COLLATE NOCASE) AS holders
           FROM staff_positions p ${all ? "" : "WHERE p.retired_at IS NULL"}
          ORDER BY p.retired_at IS NOT NULL, p.sort_order, p.name COLLATE NOCASE`,
      ).all<Position & { holders: number }>()).results ?? [];
      /* the positions typed on working staff records that are not on the list (P-2) - names only */
      const off = manage ? ((await env.DB.prepare(
        `SELECT TRIM(u.position) AS name, COUNT(*) AS n FROM users u
          WHERE u.is_active = 1 AND TRIM(COALESCE(u.position, '')) != '' AND (u.role NOT IN ('customer', 'super_admin') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0))
            AND NOT EXISTS (SELECT 1 FROM staff_positions p WHERE p.name = TRIM(u.position) COLLATE NOCASE)
          GROUP BY TRIM(u.position) COLLATE NOCASE ORDER BY n DESC, name`,
      ).all<{ name: string; n: number }>()).results ?? []) : [];
      return json({ positions: rows, not_on_list: off, can_manage: manage, access_roles: POSITION_ACCESS_ROLES });
    }

    /* ---------------- add ---------------- */
    if (path === "/positions" && method === "POST") {
      if (!manage) return refuse();
      const name = clean(body?.name, 80);
      const role = typeof body?.access_role === "string" ? body.access_role : "";
      if (!name || name.length < 2) return err("invalid_input", "Name the position (2 to 80 characters)", 400);
      if (!(POSITION_ACCESS_ROLES as readonly string[]).includes(role)) return err("invalid_input", `Link it to one access level: ${POSITION_ACCESS_ROLES.join(", ")}`, 400);
      if (await nameTaken(env, name, 0)) return err("duplicate", `"${name}" is already on the list`, 409);
      const department = clean(body?.department, 80);
      const r = await env.DB.prepare(`INSERT INTO staff_positions (name, access_role, department, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`)
        .bind(name, role, department, user.id).first<{ id: number }>();
      if (!r) return err("server_error", "Not saved", 500);
      await logChange(env, user, r, "create", { new_name: name, new_access_role: role });
      await audit(env, user.id, "positions.create", "staff_positions", String(r.id), { name, access_role: role, department });
      return json({ ok: true, id: r.id }, 201);
    }

    /* ---------------- start from the positions already typed on records (P-7) - only when asked ---------------- */
    if (path === "/positions/seed" && method === "POST") {
      if (!manage) return refuse();
      const typed = (await env.DB.prepare(
        `SELECT TRIM(u.position) AS name, u.role, COUNT(*) AS n FROM users u
          WHERE u.is_active = 1 AND TRIM(COALESCE(u.position, '')) != '' AND (u.role NOT IN ('customer', 'super_admin') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0))
            AND NOT EXISTS (SELECT 1 FROM staff_positions p WHERE p.name = TRIM(u.position) COLLATE NOCASE)
          GROUP BY TRIM(u.position) COLLATE NOCASE, u.role ORDER BY n DESC`,
      ).all<{ name: string; role: string; n: number }>()).results ?? [];
      /* one position per name; its level is the one most of its holders have now (never invented) */
      const seen = new Map<string, { name: string; role: string }>();
      for (const t of typed) {
        const k = t.name.toLowerCase();
        if (!seen.has(k) && (POSITION_ACCESS_ROLES as readonly string[]).includes(t.role)) seen.set(k, { name: t.name.slice(0, 80), role: t.role });
      }
      const added: string[] = [];
      for (const s of seen.values()) {
        if (await nameTaken(env, s.name, 0)) continue;
        const r = await env.DB.prepare(`INSERT INTO staff_positions (name, access_role, created_by) VALUES (?1, ?2, ?3) RETURNING id`).bind(s.name, s.role, user.id).first<{ id: number }>();
        if (!r) continue;
        await logChange(env, user, r, "create", { new_name: s.name, new_access_role: s.role, note: "started from the positions on staff records" });
        added.push(s.name);
      }
      await audit(env, user.id, "positions.seed", "staff_positions", undefined, { added });
      return json({ ok: true, added });
    }

    const m = /^\/positions\/(\d+)(?:\/(retire|restore|changes))?$/.exec(path);
    if (!m) return null;
    const id = Number(m[1]);
    const p = await positionOf(env, id);
    if (!p) return err("not_found", "No such position", 404);

    /* ---------------- its history ---------------- */
    if (m[2] === "changes" && method === "GET") {
      if (!manage) return refuse();
      const changes = (await env.DB.prepare(
        `SELECT c.id, c.action, c.old_name, c.new_name, c.old_access_role, c.new_access_role, c.note, c.actor_role, c.created_at,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS actor
           FROM staff_position_changes c LEFT JOIN users u ON u.id = c.actor_id WHERE c.position_id = ?1 ORDER BY c.id DESC`,
      ).bind(id).all()).results ?? [];
      return json({ position: p, changes });
    }

    /* ---------------- rename, re-link, department, order ---------------- */
    if (!m[2] && method === "PATCH") {
      if (!manage) return refuse();
      if (p.retired_at) return err("retired", "Restore the position before changing it", 409);
      const name = body && "name" in body ? clean(body.name, 80) : p.name;
      const role = body && "access_role" in body ? (typeof body.access_role === "string" ? body.access_role : "") : p.access_role;
      const department = body && "department" in body ? clean(body.department, 80) : p.department;
      const order = body && "sort_order" in body && Number.isInteger(body.sort_order) ? Number(body.sort_order) : p.sort_order;
      if (!name || name.length < 2) return err("invalid_input", "Name the position (2 to 80 characters)", 400);
      if (!(POSITION_ACCESS_ROLES as readonly string[]).includes(role)) return err("invalid_input", `Link it to one access level: ${POSITION_ACCESS_ROLES.join(", ")}`, 400);
      if (name.toLowerCase() !== p.name.toLowerCase() && await nameTaken(env, name, id)) return err("duplicate", `"${name}" is already on the list`, 409);
      const renamed = name !== p.name, relinked = role !== p.access_role;
      if (!renamed && !relinked && department === p.department && order === p.sort_order) return json({ ok: true, unchanged: true });
      await env.DB.prepare(`UPDATE staff_positions SET name = ?1, access_role = ?2, department = ?3, sort_order = ?4, updated_by = ?5, updated_at = datetime('now') WHERE id = ?6`)
        .bind(name, role, department, order, user.id, id).run();
      await logChange(env, user, p, renamed && relinked ? "rename_relink" : renamed ? "rename" : relinked ? "relink" : "edit", {
        old_name: p.name, new_name: name, old_access_role: p.access_role, new_access_role: role,
      });
      await audit(env, user.id, "positions.update", "staff_positions", String(id), { from: { name: p.name, access_role: p.access_role, department: p.department }, to: { name, access_role: role, department } });
      /* the people who hold the old name move with it - only when asked; each one a staff-record change */
      let moved = 0;
      if (renamed && body?.rename_holders === true) {
        const holders = (await env.DB.prepare(`SELECT id, position FROM users WHERE position = ?1 COLLATE NOCASE`).bind(p.name).all<{ id: number; position: string }>()).results ?? [];
        for (const h of holders) {
          await env.DB.prepare(`UPDATE users SET position = ?1 WHERE id = ?2`).bind(name, h.id).run();
          await audit(env, user.id, "staff.hr_update", "users", String(h.id), { fields: ["position"], changes: { position: [h.position, name] }, via: "positions.rename" });
          moved++;
        }
      }
      /* re-linking changes nobody's role (P-4): it says how many now differ, and nothing more */
      const differ = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND position = ?1 COLLATE NOCASE AND role != ?2`).bind(name, role).first<{ n: number }>())?.n ?? 0);
      return json({ ok: true, moved, holders_with_other_access: differ });
    }

    /* ---------------- retire and restore: never delete ---------------- */
    if (m[2] === "retire" && method === "POST") {
      if (!manage) return refuse();
      if (p.retired_at) return json({ ok: true, unchanged: true });
      const note = clean(body?.reason, 300);
      await env.DB.prepare(`UPDATE staff_positions SET retired_at = datetime('now'), retired_by = ?1 WHERE id = ?2`).bind(user.id, id).run();
      await logChange(env, user, p, "retire", { old_name: p.name, note });
      await audit(env, user.id, "positions.retire", "staff_positions", String(id), { name: p.name, reason: note });
      return json({ ok: true });
    }
    if (m[2] === "restore" && method === "POST") {
      if (!manage) return refuse();
      if (!p.retired_at) return json({ ok: true, unchanged: true });
      if (await nameTaken(env, p.name, id)) return err("duplicate", `"${p.name}" is already on the list`, 409);
      await env.DB.prepare(`UPDATE staff_positions SET retired_at = NULL, retired_by = NULL, updated_by = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(user.id, id).run();
      await logChange(env, user, p, "restore", { new_name: p.name });
      await audit(env, user.id, "positions.restore", "staff_positions", String(id), { name: p.name });
      return json({ ok: true });
    }
    return null;
  } catch (e) {
    const pm = pending(e); if (pm) return pm;
    if (/UNIQUE constraint failed/i.test(String(e))) return err("duplicate", "That position is already on the list", 409);
    throw e;
  }
}
