"use client";

/* v1.4.212 (approved architecture review — extension-only): Fulfilment
   Summary. NEW file + NEW route GET /api/v1/staff/fulfilment/summary
   (guard: revenue_view). Counts this month's shipments by
   postage_records.status (schema 0007: preparing | shipped | in_transit |
   delivered | returned) and flags the oldest order still preparing —
   the number that actually ages into a problem. Self-contained; /staff/
   prefix explicit per the v1.4.195 lesson. */

import { useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";


interface FulfilSummary {
  month: string;
  by_status: Record<string, number>;
  oldest_preparing: { order_ref: string; days: number | null } | null;
}
interface FulfilOrder { // v1.4.222 drill-down row
  order_ref: string; status: string; courier: string | null; tracking_no: string | null;
  buyer_city: string | null; order_amount_cents: number | null; created_at: string;
}

const CHIPS: [key: string, label: string][] = [
  ["preparing", "📦 Preparing"],
  ["shipped", "🚚 Shipped"],
  ["in_transit", "✈ In transit"],
  ["delivered", "✅ Delivered"],
  ["returned", "↩ Returned"],
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
    /* v1.8.2 (CEO: "fulfilment only updates when I click sync"): the card
       now keeps ITSELF fresh — refetch every 60s while the tab is visible
       and immediately when the app regains focus, so the numbers move when
       the 30-minute server sync or a webhook lands, with no manual sync
       tap. A failed refresh keeps the last good numbers on screen. */
    let alive = true;
    const load = () =>
      void fetch("/api/v1/staff/fulfilment/summary", { credentials: "include" })
        .then(async (r) => (r.ok ? ((await r.json()) as FulfilSummary) : Promise.reject(new Error(String(r.status)))))
        .then((v) => { if (alive) { setD(v); setErr(""); } })
        .catch(() => { if (alive) setD((prev) => { if (!prev) setErr("unavailable"); return prev; }); });
    load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (err) return null; // old worker: render nothing, break nothing
  const n = (k: string) => d?.by_status[k] ?? 0;
  const totalMonth = d ? Object.values(d.by_status).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className={card}>
      <p className="text-sm font-semibold">📮 Fulfilment — {d ? dmy(d.month) : "…"}</p>
      {!d ? (
        <p className="text-muted-foreground mt-1 text-sm">Loading…</p>
      ) : totalMonth === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">No shipments recorded this month yet.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {CHIPS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => void toggleDrill(k)}
                title="Click to show these orders"
                className={
                  (drill === k ? "ring-primary ring-2 " : "") +
                  (k === "preparing" && n(k) > 0
                    ? "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800"
                    : "border-border rounded-full border px-2 py-0.5")
                }>
                {label} <span className="font-semibold">{n(k)}</span> {drill === k ? "▴" : "▾"}
              </button>
            ))}
          </div>
          {drill && (
            <div className="mt-2">
              {drillBusy && <p className="text-muted-foreground text-xs">Loading…</p>}
              {orders && orders.length === 0 && (
                <p className="text-muted-foreground text-xs">No orders in this status this month.</p>
              )}
              {orders && orders.length > 0 && (
                <div className="tbl-sticky -mx-1 max-h-64 overflow-auto px-1">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-muted-foreground text-left">
                        {([
                          ["order", "ORDER", "px-2 py-1"],
                          ["date", "DATE", "px-2 py-1"],
                          ["courier", "COURIER · TRACKING", "px-2 py-1"],
                          ["city", "CITY", "px-2 py-1"],
                          ["amount", "AMOUNT", "px-2 py-1 text-right"],
                        ] as [OCol, string, string][]).map(([col, label, cls]) => (
                          <th key={col} className={`${cls} cursor-pointer select-none whitespace-nowrap`}
                            title={`Sort by ${label} — click again to reverse`}
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
              ⏳ Oldest unshipped: {d.oldest_preparing.order_ref}
              {d.oldest_preparing.days !== null && d.oldest_preparing.days >= 1
                ? ` — waiting ${d.oldest_preparing.days} day${d.oldest_preparing.days === 1 ? "" : "s"}`
                : " — from today"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
