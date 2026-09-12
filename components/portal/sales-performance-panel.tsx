"use client";

/**
 * SALES PERFORMANCE - one tab, one page, the command centre. v1.155.0.
 *
 * The CEO, 11-09-2026: *"I need a system where I can confidently answer:
 * 'Did this staff member actually work on sales today?' without relying only
 * on what they claim."* And, three times in the same brief: ONE sidebar tab,
 * ONE page, no sub-tabs, no sub-pages. Forms open as drawers over the page;
 * the page itself is collapsible sections in the order he gave them:
 *
 *   KPI summary -> Today's sales activity -> Social media -> Customer
 *   engagement -> Promotion & campaign -> Customer orders -> Shipment &
 *   tracking -> Sales funnel -> Performance trend -> Daily closing.
 *
 * NOTHING IS DECIDED HERE. Every figure, every score, every status and every
 * flag on this page came from worker/src/sales-performance.ts in ONE read
 * (/overview). The browser filters nothing it was not sent and adds nothing
 * up; the one thing it computes is the courtesy pre-check on a pasted post
 * URL (lib/sales-performance.ts, the worker's own rules, so the typist hears
 * "Platform mismatch" before pressing Save - the worker says it again).
 *
 * WHAT A STAFF MEMBER SEES: their own rows, their own score, their own
 * closing. WHAT MANAGEMENT SEES (can_manage from the API, never a role check
 * here): the team's KPIs, the per-staff table, everyone's rows, Verify /
 * Reject on each, corrections with a reason, the approved-accounts list,
 * targets, and the audit history of any record.
 *
 * Every string is L(en, ms). Every surface is from lib/ui-styles. Every
 * mutation toasts. Every fetch has a skeleton. Every dialog node sits at the
 * panel's top level, outside any collapsed body. No emoji - AppIcon.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { makeApi, csrfFetch } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Skel, SkelRows, SkelStat, StaleHint } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger, rowBtnPrimary, rowActions } from "@/components/ui/row-button";
import {
  card, insetCard, modalCard, inputClass, inputClassSm, selectClass, fieldLabel, btnClass, btnGhost, btnSm, btnSmPrimary,
  th, td, thR2, tdR2, chipSmNeutral, chipSmSuccess, chipSmWarn, chipSmDanger, chipSmInfo, listRow, tabPill, tabPillOn,
} from "@/lib/ui-styles";
import { StatTile } from "@/components/ui/stat-tile";
import { MiniBar } from "@/components/ui/stat-card";
import { AppIcon, PanelTitle, type AppIconName } from "@/components/ui/app-icon";
import { ZoneLabel, mytDateTime } from "@/components/portal/page-shared";
import { useCachedApi } from "@/lib/cached-api";
import { getLang } from "@/lib/i18n";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { compressImage } from "@/lib/compress-image";
import {
  SP_PLATFORMS, SP_CHANNELS, SP_INTERACTIONS, SP_PROMO_TYPES, SP_ACTIVITY_TYPES, SP_TRACKING, SP_TRACKING_REQUIRED,
  SP_WEIGHTS, spLabel, readSocialUrl, type SpComponent,
} from "@/lib/sales-performance";

const api = makeApi("/staff/sales-performance");
const EVIDENCE_URL = "/api/v1/staff/sales-performance/evidence";
/* v1.155.1 - THE SHAPE OF THE REMEMBERED READ. useCachedApi draws the last
   answer it saved for a path BEFORE it refetches (lib/cached-api.ts, 24 h
   TTL). The CEO's screenshot, 12-09-2026, "Cannot read properties of
   undefined (reading 'length')": the page had been opened on the first cut
   of 1.155.0, that answer was remembered, and the second cut - which added
   the tiktok_orders list - read `.length` off a field the remembered answer
   never had. The error boundary then re-mounted the same remembered answer
   on "Try again", so it could not heal itself until the TTL ran out.
   Two defences, both required: the read is keyed with this SHAPE number, so
   a new page never draws an old cut's answer; and normalizeOverview() fills
   every list and figure a remembered answer might lack, so a missing field
   is an empty list, never a crash. The worker ignores `v`. */
const SHAPE = 2;
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const lbl = (list: readonly (readonly [string, string, string])[], code: string | null | undefined) => spLabel(list, String(code ?? ""), getLang());
const TOPICS = ["sales-performance", "docs", "postage"];

/* ---- what the API sends (worker/src/sales-performance.ts /overview) ---- */
interface Figures {
  sales_cents: number; invoice_cents: number; tiktok_cents: number; tiktok_orders: number; paid_cents: number; orders: number; orders_completed: number; orders_pending: number;
  interactions: number; unique_customers: number; inquiries: number; follow_ups_done: number; follow_ups_overdue: number; follow_ups_due: number;
  conversions: number; conversion_rate: number;
  posts_verified: number; posts_reported: number; posts_flagged: number; reach: number; social_engagement: number; leads: number;
  shipments: number; shipped: number; tracking_updated: number; delivered: number; shipments_pending: number; tracking_required: number;
  promotions_active: number; promotions_executed: number;
  other_activities: number; activities_total: number; verified_activities: number;
  present: boolean; target_cents: number | null;
}
interface Band { code: "excellent" | "good" | "needs_improvement" | "poor"; en: string; ms: string }
interface Busy { activity: number; engagement: number; conversion: number; revenue: number; verdict: "low_sales" | "balanced" | "strong" }
interface Person { id: number; name: string; role: string }
interface PerStaff extends Person {
  figures: Figures; components: Record<SpComponent, number>; score: number; band: Band; busy: Busy;
  target_cents: number | null; no_target: boolean; no_verified_activity: boolean;
}
interface TrendRow { sales_cents: number; tiktok_cents: number; orders: number; engagement: number; leads: number; follow_ups: number; posts_verified: number; conversion_rate: number; score: number }
interface Post {
  id: number; user_id: number; platform: string; url: string; account_handle: string | null; account_match: number; product: string | null; description: string | null;
  evidence_key: string | null; posted_at: string; submitted_at: string; status: string; flags: string | null;
  views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; metrics_status: string;
  promotion_id: number | null; verified_by: number | null; verified_at: string | null; verify_note: string | null; last_check_at: string | null; last_check_http: number | null;
  staff_name: string; verified_by_name: string | null; promotion_name: string | null;
}
interface Engagement {
  id: number; user_id: number; customer_id: number | null; customer_name: string; customer_phone: string | null; happened_at: string; channel: string; interaction_type: string;
  product: string | null; action_taken: string | null; follow_up_on: string | null; outcome: string | null; outcome_at: string | null; order_doc_id: number | null; notes: string | null;
  evidence_key: string | null; promotion_id: number | null; source_post_id: number | null; status: string; verified_by: number | null; verified_at: string | null;
  staff_name: string; order_number: string | null; order_cents: number | null; order_payment: string | null; promotion_name: string | null;
}
interface Promotion {
  id: number; name: string; product: string | null; platform: string | null; promo_type: string | null; start_on: string; end_on: string | null; user_id: number;
  customers_reached: number | null; result: string | null; notes: string | null; evidence_key: string | null; status: string; staff_name: string;
  posts_verified: number; posts_total: number; inquiries: number; orders: number; revenue_cents: number;
}
interface Other { id: number; user_id: number; happened_at: string; customer_name: string | null; product: string | null; action: string; result: string | null; evidence_key: string | null; status: string; staff_name: string }
interface Order {
  id: number; doc_number: string; created_at: string; total_cents: number; payment_status: string; paid_at: string | null; kind: string | null; delivery_status: string | null; items: string | null;
  user_id: number; customer_id: number; customer: string; staff_name: string; ship_status: string | null; tracking_no: string | null; linked_engagements: number;
}
interface TikTokOrder { id: number; order_ref: string; created_at: string; cents: number; status: string; tracking_no: string | null; courier: string | null; items_label: string | null; user_ids: number[]; staff_names: string[] }
interface Shipment { id: number; order_ref: string; courier: string | null; tracking_no: string | null; status: string; note: string | null; user_id: number; created_at: string; updated_at: string; staff_name: string; customer: string | null; order_doc_id: number | null }
interface Closing { id: number; user_id: number; day: string; snapshot: string; main_achievement: string | null; blockers: string | null; follow_up_tomorrow: string | null; plan_tomorrow: string | null; remarks: string | null; no_activity_reason: string | null; submitted_at: string; staff_name: string }
interface Account { id: number; platform: string; handle: string; label: string | null }
interface Customer { id: number; company: string; contact_person: string | null; phone: string | null }
interface Invoice { id: number; doc_number: string; total_cents: number; customer_id: number; company: string; created_at: string; salesperson_id: number }
interface Feed { at: string; user_id: number; staff_name: string; type: string; customer: string; product: string; action: string; result: string; sales_cents: number | null; evidence_key: string | null; verification: string; ref: string; id: number }
interface Settings { default_target_cents: number | null; targets: Record<string, number | null>; engagement_target: number; posts_target: number; activity_target: number }
interface Overview {
  me: number; can_manage: boolean; range: { from: string; to: string; label: string }; today: string; days: number;
  settings: Settings; staff: Person[];
  team: { figures: Figures; avg_score: number; band: Band; achievement_pct: number | null };
  per_staff: PerStaff[];
  trend: { today: TrendRow; yesterday: TrendRow; avg7: TrendRow; avg30: TrendRow };
  funnel: { posts: number; reach: number; engagement: number; inquiries: number; follow_ups: number; orders: number; revenue_cents: number };
  feed: Feed[]; posts: Post[]; engagements: Engagement[]; promotions: Promotion[]; others: Other[]; orders: Order[]; tiktok_orders: TikTokOrder[]; shipments: Shipment[]; closings: Closing[];
  accounts: Account[]; customers: Customer[]; invoices: Invoice[];
}
interface ClosingPreview { day: string; figures: Figures; score: number; band: Band; no_verified_activity: boolean }
/** set by normalizeOverview when the answer is missing fields this page reads */
interface Overview { stale_shape?: boolean }

const ZERO_FIGURES: Figures = {
  sales_cents: 0, invoice_cents: 0, tiktok_cents: 0, tiktok_orders: 0, paid_cents: 0, orders: 0, orders_completed: 0, orders_pending: 0,
  interactions: 0, unique_customers: 0, inquiries: 0, follow_ups_done: 0, follow_ups_overdue: 0, follow_ups_due: 0, conversions: 0, conversion_rate: 0,
  posts_verified: 0, posts_reported: 0, posts_flagged: 0, reach: 0, social_engagement: 0, leads: 0,
  shipments: 0, shipped: 0, tracking_updated: 0, delivered: 0, shipments_pending: 0, tracking_required: 0, promotions_active: 0, promotions_executed: 0,
  other_activities: 0, activities_total: 0, verified_activities: 0, present: false, target_cents: null,
};
const ZERO_TREND: TrendRow = { sales_cents: 0, tiktok_cents: 0, orders: 0, engagement: 0, leads: 0, follow_ups: 0, posts_verified: 0, conversion_rate: 0, score: 0 };
const ZERO_BAND: Band = { code: "poor", en: "Poor", ms: "Lemah" };
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const figs = (v: unknown): Figures => ({ ...ZERO_FIGURES, ...(v && typeof v === "object" ? (v as Partial<Figures>) : {}) });
/** a remembered answer from an older cut, or a fresh one - either way every
    field the page reads is present; nothing on this page reads `.length`
    off the API without passing through here */
function normalizeOverview(raw: Overview | null): Overview | null {
  if (!raw) return null;
  const tr = raw.trend ?? ({} as Overview["trend"]);
  return {
    ...raw,
    /* the answer predates the TikTok figures: the page still draws, and says
       so, rather than showing RM 0.00 of TikTok sales as though it were true */
    stale_shape: raw.tiktok_orders === undefined,
    settings: { ...{ default_target_cents: null, targets: {}, engagement_target: 10, posts_target: 3, activity_target: 12 } as Settings, ...(raw.settings ?? {}) },
    staff: arr<Person>(raw.staff),
    team: { figures: figs(raw.team?.figures), avg_score: raw.team?.avg_score ?? 0, band: raw.team?.band ?? ZERO_BAND, achievement_pct: raw.team?.achievement_pct ?? null },
    per_staff: arr<PerStaff>(raw.per_staff).map((r) => ({ ...r, figures: figs(r.figures), components: r.components ?? { sales: 0, engagement: 0, social: 0, follow_up: 0, orders: 0, shipment: 0, promotion: 0 }, band: r.band ?? ZERO_BAND, busy: r.busy ?? { activity: 0, engagement: 0, conversion: 0, revenue: 0, verdict: "balanced" } })),
    trend: { today: { ...ZERO_TREND, ...tr.today }, yesterday: { ...ZERO_TREND, ...tr.yesterday }, avg7: { ...ZERO_TREND, ...tr.avg7 }, avg30: { ...ZERO_TREND, ...tr.avg30 } },
    funnel: { ...{ posts: 0, reach: 0, engagement: 0, inquiries: 0, follow_ups: 0, orders: 0, revenue_cents: 0 } as Overview["funnel"], ...(raw.funnel ?? {}) },
    feed: arr<Feed>(raw.feed), posts: arr<Post>(raw.posts), engagements: arr<Engagement>(raw.engagements), promotions: arr<Promotion>(raw.promotions), others: arr<Other>(raw.others),
    orders: arr<Order>(raw.orders), tiktok_orders: arr<TikTokOrder>(raw.tiktok_orders).map((o) => ({ ...o, user_ids: arr<number>(o.user_ids), staff_names: arr<string>(o.staff_names) })),
    shipments: arr<Shipment>(raw.shipments), closings: arr<Closing>(raw.closings), accounts: arr<Account>(raw.accounts), customers: arr<Customer>(raw.customers), invoices: arr<Invoice>(raw.invoices),
    range: raw.range ?? { from: raw.today ?? "", to: raw.today ?? "", label: "today" },
  };
}
type Err = { ok?: boolean; error?: { code?: string; message?: string } };

/* ---- small shared pieces (module scope - render-stability guard) ---- */

/** "YYYY-MM-DDTHH:MM" in Malaysia time, for a datetime-local default */
function mytNowLocal(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16);
}
/** a UTC "YYYY-MM-DD HH:MM:SS" from the API -> the datetime-local value that shows it in MYT */
function utcToLocalInput(utc: string | null | undefined): string {
  if (!utc) return "";
  const t = Date.parse(`${utc.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? "" : new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16);
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const n0 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-MY"));

const BAND_CHIP: Record<Band["code"], string> = { excellent: chipSmSuccess, good: chipSmInfo, needs_improvement: chipSmWarn, poor: chipSmDanger };
const BAND_TONE: Record<Band["code"], "success" | "info" | "gold" | "danger"> = { excellent: "success", good: "info", needs_improvement: "gold", poor: "danger" };
const bandLabel = (b: Band) => (getLang() === "ms" ? b.ms : b.en);

/** a post's, an engagement's or a feed row's verification, as a chip */
function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string, string]> = {
    verified: [chipSmSuccess, "Verified", "Disahkan"],
    linked_order: [chipSmSuccess, "Linked to order", "Dipautkan ke pesanan"],
    system: [chipSmInfo, "System record", "Rekod sistem"],
    pending: [chipSmWarn, "Pending verification", "Menunggu pengesahan"],
    reported: [chipSmNeutral, "Reported - unverified", "Dilaporkan - belum disahkan"],
    rejected: [chipSmDanger, "Rejected", "Ditolak"],
    evidence_invalid: [chipSmDanger, "Evidence invalid", "Bukti tidak sah"],
    manual_review: [chipSmWarn, "Manual verification required", "Pengesahan manual diperlukan"],
    duplicate: [chipSmDanger, "Duplicate", "Pendua"],
    old_post: [chipSmWarn, "Old post - review", "Pos lama - semakan"],
    unavailable: [chipSmDanger, "Post unavailable", "Pos tidak tersedia"],
  };
  const m = map[status] ?? [chipSmNeutral, status, status];
  return <span className={m[0]}>{L(m[1], m[2])}</span>;
}

/** a shipment status, as a chip - the tracking-required flag beside it when it applies */
function ShipChip({ status, tracking }: { status: string | null; tracking: string | null }) {
  if (!status) return <span className={chipSmNeutral}>{L("No shipment yet", "Belum ada penghantaran")}</span>;
  const cls = status === "delivered" ? chipSmSuccess : status === "returned" ? chipSmDanger : status === "preparing" ? chipSmNeutral : chipSmInfo;
  const needs = SP_TRACKING_REQUIRED.includes(status) && !tracking;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cls}>{lbl(SP_TRACKING, status)}</span>
      {needs && <span className={chipSmDanger}>{L("TRACKING UPDATE REQUIRED", "KEMAS KINI PENJEJAKAN DIPERLUKAN")}</span>}
    </span>
  );
}

/** the evidence screenshot, as a small thumbnail that opens the full image */
function Evidence({ evidenceKey, className = "" }: { evidenceKey: string | null | undefined; className?: string }) {
  if (!evidenceKey) return <span className="text-muted-foreground text-[11px]">{L("no screenshot", "tiada tangkapan skrin")}</span>;
  const src = `${EVIDENCE_URL}?key=${encodeURIComponent(evidenceKey)}`;
  return (
    <a href={src} target="_blank" rel="noreferrer" className={`inline-block ${className}`} title={L("Open the screenshot", "Buka tangkapan skrin")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={L("Evidence screenshot", "Tangkapan skrin bukti")} className="border-border h-10 w-10 rounded-md border object-cover" loading="lazy" />
    </a>
  );
}

/** One collapsible section of the page. The header is one line - title, a
    summary of what is inside, a count - and stays informative when closed,
    so the whole page can be read collapsed. Module scope. */
function Section({ id, icon, title, summary, count, open, onToggle, action, children }: {
  id: string; icon: AppIconName; title: string; summary?: ReactNode; count?: number; open: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section id={id} className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
          <AppIcon name={icon} className="text-muted-foreground shrink-0" />
          <span className="min-w-0">
            <span className="text-sm font-semibold">{title}{count != null && <span className="text-muted-foreground ml-1.5 font-normal tabular-nums">{count}</span>}</span>
            {summary && <span className="text-muted-foreground mt-0.5 block truncate text-xs">{summary}</span>}
          </span>
          <span aria-hidden className={`text-muted-foreground ml-auto shrink-0 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {open && <div id={`${id}-body`} className="mt-3">{children}</div>}
    </section>
  );
}

/** The drawer every form opens in - a modal panel over the page (the CEO:
    forms in modals/drawers, never a second page). Scrolls inside itself. */
function Drawer({ title, sub, onClose, wide = false, children }: { title: string; sub?: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`${modalCard} max-h-[92vh] overflow-y-auto overscroll-contain rounded-b-none pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:pb-6 ${wide ? "sm:max-w-2xl" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">{title}</p>
            {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
          </div>
          <button type="button" className={`${btnSm} h-8 w-8 justify-center px-0`} aria-label={L("Close", "Tutup")} onClick={onClose}><AppIcon name="blocked" className="h-4 w-4" /></button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** Upload a screenshot: compressed in the browser, sent raw, stored in R2,
    the key handed back for the record. Mandatory for a post; optional for
    the rest - the worker decides, this only makes the upload possible. */
function EvidenceUpload({ value, onChange, required, toast }: {
  value: string | null; onChange: (key: string | null) => void; required?: boolean;
  toast: (title: string, sub?: string, variant?: "success" | "notice") => void;
}) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file);
      const ct = blob.type || file.type || "image/jpeg";
      if (!/^image\/(jpeg|png|webp)$/.test(ct)) { toast(L("Not uploaded", "Tidak dimuat naik"), L("Use a JPEG, PNG or WebP screenshot", "Guna tangkapan skrin JPEG, PNG atau WebP"), "notice"); return; }
      if (blob.size > 8 * 1024 * 1024) { toast(L("Not uploaded", "Tidak dimuat naik"), L("Screenshot is over 8 MB", "Tangkapan skrin melebihi 8 MB"), "notice"); return; }
      const res = await csrfFetch(EVIDENCE_URL, { method: "POST", headers: { "Content-Type": ct }, body: blob });
      const data = (await res.json().catch(() => null)) as { key?: string; error?: { message?: string } } | null;
      if (!res.ok || !data?.key) { toast(L("Not uploaded", "Tidak dimuat naik"), data?.error?.message ?? L("Please try again", "Sila cuba lagi"), "notice"); return; }
      onChange(data.key);
      toast(L("Screenshot attached", "Tangkapan skrin dilampirkan"));
    } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <div>
      <span className={fieldLabel}>{L("Screenshot", "Tangkapan skrin")}{required ? " *" : ""}</span>
      <div className="flex flex-wrap items-center gap-2">
        {value ? <Evidence evidenceKey={value} /> : <span className="border-border text-muted-foreground inline-flex h-10 w-10 items-center justify-center rounded-md border border-dashed"><AppIcon name="attach" className="h-4 w-4" /></span>}
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        <button type="button" className={btnSm} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Skel className="inline-block h-3 w-14" /> : value ? L("Replace", "Ganti") : L("Upload screenshot", "Muat naik tangkapan skrin")}
        </button>
        {value && !required && <button type="button" className="text-muted-foreground text-xs underline" onClick={() => onChange(null)}>{L("Remove", "Buang")}</button>}
      </div>
      {required && <p className="text-muted-foreground mt-1 text-[11px]">{L("No screenshot, no submission - the post must be shown, not described.", "Tiada tangkapan skrin, tiada penghantaran - pos mesti ditunjukkan, bukan digambarkan.")}</p>}
    </div>
  );
}

/** a labelled field - the one wrapper every form uses */
function Field({ label, hint, children, span = false }: { label: string; hint?: string; children: ReactNode; span?: boolean }) {
  return (
    <label className={`block ${span ? "md:col-span-2" : ""}`}>
      <span className={fieldLabel}>{label}</span>
      {children}
      {hint && <span className="text-muted-foreground mt-0.5 block text-[11px]">{hint}</span>}
    </label>
  );
}

/** the reason a manager must give to touch a verified record */
function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field span label={L("Reason for correcting a verified record *", "Sebab pembetulan rekod yang disahkan *")}
      hint={L("Kept in the audit log with the previous and the new value of every field that changed.", "Disimpan dalam log audit bersama nilai sebelum dan selepas bagi setiap medan yang berubah.")}>
      <input className={inputClass} value={value} maxLength={300} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

const say = (r: { ok: boolean; data: Err | null }, fallback: string) => r.data?.error?.message ?? fallback;

/* ================= THE FORMS (each opens in the Drawer) ================= */

type Toast = (title: string, sub?: string, variant?: "success" | "notice") => void;

/** A social post: the URL is read as it is typed (lib/sales-performance.ts,
    the worker's own rules) so the platform, the account and a mismatch show
    before Save. The worker reads it again and its answer is the one kept. */
function PostForm({ ov, presetPlatform, edit, onDone, toast }: { ov: Overview; presetPlatform?: string; edit?: Post; onDone: () => void; toast: Toast }) {
  const manager = ov.can_manage;
  const locked = edit?.status === "verified";
  const [platform, setPlatform] = useState(edit?.platform ?? presetPlatform ?? "tiktok");
  const [url, setUrl] = useState(edit?.url ?? "");
  const [product, setProduct] = useState(edit?.product ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [postedAt, setPostedAt] = useState(edit ? utcToLocalInput(edit.posted_at) : mytNowLocal());
  const [promotion, setPromotion] = useState(edit?.promotion_id ? String(edit.promotion_id) : "");
  const [metrics, setMetrics] = useState({ views: n0s(edit?.views), likes: n0s(edit?.likes), comments: n0s(edit?.comments), shares: n0s(edit?.shares), saves: n0s(edit?.saves) });
  const [evidence, setEvidence] = useState<string | null>(edit?.evidence_key ?? null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const info = useMemo(() => readSocialUrl(url), [url]);
  const mismatch = info.ok && platform !== "other" && info.platform !== platform;
  const approved = info.ok && info.handle ? ov.accounts.some((a) => a.platform === platform && a.handle === info.handle) : null;
  const canEditCore = !edit || manager; // URL, date and evidence never move by the author once submitted

  const save = async () => {
    if (!edit) {
      if (!info.ok) { toast(L("Not saved", "Tidak disimpan"), info.reason ?? L("Invalid URL", "URL tidak sah"), "notice"); return; }
      if (mismatch) { toast(L("Not saved", "Tidak disimpan"), L("Platform mismatch. Please submit the correct social media post URL.", "Platform tidak sepadan. Sila hantar URL pos media sosial yang betul."), "notice"); return; }
      if (!evidence) { toast(L("Not saved", "Tidak disimpan"), L("A screenshot of the post is required", "Tangkapan skrin pos diperlukan"), "notice"); return; }
    }
    if (!product.trim()) { toast(L("Not saved", "Tidak disimpan"), L("Which product was promoted?", "Produk apa yang dipromosikan?"), "notice"); return; }
    if (!description.trim()) { toast(L("Not saved", "Tidak disimpan"), L("Describe the post", "Terangkan pos itu"), "notice"); return; }
    if (locked && !reason.trim()) { toast(L("Not saved", "Tidak disimpan"), L("A reason is required to correct a verified record", "Sebab diperlukan untuk membetulkan rekod yang disahkan"), "notice"); return; }
    setSaving(true);
    const m = Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v === "" ? null : Number(v)]));
    const body: Record<string, unknown> = { product: product.trim(), description: description.trim(), promotion_id: promotion || null, ...m };
    if (canEditCore) { body.platform = platform; body.url = url.trim(); body.posted_at = postedAt; body.evidence_key = evidence; }
    if (locked) body.reason = reason.trim();
    const r = edit
      ? await api<Err>(`/posts/${edit.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await api<Err & { status?: string; flags?: string[] }>(`/posts`, { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    const st = (r.data as { status?: string } | null)?.status;
    toast(edit ? L("Post updated", "Pos dikemas kini") : L("Post submitted", "Pos dihantar"),
      st === "pending" ? L("Pending verification by management", "Menunggu pengesahan pengurusan")
        : st === "manual_review" ? L("The account is not on the approved list - manual verification required", "Akaun tidak ada dalam senarai yang diluluskan - pengesahan manual diperlukan")
        : st === "old_post" ? L("Posted before today - flagged OLD POST for management review", "Dipos sebelum hari ini - ditanda POS LAMA untuk semakan pengurusan") : "");
    onDone();
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={L("Platform *", "Platform *")}>
        <select className={inputClass} value={platform} disabled={!canEditCore} onChange={(e) => setPlatform(e.target.value)}>
          {SP_PLATFORMS.map(([k]) => <option key={k} value={k}>{lbl(SP_PLATFORMS, k)}</option>)}
        </select>
      </Field>
      <Field label={L("Post URL *", "URL pos *")} hint={
        !url ? L("Paste the post's own link, starting with https://", "Tampal pautan pos itu sendiri, bermula dengan https://")
          : !info.ok ? (info.reason ?? "")
          : mismatch ? L(`Platform mismatch - the link is ${lbl(SP_PLATFORMS, info.platform)}, the platform above says ${lbl(SP_PLATFORMS, platform)}.`, `Platform tidak sepadan - pautan ini ${lbl(SP_PLATFORMS, info.platform)}, platform di atas ialah ${lbl(SP_PLATFORMS, platform)}.`)
          : info.handle ? (approved ? L(`Account @${info.handle} - approved company account`, `Akaun @${info.handle} - akaun syarikat yang diluluskan`) : L(`Account @${info.handle} is not on the approved list - management will verify by hand`, `Akaun @${info.handle} tiada dalam senarai yang diluluskan - pengurusan akan mengesahkan secara manual`))
          : L("The link does not name the account - management will verify by hand", "Pautan tidak menamakan akaun - pengurusan akan mengesahkan secara manual")}>
        <input className={`${inputClass} ${url && (!info.ok || mismatch) ? "border-danger" : ""}`} value={url} disabled={!canEditCore} placeholder="https://www.tiktok.com/@a2z/video/7350000000000000000" inputMode="url" onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label={L("Product promoted *", "Produk dipromosikan *")}><input className={inputClass} value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} /></Field>
      <Field label={L("Posted on *", "Dipos pada *")} hint={L("The post's own date and time, not now - a post older than yesterday is flagged.", "Tarikh dan masa pos itu sendiri, bukan sekarang - pos lebih lama daripada semalam ditanda.")}>
        <input type="datetime-local" className={inputClass} value={postedAt} max={mytNowLocal()} disabled={!canEditCore} onChange={(e) => setPostedAt(e.target.value)} />
      </Field>
      <Field span label={L("Description *", "Penerangan *")}>
        <textarea className={`${inputClass} min-h-20 resize-y whitespace-pre-line`} rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={L("Part of a promotion", "Sebahagian promosi")}>
        <select className={inputClass} value={promotion} onChange={(e) => setPromotion(e.target.value)}>
          <option value="">{L("— none —", "— tiada —")}</option>
          {ov.promotions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <div className="md:col-span-2">
        <span className={fieldLabel}>{L("Engagement metrics (reported - management verifies against the screenshot)", "Metrik penglibatan (dilaporkan - pengurusan sahkan dengan tangkapan skrin)")}</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {(["views", "likes", "comments", "shares", "saves"] as const).map((k) => (
            <label key={k} className="block"><span className="text-muted-foreground block text-[10px] uppercase">{L(k, { views: "tontonan", likes: "suka", comments: "komen", shares: "kongsi", saves: "simpan" }[k])}</span>
              <input type="number" inputMode="numeric" min={0} className={inputClassSm + " w-full"} value={metrics[k]} onChange={(e) => setMetrics((m) => ({ ...m, [k]: e.target.value }))} /></label>
          ))}
        </div>
      </div>
      <div className="md:col-span-2">
        {canEditCore ? <EvidenceUpload value={evidence} onChange={setEvidence} required toast={toast} /> : <div className="flex items-center gap-2"><span className={fieldLabel}>{L("Screenshot", "Tangkapan skrin")}</span><Evidence evidenceKey={evidence} /><span className="text-muted-foreground text-[11px]">{L("locked after submission", "dikunci selepas penghantaran")}</span></div>}
      </div>
      {locked && <ReasonField value={reason} onChange={setReason} />}
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : edit ? L("Save changes", "Simpan perubahan") : L("Submit post", "Hantar pos")}</button>
        <button type="button" className={btnGhost} onClick={onDone}>{L("Cancel", "Batal")}</button>
        {!edit && <span className="text-muted-foreground text-[11px]">{L("Counts toward KPI only once management verifies it.", "Dikira dalam KPI hanya selepas pengurusan mengesahkannya.")}</span>}
      </div>
    </div>
  );
}
const n0s = (v: number | null | undefined) => (v == null ? "" : String(v));

/** A customer engagement - what the staff member says happened. A
    conversion is not a checkbox: it is the invoice picked below. */
function EngagementForm({ ov, preset, edit, onDone, toast }: { ov: Overview; preset?: { channel?: string; interaction_type?: string }; edit?: Engagement; onDone: () => void; toast: Toast }) {
  const manager = ov.can_manage;
  const locked = !!edit && (edit.status === "verified" || edit.order_doc_id != null);
  const [customerId, setCustomerId] = useState(edit?.customer_id ? String(edit.customer_id) : "");
  const [customerName, setCustomerName] = useState(edit?.customer_name ?? "");
  const [phone, setPhone] = useState(edit?.customer_phone ?? "");
  const [happenedAt, setHappenedAt] = useState(edit ? utcToLocalInput(edit.happened_at) : mytNowLocal());
  const [channel, setChannel] = useState(edit?.channel ?? preset?.channel ?? "whatsapp");
  const [type, setType] = useState(edit?.interaction_type ?? preset?.interaction_type ?? "new_inquiry");
  const [product, setProduct] = useState(edit?.product ?? "");
  const [action, setAction] = useState(edit?.action_taken ?? "");
  const [followUp, setFollowUp] = useState(edit?.follow_up_on ?? "");
  const [outcome, setOutcome] = useState(edit?.outcome ?? "");
  const [orderId, setOrderId] = useState(edit?.order_doc_id ? String(edit.order_doc_id) : "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [promotion, setPromotion] = useState(edit?.promotion_id ? String(edit.promotion_id) : "");
  const [evidence, setEvidence] = useState<string | null>(edit?.evidence_key ?? null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = ov.customers.find((x) => String(x.id) === id);
    if (c) { setCustomerName(c.company); if (c.phone && !phone) setPhone(c.phone); }
  };
  const save = async () => {
    if (!customerId && !customerName.trim()) { toast(L("Not saved", "Tidak disimpan"), L("Who is the customer?", "Siapa pelanggannya?"), "notice"); return; }
    if (!action.trim()) { toast(L("Not saved", "Tidak disimpan"), L("What action did you take?", "Apa tindakan yang anda ambil?"), "notice"); return; }
    if (locked && !reason.trim()) { toast(L("Not saved", "Tidak disimpan"), L("A reason is required to correct a verified record", "Sebab diperlukan untuk membetulkan rekod yang disahkan"), "notice"); return; }
    setSaving(true);
    const body: Record<string, unknown> = {
      customer_id: customerId || null, customer_name: customerName.trim(), customer_phone: phone.trim() || null, happened_at: happenedAt, channel, interaction_type: type,
      product: product.trim() || null, action_taken: action.trim(), follow_up_on: followUp || null, outcome: outcome.trim() || null, order_doc_id: orderId || null,
      notes: notes.trim() || null, promotion_id: promotion || null, evidence_key: evidence,
    };
    if (locked) body.reason = reason.trim();
    const r = edit ? await api<Err>(`/engagements/${edit.id}`, { method: "PATCH", body: JSON.stringify(body) }) : await api<Err>(`/engagements`, { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(edit ? L("Engagement updated", "Penglibatan dikemas kini") : L("Engagement recorded", "Penglibatan direkodkan"), orderId ? L("Linked to the order - counts as a conversion", "Dipautkan ke pesanan - dikira sebagai penukaran") : L("Reported - management may verify it", "Dilaporkan - pengurusan boleh mengesahkannya"));
    onDone();
  };
  const invoices = ov.invoices.filter((i) => manager || i.salesperson_id === ov.me);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={L("Customer (existing)", "Pelanggan (sedia ada)")}>
        <select className={inputClass} value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
          <option value="">{L("— or type a name below —", "— atau taip nama di bawah —")}</option>
          {ov.customers.map((c) => <option key={c.id} value={c.id}>{c.company}{c.contact_person ? ` · ${c.contact_person}` : ""}</option>)}
        </select>
      </Field>
      <Field label={L("Customer name *", "Nama pelanggan *")}><input className={inputClass} value={customerName} maxLength={120} onChange={(e) => setCustomerName(e.target.value)} /></Field>
      <Field label={L("Phone", "Telefon")} hint={L("The same phone is the same customer, however the name is typed.", "Telefon yang sama ialah pelanggan yang sama, walau bagaimana nama ditaip.")}><input className={inputClass} value={phone} maxLength={40} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label={L("When *", "Bila *")}><input type="datetime-local" className={inputClass} value={happenedAt} max={mytNowLocal()} onChange={(e) => setHappenedAt(e.target.value)} /></Field>
      <Field label={L("Channel *", "Saluran *")}>
        <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)}>{SP_CHANNELS.map(([k]) => <option key={k} value={k}>{lbl(SP_CHANNELS, k)}</option>)}</select>
      </Field>
      <Field label={L("Interaction type *", "Jenis interaksi *")}>
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>{SP_INTERACTIONS.map(([k]) => <option key={k} value={k}>{lbl(SP_INTERACTIONS, k)}</option>)}</select>
      </Field>
      <Field label={L("Product", "Produk")}><input className={inputClass} value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} /></Field>
      <Field label={L("Follow-up date", "Tarikh susulan")} hint={L("Past this date with no outcome recorded = OVERDUE.", "Lepas tarikh ini tanpa hasil direkodkan = TERTUNGGAK.")}><input type="date" className={inputClass} value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>
      <Field span label={L("Action taken *", "Tindakan diambil *")}><textarea className={`${inputClass} min-h-16 resize-y whitespace-pre-line`} rows={2} maxLength={500} value={action} onChange={(e) => setAction(e.target.value)} /></Field>
      <Field label={L("Outcome", "Hasil")}><input className={inputClass} value={outcome} maxLength={500} placeholder={L("e.g. quotation sent, order confirmed", "cth. sebut harga dihantar, pesanan disahkan")} onChange={(e) => setOutcome(e.target.value)} /></Field>
      <Field label={L("Converted to order (invoice)", "Ditukar kepada pesanan (invois)")} hint={L("Revenue is the invoice's own total - nothing typed here.", "Hasil ialah jumlah invois itu sendiri - tiada yang ditaip di sini.")}>
        <select className={inputClass} value={orderId} disabled={locked && !manager} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">{L("— not yet —", "— belum —")}</option>
          {invoices.map((i) => <option key={i.id} value={i.id}>{i.doc_number} · {i.company} · {fmtRM(i.total_cents)}</option>)}
        </select>
      </Field>
      <Field label={L("Part of a promotion", "Sebahagian promosi")}>
        <select className={inputClass} value={promotion} onChange={(e) => setPromotion(e.target.value)}>
          <option value="">{L("— none —", "— tiada —")}</option>
          {ov.promotions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label={L("Notes", "Nota")}><input className={inputClass} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="md:col-span-2"><EvidenceUpload value={evidence} onChange={setEvidence} toast={toast} /></div>
      {locked && <ReasonField value={reason} onChange={setReason} />}
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : edit ? L("Save changes", "Simpan perubahan") : L("Record engagement", "Rekod penglibatan")}</button>
        <button type="button" className={btnGhost} onClick={onDone}>{L("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

/** the follow-up's result - and, when it closed, the invoice it closed to */
function OutcomeForm({ ov, row, onDone, toast }: { ov: Overview; row: Engagement; onDone: () => void; toast: Toast }) {
  const [outcome, setOutcome] = useState(row.outcome ?? "");
  const [orderId, setOrderId] = useState(row.order_doc_id ? String(row.order_doc_id) : "");
  const [saving, setSaving] = useState(false);
  const invoices = ov.invoices.filter((i) => ov.can_manage || i.salesperson_id === ov.me);
  const save = async () => {
    if (!outcome.trim()) { toast(L("Not saved", "Tidak disimpan"), L("What was the outcome?", "Apakah hasilnya?"), "notice"); return; }
    setSaving(true);
    const r = await api<Err>(`/engagements/${row.id}/outcome`, { method: "POST", body: JSON.stringify({ outcome: outcome.trim(), order_doc_id: orderId || null }) });
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(L("Outcome recorded", "Hasil direkodkan"), orderId ? L("Linked to the order - a conversion", "Dipautkan ke pesanan - satu penukaran") : "");
    onDone();
  };
  return (
    <div className="space-y-3">
      <p className="text-sm"><span className="font-semibold">{row.customer_name}</span> <span className="text-muted-foreground">· {lbl(SP_INTERACTIONS, row.interaction_type)} · {mytDateTime(row.happened_at)}</span></p>
      <Field label={L("Outcome *", "Hasil *")}><input className={inputClass} value={outcome} maxLength={500} onChange={(e) => setOutcome(e.target.value)} /></Field>
      <Field label={L("Converted to order (invoice)", "Ditukar kepada pesanan (invois)")}>
        <select className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">{L("— no order —", "— tiada pesanan —")}</option>
          {invoices.map((i) => <option key={i.id} value={i.id}>{i.doc_number} · {i.company} · {fmtRM(i.total_cents)}</option>)}
        </select>
      </Field>
      <div className="flex gap-2">
        <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : L("Save outcome", "Simpan hasil")}</button>
        <button type="button" className={btnGhost} onClick={onDone}>{L("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

function PromotionForm({ ov, edit, onDone, toast }: { ov: Overview; edit?: Promotion; onDone: () => void; toast: Toast }) {
  const locked = edit?.status === "verified";
  const [name, setName] = useState(edit?.name ?? "");
  const [product, setProduct] = useState(edit?.product ?? "");
  const [platform, setPlatform] = useState(edit?.platform ?? "");
  const [ptype, setPtype] = useState(edit?.promo_type ?? "discount");
  const [start, setStart] = useState(edit?.start_on ?? mytToday());
  const [end, setEnd] = useState(edit?.end_on ?? "");
  const [reached, setReached] = useState(n0s(edit?.customers_reached));
  const [result, setResult] = useState(edit?.result ?? "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [owner, setOwner] = useState(edit ? String(edit.user_id) : String(ov.me));
  const [evidence, setEvidence] = useState<string | null>(edit?.evidence_key ?? null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) { toast(L("Not saved", "Tidak disimpan"), L("Name the promotion", "Namakan promosi"), "notice"); return; }
    if (!start) { toast(L("Not saved", "Tidak disimpan"), L("When does it start?", "Bila ia bermula?"), "notice"); return; }
    if (locked && !reason.trim()) { toast(L("Not saved", "Tidak disimpan"), L("A reason is required to correct a verified record", "Sebab diperlukan untuk membetulkan rekod yang disahkan"), "notice"); return; }
    setSaving(true);
    const body: Record<string, unknown> = { name: name.trim(), product: product.trim() || null, platform: platform || null, promo_type: ptype, start_on: start, end_on: end || null, customers_reached: reached === "" ? null : Number(reached), result: result.trim() || null, notes: notes.trim() || null, evidence_key: evidence };
    if (!edit && ov.can_manage) body.user_id = owner;
    if (locked) body.reason = reason.trim();
    const r = edit ? await api<Err>(`/promotions/${edit.id}`, { method: "PATCH", body: JSON.stringify(body) }) : await api<Err>(`/promotions`, { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(edit ? L("Promotion updated", "Promosi dikemas kini") : L("Promotion recorded", "Promosi direkodkan"));
    onDone();
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field span label={L("Promotion name *", "Nama promosi *")}><input className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={L("Product", "Produk")}><input className={inputClass} value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} /></Field>
      <Field label={L("Platform", "Platform")}>
        <select className={inputClass} value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">{L("— any —", "— mana-mana —")}</option>{SP_PLATFORMS.map(([k]) => <option key={k} value={k}>{lbl(SP_PLATFORMS, k)}</option>)}</select>
      </Field>
      <Field label={L("Type", "Jenis")}>
        <select className={inputClass} value={ptype} onChange={(e) => setPtype(e.target.value)}>{SP_PROMO_TYPES.map(([k]) => <option key={k} value={k}>{lbl(SP_PROMO_TYPES, k)}</option>)}</select>
      </Field>
      {ov.can_manage && !edit && (
        <Field label={L("Run by", "Dijalankan oleh")}>
          <select className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)}>{ov.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
      )}
      <Field label={L("Start *", "Mula *")}><input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field label={L("End", "Tamat")}><input type="date" className={inputClass} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></Field>
      <Field label={L("Customers reached (reported)", "Pelanggan dicapai (dilaporkan)")}><input type="number" inputMode="numeric" min={0} className={inputClass} value={reached} onChange={(e) => setReached(e.target.value)} /></Field>
      <Field label={L("Result", "Hasil")}><input className={inputClass} value={result} maxLength={500} onChange={(e) => setResult(e.target.value)} /></Field>
      <Field span label={L("Notes", "Nota")}><textarea className={`${inputClass} min-h-16 resize-y whitespace-pre-line`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="md:col-span-2"><EvidenceUpload value={evidence} onChange={setEvidence} toast={toast} /></div>
      {locked && <ReasonField value={reason} onChange={setReason} />}
      <p className="text-muted-foreground text-[11px] md:col-span-2">{L("A promotion counts as EXECUTED when a verified post or an order is linked to it - not when it is written down.", "Promosi dikira DILAKSANAKAN apabila pos yang disahkan atau pesanan dipautkan kepadanya - bukan apabila ia ditulis.")}</p>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : edit ? L("Save changes", "Simpan perubahan") : L("Record promotion", "Rekod promosi")}</button>
        <button type="button" className={btnGhost} onClick={onDone}>{L("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

function OtherForm({ onDone, toast }: { onDone: () => void; toast: Toast }) {
  const [happenedAt, setHappenedAt] = useState(mytNowLocal());
  const [customer, setCustomer] = useState("");
  const [product, setProduct] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!action.trim()) { toast(L("Not saved", "Tidak disimpan"), L("What did you do?", "Apa yang anda lakukan?"), "notice"); return; }
    setSaving(true);
    const r = await api<Err>(`/other`, { method: "POST", body: JSON.stringify({ happened_at: happenedAt, customer_name: customer.trim() || null, product: product.trim() || null, action: action.trim(), result: result.trim() || null, evidence_key: evidence }) });
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(L("Activity recorded", "Aktiviti direkodkan"), L("Reported - it counts once management verifies it", "Dilaporkan - dikira selepas pengurusan mengesahkannya"));
    onDone();
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={L("When *", "Bila *")}><input type="datetime-local" className={inputClass} value={happenedAt} max={mytNowLocal()} onChange={(e) => setHappenedAt(e.target.value)} /></Field>
      <Field label={L("Customer", "Pelanggan")}><input className={inputClass} value={customer} maxLength={120} onChange={(e) => setCustomer(e.target.value)} /></Field>
      <Field label={L("Product", "Produk")}><input className={inputClass} value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} /></Field>
      <Field label={L("Result", "Hasil")}><input className={inputClass} value={result} maxLength={500} onChange={(e) => setResult(e.target.value)} /></Field>
      <Field span label={L("What you did *", "Apa yang anda lakukan *")}><textarea className={`${inputClass} min-h-16 resize-y whitespace-pre-line`} rows={2} maxLength={500} value={action} onChange={(e) => setAction(e.target.value)} /></Field>
      <div className="md:col-span-2"><EvidenceUpload value={evidence} onChange={setEvidence} toast={toast} /></div>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : L("Record activity", "Rekod aktiviti")}</button>
        <button type="button" className={btnGhost} onClick={onDone}>{L("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

/** A shipment names an invoice. Shipped / in transit / delivered without a
    tracking number is refused by the worker; the form says so before. */
function ShipmentForm({ ov, presetOrder, edit, onDone, toast }: { ov: Overview; presetOrder?: number; edit?: Shipment; onDone: () => void; toast: Toast }) {
  const [orderId, setOrderId] = useState(edit?.order_doc_id ? String(edit.order_doc_id) : presetOrder ? String(presetOrder) : "");
  const [status, setStatus] = useState(edit?.status ?? "preparing");
  const [courier, setCourier] = useState(edit?.courier ?? "");
  const [tracking, setTracking] = useState(edit?.tracking_no ?? "");
  const [note, setNote] = useState(edit?.note ?? "");
  const [saving, setSaving] = useState(false);
  const needsTracking = SP_TRACKING_REQUIRED.includes(status) && !tracking.trim();
  const shipped = new Set(ov.shipments.filter((s) => s.status !== "returned").map((s) => s.order_ref));
  const invoices = ov.invoices.filter((i) => (ov.can_manage || i.salesperson_id === ov.me) && (edit || !shipped.has(i.doc_number)));
  const save = async () => {
    if (!edit && !orderId) { toast(L("Not saved", "Tidak disimpan"), L("A shipment must be linked to an order (invoice)", "Penghantaran mesti dipautkan ke pesanan (invois)"), "notice"); return; }
    if (needsTracking) { toast(L("Not saved", "Tidak disimpan"), L("TRACKING UPDATE REQUIRED - add the tracking number first", "KEMAS KINI PENJEJAKAN DIPERLUKAN - tambah nombor penjejakan dahulu"), "notice"); return; }
    setSaving(true);
    const body = { order_doc_id: orderId || null, status, courier: courier.trim() || null, tracking_no: tracking.trim() || null, note: note.trim() || null };
    const r = edit ? await api<Err>(`/shipments/${edit.id}`, { method: "PATCH", body: JSON.stringify(body) }) : await api<Err>(`/shipments`, { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(edit ? L("Shipment updated", "Penghantaran dikemas kini") : L("Shipment recorded", "Penghantaran direkodkan"), tracking.trim() ? L(`Tracking ${tracking.trim()}`, `Penjejakan ${tracking.trim()}`) : "");
    onDone();
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {edit ? (
        <p className="text-sm md:col-span-2"><span className="font-semibold">{edit.order_ref}</span>{edit.customer && <span className="text-muted-foreground"> · {edit.customer}</span>}</p>
      ) : (
        <Field span label={L("Order (invoice) *", "Pesanan (invois) *")} hint={L("Only invoices without a shipment yet. Orders live in Sales - raise the invoice there first.", "Hanya invois yang belum ada penghantaran. Pesanan berada di Jualan - buat invois di sana dahulu.")}>
          <select className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">{L("— pick the order —", "— pilih pesanan —")}</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.doc_number} · {i.company} · {fmtRM(i.total_cents)}</option>)}
          </select>
        </Field>
      )}
      <Field label={L("Status *", "Status *")}>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>{SP_TRACKING.map(([k]) => <option key={k} value={k}>{lbl(SP_TRACKING, k)}</option>)}</select>
      </Field>
      <Field label={L("Courier", "Kurier")}><input className={inputClass} value={courier} maxLength={80} placeholder="J&T, Pos Laju, Ninja Van…" onChange={(e) => setCourier(e.target.value)} /></Field>
      <Field span label={L("Tracking number", "Nombor penjejakan") + (SP_TRACKING_REQUIRED.includes(status) ? " *" : "")} hint={needsTracking ? L("TRACKING UPDATE REQUIRED - shipped, in transit and delivered all need one.", "KEMAS KINI PENJEJAKAN DIPERLUKAN - dihantar, dalam perjalanan dan diterima semuanya memerlukannya.") : undefined}>
        <input className={`${inputClass} ${needsTracking ? "border-danger" : ""}`} value={tracking} maxLength={120} onChange={(e) => setTracking(e.target.value)} />
      </Field>
      <Field span label={L("Note", "Nota")}><input className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : edit ? L("Update shipment", "Kemas kini penghantaran") : L("Record shipment", "Rekod penghantaran")}</button>
        <button type="button" className={btnGhost} onClick={onDone}>{L("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

/** Management's decision on a piece of evidence. Never offered on one's own
    record - the worker refuses it, and the button is not drawn either. */
function VerifyForm({ kind, id, isPost, wasVerified, onDone, toast }: { kind: "posts" | "engagements" | "promotions" | "other"; id: number; isPost: boolean; wasVerified: boolean; onDone: () => void; toast: Toast }) {
  const [decision, setDecision] = useState("verified");
  const [note, setNote] = useState("");
  const [metricsOk, setMetricsOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const options = isPost
    ? [["verified", L("Verified - it counts", "Disahkan - ia dikira")], ["rejected", L("Rejected", "Ditolak")], ["evidence_invalid", L("Evidence invalid", "Bukti tidak sah")], ["manual_review", L("Keep under manual review", "Kekal dalam semakan manual")], ["unavailable", L("Post unavailable (deleted)", "Pos tidak tersedia (dipadam)")]]
    : [["verified", L("Verified - it counts", "Disahkan - ia dikira")], ["rejected", L("Rejected", "Ditolak")], ["reported", L("Back to reported (unverified)", "Kembali kepada dilaporkan (belum disahkan)")]];
  const save = async () => {
    if (wasVerified && !note.trim()) { toast(L("Not saved", "Tidak disimpan"), L("A reason is required to change a verified decision", "Sebab diperlukan untuk mengubah keputusan yang disahkan"), "notice"); return; }
    setSaving(true);
    const init = { method: "POST", body: JSON.stringify({ decision, note: note.trim() || null, metrics_verified: isPost && decision === "verified" ? metricsOk : undefined }) };
    /* four literal routes rather than one `/${kind}/...` - tests/api-routes.mjs
       can only check a path it can read */
    const r = kind === "posts" ? await api<Err>(`/posts/${id}/verify`, init)
      : kind === "engagements" ? await api<Err>(`/engagements/${id}/verify`, init)
      : kind === "promotions" ? await api<Err>(`/promotions/${id}/verify`, init)
      : await api<Err>(`/other/${id}/verify`, init);
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(L("Decision recorded", "Keputusan direkodkan"), options.find(([k]) => k === decision)?.[1] ?? "");
    onDone();
  };
  return (
    <div className="space-y-3">
      <Field label={L("Decision *", "Keputusan *")}>
        <select className={inputClass} value={decision} onChange={(e) => setDecision(e.target.value)}>{options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Field>
      {isPost && decision === "verified" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={metricsOk} onChange={(e) => setMetricsOk(e.target.checked)} />
          <span>{L("The reported views / likes / comments match the screenshot - count them as VERIFIED metrics", "Tontonan / suka / komen yang dilaporkan sepadan dengan tangkapan skrin - kira sebagai metrik DISAHKAN")}</span>
        </label>
      )}
      <Field label={wasVerified ? L("Reason *", "Sebab *") : L("Note", "Nota")} hint={wasVerified ? L("This record is already verified - a changed decision is a correction and needs a reason, kept in the audit log.", "Rekod ini telah disahkan - keputusan yang diubah ialah pembetulan dan memerlukan sebab, disimpan dalam log audit.") : undefined}><input className={inputClass} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2">
        <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : L("Record decision", "Rekod keputusan")}</button>
        <button type="button" className={btnGhost} onClick={onDone}>{L("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

/* ================= MANAGEMENT: approved accounts + targets ================= */

function SettingsForm({ ov, onChanged, toast, confirm }: { ov: Overview; onChanged: () => void; toast: Toast; confirm: (o: { title: string; message?: string; confirmLabel?: string; variant?: "default" | "danger" }) => Promise<boolean> }) {
  const [platform, setPlatform] = useState("tiktok");
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const [defaultRm, setDefaultRm] = useState(ov.settings.default_target_cents != null ? String(ov.settings.default_target_cents / 100) : "");
  const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(ov.staff.map((s) => [String(s.id), ov.settings.targets[String(s.id)] != null ? String((ov.settings.targets[String(s.id)] ?? 0) / 100) : ""])));
  const [bench, setBench] = useState({ engagement_target: String(ov.settings.engagement_target), posts_target: String(ov.settings.posts_target), activity_target: String(ov.settings.activity_target) });
  const [saving, setSaving] = useState(false);
  const addAccount = async () => {
    if (!handle.trim()) { toast(L("Not added", "Tidak ditambah"), L("Type the account handle", "Taip pemegang akaun"), "notice"); return; }
    const r = await api<Err & { handle?: string }>(`/accounts`, { method: "POST", body: JSON.stringify({ platform, handle: handle.trim(), label: label.trim() || null }) });
    if (!r.ok) { toast(L("Not added", "Tidak ditambah"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(L("Account approved", "Akaun diluluskan"), `@${(r.data as { handle?: string } | null)?.handle ?? handle.trim()} · ${lbl(SP_PLATFORMS, platform)}`);
    setHandle(""); setLabel(""); onChanged();
  };
  const removeAccount = async (a: Account) => {
    const ok = await confirm({ title: L("Remove this approved account?", "Buang akaun yang diluluskan ini?"), message: L(`@${a.handle} on ${lbl(SP_PLATFORMS, a.platform)}. Posts from it will need manual verification from now on; posts already verified are untouched.`, `@${a.handle} di ${lbl(SP_PLATFORMS, a.platform)}. Pos daripadanya akan memerlukan pengesahan manual mulai sekarang; pos yang telah disahkan tidak terjejas.`), confirmLabel: L("Remove", "Buang"), variant: "danger" });
    if (!ok) return;
    const r = await api<Err>(`/accounts/${a.id}`, { method: "DELETE" });
    if (!r.ok) { toast(L("Not removed", "Tidak dibuang"), say(r, ""), "notice"); return; }
    toast(L("Account removed", "Akaun dibuang")); onChanged();
  };
  const saveTargets = async () => {
    setSaving(true);
    const r = await api<Err>(`/settings`, { method: "PUT", body: JSON.stringify({ default_target_rm: defaultRm === "" ? null : Number(defaultRm), targets_rm: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, v === "" ? null : Number(v)])), engagement_target: Number(bench.engagement_target), posts_target: Number(bench.posts_target), activity_target: Number(bench.activity_target) }) });
    setSaving(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(L("Targets saved", "Sasaran disimpan"), L("Scores recompute on the next read", "Skor dikira semula pada bacaan seterusnya")); onChanged();
  };
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold">{L("Approved company accounts", "Akaun syarikat yang diluluskan")}</p>
        <p className="text-muted-foreground text-xs">{L("A post from an account on this list goes to PENDING; any other account is MANUAL VERIFICATION REQUIRED.", "Pos daripada akaun dalam senarai ini menjadi MENUNGGU; akaun lain PENGESAHAN MANUAL DIPERLUKAN.")}</p>
        <ul className="mt-2">
          {ov.accounts.length === 0 && <li className="text-muted-foreground py-2 text-sm">{L("No accounts approved yet - every post will need manual verification.", "Belum ada akaun diluluskan - setiap pos akan memerlukan pengesahan manual.")}</li>}
          {ov.accounts.map((a) => (
            <li key={a.id} className={listRow}>
              <span className="text-sm"><span className={chipSmNeutral}>{lbl(SP_PLATFORMS, a.platform)}</span> <span className="ml-1 font-medium">@{a.handle}</span>{a.label && <span className="text-muted-foreground"> · {a.label}</span>}</span>
              <button type="button" className={rowBtnDanger} onClick={() => void removeAccount(a)}>{L("Remove", "Buang")}</button>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select className={inputClass} value={platform} aria-label={L("Platform", "Platform")} onChange={(e) => setPlatform(e.target.value)}>{SP_PLATFORMS.filter(([k]) => k !== "other").map(([k]) => <option key={k} value={k}>{lbl(SP_PLATFORMS, k)}</option>)}</select>
          <input className={inputClass} value={handle} placeholder={L("@handle or profile link", "@pemegang atau pautan profil")} aria-label={L("Handle", "Pemegang")} onChange={(e) => setHandle(e.target.value)} />
          <input className={inputClass} value={label} placeholder={L("Label (optional)", "Label (pilihan)")} aria-label={L("Label", "Label")} onChange={(e) => setLabel(e.target.value)} />
          <button type="button" className={btnClass} onClick={() => void addAccount()}>{L("Approve account", "Luluskan akaun")}</button>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold">{L("Daily sales targets", "Sasaran jualan harian")}</p>
        <p className="text-muted-foreground text-xs">{L("RM per person per day. The Sales component of the score (40 points) is revenue against this; without a target it scores 0.", "RM seorang sehari. Komponen Jualan skor (40 mata) ialah hasil berbanding ini; tanpa sasaran ia mendapat 0.")}</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={L("Default target (RM / day)", "Sasaran lalai (RM / hari)")}><input type="number" inputMode="decimal" min={0} className={inputClass} value={defaultRm} onChange={(e) => setDefaultRm(e.target.value)} /></Field>
          {ov.staff.map((s) => (
            <Field key={s.id} label={`${s.name} (RM / ${L("day", "hari")})`}><input type="number" inputMode="decimal" min={0} className={inputClass} value={targets[String(s.id)] ?? ""} placeholder={L("default", "lalai")} onChange={(e) => setTargets((t) => ({ ...t, [String(s.id)]: e.target.value }))} /></Field>
          ))}
        </div>
        <p className="mt-3 text-sm font-semibold">{L("Daily benchmarks", "Penanda aras harian")}</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <Field label={L("Unique customers / day", "Pelanggan unik / hari")}><input type="number" inputMode="numeric" min={1} className={inputClass} value={bench.engagement_target} onChange={(e) => setBench((b) => ({ ...b, engagement_target: e.target.value }))} /></Field>
          <Field label={L("Verified posts / day", "Pos disahkan / hari")}><input type="number" inputMode="numeric" min={1} className={inputClass} value={bench.posts_target} onChange={(e) => setBench((b) => ({ ...b, posts_target: e.target.value }))} /></Field>
          <Field label={L("Activities / day", "Aktiviti / hari")}><input type="number" inputMode="numeric" min={1} className={inputClass} value={bench.activity_target} onChange={(e) => setBench((b) => ({ ...b, activity_target: e.target.value }))} /></Field>
        </div>
        <button type="button" className={`${btnClass} mt-3`} disabled={saving} onClick={() => void saveTargets()}>{saving ? <Skel className="inline-block h-3 w-16" /> : L("Save targets", "Simpan sasaran")}</button>
      </div>
    </div>
  );
}

/** the audit history of one record - who changed what, from what, to what */
function AuditHistory({ entity, id }: { entity: string; id: string }) {
  const [rows, setRows] = useState<{ id: number; action: string; detail: string | null; created_at: string; user_name: string | null }[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    void api<{ history?: { id: number; action: string; detail: string | null; created_at: string; user_name: string | null }[] }>(`/audit?entity=${entity}&id=${encodeURIComponent(id)}`).then((r) => { if (alive) setRows(r.ok ? (r.data?.history ?? []) : []); });
    return () => { alive = false; };
  }, [entity, id]);
  if (rows === null) return <SkelRows rows={3} />;
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{L("No history recorded for this record.", "Tiada sejarah direkodkan untuk rekod ini.")}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        let detail: unknown = null;
        try { detail = r.detail ? JSON.parse(r.detail) : null; } catch { detail = r.detail; }
        const diff = detail && typeof detail === "object" && "diff" in (detail as Record<string, unknown>) ? (detail as { diff?: Record<string, { was: unknown; now: unknown }>; reason?: string | null }) : null;
        return (
          <li key={r.id} className={insetCard}>
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold whitespace-pre-line">{r.action}</span><span className="text-muted-foreground tabular-nums">{r.user_name ?? L("system", "sistem")} · {mytDateTime(r.created_at)}</span></p>
            {diff?.diff ? (
              <ul className="mt-1 space-y-0.5 text-xs">
                {Object.entries(diff.diff).map(([k, v]) => <li key={k}><span className="text-muted-foreground">{k}:</span> <span className="line-through opacity-70">{String(v.was ?? "—")}</span> → <span className="font-medium">{String(v.now ?? "—")}</span></li>)}
                {diff.reason && <li className="text-muted-foreground">{L("Reason", "Sebab")}: {diff.reason}</li>}
              </ul>
            ) : detail ? <pre className="text-muted-foreground mt-1 overflow-x-auto text-[11px] whitespace-pre-wrap">{typeof detail === "string" ? detail : JSON.stringify(detail, null, 1)}</pre> : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ================= THE DAILY CLOSING ================= */

function ClosingCard({ ov, toast, onSaved }: { ov: Overview; toast: Toast; onSaved: () => void }) {
  const day = ov.range.from === ov.range.to && ov.range.from <= ov.today ? ov.range.from : ov.today;
  const preview = useCachedApi<ClosingPreview>(`/staff/sales-performance/closing/preview?day=${day}`, true, TOPICS);
  const mine = ov.closings.find((c) => c.user_id === ov.me && c.day === day) ?? null;
  const [text, setText] = useState({ main_achievement: "", blockers: "", follow_up_tomorrow: "", plan_tomorrow: "", remarks: "", no_activity_reason: "" });
  const [loadedFor, setLoadedFor] = useState<string>("");
  useEffect(() => {
    const key = `${day}:${mine?.id ?? 0}:${mine?.submitted_at ?? ""}`;
    if (key === loadedFor) return;
    setLoadedFor(key);
    setText({ main_achievement: mine?.main_achievement ?? "", blockers: mine?.blockers ?? "", follow_up_tomorrow: mine?.follow_up_tomorrow ?? "", plan_tomorrow: mine?.plan_tomorrow ?? "", remarks: mine?.remarks ?? "", no_activity_reason: mine?.no_activity_reason ?? "" });
  }, [day, mine, loadedFor]);
  const [saving, setSaving] = useState(false);
  const p = preview.data;
  const noActivity = Boolean(p?.no_verified_activity);
  const save = async () => {
    if (!text.main_achievement.trim()) { toast(L("Not closed", "Tidak ditutup"), L("What was the main achievement today?", "Apakah pencapaian utama hari ini?"), "notice"); return; }
    if (!text.plan_tomorrow.trim()) { toast(L("Not closed", "Tidak ditutup"), L("What is tomorrow's sales plan?", "Apakah rancangan jualan esok?"), "notice"); return; }
    if (noActivity && !text.no_activity_reason.trim()) { toast(L("Not closed", "Tidak ditutup"), L("NO VERIFIED SALES ACTIVITY - explain why before closing the day", "TIADA AKTIVITI JUALAN DISAHKAN - jelaskan sebabnya sebelum menutup hari"), "notice"); return; }
    setSaving(true);
    const r = await api<Err>(`/closing`, { method: "POST", body: JSON.stringify({ day, ...text }) });
    setSaving(false);
    if (!r.ok) { toast(L("Not closed", "Tidak ditutup"), say(r, L("Please try again", "Sila cuba lagi")), "notice"); return; }
    toast(mine ? L("Daily closing updated", "Penutupan harian dikemas kini") : L("Day closed", "Hari ditutup"), L(`${dmy(day)} - the system figures were snapshotted with it`, `${dmy(day)} - angka sistem disimpan bersamanya`));
    onSaved();
  };
  const fig = p?.figures;
  const auto: [string, string][] = fig ? [
    [L("Sales (invoices + TikTok)", "Jualan (invois + TikTok)"), `${fmtRM(fig.sales_cents)}${fig.tiktok_cents ? ` (${L("TikTok", "TikTok")} ${fmtRM(fig.tiktok_cents)})` : ""}`],
    [L("Orders", "Pesanan"), `${fig.orders} ${L("invoices", "invois")} · ${fig.tiktok_orders} TikTok · ${fig.orders_completed} ${L("completed", "selesai")}`],
    [L("Customer interactions", "Interaksi pelanggan"), `${fig.interactions} · ${fig.unique_customers} ${L("unique", "unik")}`],
    [L("Leads / inquiries", "Petunjuk / pertanyaan"), String(fig.inquiries)],
    [L("Follow-ups done / overdue", "Susulan selesai / tertunggak"), `${fig.follow_ups_done} / ${fig.follow_ups_overdue}`],
    [L("Verified posts", "Pos disahkan"), `${fig.posts_verified} (${fig.posts_reported} ${L("pending", "menunggu")})`],
    [L("Shipments updated", "Penghantaran dikemas kini"), `${fig.shipments}${fig.tracking_required ? ` · ${fig.tracking_required} ${L("need tracking", "perlu penjejakan")}` : ""}`],
    [L("Productivity score", "Skor produktiviti"), `${p!.score} · ${bandLabel(p!.band)}`],
  ] : [];
  const others = ov.can_manage ? ov.closings.filter((c) => c.user_id !== ov.me) : [];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <p className="text-muted-foreground text-xs">{L(`System figures for ${dmy(day)} - filled in by the system, not typed.`, `Angka sistem untuk ${dmy(day)} - diisi oleh sistem, bukan ditaip.`)}</p>
        {!p ? <SkelRows rows={4} className="mt-2" /> : (
          <ul className="mt-1">{auto.map(([k, v]) => <li key={k} className={listRow}><span className="text-muted-foreground text-xs">{k}</span><span className="text-sm font-medium tabular-nums">{v}</span></li>)}</ul>
        )}
        {noActivity && (
          <div className="bg-danger-soft text-danger mt-3 rounded-lg p-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold"><AppIcon name="warning" className="h-4 w-4" />{L("NO VERIFIED SALES ACTIVITY", "TIADA AKTIVITI JUALAN DISAHKAN")}</p>
            <p className="mt-0.5 text-xs">{L("You clocked in today and the system holds no verified post, no order, no verified engagement and no verified activity for you. Please explain why before closing the day.", "Anda masuk kerja hari ini dan sistem tidak mempunyai pos disahkan, pesanan, penglibatan disahkan atau aktiviti disahkan untuk anda. Sila jelaskan sebabnya sebelum menutup hari.")}</p>
          </div>
        )}
        {mine && <p className="text-muted-foreground mt-2 text-[11px]">{L(`Closed ${mytDateTime(mine.submitted_at)} - saving again updates it.`, `Ditutup ${mytDateTime(mine.submitted_at)} - simpan semula mengemaskininya.`)}</p>}
      </div>
      <div className="space-y-2">
        {noActivity && <Field label={L("Why was there no verified sales activity today? *", "Mengapa tiada aktiviti jualan disahkan hari ini? *")}><textarea className={`${inputClass} min-h-16 resize-y whitespace-pre-line border-danger`} rows={2} maxLength={1000} value={text.no_activity_reason} onChange={(e) => setText((t) => ({ ...t, no_activity_reason: e.target.value }))} /></Field>}
        <Field label={L("Main achievement today *", "Pencapaian utama hari ini *")}><textarea className={`${inputClass} min-h-16 resize-y whitespace-pre-line`} rows={2} maxLength={1000} value={text.main_achievement} onChange={(e) => setText((t) => ({ ...t, main_achievement: e.target.value }))} /></Field>
        <Field label={L("Problems / blockers", "Masalah / penghalang")}><textarea className={`${inputClass} min-h-12 resize-y whitespace-pre-line`} rows={2} maxLength={1000} value={text.blockers} onChange={(e) => setText((t) => ({ ...t, blockers: e.target.value }))} /></Field>
        <Field label={L("Customers to follow up tomorrow", "Pelanggan untuk disusuli esok")}><textarea className={`${inputClass} min-h-12 resize-y whitespace-pre-line`} rows={2} maxLength={1000} value={text.follow_up_tomorrow} onChange={(e) => setText((t) => ({ ...t, follow_up_tomorrow: e.target.value }))} /></Field>
        <Field label={L("Tomorrow's sales plan *", "Rancangan jualan esok *")}><textarea className={`${inputClass} min-h-12 resize-y whitespace-pre-line`} rows={2} maxLength={1000} value={text.plan_tomorrow} onChange={(e) => setText((t) => ({ ...t, plan_tomorrow: e.target.value }))} /></Field>
        <Field label={L("Remarks", "Catatan")}><textarea className={`${inputClass} min-h-12 resize-y whitespace-pre-line`} rows={1} maxLength={1000} value={text.remarks} onChange={(e) => setText((t) => ({ ...t, remarks: e.target.value }))} /></Field>
        <button type="button" className={btnClass} disabled={saving || !p} onClick={() => void save()}>{saving ? <Skel className="inline-block h-3 w-16" /> : mine ? L("Update closing", "Kemas kini penutupan") : L("Close the day", "Tutup hari")}</button>
      </div>
      {others.length > 0 && (
        <div className="lg:col-span-2">
          <p className="text-sm font-semibold">{L(`Team closings - ${dmy(day)}`, `Penutupan pasukan - ${dmy(day)}`)}</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {others.map((c) => {
              let snap: { score?: number; no_verified_activity?: boolean; figures?: Figures } = {};
              try { snap = JSON.parse(c.snapshot) as typeof snap; } catch { /* old shape */ }
              return (
                <div key={c.id} className={insetCard}>
                  <p className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold">{c.staff_name}</span><span className="text-muted-foreground text-xs tabular-nums">{L("score", "skor")} {snap.score ?? "—"} · {mytDateTime(c.submitted_at)}</span></p>
                  {snap.no_verified_activity && <p className="text-danger mt-1 text-xs font-medium">{L("NO VERIFIED SALES ACTIVITY", "TIADA AKTIVITI JUALAN DISAHKAN")}{c.no_activity_reason ? ` - ${c.no_activity_reason}` : ""}</p>}
                  <p className="mt-1 text-xs whitespace-pre-line"><span className="text-muted-foreground">{L("Achievement", "Pencapaian")}:</span> {c.main_achievement}</p>
                  {c.blockers && <p className="mt-0.5 text-xs whitespace-pre-line"><span className="text-muted-foreground">{L("Blockers", "Penghalang")}:</span> {c.blockers}</p>}
                  <p className="mt-0.5 text-xs whitespace-pre-line"><span className="text-muted-foreground">{L("Tomorrow", "Esok")}:</span> {c.plan_tomorrow}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= PHONE ROWS + ROW ACTIONS ================= */

/* v1.155.0 (CEO: "need to make sure that this suitable with mobile apps
   view"). Every list on this page is drawn TWICE from the same rows and the
   same handlers: a card list for the phone (md:hidden) and a table for the
   desk (hidden md:block) - the Inventory tab's v1.119.0 pattern. The
   actions are built ONCE per row (an Act[]) and rendered small in a table
   cell or thumb-sized, two to a row, under a phone card. */
type Act = { label: string; run: () => void; tone?: "primary" | "danger" | "plain" };
const phoneBtn = "border-border inline-flex h-10 items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors hover:bg-secondary";
function Acts({ acts, phone = false }: { acts: Act[]; phone?: boolean }) {
  if (acts.length === 0) return null;
  const cls = (t: Act["tone"]) => phone
    ? `${phoneBtn} ${t === "primary" ? "bg-primary text-primary-foreground border-transparent" : t === "danger" ? "text-danger border-danger/30" : ""}`
    : t === "primary" ? rowBtnPrimary : t === "danger" ? rowBtnDanger : rowBtn;
  return (
    <div className={phone ? "mt-2 grid grid-cols-2 gap-1.5" : rowActions}>
      {acts.map((a) => <button key={a.label} type="button" className={cls(a.tone)} onClick={a.run}>{a.label}</button>)}
    </div>
  );
}

/** one phone card: a title line, a muted line, something on the right, a
    row of chips, a two-column grid of labelled facts, then the actions */
function PhoneRow({ title, sub, right, chips, facts, acts, children }: {
  title: ReactNode; sub?: ReactNode; right?: ReactNode; chips?: ReactNode; facts?: [string, ReactNode][]; acts?: Act[]; children?: ReactNode;
}) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          {sub && <p className="text-muted-foreground mt-0.5 text-[11px]">{sub}</p>}
        </div>
        {right && <div className="shrink-0 text-right">{right}</div>}
      </div>
      {chips && <div className="mt-1.5 flex flex-wrap gap-1">{chips}</div>}
      {facts && facts.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0"><dt className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">{k}</dt><dd className="text-xs font-medium tabular-nums whitespace-pre-line">{v}</dd></div>
          ))}
        </dl>
      )}
      {children}
      {acts && <Acts acts={acts} phone />}
    </li>
  );
}
const phoneList = "divide-border divide-y md:hidden";
const deskTable = "hidden overflow-x-auto md:block";

/* ================= SCORE + THE MANAGEMENT TABLE ================= */

const COMPONENT_LABEL: Record<SpComponent, [string, string]> = {
  sales: ["Sales vs target", "Jualan vs sasaran"], engagement: ["Customer engagement", "Penglibatan pelanggan"], social: ["Verified social posts", "Pos sosial disahkan"],
  follow_up: ["Follow-up completion", "Penyelesaian susulan"], orders: ["Order completion", "Penyelesaian pesanan"], shipment: ["Shipment with tracking", "Penghantaran dengan penjejakan"], promotion: ["Promotion executed", "Promosi dilaksanakan"],
};

/** the flags a person's row carries, everywhere they are drawn */
function StatusFlags({ r }: { r: PerStaff }) {
  return (
    <span className="flex flex-wrap gap-1">
      {r.no_verified_activity && <span className={chipSmDanger}>{L("NO VERIFIED SALES ACTIVITY", "TIADA AKTIVITI JUALAN DISAHKAN")}</span>}
      {r.busy.verdict === "low_sales" && <span className={chipSmWarn}>{L("LOW SALES PERFORMANCE", "PRESTASI JUALAN RENDAH")}</span>}
      {r.busy.verdict === "strong" && <span className={chipSmSuccess}>{L("Strong", "Kukuh")}</span>}
      {!r.figures.present && <span className={chipSmNeutral}>{L("not clocked in", "tidak masuk kerja")}</span>}
      {r.figures.follow_ups_overdue > 0 && <span className={chipSmWarn}>{r.figures.follow_ups_overdue} {L("follow-ups overdue", "susulan tertunggak")}</span>}
      {r.figures.tracking_required > 0 && <span className={chipSmDanger}>{r.figures.tracking_required} {L("tracking required", "penjejakan diperlukan")}</span>}
    </span>
  );
}

/** one person's score, taken apart: seven weighted components and the four
    busy-vs-productive readings. Every number here arrived from the API. */
function ScoreCard({ row, title }: { row: PerStaff; title: string }) {
  const f = row.figures;
  const readings: [string, number][] = [[L("Activity", "Aktiviti"), row.busy.activity], [L("Engagement", "Penglibatan"), row.busy.engagement], [L("Conversion", "Penukaran"), row.busy.conversion], [L("Revenue", "Hasil"), row.busy.revenue]];
  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <PanelTitle icon="target">{title}</PanelTitle>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-3xl font-semibold tabular-nums">{row.score}</span>
            <span className={BAND_CHIP[row.band.code]}>{bandLabel(row.band)}</span>
          </p>
          <div className="mt-1"><StatusFlags r={row} /></div>
        </div>
        <p className="text-muted-foreground text-xs tabular-nums sm:text-right">
          {row.no_target ? L("No sales target set - Sales scores 0 until management sets one", "Tiada sasaran jualan - Jualan mendapat 0 sehingga pengurusan menetapkannya") : L(`Target ${fmtRM(row.target_cents ?? 0)} · achieved ${fmtRM(f.sales_cents)}`, `Sasaran ${fmtRM(row.target_cents ?? 0)} · dicapai ${fmtRM(f.sales_cents)}`)}
          {f.tiktok_cents > 0 && <span className="block">{L(`incl. TikTok ${fmtRM(f.tiktok_cents)} (${f.tiktok_orders} orders)`, `termasuk TikTok ${fmtRM(f.tiktok_cents)} (${f.tiktok_orders} pesanan)`)}</span>}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
        {(Object.keys(SP_WEIGHTS) as SpComponent[]).map((k) => {
          const v = row.components[k];
          const pts = Math.round(Math.min(1, Math.max(0, v)) * SP_WEIGHTS[k]);
          return (
            <div key={k} className="text-xs">
              <div className="flex items-center justify-between gap-2"><span>{L(COMPONENT_LABEL[k][0], COMPONENT_LABEL[k][1])}</span><span className="text-muted-foreground tabular-nums">{pct(v)} · <span className="text-foreground font-medium">{pts}</span>/{SP_WEIGHTS[k]}</span></div>
              <MiniBar pct={v * 100} tone={v >= 0.75 ? "green" : v >= 0.4 ? "gold" : "red"} className="mt-1" />
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-3 text-[11px] font-semibold tracking-widest uppercase">{L("Busy vs productive", "Sibuk vs produktif")}</p>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {readings.map(([k, v]) => <div key={k} className="text-xs"><div className="flex justify-between"><span>{k}</span><span className="tabular-nums">{v}%</span></div><MiniBar pct={v} tone="navy" className="mt-1" /></div>)}
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">{L("Only verified posts, real invoices, TikTok Shop orders, verified engagements and shipments with tracking move these numbers. Reported activity on its own does not.", "Hanya pos disahkan, invois sebenar, pesanan TikTok Shop, penglibatan disahkan dan penghantaran berpenjejakan menggerakkan angka ini. Aktiviti yang dilaporkan sahaja tidak.")}</p>
    </div>
  );
}

function StaffTable({ rows, onPick }: { rows: PerStaff[]; onPick: (id: number) => void }) {
  const salesCell = (r: PerStaff) => (
    <>
      {fmtRM(r.figures.sales_cents)}
      <span className="text-muted-foreground block text-[11px]">
        {r.target_cents ? `${Math.round((r.figures.sales_cents / r.target_cents) * 100)}% ${L("of target", "sasaran")}` : L("no target", "tiada sasaran")}
        {r.figures.tiktok_cents > 0 ? ` · TikTok ${fmtRM(r.figures.tiktok_cents)}` : ""}
      </span>
    </>
  );
  return (
    <>
      <ul className={phoneList}>
        {rows.map((r) => (
          <PhoneRow key={`m-${r.id}`}
            title={<button type="button" className="underline-offset-2 hover:underline" onClick={() => onPick(r.id)}>{r.name}</button>}
            sub={r.role.replace("_", " ")}
            right={<><p className="text-2xl font-bold tabular-nums">{r.score}</p><span className={BAND_CHIP[r.band.code]}>{bandLabel(r.band)}</span></>}
            chips={<StatusFlags r={r} />}
            facts={[
              [L("Sales", "Jualan"), salesCell(r)],
              [L("Orders", "Pesanan"), `${r.figures.orders + r.figures.tiktok_orders} · ${r.figures.orders_completed} ${L("done", "selesai")}`],
              [L("Verified activities", "Aktiviti disahkan"), `${r.figures.verified_activities} ${L("of", "daripada")} ${r.figures.activities_total}`],
              [L("Engagement", "Penglibatan"), `${r.figures.interactions} · ${r.figures.unique_customers} ${L("unique", "unik")}`],
              [L("Leads", "Petunjuk"), String(r.figures.inquiries)],
              [L("Conversion", "Penukaran"), `${r.figures.conversion_rate}%`],
            ]} />
        ))}
      </ul>
      <div className={deskTable}>
        <table className="w-full min-w-[880px]">
          <thead><tr className="border-border border-b">
            <th className={th}>{L("Staff", "Staf")}</th><th className={thR2}>{L("Sales", "Jualan")}</th><th className={thR2}>{L("Orders", "Pesanan")}</th><th className={thR2}>{L("Verified activities", "Aktiviti disahkan")}</th>
            <th className={thR2}>{L("Engagement", "Penglibatan")}</th><th className={thR2}>{L("Leads", "Petunjuk")}</th><th className={thR2}>{L("Conversion", "Penukaran")}</th><th className={thR2}>{L("Productivity", "Produktiviti")}</th><th className={th}>{L("Status", "Status")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-border border-b last:border-0">
                <td className={td}><button type="button" className="text-left font-medium underline-offset-2 hover:underline" title={L("Show only this person", "Tunjuk orang ini sahaja")} onClick={() => onPick(r.id)}>{r.name}</button><span className="text-muted-foreground block text-[11px]">{r.role.replace("_", " ")}</span></td>
                <td className={tdR2}>{salesCell(r)}</td>
                <td className={tdR2}>{r.figures.orders + r.figures.tiktok_orders}<span className="text-muted-foreground block text-[11px]">{r.figures.tiktok_orders ? `${r.figures.tiktok_orders} TikTok · ` : ""}{r.figures.orders_completed} {L("done", "selesai")}</span></td>
                <td className={tdR2}>{r.figures.verified_activities}<span className="text-muted-foreground block text-[11px]">{L("of", "daripada")} {r.figures.activities_total}</span></td>
                <td className={tdR2}>{r.figures.interactions}<span className="text-muted-foreground block text-[11px]">{r.figures.unique_customers} {L("unique", "unik")}</span></td>
                <td className={tdR2}>{r.figures.inquiries}</td>
                <td className={tdR2}>{r.figures.conversion_rate}%</td>
                <td className={tdR2}><span className="font-semibold">{r.score}</span> <span className={BAND_CHIP[r.band.code]}>{bandLabel(r.band)}</span></td>
                <td className={td}><StatusFlags r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ================= THE PAGE ================= */

type Range = "today" | "yesterday" | "week" | "month" | "custom";
type DrawerState =
  | { kind: "add" }
  | { kind: "post"; platform?: string; edit?: Post }
  | { kind: "engagement"; preset?: { channel?: string; interaction_type?: string }; edit?: Engagement }
  | { kind: "outcome"; row: Engagement }
  | { kind: "promotion"; edit?: Promotion }
  | { kind: "other" }
  | { kind: "shipment"; presetOrder?: number; edit?: Shipment }
  | { kind: "verify"; target: "posts" | "engagements" | "promotions" | "other"; id: number; isPost: boolean; title: string; wasVerified: boolean }
  | { kind: "settings" }
  | { kind: "audit"; entity: string; id: string; title: string }
  | null;
type SectionKey = "feed" | "posts" | "engagements" | "promotions" | "orders" | "shipments" | "funnel" | "trend" | "closing";

const feedType = (t: string): string => {
  if (t === "tiktok_order") return L("TikTok Shop order", "Pesanan TikTok Shop");
  if (t.endsWith("_post")) return `${lbl(SP_PLATFORMS, t.slice(0, -5))} ${L("post", "pos")}`;
  if (SP_ACTIVITY_TYPES.some(([k]) => k === t)) return lbl(SP_ACTIVITY_TYPES, t);
  if (SP_INTERACTIONS.some(([k]) => k === t)) return lbl(SP_INTERACTIONS, t);
  return t;
};
const flagsOf = (raw: string | null): string[] => { try { const v = JSON.parse(raw ?? "[]") as unknown; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const FLAG_LABEL: Record<string, [string, string]> = { account_not_approved: ["account not approved", "akaun tidak diluluskan"], account_unknown: ["account not in link", "akaun tiada dalam pautan"], old_post: ["old post", "pos lama"] };
const itemsOf = (raw: string | null): string => {
  try { const v = JSON.parse(raw ?? "[]") as { name?: string; qty?: number }[]; return v.map((i) => `${i.qty ?? 1}× ${i.name ?? ""}`.trim()).join(", "); } catch { return ""; }
};
const orderStatus = (o: Order): [string, string] => {
  if (o.payment_status === "paid" && ((o.kind ?? "product") === "service" || o.delivery_status === "delivered" || o.ship_status === "delivered")) return [chipSmSuccess, L("Completed", "Selesai")];
  if (o.ship_status && o.ship_status !== "preparing" && o.ship_status !== "returned") return [chipSmInfo, L("Shipped", "Dihantar")];
  if (o.payment_status === "overdue") return [chipSmDanger, L("Payment overdue", "Bayaran tertunggak")];
  if (o.payment_status === "paid") return [chipSmInfo, L("Paid - processing", "Dibayar - diproses")];
  return [chipSmWarn, L("Pending payment", "Menunggu bayaran")];
};
const payChip = (s: string) => (s === "paid" ? chipSmSuccess : s === "overdue" ? chipSmDanger : chipSmWarn);

export function SalesPerformancePanel({ go }: { go: (tab: string) => void }) {
  const [range, setRange] = useState<Range>("today");
  const [from, setFrom] = useState(mytToday());
  const [to, setTo] = useState(mytToday());
  const [staff, setStaff] = useState("0");
  const [platform, setPlatform] = useState("");
  const [verification, setVerification] = useState("");
  const [status, setStatus] = useState("");
  const qs = [`range=${range}`, range === "custom" ? `from=${from}&to=${to}` : "", staff !== "0" ? `staff=${staff}` : "", platform ? `platform=${platform}` : "", verification ? `verification=${verification}` : "", status ? `status=${status}` : ""].filter(Boolean).join("&");
  const view = useCachedApi<Overview>(`/staff/sales-performance/overview?v=${SHAPE}&${qs}`, true, TOPICS);
  const ov = useMemo(() => normalizeOverview(view.data), [view.data]);
  const refresh = view.refresh;
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ feed: true, posts: false, engagements: false, promotions: false, orders: false, shipments: false, funnel: false, trend: false, closing: false });
  const toggle = (k: SectionKey) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const jump = (k: SectionKey) => { setOpen((o) => ({ ...o, [k]: true })); window.setTimeout(() => document.getElementById(`sp-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const done = useCallback(() => { setDrawer(null); refresh(); }, [refresh]);
  const manager = Boolean(ov?.can_manage);
  const me = ov?.me ?? 0;
  const mine = (userId: number) => userId === me;

  /* ---- the deletes, each asking first and reporting after ---- */
  const remove = async (target: "posts" | "engagements" | "promotions" | "other", id: number, what: string, locked: boolean) => {
    const ok = await confirm({ title: L(`Remove this ${what}?`, `Buang ${what} ini?`), message: locked ? L("This record is verified. Management may remove it with a reason; the removal and the record are kept in the audit log.", "Rekod ini disahkan. Pengurusan boleh membuangnya dengan sebab; pembuangan dan rekod disimpan dalam log audit.") : L("It leaves every figure. The record is kept and the removal is written against your name.", "Ia dikeluarkan daripada setiap angka. Rekod disimpan dan pembuangan dicatat atas nama anda."), confirmLabel: L("Remove", "Buang"), variant: "danger" });
    if (!ok) return;
    const init = { method: "DELETE", body: JSON.stringify({ reason: locked ? L("Removed by management", "Dibuang oleh pengurusan") : null }) };
    const r = target === "posts" ? await api<Err>(`/posts/${id}`, init)
      : target === "engagements" ? await api<Err>(`/engagements/${id}`, init)
      : target === "promotions" ? await api<Err>(`/promotions/${id}`, init)
      : await api<Err>(`/other/${id}`, init);
    if (!r.ok) { toast(L("Not removed", "Tidak dibuang"), say(r, ""), "notice"); return; }
    toast(L("Removed", "Dibuang"), L("It no longer counts", "Ia tidak lagi dikira")); refresh();
  };
  const checkLink = async (p: Post) => {
    const r = await api<Err & { http?: number; reachable?: boolean; status?: string }>(`/posts/${p.id}/check`, { method: "POST", body: "{}" });
    if (!r.ok) { toast(L("Check failed", "Semakan gagal"), say(r, ""), "notice"); return; }
    const d = r.data as { http?: number; reachable?: boolean; status?: string } | null;
    toast(d?.reachable ? L("Post is reachable", "Pos boleh dicapai") : L("Post did not answer", "Pos tidak menjawab"), `HTTP ${d?.http ?? 0}${d?.status === "unavailable" ? ` · ${L("marked POST UNAVAILABLE", "ditanda POS TIDAK TERSEDIA")}` : ""}`, d?.reachable ? "success" : "notice");
    refresh();
  };
  const history = (entity: string, id: number, title: string) => setDrawer({ kind: "audit", entity, id: String(id), title: `${L("History", "Sejarah")} · ${title}` });

  /* ---- the actions each row offers, built once, drawn on desk and phone ---- */
  const postActs = (p: Post): Act[] => {
    const own = mine(p.user_id); const verified = p.status === "verified"; const acts: Act[] = [];
    if (manager && !own) acts.push({ label: verified ? L("Re-decide", "Putuskan semula") : L("Verify", "Sahkan"), tone: verified ? "plain" : "primary", run: () => setDrawer({ kind: "verify", target: "posts", id: p.id, isPost: true, title: `${p.staff_name} · ${lbl(SP_PLATFORMS, p.platform)} · ${p.product ?? ""}`, wasVerified: verified }) });
    if (manager) acts.push({ label: L("Check link", "Semak pautan"), run: () => void checkLink(p) });
    if ((own && !verified) || manager) acts.push({ label: verified ? L("Correct", "Betulkan") : L("Edit", "Sunting"), run: () => setDrawer({ kind: "post", edit: p }) });
    if ((own && !verified) || (manager && !verified)) acts.push({ label: L("Remove", "Buang"), tone: "danger", run: () => void remove("posts", p.id, L("post", "pos"), verified) });
    if (manager) acts.push({ label: L("History", "Sejarah"), run: () => history("sp_social_posts", p.id, p.product ?? p.url) });
    return acts;
  };
  const engActs = (e: Engagement): Act[] => {
    const own = mine(e.user_id); const locked = e.status === "verified" || e.order_doc_id != null; const acts: Act[] = [];
    if ((own || manager) && !e.order_doc_id) acts.push({ label: L("Outcome", "Hasil"), tone: "primary", run: () => setDrawer({ kind: "outcome", row: e }) });
    if (manager && !own && e.status !== "verified" && !e.order_doc_id) acts.push({ label: L("Verify", "Sahkan"), tone: "primary", run: () => setDrawer({ kind: "verify", target: "engagements", id: e.id, isPost: false, title: `${e.staff_name} · ${e.customer_name}`, wasVerified: false }) });
    if ((own && !locked) || manager) acts.push({ label: locked ? L("Correct", "Betulkan") : L("Edit", "Sunting"), run: () => setDrawer({ kind: "engagement", edit: e }) });
    if ((own && !locked) || manager) acts.push({ label: L("Remove", "Buang"), tone: "danger", run: () => void remove("engagements", e.id, L("engagement", "penglibatan"), locked) });
    if (manager) acts.push({ label: L("History", "Sejarah"), run: () => history("sp_engagements", e.id, e.customer_name) });
    return acts;
  };
  const promoActs = (p: Promotion): Act[] => {
    const own = mine(p.user_id); const verified = p.status === "verified"; const acts: Act[] = [];
    if (manager && !own && !verified) acts.push({ label: L("Verify", "Sahkan"), tone: "primary", run: () => setDrawer({ kind: "verify", target: "promotions", id: p.id, isPost: false, title: p.name, wasVerified: false }) });
    if ((own && !verified) || manager) acts.push({ label: verified ? L("Correct", "Betulkan") : L("Edit", "Sunting"), run: () => setDrawer({ kind: "promotion", edit: p }) });
    if ((own && !verified) || manager) acts.push({ label: L("Remove", "Buang"), tone: "danger", run: () => void remove("promotions", p.id, L("promotion", "promosi"), verified) });
    if (manager) acts.push({ label: L("History", "Sejarah"), run: () => history("sp_promotions", p.id, p.name) });
    return acts;
  };
  const otherActs = (o: Other): Act[] => {
    const acts: Act[] = [];
    if (manager && !mine(o.user_id) && o.status !== "verified") acts.push({ label: L("Verify", "Sahkan"), tone: "primary", run: () => setDrawer({ kind: "verify", target: "other", id: o.id, isPost: false, title: o.action, wasVerified: false }) });
    if ((mine(o.user_id) && o.status !== "verified") || manager) acts.push({ label: L("Remove", "Buang"), tone: "danger", run: () => void remove("other", o.id, L("activity", "aktiviti"), o.status === "verified") });
    return acts;
  };
  const orderActs = (o: Order): Act[] => {
    const acts: Act[] = [];
    if ((o.kind ?? "product") !== "service" && !o.ship_status && (mine(o.user_id) || manager)) acts.push({ label: L("Add shipment", "Tambah penghantaran"), tone: "primary", run: () => setDrawer({ kind: "shipment", presetOrder: o.id }) });
    acts.push({ label: L("Open in Sales", "Buka di Jualan"), run: () => go("Sales") });
    return acts;
  };
  const shipActs = (s: Shipment): Act[] => {
    const acts: Act[] = [];
    if (mine(s.user_id) || manager) acts.push({ label: L("Update", "Kemas kini"), tone: "primary", run: () => setDrawer({ kind: "shipment", edit: s }) });
    if (manager) acts.push({ label: L("History", "Sejarah"), run: () => history("postage_records", s.id, s.order_ref) });
    return acts;
  };

  const RANGES = [["today", L("Today", "Hari ini")], ["yesterday", L("Yesterday", "Semalam")], ["week", L("This week", "Minggu ini")], ["month", L("This month", "Bulan ini")], ["custom", L("Custom", "Tersuai")]] as const;
  const pendingMigration = view.failed && !ov;
  const myRow = ov?.per_staff.find((r) => r.id === me) ?? null;
  const shown = ov ? (staff !== "0" ? ov.per_staff.filter((r) => String(r.id) === staff) : ov.per_staff) : [];
  const team = ov?.team;
  const t = team?.figures;
  const rangeLabel = ov ? (ov.range.label === "today" ? L("today", "hari ini") : ov.range.label === "yesterday" ? L("yesterday", "semalam") : `${dmy(ov.range.from)} – ${dmy(ov.range.to)}`) : "";

  return (
    <div className="space-y-3 md:space-y-4">
      {/* ---- the header: title, filters, the two doors ---- */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle icon="target">{L("Sales Performance", "Prestasi Jualan")} <span className="text-muted-foreground hidden font-normal sm:inline">· {L("evidence, not claims", "bukti, bukan dakwaan")}</span></PanelTitle>
          <div className="flex flex-wrap items-center gap-2">
            <StaleHint show={view.stale} />
            {manager && <button type="button" className={btnGhost} onClick={() => setDrawer({ kind: "settings" })}><AppIcon name="edit" className="mr-1.5 h-4 w-4" />{L("Accounts & targets", "Akaun & sasaran")}</button>}
            <button type="button" className={btnClass} onClick={() => setDrawer({ kind: "add" })}>{L("+ Add activity", "+ Tambah aktiviti")}</button>
          </div>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {L("System-derived figures first, verified evidence second, what was reported last. Nothing unverified counts toward the score.", "Angka sistem dahulu, bukti disahkan kedua, apa yang dilaporkan terakhir. Tiada yang belum disahkan dikira dalam skor.")}
        </p>
        <div role="tablist" className="mt-3 flex flex-wrap gap-1.5">
          {RANGES.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={range === k} className={range === k ? tabPillOn : tabPill} onClick={() => setRange(k)}>{label}</button>)}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {range === "custom" && (<>
            <input type="date" className={`${inputClassSm} h-9 w-full sm:w-auto`} value={from} max={to} aria-label={L("From", "Dari")} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className={`${inputClassSm} h-9 w-full sm:w-auto`} value={to} min={from} max={mytToday()} aria-label={L("To", "Hingga")} onChange={(e) => setTo(e.target.value)} />
          </>)}
          {manager && ov && (
            <select className={selectClass} value={staff} aria-label={L("Staff", "Staf")} onChange={(e) => setStaff(e.target.value)}>
              <option value="0">{L("Staff: everyone", "Staf: semua")}</option>
              {ov.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select className={selectClass} value={platform} aria-label={L("Platform", "Platform")} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">{L("Platform: all", "Platform: semua")}</option>
            {SP_CHANNELS.map(([k]) => <option key={k} value={k}>{lbl(SP_CHANNELS, k)}</option>)}
          </select>
          <select className={selectClass} value={verification} aria-label={L("Verification", "Pengesahan")} onChange={(e) => setVerification(e.target.value)}>
            <option value="">{L("Verification: all", "Pengesahan: semua")}</option>
            <option value="verified">{L("Verified", "Disahkan")}</option>
            <option value="pending">{L("Pending", "Menunggu")}</option>
            <option value="rejected">{L("Rejected / invalid", "Ditolak / tidak sah")}</option>
            <option value="review">{L("Needs review", "Perlu semakan")}</option>
          </select>
          <select className={selectClass} value={status} aria-label={L("Follow-up status", "Status susulan")} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{L("Follow-ups: all", "Susulan: semua")}</option>
            <option value="pending">{L("Pending", "Menunggu")}</option>
            <option value="completed">{L("Completed", "Selesai")}</option>
            <option value="overdue">{L("Overdue", "Tertunggak")}</option>
          </select>
          {(platform || verification || status || staff !== "0") && <button type="button" className="text-muted-foreground col-span-2 text-left text-xs underline sm:col-span-1" onClick={() => { setPlatform(""); setVerification(""); setStatus(""); setStaff("0"); }}>{L("Clear filters", "Kosongkan penapis")}</button>}
        </div>
        {ov?.stale_shape && (
          <p className="text-warning mt-2 text-xs font-medium">
            {L("Some figures are missing because the server is a version behind this page (TikTok Shop sales are not in this answer). Run PUSH.bat to bring the server up to date.",
               "Sebahagian angka tiada kerana pelayan satu versi di belakang halaman ini (jualan TikTok Shop tiada dalam jawapan ini). Jalankan PUSH.bat untuk mengemas kini pelayan.")}
          </p>
        )}
        {pendingMigration && (
          <p className="text-warning mt-2 text-xs font-medium">{L("Sales Performance is not set up on the server yet - run PUSH.bat so database change 0127 applies.", "Prestasi Jualan belum disediakan di pelayan - jalankan PUSH.bat supaya perubahan pangkalan data 0127 dilaksanakan.")}</p>
        )}
      </div>

      {!ov ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <SkelStat key={i} />)}</div>
          <div className={card}><SkelRows rows={5} /></div>
        </>
      ) : (
        <>
          {/* ---- 1. KPI summary ---- */}
          <section>
            <ZoneLabel>{L(`KPI summary · ${rangeLabel}`, `Ringkasan KPI · ${rangeLabel}`)}</ZoneLabel>
            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <StatTile label={L("Sales", "Jualan")} value={fmtRM(t!.sales_cents)} tone={team!.achievement_pct == null ? "brand" : team!.achievement_pct >= 100 ? "success" : team!.achievement_pct >= 50 ? "gold" : "danger"} icon={<AppIcon name="money" />}
                hint={`${team!.achievement_pct == null ? L("no target set", "tiada sasaran") : L(`${team!.achievement_pct}% of ${fmtRM((t!.target_cents ?? 0) * ov.days)}`, `${team!.achievement_pct}% daripada ${fmtRM((t!.target_cents ?? 0) * ov.days)}`)}${t!.tiktok_cents ? ` · TikTok ${fmtRM(t!.tiktok_cents)}` : ""}`} onClick={() => jump("orders")} title={L("Open the orders", "Buka pesanan")} />
              <StatTile label={L("Orders", "Pesanan")} value={t!.orders + t!.tiktok_orders} tone="info" icon={<AppIcon name="orders" />} hint={L(`${t!.orders} invoices · ${t!.tiktok_orders} TikTok · ${t!.orders_completed} completed`, `${t!.orders} invois · ${t!.tiktok_orders} TikTok · ${t!.orders_completed} selesai`)} onClick={() => jump("orders")} title={L("Open the orders", "Buka pesanan")} />
              <StatTile label={L("Customer engagement", "Penglibatan pelanggan")} value={t!.interactions} tone="brand" icon={<AppIcon name="chat" />} hint={L(`${t!.unique_customers} unique · ${t!.inquiries} leads`, `${t!.unique_customers} unik · ${t!.inquiries} petunjuk`)} onClick={() => jump("engagements")} title={L("Open the engagements", "Buka penglibatan")} />
              <StatTile label={L("Social media", "Media sosial")} value={t!.posts_verified} tone={t!.posts_flagged > 0 ? "gold" : "brand"} icon={<AppIcon name="verify" />} hint={L(`verified · ${t!.posts_reported} pending · ${t!.posts_flagged} flagged`, `disahkan · ${t!.posts_reported} menunggu · ${t!.posts_flagged} ditanda`)} onClick={() => jump("posts")} title={L("Open the posts", "Buka pos")} />
              <StatTile label={L("Shipments", "Penghantaran")} value={t!.shipments} tone={t!.tracking_required > 0 ? "danger" : "muted"} icon={<AppIcon name="shipped" />} hint={t!.tracking_required > 0 ? L(`${t!.tracking_required} TRACKING REQUIRED`, `${t!.tracking_required} PENJEJAKAN DIPERLUKAN`) : L(`${t!.delivered} delivered`, `${t!.delivered} diterima`)} onClick={() => jump("shipments")} title={L("Open the shipments", "Buka penghantaran")} />
              <StatTile label={L("Productivity", "Produktiviti")} value={team!.avg_score} tone={BAND_TONE[team!.band.code]} icon={<AppIcon name="trophy" />} hint={`${bandLabel(team!.band)}${manager ? ` · ${L("team average", "purata pasukan")}` : ""}`} onClick={() => jump("trend")} title={L("Open the trend", "Buka trend")} />
            </div>
          </section>

          {/* ---- the score: the team's table for management, my own card for staff ---- */}
          {manager ? (
            <div className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PanelTitle icon="person">{L("Per staff", "Setiap staf")} <span className="text-muted-foreground hidden font-normal sm:inline">· {L("who worked, and can prove it", "siapa bekerja, dan boleh membuktikannya")}</span></PanelTitle>
                <span className="text-muted-foreground text-xs">{L("Press a name to see only that person.", "Tekan nama untuk melihat orang itu sahaja.")}</span>
              </div>
              <div className="mt-2">{shown.length === 0 ? <p className="text-muted-foreground text-sm">{L("No sales staff on the register.", "Tiada staf jualan dalam daftar.")}</p> : <StaffTable rows={shown} onPick={(id) => setStaff(String(id))} />}</div>
              {shown.length === 1 && shown[0] && <div className="mt-3"><ScoreCard row={shown[0]} title={L(`${shown[0].name} - score breakdown`, `${shown[0].name} - pecahan skor`)} /></div>}
            </div>
          ) : myRow ? <ScoreCard row={myRow} title={L("My productivity score", "Skor produktiviti saya")} /> : null}

          {/* ---- 2. Today's sales activity ---- */}
          <Section id="sp-feed" icon="time" title={ov.range.label === "today" ? L("Today's sales activity", "Aktiviti jualan hari ini") : L("Sales activity", "Aktiviti jualan")} count={ov.feed.length}
            summary={L(`${t!.verified_activities} verified of ${t!.activities_total} recorded`, `${t!.verified_activities} disahkan daripada ${t!.activities_total} direkodkan`)} open={open.feed} onToggle={() => toggle("feed")}
            action={<button type="button" className={btnSmPrimary} onClick={() => setDrawer({ kind: "add" })}>{L("+ Add", "+ Tambah")}</button>}>
            {ov.feed.length === 0 ? <p className="text-muted-foreground text-sm">{L("Nothing recorded for this range yet.", "Belum ada yang direkodkan untuk julat ini.")}</p> : (<>
              <ul className={phoneList}>
                {ov.feed.map((f) => (
                  <PhoneRow key={`m-${f.ref}-${f.id}`} title={feedType(f.type)} sub={`${mytDateTime(f.at)}${manager ? ` · ${f.staff_name}` : ""}`}
                    right={<>{f.sales_cents != null && <p className="text-sm font-semibold tabular-nums">{fmtRM(f.sales_cents)}</p>}<StatusChip status={f.verification} /></>}
                    facts={[[L("Customer / product", "Pelanggan / produk"), [f.customer, f.product].filter(Boolean).join(" · ") || "—"], [L("Result", "Hasil"), f.result || "—"], [L("Action", "Tindakan"), f.action || "—"], [L("Evidence", "Bukti"), f.evidence_key ? <Evidence evidenceKey={f.evidence_key} /> : "—"]]} />
                ))}
              </ul>
              <div className={deskTable}>
                <table className="w-full min-w-[820px]">
                  <thead><tr className="border-border border-b"><th className={th}>{L("Time", "Masa")}</th>{manager && <th className={th}>{L("Staff", "Staf")}</th>}<th className={th}>{L("Type", "Jenis")}</th><th className={th}>{L("Customer / product", "Pelanggan / produk")}</th><th className={th}>{L("Action", "Tindakan")}</th><th className={th}>{L("Result", "Hasil")}</th><th className={thR2}>{L("Sales", "Jualan")}</th><th className={th}>{L("Evidence", "Bukti")}</th><th className={th}>{L("Verification", "Pengesahan")}</th></tr></thead>
                  <tbody>
                    {ov.feed.map((f) => (
                      <tr key={`${f.ref}-${f.id}`} className="border-border border-b last:border-0">
                        <td className={`${td} whitespace-nowrap tabular-nums`}>{mytDateTime(f.at)}</td>
                        {manager && <td className={td}>{f.staff_name}</td>}
                        <td className={td}>{feedType(f.type)}</td>
                        <td className={td}>{f.customer}{f.customer && f.product ? " · " : ""}<span className="text-muted-foreground">{f.product}</span></td>
                        <td className={`${td} max-w-[240px]`}><span className="line-clamp-2 whitespace-pre-line">{f.action}</span></td>
                        <td className={`${td} max-w-[200px] truncate`} title={f.result}>{f.result}</td>
                        <td className={tdR2}>{f.sales_cents != null ? fmtRM(f.sales_cents) : "—"}</td>
                        <td className={td}>{f.evidence_key ? <Evidence evidenceKey={f.evidence_key} /> : <span className="text-muted-foreground text-[11px]">—</span>}</td>
                        <td className={td}><StatusChip status={f.verification} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)}
          </Section>

          {/* ---- 3. Social media activity ---- */}
          <Section id="sp-posts" icon="verify" title={L("Social media activity", "Aktiviti media sosial")} count={ov.posts.length}
            summary={L(`${t!.posts_verified} verified · ${t!.posts_reported} pending · ${t!.posts_flagged} flagged · reach ${n0(t!.reach)} (verified metrics only)`, `${t!.posts_verified} disahkan · ${t!.posts_reported} menunggu · ${t!.posts_flagged} ditanda · capaian ${n0(t!.reach)} (metrik disahkan sahaja)`)} open={open.posts} onToggle={() => toggle("posts")}
            action={<button type="button" className={btnSm} onClick={() => setDrawer({ kind: "post" })}>{L("+ Post", "+ Pos")}</button>}>
            {ov.posts.length === 0 ? <p className="text-muted-foreground text-sm">{L("No posts submitted for this range.", "Tiada pos dihantar untuk julat ini.")}</p> : (<>
              <ul className={phoneList}>
                {ov.posts.map((p) => {
                  const flags = flagsOf(p.flags);
                  return (
                    <PhoneRow key={`m-${p.id}`} title={<a href={p.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{p.product ?? p.url}</a>}
                      sub={`${lbl(SP_PLATFORMS, p.platform)}${p.account_handle ? ` · @${p.account_handle}` : ""}${manager ? ` · ${p.staff_name}` : ""}`}
                      right={<Evidence evidenceKey={p.evidence_key} />}
                      chips={<><StatusChip status={p.status} />{flags.map((fl) => <span key={fl} className={chipSmWarn}>{L(...(FLAG_LABEL[fl] ?? [fl, fl]))}</span>)}{p.promotion_name && <span className={chipSmInfo}>{p.promotion_name}</span>}</>}
                      facts={[[L("Posted", "Dipos"), mytDateTime(p.posted_at)], [L("Submitted", "Dihantar"), mytDateTime(p.submitted_at)], [L("Metrics", "Metrik"), p.views == null && p.likes == null ? L("not reported", "tidak dilaporkan") : `${p.views != null ? `${n0(p.views)} ${L("views", "tontonan")} · ` : ""}${n0(p.likes)} / ${n0(p.comments)} / ${n0(p.shares)} · ${p.metrics_status === "verified" ? L("verified", "disahkan") : L("reported", "dilaporkan")}`], [L("Verified by", "Disahkan oleh"), p.verified_by_name ?? "—"]]}
                      acts={postActs(p)}>
                      {p.description && <p className="mt-1.5 text-xs whitespace-pre-line">{p.description}</p>}
                    </PhoneRow>
                  );
                })}
              </ul>
              <div className={deskTable}>
                <table className="w-full min-w-[980px]">
                  <thead><tr className="border-border border-b">{manager && <th className={th}>{L("Staff", "Staf")}</th>}<th className={th}>{L("Platform", "Platform")}</th><th className={th}>{L("Post", "Pos")}</th><th className={th}>{L("Posted / submitted", "Dipos / dihantar")}</th><th className={thR2}>{L("Metrics", "Metrik")}</th><th className={th}>{L("Evidence", "Bukti")}</th><th className={th}>{L("Status", "Status")}</th><th className={th}></th></tr></thead>
                  <tbody>
                    {ov.posts.map((p) => {
                      const flags = flagsOf(p.flags);
                      return (
                        <tr key={p.id} className="border-border border-b last:border-0">
                          {manager && <td className={td}>{p.staff_name}</td>}
                          <td className={td}><span className={chipSmNeutral}>{lbl(SP_PLATFORMS, p.platform)}</span>{p.account_handle && <span className="text-muted-foreground block text-[11px]">@{p.account_handle}{p.account_match ? "" : ` · ${L("not approved", "tidak diluluskan")}`}</span>}</td>
                          <td className={`${td} max-w-[300px]`}><a href={p.url} target="_blank" rel="noreferrer" className="block truncate font-medium underline-offset-2 hover:underline" title={p.url}>{p.product ?? p.url}</a><span className="text-muted-foreground line-clamp-2 block text-[11px] whitespace-pre-line">{p.description}</span>{p.promotion_name && <span className={`${chipSmInfo} mt-0.5`}>{p.promotion_name}</span>}</td>
                          <td className={`${td} whitespace-nowrap tabular-nums`}>{mytDateTime(p.posted_at)}<span className="text-muted-foreground block text-[11px]">{mytDateTime(p.submitted_at)}</span></td>
                          <td className={tdR2}>{p.views != null || p.likes != null ? <>{n0(p.views)} <span className="text-muted-foreground">{L("views", "tontonan")}</span><span className="block text-[11px]">{n0(p.likes)} / {n0(p.comments)} / {n0(p.shares)}</span></> : "—"}<span className={`${p.metrics_status === "verified" ? chipSmSuccess : chipSmNeutral} mt-0.5`}>{p.metrics_status === "verified" ? L("verified", "disahkan") : L("reported", "dilaporkan")}</span></td>
                          <td className={td}><Evidence evidenceKey={p.evidence_key} /></td>
                          <td className={td}><span className="flex flex-wrap gap-1"><StatusChip status={p.status} />{flags.map((fl) => <span key={fl} className={chipSmWarn}>{L(...(FLAG_LABEL[fl] ?? [fl, fl]))}</span>)}</span>{p.verified_by_name && <span className="text-muted-foreground block text-[11px]">{p.verified_by_name}{p.verify_note ? ` · ${p.verify_note}` : ""}</span>}{p.last_check_http != null && <span className="text-muted-foreground block text-[11px]">{L("link check", "semakan pautan")} HTTP {p.last_check_http}</span>}</td>
                          <td className={td}><Acts acts={postActs(p)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>)}
            <p className="text-muted-foreground mt-2 text-[11px]">{L("A post counts only when VERIFIED. Metrics count only when management has checked them against the screenshot. A verified post that later disappears is re-checked daily and marked POST UNAVAILABLE.", "Pos dikira hanya apabila DISAHKAN. Metrik dikira hanya selepas pengurusan menyemaknya dengan tangkapan skrin. Pos disahkan yang kemudian hilang disemak semula setiap hari dan ditanda POS TIDAK TERSEDIA.")}</p>
          </Section>

          {/* ---- 4. Customer engagement ---- */}
          <Section id="sp-engagements" icon="chat" title={L("Customer engagement", "Penglibatan pelanggan")} count={ov.engagements.length}
            summary={L(`${t!.interactions} interactions · ${t!.unique_customers} unique customers · ${t!.inquiries} leads · ${t!.conversions} converted (${t!.conversion_rate}%) · ${t!.follow_ups_overdue} follow-ups overdue`, `${t!.interactions} interaksi · ${t!.unique_customers} pelanggan unik · ${t!.inquiries} petunjuk · ${t!.conversions} ditukar (${t!.conversion_rate}%) · ${t!.follow_ups_overdue} susulan tertunggak`)} open={open.engagements} onToggle={() => toggle("engagements")}
            action={<button type="button" className={btnSm} onClick={() => setDrawer({ kind: "engagement" })}>{L("+ Engagement", "+ Penglibatan")}</button>}>
            {ov.engagements.length === 0 ? <p className="text-muted-foreground text-sm">{L("No customer engagements for this range.", "Tiada penglibatan pelanggan untuk julat ini.")}</p> : (<>
              <ul className={phoneList}>
                {ov.engagements.map((e) => {
                  const overdue = !!e.follow_up_on && !e.outcome_at && e.follow_up_on < ov.today;
                  return (
                    <PhoneRow key={`m-${e.id}`} title={e.customer_name} sub={`${mytDateTime(e.happened_at)}${manager ? ` · ${e.staff_name}` : ""}${e.customer_phone ? ` · ${e.customer_phone}` : ""}`}
                      right={<StatusChip status={e.order_doc_id ? "linked_order" : e.status} />}
                      chips={<><span className={chipSmNeutral}>{lbl(SP_INTERACTIONS, e.interaction_type)}</span><span className={chipSmNeutral}>{lbl(SP_CHANNELS, e.channel)}</span>{overdue && <span className={chipSmDanger}>{L("OVERDUE", "TERTUNGGAK")}</span>}{e.outcome_at && e.follow_up_on && <span className={chipSmSuccess}>{L("follow-up done", "susulan selesai")}</span>}{e.promotion_name && <span className={chipSmInfo}>{e.promotion_name}</span>}</>}
                      facts={[[L("Product", "Produk"), e.product ?? "—"], [L("Follow-up", "Susulan"), e.follow_up_on ? dmy(e.follow_up_on) : "—"], [L("Outcome", "Hasil"), e.outcome ?? "—"], [L("Order", "Pesanan"), e.order_number ? `${e.order_number} · ${fmtRM(e.order_cents ?? 0)} · ${e.order_payment}` : "—"]]}
                      acts={engActs(e)}>
                      {e.action_taken && <p className="mt-1.5 text-xs whitespace-pre-line"><span className="text-muted-foreground">{L("Action", "Tindakan")}:</span> {e.action_taken}</p>}
                      {e.evidence_key && <div className="mt-1.5"><Evidence evidenceKey={e.evidence_key} /></div>}
                    </PhoneRow>
                  );
                })}
              </ul>
              <div className={deskTable}>
                <table className="w-full min-w-[1000px]">
                  <thead><tr className="border-border border-b"><th className={th}>{L("When", "Bila")}</th>{manager && <th className={th}>{L("Staff", "Staf")}</th>}<th className={th}>{L("Customer", "Pelanggan")}</th><th className={th}>{L("Type · channel", "Jenis · saluran")}</th><th className={th}>{L("Action", "Tindakan")}</th><th className={th}>{L("Follow-up", "Susulan")}</th><th className={th}>{L("Outcome / order", "Hasil / pesanan")}</th><th className={th}>{L("Status", "Status")}</th><th className={th}></th></tr></thead>
                  <tbody>
                    {ov.engagements.map((e) => {
                      const overdue = !!e.follow_up_on && !e.outcome_at && e.follow_up_on < ov.today;
                      return (
                        <tr key={e.id} className="border-border border-b last:border-0">
                          <td className={`${td} whitespace-nowrap tabular-nums`}>{mytDateTime(e.happened_at)}</td>
                          {manager && <td className={td}>{e.staff_name}</td>}
                          <td className={td}><span className="font-medium">{e.customer_name}</span>{e.customer_phone && <span className="text-muted-foreground block text-[11px]">{e.customer_phone}</span>}{e.product && <span className="text-muted-foreground block text-[11px]">{e.product}</span>}</td>
                          <td className={td}>{lbl(SP_INTERACTIONS, e.interaction_type)}<span className="text-muted-foreground block text-[11px]">{lbl(SP_CHANNELS, e.channel)}{e.promotion_name ? ` · ${e.promotion_name}` : ""}</span></td>
                          <td className={`${td} max-w-[240px]`}><span className="line-clamp-2 whitespace-pre-line">{e.action_taken}</span>{e.evidence_key && <Evidence evidenceKey={e.evidence_key} className="mt-1" />}</td>
                          <td className={`${td} whitespace-nowrap`}>{e.follow_up_on ? <>{dmy(e.follow_up_on)}{overdue && <span className={`${chipSmDanger} ml-1`}>{L("OVERDUE", "TERTUNGGAK")}</span>}{e.outcome_at && <span className={`${chipSmSuccess} ml-1`}>{L("done", "selesai")}</span>}</> : <span className="text-muted-foreground">—</span>}</td>
                          <td className={`${td} max-w-[220px]`}><span className="block truncate" title={e.outcome ?? ""}>{e.outcome ?? <span className="text-muted-foreground">—</span>}</span>{e.order_number && <span className="text-[11px] font-medium tabular-nums">{e.order_number} · {fmtRM(e.order_cents ?? 0)} · {e.order_payment}</span>}</td>
                          <td className={td}><StatusChip status={e.order_doc_id ? "linked_order" : e.status} /></td>
                          <td className={td}><Acts acts={engActs(e)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>)}
            <p className="text-muted-foreground mt-2 text-[11px]">{L("A conversion is an engagement linked to a real invoice - the invoice's total is the revenue. Typing \"converted\" converts nothing.", "Penukaran ialah penglibatan yang dipautkan ke invois sebenar - jumlah invois ialah hasilnya. Menaip \"ditukar\" tidak menukar apa-apa.")}</p>
          </Section>

          {/* ---- 5. Promotion & campaign ---- */}
          <Section id="sp-promotions" icon="boost" title={L("Promotion & campaign", "Promosi & kempen")} count={ov.promotions.length}
            summary={L(`${t!.promotions_active} active · ${t!.promotions_executed} executed (a verified post or an order linked)`, `${t!.promotions_active} aktif · ${t!.promotions_executed} dilaksanakan (pos disahkan atau pesanan dipautkan)`)} open={open.promotions} onToggle={() => toggle("promotions")}
            action={<button type="button" className={btnSm} onClick={() => setDrawer({ kind: "promotion" })}>{L("+ Promotion", "+ Promosi")}</button>}>
            {ov.promotions.length === 0 ? <p className="text-muted-foreground text-sm">{L("No promotions running in this range.", "Tiada promosi berjalan dalam julat ini.")}</p> : (<>
              <ul className={phoneList}>
                {ov.promotions.map((p) => {
                  const executed = p.posts_verified > 0 || p.orders > 0;
                  return (
                    <PhoneRow key={`m-${p.id}`} title={p.name} sub={`${dmy(p.start_on)}${p.end_on ? ` – ${dmy(p.end_on)}` : ""}${manager ? ` · ${p.staff_name}` : ""}`}
                      right={<p className="text-sm font-semibold tabular-nums">{fmtRM(p.revenue_cents)}</p>}
                      chips={<><span className={executed ? chipSmSuccess : chipSmNeutral}>{executed ? L("Executed", "Dilaksanakan") : L("Planned", "Dirancang")}</span><StatusChip status={p.status} />{p.platform && <span className={chipSmNeutral}>{lbl(SP_PLATFORMS, p.platform)}</span>}{p.promo_type && <span className={chipSmNeutral}>{lbl(SP_PROMO_TYPES, p.promo_type)}</span>}</>}
                      facts={[[L("Product", "Produk"), p.product ?? "—"], [L("Reached (reported)", "Dicapai (dilaporkan)"), n0(p.customers_reached)], [L("Posts verified", "Pos disahkan"), `${p.posts_verified} / ${p.posts_total}`], [L("Inquiries → orders", "Pertanyaan → pesanan"), `${p.inquiries} → ${p.orders}`]]}
                      acts={promoActs(p)}>
                      {p.result && <p className="mt-1.5 text-xs">{p.result}</p>}
                    </PhoneRow>
                  );
                })}
              </ul>
              <div className={deskTable}>
                <table className="w-full min-w-[900px]">
                  <thead><tr className="border-border border-b"><th className={th}>{L("Promotion", "Promosi")}</th>{manager && <th className={th}>{L("Staff", "Staf")}</th>}<th className={th}>{L("Dates", "Tarikh")}</th><th className={thR2}>{L("Reached", "Dicapai")}</th><th className={thR2}>{L("Posts", "Pos")}</th><th className={thR2}>{L("Inquiries", "Pertanyaan")}</th><th className={thR2}>{L("Orders", "Pesanan")}</th><th className={thR2}>{L("Revenue", "Hasil")}</th><th className={th}>{L("Status", "Status")}</th><th className={th}></th></tr></thead>
                  <tbody>
                    {ov.promotions.map((p) => {
                      const executed = p.posts_verified > 0 || p.orders > 0;
                      return (
                        <tr key={p.id} className="border-border border-b last:border-0">
                          <td className={td}><span className="font-medium">{p.name}</span><span className="text-muted-foreground block text-[11px]">{[p.product, p.platform ? lbl(SP_PLATFORMS, p.platform) : null, p.promo_type ? lbl(SP_PROMO_TYPES, p.promo_type) : null].filter(Boolean).join(" · ")}</span>{p.result && <span className="block text-[11px]">{p.result}</span>}</td>
                          {manager && <td className={td}>{p.staff_name}</td>}
                          <td className={`${td} whitespace-nowrap`}>{dmy(p.start_on)}{p.end_on ? ` – ${dmy(p.end_on)}` : ""}</td>
                          <td className={tdR2}>{n0(p.customers_reached)}<span className="text-muted-foreground block text-[10px]">{L("reported", "dilaporkan")}</span></td>
                          <td className={tdR2}>{p.posts_verified}<span className="text-muted-foreground">/{p.posts_total}</span></td>
                          <td className={tdR2}>{p.inquiries}</td>
                          <td className={tdR2}>{p.orders}</td>
                          <td className={tdR2}>{fmtRM(p.revenue_cents)}</td>
                          <td className={td}><span className="flex flex-wrap gap-1"><span className={executed ? chipSmSuccess : chipSmNeutral}>{executed ? L("Executed", "Dilaksanakan") : L("Planned", "Dirancang")}</span><StatusChip status={p.status} />{p.evidence_key && <Evidence evidenceKey={p.evidence_key} />}</span></td>
                          <td className={td}><Acts acts={promoActs(p)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>)}
            {ov.others.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold">{L("Other sales activity", "Aktiviti jualan lain")} <span className="text-muted-foreground font-normal">· {ov.others.length}</span></p>
                <ul className="mt-1">
                  {ov.others.map((o) => (
                    <li key={o.id} className={listRow}>
                      <span className="min-w-0 text-sm"><span className="text-muted-foreground mr-2 text-xs tabular-nums">{mytDateTime(o.happened_at)}</span>{manager && <span className="mr-2 font-medium">{o.staff_name}</span>}<span className="whitespace-pre-line">{o.action}</span>{(o.customer_name || o.product) && <span className="text-muted-foreground"> · {[o.customer_name, o.product].filter(Boolean).join(" · ")}</span>}{o.result && <span className="text-muted-foreground"> → {o.result}</span>}</span>
                      <span className="flex flex-wrap items-center gap-1.5"><Evidence evidenceKey={o.evidence_key} /><StatusChip status={o.status} /><Acts acts={otherActs(o)} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          {/* ---- 6. Customer orders (invoices - the Sales tab's records - and TikTok Shop orders) ---- */}
          <Section id="sp-orders" icon="orders" title={L("Customer orders", "Pesanan pelanggan")} count={ov.orders.length + ov.tiktok_orders.length}
            summary={L(`${t!.orders} invoices · ${t!.tiktok_orders} TikTok · ${fmtRM(t!.sales_cents)} · ${fmtRM(t!.paid_cents)} paid on invoices · ${t!.orders_completed} completed`, `${t!.orders} invois · ${t!.tiktok_orders} TikTok · ${fmtRM(t!.sales_cents)} · ${fmtRM(t!.paid_cents)} dibayar atas invois · ${t!.orders_completed} selesai`)} open={open.orders} onToggle={() => toggle("orders")}
            action={<button type="button" className={btnSm} onClick={() => go("Sales")}>{L("Raise an invoice", "Buat invois")}</button>}>
            {ov.orders.length === 0 ? <p className="text-muted-foreground text-sm">{L("No invoices raised in this range. An order is an invoice - there is no other way to record one.", "Tiada invois dibuat dalam julat ini. Pesanan ialah invois - tiada cara lain untuk merekodkannya.")}</p> : (<>
              <ul className={phoneList}>
                {ov.orders.map((o) => {
                  const [cls, label] = orderStatus(o);
                  return (
                    <PhoneRow key={`m-${o.id}`} title={o.doc_number} sub={`${mytDateTime(o.created_at)}${manager ? ` · ${o.staff_name}` : ""}`}
                      right={<><p className="text-sm font-semibold tabular-nums">{fmtRM(o.total_cents)}</p><span className={payChip(o.payment_status)}>{o.payment_status}</span></>}
                      chips={<><span className={cls}>{label}</span>{(o.kind ?? "product") === "service" ? <span className={chipSmNeutral}>{L("service", "perkhidmatan")}</span> : (!o.ship_status || (SP_TRACKING_REQUIRED.includes(o.ship_status) && !o.tracking_no)) ? <ShipChip status={o.ship_status} tracking={o.tracking_no} /> : null}{o.linked_engagements > 0 && <span className={chipSmSuccess}>{o.linked_engagements} {L("engagement linked", "penglibatan dipautkan")}</span>}</>}
                      facts={[[L("Customer", "Pelanggan"), o.customer], [L("Items", "Item"), itemsOf(o.items) || "—"]]}
                      acts={orderActs(o)} />
                  );
                })}
              </ul>
              <div className={deskTable}>
                <table className="w-full min-w-[900px]">
                  <thead><tr className="border-border border-b"><th className={th}>{L("Order", "Pesanan")}</th>{manager && <th className={th}>{L("Staff", "Staf")}</th>}<th className={th}>{L("Customer", "Pelanggan")}</th><th className={th}>{L("Items", "Item")}</th><th className={thR2}>{L("Amount", "Jumlah")}</th><th className={th}>{L("Payment", "Bayaran")}</th><th className={th}>{L("Shipment", "Penghantaran")}</th><th className={th}>{L("Status", "Status")}</th><th className={th}></th></tr></thead>
                  <tbody>
                    {ov.orders.map((o) => {
                      const [cls, label] = orderStatus(o);
                      return (
                        <tr key={o.id} className="border-border border-b last:border-0">
                          <td className={`${td} whitespace-nowrap`}><span className="font-medium tabular-nums">{o.doc_number}</span><span className="text-muted-foreground block text-[11px] tabular-nums">{mytDateTime(o.created_at)}</span>{o.linked_engagements > 0 && <span className={`${chipSmSuccess} mt-0.5`}>{o.linked_engagements} {L("engagement linked", "penglibatan dipautkan")}</span>}</td>
                          {manager && <td className={td}>{o.staff_name}</td>}
                          <td className={td}>{o.customer}</td>
                          <td className={`${td} max-w-[260px] truncate`} title={itemsOf(o.items)}>{itemsOf(o.items) || <span className="text-muted-foreground">{(o.kind ?? "product") === "service" ? L("service", "perkhidmatan") : "—"}</span>}</td>
                          <td className={tdR2}>{fmtRM(o.total_cents)}</td>
                          <td className={td}><span className={payChip(o.payment_status)}>{o.payment_status}</span></td>
                          <td className={td}>{(o.kind ?? "product") === "service" ? <span className="text-muted-foreground text-[11px]">{L("service - nothing ships", "perkhidmatan - tiada penghantaran")}</span> : <ShipChip status={o.ship_status} tracking={o.tracking_no} />}</td>
                          <td className={td}><span className={cls}>{label}</span></td>
                          <td className={td}><Acts acts={orderActs(o)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>)}
            {/* v1.155.0 (CEO: "Sales Performance need to include with their
                sales TikTok") - the shop's own orders, credited the way the
                leaderboard credits them: to the live host whose session they
                landed in, and to the sales_marketing staff clocked in at the
                time. System records - nobody typed them. */}
            <div className="mt-3">
              <p className="text-xs font-semibold">{L("TikTok Shop orders", "Pesanan TikTok Shop")} <span className="text-muted-foreground font-normal">· {ov.tiktok_orders.length} · {fmtRM(t!.tiktok_cents)}</span></p>
              {ov.tiktok_orders.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">{L("No TikTok Shop orders landed during a live session or a sales shift in this range.", "Tiada pesanan TikTok Shop mendarat semasa sesi live atau syif jualan dalam julat ini.")}</p> : (<>
                <ul className={phoneList}>
                  {ov.tiktok_orders.map((o) => (
                    <PhoneRow key={`m-tt-${o.id}`} title={o.order_ref} sub={`${mytDateTime(o.created_at)} · ${o.staff_names.join(" + ")}`}
                      right={<><p className="text-sm font-semibold tabular-nums">{fmtRM(o.cents)}</p><StatusChip status="system" /></>}
                      chips={<ShipChip status={o.status} tracking={o.tracking_no} />}
                      facts={[[L("Items", "Item"), o.items_label ?? "—"], [L("Courier", "Kurier"), o.courier ?? "—"]]} />
                  ))}
                </ul>
                <div className={deskTable}>
                  <table className="w-full min-w-[720px]">
                    <thead><tr className="border-border border-b"><th className={th}>{L("Order", "Pesanan")}</th><th className={th}>{L("Credited to", "Dikreditkan kepada")}</th><th className={th}>{L("Items", "Item")}</th><th className={thR2}>{L("Amount", "Jumlah")}</th><th className={th}>{L("Shipment", "Penghantaran")}</th><th className={th}>{L("Verification", "Pengesahan")}</th></tr></thead>
                    <tbody>
                      {ov.tiktok_orders.map((o) => (
                        <tr key={`tt-${o.id}`} className="border-border border-b last:border-0">
                          <td className={`${td} whitespace-nowrap`}><span className="font-medium tabular-nums">{o.order_ref}</span><span className="text-muted-foreground block text-[11px] tabular-nums">{mytDateTime(o.created_at)}</span></td>
                          <td className={td}>{o.staff_names.join(" + ")}</td>
                          <td className={`${td} max-w-[280px] truncate`} title={o.items_label ?? ""}>{o.items_label ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className={tdR2}>{fmtRM(o.cents)}</td>
                          <td className={td}><ShipChip status={o.status} tracking={o.tracking_no} />{o.courier && <span className="text-muted-foreground block text-[11px]">{o.courier}</span>}</td>
                          <td className={td}><StatusChip status="system" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>)}
              <p className="text-muted-foreground mt-1 text-[11px]">{L("Credited to the live host whose session the order landed in, and to the sales staff clocked in at the time (split equally) - the same rule as the sales leaderboard. The team's total counts each order once.", "Dikreditkan kepada hos live yang sesinya menerima pesanan itu, dan kepada staf jualan yang masuk kerja pada masa itu (dibahagi sama rata) - peraturan yang sama seperti papan pendahulu jualan. Jumlah pasukan mengira setiap pesanan sekali.")}</p>
            </div>
          </Section>

          {/* ---- 7. Shipment & tracking ---- */}
          <Section id="sp-shipments" icon="shipped" title={L("Shipment & tracking", "Penghantaran & penjejakan")} count={ov.shipments.length}
            summary={L(`${t!.shipped} shipped · ${t!.delivered} delivered · ${t!.shipments_pending} preparing${t!.tracking_required ? ` · ${t!.tracking_required} TRACKING UPDATE REQUIRED` : ""}`, `${t!.shipped} dihantar · ${t!.delivered} diterima · ${t!.shipments_pending} disediakan${t!.tracking_required ? ` · ${t!.tracking_required} KEMAS KINI PENJEJAKAN DIPERLUKAN` : ""}`)} open={open.shipments} onToggle={() => toggle("shipments")}
            action={<button type="button" className={btnSm} onClick={() => setDrawer({ kind: "shipment" })}>{L("+ Shipment", "+ Penghantaran")}</button>}>
            {ov.shipments.length === 0 ? <p className="text-muted-foreground text-sm">{L("No shipments updated in this range.", "Tiada penghantaran dikemas kini dalam julat ini.")}</p> : (<>
              <ul className={phoneList}>
                {ov.shipments.map((s) => (
                  <PhoneRow key={`m-${s.id}`} title={s.order_ref} sub={`${mytDateTime(s.updated_at)}${manager ? ` · ${s.staff_name}` : ""}`}
                    right={<ShipChip status={s.status} tracking={s.tracking_no} />}
                    facts={[[L("Customer", "Pelanggan"), s.customer ?? "—"], [L("Courier", "Kurier"), s.courier ?? "—"], [L("Tracking", "Penjejakan"), s.tracking_no ?? <span className="text-danger">{L("missing", "tiada")}</span>]]}
                    acts={shipActs(s)} />
                ))}
              </ul>
              <div className={deskTable}>
                <table className="w-full min-w-[820px]">
                  <thead><tr className="border-border border-b"><th className={th}>{L("Order", "Pesanan")}</th>{manager && <th className={th}>{L("Staff", "Staf")}</th>}<th className={th}>{L("Customer", "Pelanggan")}</th><th className={th}>{L("Courier", "Kurier")}</th><th className={th}>{L("Tracking", "Penjejakan")}</th><th className={th}>{L("Status", "Status")}</th><th className={th}>{L("Updated", "Dikemas kini")}</th><th className={th}></th></tr></thead>
                  <tbody>
                    {ov.shipments.map((s) => (
                      <tr key={s.id} className="border-border border-b last:border-0">
                        <td className={`${td} font-medium tabular-nums`}>{s.order_ref}</td>
                        {manager && <td className={td}>{s.staff_name}</td>}
                        <td className={td}>{s.customer ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className={td}>{s.courier ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className={`${td} tabular-nums`}>{s.tracking_no ?? <span className="text-danger text-[11px] font-medium">{L("missing", "tiada")}</span>}</td>
                        <td className={td}><ShipChip status={s.status} tracking={s.tracking_no} /></td>
                        <td className={`${td} whitespace-nowrap tabular-nums`}>{mytDateTime(s.updated_at)}</td>
                        <td className={td}><Acts acts={shipActs(s)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)}
            <p className="text-muted-foreground mt-2 text-[11px]">{L("Shipped, in transit and delivered all require a tracking number - the server refuses the status without one. A shipment is complete when it is delivered, not when it is marked shipped.", "Dihantar, dalam perjalanan dan diterima semuanya memerlukan nombor penjejakan - pelayan menolak status tanpanya. Penghantaran selesai apabila diterima, bukan apabila ditanda dihantar.")}</p>
          </Section>

          {/* ---- 8. Sales funnel ---- */}
          <Section id="sp-funnel" icon="chart" title={L("Sales funnel", "Corong jualan")} summary={L(`${ov.funnel.posts} verified posts → ${ov.funnel.inquiries} inquiries → ${ov.funnel.orders} orders → ${fmtRM(ov.funnel.revenue_cents)}`, `${ov.funnel.posts} pos disahkan → ${ov.funnel.inquiries} pertanyaan → ${ov.funnel.orders} pesanan → ${fmtRM(ov.funnel.revenue_cents)}`)} open={open.funnel} onToggle={() => toggle("funnel")}>
            <Funnel f={ov.funnel} />
          </Section>

          {/* ---- 9. Performance trend ---- */}
          <Section id="sp-trend" icon="up" title={L("Performance trend", "Trend prestasi")} summary={L(`Score today ${ov.trend.today.score} · yesterday ${ov.trend.yesterday.score} · 7-day ${ov.trend.avg7.score} · 30-day ${ov.trend.avg30.score}`, `Skor hari ini ${ov.trend.today.score} · semalam ${ov.trend.yesterday.score} · 7 hari ${ov.trend.avg7.score} · 30 hari ${ov.trend.avg30.score}`)} open={open.trend} onToggle={() => toggle("trend")}>
            <Trend trend={ov.trend} who={manager && staff === "0" ? L("the whole team", "seluruh pasukan") : L("this person", "orang ini")} />
          </Section>

          {/* ---- 10. Daily closing ---- */}
          <Section id="sp-closing" icon="document" title={L("Daily closing", "Penutupan harian")} count={ov.closings.length}
            summary={ov.closings.some((c) => c.user_id === me) ? L("You have closed this day - open to update it", "Anda telah menutup hari ini - buka untuk mengemaskininya") : L("Not closed yet - the system's figures are ready, your words are missing", "Belum ditutup - angka sistem sudah sedia, kata-kata anda belum ada")} open={open.closing} onToggle={() => toggle("closing")}>
            <ClosingCard ov={ov} toast={toast} onSaved={refresh} />
          </Section>
        </>
      )}

      {/* ---- the drawers - one open at a time, at the panel's top level ---- */}
      {drawer?.kind === "add" && ov && (
        <Drawer title={L("Add activity", "Tambah aktiviti")} sub={L("What did you do? Pick the kind - the right form opens.", "Apa yang anda lakukan? Pilih jenis - borang yang betul dibuka.")} onClose={closeDrawer}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SP_ACTIVITY_TYPES.map(([k]) => (
              <button key={k} type="button" className={`${insetCard} min-h-14 text-left text-sm font-medium hover:bg-secondary`} onClick={() => {
                if (k === "social_post") setDrawer({ kind: "post" });
                else if (k === "tiktok_activity") setDrawer({ kind: "post", platform: "tiktok" });
                else if (k === "facebook_activity") setDrawer({ kind: "post", platform: "facebook" });
                else if (k === "instagram_activity") setDrawer({ kind: "post", platform: "instagram" });
                else if (k === "customer_inquiry") setDrawer({ kind: "engagement", preset: { interaction_type: "new_inquiry" } });
                else if (k === "customer_follow_up") setDrawer({ kind: "engagement", preset: { interaction_type: "follow_up" } });
                else if (k === "whatsapp_follow_up") setDrawer({ kind: "engagement", preset: { interaction_type: "follow_up", channel: "whatsapp" } });
                else if (k === "repeat_order") setDrawer({ kind: "engagement", preset: { interaction_type: "repeat_customer" } });
                else if (k === "new_order") { setDrawer(null); go("Sales"); }
                else if (k === "promotion") setDrawer({ kind: "promotion" });
                else if (k === "shipment" || k === "tracking_update") setDrawer({ kind: "shipment" });
                else setDrawer({ kind: "other" });
              }}>{lbl(SP_ACTIVITY_TYPES, k)}{k === "new_order" && <span className="text-muted-foreground block text-[11px] font-normal">{L("an order is an invoice - raised in Sales", "pesanan ialah invois - dibuat di Jualan")}</span>}</button>
            ))}
          </div>
        </Drawer>
      )}
      {drawer?.kind === "post" && ov && <Drawer wide title={drawer.edit ? (drawer.edit.status === "verified" ? L("Correct a verified post", "Betulkan pos yang disahkan") : L("Edit post", "Sunting pos")) : L("Submit a social media post", "Hantar pos media sosial")} sub={L("URL, screenshot, product, description and the post's own date - all required.", "URL, tangkapan skrin, produk, penerangan dan tarikh pos itu sendiri - semua diperlukan.")} onClose={closeDrawer}><PostForm ov={ov} presetPlatform={drawer.platform} edit={drawer.edit} onDone={done} toast={toast} /></Drawer>}
      {drawer?.kind === "engagement" && ov && <Drawer wide title={drawer.edit ? L("Edit engagement", "Sunting penglibatan") : L("Record a customer engagement", "Rekod penglibatan pelanggan")} onClose={closeDrawer}><EngagementForm ov={ov} preset={drawer.preset} edit={drawer.edit} onDone={done} toast={toast} /></Drawer>}
      {drawer?.kind === "outcome" && ov && <Drawer title={L("Record the outcome", "Rekod hasil")} onClose={closeDrawer}><OutcomeForm ov={ov} row={drawer.row} onDone={done} toast={toast} /></Drawer>}
      {drawer?.kind === "promotion" && ov && <Drawer wide title={drawer.edit ? L("Edit promotion", "Sunting promosi") : L("Record a promotion", "Rekod promosi")} onClose={closeDrawer}><PromotionForm ov={ov} edit={drawer.edit} onDone={done} toast={toast} /></Drawer>}
      {drawer?.kind === "other" && <Drawer title={L("Other sales activity", "Aktiviti jualan lain")} sub={L("For the few things that are not a post, an engagement, a promotion or a shipment.", "Untuk beberapa perkara yang bukan pos, penglibatan, promosi atau penghantaran.")} onClose={closeDrawer}><OtherForm onDone={done} toast={toast} /></Drawer>}
      {drawer?.kind === "shipment" && ov && <Drawer title={drawer.edit ? L("Update shipment", "Kemas kini penghantaran") : L("Record a shipment", "Rekod penghantaran")} onClose={closeDrawer}><ShipmentForm ov={ov} presetOrder={drawer.presetOrder} edit={drawer.edit} onDone={done} toast={toast} /></Drawer>}
      {drawer?.kind === "verify" && <Drawer title={L("Verify evidence", "Sahkan bukti")} sub={drawer.title} onClose={closeDrawer}><VerifyForm kind={drawer.target} id={drawer.id} isPost={drawer.isPost} wasVerified={drawer.wasVerified} onDone={done} toast={toast} /></Drawer>}
      {drawer?.kind === "settings" && ov && <Drawer wide title={L("Approved accounts & targets", "Akaun yang diluluskan & sasaran")} onClose={closeDrawer}><SettingsForm ov={ov} onChanged={refresh} toast={toast} confirm={confirm} /></Drawer>}
      {drawer?.kind === "audit" && <Drawer title={drawer.title} sub={L("Every change to this record, with the previous and the new value.", "Setiap perubahan pada rekod ini, dengan nilai sebelum dan selepas.")} onClose={closeDrawer}><AuditHistory entity={drawer.entity} id={drawer.id} /></Drawer>}

      {toastNode}
      {confirmNode}
    </div>
  );
}

/** the trend: four rows on the desk, four cards on the phone */
function Trend({ trend, who }: { trend: Overview["trend"]; who: string }) {
  const rows = [["today", L("Today", "Hari ini")], ["yesterday", L("Yesterday", "Semalam")], ["avg7", L("7-day average", "Purata 7 hari")], ["avg30", L("30-day average", "Purata 30 hari")]] as const;
  return (
    <>
      <ul className={phoneList}>
        {rows.map(([k, label]) => {
          const r = trend[k];
          return (
            <PhoneRow key={`m-${k}`} title={label} right={<p className="text-xl font-bold tabular-nums">{r.score}</p>}
              facts={[[L("Sales", "Jualan"), `${fmtRM(r.sales_cents)}${r.tiktok_cents ? ` (TikTok ${fmtRM(r.tiktok_cents)})` : ""}`], [L("Orders", "Pesanan"), String(r.orders)], [L("Engagement", "Penglibatan"), String(r.engagement)], [L("Leads", "Petunjuk"), String(r.leads)], [L("Follow-ups", "Susulan"), String(r.follow_ups)], [L("Verified posts", "Pos disahkan"), String(r.posts_verified)], [L("Conversion", "Penukaran"), `${r.conversion_rate}%`]]} />
          );
        })}
      </ul>
      <div className={deskTable}>
        <table className="w-full min-w-[720px]">
          <thead><tr className="border-border border-b"><th className={th}></th><th className={thR2}>{L("Sales", "Jualan")}</th><th className={thR2}>{L("Orders", "Pesanan")}</th><th className={thR2}>{L("Engagement", "Penglibatan")}</th><th className={thR2}>{L("Leads", "Petunjuk")}</th><th className={thR2}>{L("Follow-ups", "Susulan")}</th><th className={thR2}>{L("Verified posts", "Pos disahkan")}</th><th className={thR2}>{L("Conversion", "Penukaran")}</th><th className={thR2}>{L("Score", "Skor")}</th></tr></thead>
          <tbody>
            {rows.map(([k, label]) => {
              const r = trend[k];
              return (
                <tr key={k} className="border-border border-b last:border-0">
                  <td className={`${td} font-medium`}>{label}</td>
                  <td className={tdR2}>{fmtRM(r.sales_cents)}{r.tiktok_cents ? <span className="text-muted-foreground block text-[11px]">TikTok {fmtRM(r.tiktok_cents)}</span> : null}</td>
                  <td className={tdR2}>{r.orders}</td><td className={tdR2}>{r.engagement}</td><td className={tdR2}>{r.leads}</td><td className={tdR2}>{r.follow_ups}</td><td className={tdR2}>{r.posts_verified}</td><td className={tdR2}>{r.conversion_rate}%</td>
                  <td className={tdR2}><span className="font-semibold">{r.score}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">{L(`Averages are per day, for ${who}. Sales include invoices and TikTok Shop orders. The score is the average of each day's score.`, `Purata adalah sehari, untuk ${who}. Jualan termasuk invois dan pesanan TikTok Shop. Skor ialah purata skor setiap hari.`)}</p>
    </>
  );
}

/** the funnel: six counts as bars against the widest, and the revenue they
    ended in. Everything is the team's (or the one person's) verified figures. */
function Funnel({ f }: { f: Overview["funnel"] }) {
  const stages: [string, number][] = [
    [L("Verified posts", "Pos disahkan"), f.posts], [L("Reach (verified metrics)", "Capaian (metrik disahkan)"), f.reach], [L("Engagement (likes, comments, shares, saves)", "Penglibatan (suka, komen, kongsi, simpan)"), f.engagement],
    [L("Customer inquiries", "Pertanyaan pelanggan"), f.inquiries], [L("Follow-ups done", "Susulan selesai"), f.follow_ups], [L("Orders (invoices + TikTok)", "Pesanan (invois + TikTok)"), f.orders],
  ];
  const max = Math.max(1, ...stages.map(([, v]) => v));
  return (
    <div className="space-y-2">
      {stages.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-xs sm:grid-cols-[220px_minmax(0,1fr)_64px]">
          <span className="truncate">{k}</span>
          <span className="text-right font-medium tabular-nums sm:hidden">{n0(v)}</span>
          <span className="bg-secondary col-span-2 block h-3 overflow-hidden rounded-full sm:col-span-1"><span className="bg-brand block h-full rounded-full" style={{ width: `${v > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0}%` }} /></span>
          <span className="hidden text-right font-medium tabular-nums sm:block">{n0(v)}</span>
        </div>
      ))}
      <p className="flex items-center justify-between border-t border-border pt-2 text-sm"><span className="font-semibold">{L("Revenue (invoices + TikTok)", "Hasil (invois + TikTok)")}</span><span className="font-semibold tabular-nums">{fmtRM(f.revenue_cents)}</span></p>
      <p className="text-muted-foreground text-[11px]">{L("Reach and engagement count only posts whose metrics management verified; inquiries are new / product / price inquiries; orders are invoices raised plus TikTok Shop orders credited in the range.", "Capaian dan penglibatan mengira hanya pos yang metriknya disahkan pengurusan; pertanyaan ialah pertanyaan baharu / produk / harga; pesanan ialah invois dibuat serta pesanan TikTok Shop yang dikreditkan dalam julat.")}</p>
    </div>
  );
}
