"use client";

/* v1.8.0 — reference-design dashboard cards: the attendance donut, today's
   assignments table, and the compact month-by-month bars. All fed by data
   the dashboard already loads (summary + revenue) or the roster endpoint. */

import { useEffect, useState } from "react";
import { SkelRows } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { Donut } from "@/components/ui/donut";
import { useSaveToast } from "@/components/ui/save-toast";
import { card, th, td, chipSuccess, chipWarn, chipNeutral } from "@/lib/ui-styles";
import { fmtRM, ym } from "@/lib/format";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff");
/* EN/BM at the display point only — getLang() re-reads per call, and the
   portal's language toggle re-renders the whole tree. */
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* ---- Attendance today (donut) ---- */
export function AttendanceDonutCard({ onTime, late, staffTotal, onOpen }: {
  onTime: number; late: number; staffTotal: number; onOpen?: () => void;
}) {
  const notIn = Math.max(0, staffTotal - onTime - late);
  return (
    <button type="button" onClick={onOpen} className={`${card} block w-full text-left transition-colors hover:border-primary`}>
      <p className="text-sm font-semibold">{L("Attendance today", "Kehadiran hari ini")}</p>
      <div className="mt-2">
        <Donut
          centerLabel={String(staffTotal)}
          centerSub={L("staff", "kakitangan")}
          /* v1.15.0: the ring uses the VALIDATED chart steps, not the status
             text tokens. Two reasons: --warning/--danger are not separable
             from each other (dE 2.8 deuteranopia, 9.9 normal vision), and in
             dark mode --success flips to a light text-grade green that reads
             wrong as a fill. --ring-* passes every check in both themes. */
          slices={[
            { label: L("On time", "Tepat masa"), value: onTime, color: "var(--ring-ontime)" },
            { label: L("Late", "Lewat"), value: late, color: "var(--ring-late)" },
            { label: L("Not clocked in", "Belum daftar masuk"), value: notIn, color: "var(--ring-absent)" },
          ]}
        />
      </div>
    </button>
  );
}

/* ---- Today's assignments (table) ---- */
interface RosterSessionLite {
  id: number; session_date: string; start_time: string; end_time: string | null;
  platform: string; status: string; client: string | null; host_name: string;
}

export function TodayAssignmentsCard({ onOpenRoster, canManage = false }: { onOpenRoster?: () => void; canManage?: boolean }) {
  const [sessions, setSessions] = useState<RosterSessionLite[] | null>(null);
  /* v1.23.6 (CEO: "On the dashboard, I cant update their status roster"):
     managers tap a status chip to open ✓ Done / ✕ Cancel (or put a finished
     one back to scheduled) right here — same PATCH the roster board uses,
     hosts get the same instant view read-only. */
  const [acting, setActing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.25.0: remembered-first — today's assignments paint instantly on any
     repeat open (roster data is not money, so no staleness flag needed). */
  const roster = useCachedApi<{ sessions: RosterSessionLite[]; days: string[] }>("/staff/roster");
  const load = roster.refresh;
  useEffect(() => {
    if (roster.loading) return;
    const todayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const all = roster.data?.sessions ?? [];
    setSessions(all.filter((s) => s.session_date === todayS && s.status !== "cancelled"));
  }, [roster.data, roster.loading]);
  const setStatus = async (id: number, status: "scheduled" | "completed" | "cancelled") => {
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/live-sessions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setBusy(false);
    if (!r.ok) { showToast(L("No change", "Tiada perubahan"), r.data?.error?.message ?? L("Could not update the session", "Sesi tidak dapat dikemas kini"), "notice"); return; }
    showToast(L("Session updated", "Sesi dikemas kini"), status === "completed" ? L("Marked done", "Ditanda selesai") : status === "cancelled" ? L("Session cancelled", "Sesi dibatalkan") : L("Back to scheduled", "Kembali kepada dijadualkan"));
    setActing(null);
    load();
  };
  const chipFor = (s: RosterSessionLite) => (
    <button type="button" disabled={!canManage}
      className={`${s.status === "completed" ? chipSuccess : chipWarn} shrink-0 whitespace-nowrap ${canManage ? "cursor-pointer hover:opacity-80" : ""}`}
      onClick={() => canManage && setActing(acting === s.id ? null : s.id)}
      aria-expanded={canManage ? acting === s.id : undefined}>
      {s.status === "completed" ? L("✓ done", "✓ selesai") : L("scheduled", "dijadualkan")}{canManage ? " ▾" : ""}
    </button>
  );
  const actions = (s: RosterSessionLite) => acting === s.id && canManage && (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {s.status === "scheduled" ? (
        <>
          <button type="button" disabled={busy} className="border-success text-success rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-success-soft"
            onClick={() => void setStatus(s.id, "completed")}>{L("✓ Mark done", "✓ Tanda selesai")}</button>
          <button type="button" disabled={busy} className="border-danger text-danger rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-danger-soft"
            onClick={() => void setStatus(s.id, "cancelled")}>{L("✕ Cancel session", "✕ Batal sesi")}</button>
        </>
      ) : (
        <button type="button" disabled={busy} className="border-border rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
          onClick={() => void setStatus(s.id, "scheduled")}>{L("Back to scheduled", "Kembali kepada dijadualkan")}</button>
      )}
    </div>
  );
  return (
    <div className={card}>
      {toastNode}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{L("Assignments today", "Tugasan hari ini")}</p>
        {onOpenRoster && (
          <button type="button" className="text-gold-deep text-xs font-medium underline" onClick={onOpenRoster}>
            {L("Open roster ↗", "Buka jadual bertugas ↗")}
          </button>
        )}
      </div>
      {!sessions ? (
        <SkelRows rows={3} className="mt-2" />
      ) : sessions.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">{L("No live sessions scheduled today.", "Tiada sesi langsung dijadualkan hari ini.")}</p>
      ) : (
        <>
          {/* v1.23.3 (CEO: "I saw on mobile view apps overflow"): a 4-column
              table cannot fit a 390px phone — its min-content width stretched
              the Dashboard to ~436px, the page panned sideways and EVERY card
              looked cut (iOS keeps the zoomed-out state on other tabs too).
              Phones get agenda-style rows — the roster's proven no-overflow
              pattern: fixed time column, truncating middle, shrink-proof chip. */}
          <div className="mt-2 sm:hidden">
            {sessions.slice(0, 8).map((s) => (
              <div key={s.id} className="border-border border-b py-2 last:border-0">
                <div className="flex items-center gap-2.5">
                  <span className="w-[52px] shrink-0 text-center">
                    <span className="block text-sm leading-tight font-bold tabular-nums">{s.start_time}</span>
                    {s.end_time && <span className="text-muted-foreground block text-[10px] leading-tight tabular-nums">–{s.end_time}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{s.client ?? s.platform}</span>
                    <span className="text-muted-foreground block truncate text-xs">{s.host_name.split(" ").slice(0, 2).join(" ")}</span>
                  </span>
                  {chipFor(s)}
                </div>
                <div className="pl-[62px]">{actions(s)}</div>
              </div>
            ))}
          </div>
          {/* sm and up: the reference table, defensively scrollable. */}
          <div className="mt-2 hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-border border-b">
                <th className={th}>{L("HOST", "HOS")}</th><th className={th}>{L("CLIENT", "KLIEN")}</th><th className={th}>{L("TIME", "MASA")}</th><th className={th}>{L("STATUS", "STATUS")}</th>
              </tr></thead>
              <tbody>
                {sessions.slice(0, 8).map((s) => (
                  <tr key={s.id} className="border-border border-b last:border-0">
                    <td className={td}>
                      <span className="bg-brand mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" aria-hidden>
                        {s.host_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      {s.host_name.split(" ")[0]}
                    </td>
                    <td className={td}><span className={chipNeutral}>{s.client ?? s.platform}</span></td>
                    <td className={`${td} tabular-nums whitespace-nowrap`}>{s.start_time}{s.end_time ? `–${s.end_time}` : ""}</td>
                    <td className={td}>
                      {chipFor(s)}
                      {actions(s)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ---- Month-by-month bars (this year, all channels) ---- */
export function MonthlyBarsCard({ months }: { months: { month: string; cents: number }[] }) {
  if (months.length === 0) return null;
  const max = Math.max(...months.map((m) => m.cents), 1);
  const best = months.reduce((a, m) => (m.cents > a.cents ? m : a), months[0]!);
  return (
    <div className={card}>
      <p className="text-sm font-semibold">{L("Sales by month", "Jualan mengikut bulan")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{L("Every channel · bar vs your best month.", "Semua saluran · bar berbanding bulan terbaik anda.")}</p>
      <div className="mt-3 flex items-end gap-1.5" style={{ height: 84 }} aria-hidden>
        {months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${ym(m.month)} · ${fmtRM(m.cents)}`}>
            <div className={`w-full rounded-t-md ${m.month === best.month ? "bg-gold-solid" : "bg-brand/25"}`}
              style={{ height: `${Math.max(6, (m.cents / max) * 68)}px` }} />
            <span className="text-muted-foreground text-[9px] tabular-nums">{m.month.slice(5)}</span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-1.5 text-[11px]">🏆 {L("Best", "Terbaik")}: {ym(best.month)} · {fmtRM(best.cents)}</p>
    </div>
  );
}
