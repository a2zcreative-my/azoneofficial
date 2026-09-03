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
import { Skel } from "@/components/ui/skeleton";
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
const MONTHS_MS = ["Januari","Februari","Mac","April","Mei","Jun","Julai","Ogos","September","Oktober","November","Disember"];
/* BM labels for API VALUES — display only. The values themselves stay
   English: the filters above still compare "completed" / "cancelled" etc. */
const TASK_STATUS_MS: Record<string, string> = { open: "terbuka", in_progress: "sedang berjalan", completed: "selesai" };
const LEAVE_TYPE_MS: Record<string, string> = { annual: "tahunan", medical: "perubatan", emergency: "kecemasan", unpaid: "tanpa gaji", replacement: "gantian" };
const EVENT_CAT_MS: Record<string, string> = { event: "acara", news: "berita", meeting: "mesyuarat", holiday: "cuti", kpi: "KPI", training: "latihan", memo: "memo" };

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
  /* v1.77.0 — skeleton until the first fetch lands. The four lists start
     empty, so without this flag the day card read "0 items · Nothing
     scheduled" while the requests were still in flight. */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (m: string) => {
    try {
      const a = await api<{ records: Punch[] }>(`/staff/attendance?month=${m}`);
      setPunches(a.data?.records ?? []);
      const t = await api<{ tasks: Task[] }>(`/staff/tasks`);
      setTasks((t.data?.tasks ?? []).filter((x) => x.status !== "completed"));
      const s = await api<{ sessions: Sess[] }>(`/staff/live-sessions`);
      setSessions((s.data?.sessions ?? []).filter((x) => x.status !== "cancelled"));
      const e = await api<{ events: Ev[] }>(`/staff/events`);
      setEvents(e.data?.events ?? []);
    } finally {
      setLoaded(true);
    }
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
        label={`${(lang === "ms" ? MONTHS_MS : MONTHS)[m - 1]} ${y}`}
      />

      {/* v1.77.0 — skeleton until the first fetch lands: the same navy day
          card (its three lines) and three agenda rows, in the card shape the
          real sessions/events/tasks render in below. */}
      {!loaded ? (
        <>
          <div className="bg-brand rounded-card p-3 text-white" aria-hidden>
            <div className="h-2.5 w-16 rounded bg-white/20" />
            <div className="mt-2 h-5 w-24 rounded bg-white/25" />
            <div className="mt-2 h-2.5 w-36 max-w-full rounded bg-white/15" />
            <div className="mt-1.5 h-2.5 w-28 max-w-full rounded bg-white/15" />
          </div>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="border-border bg-card rounded-card border p-3" aria-hidden>
              <Skel className="h-2.5 w-20" />
              <Skel className="mt-2 h-3.5 w-3/4" />
              <Skel className="mt-1.5 h-2.5 w-1/2" />
            </div>
          ))}
        </>
      ) : (
      <>
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
          <p className="mt-1 truncate text-[13px] font-semibold">{s.client_company ?? s.client_name ?? (lang === "ms" ? "Sesi langsung" : "Live session")}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-[11.5px]">{s.host_name}</p>
        </div>
      ))}
      {dayEvents.slice(0, 3).map((e) => (
        <div key={`e${e.id}`} className="border-border bg-card rounded-card border p-3">
          <p className="text-gold-deep text-[11px] font-semibold tabular-nums">{e.start_time || (lang === "ms" ? "Sepanjang hari" : "All day")}</p>
          <p className="mt-1 truncate text-[13px] font-semibold">{e.title}</p>
          <p className="text-muted-foreground mt-0.5 text-[11.5px] capitalize">{lang === "ms" ? EVENT_CAT_MS[e.category] ?? e.category : e.category}</p>
        </div>
      ))}
      {dayTasks.slice(0, 6).map((t) => (
        <div key={t.id} className="border-border bg-card rounded-card border p-3">
          <p className="text-gold-deep text-[11px] font-semibold tabular-nums">{t.due_date?.slice(0, 10)}</p>
          <p className="mt-1 truncate text-[13px] font-semibold">{t.title}</p>
          <p className="text-muted-foreground mt-0.5 text-[11.5px] capitalize">{lang === "ms" ? TASK_STATUS_MS[t.status] ?? t.status.replace(/_/g, " ") : t.status.replace(/_/g, " ")}</p>
        </div>
      ))}
      {dayCount === 0 && (
        <p className="text-muted-foreground px-1 text-[12px]">
          {lang === "ms" ? "Tiada apa-apa pada hari ini." : "Nothing on this day."}
        </p>
      )}
      </>
      )}
    </>
  );
}

/** Right column: the queues that actually need someone to act. */
/* v1.79.0 — hoisted out of RightRail. Declared inside a component, `Section`
   was a NEW component type on every render, so React threw away all three
   sections and rebuilt them each time the rail re-rendered: any state inside
   one would reset, and an input placed in one would lose focus mid-keystroke.
   Nothing here holds focus today, which is exactly why it went unnoticed —
   guard #30 now fails the build on the pattern rather than on its symptoms. */
function Section({ title, count, children, onCount, countHint }: {
  title: string; count?: number; children: React.ReactNode;
  /* v1.88.0 (CEO: "clickable data without me need to open another new tabs")
     — the red badge is the rail's whole point: it says how many things are
     waiting on you. It was a span, so the only way to act on it was to find
     the tab yourself. Given an `onCount` it becomes the door. Without one it
     stays a span, because a badge that looks pressable and is not is worse
     than one that never offered. */
  onCount?: () => void; countHint?: string;
}) {
  const badge = "bg-danger-soft text-danger rounded-full px-2 py-0.5 text-[11px] font-semibold";
  return (
    <section className="border-border bg-card rounded-card border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {count !== undefined && count > 0 && (
          onCount
            ? <button type="button" className={`${badge} transition hover:brightness-95`} title={countHint} onClick={onCount}>{count} →</button>
            : <span className={badge}>{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

export function RightRail({ lang = "en", go }: {
  lang?: "en" | "ms";
  /** v1.88.0 — how the rail opens the tab a badge counts for. */
  go?: (t: string) => void;
}) {
  const [leave, setLeave] = useState<Leave[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [anns, setAnns] = useState<Ann[]>([]);
  /* v1.77.0 — skeleton until the first fetch lands. All three queues start
     empty, so the rail used to say "Nothing waiting · All clear · None"
     for as long as the requests took. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.allSettled([
      api<{ leave: Leave[] }>(`/staff/leave`).then((r) =>
        setLeave((r.data?.leave ?? []).filter((x) => x.status === "pending"))),
      api<{ tasks: Task[] }>(`/staff/tasks`).then((r) =>
        setTasks((r.data?.tasks ?? []).filter((x) => x.status !== "completed").slice(0, 5))),
      api<{ announcements: Ann[] }>(`/staff/announcements`).then((r) =>
        setAnns((r.data?.announcements ?? []).slice(0, 3))),
    ]).then(() => setLoaded(true));
  }, []);

  /* v1.77.0 — skeleton until the first fetch lands: one queue entry in the
     shape of the real rows (title line + detail line). */
  const skelRows = (n: number) => (
    <div aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="border-border border-b py-2 last:border-0 last:pb-0">
          <Skel className="h-3 w-2/3" />
          <Skel className="mt-1.5 h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );

  return (
    <>
      <Section title={lang === "ms" ? "Cuti menunggu" : "Leave pending"} count={leave.length}
        onCount={go ? () => go("Leave") : undefined}
        countHint={lang === "ms" ? "Buka tab Cuti" : "Open the Leave tab"}>
        {!loaded ? skelRows(2) : leave.length === 0 ? (
          <p className="text-muted-foreground text-[12px]">{lang === "ms" ? "Tiada permohonan." : "Nothing waiting."}</p>
        ) : leave.slice(0, 4).map((l) => (
          <div key={l.id} className="border-border flex items-start gap-2 border-b py-2 last:border-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold capitalize">{lang === "ms" ? LEAVE_TYPE_MS[l.type] ?? l.type.replace(/_/g, " ") : l.type.replace(/_/g, " ")}</p>
              <p className="text-muted-foreground text-[11.5px] tabular-nums">{l.start_date} → {l.end_date}</p>
            </div>
          </div>
        ))}
      </Section>

      <Section title={lang === "ms" ? "Tugasan terbuka" : "Open tasks"} count={tasks.length}
        onCount={go ? () => go("Tasks") : undefined}
        countHint={lang === "ms" ? "Buka tab Tugasan" : "Open the Tasks tab"}>
        {!loaded ? skelRows(3) : tasks.length === 0 ? (
          <p className="text-muted-foreground text-[12px]">{lang === "ms" ? "Semua selesai." : "All clear."}</p>
        ) : tasks.map((t) => (
          <div key={t.id} className="border-border border-b py-2 last:border-0 last:pb-0">
            <p className="truncate text-[12.5px] font-semibold">{t.title}</p>
            <p className="text-muted-foreground text-[11.5px] capitalize">{lang === "ms" ? TASK_STATUS_MS[t.status] ?? t.status.replace(/_/g, " ") : t.status.replace(/_/g, " ")}</p>
          </div>
        ))}
      </Section>

      <Section title={lang === "ms" ? "Pengumuman" : "Announcements"}>
        {!loaded ? skelRows(2) : anns.length === 0 ? (
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
