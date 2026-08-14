"use client";

/* v1.8.0 — 📆 Schedule & Roster (the reference design's flagship screen, in
   brand colours). Week time-grid of live sessions with conflict flags, a
   detail popover, stat chips, an unassigned-requests rail, "available today",
   and click-to-assign (reuses POST /staff/live-sessions). Managers see the
   whole floor; hosts see their own week read-only. */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { card, inputClass, btnClass, btnSm, fieldLabel, chipWarn, chipSuccess, chipNeutral } from "@/lib/ui-styles";
import { dmy } from "@/lib/format";
import { MiniCalendar } from "@/components/portal/mini-calendar";

const api = makeApi("/staff");

interface RosterSession {
  id: number; session_date: string; start_time: string; end_time: string | null;
  platform: string; status: string; client: string | null; notes: string | null;
  host_user_id: number; host_name: string; photo_key: string | null;
}
interface RosterData {
  week_start: string; days: string[]; manager: boolean;
  sessions: RosterSession[];
  on_leave: { user_id: number; name: string; start_date: string; end_date: string }[];
  conflicts: { kind: string; session_ids: number[]; host_user_id: number; date: string }[];
  requests: { id: number; name: string; company: string | null; category: string | null; created_at: string }[];
  available_today: { id: number; name: string; role: string; photo_key: string | null }[];
}

const DAY_START = 8;   // 08:00
const DAY_END = 23;    // 23:00
const HOUR_PX = 44;

function mins(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 86400_000).toISOString().slice(0, 10);
}
function shiftWeek(weekStart: string, weeks: number): string {
  return new Date(Date.parse(weekStart + "T00:00:00Z") + weeks * 7 * 86400_000).toISOString().slice(0, 10);
}
const DAY_LABEL = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function RosterBoard({ canManage }: { canManage: boolean }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [data, setData] = useState<RosterData | null>(null);
  const [week, setWeek] = useState<string>("");           // "" = server default (this week)
  const [openSession, setOpenSession] = useState<number | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [draft, setDraft] = useState({ session_date: "", start_time: "19:00", end_time: "21:00", platform: "tiktok", client_name: "", host_user_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [notReady, setNotReady] = useState(false);

  const [failed, setFailed] = useState(false);
  const load = useCallback(async (w: string) => {
    setFailed(false);
    const r = await api<RosterData & { error?: { message?: string } }>(`/roster${w ? `?week=${w}` : ""}`);
    if (r.ok && r.data?.days) setData(r.data);
    else if (/route not found/i.test(r.data?.error?.message ?? "") || r.data?.error?.message?.includes("0056")) setNotReady(true);
    else setFailed(true);
  }, []);
  useEffect(() => { void load(week); }, [week, load]);
  useEffect(() => {
    if (!canManage) return;
    void api<{ staff: { id: number; name: string }[] }>(`/staff-list`).then((r) => { if (r.ok && r.data?.staff) setStaff(r.data.staff); });
  }, [canManage]);

  const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const openAssign = (prefill?: Partial<typeof draft>) => {
    setDraft({ session_date: todayS, start_time: "19:00", end_time: "21:00", platform: "tiktok", client_name: "", host_user_id: "", notes: "", ...prefill });
    setAssignOpen(true);
  };

  const saveAssign = async () => {
    if (!draft.session_date || !draft.start_time || !draft.host_user_id) {
      showToast("No change", "Date, start time and host are required", "notice");
      return;
    }
    setSaving(true);
    const r = await api<{ error?: { message?: string } }>(`/live-sessions`, {
      method: "POST",
      body: JSON.stringify({ ...draft, host_user_id: Number(draft.host_user_id) }),
    });
    setSaving(false);
    if (!r.ok) { showToast("No change", r.data?.error?.message ?? "Could not schedule", "notice"); return; }
    showToast("Scheduled", `${draft.client_name || "Live session"} · ${dmy(draft.session_date)} ${draft.start_time}`);
    setAssignOpen(false);
    void load(week);
  };

  if (notReady) {
    return <div className={card}><p className="text-sm font-semibold">📆 Schedule &amp; Roster</p>
      <p className="text-muted-foreground mt-1 text-xs">The roster needs the latest Worker deploy (and migration 0056).</p></div>;
  }
  if (!data) {
    return <div className={card}><p className="text-sm font-semibold">📆 Schedule &amp; Roster</p>
      {failed
        ? <p className="text-muted-foreground mt-2 text-sm">Could not load the week — <button type="button" className="underline" onClick={() => void load(week)}>try again</button>.</p>
        : <p className="text-muted-foreground mt-2 text-sm">Loading the week…</p>}
    </div>;
  }

  const active = data.sessions.filter((s) => s.status !== "cancelled");
  const conflictIds = new Set(data.conflicts.flatMap((c) => c.session_ids));
  const onLeaveCount = new Set(data.on_leave.map((l) => l.user_id)).size;
  const gridHeight = (DAY_END - DAY_START) * HOUR_PX;
  const sel = data.sessions.find((s) => s.id === openSession) ?? null;

  const chip = (label: string, value: number, cls: string) => (
    <span className={`${cls} inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium`}>
      <span className="text-sm font-bold tabular-nums">{value}</span> {label}
    </span>
  );

  return (
    <div className={card}>
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">📆 Schedule &amp; Roster</p>
          <p className="text-muted-foreground mt-0.5 text-xs">Plan live-host assignments, availability and replacements.</p>
        </div>
        {canManage && (
          <button type="button" className={btnClass} onClick={() => openAssign()}>＋ New assignment</button>
        )}
      </div>

      {/* stat chips (reference: Scheduled / Available / On leave / Conflicts) */}
      <div className="mt-3 flex flex-wrap gap-2">
        {chip("scheduled", active.length, "bg-secondary")}
        {data.manager && chip("available today", data.available_today.length, chipSuccess)}
        {chip(data.manager ? "on leave" : "my leave days", onLeaveCount, chipNeutral)}
        {chip("conflicts", data.conflicts.length, data.conflicts.length ? chipWarn : "bg-secondary")}
      </div>

      <div className="mt-3 grid gap-4 xl:grid-cols-[240px_1fr_230px]">
        {/* left rail: mini calendar (xl+) */}
        <div className="hidden xl:block">
          <MiniCalendar
            selected={data.week_start}
            marked={new Set(active.map((s) => s.session_date))}
            onPick={(d) => setWeek(mondayOf(d))}
          />
          <div className="border-border mt-3 rounded-lg border p-3">
            <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">Today</p>
            {active.filter((s) => s.session_date === todayS).length === 0
              ? <p className="text-muted-foreground mt-1.5 text-xs">No sessions today.</p>
              : active.filter((s) => s.session_date === todayS).map((s) => (
                <button key={s.id} type="button" onClick={() => setOpenSession(s.id)}
                  className="border-border mt-1.5 block w-full rounded-lg border px-2.5 py-1.5 text-left text-xs hover:bg-secondary">
                  <span className="font-semibold tabular-nums">{s.start_time}{s.end_time ? `–${s.end_time}` : ""}</span> {s.client ?? "Live"}
                  <span className="text-muted-foreground block">{s.host_name.split(" ")[0]} · {s.platform}</span>
                </button>
              ))}
          </div>
        </div>

        {/* the week grid */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button type="button" className={btnSm} onClick={() => { if (week === "") void load(""); else setWeek(""); }}>Today</button>
              <button type="button" className={btnSm} aria-label="Previous week" onClick={() => setWeek(shiftWeek(data.week_start, -1))}>‹</button>
              <button type="button" className={btnSm} aria-label="Next week" onClick={() => setWeek(shiftWeek(data.week_start, 1))}>›</button>
            </div>
            <p className="text-sm font-medium tabular-nums">Week of {dmy(data.days[0]!)} – {dmy(data.days[6]!)}</p>
          </div>
          <div className="mt-2 overflow-x-auto">
            <div className="min-w-[640px]">
              {/* day headers */}
              <div className="grid" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
                <span />
                {data.days.map((d, i) => (
                  <span key={d} className={`px-1 pb-1 text-center text-[11px] font-semibold ${d === todayS ? "text-gold-deep" : "text-muted-foreground"}`}>
                    {DAY_LABEL[i]} <span className="tabular-nums">{d.slice(8)}</span>
                  </span>
                ))}
              </div>
              {/* time grid */}
              <div className="border-border relative grid rounded-lg border" style={{ gridTemplateColumns: "48px repeat(7, 1fr)", height: gridHeight }}>
                {/* hour lines + labels */}
                {Array.from({ length: DAY_END - DAY_START }, (_, h) => (
                  <span key={h} className="text-muted-foreground absolute left-1 text-[10px] tabular-nums" style={{ top: h * HOUR_PX - 6 }}>
                    {h === 0 ? "" : `${String(DAY_START + h).padStart(2, "0")}:00`}
                  </span>
                ))}
                {Array.from({ length: DAY_END - DAY_START - 1 }, (_, h) => (
                  <span key={`l${h}`} className="bg-border/60 absolute inset-x-0" style={{ top: (h + 1) * HOUR_PX, height: 1 }} />
                ))}
                {/* day columns */}
                {data.days.map((d, di) => (
                  <div key={d} className={`relative border-l border-border/60 ${d === todayS ? "bg-gold-soft/20" : ""}`}
                    style={{ gridColumn: di + 2, gridRow: 1 }}>
                    {active.filter((s) => s.session_date === d).map((s) => {
                      const top = Math.min(gridHeight - 22, Math.max(0, ((mins(s.start_time) - DAY_START * 60) / 60) * HOUR_PX));
                      const endM = s.end_time ? mins(s.end_time) : mins(s.start_time) + 60;
                      // clamp inside the 08:00–23:00 window so early/late
                      // sessions pin to the edge instead of overflowing
                      const height = Math.min(gridHeight - top, Math.max(22, ((endM - mins(s.start_time)) / 60) * HOUR_PX - 2));
                      const conflict = conflictIds.has(s.id);
                      return (
                        <button key={s.id} type="button" onClick={() => setOpenSession(openSession === s.id ? null : s.id)}
                          title={`${s.client ?? "Live"} · ${s.start_time}${s.end_time ? `–${s.end_time}` : ""} · ${s.host_name}`}
                          className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm transition-opacity hover:opacity-90 ${
                            conflict ? "border-warning bg-warning-soft" : s.status === "completed" ? "border-success bg-success-soft" : "border-brand/30 bg-brand/10"
                          }`}
                          style={{ top, height }}>
                          <span className="block truncate font-semibold">{conflict ? "⚠ " : ""}{s.client ?? "Live"}</span>
                          <span className="text-muted-foreground block truncate tabular-nums">{s.start_time}{s.end_time ? `–${s.end_time}` : ""} · {s.host_name.split(" ")[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* detail popover (tap a block) */}
          {sel && (
            <div className="bg-brand mt-2 rounded-xl p-3.5 text-white shadow-lg">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{sel.client ?? "Live session"}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${sel.status === "completed" ? "bg-bull/30" : sel.status === "cancelled" ? "bg-bear/30" : "bg-white/15"}`}>{sel.status}</span>
                </p>
                <button type="button" className="text-white/70 hover:text-white" onClick={() => setOpenSession(null)} aria-label="Close">✕</button>
              </div>
              <p className="mt-1.5 text-xs text-white/85">👤 {sel.host_name} · 📅 {dmy(sel.session_date)} · 🕐 {sel.start_time}{sel.end_time ? `–${sel.end_time}` : ""} · {sel.platform}</p>
              {sel.notes && <p className="mt-1 text-xs text-white/70">{sel.notes}</p>}
              {canManage && (
                <div className="mt-2 flex gap-2">
                  {sel.status === "scheduled" && (
                    <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
                      onClick={async () => { await api(`/live-sessions/${sel.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }); setOpenSession(null); void load(week); }}>
                      ✓ Mark completed
                    </button>
                  )}
                  {sel.status !== "cancelled" && (
                    <button type="button" className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
                      onClick={async () => { await api(`/live-sessions/${sel.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }); setOpenSession(null); void load(week); }}>
                      ✕ Cancel session
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* right rail */}
        {data.manager && (
          <div className="space-y-3">
            <div className="border-border rounded-lg border p-3">
              <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
                Unassigned requests {data.requests.length > 0 && <span className="bg-bear ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white">{data.requests.length}</span>}
              </p>
              {data.requests.length === 0
                ? <p className="text-muted-foreground mt-1.5 text-xs">No new requests.</p>
                : data.requests.map((q) => (
                  <div key={q.id} className="border-border mt-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
                    <p className="font-medium">{q.company ?? q.name}</p>
                    <p className="text-muted-foreground">{(q.category ?? "enquiry").replace(/_/g, " ")} · {dmy(q.created_at)}</p>
                    {canManage && (
                      <button type="button" className="text-gold-deep mt-1 text-xs font-medium underline"
                        onClick={() => openAssign({ client_name: q.company ?? q.name })}>
                        Schedule
                      </button>
                    )}
                  </div>
                ))}
            </div>
            <div className="border-border rounded-lg border p-3">
              <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">Available today</p>
              {data.available_today.length === 0
                ? <p className="text-muted-foreground mt-1.5 text-xs">Nobody free today.</p>
                : data.available_today.map((a) => (
                  <p key={a.id} className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="bg-bull inline-block h-2 w-2 rounded-full" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="text-muted-foreground shrink-0 capitalize">{a.role.replace(/_/g, " ")}</span>
                  </p>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* assignment modal (click-to-assign) */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]" onClick={() => setAssignOpen(false)}>
          <div className="bg-card border-border w-full max-w-md rounded-2xl border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold">New assignment</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="col-span-2 block">
                <span className={fieldLabel}>Client</span>
                <input className={inputClass} placeholder="client / brand" value={draft.client_name}
                  onChange={(e) => setDraft((d) => ({ ...d, client_name: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>Date *</span>
                <input type="date" className={inputClass} value={draft.session_date}
                  onChange={(e) => setDraft((d) => ({ ...d, session_date: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>Host *</span>
                <select className={inputClass} value={draft.host_user_id}
                  onChange={(e) => setDraft((d) => ({ ...d, host_user_id: e.target.value }))}>
                  <option value="">— pick —</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>Start *</span>
                <input type="time" className={inputClass} value={draft.start_time}
                  onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>End</span>
                <input type="time" className={inputClass} value={draft.end_time}
                  onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))} />
              </label>
              <label className="block">
                <span className={fieldLabel}>Platform</span>
                <select className={inputClass} value={draft.platform}
                  onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))}>
                  <option value="tiktok">TikTok</option><option value="shopee">Shopee</option><option value="other">Other</option>
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>Notes</span>
                <input className={inputClass} value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button type="button" className={btnClass} disabled={saving} onClick={() => void saveAssign()}>
                {saving ? "Scheduling…" : "Schedule"}
              </button>
              <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setAssignOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
