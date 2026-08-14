"use client";

/* v1.8.0 — Dashboard uplift cards (UI-REDESIGN-PLAN.md Phases 2 & 4).
   Four self-contained cards in the codebase's card idiom (each fetches its
   own data, each fails silent — a dashboard tile must never take the
   Dashboard down, and a 403 simply hides the card):

     · NextAssignmentCard   — the reference's navy hero: your next live
                              session / event with a countdown chip.
     · AttendanceTodayCard  — the reference's donut: on-time / late /
                              not-clocked-in from /attendance/monitor
                              (HR + exec readers, same as the endpoint).
     · SessionsMonthChartCard — the reference's bar chart, on live-session
                              counts (everyone sees their own scope: the
                              API already returns hosts only their own).
     · TodaySessionsCard    — the reference's assignments table: today's
                              roster with avatars and status chips.

   No new endpoints, no new permissions — presentation only. */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { mytToday } from "@/lib/format";
import { tile } from "@/lib/ui-styles";
import { Avatar } from "@/components/ui/avatar";
import { DonutStat } from "@/components/ui/donut-stat";
import { BarChart, type BarDatum } from "@/components/ui/bar-chart";
import { chipSuccess, chipWarn, chipNeutral } from "@/lib/ui-styles";

interface Session {
  id: number; session_date: string; start_time: string; end_time?: string | null;
  platform?: string | null; client_name?: string | null; client_company?: string | null;
  host_user_id: number; host_name?: string | null; status?: string | null;
}
interface EventRow { id: number; title: string; category: string; event_date: string; start_time?: string | null; location?: string | null }

/** Minutes now in MYT. */
function mytNowMins(): number {
  const m = new Date(Date.now() + 8 * 3600 * 1000);
  return m.getUTCHours() * 60 + m.getUTCMinutes();
}
function hmToMins(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/* ── 1 · Next assignment (the navy hero) ─────────────────────────────── */

export function NextAssignmentCard({ userId }: { userId: number }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [, tick] = useState(0); // minute tick for the countdown chip

  useEffect(() => {
    let alive = true;
    void api<{ sessions: Session[] }>("/staff/live-sessions").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.sessions)) setSessions(r.data.sessions);
    }).catch(() => {});
    void api<{ events: EventRow[] }>("/staff/events").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.events)) setEvents(r.data.events);
    }).catch(() => {});
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const today = mytToday();
  const nowM = mytNowMins();

  /* The next thing on YOUR plate: your own upcoming session first (hosts
     get exactly their own from the API; for management "next session on
     the roster" is the operational headline), else the next event. */
  const next = useMemo(() => {
    const mine = sessions.filter((s) => s.status !== "cancelled");
    const upcoming = mine
      .filter((s) => s.session_date > today || (s.session_date === today && hmToMins(s.start_time) + 1 > nowM))
      .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));
    const own = upcoming.find((s) => s.host_user_id === userId);
    return own ?? upcoming[0] ?? null;
  }, [sessions, today, nowM, userId]);

  const nextEvent = useMemo(() => {
    return events
      .filter((e) => e.event_date >= today)
      .sort((a, b) => (a.event_date + (a.start_time ?? "")).localeCompare(b.event_date + (b.start_time ?? "")))[0] ?? null;
  }, [events, today]);

  if (!next && !nextEvent) return null;

  const startsChip = (dateISO: string, hm?: string | null): string | null => {
    if (dateISO !== today || !hm) return dateISO === today ? "Today" : null;
    const diff = hmToMins(hm) - nowM;
    if (diff <= 0) return "Now";
    if (diff < 60) return `Starts in ${diff} minutes`;
    if (diff < 8 * 60) return `Starts in ${Math.round(diff / 60)} h`;
    return "Today";
  };

  if (next) {
    const chip = startsChip(next.session_date, next.start_time);
    return (
      <section className="bg-brand rounded-card shadow-soft relative overflow-hidden p-4 text-white md:p-5" aria-label="Next assignment">
        {/* flat decorative disc — a tint, not a gradient (design mandate) */}
        <span aria-hidden className="bg-brand-soft absolute -top-10 -right-10 h-36 w-36 rounded-full" />
        <p className="text-gold text-[10px] font-semibold tracking-[0.2em] uppercase">Next assignment</p>
        <p className="relative mt-1.5 truncate text-xl font-semibold">{next.client_name ?? next.client_company ?? "Live session"}</p>
        <p className="text-sm text-white/70">
          {(next.platform ?? "live").toUpperCase()} · {next.host_name ?? ""}
        </p>
        <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
          <span>🕐 {next.start_time}{next.end_time ? `–${next.end_time}` : ""}</span>
          <span>📅 {next.session_date === today ? "Today" : next.session_date}</span>
          {chip && <span className="ml-auto rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">{chip}</span>}
        </div>
      </section>
    );
  }

  const ev = nextEvent!;
  const chip = startsChip(ev.event_date, ev.start_time);
  return (
    <section className="bg-brand rounded-card shadow-soft relative overflow-hidden p-4 text-white md:p-5" aria-label="Next event">
      <span aria-hidden className="bg-brand-soft absolute -top-10 -right-10 h-36 w-36 rounded-full" />
      <p className="text-gold text-[10px] font-semibold tracking-[0.2em] uppercase">Next event</p>
      <p className="relative mt-1.5 truncate text-xl font-semibold">{ev.title}</p>
      <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
        {ev.start_time && <span>🕐 {ev.start_time}</span>}
        <span>📅 {ev.event_date === today ? "Today" : ev.event_date}</span>
        {ev.location && <span className="truncate">📍 {ev.location}</span>}
        {chip && <span className="ml-auto rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">{chip}</span>}
      </div>
    </section>
  );
}

/* ── 2 · Attendance today donut (HR/exec readers) ────────────────────── */

interface MonitorRow { id: number; name: string; in_at: string | null; out_at: string | null }

export function AttendanceTodayCard() {
  const [rows, setRows] = useState<MonitorRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ staff: MonitorRow[] }>("/staff/attendance/monitor").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.staff)) setRows(r.data.staff);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!rows) return null; // no access (403) or old worker — card simply absent

  /* Late = first clock-in after 10:00 MYT (the shift rule the server
     already applies to reports; recomputed here only for the ring split). */
  const TEN_MYT = 10 * 60;
  let onTime = 0, late = 0;
  const missingNames: string[] = [];
  for (const r of rows) {
    if (!r.in_at) { missingNames.push(r.name.split(" ")[0] ?? r.name); continue; }
    const d = new Date(r.in_at.replace(" ", "T") + (r.in_at.endsWith("Z") ? "" : "Z"));
    const mins = ((d.getTime() / 60000) + 8 * 60) % (24 * 60);
    if (mins <= TEN_MYT) onTime++; else late++;
  }
  const missing = missingNames.length;
  const present = onTime + late;
  const presentPct = rows.length > 0 ? Math.round((present / rows.length) * 100) : 0;

  return (
    <section className={tile} aria-label="Attendance today">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Attendance today</p>
        <span className="text-muted-foreground text-xs">{mytToday()}</span>
      </div>
      {/* v1.8.1 infographic pass: the headline reading first, then the ring. */}
      <p className="mb-3 text-xs">
        <span className="text-foreground text-base font-semibold tabular-nums">{presentPct}%</span>
        <span className="text-muted-foreground"> of the team has clocked in ({present} of {rows.length})</span>
      </p>
      <DonutStat
        centerValue={rows.length}
        centerLabel="staff"
        segments={[
          { label: "On time", value: onTime, tone: "success" },
          { label: "Late", value: late, tone: "warning" },
          /* neutral, not red — validated palette note in donut-stat.tsx */
          { label: "Not clocked in", value: missing, tone: "muted" },
        ]}
      />
      {missing > 0 && (
        <p className="bg-warning-soft text-warning mt-3 rounded-lg px-3 py-2 text-xs font-medium">
          ⏳ Not clocked in: {missingNames.join(", ")}
        </p>
      )}
    </section>
  );
}

/* ── 3 · Sessions per month bars ─────────────────────────────────────── */

export function SessionsMonthChartCard() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ sessions: Session[] }>("/staff/live-sessions").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.sessions)) setSessions(r.data.sessions);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /* The API returns a rolling window (−14 days onward), so this chart shows
     the near-term picture: last month, this month and the scheduled future
     — honest about its window rather than faking a year. */
  const data: BarDatum[] = useMemo(() => {
    if (!sessions) return [];
    const byMonth = new Map<string, { total: number; done: number }>();
    for (const s of sessions) {
      const k = s.session_date.slice(0, 7);
      const e = byMonth.get(k) ?? { total: 0, done: 0 };
      e.total++;
      if (s.status === "completed") e.done++;
      byMonth.set(k, e);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([k, v]) => ({
        label: new Date(k + "-01T00:00:00Z").toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
        value: v.done,
        bg: v.total,
        hint: `${v.done} completed of ${v.total}`,
      }));
  }, [sessions]);

  /* One lonely month renders as a meaningless full-height block — the chart
     earns its card only once there are months to compare. */
  if (!sessions || data.length < 2) return null;

  return (
    <section className={tile} aria-label="Live sessions by month">
      <p className="mb-3 text-sm font-semibold">Live sessions</p>
      <BarChart data={data} height={140} seriesLabel="Completed" bgLabel="Scheduled" />
    </section>
  );
}

/* ── 4 · Today's roster table ────────────────────────────────────────── */

export function TodaySessionsCard() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ sessions: Session[] }>("/staff/live-sessions").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.sessions)) setSessions(r.data.sessions);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const today = mytToday();
  const rows = (sessions ?? []).filter((s) => s.session_date === today && s.status !== "cancelled");
  if (!sessions || rows.length === 0) return null;

  return (
    <section className={tile} aria-label="Today's live sessions">
      <p className="mb-2 text-sm font-semibold">Today&apos;s live sessions</p>
      <ul className="divide-border divide-y">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={s.host_name ?? "?"} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.host_name ?? "—"}</p>
              <p className="text-muted-foreground truncate text-xs">
                {s.client_name ?? s.client_company ?? "Live session"} · {(s.platform ?? "").toUpperCase()}
              </p>
            </div>
            <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">{s.start_time}{s.end_time ? `–${s.end_time}` : ""}</span>
            <span className={s.status === "completed" ? chipSuccess : s.status === "scheduled" ? chipNeutral : chipWarn}>
              {s.status === "completed" ? "✓ Done" : s.status === "scheduled" ? "Scheduled" : (s.status ?? "")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
