"use client";

/* v1.193.0 - THE INVENTORY OVERVIEW AND REPORTS, laid out as the owner's
   reference photo (22-10-2026). Both are drawn from the lists the Inventory
   panel already loads (the items, the manual movements, the TikTok stock-out
   and the supplier-return totals): they fetch nothing, write nothing and
   compute nothing the panel does not already state.

     Overview   four tiles (total items, in stock, low, out of stock - the
                server's own status, 5 or fewer is low, 0 is out), the low and
                out items, the manual movements of the last 30 days, the
                quick actions, and the store-sync warning when there is one
     Reports    stock valuation (the stock table's own footer sums, over the
                whole shelf, and by category), the month's TikTok stock-out
                and the last 30 days of manual movement

   No figure from the mockup is used. Where the photo draws something this
   system does not keep (a minimum per item, a purchase-order reference) the
   page says what the system does keep instead. */

import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { dmy, rm as rmBare } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, card, chipSmDanger, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import css from "./inventory-overview.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export type InvView = "overview" | "stock" | "inout" | "returns" | "stocktake" | "reports";
export type InvOpen = (v: InvView, opts?: { filter?: "all" | "low" | "out"; record?: "returns" | "postage" | "materials"; add?: boolean; anchor?: string }) => void;

type OvItem = { id: number; sku: string; name: string; stock: number; status: string; category?: string | null; unit_price_cents?: number; unit_cost_cents?: number | null; live_rebate_cents?: number };
type OvMove = { id: number; sku: string; item_name: string; qty: number; remark: string; created_at: string; created_by_name?: string | null; out_date?: string | null; reverted?: number | null; direction?: string | null };
type OvTt = { month_qty: number; today_qty: number; month_value_cents?: number | null };

/* the day a movement counts for: its stock date, else the day it was keyed */
const dayOf = (m: OvMove) => (m.out_date || m.created_at || "").slice(0, 10);
const daysAgo = (today: string, n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const reasonOf = (remark: string) => (remark.split(" — ")[0] ?? "").trim();

/* the stock table's footer, over any set of items (role-panels.tsx, v1.147.0) */
export function valuation(items: readonly OvItem[]) {
  return items.reduce(
    (a, it) => {
      const price = it.unit_price_cents ?? 0;
      const net = Math.max(0, price - (it.live_rebate_cents ?? 0));
      a.units += it.stock;
      a.value += it.stock * price;
      a.net += it.stock * net;
      if (it.unit_cost_cents != null) a.cost += it.stock * it.unit_cost_cents;
      else if (it.stock > 0) a.noCost += 1;
      return a;
    },
    { units: 0, value: 0, net: 0, cost: 0, noCost: 0 },
  );
}

function Head({ icon, tone, title, sub, action }: { icon: AppIconName; tone: string | undefined; title: string; sub: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={css.head}>
      <div className={css.lead}>
        <span className={`${css.well} ${tone ?? ""}`}><AppIcon name={icon} /></span>
        <div className={css.headText}>
          <p className={css.title}>{title}</p>
          <p className={css.sub}>{sub}</p>
        </div>
      </div>
      {action && <button type="button" className={btnSm} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

export function InventoryOverview({ items, moves, loaded, today, bridgeProblem, open }: {
  items: readonly OvItem[];
  moves: readonly OvMove[];
  loaded: boolean;
  today: string;
  bridgeProblem: boolean;
  open: InvOpen;
}) {
  const low = items.filter((i) => i.status === "low");
  const out = items.filter((i) => i.status === "out_of_stock");
  const total = items.length;
  const inStock = total - low.length - out.length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const cats = new Set(items.map((i) => (i.category ?? "").trim().toLowerCase()).filter(Boolean)).size;
  const alerts = [...out, ...low].sort((a, b) => a.stock - b.stock || a.sku.localeCompare(b.sku, undefined, { numeric: true }));
  const since = daysAgo(today, 30);
  const recent = moves.filter((m) => dayOf(m) >= since).sort((a, b) => (dayOf(b) + b.created_at).localeCompare(dayOf(a) + a.created_at));

  const quick: { icon: AppIconName; tone: string | undefined; label: string; onClick: () => void }[] = [
    { icon: "download", tone: css.green, label: L("Receive Stock", "Terima Stok"), onClick: () => open("inout", { anchor: "inv-receive" }) },
    { icon: "edit", tone: css.blue, label: L("Manual In / Out", "Masuk / Keluar Manual"), onClick: () => open("stock") },
    { icon: "verify", tone: css.navy, label: L("Stock Take", "Kiraan Stok"), onClick: () => open("stocktake") },
    { icon: "returned", tone: css.red, label: L("Supplier Return", "Pulangan Pembekal"), onClick: () => open("returns", { record: "returns" }) },
    { icon: "shipped", tone: css.gold, label: L("Postage Tracking", "Penjejakan Pos"), onClick: () => open("returns", { record: "postage" }) },
    { icon: "add", tone: css.gold, label: L("Add Item", "Tambah Barang"), onClick: () => open("stock", { add: true }) },
    { icon: "chart", tone: css.purple, label: L("TikTok Stock Out", "Stok Keluar TikTok"), onClick: () => open("reports") },
    { icon: "money", tone: css.green, label: L("Stock Valuation", "Nilai Stok"), onClick: () => open("reports", { anchor: "inv-valuation" }) },
  ];

  return (
    <>
      {bridgeProblem && (
        <p role="status" className={`erp-note erp-note-warning ${css.alert}`}>
          <AppIcon name="warning" />
          {L("Stock sync with the ELFIA store needs attention.", "Penyegerakan stok dengan kedai ELFIA perlu perhatian.")}
          <button type="button" className={btnSm} onClick={() => open("stock", { anchor: "inventory-bridge" })}>{L("Review the ELFIA bridge", "Semak jambatan ELFIA")}</button>
        </p>
      )}
      <KpiRow label={L("Stock at a glance", "Stok sepintas lalu")}>
        <KpiTile icon="inventory" tone="blue" label={L("Total Items", "Jumlah Barang")} value={total} busy={!loaded}
          sub={cats > 0 ? L(`across ${cats} categor${cats === 1 ? "y" : "ies"}`, `merentas ${cats} kategori`) : L("SKUs on the stock list", "SKU dalam senarai stok")}
          onClick={() => open("stock", { filter: "all" })} title={L("Open the stock list", "Buka senarai stok")} />
        <KpiTile icon="success" tone="green" label={L("In Stock", "Dalam Stok")} value={inStock} busy={!loaded}
          sub={L(`${pct(inStock)}% of items · more than 5 on hand`, `${pct(inStock)}% barang · lebih 5 dalam tangan`)} bar={{ pct: pct(inStock), tone: "green" }} />
        <KpiTile icon="warning" tone="gold" label={L("Low Stock", "Stok Rendah")} value={low.length} busy={!loaded}
          sub={L(`${pct(low.length)}% of items · 5 or fewer`, `${pct(low.length)}% barang · 5 atau kurang`)} bar={{ pct: pct(low.length), tone: "gold" }}
          onClick={() => open("stock", { filter: "low" })} title={L("Show the low items", "Tunjuk barang rendah")} />
        <KpiTile icon="blocked" tone="red" label={L("Out of Stock", "Habis Stok")} value={out.length} busy={!loaded}
          sub={L(`${pct(out.length)}% of items · none on hand`, `${pct(out.length)}% barang · tiada dalam tangan`)} bar={{ pct: pct(out.length), tone: "red" }}
          onClick={() => open("stock", { filter: "out" })} title={L("Show the items that are out", "Tunjuk barang yang habis")} />
      </KpiRow>

      <div className={css.split}>
        <section className={card} aria-label={L("Low stock items", "Barang stok rendah")}>
          <Head icon="warning" tone={css.gold} title={L("Low Stock Items", "Barang Stok Rendah")}
            sub={L("Out of stock first, then 5 or fewer on hand - the system's own rule.", "Habis stok dahulu, kemudian 5 atau kurang - peraturan sistem.")}
            action={{ label: L("View all", "Lihat semua"), onClick: () => open("stock", { filter: "low" }) }} />
          <div className={css.tWrap}>
            <table className={css.t}>
              <thead><tr><th>SKU</th><th>{L("Item", "Barang")}</th><th className={css.num}>{L("On hand", "Dalam tangan")}</th><th>{L("Status", "Status")}</th></tr></thead>
              <tbody>
                {!loaded ? <tr><td colSpan={4}><SkelRows rows={4} /></td></tr>
                  : alerts.length === 0 ? <tr><td colSpan={4} className={css.empty}>{L("Nothing is low - every item has more than 5 on hand.", "Tiada yang rendah - setiap barang lebih 5 dalam tangan.")}</td></tr>
                  : alerts.slice(0, 6).map((it) => (
                    <tr key={it.id}>
                      <td className={css.mono}>{it.sku}</td>
                      <td className={css.name}>{it.name}</td>
                      <td className={css.num}>{it.stock}</td>
                      <td><span className={it.status === "out_of_stock" ? chipSmDanger : chipSmWarn}>{it.status === "out_of_stock" ? L("Out of stock", "Habis stok") : L("Low stock", "Stok rendah")}</span></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {alerts.length > 6 && <p className={css.more}>{L(`+${alerts.length - 6} more in the stock list`, `+${alerts.length - 6} lagi dalam senarai stok`)}</p>}
        </section>

        <section className={card} aria-label={L("Stock movements", "Pergerakan stok")}>
          <Head icon="transit" tone={css.blue} title={L("Stock Movements (Last 30 Days)", "Pergerakan Stok (30 Hari Lepas)")}
            sub={L("Manual stock in and out, newest first. TikTok and ELFIA sales are in Reports.", "Stok masuk dan keluar manual, terbaru dahulu. Jualan TikTok dan ELFIA dalam Laporan.")}
            action={{ label: L("View all", "Lihat semua"), onClick: () => open("inout", { anchor: "inv-moves" }) }} />
          <div className={css.tWrap}>
            <table className={css.t}>
              <thead><tr><th>{L("Date", "Tarikh")}</th><th>{L("Type", "Jenis")}</th><th>{L("Item", "Barang")}</th><th className={css.num}>{L("Qty", "Kuantiti")}</th><th>{L("Reason", "Sebab")}</th><th>{L("By", "Oleh")}</th></tr></thead>
              <tbody>
                {!loaded ? <tr><td colSpan={6}><SkelRows rows={4} /></td></tr>
                  : recent.length === 0 ? <tr><td colSpan={6} className={css.empty}>{L("No manual movements in the last 30 days.", "Tiada pergerakan manual dalam 30 hari lepas.")}</td></tr>
                  : recent.slice(0, 6).map((m) => {
                    const isIn = m.direction === "in";
                    return (
                      <tr key={m.id} className={m.reverted ? css.reverted : undefined}>
                        <td className={css.muted}>{dmy(dayOf(m))}</td>
                        <td><span className={m.reverted ? chipSmNeutral : isIn ? chipSmSuccess : chipSmDanger}>{m.reverted ? L("Reversed", "Dibatalkan") : isIn ? L("In", "Masuk") : L("Out", "Keluar")}</span></td>
                        <td className={css.name}>{m.item_name || m.sku}</td>
                        <td className={`${css.num} ${isIn ? css.plus : css.minus}`}>{isIn ? "+" : "−"}{m.qty}</td>
                        <td className={css.reason}>{reasonOf(m.remark) || "—"}</td>
                        <td className={css.muted}>{m.created_by_name ?? "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className={card} aria-label={L("Quick actions", "Tindakan pantas")}>
        <p className={css.title}>{L("Quick Actions", "Tindakan Pantas")}</p>
        <div className={css.quick}>
          {quick.map((q) => (
            <button key={q.label} type="button" className={css.qa} onClick={q.onClick}>
              <span className={`${css.qaIcon} ${q.tone ?? ""}`}><AppIcon name={q.icon} /></span>
              <span>{q.label}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

export function InventoryReports({ items, moves, tt, loaded, today }: {
  items: readonly OvItem[];
  moves: readonly OvMove[];
  tt: readonly OvTt[];
  loaded: boolean;
  today: string;
}) {
  const all = valuation(items);
  /* by category, the same sums; uncategorised last */
  const byCat = new Map<string, { label: string; n: number; v: ReturnType<typeof valuation> }>();
  for (const it of items) {
    const raw = (it.category ?? "").trim();
    const k = raw.toLowerCase();
    const cur = byCat.get(k) ?? { label: raw || L("Uncategorised", "Tanpa kategori"), n: 0, v: valuation([]) };
    const one = valuation([it]);
    cur.n += 1; cur.v.units += one.units; cur.v.value += one.value; cur.v.net += one.net; cur.v.cost += one.cost; cur.v.noCost += one.noCost;
    byCat.set(k, cur);
  }
  const cats = [...byCat.entries()].sort(([a], [b]) => (!a !== !b ? (a ? -1 : 1) : a.localeCompare(b))).map(([, c]) => c);
  const ttMonth = tt.reduce((a, r) => ({ qty: a.qty + r.month_qty, today: a.today + r.today_qty, value: a.value + (r.month_value_cents ?? 0) }), { qty: 0, today: 0, value: 0 });
  const since = daysAgo(today, 30);
  const live = moves.filter((m) => dayOf(m) >= since && !m.reverted);
  const inUnits = live.filter((m) => m.direction === "in").reduce((a, m) => a + m.qty, 0);
  const outUnits = live.filter((m) => m.direction !== "in").reduce((a, m) => a + m.qty, 0);
  const reasons = new Map<string, number>();
  for (const m of live) { const r = reasonOf(m.remark) || L("No reason", "Tiada sebab"); reasons.set(r, (reasons.get(r) ?? 0) + m.qty); }
  const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const noCostNote = all.noCost > 0 ? L(` · ${all.noCost} item(s) with stock have no cost set`, ` · ${all.noCost} barang berstok tiada kos`) : "";

  return (
    <>
      <div id="inv-valuation" className={css.anchor}>
        <KpiRow label={L("Stock valuation", "Nilai stok")}>
          <KpiTile icon="inventory" tone="navy" label={L("Units on Hand", "Unit Dalam Tangan")} value={all.units} busy={!loaded} sub={L(`${items.length} SKUs`, `${items.length} SKU`)} />
          <KpiTile icon="money" tone="gold" label={L("Value at Price", "Nilai pada Harga")} value={`RM ${rmBare(all.value)}`} busy={!loaded} sub={L("stock × price per unit", "stok × harga seunit")} />
          <KpiTile icon="balance" tone="green" label={L("Net after Live Rebate", "Bersih selepas Rebat Live")} value={`RM ${rmBare(all.net)}`} busy={!loaded} sub={L("stock × (price − rebate)", "stok × (harga − rebat)")} />
          <KpiTile icon="receipt" tone="blue" label={L("Value at Cost", "Nilai pada Kos")} value={all.cost > 0 || all.noCost === 0 ? `RM ${rmBare(all.cost)}` : "—"} busy={!loaded}
            sub={L(`items with a cost set${noCostNote}`, `barang yang ada kos${noCostNote}`)} />
        </KpiRow>
      </div>

      <div className={css.split}>
        <section className={card} aria-label={L("Valuation by category", "Nilai mengikut kategori")}>
          <Head icon="chart" tone={css.gold} title={L("Valuation by Category", "Nilai Mengikut Kategori")} sub={L("The stock table's totals, one row a category.", "Jumlah jadual stok, satu baris setiap kategori.")} />
          <div className={css.tWrap}>
            <table className={css.t}>
              <thead><tr><th>{L("Category", "Kategori")}</th><th className={css.num}>{L("Items", "Barang")}</th><th className={css.num}>{L("Units", "Unit")}</th><th className={css.num}>{L("At price", "Pada harga")}</th><th className={css.num}>{L("Net", "Bersih")}</th><th className={css.num}>{L("At cost", "Pada kos")}</th></tr></thead>
              <tbody>
                {!loaded ? <tr><td colSpan={6}><SkelRows rows={3} /></td></tr>
                  : cats.length === 0 ? <tr><td colSpan={6} className={css.empty}>{L("No items yet.", "Belum ada barang.")}</td></tr>
                  : cats.map((c) => (
                    <tr key={c.label}>
                      <td className={css.name}>{c.label}</td>
                      <td className={css.num}>{c.n}</td>
                      <td className={css.num}>{c.v.units}</td>
                      <td className={css.num}>RM {rmBare(c.v.value)}</td>
                      <td className={css.num}>RM {rmBare(c.v.net)}</td>
                      <td className={css.num}>{c.v.cost > 0 || c.v.noCost === 0 ? `RM ${rmBare(c.v.cost)}` : "—"}{c.v.noCost > 0 && c.v.cost > 0 ? " *" : ""}</td>
                    </tr>
                  ))}
              </tbody>
              {loaded && cats.length > 0 && (
                <tfoot>
                  <tr>
                    <td>{L("Total", "Jumlah")}</td><td className={css.num}>{items.length}</td><td className={css.num}>{all.units}</td>
                    <td className={css.num}>RM {rmBare(all.value)}</td><td className={css.num}>RM {rmBare(all.net)}</td>
                    <td className={css.num}>{all.cost > 0 || all.noCost === 0 ? `RM ${rmBare(all.cost)}` : "—"}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {all.noCost > 0 && <p className={css.more}>{L("* some items in this category have stock but no cost set, so the cost figure is lower than the truth.", "* sesetengah barang dalam kategori ini berstok tetapi tiada kos, jadi angka kos lebih rendah daripada sebenar.")}</p>}
        </section>

        <div className={css.col}>
          <section className={card} aria-label={L("TikTok stock out this month", "Stok keluar TikTok bulan ini")}>
            <Head icon="chart" tone={css.purple} title={L("TikTok Stock Out", "Stok Keluar TikTok")} sub={L("Units TikTok orders deducted (returned orders excluded). The per-item table is below.", "Unit yang ditolak oleh pesanan TikTok (pesanan dipulangkan tidak dikira). Jadual setiap barang di bawah.")} />
            <div className={css.figs}>
              <div className={css.fig}><p className={css.figLabel}>{L("Today", "Hari ini")}</p><p className={css.figValue}>{loaded ? ttMonth.today : "···"}</p></div>
              <div className={css.fig}><p className={css.figLabel}>{L("This month", "Bulan ini")}</p><p className={css.figValue}>{loaded ? ttMonth.qty : "···"}</p></div>
              <div className={css.fig}><p className={css.figLabel}>{L("Sold value, month", "Nilai jualan, bulan")}</p><p className={css.figValue}>{loaded ? `RM ${rmBare(ttMonth.value)}` : "···"}</p></div>
            </div>
          </section>
          <section className={card} aria-label={L("Manual movements, last 30 days", "Pergerakan manual, 30 hari lepas")}>
            <Head icon="transit" tone={css.blue} title={L("Manual Movements (30 Days)", "Pergerakan Manual (30 Hari)")} sub={L("Units moved by hand, reversed records left out, by reason.", "Unit digerakkan secara manual, rekod dibatalkan tidak dikira, mengikut sebab.")} />
            <div className={css.figs}>
              <div className={css.fig}><p className={css.figLabel}>{L("Units in", "Unit masuk")}</p><p className={`${css.figValue} ${css.plus}`}>{loaded ? (inUnits > 0 ? `+${inUnits}` : "0") : "···"}</p></div>
              <div className={css.fig}><p className={css.figLabel}>{L("Units out", "Unit keluar")}</p><p className={`${css.figValue} ${css.minus}`}>{loaded ? (outUnits > 0 ? `−${outUnits}` : "0") : "···"}</p></div>
              <div className={css.fig}><p className={css.figLabel}>{L("Records", "Rekod")}</p><p className={css.figValue}>{loaded ? live.length : "···"}</p></div>
            </div>
            {loaded && topReasons.length > 0 && (
              <ul className={css.rows}>
                {topReasons.map(([r, n]) => (
                  <li key={r} className={css.row}><span className={css.reasonWide}>{r}</span><span className={css.num}>{n} {L("units", "unit")}</span></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
