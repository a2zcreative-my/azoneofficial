"use client";

/* v1.212.0 - TIKTOK ORDERS, ONE RECORD IN EVERY VIEW (the owner's Ecommerce
   brief, 26-10-2026: "ONE ORDER RECORD. ONE AUTHORITATIVE STOCK SOURCE.
   CONSISTENT SALES DATA. ZERO DUPLICATION.").

   Before: the orders table read the newest 200 postage rows of every source
   and kept the TT- ones on the phone, so an older order could not be found
   and the status counts were counts of a sample. Now it reads the server's
   paged TikTok read (GET /staff/postage?source=tiktok - one page, the real
   count per status for the same search). An older worker that ignores
   ?source still answers the old list; the page then filters it as before and
   says it is showing the newest 200.

   WHAT DID NOT CHANGE. The order is the row the sync or the webhook stored
   (postage_records, order_ref "TT-" + TikTok's own order id); this file
   writes nothing to it. The one write is the sync (POST
   /integrations/tiktok/sync, the server's sync_manage gate; SYNC_ROLES only
   decides who sees the button). "azone:tiktok-synced" still tells the map
   and the top states to re-read. Signatures, credentials and the webhook are
   the worker's business: no secret, app id or signing step is in this file,
   and the setup wording is only for management (TECH_ROLES, the same four
   roles the server's webhook-debug answers).

   HONEST LABELS. "Recorded" is when the portal stored the order (not
   TikTok's payment time). "Order total" is TikTok's payment total for the
   order; returned and cancelled orders are left out of revenue. Returned
   covers cancelled and refunded too - one status on the server. "How it
   arrived": a live update (the webhook) or imported by Sync. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { getCsrfToken } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { stateOf, titleCase } from "@/lib/malaysia-map";
import { btnSm, card, inputClassSm, tabPill, tabPillOn } from "@/lib/ui-styles";
import css from "./tiktok-orders.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface TtStatus { configured: boolean; authorized: boolean; last_event_at: string | null; last_event_verified: boolean | null; last_order_at?: string | null; failed_events_7d?: number }
export interface TtOrder {
  id: number; order_ref: string; status: string; note?: string | null; created_at: string; updated_at?: string | null;
  items_label?: string | null; courier?: string | null; tracking_no?: string | null; buyer_city?: string | null;
  order_amount_cents?: number | null; line_count?: number | null;
}
interface PagedRead { records: TtOrder[]; total?: number; page?: number; per?: number; counts?: Record<string, number> }
export interface SyncResult { at: number; ok: boolean; imported: number; skipped: number; retried: number; fromTiktok: number | null; problems: string[]; message: string }

/* postage_records.status (schema 0007) - the server's five, in the order a
   parcel moves */
export const STATUSES: [key: string, en: string, ms: string, chip: string][] = [
  ["preparing", "Preparing", "Disediakan", "erp-chip-warning"],
  ["shipped", "Shipped", "Dihantar", "erp-chip-info"],
  ["in_transit", "In transit", "Dalam perjalanan", "erp-chip-info"],
  ["delivered", "Delivered", "Sampai", "erp-chip-success"],
  ["returned", "Returned / cancelled", "Dipulang / dibatal", "erp-chip-danger"],
];
const statusOf = (k: string) => STATUSES.find((s) => s[0] === k);
export const SYNC_ROLES: readonly string[] = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];
/** Who reads the setup wording (the server's webhook-debug gate). */
export const TECH_ROLES: readonly string[] = ["ceo", "coo", "admin", "super_admin"];

/* the note the sync or the webhook wrote first says how the order came in */
export const arrivedBy = (o: TtOrder) =>
  /TikTok order \(auto\)/.test(o.note ?? "") ? L("Live update from TikTok", "Kemas kini langsung dari TikTok")
  : /TikTok order \(synced\)/.test(o.note ?? "") ? L("Imported by Sync", "Diimport oleh Segerak")
  : L("Recorded in the portal", "Direkodkan dalam portal");
const noStock = (o: TtOrder) => o.status !== "returned" && (o.line_count === 0 || (o.line_count == null && !o.items_label));
const tiktokId = (ref: string) => ref.replace(/^TT-/, "");
const area = (city?: string | null) => {
  if (!city) return null;
  const st = stateOf(city);
  return st ? `${titleCase(city)} · ${st}` : titleCase(city);
};

/* Integrations endpoints sit outside the /staff base: one small fetcher */
async function tiktokApi<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const headers = new Headers(init?.headers as Record<string, string> ?? {});
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (init?.method && init.method !== "GET") { const csrf = getCsrfToken(); if (csrf) headers.set("X-CSRF-Token", csrf); }
    const res = await fetch(`/api/v1/integrations/tiktok${path}`, { credentials: "include", ...init, headers });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** The connection in plain words; the setup steps only for management. */
export function connectionLine(st: TtStatus | null, technical: boolean): { text: string; tone: "ok" | "warn" | "bad" } {
  if (!st) return { text: L("Connection status unavailable right now.", "Status sambungan tidak tersedia sekarang."), tone: "warn" };
  if (!st.configured) return { text: technical
    ? L("Not connected - the TikTok app keys are not set on the server.", "Tidak bersambung - kunci aplikasi TikTok belum ditetapkan pada pelayan.")
    : L("TikTok Shop is not connected yet. A manager can set it up.", "TikTok Shop belum bersambung. Pengurus boleh menetapkannya."), tone: "bad" };
  if (!st.authorized) return { text: technical
    ? L("Connected, but the shop has not authorised the app yet - authorise it from Partner Center.", "Bersambung, tetapi kedai belum membenarkan aplikasi - benarkan melalui Partner Center.")
    : L("TikTok Shop needs to be re-authorised by a manager. Orders already here are safe.", "TikTok Shop perlu dibenarkan semula oleh pengurus. Pesanan yang sudah ada selamat."), tone: "bad" };
  if (st.last_event_at && st.last_event_verified === false) return { text: technical
    ? L(`Connected · the last live update (${dmyMYT(st.last_event_at)} MYT) failed its signature check and was refused. Sync still works.`, `Bersambung · kemas kini langsung terakhir (${dmyMYT(st.last_event_at)} MYT) gagal semakan tandatangan dan ditolak. Segerak masih berfungsi.`)
    : L("Connected · a live update was refused; Sync still brings orders in.", "Bersambung · satu kemas kini langsung ditolak; Segerak masih membawa pesanan masuk."), tone: "warn" };
  return { text: st.last_event_at
    ? L(`Connected · last live update ${dmyMYT(st.last_event_at)} MYT · Sync also runs every 30 minutes.`, `Bersambung · kemas kini langsung terakhir ${dmyMYT(st.last_event_at)} MYT · Segerak juga berjalan setiap 30 minit.`)
    : L("Connected · Sync runs every 30 minutes; Sync now pulls immediately.", "Bersambung · Segerak berjalan setiap 30 minit; Segerak sekarang menarik serta-merta."), tone: "ok" };
}

/** The one sync on the page: the header button and the Sync tab both press it. */
export function useTikTokSync(role: string) {
  const canSync = SYNC_ROLES.includes(role);
  const technical = TECH_ROLES.includes(role);
  const [status, setStatus] = useState<TtStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const busyRef = useRef(false);
  const loadStatus = useCallback(async () => {
    const st = await tiktokApi<TtStatus>("/status");
    setStatus(st.ok ? st.data : null);
    setStatusLoaded(true);
  }, []);
  useEffect(() => {
    let alive = true;
    void tiktokApi<TtStatus>("/status").then((st) => { if (alive) { setStatus(st.ok ? st.data : null); setStatusLoaded(true); } });
    return () => { alive = false; };
  }, []);

  const sync = useCallback(async () => {
    if (!canSync || busyRef.current) return; // pressed twice is one sync
    busyRef.current = true;
    setBusy(true);
    const res = await tiktokApi<{ imported: number; skipped: number; retried?: number; total_from_tiktok?: number; problems?: string[]; error?: { message?: string } }>("/sync", { method: "POST", body: "{}" });
    busyRef.current = false;
    setBusy(false);
    if (res.ok && res.data) {
      const d = res.data;
      setResult({ at: Date.now(), ok: true, imported: d.imported ?? 0, skipped: d.skipped ?? 0, retried: d.retried ?? 0, fromTiktok: d.total_from_tiktok ?? null, problems: d.problems ?? [], message: "" });
      window.dispatchEvent(new Event("azone:tiktok-synced"));
      void loadStatus();
    } else {
      const message = res.status === 0
        ? L("No connection - the sync did not run. Check the internet and try again.", "Tiada sambungan - segerak tidak berjalan. Semak internet dan cuba lagi.")
        : res.status === 401 || res.status === 403
          ? L("Your sign-in does not allow a sync.", "Log masuk anda tidak membenarkan segerak.")
          : technical && res.data?.error?.message
            ? res.data.error.message
            : L("The sync did not finish. Try again in a minute; if it keeps failing, tell a manager.", "Segerak tidak selesai. Cuba lagi seminit lagi; jika terus gagal, maklumkan pengurus.");
      setResult({ at: Date.now(), ok: false, imported: 0, skipped: 0, retried: 0, fromTiktok: null, problems: [], message });
    }
  }, [canSync, technical, loadStatus]);

  return { canSync, technical, status, statusLoaded, busy, result, sync };
}

/* one page of TikTok orders. An older worker answers the old newest-200
   list: filter it here, as the page always did, and say so (`partial`). */
function usePagedOrders(opts: { page: number; per: number; q: string; status: string; stock?: "none" }) {
  const qs = new URLSearchParams({ source: "tiktok", page: String(opts.page), per: String(opts.per) });
  if (opts.q) qs.set("q", opts.q);
  if (opts.status) qs.set("status", opts.status);
  if (opts.stock) qs.set("stock", opts.stock);
  const res = useCachedApi<PagedRead>(`/staff/postage?${qs.toString()}`, true, ["orders"]);
  const d = res.data;
  if (!d) return { ...res, records: [] as TtOrder[], total: 0, counts: {} as Record<string, number>, partial: false };
  if (typeof d.total === "number") return { ...res, records: d.records, total: d.total, counts: d.counts ?? {}, partial: false };
  const q = opts.q.toLowerCase();
  const tt = (d.records ?? []).filter((r) => r.order_ref?.startsWith("TT-"))
    .filter((r) => !q || `${r.order_ref} ${r.buyer_city ?? ""} ${r.items_label ?? ""} ${r.tracking_no ?? ""} ${r.courier ?? ""}`.toLowerCase().includes(q))
    .filter((r) => !opts.stock || noStock(r));
  const counts: Record<string, number> = { all: tt.length, no_stock: tt.filter(noStock).length };
  for (const s of STATUSES) counts[s[0]] = tt.filter((r) => r.status === s[0]).length;
  const rows = opts.status ? tt.filter((r) => r.status === opts.status) : tt;
  return { ...res, records: rows.slice((opts.page - 1) * opts.per, opts.page * opts.per), total: rows.length, counts, partial: true };
}

export function StatusChip({ status, big = false }: { status: string; big?: boolean }) {
  const s = statusOf(status);
  return <span className={`erp-chip ${big ? css.bigChip : "erp-chip-sm"} ${s?.[3] ?? "erp-chip-neutral"}`}>{s ? L(s[1], s[2]) : status.replace(/_/g, " ")}</span>;
}

/** One order, read in full. No command here: an order's status is TikTok's. */
export function OrderDrawer({ order, onClose }: { order: TtOrder | null; onClose: () => void }) {
  const o = order;
  return (
    <SideDrawer open={!!o} onClose={onClose} full
      title={o ? o.order_ref : ""}
      subtitle={o ? L(`Recorded ${dmyMYT(o.created_at)} MYT`, `Direkodkan ${dmyMYT(o.created_at)} MYT`) : undefined}>
      {o && (
        <div className={css.drawer} data-order-drawer={o.id}>
          <div className={css.drawerStatus}>
            <StatusChip status={o.status} big />
            <span className="erp-meta">{arrivedBy(o)}</span>
          </div>
          <dl className={css.facts}>
            <div><dt>{L("TikTok order ID", "ID pesanan TikTok")}</dt><dd className={css.mono}>{tiktokId(o.order_ref)}</dd></div>
            <div><dt>{L("Order total", "Jumlah pesanan")}</dt>
              <dd>{o.order_amount_cents != null ? <strong className="erp-num">{fmtRM(o.order_amount_cents)}</strong> : <span className="erp-meta">{L("Not sent by TikTok", "Tidak dihantar oleh TikTok")}</span>}
                <span className={css.hint}>{o.status === "returned"
                  ? L("Returned or cancelled - not counted in revenue.", "Dipulang atau dibatal - tidak dikira dalam hasil.")
                  : L("TikTok's payment total for this order (what the buyer paid).", "Jumlah bayaran TikTok untuk pesanan ini (yang dibayar pembeli).")}</span></dd></div>
            <div><dt>{L("Recorded", "Direkodkan")}</dt>
              <dd><span className="erp-num">{dmyMYT(o.created_at)} MYT</span><span className={css.hint}>{L("When the portal stored the order - not TikTok's payment time.", "Bila portal menyimpan pesanan - bukan masa bayaran TikTok.")}</span></dd></div>
            {o.updated_at && <div><dt>{L("Last change", "Perubahan terakhir")}</dt><dd className="erp-num">{dmyMYT(o.updated_at)} MYT</dd></div>}
            <div><dt>{L("Items", "Barang")}</dt>
              <dd>{o.items_label
                ? <>{o.items_label}<span className={css.hint}>{o.status === "returned" ? L("Put back on the shelf when the order was returned or cancelled.", "Dikembalikan ke rak apabila pesanan dipulang atau dibatal.") : L("Taken off the stock when the order arrived.", "Ditolak daripada stok apabila pesanan tiba.")}</span></>
                : <span className={css.attn}><AppIcon name="warning" />{L("No stock movement recorded", "Tiada pergerakan stok direkodkan")}</span>}</dd></div>
            <div><dt>{L("Buyer area", "Kawasan pembeli")}</dt>
              <dd>{area(o.buyer_city) ?? "—"}<span className={css.hint}>{L("Town and state only - the address is never stored.", "Bandar dan negeri sahaja - alamat tidak pernah disimpan.")}</span></dd></div>
            <div><dt>{L("Courier", "Kurier")}</dt><dd>{o.courier || "—"}</dd></div>
            <div><dt>{L("Tracking", "Penjejakan")}</dt><dd>{o.tracking_no ? <span className={css.mono}>{o.tracking_no}</span> : <span className="erp-meta">{L("No tracking number yet", "Tiada nombor penjejakan lagi")}</span>}</dd></div>
            {o.note && <div><dt>{L("Note", "Nota")}</dt><dd className={css.note}>{o.note}</dd></div>}
          </dl>
          <p className={css.hintBlock}>{L("Statuses come from TikTok through the live updates and Sync. A returned order stays returned.", "Status datang dari TikTok melalui kemas kini langsung dan Segerak. Pesanan yang dipulang kekal dipulang.")}</p>
        </div>
      )}
    </SideDrawer>
  );
}

/* the row as a card (a phone) and as a table row (from 768px): one record */
function OrderCard({ o, onOpen }: { o: TtOrder; onOpen: (o: TtOrder) => void }) {
  return (
    <li>
      <button type="button" className={css.orderCard} onClick={() => onOpen(o)} data-order={o.id}>
        <span className={css.cardTop}>
          <span className={css.ref}>{o.order_ref}</span>
          <StatusChip status={o.status} />
        </span>
        <span className={css.cardItems}>{o.items_label ?? <span className={css.attn}><AppIcon name="warning" />{L("No stock movement recorded", "Tiada pergerakan stok direkodkan")}</span>}</span>
        <span className={css.cardMeta}>
          <span>{area(o.buyer_city) ?? L("Area not sent", "Kawasan tidak dihantar")}</span>
          <span className="erp-num">{o.order_amount_cents != null ? fmtRM(o.order_amount_cents) : "—"}</span>
        </span>
        <span className={css.cardDate}>{L("Recorded", "Direkodkan")} {dmyMYT(o.created_at)}</span>
      </button>
    </li>
  );
}

export function TikTokOrders({ mode, title, initialStatus = "", stock, pills = true, onViewAll, reloadKey = 0 }: {
  /** "recent" - the newest five, no tools (Overview); "full" - the Orders tab */
  mode: "recent" | "full";
  title?: string;
  initialStatus?: string;
  stock?: "none";
  /** the status pills (off where the page chooses the status itself) */
  pills?: boolean;
  onViewAll?: () => void;
  /** bumped by the page after a sync, so the list re-reads */
  reloadKey?: number;
}) {
  const full = mode === "full";
  const [status, setStatus] = useState(initialStatus);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<TtOrder | null>(null);
  const per = full ? 15 : 5;
  const data = usePagedOrders({ page, per, q, status, stock });
  const { refresh } = data;

  /* the search goes to the server a moment after typing stops */
  useEffect(() => {
    const t = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [typed]);
  const seen = useRef(reloadKey);
  useEffect(() => { if (seen.current !== reloadKey) { seen.current = reloadKey; refresh(); } }, [reloadKey, refresh]);

  const pages = Math.max(1, Math.ceil(data.total / per));
  const loaded = data.data != null;
  const rows = data.records;
  const pick = (s: string) => { setStatus(s); setPage(1); };

  return (
    <section className={card} aria-label={title ?? L("TikTok orders", "Pesanan TikTok")}>
      <div className={css.head}>
        <div className={css.headLead}>
          <span className={css.logo} aria-hidden><AppIcon name="live" /></span>
          <div className={css.headText}>
            <PanelTitle tone="inherit">{title ?? L("TikTok Orders", "Pesanan TikTok")}</PanelTitle>
            <p className="erp-meta">{full
              ? (loaded ? L(`${data.total} order${data.total === 1 ? "" : "s"}${q ? " for this search" : ""} · newest first`, `${data.total} pesanan${q ? " untuk carian ini" : ""} · terbaru dahulu`) : <Skel w="10rem" h="0.75rem" />)
              : L("The newest TikTok orders, as recorded", "Pesanan TikTok terbaru, seperti direkodkan")}</p>
          </div>
        </div>
        {!full && onViewAll && <button type="button" className={btnSm} onClick={onViewAll}>{L("View all orders", "Lihat semua pesanan")}</button>}
      </div>

      {full && (
        <>
          <div className={css.tools}>
            <label className={css.search}>
              <span className="erp-sr-only">{L("Search orders", "Cari pesanan")}</span>
              <AppIcon name="search" />
              <input type="search" className={inputClassSm} value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder={L("Order no., item, SKU, tracking, town", "No. pesanan, barang, SKU, penjejakan, bandar")} />
            </label>
          </div>
          {pills && <div role="tablist" aria-label={L("Status", "Status")} className={`erp-pill-row ${css.pills}`}>
            {([["", L("All", "Semua"), "all"], ...STATUSES.map((s) => [s[0], L(s[1], s[2]), s[0]] as const)] as const).map(([v, label, k]) => (
              <button key={k} type="button" role="tab" aria-selected={status === v}
                className={`${status === v ? tabPillOn : tabPill} ${css.pill}`} onClick={() => pick(v)}>
                {label} <span className="erp-num">({loaded ? data.counts[k] ?? 0 : "…"})</span>
              </button>
            ))}
          </div>}
        </>
      )}

      {data.partial && <p className={`erp-note erp-note-info ${css.note2}`} role="note">{L("Showing the newest 200 orders - older orders appear once the server is updated.", "Menunjukkan 200 pesanan terbaru - pesanan lama muncul selepas pelayan dikemas kini.")}</p>}
      {data.failed && (
        <p className={`erp-note erp-note-warning ${css.note2}`} role="alert">
          {loaded ? L("Couldn't refresh - showing the orders from the last successful load.", "Tidak dapat menyegar semula - menunjukkan pesanan daripada muatan terakhir yang berjaya.")
            : L("Couldn't load the orders. Check the connection.", "Tidak dapat memuatkan pesanan. Semak sambungan.")}
          <button type="button" className={btnSm} onClick={refresh}>{L("Try again", "Cuba lagi")}</button>
        </p>
      )}

      {!loaded ? (data.failed ? null : <SkelRows rows={full ? 6 : 4} />)
        : rows.length === 0 ? (
          <p className={css.empty}>{(data.counts.all ?? 0) === 0 && !q && !stock
            ? L("No TikTok orders yet. Sync from TikTok pulls the shop's orders in.", "Tiada pesanan TikTok lagi. Segerak dari TikTok menarik pesanan kedai masuk.")
            : stock ? L("Every order moved its stock - nothing needs attention.", "Setiap pesanan menggerakkan stoknya - tiada yang perlu perhatian.")
            : L("No orders match this search or status.", "Tiada pesanan sepadan dengan carian atau status ini.")}</p>
        ) : (
          <>
            <ul className={css.cards} aria-label={L("Orders", "Pesanan")}>
              {rows.map((o) => <OrderCard key={o.id} o={o} onOpen={setOpen} />)}
            </ul>
            <div className={css.tableWrap}>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th scope="col">{L("Order no.", "No. pesanan")}</th>
                    <th scope="col">{L("Recorded", "Direkodkan")}</th>
                    <th scope="col">{L("Buyer area", "Kawasan pembeli")}</th>
                    <th scope="col">{L("Items", "Barang")}</th>
                    <th scope="col" className={css.num}>{L("Order total", "Jumlah pesanan")}</th>
                    <th scope="col">{L("Status", "Status")}</th>
                    <th scope="col"><span className="erp-sr-only">{L("Details", "Butiran")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} onClick={() => setOpen(o)} className={css.row}>
                      <td><span className={css.ref}>{o.order_ref}</span></td>
                      <td className={`erp-num ${css.nowrap}`}>{dmyMYT(o.created_at)}</td>
                      <td>{o.buyer_city ? <span className={css.buyer}><span className={css.buyerState}>{stateOf(o.buyer_city) ?? titleCase(o.buyer_city)}</span>{stateOf(o.buyer_city) && <span className={`erp-meta ${css.nowrap}`}>{titleCase(o.buyer_city)}</span>}</span> : <span className="erp-meta">—</span>}</td>
                      <td>{o.items_label ? <span className={css.items} title={o.items_label}>{o.items_label}</span> : <span className={css.attn}><AppIcon name="warning" />{L("No stock movement", "Tiada pergerakan stok")}</span>}</td>
                      <td className={css.num}>{o.order_amount_cents != null ? fmtRM(o.order_amount_cents) : "—"}</td>
                      <td><StatusChip status={o.status} /></td>
                      <td className={css.num}>
                        <button type="button" className={`${btnSm} ${css.rowBtn}`} onClick={(e) => { e.stopPropagation(); setOpen(o); }}
                          aria-label={L(`Details of ${o.order_ref}`, `Butiran ${o.order_ref}`)} title={L("Details", "Butiran")}>
                          <AppIcon name="next" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {full && pages > 1 && (
              <nav className={css.pager} aria-label={L("Pages", "Halaman")}>
                <button type="button" className={btnSm} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <AppIcon name="previous" />{L("Previous", "Sebelum")}
                </button>
                <span className="erp-meta erp-num" aria-live="polite">{L(`Page ${page} of ${pages}`, `Halaman ${page} daripada ${pages}`)}</span>
                <button type="button" className={btnSm} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                  {L("Next", "Seterusnya")}<AppIcon name="next" />
                </button>
              </nav>
            )}
          </>
        )}
      <OrderDrawer order={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/** The counts per status, for the Fulfilment board and the Overview alerts. */
export function useOrderCounts() {
  const d = usePagedOrders({ page: 1, per: 5, q: "", status: "" });
  return { counts: d.data ? d.counts : null, failed: d.failed, refresh: d.refresh };
}
