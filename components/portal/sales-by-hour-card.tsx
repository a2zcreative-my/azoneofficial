"use client";

/* v1.4.212 (approved architecture review — extension-only): Sales By Hour.
   NEW file + NEW route GET /api/v1/staff/sales/by-hour (guard:
   revenue_view, same as /revenue). Hourly MYT histogram over the last 7
   days across the same bases as the revenue card (shipments with an order
   amount, returned excluded, + manual sales) — built for one question:
   which hours deserve the LIVE sessions. Pure-div bars — the system has
   no chart library by design and this stays that way. NOTE (v1.4.195
   lesson): staff routes are called with the /staff/ prefix EXPLICIT. */

import { useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";


interface Bucket { hour: number; cents: number; orders: number }

const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function SalesByHourCard() {
  const [data, setData] = useState<{ days: number; buckets: Bucket[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    void fetch("/api/v1/staff/sales/by-hour", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setData(d as { days: number; buckets: Bucket[] }); })
      .catch(() => { if (alive) setErr("unavailable"); });
    return () => { alive = false; };
  }, []);

  if (err) return null; // old worker: render nothing, break nothing
  const buckets = data?.buckets ?? [];
  const max = Math.max(1, ...buckets.map((b) => b.cents));
  const total = buckets.reduce((a, b) => a + b.cents, 0);
  const peak = buckets.reduce<Bucket | null>((a, b) => (b.cents > (a?.cents ?? 0) ? b : a), null);
  return (
    <div className={card}>
      <p className="text-sm font-semibold">🕐 Sales by hour — last {data?.days ?? 7} days</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        All channels by the hour the order came in (MYT) — schedule the LIVE sessions where the bars are.
      </p>
      {!data ? (
        <p className="text-muted-foreground mt-1 text-sm">Loading…</p>
      ) : total === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">No sales in the last {data.days} days yet.</p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-[2px]" style={{ height: 64 }} aria-hidden>
            {buckets.map((b) => (
              <div key={b.hour} className="flex-1"
                title={`${hh(b.hour)}–${hh((b.hour + 1) % 24)} · ${rm(b.cents)} · ${b.orders} orders`}
                style={{
                  height: `${Math.max(b.cents > 0 ? 6 : 2, Math.round((b.cents / max) * 64))}px`,
                  borderRadius: 3,
                  background: b.hour === peak?.hour ? "var(--primary)" : "var(--border)",
                }} />
            ))}
          </div>
          <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
          {peak && peak.cents > 0 && (
            <p className="mt-2 text-xs">
              🔥 Peak hour: <span className="font-semibold">{hh(peak.hour)}–{hh((peak.hour + 1) % 24)}</span>{" "}
              <span className="text-muted-foreground">{rm(peak.cents)} across {peak.orders} orders · week total {rm(total)}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
