/* v1.369.0 - THE A2Z BUSINESS GROWTH CHECK (the CEO, 18-11-2026, "A2Z Business
   Growth Check", his three step pictures and the Sales Customers & Follow-ups
   picture; the audit answered: who sees = the same as website Enquiries
   (enquiry_manage), a second submission while one is open is ADDED to that
   open enquiry, reminders at 4 / 24 / 48 hours).

   A public, three-step form at /apply/business: an entrepreneur describes the
   business, its challenges and the 90-day goal and asks for a FREE first
   review. It is a lead record - ONE business_growth_enquiry with a reference -
   and nothing more: it never creates an account, a customer or a sale.

     New -> Assigned -> Contacted -> Problem Identified -> Free Advice Delivered
         -> Qualified | Follow-Up | Not Interested

   A paid solution goes through the EXISTING Sales path only: a quotation (the
   Sales form, prefilled), the customer's acceptance, the invoice, the payment
   report and the CEO's verification. This file never marks anything sold: the
   "quotations accepted" and "CEO-verified sales" figures are READ from those
   records for the enquiries a quotation was linked to.

   Opening WhatsApp (wa.me click-to-chat, prefilled) is not proof a message was
   sent: a contact attempt is what the staff member RECORDS here. Nothing is sent
   automatically and no paid WhatsApp API is used.

   PUBLIC (no session):
     POST /api/v1/public/business-growth        validated here, Cloudflare's bot check,
                                                retry-safe by the browser's client_key
   STAFF (/api/v1/staff, Sales -> Customers & Follow-ups -> Business Growth):
     GET  /business-growth                      the list, counts and the analytics
     GET  /business-growth/settings             reminder hours
     PUT  /business-growth/settings             a manager (exec_view), reason, audited
     GET  /business-growth/:id                  the whole enquiry, its history, linked quotation
     POST /business-growth/:id/pickup           claim it - once: a second person is refused (409)
     POST /business-growth/:id/release          the owner or a manager hands it back
     POST /business-growth/:id/assign           a manager gives it to a named person
     POST /business-growth/:id/contact          a contact attempt (reached or not)
     POST /business-growth/:id/note             a note and / or the next follow-up
     POST /business-growth/:id/problem          the problem identified with the owner
     POST /business-growth/:id/advice           the free advice given
     POST /business-growth/:id/outcome          qualified | follow_up | not_interested, with the reason
     POST /business-growth/:id/quotation        link an existing quotation to a qualified enquiry

   Every write but pickup carries the record's `version` and is refused when
   somebody else changed it first. Every action is an append-only event and an
   audit row. Agents, customers and applicants are refused BY ROLE, whatever a
   saved permission cell says. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify } from "./staff";
import { json, err, audit, bumpVersion } from "./shared";
import { canUser } from "./permissions";
import { botCheck, BOT_REFUSED_MESSAGE } from "./security-status";
import { sha256 } from "./accounts";

export const GROWTH_STATUSES = ["new", "assigned", "contacted", "problem_identified", "advice_delivered", "qualified", "follow_up", "not_interested"] as const;
type Status = (typeof GROWTH_STATUSES)[number];
const NEVER = ["agent", "customer"];
export const GROWTH_SOURCES = ["facebook", "instagram", "tiktok", "threads", "x", "linkedin", "whatsapp", "google", "website", "referral", "event", "other"] as const;
export const GROWTH_INDUSTRIES = ["food_beverage", "retail", "fashion_beauty", "health_wellness", "education", "professional_services", "property", "automotive", "manufacturing", "agriculture", "technology", "travel_hospitality", "other"] as const;
export const GROWTH_STATES = ["johor", "kedah", "kelantan", "melaka", "negeri_sembilan", "pahang", "perak", "perlis", "pulau_pinang", "sabah", "sarawak", "selangor", "terengganu", "kuala_lumpur", "labuan", "putrajaya", "outside_malaysia"] as const;
export const GROWTH_CHALLENGES = ["low_sales", "few_customers", "weak_brand", "content", "social_reach", "ads_results", "online_store", "competition", "no_strategy", "no_time", "other"] as const;
export const GROWTH_PLATFORMS = ["facebook", "instagram", "tiktok", "whatsapp", "shopee", "lazada", "tiktok_shop", "website", "google_business", "youtube", "none"] as const;
export const GROWTH_INTERESTS = ["sales", "customer_acquisition", "branding", "creative_content", "ai_video", "digital_marketing", "seo", "ecommerce"] as const;
export const GROWTH_TIMES = ["morning", "afternoon", "evening", "any"] as const;
/** the Privacy Notice the second consent acknowledges - app/privacy, updated 24 July 2026 */
export const PRIVACY_VERSION = "2026-07-24";
const DIAL = ["+60", "+65", "+62", "+66", "+673"] as const;
/** still being worked: everything but a closed Not Interested */
const OPEN: readonly Status[] = ["new", "assigned", "contacted", "problem_identified", "advice_delivered", "qualified", "follow_up"];
/** owned work, before an outcome */
const WORKING: readonly Status[] = ["assigned", "contacted", "problem_identified", "advice_delivered", "follow_up"];
const SETTINGS_KEY = "growth_enquiry_settings";
export const GROWTH_SETTINGS_DEFAULT = { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 };
type Settings = typeof GROWTH_SETTINGS_DEFAULT;

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const long = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? v as T : null);
const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const validDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const hoursSince = (sqliteDt: string | null) => (sqliteDt ? (Date.now() - Date.parse(`${sqliteDt.replace(" ", "T")}Z`)) / 3600_000 : 0);
const parse = (v: unknown) => { try { const a = JSON.parse(String(v)) as unknown; return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const list = (v: unknown, of: readonly string[]) => (Array.isArray(v) ? [...new Set(v.map(String))].filter((x) => of.includes(x)) : []);

/* BG-#### - the next number after the highest id, worked out inside the INSERT; two at the
   same instant collide on the unique ref and the loser draws again */
const NEXT_REF = `'BG-' || (COALESCE((SELECT MAX(id) FROM business_growth_enquiries), 0) + 1001)`;

export async function growthSettings(env: Env): Promise<Settings> {
  try {
    const r = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`).bind(SETTINGS_KEY).first<{ value: string }>();
    const v = r?.value ? JSON.parse(r.value) as Partial<Settings> : {};
    const pick = (k: keyof Settings, lo: number, hi: number) => { const n = Number(v[k]); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : GROWTH_SETTINGS_DEFAULT[k]; };
    return { unclaimed_hours: pick("unclaimed_hours", 1, 168), remind_hours: pick("remind_hours", 1, 168), escalate_hours: pick("escalate_hours", 2, 336) };
  } catch { return { ...GROWTH_SETTINGS_DEFAULT }; }
}

/** may this person work Business Growth enquiries at all - the website Enquiries permission,
    never an agent or a customer */
export const growthViewer = (user: { role: string; custom_role?: string | null }) => !NEVER.includes(user.role) && canUser(user as StaffUser, "enquiry_manage");
/** a manager also reassigns, hands back somebody else's and sets the reminders */
const growthManager = (user: StaffUser) => growthViewer(user) && canUser(user, "exec_view");

/** The people who hold a capability right now (a custom role's cells included),
    business roles first - the technical accounts only when nobody else holds it. */
async function holders(env: Env, cap: "enquiry_manage" | "exec_view"): Promise<number[]> {
  let rows: { id: number; role: string; custom_role: string | null }[] = [];
  const staffOnly = `u.is_active = 1 AND u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`;
  try {
    rows = (await env.DB.prepare(
      `SELECT u.id, u.role, (SELECT c.key FROM custom_roles c WHERE c.id = u.custom_role_id AND c.active = 1 AND c.base_role = u.role) AS custom_role
         FROM users u WHERE ${staffOnly}`,
    ).all<{ id: number; role: string; custom_role: string | null }>()).results ?? [];
  } catch {
    rows = ((await env.DB.prepare(`SELECT u.id, u.role, NULL AS custom_role FROM users u WHERE u.is_active = 1 AND u.role NOT IN ('customer', 'agent') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0)`).all<{ id: number; role: string; custom_role: null }>()).results ?? []);
  }
  const ok = rows.filter((u) => growthViewer({ role: u.role, custom_role: u.custom_role }) && canUser({ role: u.role, custom_role: u.custom_role ?? undefined }, cap));
  const business = ok.filter((u) => !["admin", "super_admin"].includes(u.role));
  return (business.length ? business : ok).map((u) => u.id);
}

/** the bell (kind "enquiry" lands on Sales); `growth:<id>:...` opens the enquiry itself */
async function tell(env: Env, ids: number[], message: string, ref: string, skip?: number): Promise<number> {
  let n = 0;
  for (const id of ids) {
    if (id === skip) continue;
    try { if (await notify(env, id, "enquiry", message, ref, { once: true })) n++; } catch { /* a notice never blocks the record */ }
  }
  return n;
}

async function event(env: Env, enquiryId: number, actorId: number | null, e: { kind: string; body?: string | null; channel?: string | null; from?: string | null; to?: string | null }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO business_growth_events (enquiry_id, actor_id, kind, body, channel, status_from, status_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(enquiryId, actorId, e.kind, e.body ?? null, e.channel ?? null, e.from ?? null, e.to ?? null, now()).run();
}

/** +60 12-345 6789 -> +60123456789; null when it is not a mobile number */
export function normaliseWhatsApp(dialIn: unknown, raw: unknown): string | null {
  const dial = oneOf(DIAL, dialIn) ?? "+60";
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith(dial.slice(1)) && digits.length > 10) digits = digits.slice(dial.length - 1); // typed the country code again
  digits = digits.replace(/^0+/, "");
  return /^\d{7,12}$/.test(digits) ? `${dial}${digits}` : null;
}

/* =========================================================================
   PUBLIC: one enquiry, from the three steps
   ========================================================================= */
export async function submitBusinessGrowth(env: Env, request: Request, body: Record<string, unknown> | null, rateOk: boolean): Promise<Response> {
  if (!body) return err("invalid_input", "Send the form as JSON.", 400);
  const key = text(body.client_key, 80);
  if (!/^[A-Za-z0-9-]{16,80}$/.test(key)) return err("invalid_input", "This form needs to be reloaded - please open the link again.", 400);
  /* a retry of a submission that already landed answers with the same reference, before anything else -
     a new enquiry by its own key, an added one by the key kept on its "resubmitted" event */
  try {
    const again = await env.DB.prepare(
      `SELECT ref FROM business_growth_enquiries WHERE client_key = ?1
       UNION ALL SELECT g.ref FROM business_growth_events e JOIN business_growth_enquiries g ON g.id = e.enquiry_id WHERE e.kind = 'resubmitted' AND e.channel = ?2 LIMIT 1`,
    ).bind(key, `key:${key}`).first<{ ref: string }>();
    if (again) return json({ ok: true, ref: again.ref, existing: true });
  } catch (e) {
    if (missing(e)) return err("unavailable", "The Business Growth Check opens after the next update - please try again later.", 503);
    throw e;
  }
  if (!rateOk) return err("rate_limited", "Too many submissions from this connection - please try again later.", 429);

  const errors: Record<string, string> = {};
  /* ---- step 1: the person and the business ---- */
  const full_name = text(body.full_name, 120);
  if (full_name.length < 2) errors.full_name = "required";
  const whatsapp = normaliseWhatsApp(body.dial, body.phone);
  if (!whatsapp) errors.phone = "invalid";
  const email = text(body.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "invalid";
  const business_name = text(body.business_name, 160);
  if (business_name.length < 2) errors.business_name = "required";
  const industry = oneOf(GROWTH_INDUSTRIES, body.industry);
  if (!industry) errors.industry = "required";
  const industry_other = industry === "other" ? text(body.industry_other, 120) || null : null;
  const city = text(body.city, 80);
  if (city.length < 2) errors.city = "required";
  const state = oneOf(GROWTH_STATES, body.state);
  if (!state) errors.state = "required";
  const social_url = text(body.social_url, 300) || null;
  const source = oneOf(GROWTH_SOURCES, body.source);
  if (!source) errors.source = "required";
  const source_detail = source === "referral" || source === "other" ? text(body.source_detail, 200) || null : null;
  const utm = (k: string) => text((body.utm as Record<string, unknown> | undefined)?.[k], 120) || null;
  const referrer = text(body.referrer, 300) || null;
  const landing_path = text(body.landing_path, 300) || null;

  /* ---- step 2: the challenges and the goal ---- */
  const challenges = list(body.challenges, GROWTH_CHALLENGES);
  if (!challenges.length) errors.challenges = "required";
  if (challenges.length > 3) errors.challenges = "too_many";
  const challenge_other = challenges.includes("other") ? text(body.challenge_other, 200) || null : null;
  const urgent_problem = long(body.urgent_problem, 1500);
  if (urgent_problem.replace(/\s+/g, " ").length < 10) errors.urgent_problem = "too_short";
  const goal_90d = long(body.goal_90d, 1500);
  if (goal_90d.replace(/\s+/g, " ").length < 10) errors.goal_90d = "too_short";
  const platforms = list(body.platforms, GROWTH_PLATFORMS);
  if (!platforms.length) errors.platforms = "required";
  if (platforms.includes("none") && platforms.length > 1) errors.platforms = "invalid";
  const interests = list(body.interests, GROWTH_INTERESTS); // optional

  /* ---- step 3: how to reach them and the consents ---- */
  const contact_method = oneOf(["whatsapp", "call", "email"] as const, body.contact_method);
  if (!contact_method) errors.contact_method = "required";
  if (contact_method === "email" && !email) errors.email = "required_for_email";
  const contact_time = oneOf(GROWTH_TIMES, body.contact_time);
  if (!contact_time) errors.contact_time = "required";
  if (body.consent_contact !== true) errors.consent_contact = "required";
  if (body.consent_privacy !== true) errors.consent_privacy = "required";
  const marketing = body.consent_marketing === true ? 1 : 0;
  if (Object.keys(errors).length) return json({ error: { code: "invalid_input", message: "Some answers are missing or not valid.", fields: errors } }, 400);

  /* ---- Cloudflare's bot check, the same one every sign-in asks (security-status.ts) ---- */
  const bot = await botCheck(env, request, body.bot_token, "growth_check");
  if (!bot.ok) return err(bot.code, BOT_REFUSED_MESSAGE, 403);

  const at = now();
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = ip ? (await sha256(`growth:${ip}`)).slice(0, 32) : null;
  const agent = text(request.headers.get("User-Agent"), 200) || null;
  const lang = body.lang === "ms" ? "ms" : "en";
  const consentLine = `contact yes · privacy notice ${PRIVACY_VERSION} yes · marketing ${marketing ? "yes" : "no"} · ${at} UTC`;

  /* ---- the same WhatsApp while an enquiry is open: ADDED to that enquiry (the CEO's answer) ---- */
  const open = await env.DB.prepare(
    `SELECT id, ref, owner_id, full_name, business_name FROM business_growth_enquiries
      WHERE whatsapp = ?1 AND status IN (${OPEN.map((s) => `'${s}'`).join(", ")}) ORDER BY id DESC LIMIT 1`,
  ).bind(whatsapp).first<{ id: number; ref: string; owner_id: number | null; full_name: string; business_name: string }>();
  if (open) {
    const summary = [
      `Submitted again from /apply/business (${source})`,
      `Business: ${business_name}`,
      `Challenges: ${challenges.join(", ")}${challenge_other ? ` (${challenge_other})` : ""}`,
      `Most urgent: ${urgent_problem}`,
      `90-day goal: ${goal_90d}`,
      `Platforms: ${platforms.join(", ")}`,
      interests.length ? `Interested in: ${interests.join(", ")}` : "",
      `Contact: ${contact_method} · ${contact_time}`,
      `Consent: ${consentLine}`,
    ].filter(Boolean).join("\n");
    /* the event carries this browser's key, so a retry of THIS resubmission answers without adding again */
    await event(env, open.id, null, { kind: "resubmitted", body: summary, channel: `key:${key}` });
    await env.DB.prepare(
      `UPDATE business_growth_enquiries SET resubmissions = resubmissions + 1, last_submitted_at = ?1,
              consent_marketing = MAX(consent_marketing, ?2), version = version + 1, updated_at = ?1 WHERE id = ?3`,
    ).bind(at, marketing, open.id).run();
    await bumpVersion(env, "business-growth");
    const to = open.owner_id ? [open.owner_id] : await holders(env, "enquiry_manage");
    await tell(env, to, `Business Growth ${open.ref}: ${open.full_name} submitted the check again - the new answers are added to the enquiry`, `growth:${open.id}:again:${key.slice(0, 12)}`);
    return json({ ok: true, ref: open.ref, existing: true });
  }

  let ins: { id: number; ref: string } | null = null;
  for (let i = 0; i < 4 && !ins; i++) {
    try {
      ins = await env.DB.prepare(
        `INSERT INTO business_growth_enquiries (ref, client_key, full_name, whatsapp, email, business_name, industry, industry_other, city, state, social_url,
            source, source_detail, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer, landing_path,
            challenges, challenge_other, urgent_problem, goal_90d, platforms, interests, contact_method, contact_time,
            consent_contact, consent_privacy, consent_marketing, privacy_version, consent_at, consent_ip_hash, consent_agent, lang, last_submitted_at, created_at)
         VALUES (${NEXT_REF}, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27,
            1, 1, ?28, ?29, ?30, ?31, ?32, ?33, ?30, ?30)
         ON CONFLICT(client_key) DO NOTHING RETURNING id, ref`,
      ).bind(key, full_name, whatsapp, email || null, business_name, industry, industry_other, city, state, social_url,
        source, source_detail, utm("source"), utm("medium"), utm("campaign"), utm("term"), utm("content"), referrer, landing_path,
        JSON.stringify(challenges), challenge_other, urgent_problem, goal_90d, JSON.stringify(platforms), JSON.stringify(interests), contact_method, contact_time,
        marketing, PRIVACY_VERSION, at, ipHash, agent, lang).first<{ id: number; ref: string }>();
      if (!ins) {
        const again = await env.DB.prepare(`SELECT ref FROM business_growth_enquiries WHERE client_key = ?1`).bind(key).first<{ ref: string }>();
        if (again) return json({ ok: true, ref: again.ref, existing: true });
      }
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e; // a reference collision: draw again
    }
  }
  if (!ins) return err("unavailable", "The form could not be saved - please try again.", 503);
  await event(env, ins.id, null, { kind: "submitted", to: "new", body: `Submitted from /apply/business · source ${source}${utm("campaign") ? ` · campaign ${utm("campaign")}` : ""}\nConsent: ${consentLine}` });
  await bumpVersion(env, "business-growth");
  /* the website Enquiries people are told once (holders() never returns an agent or a customer),
     and the bell opens the enquiry itself */
  await tell(env, await holders(env, "enquiry_manage"), `New Business Growth Check ${ins.ref}: ${full_name}, ${business_name} - pick it up in Sales › Customers & Follow-ups`, `growth:${ins.id}:new`);
  return json({ ok: true, ref: ins.ref }, 201);
}

/* =========================================================================
   STAFF
   ========================================================================= */
interface Row {
  id: number; ref: string; full_name: string; whatsapp: string; email: string | null; business_name: string; industry: string; industry_other: string | null; city: string; state: string; social_url: string | null;
  source: string; source_detail: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_term: string | null; utm_content: string | null; referrer: string | null; landing_path: string | null;
  challenges: string; challenge_other: string | null; urgent_problem: string; goal_90d: string; platforms: string; interests: string; contact_method: string; contact_time: string;
  consent_contact: number; consent_privacy: number; consent_marketing: number; privacy_version: string; consent_at: string; lang: string | null;
  status: Status; owner_id: number | null; picked_at: string | null; first_response_at: string | null; contact_attempts: number; next_follow_up_on: string | null;
  problem_summary: string | null; advice_summary: string | null; advice_at: string | null; advice_by: number | null; outcome_reason: string | null; closed_at: string | null; closed_by: number | null;
  quotation_id: number | null; resubmissions: number; last_submitted_at: string | null; version: number; created_at: string; updated_at: string | null;
}

/** What THIS person may do to this enquiry now - the screen draws exactly these; every route re-checks. */
function actionsFor(a: Row, user: StaffUser, manager: boolean) {
  const mine = a.owner_id === user.id;
  const works = mine || manager;
  const open = a.status !== "not_interested";
  const reached = ["contacted", "problem_identified", "advice_delivered", "qualified", "follow_up"].includes(a.status);
  return {
    pickup: a.status === "new" && a.owner_id === null,
    release: works && a.owner_id !== null && WORKING.includes(a.status),
    assign: manager && open,
    contact: works && a.owner_id !== null && open,
    note: open,
    problem: works && reached && a.status !== "qualified",
    advice: works && ["problem_identified", "advice_delivered", "follow_up"].includes(a.status),
    outcome: works && reached,
    quotation: works && a.status === "qualified" && a.quotation_id === null,
    whatsapp: works && a.owner_id !== null,
  };
}

export async function handleGrowth(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response | null> {
  if (path !== "/business-growth" && !path.startsWith("/business-growth/")) return null;
  /* AGENTS AND CUSTOMERS ARE NOT STAFF: refused by role before any read */
  if (NEVER.includes(user.role)) return err("forbidden", "Business Growth enquiries are for A2Z staff only", 403);
  if (!growthViewer(user)) return err("forbidden", "Business Growth enquiries are for the people who answer website enquiries", 403);
  const manager = growthManager(user);
  try {
    if (path === "/business-growth/settings") {
      if (method === "GET") return json({ settings: await growthSettings(env), can_edit: manager });
      if (method === "PUT") {
        if (!manager) return err("forbidden", "Management sets the reminders", 403);
        const reason = text(body?.reason, 300);
        if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters).", 400);
        const cur = await growthSettings(env);
        const n = (k: keyof Settings, lo: number, hi: number) => { const v = Number(body?.[k]); return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null; };
        const next = { unclaimed_hours: n("unclaimed_hours", 1, 168), remind_hours: n("remind_hours", 1, 168), escalate_hours: n("escalate_hours", 2, 336) };
        if (Object.values(next).some((v) => v === null)) return err("invalid_input", "Hours: unclaimed and reminder 1-168, escalation 2-336.", 400);
        if (next.escalate_hours! <= next.remind_hours!) return err("invalid_input", "Escalation comes after the reminder.", 400);
        await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`).bind(SETTINGS_KEY, JSON.stringify(next)).run();
        await audit(env, user.id, "growth.settings", "system_meta", SETTINGS_KEY, { from: cur, to: next, reason });
        return json({ ok: true, settings: next });
      }
    }

    if (path === "/business-growth" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT g.id, g.ref, g.full_name, g.whatsapp, g.email, g.business_name, g.industry, g.city, g.state, g.source, g.utm_campaign, g.challenges, g.interests,
                g.contact_method, g.contact_time, g.status, g.owner_id, g.picked_at, g.first_response_at, g.contact_attempts, g.next_follow_up_on, g.advice_at,
                g.quotation_id, g.resubmissions, g.version, g.created_at, g.updated_at, g.closed_at, ${PERSON("o")} AS owner_name,
                (SELECT 1 FROM quotation_acceptances qa WHERE qa.doc_id = g.quotation_id LIMIT 1) AS accepted,
                (SELECT i.total_cents FROM sales_documents i WHERE i.converted_from = g.quotation_id AND i.doc_type = 'INV' AND i.voided_at IS NULL
                    AND EXISTS (SELECT 1 FROM invoice_paid_confirmations c WHERE c.invoice_id = i.id AND c.revoked_at IS NULL) LIMIT 1) AS verified_cents
           FROM business_growth_enquiries g LEFT JOIN users o ON o.id = g.owner_id ORDER BY g.id DESC LIMIT 1000`,
      ).all<Record<string, unknown>>();
      const today = mytToday();
      const s = await growthSettings(env);
      const rows = (results ?? []).map((r) => {
        const st = r.status as Status;
        const overdue = OPEN.includes(st) && ((!!r.next_follow_up_on && String(r.next_follow_up_on) < today)
          || (st === "new" && hoursSince(String(r.created_at)) > s.unclaimed_hours)
          || (st === "assigned" && !r.first_response_at && hoursSince(String(r.picked_at ?? r.created_at)) > s.remind_hours));
        return { ...r, challenges: parse(r.challenges), interests: parse(r.interests), accepted: !!r.accepted, verified: r.verified_cents != null, overdue } as Record<string, unknown>;
      });
      const counts: Record<string, number> = {};
      for (const r of rows) counts[String(r.status)] = (counts[String(r.status)] ?? 0) + 1;
      return json({ enquiries: rows, counts, analytics: analytics(rows), me: user.id, can_manage: manager, settings: s });
    }

    const m = path.match(/^\/business-growth\/(\d+)(?:\/(pickup|release|assign|contact|note|problem|advice|outcome|quotation))?$/);
    if (!m) return err("not_found", "Unknown Business Growth route", 404);
    const id = Number(m[1]);
    const a = await env.DB.prepare(`SELECT * FROM business_growth_enquiries WHERE id = ?1`).bind(id).first<Row>();
    if (!a) return err("not_found", "Enquiry not found", 404);
    const action = m[2] ?? "";
    const can = actionsFor(a, user, manager);

    if (!action && method === "GET") {
      const ev = (await env.DB.prepare(
        `SELECT e.id, e.kind, e.body, CASE WHEN e.channel LIKE 'key:%' THEN NULL ELSE e.channel END AS channel, e.status_from, e.status_to, e.created_at, ${PERSON("u")} AS actor
           FROM business_growth_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.enquiry_id = ?1 ORDER BY e.id ASC`,
      ).bind(id).all()).results ?? [];
      const name = async (uid: number | null | undefined) => (uid ? (await env.DB.prepare(`SELECT ${PERSON("u")} AS n FROM users u WHERE u.id = ?1`).bind(uid).first<{ n: string }>())?.n ?? null : null);
      /* the quotation a paid solution went through, read from Sales - never written here */
      let quotation: Record<string, unknown> | null = null;
      if (a.quotation_id) {
        quotation = await env.DB.prepare(
          `SELECT q.id, q.doc_number, q.total_cents, q.created_at,
                  (SELECT 1 FROM quotation_acceptances qa WHERE qa.doc_id = q.id LIMIT 1) AS accepted,
                  (SELECT i.doc_number FROM sales_documents i WHERE i.converted_from = q.id AND i.doc_type = 'INV' AND i.voided_at IS NULL LIMIT 1) AS invoice_number,
                  (SELECT 1 FROM sales_documents i WHERE i.converted_from = q.id AND i.doc_type = 'INV' AND i.voided_at IS NULL
                      AND EXISTS (SELECT 1 FROM invoice_paid_confirmations c WHERE c.invoice_id = i.id AND c.revoked_at IS NULL) LIMIT 1) AS verified
             FROM sales_documents q WHERE q.id = ?1`,
        ).bind(a.quotation_id).first<Record<string, unknown>>();
      }
      /* quotations that name this enquiry in their reference (the Sales prefill writes it) - offered to link */
      const candidates = a.quotation_id ? [] : (await env.DB.prepare(
        `SELECT id, doc_number, total_cents, created_at FROM sales_documents WHERE doc_type = 'QT' AND reference = ?1 ORDER BY id DESC LIMIT 5`,
      ).bind(a.ref).all()).results ?? [];
      /* the people a manager may hand it to - the website Enquiries people */
      const people = manager ? await Promise.all((await holders(env, "enquiry_manage")).map(async (pid) => ({ id: pid, name: (await name(pid)) ?? `#${pid}` }))) : [];
      return json({
        enquiry: { ...a, challenges: parse(a.challenges), platforms: parse(a.platforms), interests: parse(a.interests),
          owner_name: await name(a.owner_id), advice_by_name: await name(a.advice_by), closed_by_name: await name(a.closed_by) },
        events: ev, quotation, candidates, people, staff_name: user.name, can,
      });
    }
    if (method !== "POST") return err("not_found", "Unknown Business Growth route", 404);
    const version = Number(body?.version);
    const stale = () => err("stale", "Somebody else changed this enquiry first - it has been reloaded.", 409);
    /* one conditional UPDATE per move: the version AND the status it was read in */
    const move = async (to: Status, set: string, binds: unknown[], from: readonly Status[], extra = ""): Promise<boolean> => {
      const r = await env.DB.prepare(
        `UPDATE business_growth_enquiries SET status = ?1, version = version + 1, updated_at = ?2${set ? `, ${set}` : ""}
          WHERE id = ?3 AND version = ?4 AND status IN (${from.map((x) => `'${x}'`).join(", ")})${extra} RETURNING id`,
      ).bind(to, now(), id, version, ...binds).first();
      return !!r;
    };
    const done = async (kind: string, detail: Record<string, unknown>) => {
      await audit(env, user.id, `growth.${kind}`, "business_growth_enquiries", String(id), { ref: a.ref, ...detail });
      await bumpVersion(env, "business-growth");
      return json({ ok: true });
    };

    /* ---- claim: one person, once (the conditional UPDATE is the lock) ---- */
    if (action === "pickup") {
      if (!can.pickup) return a.owner_id ? err("already_claimed", "Somebody else already picked this enquiry up.", 409) : err("forbidden", "Not yours to pick up", 403);
      const r = await env.DB.prepare(
        `UPDATE business_growth_enquiries SET status = 'assigned', owner_id = ?1, picked_at = ?2, version = version + 1, updated_at = ?2
          WHERE id = ?3 AND status = 'new' AND owner_id IS NULL RETURNING version`,
      ).bind(user.id, now(), id).first<{ version: number }>();
      if (!r) return err("already_claimed", "Somebody else already picked this enquiry up.", 409);
      await event(env, id, user.id, { kind: "picked_up", from: "new", to: "assigned", body: "Picked up" });
      await audit(env, user.id, "growth.pickup", "business_growth_enquiries", String(id), { ref: a.ref });
      await bumpVersion(env, "business-growth");
      return json({ ok: true, version: r.version });
    }
    if (action === "release") {
      if (!can.release) return err("forbidden", "Only the owner or management hands an enquiry back", 403);
      const reason = text(body?.reason, 300);
      if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters).", 400);
      if (!(await move("new", "owner_id = NULL, picked_at = NULL", [], WORKING))) return stale();
      await event(env, id, user.id, { kind: "released", from: a.status, to: "new", body: reason });
      return done("release", { reason, owner: a.owner_id });
    }
    if (action === "assign") {
      if (!can.assign) return err("forbidden", "Management gives an enquiry to someone", 403);
      const to = Number(body?.owner_id);
      const reason = text(body?.reason, 300);
      if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters).", 400);
      if (!(await holders(env, "enquiry_manage")).includes(to)) return err("invalid_input", "Choose someone who answers website enquiries.", 400);
      if (to === a.owner_id) return err("invalid_input", "It is already theirs.", 400);
      const next: Status = a.status === "new" ? "assigned" : a.status;
      if (!(await move(next, "owner_id = ?5, picked_at = COALESCE(picked_at, ?6)", [to, now()], OPEN))) return stale();
      await event(env, id, user.id, { kind: "assigned", from: a.status, to: next, body: reason });
      await tell(env, [to], `Business Growth ${a.ref} (${a.business_name}) is now yours - ${reason}`, `growth:${id}:assigned:${version}`, user.id);
      return done("assign", { from_owner: a.owner_id, to_owner: to, reason });
    }
    if (action === "contact") {
      if (!can.contact) return err("forbidden", "Pick the enquiry up first - the owner records the contact", 403);
      const channel = oneOf(["whatsapp", "call", "email", "other"] as const, body?.channel);
      const reached = body?.reached === true;
      const note = long(body?.note, 1000);
      if (!channel) return err("invalid_input", "Say how you contacted them.", 400);
      if (note.length < 3) return err("invalid_input", "Write what happened (a few words).", 400);
      const follow = validDay(body?.next_follow_up_on) ? String(body!.next_follow_up_on) : null;
      if (follow && follow < mytToday()) return err("invalid_input", "The next follow-up is today or later.", 400);
      const to: Status = reached && a.status === "assigned" ? "contacted" : a.status;
      if (!(await move(to, "first_response_at = COALESCE(first_response_at, ?5), contact_attempts = contact_attempts + 1, next_follow_up_on = COALESCE(?6, next_follow_up_on)",
        [now(), follow], OPEN.filter((s) => s !== "new")))) return stale();
      await event(env, id, user.id, { kind: reached ? "contacted" : "attempt", channel, body: `${reached ? "Reached" : "Not reached"} - ${note}${follow ? `\nNext follow-up ${follow}` : ""}`, from: a.status, to });
      return done("contact", { channel, reached, attempt: a.contact_attempts + 1, first: !a.first_response_at });
    }
    if (action === "note") {
      if (!can.note) return err("forbidden", "This enquiry is closed", 403);
      const note = long(body?.note, 2000);
      const follow = body?.next_follow_up_on === null ? null : validDay(body?.next_follow_up_on) ? String(body!.next_follow_up_on) : undefined;
      if (note.length < 3 && follow === undefined) return err("invalid_input", "Write a note or set the next follow-up.", 400);
      if (follow && follow < mytToday()) return err("invalid_input", "The next follow-up is today or later.", 400);
      if (follow !== undefined && !(a.owner_id === user.id || manager)) return err("forbidden", "The owner sets the next follow-up", 403);
      if (follow !== undefined && !(await move(a.status, "next_follow_up_on = ?5", [follow], [a.status]))) return stale();
      if (note.length >= 3) await event(env, id, user.id, { kind: "note", body: note });
      if (follow !== undefined) await event(env, id, user.id, { kind: "follow_up", body: follow ? `Next follow-up ${follow}` : "Follow-up cleared" });
      return done("note", { note: note.length >= 3, follow: follow ?? null });
    }
    if (action === "problem") {
      if (!can.problem) return err("forbidden", "Contact the entrepreneur first - the owner records the problem", 403);
      const summary = long(body?.summary, 2000);
      if (summary.length < 10) return err("invalid_input", "Describe the problem you identified (at least 10 characters).", 400);
      const to: Status = a.status === "contacted" ? "problem_identified" : a.status;
      if (!(await move(to, "problem_summary = ?5", [summary], ["contacted", "problem_identified", "advice_delivered", "follow_up"]))) return stale();
      await event(env, id, user.id, { kind: "problem", body: summary, from: a.status, to });
      return done("problem", { from: a.status, to });
    }
    if (action === "advice") {
      if (!can.advice) return err("forbidden", "Record the problem first - then the free advice", 403);
      const summary = long(body?.summary, 3000);
      if (summary.length < 10) return err("invalid_input", "Write the free advice you gave (at least 10 characters).", 400);
      const to: Status = a.status === "follow_up" ? "follow_up" : "advice_delivered";
      if (!(await move(to, "advice_summary = ?5, advice_at = COALESCE(advice_at, ?6), advice_by = COALESCE(advice_by, ?7)", [summary, now(), user.id], ["problem_identified", "advice_delivered", "follow_up"]))) return stale();
      await event(env, id, user.id, { kind: "advice", body: summary, from: a.status, to });
      return done("advice", { from: a.status, to, first: !a.advice_at });
    }
    if (action === "outcome") {
      if (!can.outcome) return err("forbidden", "Only the owner or management records the outcome, after a contact", 403);
      const outcome = oneOf(["qualified", "follow_up", "not_interested"] as const, body?.outcome);
      const reason = long(body?.reason, 1000);
      if (!outcome) return err("invalid_input", "Qualified, Follow-Up or Not Interested.", 400);
      if (reason.length < 5) return err("reason_required", "Give the reason (at least 5 characters) - it is kept with the enquiry.", 400);
      const follow = validDay(body?.next_follow_up_on) ? String(body!.next_follow_up_on) : null;
      if (outcome === "follow_up" && !follow) return err("invalid_input", "A follow-up needs its date.", 400);
      if (follow && follow < mytToday()) return err("invalid_input", "The next follow-up is today or later.", 400);
      if (outcome === a.status && outcome !== "follow_up") return err("invalid_input", "That is already the outcome.", 400);
      const closing = outcome === "not_interested";
      const ok = await move(outcome, "outcome_reason = ?5, next_follow_up_on = ?6, closed_at = ?7, closed_by = ?8",
        [reason, outcome === "follow_up" ? follow : null, closing ? now() : null, closing ? user.id : null], ["contacted", "problem_identified", "advice_delivered", "qualified", "follow_up"]);
      if (!ok) return stale();
      await event(env, id, user.id, { kind: outcome, body: `${reason}${follow && outcome === "follow_up" ? `\nNext follow-up ${follow}` : ""}`, from: a.status, to: outcome });
      return done("outcome", { from: a.status, to: outcome, reason });
    }
    if (action === "quotation") {
      if (!can.quotation) return err("forbidden", a.quotation_id ? "A quotation is already linked." : "Only a qualified enquiry is linked to a quotation, by its owner or management", 403);
      const qid = Number(body?.quotation_id);
      const q = await env.DB.prepare(`SELECT id, doc_number, doc_type, voided_at FROM sales_documents WHERE id = ?1`).bind(qid).first<{ id: number; doc_number: string; doc_type: string; voided_at: string | null }>();
      if (!q || q.doc_type !== "QT") return err("invalid_input", "Choose a quotation.", 400);
      if (q.voided_at) return err("invalid_input", "That quotation is void.", 400);
      const taken = await env.DB.prepare(`SELECT ref FROM business_growth_enquiries WHERE quotation_id = ?1 AND id != ?2`).bind(qid, id).first<{ ref: string }>();
      if (taken) return err("quotation_linked", `That quotation is already linked to ${taken.ref}.`, 409);
      if (!(await move("qualified", "quotation_id = ?5", [qid], ["qualified"], " AND quotation_id IS NULL"))) return stale();
      await event(env, id, user.id, { kind: "quotation", body: `Quotation ${q.doc_number} linked - acceptance, invoice and payment follow the normal Sales process` });
      return done("quotation", { quotation_id: qid, doc_number: q.doc_number });
    }
    return err("not_found", "Unknown Business Growth route", 404);
  } catch (e) {
    if (missing(e)) return json({ enquiries: [], counts: {}, pending_migration: true, error: { code: "pending_migration", message: "Business Growth enquiries arrive with the next database update." } }, 200);
    throw e;
  }
}

/** The figures the CEO asked for, counted from the rows themselves - never estimated.
    Response time is the hours from submission to the FIRST recorded contact attempt. */
function analytics(rows: Record<string, unknown>[]) {
  const by = (k: string) => { const o: Record<string, number> = {}; for (const r of rows) { const v = String(r[k] ?? ""); if (v) o[v] = (o[v] ?? 0) + 1; } return o; };
  const challenges: Record<string, number> = {};
  for (const r of rows) for (const c of (r.challenges as string[]) ?? []) challenges[c] = (challenges[c] ?? 0) + 1;
  const hours = rows.filter((r) => r.first_response_at).map((r) => (Date.parse(`${String(r.first_response_at).replace(" ", "T")}Z`) - Date.parse(`${String(r.created_at).replace(" ", "T")}Z`)) / 3600_000).filter((h) => Number.isFinite(h) && h >= 0).sort((x, y) => x - y);
  const median = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2]! : (hours[hours.length / 2 - 1]! + hours[hours.length / 2]!) / 2) : null;
  return {
    total: rows.length,
    sources: by("source"),
    challenges,
    responded: hours.length,
    response_median_hours: median === null ? null : Math.round(median * 10) / 10,
    response_avg_hours: hours.length ? Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10 : null,
    assessments: rows.filter((r) => r.advice_at).length,
    qualified: rows.filter((r) => r.status === "qualified").length,
    quotations: rows.filter((r) => r.quotation_id).length,
    accepted: rows.filter((r) => r.accepted).length,
    verified: rows.filter((r) => r.verified).length,
    verified_cents: rows.reduce((s, r) => s + (r.verified_cents == null ? 0 : Number(r.verified_cents)), 0),
  };
}

/* =========================================================================
   The hourly pass (index.ts scheduled, beside the partner sweep):
   reminders to the owner, escalation to management - once a day each, by ref
   ========================================================================= */
export async function growthSweep(env: Env): Promise<{ reminded: number; escalated: number }> {
  let rows: Row[] = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT * FROM business_growth_enquiries WHERE status IN ('new', 'assigned', 'contacted', 'problem_identified', 'advice_delivered', 'follow_up') ORDER BY id LIMIT 500`,
    ).all<Row>()).results ?? [];
  } catch (e) { if (missing(e)) return { reminded: 0, escalated: 0 }; throw e; }
  if (!rows.length) return { reminded: 0, escalated: 0 };
  const s = await growthSettings(env);
  const today = mytToday();
  let viewers: number[] | null = null, managers: number[] | null = null;
  const all = async () => (viewers ??= await holders(env, "enquiry_manage"));
  const mgr = async () => (managers ??= await holders(env, "exec_view"));
  let reminded = 0, escalated = 0;
  for (const a of rows) {
    if (a.status === "new") {
      const h = hoursSince(a.created_at);
      if (h > s.unclaimed_hours) reminded += await tell(env, await all(), `Business Growth ${a.ref} (${a.business_name}) has not been picked up for ${Math.floor(h)} hours`, `growth:${a.id}:unclaimed:${today}`);
      if (h > s.escalate_hours) escalated += await tell(env, await mgr(), `Business Growth ${a.ref} is still not picked up - ${Math.floor(h)} hours`, `growth:${a.id}:escalate:${today}`);
      continue;
    }
    /* owned: no contact yet, or the follow-up date passed */
    const waiting = !a.first_response_at ? hoursSince(a.picked_at ?? a.created_at) : a.next_follow_up_on && a.next_follow_up_on < today ? hoursSince(`${a.next_follow_up_on} 00:00:00`) : 0;
    if (!waiting || !a.owner_id) continue;
    if (waiting > s.remind_hours) reminded += await tell(env, [a.owner_id], `Business Growth ${a.ref} (${a.business_name}): ${a.first_response_at ? "the follow-up is overdue" : "contact the entrepreneur"}`, `growth:${a.id}:remind:${today}`);
    if (waiting > s.escalate_hours) escalated += await tell(env, await mgr(), `Business Growth ${a.ref} is overdue with its owner - ${Math.floor(waiting)} hours`, `growth:${a.id}:escalate:${today}`, a.owner_id);
  }
  return { reminded, escalated };
}
