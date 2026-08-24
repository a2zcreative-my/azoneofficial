"use client";

/* v1.43.0 — ELFIA Traffic (CEO: "for ELFIA, I want to have a traffic to see
   which user that visit my pages … a new map like Operations map … a new tab
   for ELFIA traffic").

   The store's ANONYMOUS visitor aggregates (bridge feed D — OD-20a: no IPs,
   no per-person rows, daily-rotating hashes that never leave the store) drawn
   on the same Malaysia geometry as the Operations map (lib/malaysia-map.ts).
   Tap a state for its cities and pages; Today / 7 / 30-day ranges; and a
   visits-vs-orders line per state, computed client-side by running the ELFIA
   web orders' addresses through the shared city→state mapper — the closest
   honest "conversion" that exists without tracking anybody. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { makeApi } from "@/lib/api";
import { card, btnSm } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import { STATES, stateOf, titleCase } from "@/lib/malaysia-map";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type DayRow = { day: string; visits: number; visitors: number };
type StateRow = { state: string; visits: number; visitors: number };
type TrafficSummary = {
  days: DayRow[]; states: StateRow[]; span: number; from: string;
  last_poll_at: string | null; pending_migration?: boolean;
};
type TrafficDetail = {
  state: string; cities: { city: string; visits: number }[];
  paths: { path: string; visits: number }[]; pending_migration?: boolean;
};
type WebOrder = { address?: string | null; placed_at?: string | null; status?: string };

const SPANS: { days: number; en: string; ms: string }[] = [
  { days: 1, en: "Today", ms: "Hari ini" },
  { days: 7, en: "7 days", ms: "7 hari" },
  { days: 30, en: "30 days", ms: "30 hari" },
];

export function ElfiaTrafficPanel() {
  const [span, setSpan] = useState(7);
  const [data, setData] = useState<TrafficSummary | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrafficDetail | null>(null);
  const [orders, setOrders] = useState<WebOrder[] | null>(null);

  const load = useCallback(() => {
    void api<TrafficSummary>(`/web-traffic?days=${span}`)
      .then((r) => setData(r.ok && r.data ? r.data : null));
  }, [span]);
  useEffect(() => { setSel(null); setDetail(null); load(); }, [load]);

  /* The conversion line's denominator: ELFIA web orders, mapped to states by
     address text. Best-effort — a role without the Web Orders permission, or
     a pre-0081 database, simply shows the map without conversion. */
  useEffect(() => {
    void api<{ orders: WebOrder[] }>(`/web-orders`)
      .then((r) => setOrders(r.ok && r.data?.orders ? r.data.orders : null))
      .catch(() => setOrders(null));
  }, []);

  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    setDetail(null);
    void api<TrafficDetail>(`/web-traffic/detail?state=${encodeURIComponent(sel)}&days=${span}`)
      .then((r) => setDetail(r.ok && r.data ? r.data : null));
  }, [sel, span]);

  const ordersByState = useMemo(() => {
    const m = new Map<string, number>();
    if (!orders || !data) return m;
    for (const o of orders) {
      if (o.status === "cancelled") continue;
      const placed = (o.placed_at ?? "").slice(0, 10);
      if (placed && placed < data.from) continue;
      const st = stateOf(o.address ?? "");
      if (st) m.set(st, (m.get(st) ?? 0) + 1);
    }
    return m;
  }, [orders, data]);

  const byState = useMemo(() => {
    const m = new Map<string, StateRow>();
    for (const s of data?.states ?? []) m.set(s.state, s);
    return m;
  }, [data]);

  const totals = useMemo(() => {
    let visits = 0, visitors = 0;
    for (const d of data?.days ?? []) { visits += d.visits; visitors += d.visitors; }
    return { visits, visitors };
  }, [data]);

  if (!data) return null;

  const notConfigured = !data.pending_migration && data.last_poll_at === null && data.states.length === 0;
  const maxVisits = Math.max(1, ...[...byState.values()].filter((s) => s.state !== "Outside Malaysia").map((s) => s.visits));
  const abroad = byState.get("Outside Malaysia");
  const top = [...byState.values()].filter((s) => s.state !== "Outside Malaysia").slice(0, 5);
  const selData = sel ? byState.get(sel) : undefined;
  const toggle = (name: string) => setSel((cur) => (cur === name ? null : name));
  const drawOrder = sel ? [...STATES.filter((s) => s.name !== sel), ...STATES.filter((s) => s.name === sel)] : STATES;
  const convLine = (st: string, visits: number) => {
    const n = ordersByState.get(st);
    if (!n || visits <= 0) return null;
    return L(`${n} order${n === 1 ? "" : "s"} · ${(Math.min(1, n / visits) * 100).toFixed(1)}% of visits`,
             `${n} pesanan · ${(Math.min(1, n / visits) * 100).toFixed(1)}% daripada lawatan`);
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{L("ELFIA Traffic — visitors by state", "Trafik ELFIA — pelawat mengikut negeri")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Where the ELFIA store's visitors browse from and what they look at — anonymous by design: locations and counts only, never identities.",
               "Dari mana pelawat kedai ELFIA melayari dan apa yang mereka lihat — tanpa nama secara reka bentuk: lokasi dan bilangan sahaja, bukan identiti.")}
          </p>
        </div>
        <div className="flex gap-1">
          {SPANS.map((s) => (
            <button key={s.days} type="button" onClick={() => setSpan(s.days)}
              className={`${btnSm} ${span === s.days ? "!bg-primary !text-primary-foreground" : ""}`}>
              {L(s.en, s.ms)}
            </button>
          ))}
        </div>
      </div>

      {data.pending_migration ? (
        <p className="text-warning mt-3 text-xs">
          {L("Database migration 0084 has not run yet — deploy with DEPLOY.bat (it applies migrations first).",
             "Migrasi pangkalan data 0084 belum dijalankan — gunakan DEPLOY.bat (ia menjalankan migrasi dahulu).")}
        </p>
      ) : notConfigured ? (
        <p className="text-muted-foreground mt-3 text-xs">
          {L("Waiting for the first traffic pull. The map fills by itself once the ELFIA bridge secrets are set and the store's v1.2.0 is live — visitors are counted from that moment (never retroactively).",
             "Menunggu tarikan trafik pertama. Peta ini terisi sendiri setelah rahsia jambatan ELFIA ditetapkan dan kedai v1.2.0 dilancarkan — pelawat dikira dari saat itu (tidak berlaku surut).")}
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-secondary rounded-lg px-2.5 py-2">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Page views", "Paparan halaman")}</p>
              <p className="text-sm font-semibold tabular-nums">{totals.visits}</p>
            </div>
            <div className="bg-secondary rounded-lg px-2.5 py-2">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Visitors", "Pelawat")}</p>
              <p className="text-sm font-semibold tabular-nums">{totals.visitors}</p>
              {span > 1 && <p className="text-muted-foreground text-[10px]">{L("daily uniques, summed", "unik harian, dijumlah")}</p>}
            </div>
            <div className="bg-secondary rounded-lg px-2.5 py-2">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Last pull", "Tarikan akhir")}</p>
              <p className="text-xs font-semibold">{data.last_poll_at ? data.last_poll_at.slice(5, 16) : "—"}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
            <svg viewBox="0 0 860 380" className="w-full" aria-label={L("Map of Malaysia — each state is a button showing its store visitors", "Peta Malaysia — setiap negeri ialah butang yang menunjukkan pelawat kedainya")}>
              <text x="14" y="16" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">{L("PENINSULAR MALAYSIA", "SEMENANJUNG MALAYSIA")}</text>
              <text x="340" y="46" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">SABAH &amp; SARAWAK</text>
              <line x1="320" y1="24" x2="320" y2="364" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
              {drawOrder.map((s) => {
                const v = byState.get(s.name);
                const ratio = v ? v.visits / maxVisits : 0;
                const isSel = sel === s.name;
                return (
                  <path
                    key={s.name}
                    d={s.d}
                    role="button"
                    tabIndex={0}
                    aria-label={`${s.name}: ${v ? L(`${v.visits} page view${v.visits === 1 ? "" : "s"}`, `${v.visits} paparan halaman`) : L("no visits yet", "belum ada lawatan")}`}
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
                    <title>{`${s.name} · ${v ? L(`${v.visits} view${v.visits === 1 ? "" : "s"} · ${v.visitors} visitor${v.visitors === 1 ? "" : "s"}`, `${v.visits} paparan · ${v.visitors} pelawat`) : L("no visits yet", "belum ada lawatan")}`}</title>
                  </path>
                );
              })}
              {STATES.map((s) => {
                const v = byState.get(s.name);
                if (!v) return null;
                const r = 9 + Math.sqrt(v.visits / maxVisits) * 9;
                return (
                  <g key={`b-${s.name}`} className="pointer-events-none">
                    <circle cx={s.cx} cy={s.cy} r={r} fill="var(--brand-primary)" stroke="var(--gold-solid)" strokeWidth="1.5" opacity="0.92" />
                    <text x={s.cx} y={s.cy + 3.5} textAnchor="middle" style={{ font: "700 10px sans-serif", fill: "#fff" }}>{v.visits}</text>
                  </g>
                );
              })}
            </svg>

            {/* Inline detail panel — same reading pattern as the ops map. */}
            <div className="border-border rounded-xl border p-3">
              {sel ? (
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{sel}</p>
                      <p className="text-muted-foreground text-[11px]">
                        {selData
                          ? L(`${Math.round((selData.visits / Math.max(1, totals.visits)) * 100)}% of page views`, `${Math.round((selData.visits / Math.max(1, totals.visits)) * 100)}% daripada paparan halaman`)
                          : L("no visits yet", "belum ada lawatan")}
                      </p>
                    </div>
                    <button type="button" className={btnSm} onClick={() => setSel(null)}>{L("All states", "Semua negeri")}</button>
                  </div>
                  {selData ? (
                    <>
                      <div className="mt-2.5 grid grid-cols-2 gap-2">
                        <div className="bg-secondary rounded-lg px-2.5 py-2">
                          <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Views", "Paparan")}</p>
                          <p className="text-sm font-semibold tabular-nums">{selData.visits}</p>
                        </div>
                        <div className="bg-secondary rounded-lg px-2.5 py-2">
                          <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Visitors", "Pelawat")}</p>
                          <p className="text-sm font-semibold tabular-nums">{selData.visitors}</p>
                        </div>
                      </div>
                      {convLine(sel, selData.visits) && (
                        <p className="text-muted-foreground mt-2 text-[11px]">🛒 {convLine(sel, selData.visits)}</p>
                      )}
                      <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">{L("Top cities", "Bandar teratas")}</p>
                      <div className="mt-1.5 space-y-1">
                        {(detail?.cities ?? []).slice(0, 6).map((c) => (
                          <p key={c.city} className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate">{titleCase(c.city)}</span>
                            <span className="tabular-nums font-semibold whitespace-nowrap">{c.visits}</span>
                          </p>
                        ))}
                        {detail && detail.cities.length === 0 && (
                          <p className="text-muted-foreground text-[11px]">{L("No city detail for this range.", "Tiada perincian bandar untuk julat ini.")}</p>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">{L("Top pages", "Halaman teratas")}</p>
                      <div className="mt-1.5 space-y-1">
                        {(detail?.paths ?? []).slice(0, 6).map((p) => (
                          <p key={p.path} className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate font-mono text-[11px]">{p.path}</span>
                            <span className="tabular-nums font-semibold whitespace-nowrap">{p.visits}</span>
                          </p>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground mt-2.5 text-xs">{L(`No store visits from ${sel} in this range.`, `Tiada lawatan kedai dari ${sel} dalam julat ini.`)}</p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm font-semibold">{L("Malaysia — all states", "Malaysia — semua negeri")}</p>
                  <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">{L("Top states", "Negeri teratas")}</p>
                  <div className="mt-1 -mx-1">
                    {top.map((s) => (
                      <button
                        key={s.state}
                        type="button"
                        onClick={() => setSel(s.state)}
                        className="hover:bg-secondary flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors"
                      >
                        <span>{s.state}</span>
                        <span className="tabular-nums font-semibold">{s.visits}<span className="text-muted-foreground font-normal"> · {s.visitors} {L("visitors", "pelawat")}</span></span>
                      </button>
                    ))}
                    {top.length === 0 && (
                      <p className="text-muted-foreground px-1 text-[11px]">{L("No visits in this range yet.", "Belum ada lawatan dalam julat ini.")}</p>
                    )}
                  </div>
                  {abroad && (
                    <p className="text-muted-foreground mt-1.5 flex items-baseline justify-between px-1 text-[11px]">
                      <span>{L("Outside Malaysia", "Luar Malaysia")}</span><span className="tabular-nums">{abroad.visits}</span>
                    </p>
                  )}
                  <p className="text-muted-foreground mt-2 text-[11px]">{L("Tap a state on the map for its cities, pages and orders.", "Tekan negeri pada peta untuk bandar, halaman dan pesanannya.")}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
