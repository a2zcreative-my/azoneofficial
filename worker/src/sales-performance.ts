/**
 * SALES PERFORMANCE - the command centre behind the one tab. v1.155.0.
 *
 * The CEO, 11-09-2026: *"I need a system where I can confidently answer:
 * 'Did this staff member actually work on sales today?' without relying only
 * on what they claim."* One sidebar tab, one page, and this module behind it.
 *
 * THE HIERARCHY, enforced HERE and not in the browser:
 *   system-derived data  >  verified evidence  >  staff-reported data
 *
 *   - Revenue and orders come from sales_documents (INV) by salesperson. No
 *     route on this file accepts a revenue figure from a form.
 *   - Shipments come from postage_records; a shipment linked here must name
 *     an invoice, and a shipped/in-transit/delivered status without a
 *     tracking number is refused (staff.ts, the postage PATCH, same rule).
 *   - A social post needs a valid https URL on a recognised platform that
 *     matches the platform chosen, a screenshot, a post date; its identity is
 *     normalised so the same post cannot be entered twice in two spellings;
 *     a post older than its submission day is flagged old_post; an account
 *     the URL does not name, or names but is not on the approved list, is
 *     manual_review. It is PENDING until a manager who is not its author
 *     verifies it. Only VERIFIED posts count.
 *   - Engagements are what the staff member SAYS happened. They are
 *     "reported" until a manager verifies them, or until they link to a real
 *     invoice - the link is what turns a conversation into a conversion, and
 *     the invoice's total is the only revenue it may claim.
 *   - The productivity score is computed here from the above, per person,
 *     per range. Nothing on any form writes it.
 *
 * IMMUTABILITY. A verified record cannot be changed or deleted by its author.
 * A manager may correct it, with a reason, and the audit row carries the
 * previous and the new value of every field that moved.
 *
 * PERMISSIONS (permissions.ts): sales_perf_view - see and enter your OWN
 * work; sales_perf_manage - see everyone, verify, correct, configure targets
 * and approved accounts, read audit history. A manager can never verify a
 * record they authored.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { STAFF_ORDER_SQL, currentStaffSql } from "./staff";
import { json, err, audit, str } from "./shared";
import { can } from "./permissions";
import {
  readSocialUrl, normalizeHandle, customerKey, spScore, spBand, ratio, spBusyVsProductive,
  SP_PLATFORMS, SP_CHANNELS, SP_INTERACTIONS, SP_INQUIRY_TYPES, SP_PROMO_TYPES, SP_TRACKING_REQUIRED, SP_POST_STATUSES,
  type SpComponent,
} from "./sp-rules";

/* ── time ──────────────────────────────────────────────────────────────── */
const mytNow = () => new Date(Date.now() + 8 * 3600 * 1000);
const mytToday = () => mytNow().toISOString().slice(0, 10);
const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
/** "YYYY-MM-DD HH:MM" typed in MYT -> the UTC stamp the DB stores */
const mytToUtc = (local: string): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) - 8 * 3600 * 1000;
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 19).replace("T", " ");
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/* ── settings (system_meta, one JSON key) ──────────────────────────────── */
const SETTINGS_KEY = "sp_settings";
export interface SpSettings {
  /** RM per staff per day, in sen; a person without their own entry uses default_target_cents */
  default_target_cents: number | null;
  targets: Record<string, number>;
  /** the day's benchmarks the score components are measured against */
  engagement_target: number;
  posts_target: number;
  activity_target: number;
}
const DEFAULT_SETTINGS: SpSettings = { default_target_cents: null, targets: {}, engagement_target: 10, posts_target: 3, activity_target: 12 };
async function readSettings(env: Env): Promise<SpSettings> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`).bind(SETTINGS_KEY).first<{ value: string }>();
    if (!row) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(row.value) as Partial<SpSettings>;
    return {
      default_target_cents: typeof v.default_target_cents === "number" ? v.default_target_cents : null,
      targets: v.targets && typeof v.targets === "object" ? v.targets : {},
      engagement_target: typeof v.engagement_target === "number" && v.engagement_target > 0 ? v.engagement_target : DEFAULT_SETTINGS.engagement_target,
      posts_target: typeof v.posts_target === "number" && v.posts_target > 0 ? v.posts_target : DEFAULT_SETTINGS.posts_target,
      activity_target: typeof v.activity_target === "number" && v.activity_target > 0 ? v.activity_target : DEFAULT_SETTINGS.activity_target,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
const targetFor = (s: SpSettings, userId: number): number | null => {
  const own = s.targets[String(userId)];
  return typeof own === "number" && own > 0 ? own : s.default_target_cents;
};

/* ── who ───────────────────────────────────────────────────────────────── */
interface Person { id: number; name: string; role: string }
async function salesStaff(env: Env): Promise<Person[]> {
  /* the roles that can see the tab - permissions.ts sales_perf_view; the
     operators (super_admin/admin) are not measured */
  const { results } = await env.DB.prepare(
    `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role FROM users u
     WHERE u.is_active = 1 AND ${currentStaffSql("u.")} AND u.role IN ('ceo','coo','cco','sales_marketing','marketing','live_host','editor')
     ORDER BY ${STAFF_ORDER_SQL}`,
  ).all<Person>();
  return results ?? [];
}

/* ── the figures, per person, for a range ─────────────────────────────── */
export interface Figures {
  sales_cents: number; paid_cents: number; orders: number; orders_completed: number; orders_pending: number;
  interactions: number; unique_customers: number; inquiries: number; follow_ups_done: number; follow_ups_overdue: number; follow_ups_due: number;
  conversions: number; conversion_rate: number;
  posts_verified: number; posts_reported: number; posts_flagged: number; reach: number; social_engagement: number; leads: number;
  shipments: number; shipped: number; tracking_updated: number; delivered: number; shipments_pending: number; tracking_required: number;
  promotions_active: number; promotions_executed: number;
  other_activities: number; activities_total: number; verified_activities: number;
  present: boolean;
  target_cents: number | null;
}
const zero = (): Figures => ({
  sales_cents: 0, paid_cents: 0, orders: 0, orders_completed: 0, orders_pending: 0,
  interactions: 0, unique_customers: 0, inquiries: 0, follow_ups_done: 0, follow_ups_overdue: 0, follow_ups_due: 0,
  conversions: 0, conversion_rate: 0,
  posts_verified: 0, posts_reported: 0, posts_flagged: 0, reach: 0, social_engagement: 0, leads: 0,
  shipments: 0, shipped: 0, tracking_updated: 0, delivered: 0, shipments_pending: 0, tracking_required: 0,
  promotions_active: 0, promotions_executed: 0,
  other_activities: 0, activities_total: 0, verified_activities: 0,
  present: false, target_cents: null,
});

const MYT = (col: string) => `date(${col}, '+8 hours')`;

/** Every person's figures in one pass of grouped queries - never per row. */
async function figuresFor(env: Env, ids: number[], from: string, to: string, settings: SpSettings): Promise<Map<number, Figures>> {
  const out = new Map<number, Figures>();
  for (const id of ids) { const f = zero(); f.target_cents = targetFor(settings, id); out.set(id, f); }
  if (ids.length === 0) return out;
  const inIds = ids.join(",");
  const g = (id: number) => out.get(id)!;
  const q = async <T>(sql: string, ...binds: unknown[]) => {
    try { return ((await env.DB.prepare(sql).bind(...binds).all<T>()).results ?? []) as T[]; }
    catch (e) { if (String(e).includes("no such")) return [] as T[]; throw e; }
  };

  /* orders = invoices by salesperson, raised in the range */
  for (const r of await q<{ uid: number; n: number; cents: number; paid: number; done: number }>(
    `SELECT d.salesperson_id AS uid, COUNT(*) AS n, COALESCE(SUM(d.total_cents), 0) AS cents,
            COALESCE(SUM(CASE WHEN d.payment_status = 'paid' THEN d.total_cents ELSE 0 END), 0) AS paid,
            COALESCE(SUM(CASE WHEN d.payment_status = 'paid' AND (COALESCE(d.kind, 'product') = 'service' OR COALESCE(d.delivery_status, '') = 'delivered'
                   OR EXISTS (SELECT 1 FROM postage_records p WHERE p.order_ref = d.doc_number AND p.status = 'delivered')) THEN 1 ELSE 0 END), 0) AS done
       FROM sales_documents d
      WHERE d.doc_type = 'INV' AND d.salesperson_id IN (${inIds}) AND ${MYT("d.created_at")} BETWEEN ?1 AND ?2
      GROUP BY d.salesperson_id`, from, to)) {
    const f = g(r.uid); if (!f) continue;
    f.sales_cents = r.cents; f.paid_cents = r.paid; f.orders = r.n; f.orders_completed = r.done; f.orders_pending = r.n - r.done;
  }
  /* engagements */
  for (const r of await q<{ uid: number; n: number; uniq: number; inq: number; conv: number; verified: number }>(
    `SELECT user_id AS uid, COUNT(*) AS n, COUNT(DISTINCT customer_key) AS uniq,
            SUM(CASE WHEN interaction_type IN ('new_inquiry','product_question','price_inquiry') THEN 1 ELSE 0 END) AS inq,
            COUNT(DISTINCT order_doc_id) AS conv,
            SUM(CASE WHEN status = 'verified' OR order_doc_id IS NOT NULL THEN 1 ELSE 0 END) AS verified
       FROM sp_engagements WHERE deleted_at IS NULL AND user_id IN (${inIds}) AND ${MYT("happened_at")} BETWEEN ?1 AND ?2
      GROUP BY user_id`, from, to)) {
    const f = g(r.uid); if (!f) continue;
    f.interactions = r.n; f.unique_customers = r.uniq; f.inquiries = r.inq; f.conversions = r.conv; f.leads = r.inq;
    f.conversion_rate = r.inq > 0 ? Math.round((r.conv / r.inq) * 1000) / 10 : 0;
    f.verified_activities += r.verified;
  }
  /* follow-ups: done in range (outcome recorded), overdue (due on or before `to`, no outcome), due in range */
  for (const r of await q<{ uid: number; done: number; overdue: number; due: number }>(
    `SELECT user_id AS uid,
            SUM(CASE WHEN outcome_at IS NOT NULL AND ${MYT("outcome_at")} BETWEEN ?1 AND ?2 THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN follow_up_on IS NOT NULL AND follow_up_on <= ?2 AND outcome_at IS NULL THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN follow_up_on BETWEEN ?1 AND ?2 THEN 1 ELSE 0 END) AS due
       FROM sp_engagements WHERE deleted_at IS NULL AND user_id IN (${inIds})
      GROUP BY user_id`, from, to)) {
    const f = g(r.uid); if (!f) continue;
    f.follow_ups_done = r.done; f.follow_ups_overdue = r.overdue; f.follow_ups_due = r.due;
  }
  /* social posts - by submission day */
  for (const r of await q<{ uid: number; verified: number; reported: number; flagged: number; reach: number; eng: number }>(
    `SELECT user_id AS uid,
            SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS reported,
            SUM(CASE WHEN status NOT IN ('pending','verified') THEN 1 ELSE 0 END) AS flagged,
            COALESCE(SUM(CASE WHEN status = 'verified' AND metrics_status = 'verified' THEN COALESCE(views, 0) ELSE 0 END), 0) AS reach,
            COALESCE(SUM(CASE WHEN status = 'verified' AND metrics_status = 'verified' THEN COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0)+COALESCE(saves,0) ELSE 0 END), 0) AS eng
       FROM sp_social_posts WHERE deleted_at IS NULL AND user_id IN (${inIds}) AND ${MYT("submitted_at")} BETWEEN ?1 AND ?2
      GROUP BY user_id`, from, to)) {
    const f = g(r.uid); if (!f) continue;
    f.posts_verified = r.verified; f.posts_reported = r.reported; f.posts_flagged = r.flagged; f.reach = r.reach; f.social_engagement = r.eng;
    f.verified_activities += r.verified;
  }
  /* shipments - postage rows this person last touched in the range */
  for (const r of await q<{ uid: number; n: number; shipped: number; tracked: number; delivered: number; pending: number; need: number }>(
    `SELECT updated_by AS uid, COUNT(*) AS n,
            SUM(CASE WHEN status IN ('shipped','in_transit','delivered') THEN 1 ELSE 0 END) AS shipped,
            SUM(CASE WHEN tracking_no IS NOT NULL AND tracking_no != '' THEN 1 ELSE 0 END) AS tracked,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status IN ('shipped','in_transit','delivered') AND (tracking_no IS NULL OR tracking_no = '') THEN 1 ELSE 0 END) AS need
       FROM postage_records WHERE updated_by IN (${inIds}) AND ${MYT("updated_at")} BETWEEN ?1 AND ?2
      GROUP BY updated_by`, from, to)) {
    const f = g(r.uid); if (!f) continue;
    f.shipments = r.n; f.shipped = r.shipped; f.tracking_updated = r.tracked; f.delivered = r.delivered; f.shipments_pending = r.pending; f.tracking_required = r.need;
  }
  /* promotions active in the range; executed = a verified post or a linked invoice */
  for (const r of await q<{ uid: number; n: number; done: number }>(
    `SELECT p.user_id AS uid, COUNT(*) AS n,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM sp_social_posts s WHERE s.promotion_id = p.id AND s.status = 'verified' AND s.deleted_at IS NULL)
                       OR EXISTS (SELECT 1 FROM sp_engagements e WHERE e.promotion_id = p.id AND e.order_doc_id IS NOT NULL AND e.deleted_at IS NULL) THEN 1 ELSE 0 END) AS done
       FROM sp_promotions p WHERE p.deleted_at IS NULL AND p.user_id IN (${inIds}) AND p.start_on <= ?2 AND COALESCE(p.end_on, p.start_on) >= ?1
      GROUP BY p.user_id`, from, to)) {
    const f = g(r.uid); if (!f) continue;
    f.promotions_active = r.n; f.promotions_executed = r.done;
  }
  /* other activities (reported) */
  for (const r of await q<{ uid: number; n: number; v: number }>(
    `SELECT user_id AS uid, COUNT(*) AS n, SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS v FROM sp_other_activities
      WHERE deleted_at IS NULL AND user_id IN (${inIds}) AND ${MYT("happened_at")} BETWEEN ?1 AND ?2 GROUP BY user_id`, from, to)) {
    const f = g(r.uid); if (!f) continue;
    f.other_activities = r.n; f.verified_activities += r.v;
  }
  /* present = clocked in on any day of the range */
  for (const r of await q<{ uid: number }>(
    `SELECT DISTINCT user_id AS uid FROM attendance_records WHERE user_id IN (${inIds}) AND type = 'clock_in' AND ${MYT("created_at")} BETWEEN ?1 AND ?2`, from, to)) {
    const f = g(r.uid); if (f) f.present = true;
  }
  for (const f of out.values()) {
    f.activities_total = f.interactions + f.posts_verified + f.posts_reported + f.posts_flagged + f.other_activities + f.orders + f.shipments + f.promotions_active;
    f.verified_activities += f.orders; // an invoice is a system record
  }
  return out;
}

/** the seven components and the score, from the figures - nothing else */
export function scoreOf(f: Figures, settings: SpSettings, days: number) {
  const target = f.target_cents == null ? null : f.target_cents * days;
  const components: Record<SpComponent, number> = {
    sales: target ? ratio(f.sales_cents, target) : 0,
    engagement: ratio(f.unique_customers, settings.engagement_target * days),
    social: ratio(f.posts_verified, settings.posts_target * days),
    follow_up: f.follow_ups_done + f.follow_ups_overdue > 0 ? ratio(f.follow_ups_done, f.follow_ups_done + f.follow_ups_overdue) : 0,
    orders: f.orders > 0 ? ratio(f.orders_completed, f.orders) : 0,
    shipment: f.shipped > 0 ? ratio(f.shipped - f.tracking_required, f.shipped) : 0,
    promotion: f.promotions_active > 0 ? ratio(f.promotions_executed, f.promotions_active) : 0,
  };
  const score = spScore(components);
  const busy = spBusyVsProductive({
    activity: ratio(f.activities_total, settings.activity_target * days),
    engagement: components.engagement,
    conversion: f.inquiries > 0 ? ratio(f.conversions, f.inquiries) : 0,
    revenue: components.sales,
  });
  return { components, score, band: spBand(score), busy, target_cents: target, no_target: target == null };
}

/* ── the range from the query string ───────────────────────────────────── */
function rangeOf(params: URLSearchParams): { from: string; to: string; label: string } {
  const today = mytToday();
  const preset = params.get("range") ?? "today";
  if (preset === "yesterday") { const y = addDays(today, -1); return { from: y, to: y, label: "yesterday" }; }
  if (preset === "week") {
    const d = new Date(`${today}T00:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; // Monday first
    return { from: addDays(today, -dow), to: today, label: "week" };
  }
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today, label: "month" };
  if (preset === "custom") {
    const f = params.get("from"), t = params.get("to");
    if (validDay(f) && validDay(t) && f <= t) {
      const span = (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86400000;
      if (span <= 366) return { from: f, to: t, label: "custom" };
    }
  }
  return { from: today, to: today, label: "today" };
}

/* ── evidence (R2) ─────────────────────────────────────────────────────── */
const EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const EVIDENCE_MAX = 8 * 1024 * 1024;

/* ── the handler ───────────────────────────────────────────────────────── */
export async function handleSalesPerformance(
  env: Env, request: Request, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams,
): Promise<Response> {
  if (!can(user.role, "sales_perf_view")) return err("forbidden", "Sales Performance access required", 403);
  const manager = can(user.role, "sales_perf_manage");
  const me = user.id;
  const pending = (e: unknown) => String(e).includes("no such table") ? err("pending_migration", "Sales Performance needs database change 0127 - run PUSH.bat", 503) : null;

  /* who this request may see */
  const scopeIds = async (): Promise<{ ids: number[]; people: Person[] }> => {
    const staff = await salesStaff(env);
    if (!manager) {
      const meRow = staff.find((p) => p.id === me) ?? { id: me, name: user.name, role: user.role };
      return { ids: [me], people: [meRow] };
    }
    const one = Number(params.get("staff") ?? 0);
    const people = one > 0 ? staff.filter((p) => p.id === one) : staff;
    return { ids: people.map((p) => p.id), people };
  };
  /** a record the caller may touch: own for staff, any for a manager */
  const owns = (row: { user_id: number } | null | undefined) => !!row && (manager || row.user_id === me);

  /* ════════════════════════════════════════════════════════════════════
     GET /overview - the whole page in one read
     ════════════════════════════════════════════════════════════════════ */
  if (path === "/overview" && method === "GET") {
    try {
      const settings = await readSettings(env);
      const { ids, people } = await scopeIds();
      const range = rangeOf(params);
      const today = mytToday();
      const days = Math.max(1, Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1);
      const figs = await figuresFor(env, ids, range.from, range.to, settings);
      const per_staff = people.map((p) => {
        const f = figs.get(p.id) ?? zero();
        const s = scoreOf(f, settings, days);
        return { ...p, figures: f, ...s, no_verified_activity: f.present && f.verified_activities === 0 };
      });
      /* team = the sum, and the average score */
      const team = zero();
      for (const r of per_staff) for (const k of Object.keys(team) as (keyof Figures)[]) {
        if (k === "present" || k === "target_cents" || k === "conversion_rate") continue;
        const acc = team as unknown as Record<string, number>;
        acc[k] = (acc[k] ?? 0) + (r.figures[k] as number);
      }
      team.conversion_rate = team.inquiries > 0 ? Math.round((team.conversions / team.inquiries) * 1000) / 10 : 0;
      team.target_cents = per_staff.reduce((a, r) => a + (r.target_cents ?? 0), 0) || null;
      const avg_score = per_staff.length ? Math.round(per_staff.reduce((a, r) => a + r.score, 0) / per_staff.length) : 0;

      /* trend - today, yesterday, 7-day and 30-day averages, for the same people */
      const trendFor = async (from: string, to: string, div: number) => {
        const m = await figuresFor(env, ids, from, to, settings);
        const t = zero(); let score = 0;
        const n = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
        for (const id of ids) { const f = m.get(id) ?? zero(); const acc = t as unknown as Record<string, number>; for (const k of ["sales_cents", "orders", "interactions", "leads", "follow_ups_done", "posts_verified", "inquiries", "conversions"] as (keyof Figures)[]) acc[k] = (acc[k] ?? 0) + (f[k] as number); score += scoreOf(f, settings, n).score; }
        const d = (v: number) => Math.round((v / div) * 10) / 10;
        return { sales_cents: Math.round(t.sales_cents / div), orders: d(t.orders), engagement: d(t.interactions), leads: d(t.leads), follow_ups: d(t.follow_ups_done), posts_verified: d(t.posts_verified),
          conversion_rate: t.inquiries > 0 ? Math.round((t.conversions / t.inquiries) * 1000) / 10 : 0, score: ids.length ? Math.round(score / ids.length) : 0 };
      };
      const yesterday = addDays(today, -1);
      const trend = {
        today: await trendFor(today, today, 1),
        yesterday: await trendFor(yesterday, yesterday, 1),
        avg7: await trendFor(addDays(today, -6), today, 7),
        avg30: await trendFor(addDays(today, -29), today, 30),
      };

      /* the lists, filtered */
      const inIds = ids.length ? ids.join(",") : "0";
      const platform = params.get("platform") ?? "";
      const verification = params.get("verification") ?? "";
      const status = params.get("status") ?? "";
      const q = async <T>(sql: string, ...binds: unknown[]) => { try { return ((await env.DB.prepare(sql).bind(...binds).all<T>()).results ?? []) as T[]; } catch (e) { if (String(e).includes("no such")) return [] as T[]; throw e; } };
      const NAME = `(SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) FROM users u WHERE u.id = x.user_id)`;
      const platWhere = platform && platform !== "all" ? ` AND x.platform = '${SP_PLATFORMS.some(([k]) => k === platform) ? platform : "other"}'` : "";
      const verWhere = verification === "verified" ? " AND x.status = 'verified'" : verification === "pending" ? " AND x.status = 'pending'" : verification === "rejected" ? " AND x.status IN ('rejected','evidence_invalid')" : verification === "review" ? " AND x.status IN ('manual_review','old_post','unavailable','duplicate')" : "";
      const posts = await q<Record<string, unknown>>(
        `SELECT x.*, ${NAME} AS staff_name, (SELECT COALESCE(NULLIF(TRIM(v.full_name), ''), v.name) FROM users v WHERE v.id = x.verified_by) AS verified_by_name,
                (SELECT name FROM sp_promotions pr WHERE pr.id = x.promotion_id) AS promotion_name
           FROM sp_social_posts x WHERE x.deleted_at IS NULL AND x.user_id IN (${inIds}) AND ${MYT("x.submitted_at")} BETWEEN ?1 AND ?2 ${platWhere} ${verWhere}
          ORDER BY x.submitted_at DESC LIMIT 300`, range.from, range.to);
      const chanWhere = platform && platform !== "all" ? ` AND x.channel = '${SP_CHANNELS.some(([k]) => k === platform) ? platform : "other"}'` : "";
      const engVer = verification === "verified" ? " AND (x.status = 'verified' OR x.order_doc_id IS NOT NULL)" : verification === "pending" ? " AND x.status = 'reported' AND x.order_doc_id IS NULL" : verification === "rejected" ? " AND x.status = 'rejected'" : "";
      const engStatus = status === "completed" ? " AND x.outcome_at IS NOT NULL" : status === "pending" ? " AND x.follow_up_on IS NOT NULL AND x.outcome_at IS NULL AND x.follow_up_on >= ?3" : status === "overdue" ? " AND x.follow_up_on IS NOT NULL AND x.outcome_at IS NULL AND x.follow_up_on < ?3" : "";
      const engagements = await q<Record<string, unknown>>(
        `SELECT x.*, ${NAME} AS staff_name,
                (SELECT d.doc_number FROM sales_documents d WHERE d.id = x.order_doc_id) AS order_number,
                (SELECT d.total_cents FROM sales_documents d WHERE d.id = x.order_doc_id) AS order_cents,
                (SELECT d.payment_status FROM sales_documents d WHERE d.id = x.order_doc_id) AS order_payment,
                (SELECT name FROM sp_promotions pr WHERE pr.id = x.promotion_id) AS promotion_name
           FROM sp_engagements x WHERE x.deleted_at IS NULL AND x.user_id IN (${inIds})
            AND (${MYT("x.happened_at")} BETWEEN ?1 AND ?2 OR (x.follow_up_on IS NOT NULL AND x.outcome_at IS NULL AND x.follow_up_on <= ?3)) ${chanWhere} ${engVer} ${engStatus}
          ORDER BY x.happened_at DESC LIMIT 400`, range.from, range.to, today);
      const promotions = await q<Record<string, unknown>>(
        `SELECT x.*, ${NAME} AS staff_name,
                (SELECT COUNT(*) FROM sp_social_posts s WHERE s.promotion_id = x.id AND s.deleted_at IS NULL AND s.status = 'verified') AS posts_verified,
                (SELECT COUNT(*) FROM sp_social_posts s WHERE s.promotion_id = x.id AND s.deleted_at IS NULL) AS posts_total,
                (SELECT COUNT(*) FROM sp_engagements e WHERE e.promotion_id = x.id AND e.deleted_at IS NULL AND e.interaction_type IN ('new_inquiry','product_question','price_inquiry')) AS inquiries,
                (SELECT COUNT(DISTINCT e.order_doc_id) FROM sp_engagements e WHERE e.promotion_id = x.id AND e.deleted_at IS NULL AND e.order_doc_id IS NOT NULL) AS orders,
                (SELECT COALESCE(SUM(d.total_cents), 0) FROM sales_documents d WHERE d.id IN (SELECT DISTINCT e.order_doc_id FROM sp_engagements e WHERE e.promotion_id = x.id AND e.deleted_at IS NULL AND e.order_doc_id IS NOT NULL)) AS revenue_cents
           FROM sp_promotions x WHERE x.deleted_at IS NULL AND x.user_id IN (${inIds}) AND x.start_on <= ?2 AND COALESCE(x.end_on, x.start_on) >= ?1 ${platWhere}
          ORDER BY x.start_on DESC LIMIT 200`, range.from, range.to);
      const others = await q<Record<string, unknown>>(
        `SELECT x.*, ${NAME} AS staff_name FROM sp_other_activities x WHERE x.deleted_at IS NULL AND x.user_id IN (${inIds}) AND ${MYT("x.happened_at")} BETWEEN ?1 AND ?2 ORDER BY x.happened_at DESC LIMIT 200`, range.from, range.to);
      const orders = await q<Record<string, unknown>>(
        `SELECT d.id, d.doc_number, d.created_at, d.total_cents, d.payment_status, d.paid_at, d.kind, d.delivery_status, d.items, d.salesperson_id AS user_id, d.customer_id,
                c.company AS customer, (SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) FROM users u WHERE u.id = d.salesperson_id) AS staff_name,
                (SELECT p.status FROM postage_records p WHERE p.order_ref = d.doc_number ORDER BY p.updated_at DESC LIMIT 1) AS ship_status,
                (SELECT p.tracking_no FROM postage_records p WHERE p.order_ref = d.doc_number ORDER BY p.updated_at DESC LIMIT 1) AS tracking_no,
                (SELECT COUNT(*) FROM sp_engagements e WHERE e.order_doc_id = d.id AND e.deleted_at IS NULL) AS linked_engagements
           FROM sales_documents d JOIN customers c ON c.id = d.customer_id
          WHERE d.doc_type = 'INV' AND d.salesperson_id IN (${inIds}) AND ${MYT("d.created_at")} BETWEEN ?1 AND ?2
          ORDER BY d.created_at DESC LIMIT 300`, range.from, range.to);
      const shipments = await q<Record<string, unknown>>(
        `SELECT p.id, p.order_ref, p.courier, p.tracking_no, p.status, p.note, p.updated_by AS user_id, p.created_at, p.updated_at,
                (SELECT COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) FROM users u WHERE u.id = p.updated_by) AS staff_name,
                (SELECT c.company FROM sales_documents d JOIN customers c ON c.id = d.customer_id WHERE d.doc_number = p.order_ref LIMIT 1) AS customer,
                (SELECT d.id FROM sales_documents d WHERE d.doc_number = p.order_ref LIMIT 1) AS order_doc_id
           FROM postage_records p WHERE p.updated_by IN (${inIds}) AND ${MYT("p.updated_at")} BETWEEN ?1 AND ?2
          ORDER BY p.updated_at DESC LIMIT 300`, range.from, range.to);

      /* the activity feed - one row per record, newest first */
      type Feed = { at: string; user_id: number; staff_name: string; type: string; customer: string; product: string; action: string; result: string; sales_cents: number | null; evidence_key: string | null; verification: string; ref: string; id: number };
      const feed: Feed[] = [];
      for (const p of posts) feed.push({ at: String(p.submitted_at), user_id: Number(p.user_id), staff_name: String(p.staff_name ?? ""), type: `${p.platform}_post`, customer: "", product: String(p.product ?? ""), action: `${String(p.platform)} post`, result: String(p.description ?? "").slice(0, 80), sales_cents: null, evidence_key: (p.evidence_key as string) ?? null, verification: String(p.status), ref: "post", id: Number(p.id) });
      for (const e of engagements) feed.push({ at: String(e.happened_at), user_id: Number(e.user_id), staff_name: String(e.staff_name ?? ""), type: String(e.interaction_type), customer: String(e.customer_name ?? ""), product: String(e.product ?? ""), action: String(e.action_taken ?? ""), result: String(e.outcome ?? (e.follow_up_on ? `follow up ${e.follow_up_on}` : "")), sales_cents: e.order_cents != null ? Number(e.order_cents) : null, evidence_key: (e.evidence_key as string) ?? null, verification: e.order_doc_id ? "linked_order" : String(e.status), ref: "engagement", id: Number(e.id) });
      for (const p of promotions) feed.push({ at: `${p.start_on} 00:00:00`, user_id: Number(p.user_id), staff_name: String(p.staff_name ?? ""), type: "promotion", customer: "", product: String(p.product ?? ""), action: String(p.name), result: String(p.result ?? ""), sales_cents: Number(p.revenue_cents ?? 0) || null, evidence_key: (p.evidence_key as string) ?? null, verification: String(p.status), ref: "promotion", id: Number(p.id) });
      for (const o of others) feed.push({ at: String(o.happened_at), user_id: Number(o.user_id), staff_name: String(o.staff_name ?? ""), type: "other", customer: String(o.customer_name ?? ""), product: String(o.product ?? ""), action: String(o.action), result: String(o.result ?? ""), sales_cents: null, evidence_key: (o.evidence_key as string) ?? null, verification: String(o.status), ref: "other", id: Number(o.id) });
      for (const o of orders) feed.push({ at: String(o.created_at), user_id: Number(o.user_id), staff_name: String(o.staff_name ?? ""), type: "new_order", customer: String(o.customer ?? ""), product: "", action: String(o.doc_number), result: String(o.payment_status ?? "unpaid"), sales_cents: Number(o.total_cents), evidence_key: null, verification: "system", ref: "order", id: Number(o.id) });
      for (const s of shipments) feed.push({ at: String(s.updated_at), user_id: Number(s.user_id), staff_name: String(s.staff_name ?? ""), type: s.tracking_no ? "tracking_update" : "shipment", customer: String(s.customer ?? ""), product: "", action: `${s.order_ref} · ${s.courier ?? ""}`.trim(), result: String(s.status), sales_cents: null, evidence_key: null, verification: "system", ref: "shipment", id: Number(s.id) });
      feed.sort((a, b) => b.at.localeCompare(a.at));

      /* my closing for today (or the range's single day), and the team's */
      const closingDay = range.from === range.to ? range.from : today;
      const closings = await q<Record<string, unknown>>(
        `SELECT x.*, ${NAME} AS staff_name FROM sp_daily_closings x WHERE x.user_id IN (${inIds}) AND x.day = ?1`, closingDay);
      /* everyone sees the approved list - a submitter should know which accounts count before posting */
      const accounts = await q<Record<string, unknown>>(`SELECT id, platform, handle, label FROM sp_social_accounts WHERE is_active = 1 ORDER BY platform, handle`);
      /* customers for the engagement picker (the sales tier's list); invoices for the order picker */
      const customers = await q<{ id: number; company: string; contact_person: string | null; phone: string | null }>(`SELECT id, company, contact_person, phone FROM customers ORDER BY company LIMIT 500`);
      const invoices = await q<{ id: number; doc_number: string; total_cents: number; customer_id: number; company: string; created_at: string; salesperson_id: number }>(
        `SELECT d.id, d.doc_number, d.total_cents, d.customer_id, c.company, d.created_at, d.salesperson_id FROM sales_documents d JOIN customers c ON c.id = d.customer_id
          WHERE d.doc_type = 'INV' ${manager ? "" : `AND d.salesperson_id = ${me}`} ORDER BY d.created_at DESC LIMIT 300`);

      return json({
        me, can_manage: manager, range, today, days,
        settings: manager ? settings : { ...settings, targets: { [String(me)]: settings.targets[String(me)] ?? null } },
        staff: manager ? await salesStaff(env) : people,
        team: { figures: team, avg_score: avg_score, band: spBand(avg_score), achievement_pct: team.target_cents ? Math.round((team.sales_cents / (team.target_cents * days)) * 100) : null },
        per_staff, trend,
        funnel: { posts: team.posts_verified, reach: team.reach, engagement: team.social_engagement, inquiries: team.inquiries, follow_ups: team.follow_ups_done, orders: team.orders, revenue_cents: team.sales_cents },
        feed: feed.slice(0, 400),
        posts, engagements, promotions, others, orders, shipments, closings,
        accounts, customers, invoices,
        vocab: { platforms: SP_PLATFORMS, channels: SP_CHANNELS, interactions: SP_INTERACTIONS, promo_types: SP_PROMO_TYPES, post_statuses: SP_POST_STATUSES },
      });
    } catch (e) { const p = pending(e); if (p) return p; throw e; }
  }

  /* ════════════════════════════════════════════════════════════════════
     EVIDENCE - a screenshot in R2, keyed sp/<uuid>; read back by key
     ════════════════════════════════════════════════════════════════════ */
  if (path === "/evidence" && method === "POST") {
    const ct = request.headers.get("content-type") ?? "";
    if (!EVIDENCE_TYPES.includes(ct)) return err("invalid_input", "Evidence must be a JPEG, PNG or WebP screenshot", 400);
    const len = Number(request.headers.get("content-length") ?? 0);
    if (len > EVIDENCE_MAX) return err("too_large", "Screenshot too large - maximum 8 MB", 413);
    if (!request.body) return err("invalid_input", "Screenshot body required", 400);
    const key = `sp/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
    await audit(env, me, "sp.evidence_upload", "r2", key, { content_type: ct, bytes: len });
    return json({ key });
  }
  if (path === "/evidence" && method === "GET") {
    const key = params.get("key") ?? "";
    if (!/^sp\/[0-9a-f-]{36}$/.test(key)) return err("invalid_input", "Bad evidence key", 400);
    /* the file is reachable by anyone who can see the record it hangs on:
       staff see their own, managers everything */
    if (!manager) {
      const own = await env.DB.prepare(
        `SELECT 1 AS x FROM (SELECT user_id, evidence_key FROM sp_social_posts UNION ALL SELECT user_id, evidence_key FROM sp_engagements UNION ALL SELECT user_id, evidence_key FROM sp_promotions UNION ALL SELECT user_id, evidence_key FROM sp_other_activities)
          WHERE evidence_key = ?1 AND user_id = ?2 LIMIT 1`).bind(key, me).first().catch(() => null);
      /* a screenshot uploaded a moment ago and not yet attached is the
         uploader's own - the audit row says who put it there */
      const mine = own ?? await env.DB.prepare(`SELECT 1 AS x FROM audit_log WHERE action = 'sp.evidence_upload' AND entity_id = ?1 AND user_id = ?2 LIMIT 1`).bind(key, me).first().catch(() => null);
      if (!mine) return err("forbidden", "Not your evidence", 403);
    }
    const obj = await env.MEDIA.get(key);
    if (!obj) return err("not_found", "Evidence file missing", 404);
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "private, max-age=600" } });
  }

  /* ════════════════════════════════════════════════════════════════════
     SOCIAL POSTS
     ════════════════════════════════════════════════════════════════════ */
  const evidenceOk = async (key: unknown): Promise<string | null> => {
    if (!str(key, 60) || !/^sp\/[0-9a-f-]{36}$/.test(key)) return null;
    const head = await env.MEDIA.head(key).catch(() => null);
    return head ? key : null;
  };
  const readMetric = (v: unknown): number | null => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? n : null;
  };

  if (path === "/posts" && method === "POST") {
    try {
      const platform = str(body?.platform, 20) && SP_PLATFORMS.some(([k]) => k === body!.platform) ? (body!.platform as string) : null;
      if (!platform) return err("invalid_input", "Pick the platform", 400);
      const info = readSocialUrl(String(body?.url ?? ""));
      if (!info.ok) return err("invalid_url", info.reason ?? "Invalid post URL", 400);
      if (platform !== "other" && info.platform !== platform) {
        return err("platform_mismatch", "Platform mismatch. Please submit the correct social media post URL.", 400);
      }
      if (platform === "other" && info.platform !== "other") {
        return err("platform_mismatch", `That is a ${info.platform} link - pick ${info.platform} as the platform.`, 400);
      }
      const evidence = await evidenceOk(body?.evidence_key);
      if (!evidence) return err("evidence_required", "A screenshot of the post is required - upload it first", 400);
      if (!str(body?.product, 120) || !(body!.product as string).trim()) return err("invalid_input", "Which product was promoted?", 400);
      if (!str(body?.description, 1000) || !(body!.description as string).trim()) return err("invalid_input", "Describe the post", 400);
      const postedUtc = str(body?.posted_at, 25) ? mytToUtc(body!.posted_at as string) : null;
      if (!postedUtc) return err("invalid_input", "When was the post published? (date and time)", 400);
      if (postedUtc > new Date().toISOString().slice(0, 19).replace("T", " ")) return err("invalid_input", "The post date is in the future", 400);
      /* duplicate - by the post's identity, not its spelling */
      const dup = await env.DB.prepare(`SELECT id, status FROM sp_social_posts WHERE url_key = ?1 AND deleted_at IS NULL`).bind(info.key).first<{ id: number; status: string }>();
      if (dup) return err("duplicate", "Duplicate Post - This post has already been submitted.", 409);
      /* the account: named by the URL and on the approved list -> matched */
      const flags: string[] = [];
      let accountMatch = 0;
      if (info.handle) {
        const acc = await env.DB.prepare(`SELECT 1 AS x FROM sp_social_accounts WHERE platform = ?1 AND handle = ?2 AND is_active = 1`).bind(platform, info.handle).first();
        accountMatch = acc ? 1 : 0;
        if (!acc) flags.push("account_not_approved");
      } else flags.push("account_unknown");
      const today = mytToday();
      const postedDay = new Date(Date.parse(`${postedUtc.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString().slice(0, 10);
      if (postedDay < addDays(today, -1)) flags.push("old_post");
      const status = flags.includes("old_post") ? "old_post" : accountMatch ? "pending" : "manual_review";
      const promo = body?.promotion_id != null && String(body.promotion_id) !== "" ? Number(body.promotion_id) : null;
      if (promo) {
        const pr = await env.DB.prepare(`SELECT user_id FROM sp_promotions WHERE id = ?1 AND deleted_at IS NULL`).bind(promo).first<{ user_id: number }>();
        if (!pr) return err("invalid_input", "That promotion does not exist", 400);
      }
      const r = await env.DB.prepare(
        `INSERT INTO sp_social_posts (user_id, platform, url, url_key, account_handle, account_match, product, description, evidence_key, posted_at, status, flags, views, likes, comments, shares, saves, promotion_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
      ).bind(me, platform, info.clean, info.key, info.handle, accountMatch, (body!.product as string).trim(), (body!.description as string).trim(), evidence, postedUtc, status, JSON.stringify(flags),
        readMetric(body?.views), readMetric(body?.likes), readMetric(body?.comments), readMetric(body?.shares), readMetric(body?.saves), promo).run();
      const id = String(r.meta.last_row_id);
      await audit(env, me, "sp.post_create", "sp_social_posts", id, { platform, url: info.clean, key: info.key, status, flags, evidence });
      return json({ ok: true, id: Number(id), status, flags }, 201);
    } catch (e) {
      const p = pending(e); if (p) return p;
      if (String(e).includes("UNIQUE")) return err("duplicate", "Duplicate Post - This post has already been submitted.", 409);
      throw e;
    }
  }
  const postM = path.match(/^\/posts\/(\d+)(?:\/(verify|check))?$/);
  if (postM) {
    const id = postM[1]!;
    const row = await env.DB.prepare(`SELECT * FROM sp_social_posts WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>().catch(() => null);
    if (!row) return err("not_found", "Post not found", 404);
    if (!owns(row as { user_id: number })) return err("forbidden", "Not your record", 403);
    const verified = row.status === "verified";
    if (postM[2] === "verify" && method === "POST") {
      if (!manager) return err("forbidden", "Only management verifies evidence", 403);
      if (Number(row.user_id) === me) return err("forbidden", "You cannot verify your own evidence", 403);
      const decision = String(body?.decision ?? "");
      if (!["verified", "rejected", "evidence_invalid", "manual_review", "unavailable"].includes(decision)) return err("invalid_input", "decision must be verified, rejected, evidence_invalid, manual_review or unavailable", 400);
      /* a decision on an already-verified post is a CORRECTION: it needs a
         reason, and the audit row below keeps the old and new status */
      if (verified && decision !== "verified" && !str(body?.note, 300)) return err("invalid_input", "A reason is required to change a verified decision", 400);
      const metricsVerified = decision === "verified" && body?.metrics_verified === true ? "verified" : "reported";
      await env.DB.prepare(`UPDATE sp_social_posts SET status = ?1, verified_by = ?2, verified_at = datetime('now'), verify_note = ?3, metrics_status = ?4, updated_at = datetime('now') WHERE id = ?5`)
        .bind(decision, me, str(body?.note, 300) ? (body!.note as string).trim() : null, metricsVerified, id).run();
      await audit(env, me, "sp.post_verify", "sp_social_posts", id, { was: row.status, now: decision, metrics_status: metricsVerified, note: body?.note ?? null });
      return json({ ok: true, status: decision });
    }
    if (postM[2] === "check" && method === "POST") {
      if (!manager) return err("forbidden", "Only management runs link checks", 403);
      const http = await probeUrl(String(row.url));
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      let status = String(row.status);
      if ((http === 404 || http === 410) && status === "verified") status = "unavailable";
      await env.DB.prepare(`UPDATE sp_social_posts SET last_check_at = ?1, last_check_http = ?2, status = ?3, updated_at = datetime('now') WHERE id = ?4`).bind(now, http, status, id).run();
      await audit(env, me, "sp.post_check", "sp_social_posts", id, { http, was: row.status, now: status });
      return json({ ok: true, http, status, reachable: http >= 200 && http < 400 });
    }
    if (!postM[2] && method === "PATCH") {
      /* the author may fix a PENDING/flagged record's text and metrics; the
         URL, evidence, date and staff never move by the author once verified;
         a manager may correct anything, with a reason, and the diff is kept */
      if (verified && !manager) return err("locked", "A verified post cannot be changed - ask management to correct it", 403);
      const reason = str(body?.reason, 300) ? (body!.reason as string).trim() : null;
      if (verified && manager && !reason) return err("invalid_input", "A reason is required to correct a verified record", 400);
      const sets: string[] = []; const vals: unknown[] = []; const diff: Record<string, { was: unknown; now: unknown }> = {};
      const put = (col: string, v: unknown) => { if (v !== row[col]) { sets.push(`${col} = ?${sets.length + 1}`); vals.push(v); diff[col] = { was: row[col], now: v }; } };
      if (str(body?.product, 120)) put("product", (body!.product as string).trim());
      if (str(body?.description, 1000)) put("description", (body!.description as string).trim());
      for (const k of ["views", "likes", "comments", "shares", "saves"] as const) if (body && k in body) put(k, readMetric(body[k]));
      if (body && "promotion_id" in body) put("promotion_id", body.promotion_id != null && String(body.promotion_id) !== "" ? Number(body.promotion_id) : null);
      if (manager) {
        if (str(body?.posted_at, 25)) { const u = mytToUtc(body!.posted_at as string); if (u) put("posted_at", u); }
        if (str(body?.url, 500)) { const info = readSocialUrl(body!.url as string); if (!info.ok) return err("invalid_url", info.reason ?? "Invalid URL", 400); put("url", info.clean); put("url_key", info.key); put("account_handle", info.handle); }
        const ev = body?.evidence_key !== undefined ? await evidenceOk(body!.evidence_key) : null; if (ev) put("evidence_key", ev);
      } else if (body && ("url" in body || "evidence_key" in body || "posted_at" in body || "user_id" in body)) {
        return err("locked", "The URL, evidence, date and staff of a post cannot be changed after submission - delete it (while pending) and submit again", 403);
      }
      if (sets.length === 0) return json({ ok: true, unchanged: true });
      /* metrics typed after the fact are REPORTED again until re-verified */
      if (Object.keys(diff).some((k) => ["views", "likes", "comments", "shares", "saves"].includes(k)) && row.metrics_status === "verified") { sets.push(`metrics_status = ?${sets.length + 1}`); vals.push("reported"); diff.metrics_status = { was: "verified", now: "reported" }; }
      sets.push("updated_at = datetime('now')"); vals.push(id);
      try { await env.DB.prepare(`UPDATE sp_social_posts SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals).run(); }
      catch (e) { if (String(e).includes("UNIQUE")) return err("duplicate", "Another submission already carries that post URL", 409); throw e; }
      await audit(env, me, verified ? "sp.post_correct" : "sp.post_edit", "sp_social_posts", id, { diff, reason });
      return json({ ok: true });
    }
    if (!postM[2] && method === "DELETE") {
      if (verified) return err("locked", "A verified post is a permanent record - management may mark it rejected or unavailable, with a reason", 403);
      await env.DB.prepare(`UPDATE sp_social_posts SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1`).bind(id).run();
      await audit(env, me, "sp.post_delete", "sp_social_posts", id, { status: row.status, url: row.url, reason: body?.reason ?? null });
      return json({ ok: true });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     ENGAGEMENTS - what the staff member says happened with a customer
     ════════════════════════════════════════════════════════════════════ */
  type Fields = { fields: Record<string, unknown> } | { error: string };
  const readEngagement = async (b: Record<string, unknown> | null, partial: boolean): Promise<Fields> => {
    const out: Record<string, unknown> = {};
    const has = (k: string) => !!b && k in b;
    if (has("customer_id") || has("customer_name") || !partial) {
      const cid = b?.customer_id != null && String(b.customer_id) !== "" ? Number(b.customer_id) : null;
      let name = str(b?.customer_name, 120) ? (b!.customer_name as string).trim() : "";
      const phone = str(b?.customer_phone, 40) ? (b!.customer_phone as string).trim() : null;
      if (cid) {
        const c = await env.DB.prepare(`SELECT company, contact_person, phone FROM customers WHERE id = ?1`).bind(cid).first<{ company: string; contact_person: string | null; phone: string | null }>();
        if (!c) return { error: "That customer does not exist" };
        if (!name) name = c.company;
        out.customer_id = cid; out.customer_name = name; out.customer_phone = phone ?? c.phone ?? null;
      } else {
        if (!name) return { error: "Who is the customer? Pick one or type the name" };
        out.customer_id = null; out.customer_name = name; out.customer_phone = phone;
      }
      out.customer_key = customerKey(out.customer_id as number | null, out.customer_name as string, out.customer_phone as string | null);
    }
    if (has("happened_at") || !partial) {
      const u = str(b?.happened_at, 25) ? mytToUtc(b!.happened_at as string) : null;
      if (!u) return { error: "When did this happen? (date and time)" };
      if (u > new Date().toISOString().slice(0, 19).replace("T", " ")) return { error: "That time is in the future" };
      out.happened_at = u;
    }
    if (has("channel") || !partial) { const c = String(b?.channel ?? ""); if (!SP_CHANNELS.some(([k]) => k === c)) return { error: "Pick the channel" }; out.channel = c; }
    if (has("interaction_type") || !partial) { const t = String(b?.interaction_type ?? ""); if (!SP_INTERACTIONS.some(([k]) => k === t)) return { error: "Pick the interaction type" }; out.interaction_type = t; }
    if (has("product")) out.product = str(b?.product, 120) ? (b!.product as string).trim() || null : null;
    if (has("action_taken") || !partial) { if (!str(b?.action_taken, 500) || !(b!.action_taken as string).trim()) return { error: "What action did you take?" }; out.action_taken = (b!.action_taken as string).trim(); }
    if (has("follow_up_on")) { const d = b!.follow_up_on; if (d == null || d === "") out.follow_up_on = null; else if (validDay(d)) out.follow_up_on = d; else return { error: "The follow-up date must be YYYY-MM-DD" }; }
    if (has("notes")) out.notes = str(b?.notes, 1000) ? (b!.notes as string).trim() || null : null;
    if (has("promotion_id")) out.promotion_id = b!.promotion_id != null && String(b!.promotion_id) !== "" ? Number(b!.promotion_id) : null;
    if (has("source_post_id")) out.source_post_id = b!.source_post_id != null && String(b!.source_post_id) !== "" ? Number(b!.source_post_id) : null;
    if (has("evidence_key")) { const ev = b!.evidence_key == null || b!.evidence_key === "" ? null : await evidenceOk(b!.evidence_key); if (b!.evidence_key && !ev) return { error: "That screenshot was not uploaded" }; out.evidence_key = ev; }
    return { fields: out };
  };
  /** the link that turns a conversation into a conversion: a real invoice */
  const orderLink = async (v: unknown): Promise<{ id: number | null } | { error: string }> => {
    if (v == null || String(v) === "") return { id: null };
    const id = Number(v);
    const d = await env.DB.prepare(`SELECT id, salesperson_id FROM sales_documents WHERE id = ?1 AND doc_type = 'INV'`).bind(id).first<{ id: number; salesperson_id: number }>();
    if (!d) return { error: "That order (invoice) does not exist" };
    if (!manager && d.salesperson_id !== me) return { error: "That invoice is not yours - a conversion links to your own order" };
    return { id: d.id };
  };

  if (path === "/engagements" && method === "POST") {
    try {
      const r = await readEngagement(body, false);
      if ("error" in r) return err("invalid_input", r.error, 400);
      const f = r.fields;
      const ol = await orderLink(body?.order_doc_id); if ("error" in ol) return err("invalid_input", ol.error, 400);
      const outcome = str(body?.outcome, 500) ? (body!.outcome as string).trim() || null : null;
      const res = await env.DB.prepare(
        `INSERT INTO sp_engagements (user_id, customer_id, customer_name, customer_phone, customer_key, happened_at, channel, interaction_type, product, action_taken, follow_up_on, outcome, outcome_at, order_doc_id, notes, evidence_key, promotion_id, source_post_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
      ).bind(me, f.customer_id ?? null, f.customer_name, f.customer_phone ?? null, f.customer_key, f.happened_at, f.channel, f.interaction_type, f.product ?? null, f.action_taken, f.follow_up_on ?? null,
        outcome, outcome || ol.id ? new Date().toISOString().slice(0, 19).replace("T", " ") : null, ol.id, f.notes ?? null, f.evidence_key ?? null, f.promotion_id ?? null, f.source_post_id ?? null).run();
      const id = String(res.meta.last_row_id);
      await audit(env, me, "sp.engagement_create", "sp_engagements", id, { customer: f.customer_name, type: f.interaction_type, channel: f.channel, order_doc_id: ol.id });
      return json({ ok: true, id: Number(id) }, 201);
    } catch (e) { const p = pending(e); if (p) return p; throw e; }
  }
  const engM = path.match(/^\/engagements\/(\d+)(?:\/(verify|outcome))?$/);
  if (engM) {
    const id = engM[1]!;
    const row = await env.DB.prepare(`SELECT * FROM sp_engagements WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>().catch(() => null);
    if (!row) return err("not_found", "Engagement not found", 404);
    if (!owns(row as { user_id: number })) return err("forbidden", "Not your record", 403);
    const locked = row.status === "verified" || row.order_doc_id != null;
    if (engM[2] === "verify" && method === "POST") {
      if (!manager) return err("forbidden", "Only management verifies", 403);
      if (Number(row.user_id) === me) return err("forbidden", "You cannot verify your own record", 403);
      const decision = String(body?.decision ?? "");
      if (!["verified", "rejected", "reported"].includes(decision)) return err("invalid_input", "decision must be verified, rejected or reported", 400);
      await env.DB.prepare(`UPDATE sp_engagements SET status = ?1, verified_by = ?2, verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?3`).bind(decision, me, id).run();
      await audit(env, me, "sp.engagement_verify", "sp_engagements", id, { was: row.status, now: decision, note: body?.note ?? null });
      return json({ ok: true, status: decision });
    }
    if (engM[2] === "outcome" && method === "POST") {
      /* the follow-up's result - and, when it closed, the invoice it closed to */
      const outcome = str(body?.outcome, 500) ? (body!.outcome as string).trim() : "";
      if (!outcome) return err("invalid_input", "What was the outcome?", 400);
      const ol = await orderLink(body?.order_doc_id); if ("error" in ol) return err("invalid_input", ol.error, 400);
      if (row.order_doc_id != null && ol.id !== null && ol.id !== Number(row.order_doc_id) && !manager) return err("locked", "This engagement is already linked to an order - management may re-link it", 403);
      await env.DB.prepare(`UPDATE sp_engagements SET outcome = ?1, outcome_at = datetime('now'), order_doc_id = COALESCE(?2, order_doc_id), updated_at = datetime('now') WHERE id = ?3`).bind(outcome, ol.id, id).run();
      await audit(env, me, "sp.engagement_outcome", "sp_engagements", id, { outcome, order_doc_id: ol.id ?? row.order_doc_id, was_order: row.order_doc_id });
      return json({ ok: true });
    }
    if (!engM[2] && method === "PATCH") {
      if (locked && !manager) return err("locked", "A verified or order-linked engagement cannot be changed - ask management to correct it", 403);
      const reason = str(body?.reason, 300) ? (body!.reason as string).trim() : null;
      if (locked && manager && !reason) return err("invalid_input", "A reason is required to correct a verified record", 400);
      const r = await readEngagement(body, true);
      if ("error" in r) return err("invalid_input", r.error, 400);
      const f = r.fields;
      if (body && "order_doc_id" in body) { const ol = await orderLink(body.order_doc_id); if ("error" in ol) return err("invalid_input", ol.error, 400); f.order_doc_id = ol.id; }
      if (body && "outcome" in body) { f.outcome = str(body.outcome, 500) ? (body.outcome as string).trim() || null : null; f.outcome_at = f.outcome ? new Date().toISOString().slice(0, 19).replace("T", " ") : null; }
      const sets: string[] = []; const vals: unknown[] = []; const diff: Record<string, { was: unknown; now: unknown }> = {};
      for (const [k, v] of Object.entries(f)) if (v !== row[k]) { sets.push(`${k} = ?${sets.length + 1}`); vals.push(v); diff[k] = { was: row[k], now: v }; }
      if (sets.length === 0) return json({ ok: true, unchanged: true });
      sets.push("updated_at = datetime('now')"); vals.push(id);
      await env.DB.prepare(`UPDATE sp_engagements SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals).run();
      await audit(env, me, locked ? "sp.engagement_correct" : "sp.engagement_edit", "sp_engagements", id, { diff, reason });
      return json({ ok: true });
    }
    if (!engM[2] && method === "DELETE") {
      if (locked && !manager) return err("locked", "A verified or order-linked engagement is a permanent record", 403);
      if (locked && !str(body?.reason, 300)) return err("invalid_input", "A reason is required to remove a verified record", 400);
      await env.DB.prepare(`UPDATE sp_engagements SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1`).bind(id).run();
      await audit(env, me, "sp.engagement_delete", "sp_engagements", id, { snapshot: row, reason: body?.reason ?? null });
      return json({ ok: true });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     PROMOTIONS
     ════════════════════════════════════════════════════════════════════ */
  const readPromotion = async (b: Record<string, unknown> | null, partial: boolean): Promise<Fields> => {
    const out: Record<string, unknown> = {};
    const has = (k: string) => !!b && k in b;
    if (has("name") || !partial) { if (!str(b?.name, 120) || !(b!.name as string).trim()) return { error: "Name the promotion" }; out.name = (b!.name as string).trim(); }
    if (has("product")) out.product = str(b?.product, 120) ? (b!.product as string).trim() || null : null;
    if (has("platform")) { const p = String(b?.platform ?? ""); out.platform = SP_PLATFORMS.some(([k]) => k === p) ? p : null; }
    if (has("promo_type")) { const t = String(b?.promo_type ?? ""); out.promo_type = SP_PROMO_TYPES.some(([k]) => k === t) ? t : "other"; }
    if (has("start_on") || !partial) { if (!validDay(b?.start_on)) return { error: "The start date must be YYYY-MM-DD" }; out.start_on = b!.start_on; }
    if (has("end_on")) { const d = b!.end_on; if (d == null || d === "") out.end_on = null; else if (validDay(d)) out.end_on = d; else return { error: "The end date must be YYYY-MM-DD" }; }
    if (has("customers_reached")) out.customers_reached = readMetric(b!.customers_reached);
    if (has("result")) out.result = str(b?.result, 500) ? (b!.result as string).trim() || null : null;
    if (has("notes")) out.notes = str(b?.notes, 1000) ? (b!.notes as string).trim() || null : null;
    if (has("evidence_key")) { const ev = b!.evidence_key == null || b!.evidence_key === "" ? null : await evidenceOk(b!.evidence_key); if (b!.evidence_key && !ev) return { error: "That screenshot was not uploaded" }; out.evidence_key = ev; }
    if (out.start_on && out.end_on && String(out.end_on) < String(out.start_on)) return { error: "The end date is before the start" };
    return { fields: out };
  };
  if (path === "/promotions" && method === "POST") {
    try {
      const r = await readPromotion(body, false);
      if ("error" in r) return err("invalid_input", r.error, 400);
      const f = r.fields;
      const owner = manager && body?.user_id != null && String(body.user_id) !== "" ? Number(body.user_id) : me;
      const res = await env.DB.prepare(
        `INSERT INTO sp_promotions (name, product, platform, promo_type, start_on, end_on, user_id, customers_reached, result, notes, evidence_key, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      ).bind(f.name, f.product ?? null, f.platform ?? null, f.promo_type ?? "other", f.start_on, f.end_on ?? null, owner, f.customers_reached ?? null, f.result ?? null, f.notes ?? null, f.evidence_key ?? null, me).run();
      const id = String(res.meta.last_row_id);
      await audit(env, me, "sp.promotion_create", "sp_promotions", id, { name: f.name, user_id: owner });
      return json({ ok: true, id: Number(id) }, 201);
    } catch (e) { const p = pending(e); if (p) return p; throw e; }
  }
  const promoM = path.match(/^\/promotions\/(\d+)(?:\/(verify))?$/);
  if (promoM) {
    const id = promoM[1]!;
    const row = await env.DB.prepare(`SELECT * FROM sp_promotions WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>().catch(() => null);
    if (!row) return err("not_found", "Promotion not found", 404);
    if (!owns(row as { user_id: number })) return err("forbidden", "Not your record", 403);
    const verified = row.status === "verified";
    if (promoM[2] === "verify" && method === "POST") {
      if (!manager) return err("forbidden", "Only management verifies", 403);
      if (Number(row.user_id) === me) return err("forbidden", "You cannot verify your own record", 403);
      const decision = String(body?.decision ?? "");
      if (!["verified", "rejected", "reported"].includes(decision)) return err("invalid_input", "decision must be verified, rejected or reported", 400);
      await env.DB.prepare(`UPDATE sp_promotions SET status = ?1, verified_by = ?2, verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?3`).bind(decision, me, id).run();
      await audit(env, me, "sp.promotion_verify", "sp_promotions", id, { was: row.status, now: decision });
      return json({ ok: true, status: decision });
    }
    if (!promoM[2] && method === "PATCH") {
      if (verified && !manager) return err("locked", "A verified promotion cannot be changed - ask management to correct it", 403);
      const reason = str(body?.reason, 300) ? (body!.reason as string).trim() : null;
      if (verified && manager && !reason) return err("invalid_input", "A reason is required to correct a verified record", 400);
      const r = await readPromotion(body, true);
      if ("error" in r) return err("invalid_input", r.error, 400);
      const sets: string[] = []; const vals: unknown[] = []; const diff: Record<string, { was: unknown; now: unknown }> = {};
      for (const [k, v] of Object.entries(r.fields)) if (v !== row[k]) { sets.push(`${k} = ?${sets.length + 1}`); vals.push(v); diff[k] = { was: row[k], now: v }; }
      if (sets.length === 0) return json({ ok: true, unchanged: true });
      sets.push("updated_at = datetime('now')"); vals.push(id);
      await env.DB.prepare(`UPDATE sp_promotions SET ${sets.join(", ")} WHERE id = ?${vals.length}`).bind(...vals).run();
      await audit(env, me, verified ? "sp.promotion_correct" : "sp.promotion_edit", "sp_promotions", id, { diff, reason });
      return json({ ok: true });
    }
    if (!promoM[2] && method === "DELETE") {
      if (verified && !manager) return err("locked", "A verified promotion is a permanent record", 403);
      await env.DB.prepare(`UPDATE sp_promotions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1`).bind(id).run();
      await audit(env, me, "sp.promotion_delete", "sp_promotions", id, { snapshot: row, reason: body?.reason ?? null });
      return json({ ok: true });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     OTHER SALES ACTIVITY - the few things that fit none of the above
     ════════════════════════════════════════════════════════════════════ */
  if (path === "/other" && method === "POST") {
    try {
      const u = str(body?.happened_at, 25) ? mytToUtc(body!.happened_at as string) : null;
      if (!u) return err("invalid_input", "When did this happen?", 400);
      if (!str(body?.action, 500) || !(body!.action as string).trim()) return err("invalid_input", "What did you do?", 400);
      const ev = body?.evidence_key ? await evidenceOk(body.evidence_key) : null;
      const res = await env.DB.prepare(
        `INSERT INTO sp_other_activities (user_id, happened_at, customer_name, product, action, result, evidence_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(me, u, str(body?.customer_name, 120) ? (body!.customer_name as string).trim() || null : null, str(body?.product, 120) ? (body!.product as string).trim() || null : null,
        (body!.action as string).trim(), str(body?.result, 500) ? (body!.result as string).trim() || null : null, ev).run();
      const id = String(res.meta.last_row_id);
      await audit(env, me, "sp.other_create", "sp_other_activities", id, { action: body!.action });
      return json({ ok: true, id: Number(id) }, 201);
    } catch (e) { const p = pending(e); if (p) return p; throw e; }
  }
  const otherM = path.match(/^\/other\/(\d+)(?:\/(verify))?$/);
  if (otherM) {
    const id = otherM[1]!;
    const row = await env.DB.prepare(`SELECT * FROM sp_other_activities WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>().catch(() => null);
    if (!row) return err("not_found", "Activity not found", 404);
    if (!owns(row as { user_id: number })) return err("forbidden", "Not your record", 403);
    if (otherM[2] === "verify" && method === "POST") {
      if (!manager) return err("forbidden", "Only management verifies", 403);
      if (Number(row.user_id) === me) return err("forbidden", "You cannot verify your own record", 403);
      const decision = String(body?.decision ?? "");
      if (!["verified", "rejected", "reported"].includes(decision)) return err("invalid_input", "decision must be verified, rejected or reported", 400);
      await env.DB.prepare(`UPDATE sp_other_activities SET status = ?1, verified_by = ?2, verified_at = datetime('now') WHERE id = ?3`).bind(decision, me, id).run();
      await audit(env, me, "sp.other_verify", "sp_other_activities", id, { was: row.status, now: decision });
      return json({ ok: true, status: decision });
    }
    if (!otherM[2] && method === "DELETE") {
      if (row.status === "verified" && !manager) return err("locked", "A verified activity is a permanent record", 403);
      await env.DB.prepare(`UPDATE sp_other_activities SET deleted_at = datetime('now') WHERE id = ?1`).bind(id).run();
      await audit(env, me, "sp.other_delete", "sp_other_activities", id, { snapshot: row });
      return json({ ok: true });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     SHIPMENTS - a postage record that names an invoice
     ════════════════════════════════════════════════════════════════════ */
  if (path === "/shipments" && method === "POST") {
    const ol = await orderLink(body?.order_doc_id);
    if ("error" in ol || ol.id === null) return err("invalid_input", "error" in ol ? ol.error : "A shipment must be linked to an order (invoice)", 400);
    const doc = await env.DB.prepare(`SELECT doc_number FROM sales_documents WHERE id = ?1`).bind(ol.id).first<{ doc_number: string }>();
    const status = String(body?.status ?? "preparing");
    if (!["preparing", "shipped", "in_transit", "delivered", "returned"].includes(status)) return err("invalid_input", "status must be preparing, shipped, in_transit, delivered or returned", 400);
    const tracking = str(body?.tracking_no, 120) ? (body!.tracking_no as string).trim() : "";
    if (SP_TRACKING_REQUIRED.includes(status) && !tracking) return err("tracking_required", "TRACKING UPDATE REQUIRED - a shipment cannot be marked shipped without its tracking number", 400);
    const dup = await env.DB.prepare(`SELECT id FROM postage_records WHERE order_ref = ?1 AND status != 'returned' LIMIT 1`).bind(doc!.doc_number).first<{ id: number }>();
    if (dup) return err("duplicate", `${doc!.doc_number} already has a shipment record (#${dup.id}) - update that one`, 409);
    const res = await env.DB.prepare(
      `INSERT INTO postage_records (order_ref, courier, tracking_no, status, note, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(doc!.doc_number, str(body?.courier, 80) ? (body!.courier as string).trim() || null : null, tracking || null, status, str(body?.note, 500) ? (body!.note as string).trim() || null : null, me).run();
    const id = String(res.meta.last_row_id);
    await audit(env, me, "sp.shipment_create", "postage_records", id, { order: doc!.doc_number, status, tracking: tracking || null });
    return json({ ok: true, id: Number(id) }, 201);
  }
  const shipM = path.match(/^\/shipments\/(\d+)$/);
  if (shipM && method === "PATCH") {
    const row = await env.DB.prepare(`SELECT * FROM postage_records WHERE id = ?1`).bind(shipM[1]).first<Record<string, unknown>>();
    if (!row) return err("not_found", "Shipment not found", 404);
    if (!manager && Number(row.updated_by) !== me) return err("forbidden", "Not your shipment", 403);
    const status = str(body?.status, 20) ? (body!.status as string) : String(row.status);
    if (!["preparing", "shipped", "in_transit", "delivered", "returned"].includes(status)) return err("invalid_input", "Bad status", 400);
    const tracking = str(body?.tracking_no, 120) ? (body!.tracking_no as string).trim() : String(row.tracking_no ?? "");
    if (SP_TRACKING_REQUIRED.includes(status) && !tracking) return err("tracking_required", "TRACKING UPDATE REQUIRED - a shipment cannot be marked shipped without its tracking number", 400);
    await env.DB.prepare(`UPDATE postage_records SET status = ?1, tracking_no = ?2, courier = COALESCE(?3, courier), note = COALESCE(?4, note), updated_by = ?5, updated_at = datetime('now') WHERE id = ?6`)
      .bind(status, tracking || null, str(body?.courier, 80) ? (body!.courier as string).trim() : null, str(body?.note, 500) ? (body!.note as string).trim() : null, me, shipM[1]).run();
    await audit(env, me, "sp.shipment_update", "postage_records", shipM[1]!, { was: { status: row.status, tracking_no: row.tracking_no }, now: { status, tracking_no: tracking || null } });
    return json({ ok: true });
  }

  /* ════════════════════════════════════════════════════════════════════
     DAILY CLOSING - the system's numbers, the person's words
     ════════════════════════════════════════════════════════════════════ */
  if (path === "/closing" && method === "POST") {
    try {
      const day = validDay(body?.day) ? (body!.day as string) : mytToday();
      if (day > mytToday()) return err("invalid_input", "You cannot close a day that has not happened", 400);
      const settings = await readSettings(env);
      const figs = await figuresFor(env, [me], day, day, settings);
      const f = figs.get(me) ?? zero();
      const s = scoreOf(f, settings, 1);
      const noActivity = f.present && f.verified_activities === 0;
      const reason = str(body?.no_activity_reason, 1000) ? (body!.no_activity_reason as string).trim() : "";
      if (noActivity && !reason) return err("explanation_required", "NO VERIFIED SALES ACTIVITY - please explain why no verified sales activity was recorded today before closing.", 400);
      if (!str(body?.main_achievement, 1000) || !(body!.main_achievement as string).trim()) return err("invalid_input", "What was the main achievement today?", 400);
      if (!str(body?.plan_tomorrow, 1000) || !(body!.plan_tomorrow as string).trim()) return err("invalid_input", "What is tomorrow's sales plan?", 400);
      const snapshot = { figures: f, score: s.score, band: s.band.code, components: s.components, no_verified_activity: noActivity, taken_at: new Date().toISOString() };
      const text = (k: string) => str(body?.[k], 2000) ? (body![k] as string).trim() || null : null;
      await env.DB.prepare(
        `INSERT INTO sp_daily_closings (user_id, day, snapshot, main_achievement, blockers, follow_up_tomorrow, plan_tomorrow, remarks, no_activity_reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(user_id, day) DO UPDATE SET snapshot = ?3, main_achievement = ?4, blockers = ?5, follow_up_tomorrow = ?6, plan_tomorrow = ?7, remarks = ?8, no_activity_reason = ?9, updated_at = datetime('now')`,
      ).bind(me, day, JSON.stringify(snapshot), text("main_achievement"), text("blockers"), text("follow_up_tomorrow"), text("plan_tomorrow"), text("remarks"), reason || null).run();
      await audit(env, me, "sp.closing_submit", "sp_daily_closings", `${me}:${day}`, { day, score: s.score, no_verified_activity: noActivity });
      return json({ ok: true, day, snapshot });
    } catch (e) { const p = pending(e); if (p) return p; throw e; }
  }
  if (path === "/closing/preview" && method === "GET") {
    try {
      const day = validDay(params.get("day")) ? (params.get("day") as string) : mytToday();
      const settings = await readSettings(env);
      const f = (await figuresFor(env, [me], day, day, settings)).get(me) ?? zero();
      const s = scoreOf(f, settings, 1);
      return json({ day, figures: f, score: s.score, band: s.band, no_verified_activity: f.present && f.verified_activities === 0 });
    } catch (e) { const p = pending(e); if (p) return p; throw e; }
  }

  /* ════════════════════════════════════════════════════════════════════
     MANAGEMENT - approved accounts, targets, audit history
     ════════════════════════════════════════════════════════════════════ */
  if (path === "/accounts" && method === "POST") {
    if (!manager) return err("forbidden", "Only management configures approved accounts", 403);
    const platform = String(body?.platform ?? "");
    if (!SP_PLATFORMS.some(([k]) => k === platform) || platform === "other") return err("invalid_input", "Pick TikTok, Instagram, Facebook or WhatsApp", 400);
    const handle = normalizeHandle(String(body?.handle ?? ""));
    if (!handle || handle.length > 80) return err("invalid_input", "The account handle is required", 400);
    try {
      const r = await env.DB.prepare(`INSERT INTO sp_social_accounts (platform, handle, label, created_by) VALUES (?1, ?2, ?3, ?4)`).bind(platform, handle, str(body?.label, 80) ? (body!.label as string).trim() || null : null, me).run();
      await audit(env, me, "sp.account_add", "sp_social_accounts", String(r.meta.last_row_id), { platform, handle });
      return json({ ok: true, id: r.meta.last_row_id, handle }, 201);
    } catch (e) { if (String(e).includes("UNIQUE")) return err("duplicate", `@${handle} is already on the ${platform} list`, 409); const p = pending(e); if (p) return p; throw e; }
  }
  const accM = path.match(/^\/accounts\/(\d+)$/);
  if (accM && method === "DELETE") {
    if (!manager) return err("forbidden", "Only management configures approved accounts", 403);
    const row = await env.DB.prepare(`SELECT platform, handle FROM sp_social_accounts WHERE id = ?1`).bind(accM[1]).first<{ platform: string; handle: string }>();
    if (!row) return err("not_found", "Account not found", 404);
    await env.DB.prepare(`UPDATE sp_social_accounts SET is_active = 0 WHERE id = ?1`).bind(accM[1]).run();
    await audit(env, me, "sp.account_remove", "sp_social_accounts", accM[1]!, row);
    return json({ ok: true });
  }
  if (path === "/settings" && method === "PUT") {
    if (!manager) return err("forbidden", "Only management sets targets", 403);
    const cur = await readSettings(env);
    const next: SpSettings = { ...cur, targets: { ...cur.targets } };
    const rm = (v: unknown): number | null => { if (v === null || v === "" || v === undefined) return null; const c = Math.round(Number(v) * 100); return Number.isFinite(c) && c >= 0 && c <= 100_000_000 ? c : null; };
    if (body && "default_target_rm" in body) next.default_target_cents = rm(body.default_target_rm);
    if (body && typeof body.targets_rm === "object" && body.targets_rm) {
      for (const [k, v] of Object.entries(body.targets_rm as Record<string, unknown>)) {
        if (!/^\d+$/.test(k)) continue;
        const c = rm(v); if (c === null || c === 0) delete next.targets[k]; else next.targets[k] = c;
      }
    }
    for (const k of ["engagement_target", "posts_target", "activity_target"] as const) {
      if (body && k in body) { const n = Math.round(Number(body[k])); if (Number.isFinite(n) && n >= 1 && n <= 1000) next[k] = n; }
    }
    await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`).bind(SETTINGS_KEY, JSON.stringify(next)).run();
    await audit(env, me, "sp.settings_set", "system_meta", SETTINGS_KEY, { was: cur, now: next });
    return json({ ok: true, settings: next });
  }
  if (path === "/audit" && method === "GET") {
    if (!manager) return err("forbidden", "Only management reads the audit history", 403);
    const entity = params.get("entity") ?? "";
    const id = params.get("id") ?? "";
    if (!/^(sp_social_posts|sp_engagements|sp_promotions|sp_other_activities|sp_daily_closings|postage_records|sp_social_accounts|system_meta)$/.test(entity) || !id) return err("invalid_input", "entity and id are required", 400);
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.action, a.detail, a.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = ?1 AND a.entity_id = ?2 ORDER BY a.id DESC LIMIT 100`,
    ).bind(entity, id).all();
    return json({ history: results ?? [] });
  }

  return err("not_found", "No such Sales Performance route", 404);
}

/* ── the link probe: is the post still there? ──────────────────────────── */
async function probeUrl(url: string): Promise<number> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "text/html" } });
    clearTimeout(t);
    return res.status;
  } catch { return 0; }
}

/** The daily re-check (09:00 MYT tick): a verified post that has gone (404/410)
    becomes POST UNAVAILABLE - record kept, flagged for review. At most 15 a
    day, oldest check first, so the tick never spends its subrequests here. */
export async function spRecheckPosts(env: Env): Promise<{ checked: number; unavailable: number }> {
  let checked = 0, unavailable = 0;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, url, user_id FROM sp_social_posts WHERE deleted_at IS NULL AND status = 'verified' AND (last_check_at IS NULL OR last_check_at < datetime('now', '-3 days'))
        ORDER BY COALESCE(last_check_at, '1970') ASC LIMIT 15`,
    ).all<{ id: number; url: string; user_id: number }>();
    for (const p of results ?? []) {
      const http = await probeUrl(p.url);
      checked += 1;
      const gone = http === 404 || http === 410;
      await env.DB.prepare(`UPDATE sp_social_posts SET last_check_at = datetime('now'), last_check_http = ?1, status = ?2, updated_at = datetime('now') WHERE id = ?3`)
        .bind(http, gone ? "unavailable" : "verified", p.id).run();
      if (gone) { unavailable += 1; await audit(env, 0, "sp.post_unavailable", "sp_social_posts", String(p.id), { http, url: p.url }); }
    }
  } catch { /* pre-0127 */ }
  return { checked, unavailable };
}
