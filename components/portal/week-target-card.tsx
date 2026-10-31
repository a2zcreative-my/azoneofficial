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

/** v1.240.0 - one figure against its target, compact (the owner's mobile
    reference, 31-10-2026): label, the target, a bar, then "collected (pct)"
    and "left". With no target: the empty state, never a 0%. */
function Against({ title, icon, basis, target, pct, gap, empty, emptyNote, right }: {
  title: string; icon: AppIconName; basis: number; target: number | null; pct: number | null; gap: number | null;
  empty: string; emptyNote: string; right?: ReactNode;
}) {
  return (
    <div className={css.col}>
      <div className={css.colHead}>
        <span className={css.colIcon} aria-hidden><AppIcon name={icon} /></span>
        <span className={css.colTitle}>{title}</span>
        {right}
      </div>
      {target === null ? (
        <>
          <p className={css.notSet}>{empty}</p>
          <p className={css.muted}>{emptyNote}</p>
          <p className={css.muted}><strong className={css.strongNum}>{fmtRM(basis)}</strong> {L("collected this week", "dikutip minggu ini")}</p>
        </>
      ) : (
        <>
          <p className={css.target}>{fmtRM(target)}</p>
          <Bar pct={pct} label={L(`${pct ?? 0}% of ${fmtRM(target)}`, `${pct ?? 0}% daripada ${fmtRM(target)}`)} />
          <p className={css.split}>
            <span>{fmtRM(basis)} ({pct ?? 0}%)</span>
            <span>{(gap ?? 0) > 0 ? L(`${fmtRM(gap ?? 0)} left`, `${fmtRM(gap ?? 0)} lagi`) : L("Reached", "Dicapai")}</span>
          </p>
        </>
      )}
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

/** v1.240.0 - the My Day line (the owner's answer "One-line strip"): the
    company's week and mine in one sentence; pressing it opens the Overview,
    where the full card is. The same request as the card. */
export function WeekTargetStrip({ onOpen }: { onOpen: () => void }) {
  const d = useCachedApi<WeekDash>("/staff/sales/week/dashboard", true, ["docs", "sales", "tasks", "enquiries"]).data;
  if (!d) return null;
  const co = d.company.target_cents === null ? L("company target not set", "sasaran syarikat belum ditetapkan") : L(`company ${d.company.pct ?? 0}%`, `syarikat ${d.company.pct ?? 0}%`);
  const me = !d.me ? "" : d.me.target_cents !== null ? L(` · me ${d.me.pct ?? 0}%`, ` · saya ${d.me.pct ?? 0}%`)
    : d.me.goals.length ? ` · ${d.me.goals.map((g) => `${g.actual}/${g.target}`).join(", ")}` : "";
  return (
    <button type="button" className={css.strip} onClick={onOpen} aria-label={L("Weekly sales target - open the Overview", "Sasaran jualan mingguan - buka Gambaran")}>
      <span className={css.colIcon} aria-hidden><AppIcon name="chart" /></span>
      <span className={css.stripText}><strong>{L("Weekly sales target", "Sasaran jualan mingguan")}</strong> · {co}{me}</span>
      <Bar pct={d.company.pct} label={`${d.company.pct ?? 0}%`} />
      <AppIcon name="next" />
    </button>
  );
}

export function WeekTargetCard({ go, canOpen, onCreateQuotation }: { go: (t: TabName) => void; canOpen?: (t: string) => boolean; onCreateQuotation?: () => void }) {
  const view = useCachedApi<WeekDash>("/staff/sales/week/dashboard", true, ["docs", "sales", "tasks", "enquiries"]);
  const [introduce, setIntroduce] = useState(false);
  const [targets, setTargets] = useState(false);
  const [lists, setLists] = useState(false);
  const d = view.data;
  const open = (t: string) => (canOpen ? canOpen(t) : false);

  if (!d) {
    return (
      <section className={`${card} ${css.card}`} aria-label={L("Weekly sales target", "Sasaran jualan mingguan")}>
        {view.failed ? <p className={css.muted}>{L("The weekly target could not be loaded.", "Sasaran mingguan tidak dapat dimuatkan.")}</p> : <SkelRows rows={3} />}
      </section>
    );
  }
  const me = d.me;
  const behind = me && ["at_risk", "action", "missed"].includes(me.status);
  const sales = d.can_sales && open("Sales");

  /* the sales actions - each opens a module that already exists */
  const acts: { key: string; icon: AppIconName; label: string; onClick: () => void }[] = [];
  if (sales && behind) acts.push({ key: "plan", icon: "target", label: me?.plan ? L("Recovery plan", "Pelan pemulihan") : L("Submit recovery plan", "Hantar pelan pemulihan"), onClick: () => go("Sales") });
  if (me) acts.push({ key: "lead", icon: "add", label: L("New enquiry", "Pertanyaan baharu"), onClick: () => setIntroduce(true) });
  if (sales && onCreateQuotation) acts.push({ key: "qt", icon: "document", label: L("Create quotation", "Cipta sebut harga"), onClick: onCreateQuotation });
  if (sales) acts.push({ key: "fu", icon: "clients", label: me && me.followups_overdue > 0 ? L(`Follow up customers (${me.followups_overdue})`, `Susuli pelanggan (${me.followups_overdue})`) : L("Follow up customers", "Susuli pelanggan"), onClick: () => go("Sales") });
  if (sales) acts.push({ key: "pipe", icon: "chart", label: me && me.open_quotations.n > 0 ? L(`Sales pipeline (${me.open_quotations.n})`, `Saluran jualan (${me.open_quotations.n})`) : L("Sales pipeline", "Saluran jualan"), onClick: () => go("Sales") });
  if (me && open("Tasks")) acts.push({ key: "tasks", icon: "assignment", label: me.tasks.open > 0 ? L(`My sales tasks (${me.tasks.open})`, `Tugasan jualan saya (${me.tasks.open})`) : L("My sales tasks", "Tugasan jualan saya"), onClick: () => go("Tasks") });

  const hasLists = Boolean(d.team || d.all);

  return (
    <section className={`${card} ${css.card}`} aria-label={L("Weekly sales target", "Sasaran jualan mingguan")}>
      <div className={css.head}>
        <span className={css.headIcon} aria-hidden><AppIcon name="chart" /></span>
        <div className={css.headText}>
          <h3 className={css.title}>{L("Weekly Sales Target", "Sasaran Jualan Mingguan")}</h3>
          <p className={css.dates}>{dmy(d.week.from)} – {dmy(d.week.to)}</p>
        </div>
        {d.can_set && <button type="button" className={css.headBtn} onClick={() => setTargets(true)}>{L("Manage", "Urus")}</button>}
        {sales && <button type="button" className={css.headBtn} onClick={() => go("Sales")}>{L("View details", "Lihat butiran")}<AppIcon name="next" /></button>}
      </div>

      <div className={css.cols}>
        <Against title={L("Company target", "Sasaran syarikat")} icon="chart" basis={d.company.basis_cents} target={d.company.target_cents} pct={d.company.pct} gap={d.company.gap_cents}
          empty={L("Target Not Set", "Sasaran Belum Ditetapkan")}
          emptyNote={d.can_set ? L("Set this week's target with Manage.", "Tetapkan sasaran minggu ini melalui Urus.") : L("Management has not set this week's target.", "Pengurusan belum menetapkan sasaran minggu ini.")} />
        {me && (
          <div className={css.colGroup}>
            <Against title={L("My target", "Sasaran saya")} icon="person" basis={me.basis_cents} target={me.target_cents} pct={me.pct} gap={me.gap_cents}
              right={me.target_cents !== null ? chip(me.status) : undefined}
              empty={L("No Individual Target Assigned", "Tiada Sasaran Individu")}
              emptyNote={me.goals.length ? L("Your goals this week are below.", "Matlamat anda minggu ini di bawah.") : L("Every lead you bring in still helps the company target.", "Setiap petunjuk yang anda bawa tetap membantu sasaran syarikat.")} />
            {me.goals.length > 0 && (
              <ul className={css.goals} aria-label={L("My contribution goals", "Matlamat sumbangan saya")}>
                {me.goals.map((g) => (
                  <li key={g.metric}>
                    <span>{GOAL_LABEL[g.metric] ? L(GOAL_LABEL[g.metric]![0], GOAL_LABEL[g.metric]![1]) : g.metric}</span>
                    <strong>{g.actual} / {g.target}</strong>
                  </li>
                ))}
              </ul>
            )}
            {(me.introductions.pending ?? 0) > 0 && <p className={css.muted}>{L(`${me.introductions.pending} lead(s) you introduced waiting for Sales`, `${me.introductions.pending} petunjuk anda menunggu Jualan`)}</p>}
          </div>
        )}
      </div>

      <p className={css.basis}>
        {L("Counts invoices paid in full this week, by the closer.", "Mengira invois dibayar penuh minggu ini, oleh penutup.")}
        {d.other_channels_cents !== null && d.other_channels_cents > 0 ? L(` Not counted: ${fmtRM(d.other_channels_cents)} TikTok, online and manual sales.`, ` Tidak dikira: ${fmtRM(d.other_channels_cents)} jualan TikTok, dalam talian dan manual.`) : ""}
      </p>

      {acts.length > 0 && (
        <div className={css.acts} role="group" aria-label={L("Sales actions", "Tindakan jualan")}>
          {acts.map((a) => <button key={a.key} type="button" className={css.act} onClick={a.onClick}><AppIcon name={a.icon} />{a.label}</button>)}
        </div>
      )}

      {hasLists && (
        <>
          <button type="button" className={css.listsToggle} aria-expanded={lists} onClick={() => setLists((v) => !v)}>
            {d.all ? L(`Team & departments${d.all.attention.length ? ` · ${d.all.attention.length} need attention` : ""}`, `Pasukan & jabatan${d.all.attention.length ? ` · ${d.all.attention.length} perlu perhatian` : ""}`)
              : L("My team", "Pasukan saya")}
            <AppIcon name={lists ? "up" : "down"} />
          </button>
          <div className={`${css.lists} ${lists ? css.listsOpen : ""}`}>
            {d.team && (
              <div className={css.block}>
                <p className={css.label}>{L("My team", "Pasukan saya")}</p>
                {d.team.target_cents === null
                  ? <p className={css.muted}>{L("No team member has a target this week.", "Tiada ahli pasukan mempunyai sasaran minggu ini.")} <strong>{fmtRM(d.team.basis_cents)}</strong> {L("collected.", "dikutip.")}</p>
                  : <>
                    <p className={css.split}><span><strong className={css.strongNum}>{fmtRM(d.team.basis_cents)}</strong> / {fmtRM(d.team.target_cents)}</span><span>{d.team.pct ?? 0}%</span></p>
                    <Bar pct={d.team.pct} label={L(`Team: ${d.team.pct ?? 0}% of the combined target`, `Pasukan: ${d.team.pct ?? 0}% daripada sasaran gabungan`)} />
                  </>}
                <ul className={css.people}>
                  {d.team.rows.slice(0, 8).map((r) => <li key={r.user_id}><span className={css.who}>{r.name}</span><span className={css.amt}>{r.target_cents === null ? fmtRM(r.basis_cents) : `${r.pct ?? 0}%`}</span>{chip(r.status)}</li>)}
                </ul>
              </div>
            )}
            {d.all && (
              <>
                <div className={css.block}>
                  <p className={css.label}>{L("Needs attention", "Perlu perhatian")}</p>
                  {d.all.attention.length === 0
                    ? <p className={css.muted}>{d.all.rows.some((r) => r.target_cents !== null) ? L("Nobody is behind their pace right now.", "Tiada siapa ketinggalan buat masa ini.") : L("No individual targets are set this week.", "Tiada sasaran individu ditetapkan minggu ini.")}</p>
                    : <ul className={css.people}>{d.all.attention.map((r) => <li key={r.user_id}><span className={css.who}>{r.name}</span><span className={css.amt}>{r.pct ?? 0}% · {fmtRM(r.gap_cents ?? 0)}</span>{chip(r.status)}</li>)}</ul>}
                </div>
                {d.all.departments.length > 0 && (
                  <div className={css.block}>
                    <p className={css.label}>{L("By department", "Mengikut jabatan")}</p>
                    <ul className={css.depts}>
                      {d.all.departments.slice(0, 6).map((x) => (
                        <li key={x.name ?? "-"}>
                          <span className={css.who}>{x.name ?? L("No department", "Tiada jabatan")}</span>
                          <span className={css.amt}>{fmtRM(x.basis_cents)}{x.target_cents !== null ? ` / ${fmtRM(x.target_cents)}` : ""}</span>
                          {x.target_cents !== null && <Bar pct={x.pct} label={`${x.pct ?? 0}%`} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      <IntroduceLead open={introduce} onClose={() => setIntroduce(false)} />
      {targets && <TargetsDrawer week={d.week.from} onClose={() => setTargets(false)} onSaved={() => undefined} />}
    </section>
  );
}
