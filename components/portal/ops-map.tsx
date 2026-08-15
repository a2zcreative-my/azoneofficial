"use client";

/* v1.20.1 — Operations map, real geography.
   Real Malaysian state boundaries (Natural Earth-derived geometry, projected
   as the standard two insets: Peninsular Malaysia + Sabah & Sarawak). Every
   state is clickable — the side panel shows that state's orders, revenue and
   top buyer cities inline, so management reads the whole country without
   leaving the tab. Orders come from GET /staff/orders/geo (buyer city from
   the TikTok sync), grouped into states client-side. */

import { useEffect, useMemo, useState } from "react";
import { makeApi } from "@/lib/api";
import { card, btnSm } from "@/lib/ui-styles";
import { fmtRM } from "@/lib/format";

const api = makeApi("/staff");

/* Real state boundary paths on a 860×380 canvas (Mercator, 1dp).
   Generated offline from @highcharts/map-collection (Natural Earth data) —
   the geometry is inlined here so the app itself gains no dependency. */
type StateShape = { name: string; d: string; cx: number; cy: number };
const STATES: StateShape[] = [
  { name: "Sabah", cx: 702.1, cy: 140.4,
    d: "M764.0,176.6L764.0,176.6L764.0,176.6ZM756.4,167.6L759.6,170.0L750.5,167.3ZM744.6,121.1L744.6,121.1L744.6,121.1ZM714.5,88.4L714.5,88.4L714.5,88.4ZM697.7,60.9L697.7,60.9L697.7,60.9ZM707.3,65.6L699.7,69.6L699.4,62.8L703.1,60L708.1,61.3ZM733.1,187.8L724.9,187.6L724.8,183.4ZM633.8,155.5L639.2,151.3L641.1,145.5L636.5,145.1L631.3,141.3L633.1,137.1L638.9,132.4L640.3,129.3L643.8,132.8L650.8,131.6L653.6,124.1L658.9,120.3L662.5,111.0L661.1,108.8L668.5,102.9L670.7,98.7L677.0,94.0L682.7,85.1L683.6,78.7L687.9,72.6L690.1,74.8L691.2,81.1L688.0,88.7L689.8,90.5L695.7,85.5L699.1,79.9L697.9,77.3L702.6,73.6L707.0,76.2L705.9,80.2L709.2,88.7L714.5,91.7L718.1,89.0L726.5,98.2L725.7,103.7L720.8,106.0L723.7,114.4L716.5,118.1L727.7,117.6L737.5,111.5L741.8,119.4L733.1,122.6L735.3,126.5L742.1,126.4L743.2,122.2L747.3,120.8L753.1,122.1L773.4,135.8L780.1,137.6L784.9,136.3L787.6,139.5L787.3,146.0L782.9,149.8L764.0,156.3L757.1,156.8L751.0,152.5L742.2,158.8L750.1,168.0L756.3,171.1L762.5,176.3L758.4,179.7L742.2,182.1L736.9,184.8L732.4,183.8L723.6,177.1L721.0,178.8L722.8,182.7L719.5,187.7L714.2,186.7L705.5,179.9L703.4,180.8L689.0,180.9L685.2,179.4L672.5,182.3L669.2,178.7L661.9,178.9L657.7,183.2L650.6,178.5L649.6,182.8L642.4,188.3L643.9,181.6L640.8,178.9L639.3,170.6L643.2,161.0L641.8,155.7Z" },
  { name: "Sarawak", cx: 548.3, cy: 250.5,
    d: "M473.6,258.6L469.5,256.0L469.8,242.7L472.4,246.2ZM633.8,155.5L641.8,155.7L643.2,161.0L639.3,170.6L640.8,178.9L643.9,181.6L642.4,188.3L641.3,194.2L638.4,198.2L640.5,199.8L638.8,209.9L640.9,216.5L637.6,219.8L637.6,227.8L635.5,232.9L629.3,234.7L626.6,232.5L619.6,241.0L619.2,249.8L623.4,250.5L625.2,253.7L622.0,255.0L613.7,262.3L608.1,264.2L608.2,272.6L610.8,273.1L610.2,278L603.8,281.3L603.7,286.3L597.0,296.6L591.2,294.0L583.4,297.1L579.2,295.5L573.4,296.4L563.0,304.7L557.1,301.5L552.9,302.3L550.0,300.0L540.6,296.8L535.4,297.4L538.0,292.6L531.3,290.8L527.8,292.0L515.9,291.4L504.3,296.1L504.4,299.3L501.2,307.8L493.5,309.5L490.0,313.7L483.4,312.8L478.7,314.2L471.2,313.5L465.1,311.0L451.3,314.2L448.5,317.7L439.4,320L431.3,314.6L427.8,314.3L424.0,307.1L419.3,305.4L414.6,298.9L410.9,297.9L402.9,288.6L402.9,282.8L398.4,278.5L403.1,270.8L403.5,276.6L406.5,280.5L412.7,283.7L414.4,286.4L427.4,285.9L430.9,282.2L431.8,285.5L438.0,285.2L435.8,289.3L446.3,292.2L450.7,291.4L463.4,299.4L457.5,291.9L458.7,287.0L462.7,286.8L461.0,283.1L465.6,271.2L464.5,268.3L465.5,258.6L467.0,256.7L471.8,260.5L475.0,259.2L473.3,254.7L474.7,246.9L483.9,240.4L497.6,238.7L526.2,231.5L537.4,227.6L539.8,222.9L548.1,214.7L554.4,204.0L566.5,194.0L574.9,183.1L577.0,170.0L586.8,174.8L588.3,183.5L593.7,183.7L600.4,193.3L607.6,188.8L608.2,182.7L610.8,177.1L608.2,174.2L607.0,164.5L614.9,161.3L617.6,157.4L618.4,169.2L621.4,178.8L631.4,180.9L627.8,175.1L627.9,168.6L625.2,161.0L622.8,158.6L624.9,156.0L631.2,157.9Z" },
  { name: "Labuan", cx: 625.7, cy: 141.6,
    d: "M627.3,142.3L623.3,143.9L626.6,138.5Z" },
  { name: "Pulau Pinang", cx: 61.4, cy: 111.3,
    d: "M54.9,105.6L57.0,107.7L53.6,117.3L47.9,115.0L47.6,104.9ZM60.6,126.1L62.3,114.8L57.6,98.4L68.7,99.5L70.2,124.4L66.8,125.2Z" },
  { name: "Kedah", cx: 74, cy: 75.4,
    d: "M30.5,47.5L30.7,51.2L19.2,55.5L14,44.7L22.7,45.5L26.7,42.9ZM26.0,54.5L26.0,54.5L26.0,54.5ZM57.6,98.4L58.9,83.4L57.2,70.9L48.1,55.5L58.3,43.5L59.0,39.1L75.7,44.0L79.7,41.2L85.4,46.0L86.3,55.6L102.4,56.5L101.7,76.7L95.6,85.7L94.1,99.4L87.4,112.5L82.7,113.7L70.2,128.5L66.8,125.2L70.2,124.4L68.7,99.5Z" },
  { name: "Selangor", cx: 128.5, cy: 239.7,
    d: "M113.3,255.0L113.3,255.0L113.3,255.0ZM114.4,258.8L114.4,258.8L114.4,258.8ZM141.8,281.8L130.7,277.7L121.9,268.0L115.0,266.1L120.3,256.7L115.7,240.0L104.1,227.6L99.9,218.5L85.9,208.4L87.6,204.9L93.8,203.9L113.2,215.4L118.7,213.5L118.8,208.0L129.7,215.1L135.9,209.3L147.3,220.0L144.4,233.9L153.7,240.8L156.6,254.5L150.4,265.6L144.1,265.3L144.9,273.0ZM138.6,254.7L142.4,255.0L144.3,246.0L138.3,242.6L135.6,245.6ZM139.0,264.5L139.0,264.5L139.0,264.5Z" },
  { name: "Pahang", cx: 193, cy: 211.8,
    d: "M289.6,270.6L293.4,263.9L294.9,274.4ZM247.7,184.8L244.7,188.1L247.3,196.7L241.2,210.1L250.1,225.3L246.7,234.2L248.4,244.3L247.1,259.2L249.5,266.0L259.8,277.1L257.8,290.8L242.9,281.9L230.2,285.8L219.9,281.8L209.1,269.5L202.2,266.8L182.8,249.6L166.5,244.8L162.9,246.2L153.7,240.8L144.4,233.9L147.3,220.0L135.9,209.3L131.9,194.9L133.3,190.1L126.1,181.8L124.6,171.5L118.4,168.6L120.6,157.4L125.7,159.9L137.9,160.2L144.7,155.6L145.2,149.7L152.8,156.7L156.6,148.3L166.1,148.4L171.1,155.5L179.9,155.4L181.8,151.8L195.6,152.4L199.5,147.7L210.9,153.5L213.5,166.2L222.0,170.6L216.3,178.4L216.7,188.5L219.9,187.0L235.0,194.0L239.0,201.9L241.5,197.9L239.2,191.2L241.7,184.1Z" },
  { name: "Kuala Lumpur", cx: 140.1, cy: 248.7,
    d: "M138.6,254.7L135.6,245.6L138.3,242.6L144.3,246.0L142.4,255.0Z" },
  { name: "Putrajaya", cx: 139, cy: 264.5,
    d: "M139.0,264.5L139.0,264.5L139.0,264.5Z" },
  { name: "Perlis", cx: 50.7, cy: 40.6,
    d: "M48.1,55.5L43.7,44.3L46.1,28.7L53.1,29.0L59.0,39.1L58.3,43.5Z" },
  { name: "Johor", cx: 243.8, cy: 315.5,
    d: "M259.8,277.1L267.6,280.0L272.0,289.8L278.7,297.5L280.4,306.6L294.0,330.8L300,352.5L299.0,357.4L288.5,356.9L282.7,343.2L280.3,354.2L272.1,350.6L262.3,352.8L252.2,363.3L243.0,346.9L222.7,335.9L216.3,333.9L208.3,327.0L203.3,327.8L189.0,312.7L193.0,294.0L195.8,292.5L197.9,279.4L202.2,266.8L209.1,269.5L219.9,281.8L230.2,285.8L242.9,281.9L257.8,290.8Z" },
  { name: "Perak", cx: 104.3, cy: 147.8,
    d: "M87.6,204.9L80.2,203.3L80.1,195.8L85.1,195.8L83.0,189.0L74.8,185.6L70.6,175.5L74.8,162.3L71.4,142.5L66.3,141.4L60.5,134.0L60.6,126.1L66.8,125.2L70.2,128.5L82.7,113.7L87.4,112.5L94.1,99.4L95.6,85.7L103.9,94.1L111.2,90.3L112.7,84.8L133.0,77.4L140.2,86.1L138.6,101.4L143.7,103.5L143.4,111.1L135.5,111.2L130.1,116.5L122.6,143.9L120.6,157.4L118.4,168.6L124.6,171.5L126.1,181.8L133.3,190.1L131.9,194.9L135.9,209.3L129.7,215.1L118.8,208.0L118.7,213.5L113.2,215.4L93.8,203.9Z" },
  { name: "Kelantan", cx: 161, cy: 115.9,
    d: "M120.6,157.4L122.6,143.9L130.1,116.5L135.5,111.2L143.4,111.1L143.7,103.5L138.6,101.4L140.2,86.1L146.6,87.7L153.5,80.4L156.4,71.0L162.6,65.8L163.4,55.7L171.1,57.3L182.2,63.4L192.3,80.7L182.6,91.1L183.2,107.4L186.0,110.7L184.4,122.4L191.4,126.9L191.3,139.6L198.4,142.8L199.5,147.7L195.6,152.4L181.8,151.8L179.9,155.4L171.1,155.5L166.1,148.4L156.6,148.3L152.8,156.7L145.2,149.7L144.7,155.6L137.9,160.2L125.7,159.9Z" },
  { name: "Melaka", cx: 178.5, cy: 298.2,
    d: "M195.8,292.5L193.0,294.0L189.0,312.7L170.4,305.1L158.2,294.4L170.2,288.1L182.5,288.4Z" },
  { name: "Negeri Sembilan", cx: 171.5, cy: 270.7,
    d: "M202.2,266.8L197.9,279.4L195.8,292.5L182.5,288.4L170.2,288.1L158.2,294.4L150.6,294.1L145.5,283.0L141.8,281.8L144.9,273.0L144.1,265.3L150.4,265.6L156.6,254.5L153.7,240.8L162.9,246.2L166.5,244.8L182.8,249.6Z" },
  { name: "Terengganu", cx: 217.8, cy: 138,
    d: "M199.5,147.7L198.4,142.8L191.3,139.6L191.4,126.9L184.4,122.4L186.0,110.7L183.2,107.4L182.6,91.1L192.3,80.7L200.0,88.7L212.7,98.2L217.9,100.0L227.8,110.0L247.9,146.1L248.2,165.1L251.0,176.3L247.7,184.8L241.7,184.1L239.2,191.2L241.5,197.9L239.0,201.9L235.0,194.0L219.9,187.0L216.7,188.5L216.3,178.4L222.0,170.6L213.5,166.2L210.9,153.5Z" },
];

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

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

type CityRow = { city: string; orders: number; cents: number };
type StateAgg = { orders: number; cents: number; cities: CityRow[] };

export function OpsMapCard() {
  const [cities, setCities] = useState<CityRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    void api<{ cities: CityRow[] }>(`/orders/geo`)
      .then((r) => setCities(r.ok && r.data?.cities ? r.data.cities : []));
  }, []);

  const agg = useMemo(() => {
    const byState = new Map<string, StateAgg>();
    let unknown = 0;
    for (const c of cities ?? []) {
      const st = stateOf(c.city);
      if (!st) { unknown += c.orders; continue; }
      const cur = byState.get(st) ?? { orders: 0, cents: 0, cities: [] };
      cur.orders += c.orders; cur.cents += c.cents; cur.cities.push(c);
      byState.set(st, cur);
    }
    for (const v of byState.values()) v.cities.sort((a, b) => b.orders - a.orders);
    let totalOrders = 0, totalCents = 0;
    for (const v of byState.values()) { totalOrders += v.orders; totalCents += v.cents; }
    return { byState, unknown, totalOrders, totalCents };
  }, [cities]);

  if (!cities) return null;
  if (cities.length === 0) return null; // no located orders yet — render nothing

  const { byState, unknown, totalOrders, totalCents } = agg;
  const maxOrders = Math.max(1, ...[...byState.values()].map((v) => v.orders));
  const top = [...byState.entries()].sort((a, b) => b[1].orders - a[1].orders).slice(0, 5);
  const selData = sel ? byState.get(sel) : undefined;

  const toggle = (name: string) => setSel((cur) => (cur === name ? null : name));

  /* Selected state renders last so its highlight stroke sits above neighbours. */
  const drawOrder = sel ? [...STATES.filter((s) => s.name !== sel), ...STATES.filter((s) => s.name === sel)] : STATES;

  return (
    <div className={card}>
      <p className="text-sm font-semibold">Operations map — orders by state</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Where your TikTok orders ship (buyer city from the sync). Tap any state to see its orders and top buyer cities right here.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
        <svg viewBox="0 0 860 380" className="w-full" aria-label="Map of Malaysia — each state is a button showing its orders">
          <text x="14" y="16" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">PENINSULAR MALAYSIA</text>
          <text x="340" y="46" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">SABAH &amp; SARAWAK</text>
          <line x1="320" y1="24" x2="320" y2="364" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
          {drawOrder.map((s) => {
            const v = byState.get(s.name);
            const ratio = v ? v.orders / maxOrders : 0;
            const isSel = sel === s.name;
            return (
              <path
                key={s.name}
                d={s.d}
                role="button"
                tabIndex={0}
                aria-label={`${s.name}: ${v ? `${v.orders} order${v.orders === 1 ? "" : "s"}, ${fmtRM(v.cents)}` : "no orders yet"}`}
                aria-pressed={isSel}
                onClick={() => toggle(s.name)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s.name); } }}
                className="cursor-pointer outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
                fill={v ? "var(--gold-solid)" : "var(--secondary)"}
                fillOpacity={v ? 0.3 + 0.55 * ratio : 1}
                stroke={isSel ? "var(--primary)" : "var(--border)"}
                strokeWidth={isSel ? 2.5 : 1}
                strokeLinejoin="round"
              >
                <title>{`${s.name} · ${v ? `${v.orders} order${v.orders === 1 ? "" : "s"} · ${fmtRM(v.cents)}` : "no orders yet"}`}</title>
              </path>
            );
          })}
          {STATES.map((s) => {
            const v = byState.get(s.name);
            if (!v) return null;
            const r = 9 + Math.sqrt(v.orders / maxOrders) * 9;
            return (
              <g key={`b-${s.name}`} className="pointer-events-none">
                <circle cx={s.cx} cy={s.cy} r={r} fill="var(--brand-primary)" stroke="var(--gold-solid)" strokeWidth="1.5" opacity="0.92" />
                <text x={s.cx} y={s.cy + 3.5} textAnchor="middle" style={{ font: "700 10px sans-serif", fill: "#fff" }}>{v.orders}</text>
              </g>
            );
          })}
        </svg>

        {/* Inline detail panel — the click target's data, no tab hop. */}
        <div className="border-border rounded-xl border p-3">
          {sel ? (
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{sel}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {selData ? `${Math.round((selData.orders / Math.max(1, totalOrders)) * 100)}% of located orders` : "no orders yet"}
                  </p>
                </div>
                <button type="button" className={btnSm} onClick={() => setSel(null)}>All states</button>
              </div>
              {selData ? (
                <>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <div className="bg-secondary rounded-lg px-2.5 py-2">
                      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Orders</p>
                      <p className="text-sm font-semibold tabular-nums">{selData.orders}</p>
                    </div>
                    <div className="bg-secondary rounded-lg px-2.5 py-2">
                      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Revenue</p>
                      <p className="text-sm font-semibold tabular-nums">{fmtRM(selData.cents)}</p>
                    </div>
                  </div>
                  <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">Top cities</p>
                  <div className="mt-1.5 space-y-1">
                    {selData.cities.slice(0, 6).map((c) => (
                      <p key={c.city} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate">{titleCase(c.city)}</span>
                        <span className="tabular-nums font-semibold whitespace-nowrap">{c.orders}<span className="text-muted-foreground font-normal"> · {fmtRM(c.cents)}</span></span>
                      </p>
                    ))}
                    {selData.cities.length > 6 && (
                      <p className="text-muted-foreground text-[11px]">+{selData.cities.length - 6} more cities</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground mt-2.5 text-xs">No orders shipped to {sel} yet.</p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold">Malaysia — all states</p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <div className="bg-secondary rounded-lg px-2.5 py-2">
                  <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Orders</p>
                  <p className="text-sm font-semibold tabular-nums">{totalOrders}</p>
                </div>
                <div className="bg-secondary rounded-lg px-2.5 py-2">
                  <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Revenue</p>
                  <p className="text-sm font-semibold tabular-nums">{fmtRM(totalCents)}</p>
                </div>
              </div>
              <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">Top states</p>
              <div className="mt-1 -mx-1">
                {top.map(([st, v]) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSel(st)}
                    className="hover:bg-secondary flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors"
                  >
                    <span>{st}</span>
                    <span className="tabular-nums font-semibold">{v.orders}<span className="text-muted-foreground font-normal"> · {fmtRM(v.cents)}</span></span>
                  </button>
                ))}
              </div>
              {unknown > 0 && (
                <p className="text-muted-foreground mt-1.5 flex items-baseline justify-between px-1 text-[11px]">
                  <span>Unmapped cities</span><span className="tabular-nums">{unknown}</span>
                </p>
              )}
              <p className="text-muted-foreground mt-2 text-[11px]">Tap a state on the map for its city breakdown.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
