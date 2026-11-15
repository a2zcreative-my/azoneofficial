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

import { L, leaveTypeL } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, card, chipSmDanger, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import css from "./leave-page.module.css";

export type LeaveView = "overview" | "apply" | "mine" | "calendar" | "manage";
type MonthLeave = { id: number; user_id: number; name: string; photo_key?: string | null; position?: string | null; type: string | null; start_date: string; end_date: string; days: number; status: string }; // type null = withheld by the server (v1.259.0, D6)
type Holiday = { id: number; holiday_date: string; name: string; kind: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
export const monthName = (ym: string) => { const m = Number(ym.slice(5, 7)) - 1; return `${L(MONTHS[m] ?? "", MONTHS_MS[m] ?? "")} ${ym.slice(0, 4)}`; };
const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number) as [number, number]; const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };
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


/* v1.309.0 (Leave Workspace 4.0, L-9 / L-10) - the old Overview (your own
   tiles, the balance cards, a mini calendar, quick actions) and the "Your
   approval route" card with the CEO's legacy / organisation switch are
   gone: the Overview is the team picture (leave4.tsx), the balance lives in
   My Leave only, the route is shown on Apply before submitting, the switch
   is retired (L-1), and this grid is the one calendar. */

/* ================= the Team Calendar: a month, a cell a day ================= */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_MS = ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"];

export function TeamCalendarGrid({ userId, onMonth, onDay }: { userId: number; /** v1.309.0 - the side panels follow the month and the day */ onMonth?: (ym: string) => void; onDay?: (d: string) => void }) {
  const today = mytToday();
  const [ym, setYmRaw] = useState(today.slice(0, 7));
  const [pick, setPickRaw] = useState<string | null>(null);
  const setYm = (f: (v: string) => string) => setYmRaw((v) => { const n = f(v); onMonth?.(n); return n; });
  const setPick = (d: string | null) => { setPickRaw(d); onDay?.(d ?? today); };
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
            <p className={css.title}>{L("Team Calendar", "Kalendar Pasukan")}</p>
            <p className={css.sub}>{L("Your leave and the team's at a glance, with the public holidays. Press a day to see who is away.", "Cuti anda dan pasukan sepintas lalu, bersama cuti umum. Tekan satu hari untuk melihat siapa yang bercuti.")}</p>
          </div>
        </div>
        <div className={css.calNav}>
          <button type="button" className={btnSm} aria-label={L("Previous month", "Bulan sebelumnya")} onClick={() => setYm((v) => shiftMonth(v, -1))}><AppIcon name="previous" /></button>
          <span className={css.calMonth}>{monthName(ym)}</span>
          <button type="button" className={btnSm} aria-label={L("Next month", "Bulan seterusnya")} onClick={() => setYm((v) => shiftMonth(v, 1))}><AppIcon name="next" /></button>
          <button type="button" className={btnSm} onClick={() => setYm(() => today.slice(0, 7))}>{L("Today", "Hari ini")}</button>
        </div>
      </div>
      {/* v1.309.0 (ref 3) - the legend of the reference: team leave, public holiday, pending leave, today (your own leave keeps its colour) */}
      <p className={css.legend}>
        <span><span className={`${css.key} ${css.keyTeam}`} aria-hidden="true" />{L("Team Leave", "Cuti Pasukan")}</span>
        <span><span className={`${css.key} ${css.keyHol}`} aria-hidden="true" />{L("Public Holiday", "Cuti Umum")}</span>
        <span><span className={`${css.key} ${css.keyPending}`} aria-hidden="true" />{L("Pending Leave", "Cuti Menunggu")}</span>
        <span><span className={`${css.key} ${css.keyToday}`} aria-hidden="true" />{L("Today", "Hari Ini")}</span>
        <span><span className={`${css.key} ${css.keyMine}`} aria-hidden="true" />{L("My leave", "Cuti saya")}</span>
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
                  {teamHere.some((l) => l.status === "approved") && <span className={`${css.pill} ${css.pillTeam}`}>{teamHere.filter((l) => l.status === "approved").length} {L("on leave", "bercuti")}</span>}
                  {teamHere.some((l) => l.status !== "approved") && <span className={`${css.pill} ${css.pillTeam} ${css.pillPending}`}>{teamHere.filter((l) => l.status !== "approved").length} {L("pending", "menunggu")}</span>}
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
                  <span className={l.status === "approved" ? chipSmSuccess : chipSmWarn} data-state={l.status === "approved" ? "approved" : "tentative"}>{l.status === "approved" ? L("Approved", "Diluluskan") : L("Tentative", "Sementara")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
