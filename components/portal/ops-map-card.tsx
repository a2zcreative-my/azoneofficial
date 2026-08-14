"use client";

/* v1.8.0 — Operations map (UI-REDESIGN-PLAN.md Phase 6).
   The reference dashboard's regional bubbles, on shipment data we already
   have: /staff/postage buyer_city (last 200 records — the endpoint's own
   window), grouped into Malaysian states. Inline stylised SVG silhouette
   (~1 KB, flat tint — not a geographic-accuracy tool, a where-are-orders
   glance) with count bubbles, PLUS the ranked list beside it so the exact
   numbers never depend on reading circle sizes (dataviz: a table view
   always exists). Gated exactly like the endpoint: 403 → card absent. */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { tile } from "@/lib/ui-styles";

interface PostageRow { id: number; buyer_city?: string | null; status?: string | null }

/* City/keyword → state. Lowercased substring match; state names match
   themselves. Unknowns land in "Other" and stay visible in the list. */
const CITY_TO_STATE: [string, string][] = [
  ["kuala lumpur", "Kuala Lumpur"], ["kl", "Kuala Lumpur"], ["cheras", "Kuala Lumpur"], ["setapak", "Kuala Lumpur"], ["kepong", "Kuala Lumpur"],
  ["putrajaya", "Putrajaya"], ["cyberjaya", "Selangor"],
  ["shah alam", "Selangor"], ["setia alam", "Selangor"], ["petaling", "Selangor"], ["subang", "Selangor"], ["klang", "Selangor"], ["puchong", "Selangor"], ["kajang", "Selangor"], ["rawang", "Selangor"], ["ampang", "Selangor"], ["gombak", "Selangor"], ["selangor", "Selangor"], ["bangi", "Selangor"], ["sepang", "Selangor"],
  ["johor bahru", "Johor"], ["jb", "Johor"], ["skudai", "Johor"], ["batu pahat", "Johor"], ["muar", "Johor"], ["kluang", "Johor"], ["kulai", "Johor"], ["pasir gudang", "Johor"], ["iskandar", "Johor"], ["johor", "Johor"], ["segamat", "Johor"], ["pontian", "Johor"],
  ["george town", "Penang"], ["georgetown", "Penang"], ["butterworth", "Penang"], ["bukit mertajam", "Penang"], ["penang", "Penang"], ["pulau pinang", "Penang"],
  ["ipoh", "Perak"], ["taiping", "Perak"], ["teluk intan", "Perak"], ["perak", "Perak"],
  ["seremban", "Negeri Sembilan"], ["nilai", "Negeri Sembilan"], ["negeri sembilan", "Negeri Sembilan"], ["n9", "Negeri Sembilan"],
  ["melaka", "Melaka"], ["malacca", "Melaka"],
  ["kuantan", "Pahang"], ["temerloh", "Pahang"], ["bentong", "Pahang"], ["pahang", "Pahang"],
  ["kota bharu", "Kelantan"], ["kelantan", "Kelantan"],
  ["kuala terengganu", "Terengganu"], ["terengganu", "Terengganu"],
  ["alor setar", "Kedah"], ["sungai petani", "Kedah"], ["langkawi", "Kedah"], ["kedah", "Kedah"],
  ["kangar", "Perlis"], ["perlis", "Perlis"],
  ["kuching", "Sarawak"], ["miri", "Sarawak"], ["sibu", "Sarawak"], ["bintulu", "Sarawak"], ["sarawak", "Sarawak"],
  ["kota kinabalu", "Sabah"], ["sandakan", "Sabah"], ["tawau", "Sabah"], ["sabah", "Sabah"],
  ["labuan", "Labuan"],
];

/* Bubble anchors on the 420×230 viewBox — projected from real state
   coordinates with the same equirectangular projection as the outline. */
const STATE_POS: Record<string, [number, number]> = {
  Perlis: [14.4, 61.3], Kedah: [17.9, 67.9], Penang: [17.1, 82.7], Perak: [32.8, 99.5],
  Kelantan: [56.7, 69.4], Terengganu: [75.3, 89.1], Pahang: [70.4, 116],
  Selangor: [39.3, 129.5], "Kuala Lumpur": [48.6, 126.4], Putrajaya: [45.5, 134.7],
  "Negeri Sembilan": [53.8, 138.9], Melaka: [56.9, 149.4], Johor: [82.8, 157.5],
  Sarawak: [275.7, 147.2], Sabah: [360.7, 84.9], Labuan: [326.3, 85.4],
};

function stateOf(city: string | null | undefined): string {
  if (!city) return "Other";
  const c = city.trim().toLowerCase();
  for (const [k, s] of CITY_TO_STATE) if (c.includes(k)) return s;
  return "Other";
}

export function OpsMapCard() {
  const [rows, setRows] = useState<PostageRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ records: PostageRow[] }>("/staff/postage").then((r) => {
      if (alive && r.ok && Array.isArray(r.data?.records)) setRows(r.data.records);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const byState = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const s = stateOf(r.buyer_city);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (!rows || rows.length === 0) return null; // 403, empty, or old worker
  const placeable = byState.filter(([s]) => STATE_POS[s]);
  const max = Math.max(1, ...placeable.map(([, n]) => n));
  const total = rows.length;
  const [topState, topN] = byState[0] ?? ["—", 0];
  const topPct = total > 0 ? Math.round((topN / total) * 100) : 0;

  return (
    <section className={tile} aria-label="Orders by state">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold">Operations map</p>
        <span className="text-muted-foreground text-xs">last {total} shipments</span>
      </div>
      {/* v1.8.1 infographic pass: the headline reading before the picture. */}
      <p className="mb-2 text-xs">
        <span className="text-foreground text-base font-semibold">{topState}</span>
        <span className="text-muted-foreground"> leads with </span>
        <span className="text-gold-deep font-semibold tabular-nums">{topPct}%</span>
        <span className="text-muted-foreground"> of shipments ({topN} of {total})</span>
      </p>
      <div className="grid items-center gap-4 md:grid-cols-[1fr_200px]">
        <svg viewBox="0 0 420 230" role="img" className="w-full"
          aria-label={`Shipments by state: ${byState.map(([s, n]) => `${s} ${n}`).join(", ")}`}>
          {/* v1.8.1 — the REAL outline: Natural-Earth low-res Malaysia
              (world.geo.json MYS), equirectangular-projected into this
              viewBox. Low-poly on purpose — a glance-level map in a flat
              brand tint, but now the actual country. */}
          <path strokeLinejoin="round" className="fill-tint-navy stroke-tint-navy" strokeWidth="6"
            d="M32.5 66.2 L34.2 76.8 L47.8 74.4 L54.6 65.8 L59.4 67.8 L71.6 80.3 L80.3 94.2 L81.5 108.1 L79.3 117.6 L81.3 124.7 L82.9 137.0 L90.2 142.7 L98.3 161.0 L97.9 168.0 L83.2 169.4 L63.6 154.1 L39.1 137.6 L36.6 127.0 L24.6 113.2 L21.8 96.0 L14.3 84.7 L16.6 69.6 L12.0 60.8 L15.6 57.1 L32.5 66.2 Z" />
          <path strokeLinejoin="round" className="fill-tint-navy stroke-tint-navy" strokeWidth="6"
            d="M396.3 102.0 L381.0 109.0 L363.1 105.6 L339.2 105.5 L332.0 129.1 L324.1 136.3 L313.4 165.2 L296.5 169.6 L276.9 163.8 L267.0 165.6 L254.9 176.1 L241.6 174.6 L228.3 178.8 L214.1 167.1 L210.6 153.2 L225.8 160.3 L241.8 156.5 L246.0 138.9 L254.9 135.0 L279.7 130.5 L294.6 114.1 L304.8 101.0 L314.2 111.7 L318.6 104.7 L328.5 105.3 L329.7 92.1 L330.6 81.9 L346.6 67.5 L357.1 51.3 L365.4 51.2 L376.1 61.7 L377.0 70.7 L390.7 76.5 L408.0 82.7 L406.5 90.8 L392.6 91.9 L396.3 102.0 Z" />
          {placeable.map(([s, n]) => {
            const [x, y] = STATE_POS[s]!;
            /* Cap the bubbles to the peninsula's scale — a dominant state
               must not swallow its neighbours' labels. */
            const r = 7 + (n / max) * 9;
            const short = s === "Kuala Lumpur" ? "KL" : s === "Negeri Sembilan" ? "N9" : s;
            return (
              <g key={s}>
                <circle cx={x} cy={y} r={r} className="fill-brand" opacity={0.92} />
                <circle cx={x} cy={y} r={r} fill="none" stroke="var(--background)" strokeWidth="2" />
                <text x={x} y={y + 3} textAnchor="middle"
                  style={{ fill: "var(--brand-accent)", fontSize: 9, fontWeight: 600 }}>{n}</text>
                {/* state label under the bubble — identity never size-alone */}
                <text x={x} y={y + r + 9} textAnchor="middle"
                  style={{ fill: "var(--muted-foreground)", fontSize: 8, fontWeight: 500 }}>{short}</text>
                <title>{s}: {n} shipment{n === 1 ? "" : "s"} ({Math.round((n / total) * 100)}%)</title>
              </g>
            );
          })}
        </svg>
        {/* the exact numbers with proportion bars — never circle-size-only */}
        <ul className="space-y-2">
          {byState.slice(0, 6).map(([s, n]) => {
            const pct = total > 0 ? Math.round((n / total) * 100) : 0;
            return (
              <li key={s} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground truncate">{s}</span>
                  <span className="font-medium tabular-nums">
                    {n}
                    <span className="text-muted-foreground ml-1.5 text-xs font-normal">{pct}%</span>
                  </span>
                </div>
                <span className="bg-secondary mt-1 block h-1 w-full overflow-hidden rounded-full" aria-hidden>
                  <span className="bg-gold-deep block h-full rounded-full" style={{ width: `${pct}%` }} />
                </span>
              </li>
            );
          })}
          {byState.length > 6 && (
            <li className="text-muted-foreground text-xs">+ {byState.length - 6} more states</li>
          )}
        </ul>
      </div>
    </section>
  );
}
