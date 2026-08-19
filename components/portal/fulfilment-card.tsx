"use client";

/* v1.4.212 (approved architecture review — extension-only): Fulfilment
   Summary. NEW file + NEW route GET /api/v1/staff/fulfilment/summary
   (guard: revenue_view). Counts this month's shipments by
   postage_records.status (schema 0007: preparing | shipped | in_transit |
   delivered | returned) and flags the oldest order still preparing —
   the number that actually ages into a problem. Self-contained; /staff/
   prefix explicit per the v1.4.195 lesson. */

import { useEffect, useState } from "react";
import { SkelText } from "@/components/ui/skeleton";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);


interface FulfilSummary {
  month: string;
  by_status: Record<string, number>;
  oldest_preparing: { order_ref: string; days: number | null } | null;
}
interface FulfilOrder { // v1.4.222 drill-down row
  order_ref: string; status: string; courier: string | null; tracking_no: string | null;
  buyer_city: string | null; order_amount_cents: number | null; created_at: string;
}

/* [status key (API value — never translated), EN label, BM label] */
const CHIPS: [key: string, label: string, labelMs: string][] = [
  ["preparing", "📦 Preparing", "📦 Sedang disediakan"],
  ["shipped", "🚚 Shipped", "🚚 Dihantar"],
  ["in_transit", "✈ In transit", "✈ Dalam perjalanan"],
  ["delivered", "✅ Delivered", "✅ Telah sampai"],
  ["returned", "↩ Returned", "↩ Dipulangkan"],
];

import { fmtRM as rmF, dmy } from "@/lib/format"; // v1.4.272: the global formatters
const dmyT = (ts: string) => {
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return ts;
  const m = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return `${m.slice(8, 10)}-${m.slice(5, 7)} ${m.slice(11, 16)}`;
};

export function FulfilmentCard() {
  const [d, setD] = useState<FulfilSummary | null>(null);
  const [err, setErr] = useState("");
  /* v1.4.222 (CEO): chips are clickable — the orders behind a status. */
  const [drill, setDrill] = useState<string | null>(null);
  const [orders, setOrders] = useState<FulfilOrder[] | null>(null);
  type OCol = "order" | "date" | "courier" | "city" | "amount";
  const [oSort, setOSort] = useState<{ col: OCol; asc: boolean }>({ col: "date", asc: false });
  const cycleO = (col: OCol) => setOSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: col !== "date" });
  const [drillBusy, setDrillBusy] = useState(false);
  const toggleDrill = async (k: string) => {
    if (drill === k) { setDrill(null); setOrders(null); return; }
    setDrill(k); setOrders(null); setDrillBusy(true);
    try {
      const r = await fetch(`/api/v1/staff/fulfilment/summary?status=${k}`, { credentials: "include" });
      if (r.ok) {
        const j = (await r.json()) as { orders?: FulfilOrder[] };
        setOrders(j.orders ?? []);
      }
    } finally { setDrillBusy(false); }
  };
  useEffect(() => {
    let alive = true;
    void fetch("/api/v1/staff/fulfilment/summary", { credentials: "include" })
      .then(async (r) => (r.ok ? ((await r.json()) as FulfilSummary) : Promise.reject(new Error(String(r.status)))))
      .then((v) => { if (alive) setD(v); })
      .catch(() => { if (alive) setErr("unavailable"); });
    return () => { alive = false; };
  }, []);

  if (err) return null; // old worker: render nothing, break nothing
  const n = (k: string) => d?.by_status[k] ?? 0;
  const totalMonth = d ? Object.values(d.by_status).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className={card}>
      <p className="text-sm font-semibold">{L("📮 Fulfilment", "📮 Pemenuhan")} — {d ? dmy(d.month) : "…"}</p>
      {!d ? (
        <SkelText lines={2} className="mt-2" />
      ) : totalMonth === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">{L("No shipments recorded this month yet.", "Belum ada penghantaran direkodkan bulan ini.")}</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {CHIPS.map(([k, label, labelMs]) => (
              <button key={k} type="button" onClick={() => void toggleDrill(k)}
                title={L("Click to show these orders", "Klik untuk tunjuk pesanan ini")}
                className={
                  (drill === k ? "ring-primary ring-2 " : "") +
                  (k === "preparing" && n(k) > 0
                    ? "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800"
                    : "border-border rounded-full border px-2 py-0.5")
                }>
                {L(label, labelMs)} <span className="font-semibold">{n(k)}</span> {drill === k ? "▴" : "▾"}
              </button>
            ))}
          </div>
          {drill && (
            <div className="mt-2">
              {drillBusy && <SkelText lines={2} className="mt-1" />}
              {orders && orders.length === 0 && (
                <p className="text-muted-foreground text-xs">{L("No orders in this status this month.", "Tiada pesanan dalam status ini bulan ini.")}</p>
              )}
              {orders && orders.length > 0 && (
                <div className="tbl-sticky -mx-1 max-h-64 overflow-auto px-1">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-muted-foreground text-left">
                        {([
                          ["order", L("ORDER", "PESANAN"), "px-2 py-1"],
                          ["date", L("DATE", "TARIKH"), "px-2 py-1"],
                          ["courier", L("COURIER · TRACKING", "KURIER · PENJEJAKAN"), "px-2 py-1"],
                          ["city", L("CITY", "BANDAR"), "px-2 py-1"],
                          ["amount", L("AMOUNT", "AMAUN"), "px-2 py-1 text-right"],
                        ] as [OCol, string, string][]).map(([col, label, cls]) => (
                          <th key={col} className={`${cls} cursor-pointer select-none whitespace-nowrap`}
                            title={L(`Sort by ${label} — click again to reverse`, `Isih mengikut ${label} — klik lagi untuk terbalikkan`)}
                            onClick={() => cycleO(col)}>
                            {label}{oSort.col === col ? (oSort.asc ? " ▲" : " ▼") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...orders].sort((a, b) => {
                        const dir = oSort.asc ? 1 : -1;
                        switch (oSort.col) {
                          case "order": return dir * a.order_ref.localeCompare(b.order_ref);
                          case "date": return dir * a.created_at.localeCompare(b.created_at);
                          case "courier": return dir * ((a.courier || "") + (a.tracking_no || "")).localeCompare((b.courier || "") + (b.tracking_no || ""));
                          case "city": return dir * (a.buyer_city || "").localeCompare(b.buyer_city || "");
                          case "amount": return dir * ((a.order_amount_cents ?? 0) - (b.order_amount_cents ?? 0));
                          default: return 0;
                        }
                      }).map((o) => (
                        <tr key={o.order_ref + o.created_at} className="border-border border-t">
                          <td className="px-2 py-1 font-mono">{o.order_ref}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{dmyT(o.created_at)}</td>
                          <td className="px-2 py-1">{o.courier ?? "—"}{o.tracking_no ? ` · ${o.tracking_no}` : ""}</td>
                          <td className="px-2 py-1">{o.buyer_city ?? "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{o.order_amount_cents != null ? rmF(o.order_amount_cents) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {d.oldest_preparing && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              {L("⏳ Oldest unshipped:", "⏳ Paling lama belum dihantar:")} {d.oldest_preparing.order_ref}
              {d.oldest_preparing.days !== null && d.oldest_preparing.days >= 1
                ? L(` — waiting ${d.oldest_preparing.days} day${d.oldest_preparing.days === 1 ? "" : "s"}`, ` — menunggu ${d.oldest_preparing.days} hari`)
                : L(" — from today", " — dari hari ini")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
