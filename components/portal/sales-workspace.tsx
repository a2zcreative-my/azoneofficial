"use client";

/* v1.214.0 - THE SALES WORKSPACE (the owner's brief "A2Z OS - Sales
   Workspace 2.0", 27-10-2026, and his answers to the audit in
   claude/SALES-WORKSPACE-AUDIT.md: the retired modules stay retired and the
   workspace is built on the live records; the screen comes first and the
   commission ledger waits for his policy; the closer is locked at the first
   recorded payment; a payment will count for commission only when someone
   other than the closer recorded it).

   ONE VERIFIED SALE, ONE RECORD. Every card here reads what the Sales panel
   already loaded - GET /staff/docs (quotations, invoices, the salesperson,
   payment state, the quotation an invoice came from), /staff/docs/part-
   payments and the open follow-ups in /staff/customers/crm. Nothing is
   fetched twice and nothing is written here, except the CEO's closer
   correction, which is the server's POST /docs/:id/closer (commission_decide,
   a reason, audited from -> to).

   HONEST WORDS. "Collected" is an invoice marked paid, by the day the money
   landed (paid_at, Malaysia time) - the rule the Paid tile and the Dashboard
   use; part payments are shown as part payments, never as collected. The
   closer is the invoice's salesperson. No commission figure appears: there
   is no approved policy yet, and a rate is never invented. */

import { useMemo, useState } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { api } from "@/lib/api";
import { dmy, fmtRM, mytDateOf } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, inputClass } from "@/lib/ui-styles";
import css from "./sales-workspace.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface WsDoc {
  id: number; doc_type: string; doc_number: string; company: string; total_cents: number;
  payment_status: string | null; created_at: string; paid_at?: string | null;
  salesperson_id?: number | null; salesperson_name?: string | null;
  converted_from?: number | null; invoiced_as?: string | null; valid_until?: string | null; customer_id?: number;
}
export interface WsFollowUp { id: number; customer_id: number; company: string; due_on: string; note: string | null; owner_id: number | null; owner_name: string | null }
export type WsScope = "mine" | "all";

const ymd = (ts?: string | null) => (ts ? mytDateOf(ts) : "");
/** The closer of an invoice is locked from its first recorded payment (the server's rule). */
export const closerLocked = (d: WsDoc, partPaid: Record<number, number>) =>
  d.doc_type === "INV" && (d.payment_status === "paid" || (partPaid[d.id] ?? 0) > 0);

function payState(d: WsDoc, partPaid: Record<number, number>): { label: string; chip: string } {
  if (d.payment_status === "paid") return { label: L("Paid", "Dibayar"), chip: "erp-chip-success" };
  const got = partPaid[d.id] ?? 0;
  if (got > 0) return { label: L(`Part paid · ${fmtRM(d.total_cents - got)} left`, `Bayar separa · baki ${fmtRM(d.total_cents - got)}`), chip: "erp-chip-warning" };
  return { label: L("Unpaid", "Belum dibayar"), chip: "erp-chip-neutral" };
}

/** Mine / Everyone - the screen's filter over records every sales role may already read. */
export function ScopeSwitch({ scope, onChange }: { scope: WsScope; onChange: (s: WsScope) => void }) {
  return (
    <div className={css.scope} role="group" aria-label={L("Whose sales", "Jualan siapa")}>
      {([["mine", L("Mine", "Saya")], ["all", L("Everyone", "Semua")]] as const).map(([k, label]) => (
        <button key={k} type="button" aria-pressed={scope === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

/* the month's money in, day by day, as a running total */
function CollectedTrend({ docs, monthKey, today }: { docs: WsDoc[]; monthKey: string; today: string }) {
  const days = new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0)).getUTCDate();
  const lastDay = today.startsWith(monthKey) ? Number(today.slice(8, 10)) : days;
  const perDay = Array.from({ length: days }, () => 0);
  for (const d of docs) {
    if (d.doc_type !== "INV" || d.payment_status !== "paid") continue;
    const day = ymd(d.paid_at ?? d.created_at);
    const i = Number(day.slice(8, 10)) - 1;
    if (day.startsWith(monthKey) && i >= 0 && i < days) perDay[i] = (perDay[i] ?? 0) + d.total_cents;
  }
  let run = 0;
  const cum = perDay.slice(0, lastDay).map((c) => (run += c));
  const total = run;
  const max = Math.max(1, ...cum);
  const W = 300, H = 120, P = 6;
  const x = (i: number) => P + (i / Math.max(1, days - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = cum.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = cum.length ? `${line}L${x(cum.length - 1).toFixed(1)} ${H - P}L${x(0).toFixed(1)} ${H - P}Z` : "";
  return (
    <section className={card} aria-label={L("Collected this month", "Dikutip bulan ini")}>
      <div className={css.head}>
        <PanelTitle icon="paid">{L("Collected this month", "Dikutip bulan ini")}</PanelTitle>
        <strong className={css.big}>{fmtRM(total)}</strong>
      </div>
      <p className={css.meta}>{L("Invoices marked paid, by the day the money landed. Part payments are not counted until the invoice is paid.", "Invois ditanda dibayar, ikut hari wang diterima. Bayaran separa tidak dikira sehingga invois dibayar.")}</p>
      {total === 0 ? <p className={css.empty}>{L("Nothing collected yet this month.", "Belum ada kutipan bulan ini.")}</p> : (
        <svg className={css.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={L(`Running total, ${fmtRM(total)} by day ${lastDay}`, `Jumlah berjalan, ${fmtRM(total)} pada hari ${lastDay}`)}>
          <line x1={P} x2={W - P} y1={H - P} y2={H - P} className={css.axis} />
          <path d={area} className={css.area} />
          <path d={line} className={css.line} />
          
        </svg>
      )}
      <div className={css.ticks} aria-hidden><span>1</span><span>{Math.ceil(days / 2)}</span><span>{days}</span></div>
    </section>
  );
}

/* where this month's quotations went */
function QuoteFunnel({ docs, partPaid, monthKey, today, onOpen }: { docs: WsDoc[]; partPaid: Record<number, number>; monthKey: string; today: string; onOpen: (q: string) => void }) {
  const invOf = new Map<number, WsDoc>();
  for (const d of docs) if (d.doc_type === "INV" && d.converted_from) invOf.set(d.converted_from, d);
  const qts = docs.filter((d) => d.doc_type === "QT" && ymd(d.created_at).startsWith(monthKey));
  const invoiced = qts.filter((q) => invOf.has(q.id) || q.invoiced_as);
  const paid = invoiced.filter((q) => invOf.get(q.id)?.payment_status === "paid");
  const part = invoiced.filter((q) => { const i = invOf.get(q.id); return i && i.payment_status !== "paid" && (partPaid[i.id] ?? 0) > 0; });
  const expired = qts.filter((q) => !invOf.has(q.id) && !q.invoiced_as && q.valid_until && q.valid_until.slice(0, 10) < today);
  const open = qts.length - invoiced.length - expired.length;
  const steps: [string, number, string | undefined][] = [
    [L("Raised", "Dikeluarkan"), qts.length, css.s1],
    [L("Still open", "Masih terbuka"), open, css.s2],
    [L("Invoiced", "Diinvois"), invoiced.length, css.s3],
    [L("Part paid", "Bayar separa"), part.length, css.s4],
    [L("Paid", "Dibayar"), paid.length, css.s5],
    [L("Expired", "Tamat tempoh"), expired.length, css.s6],
  ];
  return (
    <section className={card} aria-label={L("Quotations this month", "Sebut harga bulan ini")}>
      <div className={css.head}>
        <PanelTitle icon="document">{L("Quotations this month", "Sebut harga bulan ini")}</PanelTitle>
        <button type="button" className={btnSm} onClick={() => onOpen("QT")}>{L("Open quotations", "Buka sebut harga")}</button>
      </div>
      <p className={css.meta}>{L("Quotations raised this month and where each one is now.", "Sebut harga yang dikeluarkan bulan ini dan di mana setiap satu sekarang.")}</p>
      <ul className={css.funnel}>
        {steps.map(([label, n, tone]) => (
          <li key={label} className={tone ?? ""}><span className={css.fnN}>{n}</span><span className={css.fnL}>{label}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** Open follow-ups from the customer files: the next 7 days on the
    Overview, every open one on Customers & Follow-ups. */
export function FollowUps({ rows, today, onOpen, all = false }: { rows: WsFollowUp[]; today: string; onOpen: (f: WsFollowUp) => void; all?: boolean }) {
  const weekOut = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const due = rows.filter((f) => all || f.due_on <= weekOut).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const limit = all ? 50 : 6;
  return (
    <section className={card} aria-label={L("Follow-ups", "Susulan")}>
      <PanelTitle icon="date">{all ? L("Open follow-ups", "Susulan terbuka") : L("Follow-ups due", "Susulan perlu dibuat")}</PanelTitle>
      <p className={css.meta}>{all
        ? L("Every open follow-up in the customer files, soonest first. A row opens the customer's file, where it is marked done.", "Setiap susulan terbuka dalam fail pelanggan, yang terdekat dahulu. Satu baris membuka fail pelanggan, di mana ia ditanda selesai.")
        : L("Overdue, today and the next 7 days, from the customer files.", "Lewat, hari ini dan 7 hari akan datang, daripada fail pelanggan.")}</p>
      {due.length === 0 ? <p className={css.empty}>{all ? L("No open follow-ups.", "Tiada susulan terbuka.") : L("No follow-ups due in the next 7 days.", "Tiada susulan dalam 7 hari akan datang.")}</p> : (
        <ul className={css.list}>
          {due.slice(0, limit).map((f) => {
            const late = f.due_on < today, now = f.due_on === today;
            return (
              <li key={f.id}>
                <button type="button" className={css.row} onClick={() => onOpen(f)}>
                  <span className={css.rowMain}>
                    <span className={css.rowTitle}>{f.company}</span>
                    <span className={css.rowSub}>{f.note || L("Follow up", "Susulan")}{f.owner_name ? ` · ${f.owner_name}` : ""}</span>
                  </span>
                  <span className={`erp-chip erp-chip-sm ${late ? "erp-chip-danger" : now ? "erp-chip-warning" : "erp-chip-neutral"}`}>
                    {late ? L(`Overdue · ${dmy(f.due_on)}`, `Lewat · ${dmy(f.due_on)}`) : now ? L("Today", "Hari ini") : dmy(f.due_on)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {due.length > limit && <p className={css.meta}>{L(`+${due.length - limit} more in the customer files`, `+${due.length - limit} lagi dalam fail pelanggan`)}</p>}
    </section>
  );
}

function LatestInvoices({ docs, partPaid, onOpen, onAll }: { docs: WsDoc[]; partPaid: Record<number, number>; onOpen: (d: WsDoc) => void; onAll: () => void }) {
  const rows = docs.filter((d) => d.doc_type === "INV").sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 6);
  return (
    <section className={card} aria-label={L("Latest invoices and closers", "Invois terkini dan penutup")}>
      <div className={css.head}>
        <PanelTitle icon="documents">{L("Latest invoices & closers", "Invois terkini & penutup")}</PanelTitle>
        <button type="button" className={btnSm} onClick={onAll}>{L("Closed sales", "Jualan ditutup")}</button>
      </div>
      {rows.length === 0 ? <p className={css.empty}>{L("No invoices yet.", "Belum ada invois.")}</p> : (
        <ul className={css.list}>
          {rows.map((d) => {
            const ps = payState(d, partPaid);
            return (
              <li key={d.id}>
                <button type="button" className={css.row} onClick={() => onOpen(d)}>
                  <span className={css.rowMain}>
                    <span className={css.rowTitle}>{d.doc_number} · {d.company}</span>
                    <span className={css.rowSub}>
                      {L("Closer", "Penutup")}: {d.salesperson_name ?? L("not set", "belum ditetapkan")}
                      {closerLocked(d, partPaid) && <span className={css.lock} title={L("Locked after the first payment", "Dikunci selepas bayaran pertama")}><AppIcon name="lock" /></span>}
                    </span>
                  </span>
                  <span className={css.rowEnd}>
                    <span className="erp-num">{fmtRM(d.total_cents)}</span>
                    <span className={`erp-chip erp-chip-sm ${ps.chip}`}>{ps.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SalesOverviewCards(p: {
  docs: WsDoc[]; partPaid: Record<number, number>; followups: WsFollowUp[]; monthKey: string; today: string;
  onOpenDocs: (filter: "QT" | "INV") => void; onOpenDoc: (d: WsDoc) => void; onOpenCustomer: (f: WsFollowUp) => void; onClosed: () => void;
}) {
  return (
    <>
      <div className={css.grid2}>
        <CollectedTrend docs={p.docs} monthKey={p.monthKey} today={p.today} />
        <QuoteFunnel docs={p.docs} partPaid={p.partPaid} monthKey={p.monthKey} today={p.today} onOpen={() => p.onOpenDocs("QT")} />
      </div>
      <div className={css.grid2}>
        <FollowUps rows={p.followups} today={p.today} onOpen={p.onOpenCustomer} />
        <LatestInvoices docs={p.docs} partPaid={p.partPaid} onOpen={p.onOpenDoc} onAll={p.onClosed} />
      </div>
    </>
  );
}

/* ---- Closed sales: every invoice with money recorded, its closer and the
   quotation it came from; the CEO corrects a closer here ---- */
const PER = 15;
export function ClosedSales({ docs, partPaid, monthKey, canFix, staff, onOpenDoc, onFixed }: {
  docs: WsDoc[]; partPaid: Record<number, number>; monthKey: string; canFix: boolean;
  staff: { id: number; name: string }[]; onOpenDoc: (d: WsDoc) => void; onFixed: () => void;
}) {
  const [period, setPeriod] = useState<"month" | "last" | "all">("month");
  const [page, setPage] = useState(1);
  const [fix, setFix] = useState<WsDoc | null>(null);
  const lastKey = (() => { const d = new Date(`${monthKey}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const qtNo = useMemo(() => new Map(docs.filter((d) => d.doc_type === "QT").map((d) => [d.id, d.doc_number])), [docs]);
  const rows = docs
    .filter((d) => d.doc_type === "INV" && (d.payment_status === "paid" || (partPaid[d.id] ?? 0) > 0))
    .filter((d) => {
      if (period === "all") return true;
      const k = ymd(d.payment_status === "paid" ? d.paid_at ?? d.created_at : d.created_at).slice(0, 7);
      return k === (period === "month" ? monthKey : lastKey);
    })
    .sort((a, b) => (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at));
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const shown = rows.slice((Math.min(page, pages) - 1) * PER, Math.min(page, pages) * PER);
  const collected = rows.filter((d) => d.payment_status === "paid").reduce((a, d) => a + d.total_cents, 0);
  return (
    <section className={card} aria-label={L("Closed sales", "Jualan ditutup")}>
      <div className={css.head}>
        <div>
          <PanelTitle icon="paid">{L("Closed sales", "Jualan ditutup")}</PanelTitle>
          <p className={css.meta}>{L("Invoices with money recorded. The closer is locked from the first payment; only the CEO can correct it, with a reason.", "Invois dengan bayaran direkodkan. Penutup dikunci dari bayaran pertama; hanya CEO boleh membetulkannya, dengan sebab.")}</p>
        </div>
        <div className={css.periods} role="group" aria-label={L("Period", "Tempoh")}>
          {([["month", L("This month", "Bulan ini")], ["last", L("Last month", "Bulan lepas")], ["all", L("All", "Semua")]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={period === k} onClick={() => { setPeriod(k); setPage(1); }}>{label}</button>
          ))}
        </div>
      </div>
      <p className={css.sum}>{L(`${rows.length} invoice${rows.length === 1 ? "" : "s"} · ${fmtRM(collected)} collected (paid in full)`, `${rows.length} invois · ${fmtRM(collected)} dikutip (dibayar penuh)`)}</p>
      {rows.length === 0 ? <p className={css.empty}>{L("No closed sales in this period.", "Tiada jualan ditutup dalam tempoh ini.")}</p> : (
        <>
          <ul className={css.cards}>
            {shown.map((d) => {
              const ps = payState(d, partPaid);
              return (
                <li key={d.id} className={css.cardRow}>
                  <button type="button" className={css.cardOpen} onClick={() => onOpenDoc(d)}>
                    <span className={css.rowTitle}>{d.doc_number}</span>
                    <span className={`erp-chip erp-chip-sm ${ps.chip}`}>{ps.label}</span>
                  </button>
                  <span className={css.rowSub}>{d.company}{d.converted_from && qtNo.get(d.converted_from) ? ` · ${L("from", "dari")} ${qtNo.get(d.converted_from)}` : ""}</span>
                  <span className={css.cardMeta}>
                    <span>{L("Closer", "Penutup")}: <strong>{d.salesperson_name ?? L("not set", "belum ditetapkan")}</strong></span>
                    <span className="erp-num">{fmtRM(d.total_cents)}</span>
                  </span>
                  {canFix && <button type="button" className={btnSm} onClick={() => setFix(d)}>{L("Correct closer", "Betulkan penutup")}</button>}
                </li>
              );
            })}
          </ul>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead><tr>
                <th>{L("Invoice", "Invois")}</th><th>{L("Customer", "Pelanggan")}</th><th>{L("Quotation", "Sebut harga")}</th>
                <th>{L("Closer", "Penutup")}</th><th className={css.num}>{L("Total", "Jumlah")}</th><th>{L("Payment", "Bayaran")}</th><th>{L("Paid on", "Dibayar pada")}</th>
                {canFix && <th><span className="erp-sr-only">{L("Correct", "Betulkan")}</span></th>}
              </tr></thead>
              <tbody>
                {shown.map((d) => {
                  const ps = payState(d, partPaid);
                  return (
                    <tr key={d.id}>
                      <td><button type="button" className={css.link} onClick={() => onOpenDoc(d)}>{d.doc_number}</button></td>
                      <td>{d.company}</td>
                      <td>{d.converted_from && qtNo.get(d.converted_from) ? qtNo.get(d.converted_from) : <span className={css.dim}>—</span>}</td>
                      <td>{d.salesperson_name ?? <span className={css.dim}>{L("not set", "belum ditetapkan")}</span>} <span className={css.lock} title={L("Locked after the first payment", "Dikunci selepas bayaran pertama")}><AppIcon name="lock" /></span></td>
                      <td className={`${css.num} erp-num`}>{fmtRM(d.total_cents)}</td>
                      <td><span className={`erp-chip erp-chip-sm ${ps.chip}`}>{ps.label}</span></td>
                      <td className="erp-num">{d.payment_status === "paid" && d.paid_at ? dmy(ymd(d.paid_at)) : <span className={css.dim}>—</span>}</td>
                      {canFix && <td><button type="button" className={btnSm} onClick={() => setFix(d)}>{L("Correct closer", "Betulkan penutup")}</button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className={css.pager} aria-label={L("Pages", "Halaman")}>
              <button type="button" className={btnSm} disabled={page <= 1} onClick={() => setPage((x) => Math.max(1, x - 1))}>{L("Previous", "Sebelum")}</button>
              <span className="erp-meta">{L(`Page ${Math.min(page, pages)} of ${pages}`, `Halaman ${Math.min(page, pages)} daripada ${pages}`)}</span>
              <button type="button" className={btnSm} disabled={page >= pages} onClick={() => setPage((x) => Math.min(pages, x + 1))}>{L("Next", "Seterusnya")}</button>
            </nav>
          )}
        </>
      )}
      {canFix && <CloserFix doc={fix} staff={staff} onClose={() => setFix(null)} onDone={() => { setFix(null); onFixed(); }} />}
    </section>
  );
}

/** The CEO's correction: who closed it, and why. The server keeps the trail. */
function CloserFix({ doc, staff, onClose, onDone }: { doc: WsDoc | null; staff: { id: number; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const close = () => { setTo(0); setReason(""); setMsg(""); onClose(); };
  const save = async () => {
    if (!doc || busy) return;
    setBusy(true); setMsg("");
    const r = await api<{ error?: { message?: string } }>(`/staff/docs/${doc.id}/closer`, {
      method: "POST", body: JSON.stringify({ salesperson_id: to, from_salesperson_id: doc.salesperson_id ?? 0, reason }),
    });
    setBusy(false);
    if (r.ok) { setTo(0); setReason(""); onDone(); }
    else setMsg(r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The correction was not saved.", "Pembetulan tidak disimpan."));
  };
  return (
    <SideDrawer open={!!doc} onClose={close} title={L("Correct the closer", "Betulkan penutup")} subtitle={doc ? `${doc.doc_number} · ${doc.company}` : undefined}
      footer={<div className={css.drawerFoot}>
        <button type="button" className={btnSm} onClick={close}>{L("Cancel", "Batal")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || !to || reason.trim().length < 10} onClick={() => void save()}>{busy ? L("Saving…", "Menyimpan…") : L("Save correction", "Simpan pembetulan")}</button>
      </div>}>
      {doc && (
        <div className={css.drawer}>
          <p>{L("Now credited to", "Kini dikreditkan kepada")}: <strong>{doc.salesperson_name ?? L("not set", "belum ditetapkan")}</strong></p>
          <label className={css.field}>
            <span>{L("The person who closed this sale", "Orang yang menutup jualan ini")}</span>
            <select className={inputClass} value={to} onChange={(e) => setTo(Number(e.target.value))}>
              <option value={0}>{L("Choose…", "Pilih…")}</option>
              {staff.filter((s) => s.id !== doc.salesperson_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className={css.field}>
            <span>{L("Reason (kept in the audit trail)", "Sebab (disimpan dalam jejak audit)")}</span>
            <textarea className={inputClass} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={L("What the review found", "Apa yang didapati semakan")} />
          </label>
          <p className={css.meta}>{L("The invoice, its total and its payments do not change. The old and new closer, your name and the reason are recorded.", "Invois, jumlah dan bayarannya tidak berubah. Penutup lama dan baharu, nama anda dan sebab direkodkan.")}</p>
          {msg && <p className="erp-note erp-note-warning" role="alert">{msg}</p>}
        </div>
      )}
    </SideDrawer>
  );
}
