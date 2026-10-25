"use client";

/* v1.196.0 - THE LEAVE OVERVIEW AND THE TEAM CALENDAR, laid out as the
   owner's reference photo (23-10-2026). Everything here is read from routes
   the page or the Dashboard already call - your balance and applications
   (handed in from leave.tsx), the month's company leave (GET /staff/leave/
   month, which every staff member already sees on the Dashboard's Leave
   Application card) and the holidays (GET /staff/holidays, open to all).
   Nothing writes, nothing is cached on the device, and no figure from the
   mockup is used. Leave REASONS are never shown here: names, types and
   dates only - less than the Dashboard card already shows. */

import { useEffect, useState } from "react";

import { L, type LeaveReq, leaveTypeL } from "@/components/portal/page-shared";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import css from "./leave-page.module.css";

export type LeaveView = "overview" | "apply" | "mine" | "calendar" | "manage";
type Balance = { entitled: number; used: number; accrued?: number };
type MonthLeave = { id: number; user_id: number; name: string; photo_key?: string | null; position?: string | null; type: string; start_date: string; end_date: string; days: number; status: string };
type Holiday = { id: number; holiday_date: string; name: string; kind: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (ym: string) => { const m = Number(ym.slice(5, 7)) - 1; return `${L(MONTHS[m] ?? "", MONTHS_MS[m] ?? "")} ${ym.slice(0, 4)}`; };
const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number) as [number, number]; const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };
const stateOf = (l: { stage?: string; status: string }) => l.stage ?? l.status;
export function leaveChip(state: string): [string, string] {
  if (state === "approved") return [chipSmSuccess, L("Approved", "Diluluskan")];
  if (state === "rejected") return [chipSmDanger, L("Rejected", "Ditolak")];
  if (state === "cancelled") return [chipSmNeutral, L("Cancelled", "Dibatalkan")];
  return [chipSmWarn, L("Pending", "Menunggu")];
}

/** One plain GET, kept in component state only (never the device cache). */
function usePlain<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null }>({ path: null, data: null });
  useEffect(() => {
    if (!path) return;
    let live = true;
    void api<T>(path).then((r) => { if (live) setState({ path, data: r.ok ? r.data : null }); });
    return () => { live = false; };
  }, [path]);
  return { data: state.path === path ? state.data : null, done: !path || state.path === path };
}

function Head({ icon, tone, title, sub, action }: { icon: AppIconName; tone: string | undefined; title: string; sub: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={css.head}>
      <div className={css.lead}>
        <span className={`${css.well} ${tone ?? ""}`}><AppIcon name={icon} /></span>
        <div className={css.headText}>
          <p className={css.title}>{title}</p>
          <p className={css.sub}>{sub}</p>
        </div>
      </div>
      {action && <button type="button" className={btnSm} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/* v1.206.0 - the Overview, laid out as the owner's second Leave reference
   (25-10-2026): YOUR applications this year by state (labelled as yours -
   the company's in-progress count is the banner above, for approvers),
   your balance as one card a type, then the month at a glance, who is
   away, the holidays. Every figure is the one this page already had:
   balances from GET /staff/leave/balance (the worker's leaveAccrual), your
   applications from GET /staff/leave, the month from GET /staff/leave/month.
   Who is away shows names, types and dates - never the reason. */
export function LeaveOverview({ userId, types, unpaidTypes, balances, mine, loaded, hourly, inProgress, canManage, open, onView }: {
  userId: number;
  types: readonly string[];
  unpaidTypes: readonly string[];
  balances: Record<string, Balance>;
  mine: readonly LeaveReq[];
  loaded: boolean;
  hourly: boolean;
  /** applications in progress across the company, for an approver; null otherwise */
  inProgress: number | null;
  canManage: boolean;
  open: (v: LeaveView) => void;
  /** open one of your applications in the details drawer */
  onView: (id: number) => void;
}) {
  const today = mytToday();
  const ym = today.slice(0, 7);
  const year = today.slice(0, 4);
  const cur = usePlain<{ month: string; leave: MonthLeave[] }>("/staff/leave/month");
  const next = usePlain<{ month: string; leave: MonthLeave[] }>(`/staff/leave/month?month=${shiftMonth(ym, 1)}`);
  const hol = usePlain<{ holidays: Holiday[] }>(`/staff/holidays?year=${year}`);
  const holNext = usePlain<{ holidays: Holiday[] }>(today.slice(5, 7) >= "11" ? `/staff/holidays?year=${Number(year) + 1}` : null);

  /* your applications this year (by the year they start in), by state */
  const thisYear = mine.filter((l) => l.start_date.startsWith(year));
  const count = (st: string) => thisYear.filter((l) => (st === "pending" ? !["approved", "rejected", "cancelled"].includes(stateOf(l)) : stateOf(l) === st)).length;
  const total = thisYear.length;
  const pctOf = (n: number) => (total > 0 ? Math.round((n * 100) / total) : 0);
  const recent = [...mine].sort((a, b) => (b.created_at ?? b.start_date).localeCompare(a.created_at ?? a.start_date)).slice(0, 5);

  /* team leave from today on, this month and next, without duplicates */
  const seen = new Set<number>();
  const upcoming = [...(cur.data?.leave ?? []), ...(next.data?.leave ?? [])]
    .filter((l) => { if (seen.has(l.id)) return false; seen.add(l.id); return l.end_date >= today && l.status !== "rejected"; })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 6);
  const holidays = [...(hol.data?.holidays ?? []), ...(holNext.data?.holidays ?? [])].filter((h) => h.holiday_date >= today).slice(0, 5);

  const tile = (st: "approved" | "pending" | "rejected" | "cancelled", icon: AppIconName, tone: "green" | "gold" | "red" | "blue", label: string) => (
    <KpiTile icon={icon} tone={tone} label={label} value={count(st)} busy={!loaded}
      sub={L(`${pctOf(count(st))}% of your applications`, `${pctOf(count(st))}% daripada permohonan anda`)} onClick={() => open("mine")} />
  );

  return (
    <>
      {inProgress != null && inProgress > 0 && (
        <p className={`erp-note erp-note-warning ${css.callout}`}>
          <AppIcon name="pending" />
          <span>{L(`${inProgress} leave application${inProgress === 1 ? " is" : "s are"} in progress across the company.`, `${inProgress} permohonan cuti sedang diproses di seluruh syarikat.`)}</span>
          <button type="button" className={btnSm} onClick={() => open("manage")}>{L("Open approvals", "Buka kelulusan")}</button>
        </p>
      )}
      {!hourly && (
        <KpiRow label={L(`My applications in ${year}`, `Permohonan saya pada ${year}`)}>
          <KpiTile icon="documents" tone="navy" label={L("My applications", "Permohonan saya")} value={total} busy={!loaded}
            sub={L(`This year (${year})`, `Tahun ini (${year})`)} onClick={() => open("mine")} />
          {tile("approved", "success", "green", L("Approved", "Diluluskan"))}
          {tile("pending", "pending", "gold", L("Pending", "Menunggu"))}
          {tile("rejected", "error", "red", L("Rejected", "Ditolak"))}
          {tile("cancelled", "blocked", "blue", L("Cancelled", "Dibatalkan"))}
        </KpiRow>
      )}

      <div className={css.ovGrid}>
        <div className={css.ovCol}>
          {!hourly && (
            <section className={card} aria-label={L("My leave balance", "Baki cuti saya")}>
              <Head icon="balance" tone={css.gold} title={L("My Leave Balance", "Baki Cuti Saya")} sub={L(`What you are entitled to in ${year} and what is used.`, `Kelayakan anda pada ${year} dan yang digunakan.`)}
                action={{ label: L("Apply leave", "Mohon cuti"), onClick: () => open("apply") }} />
              {!loaded ? <SkelRows rows={3} /> : (
                <ul className={css.balCards}>
                  {types.map((t) => <BalanceCard key={t} type={t} b={balances[t]} unpaid={unpaidTypes.includes(t)} />)}
                </ul>
              )}
            </section>
          )}
          {!hourly && (
            <section className={card} aria-label={L("Recent leave requests", "Permohonan cuti terkini")}>
              <Head icon="documents" tone={css.gold} title={L("Recent Leave Requests", "Permohonan Cuti Terkini")} sub={L("Your latest applications and their status.", "Permohonan terkini anda dan statusnya.")}
                action={{ label: L("View all", "Lihat semua"), onClick: () => open("mine") }} />
              <div className={css.tWrap}>
                <table className={css.t}>
                  <thead><tr><th>{L("Applied", "Dimohon")}</th><th>{L("Leave type", "Jenis cuti")}</th><th>{L("Period", "Tempoh")}</th><th className={css.num}>{L("Days", "Hari")}</th><th>{L("Status", "Status")}</th><th><span className={css.srOnly}>{L("Action", "Tindakan")}</span></th></tr></thead>
                  <tbody>
                    {!loaded ? <tr><td colSpan={6}><SkelRows rows={3} /></td></tr>
                      : recent.length === 0 ? <tr><td colSpan={6} className={css.empty}>{L("No applications yet - Apply Leave starts the first one.", "Belum ada permohonan - Mohon Cuti untuk memulakan.")}</td></tr>
                      : recent.map((l) => {
                        const chip = leaveChip(stateOf(l));
                        return (
                          <tr key={l.id}>
                            <td className={css.muted}>{dmy((l.created_at ?? l.start_date).slice(0, 10))}</td>
                            <td className={css.cap}>{leaveTypeL(l.type)}</td>
                            <td className={css.muted}>{dmy(l.start_date)}{l.end_date !== l.start_date ? ` – ${dmy(l.end_date)}` : ""}</td>
                            <td className={css.num}>{l.days}</td>
                            <td><span className={chip[0]}>{chip[1]}</span></td>
                            <td><button type="button" className={btnSm} onClick={() => onView(l.id)}>{L("View", "Lihat")}</button></td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className={css.ovCol}>
          <MiniCalendar userId={userId} today={today} holidays={[...(hol.data?.holidays ?? []), ...(holNext.data?.holidays ?? [])]} onOpen={() => open("calendar")} />

          <section className={card} aria-label={L("Upcoming team leave", "Cuti pasukan akan datang")}>
            <Head icon="users" tone={css.blue} title={L("Upcoming Team Leave", "Cuti Pasukan Akan Datang")} sub={L("Who is away from today, this month and next.", "Siapa bercuti mulai hari ini, bulan ini dan bulan depan.")}
              action={{ label: L("View calendar", "Lihat kalendar"), onClick: () => open("calendar") }} />
            {!(cur.done && next.done) ? <SkelRows rows={3} /> : upcoming.length === 0 ? (
              <p className={css.empty}>{L("Nobody is on leave in the coming weeks.", "Tiada sesiapa bercuti dalam beberapa minggu akan datang.")}</p>
            ) : (
              <ul className={css.rows}>
                {upcoming.map((l) => (
                  <li key={l.id} className={css.row}>
                    <Avatar name={properName(l.name)} photoKey={l.photo_key} size="sm" />
                    <span className={css.rowMain}>
                      <span className={css.name}>{properName(l.name)}</span>
                      <span className={`${css.sub} ${css.cap}`}>{leaveTypeL(l.type)}{l.position ? ` · ${l.position}` : ""}</span>
                    </span>
                    <span className={css.rowEnd}>
                      <span>{dmy(l.start_date)}{l.end_date !== l.start_date ? ` – ${dmy(l.end_date)}` : ""}</span>
                      <span className={css.sub}>{l.days} {L("day(s)", "hari")}{l.status !== "approved" ? <span className={`${chipSmWarn} ${css.gap}`}>{L("Pending", "Menunggu")}</span> : null}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-label={L("Public holidays", "Cuti umum")}>
            <Head icon="holiday" tone={css.red} title={L("Public Holidays", "Cuti Umum")} sub={L("The company's holidays and replacement days ahead.", "Cuti syarikat dan hari gantian akan datang.")} />
            {!(hol.done && holNext.done) ? <SkelRows rows={3} /> : holidays.length === 0 ? (
              <p className={css.empty}>{L("No holidays ahead on the company calendar.", "Tiada cuti akan datang dalam kalendar syarikat.")}</p>
            ) : (
              <ul className={css.rows}>
                {holidays.map((h) => (
                  <li key={h.id} className={css.row}>
                    <span className={css.badge} aria-hidden="true"><span className={css.badgeDay}>{h.holiday_date.slice(8, 10)}</span><span className={css.badgeMon}>{MON[Number(h.holiday_date.slice(5, 7)) - 1]}</span></span>
                    <span className={css.rowMain}><span className={css.name}>{h.name}</span><span className={css.sub}>{dmy(h.holiday_date)}</span></span>
                    <span className={h.kind === "replacement" ? chipSmWarn : h.kind === "company" ? chipSmInfo : chipSmDanger}>
                      {h.kind === "replacement" ? L("Replacement day", "Hari gantian") : h.kind === "company" ? L("Company holiday", "Cuti syarikat") : L("Public holiday", "Cuti umum")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className={card} aria-label={L("Quick actions", "Tindakan pantas")}>
        <p className={css.title}>{L("Quick Actions", "Tindakan Pantas")}</p>
        <div className={css.quick}>
          {!hourly && <button type="button" className={css.qa} onClick={() => open("apply")}><span className={`${css.qaIcon} ${css.gold}`}><AppIcon name="add" /></span>{L("Apply leave", "Mohon cuti")}</button>}
          {!hourly && <button type="button" className={css.qa} onClick={() => open("mine")}><span className={`${css.qaIcon} ${css.blue}`}><AppIcon name="documents" /></span>{L("My leave history", "Sejarah cuti saya")}</button>}
          <button type="button" className={css.qa} onClick={() => open("calendar")}><span className={`${css.qaIcon} ${css.green}`}><AppIcon name="date" /></span>{L("Team calendar", "Kalendar pasukan")}</button>
          {canManage && <button type="button" className={css.qa} onClick={() => open("manage")}><span className={`${css.qaIcon} ${css.red}`}><AppIcon name="verify" /></span>{L("Approvals & management", "Kelulusan & pengurusan")}</button>}
        </div>
      </section>
    </>
  );
}

/* One leave type's balance, from the figures the worker returns (entitled,
   used, accrued - leaveAccrual). Annual leave accrues through the year, so
   its headline is what you may take NOW; the unpaid, unrestricted types say
   what they cost instead of pretending to a balance (v1.146.0). */
export function BalanceCard({ type, b, unpaid }: { type: string; b: Balance | undefined; unpaid: boolean }) {
  const v = b ?? { entitled: 0, used: 0, accrued: 0 };
  const now = Math.max(0, (v.accrued ?? v.entitled) - v.used);
  const pct = v.entitled > 0 ? Math.min(100, (v.used / v.entitled) * 100) : 0;
  return (
    <li className={css.balCard}>
      <span className={`${css.balIcon} ${css[`bal_${type}`] ?? ""}`} aria-hidden="true"><AppIcon name={type === "medical" ? "verify" : type === "replacement" ? "refresh" : unpaid ? "money" : "holiday"} /></span>
      <span className={css.balText}>
        <span className={`${css.balName} ${css.cap}`}>{leaveTypeL(type)}{L(" leave", "")}</span>
        {unpaid ? (
          <>
            <span className={css.balBig}>{L("Unpaid", "Tanpa gaji")}</span>
            <span className={css.sub}>{L(`No limit · ${v.used} taken this year`, `Tiada had · ${v.used} diambil tahun ini`)}</span>
          </>
        ) : (
          <>
            <span className={css.balBig}>{now} <small>{L("days eligible now", "hari layak sekarang")}</small></span>
            <span className={css.track} aria-hidden="true"><span className={`${css.fill} ${css[`fill_${type}`] ?? ""}`} style={{ width: `${pct}%` }} /></span>
            <span className={css.sub}>{L(`${v.entitled}/year · ${v.used} used`, `${v.entitled}/tahun · ${v.used} digunakan`)}</span>
          </>
        )}
      </span>
    </li>
  );
}

/* The month at a glance, small: a dot for your leave, the team's, a public
   holiday; today ringed. Pressing a day opens the Team Calendar. */
function MiniCalendar({ userId, today, holidays, onOpen }: { userId: number | null; today: string; holidays: readonly Holiday[]; onOpen: () => void }) {
  const [ym, setYm] = useState(today.slice(0, 7));
  const month = usePlain<{ month: string; leave: MonthLeave[] }>(`/staff/leave/month?month=${ym}`);
  const yearHol = usePlain<{ holidays: Holiday[] }>(ym.slice(0, 4) !== today.slice(0, 4) ? `/staff/holidays?year=${ym.slice(0, 4)}` : null);
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array.from({ length: first }, () => null), ...Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const leave = (month.data?.leave ?? []).filter((l) => l.status !== "rejected");
  const hols = [...holidays, ...(yearHol.data?.holidays ?? [])].filter((h) => h.holiday_date.startsWith(ym));
  const DOWM = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DOWM_MS = ["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Ahd"];
  return (
    <section className={card} aria-label={L("Leave calendar at a glance", "Kalendar cuti sepintas lalu")}>
      <div className={css.head}>
        <div className={css.lead}>
          <span className={`${css.well} ${css.gold}`}><AppIcon name="date" /></span>
          <div className={css.headText}><p className={css.title}>{L("Leave Calendar", "Kalendar Cuti")}</p></div>
        </div>
        <div className={css.calNav}>
          <button type="button" className={btnSm} aria-label={L("Previous month", "Bulan sebelumnya")} onClick={() => setYm((v) => shiftMonth(v, -1))}><AppIcon name="previous" /></button>
          <span className={css.calMonth}>{monthName(ym)}</span>
          <button type="button" className={btnSm} aria-label={L("Next month", "Bulan seterusnya")} onClick={() => setYm((v) => shiftMonth(v, 1))}><AppIcon name="next" /></button>
        </div>
      </div>
      {!month.done ? <SkelRows rows={4} /> : (
        <div className={css.mini} role="group" aria-label={monthName(ym)}>
          {DOWM.map((d, i) => <span key={d} className={`${css.miniDow} ${i >= 5 ? css.miniWeekend : ""}`} aria-hidden="true">{L(d, DOWM_MS[i] ?? d)}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={`e${i}`} aria-hidden="true" />;
            const here = leave.filter((l) => l.start_date <= d && l.end_date >= d);
            const mineHere = userId != null && here.some((l) => l.user_id === userId);
            const team = here.some((l) => l.user_id !== userId);
            const h = hols.find((x) => x.holiday_date === d);
            return (
              <button key={d} type="button" onClick={onOpen}
                className={`${css.miniDay} ${d === today ? css.miniToday : ""} ${h ? css.miniHol : ""}`}
                aria-label={`${dmy(d)}${h ? ` · ${h.name}` : ""}${here.length ? ` · ${here.length} ${L("away", "bercuti")}` : ""}`}>
                <span>{Number(d.slice(8, 10))}</span>
                <span className={css.miniDots} aria-hidden="true">
                  {mineHere && <span className={`${css.miniDot} ${css.keyMine}`} />}
                  {team && <span className={`${css.miniDot} ${css.keyTeam}`} />}
                  {h && <span className={`${css.miniDot} ${css.keyHol}`} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className={css.legend}>
        <span><span className={`${css.key} ${css.keyMine}`} aria-hidden="true" />{L("My leave", "Cuti saya")}</span>
        <span><span className={`${css.key} ${css.keyTeam}`} aria-hidden="true" />{L("Team leave", "Cuti pasukan")}</span>
        <span><span className={`${css.key} ${css.keyHol}`} aria-hidden="true" />{L("Public holiday", "Cuti umum")}</span>
        <span><span className={`${css.key} ${css.keyToday}`} aria-hidden="true" />{L("Today", "Hari ini")}</span>
      </p>
    </section>
  );
}

/* ================= the Team Calendar: a month, a cell a day ================= */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_MS = ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"];

export function TeamCalendarGrid({ userId }: { userId: number }) {
  const today = mytToday();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [pick, setPick] = useState<string | null>(null);
  const month = usePlain<{ month: string; leave: MonthLeave[] }>(`/staff/leave/month?month=${ym}`);
  const hol = usePlain<{ holidays: Holiday[] }>(`/staff/holidays?year=${ym.slice(0, 4)}`);

  const [y, m] = ym.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array.from({ length: first }, () => null), ...Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const leave = (month.data?.leave ?? []).filter((l) => l.status !== "rejected");
  const holidays = (hol.data?.holidays ?? []).filter((h) => h.holiday_date.startsWith(ym));
  const on = (d: string) => leave.filter((l) => l.start_date <= d && l.end_date >= d);
  const picked = pick && pick.startsWith(ym) ? pick : null;

  return (
    <section className={card} aria-label={L("Leave calendar", "Kalendar cuti")}>
      <div className={css.head}>
        <div className={css.lead}>
          <span className={`${css.well} ${css.gold}`}><AppIcon name="date" /></span>
          <div className={css.headText}>
            <p className={css.title}>{L("Leave Calendar", "Kalendar Cuti")}</p>
            <p className={css.sub}>{L("Your leave and the team's at a glance, with the public holidays. Press a day to see who is away.", "Cuti anda dan pasukan sepintas lalu, bersama cuti umum. Tekan satu hari untuk melihat siapa yang bercuti.")}</p>
          </div>
        </div>
        <div className={css.calNav}>
          <button type="button" className={btnSm} aria-label={L("Previous month", "Bulan sebelumnya")} onClick={() => setYm((v) => shiftMonth(v, -1))}><AppIcon name="previous" /></button>
          <span className={css.calMonth}>{monthName(ym)}</span>
          <button type="button" className={btnSm} aria-label={L("Next month", "Bulan seterusnya")} onClick={() => setYm((v) => shiftMonth(v, 1))}><AppIcon name="next" /></button>
          <button type="button" className={btnSm} onClick={() => setYm(today.slice(0, 7))}>{L("Today", "Hari ini")}</button>
        </div>
      </div>
      <p className={css.legend}>
        <span><span className={`${css.key} ${css.keyMine}`} aria-hidden="true" />{L("My leave", "Cuti saya")}</span>
        <span><span className={`${css.key} ${css.keyTeam}`} aria-hidden="true" />{L("Team leave", "Cuti pasukan")}</span>
        <span><span className={`${css.key} ${css.keyHol}`} aria-hidden="true" />{L("Public holiday", "Cuti umum")}</span>
        <span><span className={`${css.key} ${css.keyPending}`} aria-hidden="true" />{L("Waiting for a decision", "Menunggu keputusan")}</span>
      </p>
      {!(month.done && hol.done) ? <SkelRows rows={5} /> : (
        <div className={css.calWrap}>
          <div className={css.grid} role="group" aria-label={monthName(ym)}>
            {DOW.map((d, i) => <span key={d} className={css.dow} aria-hidden="true">{L(d, DOW_MS[i] ?? d)}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} className={css.blank} aria-hidden="true" />;
              const list = on(d);
              const mineHere = list.filter((l) => l.user_id === userId);
              const teamHere = list.filter((l) => l.user_id !== userId);
              const h = holidays.find((x) => x.holiday_date === d);
              return (
                <button key={d} type="button" aria-pressed={picked === d}
                  className={`${css.day} ${d === today ? css.today : ""} ${picked === d ? css.dayOn : ""} ${(i % 7 === 0 || i % 7 === 6) ? css.weekend : ""}`}
                  onClick={() => setPick(picked === d ? null : d)}
                  aria-label={`${dmy(d)}${h ? ` · ${h.name}` : ""}${list.length ? ` · ${list.length} ${L("away", "bercuti")}` : ""}`}>
                  <span className={css.dayNum}>{Number(d.slice(8, 10))}</span>
                  {h && <span className={`${css.pill} ${css.pillHol}`}>{h.name}</span>}
                  {mineHere.length > 0 && <span className={`${css.pill} ${css.pillMine} ${mineHere.every((l) => l.status === "approved") ? "" : css.pillPending}`}>{L("My leave", "Cuti saya")}</span>}
                  {teamHere.length > 0 && <span className={`${css.pill} ${css.pillTeam} ${teamHere.every((l) => l.status === "approved") ? "" : css.pillPending}`}>{teamHere.length} {L("away", "bercuti")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {picked && (
        <div className={css.dayList}>
          <p className={css.title}>{dmy(picked)}</p>
          {holidays.filter((x) => x.holiday_date === picked).map((x) => <p key={x.id} className={css.sub}>{x.name}</p>)}
          {on(picked).length === 0 ? <p className={css.empty}>{L("Nobody is on leave this day.", "Tiada sesiapa bercuti pada hari ini.")}</p> : (
            <ul className={css.rows}>
              {on(picked).map((l) => (
                <li key={l.id} className={css.row}>
                  <Avatar name={properName(l.name)} size="sm" />
                  <span className={css.rowMain}><span className={css.name}>{properName(l.name)}</span><span className={`${css.sub} ${css.cap}`}>{leaveTypeL(l.type)} · {dmy(l.start_date)}{l.end_date !== l.start_date ? ` – ${dmy(l.end_date)}` : ""}</span></span>
                  <span className={l.status === "approved" ? chipSmSuccess : chipSmWarn}>{l.status === "approved" ? L("Approved", "Diluluskan") : L("Pending", "Menunggu")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
