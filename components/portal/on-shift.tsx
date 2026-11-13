"use client";

/* v1.208.0 - ON SHIFT, REDESIGNED (the owner's brief, 25-10-2026: "ONE WORK
   SESSION. ONE AUTHORITATIVE RECORD. TWO CONSISTENT INTERFACES. ZERO
   DUPLICATION.").

   This file only DRAWS. Every figure on it comes from a response the page
   already reads, and nothing here punches:

     the punch          punch() in dashboard.tsx - the one function the
                        Dashboard's clock card calls too, with its geofence,
                        shift and approval rules (POST /staff/attendance)
     my day             GET /staff/attendance - today's punches, the server's
                        today_shift (slots, entry.open_since, can_clock_in)
     the timer          now minus entry.open_since, the clock-in the SERVER
                        recorded. It is a display: the hours paid are the
                        server's pairing of the stored punches, never this
     sessions / hours   lib/clock-sessions.ts, the server's pairing rule
     team on shift      GET /staff/attendance/monitor - the route the
                        Dashboard's Team On Shift card reads, for the same
                        roles; status and times only, never a position
     this week          GET /staff/roster - the roster board's own route,
                        filtered to the person's own rows
     recent days        the month the page already loaded, with the server's
                        own verdict for each day (myMonthDays)
     waiting punches    the device outbox (lib/outbox.ts): a punch kept with
                        no signal is shown as NOT CONFIRMED until the server
                        has it - never as a clock-in

   Everything works the same on a desktop and in the installed app: one tree,
   laid out by on-shift.module.css. */

import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { L, type AttRecord, type LocOutcome, type MonthDay } from "@/components/portal/page-shared";
import { LocChip, locFlagged, locWord } from "@/components/portal/shift-location";
import { SideDrawer } from "@/components/ui/side-drawer";
import type { MonitorRow } from "@/components/portal/dashboard-overview";
import { useCachedApi } from "@/lib/cached-api";
import { daysOf, hoursLabel, mytDay, pairSessions, type Session } from "@/lib/clock-sessions";
import { dmy, mytToday } from "@/lib/format";
import { outboxAll, subscribeOutbox, dismissNeedsHr } from "@/lib/outbox";
import { chipInfo, chipNeutral, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, chipSuccess, chipWarn, inputClass, selectClass } from "@/lib/ui-styles";
import css from "./on-shift.module.css";

const utcMs = (at: string): number => Date.parse(`${at.replace(" ", "T")}Z`);
/** HH:MM Malaysia time for a stored UTC stamp */
export const mytHm = (at: string): string => new Date(utcMs(at) + 8 * 3600 * 1000).toISOString().slice(11, 16);
const pad = (n: number) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ */
/* the timer                                                           */
/* ------------------------------------------------------------------ */

/** A clock that ticks only while it is wanted - the page is often left open
    on a phone all day. The tick is set from the interval, never in render. */
function useTick(active: boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [active, every]);
  return now;
}

export type ShiftState = "unknown" | "idle" | "open" | "done" | "error";

export function ShiftTimer({ state, openSince, workedMinutes, firstIn, lastOut }: {
  state: ShiftState;
  /** the server's recorded clock-in (UTC, as stored) */
  openSince: string | null;
  /** today's closed sessions, minutes */
  workedMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
}) {
  const now = useTick(state === "open" && !!openSince);
  if (state === "unknown") {
    return (
      <div className={css.timer} aria-busy="true">
        <Skel w={220} h={56} round="lg" />
        <Skel w={160} h={14} />
      </div>
    );
  }
  if (state === "open" && openSince) {
    const ms = now - utcMs(openSince);
    const behind = ms < 0;
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    return (
      <div className={css.timer}>
        <p className={`${css.timerValue} ${css.timerLive}`} role="timer" aria-label={L(`On shift for ${hh} hours ${Math.floor((s % 3600) / 60)} minutes`, `Sedang syif selama ${hh} jam ${Math.floor((s % 3600) / 60)} minit`)}>
          {pad(hh)}:{pad(Math.floor((s % 3600) / 60))}<span className={css.timerSec}>:{pad(s % 60)}</span>
        </p>
        <span className={css.underline} aria-hidden />
        <p className={css.timerCaption}>
          {L(`On shift since ${mytHm(openSince)} MYT`, `Sedang syif sejak ${mytHm(openSince)} MYT`)}
          {mytDay(openSince) !== mytToday() && <> · {L("began yesterday", "bermula semalam")}</>}
        </p>
        {behind && (
          <p className={css.timerWarn} role="status">
            {L("This device's clock is behind the server's, so the timer cannot run. Your clock-in is recorded at the time above.",
               "Jam peranti ini di belakang pelayan, jadi pemasa tidak dapat berjalan. Daftar masuk anda direkodkan pada masa di atas.")}
          </p>
        )}
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className={css.timer}>
        <p className={css.timerValue}>{hoursLabel(workedMinutes)}</p>
        <span className={css.underline} aria-hidden />
        <p className={css.timerCaption}>
          {L("Worked today", "Bekerja hari ini")}{firstIn ? ` · ${firstIn}${lastOut ? ` → ${lastOut}` : ""}` : ""}
        </p>
      </div>
    );
  }
  /* idle (or the day could not be read): no session has started, so no
     timer runs - the brief's "do not start a working-session timer
     prematurely" */
  return (
    <div className={css.timer}>
      <p className={`${css.timerValue} ${css.timerIdle}`} aria-label={L("No shift running", "Tiada syif berjalan")}>--:--<span className={css.timerSec}>:--</span></p>
      <p className={css.timerCaption}>
        {state === "error" ? L("Your day could not be loaded", "Hari anda tidak dapat dimuatkan") : L("Not clocked in", "Belum daftar masuk")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* today's sessions                                                    */
/* ------------------------------------------------------------------ */

/** Today's punches as sessions (newest-first input is fine). A shift that
    began yesterday and is still open is shown first, from the server's
    open_since, so the night is not lost from the list. */
export function todaySessions(today: { type: string; created_at: string }[], openSince: string | null): Session[] {
  const list = pairSessions(today.filter((r) => r.type === "clock_in" || r.type === "clock_out").map((r) => ({ type: r.type, at: r.created_at })));
  if (openSince && mytDay(openSince) !== mytToday() && !list.some((s) => !s.out)) {
    return [{ in: openSince, out: null, minutes: 0 }, ...list];
  }
  return list;
}

/* v1.294.0 (On Shift v2.0) - PUNCH DETAILS: each shift as its clock-in and
   clock-out, and each punch with the location outcome the server gave it
   (the in and the out are judged separately and never overwrite each
   other). `punches` are today's records as read; nothing is computed here
   that the server did not say. */
export function SessionRows({ sessions, known, punches = [], site = null, exempt = false }: {
  sessions: Session[]; known: boolean;
  punches?: AttRecord[];
  /** the site's name, when a geofence is set */
  site?: string | null;
  exempt?: boolean;
}) {
  if (!known) return <SkelRows rows={2} />;
  if (sessions.length === 0) {
    return <p className={css.muted}>{L("No punches recorded today.", "Tiada punch direkodkan hari ini.")}</p>;
  }
  const at = new Map(punches.map((r) => [r.created_at, r]));
  const where = (r: AttRecord | undefined) => {
    if (!r?.loc) return null;
    const w = locWord(r.loc, exempt);
    return site && (r.loc.status === "verified" || r.loc.status === "outside" || r.loc.status === "low_accuracy") ? `${site} · ${w.long}` : w.long;
  };
  return (
    <ol className={css.sessions} aria-label={L("Today's punches", "Punch hari ini")}>
      {sessions.map((s, i) => {
        const pin = at.get(s.in);
        const pout = s.out ? at.get(s.out) : undefined;
        return (
          <li key={s.in} className={`${css.session} ${css.sessionGold}`} data-testid="punch-session">
            {sessions.length > 1 && <span className={css.sessionNo}>{L(`Shift ${i + 1}`, `Syif ${i + 1}`)}</span>}
            <div className={css.punchLine} data-kind="in">
              <span className={css.punchDot} data-done="" aria-hidden />
              <span className={css.punchWhat}><strong>{L("Clock In", "Daftar Masuk")}</strong><span className={css.inTime}>{mytHm(s.in)}</span></span>
              <span className={css.punchWhere}>{where(pin) ?? <span className={css.muted}>{L("Location not read", "Lokasi tidak dibaca")}</span>}</span>
              {pin?.pending ? <span className={chipSmWarn}>{L("Awaiting approval", "Menunggu kelulusan")}</span> : <LocChip loc={pin?.loc ?? null} exempt={exempt} small />}
            </div>
            <div className={css.punchLine} data-kind="out">
              <span className={css.punchDot} data-done={s.out ? "" : undefined} aria-hidden />
              <span className={css.punchWhat}><strong>{L("Clock Out", "Daftar Keluar")}</strong>{s.out ? <span>{mytHm(s.out)}</span> : <span className={css.muted}>{L("Not yet recorded", "Belum direkod")}</span>}</span>
              <span className={css.punchWhere}>{s.out ? where(pout) ?? "" : <span className={css.sessionLen}>{L("running", "berjalan")}</span>}</span>
              {s.out ? (pout?.pending ? <span className={chipSmWarn}>{L("Awaiting approval", "Menunggu kelulusan")}</span> : <LocChip loc={pout?.loc ?? null} exempt={exempt} small />)
                : <span className={chipSmNeutral}>{L("Pending", "Belum")}</span>}
            </div>
            {s.out && <span className={css.sessionLen}>{L(`Worked ${hoursLabel(s.minutes)}`, `Bekerja ${hoursLabel(s.minutes)}`)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* today's schedule                                                    */
/* ------------------------------------------------------------------ */

export interface SlotLite { start: string; end: string; what: string | null; claimed: boolean }

export function ScheduleSlots({ slots, known, nowMinute }: { slots: SlotLite[] | null; known: boolean; nowMinute: number }) {
  if (!known) return <SkelRows rows={2} />;
  if (!slots || slots.length === 0) {
    return <p className={css.muted}>{L("Rest day on your pattern - nothing scheduled today.", "Hari rehat pada corak anda - tiada jadual hari ini.")}</p>;
  }
  const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return (
    <ul className={css.slots} aria-label={L("Today's scheduled shifts", "Syif berjadual hari ini")}>
      {slots.map((s) => {
        const over = nowMinute >= min(s.end) && s.end !== "00:00";
        const now = nowMinute >= min(s.start) && !over;
        return (
          <li key={`${s.start}-${s.end}`} className={css.slot} data-now={now ? "" : undefined}>
            <span className={css.slotTime}>{s.start} – {s.end}</span>
            <span className={css.slotWhat}>{s.what ?? L("Working hours", "Waktu bekerja")}</span>
            <span className={s.claimed ? chipSmSuccess : now ? chipSmWarn : chipSmNeutral}>
              {s.claimed ? L("Clocked", "Didaftar") : now ? L("Due now", "Sekarang") : over ? L("Not clocked", "Tidak didaftar") : L("Later", "Nanti")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* team on shift                                                       */
/* ------------------------------------------------------------------ */

/* v1.294.0 (On Shift v2.0, section 12) - TEAM ON SHIFT, redesigned. The
   same monitor route and the same readers (hr_manage or exec_view, checked
   by the worker); the route now adds, read-only, who each person is at work,
   today's shift from the one schedule rule, leave and holidays, and each
   punch's location OUTCOME - a word and a distance, never a position. The
   five counts are counted from the rows drawn, so they cannot disagree with
   the list: scheduled headcount is not the on-shift headcount. */
export interface TeamPunch { type: string; at: string; pending?: boolean; loc: LocOutcome }
export interface TeamRow extends MonitorRow {
  position?: string | null; department?: string | null; role_title?: string | null;
  shift?: { label: string | null; pattern: string; scheduled: boolean };
  on_leave?: boolean; holiday?: boolean;
  punches?: TeamPunch[];
  in_loc?: LocOutcome | null; out_loc?: LocOutcome | null;
  loc_exempt?: boolean;
}
type TeamState = "on" | "out" | "none" | "leave" | "off";
const stateOf = (m: TeamRow): TeamState =>
  m.last_type === "clock_in" ? "on" : m.out_at || m.last_type === "clock_out" ? "out"
    : m.on_leave ? "leave" : m.holiday || (m.shift && !m.shift.scheduled) ? "off" : "none";
const STATE_WORD: Record<TeamState, [string, string]> = {
  on: ["On Shift", "Sedang Syif"], out: ["Clocked Out", "Daftar Keluar"], none: ["Not Yet Clocked In", "Belum Daftar Masuk"],
  leave: ["On Leave", "Bercuti"], off: ["Not Scheduled", "Tiada Jadual"],
};
const STATE_CHIP: Record<TeamState, string> = { on: chipSmSuccess, out: chipSmNeutral, none: chipSmWarn, leave: chipSmInfo, off: chipSmNeutral };
const STATE_RANK: Record<TeamState, number> = { none: 0, on: 1, out: 2, leave: 3, off: 4 };
type LocFilter = "" | "verified" | "outside" | "low" | "noloc" | "nopunch";
const locKey = (m: TeamRow): Exclude<LocFilter, ""> => {
  const all = (m.punches ?? []).map((p) => p.loc.status);
  const l = m.in_loc?.status ?? all[0];
  if (!l) return "nopunch";
  if (all.includes("outside") || l === "outside") return "outside";
  if (l === "denied" || l === "unavailable" || l === "none") return "noloc";
  if (l === "low_accuracy") return "low";
  return "verified";
};
/** a person with a punch management reviews today (outside, or no location) */
const flaggedToday = (m: TeamRow) => !m.loc_exempt && (m.punches ?? []).some((p) => locFlagged(p.loc));
const PAGE = 10;

export function TeamOnShift({ rows, onOpenAttendance, site = null }: {
  rows: TeamRow[] | null;
  onOpenAttendance?: () => void;
  /** the site's name, when a geofence is set */
  site?: string | null;
}) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<"" | TeamState>("");
  const [dept, setDept] = useState("");
  const [locF, setLocF] = useState<LocFilter>("");
  const [shiftF, setShiftF] = useState("");
  const [sort, setSort] = useState<"status" | "name" | "in">("status");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<TeamRow | null>(null);
  const list = useMemo(() => rows ?? [], [rows]);
  const hasShift = list.some((m) => m.shift);
  const counts = useMemo(() => {
    const c = { scheduled: 0, on: 0, notIn: 0, out: 0, exceptions: 0 };
    for (const m of rows ?? []) {
      const st = stateOf(m);
      const sched = m.shift ? m.shift.scheduled && !m.on_leave : true;
      if (sched) c.scheduled++;
      if (st === "on") c.on++;
      if (st === "out") c.out++;
      if (st === "none") c.notIn++;
      if (flaggedToday(m)) c.exceptions++;
    }
    return c;
  }, [rows]);
  const depts = useMemo(() => [...new Set(list.map((m) => (m.department ?? "").trim()).filter(Boolean))].sort(), [list]);
  const patterns = useMemo(() => [...new Set(list.map((m) => m.shift?.pattern ?? "").filter(Boolean))].sort(), [list]);
  const needle = q.trim().toLowerCase();
  const shown = list
    .filter((m) => !f || stateOf(m) === f)
    .filter((m) => !dept || (m.department ?? "").trim() === dept)
    .filter((m) => !locF || locKey(m) === locF)
    .filter((m) => !shiftF || m.shift?.pattern === shiftF)
    .filter((m) => !needle || [m.name, m.role.replace(/_/g, " "), m.position ?? "", m.department ?? "", m.role_title ?? ""].some((x) => x.toLowerCase().includes(needle)))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name)
      : sort === "in" ? (a.in_at ?? "~").localeCompare(b.in_at ?? "~") || a.name.localeCompare(b.name)
      : STATE_RANK[stateOf(a)] - STATE_RANK[stateOf(b)] || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PAGE, at * PAGE + PAGE);
  const reset = () => setPage(0);
  const job = (m: TeamRow) => m.position || m.role_title || m.role.replace(/_/g, " ");
  const FIG: [keyof typeof counts, string, string, "" | TeamState][] = [
    ["scheduled", "Total scheduled", "Jumlah berjadual", ""],
    ["on", "On shift now", "Sedang syif", "on"],
    ["notIn", "Not yet clocked in", "Belum daftar masuk", "none"],
    ["out", "Clocked out", "Daftar keluar", "out"],
    ["exceptions", "Location exceptions", "Pengecualian lokasi", ""],
  ];
  return (
    <section className={`erp-card ${css.card} ${css.team}`} aria-label={L("Team on shift", "Pasukan sedang syif")} data-testid="team-on-shift">
      <div className={css.cardHead}>
        <div className={css.titleBlock}>
          <h3 className={css.cardTitle}><AppIcon name="users" className="erp-icon" />{L("Team On Shift", "Pasukan Sedang Syif")}
            {rows !== null && <span className={css.titleCount}>({counts.on} / {counts.scheduled})</span>}</h3>
          <p className={css.cardSub}>{L("Staff on today's list, their shift and where they punched", "Kakitangan dalam senarai hari ini, syif mereka dan lokasi punch")}{site ? ` · ${L("Work location", "Lokasi kerja")}: ${site}` : ""}</p>
        </div>
        {onOpenAttendance && (
          <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={onOpenAttendance}>
            {L("Open Attendance", "Buka Kehadiran")}
          </button>
        )}
      </div>
      {rows === null ? <SkelRows rows={4} /> : (
        <>
          <div className={css.teamFigures} data-testid="team-figures">
            {FIG.map(([k, en, ms, st]) => {
              const body = (<><span className={css.figValue} data-testid={`team-fig-${k}`}>{counts[k]}</span><span className={css.figLabel}>{L(en, ms)}</span></>);
              return st
                ? <button key={k} type="button" className={css.teamFig} aria-pressed={f === st} onClick={() => { setF(f === st ? "" : st); reset(); }}>{body}</button>
                : k === "exceptions"
                  ? <button key={k} type="button" className={css.teamFig} data-alert={counts.exceptions > 0 ? "" : undefined} aria-pressed={locF === "outside"} onClick={() => { setLocF(locF === "outside" ? "" : "outside"); reset(); }}>{body}</button>
                  : <div key={k} className={css.teamFig}>{body}</div>;
            })}
          </div>
          {!hasShift && <p className={css.hint}>{L("Scheduled counts are shown once the server sends today's shifts.", "Kiraan berjadual dipaparkan selepas pelayan menghantar syif hari ini.")}</p>}
          <div className={css.teamTools}>
            <input type="search" className={inputClass} value={q} onChange={(e) => { setQ(e.target.value); reset(); }}
              placeholder={L("Search staff, position or department", "Cari kakitangan, jawatan atau jabatan")} aria-label={L("Search staff on shift", "Cari kakitangan sedang syif")} />
            <select className={selectClass} value={f} onChange={(e) => { setF(e.target.value as "" | TeamState); reset(); }} aria-label={L("Attendance status", "Status kehadiran")} data-testid="team-status">
              <option value="">{L("All statuses", "Semua status")}</option>
              {(Object.keys(STATE_WORD) as TeamState[]).map((k) => <option key={k} value={k}>{L(STATE_WORD[k][0], STATE_WORD[k][1])}</option>)}
            </select>
            <select className={selectClass} value={locF} onChange={(e) => { setLocF(e.target.value as LocFilter); reset(); }} aria-label={L("Location status", "Status lokasi")} data-testid="team-location">
              <option value="">{L("All locations", "Semua lokasi")}</option>
              <option value="verified">{L("Verified", "Disahkan")}</option>
              <option value="outside">{L("Outside", "Di luar")}</option>
              <option value="low">{L("Low accuracy", "Ketepatan rendah")}</option>
              <option value="noloc">{L("No location", "Tiada lokasi")}</option>
              <option value="nopunch">{L("No punch yet", "Belum punch")}</option>
            </select>
            {depts.length > 0 && (
              <select className={selectClass} value={dept} onChange={(e) => { setDept(e.target.value); reset(); }} aria-label={L("Department", "Jabatan")} data-testid="team-dept">
                <option value="">{L("All departments", "Semua jabatan")}</option>
                {depts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {patterns.length > 1 && (
              <select className={selectClass} value={shiftF} onChange={(e) => { setShiftF(e.target.value); reset(); }} aria-label={L("Shift type", "Jenis syif")} data-testid="team-shift">
                <option value="">{L("All shift types", "Semua jenis syif")}</option>
                {patterns.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <select className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={L("Sort", "Susun")} data-testid="team-sort">
              <option value="status">{L("Sort: status", "Susun: status")}</option>
              <option value="name">{L("Sort: name", "Susun: nama")}</option>
              <option value="in">{L("Sort: clock-in time", "Susun: masa masuk")}</option>
            </select>
          </div>
          {shown.length === 0 ? (
            <p className={css.muted}>{rows.length === 0 ? L("No staff on today's list.", "Tiada kakitangan dalam senarai hari ini.") : L("Nobody matches.", "Tiada yang sepadan.")}</p>
          ) : (
            <>
              <div className={css.teamHead} aria-hidden>
                <span>{L("Staff", "Kakitangan")}</span><span>{L("Shift", "Syif")}</span><span>{L("Work location", "Lokasi kerja")}</span>
                <span>{L("Clock in", "Masuk")}</span><span>{L("Clock out", "Keluar")}</span><span>{L("Status", "Status")}</span><span>{L("Location", "Lokasi")}</span><span />
              </div>
              <ul className={css.teamList}>
                {slice.map((m) => {
                  const st = stateOf(m);
                  return (
                    <li key={m.id}>
                      <button type="button" className={css.teamRow} onClick={() => setOpen(m)} data-testid="team-row"
                        aria-label={L(`${m.name}: ${STATE_WORD[st][0]} - open details`, `${m.name}: ${STATE_WORD[st][1]} - buka butiran`)}>
                        <span className={css.teamWho}>
                          <Avatar name={m.name} size="md" />
                          <span className={css.teamName}><strong>{m.name}</strong><span>{job(m)}{m.department ? ` · ${m.department}` : ""}</span></span>
                        </span>
                        <span className={css.teamCell} data-label={L("Shift", "Syif")}>{m.shift?.label ?? (m.shift ? L("No shift", "Tiada syif") : "—")}</span>
                        <span className={css.teamCell} data-label={L("Work location", "Lokasi kerja")}>{site ?? "—"}</span>
                        <span className={css.teamCell} data-label={L("Clock in", "Masuk")}>{m.in_at ? mytHm(m.in_at) : "—"}{(m.shifts ?? 0) > 1 && <span className={css.muted}> · {m.shifts}×</span>}</span>
                        <span className={css.teamCell} data-label={L("Clock out", "Keluar")}>{m.out_at ? mytHm(m.out_at) : "—"}</span>
                        <span className={STATE_CHIP[st]}>{L(STATE_WORD[st][0], STATE_WORD[st][1])}</span>
                        <span className={css.teamLoc}>{m.in_loc || (m.punches ?? []).length ? <LocChip loc={m.in_loc ?? m.punches?.[0]?.loc ?? null} exempt={!!m.loc_exempt} small /> : <span className={css.muted}>—</span>}</span>
                        <span className={css.teamChevron} aria-hidden><AppIcon name="next" /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {pages > 1 && (
                <div className={css.pager}>
                  <span className={css.muted}>{L(`Showing ${at * PAGE + 1}–${Math.min(shown.length, at * PAGE + PAGE)} of ${shown.length}`, `Menunjukkan ${at * PAGE + 1}–${Math.min(shown.length, at * PAGE + PAGE)} daripada ${shown.length}`)}</span>
                  <button type="button" className="erp-button erp-button-ghost erp-button-compact" disabled={at === 0} onClick={() => setPage(at - 1)}>{L("Previous", "Sebelum")}</button>
                  <button type="button" className="erp-button erp-button-ghost erp-button-compact" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>{L("Next", "Seterusnya")}</button>
                </div>
              )}
            </>
          )}
        </>
      )}
      <SideDrawer open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""}
        subtitle={open ? `${job(open)}${open.department ? ` · ${open.department}` : ""}` : undefined}
        footer={onOpenAttendance ? (
          <button type="button" className="erp-button erp-button-primary" onClick={() => { setOpen(null); onOpenAttendance(); }}>
            {L("Open Attendance to correct a record", "Buka Kehadiran untuk membetulkan rekod")}
          </button>
        ) : undefined}>
        {open && <TeamDetail m={open} site={site} />}
      </SideDrawer>
    </section>
  );
}

function TeamDetail({ m, site }: { m: TeamRow; site: string | null }) {
  const st = stateOf(m);
  const punches = m.punches ?? [];
  const flagged = punches.filter((p) => !m.loc_exempt && locFlagged(p.loc));
  return (
    <div className={css.detail} data-testid="team-detail">
      <div className={css.detailWho}>
        <Avatar name={m.name} size="lg" />
        <span className={STATE_CHIP[st]}>{L(STATE_WORD[st][0], STATE_WORD[st][1])}</span>
      </div>
      <dl className={css.detailFacts}>
        <div><dt>{L("Today's shift", "Syif hari ini")}</dt><dd>{m.shift?.label ?? (m.on_leave ? L("On approved leave", "Cuti diluluskan") : m.holiday ? L("Public holiday", "Cuti umum") : L("Not scheduled", "Tiada jadual"))}{m.shift?.pattern ? ` · ${m.shift.pattern}` : ""}</dd></div>
        <div><dt>{L("Work location", "Lokasi kerja")}</dt><dd>{site ?? L("No site boundary set", "Tiada sempadan tapak")}</dd></div>
        <div><dt>{L("Role", "Peranan")}</dt><dd>{m.role.replace(/_/g, " ")}{m.loc_exempt ? ` · ${L("not flagged for location", "tidak ditanda untuk lokasi")}` : ""}</dd></div>
      </dl>
      <h4 className={css.subHead}>{L("Attendance timeline", "Garis masa kehadiran")}</h4>
      {punches.length === 0 ? <p className={css.muted}>{L("No punch today.", "Tiada punch hari ini.")}</p> : (
        <ol className={css.timeline}>
          {punches.map((p) => (
            <li key={`${p.type}-${p.at}`} className={css.timelineRow} data-testid="team-punch">
              <span className={css.inTime}>{mytHm(p.at)}</span>
              <span className={css.timelineWhat}>
                <strong>{p.type === "clock_out" ? L("Clock out", "Daftar keluar") : L("Clock in", "Daftar masuk")}</strong>
                <span className={css.muted}>
                  {locWord(p.loc, !!m.loc_exempt).long}
                  {p.loc.accuracy_m !== null && ` · ${L("accuracy", "ketepatan")} ±${p.loc.accuracy_m} m`}
                </span>
              </span>
              {p.pending ? <span className={chipSmWarn}>{L("Awaiting approval", "Menunggu kelulusan")}</span> : <LocChip loc={p.loc} exempt={!!m.loc_exempt} small />}
            </li>
          ))}
        </ol>
      )}
      <h4 className={css.subHead}>{L("Location exceptions", "Pengecualian lokasi")}</h4>
      <p className={css.muted}>
        {flagged.length === 0 ? L("None today.", "Tiada hari ini.")
          : L(`${flagged.length} punch${flagged.length > 1 ? "es" : ""} today ${flagged.length > 1 ? "are" : "is"} outside the site boundary or without a location. They are recorded, not refused.`,
              `${flagged.length} punch hari ini di luar sempadan tapak atau tanpa lokasi. Ia direkod, bukan ditolak.`)}
      </p>
      <p className={css.hint}>{L("Distances only - exact positions are not shown here. Corrections go through Attendance, under its own approval rules.", "Jarak sahaja - kedudukan tepat tidak dipaparkan di sini. Pembetulan melalui Kehadiran, di bawah peraturan kelulusannya.")}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* this week (the roster's own route, own rows only)                    */
/* ------------------------------------------------------------------ */

interface RosterLite {
  days?: string[];
  sessions?: { id: number; session_date: string; start_time: string; end_time: string | null; platform: string; status: string; host_user_id: number; client?: string | null }[];
  task_blocks?: { id: number; user_id: number; block_date: string; start_time: string; end_time: string | null; title?: string | null; done_at?: string | null }[];
}

/* v1.294.0 (On Shift v2.0, section 10) - THE WEEK, CONSOLIDATED. One card
   for what used to be "This week" (the roster's own rows) and the week's
   attendance: seven days, each with the SERVER'S verdict for it (the month
   classifier the Attendance module and payroll use, myMonthDays) and the
   person's own roster rows. The counts are counts of those verdicts and of
   the shared pairing rule's sessions - nothing is classified here. Picking a
   day opens its detail below the timeline. */
export function WeekSchedule({ userId, onOpenRoster, days: verdicts = null, records = [], statusLabel, onOpenAttendance, known = true }: {
  userId: number;
  onOpenRoster?: () => void;
  /** the month verdicts covering this week (the current month, plus the
      previous one when the week began in it); null = not read */
  days?: MonthDay[] | null;
  records?: AttRecord[];
  statusLabel?: (s: MonthDay["status"]) => string;
  onOpenAttendance?: () => void;
  known?: boolean;
}) {
  const roster = useCachedApi<RosterLite>("/staff/roster", true, ["live-sessions", "task-blocks"]);
  const today = mytToday();
  const [pick, setPick] = useState<string | null>(null);
  /* this week in Malaysia, Monday to Sunday - the roster rows are matched to it by date */
  const days = (() => {
    const t = new Date(`${today}T00:00:00Z`);
    const mon = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000);
    return Array.from({ length: 7 }, (_, i) => new Date(mon.getTime() + i * 86400000).toISOString().slice(0, 10));
  })();
  const items = (d: string) => [
    ...(roster.data?.sessions ?? []).filter((s) => s.host_user_id === userId && s.session_date === d && s.status !== "cancelled")
      .map((s) => ({ key: `s${s.id}`, start: s.start_time, end: s.end_time, what: `${L("Live", "Live")} · ${s.platform}${s.client ? ` · ${s.client}` : ""}` })),
    ...(roster.data?.task_blocks ?? []).filter((b) => b.user_id === userId && b.block_date === d)
      .map((b) => ({ key: `b${b.id}`, start: b.start_time, end: b.end_time, what: b.title ?? L("Task", "Tugasan") })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const verdict = new Map((verdicts ?? []).map((d) => [d.date, d]));
  const paired = new Map(daysOf(records).map((d) => [d.date, d]));
  const pendingDays = new Set(records.filter((r) => r.pending).map((r) => mytDay(r.created_at)));
  const past = days.filter((d) => d <= today);
  const vs = past.map((d) => verdict.get(d)).filter((v): v is MonthDay => !!v);
  const count = {
    scheduled: vs.filter((v) => v.scheduled).length,
    attended: vs.filter((v) => v.worked).length,
    completed: past.reduce((n, d) => n + (paired.get(d)?.sessions.filter((x) => x.out).length ?? 0), 0),
    late: vs.filter((v) => v.status === "late" || v.status === "half_day").length,
    missing: vs.filter((v) => v.open && v.date < today).length,
    leave: vs.filter((v) => v.status === "leave").length,
    pending: new Set([...vs.filter((v) => v.status === "awaiting_approval").map((v) => v.date), ...past.filter((d) => pendingDays.has(d))]).size,
  };
  const FIG: [keyof typeof count, string, string][] = [
    ["scheduled", "Scheduled", "Berjadual"], ["attended", "Attended", "Hadir"], ["completed", "Completed shifts", "Syif selesai"],
    ["late", "Late", "Lewat"], ["missing", "Missing punch", "Punch tertinggal"], ["leave", "Approved leave", "Cuti diluluskan"],
    ["pending", "Pending corrections", "Pembetulan menunggu"],
  ];
  const word = (v: MonthDay | undefined, d: string) =>
    d > today ? L("Upcoming", "Akan datang") : !v ? "—" : v.open && d < today ? L("Missing punch", "Punch tertinggal") : statusLabel ? statusLabel(v.status) : v.status;
  const tone = (v: MonthDay | undefined, d: string) =>
    d > today || !v ? chipSmNeutral : v.open && d < today ? chipSmWarn
      : v.status === "ok" || v.status === "assigned" ? chipSmSuccess
      : v.status === "late" || v.status === "half_day" || v.status === "absent" || v.status === "awaiting_approval" ? chipSmWarn
      : v.status === "leave" || v.status === "holiday" || v.status === "pending" ? chipSmInfo : chipSmNeutral;
  const sel = pick && days.includes(pick) ? pick : null;
  const selV = sel ? verdict.get(sel) : undefined;
  const selP = sel ? paired.get(sel) : undefined;
  return (
    <section className={`erp-card ${css.card}`} aria-label={L("This week", "Minggu ini")} data-testid="week-summary">
      <div className={css.cardHead}>
        <div className={css.titleBlock}>
          <h3 className={css.cardTitle}><AppIcon name="date" className="erp-icon" />{L("This Week", "Minggu Ini")}</h3>
          <p className={css.cardSub}>{L("Your attendance this week, as the Attendance module records it", "Kehadiran anda minggu ini, seperti yang direkod modul Kehadiran")}</p>
        </div>
        {onOpenRoster && (
          <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={onOpenRoster}>{L("Open roster", "Buka roster")}</button>
        )}
      </div>
      {!known || roster.loading ? <SkelRows rows={4} /> : (
        <>
          <dl className={css.weekFigures}>
            {FIG.map(([k, en, ms]) => (
              <div key={k} className={css.weekFig} data-alert={(k === "late" || k === "missing" || k === "pending") && count[k] > 0 ? "" : undefined}>
                <dt>{L(en, ms)}</dt><dd data-testid={`week-${k}`}>{verdicts ? count[k] : "—"}</dd>
              </div>
            ))}
          </dl>
          {roster.failed && !roster.data && <p className={css.hint}>{L("The roster could not be loaded; the days below show your attendance only.", "Roster tidak dapat dimuatkan; hari di bawah hanya menunjukkan kehadiran anda.")}</p>}
          <ul className={css.week} aria-label={L("Days of this week", "Hari minggu ini")}>
            {days.map((d) => {
              const list = items(d);
              const v = verdict.get(d);
              return (
                <li key={d}>
                  <button type="button" className={css.weekDay} data-today={d === today ? "" : undefined} aria-pressed={sel === d}
                    onClick={() => setPick(sel === d ? null : d)} data-testid="week-day">
                    <span className={css.weekDate}>
                      <strong>{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" })}</strong>
                      <span>{dmy(d).slice(0, 5)}</span>
                    </span>
                    <span className={tone(v, d)}>{word(v, d)}</span>
                    {list.length > 0 && (
                      <span className={css.weekItems}>
                        {list.map((x) => (
                          <span key={x.key} className={css.weekItem}><span className={css.slotTime}>{x.start}{x.end ? `–${x.end}` : ""}</span> {x.what}</span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {sel && (
            <div className={css.weekDetail} data-testid="week-detail" role="region" aria-label={L(`Attendance on ${dmy(sel)}`, `Kehadiran pada ${dmy(sel)}`)}>
              <dl className={css.weekDetailGrid}>
                <div><dt>{L("Date", "Tarikh")}</dt><dd>{dmy(sel)}</dd></div>
                <div><dt>{L("Status", "Status")}</dt><dd>{word(selV, sel)}</dd></div>
                <div><dt>{L("Clock in", "Masuk")}</dt><dd>{selV?.in ?? "—"}</dd></div>
                <div><dt>{L("Clock out", "Keluar")}</dt><dd>{selV?.out ?? (selV?.open ? L("Not recorded", "Tidak direkod") : "—")}</dd></div>
                <div><dt>{L("Worked", "Bekerja")}</dt><dd>{selP && selP.minutes > 0 ? hoursLabel(selP.minutes) : "—"}</dd></div>
                <div><dt>{L("Shifts", "Syif")}</dt><dd>{selP ? selP.sessions.length : 0}</dd></div>
              </dl>
              {onOpenAttendance && (
                <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={onOpenAttendance}>
                  {L("Open in Attendance", "Buka dalam Kehadiran")}<AppIcon name="next" />
                </button>
              )}
            </div>
          )}
          {verdicts && past.length > 0 && count.attended === 0 && (
            <p className={css.hint}>{L("No attendance recorded yet this week.", "Belum ada kehadiran direkod minggu ini.")}</p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* recent days                                                         */
/* ------------------------------------------------------------------ */

/* v1.294.0 (On Shift v2.0, section 11) - the five most recent days, with
   the location outcome of the day's first clock-in; View Full History opens
   the Attendance module, where every record stays. */
export function RecentDays({ records, days, known, statusLabel, onOpenAttendance, exempt = false }: {
  records: AttRecord[];
  days: MonthDay[] | null;
  known: boolean;
  statusLabel: (s: MonthDay["status"]) => string;
  onOpenAttendance?: () => void;
  exempt?: boolean;
}) {
  const paired = daysOf(records);
  const verdict = new Map((days ?? []).map((d) => [d.date, d]));
  const firstIn = new Map<string, AttRecord>();
  for (const r of records) if (r.type === "clock_in") firstIn.set(mytDay(r.created_at), r); // newest first: the last written is the day's first
  const recent = paired.slice(0, 5);
  return (
    <section className={`erp-card ${css.card}`} aria-label={L("Recent attendance", "Kehadiran terkini")} data-testid="recent-attendance">
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}><AppIcon name="time" className="erp-icon" />{L("Recent Attendance", "Kehadiran Terkini")}</h3>
        {onOpenAttendance && (
          <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={onOpenAttendance}>{L("View full history", "Lihat sejarah penuh")}<AppIcon name="next" /></button>
        )}
      </div>
      {!known ? <SkelRows rows={4} /> : recent.length === 0 ? (
        <p className={css.muted}>{L("No punches yet this month.", "Belum ada punch bulan ini.")}</p>
      ) : (
        <ul className={css.history}>
          {recent.map((d) => {
            const v = verdict.get(d.date);
            const first = d.sessions[0];
            const last = d.sessions[d.sessions.length - 1];
            const good = v && (v.status === "ok" || v.status === "assigned");
            const warn = v && (v.status === "late" || v.status === "half_day" || v.status === "absent" || v.status === "awaiting_approval");
            const fi = firstIn.get(d.date);
            return (
              <li key={d.date} className={css.historyRow} data-testid="recent-row">
                <span className={css.historyDate}>{dmy(d.date)}</span>
                <span className={css.historyTimes}>
                  {first ? mytHm(first.in) : "—"} → {last?.out ? mytHm(last.out) : d.open ? L("open", "terbuka") : "—"}
                  {d.sessions.length > 1 && <span className={css.muted}> · {d.sessions.length} {L("shifts", "syif")}</span>}
                </span>
                <span className={css.historyHours}>{d.minutes > 0 ? hoursLabel(d.minutes) : "—"}</span>
                <span className={css.historyLoc}>{fi?.loc ? <LocChip loc={fi.loc} exempt={exempt} small /> : <span className={css.muted}>—</span>}</span>
                {v ? <span className={good ? chipSmSuccess : warn ? chipSmWarn : chipSmNeutral}>{statusLabel(v.status)}</span> : <span />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* punches kept on this device                                         */
/* ------------------------------------------------------------------ */

export interface WaitingPunch { id: string; type: string; clientAt: string; state: "queued" | "sending" | "held_signin" | "needs_hr"; reason: string | null }

/** The punches this device is holding because it had no signal. They are NOT
    records: the server has not seen them. `onDrained` fires when the list
    shrinks (one reached the server), so the day can be read again. */
export function usePunchesWaiting(onDrained: () => void): WaitingPunch[] {
  const [list, setList] = useState<WaitingPunch[]>([]);
  useEffect(() => {
    let alive = true;
    let last = -1;
    const read = () => {
      void outboxAll().then((all) => {
        if (!alive) return;
        const punches = all.filter((e) => e.kind === "punch").map((e) => {
          let type = "";
          try { type = String((JSON.parse(e.body ?? "{}") as { type?: unknown }).type ?? ""); } catch { /* unreadable body: still waiting */ }
          return { id: e.id, type, clientAt: e.clientAt, state: e.state ?? "queued", reason: e.reason ?? null };
        });
        if (last > punches.length) onDrained();
        last = punches.length;
        setList(punches);
      });
    };
    read();
    const unsub = subscribeOutbox(read);
    return () => { alive = false; unsub(); };
  }, [onDrained]);
  return list;
}

/* v1.243.0 (go-live audit F3) - the queue, by STATE: queued / sending (a
   signal away), held for sign-in (the session expired; sent again after the
   next sign-in, same pressed time), needs HR (refused, or older than the
   server's 48-hour window: shown with its pressed time and the reason until
   the person says HR has it). Nothing here is called recorded. */
export function WaitingPunches({ list }: { list: WaitingPunch[] }) {
  if (list.length === 0) return null;
  const when = (p: WaitingPunch) => `${p.type === "clock_out" ? L("Clock out", "Daftar keluar") : L("Clock in", "Daftar masuk")} ${L("pressed", "ditekan")} ${new Date(Date.parse(p.clientAt) + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ")}`;
  const queued = list.filter((p) => p.state === "queued" || p.state === "sending");
  const held = list.filter((p) => p.state === "held_signin");
  const hr = list.filter((p) => p.state === "needs_hr");
  return (
    <div className={css.waiting} role="status" data-testid="waiting-punches">
      <AppIcon name="warning" className="erp-icon" />
      <div>
        {queued.length > 0 && (
          <>
            <p className={css.waitingTitle}>
              {queued.length === 1 ? L("1 punch waiting on this phone - not confirmed", "1 punch menunggu pada telefon ini - belum disahkan")
                : L(`${queued.length} punches waiting on this phone - not confirmed`, `${queued.length} punch menunggu pada telefon ini - belum disahkan`)}
            </p>
            <p className={css.waitingSub}>
              {queued.map(when).join(" · ")}
              {" - "}
              {L("the server has not received it yet. It is sent when you are back online and goes to the CEO to approve. Your status above changes only when the server confirms it.",
                 "pelayan belum menerimanya. Ia dihantar apabila anda kembali dalam talian dan dihantar kepada CEO untuk kelulusan. Status anda di atas hanya berubah apabila pelayan mengesahkannya.")}
            </p>
          </>
        )}
        {held.length > 0 && (
          <>
            <p className={css.waitingTitle} data-testid="held-signin">
              {held.length === 1 ? L("Sign in to send 1 waiting punch", "Log masuk untuk menghantar 1 punch menunggu") : L(`Sign in to send ${held.length} waiting punches`, `Log masuk untuk menghantar ${held.length} punch menunggu`)}
            </p>
            <p className={css.waitingSub}>
              {held.map(when).join(" · ")}
              {" - "}
              {L("your session had expired when the phone tried to send it. It is kept with the time you pressed it and is sent the moment you sign in again.",
                 "sesi anda telah tamat apabila telefon cuba menghantarnya. Ia disimpan dengan masa anda menekannya dan dihantar sebaik sahaja anda log masuk semula.")}
            </p>
          </>
        )}
        {hr.map((p) => (
          <div key={p.id} data-testid="needs-hr">
            <p className={css.waitingTitle}>{L("Tell HR: a punch could not be sent", "Beritahu HR: satu punch tidak dapat dihantar")}</p>
            <p className={css.waitingSub}>
              {when(p)}{p.reason ? ` - ${p.reason}` : ""}. {L("HR can enter it by hand at that time; it is kept here until you say HR has it.", "HR boleh memasukkannya secara manual pada masa itu; ia disimpan di sini sehingga anda kata HR telah menerimanya.")}
              {" "}
              <button type="button" className={css.waitingLink} onClick={() => void dismissNeedsHr(p.id)}>{L("HR has it", "HR telah terima")}</button>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export const chipForState = (s: ShiftState): string => (s === "open" ? chipSuccess : s === "done" ? chipNeutral : s === "idle" ? chipWarn : chipInfo);

/* ------------------------------------------------------------------ */
/* v1.229.0 - TODAY'S SHIFT, the Dashboard's read-only summary          */
/* ------------------------------------------------------------------ */

/* The owner's brief, 30-10-2026 ("ONE FUNCTION. ONE OWNER. MULTIPLE
   READ-ONLY SUMMARY VIEWS") and his answer "Yes, summary only": the
   Dashboard no longer draws a clock or a punch button. It shows where the
   day stands - from the SAME state On Shift reads (the Dashboard component's
   one load(): today's punches, today-shift, the month's day statuses, the
   outbox) - and one button to On Shift, where the punch is. Nothing here
   computes a figure of its own: hours are the shared pairing rule
   (sessionMinutes), the state is the server's, a day status is the
   server's word for the day. Nothing is invented for a day with no shift. */
export type TodayShiftKind = "loading" | "error" | "waiting" | "review" | "open" | "between" | "done" | "leave" | "holiday" | "rest" | "idle";

export function todayShiftKind(p: {
  known: boolean; error: boolean; waiting: number; state: ShiftState; canClockIn: boolean;
  dayStatus: MonthDay["status"] | null; leaveReview: boolean; hasSlots: boolean;
}): TodayShiftKind {
  if (!p.known) return p.error ? "error" : "loading";
  if (p.waiting > 0) return "waiting";
  if (p.leaveReview || p.dayStatus === "awaiting_approval") return "review";
  if (p.state === "open") return "open";
  if (p.state === "done") return p.canClockIn ? "between" : "done";
  if (p.dayStatus === "leave") return "leave";
  if (p.dayStatus === "holiday") return "holiday";
  if (!p.hasSlots || p.dayStatus === "rest_day") return "rest";
  return "idle";
}

export function TodayShiftCard({ kind, firstIn, lastOut, openSince, workedMinutes, scheduled, onOpen }: {
  kind: TodayShiftKind;
  firstIn: string | null;
  lastOut: string | null;
  /** the server's open clock-in (UTC, as stored), while on shift */
  openSince: string | null;
  /** today's closed sessions, minutes (the shared pairing rule) */
  workedMinutes: number;
  /** today's scheduled shifts as the server labels them ("09:00-17:00") */
  scheduled: string | null;
  onOpen: () => void;
}) {
  const now = useTick(kind === "open" && !!openSince, 30000);
  const running = kind === "open" && openSince ? Math.max(0, Math.floor((now - utcMs(openSince)) / 60000)) : 0;
  const CHIP: Record<TodayShiftKind, [string, string, string]> = {
    loading: ["", "", chipNeutral], error: ["Not loaded", "Tidak dimuatkan", chipWarn],
    waiting: ["Not confirmed", "Belum disahkan", chipWarn], review: ["Needs review", "Perlu semakan", chipWarn],
    open: ["On shift", "Sedang syif", chipSuccess], between: ["Between shifts", "Antara syif", chipInfo],
    done: ["Completed", "Selesai", chipSuccess], leave: ["On leave", "Bercuti", chipInfo],
    holiday: ["Public holiday", "Cuti umum", chipInfo], rest: ["No shift today", "Tiada syif hari ini", chipNeutral],
    idle: ["Not started", "Belum bermula", chipWarn],
  };
  const NOTE: Partial<Record<TodayShiftKind, [string, string]>> = {
    error: ["Your day could not be loaded. Open On Shift to retry.", "Hari anda tidak dapat dimuatkan. Buka Syif Saya untuk cuba lagi."],
    waiting: ["A punch is waiting on this phone for a signal - it counts once the server confirms it.", "Satu punch menunggu isyarat pada telefon ini - ia dikira selepas pelayan mengesahkannya."],
    review: ["Today's attendance is waiting for management review.", "Kehadiran hari ini menunggu semakan pengurusan."],
    leave: ["Approved leave - nothing to clock today.", "Cuti diluluskan - tiada apa perlu didaftar hari ini."],
    holiday: ["Public holiday on your working pattern.", "Cuti umum pada corak kerja anda."],
    rest: ["Nothing is scheduled for you today.", "Tiada apa dijadualkan untuk anda hari ini."],
  };
  const showTimes = ["open", "between", "done", "review", "waiting"].includes(kind) && !!firstIn;
  return (
    <section className={css.ts} aria-label={L("Today's shift", "Syif hari ini")}>
      <div className={css.tsHead}>
        <span className={css.tsIcon} aria-hidden><AppIcon name="time" /></span>
        <h3 className={css.tsTitle}>{L("Today's Shift", "Syif Hari Ini")}</h3>
        {kind !== "loading" && <span className={CHIP[kind][2]} role="status">{L(CHIP[kind][0], CHIP[kind][1])}</span>}
      </div>
      {kind === "loading" ? <SkelRows rows={2} /> : showTimes ? (
        <dl className={css.tsGrid}>
          <div className={css.tsCell}><dt>{L("Clock in", "Masuk")}</dt><dd>{firstIn}</dd></div>
          <div className={css.tsCell}><dt>{L("Clock out", "Keluar")}</dt><dd>{kind === "open" ? "—" : lastOut ?? "—"}</dd></div>
          <div className={css.tsCell}><dt>{kind === "open" ? L("On shift for", "Sedang syif") : L("Worked", "Bekerja")}</dt>
            <dd>{hoursLabel(kind === "open" ? workedMinutes + running : workedMinutes)}</dd></div>
        </dl>
      ) : kind === "idle" ? (
        <dl className={css.tsGrid}>
          <div className={`${css.tsCell} ${css.tsWide}`}><dt>{L("Scheduled", "Dijadualkan")}</dt><dd>{scheduled ?? "—"}</dd></div>
        </dl>
      ) : null}
      {NOTE[kind] && <p className={css.tsNote}>{L(NOTE[kind]![0], NOTE[kind]![1])}</p>}
      <button type="button" className={css.tsBtn} onClick={onOpen}>
        {kind === "idle" || kind === "between" ? L("Open On Shift to clock in", "Buka Syif Saya untuk daftar masuk")
          : kind === "open" ? L("Open On Shift", "Buka Syif Saya") : L("View On Shift", "Lihat Syif Saya")}
        <AppIcon name="next" />
      </button>
    </section>
  );
}
