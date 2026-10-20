"use client";

/**
 * v1.181.15 - STOCK TAKE (ERP roadmap, phase 3), on Inventory.
 *
 * Start a count (every item, or one category). The portal notes what it held
 * for each item at that moment. Type what is on the shelf as you count - save
 * as often as you like, from any phone. Sales and receipts carry on while the
 * count is open: the difference is taken against what was held when the
 * count started, so a piece sold mid-count is out of both and never counted
 * twice. Posting moves each counted item by its difference, logged in What
 * moved as a stock count variance (found or missing) - the same reasons a
 * manual correction already uses. An item left blank is not touched.
 *
 * One count open at a time. Cancel leaves stock exactly as it is.
 */

import { useEffect, useMemo, useState } from "react";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { rowBtn } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface CountHead {
  id: number; category: string | null; note: string | null; status: "open" | "posted" | "cancelled";
  started_at: string; posted_at: string | null; cancelled_at?: string | null; started_by_name?: string | null;
  lines?: number; counted?: number; variances?: number;
}
interface CountLine { id: number; item_id: number; sku: string; item_name: string; system_qty: number; counted_qty: number | null; posted_delta: number | null; stock_now: number | null; unit_cost_cents: number | null }

const st = (id: number) => `ST-${String(id).padStart(4, "0")}`;

export function StockTake({ categories, onStockChanged }: { categories: string[]; onStockChanged?: () => void }) {
  const [counts, setCounts] = useState<CountHead[] | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState<{ count: CountHead; lines: CountLine[] } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<"all" | "uncounted" | "different">("all");
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, node: confirmNode } = useConfirm();
  const { show: toast, node: toastNode } = useSaveToast();

  useEffect(() => {
    let live = true;
    void api<{ counts: CountHead[]; pending_migration?: boolean }>(`/staff/stock-counts`).then(async (r) => {
      if (!live || !r.ok || !r.data) return;
      setCounts(r.data.counts);
      setPending(r.data.pending_migration === true);
      const o = r.data.counts.find((c) => c.status === "open");
      if (!o) { setOpen(null); return; }
      const d = await api<{ count: CountHead; lines: CountLine[] }>(`/staff/stock-counts/${o.id}`);
      if (live && d.ok && d.data) setOpen(d.data);
    });
    return () => { live = false; };
  }, [tick]);

  const valueOf = (l: CountLine): number | null => {
    const e = edits[l.item_id];
    if (e === undefined) return l.counted_qty;
    return e === "" ? null : Number(e);
  };
  const lines = useMemo(() => open?.lines ?? [], [open]);
  const counted = lines.filter((l) => valueOf(l) !== null).length;
  const diffs = lines.filter((l) => { const v = valueOf(l); return v !== null && v !== l.system_qty; });
  const diffValue = diffs.reduce((a, l) => a + ((valueOf(l) ?? 0) - l.system_qty) * (l.unit_cost_cents ?? 0), 0);
  const dirty = Object.keys(edits).length > 0;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return lines.filter((l) => {
      const v = edits[l.item_id] !== undefined ? (edits[l.item_id] === "" ? null : Number(edits[l.item_id])) : l.counted_qty;
      if (show === "uncounted" && v !== null) return false;
      if (show === "different" && (v === null || v === l.system_qty)) return false;
      return !f || l.sku.toLowerCase().includes(f) || l.item_name.toLowerCase().includes(f);
    });
  }, [lines, edits, filter, show]);

  const start = async () => {
    setBusy(true);
    const r = await api<{ id?: number; lines?: number; error?: { message?: string } }>(`/staff/stock-counts`, { method: "POST", body: JSON.stringify({ category: cat || undefined }) });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not started", "Tidak dimulakan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L(`${st(r.data?.id ?? 0)} started - ${r.data?.lines} items to count`, `${st(r.data?.id ?? 0)} dimulakan - ${r.data?.lines} barang untuk dikira`));
    setEdits({}); reload();
  };

  const save = async (): Promise<boolean> => {
    if (!open || !dirty) return true;
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/stock-counts/${open.count.id}/lines`, {
      method: "PUT",
      body: JSON.stringify({ lines: Object.entries(edits).map(([id, v]) => ({ item_id: Number(id), counted_qty: v === "" ? null : Number(v) })) }),
    });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Counts not saved", "Kiraan tidak disimpan"), "notice"); return false; }
    toast(L("Saved", "Disimpan"), L("Counts saved", "Kiraan disimpan"));
    setEdits({}); reload();
    return true;
  };

  const post = async () => {
    if (!open) return;
    const ok = await confirm({
      title: L(`Post ${st(open.count.id)}?`, `Pos ${st(open.count.id)}?`),
      message: L(`${diffs.length} item(s) move by their difference (${fmtRM(diffValue)} at unit cost). Items left blank are not touched. Each move shows in What moved as a stock count variance.`,
        `${diffs.length} barang bergerak mengikut perbezaannya (${fmtRM(diffValue)} pada kos seunit). Barang yang dibiarkan kosong tidak disentuh. Setiap pergerakan dipaparkan dalam Apa yang bergerak sebagai varians kiraan stok.`),
      confirmLabel: L("Post differences", "Pos perbezaan"),
    });
    if (!ok || !(await save())) return;
    setBusy(true);
    const r = await api<{ variances?: number; error?: { message?: string } }>(`/staff/stock-counts/${open.count.id}/post`, { method: "POST", body: "{}" });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not posted", "Tidak dipos"), "notice"); reload(); return; }
    toast(L("Saved", "Disimpan"), L(`${st(open.count.id)} posted - ${r.data?.variances ?? 0} item(s) adjusted`, `${st(open.count.id)} dipos - ${r.data?.variances ?? 0} barang dilaraskan`));
    reload(); onStockChanged?.();
  };

  const cancel = async () => {
    if (!open) return;
    const ok = await confirm({
      title: L(`Cancel ${st(open.count.id)}?`, `Batalkan ${st(open.count.id)}?`),
      message: L("Stock stays exactly as it is. The counts typed so far are kept on the cancelled record.", "Stok kekal seperti sedia ada. Kiraan yang ditaip disimpan pada rekod yang dibatalkan."),
      confirmLabel: L("Cancel stock take", "Batalkan kiraan stok"), variant: "danger",
    });
    if (!ok) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/stock-counts/${open.count.id}/cancel`, { method: "POST", body: "{}" });
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not cancelled", "Tidak dibatalkan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L(`${st(open.count.id)} cancelled`, `${st(open.count.id)} dibatalkan`));
    setEdits({}); reload();
  };

  if (!counts) return <div className={card}><SkelRows rows={3} /></div>;
  if (pending) {
    return <div className={card}><p className="erp-note erp-note-warning">{L("Stock take needs the 0142 database update. It is applied by the next PUSH.bat.", "Kiraan stok memerlukan kemas kini pangkalan data 0142. Ia dipasang oleh PUSH.bat seterusnya.")}</p></div>;
  }
  const past = counts.filter((c) => c.status !== "open").slice(0, 6);

  return (
    <div className={card}>
      {confirmNode}{toastNode}
      {!open ? (
        <div className={css.stack}>
          <p className={css.hiddenNote}>
            {L("Count the shelf against what the portal holds. Sales and receipts carry on while you count; the difference is taken against what was held when the count started.",
              "Kira stok sebenar berbanding apa yang portal pegang. Jualan dan penerimaan berjalan seperti biasa semasa mengira; perbezaan diambil berbanding apa yang dipegang semasa kiraan bermula.")}
          </p>
          <div className={css.form}>
            <label className={css.field}>{L("What to count", "Apa yang dikira")}
              <select className={selectClassSm} value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">{L("Every item", "Semua barang")}</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void start()}>{L("Start stock take", "Mula kiraan stok")}</button>
          </div>
        </div>
      ) : (
        <div className={css.stack}>
          <div className={css.monthHead}>
            <span className={css.whatTitle}>{st(open.count.id)} · {open.count.category ?? L("Every item", "Semua barang")}</span>
            <span className={chipSmWarn}>{L("open", "terbuka")}</span>
            <span className={css.whatDetail}>{L(`started ${dmyMYT(open.count.started_at)}`, `dimulakan ${dmyMYT(open.count.started_at)}`)}</span>
          </div>
          <div className={css.figures}>
            <span className={css.figure}><span className={css.figureLabel}>{L("Counted", "Dikira")}</span>{counted} / {lines.length}</span>
            <span className={css.figure}><span className={css.figureLabel}>{L("Different", "Berbeza")}</span>{diffs.length}</span>
            <span className={css.figure}><span className={css.figureLabel}>{L("Difference at cost", "Perbezaan pada kos")}</span>{fmtRM(diffValue)}</span>
          </div>
          <div className={css.form}>
            <label className={css.field}>{L("Find an item", "Cari barang")}
              <input className={inputClassSm} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={L("SKU or name", "SKU atau nama")} />
            </label>
            <label className={css.field}>{L("Show", "Papar")}
              <select className={selectClassSm} value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
                <option value="all">{L("Every line", "Semua baris")}</option>
                <option value="uncounted">{L("Not counted yet", "Belum dikira")}</option>
                <option value="different">{L("Different from held", "Berbeza daripada dipegang")}</option>
              </select>
            </label>
          </div>
          <ul className={css.list} aria-label={L("Lines to count", "Baris untuk dikira")}>
            <li className={`${css.countLine} ${css.countHead}`} aria-hidden>
              <span>{L("Item", "Barang")}</span><span className={css.num}>{L("Held", "Dipegang")}</span><span className={css.num}>{L("Counted", "Dikira")}</span><span className={css.num}>{L("Diff", "Beza")}</span>
            </li>
            {shown.slice(0, 400).map((l) => {
              const v = valueOf(l);
              const d = v === null ? null : v - l.system_qty;
              return (
                <li key={l.item_id} className={css.countLine}>
                  <span className={css.what}><span className={css.whatTitle}>{l.sku}</span><span className={css.whatDetail}>{l.item_name}</span></span>
                  <span className={css.num}>{l.system_qty}</span>
                  <input className={`${inputClassSm} ${css.num}`} inputMode="numeric" aria-label={L(`Counted for ${l.sku}`, `Dikira untuk ${l.sku}`)}
                    value={edits[l.item_id] ?? (l.counted_qty === null ? "" : String(l.counted_qty))}
                    onChange={(e) => { const x = e.target.value.replace(/\D/g, ""); setEdits((m) => ({ ...m, [l.item_id]: x })); }} />
                  <span className={`${css.num} ${d === null || d === 0 ? "" : d > 0 ? css.over : css.under}`}>{d === null ? "" : d > 0 ? `+${d}` : d}</span>
                </li>
              );
            })}
          </ul>
          {shown.length > 400 && <p className={css.hiddenNote}>{L(`Showing 400 of ${shown.length}. Find an item to narrow the list.`, `Memaparkan 400 daripada ${shown.length}. Cari barang untuk mengecilkan senarai.`)}</p>}
          {shown.length === 0 && <p className={css.empty}>{L("No line matches.", "Tiada baris sepadan.")}</p>}
          <div className={css.figures}>
            <button type="button" className={btnSmPrimary} disabled={busy || !dirty} onClick={() => void save()}>{L("Save counts", "Simpan kiraan")}</button>
            <button type="button" className={btnSm} disabled={busy || counted === 0} onClick={() => void post()}>{L("Post differences", "Pos perbezaan")}</button>
            <button type="button" className={rowBtn} disabled={busy} onClick={() => void cancel()}>{L("Cancel stock take", "Batalkan kiraan stok")}</button>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <>
          <p className={css.sub}>{L("Earlier stock takes", "Kiraan stok terdahulu")}</p>
          <ul className={css.list} aria-label={L("Earlier stock takes", "Kiraan stok terdahulu")}>
            {past.map((c) => (
              <li key={c.id} className={css.item}>
                <span className={css.when}>{dmyMYT(c.posted_at ?? c.cancelled_at ?? c.started_at).slice(0, 10)}</span>
                <span className={css.what}><span className={css.whatTitle}>{st(c.id)} · {c.category ?? L("Every item", "Semua barang")}</span>
                  <span className={css.whatDetail}>{L(`${c.counted ?? 0} of ${c.lines ?? 0} counted · ${c.variances ?? 0} different`, `${c.counted ?? 0} daripada ${c.lines ?? 0} dikira · ${c.variances ?? 0} berbeza`)}{c.started_by_name ? ` · ${c.started_by_name}` : ""}</span></span>
                <span className={c.status === "posted" ? chipSmSuccess : chipSmNeutral}>{c.status === "posted" ? L("posted", "dipos") : L("cancelled", "dibatalkan")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
