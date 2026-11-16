"use client";

/* v1.309.0 - LEAVE WORKSPACE 4.0 (the CEO, 15-11-2026: "approve as recommend
   and make sure it is correct flow", L-0 ... L-15 in
   claude/LEAVE-WORKSPACE-4.0-BLUEPRINT.md, five reference images).

   The pieces of the five views that are new in 4.0. Every figure is read
   from the server - nothing from the reference pictures:
     Overview          the team picture (ref 5): this month's applications,
                       what waits on you, who is available today (Attendance's
                       own day verdict, GET /staff/leave/availability), today's
                       and the next seven days' approved leave
     Apply Leave       a three-step form (ref 1): the server counts the days
                       (GET /staff/leave/quote - the roster, the holidays, a
                       half day), shows the balance before and after and the
                       route the request will be frozen with, then submits to
                       the one engine (POST /staff/leave). Nothing is promised
                       that the submission would refuse.
     My Leave          one balance card per capped type (ref 2), available =
                       entitled - approved - pending, the ledger behind it and
                       the replacement credits (read only - decided in
                       Attendance, L-8)
     Team Calendar     the side panels of ref 3 (availability, who is away by
                       department) beside the one month grid
     Approvals         the management tiles, the policy in force and the
                       approval queue (ref 4); the register stays below.

   Decisions stay where they were: PATCH /staff/leave/:id, from leave.tsx. */

import { useEffect, useMemo, useState } from "react";

import { PillSwitch } from "@/components/ui/panel"; // v1.325.0 - D-2
import { L, type LeaveReq, leaveTypeL } from "@/components/portal/page-shared";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { Donut } from "@/components/ui/donut";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { DrawerFoot, DrawerForm, DrawerPanel, DrawerSteps, SideDrawer, useDrawerClose } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { api, csrfFetch } from "@/lib/api";
import { dmy, mytToday } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnClass, btnGhost, btnSm, btnSmPrimary, card, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClass, inputClassSm, selectClass, textareaClass } from "@/lib/ui-styles";
import css from "./leave-page.module.css";
import l4 from "./leave4.module.css";

export type LeaveView4 = "overview" | "apply" | "mine" | "calendar" | "manage";
export const LEAVE_VIEWS: readonly LeaveView4[] = ["overview", "apply", "mine", "calendar", "manage"];
export const isLeaveView = (v: string | null): v is LeaveView4 => !!v && (LEAVE_VIEWS as readonly string[]).includes(v);

export type RouteStep = { n: number; approver: { id?: number; name: string; position: string | null; role?: string }; final: boolean };
export type RouteInfo = { kind: "manager" | "executive_record" | "routing_required"; steps: RouteStep[] } | null;
type Quote = {
  type: string; start: string; end: string; part: string; days: number;
  lines: { d: string; kind: "work" | "rest_day" | "holiday"; count: number; holiday: string | null }[];
  problem: { code: string; message: string } | null; unpaid: boolean;
  balance: { before: number; request: number; after: number; entitled: number; approved: number; pending: number } | null;
  needs_attachment: boolean; route: RouteInfo;
};
type Avail = { day: string; total: number; available: number; on_leave: number; off: number; pending: number };
type MonthLeave = { id: number; user_id: number; name: string; photo_key?: string | null; position?: string | null; department?: string | null; type: string | null; start_date: string; end_date: string; days: number; status: string };
export type Balance4 = { entitled: number; used: number; accrued?: number; adjust?: number; pending?: number; available?: number; capped?: boolean };
type Credit = { id: number; user_id: number; name: string; work_date: string; days: number; minutes: number | null; created_at: string; credited_by_name: string | null };
type Policy = { defaults: Record<string, number>; capped: string[]; unpaid: string[]; can_edit: boolean };

/** "Annual Leave" / "Cuti Tahunan" - the reference's own names */
export const typeName = (t: string | null | undefined) => { const n = leaveTypeL(t); return t ? L(`${n.charAt(0).toUpperCase()}${n.slice(1)} Leave`, `Cuti ${n.charAt(0).toUpperCase()}${n.slice(1)}`) : L("Leave", "Cuti"); };
const TERMINAL = ["approved", "rejected", "cancelled"];
const stateOf = (l: { stage?: string; status: string }) => l.stage ?? l.status;
const inProgress = (l: LeaveReq) => !TERMINAL.includes(stateOf(l));
/** the Malaysian day a UTC "YYYY-MM-DD HH:MM:SS" stamp falls on */
export const mytDayOf = (utc?: string | null) => (utc ? new Date(Date.parse(`${utc.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString().slice(0, 10) : "");
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nextMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); };
const pct = (n: number, d: number) => (d > 0 ? Math.round((n * 100) / d) : 0);
/** "24-09 – 25-09-2026": the year once when both ends share it */
export const period = (a: string, b: string) => (b === a ? dmy(a) : a.slice(0, 4) === b.slice(0, 4) ? `${dmy(a).slice(0, 5)} – ${dmy(b)}` : `${dmy(a)} – ${dmy(b)}`);

/** One plain GET, kept in component state only (never the device cache). */
function usePlain<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; status: number }>({ path: null, data: null, status: 0 });
  useEffect(() => {
    if (!path) return;
    let live = true;
    void api<T>(path).then((r) => { if (live) setState({ path, data: r.ok ? r.data : null, status: r.status }); });
    return () => { live = false; };
  }, [path]);
  return { data: state.path === path ? state.data : null, done: !path || state.path === path, status: state.path === path ? state.status : 0 };
}

function Head({ icon, tone, title, sub, action }: { icon: AppIconName; tone?: string; title: string; sub: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={css.head}>
      <div className={css.lead}>
        <span className={`${css.well} ${tone ?? css.gold}`}><AppIcon name={icon} /></span>
        <div className={css.headText}>
          <p className={css.title}>{title}</p>
          <p className={css.sub}>{sub}</p>
        </div>
      </div>
      {action && <button type="button" className={btnSm} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/* ---------- the route, drawn as the server answers it (never a generic picture) ---------- */
export function RouteList({ route, compact = false, withYou = false }: { route: RouteInfo; compact?: boolean; /** v1.326.0 - the Apply Leave drawer: the route starts with you, submitting */ withYou?: boolean }) {
  if (!route) return <p className={css.empty}>{L("The route could not be worked out - your request is still checked when you submit.", "Laluan tidak dapat ditentukan - permohonan anda tetap disemak semasa dihantar.")}</p>;
  if (route.kind === "executive_record") return <p className={l4.routeNote} data-testid="route-exec">{L("Executive Leave Record - you are at the top of the organisation: your leave is recorded with your authenticator code, nobody approves it. The COO, the CCO and HR are told.", "Rekod Cuti Eksekutif - anda di puncak organisasi: cuti anda direkod dengan kod pengesah anda, tiada sesiapa meluluskannya. COO, CCO dan HR dimaklumkan.")}</p>;
  if (route.kind === "routing_required") return <p className={l4.routeNote} data-testid="route-config">{L("Your reporting line is not set on the Organisation chart yet. You can still submit: HR or the CEO sets the line and routes the request - nobody approves it before then.", "Garis pelaporan anda belum ditetapkan pada carta Organisasi. Anda masih boleh menghantar: HR atau CEO menetapkannya dan menghalakan permohonan - tiada sesiapa meluluskannya sebelum itu.")}</p>;
  return (
    <ol className={`${l4.route} ${compact ? l4.routeCompact : ""} ${withYou ? l4.routeFlat : ""}`} data-testid="route-steps">
      {withYou && (
        <li className={l4.routeYou} data-testid="route-you">
          <span className={l4.routeDot} aria-hidden="true"><AppIcon name="success" /></span>
          <span className={l4.routeText}><strong>{L("You", "Anda")}</strong><span>{L("Submit the request", "Hantar permohonan")}</span></span>
        </li>
      )}
      {route.steps.map((s) => (
        <li key={s.n}>
          <span className={l4.routeDot} aria-hidden="true">{s.n}</span>
          <span className={l4.routeCard}>
            <Avatar name={properName(s.approver.name)} userId={s.approver.id} size="sm" />
            <span className={l4.routeText}>
              <strong>{properName(s.approver.name)}</strong>
              <span>{s.approver.position || L("Reporting line", "Garis pelaporan")}{s.final ? L(" · final approval", " · kelulusan akhir") : L(" · approves, then passes it up", " · meluluskan, kemudian menghantar ke atas")}</span>
            </span>
          </span>
        </li>
      ))}
      <li className={l4.routeInfo}>
        <span className={l4.routeDot} aria-hidden="true"><AppIcon name="info" /></span>
        <span className={l4.routeText}><strong>{L("HR check", "Semakan HR")}</strong><span>{L("HR may verify or flag - information only, it never approves or blocks", "HR boleh mengesahkan atau menanda - makluman sahaja, tidak meluluskan atau menyekat")}</span></span>
      </li>
    </ol>
  );
}

/* ================= OVERVIEW (ref 5) ================= */
export function LeaveOverview4({ userId, mine, all, company, loaded, hourly, open, onView }: {
  userId: number;
  mine: readonly LeaveReq[];
  /** the requests this person may see beyond their own (the chain's register, or those routed to them) */
  all: readonly LeaveReq[];
  /** true: the company picture (the approval chain); false: your own */
  company: boolean;
  loaded: boolean;
  hourly: boolean;
  open: (v: LeaveView4) => void;
  onView: (id: number) => void;
}) {
  const today = mytToday();
  const ym = today.slice(0, 7);
  const avail = usePlain<Avail>(`/staff/leave/availability?day=${today}`);
  const cur = usePlain<{ leave: MonthLeave[] }>(`/staff/leave/month?month=${ym}`);
  const nxt = usePlain<{ leave: MonthLeave[] }>(addDays(today, 7).slice(0, 7) !== ym ? `/staff/leave/month?month=${nextMonth(ym)}` : null);
  const scope = company ? all : mine;
  const apps = scope.filter((l) => mytDayOf(l.created_at).slice(0, 7) === ym || (!l.created_at && l.start_date.slice(0, 7) === ym));
  const count = (st: "approved" | "pending" | "rejected") => apps.filter((l) => (st === "pending" ? inProgress(l) : stateOf(l) === st)).length;
  /* what waits on YOU first (a team lead outside the chain decides the requests routed to them), then - for staff - your own still pending */
  const toAct = all.filter((l) => l.can_act === true && inProgress(l));
  const waiting = (company ? toAct : [...toAct, ...mine.filter(inProgress)]).slice(0, 6);
  const seen = new Set<number>();
  const monthLeave = [...(cur.data?.leave ?? []), ...(nxt.data?.leave ?? [])].filter((l) => { if (seen.has(l.id)) return false; seen.add(l.id); return l.status === "approved"; });
  const todayLeave = monthLeave.filter((l) => l.start_date <= today && l.end_date >= today);
  const until = addDays(today, 7);
  const upcoming = monthLeave.filter((l) => l.start_date > today && l.start_date <= until).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const a = avail.data;
  const typeChip = (t: string | null) => (t ? <span className={`${chipSmInfo} ${css.cap}`}>{typeName(t)}</span> : <span className={chipSmNeutral}>{L("On leave", "Bercuti")}</span>);

  return (
    <div className={l4.stack} data-testid="leave-overview4">
      <KpiRow label={company ? L(`The company's leave this month`, `Cuti syarikat bulan ini`) : L("My applications this month", "Permohonan saya bulan ini")}>
        <KpiTile icon="date" tone="blue" label={L("Applications", "Permohonan")} value={apps.length} busy={!loaded} sub={L("This month", "Bulan ini")} onClick={() => open(company ? "manage" : "mine")} />
        <KpiTile icon="success" tone="green" label={L("Approved", "Diluluskan")} value={count("approved")} busy={!loaded} sub={L(`${pct(count("approved"), apps.length)}% of applications`, `${pct(count("approved"), apps.length)}% daripada permohonan`)} />
        <KpiTile icon="pending" tone="gold" label={L("Pending", "Menunggu")} value={count("pending")} busy={!loaded} sub={L(`${pct(count("pending"), apps.length)}% of applications`, `${pct(count("pending"), apps.length)}% daripada permohonan`)} />
        <KpiTile icon="error" tone="red" label={L("Rejected", "Ditolak")} value={count("rejected")} busy={!loaded} sub={L(`${pct(count("rejected"), apps.length)}% of applications`, `${pct(count("rejected"), apps.length)}% daripada permohonan`)} />
        <KpiTile icon="holiday" tone="purple" label={L("On Leave Today", "Bercuti Hari Ini")} value={a?.on_leave ?? 0} busy={!avail.done} sub={a ? L(`of ${a.total} staff (${pct(a.on_leave, a.total)}%)`, `daripada ${a.total} kakitangan (${pct(a.on_leave, a.total)}%)`) : ""} onClick={() => open("calendar")} />
      </KpiRow>

      <div className={l4.split}>
        <section className={card} aria-label={L("Pending requests", "Permohonan menunggu")} data-testid="ov-pending">
          <Head icon="pending" title={company || toAct.length > 0 ? L("Pending Requests", "Permohonan Menunggu") : L("My Pending Requests", "Permohonan Saya Yang Menunggu")}
            sub={company ? L("Leave applications that require your attention.", "Permohonan cuti yang memerlukan perhatian anda.") : L("Your applications still waiting for a decision.", "Permohonan anda yang masih menunggu keputusan.")}
            action={{ label: L("View all", "Lihat semua"), onClick: () => open(company ? "manage" : "mine") }} />
          {!loaded ? <SkelRows rows={3} /> : waiting.length === 0 ? (
            <p className={css.empty}>{company ? L("Nothing waits on you.", "Tiada yang menunggu anda.") : L("Nothing pending.", "Tiada yang menunggu.")}</p>
          ) : (
            <>
            <div className={`erp-desktop-only ${css.tWrap}`}>
              <table className={css.t}>
                <thead><tr><th>{L("Staff", "Kakitangan")}</th><th>{L("Leave type", "Jenis cuti")}</th><th>{L("Period", "Tempoh")}</th><th className={css.num}>{L("Days", "Hari")}</th><th>{L("Submitted", "Dihantar")}</th><th><span className={css.srOnly}>{L("Action", "Tindakan")}</span></th></tr></thead>
                <tbody>
                  {waiting.map((l) => {
                    const who = properName(l.user_full || l.user_name || "") || L("You", "Anda");
                    return (
                      <tr key={l.id}>
                        <td><span className={l4.who}><Avatar name={who} userId={l.user_id ?? userId} size="sm" /><span><strong>{who}</strong><span className={css.sub}>{l.user_department || l.user_position || ""}</span></span></span></td>
                        <td className={css.cap}>{typeName(l.type)}</td>
                        <td className={css.muted}>{period(l.start_date, l.end_date)}</td>
                        <td className={css.num}>{l.days}</td>
                        <td className={css.muted}>{dmy(mytDayOf(l.created_at) || l.start_date).slice(0, 5)}</td>
                        <td><button type="button" className={l.can_act ? btnSmPrimary : btnSm} onClick={() => onView(l.id)}>{l.can_act ? L("Review", "Semak") : L("View", "Lihat")}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* a phone reads the same requests as short cards */}
            <ul className={`erp-phone-only ${css.rows}`}>
              {waiting.map((l) => {
                const who = properName(l.user_full || l.user_name || "") || L("You", "Anda");
                return (
                  <li key={l.id} className={css.row}>
                    <Avatar name={who} userId={l.user_id ?? userId} size="sm" />
                    <span className={css.rowMain}><span className={css.name}>{who}</span><span className={css.sub}>{typeName(l.type)} · {period(l.start_date, l.end_date)} · {l.days} {L("day(s)", "hari")}</span></span>
                    <button type="button" className={l.can_act ? btnSmPrimary : btnSm} onClick={() => onView(l.id)}>{l.can_act ? L("Review", "Semak") : L("View", "Lihat")}</button>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </section>
        <TeamAvailability day={today} data={a} done={avail.done} />
      </div>

      <div className={l4.split2}>
        <section className={card} aria-label={L("Today's leave", "Cuti hari ini")} data-testid="ov-today">
          <Head icon="date" title={L("Today's Leave", "Cuti Hari Ini")} sub={L("Staff who are on approved leave today.", "Kakitangan yang bercuti (diluluskan) hari ini.")} />
          {!cur.done ? <SkelRows rows={2} /> : todayLeave.length === 0 ? <p className={css.empty}>{L("Nobody is on leave today.", "Tiada sesiapa bercuti hari ini.")}</p> : (
            <ul className={css.rows}>
              {todayLeave.map((l) => (
                <li key={l.id} className={css.row}>
                  <Avatar name={properName(l.name)} photoKey={l.photo_key} size="sm" />
                  <span className={css.rowMain}><span className={css.name}>{properName(l.name)}</span><span className={css.sub}>{l.department || l.position || ""}</span></span>
                  {typeChip(l.type)}
                  <span className={css.rowEnd}><span>{period(l.start_date, l.end_date)}</span><span className={css.sub}>{l.days} {L("day(s)", "hari")}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card} aria-label={L("Upcoming leave", "Cuti akan datang")} data-testid="ov-upcoming">
          <Head icon="time" tone={css.blue} title={L("Upcoming Leave (Next 7 Days)", "Cuti Akan Datang (7 Hari)")} sub={L("Approved leave in the next 7 days.", "Cuti diluluskan dalam 7 hari akan datang.")} />
          {!(cur.done && nxt.done) ? <SkelRows rows={2} /> : upcoming.length === 0 ? <p className={css.empty}>{L("No approved leave in the next 7 days.", "Tiada cuti diluluskan dalam 7 hari akan datang.")}</p> : (
            <ul className={css.rows}>
              {upcoming.map((l) => (
                <li key={l.id} className={css.row}>
                  <Avatar name={properName(l.name)} photoKey={l.photo_key} size="sm" />
                  <span className={css.rowMain}><span className={css.name}>{properName(l.name)}</span><span className={css.sub}>{l.department || l.position || ""}</span></span>
                  {typeChip(l.type)}
                  <span className={css.rowEnd}><span>{period(l.start_date, l.end_date)}</span><span className={css.sub}>{l.days} {L("day(s)", "hari")}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {hourly && <p className={css.note}>{L("You are a part-time host, paid by the hour: there is no leave to apply for. The calendar still shows who is away.", "Anda hos sambilan yang dibayar mengikut jam: tiada cuti untuk dimohon. Kalendar masih menunjukkan siapa yang bercuti.")}</p>}
    </div>
  );
}

/** Today's (or a day's) availability, from Attendance's own day verdict. */
export function TeamAvailability({ day, data, done }: { day: string; data: Avail | null; done: boolean }) {
  const t = data?.total ?? 0;
  return (
    <section className={card} aria-label={L("Team availability", "Ketersediaan pasukan")} data-testid="team-availability">
      <Head icon="users" title={L("Team Availability", "Ketersediaan Pasukan")} sub={day === mytToday() ? L("Today's team status.", "Status pasukan hari ini.") : L(`Status on ${dmy(day)}.`, `Status pada ${dmy(day)}.`)} />
      {!done ? <SkelRows rows={3} /> : !data ? <p className={css.empty}>{L("Availability could not be read.", "Ketersediaan tidak dapat dibaca.")}</p> : (
        <div className={l4.avail}>
          <Donut size={128} hideLegend centerLabel={`${data.available}/${t}`} centerSub={L("Available", "Tersedia")}
            slices={[
              { label: L("Available", "Tersedia"), value: data.available, color: "var(--success)" },
              { label: L("On leave", "Bercuti"), value: data.on_leave, color: "var(--info)" },
              { label: L("Off day / holiday", "Hari rehat / cuti umum"), value: data.off, color: "var(--border)" },
            ]} />
          <ul className={l4.legend}>
            <li><span className={`${l4.key} ${l4.kAvail}`} aria-hidden="true" />{L("Available", "Tersedia")}<strong>{data.available}</strong><span>{pct(data.available, t)}%</span></li>
            <li><span className={`${l4.key} ${l4.kLeave}`} aria-hidden="true" />{L("On Leave", "Bercuti")}<strong>{data.on_leave}</strong><span>{pct(data.on_leave, t)}%</span></li>
            <li><span className={`${l4.key} ${l4.kOff}`} aria-hidden="true" />{L("Off Day / Holiday", "Hari Rehat / Cuti Umum")}<strong>{data.off}</strong><span>{pct(data.off, t)}%</span></li>
            <li><span className={`${l4.key} ${l4.kPend}`} aria-hidden="true" />{L("Pending (still working)", "Menunggu (masih bekerja)")}<strong>{data.pending}</strong><span /></li>
          </ul>
        </div>
      )}
    </section>
  );
}

/* ================= APPLY LEAVE (ref 1) ================= */
type Submitted = { id?: number; stage?: string; route?: string; approver?: string; days?: number; queued?: boolean };
export function ApplyLeave4({ types, onSubmitted, toast, submit }: {
  types: readonly string[];
  onSubmitted: () => void;
  toast: (title: string, sub?: string, v?: "success" | "notice" | "error") => void;
  /** POST /staff/leave through the page's own sender (the step-up for an Executive Leave Record, the offline queue) */
  submit: (body: Record<string, unknown>) => Promise<{ ok: boolean; queued?: boolean; data: (Submitted & { error?: { message?: string } }) | null }>;
}) {
  const closeDrawer = useDrawerClose(); // v1.326.0 - Cancel closes the drawer (and asks first if anything was typed)
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [f, setF] = useState({ type: "annual", start: "", end: "", half: "" as "" | "first_half" | "second_half", reason: "" });
  const [file, setFile] = useState<{ media_id: number; name: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Submitted | null>(null);
  const end = f.end || f.start;
  const halfOk = !!f.start && end === f.start;
  const half = halfOk ? f.half : "";
  /* the server's preview for exactly these choices; a stale answer is never shown */
  const qs = f.start && end >= f.start ? `type=${encodeURIComponent(f.type)}&start=${f.start}&end=${end}${half ? `&part=${half}` : ""}` : "";
  const [answer, setAnswer] = useState<{ qs: string; quote: Quote | null }>({ qs: "", quote: null });
  useEffect(() => {
    if (!qs) return;
    let live = true;
    const t = window.setTimeout(() => {
      void api<Quote & { error?: { message?: string } }>(`/staff/leave/quote?${qs}`).then((r) => {
        if (!live) return;
        const d = r.data;
        setAnswer({ qs, quote: r.ok && d ? d : d?.error ? { type: f.type, start: f.start, end, part: half || "full", days: 0, lines: [], problem: { code: "invalid_input", message: d.error.message ?? "" }, unpaid: false, balance: null, needs_attachment: false, route: null } : null });
      });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [qs, f.type, f.start, end, half]);
  const quoting = !!qs && answer.qs !== qs;
  const quote = qs && answer.qs === qs ? answer.quote : null;
  const reasonLen = f.reason.trim().length;
  const needFile = f.type === "medical";
  const ready = !!quote && !quote.problem && quote.days > 0 && reasonLen >= 5 && reasonLen <= 500 && (!needFile || !!file) && !uploading && !quoting;
  const missing = !f.start ? L("Choose the dates", "Pilih tarikh")
    : quote?.problem ? quote.problem.message
    : reasonLen < 5 ? L("Write the reason (at least 5 characters)", "Tulis sebabnya (sekurang-kurangnya 5 aksara)")
    : needFile && !file ? L("Attach the medical certificate", "Lampirkan sijil perubatan") : "";

  const upload = async (fl: File | null | undefined) => {
    if (!fl) return;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(fl.type)) { toast(L("Not attached", "Tidak dilampirkan"), L("PDF, JPG or PNG files only", "Fail PDF, JPG atau PNG sahaja"), "notice"); return; }
    if (fl.size > 10 * 1048576) { toast(L("Not attached", "Tidak dilampirkan"), L("The file is larger than 10 MB", "Fail melebihi 10 MB"), "notice"); return; }
    setUploading(true);
    try {
      const res = await csrfFetch(`/api/v1/staff/leave/attachment`, { method: "POST", body: fl, headers: { "Content-Type": fl.type, "X-File-Name": fl.name.slice(0, 160) } });
      const j = (await res.json().catch(() => null)) as { media_id?: number; error?: { message?: string } } | null;
      if (!res.ok || !j?.media_id) { toast(L("Not attached", "Tidak dilampirkan"), j?.error?.message ?? L("The upload did not finish - try again", "Muat naik tidak selesai - cuba lagi"), "notice"); return; }
      setFile({ media_id: j.media_id, name: fl.name, size: fl.size });
    } finally { setUploading(false); }
  };
  const send = async () => {
    if (!ready || busy || !quote) return;
    setBusy(true);
    try {
      const r = await submit({ type: f.type, start_date: f.start, end_date: end, day_part: half || "full", reason: f.reason.trim(), ...(file ? { mc_media_id: file.media_id } : {}) });
      if (!r.ok && !r.queued) { toast(L("Not sent", "Tidak dihantar"), r.data?.error?.message ?? L("The server refused the request", "Pelayan menolak permohonan"), "error"); return; } /* v1.329.0 - a refusal waits for OK */
      setDone({ ...(r.data ?? {}), queued: r.queued, days: r.data?.days ?? quote.days });
      setStep(3);
      onSubmitted();
    } finally { setBusy(false); }
  };
  const reset = () => { setF({ type: "annual", start: "", end: "", half: "", reason: "" }); setFile(null); setDone(null); setAnswer({ qs: "", quote: null }); setStep(1); };
  const linesNote = quote ? quote.lines.filter((x) => x.kind !== "work").map((x) => x.kind === "holiday" ? `${dmy(x.d)} ${x.holiday ?? ""}`.trim() : L(`${dmy(x.d)} rest day`, `${dmy(x.d)} hari rehat`)) : [];
  const STEPS = [L("Leave Details", "Butiran Cuti"), L("Review", "Semak"), L("Submitted", "Dihantar")];

  /* v1.326.0 (the CEO's "Improve Leave → Apply Leave", 16-11-2026) - the form drawer:
     the steps in the drawer's step row, the fields beside the live balance impact
     and the approval route (DrawerForm), Cancel / Review pinned at the foot
     (DrawerFoot). The same state, the same checks, the same quote and the same
     POST as before; nothing here decides a figure or a route - the server's
     preview (GET /staff/leave/quote) does. */
  const fmtDays = (n: number) => `${n} ${n === 1 ? L("day", "hari") : L("days", "hari")}`;
  const impact = (
    <DrawerPanel icon="balance" title={L("Leave Balance Impact", "Kesan Baki Cuti")} sub={L("How this request changes your balance.", "Bagaimana permohonan ini mengubah baki anda.")} label={L("Leave balance impact", "Kesan baki cuti")} testid="apply-impact">
      {quoting ? <SkelRows rows={3} /> : !quote ? <p className={css.empty}>{L("Choose the type and the dates to see the effect.", "Pilih jenis dan tarikh untuk melihat kesannya.")}</p>
        : quote.balance ? (
          <ul className={l4.impact}>
            <li><span>{typeName(f.type)} {L("balance (before)", "baki (sebelum)")}</span><strong>{fmtDays(quote.balance.before)}</strong></li>
            <li className={l4.minus}><span>{L("This request", "Permohonan ini")}</span><strong>− {fmtDays(quote.problem ? 0 : quote.days)}</strong></li>
            <li className={`${l4.after} ${(quote.problem ? quote.balance.before : quote.balance.after) < 0 ? l4.neg : ""}`}><span>{typeName(f.type)} {L("balance (after)", "baki (selepas)")}</span><strong data-testid="impact-after">{fmtDays(quote.problem ? quote.balance.before : quote.balance.after)}</strong></li>
            {quote.balance.pending > 0 && <li className={css.sub}><span>{L(`Includes ${quote.balance.pending} day(s) already pending`, `Termasuk ${quote.balance.pending} hari yang sedang menunggu`)}</span><span /></li>}
          </ul>
        ) : <p className={css.sub} data-testid="impact-unpaid">{quote.unpaid ? L("Unpaid leave - no balance to use up. Each day is deducted at 1/26 of the monthly wage.", "Cuti tanpa gaji - tiada baki digunakan. Setiap hari dipotong 1/26 daripada gaji bulanan.") : L("This type has no yearly ceiling.", "Jenis ini tiada had tahunan.")}</p>}
    </DrawerPanel>
  );
  const route = (
    <DrawerPanel icon="users" title={L("Approval Route", "Laluan Kelulusan")} sub={L("Who decides this request, in order.", "Siapa memutuskan permohonan ini, mengikut urutan.")} label={L("Approval route", "Laluan kelulusan")} testid="apply-route">
      {quoting ? <SkelRows rows={2} /> : quote ? <RouteList route={quote.route} withYou /> : <p className={css.empty}>{L("Choose the dates to see who approves it.", "Pilih tarikh untuk melihat siapa yang meluluskannya.")}</p>}
    </DrawerPanel>
  );

  return (
    <div data-testid="apply4">
      <DrawerSteps steps={STEPS} current={step} label={L("Steps", "Langkah")} testid="apply-steps" />
      {step === 3 && done ? (
        <>
          <div className={l4.doneBox} data-testid="apply-done" role="status">
            <AppIcon name={done.queued ? "pending" : "success"} />
            <p className={css.title}>{done.queued ? L("Kept on this phone - no signal", "Disimpan pada telefon ini - tiada isyarat") : L("Leave request submitted", "Permohonan cuti dihantar")}</p>
            <p className={css.sub}>
              {done.queued ? L("It is sent the moment you are back online; nothing is requested yet.", "Ia dihantar sebaik sahaja anda kembali dalam talian; belum dimohon lagi.")
                : `${typeName(f.type)} · ${period(f.start, end)} · ${done.days ?? ""} ${L("day(s)", "hari")} · ${done.route === "executive_record" ? L("recorded (Executive Leave Record)", "direkod (Rekod Cuti Eksekutif)") : done.route === "routing_required" ? L("HR or the CEO routes it to your manager", "HR atau CEO menghalakannya kepada pengurus anda") : L(`waiting for ${properName(done.approver ?? "")}`, `menunggu ${properName(done.approver ?? "")}`)}`}
            </p>
          </div>
          <DrawerFoot testid="apply-actions">
            {closeDrawer && <button type="button" className={btnGhost} onClick={closeDrawer} data-testid="apply-close">{L("Close", "Tutup")}</button>}
            <button type="button" className={btnClass} onClick={reset}>{L("Apply for another", "Mohon yang lain")}</button>
          </DrawerFoot>
        </>
      ) : (
        <DrawerForm testid="apply-form" aside={<>{impact}{route}</>}>
          <label className="erp-field">
            <span className="erp-label" data-required="">{L("Leave Type", "Jenis Cuti")}</span>
            <select className={selectClass} value={f.type} disabled={step === 2} onChange={(e) => setF({ ...f, type: e.target.value })} data-testid="apply-type">
              {types.map((t) => <option key={t} value={t}>{typeName(t)}{["unpaid", "emergency"].includes(t) ? L(" — unpaid", " — tanpa gaji") : ""}</option>)}
            </select>
          </label>
          <div className={l4.dates}>
            <fieldset className={`erp-field ${l4.rangeSet}`}>
              <legend className="erp-label" data-required="">{L("Date Range", "Julat Tarikh")}</legend>
              <span className={l4.range}>
                <input type="date" className={inputClass} value={f.start} disabled={step === 2} aria-label={L("First day", "Hari pertama")} data-testid="apply-start"
                  onChange={(e) => setF({ ...f, start: e.target.value, end: !f.end || f.end < e.target.value ? e.target.value : f.end })} />
                <span className={l4.to} aria-hidden="true">–</span>
                <input type="date" className={inputClass} value={f.end} min={f.start || undefined} disabled={step === 2} aria-label={L("Last day", "Hari terakhir")} data-testid="apply-end"
                  onChange={(e) => setF({ ...f, end: e.target.value })} />
              </span>
            </fieldset>
            <div className="erp-field">
              <span className="erp-label">{L("Working Days", "Hari Bekerja")}</span>
              <span className={l4.days} data-testid="apply-days" aria-live="polite">
                <AppIcon name="date" />
                <strong>{quoting ? "…" : quote && !quote.problem ? fmtDays(quote.days) : "—"}</strong>
              </span>
            </div>
          </div>
          {halfOk && (
            /* v1.325.0 (Global UI System D-2) - the one switch; on the review step it is read only */
            <div className={l4.halfRow}><PillSwitch testid="apply-half" label={L("Half day", "Separuh hari")} value={f.half || "full"}
              onChange={(k) => setF({ ...f, half: k === "full" ? "" : k })}
              options={[["full", L("Full day", "Sehari penuh")], ["first_half", L("First half", "Separuh pertama")], ["second_half", L("Second half", "Separuh kedua")]] as const}
              disabled={step === 2 ? { full: L("Back to change it", "Kembali untuk mengubahnya"), first_half: L("Back to change it", "Kembali untuk mengubahnya"), second_half: L("Back to change it", "Kembali untuk mengubahnya") } : undefined} /></div>
          )}
          {quote && !quote.problem && linesNote.length > 0 && <p className="erp-help" data-testid="apply-excluded">{L("Not counted: ", "Tidak dikira: ")}{linesNote.join(" · ")}</p>}
          {quote?.problem && <p className={l4.problem} role="alert" data-testid="apply-problem">{quote.problem.message}</p>}
          <label className="erp-field">
            <span className="erp-label" data-required="">{L("Reason", "Sebab")}</span>
            <textarea className={textareaClass} rows={4} maxLength={500} value={f.reason} disabled={step === 2} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="apply-reason"
              placeholder={L("State the reason for your leave - your approver reads it", "Nyatakan sebab cuti anda - pelulus anda membacanya")} />
            <span className={l4.counter}>{f.reason.length} / 500</span>
          </label>
          <div className="erp-field">
            <span className="erp-label" data-required={needFile ? "" : undefined}>{L("Attachment", "Lampiran")} {!needFile && <em>{L("(Optional)", "(Pilihan)")}</em>}</span>
            {!file ? (
              <label className="erp-dropzone">
                <span className="erp-dropzone-icon"><AppIcon name="upload" /></span>
                <span className="erp-dropzone-text"><strong>{uploading ? L("Uploading…", "Memuat naik…") : L("Upload file", "Muat naik fail")}</strong><small>{needFile ? L("Medical certificate - ", "Sijil perubatan - ") : ""}PDF, JPG {L("or", "atau")} PNG · {L("Max 10 MB", "Maks 10 MB")}</small></span>
                <span className={`${btnSm} erp-dropzone-btn`}>{L("Choose file", "Pilih fail")}</span>
                <input type="file" accept="application/pdf,image/jpeg,image/png" className={css.srOnly} disabled={uploading || step === 2} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} data-testid="apply-file" />
              </label>
            ) : (
              <div className="erp-file-chip" data-testid="apply-file-chip">
                <AppIcon name="document" />
                <span><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></span>
                {step === 1 && <button type="button" className={btnSm} aria-label={L("Remove the attachment", "Buang lampiran")} onClick={() => setFile(null)}><AppIcon name="error" /></button>}
              </div>
            )}
          </div>
          <DrawerFoot testid="apply-actions">
            {step === 1 && missing && <span className="erp-meta" data-testid="apply-missing">{missing}</span>}
            {step === 1 ? (
              <>
                <button type="button" className={btnGhost} onClick={closeDrawer ?? reset} data-testid="apply-cancel">{L("Cancel", "Batal")}</button>
                <button type="button" className={btnClass} disabled={!ready} onClick={() => setStep(2)} data-testid="apply-next">{L("Review", "Semak")} <AppIcon name="next" /></button>
              </>
            ) : (
              <>
                <button type="button" className={btnGhost} onClick={() => setStep(1)} data-testid="apply-back"><AppIcon name="previous" /> {L("Back", "Kembali")}</button>
                <button type="button" className={btnClass} disabled={!ready || busy} onClick={() => void send()} data-testid="apply-submit">{busy ? L("Sending…", "Menghantar…") : L("Submit request", "Hantar permohonan")}</button>
              </>
            )}
          </DrawerFoot>
        </DrawerForm>
      )}
    </div>
  );
}

/* ================= MY LEAVE: the balance (ref 2) ================= */
export function MyBalances4({ balances, loaded, userId }: { balances: Record<string, Balance4>; loaded: boolean; userId: number }) {
  const [details, setDetails] = useState(false);
  const credits = usePlain<{ credits: Credit[] }>(details ? `/staff/leave/replacement-credits?user_id=${userId}` : null);
  const year = mytToday().slice(0, 4);
  const CAPPED = ["annual", "medical", "replacement"] as const;
  const icon: Record<string, AppIconName> = { annual: "date", medical: "verify", replacement: "refresh" };
  const avail = (t: string) => { const b = balances[t]; return b?.available ?? Math.max(0, (b?.entitled ?? 0) + (b?.adjust ?? 0) - (b?.used ?? 0)); };
  const total = (t: string) => { const b = balances[t]; return (b?.entitled ?? 0) + (b?.adjust ?? 0); };
  return (
    <section className={card} aria-label={L("My leave balance", "Baki cuti saya")} data-testid="my-balance">
      <Head icon="balance" title={L("My Leave Balance", "Baki Cuti Saya")} sub={L(`Your current leave balance for ${year}.`, `Baki cuti semasa anda bagi ${year}.`)} action={{ label: L("View details", "Lihat butiran"), onClick: () => setDetails(true) }} />
      {!loaded ? <SkelRows rows={2} /> : (
        <>
          <ul className={l4.bal}>
            {CAPPED.map((t) => {
              const b = balances[t];
              const tot = total(t);
              const left = avail(t);
              return (
                <li key={t} className={l4.balCard} data-testid={`bal-${t}`}>
                  <span className={`${css.balIcon} ${css[`bal_${t}`] ?? ""}`} aria-hidden="true"><AppIcon name={icon[t] ?? "date"} /></span>
                  <span className={l4.balText}>
                    <span className={l4.balHead}><strong>{typeName(t)}</strong><span><b>{left}</b> / {tot} {L("days", "hari")}</span></span>
                    <span className={css.track} aria-hidden="true"><span className={`${css.fill} ${css[`fill_${t}`] ?? ""}`} style={{ width: `${tot > 0 ? Math.min(100, Math.max(0, (left / tot) * 100)) : 0}%` }} /></span>
                    <span className={css.sub}>{(b?.pending ?? 0) > 0 ? L(`${b?.pending} pending · `, `${b?.pending} menunggu · `) : ""}{t === "annual" && b?.accrued != null ? L(`${b.accrued} accrued so far`, `${b.accrued} terkumpul setakat ini`) : t === "replacement" ? L("Earned from rest days worked", "Diperoleh daripada hari rehat bekerja") : L(`${b?.used ?? 0} used`, `${b?.used ?? 0} digunakan`)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className={css.sub} data-testid="bal-unpaid">{L(`Emergency and unpaid leave: no limit · ${(balances.emergency?.used ?? 0) + (balances.unpaid?.used ?? 0)} day(s) taken this year · each day is deducted at 1/26 of the monthly wage.`, `Cuti kecemasan dan tanpa gaji: tiada had · ${(balances.emergency?.used ?? 0) + (balances.unpaid?.used ?? 0)} hari diambil tahun ini · setiap hari dipotong 1/26 daripada gaji bulanan.`)}</p>
        </>
      )}
      <SideDrawer open={details} onClose={() => setDetails(false)} title={L("My leave ledger", "Lejar cuti saya")} subtitle={year}>
        <div className={l4.ledger} data-testid="ledger">
          <table className={css.t}>
            <thead><tr><th>{L("Type", "Jenis")}</th><th className={css.num}>{L("Entitled", "Layak")}</th><th className={css.num}>{L("Adjust", "Pelarasan")}</th><th className={css.num}>{L("Approved", "Diluluskan")}</th><th className={css.num}>{L("Pending", "Menunggu")}</th><th className={css.num}>{L("Available", "Tersedia")}</th></tr></thead>
            <tbody>
              {CAPPED.map((t) => { const b = balances[t]; return (
                <tr key={t}><td className={css.cap}>{typeName(t)}</td><td className={css.num}>{b?.entitled ?? 0}</td><td className={css.num}>{b?.adjust ?? 0}</td><td className={css.num}>{b?.used ?? 0}</td><td className={css.num}>{b?.pending ?? 0}</td><td className={css.num}><strong>{avail(t)}</strong></td></tr>
              ); })}
            </tbody>
          </table>
          <p className={css.sub}>{L("Available = entitled + adjustments − approved − pending. Annual leave accrues through the year; replacement leave is credited from rest days worked (decided in Attendance).", "Tersedia = layak + pelarasan − diluluskan − menunggu. Cuti tahunan terkumpul sepanjang tahun; cuti gantian dikreditkan daripada hari rehat bekerja (diputuskan dalam Kehadiran).")}</p>
          <p className={css.title}>{L("Replacement credits", "Kredit gantian")}</p>
          {!credits.done ? <SkelRows rows={2} /> : (credits.data?.credits ?? []).length === 0 ? <p className={css.empty}>{L("No replacement credits yet.", "Belum ada kredit gantian.")}</p> : (
            <ul className={css.rows} data-testid="credits">
              {(credits.data?.credits ?? []).map((c) => (
                <li key={c.id} className={css.row}>
                  <span className={css.rowMain}><span className={css.name}>{L("Rest day worked", "Hari rehat bekerja")} · {dmy(c.work_date)}</span><span className={css.sub}>{L("Credited by", "Dikreditkan oleh")} {properName(c.credited_by_name ?? "") || "—"} · {dmy(mytDayOf(c.created_at))}</span></span>
                  <span className={chipSmSuccess}>+{c.days} {L("day", "hari")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SideDrawer>
    </section>
  );
}

/* ================= TEAM CALENDAR: the side panels (ref 3) ================= */
export function TeamSide({ ym, day }: { ym: string; day: string }) {
  const avail = usePlain<Avail>(`/staff/leave/availability?day=${day}`);
  const month = usePlain<{ leave: MonthLeave[] }>(`/staff/leave/month?month=${ym}`);
  const [openDept, setOpenDept] = useState<string | null>(null);
  const away = (month.data?.leave ?? []).filter((l) => l.status === "approved");
  const depts = useMemo(() => {
    const m = new Map<string, MonthLeave[]>();
    for (const l of away) { const k = (l.department ?? "").trim() || L("No department", "Tiada jabatan"); m.set(k, [...(m.get(k) ?? []), l]); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [away]);
  return (
    <div className={l4.side}>
      <TeamAvailability day={day} data={avail.data} done={avail.done} />
      <section className={card} aria-label={L("Who is away by department", "Siapa bercuti mengikut jabatan")} data-testid="away-by-dept">
        <Head icon="users" title={L("Who's Away by Department", "Siapa Bercuti Mengikut Jabatan")} sub={L("Team members on approved leave this month.", "Ahli pasukan yang bercuti (diluluskan) bulan ini.")} />
        {!month.done ? <SkelRows rows={3} /> : depts.length === 0 ? <p className={css.empty}>{L("Nobody has approved leave this month.", "Tiada cuti diluluskan bulan ini.")}</p> : (
          <ul className={l4.depts}>
            {depts.map(([d, list]) => {
              const people = new Set(list.map((l) => l.user_id)).size;
              const isOpen = openDept === d;
              return (
                <li key={d}>
                  <button type="button" className={l4.deptHead} aria-expanded={isOpen} onClick={() => setOpenDept(isOpen ? null : d)}>
                    <strong>{d}</strong><span className={chipSmWarn}>{people} {L("away", "bercuti")}</span><AppIcon name="expand" />
                  </button>
                  {isOpen && (
                    <ul className={css.rows}>
                      {list.map((l) => (
                        <li key={l.id} className={css.row}>
                          <Avatar name={properName(l.name)} photoKey={l.photo_key} size="sm" />
                          <span className={css.rowMain}><span className={css.name}>{properName(l.name)}</span></span>
                          {l.type ? <span className={`${chipSmSuccess} ${css.cap}`}>{typeName(l.type)}</span> : null}
                          <span className={css.sub}>{period(l.start_date, l.end_date)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ================= APPROVALS & MANAGEMENT (ref 4) ================= */
export function ApprovalsHead4({ all, loaded, canEditPolicy, onManagePolicy }: { all: readonly LeaveReq[]; loaded: boolean; canEditPolicy: boolean; onManagePolicy: () => void }) {
  const policy = usePlain<Policy>("/staff/leave/policy");
  const year = mytToday().slice(0, 4);
  const mineToAct = all.filter((l) => l.can_act === true && inProgress(l)).length;
  const approvedYear = all.filter((l) => stateOf(l) === "approved" && l.start_date.startsWith(year)).length;
  const routing = all.filter((l) => stateOf(l) === "routing_required").length;
  const d = policy.data?.defaults ?? {};
  return (
    <div className={l4.mgmtHead}>
      <section className={card} aria-label={L("Leave management", "Pengurusan cuti")} data-testid="mgmt-tiles">
        <Head icon="balance" title={L("Leave Management", "Pengurusan Cuti")} sub={L("Leave approvals, routing and entitlements.", "Kelulusan cuti, laluan dan kelayakan.")} />
        <div className={l4.tiles}>
          <span className={l4.tile}><AppIcon name="pending" /><strong>{loaded ? mineToAct : "…"}</strong><span>{L("Pending approvals", "Kelulusan menunggu")}</span><em>{L("Requires your action", "Memerlukan tindakan anda")}</em></span>
          <span className={l4.tile}><AppIcon name="success" /><strong>{loaded ? approvedYear : "…"}</strong><span>{L(`Approved (${year})`, `Diluluskan (${year})`)}</span><em>{L("In the list you can see", "Dalam senarai yang anda boleh lihat")}</em></span>
          <span className={l4.tile}><AppIcon name="warning" /><strong>{loaded ? routing : "…"}</strong><span>{L("Routing needs configuration", "Laluan perlu ditetapkan")}</span><em>{L("No reporting line on the chart", "Tiada garis pelaporan pada carta")}</em></span>
        </div>
      </section>
      <section className={card} aria-label={L("Leave policy and entitlements", "Dasar dan kelayakan cuti")} data-testid="mgmt-policy">
        <Head icon="verify" title={L("Leave Policy & Entitlements", "Dasar & Kelayakan Cuti")} sub={L("The default yearly entitlement - a person's own figure may differ.", "Kelayakan tahunan lalai - angka seseorang mungkin berbeza.")}
          action={canEditPolicy ? { label: L("Manage Policy", "Urus Dasar"), onClick: onManagePolicy } : undefined} />
        {!policy.done ? <SkelRows rows={1} /> : (
          <div className={l4.policy}>
            <span><AppIcon name="date" /><strong>{L("Annual Leave", "Cuti Tahunan")}</strong><span>{d.annual ?? 0} {L("days / year", "hari / tahun")}</span></span>
            <span><AppIcon name="verify" /><strong>{L("Medical Leave", "Cuti Sakit")}</strong><span>{d.medical ?? 0} {L("days / year", "hari / tahun")}</span></span>
            <span><AppIcon name="refresh" /><strong>{L("Replacement Leave", "Cuti Gantian")}</strong><span>{L("Earned from rest days worked", "Diperoleh daripada hari rehat bekerja")}</span></span>
            <span><AppIcon name="money" /><strong>{L("Emergency / Unpaid", "Kecemasan / Tanpa Gaji")}</strong><span>{L("No limit · 1/26 of the wage a day", "Tiada had · 1/26 gaji sehari")}</span></span>
          </div>
        )}
      </section>
    </div>
  );
}

/** The approval queue: the requests whose current step is yours. Decisions
    go through the page's own sender (leave.tsx act) - the same route, the
    same rule, the authenticator on a final approval. */
export function ApprovalQueue4({ all, loaded, onView, act }: { all: readonly LeaveReq[]; loaded: boolean; onView: (id: number) => void; act: (id: number, action: "approve" | "reject" | "return") => void }) {
  const [type, setType] = useState("");
  const [stage, setStage] = useState<"" | "step" | "final" | "routing" | "returned">("");
  const [q, setQ] = useState("");
  const rows = all.filter((l) => inProgress(l) && (l.can_act === true || l.can_route === true))
    .filter((l) => !type || l.type === type)
    .filter((l) => { const st = stateOf(l); const fin = !!l.route?.steps.find((s) => s.approver.id === l.approver_id)?.final; return !stage || (stage === "routing" ? st === "routing_required" : stage === "returned" ? st === "returned" : stage === "final" ? fin : stage === "step" ? st !== "routing_required" && !fin : true); })
    .filter((l) => { const n = q.trim().toLowerCase(); return !n || [l.user_full ?? "", l.user_name ?? "", typeName(l.type), String(l.id)].some((t) => t.toLowerCase().includes(n)); })
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const stageText = (l: LeaveReq) => {
    if (stateOf(l) === "routing_required") return L("Routing required", "Laluan diperlukan");
    if (!l.route) return L("Previous rules", "Peraturan terdahulu");
    const s = l.route.steps.find((x) => x.approver.id === l.approver_id);
    return s ? L(`Step ${s.n} of ${l.route.steps.length}${s.final ? " · final" : ""}`, `Langkah ${s.n} daripada ${l.route.steps.length}${s.final ? " · akhir" : ""}`) : L("Your step", "Langkah anda");
  };
  return (
    <section className={card} aria-label={L("Approval queue", "Barisan kelulusan")} data-testid="approval-queue">
      <div className={l4.queueHead}>
        <Head icon="person" title={L("Approval Queue", "Barisan Kelulusan")} sub={L("Leave requests awaiting your decision.", "Permohonan cuti yang menunggu keputusan anda.")} />
        <div className={l4.filters}>
          <select className={inputClassSm} value={type} onChange={(e) => setType(e.target.value)} aria-label={L("Leave type", "Jenis cuti")}>
            <option value="">{L("All leave types", "Semua jenis cuti")}</option>
            {["annual", "medical", "emergency", "unpaid", "replacement"].map((t) => <option key={t} value={t}>{typeName(t)}</option>)}
          </select>
          <select className={inputClassSm} value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} aria-label={L("Stage", "Peringkat")}>
            <option value="">{L("All stages", "Semua peringkat")}</option>
            <option value="step">{L("Passing up the line", "Dihantar ke atas")}</option>
            <option value="final">{L("Final approval", "Kelulusan akhir")}</option>
            <option value="routing">{L("Routing required", "Laluan diperlukan")}</option>
          </select>
          <input type="search" className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff or request…", "Cari kakitangan atau permohonan…")} aria-label={L("Search the queue", "Cari barisan")} />
        </div>
      </div>
      {!loaded ? <SkelRows rows={3} /> : rows.length === 0 ? <p className={css.empty} data-testid="queue-empty">{L("Nothing waits on your decision.", "Tiada yang menunggu keputusan anda.")}</p> : (
        <div className={css.regWrap}>
          <table className={css.reg} aria-label={L("Approval queue", "Barisan kelulusan")}>
            <thead><tr><th>{L("Staff", "Kakitangan")}</th><th>{L("Leave type", "Jenis cuti")}</th><th>{L("Dates", "Tarikh")}</th><th className={css.num}>{L("Days", "Hari")}</th><th>{L("Approval route / stage", "Laluan / peringkat")}</th><th><span className={css.srOnly}>{L("Action", "Tindakan")}</span></th></tr></thead>
            <tbody>
              {rows.map((l) => {
                const who = properName(l.user_full || l.user_name || "");
                return (
                  <tr key={l.id} data-testid="queue-row">
                    <td className={css.personCell}>
                      <button type="button" className={css.person} onClick={() => onView(l.id)}>
                        <Avatar name={who} userId={l.user_id} size="sm" />
                        <span className={css.personText}><strong>{who}</strong><span>{l.user_position || l.user_department || "—"}</span></span>
                      </button>
                    </td>
                    <td data-label={L("Leave type", "Jenis cuti")}><span className={`${chipSmInfo} ${css.cap}`}>{typeName(l.type)}</span></td>
                    <td data-label={L("Dates", "Tarikh")}>{period(l.start_date, l.end_date)}</td>
                    <td data-label={L("Days", "Hari")} className={css.num}>{l.days}</td>
                    <td data-label={L("Stage", "Peringkat")}><span className={chipSmWarn}>{stageText(l)}</span></td>
                    <td className={css.actCell}>
                      <span>
                        <button type="button" className={btnSm} onClick={() => onView(l.id)}>{L("View", "Lihat")}</button>
                        {l.can_act === true && <>
                          <button type="button" className={btnSmPrimary} onClick={() => act(l.id, "approve")} data-testid="queue-approve">{L("Approve", "Luluskan")}</button>
                          <button type="button" className={btnSm} onClick={() => act(l.id, "reject")} data-testid="queue-reject">{L("Reject", "Tolak")}</button>
                          <button type="button" className={btnSm} onClick={() => act(l.id, "return")} data-testid="queue-return">{L("Send back", "Hantar balik")}</button>
                        </>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** A row's further actions behind one ⋮ (ref 2), closing after a choice. */
export function RowMenu({ label, items }: { label: string; items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  return (
    <details className={l4.menu} onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLDetailsElement).open = false; }}>
      <summary aria-label={label} title={label}><span aria-hidden="true" className={l4.dots}>⋮</span></summary>
      <ul className={l4.menuList}>
        {items.map((it) => (
          <li key={it.label}><button type="button" data-danger={it.danger ? "true" : undefined} onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); it.onClick(); }}>{it.label}</button></li>
        ))}
      </ul>
    </details>
  );
}
