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
import { btnSm, card, th, td, chipSuccess, chipWarn, chipNeutral } from "@/lib/ui-styles";
import { rowBtn, rowBtnDanger, rowBtnGood } from "@/components/ui/row-button";
import { fmtRM, ym } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { givenNames } from "@/lib/names";
import { AppIcon } from "@/components/ui/app-icon";
import { revealAnchor } from "@/components/portal/page-shared";
import type { DashSummary } from "@/components/portal/dashboard";
import attCss from "@/components/portal/attendance-today.module.css";

const api = makeApi("/staff");
/* EN/BM at the display point only — getLang() re-reads per call, and the
   portal's language toggle re-renders the whole tree. */
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* ---- v1.181.4: Attendance today, with its people ----
   The CEO, 24-09-2026: "attendance today cant see the data which is I want
   to view the data by clickable without go to the actual tabs". The card
   was one big <button> with no action behind it on the Attendance tab - it
   looked tappable and did nothing, and nothing on it could say WHO the 3,
   the 2 and the 2 were. Each legend line is now its own control and opens
   the names inside the card: first clock-in for on time and late, and for
   "not clocked in" the ones on approved leave are marked, so the absent
   and the excused are told apart at a glance. The names are fetched on the
   first tap (and again after a minute), from the endpoint built on the
   same rules as the counts beside it. */
type AttKind = "on_time" | "late" | "not_in";
interface AttPerson { id: number; name: string; position: string | null; first_in?: string; leave_type?: string | null }
interface AttWho { date: string; cutoff: string; on_time: AttPerson[]; late: AttPerson[]; not_in: AttPerson[] }

const LEAVE_WORD: Record<string, [string, string]> = {
  annual: ["annual leave", "cuti tahunan"], medical: ["medical leave", "cuti sakit"],
  emergency: ["emergency leave", "cuti kecemasan"], unpaid: ["unpaid leave", "cuti tanpa gaji"],
  replacement: ["replacement leave", "cuti ganti"],
};

export function AttendanceTodayCard({ onTime, late, staffTotal }: {
  onTime: number; late: number; staffTotal: number;
}) {
  const notIn = Math.max(0, staffTotal - onTime - late);
  const [open, setOpen] = useState<AttKind | null>(null);
  const [who, setWho] = useState<AttWho | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const slices: { key: AttKind; label: string; value: number; color: string }[] = [
    { key: "on_time", label: L("On time", "Tepat masa"), value: onTime, color: "var(--ring-ontime)" },
    { key: "late", label: L("Late", "Lewat"), value: late, color: "var(--ring-late)" },
    { key: "not_in", label: L("Not clocked in", "Belum daftar masuk"), value: notIn, color: "var(--ring-absent)" },
  ];
  const pick = async (k: AttKind) => {
    const next = open === k ? null : k;
    setOpen(next);
    if (!next || state === "loading") return;
    if (who && Date.now() - loadedAt < 60_000) return;
    setState("loading");
    const r = await api<AttWho>("/dashboard/attendance-today");
    if (r.ok && r.data) { setWho(r.data); setLoadedAt(Date.now()); setState("idle"); }
    else setState("error");
  };
  const list = open && who ? who[open] : [];
  const openLabel = slices.find((x) => x.key === open)?.label ?? "";
  return (
    <div className={card}>
      <p className={attCss.title}>{L("Attendance today", "Kehadiran hari ini")}</p>
      <div className={attCss.body}>
        <Donut
          hideLegend
          centerLabel={String(staffTotal)}
          centerSub={L("staff", "kakitangan")}
          /* v1.15.0: the validated chart steps, not the status text tokens -
             see the note that used to sit here; the colours are unchanged. */
          slices={slices.map(({ label, value, color }) => ({ label, value, color }))}
        />
        <ul className={attCss.legend}>
          {slices.map((x) => (
            <li key={x.key}>
              <button type="button" className={attCss.line}
                aria-expanded={open === x.key} aria-controls="att-today-who"
                onClick={() => void pick(x.key)}>
                <span className={attCss.dot} style={{ background: x.color }} aria-hidden />
                <span className={attCss.label}>{x.label}</span>
                <span className={attCss.count}>{x.value}</span>
                <span className={attCss.chev} aria-hidden>{open === x.key ? "▴" : "▾"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {!open && <p className={attCss.hint}>{L("Tap a line to see who.", "Ketik satu baris untuk lihat siapa.")}</p>}
      {open && (
        <div id="att-today-who" className={attCss.who} role="region" aria-label={openLabel} aria-busy={state === "loading" || undefined}>
          <p className={attCss.whoHead}>
            <span>{openLabel}</span>
            {open !== "not_in" && who && <span>{L(`on time = in by ${who.cutoff}`, `tepat masa = masuk sebelum ${who.cutoff}`)}</span>}
          </p>
          {state === "loading" && !who && <SkelRows rows={3} />}
          {state === "error" && <p className="erp-meta">{L("Could not load the names - tap the line again.", "Tidak dapat memuatkan nama - ketik baris itu sekali lagi.")}</p>}
          {who && (list.length === 0
            ? <p className="erp-meta">{L("Nobody.", "Tiada sesiapa.")}</p>
            : (
              <ul className={attCss.people}>
                {list.map((p) => {
                  const leave = p.leave_type ? LEAVE_WORD[p.leave_type] : null;
                  return (
                    <li key={p.id} className={attCss.person}>
                      <span className={attCss.name}>{p.name}</span>
                      {open === "not_in"
                        ? <span className={`${attCss.meta} ${leave ? attCss.excused : ""}`}>
                            {leave ? L(`On ${leave[0]}`, `Sedang ${leave[1]}`) : (p.position ?? "")}
                          </span>
                        : <span className={attCss.meta}>{L("in", "masuk")} {p.first_in}</span>}
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      )}
    </div>
  );
}

/* ---- v1.171.0: the company's attendance today, on the ATTENDANCE tab ----
   The CEO, 20-09-2026: *"clean off my dashboard and resort it based on it
   own function and properly put in on their own tabs!"*. The donut and the
   assignments list used to be the Dashboard's row three; they are the
   Attendance tab's now, for the management tier, under the monitor and
   above the roster they summarise. Same figures (the dashboard summary the
   pulse card also reads - remembered on the device, one request), same
   cards; "Open roster" scrolls to the board below instead of leaving the
   tab. Skeleton until the summary is known; the donut is not drawn from
   zeros while the answer is still in flight. */
export function CompanyAttendanceToday({ canManage = false }: { canManage?: boolean }) {
  const sum = useCachedApi<DashSummary>("/staff/dashboard/summary");
  const s = sum.data;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-4">
      {!s ? (
        <div className={card} aria-busy="true"><SkelRows rows={3} /></div>
      ) : (
        /* v1.177.2 - the donut needs all three to mean anything; without the
           attendance permission the server sends none of them, and drawing a
           0/0/0 ring would claim nobody clocked in. Say nothing instead. */
        s.attendance_on_time == null || s.attendance_late == null ? null : (
        <AttendanceTodayCard
          onTime={s.attendance_on_time}
          late={s.attendance_late}
          staffTotal={s.staff_total ?? 0}
        />
        )
      )}
      <TodayAssignmentsCard canManage={canManage} onOpenRoster={() => revealAnchor("roster-board")} />
    </div>
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
          <button type="button" disabled={busy} className={rowBtnGood}
            onClick={() => void setStatus(s.id, "completed")}>{L("✓ Mark done", "✓ Tanda selesai")}</button>
          <button type="button" disabled={busy} className={rowBtnDanger}
            onClick={() => void setStatus(s.id, "cancelled")}>{L("✕ Cancel session", "✕ Batal sesi")}</button>
        </>
      ) : (
        <button type="button" disabled={busy} className={rowBtn}
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
          <button type="button" className={btnSm} onClick={onOpenRoster}>
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
                    <span className="text-muted-foreground block truncate text-xs">{givenNames(s.host_name)}</span>
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
                      {givenNames(s.host_name)}
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
/* v1.171.0 - `bare`: drawn inside the Sales floor pill on Ecommerce, under a
   rule, with no card of its own (a card inside a card is what the CEO called
   messy). */
export function MonthlyBarsCard({ months, bare = false }: { months: { month: string; cents: number }[]; bare?: boolean }) {
  if (months.length === 0) return null;
  const max = Math.max(...months.map((m) => m.cents), 1);
  const best = months.reduce((a, m) => (m.cents > a.cents ? m : a), months[0]!);
  return (
    <div className={bare ? "border-border mt-4 border-t pt-4" : card}>
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
      <p className="text-muted-foreground mt-1.5 text-[11px]"><AppIcon name="trophy" className="mr-1 h-3 w-3" />{L("Best", "Terbaik")}: {ym(best.month)} · {fmtRM(best.cents)}</p>
    </div>
  );
}
