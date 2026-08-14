"use client";

/* v1.8.0 — WeekGrid (UI-REDESIGN-PLAN.md Phase 3, the flagship).
   The reference's "Schedule & Roster" screen on the existing live-session
   data: a KPI strip, a Mon–Sun time grid with tinted session blocks and a
   tap/hover detail card, and a right rail of who's on and who's free.

   Scope rules are inherited, not invented: the API gives hosts their own
   sessions and management the whole roster, so the same component renders
   a personal week for a host and the agency week for the CEO. Creating
   sessions stays in the Live Schedule card below — this is the view layer.

   Desktop md+: the 7-column grid. Phones: a day view with ‹ › paging (a
   week grid at 390px is unreadable — the reference never shows one). */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { mytToday } from "@/lib/format";
import { tile, chipSuccess, chipNeutral, chipWarn } from "@/lib/ui-styles";
import { Avatar } from "@/components/ui/avatar";

interface Session {
  id: number; session_date: string; start_time: string; end_time?: string | null;
  platform?: string | null; client_name?: string | null; client_company?: string | null;
  host_user_id: number; host_name?: string | null; status?: string | null; notes?: string | null;
}
interface LeaveRow { id: number; user_id: number; user_name?: string; start_date: string; end_date: string; status: string }

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function hmToMins(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Monday of the week containing `iso`. */
function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}
function overlap(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

export function WeekGridCard() {
  const today = mytToday();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [day, setDay] = useState(today); // mobile day view
  const [sessions, setSessions] = useState<Session[]>([]);
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [active, setActive] = useState<number | null>(null); // tapped block

  useEffect(() => {
    let alive = true;
    void api<{ sessions: Session[] }>("/staff/live-sessions").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.sessions)) setSessions(r.data.sessions);
    }).catch(() => {});
    /* HR sees everyone (?all=1); everyone else quietly falls back to their
       own leave — the KPI is simply personal at that scope. */
    void api<{ leave: LeaveRow[] }>("/staff/leave?all=1").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.leave)) setLeave(r.data.leave);
      else return api<{ leave: LeaveRow[] }>("/staff/leave").then((r2) => {
        if (alive && r2.ok && Array.isArray(r2.data?.leave)) setLeave(r2.data.leave);
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const sunday = days[6]!;

  const weekSessions = useMemo(
    () => sessions.filter((s) => s.session_date >= monday && s.session_date <= sunday && s.status !== "cancelled"),
    [sessions, monday, sunday],
  );

  /* KPI strip */
  const hostsBooked = new Set(weekSessions.map((s) => s.host_user_id)).size;
  const onLeave = new Set(
    leave
      .filter((l) => l.status === "approved" && l.start_date <= sunday && l.end_date >= monday)
      .map((l) => l.user_id),
  ).size;
  const conflicts = useMemo(() => {
    let n = 0;
    const byHostDay = new Map<string, Session[]>();
    for (const s of weekSessions) {
      const k = `${s.host_user_id}|${s.session_date}`;
      const arr = byHostDay.get(k) ?? [];
      arr.push(s);
      byHostDay.set(k, arr);
    }
    for (const arr of byHostDay.values()) {
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!, b = arr[j]!;
        if (overlap(hmToMins(a.start_time), hmToMins(a.end_time ?? a.start_time) + 1,
                    hmToMins(b.start_time), hmToMins(b.end_time ?? b.start_time) + 1)) n++;
      }
    }
    return n;
  }, [weekSessions]);

  /* Grid time range: generous default, stretched by the data. */
  const startH = Math.min(9, ...weekSessions.map((s) => Math.floor(hmToMins(s.start_time) / 60)));
  const endH = Math.max(22, ...weekSessions.map((s) => Math.ceil(hmToMins(s.end_time ?? s.start_time) / 60) + 1));
  const HOUR_PX = 44;
  const gridH = (endH - startH) * HOUR_PX;

  const block = (s: Session) => {
    const top = ((hmToMins(s.start_time) - startH * 60) / 60) * HOUR_PX;
    const h = Math.max(30, ((hmToMins(s.end_time ?? s.start_time) - hmToMins(s.start_time)) / 60) * HOUR_PX || 40);
    const isActive = active === s.id;
    return (
      <div key={s.id} className="absolute right-0.5 left-0.5" style={{ top, height: h }}>
        <button
          type="button"
          onClick={() => setActive((a) => (a === s.id ? null : s.id))}
          onMouseEnter={() => setActive(s.id)}
          onMouseLeave={() => setActive((a) => (a === s.id ? null : a))}
          aria-label={`${s.client_name ?? "Live session"} — ${s.start_time}${s.end_time ? `–${s.end_time}` : ""}, ${s.host_name ?? ""}`}
          className={`bg-tint-gold h-full w-full overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-left transition-shadow ${
            isActive ? "border-l-gold-solid shadow-soft ring-gold-solid z-10 ring-1" : "border-l-gold-deep"
          }`}
        >
          <p className="text-foreground truncate text-[11px] leading-tight font-semibold">{s.client_name ?? s.client_company ?? "Live"}</p>
          <p className="text-muted-foreground truncate text-[10px] tabular-nums">{s.start_time}{s.end_time ? `–${s.end_time}` : ""}</p>
          {h > 52 && s.host_name && (
            <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[10px]">
              <Avatar name={s.host_name} size="sm" /> <span className="truncate">{s.host_name}</span>
            </p>
          )}
        </button>
        {/* detail card — the reference's dark tooltip */}
        {isActive && (
          <div className="bg-brand shadow-soft absolute top-0 left-1/2 z-20 w-52 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-xl p-3 text-white">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{s.client_name ?? s.client_company ?? "Live session"}</p>
              <span className={`${s.status === "completed" ? "bg-white/20" : "bg-white/10"} rounded-full px-2 py-0.5 text-[10px] font-medium`}>
                {s.status === "completed" ? "Completed" : "Scheduled"}
              </span>
            </div>
            {s.host_name && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/85">
                <Avatar name={s.host_name} size="sm" /> {s.host_name}
              </p>
            )}
            <p className="mt-1 text-xs text-white/70">📅 {s.session_date}</p>
            <p className="text-xs text-white/70">🕐 {s.start_time}{s.end_time ? ` – ${s.end_time}` : ""}</p>
            <p className="text-xs text-white/70">📺 {(s.platform ?? "tiktok").toUpperCase()}</p>
          </div>
        )}
      </div>
    );
  };

  const daySessions = sessions
    .filter((s) => s.session_date === day && s.status !== "cancelled")
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <section className={tile} aria-label="Schedule and roster">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Schedule &amp; roster</p>
          <p className="text-muted-foreground text-xs">Live sessions — week of {monday} – {sunday}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => { setMonday(mondayOf(today)); setDay(today); }}
            className="border-border hover:bg-secondary rounded-lg border px-2.5 py-1 text-xs font-medium">Today</button>
          <button type="button" aria-label="Previous week" onClick={() => { setMonday((m) => addDays(m, -7)); setDay((d) => addDays(d, -7)); }}
            className="border-border hover:bg-secondary flex h-7 w-7 items-center justify-center rounded-lg border text-sm">‹</button>
          <button type="button" aria-label="Next week" onClick={() => { setMonday((m) => addDays(m, 7)); setDay((d) => addDays(d, 7)); }}
            className="border-border hover:bg-secondary flex h-7 w-7 items-center justify-center rounded-lg border text-sm">›</button>
        </div>
      </div>

      {/* KPI strip — the reference's four tiles */}
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { n: weekSessions.length, l: "Scheduled", icon: "📅" },
          { n: hostsBooked, l: "Hosts booked", icon: "🧑‍💼" },
          { n: onLeave, l: "On leave", icon: "🌴" },
          { n: conflicts, l: "Conflicts", icon: "⚠️", warn: conflicts > 0 },
        ].map((k) => (
          <div key={k.l} className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${k.warn ? "border-warning bg-warning-soft" : "border-border bg-secondary/50"}`}>
            <span aria-hidden className="bg-card flex h-8 w-8 items-center justify-center rounded-lg text-sm">{k.icon}</span>
            <span>
              <span className="block text-lg leading-none font-semibold tabular-nums">{k.n}</span>
              <span className="text-muted-foreground text-[11px]">{k.l}</span>
            </span>
          </div>
        ))}
      </div>

      {/* ── Desktop week grid ── */}
      <div className="border-border hidden overflow-x-auto rounded-xl border md:block">
        <div className="min-w-[720px]">
          <div className="border-border grid border-b" style={{ gridTemplateColumns: "3rem repeat(7, 1fr)" }}>
            <span />
            {days.map((d, i) => (
              <div key={d} className={`px-1 py-2 text-center ${d === today ? "bg-tint-gold" : ""}`}>
                <p className="text-muted-foreground text-[10px] font-semibold">{DAY_LABELS[i]}</p>
                <p className={`text-sm font-semibold tabular-nums ${d === today ? "text-gold-deep" : ""}`}>{Number(d.slice(8, 10))}</p>
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: "3rem repeat(7, 1fr)" }}>
            {/* hour gutter */}
            <div className="relative" style={{ height: gridH }}>
              {Array.from({ length: endH - startH }, (_, i) => (
                <span key={i} className="text-muted-foreground absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums"
                  style={{ top: i * HOUR_PX }}>
                  {i === 0 ? "" : `${String(startH + i).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} className={`border-border relative border-l ${d === today ? "bg-tint-gold" : ""}`} style={{ height: gridH }}>
                {Array.from({ length: endH - startH - 1 }, (_, i) => (
                  <span key={i} aria-hidden className="border-border/60 absolute right-0 left-0 border-t"
                    style={{ top: (i + 1) * HOUR_PX }} />
                ))}
                {weekSessions.filter((s) => s.session_date === d).map(block)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile day view ── */}
      <div className="md:hidden">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label="Previous day" onClick={() => setDay((d) => addDays(d, -1))}
            className="border-border flex h-8 w-8 items-center justify-center rounded-lg border">‹</button>
          <p className="text-sm font-semibold">{day === today ? "Today" : day}</p>
          <button type="button" aria-label="Next day" onClick={() => setDay((d) => addDays(d, 1))}
            className="border-border flex h-8 w-8 items-center justify-center rounded-lg border">›</button>
        </div>
        {daySessions.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">No live sessions this day.</p>
        ) : (
          <ul className="space-y-2">
            {daySessions.map((s) => (
              <li key={s.id} className="bg-tint-gold border-l-gold-deep rounded-xl border-l-[3px] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{s.client_name ?? s.client_company ?? "Live session"}</p>
                  <span className={s.status === "completed" ? chipSuccess : s.status === "scheduled" ? chipNeutral : chipWarn}>
                    {s.status === "completed" ? "✓ Done" : "Scheduled"}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs tabular-nums">🕐 {s.start_time}{s.end_time ? `–${s.end_time}` : ""} · 📺 {(s.platform ?? "tiktok").toUpperCase()}</p>
                {s.host_name && (
                  <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                    <Avatar name={s.host_name} size="sm" /> {s.host_name}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
