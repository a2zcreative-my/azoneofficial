"use client";

/**
 * v1.181.14 - RECEIVE STOCK (ERP roadmap, phase 2).
 *
 * The owner, 20-10-2026: Purchasing stays retired; stock comes in through a
 * form on Inventory. A receipt names the supplier, the day it arrived and its
 * lines. Each line raises the shelf through the same manual movement log a
 * manual stock in writes (it shows in "What moved" as a restock), and - only
 * if the box is ticked - moves the item's unit cost to the moving average. A
 * supplier bill with a due date is optional and is recorded on the receipt
 * only: no expense, no cash entry, so Finance reads exactly as before.
 *
 * Three panes, one card: Receive (the form), Received (the log, with the
 * bill and void), Reorder (levels you choose per item, and what is under
 * them now). A reorder level is a note to yourself; it changes no alert.
 */

import { useEffect, useMemo, useState } from "react";

import { SectionTabs } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { rowBtn } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, inputClassSm, selectClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface ReceiveItem { id: number; sku: string; name: string; stock: number; unit_cost_cents?: number | null; status?: string }
interface Receipt {
  id: number; supplier: string; received_on: string; reference: string | null; note: string | null; total_cents: number;
  bill_due_on: string | null; bill_paid_on: string | null; voided_at: string | null; void_reason: string | null;
  received_by: string | null; lines: number;
}
interface Level { id: number; sku: string; name: string; stock: number; reorder_level: number; reorder_qty: number | null; unit_cost_cents?: number | null }
interface Feed { receipts: Receipt[]; reorder: Level[]; levels: Level[]; suppliers: string[]; can_write: boolean; pending_migration?: boolean }
interface Line { item_id: string; qty: string; cost: string }

const grn = (id: number) => `GRN-${String(id).padStart(5, "0")}`;
const emptyLine = (): Line => ({ item_id: "", qty: "", cost: "" });
const toCents = (rm: string) => Math.round(Number(rm.replace(/,/g, "")) * 100);

export function StockReceive({ items, onStockChanged }: { items: ReceiveItem[]; onStockChanged?: () => void }) {
  const [tab, setTab] = useState<"receive" | "received" | "reorder">("receive");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();

  useEffect(() => {
    let live = true;
    void api<Feed>(`/staff/inventory/receipts`).then((r) => { if (live && r.ok && r.data) setFeed(r.data); });
    return () => { live = false; };
  }, [tick]);

  /* ---- the form ---- */
  const [supplier, setSupplier] = useState("");
  const [on, setOn] = useState(mytToday());
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [updateCost, setUpdateCost] = useState(true);
  const [billDue, setBillDue] = useState("");
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => [...items].filter((i) => i.status !== "discontinued").sort((a, b) => a.sku.localeCompare(b.sku)), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [String(i.id), i])), [items]);
  const total = lines.reduce((a, l) => a + (Number(l.qty) > 0 && l.cost ? toCents(l.cost) * Number(l.qty) : 0), 0);

  const save = async () => {
    const filled = lines.filter((l) => l.item_id || l.qty || l.cost);
    if (!supplier.trim() || filled.length === 0) {
      toast(L("No changes", "Tiada perubahan"), L("Enter the supplier and at least one line.", "Masukkan pembekal dan sekurang-kurangnya satu baris."), "notice");
      return;
    }
    setBusy(true);
    const r = await api<{ grn?: string; total_cents?: number; error?: { message?: string } }>(`/staff/inventory/receipts`, {
      method: "POST",
      body: JSON.stringify({
        supplier: supplier.trim(), received_on: on, reference: ref.trim() || undefined, update_cost: updateCost,
        bill_due_on: billDue || undefined,
        lines: filled.map((l) => ({ item_id: Number(l.item_id), qty: Number(l.qty), unit_cost_cents: l.cost ? toCents(l.cost) : 0 })),
      }),
    });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not received - try again", "Tidak diterima - cuba lagi"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L(`${r.data?.grn} received - stock is up`, `${r.data?.grn} diterima - stok bertambah`));
    setLines([emptyLine()]); setRef(""); setBillDue("");
    reload(); onStockChanged?.();
  };

  const voidReceipt = async (x: Receipt) => {
    const got = await prompt({
      title: L(`Void ${grn(x.id)} from ${x.supplier}?`, `Batalkan ${grn(x.id)} daripada ${x.supplier}?`),
      message: L("Its stock goes back out as a correction and the receipt stays on record, voided.", "Stoknya dikeluarkan semula sebagai pembetulan dan resit kekal direkod, dibatalkan."),
      label: L("Reason", "Sebab"), required: true, confirmLabel: L("Void receipt", "Batalkan resit"), variant: "danger",
    });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/inventory/receipts/${x.id}/void`, { method: "POST", body: JSON.stringify({ reason: got.value }) });
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not voided", "Tidak dibatalkan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L(`${grn(x.id)} voided`, `${grn(x.id)} dibatalkan`));
    reload(); onStockChanged?.();
  };

  const billPaid = async (x: Receipt) => {
    const got = await prompt({
      title: L(`Supplier paid for ${grn(x.id)}`, `Pembekal dibayar untuk ${grn(x.id)}`),
      message: L("This marks the bill paid on this receipt only. Record the payment in Finance as you do today.", "Ini menanda bil dibayar pada resit ini sahaja. Rekod bayaran di Kewangan seperti biasa."),
      text: false, date: { label: L("Paid on", "Dibayar pada"), initial: mytToday(), max: mytToday(), required: true },
      confirmLabel: L("Mark bill paid", "Tanda bil dibayar"),
    });
    if (!got) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/inventory/receipts/${x.id}/bill`, { method: "POST", body: JSON.stringify({ paid_on: got.date }) });
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not saved", "Tidak disimpan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L("Supplier bill marked paid", "Bil pembekal ditanda dibayar"));
    reload();
  };

  /* ---- reorder levels ---- */
  const [lvItem, setLvItem] = useState("");
  const [lvLevel, setLvLevel] = useState("");
  const [lvQty, setLvQty] = useState("");
  const saveLevel = async (clear = false) => {
    if (!lvItem) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/inventory/${lvItem}/reorder`, {
      method: "PUT",
      body: JSON.stringify(clear ? { reorder_level: null, reorder_qty: null } : { reorder_level: Number(lvLevel), reorder_qty: lvQty ? Number(lvQty) : null }),
    });
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not saved", "Tidak disimpan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), clear ? L("Reorder level cleared", "Paras pesanan semula dikosongkan") : L("Reorder level saved", "Paras pesanan semula disimpan"));
    setLvLevel(""); setLvQty("");
    reload();
  };

  if (!feed) return <div className={card}><SkelRows rows={4} /></div>;
  if (feed.pending_migration) {
    return <div className={card}><p className="erp-note erp-note-warning">{L("Receiving stock needs the 0141 database update. It is applied by the next PUSH.bat.", "Penerimaan stok memerlukan kemas kini pangkalan data 0141. Ia dipasang oleh PUSH.bat seterusnya.")}</p></div>;
  }

  return (
    <div className={card}>
      {promptNode}{toastNode}
      <SectionTabs value={tab} onChange={setTab} tabs={[
        ["receive", L("Receive", "Terima")],
        ["received", `${L("Received", "Diterima")} · ${feed.receipts.filter((x) => !x.voided_at).length}`],
        ["reorder", `${L("Reorder", "Pesan semula")}${feed.reorder.length ? ` · ${feed.reorder.length}` : ""}`],
      ] as const} />

      <div className={`${css.stack} erp-mt-3`} hidden={tab !== "receive"}>
        <p className={css.hiddenNote}>
          {L("Stock that arrived from a supplier. Each line raises the shelf and shows in What moved as a restock. Purchase orders are not used.",
            "Stok yang tiba daripada pembekal. Setiap baris menambah stok dan dipaparkan dalam Apa yang bergerak sebagai stok semula. Pesanan belian tidak digunakan.")}
        </p>
        <div className={css.form}>
          <label className={css.field}>{L("Supplier", "Pembekal")}
            <input className={inputClassSm} list="rcv-suppliers" value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} placeholder={L("e.g. Kilang Tudung Sdn Bhd", "cth. Kilang Tudung Sdn Bhd")} />
            <datalist id="rcv-suppliers">{feed.suppliers.map((sp) => <option key={sp} value={sp} />)}</datalist>
          </label>
          <label className={css.field}>{L("Arrived on", "Tiba pada")}
            <input className={inputClassSm} type="date" value={on} max={mytToday()} onChange={(e) => setOn(e.target.value)} />
          </label>
          <label className={css.field}>{L("Supplier's DO / invoice no. (optional)", "No. DO / invois pembekal (pilihan)")}
            <input className={inputClassSm} value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} />
          </label>
        </div>
        <ul className={css.list} aria-label={L("Lines received", "Baris diterima")}>
          {lines.map((l, i) => {
            const it = byId.get(l.item_id);
            return (
              <li key={i} className={css.rcvLine}>
                <label className={css.field}>{L("Item", "Barang")}
                  <select className={selectClassSm} value={l.item_id} onChange={(e) => setLines((ls) => ls.map((x, xi) => xi === i ? { ...x, item_id: e.target.value } : x))}>
                    <option value="">{L("- pick an item -", "- pilih barang -")}</option>
                    {sorted.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name} ({s.stock})</option>)}
                  </select>
                </label>
                <label className={css.field}>{L("Qty", "Kuantiti")}
                  <input className={inputClassSm} inputMode="numeric" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, xi) => xi === i ? { ...x, qty: e.target.value.replace(/\D/g, "") } : x))} />
                </label>
                <label className={css.field}>{L("Unit cost (RM)", "Kos seunit (RM)")}
                  <input className={inputClassSm} inputMode="decimal" value={l.cost} placeholder={it?.unit_cost_cents != null ? (it.unit_cost_cents / 100).toFixed(2) : "0.00"}
                    onChange={(e) => setLines((ls) => ls.map((x, xi) => xi === i ? { ...x, cost: e.target.value } : x))} />
                </label>
                {lines.length > 1 && (
                  <button type="button" className={rowBtn} aria-label={L(`Remove line ${i + 1}`, `Buang baris ${i + 1}`)} onClick={() => setLines((ls) => ls.filter((_, xi) => xi !== i))}>×</button>
                )}
              </li>
            );
          })}
        </ul>
        <div className={css.figures}>
          <button type="button" className={btnSm} disabled={lines.length >= 30} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ {L("Add line", "Tambah baris")}</button>
          <span className={css.figure}><span className={css.figureLabel}>{L("Total cost", "Jumlah kos")}</span>{fmtRM(total)}</span>
        </div>
        <label className={css.check}>
          <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
          {L("Update each item's unit cost to the average of what was on the shelf and what arrived",
            "Kemas kini kos seunit setiap barang kepada purata stok sedia ada dan yang tiba")}
        </label>
        <div className={css.form}>
          <label className={css.field}>{L("Supplier bill due on (optional - leave empty if already paid)", "Bil pembekal perlu dibayar pada (pilihan - kosongkan jika sudah dibayar)")}
            <input className={inputClassSm} type="date" value={billDue} onChange={(e) => setBillDue(e.target.value)} />
          </label>
          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void save()}>{L("Receive stock", "Terima stok")}</button>
        </div>
      </div>

      <div className={`${css.stack} erp-mt-3`} hidden={tab !== "received"}>
        {feed.receipts.length === 0 ? <p className={css.empty}>{L("No stock received through this form yet.", "Belum ada stok diterima melalui borang ini.")}</p> : (
          <ul className={css.list} aria-label={L("Stock received", "Stok diterima")}>
            {feed.receipts.map((x) => (
              <li key={x.id} className={`${css.item} ${x.voided_at ? css.voided : ""}`}>
                <span className={css.when}>{dmy(x.received_on)}</span>
                <span className={css.what}>
                  <span className={css.whatTitle}>{grn(x.id)} · {x.supplier}</span>
                  <span className={css.whatDetail}>
                    {x.voided_at ? L(`voided - ${x.void_reason ?? ""}`, `dibatalkan - ${x.void_reason ?? ""}`)
                      : [`${x.lines} ${L(x.lines === 1 ? "line" : "lines", "baris")}`, x.reference, x.received_by,
                        x.bill_due_on ? (x.bill_paid_on ? L(`bill paid ${dmy(x.bill_paid_on)}`, `bil dibayar ${dmy(x.bill_paid_on)}`) : L(`bill due ${dmy(x.bill_due_on)}`, `bil perlu dibayar ${dmy(x.bill_due_on)}`)) : null,
                      ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={css.amount}>{fmtRM(x.total_cents)}</span>
                {!x.voided_at && x.bill_due_on && !x.bill_paid_on && (
                  <button type="button" className={rowBtn} onClick={() => void billPaid(x)}>{L("Bill paid", "Bil dibayar")}</button>
                )}
                {!x.voided_at && <button type="button" className={rowBtn} onClick={() => void voidReceipt(x)}>{L("Void", "Batal")}</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`${css.stack} erp-mt-3`} hidden={tab !== "reorder"}>
        <p className={css.hiddenNote}>
          {L("A reorder level is your own line for an item. It lists the item here when stock falls to it; the low stock alert stays as it is.",
            "Paras pesanan semula ialah garisan anda sendiri untuk sesuatu barang. Ia menyenaraikan barang di sini apabila stok jatuh kepadanya; amaran stok rendah kekal seperti biasa.")}
        </p>
        {feed.reorder.length > 0 ? (
          <ul className={css.list} aria-label={L("At or under the reorder level", "Pada atau bawah paras pesanan semula")}>
            {feed.reorder.map((r) => (
              <li key={r.id} className={css.item}>
                <span className={css.what}><span className={css.whatTitle}>{r.sku} · {r.name}</span>
                  <span className={css.whatDetail}>{L(`${r.stock} on the shelf, level ${r.reorder_level}`, `${r.stock} dalam stok, paras ${r.reorder_level}`)}</span></span>
                {r.reorder_qty ? <span className={css.amount}>{L(`order ${r.reorder_qty}`, `pesan ${r.reorder_qty}`)}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className={css.empty}>{L("Nothing is at or under its reorder level.", "Tiada barang pada atau bawah paras pesanan semula.")}</p>}
        <div className={css.form}>
          <label className={css.field}>{L("Item", "Barang")}
            <select className={selectClassSm} value={lvItem} onChange={(e) => {
              setLvItem(e.target.value);
              const cur = feed.levels.find((x) => String(x.id) === e.target.value);
              setLvLevel(cur ? String(cur.reorder_level) : ""); setLvQty(cur?.reorder_qty ? String(cur.reorder_qty) : "");
            }}>
              <option value="">{L("- pick an item -", "- pilih barang -")}</option>
              {sorted.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name}</option>)}
            </select>
          </label>
          <label className={css.field}>{L("Reorder when stock is at", "Pesan semula apabila stok")}
            <input className={inputClassSm} inputMode="numeric" value={lvLevel} onChange={(e) => setLvLevel(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className={css.field}>{L("Usual order quantity (optional)", "Kuantiti pesanan biasa (pilihan)")}
            <input className={inputClassSm} inputMode="numeric" value={lvQty} onChange={(e) => setLvQty(e.target.value.replace(/\D/g, ""))} />
          </label>
          <button type="button" className={btnSmPrimary} disabled={!lvItem || lvLevel === ""} onClick={() => void saveLevel()}>{L("Save level", "Simpan paras")}</button>
          {lvItem && feed.levels.some((x) => String(x.id) === lvItem) && (
            <button type="button" className={btnSm} onClick={() => void saveLevel(true)}>{L("Clear level", "Kosongkan paras")}</button>
          )}
        </div>
        {feed.levels.length > 0 && (
          <p className={css.hiddenNote}>{L(`${feed.levels.length} item(s) have a reorder level.`, `${feed.levels.length} barang mempunyai paras pesanan semula.`)}</p>
        )}
      </div>
    </div>
  );
}
