"use client";

/**
 * v1.203.0 - THE DASHBOARD OVERVIEW (A2Z OS 2.0, the owner's reference,
 * 24-10-2026): a welcome header, five figure tiles, then three rows of three
 * cards - Recent Activities, Task Overview, Sales Performance; Live
 * Sessions, Team On Shift, Upcoming & Pending; Quick Actions, Business
 * Summary, System Status.
 *
 * A PRESENTATION LAYER AND NOTHING ELSE. Every figure is read from a request
 * a module already answers, through the same remembered views the modules
 * use, so the Dashboard and the module can never disagree:
 *   sales          /staff/revenue (the month figure the Sales floor shows:
 *                  TikTok + paid invoices + other shipments + manual sales)
 *   history        /staff/revenue overall.months (every revenue line - it
 *                  also counts stokis and ELFIA web orders, so it is
 *                  captioned, never presented as the headline)
 *   quotations,
 *   stock, people  /staff/dashboard/summary (each field only when the worker
 *                  says this person may see it)
 *   inventory      /staff/inventory
 *   tasks          /staff/tasks (?all=1 for the managing roles - the same
 *                  view the Tasks page reads), counted by lib/task-figures
 *   activities     /audit (the admin tier: CEO, admin, super admin), the
 *                  trail every module already writes; company news otherwise
 *   on shift       /staff/attendance/monitor (the managing roles)
 *   lives          /staff/live-sessions
 *   upcoming       /staff/desk (the decisions waiting on you), the task
 *                  board, /staff/events, your own pending leave
 *   system         /system/health (CEO and admin): backups, migrations,
 *                  logged errors - never an uptime figure, which the portal
 *                  does not measure
 * Nothing here writes. Every card opens the tab that owns the records, and
 * a card whose data this person may not see is not drawn.
 *
 * Not in the reference and not built: "Total Enquiries" (the Enquiries tab
 * was retired in v1.183.0 - the tile shows open quotations, the funnel the
 * Sales tab owns), "Projects & Campaigns" (no project records exist; the
 * Content tab is parked - the card shows the live sessions on the roster),
 * "Module Usage" (no usage analytics exist - a business summary instead) and
 * uptime percentages (not measured).
 */

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Donut } from "@/components/ui/donut";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { deskAnchor, deskBucketWord, splitDesk, useDeskData } from "@/components/portal/one-desk";
import type { Announcement, LeaveReq, Task, User } from "@/components/portal/page-shared";
import { MANAGE_ROLES, annCatL, leaveTypeL, priorityL, revealAnchor } from "@/components/portal/page-shared";
import type { DashSummary, RevenueData } from "@/components/portal/dashboard";
import { useCachedApi } from "@/lib/cached-api";
import { api } from "@/lib/api";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { getLang, type Lang } from "@/lib/i18n";
import { LeaveMonthCard } from "@/components/portal/leave-month-card";
import { ReportingLineStrip } from "@/components/portal/reporting-line-card";
import { AdviceSummaryCard, FinanceHealthCard, PipelineCard, SalesPaceCard, TeamPerformanceCard, TodayFocusCard, oppStatus, useWeekDash } from "@/components/portal/week-target-card";
import { usePortal } from "@/components/portal/portal-provider";
import type { TodayShiftKind } from "@/components/portal/on-shift";
import { taskFigures } from "@/lib/task-figures";
import type { TabName } from "@/lib/portal-tabs";
import { card, chipDanger, chipGold, chipInfo, chipNeutral, chipSuccess, chipWarn } from "@/lib/ui-styles";
import ov from "./dashboard-overview.module.css";
import x from "./executive.module.css";
import { AlertBand, ApprovalsCard, ContributionCard, DecisionQueueCard, FollowUpsCard, MyTasksCard, MyWorkStrip, NextActionsCard, NextBestActionCard, QuickActionsStrip, SalesRecoveryStrip, SalesSummaryCard, ScheduleCard, TodayStrip, ViewSwitch, daysWaiting, usePerformance, vsWord, type AlertLine, type DayAction, type FollowLite, type NextAction, type QuickAction, type ScheduleLite } from "@/components/portal/executive-cards";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** The month's sales exactly as the Sales floor sums them (trading-desk.tsx):
    TikTok + paid invoices + other shipments + manual sales, this month and
    last. tests/dashboard-overview.mjs holds the two sums together. */
export function revenueMonthTotals(rev: RevenueData) {
  const total = rev.tiktok.this_cents + rev.invoiced.this_cents + (rev.other?.this_cents ?? 0) + (rev.manual?.this_cents ?? 0);
  const last = rev.tiktok.last_cents + rev.invoiced.last_cents + (rev.other?.last_cents ?? 0) + (rev.manual?.last_cents ?? 0);
  const delta = last > 0 ? Math.round(((total - last) / last) * 100) : null;
  return { total, last, delta };
}

interface MonitorRow { id: number; name: string; role: string; in_at?: string | null; out_at?: string | null; last_type?: string | null; shifts?: number }
interface Session { id: number; session_date: string; start_time: string; end_time?: string | null; platform: string; host_user_id: number; host_name?: string | null; client_company?: string | null; client_name?: string | null; status: string; notes?: string | null }
interface AuditRow { id: number; action: string; entity?: string | null; entity_id?: string | null; detail?: string | null; created_at: string; user_name?: string | null }
interface CompanyEvent { id: number; title: string; category: string; event_date: string; start_time?: string | null; location?: string | null }
interface Health { errors: { id: number; created_at: string; source: string; message: string }[]; last_backup: { key: string; size: number; uploaded: string } | null; last_offsite?: string | null; migrations_pending?: string[] }
type MyShift = { known: boolean; open: boolean; since: string; out: string; hasOut: boolean };

const ADMIN_TIER = ["super_admin", "admin", "ceo"];
const REVENUE_READERS = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];

/** "2026-09-18 02:00:00" (UTC, as the worker stores it) → minutes / hours / days ago */
function ago(utc: string): string {
  const t = new Date(utc.replace(" ", "T") + (utc.includes("Z") || utc.includes("+") ? "" : "Z")).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return L("just now", "baru sahaja");
  if (m < 60) return L(`${m} min ago`, `${m} min lalu`);
  const h = Math.round(m / 60);
  if (h < 24) return L(`${h} h ago`, `${h} j lalu`);
  const d = Math.round(h / 24);
  return L(`${d} d ago`, `${d} h lalu`);
}
/** an ISO / UTC instant → "DD-MM-YYYY HH:MM" and its date, in Malaysia time */
const mytStamp = (instant: string) => {
  const t = new Date(instant.includes("T") ? instant : instant.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return { date: "", text: "" };
  const iso = new Date(t + 8 * 3600 * 1000).toISOString();
  return { date: iso.slice(0, 10), text: `${dmy(iso.slice(0, 10))} ${iso.slice(11, 16)}` };
};
/** UTC "YYYY-MM-DD HH:MM:SS" → "HH:MM" Malaysia time */
const mytHm = (utc: string) => {
  const t = new Date(utc.replace(" ", "T") + "Z").getTime();
  return Number.isNaN(t) ? "" : new Date(t + 8 * 3600 * 1000).toISOString().slice(11, 16);
};

/* ---- the audit trail, said in words. The action names are the modules'
   own ("hotel.update", "leave.approve" ...); the verb and the noun are read
   from them, so a new action still reads sensibly without a table entry. */
const VERB: Record<string, [string, string]> = {
  create: ["added", "ditambah"], add: ["added", "ditambah"], update: ["updated", "dikemas kini"], edit: ["updated", "dikemas kini"],
  delete: ["removed", "dibuang"], remove: ["removed", "dibuang"], approve: ["approved", "diluluskan"], reject: ["rejected", "ditolak"],
  decide: ["decided", "diputuskan"], cancel: ["cancelled", "dibatalkan"], offboard: ["offboarded", "ditamatkan"], role_change: ["role changed", "peranan ditukar"],
  release: ["released", "dikeluarkan"], submit: ["submitted", "dihantar"], complete: ["completed", "diselesaikan"], stage: ["moved", "dipindah"],
  call: ["call logged", "panggilan direkodkan"], responsibilities_update: ["roles written", "peranan ditulis"], status: ["status changed", "status ditukar"],
};
const NOUN_ICON: Record<string, AppIconName> = {
  hotel: "store", asset: "package", leave: "holiday", claim: "receipt", task: "orders", staff: "person", user: "person",
  payroll: "money", invoice: "receipt", doc: "document", quotation: "document", inventory: "inventory", stock: "inventory",
  attendance: "time", ot: "time", announcement: "chat", event: "date", customer: "clients", client: "clients",
};
function auditLine(a: AuditRow): { title: string; sub: string; icon: AppIconName } {
  const [nounRaw = "", ...rest] = a.action.split(".");
  const verbKey = rest.join("_");
  const noun = nounRaw.replace(/_/g, " ");
  const verb = VERB[verbKey] ?? VERB[rest[rest.length - 1] ?? ""] ?? null;
  let what = "";
  try {
    const d = a.detail ? JSON.parse(a.detail) as Record<string, unknown> : {};
    for (const k of ["hotel_name", "name", "title", "asset_tag", "person", "staff", "doc_no", "number", "company", "employee"]) {
      if (typeof d[k] === "string" && (d[k] as string).trim()) { what = d[k] as string; break; }
    }
  } catch { /* a plain-text detail: say nothing rather than print JSON */ }
  const title = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${verb ? L(verb[0], verb[1]) : rest.join(" ").replace(/_/g, " ")}`.trim();
  return { title, sub: [what, a.user_name ? L(`by ${a.user_name}`, `oleh ${a.user_name}`) : ""].filter(Boolean).join(" · "), icon: NOUN_ICON[nounRaw] ?? "info" };
}

export function DashboardOverview({ user, go, canOpen, lang, onCreateQuotation, openAt, onOpenDay, onOpenShift, todayShift, myShift, monitor, sessions, anns, annsKnown, ownLeave, view = "overview", shiftKind, onOpenOverview }: {
  user: User;
  go: (t: TabName) => void;
  canOpen?: (t: string) => boolean;
  lang: Lang;
  onCreateQuotation?: () => void;
  openAt?: (t: TabName, view: string) => void;
  onOpenDay: () => void;
  /** v1.229.0 - where a shift shortcut goes: On Shift, which owns the punch */
  onOpenShift?: () => void;
  /** v1.229.0 - the read-only Today's Shift card (on-shift.tsx), drawn in place of My Shift */
  todayShift?: ReactNode;
  myShift: MyShift;
  /** today's monitor rows - the request the Dashboard already makes for the managing roles; null = not read */
  monitor: MonitorRow[] | null;
  /** the live sessions the Dashboard already reads */
  sessions: Session[] | null;
  anns: Announcement[];
  annsKnown: boolean;
  ownLeave: LeaveReq[];
  /** v1.291.0 (4.0) - which of the two views management is reading; the zones draw My Day for everyone else */
  view?: "overview" | "day";
  /** v1.291.0 - On Shift's verdict for today (on-shift.tsx todayShiftKind): a shift card only when one is rostered */
  shiftKind?: TodayShiftKind;
  /** v1.291.0 - My Day's one decisions line opens the Overview */
  onOpenOverview?: () => void;
}) {
  const can = (t: string) => (canOpen ? canOpen(t) : false);
  const manage = MANAGE_ROLES.includes(user.role);
  const adminTier = ADMIN_TIER.includes(user.role);
  const canRevenue = REVENUE_READERS.includes(user.role);
  const today = mytToday();

  /* ---- the reads: the modules' own remembered views ---- */
  const revView = useCachedApi<RevenueData>(canRevenue ? "/staff/revenue" : null, canRevenue);
  const sumView = useCachedApi<DashSummary>("/staff/dashboard/summary");
  const canInv = can("Inventory");
  const invView = useCachedApi<{ items?: { id: number; stock: number }[] }>(canInv ? "/staff/inventory" : null, canInv);
  const taskView = useCachedApi<{ tasks: Task[] }>(`/staff/tasks${manage ? "?all=1" : ""}`, true, ["tasks"]);
  const desk = useDeskData();
  /* v1.263.0 - the week (Sales' own engine), one shared request for the KPI strip and rows 2-4 */
  const weekView = useWeekDash();
  const wk = weekView.data;
  const { openRecord, dashDate, setDashDate } = usePortal();
  /* v1.280.0 - MINIMAL EXECUTIVE WORKSPACE (E2): management - the people the
     week engine gives the company outlook (exec_view) - reads the photo's
     dashboard; the same people may read the company figure by day */
  const exec = Boolean(wk?.outlook);
  const perfWeek = usePerformance("week", exec);
  /* v1.291.0 (4.0, risk R3) - "verified" outstanding only while the CEO verifies payments: the Payments queue's own switch, read only by management */
  const pvView = useCachedApi<{ on?: boolean }>(exec ? "/staff/payments" : null, exec, ["docs"]);
  const verifying = pvView.data?.on === true;
  const pw = perfWeek.data && perfWeek.data.period === "week" ? perfWeek.data : null;
  const [moreOpen, setMoreOpen] = useState(false);
  const [audit, setAudit] = useState<AuditRow[] | null | "denied">(adminTier ? null : "denied");
  const [events, setEvents] = useState<CompanyEvent[] | null>(null);
  const [health, setHealth] = useState<Health | null | "denied">(adminTier ? null : "denied");
  /* the moment the card opened: a backup's age and the day's errors are read against it */
  const [nowMs] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    if (adminTier) {
      void api<{ entries?: AuditRow[] }>("/audit?limit=60").then((r) => {
        if (!live) return;
        setAudit(r.ok && r.data?.entries ? r.data.entries : "denied");
      });
      void api<Health>("/system/health").then((r) => {
        if (live) setHealth(r.ok && r.data ? r.data : "denied");
      });
    }
    void api<{ events?: CompanyEvent[] }>("/staff/events").then((r) => {
      if (live) setEvents(r.ok && r.data?.events ? r.data.events : []);
    });
    return () => { live = false; };
  }, [adminTier]);

  const rev = revView.data;
  const sales = rev ? revenueMonthTotals(rev) : null;
  const sum = sumView.data;
  const tasks = useMemo(() => taskView.data?.tasks ?? [], [taskView.data]);
  const tasksLoaded = !taskView.loading;
  const tf = taskFigures(tasks, today);
  const openOnly = tf.openTasks.length - tf.pendingCount;
  const deskItems = desk.data?.items ?? [];
  const { decide } = splitDesk(deskItems);
  const onShift = (monitor ?? []).filter((m) => m.last_type === "clock_in");
  const items = invView.data?.items ?? null;

  /* ---- B. the five tiles: the reference's five where this person may see
     them, the person's own figures where not, in a fixed order ---- */
  type Tile = { key: string; node: ReactNode };
  const tiles: Tile[] = [];
  /* v1.263.0 - ROW 1 (claude/COMPACT-DASHBOARD-AUDIT.md sec. 3): management
     reads the week's six figures from Sales' engine; a staff member reads
     their own; the tiles of before stay for anyone the week does not cover.
     Sales this month is in Sales performance, Inventory items and Active
     staff in Business summary and Team on shift - nothing is lost. */
  const wkTiles: Tile[] = [];
  const tasksTile: Tile = { key: "tasks", node: (
    <KpiTile icon="orders" tone="red" label={manage ? L("Open tasks", "Tugasan terbuka") : L("My open tasks", "Tugasan terbuka saya")} busy={!tasksLoaded}
      value={tf.openTasks.length}
      sub={tf.overdueCount > 0 ? L(`${tf.overdueCount} overdue`, `${tf.overdueCount} lewat`) : L("None overdue", "Tiada yang lewat")}
      onClick={() => go("Tasks")} />
  ) };
  if (wk?.outlook) {
    const o = wk.outlook, c = wk.company, gap = c.gap_cents;
    wkTiles.push(
      { key: "w-target", node: <KpiTile icon="target" tone="gold" label={L("Weekly target", "Sasaran mingguan")} value={c.target_cents === null ? L("Not set", "Belum ditetapkan") : fmtRM(c.target_cents)} sub={`${dmy(wk.week.from)} – ${dmy(wk.week.to)}`} onClick={() => go("Sales")} /> },
      /* v1.275.0 - from 10-11-2026 the company figure counts every channel: it is "Company sales", not "Collected" */
      { key: "w-collected", node: <KpiTile icon="money" tone="green" label={c.basis_kind === "all_channels" ? L("Company sales", "Jualan syarikat") : L("Collected", "Dikutip")} value={fmtRM(c.basis_cents)}
        sub={c.pct === null ? (c.basis_kind === "all_channels" ? L("This week · all channels", "Minggu ini · semua saluran") : L("Paid in full this week", "Dibayar penuh minggu ini")) : (c.basis_kind === "all_channels" ? L(`${c.pct}% of target · all channels`, `${c.pct}% daripada sasaran · semua saluran`) : L(`${c.pct}% of target`, `${c.pct}% daripada sasaran`))} bar={c.pct === null ? undefined : { pct: c.pct, tone: "gold" }} onClick={() => go("Sales")} /> },
      { key: "w-gap", node: <KpiTile icon="balance" tone="red" label={L("Remaining gap", "Baki")} value={gap === null ? "—" : fmtRM(gap)} sub={L(`${o.days_left} working day(s) left`, `${o.days_left} hari bekerja lagi`)} onClick={() => go("Sales")} /> },
      { key: "w-pace", node: <KpiTile icon="fast" tone="navy" label={L("Required pace", "Rentak diperlukan")} value={o.required_per_day_cents === null ? "—" : fmtRM(o.required_per_day_cents)} sub={o.required_per_day_cents === null ? (gap === null ? L("No company target", "Tiada sasaran syarikat") : L("Nothing left to pace", "Tiada baki")) : (c.basis_kind === "all_channels" ? L("sales per working day", "jualan setiap hari bekerja") : L("collected per working day", "dikutip setiap hari bekerja"))} onClick={() => go("Sales")} /> },
      { key: "w-open", node: <KpiTile icon="document" tone="purple" label={L("Open quotations", "Sebut harga terbuka")} value={fmtRM(o.open_quotations.cents)} sub={L(`${o.open_quotations.n} open${o.ageing_quotations ? ` · ${o.ageing_quotations} going cold` : ""}`, `${o.open_quotations.n} terbuka${o.ageing_quotations ? ` · ${o.ageing_quotations} semakin sejuk` : ""}`)} onClick={() => (openAt ? openAt("Sales", "open_quotations") : go("Sales"))} /> },
      tasksTile,
    );
  } else if (wk?.me) {
    const me = wk.me, goal = me.goals[0];
    const { decide: d0, attention: a0 } = splitDesk(deskItems);
    wkTiles.push(
      { key: "w-mine", node: <KpiTile icon="target" tone="gold" label={me.target_cents !== null ? L("My weekly target", "Sasaran mingguan saya") : goal ? L("My weekly goal", "Matlamat mingguan saya") : L("My weekly target", "Sasaran mingguan saya")}
        value={me.target_cents !== null ? fmtRM(me.target_cents) : goal ? `${goal.actual} / ${goal.target}` : L("None set", "Tiada")} sub={me.target_cents !== null ? L(`${fmtRM(me.basis_cents)} collected`, `${fmtRM(me.basis_cents)} dikutip`) : L(`Company ${wk.company.pct ?? 0}%`, `Syarikat ${wk.company.pct ?? 0}%`)}
        bar={me.pct === null ? undefined : { pct: me.pct, tone: "gold" }} onClick={() => go(wk.can_sales && can("Sales") ? "Sales" : "Dashboard")} /> },
      { key: "w-fu", node: <KpiTile icon="calendarAdd" tone="blue" label={L("Follow-ups due", "Susulan perlu")} value={(me.followups_today ?? 0) + me.followups_overdue} sub={L(`${me.followups_overdue} late`, `${me.followups_overdue} lewat`)} onClick={() => go(can("Sales") ? "Sales" : "Desk")} /> },
      tasksTile,
      { key: "desk", node: <KpiTile icon="pending" tone="navy" label={L("Waiting on me", "Menunggu saya")} busy={desk.data === null} value={d0.length + a0.length} sub={L(`${d0.length} need my decision`, `${d0.length} perlu keputusan saya`)} onClick={() => go("Desk")} /> },
      { key: "leave", node: <KpiTile icon="holiday" tone="purple" label={L("My leave", "Cuti saya")} value={ownLeave.length} sub={ownLeave.length ? L("Waiting for a decision", "Menunggu keputusan") : L("Nothing pending", "Tiada menunggu")} onClick={() => go("Leave")} /> },
    );
  }
  if (canRevenue && (can("Sales") || can("Ecommerce"))) {
    tiles.push({ key: "sales", node: (
      <KpiTile icon="money" tone="green" label={L("Sales this month", "Jualan bulan ini")} busy={!rev}
        value={sales ? fmtRM(sales.total) : "—"}
        delta={sales && sales.delta !== null ? { pct: sales.delta, text: `${sales.delta >= 0 ? "+" : "−"}${Math.abs(sales.delta)}%`, vs: L("vs last month", "berbanding bulan lalu") } : undefined}
        sub={sales && sales.delta === null ? L("Nothing last month to compare", "Tiada jualan bulan lalu untuk dibandingkan") : undefined}
        onClick={() => go(can("Ecommerce") ? "Ecommerce" : "Sales")} title={L("Every channel this month — open the sales figures", "Setiap saluran bulan ini — buka angka jualan")} />
    ) });
  }
  if (can("Sales") && sum && typeof sum.open_quotations === "number") {
    tiles.push({ key: "quotes", node: (
      <KpiTile icon="document" tone="purple" label={L("Open quotations", "Sebut harga terbuka")} value={sum.open_quotations}
        /* v1.240.0 (the owner: "make the relationship clear without merging
           distinct metrics") - the figure is quotations not yet invoiced;
           unpaid invoices are a different count, said as one */
        sub={typeof sum.outstanding_invoices === "number" ? L(`Not invoiced · unpaid invoices: ${sum.outstanding_invoices}`, `Belum diinvois · invois belum dibayar: ${sum.outstanding_invoices}`) : L("Not yet invoiced", "Belum diinvois")}
        onClick={() => go("Sales")} title={L("Quotations not yet invoiced — open Sales", "Sebut harga belum diinvois — buka Jualan")} />
    ) });
  }
  if (canInv) {
    tiles.push({ key: "stock", node: (
      <KpiTile icon="inventory" tone="blue" label={L("Inventory items", "Item inventori")} busy={items === null && invView.loading}
        value={items ? items.length : "—"}
        sub={typeof sum?.low_stock === "number" ? L(`${sum.low_stock} low or out of stock (5 or fewer)`, `${sum.low_stock} stok rendah atau habis (5 atau kurang)`) : L("Products on the stock list", "Produk dalam senarai stok")}
        onClick={() => go("Inventory")} />
    ) });
  }
  if (manage && sum && typeof sum.staff_total === "number") {
    tiles.push({ key: "staff", node: (
      <KpiTile icon="users" tone="gold" label={L("Active staff", "Kakitangan aktif")} value={sum.staff_total}
        sub={monitor ? L(`${monitor.filter((m) => !!m.in_at).length} clocked in today`, `${monitor.filter((m) => !!m.in_at).length} daftar masuk hari ini`) : L("Working today", "Bekerja hari ini")}
        onClick={() => go(can("Staff Details") ? "Staff Details" : "Attendance")} />
    ) });
  }
  tiles.push(tasksTile);
  /* the person's own figures fill the row for the roles without the company ones */
  if (tiles.length < 5) {
    const { decide: d, attention } = splitDesk(deskItems);
    tiles.push({ key: "desk", node: (
      <KpiTile icon="pending" tone="navy" label={L("Waiting on me", "Menunggu saya")} busy={desk.data === null}
        value={d.length + attention.length} sub={L(`${d.length} need my decision`, `${d.length} perlu keputusan saya`)} onClick={() => go("Desk")} />
    ) });
  }
  if (tiles.length < 5) {
    tiles.push({ key: "leave", node: (
      <KpiTile icon="holiday" tone="purple" label={L("My leave", "Cuti saya")} value={ownLeave.length}
        sub={ownLeave.length ? L("Waiting for a decision", "Menunggu keputusan") : L("Nothing pending", "Tiada menunggu")}
        onClick={() => go("Leave")} />
    ) });
  }

  /* ---- shared card head ---- */
  const head = (title: string, right?: ReactNode, sub?: string) => (
    <div className={ov.head}>
      <div className={ov.headText}>
        <h3 className={ov.title}>{title}</h3>
        {sub && <p className={ov.sub}>{sub}</p>}
      </div>
      {right}
    </div>
  );
  const viewAll = (onClick: () => void, label = L("View all", "Lihat semua")) => (
    <button type="button" className={ov.viewAll} onClick={onClick}>{label}</button>
  );
  const empty = (icon: AppIconName, text: string) => <p className={ov.empty}><AppIcon name={icon} />{text}</p>;

  /* ---- C1. recent activities (the audit trail), or the company news ---- */
  const activities = Array.isArray(audit) ? audit.filter((a) => !a.action.startsWith("auth.") && !a.action.startsWith("2fa")).slice(0, 5) : [];
  const activityCard = adminTier && audit !== "denied" ? (
    <section className={`${card} ${ov.card}`} aria-label={L("Recent activities", "Aktiviti terkini")}>
      {head(L("Recent Activities", "Aktiviti Terkini"), user.role === "ceo" ? undefined : <Link className={ov.viewAll} href="/admin">{L("Audit log", "Log audit")}</Link>,
        L("What changed across the modules, newest first.", "Apa yang berubah dalam modul, terkini dahulu."))}
      {audit === null ? <SkelRows rows={5} /> : activities.length === 0 ? empty("info", L("Nothing recorded yet.", "Belum ada yang direkodkan.")) : (
        <ul className={ov.rows}>
          {activities.map((a) => {
            const line = auditLine(a);
            return (
              <li key={a.id} className={ov.row}>
                <span className={`${ov.well} ${ov.goldWell}`} aria-hidden><AppIcon name={line.icon} /></span>
                <span className={ov.rowText}><strong>{line.title}</strong>{line.sub && <span>{line.sub}</span>}</span>
                <span className={ov.when}>{ago(a.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  ) : (
    <section className={`${card} ${ov.card}`} aria-label={L("Company news", "Berita syarikat")}>
      {head(L("Company News", "Berita Syarikat"), can("Announcements") ? viewAll(() => go("Announcements")) : undefined, L("The latest announcements.", "Pengumuman terkini."))}
      {!annsKnown ? <SkelRows rows={4} /> : anns.length === 0 ? empty("chat", L("No announcements.", "Tiada pengumuman.")) : (
        <ul className={ov.rows}>
          {anns.slice(0, 5).map((a) => (
            <li key={a.id} className={ov.row}>
              <span className={`${ov.well} ${ov.blueWell}`} aria-hidden><AppIcon name="chat" /></span>
              <span className={ov.rowText}><strong>{a.title}</strong><span>{annCatL(a.category)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- C2. task overview: the Tasks page's own four figures ---- */
  const taskSlices = [
    { key: "closed", label: L("Closed", "Selesai"), value: tf.doneCount, color: "var(--success)" },
    { key: "open", label: L("Open", "Terbuka"), value: openOnly, color: "var(--info)" },
    { key: "pending", label: L("In progress", "Sedang dibuat"), value: tf.pendingCount, color: "var(--warning)" },
  ];
  const pctOf = (n: number) => (tasks.length ? Math.round((n * 100) / tasks.length) : 0);
  const taskCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Task overview", "Gambaran tugasan")}>
      {head(L("Task Overview", "Gambaran Tugasan"), viewAll(() => go("Tasks")), manage ? L("Every task on the board.", "Setiap tugasan pada papan.") : L("Your tasks.", "Tugasan anda."))}
      {!tasksLoaded ? <SkelRows rows={4} /> : tasks.length === 0 ? empty("orders", L("No tasks yet.", "Belum ada tugasan.")) : (
        <div className={ov.donutRow}>
          <Donut size={150} hideLegend centerLabel={String(tasks.length)} centerSub={L("total tasks", "jumlah tugasan")} slices={taskSlices.map(({ label, value, color }) => ({ label, value, color }))} />
          <ul className={ov.legend}>
            {[...taskSlices, { key: "overdue", label: L("Overdue", "Lewat"), value: tf.overdueCount, color: "var(--danger)" }].map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => go("Tasks")}>
                  <span className={ov.dot} style={{ background: s.color }} aria-hidden />
                  <span>{s.label}</span>
                  <strong>{s.value}</strong>
                  <span className={ov.muted}>{pctOf(s.value)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );

  /* ---- C3. sales performance: the month figure and the months behind it ---- */
  const months = (rev?.overall?.months ?? []).slice(-10);
  const maxMonth = Math.max(1, ...months.map((m) => m.cents));
  const salesCard = canRevenue ? (
    <section className={`${card} ${ov.card}`} aria-label={L("Sales performance", "Prestasi jualan")}>
      {head(L("Sales Performance", "Prestasi Jualan"), (can("Ecommerce") || can("Sales")) ? viewAll(() => go(can("Ecommerce") ? "Ecommerce" : "Sales"), L("Open", "Buka")) : undefined,
        rev ? L(`${rev.month.slice(5, 7)}-${rev.month.slice(0, 4)}, every channel`, `${rev.month.slice(5, 7)}-${rev.month.slice(0, 4)}, setiap saluran`) : undefined)}
      {!rev ? <SkelRows rows={5} /> : (
        <>
          <p className={ov.bigMoney}>{sales ? fmtRM(sales.total) : "—"}</p>
          {sales && (
            <p className={sales.delta === null ? ov.muted : sales.delta >= 0 ? ov.up : ov.down}>
              {sales.delta === null ? L("No sales last month to compare with", "Tiada jualan bulan lalu untuk dibandingkan")
                : L(`${sales.delta >= 0 ? "↑" : "↓"} ${Math.abs(sales.delta)}% vs last month (${fmtRM(sales.last)})`, `${sales.delta >= 0 ? "↑" : "↓"} ${Math.abs(sales.delta)}% berbanding bulan lalu (${fmtRM(sales.last)})`)}
            </p>
          )}
          {months.length > 1 ? (
            <>
              <div className={ov.chart} role="img" aria-label={months.map((m) => `${m.month}: ${fmtRM(m.cents)}`).join(", ")}>
                {months.map((m) => (
                  <span key={m.month} className={ov.chartCol} title={`${m.month} · ${fmtRM(m.cents)}`}>
                    <span className={ov.chartTrack}><span className={ov.chartBar} style={{ height: `${Math.max(2, (m.cents / maxMonth) * 100)}%` }} /></span>
                    <span className={ov.chartLabel}>{new Date(`${m.month}-01T00:00:00Z`).toLocaleString(lang === "ms" ? "ms-MY" : "en-GB", { month: "short", timeZone: "UTC" })}</span>
                  </span>
                ))}
              </div>
              <p className={ov.caption}>{L("Bars: every revenue line by month, stokis and ELFIA web orders included — the figure above counts TikTok, invoices, other shipments and manual sales, as the Sales floor does.",
                "Bar: setiap baris hasil mengikut bulan, termasuk stokis dan pesanan web ELFIA — angka di atas mengira TikTok, invois, penghantaran lain dan jualan manual, seperti lantai jualan.")}</p>
            </>
          ) : empty("chart", L("Monthly history appears after the second month of sales.", "Sejarah bulanan muncul selepas bulan jualan kedua."))}
        </>
      )}
    </section>
  ) : null;

  /* ---- D1. live sessions (the roster): what the reference called campaigns ---- */
  const upcomingLives = (sessions ?? []).filter((s) => s.status === "scheduled" && s.session_date >= today).slice(0, 4);
  const livesCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Live sessions", "Sesi live")}>
      {head(L("Live Sessions", "Sesi Live"), can("Attendance") ? viewAll(() => go("Attendance")) : undefined,
        manage ? L("Upcoming lives on the roster.", "Live akan datang dalam roster.") : L("Your upcoming lives.", "Live anda akan datang."))}
      {sessions === null ? <SkelRows rows={3} /> : upcomingLives.length === 0 ? empty("live", L("No live session is scheduled.", "Tiada sesi live dijadualkan.")) : (
        <ul className={ov.rows}>
          {upcomingLives.map((s) => (
            <li key={s.id} className={ov.row}>
              <span className={`${ov.well} ${ov.redWell}`} aria-hidden><AppIcon name="live" /></span>
              <span className={ov.rowText}>
                <strong>{s.client_company ?? s.client_name ?? L("Live session", "Sesi live")}</strong>
                <span>{[s.host_name, s.notes].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={ov.rowEnd}>
                <span className={s.session_date === today ? chipGold : chipNeutral}>{s.session_date === today ? L("Today", "Hari ini") : dmy(s.session_date)}</span>
                <span className={ov.when}>{s.start_time}{s.end_time ? `–${s.end_time}` : ""} · {s.platform}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- D2. team on shift (the managing roles), or your own shift ---- */
  const shiftCard = manage ? (
    <section className={`${card} ${ov.card}`} aria-label={L("Team on shift", "Pasukan sedang syif")}>
      {head(L("Team On Shift", "Pasukan Sedang Syif"), can("Attendance") ? viewAll(() => go("Attendance"), L("View attendance", "Lihat kehadiran")) : undefined)}
      {monitor === null ? <SkelRows rows={4} /> : (
        <>
          <p className={ov.ratio}><strong>{onShift.length}</strong><span>/ {monitor.length}</span><em>{L("staff on shift now", "kakitangan sedang syif")}</em></p>
          {onShift.length === 0 ? empty("time", L("Nobody is clocked in right now.", "Tiada siapa daftar masuk sekarang.")) : (
            <ul className={ov.rows}>
              {onShift.slice(0, 5).map((m) => (
                <li key={m.id} className={ov.row}>
                  <Avatar name={m.name} size="md" />
                  <span className={ov.rowText}><strong>{m.name}</strong><span className={ov.cap}>{m.role.replace(/_/g, " ")}</span></span>
                  <span className={ov.rowEnd}>
                    <span className={chipSuccess}>{L("On shift", "Sedang syif")}</span>
                    {m.in_at && <span className={ov.when}>{L(`in ${mytHm(m.in_at)}`, `masuk ${mytHm(m.in_at)}`)}</span>}
                  </span>
                </li>
              ))}
              {onShift.length > 5 && <li className={ov.more}>{L(`and ${onShift.length - 5} more`, `dan ${onShift.length - 5} lagi`)}</li>}
            </ul>
          )}
        </>
      )}
    </section>
  ) : todayShift ? (
    /* v1.229.0 (the owner, 30-10-2026: "DASHBOARD TODAY = COMPACT SUMMARY
       ONLY"): the same read-only Today's Shift card My Day draws */
    <div className={ov.card}>{todayShift}</div>
  ) : (
    <section className={`${card} ${ov.card}`} aria-label={L("My shift", "Syif saya")}>
      {head(L("My Shift", "Syif Saya"), viewAll(onOpenShift ?? onOpenDay, L("Open On Shift", "Buka Syif Saya")))}
      {!myShift.known ? <SkelRows rows={2} /> : (
        <div className={ov.myShift}>
          <span className={myShift.open ? chipSuccess : myShift.hasOut ? chipNeutral : chipWarn}>
            {myShift.open ? L(`On shift · since ${myShift.since}`, `Sedang syif · sejak ${myShift.since}`)
              : myShift.hasOut ? L(`Clocked out · ${myShift.since} → ${myShift.out}`, `Daftar keluar · ${myShift.since} → ${myShift.out}`)
              : L("Not clocked in yet", "Belum daftar masuk")}
          </span>
          <p className={ov.sub}>{L("Check in and out on On Shift.", "Daftar masuk dan keluar di Syif Saya.")}</p>
        </div>
      )}
    </section>
  );

  /* ---- D3. upcoming & pending: the desk's decisions, the next deadlines,
     the next company events, your own leave waiting - each opens its tab ---- */
  type Up = { key: string; title: string; sub: string; date: string | null; chip: ReactNode; icon: AppIconName; well: string | undefined; open: () => void };
  const ups: Up[] = [
    ...decide.slice(0, 3).map((d): Up => ({
      key: `d-${d.id}`, title: d.title, sub: d.sub, date: null, icon: "pending", well: ov.goldWell,
      chip: <span className={d.overdue ? chipDanger : chipWarn}>{d.overdue ? L("Overdue", "Lewat") : L("Your decision", "Keputusan anda")}</span>,
      open: () => go(d.tab as TabName),
    })),
    ...tf.openTasks.filter((t) => t.deadline && t.deadline >= today).sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "")).slice(0, 3).map((t): Up => ({
      key: `t-${t.id}`, title: t.title, sub: L("Task", "Tugasan") + (t.assignee ? ` · ${t.assignee}` : ""), date: t.deadline ?? null, icon: "orders", well: ov.blueWell,
      chip: <span className={t.status === "in_progress" ? chipWarn : chipInfo}>{t.status === "in_progress" ? L("In progress", "Sedang dibuat") : L("Open", "Terbuka")}</span>,
      open: () => go("Tasks"),
    })),
    ...(events ?? []).filter((e) => e.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date)).slice(0, 2).map((e): Up => ({
      key: `e-${e.id}`, title: e.title, sub: [L("Event", "Acara"), e.start_time, e.location].filter(Boolean).join(" · "), date: e.event_date, icon: "date", well: ov.greenWell,
      chip: <span className={chipInfo}>{L("Scheduled", "Dijadualkan")}</span>,
      open: onOpenDay,
    })),
    ...ownLeave.slice(0, 2).map((l): Up => ({
      key: `l-${l.id}`, title: leaveTypeL(l.type), sub: L("My leave request", "Permohonan cuti saya"), date: l.start_date, icon: "holiday", well: ov.redWell,
      chip: <span className={chipWarn}>{L("Pending", "Menunggu")}</span>,
      open: () => go("Leave"),
    })),
  ];
  const upLoaded = desk.data !== null && tasksLoaded && events !== null;
  const upcomingCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Upcoming and pending", "Akan datang dan menunggu")}>
      {head(L("Upcoming & Pending", "Akan Datang & Menunggu"), viewAll(() => go("Desk"), L("Open the Desk", "Buka Meja")))}
      {!upLoaded ? <SkelRows rows={5} /> : ups.length === 0 ? empty("success", L("Nothing waiting and nothing coming up.", "Tiada yang menunggu dan tiada yang akan datang.")) : (
        <ul className={ov.rows}>
          {ups.slice(0, 3).map((u) => (
            <li key={u.key}>
              <button type="button" className={`${ov.row} ${ov.rowBtn}`} onClick={u.open}>
                <span className={`${ov.well} ${u.well}`} aria-hidden><AppIcon name={u.icon} /></span>
                <span className={ov.rowText}><strong>{u.title}</strong><span>{u.sub}</span></span>
                <span className={ov.rowEnd}>{u.chip}{u.date && <span className={ov.when}>{dmy(u.date)}</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- E1. quick actions - v1.280.0: the photo's Quick Actions strip
     (executive-cards.tsx QuickActionsStrip, built below), one strip, not a
     card here and a strip there ---- */

  /* ---- E2. the business summary (in place of "module usage", which the
     portal does not measure): the counts the worker gives this person ---- */
  const sumRows: { key: string; label: string; n: number; tab: TabName; warn: boolean }[] = [];
  const addSum = (key: keyof DashSummary, label: string, tab: TabName, warnFrom = 1) => {
    const v = sum?.[key];
    if (typeof v === "number" && can(tab)) sumRows.push({ key, label, n: v, tab, warn: v >= warnFrom });
  };
  addSum("pending_leave", L("Leave waiting for a decision", "Cuti menunggu keputusan"), "Leave");
  addSum("pending_claims", L("Claims waiting for a decision", "Tuntutan menunggu keputusan"), "Claims");
  addSum("pending_ot", L("Overtime to approve", "OT untuk diluluskan"), "Attendance");
  addSum("outstanding_invoices", L("Unpaid invoices", "Invois belum dibayar"), "Sales");
  addSum("low_stock", L("Items low or out of stock", "Item stok rendah atau habis"), "Inventory");
  addSum("lives_today", L("Live sessions today", "Sesi live hari ini"), "Attendance", 9999);
  addSum("clients", L("Clients on file", "Pelanggan dalam rekod"), "Sales", 999999);
  const maxSum = Math.max(1, ...sumRows.map((r) => r.n));
  const summaryCard = (
    <section className={`${card} ${ov.card}`} aria-label={L("Business summary", "Ringkasan perniagaan")}>
      {head(L("Business Summary", "Ringkasan Perniagaan"), undefined, L("Counts from the modules, as you may see them.", "Kiraan daripada modul, mengikut akses anda."))}
      {sumView.loading && !sum ? <SkelRows rows={5} /> : sumRows.length === 0 ? empty("info", L("No company figures for your role.", "Tiada angka syarikat untuk peranan anda.")) : (
        <ul className={ov.bars}>
          {sumRows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => go(r.tab)}>
                <span>{r.label}</span>
                <span className={ov.track}><span className={`${ov.fill} ${r.warn ? ov.fillWarn : ""}`} style={{ width: `${Math.max(r.n ? 4 : 0, (r.n / maxSum) * 100)}%` }} /></span>
                <strong>{r.n}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* ---- E3. system status: what the worker can actually say (CEO, admin) ---- */
  const backupAge = health && health !== "denied" && health.last_backup ? Math.floor((nowMs - new Date(health.last_backup.uploaded).getTime()) / 86_400_000) : null;
  const errors24 = health && health !== "denied" ? health.errors.filter((e) => nowMs - new Date(e.created_at.replace(" ", "T") + "Z").getTime() < 86_400_000).length : 0;
  const statusRow = (label: string, ok: boolean | null, chip: string, detail: string) => (
    <li className={ov.statusRow}>
      <span className={`${ov.statusDot} ${ok === null ? ov.dotGrey : ok ? ov.dotGreen : ov.dotAmber}`} aria-hidden />
      <span className={ov.rowText}><strong>{label}</strong><span>{detail}</span></span>
      <span className={ok === null ? chipNeutral : ok ? chipSuccess : chipWarn}>{chip}</span>
    </li>
  );
  const statusCard = adminTier && health !== "denied" ? (
    <section className={`${card} ${ov.card}`} aria-label={L("System status", "Status sistem")}>
      {head(L("System Status", "Status Sistem"), user.role !== "ceo" ? <Link className={ov.viewAll} href="/admin">{L("Open admin", "Buka admin")}</Link> : undefined,
        L("What the portal can check. Uptime is not measured here.", "Apa yang portal boleh semak. Masa operasi tidak diukur di sini."))}
      {health === null ? <SkelRows rows={4} /> : (
        <ul className={ov.rows}>
          {statusRow(L("Portal & API", "Portal & API"), true, L("Answering", "Menjawab"), L("This page just read from it", "Halaman ini baru membacanya"))}
          {statusRow(L("Database", "Pangkalan data"), (health.migrations_pending ?? []).length === 0,
            (health.migrations_pending ?? []).length === 0 ? L("Up to date", "Terkini") : L(`${health.migrations_pending!.length} pending`, `${health.migrations_pending!.length} tertunda`),
            (health.migrations_pending ?? []).length === 0 ? L("Every migration is applied", "Setiap migrasi telah digunakan") : L("Run the pending migrations, then deploy", "Jalankan migrasi tertunda, kemudian deploy"))}
          {statusRow(L("Backup", "Sandaran"), health.last_backup ? (backupAge ?? 0) <= 2 : false,
            health.last_backup ? (mytStamp(health.last_backup.uploaded).date === today ? L("Today", "Hari ini") : L(`${Math.max(1, backupAge ?? 1)} d ago`, `${Math.max(1, backupAge ?? 1)} h lalu`)) : L("None yet", "Belum ada"),
            health.last_backup ? L(`Last backup ${mytStamp(health.last_backup.uploaded).text}`, `Sandaran terakhir ${mytStamp(health.last_backup.uploaded).text}`) : L("Nightly backups run at 03:20 MYT", "Sandaran malam berjalan pada 03:20 MYT"))}
          {statusRow(L("Errors (24 h)", "Ralat (24 j)"), errors24 === 0, String(errors24),
            health.errors[0] ? L(`Latest ${ago(health.errors[0].created_at)} · ${health.errors[0].source}`, `Terkini ${ago(health.errors[0].created_at)} · ${health.errors[0].source}`) : L("None logged", "Tiada direkodkan"))}
        </ul>
      )}
    </section>
  ) : null;

  /* ---- v1.263.0 - rows 2 and 3 from the week (Sales' engine), each card
     only where the server sent its part ---- */
  const refreshWeek = weekView.refresh;
  const toSalesWeek = () => go("Sales");
  const row2: ReactNode[] = [];
  const row3: ReactNode[] = [];
  if (wk) {
    row2.push(<SalesPaceCard key="pace" d={wk} go={go} canSales={wk.can_sales && can("Sales")} refresh={refreshWeek} />);
    if (wk.opportunities && can("Sales")) row2.push(<PipelineCard key="pipe" d={wk} openAll={() => (openAt ? openAt("Sales", "open_quotations") : go("Sales"))} openDoc={(id) => { openRecord("Sales", "document", id); go("Sales"); }} />);
    if (wk.outlook && can("Finance")) row2.push(<FinanceHealthCard key="fin" d={wk} unpaid={typeof sum?.outstanding_invoices === "number" ? sum.outstanding_invoices : null} openFinance={() => go("Finance")} />);
    if (wk.advisory && can("Sales") && (wk.advisory.cards.length > 0 || wk.can_view_all)) {
      row3.push(<AdviceSummaryCard key="adv" d={wk} refresh={refreshWeek} openAll={toSalesWeek} onNavigate={(x) => (x === "tasks" ? go("Tasks") : go("Sales"))} />);
    }
    if (wk.me) row3.push(<TodayFocusCard key="focus" d={wk} openFollowups={() => go(can("Sales") ? "Sales" : "Desk")} openTask={(id) => { openRecord("Tasks", "task", id); go("Tasks"); }} openDay={onOpenDay} />);
  }
  row3.push(<Fragment key="up">{upcomingCard}</Fragment>);
  /* a row of one card joins the next, so no row is a lone third */
  const rowsAB = row2.length < 2 ? [[...row2, ...row3]] : [row2, row3];
  const teamCard = wk && (wk.all || wk.team) ? <TeamPerformanceCard d={wk} openTeam={toSalesWeek} /> : null;
  const shownTiles = wkTiles.length ? wkTiles : tiles.slice(0, 5);

  /* ================================================================
     v1.280.0 - THE PHOTO'S DASHBOARD (Minimal Executive Workspace E2,
     claude/MINIMAL-EXECUTIVE-WORKSPACE-BLUEPRINT.md section 5.1-5.3).
     Row 1 the figures; then the work: Sales Performance and My Tasks,
     Follow-ups, Approvals and the day's schedule; Quick Actions; and every
     card the Dashboard had before, one click deeper under More - nothing
     is lost. Each card is drawn only where this person may see its data.
     ================================================================ */
  /* v1.291.0 - management reads the 4.0 Command Center above (an early
     return), so this layout is the rest of the company's: the photo's
     tiles of v1.280.0 for management are retired with it. */
  const rowTiles = shownTiles;
  /* the target tile leads on a phone (the photo), so the row hides its copy there */
  const hero = wk?.me ? wkTiles[0] : undefined;

  /* My Tasks: my own open work, the most urgent first; the tick opens the update sheet */
  const openTask = (id: number) => { openRecord("Tasks", "task", id); go("Tasks"); };
  const mine = tf.openTasks.filter((t) => t.stage !== "cancelled" && (t.assigned_to === undefined || t.assigned_to === user.id))
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const myTasks = mine.slice(0, 3).map((t) => ({ id: t.id, title: t.title, deadline: t.deadline, sub: t.link_label ?? (t.priority ? L(`Priority: ${priorityL(t.priority)}`, `Keutamaan: ${priorityL(t.priority)}`) : undefined) }));

  /* Follow-ups: a salesperson's own next follow-ups (the week engine's
     list); management's open quotations are the 4.0 Sales Recovery strip */
  let follow: FollowLite[] | null = null;
  if (wk?.me?.next_followups && can("Sales")) {
    follow = wk.me.next_followups.map((f) => ({
      key: `f-${f.id}`, title: f.company ?? L("Follow-up", "Susulan"), sub: f.note, due: f.due_on,
      open: () => (openAt ? openAt("Sales", "followups") : go("Sales")),
    }));
  }

  /* Approvals: what waits for this person's decision (the Desk's own list) */
  const approvals = decide.map((d) => ({ id: d.id, title: d.title, sub: d.sub, bucket: d.bucket, overdue: d.overdue, tab: d.tab }));
  const showApprovals = manage || approvals.length > 0;

  /* the day's schedule: company events, live sessions, my follow-ups due -
     on the day the header's date pill chose (today by default) */
  const day = dashDate ?? today;
  const sched: ScheduleLite[] = [
    ...(events ?? []).filter((e) => e.event_date === day).map((e) => ({ key: `e-${e.id}`, time: e.start_time ?? null, title: e.title, sub: e.location ?? undefined })),
    ...(sessions ?? []).filter((s) => s.session_date === day && s.status !== "cancelled").map((s) => ({ key: `s-${s.id}`, time: s.start_time, title: s.client_company ?? s.client_name ?? L("Live session", "Sesi live"), sub: [s.platform, s.host_name].filter(Boolean).join(" · ") })),
    ...(wk?.me?.next_followups ?? []).filter((f) => f.due_on === day).map((f) => ({ key: `f-${f.id}`, time: null, title: L(`Follow up ${f.company ?? ""}`.trim(), `Susuli ${f.company ?? ""}`.trim()), sub: f.note })),
  ].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  const schedLoaded = events !== null && sessions !== null;

  /* Quick Actions: each opens a workflow that exists, only where this person
     may go. v1.291.0 (4.0) - four, chosen for the role (the blueprint,
     section 9); "Report Payment" is the payment engine's own word (D5) */
  const QA: Record<string, QuickAction & { show: boolean }> = {
    quote: { key: "q-quote", icon: "add", label: L("Create Quotation", "Cipta Sebut Harga"), on: () => (onCreateQuotation ? onCreateQuotation() : go("Sales")), show: can("Sales") },
    invoice: { key: "q-invoice", icon: "document", label: L("Create Invoice", "Cipta Invois"), on: () => (openAt ? openAt("Sales", "create_invoice") : go("Sales")), show: can("Sales") },
    payment: { key: "q-payment", icon: "pay", label: L("Report Payment", "Lapor Bayaran"), on: () => (openAt ? openAt("Sales", "payments") : go("Sales")), show: can("Sales") },
    desk: { key: "q-desk", icon: "pending", label: L("Open Desk", "Buka Meja"), on: () => go("Desk"), show: can("Desk") },
    task: { key: "q-task", icon: "orders", label: L("New Task", "Tugasan Baharu"), on: () => (openAt ? openAt("Tasks", "create") : go("Tasks")), show: can("Tasks") },
    leave: { key: "q-leave", icon: "holiday", label: L("Apply Leave", "Mohon Cuti"), on: () => (openAt ? openAt("Leave", "apply") : go("Leave")), show: can("Leave") },
    claim: { key: "q-claim", icon: "receipt", label: L("Submit Claim", "Hantar Tuntutan"), on: () => (openAt ? openAt("Claims", "submit") : go("Claims")), show: can("Claims") },
    client: { key: "q-client", icon: "clients", label: L("Add Client", "Tambah Pelanggan"), on: () => (openAt ? openAt("Sales", "add_customer") : go("Sales")), show: can("Sales") },
    follow: { key: "q-follow", icon: "calendarAdd", label: L("Follow-ups", "Susulan"), on: () => (openAt ? openAt("Sales", "followups") : go("Sales")), show: can("Sales") },
    clock: { key: "q-clock", icon: "time", label: myShift.open ? L("Check out", "Daftar keluar") : L("Check in", "Daftar masuk"), on: onOpenShift ?? onOpenDay, show: true },
  };
  /* which four: a layout choice, not a permission - every action above is still gated by what this person may open */
  const opsExec = user.role === "coo" || user.role === "cco";
  const pick = (keys: string[]) => keys.map((k) => QA[k]!).filter((a) => a.show);
  const quick: QuickAction[] = exec
    ? (view === "day" ? pick(["quote", "task", "follow", "desk"]) : opsExec ? pick(["desk", "quote", "task", "leave"]) : pick(["quote", "invoice", "payment", "desk"]))
    : can("Sales") ? pick(["quote", "follow", "client", "payment"]) : pick(["clock", "leave", "claim", "task"]);

  /* Next best action (a salesperson's My Day): the most urgent of their own
     follow-ups and tasks - overdue first, then due today */
  const nba: NextAction[] = [];
  if (!exec && wk?.me) {
    const fu = (wk.me.next_followups ?? []).filter((f) => f.due_on <= today && can("Sales")).map((f) => ({ due: f.due_on, a: {
      key: `f-${f.id}`, icon: "chat" as const, title: L(`Follow up ${f.company ?? ""}`.trim(), `Susuli ${f.company ?? ""}`.trim()),
      sub: [f.note, f.due_on < today ? L("overdue", "lewat") : L("due today", "perlu hari ini")].filter(Boolean).join(" · "),
      actLabel: L("Open follow-up", "Buka susulan"), onAct: () => (openAt ? openAt("Sales", "followups") : go("Sales")) } }));
    const tk = mine.filter((t) => t.deadline && t.deadline <= today).map((t) => ({ due: t.deadline!, a: {
      key: `t-${t.id}`, icon: "orders" as const, title: t.title, sub: t.deadline! < today ? L("Task · overdue", "Tugasan · lewat") : L("Task · due today", "Tugasan · perlu hari ini"),
      actLabel: L("Add an update", "Tambah kemas kini"), onAct: () => openTask(t.id) } }));
    nba.push(...[...fu, ...tk].sort((p, q) => p.due.localeCompare(q.due)).map((v) => v.a));
  }

  const o = (n: number) => ({ "--o": n }) as CSSProperties;
  const kpiRow = (
    /* v1.280.0 - the photo's tile for everyone (52px well, 22px figure);
       the v1.263.0 compact strip is retired with the six-across row */
    <div className={ov.kpis}>
      <KpiRow label={L("At a glance", "Sepintas lalu")}>
        {rowTiles.map((t) => <Fragment key={t.key}>{t.node}</Fragment>)}
      </KpiRow>
    </div>
  );
  const tasksCard = <MyTasksCard tasks={myTasks} total={mine.length} loaded={tasksLoaded} today={today} onOpen={openTask} onViewAll={() => go("Tasks")} />;
  const followCard = follow ? <FollowUpsCard rows={follow.slice(0, 2)} total={follow.length} loaded={!!wk} today={today} onViewAll={() => (openAt ? openAt("Sales", "followups") : go("Sales"))} /> : null;
  const approvalsCard = showApprovals ? <ApprovalsCard items={approvals} loaded={desk.data !== null} go={(t) => go(t as TabName)} /> : null;
  const schedCard = <ScheduleCard date={day} today={today} items={sched} loaded={schedLoaded} onViewAll={onOpenDay} onToday={() => setDashDate(null)} />;

  /* ================================================================
     v1.291.0 - EXECUTIVE COMMAND CENTER 4.0 (the CEO's "approve",
     12-11-2026; claude/EXECUTIVE-COMMAND-CENTER-4.0-BLUEPRINT.md). For
     management - the people the week engine gives the company outlook -
     Overview is the company in one screen and My Day is only theirs. Every
     figure below is a read this file already made; the cards that left the
     Dashboard live in their modules (Sales -> Weekly target, Finance,
     Attendance, Users -> Security & Sessions, the Desk). Nothing is worked
     out here that the server did not say.
     ================================================================ */
  if (exec && wk?.outlook) {
    const c = wk.company, ol = wk.outlook;
    const owedLabel = verifying ? L("Verified outstanding", "Tertunggak disahkan") : L("Outstanding", "Tertunggak");
    const owedSub = (n: number) => (verifying
      ? L(`${n} unpaid invoice(s) · less verified payments`, `${n} invois belum dibayar · tolak bayaran disahkan`)
      : L(`${n} unpaid invoice(s) · less recorded payments`, `${n} invois belum dibayar · tolak bayaran direkodkan`));
    const deskFailed = desk.data === null && desk.failed;
    const oldest = decide.reduce<number | null>((m, d) => { const w = daysWaiting(d.since, nowMs); return w === null ? m : m === null ? w : Math.max(m, w); }, null);

    if (view === "day") {
      /* ---------------- MY DAY: mine only ---------------- */
      const me = wk.me;
      const fuDue = (me?.next_followups ?? []).filter((f) => f.due_on <= today && can("Sales"));
      const tasksDue = mine.filter((t) => t.deadline && t.deadline <= today);
      const appts = sched.filter((s0) => !s0.key.startsWith("f-")).length;
      const rows: DayAction[] = [
        ...fuDue.map((f): DayAction & { due: string } => ({ due: f.due_on, key: `f-${f.id}`, icon: "chat", title: L(`Follow up ${f.company ?? ""}`.trim(), `Susuli ${f.company ?? ""}`.trim()), sub: f.note,
          chip: f.due_on < today ? { text: L("Overdue", "Lewat"), tone: "bad" } : { text: L("Due today", "Perlu hari ini"), tone: "warn" },
          act: L("Open follow-up", "Buka susulan"), on: () => (openAt ? openAt("Sales", "followups") : go("Sales")) })),
        ...tasksDue.map((t): DayAction & { due: string } => ({ due: t.deadline!, key: `t-${t.id}`, icon: "orders", title: t.title, sub: t.deadline! < today ? L("Task · overdue", "Tugasan · lewat") : L("Task · due today", "Tugasan · perlu hari ini"),
          chip: t.deadline! < today ? { text: L("Overdue", "Lewat"), tone: "bad" } : { text: L("Due today", "Perlu hari ini"), tone: "warn" },
          act: L("Add an update", "Tambah kemas kini"), on: () => openTask(t.id) })),
      ].sort((a, b) => (a as { due: string }).due.localeCompare((b as { due: string }).due));
      const myFollow: FollowLite[] = (me?.next_followups ?? []).map((f) => ({ key: `mf-${f.id}`, title: f.company ?? L("Follow-up", "Susulan"), sub: f.note, due: f.due_on,
        open: () => (openAt ? openAt("Sales", "followups") : go("Sales")) }));
      const rostered = shiftKind && ["idle", "open", "between", "done", "waiting", "review"].includes(shiftKind);
      const shiftWord = !shiftKind || shiftKind === "loading" ? "···"
        : shiftKind === "rest" ? L("No shift rostered today", "Tiada syif dijadualkan hari ini")
        : shiftKind === "open" ? L(`On shift since ${myShift.since}`, `Sedang syif sejak ${myShift.since}`)
        : shiftKind === "done" || shiftKind === "between" ? L(`Clocked out ${myShift.out}`, `Daftar keluar ${myShift.out}`)
        : shiftKind === "leave" ? L("On leave today", "Bercuti hari ini")
        : shiftKind === "holiday" ? L("Public holiday", "Cuti umum")
        : shiftKind === "error" ? L("Your shift could not be read - open On Shift", "Syif anda tidak dapat dibaca - buka Syif Saya")
        : L("A shift today - not clocked in", "Ada syif hari ini - belum daftar masuk");
      const dateWord = new Date(`${today}T00:00:00+08:00`).toLocaleDateString(lang === "ms" ? "ms-MY" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kuala_Lumpur" });
      return (
        <div className={`${ov.page} ${x.page}`} data-layout="executive" data-view="day">
          <div className={x.span3}>
            <TodayStrip date={dateWord} shift={shiftWord} decisions={desk.data ? decide.length : null} onDecisions={onOpenOverview ?? (() => go("Desk"))}
              counts={[
                { label: L("appointments", "temujanji"), n: schedLoaded ? appts : null },
                { label: L("follow-ups due", "susulan perlu"), n: fuDue.length },
                { label: L("tasks due today", "tugasan perlu hari ini"), n: tasksLoaded ? tasksDue.length : null },
              ]} />
          </div>
          <div className={x.span2}><NextActionsCard rows={rows} loaded={tasksLoaded} /></div>
          <div className={`${x.sideCol} ${ov.column}`}>
            {rostered && todayShift}
            <ScheduleCard date={day} today={today} items={sched} loaded={schedLoaded} onToday={() => setDashDate(null)} />
          </div>
          <div>{tasksCard}</div>
          <div><FollowUpsCard rows={myFollow.slice(0, 3)} total={myFollow.length} loaded today={today} onViewAll={can("Sales") ? () => (openAt ? openAt("Sales", "followups") : go("Sales")) : undefined} /></div>
          <div><ContributionCard loaded me={me ? { basis_cents: me.basis_cents, open_quotations: me.open_quotations, introduced: me.introductions?.verified_week ?? null } : null} onOpen={can("Sales") ? () => go("Sales") : undefined} /></div>
          <div className={x.span3}><QuickActionsStrip actions={quick} max={4} /></div>
          <div className={x.span3}>
            <ReportingLineStrip canOpenOrg={Boolean(canOpen?.("Staff Details"))} openOrg={() => (openAt ? openAt("Staff Details", "org") : go("Staff Details"))} />
          </div>
        </div>
      );
    }

    /* ---------------- OVERVIEW: the company ---------------- */
    const alerts: AlertLine[] = [];
    if (health && health !== "denied") {
      const toHealth = () => (openAt ? openAt("Users", "security") : go("Users"));
      const action = L("Open System health", "Buka Kesihatan sistem");
      if (!health.last_backup) alerts.push({ key: "backup", text: L("No backup is recorded yet.", "Belum ada sandaran direkodkan."), action, on: toHealth });
      else if ((backupAge ?? 0) > 7) alerts.push({ key: "backup", text: L(`The last backup is ${backupAge} days old.`, `Sandaran terakhir berusia ${backupAge} hari.`), action, on: toHealth });
      if (errors24 > 0) alerts.push({ key: "errors", text: L(`${errors24} error(s) logged in the last 24 hours.`, `${errors24} ralat direkodkan dalam 24 jam lalu.`), action, on: toHealth });
      const mp = (health.migrations_pending ?? []).length;
      if (mp > 0) alerts.push({ key: "migrations", text: L(`${mp} database migration(s) not applied.`, `${mp} migrasi pangkalan data belum digunakan.`), action, on: toHealth });
    }
    const owedTile = (
      <KpiTile icon="pending" tone="blue" label={owedLabel} busy={!pw && !perfWeek.failed}
        value={pw ? fmtRM(pw.outstanding.cents) : perfWeek.failed ? L("Not available", "Tiada data") : "—"}
        sub={pw ? owedSub(pw.outstanding.invoices) : perfWeek.failed ? L("Could not be read", "Tidak dapat dibaca") : undefined}
        link={!pw && perfWeek.failed ? { label: L("Retry", "Cuba lagi"), onClick: perfWeek.refresh } : undefined}
        onClick={pw ? () => (openAt ? openAt("Sales", "payments") : go("Sales")) : undefined} />
    );
    const recovery = (wk.opportunities ?? []).slice(0, 3).map((q) => ({ id: q.id, doc: q.doc_number, company: q.company, cents: q.total_cents,
      why: `${oppStatus(q, wk.week.today)[0]} · ${L(`${q.age_days} days open`, `${q.age_days} hari terbuka`)}` }));
    const decisionItems = decide.map((d) => ({ id: d.id, title: d.title, sub: d.sub, bucket: d.bucket, overdue: d.overdue, tab: d.tab, since: d.since, source: deskBucketWord(d.bucket),
      open: () => { go(d.tab as TabName); revealAnchor(deskAnchor(d.bucket)); } }));
    const fuMine = wk.me ? (wk.me.followups_today ?? 0) + wk.me.followups_overdue : 0;
    return (
      <div className={`${ov.page} ${x.page}`} data-layout="executive" data-view="overview">
        {alerts.length > 0 && <div className={x.span3} style={o(0)}><AlertBand alerts={alerts} /></div>}
        <div className={`${x.span3} erp-desktop-only`} data-row="figures">
          <div className={`${ov.kpis} ${x.kpis4}`}>
            <KpiRow label={L("The week at a glance", "Minggu ini sepintas lalu")}>
              <KpiTile icon="target" tone="gold" label={L("Weekly target", "Sasaran mingguan")} value={c.target_cents === null ? L("Not set", "Belum ditetapkan") : fmtRM(c.target_cents)}
                sub={c.pct === null ? `${dmy(wk.week.from)} – ${dmy(wk.week.to)}` : L(`${c.pct}% achieved · ${dmy(wk.week.from)} – ${dmy(wk.week.to)}`, `${c.pct}% dicapai · ${dmy(wk.week.from)} – ${dmy(wk.week.to)}`)}
                bar={c.pct === null ? undefined : { pct: c.pct, tone: "gold" }} onClick={() => go("Sales")} />
              <KpiTile icon="money" tone="green" label={L("Company sales", "Jualan syarikat")} value={fmtRM(c.basis_cents)}
                delta={pw && pw.change_pct !== null ? { pct: pw.change_pct, text: `${pw.change_pct >= 0 ? "+" : "−"}${Math.abs(pw.change_pct)}%`, vs: vsWord("week") } : undefined}
                sub={c.basis_kind === "all_channels" ? L("This week · all channels · not cash received", "Minggu ini · semua saluran · bukan tunai diterima") : L("This week · invoices paid in full", "Minggu ini · invois dibayar penuh")}
                onClick={() => go("Sales")} />
              {owedTile}
              <KpiTile icon="verify" tone="red" label={L("Pending decisions", "Keputusan menunggu")} busy={desk.data === null && !deskFailed}
                value={desk.data ? decide.length : deskFailed ? L("Not available", "Tiada data") : "—"}
                sub={desk.data ? (decide.length === 0 ? L("Nothing waits for you", "Tiada yang menunggu anda") : oldest !== null ? L(`management attention · oldest ${oldest} day(s)`, `perhatian pengurusan · paling lama ${oldest} hari`) : L("management attention", "perhatian pengurusan")) : deskFailed ? L("The Desk could not be read", "Meja tidak dapat dibaca") : undefined}
                link={deskFailed ? { label: L("Retry", "Cuba lagi"), onClick: desk.refresh } : undefined}
                onClick={desk.data ? () => go("Desk") : undefined} />
            </KpiRow>
          </div>
        </div>
        <div className={x.span2} style={o(1)}>
          <SalesSummaryCard onOpen={() => go("Sales")}
            w={{ target_cents: c.target_cents, basis_cents: c.basis_cents, basis_kind: c.basis_kind, pct: c.pct, gap_cents: c.gap_cents, days_left: ol.days_left, required_per_day_cents: ol.required_per_day_cents, risk: ol.risk?.level ?? null }}
            owed={pw ? <span><strong>{owedLabel}</strong> {fmtRM(pw.outstanding.cents)} · {owedSub(pw.outstanding.invoices)}</span> : undefined} />
        </div>
        <div className={x.sideCol} style={o(2)}>
          <DecisionQueueCard items={decisionItems} total={decide.length} loaded={desk.data !== null} failed={deskFailed} nowMs={nowMs} onViewAll={() => go("Desk")} onRetry={desk.refresh} />
        </div>
        <div className={`${x.span3} erp-phone-only`} style={o(3)}>
          <MyWorkStrip followups={fuMine} tasks={mine.length} schedule={sched.length} loaded={tasksLoaded && schedLoaded} onOpen={onOpenDay} />
        </div>
        {can("Sales") && (
          <div className={x.span3} style={o(4)}>
            <SalesRecoveryStrip open={ol.open_quotations} cold={ol.ageing_quotations} items={recovery}
              onPipeline={() => (openAt ? openAt("Sales", "open_quotations") : go("Sales"))} onOpenDoc={(id) => { openRecord("Sales", "document", id); go("Sales"); }} />
          </div>
        )}
        <div className={x.span3} style={o(5)}><QuickActionsStrip actions={quick} max={4} /></div>
      </div>
    );
  }

  return (
    <div className={`${ov.page} ${x.page}`} data-layout={wk?.me ? "my-day" : "basic"}>
      {/* the phone leads with the target (the photo); the row keeps it on a wide screen */}
      {hero && <div className={x.phoneOnly} style={o(0)} data-testid="hero-target">{hero.node}</div>}
      {/* ROW 1 - the figures */}
      <div className={`${x.span3} ${hero ? x.withHero : ""}`} style={o(wk?.me ? 4 : 0)} data-row="figures">{kpiRow}</div>
          {nba.length > 0 && <div style={o(1)}><NextBestActionCard candidates={nba} today={today} /></div>}
          <div style={o(2)}>{tasksCard}</div>
          {followCard && <div style={o(3)}>{followCard}</div>}
          {approvalsCard && <div style={o(5)}>{approvalsCard}</div>}
          <div style={o(6)}>{schedCard}</div>
      <div className={x.span3} style={o(7)}><QuickActionsStrip actions={quick} max={4} /></div>
      {/* v1.233.0 / v1.239.0 - the reporting line, one line (none for the
          CEO); the full card is on Staff -> Organisation */}
      <div className={x.span3} style={o(8)}>
        <ReportingLineStrip canOpenOrg={Boolean(canOpen?.("Staff Details"))} openOrg={() => (openAt ? openAt("Staff Details", "org") : go("Staff Details"))} />
      </div>
      {/* MORE - every card the Dashboard had before, one click deeper: the
          sales pace, pipeline, finance health, advice, team, tasks overview,
          month figures, activities, shifts, leave, summary and system status */}
      <div className={`${x.span3} ${x.more}`} style={o(9)}>
        <button type="button" className={x.moreBtn} aria-expanded={moreOpen} aria-controls="dash-more" onClick={() => setMoreOpen((v) => !v)}>
          {moreOpen ? L("Show less", "Kurangkan") : L("More: sales pace, pipeline, finance, advice, team, activities and more", "Lagi: rentak jualan, saluran, kewangan, nasihat, pasukan, aktiviti dan lain-lain")}
          <AppIcon name={moreOpen ? "up" : "down"} />
        </button>
        <div id="dash-more" className={`${x.rest} ${moreOpen ? x.restOpen : ""}`} data-row="more">
          {!wk && weekView.loading && <div className={ov.grid}><section className={`${card} ${ov.card}`} aria-label={L("Weekly sales target", "Sasaran jualan mingguan")}><SkelRows rows={3} /></section></div>}
          {rowsAB.map((r, i) => <div key={i} className={`${ov.grid} ${ov.gridTop}`} data-row={i === 0 ? "command" : "actions"}>{r}</div>)}
          <div className={`${ov.grid} ${ov.gridTop}`} data-row="overview">
            {taskCard}
            {teamCard}
            {salesCard}
          </div>
          <div className={`${ov.grid} ${ov.gridTop}`}>
            {activityCard}
            <div className={ov.column}>
              {livesCard}
              {shiftCard}
            </div>
            {/* v1.213.0 - the month's leave applications (one place, on the Overview) */}
            <LeaveMonthCard go={go} />
          </div>
          <div className={ov.grid}>
            {summaryCard}
            {statusCard}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The welcome header: the person's name, the Malaysia date, and where their own shift stands. */
/** v1.240.0 - what the header chip says about today, from On Shift's own
    reading (on-shift.tsx todayShiftKind - the worker's schedule, leave,
    holidays and punches); nothing is worked out here. "Not clocked in" only
    when a shift is due now or has passed - an off day says so, and a shift
    later today says when. */
export type HeaderShift = { kind: TodayShiftKind; next: string | null };

export function WelcomeHeader({ user, lang: _lang, myShift, shift, onOpenDay }: { user: User; lang: Lang; myShift: MyShift; shift?: HeaderShift; onOpenDay: () => void }) {
  const first = (user.name ?? "").trim().split(/\s+/)[0] ?? "";
  const k = shift?.kind;
  const word = myShift.open ? L(`On shift since ${myShift.since}`, `Sedang syif sejak ${myShift.since}`)
    : k === "between" ? L(`Clocked out ${myShift.out} · another shift today`, `Daftar keluar ${myShift.out} · ada syif lagi hari ini`)
    : myShift.hasOut ? L(`Clocked out ${myShift.out}`, `Daftar keluar ${myShift.out}`)
    : k === "rest" ? L("Off day", "Hari rehat")
    : k === "leave" ? L("On leave today", "Bercuti hari ini")
    : k === "holiday" ? L("Public holiday", "Cuti umum")
    : k === "review" ? L("Leave under review today", "Cuti dalam semakan hari ini")
    : k === "waiting" ? L("Clock-in waiting to send", "Daftar masuk menunggu dihantar")
    : shift?.next ? L(`Shift at ${shift.next}`, `Syif pada ${shift.next}`)
    : L("Not clocked in", "Belum daftar masuk");
  const calm = myShift.open || myShift.hasOut || ["rest", "leave", "holiday"].includes(k ?? "") || Boolean(shift?.next);
  return (
    <header className={ov.welcome}>
      <div className={ov.welcomeText}>
        <h2 className={ov.welcomeTitle}>{L(`Welcome back, ${first}`, `Selamat kembali, ${first}`)}</h2>
        {/* v1.280.0 - the photo's line; the phone keeps to the name */}
        <p className={`${ov.welcomeSub} erp-desktop-only`}>{L("Here's what's happening at A2Z Creative today.", "Inilah yang berlaku di A2Z Creative hari ini.")}</p>
      </div>
      <div className={ov.welcomeSide}>
        {/* v1.280.0 - the date is said once: the header's date pill on a
            wide screen, the line under the title on a phone (portal-shell.tsx) */}
        {myShift.known && (
          <button type="button" className={`${ov.shiftChip} ${myShift.open ? ov.shiftOn : ""} ${!calm ? ov.shiftDue : ""}`} onClick={onOpenDay}
            title={L("Open On Shift to check in or out", "Buka Syif Saya untuk daftar masuk atau keluar")}>
            <span className={ov.statusDot} aria-hidden />
            {word}
          </button>
        )}
      </div>
    </header>
  );
}

/** v1.291.0 (4.0) - management's header. v1.292.0 (the CEO, 12-11-2026:
    "on the Dashboard remove words Executive Command Center 4.0 / Company
    performance, key decisions and next actions at a glance") - no title and
    no line: the page is already named Dashboard in the top bar. What is
    left is the phone's view switch (decision D2), where a wide screen keeps
    the two tabs; a wide screen draws nothing here. */
export function ExecHeader({ user, view, onView }: { user: User; view: "overview" | "day"; onView: (v: "overview" | "day") => void }) {
  const roleWord = ({ ceo: "CEO", coo: "COO", cco: "CCO" } as Record<string, string>)[user.role] ?? L("Management", "Pengurusan");
  return (
    <div className={`${x.execHead} erp-phone-only`} data-testid="exec-header">
      <ViewSwitch value={view} onChange={onView} options={[
        ["overview", L(`${roleWord} View`, `Paparan ${roleWord}`), L("The company: figures, decisions, recovery", "Syarikat: angka, keputusan, pemulihan")],
        ["day", L("My Day", "Hari Saya"), L("Only yours: tasks, follow-ups, schedule", "Milik anda: tugasan, susulan, jadual")],
      ] as const} />
    </div>
  );
}

export type { MyShift, MonitorRow, Session };
