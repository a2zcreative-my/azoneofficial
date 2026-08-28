"use client";

/* v1.20.1 — Operations map, real geography.
   Real Malaysian state boundaries (Natural Earth-derived geometry, projected
   as the standard two insets: Peninsular Malaysia + Sabah & Sarawak). Every
   state is clickable — the side panel shows that state's orders, revenue and
   top buyer cities inline, so management reads the whole country without
   leaving the tab. Orders come from GET /staff/orders/geo (buyer city from
   the TikTok sync), grouped into states client-side. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { makeApi } from "@/lib/api";
import { card, btnSm } from "@/lib/ui-styles";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
/* v1.43.0 — the geometry and the city→state mapper moved VERBATIM to
   lib/malaysia-map.ts when the ELFIA Traffic map became their second
   consumer. This card's behaviour is unchanged. */
import { STATES, stateOf, titleCase } from "@/lib/malaysia-map";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type CityRow = { city: string; orders: number; cents: number };
type StateAgg = { orders: number; cents: number; cities: CityRow[] };

/* v1.64.3 (CEO: "Sales leaderboard can you clipped inside the Operations
   map ... so that I can minimalist the space?"): the side column had a
   third of its height empty below the state list. `aside` fills it, so the
   leaderboard costs a divider instead of a whole card. */
export function OpsMapCard({ aside }: { aside?: ReactNode } = {}) {
  const [cities, setCities] = useState<CityRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      void api<{ cities: CityRow[] }>(`/orders/geo`)
        .then((r) => setCities(r.ok && r.data?.cities ? r.data.cities : []));
    load();
    /* v1.24.1 (CEO): re-pull the state distribution the moment a "Sync from
       TikTok" pass finishes — no reload needed. */
    window.addEventListener("azone:tiktok-synced", load);
    return () => window.removeEventListener("azone:tiktok-synced", load);
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
      <p className="text-sm font-semibold">{L("Operations map — orders by state", "Peta operasi — pesanan mengikut negeri")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Where your TikTok orders ship (buyer city from the sync). Tap any state to see its orders and top buyer cities right here.", "Destinasi penghantaran pesanan TikTok anda (bandar pembeli daripada segerakan). Tekan mana-mana negeri untuk melihat pesanan dan bandar pembeli teratasnya di sini.")}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
        <svg viewBox="0 0 860 380" className="w-full" aria-label={L("Map of Malaysia — each state is a button showing its orders", "Peta Malaysia — setiap negeri ialah butang yang menunjukkan pesanannya")}>
          <text x="14" y="16" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">{L("PENINSULAR MALAYSIA", "SEMENANJUNG MALAYSIA")}</text>
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
                aria-label={`${s.name}: ${v ? L(`${v.orders} order${v.orders === 1 ? "" : "s"}, ${fmtRM(v.cents)}`, `${v.orders} pesanan, ${fmtRM(v.cents)}`) : L("no orders yet", "belum ada pesanan")}`}
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
                <title>{`${s.name} · ${v ? L(`${v.orders} order${v.orders === 1 ? "" : "s"} · ${fmtRM(v.cents)}`, `${v.orders} pesanan · ${fmtRM(v.cents)}`) : L("no orders yet", "belum ada pesanan")}`}</title>
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
        <div className="space-y-3">
        <div className="border-border rounded-xl border p-3">
          {sel ? (
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{sel}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {selData ? L(`${Math.round((selData.orders / Math.max(1, totalOrders)) * 100)}% of located orders`, `${Math.round((selData.orders / Math.max(1, totalOrders)) * 100)}% daripada pesanan yang dikesan`) : L("no orders yet", "belum ada pesanan")}
                  </p>
                </div>
                <button type="button" className={btnSm} onClick={() => setSel(null)}>{L("All states", "Semua negeri")}</button>
              </div>
              {selData ? (
                <>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <div className="bg-secondary rounded-lg px-2.5 py-2">
                      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Orders", "Pesanan")}</p>
                      <p className="text-sm font-semibold tabular-nums">{selData.orders}</p>
                    </div>
                    <div className="bg-secondary rounded-lg px-2.5 py-2">
                      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Revenue", "Hasil")}</p>
                      <p className="text-sm font-semibold tabular-nums">{fmtRM(selData.cents)}</p>
                    </div>
                  </div>
                  <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">{L("Top cities", "Bandar teratas")}</p>
                  <div className="mt-1.5 space-y-1">
                    {selData.cities.slice(0, 6).map((c) => (
                      <p key={c.city} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate">{titleCase(c.city)}</span>
                        <span className="tabular-nums font-semibold whitespace-nowrap">{c.orders}<span className="text-muted-foreground font-normal"> · {fmtRM(c.cents)}</span></span>
                      </p>
                    ))}
                    {selData.cities.length > 6 && (
                      <p className="text-muted-foreground text-[11px]">{L(`+${selData.cities.length - 6} more cities`, `+${selData.cities.length - 6} bandar lagi`)}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground mt-2.5 text-xs">{L(`No orders shipped to ${sel} yet.`, `Belum ada pesanan dihantar ke ${sel}.`)}</p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold">{L("Malaysia — all states", "Malaysia — semua negeri")}</p>
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
              <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">{L("Top states", "Negeri teratas")}</p>
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
                  <span>{L("Unmapped cities", "Bandar tidak dipetakan")}</span><span className="tabular-nums">{unknown}</span>
                </p>
              )}
              <p className="text-muted-foreground mt-2 text-[11px]">{L("Tap a state on the map for its city breakdown.", "Tekan negeri pada peta untuk pecahan bandarnya.")}</p>
            </div>
          )}
        </div>
        {aside}
        </div>
      </div>
    </div>
  );
}
