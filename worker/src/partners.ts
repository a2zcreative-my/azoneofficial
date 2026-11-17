/* v1.351.0 - THE PARTNER INTEREST APPLICATION (the CEO, 17-11-2026, "A2Z OS -
   CREATE PARTNER INTEREST APPLICATION").
   v1.354.0 - STAFF-ONLY management (the CEO, 17-11-2026, "STAFF-ONLY PARTNER
   APPLICATION MANAGEMENT", with his process picture):
     New -> Assigned -> Screening -> Shortlisted -> Pre-Approved -> Approved -> Activated, or Rejected
     Sales / agent staff (agent_requests_view): Pick Up, Contact, Screen, Add Notes, Shortlist
     COO or CCO (partner_preapprove):            Pre-Approve, Return or Reject a shortlisted one
     CEO (partner_approve):                      final Approve, Return or Reject; then Activate
   "Pre-Approved" is a shortlisted row with preapproved_at (0207, additive) - stageOf() is the one
   reading of it. An external agent (or a customer) is refused here BY ROLE, whatever a saved
   permission cell says, before anything is read: recruitment is A2Z's internal management.

   A public, three-step screening form at /apply/partner for independent
   referral agents. It is NOT a job application and it NEVER creates an
   account: an application is a screening record, nothing more. Access is
   given afterwards through the existing door (Users & Security -> Customers &
   Agents, the role door), only after the CEO's recorded approval and a
   separate, recorded activation.

   PUBLIC (no session):
     POST /api/v1/public/partner-applications   validated here, Cloudflare's bot
                                                check first, retry-safe by the
                                                browser's client_key; one row
   STAFF (/api/v1/staff, the Agents tab -> Requests -> Partner Applications):
     GET  /partner-applications                 the list, with counts per stage
     GET  /partner-applications/settings        reminder hours
     PUT  /partner-applications/settings        agent_requests_manage, reason, audited
     GET  /partner-applications/:id             the whole application and its history
     POST /partner-applications/:id/pickup      claim it - once: a second person is refused (409)
     POST /partner-applications/:id/release     the owner or a manager hands it back
     POST /partner-applications/:id/contact     a contact attempt (first response, -> screening)
     POST /partner-applications/:id/note        a review note and/or the next follow-up
     POST /partner-applications/:id/shortlist   the owner submits a screened candidate for management review
     POST /partner-applications/:id/preapprove  partner_preapprove: preapprove | return | reject a shortlisted one
     POST /partner-applications/:id/approve     partner_approve: approve | return | reject a pre-approved one
     POST /partner-applications/:id/activate    partner_approve: an approved one, once the agreement is
                                                recorded, the person holds an Agent account given through
                                                the existing role door AND a responsible salesperson is set

   Every write but pickup carries the record's `version` and is refused when
   somebody else changed it first. Every action is an append-only event and an
   audit row. Gender and age are recorded because the form asks them; nothing
   here reads them to decide or rank anything. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify } from "./staff";
import { json, err, audit, bumpVersion } from "./shared";
import { canUser } from "./permissions";
import { botCheck, BOT_REFUSED_MESSAGE } from "./security-status";

/** the stored status (0206's CHECK). on_hold is no longer reached (v1.354.0) but kept readable. */
export const PARTNER_STATUSES = ["new", "assigned", "screening", "shortlisted", "approved", "rejected", "on_hold", "activated"] as const;
type Status = (typeof PARTNER_STATUSES)[number];
/** the stage a person reads: a shortlisted row the COO / CCO pre-approved is "pre_approved" */
export type Stage = Status | "pre_approved";
export const stageOf = (a: { status: string; preapproved_at?: string | null }): Stage => (a.status === "shortlisted" && a.preapproved_at ? "pre_approved" : a.status as Status);
/** roles that are never staff for recruitment, whatever a saved cell says */
const NEVER = ["agent", "customer"];
export const PARTNER_SOURCES = ["facebook", "instagram", "x", "threads", "tiktok", "linkedin", "whatsapp", "google", "website", "referral", "event", "other"] as const;
export const PARTNER_AGES = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;
export const PARTNER_LOCATIONS = ["johor", "kedah", "kelantan", "melaka", "negeri_sembilan", "pahang", "perak", "perlis", "pulau_pinang", "sabah", "sarawak", "selangor", "terengganu", "kuala_lumpur", "labuan", "putrajaya", "outside_malaysia"] as const;
export const PARTNER_TIMES = ["morning", "afternoon", "evening", "any"] as const;
export const PARTNER_INTROS = ["0", "1-2", "3-5", "6+"] as const;
export const PARTNER_GROUPS = ["sme", "individuals", "corporate", "community", "other"] as const;
export const PARTNER_CHANNELS = ["personal", "business", "social", "events", "other"] as const;
export const PARTNER_AVAIL = ["occasional", "2-5", "5+"] as const;
export const PARTNER_WINDOWS = ["48h", "7d", "14d", "flexible"] as const;
const DIAL = ["+60", "+65", "+62", "+66", "+673"] as const;
/** the open part of the process: still being screened or decided */
const OPEN: readonly Status[] = ["new", "assigned", "screening", "shortlisted", "on_hold", "approved"];
const SETTINGS_KEY = "partner_app_settings";
export const PARTNER_SETTINGS_DEFAULT = { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 };
type Settings = typeof PARTNER_SETTINGS_DEFAULT;

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const long = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? v as T : null);
const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const validDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const hoursSince = (sqliteDt: string | null) => (sqliteDt ? (Date.now() - Date.parse(`${sqliteDt.replace(" ", "T")}Z`)) / 3600_000 : 0);

/* v1.354.0 - AGT-APP-#### (the CEO's picture): the next number after the highest
   id, worked out inside the INSERT; two at the same instant collide on the unique
   ref and the loser draws again. Applications from before keep their PIA- reference. */
const NEXT_REF = `'AGT-APP-' || (COALESCE((SELECT MAX(id) FROM partner_applications), 0) + 1001)`;

export async function partnerSettings(env: Env): Promise<Settings> {
  try {
    const r = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`).bind(SETTINGS_KEY).first<{ value: string }>();
    const v = r?.value ? JSON.parse(r.value) as Partial<Settings> : {};
    const pick = (k: keyof Settings, lo: number, hi: number) => { const n = Number(v[k]); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : PARTNER_SETTINGS_DEFAULT[k]; };
    return { unclaimed_hours: pick("unclaimed_hours", 1, 168), remind_hours: pick("remind_hours", 1, 168), escalate_hours: pick("escalate_hours", 2, 336) };
  } catch { return { ...PARTNER_SETTINGS_DEFAULT }; }
}

/** The people who hold a capability right now (a custom role's cells included),
    business roles first - the technical accounts only when nobody else holds it. */
async function holders(env: Env, cap: "agent_requests_view" | "agent_requests_manage" | "partner_preapprove" | "partner_approve"): Promise<number[]> {
  let rows: { id: number; role: string; custom_role: string | null }[] = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT u.id, u.role, (SELECT c.key FROM custom_roles c WHERE c.id = u.custom_role_id AND c.active = 1 AND c.base_role = u.role) AS custom_role
         FROM users u WHERE u.is_active = 1 AND (u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0))`,
    ).all<{ id: number; role: string; custom_role: string | null }>()).results ?? [];
  } catch {
    rows = ((await env.DB.prepare(`SELECT id, role, NULL AS custom_role FROM users WHERE is_active = 1 AND (role NOT IN ('customer', 'agent') AND role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0))`).all<{ id: number; role: string; custom_role: null }>()).results ?? []);
  }
  const ok = rows.filter((u) => canUser({ role: u.role, custom_role: u.custom_role ?? undefined }, cap));
  const business = ok.filter((u) => !["admin", "super_admin"].includes(u.role));
  return (business.length ? business : ok).map((u) => u.id);
}

async function tell(env: Env, ids: number[], message: string, ref: string, skip?: number): Promise<number> {
  let n = 0;
  for (const id of ids) {
    if (id === skip) continue;
    try { if (await notify(env, id, "agent", message, ref, { once: true })) n++; } catch { /* a notice never blocks the record */ }
  }
  return n;
}

async function event(env: Env, appId: number, actorId: number | null, e: { kind: string; body?: string | null; channel?: string | null; from?: string | null; to?: string | null }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO partner_application_events (application_id, actor_id, kind, body, channel, status_from, status_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(appId, actorId, e.kind, e.body ?? null, e.channel ?? null, e.from ?? null, e.to ?? null, now()).run();
}

/* =========================================================================
   PUBLIC: one application, from the three steps
   ========================================================================= */
export async function submitPartnerApplication(env: Env, request: Request, body: Record<string, unknown> | null, rateOk: boolean): Promise<Response> {
  if (!body) return err("invalid_input", "Send the application as JSON.", 400);
  const key = text(body.client_key, 80);
  if (!/^[A-Za-z0-9-]{16,80}$/.test(key)) return err("invalid_input", "This form needs to be reloaded - please open the link again.", 400);
  /* a retry of a submission that already landed answers with the same reference, before anything else */
  try {
    const again = await env.DB.prepare(`SELECT ref FROM partner_applications WHERE client_key = ?1`).bind(key).first<{ ref: string }>();
    if (again) return json({ ok: true, ref: again.ref, existing: true });
  } catch (e) {
    if (missing(e)) return err("unavailable", "Applications open after the next update - please try again later.", 503);
    throw e;
  }
  if (!rateOk) return err("rate_limited", "Too many applications from this connection - please try again later.", 429);

  /* ---- step 1: contact and source ---- */
  const errors: Record<string, string> = {};
  const full_name = text(body.full_name, 120);
  if (full_name.length < 2) errors.full_name = "required";
  const gender = oneOf(["male", "female"] as const, body.gender);
  if (!gender) errors.gender = "required";
  const age_range = oneOf(PARTNER_AGES, body.age_range);
  if (!age_range) errors.age_range = "required";
  const dial = oneOf(DIAL, body.dial) ?? "+60";
  let digits = String(body.phone ?? "").replace(/\D/g, "");
  if (digits.startsWith(dial.slice(1)) && digits.length > 10) digits = digits.slice(dial.length - 1); // typed the country code again
  digits = digits.replace(/^0+/, "");
  if (!/^\d{7,12}$/.test(digits)) errors.phone = "invalid";
  const phone = `${dial}${digits}`;
  const email = text(body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "invalid";
  const location = oneOf(PARTNER_LOCATIONS, body.location);
  if (!location) errors.location = "required";
  const contact_method = oneOf(["whatsapp", "email", "call"] as const, body.contact_method) ?? "whatsapp";
  const best_time = oneOf(PARTNER_TIMES, body.best_time);
  const source = oneOf(PARTNER_SOURCES, body.source);
  if (!source) errors.source = "required";
  const source_detail = source === "referral" || source === "other" ? text(body.source_detail, 200) || null : null;
  const utm = (k: string) => text((body.utm as Record<string, unknown> | undefined)?.[k], 120) || null;

  /* ---- step 2: referral capability ---- */
  const referred_before = body.referred_before === true ? 1 : body.referred_before === false ? 0 : null;
  if (referred_before === null) errors.referred_before = "required";
  const intro_per_week = oneOf(PARTNER_INTROS, body.intro_per_week);
  if (!intro_per_week) errors.intro_per_week = "required";
  const list = (v: unknown, of: readonly string[]) => (Array.isArray(v) ? [...new Set(v.map(String))].filter((x) => of.includes(x)) : []);
  const groups = list(body.customer_groups, PARTNER_GROUPS);
  if (!groups.length) errors.customer_groups = "required";
  const channels = list(body.lead_channels, PARTNER_CHANNELS);
  if (!channels.length) errors.lead_channels = "required";
  const groups_other = groups.includes("other") ? text(body.groups_other, 200) || null : null;
  const channels_other = channels.includes("other") ? text(body.channels_other, 200) || null : null;
  const approach = long(body.approach, 2000);
  if (approach.replace(/\s+/g, " ").length < 20) errors.approach = "too_short";

  /* ---- step 3: availability and consent ---- */
  const time_available = oneOf(PARTNER_AVAIL, body.time_available);
  if (!time_available) errors.time_available = "required";
  const screening_window = oneOf(PARTNER_WINDOWS, body.screening_window);
  if (!screening_window) errors.screening_window = "required";
  if (body.ack_independent !== true) errors.ack_independent = "required";
  if (body.ack_terms !== true) errors.ack_terms = "required";
  if (body.privacy_ack !== true) errors.privacy_ack = "required";
  const marketing = body.marketing_opt_in === true ? 1 : 0;
  if (Object.keys(errors).length) return json({ error: { code: "invalid_input", message: "Some answers are missing or not valid.", fields: errors } }, 400);

  /* ---- Cloudflare's bot check, the same one every sign-in asks (security-status.ts) ---- */
  const bot = await botCheck(env, request, body.bot_token, "partner_apply");
  if (!bot.ok) return err(bot.code, BOT_REFUSED_MESSAGE, 403);

  /* ---- the same person applying again while an application is open: the same record ---- */
  const dup = await env.DB.prepare(
    `SELECT ref FROM partner_applications WHERE (lower(email) = ?1 OR phone = ?2) AND status NOT IN ('rejected', 'activated')
        AND created_at >= datetime('now', '-30 days') ORDER BY id DESC LIMIT 1`,
  ).bind(email, phone).first<{ ref: string }>();
  if (dup) return json({ ok: true, ref: dup.ref, existing: true });

  const at = now();
  let ins: { id: number; ref: string } | null = null;
  for (let i = 0; i < 4 && !ins; i++) {
    try {
      ins = await env.DB.prepare(
        `INSERT INTO partner_applications (ref, client_key, full_name, gender, age_range, phone, email, location, contact_method, best_time, source, source_detail,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content, referred_before, intro_per_week, customer_groups, groups_other, lead_channels, channels_other,
            approach, time_available, screening_window, ack_independent, ack_terms, privacy_ack, marketing_opt_in, lang, created_at)
         VALUES (${NEXT_REF}, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, 1, 1, 1, ?27, ?28, ?29)
         ON CONFLICT(client_key) DO NOTHING RETURNING id, ref`,
      ).bind(null, key, full_name, gender, age_range, phone, email, location, contact_method, best_time, source, source_detail,
        utm("source"), utm("medium"), utm("campaign"), utm("term"), utm("content"), referred_before, intro_per_week, JSON.stringify(groups), groups_other,
        JSON.stringify(channels), channels_other, approach, time_available, screening_window, marketing, body.lang === "ms" ? "ms" : "en", at).first<{ id: number; ref: string }>();
      if (!ins) {
        /* the same browser's twin request won the race: answer with its reference */
        const again = await env.DB.prepare(`SELECT ref FROM partner_applications WHERE client_key = ?1`).bind(key).first<{ ref: string }>();
        if (again) return json({ ok: true, ref: again.ref, existing: true });
      }
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e; // a reference collision: draw again
    }
  }
  if (!ins) return err("unavailable", "The application could not be saved - please try again.", 503);
  await event(env, ins.id, null, { kind: "submitted", to: "new", body: `Submitted from /apply/partner${source ? ` · source ${source}` : ""}` });
  await bumpVersion(env, "partner-applications");
  /* A2Z's Sales / agent staff and management are told once (holders() never returns an agent or a
     customer), and the bell opens the application itself */
  const ids = await holders(env, "agent_requests_view");
  await tell(env, ids, `New partner application ${ins.ref}: ${full_name} (${source}) - pick it up in Agents › Requests`, `partner:${ins.id}:new`);
  return json({ ok: true, ref: ins.ref }, 201);
}

/* =========================================================================
   STAFF
   ========================================================================= */
interface AppRow {
  id: number; ref: string; full_name: string; gender: string; age_range: string; phone: string; email: string; location: string; contact_method: string; best_time: string | null;
  source: string; source_detail: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_term: string | null; utm_content: string | null;
  referred_before: number; intro_per_week: string; customer_groups: string; groups_other: string | null; lead_channels: string; channels_other: string | null; approach: string;
  time_available: string; screening_window: string; marketing_opt_in: number; lang: string | null; status: Status; owner_id: number | null; picked_at: string | null;
  first_response_at: string | null; next_follow_up_on: string | null; recommended_by: number | null; approved_by: number | null; approved_at: string | null;
  agreement_signed_on: string | null; agreement_note: string | null; agent_user_id: number | null; activated_by: number | null; activated_at: string | null; version: number; created_at: string; updated_at: string | null;
  preapproved_by?: number | null; preapproved_at?: string | null;
}
const parse = (v: string) => { try { const a = JSON.parse(v) as unknown; return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };

export async function handlePartners(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (path !== "/partner-applications" && !path.startsWith("/partner-applications/")) return null;
  void params;
  /* EXTERNAL AGENTS ARE NOT STAFF: refused by role before any read, whatever a saved permission
     cell (or a custom role) says - recruitment is A2Z's internal management (the CEO, 17-11-2026) */
  if (NEVER.includes(user.role)) return err("forbidden", "Partner applications are for A2Z staff only", 403);
  const viewer = canUser(user, "agent_requests_view");
  const manager = canUser(user, "agent_requests_manage");
  const preapprover = canUser(user, "partner_preapprove");
  const approver = canUser(user, "partner_approve");
  if (!viewer && !manager && !preapprover && !approver) return err("forbidden", "Partner applications are for the Sales and agent team and management", 403);
  try {
    if (path === "/partner-applications/settings") {
      if (method === "GET") return json({ settings: await partnerSettings(env), can_edit: manager });
      if (method === "PUT") {
        if (!manager) return err("forbidden", "Management sets the reminders", 403);
        const reason = text(body?.reason, 300);
        if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters).", 400);
        const cur = await partnerSettings(env);
        const n = (k: keyof Settings, lo: number, hi: number) => { const v = Number(body?.[k]); return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null; };
        const next = { unclaimed_hours: n("unclaimed_hours", 1, 168), remind_hours: n("remind_hours", 1, 168), escalate_hours: n("escalate_hours", 2, 336) };
        if (Object.values(next).some((v) => v === null)) return err("invalid_input", "Hours: unclaimed and reminder 1-168, escalation 2-336.", 400);
        if (next.escalate_hours! <= next.remind_hours!) return err("invalid_input", "Escalation comes after the reminder.", 400);
        await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`).bind(SETTINGS_KEY, JSON.stringify(next)).run();
        await audit(env, user.id, "partner.settings", "system_meta", SETTINGS_KEY, { from: cur, to: next, reason });
        return json({ ok: true, settings: next });
      }
    }

    if (path === "/partner-applications" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.ref, p.full_name, p.gender, p.age_range, p.phone, p.email, p.location, p.contact_method, p.source, p.source_detail, p.utm_campaign,
                p.referred_before, p.intro_per_week, p.customer_groups, p.lead_channels, p.time_available, p.status, p.preapproved_at, p.owner_id, p.picked_at, p.first_response_at,
                p.next_follow_up_on, p.version, p.created_at, p.updated_at, ${PERSON("o")} AS owner_name
           FROM partner_applications p LEFT JOIN users o ON o.id = p.owner_id ORDER BY p.id DESC LIMIT 500`,
      ).all<Record<string, unknown>>();
      const today = mytToday();
      const s = await partnerSettings(env);
      const rows: Record<string, unknown>[] = (results ?? []).map((r) => ({
        ...r, stored_status: r.status, status: stageOf(r as { status: string; preapproved_at: string | null }),
        customer_groups: parse(String(r.customer_groups)), lead_channels: parse(String(r.lead_channels)),
        overdue: OPEN.includes(r.status as Status) && ((!!r.next_follow_up_on && String(r.next_follow_up_on) < today)
          || (r.status === "new" && hoursSince(String(r.created_at)) > s.unclaimed_hours)
          || (r.status === "assigned" && !r.first_response_at && hoursSince(String(r.picked_at ?? r.created_at)) > s.remind_hours)),
      }));
      const counts: Record<string, number> = {};
      for (const r of rows) counts[String(r.status)] = (counts[String(r.status)] ?? 0) + 1;
      return json({ applications: rows, counts, me: user.id, can_manage: manager, can_preapprove: preapprover, can_approve: approver, settings: s });
    }

    const m = path.match(/^\/partner-applications\/(\d+)(?:\/(pickup|release|contact|note|shortlist|preapprove|approve|activate))?$/);
    if (!m) return err("not_found", "Unknown partner application route", 404);
    const id = Number(m[1]);
    const app = await env.DB.prepare(`SELECT * FROM partner_applications WHERE id = ?1`).bind(id).first<AppRow>();
    if (!app) return err("not_found", "Application not found", 404);
    const action = m[2] ?? "";
    const stage = stageOf(app);
    const who = { viewer, manager, preapprover, approver };

    if (!action && method === "GET") {
      const ev = (await env.DB.prepare(
        `SELECT e.id, e.kind, e.body, e.channel, e.status_from, e.status_to, e.created_at, ${PERSON("u")} AS actor
           FROM partner_application_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.application_id = ?1 ORDER BY e.id ASC`,
      ).bind(id).all()).results ?? [];
      const names = async (uid: number | null | undefined) => (uid ? (await env.DB.prepare(`SELECT ${PERSON("u")} AS n FROM users u WHERE u.id = ?1`).bind(uid).first<{ n: string }>())?.n ?? null : null);
      /* the Agent account this person may already hold (given through Users & Security, never here),
         and the salesperson responsible for it (Agents -> Agents, agent_assignments) */
      const accounts = (await env.DB.prepare(
        `SELECT u.id, ${PERSON("u")} AS name, u.email, u.is_active,
                (SELECT ${PERSON("p")} FROM agent_assignments s JOIN users p ON p.id = s.salesperson_id
                  WHERE s.agent_id = u.id AND s.effective_from <= ?3 ORDER BY s.effective_from DESC, s.id DESC LIMIT 1) AS salesperson_name
           FROM users u WHERE u.role = 'agent' AND (lower(u.email) = ?1 OR u.id = ?2) ORDER BY u.id`,
      ).bind(app.email.toLowerCase(), app.agent_user_id ?? 0, mytToday()).all()).results ?? [];
      return json({
        application: { ...app, stored_status: app.status, status: stage, customer_groups: parse(app.customer_groups), lead_channels: parse(app.lead_channels),
          owner_name: await names(app.owner_id), recommended_by_name: await names(app.recommended_by), preapproved_by_name: await names(app.preapproved_by),
          approved_by_name: await names(app.approved_by), activated_by_name: await names(app.activated_by) },
        events: ev, agent_accounts: accounts,
        can: actionsFor(app, user, who),
      });
    }
    if (method !== "POST") return err("not_found", "Unknown partner application route", 404);
    const can = actionsFor(app, user, who);
    const version = Number(body?.version);
    const stale = () => err("stale", "Somebody else changed this application first - it has been reloaded.", 409);
    /* one conditional UPDATE per move: the version AND the stage it was read in */
    const move = async (to: Status, set: string, binds: unknown[], from: readonly Status[], extra = ""): Promise<boolean> => {
      const r = await env.DB.prepare(
        `UPDATE partner_applications SET status = ?1, version = version + 1, updated_at = ?2${set ? `, ${set}` : ""}
          WHERE id = ?3 AND version = ?4 AND status IN (${from.map((x) => `'${x}'`).join(", ")})${extra} RETURNING id`,
      ).bind(to, now(), id, version, ...binds).first();
      return !!r;
    };
    const reasonOf = () => long(body?.reason, 1000);
    const toOwner = async (msg: string, key: string) => { if (app.owner_id && app.owner_id !== user.id) await tell(env, [app.owner_id], msg, `partner:${id}:${key}:${version}`); };

    /* ---- claim: one person, once (the conditional UPDATE is the lock) ---- */
    if (action === "pickup") {
      if (!can.pickup) return app.owner_id ? err("already_claimed", "Somebody else already picked this application up.", 409) : err("forbidden", "Not yours to pick up", 403);
      const r = await env.DB.prepare(
        `UPDATE partner_applications SET status = 'assigned', owner_id = ?1, picked_at = ?2, version = version + 1, updated_at = ?2
          WHERE id = ?3 AND status = 'new' AND owner_id IS NULL RETURNING version`,
      ).bind(user.id, now(), id).first<{ version: number }>();
      if (!r) return err("already_claimed", "Somebody else already picked this application up.", 409);
      await event(env, id, user.id, { kind: "picked_up", from: "new", to: "assigned", body: "Picked up for screening" });
      await audit(env, user.id, "partner.pickup", "partner_applications", String(id), { ref: app.ref });
      return json({ ok: true, version: r.version });
    }
    if (action === "release") {
      if (!can.release) return err("forbidden", "Only the owner or management hands an application back", 403);
      const reason = text(body?.reason, 300);
      if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters).", 400);
      if (!(await move("new", "owner_id = NULL, picked_at = NULL", [], ["assigned", "screening", "on_hold"]))) return stale();
      await event(env, id, user.id, { kind: "released", from: app.status, to: "new", body: reason });
      await audit(env, user.id, "partner.release", "partner_applications", String(id), { ref: app.ref, reason, owner: app.owner_id });
      return json({ ok: true });
    }
    if (action === "contact") {
      if (!can.contact) return err("forbidden", "Pick the application up first - the owner records the contact", 403);
      const channel = oneOf(["whatsapp", "email", "call", "other"] as const, body?.channel);
      const note = long(body?.note, 1000);
      if (!channel) return err("invalid_input", "Say how you contacted them.", 400);
      if (note.length < 3) return err("invalid_input", "Write what happened (a few words).", 400);
      const follow = validDay(body?.next_follow_up_on) ? String(body!.next_follow_up_on) : null;
      if (follow && follow < mytToday()) return err("invalid_input", "The next follow-up is today or later.", 400);
      const to: Status = app.status === "assigned" || app.status === "on_hold" ? "screening" : app.status;
      if (!(await move(to, "first_response_at = COALESCE(first_response_at, ?5), next_follow_up_on = ?6", [now(), follow], ["assigned", "screening", "on_hold"]))) return stale();
      await event(env, id, user.id, { kind: "contacted", channel, body: note, from: app.status, to });
      await audit(env, user.id, "partner.contact", "partner_applications", String(id), { ref: app.ref, channel, first: !app.first_response_at });
      return json({ ok: true });
    }
    if (action === "note") {
      if (!can.note) return err("forbidden", "Not yours to review", 403);
      const note = long(body?.note, 2000);
      const follow = body?.next_follow_up_on === null ? null : validDay(body?.next_follow_up_on) ? String(body!.next_follow_up_on) : undefined;
      if (note.length < 3 && follow === undefined) return err("invalid_input", "Write a note or set the next follow-up.", 400);
      if (follow && follow < mytToday()) return err("invalid_input", "The next follow-up is today or later.", 400);
      if (follow !== undefined && !(await move(app.status, "next_follow_up_on = ?5", [follow], [app.status]))) return stale();
      if (note.length >= 3) await event(env, id, user.id, { kind: "note", body: note });
      if (follow !== undefined) await event(env, id, user.id, { kind: "follow_up", body: follow ? `Next follow-up ${follow}` : "Follow-up cleared" });
      await audit(env, user.id, "partner.note", "partner_applications", String(id), { ref: app.ref, note: note.length >= 3, follow: follow ?? null });
      return json({ ok: true });
    }
    /* ---- Sales submits a screened candidate for management review ---- */
    if (action === "shortlist") {
      if (!can.shortlist) return err("forbidden", app.first_response_at || !(app.owner_id === user.id || manager) ? "Only the owner submits an application they are screening" : "Contact the applicant and record it before submitting for review", 403);
      const reason = reasonOf();
      if (reason.length < 5) return err("reason_required", "Say why you recommend this applicant (at least 5 characters) - it is kept with the application.", 400);
      if (!(await move("shortlisted", "recommended_by = ?5, preapproved_by = NULL, preapproved_at = NULL", [user.id], ["assigned", "screening", "on_hold"], " AND first_response_at IS NOT NULL"))) return stale();
      await event(env, id, user.id, { kind: "recommended", body: reason, from: app.status, to: "shortlisted" });
      await audit(env, user.id, "partner.shortlisted", "partner_applications", String(id), { ref: app.ref, from: app.status, reason });
      await tell(env, await holders(env, "partner_preapprove"), `Partner application ${app.ref} (${app.full_name}) is shortlisted by Sales - your pre-approval is needed`, `partner:${id}:shortlisted:${version}`, user.id);
      return json({ ok: true });
    }
    /* ---- the COO or CCO: pre-approve, return or reject a shortlisted one ---- */
    if (action === "preapprove") {
      if (!preapprover) return err("forbidden", "Only the COO or the CCO pre-approves a partner application", 403);
      if (stage !== "shortlisted") return err("not_shortlisted", stage === "pre_approved" ? "Already pre-approved - it waits for the CEO." : "Only a shortlisted application is pre-approved.", 409);
      const decision = oneOf(["preapprove", "return", "reject"] as const, body?.decision);
      const reason = reasonOf();
      if (!decision) return err("invalid_input", "Pre-approve, return or reject.", 400);
      if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters).", 400);
      const pending = " AND preapproved_at IS NULL";
      const ok = decision === "preapprove" ? await move("shortlisted", "preapproved_by = ?5, preapproved_at = ?6", [user.id, now()], ["shortlisted"], pending)
        : decision === "return" ? await move("screening", "", [], ["shortlisted"], pending)
        : await move("rejected", "", [], ["shortlisted"], pending);
      if (!ok) return stale();
      const to = decision === "preapprove" ? "pre_approved" : decision === "return" ? "screening" : "rejected";
      await event(env, id, user.id, { kind: decision === "preapprove" ? "pre_approved" : decision === "return" ? "returned" : "rejected", body: reason, from: "shortlisted", to });
      await audit(env, user.id, `partner.${decision === "preapprove" ? "pre_approve" : decision}`, "partner_applications", String(id), { ref: app.ref, reason, by_role: user.role });
      if (decision === "preapprove") await tell(env, await holders(env, "partner_approve"), `Partner application ${app.ref} (${app.full_name}) is pre-approved - your final decision is needed`, `partner:${id}:pre_approved:${version}`, user.id);
      await toOwner(`Partner application ${app.ref}: ${decision === "preapprove" ? "pre-approved, now with the CEO" : decision === "return" ? `returned for more screening - ${reason}` : "rejected by management"}`, to);
      return json({ ok: true });
    }
    /* ---- the CEO: the final decision on a pre-approved one ---- */
    if (action === "approve") {
      if (!approver) return err("forbidden", "The final approval is the CEO's", 403);
      if (stage !== "pre_approved") return err("not_pre_approved", "The CEO decides after the COO or CCO pre-approves.", 409);
      const decision = oneOf(["approve", "return", "reject"] as const, body?.decision);
      const reason = reasonOf();
      if (!decision) return err("invalid_input", "Approve, return or reject.", 400);
      if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters).", 400);
      const ready = " AND preapproved_at IS NOT NULL";
      const ok = decision === "approve" ? await move("approved", "approved_by = ?5, approved_at = ?6", [user.id, now()], ["shortlisted"], ready)
        : decision === "return" ? await move("screening", "preapproved_by = NULL, preapproved_at = NULL", [], ["shortlisted"], ready)
        : await move("rejected", "", [], ["shortlisted"], ready);
      if (!ok) return stale();
      const to = decision === "approve" ? "approved" : decision === "return" ? "screening" : "rejected";
      await event(env, id, user.id, { kind: decision === "approve" ? "approved" : decision === "return" ? "returned" : "rejected", body: reason, from: "pre_approved", to });
      await audit(env, user.id, decision === "approve" ? "partner.approve" : `partner.${decision}`, "partner_applications", String(id), { ref: app.ref, reason, final: true });
      await toOwner(`Partner application ${app.ref}: ${decision === "approve" ? "approved by the CEO" : decision === "return" ? `returned by the CEO - ${reason}` : "rejected by the CEO"}`, to);
      if (app.preapproved_by && app.preapproved_by !== user.id) await tell(env, [app.preapproved_by], `Partner application ${app.ref}: the CEO ${decision === "approve" ? "approved it" : decision === "return" ? "returned it" : "rejected it"}`, `partner:${id}:final:${version}`);
      return json({ ok: true });
    }
    if (action === "activate") {
      if (!approver) return err("forbidden", "Activation is the CEO's, recorded separately from the approval", 403);
      if (app.status !== "approved") return err("not_approved", "Only an approved application is activated.", 409);
      const signed = validDay(body?.agreement_signed_on) ? String(body!.agreement_signed_on) : null;
      const agreementNote = long(body?.agreement_note, 500);
      if (!signed || signed > mytToday()) return err("agreement_required", "Record the date the agent agreement was signed (today or earlier).", 400);
      if (agreementNote.length < 5) return err("agreement_required", "Say where the signed agreement is kept (at least 5 characters).", 400);
      const agentId = Number(body?.agent_user_id);
      /* the account is given through Users & Security -> Customers & Agents (the role door, a proven email) - never here */
      const acct = await env.DB.prepare(`SELECT id, role, is_active FROM users WHERE id = ?1`).bind(agentId).first<{ id: number; role: string; is_active: number }>();
      if (!acct || acct.role !== "agent" || acct.is_active !== 1) return err("agent_account_required", "Give Agent access first in Users & Security › Customers & Agents, then choose that account here.", 409);
      const linked = await env.DB.prepare(`SELECT ref FROM partner_applications WHERE agent_user_id = ?1 AND id != ?2`).bind(agentId, id).first<{ ref: string }>();
      if (linked) return err("agent_linked", `That Agent account is already linked to ${linked.ref}.`, 409);
      /* the responsible salesperson, set in Agents -> Agents (agent_assignments) */
      const sp = await env.DB.prepare(`SELECT salesperson_id FROM agent_assignments WHERE agent_id = ?1 AND effective_from <= ?2 ORDER BY effective_from DESC, id DESC LIMIT 1`).bind(agentId, mytToday()).first<{ salesperson_id: number }>().catch(() => null);
      if (!sp?.salesperson_id) return err("salesperson_required", "Assign the responsible salesperson to this agent first (Agents › Agents).", 409);
      if (!(await move("activated", "agreement_signed_on = ?5, agreement_note = ?6, agent_user_id = ?7, activated_by = ?8, activated_at = ?9",
        [signed, agreementNote, agentId, user.id, now()], ["approved"]))) return stale();
      await event(env, id, user.id, { kind: "activated", body: `Agreement signed ${signed} · ${agreementNote}`, from: "approved", to: "activated" });
      await audit(env, user.id, "partner.activate", "partner_applications", String(id), { ref: app.ref, agent_user_id: agentId, salesperson_id: sp.salesperson_id, agreement_signed_on: signed });
      await toOwner(`Partner application ${app.ref}: activated - the agent can sign in to the Agent Portal`, "activated");
      return json({ ok: true });
    }
    return err("not_found", "Unknown partner application route", 404);
  } catch (e) {
    if (missing(e)) return json({ applications: [], counts: {}, pending_migration: true, error: { code: "pending_migration", message: "Partner applications arrive with the next database update." } }, 200);
    throw e;
  }
}

/** What THIS person may do to this application now - the screen draws exactly these; every route re-checks. */
function actionsFor(a: AppRow, user: StaffUser, who: { viewer: boolean; manager: boolean; preapprover: boolean; approver: boolean }) {
  const stage = stageOf(a);
  const anyone = who.viewer || who.manager || who.preapprover || who.approver;
  const mine = a.owner_id === user.id;
  const works = (mine || who.manager) && anyone;
  const screening = ["assigned", "screening", "on_hold"].includes(a.status);
  return {
    pickup: anyone && a.status === "new" && a.owner_id === null,
    release: works && screening,
    contact: works && screening,
    note: anyone && (mine || who.manager || who.preapprover || who.approver || a.status !== "new"),
    shortlist: works && screening && !!a.first_response_at,
    /** the screen says why Shortlist is not offered yet */
    shortlist_needs_contact: works && screening && !a.first_response_at,
    preapprove: who.preapprover && stage === "shortlisted",
    approve: who.approver && stage === "pre_approved",
    activate: who.approver && a.status === "approved",
  };
}

/* =========================================================================
   The hourly pass (index.ts scheduled, beside the task and leave sweeps):
   reminders to the owner, escalation to management - once a day each, by ref
   ========================================================================= */
export async function partnerSweep(env: Env): Promise<{ reminded: number; escalated: number }> {
  let rows: AppRow[] = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT * FROM partner_applications WHERE status IN ('new', 'assigned', 'screening', 'on_hold', 'shortlisted', 'approved') ORDER BY id LIMIT 500`,
    ).all<AppRow>()).results ?? [];
  } catch (e) { if (missing(e)) return { reminded: 0, escalated: 0 }; throw e; }
  if (!rows.length) return { reminded: 0, escalated: 0 };
  const s = await partnerSettings(env);
  const today = mytToday();
  let managers: number[] | null = null, approvers: number[] | null = null, preapprovers: number[] | null = null;
  const mgr = async () => (managers ??= await holders(env, "agent_requests_manage"));
  const appr = async () => (approvers ??= await holders(env, "partner_approve"));
  const pre = async () => (preapprovers ??= await holders(env, "partner_preapprove"));
  let reminded = 0, escalated = 0;
  for (const a of rows) {
    if (a.status === "new") {
      if (hoursSince(a.created_at) > s.unclaimed_hours) escalated += await tell(env, await mgr(), `Partner application ${a.ref} (${a.full_name}) has not been picked up for ${Math.floor(hoursSince(a.created_at))} hours`, `partner:${a.id}:unclaimed:${today}`);
      continue;
    }
    if (a.status === "shortlisted" && !a.preapproved_at) {
      if (hoursSince(a.updated_at ?? a.created_at) > s.remind_hours) reminded += await tell(env, await pre(), `Partner application ${a.ref} is waiting for your pre-approval`, `partner:${a.id}:preapprove:${today}`);
      continue;
    }
    if (a.status === "shortlisted") {
      if (hoursSince(a.preapproved_at ?? a.updated_at ?? a.created_at) > s.remind_hours) reminded += await tell(env, await appr(), `Partner application ${a.ref} is pre-approved and waiting for your final decision`, `partner:${a.id}:approve:${today}`);
      continue;
    }
    if (a.status === "approved") {
      if (hoursSince(a.approved_at ?? a.created_at) > s.remind_hours) reminded += await tell(env, await appr(), `Partner application ${a.ref} is approved - record the agreement and activate it`, `partner:${a.id}:activate:${today}`);
      continue;
    }
    /* owned: no first response yet, or the follow-up date passed */
    const waiting = !a.first_response_at ? hoursSince(a.picked_at ?? a.created_at) : a.next_follow_up_on && a.next_follow_up_on < today ? hoursSince(`${a.next_follow_up_on} 00:00:00`) : 0;
    if (!waiting || !a.owner_id) continue;
    if (waiting > s.remind_hours) reminded += await tell(env, [a.owner_id], `Partner application ${a.ref} (${a.full_name}): ${a.first_response_at ? "the follow-up is overdue" : "contact the applicant"}`, `partner:${a.id}:remind:${today}`);
    if (waiting > s.escalate_hours) escalated += await tell(env, await mgr(), `Partner application ${a.ref} is overdue with its owner - ${Math.floor(waiting)} hours`, `partner:${a.id}:escalate:${today}`, a.owner_id);
  }
  return { reminded, escalated };
}
