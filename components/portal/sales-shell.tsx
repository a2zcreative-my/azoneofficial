"use client";

/* v1.292.0 - SALES WORKSPACE 4.0 (the CEO's "approve", 12-11-2026;
   claude/SALES-WORKSPACE-4.0-BLUEPRINT.md, decisions S1-S7 as recommended).

   THE SHARED PRESENTATION LAYER of the six Sales views. Nothing here asks the
   server for anything new and nothing here writes: every piece is handed the
   records Sales already holds (documents, follow-ups, the Payments queue's
   figures, the week engine's open quotations, the enquiries) and the handler
   that opens each ORIGINAL record. There is no second task list, no second
   follow-up, no second payment or commission rule.

     MetricStrip     one slim row of figures (Overview, Closed Sales)
     SalesWorklist   the Overview's one list: what needs someone, each row the
                     record itself with its one next action
     RowMenu         "More" on a row: the document's other actions, unchanged
     ReportPicker    Reports: one chosen report at a time
     CustomerNeeds   Customers & Follow-ups: what needs action, one list
     CustomerBoard   the same records as a read-only board (decision S3):
                     no stage is stored, nothing is dragged */

import type { PipeKey } from "@/lib/sales-status";
import { useEffect, useId, useState, type ReactNode } from "react";
import { LineTabs, TabAside } from "@/components/ui/line-tabs";
import { FillPanel } from "@/components/ui/fill-panel"; // v1.324.0 - D-4
import { ViewSwitch } from "@/components/portal/executive-cards";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClass, selectClassSm } from "@/lib/ui-styles";
import css from "./sales-shell.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* ------------------------------------------------------------------ */
/* the six views, in the address (decision S2)                         */
/* ------------------------------------------------------------------ */
/* v1.399.0 (Phase 3, decision 6) - the CEO's order: Overview, Leads & CRM, Sales Pipeline, Quotations & Invoices,
   Payments, Closed Sales, Reports, and (v1.404.0, Phase 7) the Sales Playbook - the eight views of decision 6. The keys never
   change, so every link still lands. */
export const SALES_VIEWS = ["overview", "customers", "pipeline", "documents", "payments", "closed", "reports", "playbook"] as const;
export type SalesView = (typeof SALES_VIEWS)[number];
export const isSalesView = (v: string | null | undefined): v is SalesView => !!v && (SALES_VIEWS as readonly string[]).includes(v);
/** "/portal?tab=Sales&view=payments" - only the tab and the view's name; never a record or a person */
export function salesViewUrl(view: SalesView): string {
  const u = new URL(window.location.href);
  u.searchParams.set("tab", "Sales");
  u.searchParams.set("view", view);
  return u.pathname + u.search + u.hash;
}
/** the address without the Sales view (leaving Sales) */
export function withoutSalesView(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete("tab");
  u.searchParams.delete("view");
  return u.pathname + u.search + u.hash;
}


/* ------------------------------------------------------------------ */
/* the six views: tabs on a wide screen, one selector on a phone        */
/* ------------------------------------------------------------------ */
/** The CEO's answer (12-11-2026): the photo's tab row where it fits, one
    compact Views Selector on a phone; the counts say what waits behind a
    view; ONE gold action, the one the view on screen is for. */
export function SalesViewBar({ view, onView, waiting, action }: {
  view: SalesView; onView: (v: SalesView) => void;
  waiting: { documents: number | null; payments: number | null; customers: number | null };
  action: ReactNode;
}) {
  const n = (x: number | null) => (x ? L(`${x} waiting`, `${x} menunggu`) : "");
  return (
    <>
      <div className="erp-desktop-only" data-testid="sales-tabs">
        <LineTabs value={view} onChange={onView} label={L("Sales", "Jualan")} tabs={[
          ["overview", L("Overview", "Gambaran")],
          ["customers", L("Leads & CRM", "Prospek & CRM"), waiting.customers], // v1.398.0 - was Customers & Follow-ups; the view key stays, so every link still lands
          ["pipeline", L("Sales Pipeline", "Saluran Jualan")], // v1.399.0 - Phase 3
          ["documents", L("Quotations & Invoices", "Sebut Harga & Invois"), waiting.documents],
          ["payments", L("Payments", "Bayaran"), waiting.payments],
          ["closed", L("Closed Sales", "Jualan Ditutup")],
          ["reports", L("Reports", "Laporan")],
          ["playbook", L("Sales Playbook", "Buku Panduan Jualan")], // v1.404.0 - Phase 7
        ]} aside={<TabAside>{action}</TabAside>} />
      </div>
      <div className={`erp-phone-only ${css.viewBar}`} data-testid="sales-view-bar">
        <ViewSwitch value={view} onChange={onView} options={[
          ["overview", L("Overview", "Gambaran"), L("The worklist: what needs someone", "Senarai kerja: apa yang perlu tindakan")],
          ["customers", L("Leads & CRM", "Prospek & CRM"), [L("Leads, enquiries and follow-ups", "Prospek, pertanyaan dan susulan"), n(waiting.customers)].filter(Boolean).join(" · ")], // v1.398.0
          ["pipeline", L("Sales Pipeline", "Saluran Jualan"), L("Deals by stage, apart from the money", "Urusan mengikut peringkat, berasingan daripada wang")], // v1.399.0
          ["documents", L("Documents", "Dokumen"), [L("Quotations, invoices and the rest", "Sebut harga, invois dan lain-lain"), n(waiting.documents)].filter(Boolean).join(" · ")],
          ["payments", L("Payments", "Bayaran"), [L("Report, then the CEO verifies", "Lapor, kemudian CEO sahkan"), n(waiting.payments)].filter(Boolean).join(" · ")],
          ["closed", L("Closed Sales", "Jualan Ditutup"), L("Paid invoices, closers, commission", "Invois dibayar, penutup, komisen")],
          ["reports", L("Reports", "Laporan"), L("One report at a time", "Satu laporan pada satu masa")],
          ["playbook", L("Sales Playbook", "Buku Panduan Jualan"), L("Scripts, answers and guidance", "Skrip, jawapan dan panduan")], // v1.404.0
        ] as const} />
        {action}
      </div>
    </>
  );
}

/** Quotations & Invoices: the other five document views, one press away (lit while one is open) */
export function DocsMore({ items }: { items: { key: string; label: string; on: boolean; go: () => void }[] }) {
  const cur = items.find((m) => m.on);
  return (
    <label className={css.moreDocs}>
      <span className="erp-sr-only">{L("More document views", "Lagi paparan dokumen")}</span>
      <select className={`${selectClassSm} ${cur ? css.moreOn : ""}`} data-testid="docs-more" value={cur?.key ?? ""} onChange={(e) => items.find((m) => m.key === e.target.value)?.go()}>
        <option value="" disabled>{L("More…", "Lagi…")}</option>
        {items.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
    </label>
  );
}

/** Leads & CRM (was Customers & Follow-ups): one filter at a time, with the counts of what is there.
    v1.398.0 (Phase 2, decision 5) - Needs Action is retired: My Sales Action Center owns that list.
    "action" and "all" stay as words an old link may carry; neither is a tab ("all" is the add / edit
    customer form, opened by Add customer and Edit details). v1.399.0 (Phase 3, decision 7) - the read-only Board is
    retired: the Sales Pipeline is the board now, and an old "board" link opens it. */
export type CustFilter = "all_leads" | "my_leads" | "unassigned" | "active" | "enquiries" | "growth" | "followups" | "board" | "action" | "all"; // v1.369.0 growth: the Business Growth Check
/** the four lead views, and the CRM view each one is */
export const LEAD_FILTER: Partial<Record<CustFilter, "all" | "mine" | "unassigned" | "active">> = { all_leads: "all", my_leads: "mine", unassigned: "unassigned", active: "active" };
export function CustomerFilterBar({ value, onChange, counts, scopeSwitch, growth = false }: { value: CustFilter; onChange: (f: CustFilter) => void; counts: Partial<Record<CustFilter, number>> | null; scopeSwitch: ReactNode;
  /** v1.369.0 - the Business Growth Check is drawn for the website Enquiries people only (the server checks again) */
  growth?: boolean }) {
  const items: [CustFilter, string][] = [["all_leads", L("All Leads", "Semua Prospek")], ["my_leads", L("My Leads", "Prospek Saya")], ["unassigned", L("Unassigned", "Tiada Pemilik")],
    ["enquiries", L("New Enquiries", "Pertanyaan Baharu")], ...(growth ? [["growth", L("Business Growth", "Pertumbuhan Bisnes")] as [CustFilter, string]] : []),
    ["active", L("Active Customers", "Pelanggan Aktif")], ["followups", L("Follow-ups", "Susulan")]];
  const shown: CustFilter = value === "action" || value === "all" ? "all_leads" : value;
  return (
    <div className={css.customerFilters}>
      {/* v1.324.0 (Global UI System D-2) - the one tab row; the scope switch sits at its right end */}
      <LineTabs label={L("Leads and follow-ups", "Prospek dan susulan")} value={shown} onChange={onChange} testid="cust"
        tabs={items.map(([k, label]) => [k, `${label}${counts && counts[k as keyof typeof counts] != null ? ` (${counts[k as keyof typeof counts]})` : ""}`] as const)} aside={scopeSwitch} />
    </div>
  );
}

/** v1.292.0 (decision S2) - THE VIEW IS IN THE ADDRESS, so Back and Forward
    move between the six views and a view can be linked
    (/portal?tab=Sales&view=payments). Only the tab and the view's name are
    written - never a record, a person or a figure. Arriving puts the view on
    the entry already there; a change of view adds one entry; leaving Sales
    takes both words off the address again. */
export function useSalesViewHistory(view: SalesView, setView: (v: SalesView) => void) {
  useEffect(() => {
    const cur = new URL(window.location.href).searchParams.get("view");
    if (cur === null) window.history.replaceState({ salesView: view }, "", salesViewUrl(view));
    else if (cur !== view) window.history.pushState({ salesView: view }, "", salesViewUrl(view));
  }, [view]);
  useEffect(() => {
    const onPop = () => { const v = new URL(window.location.href).searchParams.get("view"); if (isSalesView(v)) setView(v); };
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("popstate", onPop); window.history.replaceState(null, "", withoutSalesView()); };
  }, [setView]);
}

/* ------------------------------------------------------------------ */
/* the slim strip                                                      */
/* ------------------------------------------------------------------ */
/* v1.321.0 - moved to components/ui/metric-strip.tsx so Sales and Tasks draw
   the same strip; re-exported here unchanged for every Sales screen */
export { MetricStrip, type StripCell } from "@/components/ui/metric-strip";

/* ------------------------------------------------------------------ */
/* More, on a row                                                      */
/* ------------------------------------------------------------------ */
/** The other actions of one record, behind one button. The children are the
    row's own buttons, untouched: the same handlers, the same gates. Escape or
    a press outside closes it; pressing an action closes it too. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={css.menuWrap}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button type="button" className={css.menuBtn} aria-haspopup="true" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={label} title={label} data-testid="row-more" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <span id={id} role="group" aria-label={label} className={css.menu} data-testid="row-menu"
          onClick={(e) => { if ((e.target as HTMLElement).closest("button")) setOpen(false); }}>
          {children}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* the Sales Worklist                                                  */
/* ------------------------------------------------------------------ */
export type WorkKind = "payment" | "quotation" | "invoice" | "followup" | "enquiry";
export interface WorkRow {
  key: string; kind: WorkKind;
  /** the customer, then the record's own reference and what stands */
  customer: string; ref: string;
  cents: number | null;
  status: { label: string; tone: "bad" | "warn" | "info" | "ok" | "neutral" };
  owner: string | null; ownerId: number | null;
  overdue: boolean;
  /** sort: the overdue first, then the oldest */
  rank: string;
  action: { label: string; primary?: boolean; on: () => void };
  open: () => void;
  /** v1.320.0 (Sales 2.0, S2-5) - the pipeline step this record stands on (lib/sales-status.ts) */
  pipe?: PipeKey;
}
const KIND: Record<WorkKind, [string, string, string]> = {
  payment: ["Payment", "Bayaran", chipSmWarn], quotation: ["Quotation", "Sebut harga", chipSmWarn], invoice: ["Invoice", "Invois", chipSmInfo],
  followup: ["Follow-up", "Susulan", chipSmNeutral], enquiry: ["Enquiry", "Pertanyaan", chipSmNeutral],
};
const TONE = { bad: chipSmDanger, warn: chipSmWarn, info: chipSmInfo, ok: chipSmSuccess, neutral: chipSmNeutral } as const;

export function SalesWorklist({ rows, loaded, mine, scopeSwitch, emptyText, pipe = null, pipeLabel }: {
  rows: WorkRow[]; loaded: boolean;
  /** v1.320.0 - the pipeline step pressed on the Overview: only its records */
  pipe?: PipeKey | null; pipeLabel?: string;
  /** the heading says whose list it is */
  mine: boolean;
  /** Mine / Everyone - the page's own switch, drawn in the filter row */
  scopeSwitch?: ReactNode;
  emptyText?: string;
}) {
  const [kind, setKind] = useState<WorkKind | "all">("all");
  const [when, setWhen] = useState<"all" | "overdue">("all");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => !pipe || r.pipe === pipe)
    .filter((r) => kind === "all" || r.kind === kind)
    .filter((r) => when === "all" || r.overdue)
    .filter((r) => !needle || `${r.customer} ${r.ref} ${r.owner ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => a.rank.localeCompare(b.rank));
  const kinds = (Object.keys(KIND) as WorkKind[]).filter((k) => rows.some((r) => r.kind === k));
  return (
    <section className={`${card} ${css.work}`} aria-label={L("Sales worklist", "Senarai kerja jualan")} data-testid="sales-worklist">
      <div className={css.workHead}>
        <h3 className={css.workTitle}><AppIcon name="orders" />{mine ? L("My Sales Worklist", "Senarai Kerja Jualan Saya") : L("Sales Worklist", "Senarai Kerja Jualan")}
          {loaded && <span className={css.count}>({shown.length})</span>}
          {pipe && pipeLabel && <span className={chipSmInfo} data-testid="worklist-pipe">{pipeLabel}</span>}</h3>
        <div className={css.filters}>
          <select className={`${inputClass} ${css.pick}`} aria-label={L("Type", "Jenis")} value={kind} onChange={(e) => setKind(e.target.value as WorkKind | "all")}>
            <option value="all">{L("All types", "Semua jenis")}</option>
            {kinds.map((k) => <option key={k} value={k}>{L(KIND[k][0], KIND[k][1])}</option>)}
          </select>
          {scopeSwitch}
          <select className={`${inputClass} ${css.pick}`} aria-label={L("When", "Bila")} value={when} onChange={(e) => setWhen(e.target.value as "all" | "overdue")}>
            <option value="all">{L("Everything waiting", "Semua yang menunggu")}</option>
            <option value="overdue">{L("Overdue only", "Yang lewat sahaja")}</option>
          </select>
        </div>
      </div>
      <label className={css.search}>
        <AppIcon name="search" />
        <span className="erp-sr-only">{L("Search the worklist", "Cari dalam senarai kerja")}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search customer, document number or salesperson…", "Cari pelanggan, nombor dokumen atau jurujual…")} />
      </label>
      {!loaded ? <SkelRows rows={4} /> : shown.length === 0 ? (
        <p className={css.empty} data-testid="worklist-empty"><AppIcon name="success" />{rows.length === 0
          ? emptyText ?? L("Nothing is waiting: no payment to verify, no follow-up due, no invoice unpaid and no quotation without a follow-up.", "Tiada yang menunggu: tiada bayaran untuk disahkan, tiada susulan perlu, tiada invois belum dibayar dan tiada sebut harga tanpa susulan.")
          : pipe ? L("Nothing at this step needs anyone now.", "Tiada apa pada langkah ini yang perlu tindakan sekarang.") : L("Nothing matches these filters.", "Tiada yang sepadan dengan penapis ini.")}</p>
      ) : (
        <FillPanel><div role="table" className={css.table} aria-label={L("Sales worklist", "Senarai kerja jualan")}>
          <div role="row" className={`${css.row} ${css.headRow}`}>
            <span role="columnheader">{L("Customer / record", "Pelanggan / rekod")}</span>
            <span role="columnheader">{L("Type", "Jenis")}</span>
            <span role="columnheader" className={css.num}>{L("Amount (RM)", "Amaun (RM)")}</span>
            <span role="columnheader">{L("Status", "Status")}</span>
            <span role="columnheader">{L("Salesperson", "Jurujual")}</span>
            <span role="columnheader" className={css.act}>{L("Next action", "Tindakan seterusnya")}</span>
          </div>
          {shown.map((r) => (
            <div role="row" key={r.key} className={css.row} data-kind={r.kind}>
              <span role="cell" className={css.cWho}>
                <button type="button" className={css.openBtn} onClick={r.open} title={L("Open this record", "Buka rekod ini")}>
                  <strong>{r.customer}</strong><span>{r.ref}</span>
                </button>
              </span>
              <span role="cell" className={css.cKind}><span className={KIND[r.kind][2]}>{L(KIND[r.kind][0], KIND[r.kind][1])}</span></span>
              <span role="cell" className={`${css.num} ${css.cAmt} erp-num`} data-empty={r.cents === null || undefined}>{r.cents === null ? "—" : fmtRM(r.cents).replace(/^RM\s?/, "")}</span>
              <span role="cell" className={css.cStatus}><span className={TONE[r.status.tone]}>{r.status.label}</span></span>
              <span role="cell" className={css.cOwner} data-empty={!r.owner || undefined}>{r.owner ?? "—"}</span>
              <span role="cell" className={`${css.act} ${css.cAct}`}>
                <button type="button" className={r.action.primary ? btnSmPrimary : btnSm} onClick={r.action.on}>{r.action.label}</button>
              </span>
            </div>
          ))}
        </div></FillPanel>
      )}
      <p className={css.note}>{L("Each row is the record itself - it opens that quotation, invoice, payment, follow-up or enquiry. Nothing is copied into a second list.", "Setiap baris ialah rekod itu sendiri - ia membuka sebut harga, invois, bayaran, susulan atau pertanyaan tersebut. Tiada yang disalin ke senarai kedua.")}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Reports: one at a time                                              */
/* ------------------------------------------------------------------ */
export interface ReportDef { key: string; label: string; hint?: string; node: ReactNode }
export function ReportPicker({ reports, initial }: { reports: ReportDef[]; initial?: string }) {
  const [key, setKey] = useState(initial && reports.some((r) => r.key === initial) ? initial : reports[0]?.key ?? "");
  const cur = reports.find((r) => r.key === key) ?? reports[0];
  if (!cur) return null;
  return (
    <div className={css.reports} data-testid="sales-reports" data-report={cur.key}>
      <div className={`${card} ${css.reportBar}`}>
        <label className={css.reportPick}>
          <span>{L("Report", "Laporan")}</span>
          <select className={inputClass} value={cur.key} onChange={(e) => setKey(e.target.value)} data-testid="report-type">
            {reports.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        {cur.hint && <p className={css.note}>{cur.hint}</p>}
      </div>
      {/* only the chosen report is mounted: the others ask the server nothing until they are picked */}
      <div key={cur.key} className={css.reportBody}>{cur.node}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Customers & Follow-ups: what needs action, and the board            */
/* ------------------------------------------------------------------ */
export interface CustomerNeed {
  key: string; customer: string; kindWord: string;
  /** the linked quotation, invoice or enquiry, in words */
  linked: string; last: string;
  next: { label: string; tone: "bad" | "warn" | "info" | "neutral"; sub?: string };
  owner: string | null;
  action: { label: string; primary?: boolean; on: () => void };
  open: () => void;
  rank: string;
}
export function CustomerNeeds({ rows, loaded }: { rows: CustomerNeed[]; loaded: boolean }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || `${r.customer} ${r.linked} ${r.owner ?? ""}`.toLowerCase().includes(needle)).sort((a, b) => a.rank.localeCompare(b.rank));
  return (
    <section className={`${card} ${css.work}`} aria-label={L("Customers needing action", "Pelanggan yang perlu tindakan")} data-testid="customer-needs">
      <label className={css.search}>
        <AppIcon name="search" />
        <span className="erp-sr-only">{L("Search", "Cari")}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search customer, quotation or salesperson…", "Cari pelanggan, sebut harga atau jurujual…")} />
      </label>
      {!loaded ? <SkelRows rows={3} /> : shown.length === 0 ? (
        <p className={css.empty}><AppIcon name="success" />{rows.length === 0 ? L("Nobody is waiting: no enquiry to answer and no follow-up due.", "Tiada yang menunggu: tiada pertanyaan untuk dijawab dan tiada susulan perlu.") : L("Nothing matches the search.", "Tiada yang sepadan dengan carian.")}</p>
      ) : (
        <FillPanel><div role="table" className={`${css.table} ${css.custTable}`} aria-label={L("Customers needing action", "Pelanggan yang perlu tindakan")}>
          <div role="row" className={`${css.row} ${css.headRow}`}>
            <span role="columnheader">{L("Customer", "Pelanggan")}</span>
            <span role="columnheader">{L("Linked sales activity", "Aktiviti jualan berkaitan")}</span>
            <span role="columnheader">{L("Last update", "Kemas kini terakhir")}</span>
            <span role="columnheader">{L("Next action", "Tindakan seterusnya")}</span>
            <span role="columnheader">{L("Salesperson", "Jurujual")}</span>
            <span role="columnheader" className={css.act}><span className="erp-sr-only">{L("Action", "Tindakan")}</span></span>
          </div>
          {shown.map((r) => (
            <div role="row" key={r.key} className={css.row}>
              <span role="cell" className={css.cWho}><button type="button" className={css.openBtn} onClick={r.open}><strong>{r.customer}</strong><span>{r.kindWord}</span></button></span>
              <span role="cell" className={css.cLinked}>{r.linked}</span>
              <span role="cell" className={css.cLast}>{r.last}</span>
              <span role="cell" className={css.cStatus}><span className={TONE[r.next.tone]}>{r.next.label}</span>{r.next.sub && <small>{r.next.sub}</small>}</span>
              <span role="cell" className={css.cOwner}>{r.owner ?? "—"}</span>
              <span role="cell" className={`${css.act} ${css.cAct}`}><button type="button" className={r.action.primary ? btnSmPrimary : btnSm} onClick={r.action.on}>{r.action.label}</button></span>
            </div>
          ))}
        </div></FillPanel>
      )}
    </section>
  );
}

export interface BoardCard { key: string; title: string; cents: number | null; sub: string; open: () => void }
export interface BoardColumn { key: "enquiry" | "quotation" | "negotiating" | "accepted" | "closed"; cards: BoardCard[] }
const COL: Record<BoardColumn["key"], [string, string, string, string]> = {
  enquiry: ["Enquiry", "Pertanyaan", "No open enquiry", "Tiada pertanyaan terbuka"],
  quotation: ["Quotation", "Sebut harga", "No open quotation", "Tiada sebut harga terbuka"],
  negotiating: ["Negotiating", "Berunding", "No quotation in negotiation", "Tiada sebut harga dalam rundingan"],
  accepted: ["Accepted", "Diterima", "No accepted quotation waiting for its invoice", "Tiada sebut harga diterima menunggu invois"],
  closed: ["Closed", "Ditutup", "Nothing paid in full this month", "Tiada dibayar penuh bulan ini"],
};
/** The same records as columns. READ-ONLY: a card opens its record; no stage
    is stored and nothing is dragged - a record sits in the column its own
    state puts it in (an open enquiry; an open quotation; one whose last
    recorded contact is "negotiating"; an accepted one not yet invoiced; an
    invoice paid in full this month). */
export function CustomerBoard({ columns, loaded }: { columns: BoardColumn[]; loaded: boolean }) {
  return (
    <section className={`${card} ${css.work}`} aria-label={L("Board", "Papan")} data-testid="customer-board">
      {!loaded ? <SkelRows rows={4} /> : (
        <div className={css.board}>
          {columns.map((c) => {
            const total = c.cards.reduce((a, x) => a + (x.cents ?? 0), 0);
            return (
              <div key={c.key} className={`${css.col} ${css[`col_${c.key}`]}`} role="group" aria-label={L(COL[c.key][0], COL[c.key][1])}>
                <p className={css.colHead}><strong>{L(COL[c.key][0], COL[c.key][1])} ({c.cards.length})</strong>{c.key !== "enquiry" && <span className="erp-num">{fmtRM(total)}</span>}</p>
                {c.cards.length === 0 ? <p className={css.colNone}>{L(COL[c.key][2], COL[c.key][3])}</p> : (
                  <ul className={css.colCards}>
                    {c.cards.slice(0, 8).map((x) => (
                      <li key={x.key}><button type="button" className={css.boardCard} onClick={x.open}>
                        <strong>{x.title}</strong>{x.cents !== null && <span className="erp-num">{fmtRM(x.cents)}</span>}<small>{x.sub}</small>
                      </button></li>
                    ))}
                    {c.cards.length > 8 && <li className={css.colMore}>{L(`and ${c.cards.length - 8} more - see the list`, `dan ${c.cards.length - 8} lagi - lihat senarai`)}</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className={css.note}>{L("Read-only: each card opens its own record. A record sits where its own state puts it; no stage is kept here.", "Baca sahaja: setiap kad membuka rekodnya. Rekod berada di lajur mengikut keadaannya sendiri; tiada peringkat disimpan di sini.")}</p>
    </section>
  );
}

/** "3 days" from a date or instant, against today's Malaysia date */
export function daysSince(d: string | null | undefined, today: string): number | null {
  if (!d) return null;
  const a = Date.parse(`${d.slice(0, 10)}T00:00:00Z`), b = Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, Math.round((b - a) / 86_400_000));
}
export const shortDmy = (d: string) => dmy(d.slice(0, 10)).slice(0, 5);
