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

/* Bubble anchors on the 420×230 viewBox below. */
const STATE_POS: Record<string, [number, number]> = {
  Perlis: [52, 22], Kedah: [58, 44], Penang: [44, 66], Perak: [70, 84],
  Kelantan: [98, 48], Terengganu: [120, 62], Pahang: [104, 104],
  Selangor: [70, 122], "Kuala Lumpur": [82, 130], Putrajaya: [80, 140],
  "Negeri Sembilan": [92, 146], Melaka: [96, 164], Johor: [116, 186],
  Sarawak: [268, 168], Sabah: [352, 82], Labuan: [330, 96],
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

  return (
    <section className={tile} aria-label="Orders by state">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">Operations map</p>
        <span className="text-muted-foreground text-xs">last {rows.length} shipments</span>
      </div>
      <div className="grid items-center gap-4 md:grid-cols-[1fr_180px]">
        <svg viewBox="0 0 420 230" role="img" className="w-full"
          aria-label={`Shipments by state: ${byState.map(([s, n]) => `${s} ${n}`).join(", ")}`}>
          {/* Stylised silhouettes — peninsular Malaysia + Borneo strip.
              A glance-level shape, deliberately simplified (≈design-mandate
              minimalism), tinted with the brand token. */}
          <path
            d="M46 12 C60 6 72 14 74 28 C90 30 104 36 112 50 C124 54 130 66 128 80 C124 96 118 108 112 118 C106 134 108 150 118 164 C126 176 128 190 120 200 C110 212 96 210 88 200 C78 188 70 174 64 158 C56 140 54 122 56 106 C50 92 48 76 50 60 C44 46 40 26 46 12 Z"
            className="fill-tint-navy" />
          <path
            d="M230 190 C244 172 260 158 278 150 C294 142 310 128 320 112 C328 96 338 82 352 70 C364 60 380 58 392 66 C402 74 404 88 396 98 C386 112 376 124 368 138 C356 152 344 164 330 172 C312 182 294 190 276 196 C260 200 242 200 230 190 Z"
            className="fill-tint-navy" />
          {placeable.map(([s, n]) => {
            const [x, y] = STATE_POS[s]!;
            const r = 8 + (n / max) * 12;
            return (
              <g key={s}>
                <circle cx={x} cy={y} r={r} className="fill-brand" opacity={0.92} />
                <circle cx={x} cy={y} r={r} fill="none" stroke="var(--background)" strokeWidth="2" />
                <text x={x} y={y + 3.5} textAnchor="middle"
                  style={{ fill: "var(--brand-accent)", fontSize: 10, fontWeight: 600 }}>{n}</text>
                <title>{s}: {n} shipment{n === 1 ? "" : "s"}</title>
              </g>
            );
          })}
        </svg>
        {/* the exact numbers — never circle-size-only */}
        <ul className="space-y-1">
          {byState.slice(0, 6).map(([s, n]) => (
            <li key={s} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground truncate">{s}</span>
              <span className="font-medium tabular-nums">{n}</span>
            </li>
          ))}
          {byState.length > 6 && (
            <li className="text-muted-foreground text-xs">+ {byState.length - 6} more</li>
          )}
        </ul>
      </div>
    </section>
  );
}
