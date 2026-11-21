"use client";

/* v1.320.0 - SALES 2.0 (the CEO's six pictures; claude/SALES-2.0-STAGE-0-AUDIT.md,
   "Proceed the recommend"). Stage 1, the design foundation, and Stage 2, the
   Overview (picture 01):

     QuoteBadge / InvoiceBadge   the one word for a quotation and an invoice
                                 (S2-4, lib/sales-status.ts)
     SalesPipeline               the seven steps with a count each; pressing a
                                 step filters the worklist under it (S2-5)
     SalesOverview2              picture 01: six figures, the pipeline, the
                                 worklist, and the rail (v1.397.0: the Action
                                 Center, the week's target, the pipeline summary,
                                 the team and Recent Activities - sales-today.tsx)

   SCREENS ONLY. Every figure is one the Sales tab already reads (the weekly
   figures, the documents, the payment engine's verified and reported parts,
   the follow-ups, the open quotations, the enquiries). Nothing here writes,
   no payment, commission or numbering rule changes, and a figure with no
   source is not drawn (no "+22% vs last week" without last week's figure). */

import type { ReactNode } from "react";
import { L } from "@/components/portal/page-shared";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { FlowStrip, type FlowStep } from "@/components/ui/flow-strip";
import { Panel, WorkspaceGrid } from "@/components/ui/panel";
import { fmtRM } from "@/lib/format";
import { chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
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
  return <FlowStrip steps={steps} label={L("Sales pipeline", "Saluran jualan")} testid="sales-pipeline" compact arrows />;
}

/* ---------------- picture 01: the Overview ---------------- */
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

/* v1.397.0 - SALES COMMAND CENTER, PHASE 1 (the CEO, 21-11-2026). The same six figures from
   the same sources (unchanged), then My Sales Action Center beside the week's target and the
   pipeline summary, then Team Sales Performance (managers) and Recent Activities. The old
   worklist, Important Follow-Ups and Recent Payment Activity are now the Action Center and
   Recent Activities' Payments filter (sales-today.tsx) - one list, never two. */
export function SalesOverview2({ figures, loaded, pipeline, onPick, actionCenter, weeklyTarget, lower, toPayments, toReports, toFollowups }: {
  figures: OverviewFigures; loaded: boolean;
  pipeline: Record<PipeKey, number>;
  /** a pipeline step or a figure opens the records it counts (sales.tsx) */
  onPick: (k: PipeKey) => void;
  /** My Sales Action Center (sales-today.tsx ActionCenter) */
  actionCenter: ReactNode;
  /** Weekly Target Progress (sales-today.tsx WeeklyTargetPanel) */
  weeklyTarget: ReactNode;
  /** Team Sales Performance (managers) and Recent Activities */
  lower: ReactNode;
  toPayments: () => void; toReports: () => void;
  /** Due Follow-Ups opens the Action Center on its Overdue filter */
  toFollowups: () => void;
}) {
  const f = figures;
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
          sub={L(`${f.followups.customers} customer(s) · ${f.followups.overdue} overdue`, `${f.followups.customers} pelanggan · ${f.followups.overdue} lewat`)} onClick={toFollowups} />
        <KpiTile icon="document" tone="blue" label={L("Open Quotations", "Sebut Harga Terbuka")} busy={!loaded} value={f.quotes.n}
          sub={L(`${fmtRM(f.quotes.cents)} · not yet invoiced`, `${fmtRM(f.quotes.cents)} · belum diinvois`)} onClick={() => onPick("quotation")} />
      </KpiRow>

      <WorkspaceGrid testid="overview-grid"
        main={actionCenter}
        rail={<>
          {weeklyTarget}
          <Panel icon="chart" tone="navy" title={L("Sales Pipeline Summary", "Ringkasan Saluran Jualan")} testid="pipeline-panel" level={3}
            sub={L("Where every quotation and invoice stands now. Press a step to open its records.", "Di mana setiap sebut harga dan invois sekarang. Tekan langkah untuk membuka rekodnya.")}>
            <SalesPipeline counts={pipeline} picked={null} onPick={onPick} loaded={loaded} />
          </Panel>
        </>} />
      {lower}
    </div>
  );
}

