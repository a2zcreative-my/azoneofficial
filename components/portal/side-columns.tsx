"use client";

/* v1.14.0 — the canvas shell's two side columns (desktop only).
 *
 * These are self-contained: they fetch from the SAME endpoints the Dashboard
 * already uses, rather than threading state out of the 5,082-line page. That
 * keeps adoption a pure outer-JSX change. The cost is a second call to two
 * cheap read endpoints; the benefit is that no existing state, effect or
 * handler is touched.
 *
 * Dates are MYT `YYYY-MM-DD` strings throughout — see mini-calendar.tsx for
 * why building Date objects here would drift by a day off UTC+8.
 */

import { useCallback, useEffect, useState } from "react";

import { MiniCalendar } from "@/components/ui/mini-calendar";
import { api } from "@/lib/api";

interface Punch { type: string; created_at: string }
interface Task { id: number; title: string; status: string; due_date?: string | null }
interface Leave { id: number; type: string; start_date: string; end_date: string; status: string }
interface Ann { id: number; title: string; created_at: string }
interface Sess { id: number; session_date: string; start_time: string; end_time?: string | null; platform: string; client_company?: string | null; client_name?: string | null; host_name: string; status: string }
interface Ev { id: number; title: string; category: string; event_date: string; start_time?: string | null }

const MY_MS = 8 * 3600 * 1000;
const mytNow = () => new Date(Date.now() + MY_MS);
const mytDay = (iso: string) => new Date(new Date(iso).getTime() + MY_MS).toISOString().slice(0, 10);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Left column: month grid + what is happening today. */
export function ContextPanel({ lang = "en" }: { lang?: "en" | "ms" }) {
  const [month, setMonth] = useState(() => mytNow().toISOString().slice(0, 7));
  const [punches, setPunches] = useState<Punch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  /* v1.21.3 (CEO: "there is roaster schedule created but why on the
     calendar at side of dashboard appear task 0??"): the day card counted
     TASKS only — a scheduled roster session or company event on that day
     was invisible. Now the card reads everything on the day: tasks due,
     live/roster sessions and company events, and the mini calendar dots
     mark those days too. */
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const today = mytNow().toISOString().slice(0, 10);
  const [selected, setSelected] = useState(today);

  const load = useCallback(async (m: string) => {
    const a = await api<{ records: Punch[] }>(`/staff/attendance?month=${m}`);
    setPunches(a.data?.records ?? []);
    const t = await api<{ tasks: Task[] }>(`/staff/tasks`);
    setTasks((t.data?.tasks ?? []).filter((x) => x.status !== "completed"));
    const s = await api<{ sessions: Sess[] }>(`/staff/live-sessions`);
    setSessions((s.data?.sessions ?? []).filter((x) => x.status !== "cancelled"));
    const e = await api<{ events: Ev[] }>(`/staff/events`);
    setEvents(e.data?.events ?? []);
  }, []);
  useEffect(() => { void load(month); }, [load, month]);

  const daySessions = sessions.filter((s) => s.session_date === selected);
  const dayEvents = events.filter((e) => e.event_date === selected);
  /* v1.21.5 (CEO: "why got dotting instead of there is a task only have a
     dot"): attendance days OUT of the dots — with daily punches, every past
     day carried one and the dots said nothing. A dot now means something is
     ON that day: a task due, a roster/live session, or a company event.
     Attendance still reads in the day card's text line. */
  const marked = Array.from(new Set([
    ...tasks.filter((t) => t.due_date).map((t) => (t.due_date as string).slice(0, 10)),
    ...sessions.map((s) => s.session_date),
    ...events.map((e) => e.event_date),
  ]));
  const dayTasks = tasks.filter((t) => t.due_date && t.due_date.slice(0, 10) === selected);
  const dayCount = dayTasks.length + daySessions.length + dayEvents.length;
  // `noUncheckedIndexedAccess` is on, so a split()/map() element is
  // `number | undefined`. Coerce with a sane fallback rather than assert.
  const parts = month.split("-").map(Number);
  const y = parts[0] ?? mytNow().getUTCFullYear();
  const m = parts[1] ?? 1;

  return (
    <>
      <MiniCalendar
        month={month}
        selected={selected}
        marked={marked}
        onSelect={setSelected}
        onMonth={(d) => {
          const next = new Date(Date.UTC(y, m - 1 + d, 1));
          setMonth(next.toISOString().slice(0, 7));
        }}
        label={`${MONTHS[m - 1]} ${y}`}
      />

      <div className="bg-brand rounded-card p-3 text-white">
        <p className="text-gold text-[10px] font-semibold tracking-[0.14em] uppercase">
          {selected === today ? (lang === "ms" ? "Hari ini" : "Today") : selected}
        </p>
        <p className="mt-1 text-[19px] font-semibold">
          {dayCount} {lang === "ms" ? "perkara" : dayCount === 1 ? "item" : "items"}
        </p>
        <p className="mt-0.5 text-[11.5px] text-white/60">
          {[
            dayTasks.length ? `${dayTasks.length} ${lang === "ms" ? "tugasan" : dayTasks.length === 1 ? "task" : "tasks"}` : null,
            daySessions.length ? `${daySessions.length} ${lang === "ms" ? "sesi" : daySessions.length === 1 ? "session" : "sessions"}` : null,
            dayEvents.length ? `${dayEvents.length} ${lang === "ms" ? "acara" : dayEvents.length === 1 ? "event" : "events"}` : null,
          ].filter(Boolean).join(" · ") || (lang === "ms" ? "Tiada apa-apa dijadualkan" : "Nothing scheduled")}
        </p>
        <p className="mt-0.5 text-[11.5px] text-white/60">
          {punches.some((p) => mytDay(p.created_at) === selected)
            ? (lang === "ms" ? "Kehadiran direkod" : "Attendance recorded")
            : (lang === "ms" ? "Tiada rekod kehadiran" : "No attendance recorded")}
        </p>
      </div>

      {/* v1.21.3: roster/live sessions on the selected day. */}
      {daySessions.slice(0, 4).map((s) => (
        <div key={`s${s.id}`} className="border-border bg-card rounded-card border p-3">
          <p className="text-gold-deep text-[11px] font-semibold tabular-nums">
            {s.start_time}{s.end_time ? `–${s.end_time}` : ""} · {s.platform}
          </p>
          <p className="mt-1 truncate text-[13px] font-semibold">{s.client_company ?? s.client_name ?? "Live session"}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-[11.5px]">{s.host_name}</p>
        </div>
      ))}
      {dayEvents.slice(0, 3).map((e) => (
        <div key={`e${e.id}`} className="border-border bg-card rounded-card border p-3">
          <p className="text-gold-deep text-[11px] font-semibold tabular-nums">{e.start_time || (lang === "ms" ? "Sepanjang hari" : "All day")}</p>
          <p className="mt-1 truncate text-[13px] font-semibold">{e.title}</p>
          <p className="text-muted-foreground mt-0.5 text-[11.5px] capitalize">{e.category}</p>
        </div>
      ))}
      {dayTasks.slice(0, 6).map((t) => (
        <div key={t.id} className="border-border bg-card rounded-card border p-3">
          <p className="text-gold-deep text-[11px] font-semibold tabular-nums">{t.due_date?.slice(0, 10)}</p>
          <p className="mt-1 truncate text-[13px] font-semibold">{t.title}</p>
          <p className="text-muted-foreground mt-0.5 text-[11.5px] capitalize">{t.status.replace(/_/g, " ")}</p>
        </div>
      ))}
      {dayCount === 0 && (
        <p className="text-muted-foreground px-1 text-[12px]">
          {lang === "ms" ? "Tiada apa-apa pada hari ini." : "Nothing on this day."}
        </p>
      )}
    </>
  );
}

/** Right column: the queues that actually need someone to act. */
export function RightRail({ lang = "en" }: { lang?: "en" | "ms" }) {
  const [leave, setLeave] = useState<Leave[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [anns, setAnns] = useState<Ann[]>([]);

  useEffect(() => {
    void api<{ leave: Leave[] }>(`/staff/leave`).then((r) =>
      setLeave((r.data?.leave ?? []).filter((x) => x.status === "pending")));
    void api<{ tasks: Task[] }>(`/staff/tasks`).then((r) =>
      setTasks((r.data?.tasks ?? []).filter((x) => x.status !== "completed").slice(0, 5)));
    void api<{ announcements: Ann[] }>(`/staff/announcements`).then((r) =>
      setAnns((r.data?.announcements ?? []).slice(0, 3)));
  }, []);

  const Section = ({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) => (
    <section className="border-border bg-card rounded-card border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-[11px] font-semibold">{count}</span>
        )}
      </div>
      {children}
    </section>
  );

  return (
    <>
      <Section title={lang === "ms" ? "Cuti menunggu" : "Leave pending"} count={leave.length}>
        {leave.length === 0 ? (
          <p className="text-muted-foreground text-[12px]">{lang === "ms" ? "Tiada permohonan." : "Nothing waiting."}</p>
        ) : leave.slice(0, 4).map((l) => (
          <div key={l.id} className="border-border flex items-start gap-2 border-b py-2 last:border-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold capitalize">{l.type.replace(/_/g, " ")}</p>
              <p className="text-muted-foreground text-[11.5px] tabular-nums">{l.start_date} → {l.end_date}</p>
            </div>
          </div>
        ))}
      </Section>

      <Section title={lang === "ms" ? "Tugasan terbuka" : "Open tasks"} count={tasks.length}>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground text-[12px]">{lang === "ms" ? "Semua selesai." : "All clear."}</p>
        ) : tasks.map((t) => (
          <div key={t.id} className="border-border border-b py-2 last:border-0 last:pb-0">
            <p className="truncate text-[12.5px] font-semibold">{t.title}</p>
            <p className="text-muted-foreground text-[11.5px] capitalize">{t.status.replace(/_/g, " ")}</p>
          </div>
        ))}
      </Section>

      <Section title={lang === "ms" ? "Pengumuman" : "Announcements"}>
        {anns.length === 0 ? (
          <p className="text-muted-foreground text-[12px]">{lang === "ms" ? "Tiada." : "None."}</p>
        ) : anns.map((a) => (
          <div key={a.id} className="border-border border-b py-2 last:border-0 last:pb-0">
            <p className="truncate text-[12.5px] font-semibold">{a.title}</p>
            <p className="text-muted-foreground text-[11.5px] tabular-nums">{mytDay(a.created_at)}</p>
          </div>
        ))}
      </Section>
    </>
  );
}
