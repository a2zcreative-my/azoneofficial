"use client";

/* v1.399.0 - THE SALES PIPELINE (Sales Command Center Phase 3; the CEO, 21-11-2026: decisions 1,
   4 and 6, and "As recommended" on the seven Phase 3 decisions). worker/src/deals.ts is the server.

   A deal is the work of winning one piece of business from one customer, kept APART from the
   money: nothing here writes a quotation, an invoice, a payment, a verification, the closer or
   commission, and Won is never revenue. A deal's value is counted once (lib/pipeline-words.ts):
   its newest linked quotation's latest total, or the estimate while none is linked.

     New -> Qualified -> Proposal sent -> Negotiation -> Won / Lost

   Moving is a drag on the board, or "Move to" on a card (keyboard and phone). Won needs the
   customer's acceptance of a linked quotation or an invoice made from one; the CEO, COO or CCO
   may decide otherwise with a reason. Lost needs a reason from the list. Amber "Stuck" is 14
   days in one stage with nothing recorded; red stays for an overdue next action. Every button
   is drawn from what the server says this person may do, and every route checks again. */

import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { newIdempotencyKey } from "@/lib/outbox";
import { fmtRM } from "@/lib/format";
import { L } from "@/components/portal/page-shared";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, TaskToolbar, type TableCol } from "@/components/portal/task-table";
import { DrawerFoot, DrawerForm, SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { MetricStrip, type StripCell } from "@/components/ui/metric-strip";
import { PillSwitch } from "@/components/ui/panel";
import { AppIcon } from "@/components/ui/app-icon";
import { useFeedback } from "@/components/ui/feedback-modal";
import {
  btnSm, btnSmPrimary, btnSmQuiet, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, fieldLabel, inputClass, selectClass, selectClassSm, textareaClass,
} from "@/lib/ui-styles";
import { LOST_REASONS, LOST_WORD, OPEN_STAGES, PRIORITY_WORD, STAGE_WORD, WON_WORD, type Stage } from "@/lib/pipeline-words";
import { serviceName } from "@/lib/crm-words";
import type { PbStage } from "@/lib/playbook";
import css from "./sales-pipeline.module.css";

interface Options {
  stages: Stage[]; lost_reasons: string[]; packages: { id: number; name: string; status: string }[]; owners: { id: number; name: string }[];
  can_write: boolean; can_assign: boolean; can_override: boolean; stuck_days: number; me: number;
}
interface Quote { id: number; doc_number: string; revision: number; total_cents: number; created_at: string; linked_at: string; accepted: boolean; invoiced: boolean }
export interface Deal {
  id: number; customer_id: number; customer: string; customer_phone: string | null; title: string; owner_id: number | null; owner_name: string | null;
  stage: Stage; est_value_cents: number | null; service: string | null; priority: "low" | "normal" | "high";
  next_action: string | null; next_action_on: string | null; expected_close_on: string | null;
  lost_reason: string | null; lost_note: string | null; won_basis: "acceptance" | "invoice" | "override" | null; override_reason: string | null;
  stage_since: string; closed_at: string | null; origin: "manual" | "suggestion"; version: number;
  quotes: Quote[]; value_cents: number | null; value_basis: "quotation" | "estimate" | "none";
  days_in_stage: number; stuck: boolean; next_late: boolean; next_today: boolean; no_next: boolean;
}
interface Board {
  today: string; deals: Deal[];
  summary: { open: number; value_cents: number; quoted_cents: number; estimated_cents: number; stuck: number; no_next: number; late: number; won_month: number; lost_month: number; by_stage: Record<string, number> };
}
interface Detail {
  deal: Deal;
  events: { id: number; from_stage: Stage | null; to_stage: Stage; reason: string | null; basis: string | null; created_at: string; by_name: string | null }[];
  candidates: { id: number; doc_number: string; total_cents: number; revision: number; created_at: string }[];
}
interface Suggestion { doc_id: number; doc_number: string; customer_id: number; company: string; total_cents: number; created_at: string; owner_id: number; owner_name: string; accepted: boolean; stage: Stage }

const w = (pair: [string, string] | undefined, fallback: string) => (pair ? L(pair[0], pair[1]) : fallback);
const stageWord = (s: Stage | null) => (s ? w(STAGE_WORD[s], s) : "—");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (iso: string | null) => { if (!iso) return ""; const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const when = (ts: string | null) => {
  if (!ts) return "";
  const t = Date.parse(ts.replace(" ", "T") + (/[zZ]$/.test(ts) ? "" : "Z"));
  if (Number.isNaN(t)) return ts;
  const m = new Date(t + 8 * 3600 * 1000);
  return `${m.getUTCDate()} ${MON[m.getUTCMonth()]}, ${String(m.getUTCHours()).padStart(2, "0")}:${String(m.getUTCMinutes()).padStart(2, "0")}`;
};
const key = () => newIdempotencyKey().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
const TOPICS = ["deals", "docs", "crm", "customers"];
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
const PRIORITY_CHIP = { low: chipSmNeutral, normal: chipSmNeutral, high: chipSmWarn } as const;

export function usePipelineOptions(enabled = true) {
  return useCachedApi<Options>("/staff/deals/options", enabled, ["deals", "packages"]);
}

/** a deal's value, and where it comes from - a quotation's total or the owner's estimate, never both */
function ValueTag({ d }: { d: Pick<Deal, "value_cents" | "value_basis"> }) {
  if (d.value_basis === "none") return <span className={css.muted} data-testid="deal-value" data-basis="none">{L("No value yet", "Tiada nilai lagi")}</span>;
  return (
    <span className={css.value} data-testid="deal-value" data-basis={d.value_basis}>
      {fmtRM(d.value_cents ?? 0)}
      <span className={css.basis}>{d.value_basis === "quotation" ? L("quoted", "disebut harga") : L("estimate", "anggaran")}</span>
    </span>
  );
}
/** the one flag a deal carries: red for a late next action, amber for none or stuck, blue for today */
function DealFlag({ d }: { d: Deal }) {
  if (d.stage === "won") return <span className={chipSmSuccess} data-testid="deal-flag" data-flag="won">{L("Won", "Berjaya")}</span>;
  if (d.stage === "lost") return <span className={chipSmNeutral} data-testid="deal-flag" data-flag="lost">{L("Lost", "Gagal")}</span>;
  if (d.next_late) return <span className={chipSmDanger} data-testid="deal-flag" data-flag="late">{L(`Overdue · ${dayOf(d.next_action_on)}`, `Lewat · ${dayOf(d.next_action_on)}`)}</span>;
  if (d.no_next) return <span className={chipSmWarn} data-testid="deal-flag" data-flag="no_next">{L("No next action", "Tiada tindakan seterusnya")}</span>;
  if (d.stuck) return <span className={chipSmWarn} data-testid="deal-flag" data-flag="stuck">{L(`Stuck · ${d.days_in_stage} days`, `Tersekat · ${d.days_in_stage} hari`)}</span>;
  if (d.next_today) return <span className={chipSmInfo} data-testid="deal-flag" data-flag="today">{L("Due today", "Hari ini")}</span>;
  return <span className={css.next} data-testid="deal-flag" data-flag="booked">{dayOf(d.next_action_on)}</span>;
}

/* =====================================================================
   The pipeline: the figures, the board (or list) and the deal beside it
   ===================================================================== */
export function SalesPipeline({ open, onOpen, onOpenLead, onQuote, onPlaybook, newTick = 0 }: {
  /** the deal a bell, the Action Center or a lead asked for */
  open: number | null; onOpen: (id: number | null) => void;
  onOpenLead: (customerId: number) => void;
  onQuote: (deal: { customer_id: number; customer: string; owner_id: number | null; deal_id: number }) => void;
  /** v1.404.0 (Phase 7, decision 5) - the Sales Playbook, on the entries for a deal's stage; read-only */
  onPlaybook?: (stage: PbStage) => void;
  /** the view bar's gold New deal: each press opens the form once */
  newTick?: number;
}) {
  const opts = usePipelineOptions();
  const fb = useFeedback();
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [scope, setScope] = useState<"all" | "mine">("mine");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [flag, setFlag] = useState<"" | "stuck" | "no_next" | "won" | "lost">("");
  const [drawer, setDrawer] = useState<number | null>(null);
  const [making, setMaking] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [tickSeen, setTickSeen] = useState(newTick);
  if (tickSeen !== newTick) { setTickSeen(newTick); setMaking(true); }
  const [asked, setAsked] = useState<number | null>(null);
  if (open !== asked) { setAsked(open); if (open != null && (narrow() || (layout === "board" && flag !== "won" && flag !== "lost"))) setDrawer(open); }

  const qs = new URLSearchParams({ scope });
  if (q.trim()) qs.set("q", q.trim());
  if (owner) qs.set("owner", owner);
  if (priority) qs.set("priority", priority);
  const board = useCachedApi<Board>(`/staff/deals?${qs.toString()}`, true, TOPICS);
  const refresh = useCallback(() => board.refresh(), [board]);
  const o = opts.data;
  const s = board.data?.summary;
  const boardShown = layout === "board" && flag !== "won" && flag !== "lost";
  /* the board takes the whole width, so a deal opens in the drawer there; the list keeps the deal beside it */
  const pick = (id: number) => { onOpen(id); if (narrow() || boardShown) setDrawer(id); };
  const all = board.data?.deals ?? [];
  const shown = all.filter((d) => (flag === "" ? true : flag === "won" || flag === "lost" ? d.stage === flag : d[flag]));
  const openDeals = shown.filter((d) => (OPEN_STAGES as readonly string[]).includes(d.stage));
  const mayMove = (d: Deal) => !!o?.can_write && (o.can_assign || d.owner_id === o.me);

  /** a move from the board: one write, confirmed by the deal's version; the server's answer is what the person is told */
  const showToast = fb.show;
  const move = async (d: Deal, to: Stage) => {
    if (to === d.stage || !mayMove(d)) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/deals/${d.id}/move`, { method: "POST", body: JSON.stringify({ to, version: d.version }) });
    if (!r.ok) showToast({ variant: "error", title: L("Not moved", "Tidak dialih"), description: r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") });
    else showToast({ variant: "success", title: L(`Moved to ${w(STAGE_WORD[to], to)}`, `Dialih ke ${w(STAGE_WORD[to], to)}`), description: d.title });
    refresh();
  };

  const cells: StripCell[] = [
    { key: "open", icon: "target", tone: "info", label: scope === "mine" ? L("My open deals", "Urusan terbuka saya") : L("Open deals", "Urusan terbuka"), value: s ? s.open : "…", busy: !s,
      onClick: () => setFlag(""), pressed: flag === "" },
    { key: "value", icon: "money", tone: "gold", label: L("Pipeline value", "Nilai saluran"), value: s ? fmtRM(s.value_cents) : "…", busy: !s,
      sub: L("Not revenue", "Bukan hasil") },
    { key: "stuck", icon: "time", tone: "gold", label: L("Stuck", "Tersekat"), value: s ? s.stuck : "…", busy: !s,
      sub: L(`${o?.stuck_days ?? 14}+ quiet days`, `${o?.stuck_days ?? 14}+ hari senyap`), onClick: () => setFlag(flag === "stuck" ? "" : "stuck"), pressed: flag === "stuck" },
    { key: "no_next", icon: "alert", tone: "gold", label: L("No next action", "Tiada tindakan seterusnya"), value: s ? s.no_next : "…", busy: !s,
      onClick: () => setFlag(flag === "no_next" ? "" : "no_next"), pressed: flag === "no_next" },
    { key: "won", icon: "success", tone: "ok", label: L("Won this month", "Berjaya bulan ini"), value: s ? s.won_month : "…", busy: !s,
      sub: L("Not revenue", "Bukan hasil"), onClick: () => setFlag(flag === "won" ? "" : "won"), pressed: flag === "won" },
    { key: "lost", icon: "close", tone: "bad", label: L("Lost this month", "Gagal bulan ini"), value: s ? s.lost_month : "…", busy: !s,
      onClick: () => setFlag(flag === "lost" ? "" : "lost"), pressed: flag === "lost" },
  ];
  const cols: TableCol<Deal>[] = [
    { key: "deal", label: L("Deal · customer", "Urusan · pelanggan"), main: true, cell: (d) => <>
      <TaskRowTitle title={d.title} onOpen={() => pick(d.id)} late={d.next_late} />
      <TaskRowSub>{[d.customer, d.owner_name ?? L("No owner", "Tiada pemilik")].join(" · ")}</TaskRowSub>
    </> },
    { key: "stage", label: L("Stage", "Peringkat"), cell: (d) => <span className={css.stageChip} data-stage={d.stage} data-testid="deal-stage">{stageWord(d.stage)}</span> },
    { key: "value", label: L("Value", "Nilai"), cell: (d) => <ValueTag d={d} /> },
    { key: "next", label: L("Next action", "Tindakan seterusnya"), cell: (d) => <DealFlag d={d} /> },
  ];
  const empty = (msg: string) => <p className={css.empty} data-testid="pipeline-empty"><AppIcon name="search" />{msg}</p>;
  const noneMsg = q || owner || priority || flag ? L("No deal matches these filters.", "Tiada urusan sepadan dengan penapis ini.")
    : scope === "mine" ? L("No deal is yours yet. Start one from a lead, or press New deal.", "Belum ada urusan milik anda. Mulakan dari prospek, atau tekan Urusan baharu.")
      : L("No deals yet. Start one from a lead, or confirm the suggested deals from open quotations.", "Belum ada urusan. Mulakan dari prospek, atau sahkan urusan dicadangkan dari sebut harga terbuka.");

  if ((board.failed && !board.data) || (opts.failed && !o)) return <p className={css.warn} role="alert" data-testid="pipeline-failed"><AppIcon name="warning" />{L("The pipeline could not be loaded. If the database update has not run yet, run PUSH.bat.", "Saluran tidak dapat dimuatkan. Jika kemas kini pangkalan data belum dijalankan, jalankan PUSH.bat.")}</p>;

  const card = (d: Deal) => (
    <li key={d.id} className={`${css.card} ${d.id === open ? css.cardOn : ""} ${d.next_late ? css.cardLate : ""}`} data-testid="deal-card" data-deal={d.id} data-record={`deal:${d.id}`}
      draggable={mayMove(d)} onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(d.id)); e.dataTransfer.effectAllowed = "move"; setDragId(d.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}>
      <button type="button" className={css.cardOpen} onClick={() => pick(d.id)} data-testid="deal-open" aria-pressed={d.id === open}>
        <strong>{d.title}</strong>
        <span>{d.customer}</span>
      </button>
      <span className={css.cardMeta}><ValueTag d={d} />{d.priority === "high" && <span className={chipSmWarn} data-testid="deal-priority">{L("High", "Tinggi")}</span>}</span>
      <span className={css.cardMeta}><DealFlag d={d} /><span className={css.muted}>{d.owner_name ?? L("No owner", "Tiada pemilik")}</span></span>
      {mayMove(d) && (
        <label className={css.moveTo}>
          <span className="erp-sr-only">{L(`Move ${d.title} to`, `Alih ${d.title} ke`)}</span>
          <select className={selectClassSm} value="" onChange={(e) => { if (e.target.value) void move(d, e.target.value as Stage); }} data-testid="deal-move">
            <option value="">{L("Move to…", "Alih ke…")}</option>
            {OPEN_STAGES.filter((x) => x !== d.stage).map((x) => <option key={x} value={x}>{stageWord(x)}</option>)}
          </select>
        </label>
      )}
    </li>
  );
  const drop = (stage: Stage) => (e: DragEvent) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData("text/plain")) || dragId;
    const d = all.find((x) => x.id === id);
    if (d) void move(d, stage);
  };

  return (
    <div className="erp-stack-tight" data-testid="sales-pipeline">
      {fb.node}
      <MetricStrip cells={cells} label={L("The pipeline at a glance", "Saluran sepintas lalu")} testid="pipeline-strip" />
      <WorkspaceSplit testid="pipeline-split" ratio="60-40">
        <SplitPane testid="pipeline-list" title={L("Sales Pipeline", "Saluran Jualan")} label={L("Deals", "Urusan")}
          sub={s ? L(`${fmtRM(s.quoted_cents)} quoted · ${fmtRM(s.estimated_cents)} estimated · counted once, never both`, `${fmtRM(s.quoted_cents)} disebut harga · ${fmtRM(s.estimated_cents)} anggaran · dikira sekali, bukan kedua-duanya`) : undefined}
          actions={<>
            <PillSwitch value={layout} onChange={setLayout} label={L("Show as", "Papar sebagai")} testid="pipeline-layout"
              options={[["board", L("Board", "Papan"), "orders"], ["list", L("List", "Senarai"), "documents"]] as const} />
          </>}
          toolbar={<TaskToolbar q={q} onQ={setQ} placeholder={L("Search deal or customer…", "Cari urusan atau pelanggan…")} testid="pipeline-toolbar"
            aside={o?.can_assign ? <button type="button" className={btnSm} onClick={() => setSuggest(true)} data-testid="deal-suggest-open"><AppIcon name="document" />{L("Suggested deals", "Urusan dicadangkan")}</button> : undefined}>
            <PillSwitch value={scope} onChange={setScope} label={L("Whose deals", "Urusan siapa")} testid="pipeline-scope"
              options={[["mine", L("Mine", "Saya")], ["all", L("Everyone", "Semua")]] as const} />
            {scope === "all" && (
              <select className={selectClassSm} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={L("Owner", "Pemilik")} data-testid="pipeline-owner">
                <option value="">{L("Any owner", "Semua pemilik")}</option>
                {(o?.owners ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            <select className={selectClassSm} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={L("Priority", "Keutamaan")} data-testid="pipeline-priority">
              <option value="">{L("Any priority", "Semua keutamaan")}</option>
              {(["high", "normal", "low"] as const).map((k) => <option key={k} value={k}>{w(PRIORITY_WORD[k], k)}</option>)}
            </select>
          </TaskToolbar>}>
          {!board.data ? <SkelRows rows={6} /> : boardShown ? (
            <div className={css.boardScroll} data-testid="pipeline-board">
              {openDeals.length === 0 && empty(noneMsg)}
              <div className={css.board}>
                {OPEN_STAGES.map((st) => {
                  const here = openDeals.filter((d) => d.stage === st);
                  const total = here.reduce((t, d) => t + (d.value_cents ?? 0), 0);
                  return (
                    <section key={st} className={`${css.col} ${over === st ? css.colOver : ""}`} aria-label={stageWord(st)} data-testid={`pipeline-col-${st}`}
                      onDragOver={(e) => { if (dragId !== null) { e.preventDefault(); setOver(st); } }} onDragLeave={() => setOver((x) => (x === st ? null : x))} onDrop={drop(st)}>
                      <header className={css.colHead}><strong>{stageWord(st)}</strong><span className={chipSmNeutral} data-testid="col-count">{here.length}</span></header>
                      <span className={css.colSum}>{fmtRM(total)}</span>
                      <ol className={css.cards}>{here.map(card)}</ol>
                    </section>
                  );
                })}
              </div>
            </div>
          ) : (
            <CompactTaskTable rows={shown} cols={cols} label={L("Deals", "Urusan")} loading={false} record="deal" testid="pipeline-table" fill
              onOpen={pick} picked={open} rowClass={(d) => (d.next_late ? css.lateRow ?? "" : "")} empty={empty(noneMsg)} />
          )}
        </SplitPane>
        {boardShown ? null : open != null ? (
          <SplitPane testid="deal-preview" title={L("Selected deal", "Urusan dipilih")} label={L("Selected deal", "Urusan dipilih")}
            actions={<button type="button" className={btnSmQuiet} aria-label={L("Close", "Tutup")} onClick={() => onOpen(null)} data-testid="deal-preview-close"><AppIcon name="close" /></button>}>
            <DealRecord id={open} opts={o} onChanged={refresh} onOpenLead={onOpenLead} onQuote={onQuote} onPlaybook={onPlaybook} />
          </SplitPane>
        ) : (
          <SplitPane testid="pipeline-help" title={L("Every open deal needs a next action", "Setiap urusan terbuka perlukan tindakan seterusnya")} label={L("How deals are worked", "Cara urusan diurus")}
            sub={L("Choose a deal to see it here.", "Pilih urusan untuk melihatnya di sini.")}>
            <ul className={css.rules} data-testid="pipeline-rules">
              <li><span className={chipSmDanger}>{L("Overdue", "Lewat")}</span>{L("the next action's day has passed", "hari tindakan seterusnya telah berlalu")}</li>
              <li><span className={chipSmWarn}>{L("Stuck", "Tersekat")}</span>{L(`${o?.stuck_days ?? 14} days in one stage with nothing recorded`, `${o?.stuck_days ?? 14} hari dalam satu peringkat tanpa rekod`)}</li>
              <li><span className={chipSmSuccess}>{L("Won", "Berjaya")}</span>{L("the customer accepted a linked quotation, or it was invoiced - never revenue by itself", "pelanggan menerima sebut harga dipaut, atau ia diinvois - bukan hasil dengan sendiri")}</li>
              <li><span className={chipSmNeutral}>{L("Value", "Nilai")}</span>{L("the newest linked quotation, or your estimate until there is one", "sebut harga dipaut terbaharu, atau anggaran anda sehingga ada")}</li>
            </ul>
          </SplitPane>
        )}
      </WorkspaceSplit>
      {drawer != null && (
        <SideDrawer open onClose={() => setDrawer(null)} title={L("Deal", "Urusan")} full>
          <DealRecord id={drawer} opts={o} onChanged={refresh} onOpenLead={onOpenLead} onQuote={onQuote} onPlaybook={onPlaybook} />
        </SideDrawer>
      )}
      {making && o?.can_write && <DealForm opts={o} onClose={() => setMaking(false)} onSaved={(id) => { setMaking(false); refresh(); pick(id); }} />}
      {suggest && o?.can_assign && <SuggestedDeals onClose={() => setSuggest(false)} onDone={refresh} />}
    </div>
  );
}

/* =====================================================================
   One deal
   ===================================================================== */
type Form = "" | "edit" | "won" | "lost" | "reopen" | "link";

function DealRecord({ id, opts, onChanged, onOpenLead, onQuote, onPlaybook }: {
  id: number; opts: Options | null; onChanged: () => void;
  onOpenLead: (customerId: number) => void;
  onQuote: (deal: { customer_id: number; customer: string; owner_id: number | null; deal_id: number }) => void;
  onPlaybook?: (stage: PbStage) => void;
}) {
  const fb = useFeedback();
  const [d, setD] = useState<Detail | null>(null);
  const [problem, setProblem] = useState("");
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<Form>("");
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(id);
  if (seen !== id) { setSeen(id); setD(null); setForm(""); setProblem(""); }
  useEffect(() => {
    const c = new AbortController();
    void api<Detail & { error?: { message?: string } }>(`/staff/deals/${id}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data?.deal) { setD(r.data); setProblem(""); } else setProblem(r.data?.error?.message ?? L("The deal could not be opened.", "Urusan tidak dapat dibuka."));
    });
    return () => c.abort();
  }, [id, tick]);

  const send = async (path: string, method: "POST" | "PUT", body: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    const r = await api<{ error?: { message?: string }; basis?: string }>(`/staff/deals/${id}${path}`, { method, body: JSON.stringify({ ...body, version: d?.deal.version }) });
    setBusy(false);
    setTick((t) => t + 1);
    if (!r.ok) {
      fb.show({ variant: "error", title: L("Not saved", "Tidak disimpan"), description: r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") });
      return false;
    }
    fb.show({ variant: "success", title: done, description: d?.deal.title });
    setForm("");
    onChanged();
    return true;
  };

  if (problem && !d) return <p className={css.warn} role="alert" data-testid="deal-problem"><AppIcon name="warning" />{problem}</p>;
  if (!d) return <SkelRows rows={6} />;
  const x = d.deal;
  const isOpen = (OPEN_STAGES as readonly string[]).includes(x.stage);
  const mine = !!opts && (opts.can_assign || x.owner_id === opts.me);
  const can = !!opts?.can_write && mine;
  const evidence = x.quotes.find((q) => q.accepted) ?? x.quotes.find((q) => q.invoiced) ?? null;
  return (
    <div className={css.record} data-testid="deal-record" data-deal={x.id}>
      {fb.node}
      <div className={css.head}>
        <span className={css.avatar} aria-hidden><AppIcon name="target" /></span>
        <div className={css.headText}>
          <strong>{x.title}</strong>
          <button type="button" className={css.linkish} onClick={() => onOpenLead(x.customer_id)} data-testid="deal-lead">{x.customer}</button>
        </div>
        <span className={css.stageChip} data-stage={x.stage} data-testid="deal-stage">{stageWord(x.stage)}</span>
      </div>

      {isOpen && (
        <ol className={css.steps} aria-label={L("Stages", "Peringkat")} data-testid="deal-steps">
          {OPEN_STAGES.map((st, i) => {
            const at = OPEN_STAGES.indexOf(x.stage as (typeof OPEN_STAGES)[number]);
            return <li key={st} data-on={i === at ? "" : undefined} data-done={i < at ? "" : undefined}>{stageWord(st)}</li>;
          })}
        </ol>
      )}

      <dl className={css.dl} data-testid="deal-facts">
        <dt>{L("Value", "Nilai")}</dt><dd><ValueTag d={x} /></dd>
        <dt>{L("Owner", "Pemilik")}</dt><dd>{x.owner_name ?? <span className={chipSmWarn}>{L("No owner", "Tiada pemilik")}</span>}</dd>
        <dt>{L("Next action", "Tindakan seterusnya")}</dt>
        <dd data-testid="deal-next">{isOpen ? <span className={css.inline}><DealFlag d={x} />{x.next_action}</span> : "—"}</dd>
        <dt>{L("Expected close", "Jangka ditutup")}</dt><dd>{x.expected_close_on ? dayOf(x.expected_close_on) : "—"}</dd>
        <dt>{L("Service", "Perkhidmatan")}</dt><dd>{x.service ? serviceName(x.service, opts?.packages ?? []) : "—"}</dd>
        <dt>{L("Priority", "Keutamaan")}</dt><dd><span className={PRIORITY_CHIP[x.priority]}>{w(PRIORITY_WORD[x.priority], x.priority)}</span></dd>
        <dt>{L("In this stage", "Dalam peringkat ini")}</dt><dd>{L(`${x.days_in_stage} day${x.days_in_stage === 1 ? "" : "s"}`, `${x.days_in_stage} hari`)}</dd>
        {x.stage === "won" && x.won_basis && <><dt>{L("Won on", "Berjaya atas")}</dt><dd data-testid="deal-won-basis" data-basis={x.won_basis}>{w(WON_WORD[x.won_basis], x.won_basis)}{x.override_reason ? ` · ${x.override_reason}` : ""}</dd></>}
        {x.stage === "lost" && x.lost_reason && <><dt>{L("Why lost", "Sebab gagal")}</dt><dd data-testid="deal-lost-reason">{w(LOST_WORD[x.lost_reason as keyof typeof LOST_WORD], x.lost_reason)}{x.lost_note ? ` · ${x.lost_note}` : ""}</dd></>}
      </dl>

      <section className={css.actions} aria-label={L("Actions", "Tindakan")} data-testid="deal-actions">
        {isOpen && can && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => setForm("won")} data-testid="deal-won-btn"><AppIcon name="success" />{L("Mark won", "Tanda berjaya")}</button>}
        {isOpen && can && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm("lost")} data-testid="deal-lost-btn">{L("Mark lost", "Tanda gagal")}</button>}
        {isOpen && can && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm("edit")} data-testid="deal-edit-btn"><AppIcon name="edit" />{L("Edit & next action", "Sunting & tindakan")}</button>}
        {isOpen && can && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm("link")} data-testid="deal-link-btn"><AppIcon name="document" />{L("Link quotation", "Paut sebut harga")}</button>}
        {isOpen && can && <button type="button" className={btnSmQuiet} onClick={() => onQuote({ customer_id: x.customer_id, customer: x.customer, owner_id: x.owner_id, deal_id: x.id })} data-testid="deal-quote"><AppIcon name="add" />{L("Create quotation", "Buat sebut harga")}</button>}
        {!isOpen && opts?.can_override && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm("reopen")} data-testid="deal-reopen-btn">{L("Reopen", "Buka semula")}</button>}
        {/* v1.404.0 (Phase 7, decision 5) - read-only: the Playbook entries tagged with this stage; it changes nothing on the deal */}
        {isOpen && onPlaybook && <button type="button" className={btnSmQuiet} onClick={() => onPlaybook(x.stage as PbStage)} data-testid="deal-playbook"><AppIcon name="documents" />{L("Playbook for this stage", "Panduan untuk peringkat ini")}</button>}
      </section>

      <Section title={L("Quotations", "Sebut harga")} testid="deal-quotes">
        {x.quotes.length === 0 ? <p className={css.muted}>{L("No quotation linked. The value is the estimate until one is.", "Tiada sebut harga dipaut. Nilai ialah anggaran sehingga ada.")}</p> : (
          <ul className={css.docs}>
            {x.quotes.map((q, i) => (
              <li key={q.id} data-testid="deal-quote-row" data-doc={q.id}>
                <span>{q.doc_number}{q.revision ? ` · R${q.revision}` : ""}{i === 0 ? <span className={css.basis}>{L("counts", "dikira")}</span> : null}</span>
                <span>{fmtRM(q.total_cents)}</span>
                <span>{q.invoiced ? <span className={chipSmSuccess}>{L("Invoiced", "Diinvois")}</span> : q.accepted ? <span className={chipSmSuccess}>{L("Accepted", "Diterima")}</span> : <span className={chipSmNeutral}>{L("Open", "Terbuka")}</span>}</span>
                {isOpen && can && <UnlinkButton busy={busy} onUnlink={(reason) => send("/unlink", "POST", { doc_id: q.id, reason }, L("Quotation unlinked", "Sebut harga dinyahpaut"))} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {(x.stage === "won" || x.quotes.some((q) => q.invoiced)) && <DealPayment dealId={x.id} />}
      <Section title={L("Stage history", "Sejarah peringkat")} testid="deal-history">
        <ol className={css.timeline}>
          {d.events.map((e) => (
            <li key={e.id} data-testid="deal-event" data-to={e.to_stage}>
              <span className={css.tlHead}><strong>{e.from_stage ? `${stageWord(e.from_stage)} → ${stageWord(e.to_stage)}` : L(`Started in ${stageWord(e.to_stage)}`, `Dimulakan di ${stageWord(e.to_stage)}`)}</strong> · {when(e.created_at)}{e.by_name ? ` · ${e.by_name}` : ""}</span>
              {e.reason && <span className={css.tlBody}>{e.reason}</span>}
            </li>
          ))}
        </ol>
      </Section>

      {form === "edit" && opts && <DealForm opts={opts} deal={x} onClose={() => setForm("")} onSaved={() => { setForm(""); setTick((t) => t + 1); onChanged(); fb.show({ variant: "success", title: L("Deal saved", "Urusan disimpan"), description: x.title }); }} />}
      {form === "won" && <WonForm busy={busy} evidence={evidence} canOverride={!!opts?.can_override} onClose={() => setForm("")} onSave={(b) => send("/won", "POST", b, L("Deal won", "Urusan berjaya"))} />}
      {form === "lost" && <LostForm busy={busy} onClose={() => setForm("")} onSave={(b) => send("/lost", "POST", b, L("Deal marked lost", "Urusan ditanda gagal"))} />}
      {form === "reopen" && <ReasonForm title={L("Reopen deal", "Buka semula urusan")} min={10} busy={busy} testid="reopen"
        intro={L("It goes back to Negotiation. The earlier Won or Lost stays in the history.", "Ia kembali ke Rundingan. Berjaya atau Gagal sebelumnya kekal dalam sejarah.")}
        onClose={() => setForm("")} onSave={(reason) => send("/reopen", "POST", { reason }, L("Deal reopened", "Urusan dibuka semula"))} />}
      {form === "link" && <LinkForm busy={busy} candidates={d.candidates} onClose={() => setForm("")} onSave={(doc_id) => send("/link", "POST", { doc_id }, L("Quotation linked", "Sebut harga dipaut"))} />}
    </div>
  );
}

function Section({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  return <section className={css.section} aria-label={title} data-testid={testid}><h3 className={css.h3}>{title}</h3>{children}</section>;
}
function FormDrawer({ title, icon, onClose, children, foot }: { title: string; icon: "target" | "success" | "close" | "edit" | "document"; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  return (
    <SideDrawer open onClose={onClose} title={title} form icon={icon} dirty="auto">
      <DrawerForm>{children}</DrawerForm>
      <DrawerFoot>{foot}</DrawerFoot>
    </SideDrawer>
  );
}
const Cancel = ({ onClose }: { onClose: () => void }) => <button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>;

/** a new deal (from New deal, or from a lead) or an edit of one */
export function DealForm({ opts, deal, customer, onClose, onSaved }: {
  opts: Options; deal?: Deal; customer?: { id: number; company: string; owner_id: number | null };
  onClose: () => void; onSaved: (id: number) => void;
}) {
  const fb = useFeedback();
  const [ck] = useState(key);
  const [title, setTitle] = useState(deal?.title ?? (customer ? customer.company : ""));
  const [cust, setCust] = useState<number | "">(deal?.customer_id ?? customer?.id ?? "");
  const [custQ, setCustQ] = useState("");
  const [owner, setOwner] = useState<number | "">(deal ? deal.owner_id ?? "" : customer?.owner_id ?? opts.me);
  const [est, setEst] = useState(deal?.est_value_cents != null ? String(deal.est_value_cents / 100) : "");
  const [service, setService] = useState(deal?.service ?? "");
  const [priority, setPriority] = useState<Deal["priority"]>(deal?.priority ?? "normal");
  const [next, setNext] = useState(deal?.next_action ?? "");
  const [nextOn, setNextOn] = useState(deal?.next_action_on ?? "");
  const [closeOn, setCloseOn] = useState(deal?.expected_close_on ?? "");
  const [busy, setBusy] = useState(false);
  const found = useCachedApi<{ rows: { id: number; company: string; owner_id: number | null }[] }>(
    `/staff/crm/leads?view=all&sort=name&q=${encodeURIComponent(custQ.trim())}`, !deal && !customer && custQ.trim().length >= 2, ["crm", "customers"]);
  const quoted = !!deal && deal.quotes.length > 0;
  const estCents = est.trim() === "" ? null : Math.round(Number(est) * 100);
  const ok = title.trim().length >= 3 && cust !== "" && (estCents === null || (Number.isFinite(estCents) && estCents >= 0));
  const save = async () => {
    setBusy(true);
    const body = { title: title.trim(), customer_id: cust, est_value_cents: estCents, service: service || null, priority, next_action: next.trim() || null,
      next_action_on: nextOn || null, expected_close_on: closeOn || null, ...(opts.can_assign || !deal ? { owner_id: owner === "" ? null : owner } : {}) };
    const r = deal
      ? await api<{ error?: { message?: string } }>(`/staff/deals/${deal.id}`, { method: "PUT", body: JSON.stringify({ ...body, version: deal.version }) })
      : await api<{ id?: number; error?: { message?: string } }>(`/staff/deals`, { method: "POST", body: JSON.stringify({ ...body, client_key: ck }) });
    setBusy(false);
    if (!r.ok) { fb.show({ variant: "error", title: L("Not saved", "Tidak disimpan"), description: r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") }); return; }
    onSaved(deal ? deal.id : (r.data as { id: number }).id);
  };
  const pk = opts.packages.filter((p) => p.status === "active" || service === `pkg:${p.id}`);
  return (
    <FormDrawer title={deal ? L("Edit deal", "Sunting urusan") : L("New deal", "Urusan baharu")} icon="target" onClose={onClose}
      foot={<><Cancel onClose={onClose} /><button type="button" className={btnSmPrimary} disabled={busy || !ok} onClick={() => void save()} data-testid="deal-save">{deal ? L("Save deal", "Simpan urusan") : L("Create deal", "Cipta urusan")}</button></>}>
      {fb.node}
      {!deal && !customer && (
        <fieldset className={css.radios} data-testid="deal-customer">
          <legend className={css.h3}>{L("Customer", "Pelanggan")}</legend>
          <input className={inputClass} value={custQ} onChange={(e) => { setCustQ(e.target.value); setCust(""); }} placeholder={L("Type 2 letters of the company…", "Taip 2 huruf nama syarikat…")} data-testid="deal-customer-q" />
          {(found.data?.rows ?? []).slice(0, 8).map((c) => (
            <label key={c.id} className={css.radio}><input type="radio" name="deal-customer" checked={cust === c.id} onChange={() => { setCust(c.id); if (!title.trim()) setTitle(c.company); if (c.owner_id) setOwner(c.owner_id); }} data-testid={`deal-customer-${c.id}`} />{c.company}</label>
          ))}
        </fieldset>
      )}
      {customer && <p className={css.muted}>{L(`For ${customer.company}`, `Untuk ${customer.company}`)}</p>}
      <label className={fieldLabel}>{L("Deal name", "Nama urusan")}
        <input className={inputClass} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={L("e.g. Raya live campaign", "cth. Kempen live Raya")} data-testid="deal-title" />
      </label>
      {(opts.can_assign || !deal) && (
        <label className={fieldLabel}>{L("Owner", "Pemilik")}
          <select className={selectClass} value={owner} disabled={!opts.can_assign} onChange={(e) => setOwner(e.target.value ? Number(e.target.value) : "")} data-testid="deal-owner">
            {!opts.can_assign && <option value={opts.me}>{L("You", "Anda")}</option>}
            {opts.can_assign && <option value="">{L("No owner yet", "Belum ada pemilik")}</option>}
            {opts.can_assign && opts.owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      <label className={fieldLabel}>{quoted ? L("Estimate (not counted - a quotation is linked)", "Anggaran (tidak dikira - sebut harga dipaut)") : L("Estimated value, RM (optional)", "Anggaran nilai, RM (pilihan)")}
        <input className={inputClass} inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="deal-est" />
      </label>
      <label className={fieldLabel}>{L("Service (from the Packages library - names only)", "Perkhidmatan (dari pustaka Pakej - nama sahaja)")}
        <select className={selectClass} value={service} onChange={(e) => setService(e.target.value)} data-testid="deal-service">
          <option value="">{L("Not set", "Belum ditetapkan")}</option>
          {pk.map((p) => <option key={p.id} value={`pkg:${p.id}`}>{p.name}</option>)}
        </select>
      </label>
      <label className={fieldLabel}>{L("Priority", "Keutamaan")}
        <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as Deal["priority"])} data-testid="deal-priority-select">
          {(["low", "normal", "high"] as const).map((k) => <option key={k} value={k}>{w(PRIORITY_WORD[k], k)}</option>)}
        </select>
      </label>
      <label className={fieldLabel}>{L("Next action", "Tindakan seterusnya")}
        <input className={inputClass} value={next} maxLength={200} onChange={(e) => setNext(e.target.value)} placeholder={L("e.g. Call to walk through the proposal", "cth. Telefon untuk terangkan cadangan")} data-testid="deal-next-action" />
      </label>
      <div className={css.twoUp}>
        <label className={fieldLabel}>{L("Next action on", "Tarikh tindakan")}
          <input type="date" className={inputClass} value={nextOn} onChange={(e) => setNextOn(e.target.value)} data-testid="deal-next-on" placeholder="YYYY-MM-DD" />
        </label>
        <label className={fieldLabel}>{L("Expected close", "Jangka ditutup")}
          <input type="date" className={inputClass} value={closeOn} onChange={(e) => setCloseOn(e.target.value)} data-testid="deal-close-on" placeholder="YYYY-MM-DD" />
        </label>
      </div>
    </FormDrawer>
  );
}

function WonForm({ busy, evidence, canOverride, onClose, onSave }: { busy: boolean; evidence: Quote | null; canOverride: boolean; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const ok = !!evidence || (canOverride && reason.trim().length >= 10);
  return (
    <FormDrawer title={L("Mark won", "Tanda berjaya")} icon="success" onClose={onClose}
      foot={<><Cancel onClose={onClose} /><button type="button" className={btnSmPrimary} disabled={busy || !ok} onClick={() => void onSave(evidence ? {} : { override_reason: reason.trim() })} data-testid="won-save">{L("Mark won", "Tanda berjaya")}</button></>}>
      <p className={css.muted}>{L("Won records the decision only. It is not revenue, a payment or commission - those follow the invoice and the CEO's verification.", "Berjaya merekod keputusan sahaja. Ia bukan hasil, bayaran atau komisen - itu mengikut invois dan pengesahan CEO.")}</p>
      {evidence ? (
        <p className={css.ok} data-testid="won-evidence"><AppIcon name="success" />{evidence.invoiced && !evidence.accepted
          ? L(`${evidence.doc_number} has been invoiced.`, `${evidence.doc_number} telah diinvois.`)
          : L(`The customer accepted ${evidence.doc_number}${evidence.revision ? ` (revision ${evidence.revision})` : ""}.`, `Pelanggan menerima ${evidence.doc_number}${evidence.revision ? ` (semakan ${evidence.revision})` : ""}.`)}</p>
      ) : canOverride ? (
        <>
          <p className={css.warn} data-testid="won-no-evidence"><AppIcon name="warning" />{L("No linked quotation is accepted or invoiced. You may still decide it is won - say why. It is kept in the audit trail.", "Tiada sebut harga dipaut diterima atau diinvois. Anda masih boleh memutuskan ia berjaya - nyatakan sebab. Ia disimpan dalam jejak audit.")}</p>
          <label className={fieldLabel}>{L("Why (at least 10 characters)", "Mengapa (sekurang-kurangnya 10 aksara)")}
            <textarea className={textareaClass} rows={3} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="won-reason" />
          </label>
        </>
      ) : (
        <p className={css.warn} data-testid="won-blocked"><AppIcon name="warning" />{L("Won needs the customer's acceptance of a linked quotation, or an invoice made from one. Record the acceptance on the quotation first, or ask the CEO, COO or CCO.", "Berjaya memerlukan penerimaan pelanggan atas sebut harga dipaut, atau invois daripadanya. Rekod penerimaan pada sebut harga dahulu, atau minta CEO, COO atau CCO.")}</p>
      )}
    </FormDrawer>
  );
}

function LostForm({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const ok = !!reason && (reason !== "other" || note.trim().length >= 5);
  return (
    <FormDrawer title={L("Mark lost", "Tanda gagal")} icon="close" onClose={onClose}
      foot={<><Cancel onClose={onClose} /><button type="button" className={btnSmPrimary} disabled={busy || !ok} onClick={() => void onSave({ reason, note: note.trim() || null })} data-testid="lost-save">{L("Mark lost", "Tanda gagal")}</button></>}>
      <fieldset className={css.radios} data-testid="lost-reasons">
        <legend className={css.h3}>{L("Why it was lost", "Sebab ia gagal")}</legend>
        {LOST_REASONS.map((k) => <label key={k} className={css.radio}><input type="radio" name="lost-reason" checked={reason === k} onChange={() => setReason(k)} data-testid={`lost-${k}`} />{w(LOST_WORD[k], k)}</label>)}
      </fieldset>
      <label className={fieldLabel}>{reason === "other" ? L("Say why (required)", "Nyatakan sebab (wajib)") : L("Note (optional)", "Nota (pilihan)")}
        <textarea className={textareaClass} rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} data-testid="lost-note" />
      </label>
    </FormDrawer>
  );
}

function ReasonForm({ title, intro, min, busy, testid, onClose, onSave }: { title: string; intro: string; min: number; busy: boolean; testid: string; onClose: () => void; onSave: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  return (
    <FormDrawer title={title} icon="edit" onClose={onClose}
      foot={<><Cancel onClose={onClose} /><button type="button" className={btnSmPrimary} disabled={busy || reason.trim().length < min} onClick={() => void onSave(reason.trim())} data-testid={`${testid}-save`}>{title}</button></>}>
      <p className={css.muted}>{intro}</p>
      <label className={fieldLabel}>{L(`Why (at least ${min} characters)`, `Mengapa (sekurang-kurangnya ${min} aksara)`)}
        <textarea className={textareaClass} rows={3} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid={`${testid}-reason`} />
      </label>
    </FormDrawer>
  );
}

function LinkForm({ busy, candidates, onClose, onSave }: { busy: boolean; candidates: Detail["candidates"]; onClose: () => void; onSave: (docId: number) => Promise<boolean> }) {
  const [doc, setDoc] = useState<number | null>(null);
  return (
    <FormDrawer title={L("Link quotation", "Paut sebut harga")} icon="document" onClose={onClose}
      foot={<><Cancel onClose={onClose} /><button type="button" className={btnSmPrimary} disabled={busy || doc === null} onClick={() => doc !== null && void onSave(doc)} data-testid="link-save">{L("Link", "Paut")}</button></>}>
      <p className={css.muted}>{L("Quotations of this customer that belong to no other deal. The newest linked one sets the deal's value.", "Sebut harga pelanggan ini yang bukan milik urusan lain. Yang terbaharu dipaut menetapkan nilai urusan.")}</p>
      {candidates.length === 0 ? <p className={css.muted} data-testid="link-none">{L("None to link. Create a quotation for this customer first.", "Tiada untuk dipaut. Buat sebut harga untuk pelanggan ini dahulu.")}</p> : (
        <fieldset className={css.radios} data-testid="link-options">
          <legend className="erp-sr-only">{L("Quotation", "Sebut harga")}</legend>
          {candidates.map((c) => <label key={c.id} className={css.radio}><input type="radio" name="link-doc" checked={doc === c.id} onChange={() => setDoc(c.id)} data-testid={`link-${c.id}`} />{c.doc_number}{c.revision ? ` · R${c.revision}` : ""} · {fmtRM(c.total_cents)} · {dayOf(c.created_at)}</label>)}
        </fieldset>
      )}
    </FormDrawer>
  );
}

function UnlinkButton({ busy, onUnlink }: { busy: boolean; onUnlink: (reason: string) => Promise<boolean> }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" className={btnSmQuiet} disabled={busy} onClick={() => setAsking(true)} data-testid="deal-unlink">{L("Unlink", "Nyahpaut")}</button>
      {asking && <ReasonForm title={L("Unlink quotation", "Nyahpaut sebut harga")} min={5} busy={busy} testid="unlink"
        intro={L("The quotation itself is not changed. The link is kept in the history.", "Sebut harga itu tidak diubah. Pautan disimpan dalam sejarah.")}
        onClose={() => setAsking(false)} onSave={async (r) => { const ok = await onUnlink(r); if (ok) setAsking(false); return ok; }} />}
    </>
  );
}

/** decision 3: open quotations with no deal, offered as deals; nothing is made until a manager confirms */
function SuggestedDeals({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fb = useFeedback();
  const list = useCachedApi<{ rows: Suggestion[] }>("/staff/deals/suggestions", true, ["deals", "docs"]);
  const [picked, setPicked] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = list.data?.rows ?? [];
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = async () => {
    setBusy(true);
    const r = await api<{ made?: number; skipped?: number[]; error?: { message?: string } }>("/staff/deals/suggestions/confirm", { method: "POST", body: JSON.stringify({ items: picked, reason: reason.trim() }) });
    setBusy(false);
    if (!r.ok) { fb.show({ variant: "error", title: L("Not saved", "Tidak disimpan"), description: r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") }); return; }
    const made = r.data?.made ?? 0, skipped = r.data?.skipped?.length ?? 0;
    fb.show({ variant: "success", title: L(`${made} deal${made === 1 ? "" : "s"} made`, `${made} urusan dibuat`), description: skipped ? L(`${skipped} already had a deal or changed, so were left alone.`, `${skipped} sudah ada urusan atau berubah, jadi dibiarkan.`) : undefined });
    setPicked([]); list.refresh(); onDone();
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Suggested deals", "Urusan dicadangkan")} form icon="document" wide dirty="auto">
      {fb.node}
      <DrawerForm>
        <p className={css.muted}>{L("Open quotations that belong to no deal. Each becomes a deal owned by its salesperson, in Proposal sent (Negotiation if it was negotiating or accepted). Nothing is made until you confirm.", "Sebut harga terbuka yang bukan milik mana-mana urusan. Setiap satu menjadi urusan milik jurujualnya, di Cadangan dihantar (Rundingan jika sedang berunding atau diterima). Tiada apa dibuat sehingga anda sahkan.")}</p>
        {!list.data ? <SkelRows rows={4} /> : rows.length === 0 ? <p className={css.muted} data-testid="suggest-none">{L("Every open quotation already has a deal.", "Setiap sebut harga terbuka sudah ada urusan.")}</p> : (
          <ul className={css.suggest} data-testid="deal-suggest-list">
            {rows.map((r) => (
              <li key={r.doc_id} data-testid="deal-suggest-row" data-doc={r.doc_id}>
                <label className={css.radio}><input type="checkbox" checked={picked.includes(r.doc_id)} onChange={() => toggle(r.doc_id)} data-testid={`deal-suggest-${r.doc_id}`} />
                  <span><strong>{r.company}</strong> · {r.doc_number} · {fmtRM(r.total_cents)} · {r.owner_name} · {stageWord(r.stage)}</span></label>
              </li>
            ))}
          </ul>
        )}
        <label className={fieldLabel}>{L("Why (a few words, kept with each deal)", "Mengapa (beberapa perkataan, disimpan bersama setiap urusan)")}
          <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="deal-suggest-reason" />
        </label>
      </DrawerForm>
      <DrawerFoot>
        <Cancel onClose={onClose} />
        {rows.length > 0 && <button type="button" className={btnSm} onClick={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.doc_id))} data-testid="deal-suggest-all">{picked.length === rows.length ? L("Untick all", "Nyahtanda semua") : L("Tick all", "Tanda semua")}</button>}
        <button type="button" className={btnSmPrimary} disabled={busy || !picked.length || reason.trim().length < 5} onClick={() => void save()} data-testid="deal-suggest-confirm">{L(`Make ${picked.length} deal${picked.length === 1 ? "" : "s"}`, `Buat ${picked.length} urusan`)}</button>
      </DrawerFoot>
    </SideDrawer>
  );
}

/** a lead's deals, in its record (crm-leads.tsx), with New deal - the lead is where a deal usually starts */
export function LeadDeals({ customer, onOpenDeal }: { customer: { id: number; company: string; owner_id: number | null }; onOpenDeal: (id: number) => void }) {
  const opts = usePipelineOptions();
  const list = useCachedApi<Board>(`/staff/deals?customer=${customer.id}`, true, TOPICS);
  const [making, setMaking] = useState(false);
  const deals = list.data?.deals ?? [];
  return (
    <Section title={L("Deals", "Urusan")} testid="lead-deals">
      {!list.data ? <SkelRows rows={2} /> : deals.length === 0 ? <p className={css.muted}>{L("No deal yet.", "Belum ada urusan.")}</p> : (
        <ul className={css.docs}>
          {deals.map((d) => (
            <li key={d.id} data-testid="lead-deal" data-deal={d.id}>
              <button type="button" className={css.linkish} onClick={() => onOpenDeal(d.id)}>{d.title}</button>
              <ValueTag d={d} />
              <span className={css.stageChip} data-stage={d.stage}>{stageWord(d.stage)}</span>
            </li>
          ))}
        </ul>
      )}
      {opts.data?.can_write && <span><button type="button" className={btnSm} onClick={() => setMaking(true)} data-testid="lead-deal-new"><AppIcon name="add" />{L("New deal", "Urusan baharu")}</button></span>}
      {making && opts.data && <DealForm opts={opts.data} customer={customer} onClose={() => setMaking(false)} onSaved={(id) => { setMaking(false); list.refresh(); onOpenDeal(id); }} />}
    </Section>
  );
}

/** v1.401.0 (Phase 5, decision 6) - whether the money of a deal's invoices has come in, read only from the payment
    records. Amounts only for someone who may read that invoice's payments; Won stays "not revenue" either way. */
function DealPayment({ dealId }: { dealId: number }) {
  const r = useCachedApi<{ invoices: { id: number; doc_number: string; status: "invoiced" | "part_paid" | "paid" | "paid_verified"; waiting: boolean; total_cents?: number; verified_cents?: number }[] }>(
    `/staff/collections/deal/${dealId}`, true, ["deals", "payments", "docs"]);
  const inv = r.data?.invoices ?? [];
  return (
    <Section title={L("Payment", "Bayaran")} testid="deal-payment">
      {!r.data ? <SkelRows rows={1} /> : inv.length === 0 ? <p className={css.muted}>{L("Not invoiced yet.", "Belum diinvois.")}</p> : (
        <ul className={css.docs}>
          {inv.map((i) => (
            <li key={i.id} data-testid="deal-payment-row" data-status={i.status}>
              <span>{i.doc_number}</span>
              {i.total_cents != null && <span>{fmtRM(i.total_cents)}</span>}
              <span className={i.status === "paid_verified" || i.status === "paid" ? chipSmSuccess : i.status === "part_paid" ? chipSmWarn : chipSmNeutral}>
                {i.status === "paid_verified" ? L("Paid (CEO verified)", "Dibayar (disahkan CEO)") : i.status === "paid" ? L("Paid", "Dibayar")
                  : i.status === "part_paid" ? (i.verified_cents != null ? L(`Part paid (verified ${fmtRM(i.verified_cents)})`, `Dibayar sebahagian (disahkan ${fmtRM(i.verified_cents)})`) : L("Part paid (verified)", "Dibayar sebahagian (disahkan)"))
                    : L("Invoiced", "Diinvois")}
              </span>
              {i.waiting && <span className={chipSmNeutral}>{L("Payment reported, waiting for the CEO", "Bayaran dilapor, menunggu CEO")}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
