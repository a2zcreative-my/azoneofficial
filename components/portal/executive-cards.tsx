"use client";

/* v1.280.0 - MINIMAL EXECUTIVE WORKSPACE, phase E2: the Dashboard's cards in
   the photo's language (claude/MINIMAL-EXECUTIVE-WORKSPACE-BLUEPRINT.md, the
   CEO's "Approve for all", 11-11-2026).

   A PRESENTATION LAYER, as the overview it sits in: every card is handed what
   a module already answers (the week engine, the Desk, the task board, the
   events and the roster) or reads the one new read-only route the CEO
   approved (decision 2: GET /staff/sales/week/performance, the company figure
   by day). Nothing here writes, decides or closes: a task's tick opens its
   update sheet, an approval opens the Desk record, a follow-up opens its
   record. Snooze (decision 6) hides the next best action on THIS device until
   tomorrow and tells the server nothing. */

import { useState, type ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Segmented } from "@/components/ui/segmented";
import { SkelRows } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { card } from "@/lib/ui-styles";
import css from "./executive.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
/** "12 Nov" */
export const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${(getLang() === "ms" ? MON_MS : MON)[Number(d.slice(5, 7)) - 1] ?? ""}`;

/* ------------------------------------------------------------------ */
/* the due chip: words first, colour second (WCAG 1.4.1)              */
/* ------------------------------------------------------------------ */
export type Tone = "bad" | "warn" | "info" | "ok" | "neutral" | "gold";
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${css.chip} ${css[`c_${tone}`]}`}>{children}</span>;
}
export function dueChip(deadline: string | null | undefined, today: string): ReactNode {
  if (!deadline) return null;
  if (deadline < today) return <Chip tone="bad">{L("Overdue", "Lewat")}</Chip>;
  if (deadline === today) return <Chip tone="bad">{L("Today", "Hari ini")}</Chip>;
  if (deadline === addDay(today, 1)) return <Chip tone="warn">{L("Tomorrow", "Esok")}</Chip>;
  return <Chip tone="info">{shortDate(deadline)}</Chip>;
}

/* ------------------------------------------------------------------ */
/* the card and its head: icon, title, gold count, View all →          */
/* ------------------------------------------------------------------ */
export function ExecCard({ icon, title, phoneTitle, count, onViewAll, viewAllLabel, children, label, className = "", testId, right }: {
  icon: AppIconName;
  title: string;
  /** the phone's words for the same card ("Needs your decision") */
  phoneTitle?: string;
  /** drawn as "(3)" in gold; undefined = no count */
  count?: number;
  onViewAll?: () => void;
  viewAllLabel?: string;
  children: ReactNode;
  label?: string;
  className?: string;
  testId?: string;
  right?: ReactNode;
}) {
  return (
    <section className={`${card} ${css.card} ${className}`} aria-label={label ?? title} data-testid={testId}>
      <div className={css.head}>
        <h3 className={css.title}>
          <span className={css.titleIcon} aria-hidden><AppIcon name={icon} /></span>
          {phoneTitle ? <><span className="erp-desktop-only">{title}</span><span className="erp-phone-only">{phoneTitle}</span></> : title}
          {count !== undefined && <span className={css.count}>({count})</span>}
        </h3>
        {right}
        {onViewAll && (
          <button type="button" className={css.viewAll} onClick={onViewAll} aria-label={viewAllLabel ?? L(`View all: ${title}`, `Lihat semua: ${title}`)}>
            {L("View all", "Lihat semua")} <span aria-hidden>→</span>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function ExecRow({ lead, title, sub, chip, onOpen, openLabel }: {
  lead: ReactNode;
  title: string;
  sub?: string;
  chip?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const body = (
    <>
      <span className={css.rowText}><strong>{title}</strong>{sub && <span>{sub}</span>}</span>
      {chip && <span className={css.rowChip}>{chip}</span>}
    </>
  );
  return (
    <li className={css.row}>
      {lead}
      {onOpen ? <button type="button" className={css.rowMain} onClick={onOpen} aria-label={openLabel}>{body}</button> : <span className={css.rowMain}>{body}</span>}
    </li>
  );
}

export const Well = ({ icon, tone = "neutral" }: { icon: AppIconName; tone?: Tone }) => (
  <span className={`${css.well} ${css[`w_${tone}`]}`} aria-hidden><AppIcon name={icon} /></span>
);

/* ------------------------------------------------------------------ */
/* Sales Performance - the company figure by day / week / month       */
/* ------------------------------------------------------------------ */
export interface Performance {
  period: "week" | "month" | "ytd";
  from: string; to: string; today: string;
  basis_kind: "invoices" | "all_channels";
  buckets: { label: string; from: string; to: string; cents: number | null }[];
  total_cents: number;
  previous: { from: string; to: string; cents: number };
  change_pct: number | null;
  target_cents: number | null;
  outstanding: { cents: number; invoices: number };
}
export const PERFORMANCE_PATH = "/staff/sales/week/performance";
export function usePerformance(period: Performance["period"], enabled: boolean) {
  return useCachedApi<Performance>(enabled ? `${PERFORMANCE_PATH}?period=${period}` : null, enabled, ["docs", "sales"]);
}
export const basisWord = (k: Performance["basis_kind"] | undefined) => (k === "all_channels" ? L("Company sales", "Jualan syarikat") : L("Collected", "Dikutip"));
const VS: Record<Performance["period"], [string, string]> = {
  week: ["vs last week to date", "berbanding minggu lalu setakat ini"],
  month: ["vs last month to date", "berbanding bulan lalu setakat ini"],
  ytd: ["vs last year to date", "berbanding tahun lalu setakat ini"],
};
export const vsWord = (p: Performance["period"]) => L(VS[p][0], VS[p][1]);

/** a round axis top: 1, 2, 2.5, 5 or 10 times a power of ten */
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const axisRM = (cents: number) => Math.round(cents / 100).toLocaleString("en-MY");

export function SalesPerformanceCard({ onOpen, pace }: {
  onOpen: () => void;
  /** the week engine's required pace (the gap over the working days left) */
  pace?: { cents: number | null; allChannels: boolean };
}) {
  const [period, setPeriod] = useState<Performance["period"]>("week");
  const v = usePerformance(period, true);
  const d = v.data && v.data.period === period ? v.data : null;
  const week = period === "week";
  /* the week is drawn as the running total against the target (the photo);
     a month and a year as each bucket's own figure */
  const values = d ? (week
    ? d.buckets.map((b, i) => (b.cents === null ? null : d.buckets.slice(0, i + 1).reduce((a, x) => a + (x.cents ?? 0), 0)))
    : d.buckets.map((b) => b.cents)) : [];
  const target = week ? d?.target_cents ?? null : null;
  const top = niceMax(Math.max(target ?? 0, ...values.map((x) => x ?? 0)));
  const W = 560, H = 230, PL = 48, PB = 26, PT = 22;
  const plotH = H - PB - PT, slot = (W - PL) / Math.max(1, values.length), bw = Math.min(34, slot * 0.56);
  const y = (c: number) => PT + plotH - (c / top) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  return (
    <ExecCard icon="chart" title={L("Sales Performance", "Prestasi Jualan")} className={css.perf} testId="sales-performance"
      right={<Segmented label={L("Period", "Tempoh")} value={period} onChange={setPeriod} options={[["week", L("This Week", "Minggu Ini")], ["month", L("This Month", "Bulan Ini")], ["ytd", L("YTD", "Tahun Ini")]] as const} />}>
      {v.failed && !d ? <ErrorState title={L("The sales figures could not be loaded", "Angka jualan tidak dapat dimuatkan")} onRetry={v.refresh} />
        : !d ? <SkelRows rows={5} /> : (
          <div className={css.perfBody}>
            <div className={css.perfSide}>
              <p className={css.perfBig}>{fmtRM(d.total_cents)}</p>
              {d.change_pct !== null ? (
                <p className={css.perfChange}>
                  <Chip tone={d.change_pct >= 0 ? "ok" : "bad"}>{d.change_pct >= 0 ? "▲" : "▼"} {d.change_pct >= 0 ? "+" : "−"}{Math.abs(d.change_pct)}%</Chip>
                  <span>{vsWord(period)}</span>
                </p>
              ) : <p className={css.perfChangeNone}>{L("Nothing at this point last period to compare", "Tiada angka pada tempoh lalu untuk dibandingkan")}</p>}
              <dl className={css.legend}>
                <div><dt><i className={css.dotGold} aria-hidden />{basisWord(d.basis_kind)}</dt><dd>{fmtRM(d.total_cents)}</dd></div>
                <div><dt><i className={css.dotGrey} aria-hidden />{L("Outstanding", "Tertunggak")}</dt><dd>{fmtRM(d.outstanding.cents)}</dd></div>
                {week && <div><dt><i className={css.dotLine} aria-hidden />{L("Target", "Sasaran")}</dt><dd>{target === null ? L("Not set", "Belum ditetapkan") : fmtRM(target)}</dd></div>}
              </dl>
              {week && pace && pace.cents !== null && (
                <p className={css.perfPace}>{pace.allChannels
                  ? L(`Required pace: ${fmtRM(pace.cents)} sales per working day`, `Rentak diperlukan: ${fmtRM(pace.cents)} jualan setiap hari bekerja`)
                  : L(`Required pace: ${fmtRM(pace.cents)} collected per working day`, `Rentak diperlukan: ${fmtRM(pace.cents)} dikutip setiap hari bekerja`)}</p>
              )}
              <button type="button" className={css.linkBtn} onClick={onOpen}>{L("Open Sales", "Buka Jualan")} <span aria-hidden>→</span></button>
            </div>
            <div className={css.chartWrap}>
              <svg className={css.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="perf-chart-title" preserveAspectRatio="xMidYMid meet">
                <title id="perf-chart-title">{week ? L("This week, running total by day, against the target", "Minggu ini, jumlah terkumpul mengikut hari, berbanding sasaran") : L("By period", "Mengikut tempoh")}</title>
                <text x={PL - 8} y={10} className={css.axis} textAnchor="end">RM</text>
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={PL} x2={W} y1={y(t)} y2={y(t)} className={css.grid} />
                    <text x={PL - 8} y={y(t) + 4} className={css.axis} textAnchor="end">{axisRM(t)}</text>
                  </g>
                ))}
                {values.map((val, i) => {
                  const cx = PL + slot * i + slot / 2;
                  return (
                    <g key={d.buckets[i]!.label + i}>
                      {target !== null && <rect x={cx - bw / 2} y={y(target)} width={bw} height={Math.max(0, y(0) - y(target))} rx={6} className={css.track} />}
                      {val !== null && val > 0 && <rect x={cx - bw / 2} y={y(val)} width={bw} height={Math.max(2, y(0) - y(val))} rx={6} className={css.bar} />}
                      <text x={cx} y={H - 8} className={css.axis} textAnchor="middle">{d.buckets[i]!.label}</text>
                    </g>
                  );
                })}
              </svg>
              {/* the same figures for a screen reader */}
              <table className="erp-sr-only">
                <caption>{L("Sales performance", "Prestasi jualan")}</caption>
                <thead><tr><th scope="col">{L("Period", "Tempoh")}</th><th scope="col">{week ? L("Running total", "Jumlah terkumpul") : basisWord(d.basis_kind)}</th></tr></thead>
                <tbody>{d.buckets.map((b, i) => <tr key={b.from}><th scope="row">{b.label}</th><td>{values[i] === null ? L("still to come", "belum tiba") : fmtRM(values[i]!)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
    </ExecCard>
  );
}

/* ------------------------------------------------------------------ */
/* My Tasks - the tick opens the update sheet; it never closes a task  */
/* ------------------------------------------------------------------ */
export interface TaskLite { id: number; title: string; deadline: string | null; sub?: string }
export function MyTasksCard({ tasks, total, loaded, today, onOpen, onViewAll }: {
  tasks: TaskLite[]; total: number; loaded: boolean; today: string;
  onOpen: (id: number) => void; onViewAll: () => void;
}) {
  return (
    <ExecCard icon="orders" title={L("My Tasks", "Tugasan Saya")} count={loaded ? total : undefined} onViewAll={onViewAll} testId="my-tasks">
      {!loaded ? <SkelRows rows={3} /> : tasks.length === 0 ? <p className={css.empty}><AppIcon name="success" />{L("Nothing open on your list.", "Tiada tugasan terbuka.")}</p> : (
        <ul className={css.rows}>
          {tasks.map((t) => (
            <ExecRow key={t.id}
              lead={<button type="button" className={css.tick} onClick={() => onOpen(t.id)} aria-label={L(`Add an update to "${t.title}"`, `Tambah kemas kini kepada "${t.title}"`)} title={L("Add an update", "Tambah kemas kini")} />}
              title={t.title} sub={t.sub} chip={dueChip(t.deadline, today)} onOpen={() => onOpen(t.id)} />
          ))}
        </ul>
      )}
    </ExecCard>
  );
}

/* ------------------------------------------------------------------ */
/* Follow-ups, Approvals, Today's Schedule                            */
/* ------------------------------------------------------------------ */
export interface FollowLite { key: string; title: string; sub: string; due: string | null; open: () => void }
export function FollowUpsCard({ rows, total, loaded, today, onViewAll }: { rows: FollowLite[]; total: number; loaded: boolean; today: string; onViewAll?: () => void }) {
  return (
    <ExecCard icon="users" title={L("Follow-ups", "Susulan")} count={loaded ? total : undefined} onViewAll={onViewAll} testId="follow-ups">
      {!loaded ? <SkelRows rows={2} /> : rows.length === 0 ? <p className={css.empty}><AppIcon name="success" />{L("No follow-up is due.", "Tiada susulan perlu dibuat.")}</p> : (
        <ul className={css.rows}>
          {rows.map((r) => (
            <ExecRow key={r.key} lead={<Well icon="store" />} title={r.title} sub={r.sub}
              chip={r.due ? (r.due < today ? <Chip tone="bad">{L("Overdue", "Lewat")}</Chip> : r.due === today ? <Chip tone="bad">{L("Due today", "Perlu hari ini")}</Chip> : <Chip tone="info">{shortDate(r.due)}</Chip>) : null}
              onOpen={r.open} />
          ))}
        </ul>
      )}
    </ExecCard>
  );
}

const BUCKET_ICON: Record<string, AppIconName> = { leave: "holiday", claims: "receipt", ot: "time", punches: "time", billing: "pay", quotes: "document", people: "users", followups: "clients", news: "chat", tasks: "orders", advisory: "balance" };
export interface ApprovalLite { id: string; title: string; sub: string; bucket: string; overdue: boolean; tab: string; since?: string | null; source?: string; open?: () => void }
export function ApprovalsCard({ items, loaded, go, title }: { items: ApprovalLite[]; loaded: boolean; go: (tab: string) => void; title?: string }) {
  return (
    <ExecCard icon="verify" title={title ?? L("Approvals", "Kelulusan")} phoneTitle={title ? undefined : L("Needs your decision", "Perlu keputusan anda")} count={loaded ? items.length : undefined} onViewAll={() => go("Desk")} viewAllLabel={L("Open the Desk", "Buka Meja")} testId="approvals">
      {!loaded ? <SkelRows rows={2} /> : items.length === 0 ? <p className={css.empty}><AppIcon name="success" />{L("Nothing waits for your decision.", "Tiada yang menunggu keputusan anda.")}</p> : (
        <ul className={css.rows}>
          {items.slice(0, 3).map((i) => (
            <ExecRow key={i.id} lead={<Well icon={BUCKET_ICON[i.bucket] ?? "pending"} tone="gold" />} title={i.title} sub={i.sub}
              chip={i.overdue ? <Chip tone="bad">{L("Overdue", "Lewat")}</Chip> : <Chip tone="warn">{L("Pending", "Menunggu")}</Chip>}
              onOpen={() => go(i.tab)} openLabel={L(`${i.title} - open to decide`, `${i.title} - buka untuk membuat keputusan`)} />
          ))}
        </ul>
      )}
    </ExecCard>
  );
}

/* ================================================================== */
/* v1.291.0 - EXECUTIVE COMMAND CENTER 4.0 (claude/EXECUTIVE-COMMAND-   */
/* CENTER-4.0-BLUEPRINT.md, the CEO's "approve", 12-11-2026). Still a   */
/* presentation layer: every figure below is handed in from a read the  */
/* Dashboard already makes; nothing here asks the server anything.      */
/* ================================================================== */

/** days between a stored instant ("YYYY-MM-DD HH:MM:SS" UTC or a date) and now; null when unknown */
export function daysWaiting(since: string | null | undefined, nowMs: number): number | null {
  if (!since) return null;
  const t = new Date(since.length <= 10 ? `${since}T00:00:00+08:00` : since.replace(" ", "T") + (/[Z+]/.test(since.slice(10)) ? "" : "Z")).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}
const waitWord = (d: number | null) => (d === null ? "" : d === 0 ? L("waiting today", "menunggu hari ini") : d === 1 ? L("waiting 1 day", "menunggu 1 hari") : L(`waiting ${d} days`, `menunggu ${d} hari`));

/** NEEDS MY DECISION - the top three of the Desk's own "decide" list. The
    heading says "3 of 5" so it never disagrees with the Pending decisions
    figure; each row says where it comes from, how long it has waited and
    opens it in its own module. The Desk stores overdue and since only, so
    the priority is Overdue or Pending - nothing finer is invented. Nothing
    is approved here. */
export function DecisionQueueCard({ items, total, loaded, failed, nowMs, onViewAll, onRetry }: {
  items: ApprovalLite[]; total: number; loaded: boolean; failed?: boolean; nowMs: number;
  onViewAll: () => void; onRetry?: () => void;
}) {
  const top = [...items].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.since ?? "9999").localeCompare(b.since ?? "9999")).slice(0, 3);
  return (
    <ExecCard icon="verify" title={L("Needs My Decision", "Perlu Keputusan Saya")} phoneTitle={L("My Priority Actions", "Tindakan Utama Saya")}
      right={loaded && total > 0 ? <span className={css.ofCount}>{L(`${top.length} of ${total}`, `${top.length} daripada ${total}`)}</span> : undefined}
      onViewAll={onViewAll} viewAllLabel={L("Open the Desk - every decision waiting", "Buka Meja - setiap keputusan yang menunggu")} testId="decision-queue">
      {!loaded ? (failed ? <ErrorState title={L("The Desk could not be read", "Meja tidak dapat dibaca")} onRetry={onRetry} /> : <SkelRows rows={3} />)
        : total === 0 ? <p className={css.empty}><AppIcon name="success" />{L("Nothing waits for your decision.", "Tiada yang menunggu keputusan anda.")}</p> : (
        <>
          <p className={`${css.priBanner} erp-phone-only`} data-testid="decision-banner"><strong>{total}</strong>{L("Pending decisions · Action required", "Keputusan menunggu · Tindakan diperlukan")}</p>
          <ul className={css.rows}>
            {top.map((i) => (
              <ExecRow key={i.id} lead={<Well icon={BUCKET_ICON[i.bucket] ?? "pending"} tone={i.overdue ? "bad" : "gold"} />} title={i.title}
                sub={[i.source, waitWord(daysWaiting(i.since, nowMs))].filter(Boolean).join(" · ")}
                chip={<span className={css.chipStack}>{i.overdue ? <Chip tone="bad">{L("Overdue", "Lewat")}</Chip> : <Chip tone="warn">{L("Pending", "Menunggu")}</Chip>}<span className={css.actWord} aria-hidden>{L("Review", "Semak")}</span></span>}
                onOpen={i.open} openLabel={L(`Review: ${i.title} (${i.source ?? i.tab})`, `Semak: ${i.title} (${i.source ?? i.tab})`)} />
            ))}
          </ul>
        </>
      )}
    </ExecCard>
  );
}

/** the week the Sales engine gives management (GET /staff/sales/week/dashboard) */
export interface WeekFigures {
  target_cents: number | null; basis_cents: number; basis_kind?: "invoices" | "all_channels"; pct: number | null; gap_cents: number | null;
  days_left: number; required_per_day_cents: number | null; risk: string | null;
}
/** the pace in words, from the server's own risk level (never worked out here) */
export function paceWord(w: WeekFigures): { text: string; tone: Tone } | null {
  if (w.target_cents === null) return null;
  if (w.risk === "none" || (w.gap_cents !== null && w.gap_cents <= 0)) return { text: L("Target reached", "Sasaran dicapai"), tone: "ok" };
  if (w.risk === "low") return { text: L("On pace", "Mengikut rentak"), tone: "ok" };
  if (w.risk === "medium") return { text: L("Behind pace", "Ketinggalan"), tone: "warn" };
  if (w.risk === "high") return { text: L("Below target", "Di bawah sasaran"), tone: "bad" };
  return null;
}
/** what the company figure counts, in one line - sales, never cash received */
export const basisLine = (k: WeekFigures["basis_kind"]) => (k === "all_channels"
  ? L("This week · all channels · sales, not cash received", "Minggu ini · semua saluran · jualan, bukan tunai diterima")
  : L("This week · invoices paid in full", "Minggu ini · invois dibayar penuh"));

/** SALES PERFORMANCE, the summary: target, actual, %, the pace, the gap,
    the working days left and the pace needed - one section. The week /
    month / YTD chart is Sales' own (SalesPerformanceCard in sales.tsx). */
export function SalesSummaryCard({ w, owed, onOpen }: {
  w: WeekFigures | null;
  /** the verified outstanding line a phone carries (it has no figure row) */
  owed?: ReactNode;
  onOpen: () => void;
}) {
  const pace = w ? paceWord(w) : null;
  const pct = w?.pct ?? null;
  return (
    <ExecCard icon="chart" title={L("Sales Performance", "Prestasi Jualan")} phoneTitle={L("My Performance", "Prestasi Saya")} className={css.sum} testId="sales-summary"
      right={pace ? <Chip tone={pace.tone}>{pace.text}</Chip> : undefined}>
      {!w ? <SkelRows rows={3} /> : (
        <>
          <div className={css.sumTop}>
            <p className={css.sumBig}><span className={css.sumActual}>{fmtRM(w.basis_cents)}</span>{w.target_cents !== null && <span className={css.sumOf}> / {fmtRM(w.target_cents)}</span>}</p>
            {pct !== null && <p className={css.sumPct}>{pct}%</p>}
          </div>
          {/* the phone's three figures (the photo) */}
          <dl className={`${css.sumTrio} erp-phone-only`}>
            <div><dt>{w.basis_kind === "all_channels" ? L("Company sales", "Jualan syarikat") : L("Paid invoices", "Invois dibayar")}</dt><dd>{fmtRM(w.basis_cents)}</dd></div>
            <div><dt>{L("Weekly target", "Sasaran mingguan")}</dt><dd>{w.target_cents === null ? L("Not set", "Belum ditetapkan") : fmtRM(w.target_cents)}</dd></div>
            <div><dt>{L("Achieved", "Dicapai")}</dt><dd>{pct === null ? "—" : `${pct}%`}</dd></div>
          </dl>
          {w.target_cents === null ? <p className={css.sumNote}>{L("No company target is set for this week - set it in Sales → Weekly target.", "Tiada sasaran syarikat minggu ini - tetapkan di Jualan → Sasaran mingguan.")}</p> : (
            <span className={css.sumBar} role="img" aria-label={L(`${pct ?? 0}% of the weekly target`, `${pct ?? 0}% daripada sasaran mingguan`)}><i style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} /></span>
          )}
          <dl className={css.sumFacts}>
            <div><dt>{L("Remaining gap", "Baki")}</dt><dd>{w.gap_cents === null ? "—" : fmtRM(Math.max(0, w.gap_cents))}</dd></div>
            <div><dt>{L("Working days left", "Hari bekerja lagi")}</dt><dd>{w.days_left}</dd></div>
            <div className="erp-desktop-only"><dt>{L("Needed per working day", "Perlu setiap hari bekerja")}</dt><dd>{w.required_per_day_cents === null ? "—" : fmtRM(w.required_per_day_cents)}</dd></div>
          </dl>
          {owed && <div className={`${css.sumOwed} erp-phone-only`}>{owed}</div>}
          <p className={css.sumBasis} data-testid="sales-basis">{basisLine(w.basis_kind)}</p>
          <button type="button" className={css.linkBtn} onClick={onOpen}>{L("Open Sales", "Buka Jualan")} <span aria-hidden>→</span></button>
        </>
      )}
    </ExecCard>
  );
}

/** the open quotations the week engine lists (a few, most urgent first) */
export interface RecoveryItem { id: number; doc: string; company: string | null; cents: number; why: string }
/** SALES RECOVERY - open quotations, those with no follow-up booked going
    cold (the server's own count), the quoted value (not revenue) and the
    three to recover first. */
export function SalesRecoveryStrip({ open, cold, items, onPipeline, onOpenDoc }: {
  open: { n: number; cents: number }; cold: number; items: RecoveryItem[];
  onPipeline: () => void; onOpenDoc: (id: number) => void;
}) {
  return (
    <section className={`${card} ${css.recovery}`} aria-label={L("Sales recovery", "Pemulihan jualan")} data-testid="sales-recovery">
      <div className={css.recLead}><span className={css.recIcon} aria-hidden><AppIcon name="star" /></span><strong>{L("Sales Recovery", "Pemulihan Jualan")}</strong></div>
      <dl className={css.recStats}>
        <div><dd>{open.n}</dd><dt>{L("open quotations", "sebut harga terbuka")}</dt></div>
        <div><dd>{cold}</dd><dt>{L("need a follow-up", "perlu susulan")}</dt></div>
        <div><dd>{fmtRM(open.cents)}</dd><dt>{L("quoted value (not revenue)", "nilai sebut harga (bukan hasil)")}</dt></div>
      </dl>
      <button type="button" className={css.viewAll} onClick={onPipeline}>{L("View Pipeline", "Lihat Saluran")} <span aria-hidden>→</span></button>
      {items.length > 0 && (
        <ol className={`${css.recTop} erp-desktop-only`} aria-label={L("Three to recover first", "Tiga untuk dipulihkan dahulu")}>
          {items.slice(0, 3).map((q) => (
            <li key={q.id}>
              <button type="button" className={css.recItem} onClick={() => onOpenDoc(q.id)}>
                <strong>{q.doc} · {q.company ?? "—"}</strong><span>{fmtRM(q.cents)} · {q.why}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** the phone's "My Work": three counts, each opening My Day */
export function MyWorkStrip({ followups, tasks, schedule, loaded, onOpen }: { followups: number; tasks: number; schedule: number; loaded: boolean; onOpen: () => void }) {
  const cell = (k: string, label: string, n: number, sub: string) => (
    <li key={k}><button type="button" className={css.workCell} onClick={onOpen}><span>{label}</span><strong>{loaded ? n : "···"}</strong><small>{sub}</small></button></li>
  );
  return (
    <section className={`${card} ${css.card} erp-phone-only`} aria-label={L("My work", "Kerja saya")} data-testid="my-work">
      <h3 className={css.title}>{L("My Work", "Kerja Saya")}</h3>
      <ul className={css.workRow}>
        {cell("f", L("Follow-ups", "Susulan"), followups, L("due", "perlu"))}
        {cell("t", L("My Tasks", "Tugasan Saya"), tasks, L("open", "terbuka"))}
        {cell("s", L("Today's Schedule", "Jadual Hari Ini"), schedule, L("today", "hari ini"))}
      </ul>
    </section>
  );
}

/** WHAT IS WRONG RIGHT NOW - shown only while something is (a stale backup,
    errors in the last day, a migration not applied). Never hidden to make
    the page cleaner; each line opens where it is fixed. */
export interface AlertLine { key: string; text: string; action: string; on: () => void }
export function AlertBand({ alerts }: { alerts: AlertLine[] }) {
  if (alerts.length === 0) return null;
  return (
    <section className={css.alert} role="status" aria-label={L("Needs attention", "Perlu perhatian")} data-testid="alert-band">
      <AppIcon name="warning" />
      <ul>
        {alerts.map((a) => (
          <li key={a.key}><span>{a.text}</span> <button type="button" className={css.alertBtn} onClick={a.on}>{a.action}</button></li>
        ))}
      </ul>
    </section>
  );
}

/** The phone's view switch (the photo's "CEO View" chip): a two-option
    menu, the current view ticked; Escape or a press outside closes it. */
export function ViewSwitch<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string, string])[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o[0] === value) ?? options[0]!;
  return (
    <div className={css.vsWrap} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button type="button" className={css.vsChip} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="view-switch">
        {cur[1]} <AppIcon name={open ? "up" : "down"} />
      </button>
      {open && (
        <div role="menu" className={css.vsMenu} aria-label={L("Dashboard view", "Paparan papan pemuka")}>
          {options.map(([k, label, sub]) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={k === value} className={css.vsItem}
              onClick={() => { setOpen(false); onChange(k); }}>
              <span aria-hidden className={css.vsTick}>{k === value ? "✓" : ""}</span>
              <span><strong>{label}</strong><small>{sub}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** MY NEXT ACTIONS (My Day): up to three of my own - overdue first, then
    today. Each row opens the record; nothing is closed or sent from here. */
export interface DayAction { key: string; icon: AppIconName; title: string; sub: string; chip: { text: string; tone: Tone }; act: string; on: () => void }
export function NextActionsCard({ rows, loaded }: { rows: DayAction[]; loaded: boolean }) {
  return (
    <ExecCard icon="fast" title={L("My Next Actions", "Tindakan Seterusnya")} count={loaded ? rows.length : undefined} testId="next-actions">
      {!loaded ? <SkelRows rows={3} /> : rows.length === 0 ? <p className={css.empty}><AppIcon name="success" />{L("Nothing is overdue or due today.", "Tiada yang lewat atau perlu hari ini.")}</p> : (
        <ul className={css.rows}>
          {rows.slice(0, 3).map((r) => (
            <ExecRow key={r.key} lead={<Well icon={r.icon} tone={r.chip.tone === "bad" ? "bad" : "gold"} />} title={r.title} sub={r.sub}
              chip={<span className={css.chipStack}><Chip tone={r.chip.tone}>{r.chip.text}</Chip><span className={css.actWord} aria-hidden>{r.act}</span></span>}
              onOpen={r.on} openLabel={`${r.act}: ${r.title}`} />
          ))}
        </ul>
      )}
    </ExecCard>
  );
}

/** MY CONTRIBUTION (My Day): only what the Sales engine credits to me -
    never the company total. */
export function ContributionCard({ me, loaded, onOpen }: {
  me: { basis_cents: number; open_quotations: { n: number; cents: number }; introduced: number | null } | null; loaded: boolean; onOpen?: () => void;
}) {
  return (
    <ExecCard icon="star" title={L("My Contribution", "Sumbangan Saya")} testId="my-contribution"
      right={onOpen ? <button type="button" className={css.viewAll} onClick={onOpen}>{L("Sales", "Jualan")} <span aria-hidden>→</span></button> : undefined}>
      {!loaded ? <SkelRows rows={3} /> : !me ? <p className={css.empty}><AppIcon name="info" />{L("Nothing is credited to you this week.", "Tiada yang dikreditkan kepada anda minggu ini.")}</p> : (
        <>
          <dl className={css.kv}>
            <div><dt>{L("Paid invoices credited to me", "Invois dibayar dikreditkan kepada saya")}</dt><dd>{fmtRM(me.basis_cents)}</dd></div>
            <div><dt>{L("Quotations I own", "Sebut harga saya")}</dt><dd>{me.open_quotations.n} · {fmtRM(me.open_quotations.cents)}</dd></div>
            <div><dt>{L("Leads I introduced (verified this week)", "Petunjuk saya (disahkan minggu ini)")}</dt><dd>{me.introduced ?? "—"}</dd></div>
          </dl>
          <p className={css.perfPace}>{L("This week · what the Sales engine credits to you, never the company total.", "Minggu ini · apa yang enjin Jualan kreditkan kepada anda, bukan jumlah syarikat.")}</p>
        </>
      )}
    </ExecCard>
  );
}

/** TODAY (My Day): the date, my shift only when one is rostered, and the
    day's counts; the decisions are one line that opens the Overview. */
export function TodayStrip({ date, shift, counts, decisions, onDecisions }: {
  date: string; shift: ReactNode; counts: { label: string; n: number | null }[]; decisions: number | null; onDecisions: () => void;
}) {
  return (
    <section className={`${card} ${css.today}`} aria-label={L("Today", "Hari ini")} data-testid="today-strip">
      <div className={css.todayLead}><span className={`${css.well} ${css.w_gold}`} aria-hidden><AppIcon name="date" /></span><span className={css.rowText}><strong>{date}</strong><span>{shift}</span></span></div>
      <dl className={css.todayCounts}>
        {counts.map((c) => <div key={c.label}><dd>{c.n ?? "···"}</dd><dt>{c.label}</dt></div>)}
      </dl>
      {decisions !== null && decisions > 0 && (
        <button type="button" className={css.viewAll} onClick={onDecisions}>
          {L(`${decisions} decision(s) wait for you on Overview`, `${decisions} keputusan menunggu anda di Gambaran`)} <span aria-hidden>→</span>
        </button>
      )}
    </section>
  );
}

export interface ScheduleLite { key: string; time: string | null; title: string; sub?: string }
const ampm = (t: string | null) => {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t ?? "";
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
export function ScheduleCard({ date, today, items, loaded, onViewAll, onToday }: { date: string; today: string; items: ScheduleLite[]; loaded: boolean; onViewAll?: () => void; onToday: () => void }) {
  const isToday = date === today;
  return (
    <ExecCard icon="date" title={isToday ? L("Today's Schedule", "Jadual Hari Ini") : L(`Schedule · ${shortDate(date)}`, `Jadual · ${shortDate(date)}`)} onViewAll={onViewAll} testId="schedule">
      {!isToday && <button type="button" className={css.linkBtn} onClick={onToday}>{L("Back to today", "Kembali ke hari ini")}</button>}
      {!loaded ? <SkelRows rows={3} /> : items.length === 0 ? <p className={css.empty}><AppIcon name="date" />{isToday ? L("Nothing scheduled today.", "Tiada jadual hari ini.") : L("Nothing scheduled that day.", "Tiada jadual pada hari itu.")}</p> : (
        <ul className={css.sched}>
          {items.map((s) => (
            <li key={s.key}>
              <span className={css.schedTime}>{ampm(s.time) || L("All day", "Sepanjang hari")}</span>
              <i aria-hidden className={css.schedDot} />
              <span className={css.rowText}><strong>{s.title}</strong>{s.sub && <span>{s.sub}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </ExecCard>
  );
}

/* ------------------------------------------------------------------ */
/* Quick Actions - each opens an existing workflow this person may use */
/* ------------------------------------------------------------------ */
export interface QuickAction { key: string; icon: AppIconName; label: string; on: () => void }
export function QuickActionsStrip({ actions, max }: { actions: QuickAction[]; max?: number }) {
  if (actions.length === 0) return null;
  /* v1.291.0 (4.0) - four, chosen for the role: the strip draws no more */
  const shown = max ? actions.slice(0, max) : actions;
  return (
    <section className={`${card} ${css.quick} ${max === 4 ? css.quick4 : ""}`} aria-label={L("Quick actions", "Tindakan pantas")} data-testid="quick-actions">
      <div className={css.quickLead}>
        <span className={css.quickIcon} aria-hidden><AppIcon name="boost" /></span>
        <span><strong>{L("Quick Actions", "Tindakan Pantas")}</strong><small>{L("Common tasks, one click away.", "Tugasan biasa, satu klik.")}</small></span>
      </div>
      <ul className={css.quickList}>
        {shown.map((a, i) => (
          <li key={a.key}>
            <button type="button" className={css.quickTile} onClick={a.on}>
              <span className={i === 0 ? css.quickPlus : css.quickGlyph} aria-hidden><AppIcon name={a.icon} /></span>
              <span>{a.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Next best action - the most urgent of your own follow-ups and tasks */
/* ------------------------------------------------------------------ */
export interface NextAction { key: string; icon?: AppIconName; title: string; sub: string; actLabel: string; onAct: () => void }
const SNOOZE_KEY = "azone-nba-snoozed";
const readSnoozed = (): Record<string, string> => { try { const v = JSON.parse(window.localStorage.getItem(SNOOZE_KEY) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
/** the actions not snoozed for today on this device, the first one wins */
export function NextBestActionCard({ candidates, today }: { candidates: NextAction[]; today: string }) {
  const [snoozed, setSnoozed] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : readSnoozed()));
  const item = candidates.find((c) => !(snoozed[c.key] && snoozed[c.key]! >= today)) ?? null;
  if (!item) return null;
  const snooze = () => {
    /* until the end of today, on this device only: the follow-up or task
       itself is unchanged, and tomorrow it is back if it is still due */
    const next = Object.fromEntries(Object.entries({ ...snoozed, [item.key]: today }).filter(([, d]) => d >= today));
    setSnoozed(next);
    try { window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* snoozed for this visit */ }
  };
  return (
    <section className={`${card} ${css.nba}`} aria-label={L("Next best action", "Tindakan terbaik seterusnya")} data-testid="next-best-action">
      <p className={css.nbaLabel}>{L("NEXT BEST ACTION", "TINDAKAN TERBAIK SETERUSNYA")}</p>
      <div className={css.nbaBody}>
        <Well icon={item.icon ?? "chat"} tone="gold" />
        <span className={css.rowText}><strong>{item.title}</strong><span>{item.sub}</span></span>
      </div>
      <div className={css.nbaActions}>
        <button type="button" className={css.btnGold} onClick={item.onAct}>{item.actLabel}</button>
        <button type="button" className={css.btnPlain} onClick={snooze} title={L("Hide it on this device until tomorrow", "Sembunyikan pada peranti ini hingga esok")}>{L("Snooze", "Tunda")}</button>
      </div>
    </section>
  );
}
