"use client";

/* v1.320.0 - SALES 2.0 (the CEO's six pictures; claude/SALES-2.0-STAGE-0-AUDIT.md,
   "Proceed the recommend"). Stage 1, the design foundation, and Stage 2, the
   Overview (picture 01):

     QuoteBadge / InvoiceBadge   the one word for a quotation and an invoice
                                 (S2-4, lib/sales-status.ts)
     SalesPipeline               the seven steps with a count each; pressing a
                                 step filters the worklist under it (S2-5)
     SalesOverview2              picture 01: six figures, the pipeline, the
                                 worklist, and the rail - Important Follow-Ups,
                                 Recent Payment Activity, Team Sales Performance

   SCREENS ONLY. Every figure is one the Sales tab already reads (the weekly
   figures, the documents, the payment engine's verified and reported parts,
   the follow-ups, the open quotations, the enquiries). Nothing here writes,
   no payment, commission or numbering rule changes, and a figure with no
   source is not drawn (no "+22% vs last week" without last week's figure). */

import type { ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { FlowStrip, type FlowStep } from "@/components/ui/flow-strip";
import { Panel, WorkspaceGrid } from "@/components/ui/panel";
import { SkelRows } from "@/components/ui/skeleton";
import { fmtRM } from "@/lib/format";
import { btnSm, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import { PIPELINE, invoiceStatus, type InvoiceLike, type PayFacts, type PipeKey, type QuoteKey } from "@/lib/sales-status";
import s2 from "./sales2.module.css";

/* ---------------- the words (S2-4) ---------------- */
const QUOTE_WORD: Record<QuoteKey, [string, string, string]> = {
  open: ["Open", "Terbuka", chipSmNeutral], follow_up: ["Follow-up", "Susulan", chipSmWarn], accepted: ["Accepted", "Diterima", chipSmSuccess],
  part_invoiced: ["Partially invoiced", "Diinvois separa", chipSmInfo], invoiced: ["Invoiced", "Diinvois", chipSmSuccess],
};
export function QuoteBadge({ status }: { status: QuoteKey }) {
  const w = QUOTE_WORD[status];
  return <span className={w[2]} data-testid="quote-badge" data-status={status}>{L(w[0], w[1])}</span>;
}
export function InvoiceBadge({ inv, pay }: { inv: InvoiceLike; pay?: PayFacts | null }) {
  const st = invoiceStatus(inv, pay);
  const w: [string, string, string] = st.key === "paid" ? ["Paid", "Dibayar", chipSmSuccess] : st.key === "part_paid" ? ["Partially paid", "Dibayar separa", chipSmWarn]
    : st.key === "void" ? ["Void", "Batal", chipSmNeutral] : ["Unpaid", "Belum dibayar", chipSmNeutral];
  return (
    <span className={s2.badges} data-testid="invoice-badge" data-status={st.key}>
      <span className={w[2]}>{L(w[0], w[1])}</span>
      {st.overdue && <span className={chipSmDanger}>{L("Overdue", "Lewat")}</span>}
    </span>
  );
}

/* ---------------- the pipeline (S2-5) ---------------- */
const PIPE: Record<PipeKey, [FlowStep["icon"], string, string, FlowStep["tone"]]> = {
  enquiry: ["chat", "Enquiry", "Pertanyaan", "neutral"], quotation: ["document", "Quotation", "Sebut Harga", "gold"], follow_up: ["person", "Follow-Up", "Susulan", "gold"],
  invoice: ["receipt", "Invoice", "Invois", "blue"], reported: ["upload", "Payment Reported", "Bayaran Dilapor", "blue"], verified: ["verify", "CEO Verified", "Disahkan CEO", "green"],
  closed: ["success", "Closed Sale", "Jualan Ditutup", "green"],
};
export const pipeWord = (k: PipeKey) => L(PIPE[k][1], PIPE[k][2]);
export function SalesPipeline({ counts, picked, onPick, loaded }: { counts: Record<PipeKey, number>; picked: PipeKey | null; onPick: (k: PipeKey) => void; loaded: boolean }) {
  const steps: FlowStep[] = PIPELINE.map((k) => ({ key: k, icon: PIPE[k][0], label: L(PIPE[k][1], PIPE[k][2]), tone: PIPE[k][3], count: loaded ? counts[k] : null, onClick: () => onPick(k), pressed: picked === k }));
  return <FlowStrip steps={steps} label={L("Sales pipeline", "Saluran jualan")} testid="sales-pipeline" compact />;
}

/* ---------------- picture 01: the Overview ---------------- */
export interface OverviewFollowUp { id: number; company: string; note: string | null; due_on: string; open: () => void }
export interface OverviewInvoice { id: number; doc_number: string; company: string; total_cents: number; inv: InvoiceLike; pay: PayFacts | null; open: () => void }
export interface OverviewPerson { id: number; name: string; cents: number }
export interface OverviewFigures {
  /** Mine: the person's own week and target (a consultant's view, and anyone who presses Mine) */
  mine: boolean;
  /** the week's sales: the company's (Everyone) or the person's own (Mine), and the words for what it counts */
  week: { cents: number | null; sub: string } | null;
  target: { cents: number | null; pct: number | null; left_cents: number | null } | null;
  outstanding: { cents: number; n: number; verified: boolean } | null;
  pending: { cents: number; n: number } | null;
  followups: { n: number; customers: number; overdue: number };
  quotes: { n: number; cents: number };
}

const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
function dueChip(due: string, today: string) {
  if (due < today) return <span className={chipSmDanger}>{L(`Overdue · ${day(due)}`, `Lewat · ${day(due)}`)}</span>;
  if (due === today) return <span className={chipSmDanger}>{L("Due today", "Hari ini")}</span>;
  if (due === addDays(today, 1)) return <span className={chipSmWarn}>{L("Due tomorrow", "Esok")}</span>;
  return <span className={chipSmNeutral}>{day(due)}</span>;
}

export function SalesOverview2({ figures, loaded, pipeline, picked, onPick, worklist, followups, invoices, team, today, onAllFollowups, onAllInvoices, toPayments, toReports }: {
  figures: OverviewFigures; loaded: boolean;
  pipeline: Record<PipeKey, number>; picked: PipeKey | null; onPick: (k: PipeKey) => void;
  /** the one worklist (sales-shell.tsx SalesWorklist), already narrowed to the step picked */
  worklist: ReactNode;
  followups: OverviewFollowUp[]; invoices: OverviewInvoice[];
  /** the week's collected sales by person - management only; null draws no panel */
  team: { rows: OverviewPerson[]; total_cents: number } | null;
  today: string;
  onAllFollowups: () => void; onAllInvoices: () => void; toPayments: () => void; toReports: () => void;
}) {
  const f = figures;
  const teamMax = team ? Math.max(1, ...team.rows.map((r) => r.cents)) : 1;
  return (
    <div className={s2.page} data-testid="sales-overview-2">
      <KpiRow label={L("Sales at a glance", "Jualan sepintas lalu")} cols={6}>
        <KpiTile icon="money" tone="green" label={f.mine ? L("My Sales This Week", "Jualan Saya Minggu Ini") : L("Sales This Week", "Jualan Minggu Ini")} busy={!f.week} value={f.week?.cents != null ? fmtRM(f.week.cents) : "—"} sub={f.week?.sub} onClick={toReports} />
        <KpiTile icon="target" tone="gold" label={f.mine ? L("My Weekly Target", "Sasaran Mingguan Saya") : L("Weekly Target", "Sasaran Mingguan")} busy={!f.target}
          value={f.target?.cents != null ? fmtRM(f.target.cents) : L("Not set", "Belum ditetapkan")}
          sub={f.target?.pct != null ? L(`${f.target.pct}% achieved${f.target.left_cents != null ? ` · ${fmtRM(Math.max(0, f.target.left_cents))} left` : ""}`, `${f.target.pct}% dicapai${f.target.left_cents != null ? ` · baki ${fmtRM(Math.max(0, f.target.left_cents))}` : ""}`) : undefined}
          bar={f.target?.pct != null ? { pct: f.target.pct, tone: "gold" } : undefined} onClick={toReports} />
        <KpiTile icon="pending" tone="red" label={f.outstanding?.verified ? L("Verified Outstanding", "Tertunggak Disahkan") : L("Outstanding", "Tertunggak")} busy={!loaded || !f.outstanding}
          value={f.outstanding ? fmtRM(f.outstanding.cents) : "—"}
          sub={f.outstanding ? (f.outstanding.verified ? L(`${f.outstanding.n} invoice(s) · less verified payments`, `${f.outstanding.n} invois · tolak bayaran disahkan`) : L(`${f.outstanding.n} invoice(s)`, `${f.outstanding.n} invois`)) : undefined}
          onClick={() => onPick("invoice")} />
        {f.pending
          ? <KpiTile icon="verify" tone="blue" label={L("Pending CEO Verification", "Menunggu Pengesahan CEO")} value={fmtRM(f.pending.cents)}
              sub={L(`${f.pending.n} payment(s) · waiting for the CEO`, `${f.pending.n} bayaran · menunggu CEO`)} onClick={toPayments} />
          : <KpiTile icon="verify" tone="blue" label={L("Pending CEO Verification", "Menunggu Pengesahan CEO")} value="—" sub={L("Payment verification is off", "Pengesahan bayaran dimatikan")} />}
        <KpiTile icon="date" tone="purple" label={L("Due Follow-Ups", "Susulan Perlu")} busy={!loaded} value={f.followups.n}
          sub={L(`${f.followups.customers} customer(s) · ${f.followups.overdue} overdue`, `${f.followups.customers} pelanggan · ${f.followups.overdue} lewat`)} onClick={() => onPick("follow_up")} />
        <KpiTile icon="document" tone="blue" label={L("Open Quotations", "Sebut Harga Terbuka")} busy={!loaded} value={f.quotes.n}
          sub={L(`${fmtRM(f.quotes.cents)} · not yet invoiced`, `${fmtRM(f.quotes.cents)} · belum diinvois`)} onClick={() => onPick("quotation")} />
      </KpiRow>

      <Panel icon="chart" tone="navy" title={L("Sales Pipeline", "Saluran Jualan")} testid="pipeline-panel"
        sub={L("End-to-end sales flow from enquiry to closed sale. Each count is what that step holds now; press a step to see its records.", "Aliran jualan dari pertanyaan hingga jualan ditutup. Setiap kiraan ialah apa yang ada pada langkah itu sekarang; tekan untuk melihat rekodnya.")}
        aside={picked ? <button type="button" className={btnSm} onClick={() => onPick(picked)} data-testid="pipeline-clear"><AppIcon name="error" />{L(`Clear: ${pipeWord(picked)}`, `Kosongkan: ${pipeWord(picked)}`)}</button> : undefined}>
        <SalesPipeline counts={pipeline} picked={picked} onPick={onPick} loaded={loaded} />
      </Panel>

      <WorkspaceGrid testid="overview-grid"
        main={worklist}
        rail={<>
          <Panel icon="date" tone="red" title={L("Important Follow-Ups", "Susulan Penting")} count={loaded ? followups.length : null} testid="important-followups" level={3}
            aside={<button type="button" className={btnSm} onClick={onAllFollowups}>{L("View all", "Lihat semua")}<AppIcon name="next" /></button>}>
            {!loaded ? <SkelRows rows={3} /> : followups.length === 0 ? <p className={s2.empty}><AppIcon name="success" />{L("No follow-up is due.", "Tiada susulan perlu.")}</p> : (
              <ul className={s2.list}>
                {followups.slice(0, 4).map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={x.open} className={s2.item}>
                      <span className={s2.dot} data-late={x.due_on <= today || undefined} aria-hidden />
                      <span className={s2.itemText}><strong>{x.company}</strong><small>{x.note ?? L("Follow-up", "Susulan")}</small></span>
                      {dueChip(x.due_on, today)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel icon="receipt" tone="navy" title={L("Recent Payment Activity", "Aktiviti Bayaran Terkini")} testid="recent-payments" level={3}
            aside={<button type="button" className={btnSm} onClick={onAllInvoices}>{L("View all", "Lihat semua")}<AppIcon name="next" /></button>}>
            {!loaded ? <SkelRows rows={3} /> : invoices.length === 0 ? <p className={s2.empty}><AppIcon name="info" />{L("No invoice yet.", "Belum ada invois.")}</p> : (
              <ul className={s2.list}>
                {invoices.slice(0, 4).map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={x.open} className={s2.item}>
                      <span className={s2.docIcon} aria-hidden><AppIcon name="document" /></span>
                      <span className={s2.itemText}><strong>{x.doc_number}</strong><small>{x.company}</small></span>
                      <span className={s2.amt}>{fmtRM(x.total_cents)}</span>
                      <InvoiceBadge inv={x.inv} pay={x.pay} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {team && (
            <Panel icon="chart" tone="gold" title={L("Team Sales Performance", "Prestasi Jualan Pasukan")} testid="team-sales" level={3}
              aside={<span className={s2.period}>{L("This Week", "Minggu Ini")}</span>}>
              <div className={s2.teamHead}><strong>{fmtRM(team.total_cents)}</strong><small>{f.week?.sub ?? ""}</small></div>
              {team.rows.length === 0 ? <p className={s2.empty}>{L("No sales recorded this week.", "Tiada jualan direkod minggu ini.")}</p> : (
                <ol className={s2.team}>
                  {team.rows.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <span className={s2.teamName}>{r.name}</span>
                      <span className={s2.teamAmt}>{fmtRM(r.cents)}</span>
                      <span className={s2.bar} aria-hidden><span style={{ width: `${Math.round((r.cents / teamMax) * 100)}%` }} /></span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
        </>} />
    </div>
  );
}

