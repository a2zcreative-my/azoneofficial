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
import { L, type MonthDay } from "@/components/portal/page-shared";
import type { MonitorRow } from "@/components/portal/dashboard-overview";
import { useCachedApi } from "@/lib/cached-api";
import { daysOf, hoursLabel, mytDay, pairSessions, type Session } from "@/lib/clock-sessions";
import { dmy, mytToday } from "@/lib/format";
import { outboxAll, subscribeOutbox } from "@/lib/outbox";
import { chipInfo, chipNeutral, chipSmNeutral, chipSmSuccess, chipSmWarn, chipSuccess, chipWarn, inputClass, selectClass } from "@/lib/ui-styles";
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

export function SessionRows({ sessions, known }: { sessions: Session[]; known: boolean }) {
  if (!known) return <SkelRows rows={2} />;
  if (sessions.length === 0) {
    return <p className={css.muted}>{L("No punches recorded today.", "Tiada punch direkodkan hari ini.")}</p>;
  }
  return (
    <ol className={css.sessions} aria-label={L("Today's punches", "Punch hari ini")}>
      {sessions.map((s, i) => (
        <li key={s.in} className={css.session}>
          <span className={css.sessionNo}>{L(`Shift ${i + 1}`, `Syif ${i + 1}`)}</span>
          <span className={css.sessionTimes}>
            <span className={css.inTime}>{mytHm(s.in)}</span>
            <span aria-hidden className={css.arrow}>→</span>
            {s.out ? <span>{mytHm(s.out)}</span> : <span className={chipSmSuccess}>{L("open", "terbuka")}</span>}
          </span>
          <span className={css.sessionLen}>{s.out ? hoursLabel(s.minutes) : L("running", "berjalan")}</span>
        </li>
      ))}
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

type TeamFilter = "" | "on" | "out" | "none";
const stateOf = (m: MonitorRow): Exclude<TeamFilter, ""> =>
  m.last_type === "clock_in" ? "on" : m.out_at || m.last_type === "clock_out" ? "out" : "none";

export function TeamOnShift({ rows, onOpenAttendance }: { rows: MonitorRow[] | null; onOpenAttendance?: () => void }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<TeamFilter>("");
  const counts = useMemo(() => {
    const c = { on: 0, out: 0, none: 0 };
    for (const m of rows ?? []) c[stateOf(m)]++;
    return c;
  }, [rows]);
  const needle = q.trim().toLowerCase();
  const shown = (rows ?? [])
    .filter((m) => !f || stateOf(m) === f)
    .filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.role.replace(/_/g, " ").includes(needle));
  return (
    <section className={`erp-card ${css.card} ${css.team}`} aria-label={L("Team on shift", "Pasukan sedang syif")}>
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}><AppIcon name="users" className="erp-icon" />{L("Team On Shift", "Pasukan Sedang Syif")}</h3>
        {onOpenAttendance && (
          <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={onOpenAttendance}>
            {L("Open Attendance", "Buka Kehadiran")}
          </button>
        )}
      </div>
      {rows === null ? <SkelRows rows={4} /> : (
        <>
          <p className={css.teamRatio}>
            <strong>{counts.on}</strong><span>/ {rows.length}</span>
            <em>{L("on shift now", "sedang syif")} · {counts.out} {L("clocked out", "daftar keluar")} · {counts.none} {L("not in yet", "belum masuk")}</em>
          </p>
          <div className={css.teamTools}>
            <input type="search" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={L("Find a person or role", "Cari orang atau peranan")} aria-label={L("Find a person on shift", "Cari orang sedang syif")} />
            <select className={selectClass} value={f} onChange={(e) => setF(e.target.value as TeamFilter)} aria-label={L("Shift status", "Status syif")}>
              <option value="">{L("Everyone", "Semua")}</option>
              <option value="on">{L("On shift", "Sedang syif")}</option>
              <option value="out">{L("Clocked out", "Daftar keluar")}</option>
              <option value="none">{L("Not in yet", "Belum masuk")}</option>
            </select>
          </div>
          {shown.length === 0 ? (
            <p className={css.muted}>{rows.length === 0 ? L("No staff on today's list.", "Tiada kakitangan dalam senarai hari ini.") : L("Nobody matches.", "Tiada yang sepadan.")}</p>
          ) : (
            <ul className={css.teamList}>
              {shown.map((m) => {
                const st = stateOf(m);
                return (
                  <li key={m.id} className={css.teamRow}>
                    <Avatar name={m.name} size="md" />
                    <span className={css.teamWho}><strong>{m.name}</strong><span>{m.role.replace(/_/g, " ")}</span></span>
                    <span className={st === "on" ? chipSuccess : st === "out" ? chipNeutral : chipWarn}>
                      {st === "on" ? L("On shift", "Sedang syif") : st === "out" ? L("Clocked out", "Daftar keluar") : L("Not in yet", "Belum masuk")}
                    </span>
                    <span className={css.teamTimes}>
                      {m.in_at ? <span>{L("in", "masuk")} {mytHm(m.in_at)}</span> : <span className={css.muted}>—</span>}
                      {m.out_at && <span>{L("out", "keluar")} {mytHm(m.out_at)}</span>}
                      {(m.shifts ?? 0) > 1 && <span>{m.shifts} {L("shifts", "syif")}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
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

export function WeekSchedule({ userId, onOpenRoster }: { userId: number; onOpenRoster?: () => void }) {
  const roster = useCachedApi<RosterLite>("/staff/roster", true, ["live-sessions", "task-blocks"]);
  const today = mytToday();
  const days = roster.data?.days ?? [];
  const items = (d: string) => [
    ...(roster.data?.sessions ?? []).filter((s) => s.host_user_id === userId && s.session_date === d && s.status !== "cancelled")
      .map((s) => ({ key: `s${s.id}`, start: s.start_time, end: s.end_time, what: `${L("Live", "Live")} · ${s.platform}${s.client ? ` · ${s.client}` : ""}` })),
    ...(roster.data?.task_blocks ?? []).filter((b) => b.user_id === userId && b.block_date === d)
      .map((b) => ({ key: `b${b.id}`, start: b.start_time, end: b.end_time, what: b.title ?? L("Task", "Tugasan") })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <section className={`erp-card ${css.card}`} aria-label={L("My roster this week", "Roster saya minggu ini")}>
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}><AppIcon name="date" className="erp-icon" />{L("This week", "Minggu ini")}</h3>
        {onOpenRoster && (
          <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={onOpenRoster}>{L("Open roster", "Buka roster")}</button>
        )}
      </div>
      <p className={css.hint}>{L("Roster assignments and live sessions. Your working pattern applies on the other days.", "Tugasan roster dan sesi live. Corak kerja anda terpakai pada hari lain.")}</p>
      {roster.loading ? <SkelRows rows={4} /> : roster.failed && !roster.data ? (
        <p className={css.muted}>{L("The roster could not be loaded.", "Roster tidak dapat dimuatkan.")}</p>
      ) : (
        <ul className={css.week}>
          {days.map((d) => {
            const list = items(d);
            return (
              <li key={d} className={css.weekDay} data-today={d === today ? "" : undefined}>
                <span className={css.weekDate}>
                  <strong>{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" })}</strong>
                  <span>{dmy(d).slice(0, 5)}</span>
                </span>
                {list.length === 0 ? <span className={css.muted}>—</span> : (
                  <span className={css.weekItems}>
                    {list.map((x) => (
                      <span key={x.key} className={css.weekItem}><span className={css.slotTime}>{x.start}{x.end ? `–${x.end}` : ""}</span> {x.what}</span>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* recent days                                                         */
/* ------------------------------------------------------------------ */

export function RecentDays({ records, days, known, statusLabel, onOpenAttendance }: {
  records: { type: string; created_at: string }[];
  days: MonthDay[] | null;
  known: boolean;
  statusLabel: (s: MonthDay["status"]) => string;
  onOpenAttendance?: () => void;
}) {
  const paired = daysOf(records);
  const verdict = new Map((days ?? []).map((d) => [d.date, d]));
  const recent = paired.slice(0, 7);
  return (
    <section className={`erp-card ${css.card}`} aria-label={L("Recent days", "Hari terkini")}>
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}><AppIcon name="time" className="erp-icon" />{L("Recent days", "Hari terkini")}</h3>
        {onOpenAttendance && (
          <button type="button" className="erp-button erp-button-ghost erp-button-compact" onClick={onOpenAttendance}>{L("Full history", "Sejarah penuh")}</button>
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
            return (
              <li key={d.date} className={css.historyRow}>
                <span className={css.historyDate}>{dmy(d.date)}</span>
                <span className={css.historyTimes}>
                  {first ? mytHm(first.in) : "—"} → {last?.out ? mytHm(last.out) : d.open ? L("open", "terbuka") : "—"}
                  {d.sessions.length > 1 && <span className={css.muted}> · {d.sessions.length} {L("shifts", "syif")}</span>}
                </span>
                <span className={css.historyHours}>{d.minutes > 0 ? hoursLabel(d.minutes) : "—"}</span>
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

export interface WaitingPunch { id: string; type: string; clientAt: string }

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
          return { id: e.id, type, clientAt: e.clientAt };
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

export function WaitingPunches({ list }: { list: WaitingPunch[] }) {
  if (list.length === 0) return null;
  return (
    <div className={css.waiting} role="status">
      <AppIcon name="warning" className="erp-icon" />
      <div>
        <p className={css.waitingTitle}>
          {list.length === 1 ? L("1 punch waiting on this phone - not confirmed", "1 punch menunggu pada telefon ini - belum disahkan")
            : L(`${list.length} punches waiting on this phone - not confirmed`, `${list.length} punch menunggu pada telefon ini - belum disahkan`)}
        </p>
        <p className={css.waitingSub}>
          {list.map((p) => `${p.type === "clock_out" ? L("Clock out", "Daftar keluar") : L("Clock in", "Daftar masuk")} ${L("pressed", "ditekan")} ${new Date(Date.parse(p.clientAt) + 8 * 3600 * 1000).toISOString().slice(11, 16)}`).join(" · ")}
          {" - "}
          {L("the server has not received it yet. It is sent when you are back online and goes to the CEO to approve. Your status above changes only when the server confirms it.",
             "pelayan belum menerimanya. Ia dihantar apabila anda kembali dalam talian dan dihantar kepada CEO untuk kelulusan. Status anda di atas hanya berubah apabila pelayan mengesahkannya.")}
        </p>
      </div>
    </div>
  );
}

export const chipForState = (s: ShiftState): string => (s === "open" ? chipSuccess : s === "done" ? chipNeutral : s === "idle" ? chipWarn : chipInfo);
