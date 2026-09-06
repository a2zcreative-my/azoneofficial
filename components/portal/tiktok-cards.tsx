"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { L } from "@/components/portal/page-shared";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelTable } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, fmtRM } from "@/lib/format";
import { btnSm, card, chipNeutral, chipSuccess, rowHead, td, th } from "@/lib/ui-styles";
import { useCallback, useEffect, useState } from "react";

/* ===================== TikTok Shop Analytics (v1.64.0) =====================
   The CEO wants GMV, orders, units, buyers, visitors, views and CTR, split by
   video, LIVE and product card. This is that panel.

   It exists because three rounds of probing settled which endpoints this
   shop's authorisation actually opens and — just as important — what the
   fields are really called. Nothing below is a guessed field name; every one
   came back from the live API. The one endpoint that never answered
   (shop_lives/overview_performance, TikTok's own 36009003 in every shape) is
   not used, and is not missed: shop_lives/performance carries the same
   figures per session.

   The rule this panel keeps, and the reason it can be trusted: a section
   that did not answer is NAMED, with TikTok's own words, never drawn as a
   zero. A zero is a claim about the business. "TikTok refused this" is the
   truth, and the difference matters when someone is deciding what to sell. */
export function TikTokAnalyticsCard() {
  type Row = Record<string, unknown>;
  interface Analytics {
    window?: { start_date_ge: string; end_date_lt: string; days: number };
    shop?: Record<string, number>; shop_ok?: boolean;
    shop_has?: { gmv: boolean; orders: boolean; units: boolean; buyers: boolean };
    daily?: { date: string; gmv: number; orders: number }[];
    products?: Row[]; skus?: Row[]; videos?: Row[]; lives?: Row[];
    /* names[] is joined server-side from the catalogue; a row may still
       arrive with only an id if TikTok would not name it. */
    unavailable?: { what: string; why: string }[];
    fetched_at_myt?: string; cached?: boolean;
    worker_version?: string;
    names?: { sources: string[]; notes: string[]; products: number; variants: number };
  }
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [data, setData] = useState<Analytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"videos" | "lives" | "products" | "skus">("videos");
  const { show: toast, node: toastNode } = useSaveToast();

  const load = useCallback(async (d: number, fresh = false) => {
    setBusy(true);
    try {
      const r = await api<Analytics>(`/tiktok-analytics?days=${d}${fresh ? "&fresh=1" : ""}`);
      if (!r.ok) {
        toast(L("Could not load", "Tidak dapat memuatkan"),
              (r.data as { error?: { message?: string } } | null)?.error?.message
                ?? L("The server refused the request", "Pelayan menolak permintaan"), "notice");
        return;
      }
      setData(r.data ?? null);
    } finally { setBusy(false); }
  }, [toast]);

  useEffect(() => { void load(days); }, [days, load]);

  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const int = (v: unknown): string => n(v).toLocaleString("en-MY");
  /* TikTok reports GMV in whole currency units, not sen — fmtRM expects sen,
     so it is converted once here rather than in six places. */
  const rm = (v: unknown): string => fmtRM(Math.round(n(v) * 100));
  /* A rate arrives as either 0.0123 or 1.23 depending on the endpoint; both
     mean the same thing and both are shown as a percentage. */
  const pct = (v: unknown): string => {
    const x = n(v);
    return `${(x <= 1 ? x * 100 : x).toFixed(2)}%`;
  };

  const shop = data?.shop ?? {};
  const shopOk = data?.shop_ok !== false;
  /* Older builds send no shop_has; treat every tile as sent so a split
     deploy shows the figures it always did rather than four dashes. */
  const has = data?.shop_has ?? { gmv: true, orders: true, units: true, buyers: true };
  /* A dash, not a zero. A zero says nobody bought. */
  const dash = "\u2014";
  const gone = data?.unavailable ?? [];
  /* Two sections refused for the same reason should say it once. */
  const goneGrouped = Object.entries(
    gone.reduce<Record<string, string[]>>((acc, u) => {
      (acc[u.why] ??= []).push(u.what); return acc;
    }, {}),
  );
  /* end_date_lt is EXCLUSIVE, so the last day actually covered is the day
     before it. Showing the exclusive bound would be off by one on screen. */
  const win = data?.window;
  const lastDay = win
    ? new Date(new Date(`${win.end_date_lt}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
    : null;
  const daily = data?.daily ?? [];
  const peak = Math.max(1, ...daily.map((d) => n(d.gmv)));

  const rows: Row[] = tab === "videos" ? (data?.videos ?? [])
    : tab === "lives" ? (data?.lives ?? [])
    : tab === "skus" ? (data?.skus ?? []) : (data?.products ?? []);

  /* Four columns are the same on every tab — name, GMV, orders, units — and
     the fifth is whatever that tab is actually judged on. A video lives or
     dies by its click-through; a LIVE by how many people watched; a variant
     only means something next to the product it belongs to. One column, three
     meanings, so the table stays narrow enough to read on a phone. */
  const lastCol: { label: string; value: (r: Row) => string } =
    tab === "lives" ? { label: L("Views", "Tontonan"), value: (r) => int(r.views) }
    : tab === "skus" ? { label: L("Product", "Produk"),
                        value: (r) => String(r.product_name ?? r.product_id ?? dash) }
    : { label: "CTR", value: (r) => pct(r.click_through_rate) };

  return (
    <div className={card}>
      {toastNode}
      <div className={rowHead}>
        <div>
          <h3 className="font-semibold">{L("TikTok Shop Analytics", "Analitis Kedai TikTok")}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {data?.fetched_at_myt && win && lastDay
              ? L(`${dmy(win.start_date_ge)} to ${dmy(lastDay)} · read from TikTok at ${data.fetched_at_myt} MYT${data.cached ? " (cached)" : ""}`,
                  `${dmy(win.start_date_ge)} hingga ${dmy(lastDay)} · dibaca daripada TikTok pada ${data.fetched_at_myt} MYT${data.cached ? " (cache)" : ""}`)
              : L("GMV, orders, units and CTR — by video, LIVE and product card.",
                  "GMV, pesanan, unit dan CTR — mengikut video, siaran langsung dan kad produk.")}
          </p>
        </div>
        <div className="flex gap-1">
          {([1, 7, 30] as const).map((d) => (
            <button key={d} type="button" disabled={busy}
              className={`${btnSm} ${days === d ? "!bg-primary !text-primary-foreground" : ""}`}
              onClick={() => setDays(d)}>
              {d === 1 ? L("Today", "Hari ini") : `${d} ${L("days", "hari")}`}
            </button>
          ))}
          {/* Straight past the 30-minute cache, for when a figure is being
              chased right now rather than glanced at. */}
          <button type="button" className={btnSm} disabled={busy}
            title={L("Ignore the 30-minute cache", "Abaikan cache 30 minit")}
            onClick={() => void load(days, true)}>
            {busy ? L("Reading…", "Membaca…") : L("Refresh", "Segarkan")}
          </button>
        </div>
      </div>

      {/* Anything TikTok refused, in their words. Never a silent zero. */}
      {gone.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {goneGrouped.map(([why, whats]) => (
            <p key={why}><span className="font-semibold">{whats.join(" + ")}:</span> {why}</p>
          ))}
        </div>
      )}

      {/* v1.77.0 — skeleton until the first fetch lands: the four shop
          tiles, the day bars and the five-column table, in their real grid. */}
      {busy && !data && (
        <div aria-hidden>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="bg-secondary rounded-lg px-2.5 py-2">
                <Skel className="h-2.5 w-14" />
                <Skel className="mt-1.5 h-4 w-20" />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Skel className="h-2.5 w-20" />
            <div className="mt-2 flex items-end gap-1" style={{ height: 72 }}>
              {[34, 52, 28, 58, 40, 46, 22].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <div className="skel w-full rounded-t" style={{ height: `${h}px` }} />
                  <Skel className="h-2 w-4" />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1">
            {Array.from({ length: 4 }, (_, i) => (
              <Skel key={i} className="h-7 w-20" />
            ))}
          </div>
          <SkelTable rows={5} cols={5} className="mt-2" />
        </div>
      )}

      {data && (
        <>
          {/* ---- the shop's own totals ---- */}
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {([
              /* A dash for a metric TikTok did not send, not a zero.
                 "Buyers 0" beside "3 orders" is the panel inventing a number
                 for a field that never arrived. */
              ["GMV", shopOk && has.gmv ? rm(shop.gmv) : dash],
              [L("Orders", "Pesanan"), shopOk && has.orders ? int(shop.orders ?? shop.sku_orders) : dash],
              [L("Units sold", "Unit dijual"), shopOk && has.units ? int(shop.units_sold ?? shop.items_sold) : dash],
              [L("Buyers", "Pembeli"), shopOk && has.buyers ? int(shop.buyers ?? shop.unique_buyers ?? shop.customers) : dash],
            ] as const).map(([label, value]) => (
              <div key={label} className="bg-secondary rounded-lg px-2.5 py-2">
                <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{label}</p>
                <p className="text-sm font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* ---- the daily trend, drawn from the 1D breakdown ----
              Bars, not a line: seven days is too few for a line to say
              anything a bar does not, and a bar can be read exactly. */}
          {daily.length > 1 && (
            <div className="mt-4">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                {L("GMV by day", "GMV mengikut hari")}
              </p>
              <div className="mt-2 flex items-end gap-1" style={{ height: 72 }}>
                {daily.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1"
                       title={`${d.date} · ${rm(d.gmv)} · ${int(d.orders)} ${L("orders", "pesanan")}`}>
                    <div className="bg-gold-solid w-full rounded-t"
                         style={{ height: `${Math.max(2, (n(d.gmv) / peak) * 58)}px` }} />
                    <span className="text-muted-foreground text-[9px] tabular-nums">{d.date.slice(8, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- what sold: by video, by LIVE, by product card ---- */}
          <div className="mt-4 flex flex-wrap gap-1">
            {([["videos", L("Videos", "Video")], ["lives", L("LIVE", "Siaran langsung")],
               ["products", L("Product cards", "Kad produk")],
               ["skus", L("Variants", "Varian")]] as const).map(([k, label]) => (
              <button key={k} type="button"
                className={`${btnSm} ${tab === k ? "!bg-primary !text-primary-foreground" : ""}`}
                onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-xs">
              {L("Nothing in this window.", "Tiada apa-apa dalam tempoh ini.")}
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-border border-b">
                    <th className={th}>
                      {tab === "products" ? L("Product", "Produk")
                        : tab === "skus" ? L("Variant", "Varian") : L("Title", "Tajuk")}
                    </th>
                    <th className={th}>GMV</th>
                    <th className={th}>{L("Orders", "Pesanan")}</th>
                    <th className={th}>{L("Units", "Unit")}</th>
                    <th className={th}>{lastCol.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={String(r.id ?? i)} className="border-border/60 border-b last:border-0">
                      <td className={td}>
                        <span className="line-clamp-1">{String(r.title ?? r.id ?? dash)}</span>
                        {typeof r.username === "string" && r.username && (
                          <span className="text-muted-foreground block text-[10px]">@{r.username}</span>
                        )}
                        {/* The id stays, small: it is what Seller Center
                            searches on, and it is the only handle left if a
                            name never comes through. */}
                        {r.title != null && typeof r.id === "string"
                          && (tab === "products" || tab === "skus") && (
                          <span className="text-muted-foreground/70 block font-mono text-[10px]">{r.id}</span>
                        )}
                      </td>
                      <td className={`${td} tabular-nums`}>{rm(r.gmv)}</td>
                      <td className={`${td} tabular-nums`}>{int(r.orders ?? r.sku_orders)}</td>
                      <td className={`${td} tabular-nums`}>{int(r.units_sold)}</td>
                      <td className={`${td} tabular-nums`}>{lastCol.value(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* The endpoint probe stays, folded away: it is how the next version
          change gets diagnosed, and it costs nothing sitting here shut. */}
      <details className="mt-4 text-xs">
        <summary className="text-muted-foreground cursor-pointer">
          {L("Check which endpoints answer (diagnostic)", "Semak titik akhir yang menjawab (diagnostik)")}
        </summary>
        {/* v1.64.4: which BUILD answered, and what the name lookup did.
            "Is the fix live?" and "did TikTok give us the names?" are two
            different questions and were being answered as one. */}
        {data && (
          <p className="text-muted-foreground mt-2 font-mono text-[11px]">
            {L("API build", "Binaan API")} {data.worker_version ?? "?"}
            {data.names && (
              <>
                {" · "}
                {L(
                  `names: ${data.names.products} products, ${data.names.variants} variants${data.names.sources.length > 0 ? ` from ${data.names.sources.join(" + ")}` : " — no source answered"}`,
                  `nama: ${data.names.products} produk, ${data.names.variants} varian${data.names.sources.length > 0 ? ` daripada ${data.names.sources.join(" + ")}` : " — tiada sumber menjawab"}`,
                )}
              </>
            )}
          </p>
        )}
        {data?.names?.notes && data.names.notes.length > 0 && (
          <p className="text-muted-foreground mt-1 font-mono text-[11px]">
            {data.names.notes.join(" · ")}
          </p>
        )}
        <TikTokProbe />
      </details>
    </div>
  );
}

/* The endpoint probe. It used to be the whole card, back when nothing was
   known about which analytics endpoints this authorisation opens. It is kept
   because TikTok changes endpoint versions without warning, and when a
   section of the panel above goes quiet this is the tool that says which
   endpoint stopped answering and in whose words. It runs only when asked. */
export function TikTokProbe() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();

  const probe = async () => {
    setBusy(true);
    const r = await api<Record<string, unknown>>(`/integrations/tiktok/analytics-probe`);
    setBusy(false);
    if (!r.ok) {
      toast(L("Could not check", "Tidak dapat menyemak"),
            (r.data as { error?: { message?: string } } | null)?.error?.message
              ?? L("The server refused the request", "Pelayan menolak permintaan"), "notice");
      return;
    }
    setResult(r.data ?? null);
  };

  const findings = (result?.findings as { label: string; path: string; code: number | null;
    message: string | null; usable: boolean; first_row_keys: string[] | null;
    params?: Record<string, string> }[] | undefined) ?? [];
  const usable = findings.filter((f) => f.usable);

  return (
    <div className="mt-2">
      {toastNode}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSm} disabled={busy} onClick={() => void probe()}>
          {busy ? L("Checking…", "Menyemak…") : L("Check what's available", "Semak apa yang ada")}
        </button>
        <span className="text-muted-foreground">
          {L("Asks each analytics endpoint one small question and reports the answer.",
             "Bertanya satu soalan kecil kepada setiap titik akhir analitis dan melaporkan jawapannya.")}
        </span>
      </div>

      {result?.state === "not_authorised" && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {L("No TikTok authorisation stored yet. Finish the Renew screen in Partner Center with TikTok Shop Analytics ticked, then check again.",
             "Belum ada kebenaran TikTok disimpan. Selesaikan skrin Renew di Partner Center dengan TikTok Shop Analytics ditanda, kemudian semak semula.")}
        </p>
      )}
      {result?.state === "no_secret" && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          TIKTOK_APP_SECRET {L("is not set — run: npx wrangler secret put TIKTOK_APP_SECRET",
                                "tidak ditetapkan — jalankan: npx wrangler secret put TIKTOK_APP_SECRET")}
        </p>
      )}

      {result?.state === "probed" && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">
            {usable.length > 0
              ? L(`${usable.length} of ${findings.length} endpoints answered.`,
                  `${usable.length} daripada ${findings.length} titik akhir menjawab.`)
              : L("None answered — the Analytics scope may not be active on this authorisation.",
                  "Tiada yang menjawab — skop Analytics mungkin belum aktif pada kebenaran ini.")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-border border-b">
                  <th className={th}>{L("Endpoint", "Titik akhir")}</th>
                  <th className={th}>{L("Answer", "Jawapan")}</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={`${f.path}:${f.label}`} className="border-border/60 border-b last:border-0">
                    <td className={td}>
                      <div className="font-medium">{f.label}</div>
                      <div className="text-muted-foreground font-mono text-[11px]">{f.path}</div>
                      {f.params && (
                        <div className="text-muted-foreground/70 font-mono text-[10px]">
                          {Object.entries(f.params).map(([k, v]) => `${k}=${v}`).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <span className={f.usable ? chipSuccess : chipNeutral}>
                        {f.usable ? L("works", "berfungsi") : `${f.code ?? "—"}`}
                      </span>
                      {f.message && !f.usable && (
                        <div className="text-muted-foreground mt-0.5 text-[11px]">{f.message}</div>
                      )}
                      {f.first_row_keys && f.first_row_keys.length > 0 && (
                        <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                          {f.first_row_keys.slice(0, 12).join(", ")}
                          {f.first_row_keys.length > 12 ? " …" : ""}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="text-xs">
            <summary className="text-muted-foreground cursor-pointer">
              {L("Full reply", "Balasan penuh")}
            </summary>
            <pre className="bg-secondary/40 mt-2 max-h-64 overflow-auto rounded-lg p-2 text-[11px]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
