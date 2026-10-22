"use client";

/* v1.185.0 - TIKTOK ORDERS, AS A TABLE (the owner's reference, 22-10-2026:
   the Ecommerce page's orders card - connection line, Sync from TikTok,
   status pills with counts, a search box, an orders table with pagination).
   The logic is TikTokOrdersCard's (role-panels.tsx, v1.4.214-v1.184.0),
   moved here whole: the same /integrations/tiktok/status and /sync calls,
   the same /staff/postage read filtered to TT- refs, the same sync roles,
   the same "azone:tiktok-synced" event for the map. Nothing about an order
   changes here: the table reads what the sync stored, and the one write is
   the sync itself. The chrome is the shared DataTable (search, sort, pages,
   a CSV of the rows on screen). A row opens its detail under the table -
   tracking, courier, buyer city, the note - which the old list printed on
   every row. No product photo: the sync stores item names and quantities,
   not pictures (the owner, 22-10-2026). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { Skel } from "@/components/ui/skeleton";
import { makeApi, getCsrfToken } from "@/lib/api";
import { dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, tabPill, tabPillOn } from "@/lib/ui-styles";
import { stateOf, titleCase } from "@/lib/malaysia-map";
import css from "./tiktok-orders.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface TtStatus { configured: boolean; authorized: boolean; last_event_at: string | null; last_event_verified: boolean | null }
export interface TtOrder {
  id: number; order_ref: string; status: string; note?: string | null; created_at: string;
  items_label?: string | null; courier?: string | null; tracking_no?: string | null; buyer_city?: string | null;
  order_amount_cents?: number | null;
}

/* postage_records.status (schema 0007) and how each reads; "preparing" is a
   NEW order on this card, as it always was. */
const STATUSES: [key: string, en: string, ms: string, chip: string][] = [
  ["preparing", "New", "Baru", "erp-chip-warning"],
  ["shipped", "Shipped", "Dihantar", "erp-chip-info"],
  ["in_transit", "In transit", "Dalam perjalanan", "erp-chip-info"],
  ["delivered", "Delivered", "Sampai", "erp-chip-success"],
  ["returned", "Returned", "Dipulangkan", "erp-chip-danger"],
];
const statusOf = (k: string) => STATUSES.find((s) => s[0] === k);
export const SYNC_ROLES: readonly string[] = ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"];

export function TikTokOrdersTable({ role, onSynced }: { role: string; onSynced?: () => void }) {
  const [ttStatus, setTtStatus] = useState<TtStatus | null>(null);
  const [orders, setOrders] = useState<TtOrder[]>([]);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<"all" | string>("all");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<TtOrder | null>(null);
  const canSync = SYNC_ROLES.includes(role);

  /* Integrations endpoints sit outside the /staff base, so the card carries
     its own minimal fetcher (as the old card did). */
  const tiktokApi = useCallback(async <T,>(path: string, init?: RequestInit) => {
    try {
      const isMutating = init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method);
      const headers = new Headers(init?.headers as Record<string, string> ?? {});
      if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (isMutating) { const csrf = getCsrfToken(); if (csrf) headers.set("X-CSRF-Token", csrf); }
      const res = await fetch(`/api/v1/integrations/tiktok${path}`, { credentials: "include", ...init, headers });
      return { ok: res.ok, data: (await res.json().catch(() => null)) as T | null };
    } catch {
      return { ok: false, data: null as T | null };
    }
  }, []);

  const load = useCallback(async () => {
    const st = await tiktokApi<TtStatus>(`/status`);
    if (st.ok) setTtStatus(st.data);
    const pr = await api<{ records: TtOrder[] }>(`/postage`);
    setOrders((pr.data?.records ?? []).filter((r) => r.order_ref?.startsWith("TT-")));
    setLoaded(true);
  }, [tiktokApi]);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setBusy(true);
    setMsg(L("Syncing from TikTok…", "Menyegerak dari TikTok…"));
    const res = await tiktokApi<{ imported: number; skipped: number; problems: string[]; error?: { message?: string } }>(`/sync`, { method: "POST", body: "{}" });
    setBusy(false);
    if (res.ok && res.data) {
      const probs = res.data.problems?.length ? ` · ${res.data.problems.length} ${L("problem(s)", "masalah")}: ${res.data.problems.slice(0, 3).join("; ")}` : "";
      setMsg(`${L("Imported", "Diimport")} ${res.data.imported} (${res.data.skipped} ${L("already in", "sudah ada")})${probs}`);
      await load();
      window.dispatchEvent(new Event("azone:tiktok-synced"));
      onSynced?.();
    } else {
      setMsg(res.data?.error?.message ?? L("Sync failed — check the TikTok setup", "Segerakan gagal — semak tetapan TikTok"));
    }
  };

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: orders.length };
    for (const s of STATUSES) m[s[0]] = orders.filter((o) => o.status === s[0]).length;
    return m;
  }, [orders]);
  const rows = useMemo(() => (filter === "all" ? orders : orders.filter((o) => o.status === filter)), [orders, filter]);

  const columns: DataColumn<TtOrder>[] = [
    { key: "order_ref", label: L("Order No.", "No. pesanan"), hideable: false, render: (o) => <span className={css.ref}>{o.order_ref}</span> },
    { key: "created_at", label: L("Date", "Tarikh"), render: (o) => <span className={`erp-num ${css.nowrap}`}>{dmyMYT(o.created_at)}</span>, sortValue: (o) => o.created_at },
    { key: "buyer", label: L("Buyer", "Pembeli"), render: (o) => {
        const st = o.buyer_city ? stateOf(o.buyer_city) : null;
        return o.buyer_city
          ? <span className={css.buyer}><span className={css.buyerState}>{st ?? titleCase(o.buyer_city)}</span>{st && <span className={`erp-meta ${css.nowrap}`}>{titleCase(o.buyer_city)}</span>}</span>
          : <span className="erp-meta">—</span>;
      }, sortValue: (o) => o.buyer_city ?? "" },
    { key: "items", label: L("Items", "Barang"), render: (o) => o.items_label
        ? <span className={css.items} title={o.items_label}>{o.items_label}</span>
        : <span className="erp-meta">{L("No stock movement recorded", "Tiada pergerakan stok direkodkan")}</span>,
      sortValue: (o) => o.items_label ?? "" },
    { key: "amount", label: L("Amount", "Jumlah"), numeric: true, render: (o) => o.order_amount_cents != null ? fmtRM(o.order_amount_cents) : "—", sortValue: (o) => o.order_amount_cents ?? -1 },
    { key: "status", label: L("Status", "Status"), render: (o) => {
        const s = statusOf(o.status);
        return <span className={`erp-chip erp-chip-sm ${s?.[3] ?? "erp-chip-neutral"}`}>{s ? L(s[1], s[2]) : o.status.replace(/_/g, " ")}</span>;
      } },
  ];

  return (
    <div className={card}>
      <div className={css.head}>
        <div className={css.headLead}>
          <span className={css.logo} aria-hidden><AppIcon name="live" /></span>
          <div className={css.headText}>
            <PanelTitle tone="inherit">{L("TikTok Orders", "Pesanan TikTok")}</PanelTitle>
            {!loaded ? <Skel className={css.statusSkel} /> : (
              <p className={`erp-meta ${css.statusLine}`}>
                {!ttStatus?.configured
                  ? L("Not configured — set the app secret and deploy the worker.", "Belum dikonfigurasi — tetapkan app secret dan deploy worker.")
                  : !ttStatus?.authorized
                    ? L("Not authorized yet — activate the shop/order scopes, publish the app in Partner Center, then authorize the shop. Sync pulls existing orders once live.", "Belum diberi kebenaran — aktifkan skop shop/order, terbitkan aplikasi dalam Partner Center, kemudian benarkan kedai. Segerak menarik pesanan sedia ada setelah aktif.")
                    : ttStatus.last_event_at
                      ? `${L("Connected · last webhook", "Bersambung · webhook terakhir")} ${dmyMYT(ttStatus.last_event_at)} MYT${ttStatus.last_event_verified === false ? L(" (signature FAILED — check app secret)", " (tandatangan GAGAL — semak app secret)") : ""}`
                      : L("Connected · auto-sync runs every 30 minutes; Sync pulls now.", "Bersambung · auto-segerak berjalan setiap 30 minit; Segerak menarik sekarang.")}
              </p>
            )}
          </div>
        </div>
        {canSync && (
          <button type="button" className={btnSmPrimary} disabled={busy} aria-busy={busy} onClick={() => void sync()}>
            <AppIcon name="refresh" />{L("Sync from TikTok", "Segerak dari TikTok")}
          </button>
        )}
      </div>
      {msg && <p className={`erp-note erp-note-warning erp-mt-2 ${css.msg}`} role="status">{msg}</p>}
      <div role="tablist" className={`erp-pill-row ${css.pills}`}>
        {([["all", L("All", "Semua")], ...STATUSES.map((s) => [s[0], L(s[1], s[2])] as const)] as const).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={filter === v}
            className={filter === v ? tabPillOn : tabPill} onClick={() => { setFilter(v); setOpen(null); }}>
            {label} ({counts[v] ?? 0})
          </button>
        ))}
      </div>
      <DataTable<TtOrder>
        id="tiktok-orders"
        columns={columns}
        rows={rows}
        loading={!loaded}
        searchText={(o) => `${o.order_ref} ${o.buyer_city ?? ""} ${o.items_label ?? ""} ${o.tracking_no ?? ""}`}
        defaultSort="created_at"
        pageSizes={[5, 10, 25, 50]}
        empty={loaded && orders.length === 0 ? L("No TikTok orders yet.", "Tiada pesanan TikTok lagi.") : L("No orders with this status.", "Tiada pesanan dengan status ini.")}
        emptyHint={canSync ? L("Sync from TikTok pulls the shop's orders in.", "Segerak dari TikTok menarik pesanan kedai masuk.") : undefined}
        onRowClick={(o) => setOpen((cur) => (cur?.id === o.id ? null : o))}
        rowActions={(o) => (
          <button type="button" className={`${btnSm} ${css.rowBtn}`} onClick={() => setOpen((cur) => (cur?.id === o.id ? null : o))}
            aria-expanded={open?.id === o.id} aria-label={open?.id === o.id ? L("Close details", "Tutup butiran") : L("Details", "Butiran")} title={L("Details", "Butiran")}>
            <AppIcon name={open?.id === o.id ? "expand" : "next"} />
          </button>
        )}
        rowActionsLabel={L("Actions", "Tindakan")}
        csvExport={{
          name: "tiktok-orders",
          headers: ["Order", "Date (MYT)", "Buyer city", "Items", "Amount (RM)", "Status", "Courier", "Tracking"],
          row: (o) => [o.order_ref, dmyMYT(o.created_at), o.buyer_city ?? "", o.items_label ?? "", o.order_amount_cents != null ? (o.order_amount_cents / 100).toFixed(2) : "", o.status, o.courier ?? "", o.tracking_no ?? ""],
        }}
      />
      {open && (
        <div className={css.detail} role="region" aria-label={open.order_ref}>
          <p className={css.detailTitle}>
            <span className={css.ref}>{open.order_ref}</span>
            <span className="erp-meta"> · {dmyMYT(open.created_at)} MYT</span>
          </p>
          <dl className={css.detailGrid}>
            <dt>{L("Items", "Barang")}</dt><dd>{open.items_label ?? L("No stock movement recorded", "Tiada pergerakan stok direkodkan")}</dd>
            <dt>{L("Buyer", "Pembeli")}</dt><dd>{open.buyer_city ? `${titleCase(open.buyer_city)}${stateOf(open.buyer_city) ? ` · ${stateOf(open.buyer_city)}` : ""}` : "—"}</dd>
            <dt>{L("Tracking", "Penjejakan")}</dt>
            <dd>{open.tracking_no ? <><span className={css.tracking}>{open.tracking_no}</span>{open.courier ? <span className="erp-meta"> · {open.courier}</span> : null}</> : <span className="erp-meta">{L("No tracking number yet", "Tiada nombor penjejakan lagi")}</span>}</dd>
            {open.note && <><dt>{L("Note", "Nota")}</dt><dd>{open.note}</dd></>}
          </dl>
        </div>
      )}
    </div>
  );
}
