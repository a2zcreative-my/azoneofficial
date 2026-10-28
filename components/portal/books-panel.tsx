"use client";

/**
 * v1.181.15 - THE BOOKS (ERP roadmap, phase 3), on the Accounting tab.
 *
 * Three panes, one card:
 *
 *   Month end  - the last six months, each with the figures the portal's own
 *                screens already compute (invoiced, received, part payments,
 *                expenses, stock received, payroll net). Closing a month that
 *                has ended keeps a copy of those figures. It locks nothing:
 *                every screen and save works exactly as before. What it buys
 *                is the accountant's first question - "has anything in that
 *                month changed since you closed it?" - answered beside the
 *                month, figure by figure. Reopen needs a reason.
 *   Position   - who owes us (unpaid invoices less part payments), whom we
 *                owe (supplier bills not yet paid, from Receive stock), and
 *                what the shelf is worth at each item's unit cost.
 *   Audit      - the audit trail, for the CEO and super admin only. The
 *                pane appears only when the server answers it.
 *
 * Everything here reads, except a close or reopen, which writes to
 * period_closes only.
 */

import { useEffect, useState } from "react";

import { SectionTabs } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { rowBtn } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, card, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type FigKey = "invoiced_cents" | "received_cents" | "part_payments_cents" | "expenses_cents" | "stock_received_cents" | "payroll_net_cents" | "documents" | "gl_income_cents" | "gl_expense_cents" | "gl_entries";
type Figures = Record<FigKey, number>;
interface Month {
  month: string; figures: Figures;
  closed: { id: number; at: string; by: string | null; note: string | null } | null;
  changed_since_close: Partial<Figures> | null;
  history: { id: number; at: string; by: string | null; reopened_at: string | null; reopen_reason: string | null }[];
}
interface Debtor { id: number; doc_number: string; company: string | null; total_cents: number; created_at: string; due_date: string | null; received_cents: number; balance_cents: number }
interface Creditor { id: number; supplier: string; received_on: string; bill_due_on: string; total_cents: number }
interface StockCat { category: string; items: number; units: number; value_cents: number; uncosted: number }
interface Position { as_of: string; debtors: Debtor[]; debtors_cents: number; creditors: Creditor[]; creditors_cents: number; stock: StockCat[]; stock_value_cents: number; uncosted_items: number }
interface AuditRow { id: number; action: string; entity: string | null; entity_id: string | null; detail: string | null; created_at: string; who: string | null }
interface Audit { rows: AuditRow[]; areas: { area: string; n: number }[] }

const FIGS: [FigKey, string, string][] = [
  ["invoiced_cents", "Invoiced", "Diinvois"],
  ["received_cents", "Received (marked paid)", "Diterima (ditanda dibayar)"],
  ["part_payments_cents", "Part payments", "Bayaran separa"],
  ["expenses_cents", "Expenses", "Perbelanjaan"],
  ["stock_received_cents", "Stock received", "Stok diterima"],
  ["payroll_net_cents", "Payroll net", "Gaji bersih"],
  ["documents", "Documents", "Dokumen"],
  /* v1.222.0 - the ledger's own month (Accounting 2.0, "Soft control") */
  ["gl_income_cents", "Ledger income", "Pendapatan lejar"],
  ["gl_expense_cents", "Ledger expense", "Perbelanjaan lejar"],
  ["gl_entries", "Journal entries", "Catatan jurnal"],
];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const monthName = (m: string) => `${(getLang() === "ms" ? MONTHS_MS : MONTHS_EN)[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;
const fig = (k: FigKey, v: number) => (k === "documents" || k === "gl_entries" ? String(v) : fmtRM(v ?? 0));
const signed = (k: FigKey, v: number) => `${v > 0 ? "+" : "-"}${fig(k, Math.abs(v))}`;
const inv = (d: Debtor) => d.doc_number || `#${d.id}`;

export function BooksPanel() {
  const [tab, setTab] = useState<"months" | "position" | "audit">("months");
  const [months, setMonths] = useState<{ months: Month[]; current_month: string } | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [auditAllowed, setAuditAllowed] = useState(false);
  const [tick, setTick] = useState(0);
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();

  useEffect(() => {
    let live = true;
    void api<{ months: Month[]; current_month: string }>(`/staff/books/months`).then((r) => { if (live && r.ok && r.data) setMonths(r.data); });
    void api<Position>(`/staff/books/position`).then((r) => { if (live && r.ok && r.data) setPos(r.data); });
    return () => { live = false; };
  }, [tick]);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams();
    if (area) qs.set("action", area);
    if (qApplied) qs.set("q", qApplied);
    void api<Audit>(`/staff/books/audit${qs.toString() ? `?${qs.toString()}` : ""}`).then((r) => {
      if (!live) return;
      setAuditAllowed(r.ok);
      if (r.ok && r.data) setAudit(r.data);
    });
    return () => { live = false; };
  }, [area, qApplied]);

  const close = async (m: Month) => {
    const got = await prompt({
      title: L(`Close ${monthName(m.month)}?`, `Tutup ${monthName(m.month)}?`),
      message: L("The month's figures are kept as they stand now. Nothing is locked: if anything dated in the month changes later, it shows here as a difference.",
        "Angka bulan ini disimpan seperti sekarang. Tiada yang dikunci: jika apa-apa bertarikh dalam bulan ini berubah kemudian, ia dipaparkan di sini sebagai perbezaan."),
      label: L("Note (optional)", "Catatan (pilihan)"), confirmLabel: L("Close month", "Tutup bulan"),
    });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/books/close`, { method: "POST", body: JSON.stringify({ month: m.month, note: got.value || undefined }) });
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not closed", "Tidak ditutup"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L(`${monthName(m.month)} closed`, `${monthName(m.month)} ditutup`));
    setTick((t) => t + 1);
  };

  const reopen = async (m: Month) => {
    const got = await prompt({
      title: L(`Reopen ${monthName(m.month)}?`, `Buka semula ${monthName(m.month)}?`),
      message: L("The close stays on record, marked reopened. Close the month again when it is right.", "Penutupan kekal direkod, ditanda dibuka semula. Tutup semula bulan ini apabila ia betul."),
      label: L("Reason", "Sebab"), required: true, confirmLabel: L("Reopen month", "Buka semula bulan"), variant: "danger",
    });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/books/reopen`, { method: "POST", body: JSON.stringify({ month: m.month, reason: got.value }) });
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not reopened", "Tidak dibuka semula"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L(`${monthName(m.month)} reopened`, `${monthName(m.month)} dibuka semula`));
    setTick((t) => t + 1);
  };

  if (!months) return <div className={card}><SkelRows rows={5} /></div>;

  const tabs: (readonly ["months" | "position" | "audit", string])[] = [
    ["months", L("Month end", "Hujung bulan")],
    ["position", L("Position", "Kedudukan")],
  ];
  if (auditAllowed) tabs.push(["audit", L("Audit trail", "Jejak audit")]);

  return (
    <div className={card}>
      {promptNode}{toastNode}
      <SectionTabs value={tab} onChange={setTab} tabs={tabs} />

      <div className={`${css.stack} erp-mt-3`} hidden={tab !== "months"}>
        <p className={css.hiddenNote}>
          {L("Closing a month keeps a copy of its figures. Nothing is locked - every screen works as before - and any later change to that month shows beside it.",
            "Menutup bulan menyimpan salinan angkanya. Tiada yang dikunci - setiap skrin berfungsi seperti biasa - dan sebarang perubahan kemudian pada bulan itu dipaparkan di sebelahnya.")}
        </p>
        <ul className={css.list} aria-label={L("Months", "Bulan")}>
          {months.months.map((m) => {
            const changes = m.changed_since_close ? (Object.entries(m.changed_since_close) as [FigKey, number][]) : [];
            const current = m.month === months.current_month;
            return (
              <li key={m.month} className={css.monthRow}>
                <div className={css.monthHead}>
                  <span className={css.whatTitle}>{monthName(m.month)}</span>
                  {current ? <span className={chipSmNeutral}>{L("in progress", "sedang berjalan")}</span>
                    : m.closed ? <span className={changes.length ? chipSmWarn : chipSmSuccess}>{changes.length ? L("changed since close", "berubah selepas ditutup") : L("closed", "ditutup")}</span>
                      : <span className={chipSmNeutral}>{L("open", "terbuka")}</span>}
                  {m.closed && <span className={css.whatDetail}>{L(`closed ${dmyMYT(m.closed.at)}${m.closed.by ? ` by ${m.closed.by}` : ""}`, `ditutup ${dmyMYT(m.closed.at)}${m.closed.by ? ` oleh ${m.closed.by}` : ""}`)}{m.closed.note ? ` · ${m.closed.note}` : ""}</span>}
                  <span className={css.monthActions}>
                    {!current && !m.closed && <button type="button" className={rowBtn} onClick={() => void close(m)}>{L("Close month", "Tutup bulan")}</button>}
                    {m.closed && <button type="button" className={rowBtn} onClick={() => void reopen(m)}>{L("Reopen", "Buka semula")}</button>}
                  </span>
                </div>
                <div className={css.figures}>
                  {FIGS.map(([k, en, ms]) => (
                    <span key={k} className={css.figure}><span className={css.figureLabel}>{L(en, ms)}</span>{fig(k, m.figures[k])}</span>
                  ))}
                </div>
                {changes.length > 0 && (
                  <p className="erp-note erp-note-warning">
                    {L("Since it was closed: ", "Sejak ditutup: ")}
                    {changes.map(([k, v]) => `${L(FIGS.find((f) => f[0] === k)?.[1] ?? k, FIGS.find((f) => f[0] === k)?.[2] ?? k)} ${signed(k, v)}`).join(" · ")}
                  </p>
                )}
                {m.history.some((h) => h.reopened_at) && (
                  <span className={css.whatDetail}>
                    {m.history.filter((h) => h.reopened_at).map((h) => L(`reopened ${dmyMYT(h.reopened_at)}: ${h.reopen_reason ?? ""}`, `dibuka semula ${dmyMYT(h.reopened_at)}: ${h.reopen_reason ?? ""}`)).join(" · ")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className={`${css.stack} erp-mt-3`} hidden={tab !== "position"}>
        {!pos ? <SkelRows rows={4} /> : (
          <>
            <div className={css.figures}>
              <span className={css.figure}><span className={css.figureLabel}>{L("Customers owe", "Pelanggan berhutang")}</span>{fmtRM(pos.debtors_cents)}</span>
              <span className={css.figure}><span className={css.figureLabel}>{L("We owe suppliers", "Kita berhutang pembekal")}</span>{fmtRM(pos.creditors_cents)}</span>
              <span className={css.figure}><span className={css.figureLabel}>{L("Stock at cost", "Stok pada kos")}</span>{fmtRM(pos.stock_value_cents)}</span>
              <span className={css.figure}><span className={css.figureLabel}>{L("As of", "Setakat")}</span>{dmy(pos.as_of)}</span>
            </div>
            <p className={css.hiddenNote}>
              {L("Customers owe: unpaid invoices less part payments. We owe: supplier bills recorded on Receive stock and not yet marked paid. Stock: each item's units times its unit cost.",
                "Pelanggan berhutang: invois belum dibayar tolak bayaran separa. Kita berhutang: bil pembekal yang direkod di Terima stok dan belum ditanda dibayar. Stok: unit setiap barang darab kos seunitnya.")}
            </p>

            <p className={css.sub}>{L("Customers owe", "Pelanggan berhutang")} · {pos.debtors.filter((d) => d.balance_cents > 0).length}</p>
            {pos.debtors.length === 0 ? <p className={css.empty}>{L("No unpaid invoices.", "Tiada invois belum dibayar.")}</p> : (
              <ul className={css.list} aria-label={L("Unpaid invoices", "Invois belum dibayar")}>
                {pos.debtors.filter((d) => d.balance_cents > 0).map((d) => (
                  <li key={d.id} className={css.tlItem}>
                    <span className={css.when}>{dmyMYT(d.created_at).slice(0, 10)}</span>
                    <span className={css.what}><span className={css.whatTitle}>{inv(d)} · {d.company ?? L("No customer", "Tiada pelanggan")}</span>
                      {(d.received_cents > 0 || d.due_date) && (
                        <span className={css.whatDetail}>{[d.due_date ? L(`due ${dmy(d.due_date)}`, `perlu dibayar ${dmy(d.due_date)}`) : null,
                          d.received_cents > 0 ? L(`${fmtRM(d.received_cents)} of ${fmtRM(d.total_cents)} received`, `${fmtRM(d.received_cents)} daripada ${fmtRM(d.total_cents)} diterima`) : null].filter(Boolean).join(" · ")}</span>
                      )}
                    </span>
                    <span className={css.amount}>{fmtRM(d.balance_cents)}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className={css.sub}>{L("We owe suppliers", "Kita berhutang pembekal")} · {pos.creditors.length}</p>
            {pos.creditors.length === 0 ? <p className={css.empty}>{L("No supplier bills waiting.", "Tiada bil pembekal menunggu.")}</p> : (
              <ul className={css.list} aria-label={L("Supplier bills waiting", "Bil pembekal menunggu")}>
                {pos.creditors.map((c) => (
                  <li key={c.id} className={css.tlItem}>
                    <span className={css.when}>{dmy(c.bill_due_on)}</span>
                    <span className={css.what}><span className={css.whatTitle}>GRN-{String(c.id).padStart(5, "0")} · {c.supplier}</span>
                      <span className={css.whatDetail}>{L(`received ${dmy(c.received_on)}`, `diterima ${dmy(c.received_on)}`)}</span></span>
                    <span className={css.amount}>{fmtRM(c.total_cents)}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className={css.sub}>{L("Stock at cost", "Stok pada kos")}</p>
            {pos.stock.length === 0 ? <p className={css.empty}>{L("No stock on the shelf.", "Tiada stok.")}</p> : (
              <ul className={css.list} aria-label={L("Stock value by category", "Nilai stok mengikut kategori")}>
                {pos.stock.map((s) => (
                  <li key={s.category} className={css.item}>
                    <span className={css.what}><span className={css.whatTitle}>{s.category}</span>
                      <span className={css.whatDetail}>{L(`${s.items} items · ${s.units} units`, `${s.items} barang · ${s.units} unit`)}{s.uncosted ? L(` · ${s.uncosted} without a unit cost`, ` · ${s.uncosted} tanpa kos seunit`) : ""}</span></span>
                    <span className={css.amount}>{fmtRM(s.value_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {pos.uncosted_items > 0 && (
              <p className={css.hiddenNote}>{L(`${pos.uncosted_items} item(s) on the shelf have no unit cost, so they count as RM 0.00 here. Set a cost on Inventory, or receive them with a cost.`,
                `${pos.uncosted_items} barang dalam stok tiada kos seunit, jadi dikira RM 0.00 di sini. Tetapkan kos di Inventori, atau terima dengan kos.`)}</p>
            )}
          </>
        )}
      </div>

      {auditAllowed && (
        <div className={`${css.stack} erp-mt-3`} hidden={tab !== "audit"}>
          <div className={css.form}>
            <label className={css.field}>{L("Area", "Bahagian")}
              <select className={selectClassSm} value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">{L("Everything", "Semua")}</option>
                {(audit?.areas ?? []).map((a) => <option key={a.area} value={a.area}>{a.area} ({a.n})</option>)}
              </select>
            </label>
            <label className={css.field}>{L("Record or detail contains", "Rekod atau butiran mengandungi")}
              <input className={inputClassSm} value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setQApplied(q.trim()); }} />
            </label>
            <button type="button" className={btnSm} onClick={() => setQApplied(q.trim())}>{L("Search", "Cari")}</button>
          </div>
          <p className={css.hiddenNote}>{L("The latest 100 actions that match, newest first. Area counts are for the last 90 days.", "100 tindakan terkini yang sepadan, terbaru dahulu. Kiraan bahagian untuk 90 hari lepas.")}</p>
          {!audit ? <SkelRows rows={5} /> : audit.rows.length === 0 ? <p className={css.empty}>{L("Nothing matches.", "Tiada yang sepadan.")}</p> : (
            <ul className={css.list} aria-label={L("Audit trail", "Jejak audit")}>
              {audit.rows.map((a) => (
                <li key={a.id} className={css.tlItem}>
                  <span className={css.when}>{dmyMYT(a.created_at)}</span>
                  <span className={css.what}>
                    <span className={css.whatTitle}>{a.action}</span>
                    <span className={css.whatDetail}>{[a.who ?? L("system", "sistem"), a.entity ? `${a.entity}${a.entity_id ? ` ${a.entity_id}` : ""}` : null].filter(Boolean).join(" · ")}</span>
                    {a.detail && <span className={css.detailText}>{a.detail}</span>}
                  </span>
                  <span />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
