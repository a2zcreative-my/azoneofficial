/**
 * CUSTOMER ENQUIRIES — v1.112.0.
 *
 * The CEO, 05-09-2026: *"Customer enquiries - I think should create a new
 * tabs under customer/client inquiry which is require Staff action for
 * response their inquire either via apps or emails."* Until now the enquiries
 * were a card at the top of the Sales tab, answered in the app since
 * v1.4.191; the routes lived inline in index.ts. Now they are a TAB, the
 * routes live here, and an enquiry is treated as WORK: it lands on the desk
 * of everyone who can answer it, it is pushed to their phones the moment it
 * arrives, it can be taken by one person so two do not answer it, and it is
 * marked overdue when a customer has waited a day.
 *
 * WHAT STAYS. The table (0001, 0052 category, 0055 reply), the four statuses
 * the CHECK allows - new, contacted, qualified, closed - and the in-app reply
 * the customer reads on /account. The CEO chose in-app only for now; an
 * email reply is a later step and would need a provider.
 *
 * WHO. enquiry_manage (permissions.ts), mirrored by ENQUIRY_ROLES in
 * lib/portal-tabs.ts; tests/enquiries.mjs holds the two together.
 */

import type { Env } from "./index";
import { json, err, audit, bumpVersion } from "./shared";
import { PERMS, can } from "./permissions";
import { notify } from "./staff";

export const STATUSES = ["new", "contacted", "qualified", "closed"] as const;
export type EnquiryStatus = (typeof STATUSES)[number];
export const CATEGORIES = ["general", "package_pricing", "live_commerce", "order_delivery", "collaboration"] as const;

/** How long a customer may wait before the enquiry is overdue: one day.
    Pure, so the guard runs it; the desk and the tab both use it. */
export const OVERDUE_HOURS = 24;
export function hoursWaiting(createdAt: string, now = Date.now()): number {
  const t = new Date(createdAt.replace(" ", "T") + (createdAt.endsWith("Z") ? "" : "Z")).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, (now - t) / 3_600_000);
}
export function isOverdue(e: { status: string; created_at: string; replied_at?: string | null }, now = Date.now()): boolean {
  if (e.status !== "new") return false;
  if (e.replied_at) return false;
  return hoursWaiting(e.created_at, now) > OVERDUE_HOURS;
}

const CATEGORY_LABEL: Record<string, string> = {
  general: "general", package_pricing: "package & pricing", live_commerce: "live commerce",
  order_delivery: "order & delivery", collaboration: "collaboration",
};

/** A new enquiry is announced ONCE to everyone who can answer it - a push to
    the phone with the Enquiries tab as its landing - and the live topic is
    bumped so an open tab shows it without a refresh. Best-effort: the
    enquiry itself is already saved when this runs. */
export async function announceEnquiry(env: Env, id: number | null, name: string, category: string | null, source: "site" | "account"): Promise<void> {
  try {
    const roles = PERMS.enquiry_manage ?? [];
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE is_active = 1 AND role IN (${roles.map((_, i) => `?${i + 1}`).join(",")})`,
    ).bind(...roles).all<{ id: number }>();
    const cat = category ? CATEGORY_LABEL[category] ?? category : null;
    const msg = `New customer enquiry${cat ? ` (${cat})` : ""}: ${name}${source === "site" ? " — from the website" : ""}`;
    for (const u of results) await notify(env, u.id, "enquiry", msg, `enquiry:${id ?? ""}`);
  } catch { /* best-effort */ }
  try { await bumpVersion(env, "enquiries"); } catch { /* best-effort */ }
}

interface EnquiryRow {
  id: number; name: string; company: string | null; phone: string | null; email: string | null; message: string;
  category: string | null; status: string; reply: string | null; replied_at: string | null; replied_by: number | null;
  assigned_to: number | null; assigned_name: string | null; replied_name: string | null; created_at: string;
}

export async function handleEnquiries(
  env: Env, path: string, method: string, body: Record<string, unknown> | null,
  user: { id: number; role: string; name: string } | null, params: URLSearchParams,
): Promise<Response | null> {
  if (!user || !can(user.role, "enquiry_manage")) return err("forbidden", "Business team access required", 403);

  /* ---- the list: newest first, with who took it and who answered ---- */
  if (path === "/enquiries" && method === "GET") {
    const status = params.get("status");
    const where = status && (STATUSES as readonly string[]).includes(status) ? `WHERE e.status = ?1` : "";
    let rows: EnquiryRow[];
    try {
      ({ results: rows } = await env.DB.prepare(
        `SELECT e.id, e.name, e.company, e.phone, e.email, e.message, e.category, e.status, e.reply, e.replied_at, e.replied_by,
                e.assigned_to, e.created_at,
                COALESCE(NULLIF(TRIM(a.full_name), ''), a.name) AS assigned_name,
                COALESCE(NULLIF(TRIM(r.full_name), ''), r.name) AS replied_name
           FROM enquiries e
           LEFT JOIN users a ON a.id = e.assigned_to
           LEFT JOIN users r ON r.id = e.replied_by
          ${where} ORDER BY e.created_at DESC LIMIT 300`,
      ).bind(...(where ? [status] : [])).all<EnquiryRow>());
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      /* pre-0055: no reply columns */
      ({ results: rows } = await env.DB.prepare(
        `SELECT e.id, e.name, e.company, e.phone, e.email, e.message, e.status, e.assigned_to, e.created_at,
                COALESCE(NULLIF(TRIM(a.full_name), ''), a.name) AS assigned_name
           FROM enquiries e LEFT JOIN users a ON a.id = e.assigned_to
          ${where} ORDER BY e.created_at DESC LIMIT 300`,
      ).bind(...(where ? [status] : [])).all<EnquiryRow>());
    }
    const counts: Record<string, number> = { new: 0, contacted: 0, qualified: 0, closed: 0, overdue: 0, mine: 0 };
    /* counts are over EVERYTHING, not the filtered page, so the chips read right */
    try {
      const { results: all } = await env.DB.prepare(`SELECT status, created_at, replied_at, assigned_to FROM enquiries`).all<{ status: string; created_at: string; replied_at: string | null; assigned_to: number | null }>();
      for (const r of all) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        if (isOverdue(r)) counts.overdue!++;
        if (r.assigned_to === user.id && r.status !== "closed") counts.mine!++;
      }
    } catch { /* pre-0055: no replied_at */ }
    /* who can take an enquiry: the same people who can see this */
    const roles = PERMS.enquiry_manage ?? [];
    const { results: people } = await env.DB.prepare(
      `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, role FROM users WHERE is_active = 1 AND role IN (${roles.map((_, i) => `?${i + 1}`).join(",")}) ORDER BY name`,
    ).bind(...roles).all<{ id: number; name: string; role: string }>();
    return json({
      enquiries: rows.map((r) => ({ ...r, overdue: isOverdue(r), hours_waiting: Math.round(hoursWaiting(r.created_at)) })),
      counts, people, overdue_hours: OVERDUE_HOURS, statuses: STATUSES, categories: CATEGORIES,
    });
  }

  /* ---- one enquiry: reply, status, take / hand over ---- */
  const m = path.match(/^\/enquiries\/(\d+)$/);
  if (m && method === "PATCH") {
    const id = Number(m[1]);
    const row = await env.DB.prepare(`SELECT id, name, status, assigned_to FROM enquiries WHERE id = ?1`).bind(id).first<{ id: number; name: string; status: string; assigned_to: number | null }>();
    if (!row) return err("not_found", "No such enquiry", 404);
    const hasStatus = typeof body?.status === "string" && (STATUSES as readonly string[]).includes(body.status);
    const hasReply = typeof body?.reply === "string" && body.reply.trim() !== "";
    const hasAssign = body !== null && Object.prototype.hasOwnProperty.call(body, "assigned_to");
    if (!body || (!hasStatus && !hasReply && !hasAssign)) {
      return err("invalid_input", `Provide reply text, a status (${STATUSES.join(", ")}) and/or assigned_to`, 400);
    }
    let assignedTo: number | null | undefined;
    if (hasAssign) {
      const raw = body.assigned_to;
      assignedTo = raw === null || raw === "" ? null : Number(raw);
      if (assignedTo !== null) {
        if (!Number.isInteger(assignedTo)) return err("invalid_input", "assigned_to must be a user id or null", 400);
        const u = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?1 AND is_active = 1`).bind(assignedTo).first<{ id: number; role: string }>();
        if (!u || !can(u.role, "enquiry_manage")) return err("invalid_input", "That person cannot answer enquiries", 400);
      }
    }
    if (hasReply) {
      /* v1.4.191: the reply auto-marks a new enquiry contacted unless a
         further status is set in the same call. A reply also takes the
         enquiry for the replier, unless someone already has it. */
      try {
        await env.DB.prepare(
          `UPDATE enquiries SET reply = ?1, replied_by = ?2, replied_at = datetime('now'),
             status = COALESCE(?3, CASE WHEN status = 'new' THEN 'contacted' ELSE status END),
             assigned_to = COALESCE(${hasAssign ? "?5" : "assigned_to"}, ?2)
           WHERE id = ?4`,
        ).bind((body.reply as string).trim().slice(0, 2000), user.id, hasStatus ? body.status : null, id, ...(hasAssign ? [assignedTo] : [])).run();
      } catch (e) {
        if (String(e).includes("no such column")) return err("migration_missing", "Run the deploy so migration 0055 (enquiry replies) applies", 500);
        throw e;
      }
    } else {
      const sets: string[] = [];
      const binds: unknown[] = [];
      if (hasStatus) { binds.push(body.status); sets.push(`status = ?${binds.length}`); }
      if (hasAssign) { binds.push(assignedTo); sets.push(`assigned_to = ?${binds.length}`); }
      binds.push(id);
      await env.DB.prepare(`UPDATE enquiries SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();
    }
    await audit(env, user.id, "enquiry.update_status", "enquiries", String(id), {
      ...(hasStatus ? { status: body.status } : {}), ...(hasReply ? { replied: true } : {}), ...(hasAssign ? { assigned_to: assignedTo } : {}),
    });
    /* the person it was handed to hears about it, once, unless it is themselves */
    if (hasAssign && assignedTo && assignedTo !== user.id && assignedTo !== row.assigned_to) {
      try { await notify(env, assignedTo, "enquiry", `${user.name} handed you the enquiry from ${row.name}`, `enquiry:${id}`); } catch { /* best-effort */ }
    }
    await bumpVersion(env, "enquiries");
    return json({ ok: true });
  }

  return null;
}
