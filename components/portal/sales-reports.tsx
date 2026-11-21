"use client";

/* v1.403.0 - FOUR SALES REPORTS (Sales Command Center Phase 6; the CEO, 21-11-2026, "As recommended" on the seven
   Phase 6 decisions). worker/src/sales-reports.ts is the server - pure reads. They join the five reports Sales
   already has, in the same one-at-a-time picker (sales-shell.tsx ReportPicker), each mounted only when chosen.

     Team Performance   management only: ACTIVITY (contacts logged, follow-ups completed, quotations issued) in
                        one column group, RESULTS (deals won, invoices paid in full and their total) in another
     Pipeline           open deals by stage now, moves between stages, average days in a stage, won and lost
     Win / Loss         how deals were won, why they were lost (with the notes)
     Lead Sources       leads by source, how many became deals, how many were won

   A deal's value says quoted or estimate and is never revenue; money collected is only invoices paid in full
   (the weekly engine's own figure). Every count opens the records it counts; every table exports as CSV. */

import { useState, type ReactNode } from "react";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import { csvStampMyt, downloadCsv } from "@/lib/csv";
import { L } from "@/components/portal/page-shared";
import { PillSwitch } from "@/components/ui/panel";
import { SkelRows } from "@/components/ui/skeleton";
import { AppIcon } from "@/components/ui/app-icon";
import { btnSm, card, chipSmNeutral } from "@/lib/ui-styles";
import { LOST_WORD, STAGE_WORD, WON_WORD, type Stage } from "@/lib/pipeline-words";
import { LEAD_SOURCE_WORD } from "@/lib/crm-words";
import type { ReportDef } from "@/components/portal/sales-shell";
import css from "./sales-reports.module.css";

type Period = "week" | "month" | "last_month" | "3m" | "year";
interface Base { period: Period; from: string; to: string; scope: "mine" | "all"; can_all: boolean }
const PERIOD_WORD: Record<Period, [string, string]> = {
  week: ["This week", "Minggu ini"], month: ["This month", "Bulan ini"], last_month: ["Last month", "Bulan lepas"], "3m": ["Last 3 months", "3 bulan lepas"], year: ["This year", "Tahun ini"],
};
const w = (p: [string, string] | undefined, f: string) => (p ? L(p[0], p[1]) : f);
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const TOPICS = ["deals", "crm", "customers", "docs", "followups", "payments"];

export interface ReportNav {
  /** the Sales Pipeline (a stage, or the list of won / lost) */
  toPipeline: () => void;
  /** one deal in the Sales Pipeline */
  toDeal: (id: number) => void;
  /** Leads & CRM */
  toLeads: () => void;
  /** Closed Sales (the paid invoices) */
  toClosed: () => void;
}

/** the period and Mine / Everyone, the same above every one of the four */
function Controls({ period, onPeriod, scope, onScope, canAll, onCsv, testid }: {
  period: Period; onPeriod: (p: Period) => void; scope: "mine" | "all"; onScope?: (s: "mine" | "all") => void; canAll: boolean; onCsv: (() => void) | null; testid: string;
}) {
  return (
    <div className={css.controls}>
      <PillSwitch value={period} onChange={onPeriod} label={L("Period", "Tempoh")} testid={`${testid}-period`}
        options={(Object.keys(PERIOD_WORD) as Period[]).map((p) => [p, w(PERIOD_WORD[p], p)] as const)} />
      {canAll && onScope && <PillSwitch value={scope} onChange={onScope} label={L("Whose work", "Kerja siapa")} testid={`${testid}-scope`} options={[["mine", L("Mine", "Saya")], ["all", L("Everyone", "Semua")]] as const} />}
      {onCsv && <button type="button" className={btnSm} onClick={onCsv} data-testid={`${testid}-csv`}><AppIcon name="download" />{L("Export CSV", "Eksport CSV")}</button>}
    </div>
  );
}
function Shell({ title, sub, controls, children, testid }: { title: string; sub: string; controls: ReactNode; children: ReactNode; testid: string }) {
  return (
    <section className={`${card} ${css.sec}`} aria-label={title} data-testid={testid}>
      <div><h3 className={css.h}>{title}</h3><p className={css.meta}>{sub}</p></div>
      {controls}
      {children}
    </section>
  );
}
/** a count that opens what it counts */
function Count({ n, onOpen, label }: { n: number; onOpen?: () => void; label: string }) {
  if (!onOpen || n === 0) return <span className={css.num}>{n}</span>;
  return <button type="button" className={css.countBtn} onClick={onOpen} aria-label={label} data-testid="report-count">{n}</button>;
}
const periodLine = (d: Base | null | undefined) => (d ? `${dmy(d.from)} – ${dmy(d.to)}` : "");
const csvHead = (name: string, d: Base) => [[`${name} · ${dmy(d.from)} to ${dmy(d.to)} · ${d.scope === "all" ? "everyone" : "mine"} · exported ${csvStampMyt()}`]];

/* ---------------- Team Performance ---------------- */
interface TeamRow { user_id: number; name: string; activity: { contacts: number; followups_done: number; quotations: number }; results: { deals_won: number; deals_won_cents: number; paid_invoices: number; collected_cents: number } }
function TeamReport({ nav }: { nav: ReportNav }) {
  const [period, setPeriod] = useState<Period>("month");
  const r = useCachedApi<Base & { rows: TeamRow[]; total: Omit<TeamRow, "user_id" | "name"> }>(`/staff/sales/reports/team?period=${period}`, true, TOPICS);
  const d = r.data;
  const csv = d ? () => downloadCsv(`team-performance-${d.from}-${d.to}`, [...csvHead("Team Performance", d),
    ["Salesperson", "Contacts logged", "Follow-ups completed", "Quotations issued", "Deals won", "Deals won value (not revenue)", "Invoices paid in full", "Paid in full (RM)"],
    ...d.rows.map((x) => [x.name, x.activity.contacts, x.activity.followups_done, x.activity.quotations, x.results.deals_won, (x.results.deals_won_cents / 100).toFixed(2), x.results.paid_invoices, (x.results.collected_cents / 100).toFixed(2)])]) : null;
  return (
    <Shell testid="report-team" title={L("Team Performance", "Prestasi Pasukan")} sub={`${periodLine(d)} · ${L("Activity is what was done; results are what came of it. Deal value is not revenue; paid means invoices paid in full.", "Aktiviti ialah apa yang dibuat; hasil ialah apa yang terhasil. Nilai urusan bukan hasil; dibayar bermaksud invois dibayar penuh.")}`}
      controls={<Controls period={period} onPeriod={setPeriod} scope="all" canAll={false} onCsv={csv} testid="team" />}>
      {r.failed && !d ? <Failed /> : !d ? <SkelRows rows={5} /> : (
        <div className={css.scroll}>
          <table className={css.table} data-testid="team-table">
            <thead>
              <tr><th rowSpan={2}>{L("Salesperson", "Jurujual")}</th><th colSpan={3} className={css.grpA} data-testid="team-activity-head">{L("Activity", "Aktiviti")}</th><th colSpan={3} className={css.grpR} data-testid="team-results-head">{L("Results", "Hasil")}</th></tr>
              <tr><th className={css.n}>{L("Contacts", "Hubungan")}</th><th className={css.n}>{L("Follow-ups done", "Susulan selesai")}</th><th className={css.n}>{L("Quotations", "Sebut harga")}</th>
                <th className={css.n}>{L("Deals won", "Urusan berjaya")}</th><th className={css.n}>{L("Invoices paid", "Invois dibayar")}</th><th className={css.n}>{L("Paid in full", "Dibayar penuh")}</th></tr>
            </thead>
            <tbody>
              {d.rows.map((x) => (
                <tr key={x.user_id} data-testid="team-row">
                  <th scope="row">{x.name}</th>
                  <td className={css.n}>{x.activity.contacts}</td><td className={css.n}>{x.activity.followups_done}</td><td className={css.n}>{x.activity.quotations}</td>
                  <td className={css.n}><Count n={x.results.deals_won} onOpen={nav.toPipeline} label={L(`Open ${x.name}'s won deals`, `Buka urusan berjaya ${x.name}`)} />{x.results.deals_won_cents ? <span className={css.sub}>{fmtRM(x.results.deals_won_cents)}</span> : null}</td>
                  <td className={css.n}><Count n={x.results.paid_invoices} onOpen={nav.toClosed} label={L("Open Closed Sales", "Buka Jualan Ditutup")} /></td>
                  <td className={css.n}>{fmtRM(x.results.collected_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr data-testid="team-total"><th scope="row">{L("Total", "Jumlah")}</th>
              <td className={css.n}>{d.total.activity.contacts}</td><td className={css.n}>{d.total.activity.followups_done}</td><td className={css.n}>{d.total.activity.quotations}</td>
              <td className={css.n}>{d.total.results.deals_won}</td><td className={css.n}>{d.total.results.paid_invoices}</td><td className={css.n}>{fmtRM(d.total.results.collected_cents)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

/* ---------------- Pipeline ---------------- */
interface PipeData extends Base {
  now: { stage: Stage; deals: number; quoted_cents: number; estimated_cents: number }[];
  moves: { from: Stage; to: Stage; n: number }[];
  avg_days: { stage: Stage; n: number; days: number | null }[];
  won: { n: number; cents: number }; lost: { n: number; cents: number };
}
function PipelineReport({ nav, exec }: { nav: ReportNav; exec: boolean }) {
  const [period, setPeriod] = useState<Period>("month");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const r = useCachedApi<PipeData>(`/staff/sales/reports/pipeline?period=${period}&scope=${scope}`, true, TOPICS);
  const d = r.data;
  const csv = d ? () => downloadCsv(`pipeline-${d.from}-${d.to}`, [...csvHead("Pipeline", d),
    ["Stage (open now)", "Deals", "Quoted (RM)", "Estimated (RM)", "Average days in stage (left in period)"],
    ...d.now.map((x) => [STAGE_WORD[x.stage][0], x.deals, (x.quoted_cents / 100).toFixed(2), (x.estimated_cents / 100).toFixed(2), d.avg_days.find((a) => a.stage === x.stage)?.days ?? ""]),
    [], ["Moved from", "Moved to", "Deals"], ...d.moves.map((m) => [STAGE_WORD[m.from]?.[0] ?? m.from, STAGE_WORD[m.to]?.[0] ?? m.to, m.n]),
    [], ["Won in period", d.won.n, (d.won.cents / 100).toFixed(2)], ["Lost in period", d.lost.n, (d.lost.cents / 100).toFixed(2)]]) : null;
  return (
    <Shell testid="report-pipeline" title={L("Pipeline", "Saluran")} sub={`${periodLine(d)} · ${L("Open deals are counted as they stand today; moves, won and lost are in the period. Values are quoted or estimated, never revenue.", "Urusan terbuka dikira seperti hari ini; alihan, berjaya dan gagal dalam tempoh. Nilai disebut harga atau anggaran, bukan hasil.")}`}
      controls={<Controls period={period} onPeriod={setPeriod} scope={scope} onScope={setScope} canAll={exec} onCsv={csv} testid="pipe" />}>
      {r.failed && !d ? <Failed /> : !d ? <SkelRows rows={5} /> : (<>
        <div className={css.scroll}>
          <table className={css.table} data-testid="pipe-now">
            <thead><tr><th>{L("Stage (open now)", "Peringkat (terbuka kini)")}</th><th className={css.n}>{L("Deals", "Urusan")}</th><th className={css.n}>{L("Quoted", "Disebut harga")}</th><th className={css.n}>{L("Estimated", "Anggaran")}</th><th className={css.n}>{L("Avg days in stage", "Purata hari di peringkat")}</th></tr></thead>
            <tbody>{d.now.map((x) => { const a = d.avg_days.find((y) => y.stage === x.stage); return (
              <tr key={x.stage} data-testid="pipe-stage" data-stage={x.stage}>
                <th scope="row">{w(STAGE_WORD[x.stage], x.stage)}</th>
                <td className={css.n}><Count n={x.deals} onOpen={nav.toPipeline} label={L("Open the Sales Pipeline", "Buka Saluran Jualan")} /></td>
                <td className={css.n}>{fmtRM(x.quoted_cents)}</td><td className={css.n}>{fmtRM(x.estimated_cents)}</td>
                <td className={css.n}>{a?.days != null ? L(`${a.days} days`, `${a.days} hari`) : "—"}</td>
              </tr>); })}</tbody>
          </table>
        </div>
        <div className={css.pair}>
          <div className={css.box} data-testid="pipe-moves">
            <h4 className={css.h4}>{L("Moves in the period", "Alihan dalam tempoh")}</h4>
            {d.moves.length === 0 ? <p className={css.meta}>{L("No deal changed stage in this period.", "Tiada urusan bertukar peringkat dalam tempoh ini.")}</p> : (
              <ul className={css.list}>{d.moves.map((m) => <li key={`${m.from}>${m.to}`}><span>{w(STAGE_WORD[m.from], m.from)} → {w(STAGE_WORD[m.to], m.to)}</span><b>{m.n}</b></li>)}</ul>
            )}
          </div>
          <div className={css.box} data-testid="pipe-closed">
            <h4 className={css.h4}>{L("Closed in the period", "Ditutup dalam tempoh")}</h4>
            <ul className={css.list}>
              <li><span>{L("Won", "Berjaya")} <span className={chipSmNeutral}>{L("not revenue", "bukan hasil")}</span></span><b><Count n={d.won.n} onOpen={nav.toPipeline} label={L("Open won deals", "Buka urusan berjaya")} /> · {fmtRM(d.won.cents)}</b></li>
              <li><span>{L("Lost", "Gagal")}</span><b><Count n={d.lost.n} onOpen={nav.toPipeline} label={L("Open lost deals", "Buka urusan gagal")} /> · {fmtRM(d.lost.cents)}</b></li>
            </ul>
          </div>
        </div>
      </>)}
    </Shell>
  );
}

/* ---------------- Win / Loss ---------------- */
interface WlRow { id: number; title: string; customer: string; owner: string | null; stage: "won" | "lost"; won_basis: "acceptance" | "invoice" | "override" | null; override_reason: string | null; lost_reason: string | null; lost_note: string | null; closed_at: string; value_cents: number | null; value_basis: string }
function WinLossReport({ nav, exec }: { nav: ReportNav; exec: boolean }) {
  const [period, setPeriod] = useState<Period>("month");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const r = useCachedApi<Base & { won: { basis: "acceptance" | "invoice" | "override"; n: number; cents: number }[]; lost: { reason: string; n: number; cents: number }[]; rows: WlRow[] }>(
    `/staff/sales/reports/winloss?period=${period}&scope=${scope}`, true, TOPICS);
  const d = r.data;
  const csv = d ? () => downloadCsv(`win-loss-${d.from}-${d.to}`, [...csvHead("Win / Loss", d),
    ["Deal", "Customer", "Owner", "Result", "Why", "Note", "Value (RM, not revenue)", "Closed (MYT)"],
    ...d.rows.map((x) => [x.title, x.customer, x.owner ?? "", x.stage, x.stage === "won" ? WON_WORD[x.won_basis ?? "acceptance"]?.[0] ?? "" : LOST_WORD[x.lost_reason as keyof typeof LOST_WORD]?.[0] ?? "",
      x.stage === "won" ? x.override_reason ?? "" : x.lost_note ?? "", x.value_cents != null ? (x.value_cents / 100).toFixed(2) : "", x.closed_at.slice(0, 10)])]) : null;
  return (
    <Shell testid="report-winloss" title={L("Win / Loss", "Berjaya / Gagal")} sub={`${periodLine(d)} · ${L("How deals were won and why they were lost. Won is not revenue.", "Bagaimana urusan berjaya dan mengapa gagal. Berjaya bukan hasil.")}`}
      controls={<Controls period={period} onPeriod={setPeriod} scope={scope} onScope={setScope} canAll={exec} onCsv={csv} testid="wl" />}>
      {r.failed && !d ? <Failed /> : !d ? <SkelRows rows={5} /> : (<>
        <div className={css.pair}>
          <div className={css.box} data-testid="wl-won">
            <h4 className={css.h4}>{L("Won on", "Berjaya atas")}</h4>
            <ul className={css.list}>{d.won.map((x) => <li key={x.basis} data-basis={x.basis}><span>{w(WON_WORD[x.basis], x.basis)}</span><b>{x.n} · {fmtRM(x.cents)}</b></li>)}</ul>
          </div>
          <div className={css.box} data-testid="wl-lost">
            <h4 className={css.h4}>{L("Lost because", "Gagal kerana")}</h4>
            <ul className={css.list}>{d.lost.map((x) => <li key={x.reason} data-reason={x.reason}><span>{w(LOST_WORD[x.reason as keyof typeof LOST_WORD], x.reason)}</span><b>{x.n} · {fmtRM(x.cents)}</b></li>)}</ul>
          </div>
        </div>
        {d.rows.length === 0 ? <p className={css.meta}>{L("No deal was won or lost in this period.", "Tiada urusan berjaya atau gagal dalam tempoh ini.")}</p> : (
          <div className={css.scroll}>
            <table className={css.table} data-testid="wl-rows">
              <thead><tr><th>{L("Deal", "Urusan")}</th><th>{L("Result", "Keputusan")}</th><th>{L("Why", "Sebab")}</th><th className={css.n}>{L("Value", "Nilai")}</th></tr></thead>
              <tbody>{d.rows.map((x) => (
                <tr key={x.id} data-testid="wl-row">
                  <th scope="row"><button type="button" className={css.link} onClick={() => nav.toDeal(x.id)}>{x.title}</button><span className={css.sub}>{x.customer}{x.owner ? ` · ${x.owner}` : ""}</span></th>
                  <td>{x.stage === "won" ? L("Won", "Berjaya") : L("Lost", "Gagal")}</td>
                  <td>{x.stage === "won" ? w(WON_WORD[x.won_basis ?? "acceptance"], "") : w(LOST_WORD[x.lost_reason as keyof typeof LOST_WORD], x.lost_reason ?? "")}
                    {(x.stage === "won" ? x.override_reason : x.lost_note) && <span className={css.sub}>{x.stage === "won" ? x.override_reason : x.lost_note}</span>}</td>
                  <td className={css.n}>{x.value_cents != null ? fmtRM(x.value_cents) : "—"}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </>)}
    </Shell>
  );
}

/* ---------------- Lead Sources ---------------- */
function SourcesReport({ nav, exec }: { nav: ReportNav; exec: boolean }) {
  const [period, setPeriod] = useState<Period>("month");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const r = useCachedApi<Base & { rows: { source: string; leads: number; with_deal: number; won: number }[]; total: { leads: number; with_deal: number; won: number } }>(
    `/staff/sales/reports/sources?period=${period}&scope=${scope}`, true, TOPICS);
  const d = r.data;
  const word = (s: string) => (s === "unknown" ? L("Not recorded", "Tidak direkod") : w(LEAD_SOURCE_WORD[s], s));
  const csv = d ? () => downloadCsv(`lead-sources-${d.from}-${d.to}`, [...csvHead("Lead Sources", d), ["Source", "Leads", "Became deals", "Won"],
    ...d.rows.map((x) => [x.source === "unknown" ? "Not recorded" : LEAD_SOURCE_WORD[x.source]?.[0] ?? x.source, x.leads, x.with_deal, x.won])]) : null;
  return (
    <Shell testid="report-sources" title={L("Lead Sources", "Sumber Prospek")} sub={`${periodLine(d)} · ${L("Leads that came in during the period, by where they came from.", "Prospek yang masuk dalam tempoh, mengikut dari mana ia datang.")}`}
      controls={<Controls period={period} onPeriod={setPeriod} scope={scope} onScope={setScope} canAll={exec} onCsv={csv} testid="src" />}>
      {r.failed && !d ? <Failed /> : !d ? <SkelRows rows={5} /> : d.rows.length === 0 ? <p className={css.meta}>{L("No lead came in during this period.", "Tiada prospek masuk dalam tempoh ini.")}</p> : (
        <div className={css.scroll}>
          <table className={css.table} data-testid="src-table">
            <thead><tr><th>{L("Source", "Sumber")}</th><th className={css.n}>{L("Leads", "Prospek")}</th><th className={css.n}>{L("Became deals", "Menjadi urusan")}</th><th className={css.n}>{L("Won", "Berjaya")}</th></tr></thead>
            <tbody>{d.rows.map((x) => (
              <tr key={x.source} data-testid="src-row" data-source={x.source}>
                <th scope="row">{word(x.source)}</th>
                <td className={css.n}><Count n={x.leads} onOpen={nav.toLeads} label={L("Open Leads & CRM", "Buka Prospek & CRM")} /></td>
                <td className={css.n}><Count n={x.with_deal} onOpen={nav.toPipeline} label={L("Open the Sales Pipeline", "Buka Saluran Jualan")} /></td>
                <td className={css.n}>{x.won}</td>
              </tr>))}</tbody>
            <tfoot><tr><th scope="row">{L("Total", "Jumlah")}</th><td className={css.n}>{d.total.leads}</td><td className={css.n}>{d.total.with_deal}</td><td className={css.n}>{d.total.won}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Failed() {
  return <p className={css.warn} role="alert" data-testid="report-failed"><AppIcon name="warning" />{L("This report could not be loaded. If the database update has not run yet, run PUSH.bat.", "Laporan ini tidak dapat dimuatkan. Jika kemas kini pangkalan data belum dijalankan, jalankan PUSH.bat.")}</p>;
}

/** the four, as entries for the Reports picker; Team Performance only for management (the server checks again) */
export function crmReportDefs(nav: ReportNav, exec: boolean): ReportDef[] {
  return [
    ...(exec ? [{ key: "team_performance", label: L("Team Performance", "Prestasi Pasukan"), hint: L("Activity and results, side by side, per salesperson.", "Aktiviti dan hasil, bersebelahan, bagi setiap jurujual."), node: <TeamReport nav={nav} /> }] : []),
    { key: "pipeline", label: L("Pipeline", "Saluran"), hint: L("Deals by stage, how they moved, and how long they stayed.", "Urusan mengikut peringkat, bagaimana ia beralih, dan berapa lama ia kekal."), node: <PipelineReport nav={nav} exec={exec} /> },
    { key: "winloss", label: L("Win / Loss", "Berjaya / Gagal"), hint: L("How deals were won, and why they were lost.", "Bagaimana urusan berjaya, dan mengapa gagal."), node: <WinLossReport nav={nav} exec={exec} /> },
    { key: "sources", label: L("Lead Sources", "Sumber Prospek"), hint: L("Where leads came from, and how many became deals and were won.", "Dari mana prospek datang, dan berapa menjadi urusan dan berjaya."), node: <SourcesReport nav={nav} exec={exec} /> },
  ];
}
