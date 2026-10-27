"use client";

/* v1.212.0 - STOCK & PRODUCTS ON THE ECOMMERCE PAGE (the owner's brief:
   "reuse Inventory and ELFIA SKUs; low/out of stock; no separate ledger").

   ONE AUTHORITATIVE STOCK SOURCE. This view reads the two lists the
   Inventory page already reads - GET /staff/inventory (the items, the
   server's own status: 5 or fewer is low, 0 is out) and GET
   /staff/inventory/tiktok-out (what TikTok orders took, from the same
   postage lines the sync and the webhook wrote) - and writes nothing. Every
   change to stock is made in Inventory; the button says so.

   HONEST LABELS. "On hand" is after orders: a TikTok order takes its pieces
   off when it arrives and a return puts them back, and nothing is reserved
   separately - so on hand is what is free to sell. "Sold on TikTok" leaves
   out returned and cancelled orders, by the day the order was recorded. */

import { useMemo, useState } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, card, tabPill, tabPillOn } from "@/lib/ui-styles";
import css from "./ecommerce-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export type InvItem = { id: number; sku: string; name: string; stock: number; status: string; category?: string | null; bridge_enabled?: number | null };
export type TtOut = { id: number; sku: string; name: string; stock: number; today_qty: number; month_qty: number; total_qty: number; avg_sale_cents?: number | null; month_value_cents?: number | null; last_at?: string | null };
type Row = InvItem & { today: number; month: number; monthValue: number | null };

const STOCK_CHIP: Record<string, [string, string, string]> = {
  out_of_stock: ["Out of stock", "Habis stok", "erp-chip-danger"],
  low: ["Low", "Rendah", "erp-chip-warning"],
  in_stock: ["In stock", "Dalam stok", "erp-chip-success"],
};
export function StockChip({ status }: { status: string }) {
  const c = STOCK_CHIP[status];
  return <span className={`erp-chip erp-chip-sm ${c?.[2] ?? "erp-chip-neutral"}`}>{c ? L(c[0], c[1]) : status.replace(/_/g, " ")}</span>;
}

/** The two Inventory reads, shared by the tab, the alerts and the analytics. */
export function useStockReads(enabled: boolean) {
  const inv = useCachedApi<{ items: InvItem[] }>(enabled ? "/staff/inventory" : null, enabled, ["inventory"]);
  const out = useCachedApi<{ today: string; month: string; items: TtOut[] }>(enabled ? "/staff/inventory/tiktok-out" : null, enabled, ["inventory", "orders"]);
  return { inv, out };
}

export function StockProducts({ openInventory }: { openInventory: () => void }) {
  const { inv, out } = useStockReads(true);
  const [filter, setFilter] = useState<"all" | "low" | "out" | "sold">("all");
  const rows = useMemo<Row[]>(() => {
    const sold = new Map((out.data?.items ?? []).map((t) => [t.id, t]));
    return (inv.data?.items ?? []).map((i) => {
      const t = sold.get(i.id);
      return { ...i, today: t?.today_qty ?? 0, month: t?.month_qty ?? 0, monthValue: t?.month_value_cents ?? null };
    });
  }, [inv.data, out.data]);
  const counts = {
    all: rows.length,
    low: rows.filter((r) => r.status === "low").length,
    out: rows.filter((r) => r.status === "out_of_stock").length,
    sold: rows.filter((r) => r.month > 0).length,
  };
  const shown = filter === "low" ? rows.filter((r) => r.status === "low")
    : filter === "out" ? rows.filter((r) => r.status === "out_of_stock")
    : filter === "sold" ? rows.filter((r) => r.month > 0)
    : rows;

  const columns: DataColumn<Row>[] = [
    { key: "sku", label: "SKU", hideable: false, render: (r) => <span className={css.mono}>{r.sku}</span>, sortValue: (r) => r.sku },
    { key: "name", label: L("Item", "Barang"), render: (r) => <span className={css.itemName}>{r.name}{r.bridge_enabled ? <span className="erp-chip erp-chip-sm erp-chip-info">{L("ELFIA store", "Kedai ELFIA")}</span> : null}</span>, sortValue: (r) => r.name },
    { key: "stock", label: L("On hand", "Dalam tangan"), numeric: true, render: (r) => <span className="erp-num">{r.stock}</span>, sortValue: (r) => r.stock },
    { key: "status", label: L("Stock", "Stok"), render: (r) => <StockChip status={r.status} />, sortValue: (r) => (r.status === "out_of_stock" ? 0 : r.status === "low" ? 1 : 2) },
    { key: "today", label: L("Sold on TikTok today", "Terjual di TikTok hari ini"), numeric: true, render: (r) => <span className="erp-num">{r.today}</span>, sortValue: (r) => r.today },
    { key: "month", label: L("Sold this month", "Terjual bulan ini"), numeric: true, render: (r) => <span className="erp-num">{r.month}</span>, sortValue: (r) => r.month },
    { key: "value", label: L("Sold value this month", "Nilai terjual bulan ini"), numeric: true, render: (r) => (r.monthValue ? fmtRM(r.monthValue) : "—"), sortValue: (r) => r.monthValue ?? 0 },
  ];

  return (
    <section className={card} aria-label={L("Stock and products", "Stok dan produk")}>
      <div className={css.cardHead}>
        <div>
          <PanelTitle icon="inventory">{L("Stock & Products", "Stok & Produk")}</PanelTitle>
          <p className="erp-meta">{L("The Inventory list, read here. Change stock in Inventory.", "Senarai Inventori, dibaca di sini. Ubah stok dalam Inventori.")}</p>
        </div>
        <button type="button" className={btnSm} onClick={openInventory}><AppIcon name="inventory" />{L("Open Inventory", "Buka Inventori")}</button>
      </div>
      <p className={css.explain}>{L("On hand is after orders: each TikTok order takes its pieces off when it arrives and a return puts them back. Nothing is reserved separately, so on hand is what is free to sell. Sold figures leave out returned and cancelled orders.",
        "Dalam tangan ialah selepas pesanan: setiap pesanan TikTok menolak barangnya apabila tiba dan pemulangan mengembalikannya. Tiada tempahan berasingan, jadi dalam tangan ialah yang boleh dijual. Angka terjual tidak termasuk pesanan dipulang dan dibatal.")}</p>
      <div role="tablist" aria-label={L("Stock filter", "Tapis stok")} className={`erp-pill-row ${css.pills}`}>
        {([["all", L("All items", "Semua barang")], ["low", L("Low", "Rendah")], ["out", L("Out of stock", "Habis stok")], ["sold", L("Sold on TikTok this month", "Terjual di TikTok bulan ini")]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={`${filter === k ? tabPillOn : tabPill} ${css.pill}`} onClick={() => setFilter(k)}>
            {label} <span className="erp-num">({inv.data ? counts[k] : "…"})</span>
          </button>
        ))}
      </div>
      {inv.failed && !inv.data && <p className="erp-note erp-note-warning" role="alert">{L("Couldn't load the stock list. Check the connection.", "Tidak dapat memuatkan senarai stok. Semak sambungan.")} <button type="button" className={btnSm} onClick={inv.refresh}>{L("Try again", "Cuba lagi")}</button></p>}
      <DataTable<Row>
        id="ecommerce-stock"
        look="reference"
        noun={["items", "barang"]}
        columns={columns}
        rows={shown}
        loading={!inv.data && !inv.failed}
        searchText={(r) => `${r.sku} ${r.name} ${r.category ?? ""}`}
        defaultSort={filter === "sold" ? "month" : "status"}
        defaultDir={filter === "sold" ? "desc" : "asc"}
        pageSizes={[10, 25, 50]}
        empty={filter === "low" || filter === "out" ? L("Nothing here - every item has more than 5 on hand.", "Tiada di sini - setiap barang lebih 5 dalam tangan.") : L("No items to show.", "Tiada barang untuk ditunjuk.")}
      />
    </section>
  );
}

/** Product performance: the month's TikTok stock-out, top sellers first. */
export function ProductPerformance() {
  const { out } = useStockReads(true);
  const top = [...(out.data?.items ?? [])].filter((t) => t.month_qty > 0).sort((a, b) => b.month_qty - a.month_qty).slice(0, 8);
  const max = top[0]?.month_qty ?? 0;
  return (
    <section className={card} aria-label={L("Product performance", "Prestasi produk")}>
      <PanelTitle icon="chart">{L("Product performance", "Prestasi produk")}</PanelTitle>
      <p className="erp-meta">{L("Pieces sold on TikTok this month, by the day each order was recorded. Returned and cancelled orders are left out.", "Unit terjual di TikTok bulan ini, mengikut hari pesanan direkodkan. Pesanan dipulang dan dibatal tidak dikira.")}</p>
      {!out.data ? (out.failed ? <p className="erp-meta">{L("Couldn't load the figures.", "Tidak dapat memuatkan angka.")}</p> : <p className="erp-meta">…</p>)
        : top.length === 0 ? <p className={css.emptyLine}>{L("No TikTok sales recorded this month yet.", "Belum ada jualan TikTok direkodkan bulan ini.")}</p>
        : (
          <ol className={css.bars}>
            {top.map((t) => (
              <li key={t.id}>
                <span className={css.barLabel}><span className={css.mono}>{t.sku}</span> {t.name}</span>
                <span className={css.barTrack} aria-hidden><span className={css.barFill} style={{ width: `${max ? Math.max(4, Math.round((t.month_qty / max) * 100)) : 0}%` }} /></span>
                <span className={css.barValue}><span className="erp-num">{t.month_qty}</span> {L("pcs", "unit")}{t.month_value_cents ? <span className="erp-meta"> · {fmtRM(t.month_value_cents)}</span> : null}</span>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
