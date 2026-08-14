"use client";

/* v1.8.0 — Portal context panel (UI-REDESIGN-PLAN.md Phase 1).
   The reference's left column: a mini month calendar on the navy panel with
   the day's items beneath it. Self-fetching like every other portal card
   (events — all staff can read; live sessions — the API already scopes
   hosts to their own), and silent on failure: a context panel must never
   take the portal down. Desktop xl+ only (the shell hides it below that). */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { mytToday } from "@/lib/format";
import { MiniCalendar } from "@/components/ui/mini-calendar";
import { Avatar } from "@/components/ui/avatar";

interface EventRow { id: number; title: string; category: string; event_date: string; start_time?: string | null; end_time?: string | null; location?: string | null }
interface SessionRow { id: number; session_date: string; start_time: string; end_time: string; host_name?: string | null; client_name?: string | null; platform?: string | null; status?: string | null }

const CAT_EMOJI: Record<string, string> = { training: "🎓", class: "📚", meeting: "🤝", event: "🎉" };

export function PortalContextPanel() {
  const today = mytToday();
  const [selected, setSelected] = useState<string>(today);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    let alive = true;
    void api<{ events: EventRow[] }>("/staff/events").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.events)) setEvents(r.data.events);
    }).catch(() => {});
    void api<{ sessions: SessionRow[] }>("/staff/live-sessions").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.sessions)) setSessions(r.data.sessions);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const marked = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.event_date) s.add(e.event_date.slice(0, 10));
    for (const x of sessions) if (x.session_date) s.add(x.session_date.slice(0, 10));
    return s;
  }, [events, sessions]);

  const dayEvents = events.filter((e) => e.event_date?.slice(0, 10) === selected);
  const daySessions = sessions.filter((x) => x.session_date?.slice(0, 10) === selected);
  const count = dayEvents.length + daySessions.length;

  return (
    <>
      <div className="bg-card rounded-card p-3">
        <MiniCalendar selected={selected} onSelect={setSelected} marked={marked} todayISO={today} />
      </div>

      <div className="px-1">
        <p className="text-xs font-medium text-white/60">
          {selected === today ? "Today" : selected}
        </p>
        <p className="text-sm font-semibold text-white">
          {count === 0 ? "Nothing scheduled" : `${count} item${count === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="space-y-2">
        {daySessions.map((s) => (
          <div key={`s${s.id}`} className="rounded-card bg-brand-soft p-3">
            <p className="text-xs font-medium text-white/60 tabular-nums">{s.start_time}–{s.end_time}</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{s.client_name ?? "Live session"}</p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {s.host_name && <Avatar name={s.host_name} size="sm" />}
                <span className="truncate text-xs text-white/75">{s.host_name ?? ""}</span>
              </span>
              {s.platform && <span className="text-gold shrink-0 text-[10px] font-medium uppercase">{s.platform}</span>}
            </div>
          </div>
        ))}
        {dayEvents.map((e) => (
          <div key={`e${e.id}`} className="rounded-card bg-brand-soft p-3">
            <p className="text-xs font-medium text-white/60 tabular-nums">
              {e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ""}` : "All day"}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">
              <span aria-hidden>{CAT_EMOJI[e.category] ?? "📌"} </span>{e.title}
            </p>
            {e.location && <p className="mt-1 truncate text-xs text-white/60">📍 {e.location}</p>}
          </div>
        ))}
      </div>
    </>
  );
}
