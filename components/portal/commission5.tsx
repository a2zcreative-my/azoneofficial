"use client";

/* v1.311.0 - COMMISSION WORKSPACE 5.0 (the CEO, 15-11-2026: "approve as per
   recommend", K-0 ... K-13 in claude/COMMISSION-WORKSPACE-5.0-BLUEPRINT.md;
   the six reference images).

   The views that are new in 5.0. They draw what ONE engine returns
   (worker/src/commission.ts, GET /staff/commission/overview, /transactions,
   /agents, /payroll-preview) - nothing is calculated, invented or paid here,
   and no mock-up figure from the references is ever used:
     Overview       (ref 1) Confirmed Sales · Commission Payable · Pending ·
                    To Payroll; Commission by Role; Sales & Commission
                    Performance against the Sales target (read, never kept
                    twice - K-11); Recent Commission (paid invoices); Needs
                    Attention
     Transactions   (ref 2) one line per paid invoice (and the pending ones),
                    filtered, paged, exported; a salesperson reads their own
     Agent Deals    (ref 3) the agents, their salesperson, deals, sales and
                    commission; Add Agent and New Deal open Agents and Sales
                    (K-10) - Commission never creates either
     Policy         (ref 4) the structure IN FORCE and the rules that hold it
     Payroll Sync   (ref 5) the period, the employees' review, and Sync -
                    Payroll's own recompute (K-6); agents are never here (F-3)
   Decisions stay where they were (the entry drawer, Agent deals, payouts). */

import { useEffect, useState } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Donut } from "@/components/ui/donut";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows, SkelStat } from "@/components/ui/skeleton";
import { makeApi, type ApiResult } from "@/lib/api";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { properName } from "@/lib/names";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import c5 from "./commission5.module.css";

const api = makeApi("/staff/commission");
const staffApi = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const message = (r: ApiResult<unknown>) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Retry when online.", "Sambungan gagal. Cuba semula apabila dalam talian.");
const pct = (bp: number | null | undefined) => (bp == null ? "—" : `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthWord = (m: string) => { const i = Number(m.slice(5, 7)) - 1; const full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; const ms = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"]; return `${L(full[i] ?? "", ms[i] ?? "")} ${m.slice(0, 4)}`; };
const compact = (c: number) => { const v = c / 100; return v >= 100000 ? `RM ${(v / 1000).toFixed(0)}k` : v >= 10000 ? `RM ${(v / 1000).toFixed(1)}k` : `RM ${v.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`; };

export type CommissionView = "overview" | "transactions" | "agents" | "policy" | "payroll" | "audit";
export const COMMISSION_VIEWS: readonly CommissionView[] = ["overview", "transactions", "agents", "policy", "payroll", "audit"];
export const isCommissionView = (v: string | null): v is CommissionView => !!v && (COMMISSION_VIEWS as readonly string[]).includes(v);
export type Company = "" | "a2z" | "azoo";

/** one plain GET, keyed so a stale answer is never shown */
function useGet<T>(path: string | null) {
  const [got, setGot] = useState<{ p: string; d: T | null; e: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    const c = new AbortController();
    void api<T>(path, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ p: path, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [path]);
  const cur = got && got.p === path ? got : null;
  return { d: cur?.d ?? null, e: cur?.e ?? "", done: cur !== null };
}

/* the standing of one paid invoice, in words and a chip */
export const STAND: Record<string, [string, string, string]> = {
  confirmed: ["Confirmed", "Disahkan", chipSmSuccess],
  in_payroll: ["In payroll", "Dalam gaji", chipSmInfo],
  paid: ["Paid", "Dibayar", chipSmSuccess],
  held: ["Held for review", "Ditahan untuk semakan", chipSmWarn],
  pending: ["Pending", "Menunggu", chipSmWarn],
  void: ["No commission", "Tiada komisen", chipSmNeutral],
};
const standChip = (s: string) => { const t = STAND[s] ?? STAND.void!; return <span className={t[2]}>{L(t[0], t[1])}</span>; };
export const DEAL: Record<string, [string, string]> = { direct: ["Direct Sales", "Jualan Langsung"], partnership: ["With Agent", "Dengan Ejen"], review: ["Held", "Ditahan"] };

function Head({ title, sub, icon, children }: { title: string; sub?: string; icon: AppIconName; children?: React.ReactNode }) {
  return (
    <div className={c5.head}>
      <span className={c5.well}><AppIcon name={icon} /></span>
      <div className={c5.headText}><p className={c5.title}>{title}</p>{sub && <p className={c5.sub}>{sub}</p>}</div>
      {children && <div className={c5.headAct}>{children}</div>}
    </div>
  );
}

/* ================= Overview (ref 1) ================= */
type Ov = {
  month: string; scope: "mine" | "all"; start: string;
  policy: { version: number; rate_kind: string; rate_bp: number | null; agent_rate_bp?: number | null; agent_closer_rate_bp?: number | null } | null;
  confirmed: { cents: number; n: number }; payable: { cents: number; n: number }; pending: { cents: number; n: number }; to_payroll: { cents: number; n: number };
  by_role: { agent: number; salesperson: number; direct: number } | null;
  performance: { target_cents: number | null; actual_cents: number; pct: number | null; estimated_cents: number };
  recent: { invoice_id: number; doc_number: string; company: string | null; closer_name: string | null; deal: string; sales_cents: number; commission_cents: number; status: string; entry_id: number }[];
  attention: { to_verify: number; to_confirm: number; held: number; review: number; ready_payroll: { n: number; cents: number }; payouts_to_authorise: { n: number; cents: number }; payouts_to_settle: number; sync: boolean } | null;
};

export function Overview5({ month, company, mine, rev, open, onEntry, goSales }: {
  month: string; company: Company; mine: boolean; rev: number;
  open: (v: CommissionView) => void; onEntry: (id: number) => void; goSales: () => void;
}) {
  const { d, e } = useGet<Ov>(`/overview?month=${month}${company ? `&company=${company}` : ""}${mine ? "&scope=mine" : ""}&r=${rev}`);
  const busy = !d;
  const roles = d?.by_role;
  const roleTotal = roles ? roles.agent + roles.salesperson + roles.direct : 0;
  const pol = d?.policy;
  const ROLE_ROWS: [string, string, number, string][] = roles ? [
    [L(`Agent (${pct(pol?.agent_rate_bp)})`, `Ejen (${pct(pol?.agent_rate_bp)})`), "agent", roles.agent, "var(--info)"],
    [L(`Salesperson (${pct(pol?.agent_closer_rate_bp)})`, `Jurujual (${pct(pol?.agent_closer_rate_bp)})`), "salesperson", roles.salesperson, "var(--gold-solid)"],
    [L(`Direct Sales (${pct(pol?.rate_bp)})`, `Jualan Langsung (${pct(pol?.rate_bp)})`), "direct", roles.direct, "var(--primary)"],
  ] : [];
  const att = d?.attention;
  const notes: { key: string; icon: AppIconName; tone: string; text: string; act: string; on: () => void }[] = att ? [
    ...(att.to_verify ? [{ key: "verify", icon: "verify" as AppIconName, tone: c5.toneWarn ?? "", text: L(`${att.to_verify} invoice(s) with payments waiting for the CEO's verification`, `${att.to_verify} invois dengan bayaran menunggu pengesahan CEO`), act: L("View", "Lihat"), on: goSales }] : []),
    ...(att.to_confirm ? [{ key: "confirm", icon: "paid" as AppIconName, tone: c5.toneWarn ?? "", text: L(`${att.to_confirm} invoice(s) marked paid - awaiting the CEO's verification`, `${att.to_confirm} invois ditanda dibayar - menunggu pengesahan CEO`), act: L("View", "Lihat"), on: goSales }] : []),
    ...(att.held ? [{ key: "held", icon: "warning" as AppIconName, tone: c5.toneBad ?? "", text: L(`${att.held} agent deal(s) held for your review`, `${att.held} urusan ejen ditahan untuk semakan anda`), act: L("Review", "Semak"), on: () => open("agents") }] : []),
    ...(att.review ? [{ key: "review", icon: "pending" as AppIconName, tone: c5.toneWarn ?? "", text: L(`${att.review} commission entr(ies) under review`, `${att.review} entri komisen dalam semakan`), act: L("Open", "Buka"), on: () => open("transactions") }] : []),
    ...(att.ready_payroll.n ? [{ key: "payroll", icon: "money" as AppIconName, tone: c5.toneInfo ?? "", text: att.sync ? L(`${att.ready_payroll.n} commission(s) ready for payroll sync · ${fmtRM(att.ready_payroll.cents)}`, `${att.ready_payroll.n} komisen sedia untuk penyegerakan gaji · ${fmtRM(att.ready_payroll.cents)}`) : L(`${fmtRM(att.ready_payroll.cents)} waits - the payroll link is off`, `${fmtRM(att.ready_payroll.cents)} menunggu - pautan gaji dimatikan`), act: L("Sync", "Segerak"), on: () => open("payroll") }] : []),
    ...(att.payouts_to_authorise.n ? [{ key: "authorise", icon: "pay" as AppIconName, tone: c5.toneInfo ?? "", text: L(`${att.payouts_to_authorise.n} agent(s) to pay · ${fmtRM(att.payouts_to_authorise.cents)} (Finance, never payroll)`, `${att.payouts_to_authorise.n} ejen untuk dibayar · ${fmtRM(att.payouts_to_authorise.cents)} (Kewangan, bukan gaji)`), act: L("Open", "Buka"), on: () => open("payroll") }] : []),
    ...(att.payouts_to_settle ? [{ key: "settle", icon: "paid" as AppIconName, tone: c5.toneInfo ?? "", text: L(`${att.payouts_to_settle} agent payout(s) waiting for the bank settlement`, `${att.payouts_to_settle} bayaran ejen menunggu penyelesaian bank`), act: L("Open", "Buka"), on: () => open("payroll") }] : []),
  ] : [];
  const perf = d?.performance;
  return (
    <div className={c5.stack} data-testid="commission-overview">
      {e && <p role="alert" className={c5.error}>{e}</p>}
      <KpiRow label={L(`Commission, ${monthWord(month)}`, `Komisen, ${monthWord(month)}`)}>
        <KpiTile icon="receipt" tone="gold" busy={busy} label={L("Confirmed Sales", "Jualan Disahkan")} value={fmtRM(d?.confirmed.cents ?? 0)} sub={d ? L(`${d.confirmed.n} invoice(s) · verified paid`, `${d.confirmed.n} invois · disahkan dibayar`) : undefined} onClick={() => open("transactions")} />
        <KpiTile icon="success" tone="green" busy={busy} label={L("Commission Payable", "Komisen Perlu Dibayar")} value={fmtRM(d?.payable.cents ?? 0)} sub={L("Eligible (paid invoices only)", "Layak (invois dibayar sahaja)")} onClick={() => open("transactions")} />
        <KpiTile icon="pending" tone="gold" busy={busy} label={L("Pending", "Menunggu")} value={fmtRM(d?.pending.cents ?? 0)} sub={d ? L(`${d.pending.n} invoice(s) (awaiting Paid)`, `${d.pending.n} invois (menunggu Dibayar)`) : undefined} onClick={() => open("transactions")} />
        <KpiTile icon="money" tone="blue" busy={busy} label={L("To Payroll", "Ke Gaji")} value={fmtRM(d?.to_payroll.cents ?? 0)} sub={mine ? L("Your commission for payroll", "Komisen anda untuk gaji") : L("Employees only · ready for payroll sync", "Pekerja sahaja · sedia untuk penyegerakan gaji")} onClick={mine ? undefined : () => open("payroll")} />
      </KpiRow>

      <div className={c5.split}>
        {!mine && (
          <section className={card} aria-label={L("Commission by role", "Komisen mengikut peranan")} data-testid="commission-by-role">
            <Head icon="chart" title={L("Commission by Role", "Komisen mengikut Peranan")} sub={monthWord(month)} />
            {busy ? <SkelRows rows={3} /> : (
              <div className={c5.donutRow}>
                <Donut size={148} hideLegend centerLabel={compact(roleTotal)} centerSub={L("Total", "Jumlah")}
                  slices={ROLE_ROWS.map(([label, , v, color]) => ({ label, value: v, color }))} />
                <ul className={c5.legend}>
                  {ROLE_ROWS.map(([label, key, v, color]) => (
                    <li key={key} data-role={key}>
                      <span className={c5.dot} style={{ background: color }} aria-hidden />
                      <span className={c5.legendLabel}>{label}</span>
                      <strong className={c5.num}>{fmtRM(v)}</strong>
                      <span className={`${c5.num} ${c5.muted}`}>{roleTotal ? `${((v * 100) / roleTotal).toFixed(1)}%` : "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pol && pol.agent_rate_bp == null && <p className={c5.note}>{L(`v${pol.version} has no agent rates - agent sales are held for your review until a version with them is approved.`, `v${pol.version} tiada kadar ejen - jualan ejen ditahan untuk semakan anda sehingga versi dengan kadar itu diluluskan.`)}</p>}
          </section>
        )}
        <section className={card} aria-label={L("Sales and commission performance", "Prestasi jualan dan komisen")} data-testid="commission-performance">
          <Head icon="target" title={L("Sales & Commission Performance", "Prestasi Jualan & Komisen")} sub={mine ? L("Your month", "Bulan anda") : L("The company's month", "Bulan syarikat")} />
          {busy ? <SkelRows rows={4} /> : (
            <dl className={c5.perf}>
              <div><dt>{L("Sales Target (Monthly)", "Sasaran Jualan (Bulanan)")}</dt><dd>{perf?.target_cents == null ? <span className={c5.muted}>{L("Not set in Sales", "Belum ditetapkan dalam Jualan")}</span> : fmtRM(perf.target_cents)}</dd></div>
              <div><dt>{L("Actual Sales (verified paid)", "Jualan Sebenar (disahkan dibayar)")}</dt><dd>{fmtRM(perf?.actual_cents ?? 0)}</dd></div>
              <div className={c5.perfBar}><dt>{L("Achievement", "Pencapaian")}</dt>
                <dd><span className={c5.bar} aria-hidden><span style={{ width: `${Math.min(100, perf?.pct ?? 0)}%` }} /></span><strong>{perf?.pct == null ? "—" : `${perf.pct}%`}</strong></dd></div>
              <div><dt>{L("Estimated Commission", "Anggaran Komisen")}</dt><dd><strong>{fmtRM(perf?.estimated_cents ?? 0)}</strong></dd></div>
            </dl>
          )}
        </section>
      </div>

      <div className={mine ? "" : c5.split2}>
        <section className={card} aria-label={L("Recent commission", "Komisen terkini")}>
          <Head icon="receipt" title={L("Recent Commission", "Komisen Terkini")} sub={L("Paid invoices", "Invois dibayar")}>
            <button type="button" className={btnSm} onClick={() => open("transactions")}>{L("View all", "Lihat semua")}</button>
          </Head>
          {busy ? <SkelRows rows={3} /> : (d?.recent.length ?? 0) === 0 ? <p className={c5.empty}>{L("No verified paid invoice this month yet.", "Belum ada invois disahkan dibayar bulan ini.")}</p> : (<>
            <ul className={`${c5.cards} ${c5.phoneOnly}`} data-testid="commission-recent-cards">{d!.recent.map((r) => (
              <li key={r.invoice_id}><button type="button" className={c5.cardBtn} onClick={() => onEntry(r.entry_id)}>
                <span className={c5.cardTop}><strong>{r.doc_number}</strong><strong className={c5.num}>{fmtRM(r.commission_cents)}</strong></span>
                <span className={c5.muted}>{r.company ?? "—"} · {properName(r.closer_name ?? "") || "—"}</span>
                <span className={c5.cardTop}><span>{L(DEAL[r.deal]?.[0] ?? "", DEAL[r.deal]?.[1] ?? "")} · {fmtRM(r.sales_cents)}</span>{standChip(r.status)}</span>
              </button></li>
            ))}</ul>
            <div className={`${c5.tWrap} ${c5.deskOnly}`}>
              <table className={c5.t}>
                <thead><tr><th>{L("Invoice No.", "No. Invois")}</th><th>{L("Client", "Pelanggan")}</th><th>{L("Closer", "Penutup")}</th><th>{L("Type", "Jenis")}</th><th className={c5.r}>{L("Sales (RM)", "Jualan (RM)")}</th><th className={c5.r}>{L("Commission (RM)", "Komisen (RM)")}</th><th>{L("Status", "Status")}</th></tr></thead>
                <tbody>{d!.recent.map((r) => (
                  <tr key={r.invoice_id}>
                    <td><button type="button" className={c5.link} onClick={() => onEntry(r.entry_id)}>{r.doc_number}</button></td>
                    <td>{r.company ?? "—"}</td><td>{properName(r.closer_name ?? "") || "—"}</td>
                    <td>{L(DEAL[r.deal]?.[0] ?? "", DEAL[r.deal]?.[1] ?? "")}</td>
                    <td className={c5.r}>{(r.sales_cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                    <td className={c5.r}>{(r.commission_cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                    <td>{standChip(r.status)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>)}
        </section>
        {!mine && (
          <section className={card} aria-label={L("Needs attention", "Perlu perhatian")} data-testid="commission-attention">
            <Head icon="warning" title={L("Needs Attention", "Perlu Perhatian")} />
            {busy ? <SkelRows rows={3} /> : notes.length === 0 ? <p className={c5.empty}>{L("Nothing needs you right now.", "Tiada yang memerlukan anda sekarang.")}</p> : (
              <ul className={c5.notes}>{notes.map((n) => (
                <li key={n.key} className={`${c5.noteRow} ${n.tone}`} data-attention={n.key}><AppIcon name={n.icon} /><span>{n.text}</span><button type="button" className={btnSm} onClick={n.on}>{n.act}</button></li>
              ))}</ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/* ================= Transactions (ref 2) ================= */
export type TxRow = {
  key: string; invoice_id: number; doc_number: string; invoice_date: string | null; paid_day: string | null; company: string | null; issuer_code: string | null;
  closer_name: string | null; agent_name?: string | null; deal: string; sales_cents: number; basis_cents: number | null;
  rates: { mine_bp?: number | null; closer_bp?: number | null; agent_bp?: number | null }; commission_cents: number; agent_cents?: number | null; closer_cents?: number | null;
  reversed: boolean; status: string; stage?: string; entry_id: number | null; estimate?: boolean;
};
type TxResp = { month: string; scope: string; page: number; pages: number; total: number; totals: { sales_cents: number; commission_cents: number }; rows: TxRow[]; staff: { id: number; name: string }[] };
const splitText = (r: TxRow, mine: boolean) => mine ? pct(r.rates.mine_bp) : r.deal === "partnership" ? `${pct(r.rates.agent_bp)} / ${pct(r.rates.closer_bp)}` : r.deal === "review" ? "—" : pct(r.rates.closer_bp);

export function Transactions5({ month, company, mine, rev, onEntry, onEstimate }: {
  month: string; company: Company; mine: boolean; rev: number; onEntry: (id: number) => void; onEstimate: (r: TxRow) => void;
}) {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [staff, setStaff] = useState(0);
  const [qIn, setQIn] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQ(qIn.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [qIn]);
  const qs = `month=${month}${company ? `&company=${company}` : ""}${mine ? "&scope=mine" : ""}${status ? `&status=${status}` : ""}${type ? `&type=${type}` : ""}${staff ? `&staff=${staff}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const { d, e } = useGet<TxResp>(`/transactions?${qs}&page=${page}&r=${rev}`);
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    const r = await api<TxResp>(`/transactions?${qs}&all=1`);
    setExporting(false);
    if (!r.ok || !r.data) return;
    const rows: (string | number)[][] = [
      [`# ${L("Commission transactions", "Transaksi komisen")} — ${monthWord(month)} — ${L("Generated", "Dijana")} ${csvStampMyt()}`],
      [L("Invoice No.", "No. Invois"), L("Invoice date", "Tarikh invois"), L("Paid day", "Hari dibayar"), L("Client", "Pelanggan"), L("Closer", "Penutup"), ...(mine ? [] : [L("Agent", "Ejen")]), L("Type", "Jenis"), L("Sales (RM)", "Jualan (RM)"), mine ? L("Your rate", "Kadar anda") : L("Split", "Pecahan"), L("Commission (RM)", "Komisen (RM)"), L("Status", "Status")],
      ...r.data.rows.map((x) => [x.doc_number, x.invoice_date ?? "", x.paid_day ?? "", x.company ?? "", properName(x.closer_name ?? ""), ...(mine ? [] : [properName(x.agent_name ?? "")]), L(DEAL[x.deal]?.[0] ?? "", DEAL[x.deal]?.[1] ?? ""),
        (x.sales_cents / 100).toFixed(2), splitText(x, mine), (x.commission_cents / 100).toFixed(2), L(STAND[x.status]?.[0] ?? x.status, STAND[x.status]?.[1] ?? x.status)]),
      [L("TOTAL", "JUMLAH"), "", "", "", "", ...(mine ? [] : [""]), "", (r.data.totals.sales_cents / 100).toFixed(2), "", (r.data.totals.commission_cents / 100).toFixed(2), ""],
    ];
    downloadCsv(`commission-${month}`, rows);
  };
  const openRow = (r: TxRow) => { if (r.entry_id) onEntry(r.entry_id); else onEstimate(r); };
  const reset = (f: () => void) => { f(); setPage(1); };
  return (
    <section className={card} aria-label={L("Commission transactions", "Transaksi komisen")} data-testid="commission-transactions">
      <div className={c5.filters}>
        <input className={`${inputClassSm} ${c5.search}`} value={qIn} onChange={(e2) => setQIn(e2.target.value)} placeholder={mine ? L("Search invoice or client", "Cari invois atau pelanggan") : L("Search invoice, client or staff...", "Cari invois, pelanggan atau kakitangan...")} aria-label={L("Search", "Cari")} />
        <select className={selectClassSm} value={status} onChange={(e2) => reset(() => setStatus(e2.target.value))} aria-label={L("Status", "Status")}>
          <option value="">{L("All status", "Semua status")}</option>
          {Object.entries(STAND).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}
        </select>
        <select className={selectClassSm} value={type} onChange={(e2) => reset(() => setType(e2.target.value))} aria-label={L("Type", "Jenis")}>
          <option value="">{L("All type", "Semua jenis")}</option>
          {Object.entries(DEAL).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}
        </select>
        {!mine && (
          <select className={selectClassSm} value={staff} onChange={(e2) => reset(() => setStaff(Number(e2.target.value)))} aria-label={L("Staff", "Kakitangan")}>
            <option value={0}>{L("All staff", "Semua kakitangan")}</option>
            {(d?.staff ?? []).map((s) => <option key={s.id} value={s.id}>{properName(s.name)}</option>)}
          </select>
        )}
        <button type="button" className={btnSmPrimary} disabled={!d || d.total === 0 || exporting} onClick={() => void exportCsv()}><AppIcon name="download" />{exporting ? L("Exporting…", "Mengeksport…") : L("Export", "Eksport")}</button>
      </div>
      {e && <p role="alert" className={c5.error}>{e}</p>}
      {!d ? <SkelRows rows={5} /> : d.rows.length === 0 ? <p className={c5.empty}>{L("No commission for these filters.", "Tiada komisen untuk penapis ini.")}</p> : (
        <>
          <div className={`${c5.tWrap} ${c5.deskOnly}`}>
            <table className={c5.t}>
              <thead><tr>
                <th>{L("Invoice No.", "No. Invois")}</th><th>{L("Invoice Date", "Tarikh Invois")}</th><th>{L("Client", "Pelanggan")}</th><th>{L("Closer", "Penutup")}</th>
                {!mine && <th>{L("Agent", "Ejen")}</th>}<th className={c5.r}>{L("Sales (RM)", "Jualan (RM)")}</th><th>{mine ? L("Your rate", "Kadar anda") : L("Split", "Pecahan")}</th>
                <th className={c5.r}>{L("Commission (RM)", "Komisen (RM)")}</th><th>{L("Status", "Status")}</th>
              </tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.key} data-row={r.key}>
                  <td><button type="button" className={c5.link} onClick={() => openRow(r)}>{r.doc_number}</button></td>
                  <td className={c5.muted}>{r.invoice_date ? dmy(r.invoice_date) : "—"}</td>
                  <td>{r.company ?? "—"}</td><td>{properName(r.closer_name ?? "") || "—"}</td>
                  {!mine && <td>{r.agent_name ? properName(r.agent_name) : "—"}</td>}
                  <td className={c5.r}>{(r.sales_cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                  <td>{splitText(r, mine)}</td>
                  <td className={c5.r}><strong>{(r.commission_cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</strong>{r.estimate && <span className={c5.muted}> {L("est.", "angg.")}</span>}</td>
                  <td>{standChip(r.status)}{r.reversed && <span className={chipSmDanger}>{L("Reversal", "Pembalikan")}</span>}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={mine ? 4 : 5}>{L(`${d.total} invoice(s)`, `${d.total} invois`)}</td><td className={c5.r}>{fmtRM(d.totals.sales_cents)}</td><td /><td className={c5.r}>{fmtRM(d.totals.commission_cents)}</td><td /></tr></tfoot>
            </table>
          </div>
          <ul className={`${c5.cards} ${c5.phoneOnly}`}>{d.rows.map((r) => (
            <li key={r.key}><button type="button" className={c5.cardBtn} onClick={() => openRow(r)}>
              <span className={c5.cardTop}><strong>{r.doc_number}</strong><strong className={c5.num}>{fmtRM(r.commission_cents)}</strong></span>
              <span className={c5.muted}>{r.company ?? "—"} · {properName(r.closer_name ?? "") || "—"}{!mine && r.agent_name ? ` · ${properName(r.agent_name)}` : ""}</span>
              <span className={c5.cardTop}><span>{L(DEAL[r.deal]?.[0] ?? "", DEAL[r.deal]?.[1] ?? "")} · {splitText(r, mine)} · {fmtRM(r.sales_cents)}</span>{standChip(r.status)}</span>
            </button></li>
          ))}</ul>
          {d.pages > 1 && (
            <nav className={c5.pager} aria-label={L("Pages", "Halaman")}>
              <button type="button" className={btnSm} disabled={d.page <= 1} onClick={() => setPage(d.page - 1)} aria-label={L("Previous page", "Halaman sebelum")}>‹</button>
              {Array.from({ length: d.pages }, (_, i) => i + 1).filter((p) => Math.abs(p - d.page) <= 2 || p === 1 || p === d.pages).map((p) => (
                <button key={p} type="button" className={p === d.page ? btnSmPrimary : btnSm} aria-current={p === d.page ? "page" : undefined} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button type="button" className={btnSm} disabled={d.page >= d.pages} onClick={() => setPage(d.page + 1)} aria-label={L("Next page", "Halaman seterusnya")}>›</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

/* ================= Agent Deals head (ref 3) ================= */
type AgResp = { month: string; rate: { version: number; agent_bp: number; closer_bp: number } | null; tiles: { agents: number; active: number; deals: number; agent_cents: number };
  agents: { id: number; name: string; active: boolean; salesperson: string | null; deals: number; held: number; sales_cents: number; agent_cents: number }[]; pending_migration?: boolean };

export function AgentsHead5({ month, company, rev, onAddAgent }: { month: string; company: Company; rev: number; onAddAgent: () => void }) {
  const { d, e } = useGet<AgResp>(`/agents?month=${month}${company ? `&company=${company}` : ""}&r=${rev}`);
  return (
    <div className={c5.stack} data-testid="agent-deals-head">
      {e && <p role="alert" className={c5.error}>{e}</p>}
      <div className={c5.actionsRow}>
        <p className={d?.rate ? c5.ruleOk : c5.ruleHold} data-testid="agent-rate-in-force">
          <AppIcon name={d?.rate ? "success" : "info"} />
          {!d ? L("Reading the policy in force…", "Membaca polisi berkuat kuasa…")
            : d.rate ? L(`Policy v${d.rate.version}: agent ${pct(d.rate.agent_bp)} + salesperson ${pct(d.rate.closer_bp)} on agent deals.`, `Polisi v${d.rate.version}: ejen ${pct(d.rate.agent_bp)} + jurujual ${pct(d.rate.closer_bp)} bagi urusan ejen.`)
              : L("The policy in force has no agent rates - every agent sale is held for your review until a version with them is approved (Policy Settings).", "Polisi berkuat kuasa tiada kadar ejen - setiap jualan ejen ditahan untuk semakan anda sehingga versi dengannya diluluskan (Tetapan Polisi).")}
        </p>
        <span className={c5.btnPair}>
          <button type="button" className={btnSm} onClick={onAddAgent}><AppIcon name="add" />{L("Add Agent", "Tambah Ejen")}</button>
        </span>
      </div>
      {!d ? <KpiRow label={L("Agents", "Ejen")}><SkelStat /><SkelStat /><SkelStat /><SkelStat /></KpiRow> : (
        <KpiRow label={L("Agents", "Ejen")}>
          <KpiTile icon="users" tone="gold" label={L("Total Agents", "Jumlah Ejen")} value={String(d.tiles.agents)} sub={L("Agent accounts", "Akaun ejen")} />
          <KpiTile icon="person" tone="green" label={L("Active Agents", "Ejen Aktif")} value={String(d.tiles.active)} sub={L("Able to refer clients", "Boleh merujuk pelanggan")} />
          <KpiTile icon="assignment" tone="blue" label={L("Deals (This Month)", "Urusan (Bulan Ini)")} value={String(d.tiles.deals)} sub={monthWord(month)} />
          <KpiTile icon="money" tone="red" label={L("Agent Commission", "Komisen Ejen")} value={fmtRM(d.tiles.agent_cents)} sub={L("Earned this month", "Diperoleh bulan ini")} />
        </KpiRow>
      )}
      <section className={card} aria-label={L("Agents", "Ejen")}>
        {!d ? <SkelRows rows={4} /> : d.agents.length === 0 ? <p className={c5.empty}>{L("No agent account yet - add one in Agents.", "Belum ada akaun ejen - tambah dalam Ejen.")}</p> : (
          <div className={c5.tWrap}>
            <table className={c5.t} data-testid="agents-table">
              <thead><tr><th>{L("Agent", "Ejen")}</th><th>{L("Salesperson (Owner)", "Jurujual (Pemilik)")}</th><th className={c5.r}>{L("Deals", "Urusan")}</th><th className={c5.r}>{L("Sales (RM)", "Jualan (RM)")}</th>
                <th className={c5.r}>{d.rate ? L(`Agent Comm. (${pct(d.rate.agent_bp)})`, `Komisen Ejen (${pct(d.rate.agent_bp)})`) : L("Agent Comm.", "Komisen Ejen")}</th><th>{L("Status", "Status")}</th></tr></thead>
              <tbody>{d.agents.map((a) => (
                <tr key={a.id}>
                  <td><strong>{properName(a.name)}</strong></td><td>{a.salesperson ? properName(a.salesperson) : <span className={c5.muted}>{L("Not assigned", "Belum ditetapkan")}</span>}</td>
                  <td className={c5.r}>{a.deals}{a.held ? <span className={c5.muted}> · {L(`${a.held} held`, `${a.held} ditahan`)}</span> : null}</td>
                  <td className={c5.r}>{(a.sales_cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                  <td className={c5.r}>{(a.agent_cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                  <td><span className={a.active ? chipSmSuccess : chipSmDanger}>{a.active ? L("Active", "Aktif") : L("Inactive", "Tidak aktif")}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= Policy Settings head (ref 4) ================= */
type PolIn = { version: number; name: string; effective_from: string; rate_kind: string; rate_bp: number | null; fixed_cents: number | null; agent_rate_bp?: number | null; agent_closer_rate_bp?: number | null } | null;

export function PolicyHead5({ inForce, canDraft, hold, onNewVersion }: { inForce: PolIn; canDraft: boolean; hold: boolean; onNewVersion: () => void }) {
  const agentOn = !!inForce && inForce.agent_rate_bp != null && inForce.agent_closer_rate_bp != null;
  const cards: [string, string, AppIconName, string, string][] = [
    [L("Direct Sales (No Agent)", "Jualan Langsung (Tanpa Ejen)"), L("Sales closed by a salesperson directly.", "Jualan ditutup terus oleh jurujual."), "person",
      inForce ? (inForce.rate_kind === "fixed" ? fmtRM(inForce.fixed_cents ?? 0) : pct(inForce.rate_bp)) : "—", ""],
    [L("With Agent – Agent", "Dengan Ejen – Ejen"), L("Commission to the agent (visible to the agent).", "Komisen kepada ejen (dilihat oleh ejen)."), "users", agentOn ? pct(inForce!.agent_rate_bp) : L("Not in force", "Tidak berkuat kuasa"), agentOn ? "" : "off"],
    [L("With Agent – Salesperson", "Dengan Ejen – Jurujual"), L("Commission to the salesperson (never shown to the agent).", "Komisen kepada jurujual (tidak sekali-kali ditunjuk kepada ejen)."), "person", agentOn ? pct(inForce!.agent_closer_rate_bp) : L("Not in force", "Tidak berkuat kuasa"), agentOn ? "" : "off"],
  ];
  const RULES: [string, string][] = [
    [L("Commission only for invoices paid in full", "Komisen hanya untuk invois dibayar penuh"), L("A part payment never earns", "Bayaran sebahagian tidak memberi komisen")],
    [L("CEO final verification for commission payment", "Pengesahan akhir CEO untuk bayaran komisen"), L("Only the CEO (the owner) confirms Paid", "Hanya CEO (pemilik) mengesahkan Dibayar")],
    [L("Partial payments tracked (outstanding amount)", "Bayaran sebahagian dijejak (baki tertunggak)"), L("Shown as Pending, never payable", "Ditunjuk sebagai Menunggu, tidak boleh dibayar")],
    [L("Auto attribution to the verified closer", "Atribusi automatik kepada penutup disahkan"), L("An uncertain agent link is held, never guessed", "Pautan ejen tidak pasti ditahan, tidak diteka")],
    [L("Sync to Payroll after the CEO's verification", "Segerak ke Gaji selepas pengesahan CEO"), L("Employees only, once; agents through Finance", "Pekerja sahaja, sekali; ejen melalui Kewangan")],
    [L("Hide the 3% salesperson commission from the agent view", "Sembunyi komisen jurujual 3% daripada paparan ejen"), L("Portal, API, notifications and exports", "Portal, API, pemberitahuan dan eksport")],
  ];
  return (
    <div className={c5.policy} data-testid="policy-structure">
      <section className={card} aria-label={L("Commission structure", "Struktur komisen")}>
        <Head icon="balance" title={L("Commission Structure", "Struktur Komisen")} sub={inForce ? L(`v${inForce.version} · ${inForce.name} · from ${dmy(inForce.effective_from)}`, `v${inForce.version} · ${inForce.name} · dari ${dmy(inForce.effective_from)}`) : L("No version approved yet", "Belum ada versi diluluskan")}>
          {canDraft && <button type="button" className={btnSmPrimary} onClick={onNewVersion}><AppIcon name="edit" />{L("New Version", "Versi Baharu")}</button>}
        </Head>
        <ul className={c5.structure}>{cards.map(([t, s, icon, rate, off]) => (
          <li key={t} data-off={off || undefined}><span className={c5.well}><AppIcon name={icon} /></span><span className={c5.headText}><strong>{t}</strong><span className={c5.sub}>{s}</span></span>
            <span className={c5.rate}><span className={c5.sub}>{L("Rate", "Kadar")}</span><strong>{rate}</strong></span></li>
        ))}</ul>
        <p className={c5.note}>{L("An approved version is never edited: a change is a new version, from today or later. Entitlements keep the version they were earned under.", "Versi diluluskan tidak pernah disunting: perubahan ialah versi baharu, dari hari ini atau kemudian. Hak kekal dengan versi semasa ia diperoleh.")}{hold ? ` ${L("New agent sales are on hold (Agent Deals).", "Jualan ejen baharu sedang ditahan (Urusan Ejen).")}` : ""}</p>
      </section>
      <section className={card} aria-label={L("Rules and control", "Peraturan dan kawalan")}>
        <Head icon="verify" title={L("Rules & Control", "Peraturan & Kawalan")} />
        <ul className={c5.rules}>{RULES.map(([t, s]) => <li key={t}><AppIcon name="success" /><span><strong>{t}</strong><span className={c5.sub}>{s}</span></span></li>)}</ul>
      </section>
    </div>
  );
}

/* ================= Payroll Sync (ref 5) ================= */
type PsResp = { month: string; released: boolean; future: boolean; sync: boolean; can_sync: boolean;
  employees: { user_id: number; name: string; role: string; ready: number; in_payroll: number; paid: number; on_payroll: boolean }[];
  totals: { ready: number; in_payroll: number; paid: number } };
const ROLE_WORD: Record<string, [string, string]> = { sales_marketing: ["Sales", "Jualan"], ceo: ["CEO", "CEO"], coo: ["COO", "COO"], cco: ["CCO", "CCO"], marketing: ["Marketing", "Pemasaran"], hr_admin: ["HR", "HR"], admin: ["Admin", "Admin"], editor: ["Editor", "Editor"], live_host: ["Live host", "Hos live"] };

export function PayrollSync5({ month, rev, onChanged, toast }: { month: string; rev: number; onChanged: () => void; toast: (t: string, s: string) => void }) {
  const [tick, setTick] = useState(0);
  const { d, e } = useGet<PsResp>(`/payroll-preview?month=${month}&r=${rev}-${tick}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const total = d ? d.totals.ready + d.totals.in_payroll + d.totals.paid : 0;
  const blocked = !d ? "" : !d.sync ? L("The payroll link is off - switch it on below to carry commission into payroll.", "Pautan gaji dimatikan - hidupkan di bawah untuk membawa komisen ke gaji.")
    : d.released ? L("This month's payslips are out - commission waits for the next open month.", "Slip gaji bulan ini telah dikeluarkan - komisen menunggu bulan terbuka seterusnya.")
      : d.future ? L("A future month takes nothing yet.", "Bulan akan datang belum mengambil apa-apa.")
        : !d.can_sync ? L("Payroll (the CEO or COO) runs the sync.", "Gaji (CEO atau COO) menjalankan penyegerakan.") : "";
  const step = !d ? 1 : d.totals.ready > 0 ? 2 : 3;
  const sync = async () => {
    setBusy(true); setErr("");
    /* K-6 - Payroll's OWN recompute for the month: no second calculation */
    const r = await staffApi<{ ok?: boolean }>(`/payroll/recompute`, { method: "POST", body: JSON.stringify({ month }) });
    setBusy(false);
    if (r.ok) { toast(L("Synced to Payroll", "Disegerak ke Gaji"), L(`${monthWord(month)} recomputed by Payroll - each commission joins once`, `${monthWord(month)} dikira semula oleh Gaji - setiap komisen masuk sekali`)); setTick((t) => t + 1); onChanged(); }
    else setErr(message(r));
  };
  return (
    <div className={c5.stack} data-testid="payroll-sync">
      <ol className={c5.steps} aria-label={L("Steps", "Langkah")}>
        <li data-state={step > 1 ? "done" : "now"}><span className={c5.stepNum}>{step > 1 ? <AppIcon name="success" /> : 1}</span><span><strong>{L("Select Period", "Pilih Tempoh")}</strong><span className={c5.sub}>{monthWord(month)}</span></span></li>
        <li data-state={step > 2 ? "done" : step === 2 ? "now" : "todo"}><span className={c5.stepNum}>{step > 2 ? <AppIcon name="success" /> : 2}</span><span><strong>{L("Review Commission", "Semak Komisen")}</strong><span className={c5.sub}>{fmtRM(total)}</span></span></li>
        <li data-state={step === 3 ? "now" : "todo"}><span className={c5.stepNum}>3</span><span><strong>{L("Sync to Payroll", "Segerak ke Gaji")}</strong><span className={c5.sub}>{d && d.totals.ready === 0 ? L("Nothing waiting", "Tiada yang menunggu") : L("Ready", "Sedia")}</span></span></li>
      </ol>
      <section className={card} aria-label={L("Commission ready for payroll", "Komisen sedia untuk gaji")}>
        <Head icon="money" title={L("Commission Ready for Payroll", "Komisen Sedia untuk Gaji")} sub={L("Employees only - agents are settled through Finance, below", "Pekerja sahaja - ejen diselesaikan melalui Kewangan, di bawah")} />
        {e && <p role="alert" className={c5.error}>{e}</p>}
        {!d ? <SkelRows rows={4} /> : d.employees.length === 0 ? <p className={c5.empty}>{L("No employee commission for this month.", "Tiada komisen pekerja untuk bulan ini.")}</p> : (
          <div className={c5.tWrap}>
            <table className={c5.t} data-testid="payroll-employees">
              <thead><tr><th>{L("Staff", "Kakitangan")}</th><th>{L("Role", "Peranan")}</th><th className={c5.r}>{L("Ready (RM)", "Sedia (RM)")}</th><th className={c5.r}>{L("In payroll (RM)", "Dalam gaji (RM)")}</th><th className={c5.r}>{L("Paid (RM)", "Dibayar (RM)")}</th><th className={c5.r}>{L("Commission (RM)", "Komisen (RM)")}</th></tr></thead>
              <tbody>{d.employees.map((p) => (
                <tr key={p.user_id}>
                  <td><strong>{properName(p.name)}</strong>{!p.on_payroll && p.ready > 0 && <span className={c5.muted}> · {L("no payroll row yet", "belum ada baris gaji")}</span>}</td>
                  <td>{L(ROLE_WORD[p.role]?.[0] ?? p.role, ROLE_WORD[p.role]?.[1] ?? p.role)}</td>
                  <td className={c5.r}>{(p.ready / 100).toFixed(2)}</td><td className={c5.r}>{(p.in_payroll / 100).toFixed(2)}</td><td className={c5.r}>{(p.paid / 100).toFixed(2)}</td>
                  <td className={c5.r}><strong>{((p.ready + p.in_payroll + p.paid) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</strong></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5}>{L("Total to Sync", "Jumlah untuk Disegerak")}</td><td className={c5.r}><strong>{fmtRM(total)}</strong></td></tr></tfoot>
            </table>
          </div>
        )}
        <div className={c5.syncRow}>
          {blocked ? <p className={c5.note}>{blocked}</p> : <p className={c5.sub}>{L("Sync runs Payroll's own recompute for the month: each commission joins its payslip once, never twice.", "Segerak menjalankan pengiraan semula Gaji sendiri untuk bulan itu: setiap komisen masuk slip gaji sekali, tidak dua kali.")}</p>}
          <button type="button" className={btnSmPrimary} disabled={!!blocked || busy || !d} onClick={() => void sync()} data-testid="sync-to-payroll"><AppIcon name="refresh" />{busy ? L("Syncing…", "Menyegerak…") : L("Sync to Payroll", "Segerak ke Gaji")}</button>
        </div>
        {err && <p role="alert" className={c5.error}>{err}</p>}
      </section>
    </div>
  );
}

/** the month choices: the commission start to this month (a picker never offers a month with nothing to show) */
export function monthsFrom(start: string): string[] {
  const out: string[] = [];
  const now = mytToday().slice(0, 7);
  let [y, m] = start.slice(0, 7).split("-").map(Number) as [number, number];
  for (let i = 0; i < 60; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.unshift(k);
    if (k >= now) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
export const shortMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;
