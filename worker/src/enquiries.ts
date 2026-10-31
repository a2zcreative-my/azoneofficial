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

/** v1.112.0-v1.182.1 a new enquiry was announced ONCE to everyone who could
    answer it, a push with the Enquiries tab as its landing. v1.183.0 - the
    tab is retired and the intake kept (the owner's choice): the row is saved,
    nobody is told, because a push that lands on no tab is noise. The live
    topic is still bumped. The parameters stay so the two callers (the
    website form and the customer account) are untouched. */
/* v1.216.0 - the owner, 28-10-2026 (the Sales growth audit, M1: "Show on
   Sales, notify"): a new enquiry is a lead, so it is announced again - ONCE,
   to the active sales consultants and the CEO, landing on Sales, where
   Customers & Follow-ups lists it. The Enquiries tab stays retired. It is
   called once, after the row is saved (the website form, a customer account). */
export async function announceEnquiry(env: Env, id: number | null, name: string, _category: string | null, source: "site" | "account"): Promise<void> {
  try { await bumpVersion(env, "enquiries"); } catch { /* best-effort */ }
  if (id === null) return;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'ceo')`,
    ).all<{ id: number }>();
    const from = source === "site" ? "the website" : "a customer account";
    for (const u of results) {
      await notify(env, u.id, "enquiry", `New enquiry from ${name.slice(0, 80)} (${from}) - answer it on Sales, Customers & Follow-ups`, `enquiry:new:${id}`);
    }
  } catch { /* best-effort: the enquiry is saved either way */ }
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
  /* ---- v1.239.0 - INTRODUCE A LEAD (the owner, 31-10-2026, claude/WEEKLY-
     TARGET-DASHBOARD-AUDIT.md: "Revenue + goals"). Any staff member can hand
     the Sales team a real contact they met: it is an ordinary enquiry (one
     enquiry list, no second lead system) that names who introduced it. It
     counts toward an "introductions" goal only once somebody else marks it
     qualified - an unverified or invented contact earns nothing. ---- */
  if (path === "/enquiries/introduce" && method === "POST") {
    if (!user || ["customer"].includes(user.role)) return err("forbidden", "Staff only", 403);
    const t = (k: string, max: number) => (typeof body?.[k] === "string" ? (body[k] as string).trim().slice(0, max) : "");
    const name = t("name", 120), company = t("company", 160), phone = t("phone", 40), email = t("email", 160).toLowerCase(), note = t("note", 1000);
    if (name.length < 2) return err("invalid_input", "Give the contact's name", 400);
    if (!phone && !email) return err("invalid_input", "Give a phone number or an email so Sales can reach them", 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("invalid_input", "That email does not look right", 400);
    if (phone && !/^[+\d][\d\s-]{6,}$/.test(phone)) return err("invalid_input", "That phone number does not look right", 400);
    if (note.length < 10) return err("invalid_input", "Say what they need (at least 10 characters)", 400);
    const digits = phone.replace(/\D/g, "");
    const dup = await env.DB.prepare(
      `SELECT id FROM enquiries WHERE status != 'closed' AND created_at >= datetime('now', '-30 days')
         AND ((?1 != '' AND lower(email) = ?1) OR (?2 != '' AND replace(replace(replace(phone, ' ', ''), '-', ''), '+', '') LIKE '%' || ?2))
       LIMIT 1`,
    ).bind(email, digits.slice(-9)).first<{ id: number }>();
    if (dup) return err("duplicate", "Sales already has an open enquiry for this contact - nothing new was added", 409);
    const today = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?1 AND action = 'enquiry.introduce' AND created_at >= datetime('now', '-1 day')`).bind(user.id).first<{ n: number }>();
    if (Number(today?.n ?? 0) >= 10) return err("rate_limited", "Ten introductions a day - send the rest tomorrow", 429);
    let id: number | null = null;
    try {
      const r = await env.DB.prepare(
        `INSERT INTO enquiries (name, company, phone, email, message, category, referred_by) VALUES (?1, ?2, ?3, ?4, ?5, 'introduction', ?6) RETURNING id`,
      ).bind(name, company || null, phone || null, email || null, `${note}\n\n- Introduced by ${user.name}`, user.id).first<{ id: number }>();
      id = r?.id ?? null;
    } catch (e) {
      if (/no column named|has no column|no such column/i.test(String(e))) return err("migration_missing", "Run migration 0156 first (PUSH.bat)", 503);
      throw e;
    }
    await audit(env, user.id, "enquiry.introduce", "enquiries", String(id), { has_phone: !!phone, has_email: !!email });
    await announceEnquiry(env, id, name, "introduction", "site");
    return json({ ok: true, id }, 201);
  }

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
    /* v1.239.0 - the moment an enquiry is first marked qualified, and by
       whom: what a "qualified enquiries" goal and an introduction count on */
    if (hasStatus && body.status === "qualified") {
      try { await env.DB.prepare(`UPDATE enquiries SET qualified_at = COALESCE(qualified_at, datetime('now')), qualified_by = COALESCE(qualified_by, ?2) WHERE id = ?1`).bind(id, user.id).run(); } catch { /* pre-0156 */ }
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
