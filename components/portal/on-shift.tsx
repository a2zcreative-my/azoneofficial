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
import { outboxAll, subscribeOutbox, dismissNeedsHr } from "@/lib/outbox";
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

export function SessionRows({ sessions, known }: { sessions: Session[]; known: boolean }) {
  if (!known) return <SkelRows rows={2} />;
  if (sessions.length === 0) {
    return <p className={css.muted}>{L("No punches recorded today.", "Tiada punch direkodkan hari ini.")}</p>;
  }
  return (
    <ol className={css.sessions} aria-label={L("Today's punches", "Punch hari ini")}>
      {sessions.map((s, i) => (
        <li key={s.in} className={`${css.session} ${css.sessionGold}`}>
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
