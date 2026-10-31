"use client";

/* v1.239.0 - THE WEEKLY SALES TARGET ON THE DASHBOARD (the owner's brief and
   answers, 31-10-2026; claude/WEEKLY-TARGET-DASHBOARD-AUDIT.md: "EVERY STAFF
   MEMBER UNDERSTANDS THE COMPANY SALES GOAL ... ONE WEEKLY SALES TARGET
   ENGINE ... PRESERVE THE ORIGINAL A2Z DASHBOARD").

   One card under the five tiles. Every figure is the worker's
   (GET /staff/sales/week/dashboard, the same functions as Sales -> Overview);
   nothing is added up or judged here. What a person sees is what the server
   sends them: the company's week (everyone), their own target and goals, their
   team's progress (an HOD on the Organisation chart), every row by
   department and who needs attention (management). Each action opens a screen
   that already exists, or the Introduce-a-lead form (an ordinary enquiry for
   the Sales team). No commission is shown or estimated here. */

import { useState, type ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { TargetsDrawer } from "@/components/portal/weekly-sales";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import type { TabName } from "@/lib/portal-tabs";
import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, textareaClass } from "@/lib/ui-styles";
import { GOAL_LABEL, WEEK_STATUS, type WeekStatus, type WeekTone } from "@/lib/week-status";
import ov from "./dashboard-overview.module.css";
import css from "./week-target-card.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const TONE: Record<WeekTone, string> = { neutral: chipSmNeutral, info: chipSmInfo, success: chipSmSuccess, warn: chipSmWarn, danger: chipSmDanger };
const chip = (s: WeekStatus) => <span className={TONE[WEEK_STATUS[s].tone]} title={L(WEEK_STATUS[s].hint_en, WEEK_STATUS[s].hint_ms)}>{L(WEEK_STATUS[s].en, WEEK_STATUS[s].ms)}</span>;

interface Slim { user_id: number; name: string; department: string | null; target_cents: number | null; basis_cents: number; pct: number | null; gap_cents: number | null; status: WeekStatus }
interface Goal { metric: string; target: number; actual: number; pct?: number }
export interface WeekDash {
  week: { from: string; to: string; today: string; checkpoint: string; start_dow: number };
  company: { target_cents: number | null; target_from: string | null; basis_cents: number; pct: number | null; gap_cents: number | null };
  other_channels_cents: number | null;
  me: null | {
    name: string; has_target: boolean; target_cents: number | null; basis_cents: number; paid_invoices: number; pct: number | null; gap_cents: number | null;
    expected_cents: number | null; status: WeekStatus; working_days: number; goals: Goal[];
    open_quotations: { n: number; cents: number }; followups_overdue: number; tasks: { open: number; done: number; overdue: number };
    top_tasks: { id: number; title: string; deadline: string | null; link_kind: string | null }[];
    enquiries_waiting: number | null; introductions: { pending: number | null; verified_week: number | null }; plan: { status: string } | null;
  };
  team: null | { target_cents: number | null; basis_cents: number; pct: number | null; gap_cents: number | null; rows: Slim[] };
  all: null | { rows: (Slim & { goals: Goal[] })[]; counts: Record<string, number>; attention: Slim[]; departments: { name: string | null; target_cents: number | null; basis_cents: number; people: number; pct: number | null }[] };
  can_set: boolean; can_view_all: boolean; can_assign: boolean; can_sales: boolean;
}

function Bar({ pct, label }: { pct: number | null; label: string }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return <span className={css.bar} role="img" aria-label={label}><span style={{ width: `${w}%` }} /></span>;
}

/** One figure against its target, or "Target not set". */
function Against({ title, basis, target, pct, gap, sub, notSet }: { title: string; basis: number; target: number | null; pct: number | null; gap: number | null; sub?: ReactNode; notSet: string }) {
  return (
    <div className={css.block}>
      <p className={css.label}>{title}</p>
      {target === null ? (
        <>
          <p className={css.notSet}>{L("Target not set", "Sasaran belum ditetapkan")}</p>
          <p className={css.muted}>{notSet} <strong>{fmtRM(basis)}</strong> {L("collected so far.", "dikutip setakat ini.")}</p>
        </>
      ) : (
        <>
          <p className={css.figure}><strong>{fmtRM(basis)}</strong><span> / {fmtRM(target)}</span><b className={css.pct}>{pct ?? 0}%</b></p>
          <Bar pct={pct} label={L(`${pct ?? 0}% of ${fmtRM(target)}`, `${pct ?? 0}% daripada ${fmtRM(target)}`)} />
          <p className={css.muted}>{(gap ?? 0) > 0 ? L(`${fmtRM(gap ?? 0)} to go`, `${fmtRM(gap ?? 0)} lagi`) : L("Target reached", "Sasaran dicapai")}</p>
        </>
      )}
      {sub}
    </div>
  );
}

/** The Introduce-a-lead form: an ordinary enquiry for the Sales team. */
export function IntroduceLead({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: "", company: "", phone: "", email: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();
  const ready = f.name.trim().length >= 2 && (f.phone.trim() || f.email.trim()) && f.note.trim().length >= 10;
  const send = async () => {
    setBusy(true); setError("");
    const r = await api<{ id?: number; error?: { message?: string } }>("/enquiries/introduce", { method: "POST", body: JSON.stringify(f) });
    setBusy(false);
    if (r.ok) { setDone(true); setF({ name: "", company: "", phone: "", email: "", note: "" }); toast(L("Sent to Sales", "Dihantar kepada Jualan"), L("It counts once Sales marks it qualified", "Ia dikira apabila Jualan menandanya layak")); }
    else setError(r.data?.error?.message ?? (r.status === 0 ? L("No connection - nothing was sent.", "Tiada sambungan - tiada apa dihantar.") : L("The lead was not sent.", "Petunjuk tidak dihantar.")));
  };
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label>{label}<input className={inputClassSm} type={type} value={f[k]} maxLength={k === "note" ? 1000 : 160} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <SideDrawer open={open} onClose={() => { setDone(false); setError(""); onClose(); }} title={L("Introduce a lead", "Perkenalkan petunjuk")}
      subtitle={L("Someone you met who may buy from A2Z. Sales follows it up; it counts toward your goal once they mark it qualified.", "Seseorang yang anda temui yang mungkin membeli daripada A2Z. Jualan akan susuli; ia dikira apabila mereka menandanya layak.")}>
      {toastNode}
      {done ? (
        <div className={css.done} role="status">
          <AppIcon name="success" /><p>{L("Sent to the Sales team. You can see it waiting on your Dashboard card.", "Dihantar kepada pasukan Jualan. Anda boleh lihatnya pada kad Papan Pemuka anda.")}</p>
          <button type="button" className={btnSm} onClick={() => setDone(false)}>{L("Introduce another", "Perkenalkan lagi")}</button>
        </div>
      ) : (
        <fieldset className={css.form} disabled={busy}>
          {field("name", L("Contact name", "Nama hubungan"))}
          {field("company", L("Company (optional)", "Syarikat (pilihan)"))}
          {field("phone", L("Phone", "Telefon"), "tel")}
          {field("email", L("Email", "E-mel"), "email")}
          <label>{L("What they need", "Apa yang mereka perlukan")}<textarea className={textareaClass} rows={4} maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <p className={css.muted}><AppIcon name="info" />{L("Only real contacts who agreed to be contacted. A phone number or an email is needed.", "Hanya hubungan sebenar yang bersetuju untuk dihubungi. Nombor telefon atau e-mel diperlukan.")}</p>
          {error && <p role="alert" className={css.error}>{error}</p>}
          <div className={css.actions}><button type="button" className={btnClass} disabled={!ready} onClick={() => void send()}><AppIcon name="next" />{busy ? L("Sending…", "Menghantar…") : L("Send to Sales", "Hantar kepada Jualan")}</button></div>
        </fieldset>
      )}
    </SideDrawer>
  );
}

/** The Desk's quick action: the same form behind any trigger. */
export function IntroduceLeadAction({ trigger }: { trigger: (open: () => void) => ReactNode }) {
  const [o, setO] = useState(false);
  return <>{trigger(() => setO(true))}<IntroduceLead open={o} onClose={() => setO(false)} /></>;
}

export function WeekTargetCard({ go, canOpen, onCreateQuotation }: { go: (t: TabName) => void; canOpen?: (t: string) => boolean; onCreateQuotation?: () => void }) {
  const view = useCachedApi<WeekDash>("/staff/sales/week/dashboard", true, ["docs", "sales", "tasks", "enquiries"]);
  const [introduce, setIntroduce] = useState(false);
  const [targets, setTargets] = useState(false);
  const [more, setMore] = useState(false);
  const d = view.data;
  const open = (t: string) => (canOpen ? canOpen(t) : false);
  const goTab = (t: TabName) => go(t);

  if (!d) {
    return (
      <section className={`${card} ${ov.card} ${css.card}`} aria-label={L("Weekly sales target", "Sasaran jualan mingguan")}>
        {view.failed ? <p className={css.muted}>{L("The weekly target could not be loaded.", "Sasaran mingguan tidak dapat dimuatkan.")}</p> : <SkelRows rows={4} />}
      </section>
    );
  }
  const me = d.me;
  const behind = me && ["at_risk", "action", "missed"].includes(me.status);

  /* the actions: each opens a screen that already exists */
  const acts: { key: string; icon: AppIconName; label: string; onClick: () => void; primary?: boolean }[] = [];
  if (d.can_sales && onCreateQuotation) acts.push({ key: "qt", icon: "document", label: L("Prepare a quotation", "Sediakan sebut harga"), onClick: onCreateQuotation, primary: true });
  if (d.can_sales && me && me.open_quotations.n > 0) acts.push({ key: "open", icon: "documents", label: L(`Revisit open quotations (${me.open_quotations.n})`, `Semak sebut harga terbuka (${me.open_quotations.n})`), onClick: () => goTab("Sales") });
  if (d.can_sales && me && me.followups_overdue > 0) acts.push({ key: "fu", icon: "clients", label: L(`Contact pending customers (${me.followups_overdue})`, `Hubungi pelanggan tertunggak (${me.followups_overdue})`), onClick: () => goTab("Sales") });
  if (me && (me.enquiries_waiting ?? 0) > 0) acts.push({ key: "enq", icon: "chat", label: L(`Follow up enquiries (${me.enquiries_waiting})`, `Susuli pertanyaan (${me.enquiries_waiting})`), onClick: () => goTab("Sales") });
  if (d.can_sales && behind) acts.push({ key: "plan", icon: "target", label: me?.plan ? L("Open my recovery plan", "Buka pelan pemulihan saya") : L("Submit a recovery plan", "Hantar pelan pemulihan"), onClick: () => goTab("Sales"), primary: true });
  if (me) acts.push({ key: "lead", icon: "add", label: L("Introduce a lead", "Perkenalkan petunjuk"), onClick: () => setIntroduce(true), primary: !d.can_sales });
  if (me && me.tasks.open > 0 && open("Tasks")) acts.push({ key: "tasks", icon: "assignment", label: L(`My sales tasks (${me.tasks.open})`, `Tugasan jualan saya (${me.tasks.open})`), onClick: () => goTab("Tasks") });
  acts.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));

  const right = (
    <div className={css.headActions}>
      {d.can_set && <button type="button" className={ov.viewAll} onClick={() => setTargets(true)}>{L("Manage weekly targets", "Urus sasaran mingguan")}</button>}
      {d.can_sales && open("Sales") && <button type="button" className={ov.viewAll} onClick={() => goTab("Sales")}>{L("View in Sales", "Lihat di Jualan")}</button>}
    </div>
  );

  return (
    <section className={`${card} ${ov.card} ${css.card}`} aria-label={L("Weekly sales target", "Sasaran jualan mingguan")}>
      <div className={ov.head}>
        <div className={ov.headText}>
          <h3 className={ov.title}>{L("Weekly Sales Target", "Sasaran Jualan Mingguan")}</h3>
          <p className={ov.sub}>{L(`${dmy(d.week.from)} – ${dmy(d.week.to)} · Collected: invoices paid in full`, `${dmy(d.week.from)} – ${dmy(d.week.to)} · Dikutip: invois dibayar penuh`)}</p>
        </div>
        {right}
      </div>

      <div className={css.grid}>
        <Against title={L("Company", "Syarikat")} basis={d.company.basis_cents} target={d.company.target_cents} pct={d.company.pct} gap={d.company.gap_cents}
          notSet={d.can_set ? L("Set this week's company target with Manage weekly targets.", "Tetapkan sasaran syarikat minggu ini melalui Urus sasaran mingguan.") : L("Management has not set this week's company target.", "Pengurusan belum menetapkan sasaran syarikat minggu ini.")}
          sub={d.other_channels_cents !== null && d.other_channels_cents > 0 ? <p className={css.note}>{L(`Also sold this week, not counted in the target: ${fmtRM(d.other_channels_cents)} (TikTok, online orders, manual sales).`, `Turut dijual minggu ini, tidak dikira dalam sasaran: ${fmtRM(d.other_channels_cents)} (TikTok, pesanan dalam talian, jualan manual).`)}</p> : undefined} />

        {me && (
          <div className={css.block}>
            <div className={css.labelRow}><p className={css.label}>{L("My contribution", "Sumbangan saya")}</p>{me.target_cents !== null && chip(me.status)}</div>
            {!me.has_target ? (
              <>
                <p className={css.notSet}>{L("No target assigned", "Tiada sasaran ditetapkan")}</p>
                <p className={css.muted}>{L("Your manager has not given you a target or goal this week. Every lead you introduce still helps the company target.", "Pengurus anda belum memberi sasaran atau matlamat minggu ini. Setiap petunjuk yang anda perkenalkan tetap membantu sasaran syarikat.")}</p>
              </>
            ) : (
              <>
                {me.target_cents !== null && (
                  <>
                    <p className={css.figure}><strong>{fmtRM(me.basis_cents)}</strong><span> / {fmtRM(me.target_cents)}</span><b className={css.pct}>{me.pct ?? 0}%</b></p>
                    <Bar pct={me.pct} label={L(`${me.pct ?? 0}% of my weekly target`, `${me.pct ?? 0}% daripada sasaran mingguan saya`)} />
                    <p className={css.muted}>{(me.gap_cents ?? 0) > 0 ? L(`${fmtRM(me.gap_cents ?? 0)} to go`, `${fmtRM(me.gap_cents ?? 0)} lagi`) : L("Target reached", "Sasaran dicapai")}
                      {me.expected_cents !== null && me.status !== "achieved" ? L(` · expected by now ${fmtRM(me.expected_cents)}`, ` · dijangka setakat ini ${fmtRM(me.expected_cents)}`) : ""}</p>
                  </>
                )}
                {me.goals.length > 0 && (
                  <ul className={css.goals} aria-label={L("My contribution goals", "Matlamat sumbangan saya")}>
                    {me.goals.map((g) => (
                      <li key={g.metric}>
                        <span>{GOAL_LABEL[g.metric] ? L(GOAL_LABEL[g.metric]![0], GOAL_LABEL[g.metric]![1]) : g.metric}</span>
                        <strong>{g.actual} / {g.target}</strong>
                        <Bar pct={g.pct ?? Math.round((g.actual / g.target) * 100)} label={`${g.actual} / ${g.target}`} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {(me.introductions.pending ?? 0) > 0 && <p className={css.muted}>{L(`${me.introductions.pending} lead(s) you introduced waiting for Sales.`, `${me.introductions.pending} petunjuk yang anda perkenalkan menunggu Jualan.`)}</p>}
            {me.top_tasks.length > 0 && (
              <ul className={css.tasks} aria-label={L("My sales tasks", "Tugasan jualan saya")}>
                {me.top_tasks.map((t) => <li key={t.id}><AppIcon name="assignment" /><span>{t.title}</span>{t.deadline && <em>{dmy(t.deadline.slice(0, 10))}</em>}</li>)}
              </ul>
            )}
          </div>
        )}

        {d.team && (
          <div className={css.block}>
            <p className={css.label}>{L("My team", "Pasukan saya")}</p>
            {d.team.target_cents === null
              ? <p className={css.muted}>{L("No team member has a target this week.", "Tiada ahli pasukan mempunyai sasaran minggu ini.")} <strong>{fmtRM(d.team.basis_cents)}</strong> {L("collected.", "dikutip.")}</p>
              : <>
                <p className={css.figure}><strong>{fmtRM(d.team.basis_cents)}</strong><span> / {fmtRM(d.team.target_cents)}</span><b className={css.pct}>{d.team.pct ?? 0}%</b></p>
                <Bar pct={d.team.pct} label={L(`Team: ${d.team.pct ?? 0}% of the combined target`, `Pasukan: ${d.team.pct ?? 0}% daripada sasaran gabungan`)} />
              </>}
            <ul className={css.people}>
              {d.team.rows.slice(0, 6).map((r) => <li key={r.user_id}><span className={css.who}>{r.name}</span><span className={css.amt}>{r.target_cents === null ? fmtRM(r.basis_cents) : `${r.pct ?? 0}%`}</span>{chip(r.status)}</li>)}
            </ul>
          </div>
        )}

        {d.all && (
          <div className={css.block}>
            <p className={css.label}>{L("Needs attention", "Perlu perhatian")}</p>
            {d.all.attention.length === 0
              ? <p className={css.muted}>{d.all.rows.some((r) => r.target_cents !== null) ? L("Nobody is behind their pace right now.", "Tiada siapa ketinggalan buat masa ini.") : L("No individual targets are set this week.", "Tiada sasaran individu ditetapkan minggu ini.")}</p>
              : <ul className={css.people}>{d.all.attention.map((r) => <li key={r.user_id}><span className={css.who}>{r.name}</span><span className={css.amt}>{r.pct ?? 0}% · {fmtRM(r.gap_cents ?? 0)}</span>{chip(r.status)}</li>)}</ul>}
            {d.all.departments.length > 0 && (
              <>
                <p className={css.label}>{L("By department", "Mengikut jabatan")}</p>
                <ul className={css.depts}>
                  {d.all.departments.slice(0, 5).map((x) => (
                    <li key={x.name ?? "-"}>
                      <span className={css.who}>{x.name ?? L("No department", "Tiada jabatan")}</span>
                      <span className={css.amt}>{fmtRM(x.basis_cents)}{x.target_cents !== null ? ` / ${fmtRM(x.target_cents)}` : ""}</span>
                      {x.target_cents !== null && <Bar pct={x.pct} label={`${x.pct ?? 0}%`} />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {acts.length > 0 && (
        <div className={`${css.acts} ${more ? css.actsOpen : ""}`}>
          {acts.map((a, i) => (
            <button key={a.key} type="button" className={`${btnSm} ${i > 0 ? css.extra : ""}`} onClick={a.onClick}><AppIcon name={a.icon} />{a.label}</button>
          ))}
          {acts.length > 1 && <button type="button" className={`${btnSm} ${css.moreBtn}`} aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? L("Less", "Kurang") : L(`More (${acts.length - 1})`, `Lagi (${acts.length - 1})`)}</button>}
        </div>
      )}

      <IntroduceLead open={introduce} onClose={() => setIntroduce(false)} />
      {targets && <TargetsDrawer week={d.week.from} onClose={() => setTargets(false)} onSaved={() => undefined} />}
    </section>
  );
}
