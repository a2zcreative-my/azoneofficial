"use client";

/* v1.9.0 — 🗺 Operations map (reference design's "CL totals by location").
   Orders by buyer city from the TikTok sync, grouped into states and drawn
   as bubbles on a stylised Malaysia silhouette (inline SVG — no map
   library; deliberately schematic, not cartographic). */

import { useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { card } from "@/lib/ui-styles";
import { fmtRM } from "@/lib/format";

const api = makeApi("/staff");

/* Approximate state centroids on the 420×200 canvas below. */
const STATE_POS: Record<string, { x: number; y: number }> = {
  "Perlis": { x: 78, y: 22 }, "Kedah": { x: 88, y: 38 }, "Pulau Pinang": { x: 74, y: 55 },
  "Perak": { x: 96, y: 76 }, "Kelantan": { x: 128, y: 44 }, "Terengganu": { x: 148, y: 62 },
  "Pahang": { x: 134, y: 96 }, "Selangor": { x: 100, y: 112 }, "Kuala Lumpur": { x: 110, y: 118 },
  "Putrajaya": { x: 108, y: 126 }, "Negeri Sembilan": { x: 116, y: 134 }, "Melaka": { x: 118, y: 148 },
  "Johor": { x: 140, y: 162 }, "Sarawak": { x: 300, y: 140 }, "Sabah": { x: 372, y: 74 },
  "Labuan": { x: 344, y: 84 },
};

/* Common Malaysian cities → state (lower-case keys; loose contains match). */
const CITY_STATE: [string, string][] = [
  ["kuala lumpur", "Kuala Lumpur"], ["cheras", "Kuala Lumpur"], ["kepong", "Kuala Lumpur"], ["setapak", "Kuala Lumpur"], ["wilayah persekutuan", "Kuala Lumpur"],
  ["petaling", "Selangor"], ["shah alam", "Selangor"], ["subang", "Selangor"], ["klang", "Selangor"], ["puchong", "Selangor"],
  ["ampang", "Selangor"], ["kajang", "Selangor"], ["gombak", "Selangor"], ["rawang", "Selangor"], ["sepang", "Selangor"],
  ["cyberjaya", "Selangor"], ["bangi", "Selangor"], ["selayang", "Selangor"], ["damansara", "Selangor"], ["selangor", "Selangor"],
  ["putrajaya", "Putrajaya"],
  ["johor bahru", "Johor"], ["johor", "Johor"], ["skudai", "Johor"], ["batu pahat", "Johor"], ["muar", "Johor"],
  ["kluang", "Johor"], ["kulai", "Johor"], ["pasir gudang", "Johor"], ["iskandar", "Johor"], ["segamat", "Johor"], ["pontian", "Johor"],
  ["penang", "Pulau Pinang"], ["pulau pinang", "Pulau Pinang"], ["georgetown", "Pulau Pinang"], ["butterworth", "Pulau Pinang"], ["bukit mertajam", "Pulau Pinang"],
  ["ipoh", "Perak"], ["perak", "Perak"], ["taiping", "Perak"], ["teluk intan", "Perak"], ["manjung", "Perak"], ["sitiawan", "Perak"],
  ["alor setar", "Kedah"], ["kedah", "Kedah"], ["sungai petani", "Kedah"], ["kulim", "Kedah"], ["langkawi", "Kedah"],
  ["kangar", "Perlis"], ["perlis", "Perlis"],
  ["kota bharu", "Kelantan"], ["kelantan", "Kelantan"], ["pasir mas", "Kelantan"], ["tanah merah", "Kelantan"],
  ["kuala terengganu", "Terengganu"], ["terengganu", "Terengganu"], ["kemaman", "Terengganu"], ["dungun", "Terengganu"],
  ["kuantan", "Pahang"], ["pahang", "Pahang"], ["temerloh", "Pahang"], ["bentong", "Pahang"],
  ["seremban", "Negeri Sembilan"], ["negeri sembilan", "Negeri Sembilan"], ["nilai", "Negeri Sembilan"], ["port dickson", "Negeri Sembilan"],
  ["melaka", "Melaka"], ["malacca", "Melaka"], ["alor gajah", "Melaka"],
  ["kuching", "Sarawak"], ["sarawak", "Sarawak"], ["miri", "Sarawak"], ["sibu", "Sarawak"], ["bintulu", "Sarawak"],
  ["kota kinabalu", "Sabah"], ["sabah", "Sabah"], ["sandakan", "Sabah"], ["tawau", "Sabah"], ["lahad datu", "Sabah"], ["keningau", "Sabah"],
  ["labuan", "Labuan"],
];

function stateOf(cityRaw: string): string | null {
  const c = cityRaw.toLowerCase();
  for (const [needle, st] of CITY_STATE) if (c.includes(needle)) return st;
  return null;
}

export function OpsMapCard() {
  const [cities, setCities] = useState<{ city: string; orders: number; cents: number }[] | null>(null);
  useEffect(() => {
    void api<{ cities: { city: string; orders: number; cents: number }[] }>(`/orders/geo`)
      .then((r) => setCities(r.ok && r.data?.cities ? r.data.cities : []));
  }, []);
  if (!cities) return null;
  if (cities.length === 0) return null; // no located orders yet — render nothing

  const byState = new Map<string, { orders: number; cents: number }>();
  let unknown = 0;
  for (const c of cities) {
    const st = stateOf(c.city);
    if (!st) { unknown += c.orders; continue; }
    const cur = byState.get(st) ?? { orders: 0, cents: 0 };
    byState.set(st, { orders: cur.orders + c.orders, cents: cur.cents + c.cents });
  }
  const maxOrders = Math.max(1, ...[...byState.values()].map((v) => v.orders));
  const top = [...byState.entries()].sort((a, b) => b[1].orders - a[1].orders).slice(0, 5);

  return (
    <div className={card}>
      <p className="text-sm font-semibold">🗺 Operations map — orders by state</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Where your TikTok orders ship (buyer city from the sync, grouped by state). Schematic map — bubble size = order count.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_180px]">
        <svg viewBox="0 0 420 200" className="w-full" role="img" aria-label="Orders by Malaysian state">
          {/* stylised silhouettes: peninsula + Borneo */}
          <path d="M70 12 Q60 40 78 70 Q66 84 84 104 Q88 128 106 142 Q118 162 142 172 Q158 176 154 158 Q166 130 150 108 Q158 84 144 58 Q140 34 122 24 Q96 8 70 12 Z"
            fill="var(--secondary)" stroke="var(--border)" strokeWidth="1.5" />
          <path d="M250 168 Q268 130 300 118 Q322 96 344 92 Q356 66 380 58 Q404 62 400 84 Q392 108 372 112 Q356 136 332 144 Q300 162 272 172 Q254 176 250 168 Z"
            fill="var(--secondary)" stroke="var(--border)" strokeWidth="1.5" />
          {[...byState.entries()].map(([st, v]) => {
            const pos = STATE_POS[st];
            if (!pos) return null;
            const r = 6 + Math.sqrt(v.orders / maxOrders) * 14;
            return (
              <g key={st}>
                <title>{`${st} · ${v.orders} order${v.orders === 1 ? "" : "s"} · ${fmtRM(v.cents)}`}</title>
                <circle cx={pos.x} cy={pos.y} r={r} fill="var(--gold-solid)" opacity="0.78" />
                <text x={pos.x} y={pos.y + 3.5} textAnchor="middle" style={{ font: "700 9px sans-serif", fill: "#fff" }}>{v.orders}</text>
              </g>
            );
          })}
        </svg>
        <div>
          <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Top states</p>
          <div className="mt-1.5 space-y-1">
            {top.map(([st, v]) => (
              <p key={st} className="flex items-baseline justify-between text-xs">
                <span>{st}</span>
                <span className="tabular-nums font-semibold">{v.orders}<span className="text-muted-foreground font-normal"> · {fmtRM(v.cents)}</span></span>
              </p>
            ))}
            {unknown > 0 && (
              <p className="text-muted-foreground flex items-baseline justify-between text-[11px]">
                <span>Unmapped cities</span><span className="tabular-nums">{unknown}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
