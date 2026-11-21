"use client";

/* v1.401.0 - COLLECTIONS (Sales Command Center Phase 5; the CEO, 21-11-2026, "As recommended" on the seven
   Phase 5 decisions). A tab of Payments; worker/src/collections.ts is the server (a pure read).

   Every unpaid invoice, with what is still owed by VERIFIED money only - a reported payment sits beside it as
   "waiting for the CEO", never as paid - how old it is (0-30, 31-60, 61-90, 90+ days), who collects it (the
   invoice's salesperson; never changed here) and its next collection action, in words and colour:
   red Overdue, amber No collection follow-up, blue Due today.

   Book follow-up is the existing customer follow-up on that invoice (one open per invoice). WhatsApp and Call
   open the phone with the reminder written; pressing them records nothing. Nothing here reports, verifies,
   marks paid or touches Finance, the closer or commission. */

import { useState } from "react";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM, mytToday } from "@/lib/format";
import { resolveIssuer } from "@/lib/issuers";
import { reminderText, waNumber } from "@/lib/collection-text";
import { L } from "@/components/portal/page-shared";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, TaskToolbar, type TableCol } from "@/components/portal/task-table";
import { PillSwitch } from "@/components/ui/panel";
import { DrawerFoot, DrawerForm, SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { AppIcon } from "@/components/ui/app-icon";
import { useFeedback } from "@/components/ui/feedback-modal";
import { btnSm, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmWarn, fieldLabel, inputClass, selectClass, selectClassSm } from "@/lib/ui-styles";
import css from "./collections.module.css";

type Bucket = "0_30" | "31_60" | "61_90" | "90_plus";
type Flag = "overdue" | "today" | "booked" | "no_next";
export interface CollectionItem {
  id: number; doc_number: string; customer_id: number; customer: string; phone: string | null; issuer_code: string | null;
  total_cents: number; verified_cents: number; waiting_cents: number; balance_cents: number;
  due_date: string | null; invoice_overdue: boolean; age_days: number; bucket: Bucket;
  collector_id: number | null; collector: string | null; flag: Flag;
  followup: { id: number; due_on: string; note: string; owner: string | null } | null;
}
interface Data {
  today: string; scope: "mine" | "all"; can_all: boolean; items: CollectionItem[];
  summary: { invoices: number; balance_cents: number; waiting_cents: number; buckets: Record<Bucket, { n: number; cents: number }>; no_next: number; late: number; invoice_overdue: number };
}
interface CrmOpts { owners: { id: number; name: string }[]; can_assign: boolean }

const BUCKET_WORD: Record<Bucket, [string, string]> = { "0_30": ["0–30 days", "0–30 hari"], "31_60": ["31–60 days", "31–60 hari"], "61_90": ["61–90 days", "61–90 hari"], "90_plus": ["90+ days", "90+ hari"] };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (iso: string | null) => { if (!iso) return ""; const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

function FlagChip({ i }: { i: CollectionItem }) {
  if (i.flag === "overdue") return <span className={chipSmDanger} data-testid="col-flag" data-flag="overdue">{L(`Overdue · ${dayOf(i.followup?.due_on ?? null)}`, `Lewat · ${dayOf(i.followup?.due_on ?? null)}`)}</span>;
  if (i.flag === "no_next") return <span className={chipSmWarn} data-testid="col-flag" data-flag="no_next">{L("No collection follow-up", "Tiada susulan kutipan")}</span>;
  if (i.flag === "today") return <span className={chipSmInfo} data-testid="col-flag" data-flag="today">{L("Due today", "Hari ini")}</span>;
  return <span className={css.booked} data-testid="col-flag" data-flag="booked">{dayOf(i.followup?.due_on ?? null)}</span>;
}

export function CollectionsPanel({ onOpenInvoice, onOpenCustomer }: {
  /** the invoice's own payment sheet on Payments */
  onOpenInvoice: (invoiceId: number) => void;
  /** the customer file (where a contact is logged and follow-ups are closed) */
  onOpenCustomer: (customerId: number, company: string) => void;
}) {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [bucket, setBucket] = useState<"any" | Bucket>("any");
  const [flag, setFlag] = useState<"" | "no_next" | "overdue">("");
  const [q, setQ] = useState("");
  const [booking, setBooking] = useState<CollectionItem | null>(null);
  const list = useCachedApi<Data>(`/staff/collections?scope=${scope}`, true, ["collections", "followups", "payments", "docs", "customers"]);
  const opts = useCachedApi<CrmOpts>("/staff/crm/options", true, ["crm"]);
  const d = list.data;
  const needle = q.trim().toLowerCase();
  const rows = (d?.items ?? [])
    .filter((i) => (bucket === "any" || i.bucket === bucket) && (!flag || i.flag === flag) && (!needle || `${i.doc_number} ${i.customer} ${i.collector ?? ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => b.age_days - a.age_days);

  if (list.failed && !d) return <div className={card}><p className={css.warn} role="alert" data-testid="col-failed"><AppIcon name="warning" />{L("Collections could not be loaded.", "Kutipan tidak dapat dimuatkan.")}</p></div>;

  const cols: TableCol<CollectionItem>[] = [
    { key: "inv", label: L("Invoice · customer", "Invois · pelanggan"), main: true, cell: (i) => <>
      <TaskRowTitle title={i.doc_number} onOpen={() => onOpenInvoice(i.id)} late={i.flag === "overdue"} />
      <TaskRowSub>{[i.customer, i.collector ? L(`collector ${i.collector}`, `pengutip ${i.collector}`) : L("no collector", "tiada pengutip")].join(" · ")}</TaskRowSub>
    </> },
    { key: "bal", label: L("Still owed (verified)", "Baki (disahkan)"), cell: (i) => <span className={css.money} data-testid="col-balance">
      <b>{fmtRM(i.balance_cents)}</b>
      {i.waiting_cents > 0 && <span className={chipSmNeutral} data-testid="col-waiting">{L(`${fmtRM(i.waiting_cents)} waiting for the CEO`, `${fmtRM(i.waiting_cents)} menunggu CEO`)}</span>}
    </span> },
    { key: "age", label: L("Age", "Usia"), cell: (i) => <span className={i.bucket === "61_90" || i.bucket === "90_plus" ? chipSmDanger : chipSmNeutral} data-testid="col-age" data-bucket={i.bucket}>
      {L(`${i.age_days} days`, `${i.age_days} hari`)}{i.invoice_overdue ? L(" · past due", " · lepas tempoh") : ""}</span> },
    { key: "next", label: L("Next collection action", "Tindakan kutipan seterusnya"), cell: (i) => <span className={css.next}><FlagChip i={i} />{i.followup && <span className={css.note}>{i.followup.note}</span>}</span> },
    { key: "act", label: L("Contact", "Hubungi"), cell: (i) => {
      const wa = waNumber(i.phone);
      const text = reminderText(resolveIssuer(i.issuer_code), i.doc_number, i.balance_cents);
      return (
        /* the row opens the invoice; its buttons and links do only their own thing */
        <span className="erp-row-actions" onClick={(e) => e.stopPropagation()}>
          {!i.followup && <button type="button" className={btnSmPrimary} onClick={() => setBooking(i)} data-testid="col-book"><AppIcon name="date" />{L("Book follow-up", "Tetapkan susulan")}</button>}
          {i.followup && <button type="button" className={btnSm} onClick={() => onOpenCustomer(i.customer_id, i.customer)} data-testid="col-file">{L("Open file", "Buka fail")}</button>}
          {wa && <a className={btnSmQuiet} href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" data-testid="col-wa" aria-label={L(`WhatsApp ${i.customer}`, `WhatsApp ${i.customer}`)}><AppIcon name="chat" />WhatsApp</a>}
          {i.phone && <a className={btnSmQuiet} href={`tel:${i.phone.replace(/[^0-9+]/g, "")}`} data-testid="col-call"><AppIcon name="connection" />{L("Call", "Telefon")}</a>}
        </span>
      );
    } },
  ];
  const counts: Record<"any" | Bucket, number | null> = d ? { any: d.items.length, ...Object.fromEntries(Object.entries(d.summary.buckets).map(([k, v]) => [k, v.n])) } as Record<"any" | Bucket, number> : { any: null, "0_30": null, "31_60": null, "61_90": null, "90_plus": null };
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Collections", "Kutipan")} data-testid="collections">
      <div className={css.bar}>
        <div>
          <h3 className={css.h}>{L("Collections", "Kutipan")}</h3>
          {d ? <p className={css.meta} data-testid="col-summary">{L(`${d.summary.invoices} unpaid invoice${d.summary.invoices === 1 ? "" : "s"} · ${fmtRM(d.summary.balance_cents)} still owed by verified money${d.summary.waiting_cents ? ` · ${fmtRM(d.summary.waiting_cents)} reported, waiting for the CEO (not counted as paid)` : ""}`,
              `${d.summary.invoices} invois belum dibayar · ${fmtRM(d.summary.balance_cents)} baki mengikut wang disahkan${d.summary.waiting_cents ? ` · ${fmtRM(d.summary.waiting_cents)} dilapor, menunggu CEO (tidak dikira dibayar)` : ""}`)}</p>
            : <SkelRows rows={1} />}
        </div>
        {d?.can_all && <PillSwitch value={scope} onChange={setScope} label={L("Whose invoices", "Invois siapa")} testid="col-scope" options={[["mine", L("Mine", "Saya")], ["all", L("Everyone", "Semua")]] as const} />}
      </div>
      <TaskToolbar q={q} onQ={setQ} placeholder={L("Search invoice, customer or collector…", "Cari invois, pelanggan atau pengutip…")} testid="col-toolbar">
        <PillSwitch value={bucket} onChange={setBucket} label={L("Age", "Usia")} testid="col-bucket" counts={counts}
          options={[["any", L("All ages", "Semua usia")], ...(["0_30", "31_60", "61_90", "90_plus"] as const).map((b) => [b, L(BUCKET_WORD[b][0], BUCKET_WORD[b][1])] as const)]} />
        <select className={selectClassSm} value={flag} onChange={(e) => setFlag(e.target.value as typeof flag)} aria-label={L("Follow-up", "Susulan")} data-testid="col-flag-filter">
          <option value="">{L("Any follow-up", "Semua susulan")}</option>
          <option value="no_next">{L(`No collection follow-up${d ? ` (${d.summary.no_next})` : ""}`, `Tiada susulan kutipan${d ? ` (${d.summary.no_next})` : ""}`)}</option>
          <option value="overdue">{L(`Follow-up overdue${d ? ` (${d.summary.late})` : ""}`, `Susulan lewat${d ? ` (${d.summary.late})` : ""}`)}</option>
        </select>
      </TaskToolbar>
      {!d ? <SkelRows rows={4} /> : (
        <CompactTaskTable rows={rows} cols={cols} label={L("Collections", "Kutipan")} loading={false} record="invoice" testid="col-table" onOpen={onOpenInvoice}
          rowClass={(i) => (i.flag === "overdue" ? css.lateRow ?? "" : "")}
          empty={<p className={css.empty} data-testid="col-empty"><AppIcon name="success" />{d.items.length ? L("No invoice matches these filters.", "Tiada invois sepadan dengan penapis ini.") : L("Nothing to collect: every invoice is paid.", "Tiada untuk dikutip: setiap invois telah dibayar.")}</p>} />
      )}
      <p className={css.meta}>{L("WhatsApp and Call open your phone with the reminder written. They record nothing - log what happened on the customer's file.", "WhatsApp dan Telefon membuka telefon anda dengan peringatan bertulis. Ia tidak merekod apa-apa - rekod apa yang berlaku pada fail pelanggan.")}</p>
      {booking && <BookForm item={booking} opts={opts.data ?? null} onClose={() => setBooking(null)} onDone={() => { setBooking(null); list.refresh(); }} />}
    </section>
  );
}

function BookForm({ item, opts, onClose, onDone }: { item: CollectionItem; opts: CrmOpts | null; onClose: () => void; onDone: () => void }) {
  const fb = useFeedback();
  const [due, setDue] = useState(mytToday());
  const [note, setNote] = useState(L(`Collect ${item.doc_number}`, `Kutip ${item.doc_number}`));
  const [owner, setOwner] = useState<number | "">(item.collector_id ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/customers/${item.customer_id}/followups`, {
      method: "POST", body: JSON.stringify({ due_on: due, note: note.trim(), doc_id: item.id, ...(opts?.can_assign && owner !== "" ? { owner_id: owner } : {}) }) });
    setBusy(false);
    if (!r.ok) { fb.show({ variant: "error", title: L("Not booked", "Tidak ditetapkan"), description: r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.") }); return; }
    fb.show({ variant: "success", title: L("Collection follow-up booked", "Susulan kutipan ditetapkan"), description: `${item.doc_number} · ${dayOf(due)}` });
    onDone();
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Book collection follow-up", "Tetapkan susulan kutipan")} form icon="date" dirty="auto">
      {fb.node}
      <DrawerForm>
        <p className={css.meta}>{L(`${item.doc_number} · ${item.customer} · ${fmtRM(item.balance_cents)} still owed`, `${item.doc_number} · ${item.customer} · baki ${fmtRM(item.balance_cents)}`)}</p>
        <label className={fieldLabel}>{L("When", "Bila")}
          <input type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} data-testid="col-book-date" placeholder="YYYY-MM-DD" />
        </label>
        <label className={fieldLabel}>{L("What to do", "Apa perlu dibuat")}
          <input className={inputClass} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} data-testid="col-book-note" />
        </label>
        {opts?.can_assign && (
          <label className={fieldLabel}>{L("Who follows up", "Siapa membuat susulan")}
            <select className={selectClass} value={owner} onChange={(e) => setOwner(e.target.value ? Number(e.target.value) : "")} data-testid="col-book-owner">
              {opts.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <p className={css.meta}>{L("This books the next action only. It never changes the invoice, its closer or a payment.", "Ini menetapkan tindakan seterusnya sahaja. Ia tidak mengubah invois, penutupnya atau bayaran.")}</p>
      </DrawerForm>
      <DrawerFoot>
        <button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || !due || note.trim().length < 3} onClick={() => void save()} data-testid="col-book-save">{L("Book follow-up", "Tetapkan susulan")}</button>
      </DrawerFoot>
    </SideDrawer>
  );
}
