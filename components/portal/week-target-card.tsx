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
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { useSaveToast } from "@/components/ui/save-toast";
import { TargetsDrawer } from "@/components/portal/weekly-sales";
import { AdviceList, AllocationDrawer, KIND, OUTCOME, type AdviceCard, type Opportunity, type Outlook } from "@/components/portal/sales-discipline";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import type { TabName } from "@/lib/portal-tabs";
import { dmy, fmtRM } from "@/lib/format";
import { companyBasisLine, type Channels } from "@/lib/company-basis";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, textareaClass } from "@/lib/ui-styles";
import { GOAL_LABEL, WEEK_STATUS, type WeekStatus, type WeekTone } from "@/lib/week-status";
import css from "./week-target-card.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const TONE: Record<WeekTone, string> = { neutral: chipSmNeutral, info: chipSmInfo, success: chipSmSuccess, warn: chipSmWarn, danger: chipSmDanger };
/* v1.262.0 - a team row's plan state (the HOD's "their reports' plan states") */
const PLAN_WORD: Record<string, [string, string]> = { draft: ["Plan drafted", "Pelan dideraf"], submitted: ["Plan submitted", "Pelan dihantar"], approved: ["Plan approved", "Pelan diluluskan"], returned: ["Plan returned", "Pelan dikembalikan"] };
const chip = (s: WeekStatus) => <span className={TONE[WEEK_STATUS[s].tone]} title={L(WEEK_STATUS[s].hint_en, WEEK_STATUS[s].hint_ms)}>{L(WEEK_STATUS[s].en, WEEK_STATUS[s].ms)}</span>;

interface Slim { user_id: number; name: string; department: string | null; target_cents: number | null; basis_cents: number; pct: number | null; gap_cents: number | null; status: WeekStatus; kind?: string; plan?: string | null }
interface Goal { metric: string; target: number; actual: number; pct?: number }
export interface WeekDash {
  week: { from: string; to: string; today: string; checkpoint: string; start_dow: number };
  /* v1.275.0 - basis_kind: what the company figure counts ("all_channels" from
     the week holding 10-11-2026); channels: its parts, for revenue readers only */
  company: { target_cents: number | null; target_from: string | null; basis_cents: number; pct: number | null; gap_cents: number | null; basis_kind?: "invoices" | "all_channels"; channels?: Channels | null };
  other_channels_cents: number | null;
  me: null | {
    name: string; has_target: boolean; target_cents: number | null; basis_cents: number; paid_invoices: number; pct: number | null; gap_cents: number | null;
    expected_cents: number | null; status: WeekStatus; working_days: number; goals: Goal[];
    open_quotations: { n: number; cents: number }; followups_overdue: number; tasks: { open: number; done: number; overdue: number };
    top_tasks: { id: number; title: string; deadline: string | null; link_kind: string | null }[];
    enquiries_waiting: number | null; introductions: { pending: number | null; verified_week: number | null }; plan: { status: string } | null;
    /* v1.262.0 - My week */
    kind?: string; role?: string; followups_today?: number | null; next_followups?: { id: number; due_on: string; note: string; company: string | null }[];
  };
  /* v1.262.0 - management's command strip; the advice and open quotations (own, for a seller) */
  outlook?: Outlook | null; advisory?: { cards: AdviceCard[]; total: number; inactive: { rule: string; needs: string }[] } | null; opportunities?: Opportunity[] | null;
  team: null | { target_cents: number | null; basis_cents: number; pct: number | null; gap_cents: number | null; rows: Slim[] };
  all: null | { rows: (Slim & { goals: Goal[] })[]; counts: Record<string, number>; attention: Slim[]; departments: { name: string | null; target_cents: number | null; basis_cents: number; people: number; pct: number | null }[] };
  can_set: boolean; can_view_all: boolean; can_assign: boolean; can_sales: boolean;
}

function Bar({ pct, label }: { pct: number | null; label: string }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return <span className={css.bar} role="img" aria-label={label}><span style={{ width: `${w}%` }} /></span>;
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
  const d = useWeekDash().data;
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

/* ==== v1.263.0 - THE COMPACT DASHBOARD (claude/COMPACT-DASHBOARD-AUDIT.md,
   approved 05-11-2026, D1-D4 as recommended). The long card of 1.262.0 is
   gone: the Dashboard shows a summary and the first few items, and every
   "View all" opens the module that owns the detail - Sales (the team's
   week, the Documents list filtered to open quotations, the quotation
   itself), Tasks, the Desk, Finance. ONE request feeds every piece
   (GET /staff/sales/week/dashboard, shared through the cache); nothing is
   computed, judged or invented here - the server decides who sees what. ==== */

/** The Dashboard's week, shared by every piece below and by My Day's strip. */
export function useWeekDash() {
  return useCachedApi<WeekDash>("/staff/sales/week/dashboard", true, ["docs", "sales", "tasks", "enquiries"]);
}

function Box({ title, label, chipText, action, children, testid }: { title: string; label: string; chipText?: string; action?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className={`${card} ${css.box}`} aria-label={label} data-testid={testid}>
      <div className={css.boxHead}>
        <h3 className={css.boxTitle}>{title}{chipText && <span className={chipSmNeutral}>{chipText}</span>}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
const Pill = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => <button type="button" className={css.headBtn} onClick={onClick}>{children}</button>;
const RISK_CHIP: Record<string, [string, string, string]> = { high: ["Risk: High", "Risiko: Tinggi", chipSmDanger], medium: ["Risk: Medium", "Risiko: Sederhana", chipSmWarn], low: ["Risk: Low", "Risiko: Rendah", chipSmSuccess], none: ["Target reached", "Sasaran dicapai", chipSmSuccess] };

/** Row 2, left: the week against its target - one bar, four facts, Manage targets and View sales details. */
export function SalesPaceCard({ d, go, canSales, refresh }: { d: WeekDash; go: (t: TabName) => void; canSales: boolean; refresh: () => void }) {
  const [alloc, setAlloc] = useState(false);
  const [targets, setTargets] = useState(false);
  const [introduce, setIntroduce] = useState(false);
  const o = d.outlook, me = d.me, c = d.company;
  const exec = Boolean(o);
  const behind = me && ["at_risk", "action", "missed"].includes(me.status);
  if (exec && o) {
    const r = o.risk.level && RISK_CHIP[o.risk.level] ? RISK_CHIP[o.risk.level]! : null;
    return (
      <Box title={L("Sales target & pace", "Sasaran & rentak jualan")} label={L("Weekly sales target", "Sasaran jualan mingguan")} testid="sales-pace"
        action={d.can_set ? <Pill onClick={() => setAlloc(true)}>{L("Manage targets", "Urus sasaran")}</Pill> : undefined}>
        {/* v1.275.0 - what the company figure counts, on the dates line (the card keeps its height); the parts are on Sales and in the title */}
        <p className={css.dates} data-testid="company-basis" title={c.basis_kind === "all_channels" ? companyBasisLine(c, L) : undefined}>{dmy(d.week.from)} – {dmy(d.week.to)}{c.basis_kind === "all_channels" ? L(" · all channels", " · semua saluran") : ""}</p>
        {c.target_cents === null ? <p className={css.notSet}>{L("Target Not Set", "Sasaran Belum Ditetapkan")}</p> : (
          <>
            <p className={css.split}><span><strong className={css.big}>{fmtRM(c.basis_cents)}</strong> / {fmtRM(c.target_cents)}</span>{r && <span className={r[2]}>{L(r[0], r[1])}</span>}</p>
            <Bar pct={c.pct} label={L(`${c.pct ?? 0}% of ${fmtRM(c.target_cents)}`, `${c.pct ?? 0}% daripada ${fmtRM(c.target_cents)}`)} />
          </>
        )}
        <dl className={css.facts}>
          <dt>{L("Invoiced this week", "Diinvois minggu ini")}</dt><dd>{fmtRM(o.invoiced.cents)}</dd>
          <dt>{L("Best week", "Minggu terbaik")}</dt><dd>{o.best_week ? fmtRM(o.best_week.cents) : "—"}</dd>
          <dt>{L("Confidence", "Keyakinan")}</dt><dd>{o.confidence.level === "not_enough_data" ? L("Not enough data", "Data tidak mencukupi") : o.confidence.level === "high" ? L("High", "Tinggi") : o.confidence.level === "medium" ? L("Medium", "Sederhana") : L("Low", "Rendah")}</dd>
          <dt>{L("Pipeline cover", "Perlindungan saluran")}</dt><dd>{o.risk.ratio !== null ? L(`${o.risk.ratio}× the gap`, `${o.risk.ratio}× baki`) : "—"}</dd>
        </dl>
        <div className={css.foot}>{canSales && <button type="button" className={btnSmPrimary} onClick={() => go("Sales")}>{L("View sales details", "Lihat butiran jualan")}<AppIcon name="next" /></button>}</div>
        {alloc && <AllocationDrawer week={d.week.from} onClose={() => setAlloc(false)} onSaved={refresh} onGoals={() => { setAlloc(false); setTargets(true); }} />}
        {targets && <TargetsDrawer week={d.week.from} onClose={() => setTargets(false)} onSaved={refresh} />}
      </Box>
    );
  }
  /* a staff member: MY week - my target or goal, why it applies to my role, my progress */
  const goal = me?.goals[0];
  return (
    <Box title={L("My week", "Minggu saya")} label={L("Weekly sales target", "Sasaran jualan mingguan")} testid="sales-pace"
      action={me && me.target_cents !== null ? chip(me.status) : undefined}>
      <p className={css.dates}>{dmy(d.week.from)} – {dmy(d.week.to)} · {L(`company ${c.pct ?? 0}%`, `syarikat ${c.pct ?? 0}%`)}</p>
      {me && me.target_cents !== null ? (
        <>
          <p className={css.split}><span><strong className={css.big}>{fmtRM(me.basis_cents)}</strong> / {fmtRM(me.target_cents)}</span><span>{(me.gap_cents ?? 0) > 0 ? L(`${fmtRM(me.gap_cents ?? 0)} left`, `${fmtRM(me.gap_cents ?? 0)} lagi`) : L("Reached", "Dicapai")}</span></p>
          <Bar pct={me.pct} label={`${me.pct ?? 0}%`} />
        </>
      ) : goal ? (
        <>
          <p className={css.split}><span><strong className={css.big}>{goal.actual} / {goal.target}</strong> {GOAL_LABEL[goal.metric] ? L(GOAL_LABEL[goal.metric]![0], GOAL_LABEL[goal.metric]![1]) : goal.metric}</span>{me!.goals.length > 1 && <span>{L(`+${me!.goals.length - 1} more`, `+${me!.goals.length - 1} lagi`)}</span>}</p>
          <Bar pct={goal.target ? Math.round((goal.actual / goal.target) * 100) : 0} label={`${goal.actual}/${goal.target}`} />
        </>
      ) : <p className={css.notSet}>{L("No individual target this week", "Tiada sasaran individu minggu ini")}</p>}
      {me?.kind && KIND[me.kind] && <p className={css.why}><strong>{L(KIND[me.kind]![0], KIND[me.kind]![1])}.</strong> {L(KIND[me.kind]![2], KIND[me.kind]![3])}</p>}
      <div className={css.foot}>
        {canSales && behind ? <button type="button" className={btnSmPrimary} onClick={() => go("Sales")}><AppIcon name="target" />{me?.plan ? L("My recovery plan", "Pelan pemulihan saya") : L("Submit recovery plan", "Hantar pelan pemulihan")}</button>
          : canSales ? <button type="button" className={btnSm} onClick={() => go("Sales")}>{L("View details", "Lihat butiran")}<AppIcon name="next" /></button>
            : me && <button type="button" className={btnSm} onClick={() => setIntroduce(true)}><AppIcon name="add" />{L("Introduce a lead", "Perkenalkan petunjuk")}</button>}
      </div>
      <IntroduceLead open={introduce} onClose={() => setIntroduce(false)} />
    </Box>
  );
}

/** What a quotation's status says on the Dashboard - only what is recorded:
    the owner's outcome, the open follow-up, or that nothing is recorded. */
/** v1.291.0 - exported for the Dashboard's Sales Recovery strip (the same words) */
export function oppStatus(o: Opportunity, today: string): [string, string] {
  if (o.acceptance?.current) return [L("Accepted", "Diterima"), chipSmSuccess];
  if (o.last_contact?.outcome && OUTCOME[o.last_contact.outcome]) return [L(OUTCOME[o.last_contact.outcome]![0], OUTCOME[o.last_contact.outcome]![1]), OUTCOME[o.last_contact.outcome]![2]];
  if (o.next) return o.next.due_on < today ? [L("Follow-up late", "Susulan lewat"), chipSmWarn] : o.next.due_on === today ? [L("Follow-up today", "Susulan hari ini"), chipSmInfo] : [L(`Follow-up ${dmy(o.next.due_on)}`, `Susulan ${dmy(o.next.due_on)}`), chipSmNeutral];
  return [L("No follow-up", "Tiada susulan"), chipSmWarn];
}

/** Row 2, centre: the count and value, the top three, one View all into Sales. */
export function PipelineCard({ d, openAll, openDoc }: { d: WeekDash; openAll: () => void; openDoc: (id: number) => void }) {
  const rows = (d.opportunities ?? []).slice(0, 3);
  const total = d.outlook?.open_quotations ?? d.me?.open_quotations ?? null;
  return (
    <Box title={d.outlook ? L("Pipeline & quotations", "Saluran & sebut harga") : L("My open quotations", "Sebut harga terbuka saya")} label={L("Open quotations", "Sebut harga terbuka")} testid="pipeline"
      chipText={total ? `${total.n} · ${fmtRM(total.cents)}` : undefined} action={<Pill onClick={openAll}>{L("View all", "Lihat semua")}</Pill>}>
      {rows.length === 0 ? <p className={css.muted}>{L("No open quotations.", "Tiada sebut harga terbuka.")}</p> : (
        <ul className={css.lines}>
          {rows.map((o) => {
            const [word, tone] = oppStatus(o, d.week.today);
            return (
              <li key={o.id}>
                <button type="button" className={css.lineBtn} onClick={() => openDoc(o.id)} title={L("Open this quotation in Sales", "Buka sebut harga ini dalam Jualan")}>
                  <span className={css.lineText}><strong>{o.doc_number} · {o.company ?? "-"}</strong><span>{fmtRM(o.total_cents)} · {L(`${o.age_days} days`, `${o.age_days} hari`)}{o.owner.name && d.outlook ? ` · ${o.owner.name}` : ""}</span></span>
                  <span className={tone}>{word}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Box>
  );
}

/** Row 2, right (Finance readers who are management): what is known, and
    that cash is NOT known until banks and opening balances are entered. */
export function FinanceHealthCard({ d, unpaid, openFinance }: { d: WeekDash; unpaid: number | null; openFinance: () => void }) {
  const cw = d.outlook?.cash_watch ?? null;
  return (
    <Box title={L("Financial health", "Kesihatan kewangan")} label={L("Financial health", "Kesihatan kewangan")} testid="finance-health" action={<Pill onClick={openFinance}>{L("Finance", "Kewangan")}</Pill>}>
      <dl className={css.facts}>
        <dt>{L("Cash available", "Tunai tersedia")}</dt><dd>{L("Data not available", "Data tidak tersedia")}</dd>
        <dt>{L("Bank accounts", "Akaun bank")}</dt><dd>{cw === null ? L("Data not available", "Data tidak tersedia") : cw.banks === 0 ? L("Not set up", "Belum disediakan") : L(`${cw.banks} · ${cw.with_opening} with opening balance`, `${cw.banks} · ${cw.with_opening} dengan baki pembukaan`)}</dd>
        <dt>{L("Unpaid invoices", "Invois belum dibayar")}</dt><dd>{unpaid ?? "—"}</dd>
      </dl>
      <p className={css.alert}><AppIcon name="lock" />{L("Cash runway is not calculated without a bank account and a verified opening balance per company. A2Z Creative Marketing and AZ ONE OFFICIAL are never added together.", "Jangka hayat tunai tidak dikira tanpa akaun bank dan baki pembukaan disahkan bagi setiap syarikat. A2Z Creative Marketing dan AZ ONE OFFICIAL tidak dicampur.")}</p>
    </Box>
  );
}

/** Row 3, left: the three most urgent pieces of advice, one button each. */
export function AdviceSummaryCard({ d, refresh, onNavigate, openAll }: { d: WeekDash; refresh: () => void; onNavigate: (a: "allocate" | "plan" | "tasks") => void; openAll: () => void }) {
  const a = d.advisory!;
  return (
    <Box title={L("Sales advice", "Nasihat jualan")} label={L("Sales advice", "Nasihat jualan")} testid="advice"
      chipText={a.total > 3 ? L(`3 of ${a.total}`, `3 daripada ${a.total}`) : a.total ? String(a.total) : undefined} action={<Pill onClick={openAll}>{L("View all", "Lihat semua")}</Pill>}>
      <AdviceList compact cards={a.cards.slice(0, 3)} total={a.total} onDone={refresh} onNavigate={onNavigate} />
    </Box>
  );
}

/** Row 3, centre: my follow-ups due today or late, then my sales tasks - three lines. */
export function TodayFocusCard({ d, openFollowups, openTask, openDay }: { d: WeekDash; openFollowups: () => void; openTask: (id: number) => void; openDay: () => void }) {
  const me = d.me!;
  const lines: { key: string; title: string; sub: string; late: boolean; on: () => void }[] = [
    ...(me.next_followups ?? []).map((f) => ({ key: `f${f.id}`, title: f.note, sub: `${f.due_on < d.week.today ? L("Follow-up late", "Susulan lewat") : L("Follow-up due today", "Susulan hari ini")} · ${f.company ?? "-"}`, late: f.due_on < d.week.today, on: openFollowups })),
    ...me.top_tasks.map((t) => ({ key: `t${t.id}`, title: t.title, sub: `${L("Sales task", "Tugasan jualan")} · ${t.deadline ? dmy(t.deadline) : L("no due date", "tiada tarikh")}`, late: Boolean(t.deadline && t.deadline < d.week.today), on: () => openTask(t.id) })),
  ].slice(0, 3);
  return (
    <Box title={L("Today's focus", "Fokus hari ini")} label={L("Today's focus", "Fokus hari ini")} testid="today-focus" action={<Pill onClick={openDay}>{L("My Day", "Hari Saya")}</Pill>}>
      {lines.length === 0 ? <p className={css.muted}>{L("Nothing due today.", "Tiada yang perlu hari ini.")}</p> : (
        <ul className={css.lines}>
          {lines.map((x) => (
            <li key={x.key}>
              <button type="button" className={css.lineBtn} onClick={x.on}>
                <span className={css.lineText}><strong className={css.keep}>{x.title}</strong><span>{x.sub}</span></span>
                {x.late && <span className={chipSmWarn}>{L("Late", "Lewat")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}

/** Row 4: the people behind the target - the weakest four, one View team into Sales. */
export function TeamPerformanceCard({ d, openTeam }: { d: WeekDash; openTeam: () => void }) {
  const rows = (d.all?.rows ?? d.team?.rows ?? []).slice(0, 4);
  return (
    <Box title={L("Team performance", "Prestasi pasukan")} label={L("Team performance", "Prestasi pasukan")} testid="team-performance" chipText={L("this week", "minggu ini")} action={<Pill onClick={openTeam}>{L("View team", "Lihat pasukan")}</Pill>}>
      {rows.length === 0 ? <p className={css.muted}>{L("No one on the scorecard this week.", "Tiada sesiapa dalam kad skor minggu ini.")}</p> : (
        <ul className={css.people}>
          {rows.map((r) => (
            <li key={r.user_id}>
              <span className={css.who}>{r.name}</span>
              <span className={css.amt}>{r.target_cents === null ? fmtRM(r.basis_cents) : `${fmtRM(r.basis_cents)} / ${fmtRM(r.target_cents)}`}</span>
              {chip(r.status)}
              {r.plan && <span className={chipSmNeutral}>{L(PLAN_WORD[r.plan]?.[0] ?? r.plan, PLAN_WORD[r.plan]?.[1] ?? r.plan)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}
