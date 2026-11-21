"use client";

/* v1.398.0 - LEADS & CRM (Sales Command Center Phase 2; the CEO, 21-11-2026: decisions 1-7
   and "As recommended" on the six Phase 2 decisions). worker/src/crm.ts is the server.

   The customer record IS the lead. This screen adds what it lacked - an owner, a source,
   the services it is interested in, a relationship status set by staff and a log of the
   contact made - and shows the list beside the one that is selected:

     All Leads · My Leads · Unassigned · Active Customers   (the view, from Sales' filter bar)

   Nothing here changes a quotation, an invoice, a payment, a verification, a closer or a
   commission. A Customer is a status staff set; it is never worked out from an invoice.
   Logging a call or a WhatsApp is a record of contact made - it books nothing and it is
   never a sale. Assigning an owner is a manager's (crm_assign) and every change is kept
   with who and why. Every button is drawn from what the server says this person may do,
   and every route checks again. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { newIdempotencyKey } from "@/lib/outbox";
import { fmtRM } from "@/lib/format";
import { L } from "@/components/portal/page-shared";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, TaskToolbar, type TableCol } from "@/components/portal/task-table";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { DrawerFoot, DrawerForm, SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { MetricStrip, type StripCell } from "@/components/ui/metric-strip";
import { AppIcon } from "@/components/ui/app-icon";
import { useFeedback } from "@/components/ui/feedback-modal";
import {
  btnSm, btnSmPrimary, btnSmQuiet, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, chipGold, fieldLabel, inputClass, selectClass, selectClassSm, textareaClass,
} from "@/lib/ui-styles";
import { ACTIVITY_WORD, LEAD_SOURCE_WORD, LEAD_STATUS_TONE, LEAD_STATUS_WORD, OWNER_EVENT_WORD, STATUS_NEEDS_REASON, serviceName, type LeadTone } from "@/lib/crm-words";
import { useOptionalPortal } from "@/components/portal/portal-provider";
import { LeadDeals } from "@/components/portal/sales-pipeline"; // v1.399.0 - a lead's deals and New deal
import css from "./crm-leads.module.css";

/** what Edit details hands to the existing customer form */
export interface LeadEdit { id: number; company: string; contact_person: string | null; phone: string | null; email: string | null; address?: string | null; website?: string | null }
export type LeadView = "all" | "mine" | "unassigned" | "active";
export interface CrmOptions {
  sources: string[]; statuses: string[]; activity_kinds: string[];
  packages: { id: number; name: string; status: string }[]; owners: { id: number; name: string }[];
  can_assign: boolean; can_write: boolean;
}
interface LeadRow {
  id: number; company: string; contact_person: string | null; phone: string | null; email: string | null;
  owner_id: number | null; owner_name: string | null; lead_source: string | null; relationship_status: string | null;
  interested_services: string[]; created_at: string; next_due: string | null; next_note: string | null; last_activity: string | null;
  /** v1.408.0 - the next action is the next follow-up or the next open task on the lead */
  next_kind: "followup" | "task" | null; task_id: number | null; task_title: string | null;
  quotations: number; invoices: number; no_owner: boolean; no_next: boolean; next_late: boolean;
}
interface LeadTask { id: number; title: string; due_on: string | null; status: string; stage: string | null; link_kind: string; assignee_name: string | null }
interface LeadList { rows: LeadRow[]; total: number; page: number; per: number; today: string }
interface Summary { leads: number; new_week: number; unassigned: number; no_next: number; followups_overdue: number; active_customers: number }
interface Detail {
  lead: LeadRow & { lead_source_detail: string | null; address: string | null; website: string | null; notes: string | null; crm_version: number; owner_name: string | null };
  activities: { id: number; kind: string; outcome: string | null; note: string | null; occurred_at: string; by_name: string | null }[];
  owner_events: { id: number; kind: string; reason: string | null; created_at: string; from_name: string | null; to_name: string | null; by_name: string | null }[];
  status_events: { id: number; from_status: string | null; to_status: string; reason: string | null; created_at: string; by_name: string | null }[];
  followups: { id: number; due_on: string; note: string; doc_id: number | null; owner_name: string | null }[];
  tasks: LeadTask[];
  docs: LeadDoc[];
}

/** v1.406.0 - a lead's quotation or invoice, with where it stands */
interface LeadDoc { id: number; doc_type: string; doc_number: string; total_cents: number; payment_status: string | null; created_at: string;
  valid_until?: string | null; voided_at?: string | null; accepted?: number; invoiced_as?: string | null; deal_id?: number | null }
const w = (pair: [string, string] | undefined, fallback: string) => (pair ? L(pair[0], pair[1]) : fallback);
const TONE_CHIP: Record<LeadTone, string> = { info: chipSmInfo, gold: chipGold, success: chipSmSuccess, neutral: chipSmNeutral, danger: chipSmDanger };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (iso: string | null) => { if (!iso) return ""; const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** a stored UTC time, shown in Malaysia */
const when = (ts: string | null) => {
  if (!ts) return "";
  const t = Date.parse(ts.replace(" ", "T") + (/[zZ]$/.test(ts) ? "" : "Z"));
  if (Number.isNaN(t)) return ts;
  const m = new Date(t + 8 * 3600 * 1000);
  return `${m.getUTCDate()} ${MON[m.getUTCMonth()]}, ${String(m.getUTCHours()).padStart(2, "0")}:${String(m.getUTCMinutes()).padStart(2, "0")}`;
};
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
const TOPICS = ["crm", "customers", "followups", "docs"];

export function StatusChip({ status }: { status: string | null }) {
  if (!status) return <span className={chipSmNeutral} data-testid="lead-status" data-status="none">{L("Status not set", "Status belum ditetapkan")}</span>;
  return <span className={TONE_CHIP[LEAD_STATUS_TONE[status] ?? "neutral"]} data-testid="lead-status" data-status={status}>{w(LEAD_STATUS_WORD[status], status)}</span>;
}

export function useCrmOptions() {
  return useCachedApi<CrmOptions>("/staff/crm/options", true, ["crm", "packages"]);
}

/* =====================================================================
   Leads & CRM: the figures, the list and the lead beside it
   ===================================================================== */
export function LeadsWorkspace({ view, onView, open, onOpen, onOpenFile, onQuote, onEdit, onFollowups, onOpenDeal, onOpenDoc, tabs }: {
  view: LeadView; onView: (v: LeadView) => void;
  /** the lead a bell, the Action Center or a search asked for */
  open: number | null; onOpen: (id: number | null) => void;
  onOpenFile: (customerId: number, company: string) => void;
  onQuote: (lead: { id: number; company: string; contact_person: string | null; phone: string | null; email: string | null; owner_id: number | null }) => void;
  onEdit: (lead: LeadEdit) => void;
  onFollowups: () => void;
  /** v1.399.0 - a deal in the lead's record opens in the Sales Pipeline */
  onOpenDeal?: (id: number) => void;
  /** v1.406.0 - a quotation or invoice in the lead's record opens in Quotations & Invoices */
  onOpenDoc?: (id: number) => void;
  /** the Leads & CRM sub-tab row - drawn UNDER the figure strip (the Payments order) */
  tabs?: ReactNode;
}) {
  const opts = useCrmOptions();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [flag, setFlag] = useState<"" | "no_next">("");
  const [sort, setSort] = useState<"next" | "recent" | "name">("next");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<number | null>(null);
  const [suggest, setSuggest] = useState(false);
  const key = `${view}|${q}|${status}|${source}|${flag}|${sort}`;
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) { setSeenKey(key); setPage(1); }
  const [asked, setAsked] = useState<number | null>(null);
  if (open !== asked) { setAsked(open); if (open != null && narrow()) setDrawer(open); }

  const qs = new URLSearchParams({ view, sort, page: String(page) });
  if (q.trim()) qs.set("q", q.trim());
  if (status) qs.set("status", status);
  if (source) qs.set("source", source);
  if (flag) qs.set("flag", flag);
  const list = useCachedApi<LeadList>(`/staff/crm/leads?${qs.toString()}`, true, TOPICS);
  const sum = useCachedApi<Summary>(`/staff/crm/summary?scope=${view === "mine" ? "mine" : "all"}`, true, TOPICS);
  const refresh = useCallback(() => { list.refresh(); sum.refresh(); }, [list, sum]);
  const s = sum.data;
  const o = opts.data;
  const pick = (id: number) => { onOpen(id); if (narrow()) setDrawer(id); };

  const cells: StripCell[] = [
    { key: "leads", icon: "target", tone: "info", label: view === "mine" ? L("My open leads", "Prospek terbuka saya") : L("Open leads", "Prospek terbuka"), value: s ? s.leads : "…", busy: !s,
      sub: L("New, contacted or qualified", "Baharu, dihubungi atau layak") },
    { key: "new", icon: "add", tone: "gold", label: L("New this week", "Baharu minggu ini"), value: s ? s.new_week : "…", busy: !s },
    { key: "unassigned", icon: "person", tone: "bad", label: L("Unassigned", "Tiada pemilik"), value: s ? s.unassigned : "…", busy: !s,
      onClick: () => { setFlag(""); onView("unassigned"); }, pressed: view === "unassigned" },
    { key: "no_next", icon: "time", tone: "gold", label: L("No next action", "Tiada tindakan seterusnya"), value: s ? s.no_next : "…", busy: !s,
      onClick: () => setFlag(flag === "no_next" ? "" : "no_next"), pressed: flag === "no_next" },
    { key: "overdue", icon: "alert", tone: "bad", label: L("Follow-ups overdue", "Susulan lewat"), value: s ? s.followups_overdue : "…", busy: !s, onClick: onFollowups },
    { key: "active", icon: "success", tone: "ok", label: L("Active customers", "Pelanggan aktif"), value: s ? s.active_customers : "…", busy: !s,
      onClick: () => onView("active"), pressed: view === "active" },
  ];
  const cols: TableCol<LeadRow>[] = [
    { key: "lead", label: L("Lead · contact", "Prospek · hubungan"), main: true, cell: (r) => <>
      <TaskRowTitle title={r.company} onOpen={() => pick(r.id)} late={r.next_late} />
      <TaskRowSub>{[r.contact_person, r.phone, r.lead_source ? w(LEAD_SOURCE_WORD[r.lead_source], r.lead_source) : null].filter(Boolean).join(" · ") || L("No contact yet", "Tiada hubungan lagi")}</TaskRowSub>
    </> },
    { key: "status", label: L("Status", "Status"), cell: (r) => <StatusChip status={r.relationship_status} /> },
    { key: "owner", label: L("Owner", "Pemilik"), cell: (r) => r.owner_name ?? <span className={chipSmWarn} data-testid="lead-no-owner">{L("Unassigned", "Tiada pemilik")}</span> },
    { key: "next", label: L("Next action", "Tindakan seterusnya"), cell: (r) => r.next_due
      ? <span className={css.nextCell} data-kind={r.next_kind ?? undefined}>
          <span className={r.next_late ? css.late : css.next} data-testid="lead-next">{r.next_kind === "task" ? L("Task · ", "Tugasan · ") : ""}{r.next_late ? L(`Overdue · ${dayOf(r.next_due)}`, `Lewat · ${dayOf(r.next_due)}`) : dayOf(r.next_due)}</span>
          {r.next_kind === "task" && r.next_note ? <small className={css.nextNote}>{r.next_note}</small> : null}
        </span>
      : r.task_id !== null ? <span className={css.nextCell} data-kind="task">
          <span className={css.next} data-testid="lead-next">{L("Task · no due date", "Tugasan · tiada tarikh")}</span>
          {r.task_title ? <small className={css.nextNote}>{r.task_title}</small> : null}
        </span>
      : r.no_next ? <span className={chipSmWarn} data-testid="lead-no-next">{L("No next action", "Tiada tindakan")}</span> : <span className={css.muted}>—</span> },
  ];
  const empty = (
    <p className={css.empty} data-testid="leads-empty"><AppIcon name="search" />
      {q || status || source || flag ? L("No lead matches these filters.", "Tiada prospek sepadan dengan penapis ini.")
        : view === "mine" ? L("No lead is yours yet. A manager assigns leads, or a converted enquiry brings its owner.", "Belum ada prospek milik anda. Pengurus menetapkan prospek, atau pertanyaan yang ditukar membawa pemiliknya.")
          : view === "unassigned" ? L("Every open lead has an owner.", "Setiap prospek terbuka mempunyai pemilik.") : L("No leads yet.", "Belum ada prospek.")}
    </p>
  );
  const views: [LeadView, string][] = [["all", L("All Leads", "Semua Prospek")], ["mine", L("My Leads", "Prospek Saya")], ["unassigned", L("Unassigned", "Tiada Pemilik")], ["active", L("Active Customers", "Pelanggan Aktif")]];
  const title = views.find(([k]) => k === view)?.[1] ?? "";
  const data = list.data;

  if ((list.failed && !data) || (opts.failed && !o)) return <>{tabs}<p className={css.warn} role="alert" data-testid="leads-failed"><AppIcon name="warning" />{L("Leads could not be loaded. If the database update has not run yet, run PUSH.bat.", "Prospek tidak dapat dimuatkan. Jika kemas kini pangkalan data belum dijalankan, jalankan PUSH.bat.")}</p></>;
  return (
    <div className="erp-stack-tight" data-testid="crm-leads">
      {/* 21-11-2026 (the CEO: "strip KPI card above while sub tabs at downside", the Payments page as the reference) - the
     view's figure strip first, then the Leads & CRM sub-tab row, then the work */}
      <MetricStrip cells={cells} label={L("Leads at a glance", "Prospek sepintas lalu")} testid="crm-strip" />
      {tabs}
      <WorkspaceSplit testid="crm-split" ratio="60-40">
        <SplitPane testid="crm-list" title={title} label={L("Leads", "Prospek")}
          actions={<span className={chipSmNeutral} data-testid="crm-count">{data ? L(`${data.total} lead${data.total === 1 ? "" : "s"}`, `${data.total} prospek`) : "…"}</span>}
          toolbar={<TaskToolbar q={q} onQ={setQ} placeholder={L("Search company, contact, phone or email…", "Cari syarikat, hubungan, telefon atau e-mel…")} testid="crm-toolbar"
            aside={o?.can_assign && view === "unassigned" ? <button type="button" className={btnSm} onClick={() => setSuggest(true)} data-testid="crm-suggest-open"><AppIcon name="person" />{L("Suggested owners", "Pemilik dicadangkan")}</button> : undefined}>
            <select className={selectClassSm} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={L("Status", "Status")} data-testid="crm-status-filter">
              <option value="">{L("Any status", "Semua status")}</option>
              <option value="none">{L("Status not set", "Status belum ditetapkan")}</option>
              {(o?.statuses ?? []).map((k) => <option key={k} value={k}>{w(LEAD_STATUS_WORD[k], k)}</option>)}
            </select>
            <select className={selectClassSm} value={source} onChange={(e) => setSource(e.target.value)} aria-label={L("Source", "Sumber")} data-testid="crm-source-filter">
              <option value="">{L("Any source", "Semua sumber")}</option>
              {(o?.sources ?? []).map((k) => <option key={k} value={k}>{w(LEAD_SOURCE_WORD[k], k)}</option>)}
            </select>
            <select className={selectClassSm} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={L("Sort", "Susun")} data-testid="crm-sort">
              <option value="next">{L("Next action first", "Tindakan seterusnya dahulu")}</option>
              <option value="recent">{L("Newest first", "Terbaharu dahulu")}</option>
              <option value="name">{L("Name A-Z", "Nama A-Z")}</option>
            </select>
          </TaskToolbar>}
          foot={data && data.total > data.per ? <PaginationControls page={data.page} total={data.total} size={data.per} onPage={setPage} label={L("Lead pages", "Halaman prospek")} testid="crm-pages" /> : undefined}>
          <CompactTaskTable rows={data?.rows ?? []} cols={cols} label={L("Leads", "Prospek")} loading={!data} record="lead" testid="crm-table" fill
            onOpen={pick} picked={open} rowClass={(r) => (r.next_late ? css.lateRow ?? "" : "")} empty={empty} />
        </SplitPane>
        {open != null ? (
          <SplitPane testid="crm-preview" title={L("Selected lead", "Prospek dipilih")} label={L("Selected lead", "Prospek dipilih")}
            actions={<button type="button" className={btnSmQuiet} aria-label={L("Close", "Tutup")} onClick={() => onOpen(null)} data-testid="crm-preview-close"><AppIcon name="close" /></button>}>
            <LeadRecord id={open} opts={o} onChanged={refresh} onOpenFile={onOpenFile} onQuote={onQuote} onEdit={onEdit} onOpenDeal={onOpenDeal} onOpenDoc={onOpenDoc} />
          </SplitPane>
        ) : (
          <SplitPane testid="crm-help" title={L("Every open lead needs an owner and a next action", "Setiap prospek terbuka perlukan pemilik dan tindakan seterusnya")} label={L("How leads are worked", "Cara prospek diurus")}
            sub={L("Choose a lead to see it here.", "Pilih prospek untuk melihatnya di sini.")}>
            <ul className={css.rules} data-testid="crm-rules">
              <li><span className={chipSmWarn}>{L("Unassigned", "Tiada pemilik")}</span>{L("a manager gives it an owner", "pengurus menetapkan pemilik")}</li>
              <li><span className={chipSmWarn}>{L("No next action", "Tiada tindakan")}</span>{L("book the next follow-up from the customer file", "tetapkan susulan seterusnya dari fail pelanggan")}</li>
              <li><span className={chipSmSuccess}>{L("Customer", "Pelanggan")}</span>{L("a status you set; an invoice never sets it", "status yang anda tetapkan; invois tidak menetapkannya")}</li>
              <li><span className={chipSmNeutral}>{L("Contact logged", "Hubungan direkod")}</span>{L("a record of what happened - never a sale", "rekod apa yang berlaku - bukan jualan")}</li>
            </ul>
          </SplitPane>
        )}
      </WorkspaceSplit>
      {drawer != null && (
        <SideDrawer open onClose={() => setDrawer(null)} title={L("Lead", "Prospek")} full>
          <LeadRecord id={drawer} opts={o} onChanged={refresh} onOpenFile={onOpenFile} onQuote={onQuote} onEdit={onEdit} onOpenDeal={onOpenDeal ? (d) => { setDrawer(null); onOpenDeal(d); } : undefined} onOpenDoc={onOpenDoc ? (d) => { setDrawer(null); onOpenDoc(d); } : undefined} />
        </SideDrawer>
      )}
      {suggest && o?.can_assign && <SuggestedOwners onClose={() => setSuggest(false)} onDone={refresh} />}
    </div>
  );
}

/* =====================================================================
   One lead
   ===================================================================== */
type Form = "" | "activity" | "status" | "profile" | "assign";

function LeadRecord({ id, opts, onChanged, onOpenFile, onQuote, onEdit, onOpenDeal, onOpenDoc }: {
  id: number; opts: CrmOptions | null; onChanged: () => void;
  onOpenFile: (customerId: number, company: string) => void;
  onQuote: (lead: { id: number; company: string; contact_person: string | null; phone: string | null; email: string | null; owner_id: number | null }) => void;
  onEdit: (lead: LeadEdit) => void;
  onOpenDeal?: (id: number) => void;
  onOpenDoc?: (id: number) => void;
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
    void api<Detail & { error?: { message?: string } }>(`/staff/crm/leads/${id}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data?.lead) { setD(r.data); setProblem(""); } else setProblem(r.data?.error?.message ?? L("The lead could not be opened.", "Prospek tidak dapat dibuka."));
    });
    return () => c.abort();
  }, [id, tick]);

  /** one write; the server's answer is what the person is told */
  const send = async (path: string, method: "POST" | "PUT", body: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/crm/leads/${id}${path}`, { method, body: JSON.stringify(body) });
    setBusy(false);
    setTick((t) => t + 1);
    if (!r.ok) {
      fb.show({ variant: "error", title: L("Not saved", "Tidak disimpan"), description: r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") });
      return false;
    }
    fb.show({ variant: "success", title: done, description: d?.lead.company });
    setForm("");
    onChanged();
    return true;
  };

  if (problem && !d) return <p className={css.warn} role="alert" data-testid="lead-problem"><AppIcon name="warning" />{problem}</p>;
  if (!d) return <SkelRows rows={6} />;
  const l = d.lead;
  const pk = opts?.packages ?? [];
  const canWrite = opts?.can_write ?? false;
  const open = l.relationship_status === null || ["new_lead", "contacted", "qualified"].includes(l.relationship_status);
  const next = d.followups[0] ?? null;
  /* v1.408.0 - an open task on the lead is a next action too; the earlier of the two is shown */
  const task = d.tasks[0] ?? null;
  const taskFirst = task !== null && (next === null || (task.due_on !== null && task.due_on < next.due_on));
  return (
    <div className={css.record} data-testid="lead-record" data-lead={l.id}>
      {fb.node}
      <div className={css.head}>
        <span className={css.avatar} aria-hidden><AppIcon name="store" /></span>
        <div className={css.headText}>
          <strong>{l.company}</strong>
          <span>{[l.contact_person, l.phone, l.email].filter(Boolean).join(" · ") || L("No contact details yet", "Tiada butiran hubungan lagi")}</span>
        </div>
        <StatusChip status={l.relationship_status} />
      </div>

      <dl className={css.dl} data-testid="lead-facts">
        <dt>{L("Owner", "Pemilik")}</dt>
        <dd>{l.owner_name ?? <span className={chipSmWarn}>{L("Unassigned", "Tiada pemilik")}</span>}</dd>
        <dt>{L("Next action", "Tindakan seterusnya")}</dt>
        <dd data-testid="lead-next-action">{taskFirst && task ? <>{L("Task", "Tugasan")} · {task.due_on ? dayOf(task.due_on) : L("no due date", "tiada tarikh")} · {task.title}</>
          : next ? <>{dayOf(next.due_on)} · {next.note}</> : open ? <span className={chipSmWarn}>{L("No next action", "Tiada tindakan seterusnya")}</span> : "—"}</dd>
        <dt>{L("Source", "Sumber")}</dt>
        <dd>{l.lead_source ? w(LEAD_SOURCE_WORD[l.lead_source], l.lead_source) : "—"}{l.lead_source_detail ? ` · ${l.lead_source_detail}` : ""}</dd>
        <dt>{L("Interested in", "Berminat dengan")}</dt>
        <dd>{l.interested_services.length ? <span className={css.chips}>{l.interested_services.map((k) => <span key={k} className={chipSmNeutral}>{serviceName(k, pk)}</span>)}</span> : "—"}</dd>
      </dl>

      <section className={css.actions} aria-label={L("Actions", "Tindakan")} data-testid="lead-actions">
        {canWrite && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => setForm("activity")} data-testid="lead-log"><AppIcon name="chat" />{L("Log contact", "Rekod hubungan")}</button>}
        <button type="button" className={btnSm} onClick={() => onOpenFile(l.id, l.company)} data-testid="lead-file"><AppIcon name="time" />{L("Book follow-up", "Tetapkan susulan")}</button>
        {canWrite && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm("status")} data-testid="lead-status-btn">{L("Change status", "Tukar status")}</button>}
        {canWrite && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm("profile")} data-testid="lead-profile-btn">{L("Source & services", "Sumber & perkhidmatan")}</button>}
        {opts?.can_assign && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm("assign")} data-testid="lead-assign-btn"><AppIcon name="person" />{l.owner_id ? L("Reassign", "Tukar pemilik") : L("Assign", "Tetapkan pemilik")}</button>}
        {canWrite && <button type="button" className={btnSmQuiet} onClick={() => onQuote(l)} data-testid="lead-quote"><AppIcon name="add" />{L("Create quotation", "Buat sebut harga")}</button>}
        {canWrite && <button type="button" className={btnSmQuiet} onClick={() => onEdit(l)} data-testid="lead-edit">{L("Edit details", "Sunting butiran")}</button>}
      </section>

      {/* v1.406.0 (the CEO: "all this have their own Quotation and Invoice, link it!") - the lead's own quotations and
          invoices, each with where it stands, each opening the document; the deal it belongs to, if any */}
      <LeadDocs docs={d.docs} onOpenDoc={onOpenDoc} onOpenDeal={onOpenDeal} />
      {/* v1.408.0 - the open tasks on this lead (its own, its quotations', its projects', its enquiries'); each opens in Tasks,
          which decides what the reader may see */}
      <LeadTasks tasks={d.tasks} />
      <Section title={L("Contact log", "Log hubungan")} testid="lead-activities">
        {d.activities.length === 0 ? <p className={css.muted}>{L("Nothing logged yet. Log a call, WhatsApp, email or meeting after it happens.", "Belum ada rekod. Rekod panggilan, WhatsApp, e-mel atau mesyuarat selepas ia berlaku.")}</p> : (
          <ol className={css.timeline}>
            {d.activities.map((a) => (
              <li key={a.id} data-testid="lead-activity" data-kind={a.kind}>
                <span className={css.tlHead}><strong>{w(ACTIVITY_WORD[a.kind], a.kind)}</strong>{a.outcome ? ` · ${a.outcome.replace(/_/g, " ")}` : ""} · {when(a.occurred_at)}{a.by_name ? ` · ${a.by_name}` : ""}</span>
                {a.note && <span className={css.tlBody}>{a.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </Section>
      {onOpenDeal && <LeadDeals customer={{ id: l.id, company: l.company, owner_id: l.owner_id }} onOpenDeal={onOpenDeal} />}
      <Section title={L("Ownership and status history", "Sejarah pemilikan dan status")} testid="lead-history">
        {d.owner_events.length + d.status_events.length === 0 ? <p className={css.muted}>{L("No changes recorded yet.", "Belum ada perubahan direkod.")}</p> : (
          <ol className={css.timeline}>
            {[...d.owner_events.map((e) => ({ k: `o${e.id}`, at: e.created_at, head: `${w(OWNER_EVENT_WORD[e.kind], e.kind)}: ${e.from_name ?? "—"} → ${e.to_name ?? "—"}`, by: e.by_name, reason: e.reason })),
              ...d.status_events.map((e) => ({ k: `s${e.id}`, at: e.created_at, head: `${L("Status", "Status")}: ${e.from_status ? w(LEAD_STATUS_WORD[e.from_status], e.from_status) : "—"} → ${w(LEAD_STATUS_WORD[e.to_status], e.to_status)}`, by: e.by_name, reason: e.reason }))]
              .sort((a, b) => b.at.localeCompare(a.at)).map((e) => (
                <li key={e.k} data-testid="lead-event"><span className={css.tlHead}><strong>{e.head}</strong> · {when(e.at)}{e.by ? ` · ${e.by}` : ""}</span>{e.reason && <span className={css.tlBody}>{e.reason}</span>}</li>
              ))}
          </ol>
        )}
      </Section>

      {form === "activity" && <ActivityForm busy={busy} onClose={() => setForm("")} onSave={(b) => send("/activities", "POST", b, L("Contact logged", "Hubungan direkod"))} />}
      {form === "status" && <StatusForm busy={busy} current={l.relationship_status} statuses={opts?.statuses ?? []} onClose={() => setForm("")}
        onSave={(b) => send("/status", "POST", { ...b, version: l.crm_version }, L("Status changed", "Status ditukar"))} />}
      {form === "profile" && <ProfileForm busy={busy} lead={l} opts={opts} onClose={() => setForm("")}
        onSave={(b) => send("/profile", "PUT", { ...b, version: l.crm_version }, L("Source and services saved", "Sumber dan perkhidmatan disimpan"))} />}
      {form === "assign" && opts?.can_assign && <AssignForm busy={busy} current={l.owner_id} owners={opts.owners} onClose={() => setForm("")}
        onSave={(b) => send("/assign", "POST", { ...b, version: l.crm_version }, L("Owner saved", "Pemilik disimpan"))} />}
    </div>
  );
}

const TASK_LINK_WORD: Record<string, [string, string]> = {
  customer: ["Customer", "Pelanggan"], quotation: ["Quotation", "Sebut harga"], project: ["Project", "Projek"], enquiry: ["Enquiry", "Pertanyaan"],
};
const TASK_STAGE_WORD: Record<string, [string, string]> = {
  waiting_client: ["Waiting for client", "Menunggu pelanggan"], blocked: ["Blocked", "Tersekat"], review: ["Ready for review", "Sedia untuk semakan"],
};
function LeadTasks({ tasks }: { tasks: LeadTask[] }) {
  const portal = useOptionalPortal();
  return (
    <Section title={L(`Open tasks (${tasks.length})`, `Tugasan terbuka (${tasks.length})`)} testid="lead-tasks">
      {tasks.length === 0 ? <p className={css.muted}>{L("No open task on this lead.", "Tiada tugasan terbuka untuk prospek ini.")}</p> : (
        <ul className={css.leadDocs}>
          {tasks.map((t) => {
            const link = TASK_LINK_WORD[t.link_kind];
            const stage = t.stage ? TASK_STAGE_WORD[t.stage] : undefined;
            return (
              <li key={t.id} data-testid="lead-task" data-task={t.id}>
                <span className={css.docMain}>
                  {portal ? <button type="button" className={css.docLink} onClick={() => portal.openRecord("Tasks", "task", t.id)} data-testid="lead-task-open">{t.title}</button> : <strong>{t.title}</strong>}
                  <small className={css.muted}>{[link ? L(link[0], link[1]) : null, t.assignee_name, t.due_on ? dayOf(t.due_on) : L("No due date", "Tiada tarikh")].filter(Boolean).join(" · ")}</small>
                </span>
                <span className={chipSmNeutral}>{stage ? L(stage[0], stage[1]) : t.status === "in_progress" ? L("In progress", "Sedang berjalan") : L("Open", "Terbuka")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Section({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  return <section className={css.section} aria-label={title} data-testid={testid}><h3 className={css.h3}>{title}</h3>{children}</section>;
}

/* ---------------- the forms, each in the shared drawer ---------------- */
function FormDrawer({ title, icon, onClose, children, foot }: { title: string; icon: "chat" | "target" | "person" | "edit"; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  return (
    <SideDrawer open onClose={onClose} title={title} form icon={icon} dirty="auto">
      <DrawerForm>{children}</DrawerForm>
      <DrawerFoot>{foot}</DrawerFoot>
    </SideDrawer>
  );
}

function ActivityForm({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [kind, setKind] = useState("call");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  /* one key per opening of the form: a double press or a lost reply is the same record */
  const [ck] = useState(() => newIdempotencyKey().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64));
  const ok = note.trim().length >= 3;
  return (
    <FormDrawer title={L("Log contact", "Rekod hubungan")} icon="chat" onClose={onClose}
      foot={<><button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || !ok} onClick={() => void onSave({ kind, outcome: outcome.trim() || null, note: note.trim(), client_key: ck })} data-testid="activity-save">{L("Save contact", "Simpan hubungan")}</button></>}>
      <p className={css.muted}>{L("Log it after it happened. Logging books nothing next - book the next follow-up from the customer file.", "Rekod selepas ia berlaku. Rekod tidak menetapkan apa-apa seterusnya - tetapkan susulan seterusnya dari fail pelanggan.")}</p>
      <label className={fieldLabel}>{L("What kind", "Jenis")}
        <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="activity-kind">
          {["call", "whatsapp", "email", "meeting", "note", "proposal"].map((k) => <option key={k} value={k}>{w(ACTIVITY_WORD[k], k)}</option>)}
        </select>
      </label>
      <label className={fieldLabel}>{L("Outcome (optional)", "Hasil (pilihan)")}
        <input className={inputClass} value={outcome} maxLength={120} onChange={(e) => setOutcome(e.target.value)} placeholder={L("e.g. interested, call back Friday", "cth. berminat, telefon semula Jumaat")} data-testid="activity-outcome" />
      </label>
      <label className={fieldLabel}>{L("What happened", "Apa yang berlaku")}
        <textarea className={textareaClass} rows={4} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} data-testid="activity-note" />
      </label>
    </FormDrawer>
  );
}

function StatusForm({ busy, current, statuses, onClose, onSave }: { busy: boolean; current: string | null; statuses: string[]; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [to, setTo] = useState(statuses.find((s) => s !== current) ?? "contacted");
  const [reason, setReason] = useState("");
  const needs = STATUS_NEEDS_REASON.has(to);
  const ok = to !== current && (!needs || reason.trim().length >= 10);
  return (
    <FormDrawer title={L("Change status", "Tukar status")} icon="target" onClose={onClose}
      foot={<><button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || !ok} onClick={() => void onSave({ to, reason: reason.trim() || null })} data-testid="status-save">{L("Save status", "Simpan status")}</button></>}>
      <p className={css.muted}>{L("The relationship status is yours to set. It never changes a quotation, an invoice or a payment, and an invoice never sets it.", "Status hubungan ditetapkan oleh anda. Ia tidak mengubah sebut harga, invois atau bayaran, dan invois tidak menetapkannya.")}</p>
      <fieldset className={css.radios} data-testid="status-options">
        <legend className={css.h3}>{L("New status", "Status baharu")}</legend>
        {statuses.map((s) => (
          <label key={s} className={css.radio}><input type="radio" name="lead-status" checked={to === s} disabled={s === current} onChange={() => setTo(s)} data-testid={`status-${s}`} />{w(LEAD_STATUS_WORD[s], s)}{s === current ? L(" (now)", " (sekarang)") : ""}</label>
        ))}
      </fieldset>
      <label className={fieldLabel}>{needs ? L("Why (required)", "Mengapa (wajib)") : L("Note (optional)", "Nota (pilihan)")}
        <textarea className={textareaClass} rows={3} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="status-reason" />
      </label>
    </FormDrawer>
  );
}

function ProfileForm({ busy, lead, opts, onClose, onSave }: {
  busy: boolean; lead: Detail["lead"]; opts: CrmOptions | null; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [source, setSource] = useState(lead.lead_source ?? "");
  const [detail, setDetail] = useState(lead.lead_source_detail ?? "");
  const [svc, setSvc] = useState<string[]>(lead.interested_services.filter((k) => k.startsWith("pkg:")));
  const [other, setOther] = useState(lead.interested_services.find((k) => k.startsWith("other:"))?.slice(6) ?? "");
  const pk = (opts?.packages ?? []).filter((p) => p.status === "active" || svc.includes(`pkg:${p.id}`));
  const toggle = (k: string) => setSvc((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));
  return (
    <FormDrawer title={L("Source & services", "Sumber & perkhidmatan")} icon="edit" onClose={onClose}
      foot={<><button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy} data-testid="profile-save"
          onClick={() => void onSave({ lead_source: source || null, lead_source_detail: detail.trim() || null, interested_services: [...svc, ...(other.trim().length >= 2 ? [`other:${other.trim()}`] : [])] })}>{L("Save", "Simpan")}</button></>}>
      <label className={fieldLabel}>{L("Where the lead came from", "Dari mana prospek datang")}
        <select className={selectClass} value={source} onChange={(e) => setSource(e.target.value)} data-testid="profile-source">
          <option value="">{L("Not known", "Tidak diketahui")}</option>
          {(opts?.sources ?? []).map((k) => <option key={k} value={k}>{w(LEAD_SOURCE_WORD[k], k)}</option>)}
        </select>
      </label>
      <label className={fieldLabel}>{L("Source details (optional)", "Butiran sumber (pilihan)")}
        <input className={inputClass} value={detail} maxLength={200} onChange={(e) => setDetail(e.target.value)} placeholder={L("e.g. the campaign, who referred them", "cth. kempen, siapa yang merujuk")} data-testid="profile-detail" />
      </label>
      <fieldset className={css.radios} data-testid="profile-services">
        <legend className={css.h3}>{L("Interested in (from the Packages library - names only, never a price)", "Berminat dengan (dari pustaka Pakej - nama sahaja, tiada harga)")}</legend>
        {pk.length === 0 && <p className={css.muted}>{L("No active packages in the library yet.", "Belum ada pakej aktif dalam pustaka.")}</p>}
        {pk.map((p) => <label key={p.id} className={css.radio}><input type="checkbox" checked={svc.includes(`pkg:${p.id}`)} onChange={() => toggle(`pkg:${p.id}`)} data-testid={`profile-pkg-${p.id}`} />{p.name}</label>)}
      </fieldset>
      <label className={fieldLabel}>{L("Other service (optional)", "Perkhidmatan lain (pilihan)")}
        <input className={inputClass} value={other} maxLength={60} onChange={(e) => setOther(e.target.value)} data-testid="profile-other" />
      </label>
    </FormDrawer>
  );
}

function AssignForm({ busy, current, owners, onClose, onSave }: {
  busy: boolean; current: number | null; owners: { id: number; name: string }[]; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [to, setTo] = useState<number | "">("");
  const [none, setNone] = useState(false);
  const [reason, setReason] = useState("");
  const needsReason = current !== null;
  const ok = (none ? current !== null : to !== "" && to !== current) && (!needsReason || reason.trim().length >= 5);
  return (
    <FormDrawer title={current ? L("Reassign the lead", "Tukar pemilik prospek") : L("Assign the lead", "Tetapkan pemilik prospek")} icon="person" onClose={onClose}
      foot={<><button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || !ok} onClick={() => void onSave({ owner_id: none ? null : to, reason: reason.trim() || null })} data-testid="assign-save">{L("Save owner", "Simpan pemilik")}</button></>}>
      <p className={css.muted}>{L("The new owner is told. Every change is kept with who made it and why.", "Pemilik baharu dimaklumkan. Setiap perubahan disimpan bersama siapa membuatnya dan sebabnya.")}</p>
      <label className={fieldLabel}>{L("Owner", "Pemilik")}
        <select className={selectClass} value={to} disabled={none} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : "")} data-testid="assign-to">
          <option value="">{L("Choose…", "Pilih…")}</option>
          {owners.filter((o) => o.id !== current).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      {current !== null && <label className={css.radio}><input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} data-testid="assign-none" />{L("Remove the owner (back to Unassigned)", "Buang pemilik (kembali ke Tiada Pemilik)")}</label>}
      <label className={fieldLabel}>{needsReason ? L("Why (required)", "Mengapa (wajib)") : L("Note (optional)", "Nota (pilihan)")}
        <textarea className={textareaClass} rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="assign-reason" />
      </label>
    </FormDrawer>
  );
}

/* ---------------- suggested owners: decision 1 (b) ---------------- */
interface Suggestion { customer_id: number; company: string; owner_id: number; owner_name: string; doc_number: string; doc_type: string; doc_at: string }
function SuggestedOwners({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fb = useFeedback();
  const st = useCachedApi<{ rows: Suggestion[] }>("/staff/crm/suggestions", true, ["crm"]);
  const rows = useMemo(() => st.data?.rows ?? [], [st.data]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const all = rows.length > 0 && rows.every((r) => picked.has(r.customer_id));
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const confirm = async () => {
    const items = rows.filter((r) => picked.has(r.customer_id)).slice(0, 100).map((r) => ({ customer_id: r.customer_id, owner_id: r.owner_id }));
    setBusy(true);
    const r = await api<{ applied?: number; skipped?: number[]; error?: { message?: string } }>("/staff/crm/suggestions/confirm", { method: "POST", body: JSON.stringify({ items, reason: reason.trim() }) });
    setBusy(false);
    if (!r.ok) { fb.show({ variant: "error", title: L("Not saved", "Tidak disimpan"), description: r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") }); return; }
    fb.show({ variant: "success", title: L(`${r.data?.applied ?? 0} owner(s) confirmed`, `${r.data?.applied ?? 0} pemilik disahkan`),
      description: r.data?.skipped?.length ? L(`${r.data.skipped.length} changed meanwhile and were left alone.`, `${r.data.skipped.length} berubah dan tidak disentuh.`) : undefined });
    setPicked(new Set()); st.refresh(); onDone();
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Suggested owners", "Pemilik dicadangkan")} form icon="person" wide>
      {fb.node}
      <DrawerForm>
        <p className={css.muted}>{L("Each suggestion is the salesperson on the customer's latest quotation or invoice. Nothing is set until you tick it and confirm; every confirmed owner is recorded with your reason.", "Setiap cadangan ialah jurujual pada sebut harga atau invois terkini pelanggan. Tiada apa ditetapkan sehingga anda tandakan dan sahkan; setiap pemilik yang disahkan direkod bersama sebab anda.")}</p>
        {!st.data ? <SkelRows rows={5} /> : rows.length === 0 ? <p className={css.empty} data-testid="suggest-empty"><AppIcon name="success" />{L("No suggestion left: every unowned customer either has no salesperson on a document or is already owned.", "Tiada cadangan lagi: setiap pelanggan tanpa pemilik sama ada tiada jurujual pada dokumen atau sudah dimiliki.")}</p> : (<>
          <label className={css.radio}><input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.slice(0, 100).map((r) => r.customer_id)))} data-testid="suggest-all" />{L(`Tick all (up to 100 at a time) - ${rows.length} suggested`, `Tanda semua (sehingga 100 sekali) - ${rows.length} dicadangkan`)}</label>
          <ul className={css.suggest} data-testid="suggest-list">
            {rows.map((r) => (
              <li key={r.customer_id}><label className={css.radio}><input type="checkbox" checked={picked.has(r.customer_id)} onChange={() => toggle(r.customer_id)} data-testid="suggest-row" />
                <span><strong>{r.company}</strong> → {r.owner_name}<small className={css.muted}> · {r.doc_number}, {dayOf(r.doc_at)}</small></span></label></li>
            ))}
          </ul>
          <label className={fieldLabel}>{L("Why (required)", "Mengapa (wajib)")}
            <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={L("e.g. owners for the CRM start", "cth. pemilik untuk permulaan CRM")} data-testid="suggest-reason" />
          </label>
        </>)}
      </DrawerForm>
      <DrawerFoot>
        <button type="button" className={btnSmQuiet} onClick={onClose}>{L("Close", "Tutup")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || picked.size === 0 || reason.trim().length < 5} onClick={() => void confirm()} data-testid="suggest-confirm">
          {L(`Confirm ${picked.size} owner(s)`, `Sahkan ${picked.size} pemilik`)}
        </button>
      </DrawerFoot>
    </SideDrawer>
  );
}

/* =====================================================================
   Convert an enquiry or Growth Check entry to a lead (decision 3: the duplicate check first)
   ===================================================================== */
interface Candidate { id: number; company: string; phone: string | null; email: string | null }
export function ConvertToLead({ source, id, onOpenLead, testid }: { source: "enquiry" | "growth"; id: number; onOpenLead: (customerId: number) => void; testid?: string }) {
  const fb = useFeedback();
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const go = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await api<{ customer_id?: number; existing?: boolean; linked?: boolean; created?: boolean; candidates?: Candidate[]; error?: { code?: string; message?: string } }>(
      "/staff/crm/convert", { method: "POST", body: JSON.stringify({ source, id, ...extra }) });
    setBusy(false);
    if (r.status === 409 && r.data?.error?.code === "possible_duplicate") { setCands(r.data.candidates ?? []); return; }
    if (!r.ok || !r.data?.customer_id) { fb.show({ variant: "error", title: L("Not converted", "Tidak ditukar"), description: r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") }); return; }
    setCands(null);
    fb.show({ variant: "success", title: r.data.existing ? L("Already a lead", "Sudah menjadi prospek") : r.data.linked ? L("Linked to the customer", "Dipautkan kepada pelanggan") : L("Lead created", "Prospek dibuat") });
    onOpenLead(r.data.customer_id);
  };
  return (
    <>
      {fb.node}
      <button type="button" className={btnSm} disabled={busy} onClick={() => void go()} data-testid={testid ?? "convert-lead"}><AppIcon name="person" />{L("Convert to lead", "Tukar kepada prospek")}</button>
      {cands && (
        <SideDrawer open onClose={() => setCands(null)} title={L("Already on file?", "Sudah ada dalam rekod?")} form icon="person">
          <DrawerForm>
            <p className={css.muted}>{L("These customers share the name, phone or email. Link the entry to one of them, or make a new customer if it really is someone else.", "Pelanggan ini berkongsi nama, telefon atau e-mel. Pautkan kepada salah satu, atau buat pelanggan baharu jika ia benar-benar orang lain.")}</p>
            <ul className={css.suggest} data-testid="convert-candidates">
              {cands.map((c) => (
                <li key={c.id} className={css.candRow}><span><strong>{c.company}</strong><small className={css.muted}> {[c.phone, c.email].filter(Boolean).join(" · ")}</small></span>
                  <button type="button" className={btnSm} disabled={busy} onClick={() => void go({ customer_id: c.id })} data-testid="convert-link">{L("Link to this one", "Pautkan kepada ini")}</button></li>
              ))}
            </ul>
          </DrawerForm>
          <DrawerFoot>
            <button type="button" className={btnSmQuiet} onClick={() => setCands(null)}>{L("Cancel", "Batal")}</button>
            <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void go({ confirm_duplicate: true })} data-testid="convert-new">{L("Make a new customer", "Buat pelanggan baharu")}</button>
          </DrawerFoot>
        </SideDrawer>
      )}
    </>
  );
}

/* v1.406.0 - a lead's quotations and invoices: what each one is, where it stands, and the deal it is on */
function docState(x: LeadDoc): [string, string] {
  if (x.voided_at || x.payment_status === "void") return [chipSmNeutral, L("Void", "Batal")];
  if (x.doc_type === "INV") return x.payment_status === "paid" ? [chipSmSuccess, L("Paid", "Dibayar")] : x.payment_status === "overdue" ? [chipSmDanger, L("Overdue", "Lewat bayar")] : [chipSmWarn, L("Unpaid", "Belum dibayar")];
  if (x.invoiced_as) return [chipSmSuccess, L(`Invoiced as ${x.invoiced_as}`, `Diinvois sebagai ${x.invoiced_as}`)];
  if (x.accepted) return [chipSmSuccess, L("Accepted", "Diterima")];
  if (x.valid_until && x.valid_until < new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)) return [chipSmNeutral, L("Expired", "Tamat tempoh")];
  return [chipSmInfo, L("Open", "Terbuka")];
}
function LeadDocs({ docs, onOpenDoc, onOpenDeal }: { docs: LeadDoc[]; onOpenDoc?: (id: number) => void; onOpenDeal?: (id: number) => void }) {
  const qt = docs.filter((x) => x.doc_type === "QT").length, inv = docs.length - qt;
  return (
    <Section title={L(`Quotations & invoices (${qt} · ${inv})`, `Sebut harga & invois (${qt} · ${inv})`)} testid="lead-docs">
      {docs.length === 0 ? <p className={css.muted}>{L("No quotation or invoice yet.", "Belum ada sebut harga atau invois.")}</p> : (
        <ul className={css.leadDocs}>
          {docs.map((x) => {
            const [tone, word] = docState(x);
            return (
              <li key={x.id} data-testid="lead-doc" data-doc={x.id} data-type={x.doc_type}>
                <span className={css.docMain}>
                  {onOpenDoc ? <button type="button" className={css.docLink} onClick={() => onOpenDoc(x.id)} data-testid="lead-doc-open">{x.doc_number}</button> : <strong>{x.doc_number}</strong>}
                  <small className={css.muted}>{x.doc_type === "QT" ? L("Quotation", "Sebut harga") : L("Invoice", "Invois")} · {dayOf(x.created_at)}</small>
                </span>
                <span className={css.docAmt}>{fmtRM(x.total_cents)}</span>
                <span className={tone}>{word}</span>
                {x.deal_id && onOpenDeal ? <button type="button" className={css.docLink} onClick={() => onOpenDeal(x.deal_id!)} data-testid="lead-doc-deal">{L("Deal", "Urusan")}</button> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
