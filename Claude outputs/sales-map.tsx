"use client";

/**
 * THE SALES MAP — v1.113.0.
 *
 * The CEO, 05-09-2026: *"on Sales tabs should add Sales mapped like ecommerce
 * or hotel type for me to monitor on the sales state location and revenue by
 * states."* The fourth consumer of lib/malaysia-map.ts, drawn in the same
 * language as the Operations, ELFIA Traffic and Hotels maps - gold choropleth,
 * navy bubble, the two insets and the dashed divider - so the portal's maps
 * read as one product.
 *
 * Two layers, one switch: A2Z INVOICES placed by the customer's state
 * (invoiced, with paid inside it), and ELFIA WEB ORDERS the portal has seen
 * paid, placed by the shipping state. Three ranges: this month, this year,
 * all time. Press a state for its own figures. What the server could not
 * place - an address with no readable state - is shown as a line under the
 * map with its money, never silently dropped.
 *
 * WHO: revenue_view, which is the Sales tab's own tier. Remembered on the
 * device and live on the topics a sale or an order moves.
 */

import { useMemo, useState } from "react";
import { useCachedApi } from "@/lib/cached-api";
import { Skel, StaleHint } from "@/components/ui/skeleton";
import { card, btnSm } from "@/lib/ui-styles";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { STATES } from "@/lib/malaysia-map";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Cell { invoices: number; invoiced_cents: number; paid_cents: number; orders: number; order_cents: number }
interface Data { range: string; since: string | null; states: Record<string, Cell>; unplaced: Cell; totals: Cell; generated_at: string }

type Layer = "invoices" | "orders";
type RangeKey = "month" | "year" | "all";
const RANGES: { key: RangeKey; en: string; ms: string }[] = [
  { key: "month", en: "This month", ms: "Bulan ini" },
  { key: "year", en: "This year", ms: "Tahun ini" },
  { key: "all", en: "All time", ms: "Sepanjang masa" },
];
const stateKey = (geometryName: string): string => geometryName.toUpperCase();
const cents = (c: Cell | undefined, layer: Layer): number => (c ? (layer === "invoices" ? c.invoiced_cents : c.order_cents) : 0);
const count = (c: Cell | undefined, layer: Layer): number => (c ? (layer === "invoices" ? c.invoices : c.orders) : 0);
/** Sen -> "12.5k" for a bubble that has room for five characters. */
function rmShort(c: number): string {
  const rmv = c / 100;
  if (rmv >= 1_000_000) return `${(rmv / 1_000_000).toFixed(1)}M`;
  if (rmv >= 10_000) return `${Math.round(rmv / 1000)}k`;
  if (rmv >= 1000) return `${(rmv / 1000).toFixed(1)}k`;
  return String(Math.round(rmv));
}

export function SalesMap() {
  const [layer, setLayer] = useState<Layer>("invoices");
  const [range, setRange] = useState<RangeKey>("year");
  const [state, setState] = useState<string>("");
  const view = useCachedApi<Data>(`/staff/sales/map?range=${range}`, true, ["docs", "clients", "orders", "web-orders"]);
  const data = view.data;
  const states = useMemo(() => data?.states ?? {}, [data]);
  const totals = data?.totals;
  const unplaced = data?.unplaced;
  const max = useMemo(() => Math.max(1, ...Object.values(states).map((c) => cents(c, layer))), [states, layer]);
  const unit = layer === "invoices" ? [L("invoices", "invois"), L("invoice", "invois")] : [L("orders", "pesanan"), L("order", "pesanan")];
  const noun = (n: number) => (n === 1 ? unit[1] : unit[0]);
  const sel = state ? states[state] : undefined;
  const top = useMemo(() => Object.entries(states).map(([st, c]) => [st, cents(c, layer), count(c, layer)] as [string, number, number]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6), [states, layer]);

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {layer === "invoices" ? L("Sales by state", "Jualan mengikut negeri") : L("Web orders by state", "Pesanan web mengikut negeri")}
            <StaleHint show={view.stale} className="ml-2" />
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {layer === "invoices"
              ? L("Where A2Z's invoices go, by the customer's address. The shade is the amount invoiced; press a state for paid and unpaid.",
                  "Ke mana invois A2Z pergi, mengikut alamat pelanggan. Warna ialah jumlah diinvois; tekan negeri untuk dibayar dan belum.")
              : L("Where ELFIA's paid web orders ship to. The shade is the amount paid; press a state for its count.",
                  "Ke mana pesanan web ELFIA yang dibayar dihantar. Warna ialah jumlah dibayar; tekan negeri untuk bilangannya.")}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <span role="radiogroup" aria-label={L("Layer", "Lapisan")} className="bg-secondary flex rounded-full p-0.5 text-[11px]">
            {(["invoices", "orders"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={layer === k} onClick={() => setLayer(k)}
                className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${layer === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {k === "invoices" ? L("Invoices", "Invois") : L("Web orders", "Pesanan web")}
              </button>
            ))}
          </span>
          <span role="radiogroup" aria-label={L("Range", "Julat")} className="bg-secondary flex rounded-full p-0.5 text-[11px]">
            {RANGES.map((r) => (
              <button key={r.key} type="button" role="radio" aria-checked={range === r.key} onClick={() => setRange(r.key)}
                className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${range === r.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {L(r.en, r.ms)}
              </button>
            ))}
          </span>
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
        {view.loading ? (
          <Skel className="aspect-[860/380] w-full rounded-xl" />
        ) : (
          <svg viewBox="0 0 860 380" className="w-full"
            aria-label={L("Map of Malaysia — each state is a button showing its sales", "Peta Malaysia — setiap negeri ialah butang yang menunjukkan jualannya")}>
            <text x="14" y="16" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">
              {L("PENINSULAR MALAYSIA", "SEMENANJUNG MALAYSIA")}
            </text>
            <text x="340" y="46" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">SABAH &amp; SARAWAK</text>
            <line x1="320" y1="24" x2="320" y2="364" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
            {(state ? [...STATES.filter((x) => stateKey(x.name) !== state), ...STATES.filter((x) => stateKey(x.name) === state)] : STATES).map((sh) => {
              const key = stateKey(sh.name);
              const v = cents(states[key], layer);
              const n = count(states[key], layer);
              const isSel = state === key;
              const label = `${sh.name}: ${fmtRM(v)} · ${n} ${noun(n)}`;
              return (
                <path key={sh.name} d={sh.d} role="button" tabIndex={0} aria-pressed={isSel} aria-label={label}
                  onClick={() => setState(isSel ? "" : key)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setState(isSel ? "" : key); } }}
                  className="cursor-pointer outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
                  fill={v > 0 ? "var(--gold-solid)" : "var(--secondary)"} fillOpacity={v > 0 ? 0.3 + 0.55 * (v / max) : 1}
                  stroke={isSel ? "var(--primary)" : "var(--border)"} strokeWidth={isSel ? 2.5 : 1} strokeLinejoin="round">
                  <title>{label}</title>
                </path>
              );
            })}
            {STATES.map((sh) => {
              const key = stateKey(sh.name);
              const v = cents(states[key], layer);
              if (!v) return null;
              const n = count(states[key], layer);
              const r = 11 + Math.sqrt(v / max) * 9;
              const isSel = state === key;
              const label = `${sh.name}: ${fmtRM(v)} · ${n} ${noun(n)}`;
              return (
                <g key={`b-${sh.name}`} role="button" tabIndex={0} aria-pressed={isSel} aria-label={label}
                  onClick={() => setState(isSel ? "" : key)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setState(isSel ? "" : key); } }}
                  className="cursor-pointer outline-none">
                  <circle cx={sh.cx} cy={sh.cy} r={r} fill="var(--brand-primary)" stroke={isSel ? "var(--primary)" : "var(--gold-solid)"} strokeWidth={isSel ? 2.5 : 1.5} opacity="0.92" />
                  <text x={sh.cx} y={sh.cy + 3} textAnchor="middle" style={{ font: "700 8.5px sans-serif", fill: "#fff" }}>{rmShort(v)}</text>
                  <title>{label}</title>
                </g>
              );
            })}
          </svg>
        )}

        <div className="border-border rounded-xl border p-3">
          {view.loading ? (
            <div className="space-y-2"><Skel className="h-4 w-32" /><Skel className="h-12 rounded-lg" /><Skel className="h-3 w-full" /><Skel className="h-3 w-full" /></div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{state || L("Malaysia — all states", "Malaysia — semua negeri")}</p>
                  <p className="text-muted-foreground text-[11px]">{L(RANGES.find((r) => r.key === range)?.en ?? "", RANGES.find((r) => r.key === range)?.ms ?? "")}</p>
                </div>
                {state && <button type="button" className={btnSm} onClick={() => setState("")}>{L("All states", "Semua negeri")}</button>}
              </div>
              <div className="bg-secondary mt-2.5 rounded-lg px-2.5 py-2">
                <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  {layer === "invoices" ? L("Invoiced", "Diinvois") : L("Paid", "Dibayar")}
                </p>
                <p className="text-lg font-bold tabular-nums">{fmtRM(cents(state ? sel : totals, layer))}</p>
                <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
                  {count(state ? sel : totals, layer)} {noun(count(state ? sel : totals, layer))}
                  {layer === "invoices" && (state ? sel : totals) ? ` · ${fmtRM((state ? sel : totals)!.paid_cents)} ${L("paid", "dibayar")} · ${fmtRM((state ? sel : totals)!.invoiced_cents - (state ? sel : totals)!.paid_cents)} ${L("unpaid", "belum dibayar")}` : ""}
                </p>
              </div>
              <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">{L("Most", "Terbanyak")}</p>
              <ul className="mt-1.5 space-y-1">
                {top.length === 0 && <li className="text-muted-foreground text-[11px]">{L("Nothing placed in this range yet.", "Tiada apa ditempatkan dalam julat ini lagi.")}</li>}
                {top.map(([st, v, n]) => (
                  <li key={st}>
                    <button type="button" onClick={() => setState(state === st ? "" : st)} className={`flex w-full items-center justify-between gap-2 text-xs ${state === st ? "font-semibold" : ""}`}>
                      <span className="truncate">{st}</span>
                      <span className="tabular-nums">{fmtRM(v)} <span className="text-muted-foreground">· {n}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
              {unplaced && count(unplaced, layer) > 0 && (
                <p className="text-warning mt-3 text-[11px]">
                  {L(`${fmtRM(cents(unplaced, layer))} from ${count(unplaced, layer)} ${noun(count(unplaced, layer))} could not be placed — the address names no state or postcode.`,
                     `${fmtRM(cents(unplaced, layer))} daripada ${count(unplaced, layer)} ${noun(count(unplaced, layer))} tidak dapat ditempatkan — alamat tidak menyebut negeri atau poskod.`)}
                  {layer === "invoices" ? ` ${L("Add the state to the customer's address and the map places it.", "Tambah negeri pada alamat pelanggan dan peta akan menempatkannya.")}` : ""}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
