"use client";

/* v1.37.0 — 🌐 Web Orders: every ELFIA store order, monitored from the
   portal (IMPLEMENTATION-PLAN.md Track A-3). The STORE owns these — this
   panel reads, filters and drills in; it never edits an order and never
   touches stock (the movements feed already did that). The detail drawer
   shows the frozen prices actually charged at purchase AND the portal-side
   stock movements the order caused, so "what did this order do to my count"
   is one click. */

import { Fragment, useCallback, useMemo, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { card, inputClass, btnSm, chipSuccess, chipNeutral, chipWarn } from "@/lib/ui-styles";
import { dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
/* The shop's address comes from the brand registry, never typed here:
   tests/brands-guard.mjs fails the build on a hardcoded client domain, and
   the reason it does is that a domain written in twelve files is a domain
   that cannot be changed. */
import { brandByCode } from "@/constants/brands";
import { Skel, SkelText, StaleHint } from "@/components/ui/skeleton";
import { useCachedApi } from "@/lib/cached-api";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface WebOrder {
  id: number; store: string; order_number: string; status: string;
  customer_name?: string | null; phone?: string | null; address?: string | null;
  subtotal_cents: number; shipping_cents: number; total_cents: number;
  payment_method?: string | null; tracking_no?: string | null; tracking_courier?: string | null;
  /* v1.73.0 — built by the SHOP and mirrored here (feed C). Never assembled
     in this file: one courier map, in one repository. */
  tracking_url?: string | null;
  placed_at?: string | null; store_updated_at?: string | null; paid_seen_at?: string | null;
}
interface WebOrderLine { id: number; name?: string | null; sku?: string | null; qty: number; price_cents: number }
interface Movement { sku: string; delta: number; outcome: string; received_at: string }

const STATUSES = ["pending_payment", "payment_review", "paid", "shipped", "completed", "cancelled"] as const;

/* v1.51.0 — the couriers the ELFIA store knows how to build a tracking link
   for. Keys must match the store's own list: it turns the key into the
   customer-facing tracking URL on the order page, and one it does not
   recognise is dropped rather than shown as a dead link. */
const COURIERS = [
  { key: "jnt", label: "J&T Express" },
  { key: "ninjavan", label: "Ninja Van" },
  { key: "poslaju", label: "Pos Laju" },
  { key: "flash", label: "Flash Express" },
  { key: "citylink", label: "City-Link" },
  { key: "dhl", label: "DHL" },
] as const;

/* Status labels are DISPLAY strings (bilingual); the raw values drive logic
   and stay English, per the house i18n rule. */
function statusLabel(s: string): string {
  switch (s) {
    case "pending_payment": return L("Awaiting payment", "Menunggu bayaran");
    case "payment_review": return L("Payment review", "Semakan bayaran");
    case "paid": return L("Paid", "Dibayar");
    case "shipped": return L("Shipped", "Dihantar");
    case "completed": return L("Completed", "Selesai");
    case "cancelled": return L("Cancelled", "Dibatalkan");
    default: return s;
  }
}
function statusChip(s: string): string {
  if (s === "paid" || s === "shipped" || s === "completed") return chipSuccess;
  if (s === "cancelled") return chipWarn;
  return chipNeutral;
}

export function WebOrdersPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.62.0 — the v1.4.240 sweep replaced every window.confirm with the
     branded dialog, but this panel was written after it and went back to
     the browser's own box. The CEO, 27-08: "when cancel the order, this
     box popup instead using the Globally popup!" */
  const { confirm, node: confirmNode } = useConfirm();
  const [statusF, setStatusF] = useState<string>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  /* v1.51.0 — the fulfilment controls. One tracking box at a time: only one
     order is ever open. */
  const [tracking, setTracking] = useState("");
  const [courier, setCourier] = useState("jnt");
  const [acting, setActing] = useState(false);
  /* v1.73.0 — the link the last action returned, so "send it to the
     customer" works the second a parcel is marked shipped rather than after
     the next five-minute poll. */
  const [freshUrl, setFreshUrl] = useState<Record<string, string>>({});

  /* CEO: "how to make sure that they able to tracking their order?" — this
     is the answer. Marking an order shipped updates the shop's own order
     page, but nothing reaches the customer until somebody tells them, and
     there is still no outbound email (OD-12). WhatsApp is what this shop
     actually uses, so the message is composed here and opened in WhatsApp
     with one tap: the order number, the courier, the number itself, the
     direct courier link, and the shop's own lookup page as a fallback. */
  const waTrack = (o: WebOrder, url?: string) => {
    const digits = (o.phone ?? "").replace(/\D/g, "").replace(/^0/, "60");
    const link = url ?? o.tracking_url ?? "";
    const lines = [
      `Hi ${o.customer_name ?? ""}! Your ELFIA order ${o.order_number} is on its way.`,
      "",
      `Courier: ${COURIERS.find((c) => c.key === o.tracking_courier)?.label ?? o.tracking_courier ?? "-"}`,
      `Tracking number: ${o.tracking_no ?? ""}`,
      ...(link ? ["", `Track it here: ${link}`] : []),
      "",
      `You can also check your order any time at ${brandByCode("elfia")?.url ?? ""}/track`,
      "Thank you for shopping with ELFIA!",
    ];
    return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
  };

  /* One relay call, then reload: the store is the source of truth for what
     an order IS, so the panel never guesses the new state — it asks. */
  const act = async (o: WebOrder, action: string, extra: Record<string, unknown> = {}) => {
    setActing(true);
    const res = await api<{ error?: { message?: string } }>(
      `/web-orders/${encodeURIComponent(o.order_number)}/action`,
      { method: "POST", body: JSON.stringify({ action, ...extra }) },
    );
    setActing(false);
    if (!res.ok) {
      showToast(L("Not changed", "Tidak diubah"), res.data?.error?.message ?? L("The shop refused that", "Kedai menolaknya"), "notice");
      return;
    }
    const back = res.data as unknown as { tracking_url?: string | null } | null;
    if (back?.tracking_url) setFreshUrl((m) => ({ ...m, [o.order_number]: back.tracking_url! }));
    const done: Record<string, string> = {
      confirm_paid: L("marked paid — the customer sees it too", "ditanda dibayar — pelanggan juga nampak"),
      ship: L("tracking saved — the customer can track it now", "penjejakan disimpan — pelanggan boleh menjejak sekarang"),
      complete: L("marked delivered", "ditanda sampai"),
      cancel: L("cancelled and the stock is back", "dibatalkan dan stok dipulangkan"),
      update_tracking: L("tracking number corrected — the customer sees the new one", "nombor penjejakan dibetulkan — pelanggan nampak yang baharu"),
    };
    showToast(L("Saved", "Disimpan"), `${o.order_number} — ${done[action] ?? L("updated", "dikemas kini")}`);
    setTracking("");
    void load();
  };
  const [detail, setDetail] = useState<{ lines: WebOrderLine[]; movements: Movement[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  /* v1.104.0 (roadmap phase 02) - remembered, then refreshed. The list you
     had last time paints from the device before the request lands; each
     (status, search) pair is its own entry. Any write on an order - here, or
     the bridge pulling new ones - bumps the "web-orders" topic and the open
     view refetches by itself.
     v1.77.0 (kept): until the first EVER response the table body is a
     skeleton, never "No web orders yet". */
  const listPath = (() => {
    const params = new URLSearchParams();
    if (statusF) params.set("status", statusF);
    if (q.trim()) params.set("q", q.trim());
    return `/staff/web-orders?${params}`;
  })();
  const list = useCachedApi<{ orders: WebOrder[]; pending_migration?: boolean }>(listPath, true, ["web-orders"]);
  const orders = useMemo(() => list.data?.orders ?? [], [list.data]);
  const pending = Boolean(list.data?.pending_migration); // pending_migration flag
  const loaded = !list.loading;
  const refreshList = list.refresh;
  const load = useCallback(async () => { refreshList(); }, [refreshList]);

  const openDetail = async (id: number) => {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null); setTracking("");
    const res = await api<{ lines: WebOrderLine[]; movements: Movement[] }>(`/web-orders/${id}`);
    if (res.ok && res.data) setDetail({ lines: res.data.lines ?? [], movements: res.data.movements ?? [] });
  };

  const syncNow = async () => {
    setSyncing(true);
    const res = await api<{ error?: { message?: string } }>(`/web-orders/sync`, { method: "POST", body: JSON.stringify({}) });
    setSyncing(false);
    if (!res.ok) { showToast(L("Not synced", "Tidak disegerak"), res.data?.error?.message ?? L("Sync failed", "Segerak gagal"), "notice"); return; }
    showToast(L("Synced", "Disegerak"), L("Pulled the latest orders from the store", "Pesanan terkini ditarik daripada kedai"));
    void load();
  };

  const th = "px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground";
  const td = "px-2 py-1.5 text-sm";

  return (
    <div className={card}>
      {toastNode}
      {confirmNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{L("Web Orders", "Pesanan Web")} <span className="text-muted-foreground text-xs font-normal">ELFIA</span> <StaleHint show={list.stale} className="ml-1" /></h2>
        <button type="button" className={btnSm} disabled={syncing} onClick={() => void syncNow()}
          title={L("The store is polled every 5 minutes anyway — this just pulls now", "Kedai ditarik setiap 5 minit — butang ini menarik sekarang sahaja")}>
          {syncing ? L("Pulling…", "Menarik…") : L("Pull now", "Tarik sekarang")}
        </button>
      </div>
      {pending && (
        <p className="text-muted-foreground mt-2 text-sm">
          {L("Waiting for migration 0081 — run the deploy and this fills by itself.", "Menunggu migrasi 0081 — jalankan deploy dan senarai ini terisi sendiri.")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button type="button"
          className={`rounded-full border px-2.5 py-0.5 text-xs ${statusF === "" ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-secondary"}`}
          onClick={() => setStatusF("")}>{L("All", "Semua")}</button>
        {STATUSES.map((s) => (
          <button key={s} type="button"
            className={`rounded-full border px-2.5 py-0.5 text-xs ${statusF === s ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-secondary"}`}
            onClick={() => setStatusF(s)}>{statusLabel(s)}</button>
        ))}
        <input className={`${inputClass} sm:max-w-56`} placeholder={L("Order no / phone / name", "No pesanan / telefon / nama")}
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {/* v1.77.0 — skeleton until the first fetch lands: the real table
          header over six shimmering columns, same min width as the table. */}
      {!loaded && (
        <div className="mt-3 overflow-x-auto" aria-hidden>
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("Order", "Pesanan")}</th>
                <th className={th}>Status</th>
                <th className={th}>{L("Customer", "Pelanggan")}</th>
                <th className={`${th} text-right`}>{L("Total", "Jumlah")}</th>
                <th className={th}>{L("Placed", "Dibuat")}</th>
                <th className={th}>{L("Tracking", "Penjejakan")}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="border-border border-b last:border-0">
                  <td className={td}><Skel className="h-4 w-24" /></td>
                  <td className={td}><Skel className="h-5 w-20 rounded-full" /></td>
                  <td className={td}><Skel className="h-4 w-32" /></td>
                  <td className={td}><Skel className="ml-auto h-4 w-16" /></td>
                  <td className={td}><Skel className="h-4 w-24" /></td>
                  <td className={td}><Skel className="h-4 w-28" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loaded && orders.length === 0 && !pending && (
        <p className="text-muted-foreground mt-3 text-sm">
          {L("No web orders yet — they appear here within 5 minutes of being placed in the store.", "Tiada pesanan web lagi — ia muncul di sini dalam 5 minit selepas dibuat di kedai.")}
        </p>
      )}
      {orders.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("Order", "Pesanan")}</th>
                <th className={th}>Status</th>
                <th className={th}>{L("Customer", "Pelanggan")}</th>
                <th className={`${th} text-right`}>{L("Total", "Jumlah")}</th>
                <th className={th}>{L("Placed", "Dibuat")}</th>
                <th className={th}>{L("Tracking", "Penjejakan")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr className="border-border cursor-pointer border-b last:border-0 hover:bg-secondary/40"
                    onClick={() => void openDetail(o.id)}>
                    <td className={`${td} font-mono text-xs`}>{o.order_number}</td>
                    <td className={td}><span className={statusChip(o.status)}>{statusLabel(o.status)}</span></td>
                    <td className={td}>{o.customer_name ?? "—"}<span className="text-muted-foreground ml-1 text-xs">{o.phone ?? ""}</span></td>
                    <td className={`${td} text-right font-medium`}>{fmtRM(o.total_cents)}</td>
                    <td className={`${td} text-xs`}>{dmyMYT(o.placed_at)}</td>
                    <td className={`${td} text-xs`}>
                      {o.tracking_no ? (
                        o.tracking_url ? (
                          /* The link is the shop's, not one built here. */
                          <a href={o.tracking_url} target="_blank" rel="noopener noreferrer"
                            className="underline" onClick={(e) => e.stopPropagation()}
                            title={L("Open the courier's tracking page", "Buka halaman penjejakan kurier")}>
                            {COURIERS.find((c) => c.key === o.tracking_courier)?.label ?? o.tracking_courier} {o.tracking_no}
                          </a>
                        ) : (
                          `${o.tracking_courier ?? ""} ${o.tracking_no}`
                        )
                      ) : "—"}
                    </td>
                  </tr>
                  {open === o.id && (
                    <tr className="border-border border-b last:border-0">
                      <td className={td} colSpan={6}>
                        {/* v1.77.0 — skeleton until the detail lands, in the
                            detail's own two-column grid. */}
                        {!detail && (
                          <div className="grid grid-cols-1 gap-3 py-1 md:grid-cols-2" aria-hidden>
                            <div>
                              <Skel className="h-3 w-44" />
                              <SkelText lines={3} className="mt-2" />
                            </div>
                            <div>
                              <Skel className="h-3 w-40" />
                              <SkelText lines={2} className="mt-2" />
                            </div>
                            <div className="md:col-span-2 border-border border-t pt-3">
                              <Skel className="h-3 w-32" />
                              <Skel className="mt-2 h-7 w-36" />
                            </div>
                          </div>
                        )}
                        {detail && (
                          <div className="grid grid-cols-1 gap-3 py-1 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold">{L("Items — price actually charged", "Barangan — harga sebenar dicaj")}</p>
                              <ul className="mt-1 space-y-0.5 text-sm">
                                {detail.lines.map((l) => (
                                  <li key={l.id} className="flex justify-between gap-2">
                                    <span>{l.qty}× {l.name ?? l.sku ?? "?"}{l.sku ? <span className="text-muted-foreground ml-1 font-mono text-xs">{l.sku}</span> : null}</span>
                                    <span>{fmtRM(l.price_cents * l.qty)}</span>
                                  </li>
                                ))}
                                <li className="text-muted-foreground flex justify-between gap-2 text-xs">
                                  <span>{L("Shipping", "Penghantaran")}</span><span>{fmtRM(o.shipping_cents)}</span>
                                </li>
                              </ul>
                              {o.address && <p className="text-muted-foreground mt-2 text-xs whitespace-pre-line">{o.address}</p>}
                            </div>
                            <div>
                              <p className="text-xs font-semibold">{L("What it did to the stock count", "Kesannya pada kiraan stok")}</p>
                              {detail.movements.length === 0
                                ? <p className="text-muted-foreground mt-1 text-xs">{L("No movements recorded for this order (yet).", "Tiada pergerakan direkod untuk pesanan ini (buat masa ini).")}</p>
                                : (
                                  <ul className="mt-1 space-y-0.5 text-sm">
                                    {detail.movements.map((m, i) => (
                                      <li key={i} className="flex justify-between gap-2">
                                        <span className="font-mono text-xs">{m.sku}</span>
                                        <span className={m.delta < 0 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}>
                                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                                          {m.outcome !== "applied" && <span className="text-muted-foreground ml-1 text-xs">({m.outcome})</span>}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              {o.paid_seen_at && <p className="text-muted-foreground mt-2 text-xs">{L("Booked as revenue on", "Ditempah sebagai hasil pada")} {dmyMYT(o.paid_seen_at)}</p>}
                            </div>

                            {/* v1.51.0 — the CEO: "elfia web order should be
                                able to update the tracking number so that
                                customer can track the order". This panel used
                                to be read-only, which left confirming a
                                payment and entering a tracking number stuck
                                in the store's own admin. The store still owns
                                the rules — forward-only, and cancelling puts
                                the stock back — so only the moves that are
                                legal from THIS status are offered. */}
                            <div className="md:col-span-2 border-border border-t pt-3">
                              <p className="text-xs font-semibold">{L("Move this order forward", "Gerakkan pesanan ini")}</p>
                              {["pending_payment", "payment_review"].includes(o.status) && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                  <button type="button" className={btnSm} disabled={acting}
                                    onClick={() => void act(o, "confirm_paid")}>
                                    {L("Payment received", "Bayaran diterima")}
                                  </button>
                                  <button type="button" className={btnSm} disabled={acting}
                                    onClick={() => void (async () => {
                                      if (!(await confirm({
                                        title: L("Cancel this order?", "Batalkan pesanan ini?"),
                                        message: L(`${o.order_number} will be cancelled and the stock put back.`,
                                                   `${o.order_number} akan dibatalkan dan stok dipulangkan.`),
                                        confirmLabel: L("Cancel order", "Batalkan pesanan"),
                                        cancelLabel: L("Keep it", "Kekalkan"),
                                        variant: "danger",
                                      }))) return;
                                      await act(o, "cancel");
                                    })()}>
                                    {L("Cancel order", "Batalkan pesanan")}
                                  </button>
                                </div>
                              )}
                              {o.status === "paid" && (
                                <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                                  <label className="flex flex-col gap-1">
                                    <span className="text-muted-foreground">{L("Courier", "Kurier")}</span>
                                    <select className="border-input bg-background rounded border px-1.5 py-1"
                                      value={courier} onChange={(e) => setCourier(e.target.value)}>
                                      {COURIERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                    </select>
                                  </label>
                                  <label className="flex flex-1 flex-col gap-1" style={{ minWidth: "12rem" }}>
                                    <span className="text-muted-foreground">{L("Tracking number", "Nombor penjejakan")}</span>
                                    <input className={inputClass} value={tracking} maxLength={60}
                                      placeholder={L("as printed on the parcel", "seperti tercetak pada bungkusan")}
                                      onChange={(e) => setTracking(e.target.value)} />
                                  </label>
                                  <button type="button" className={btnSm} disabled={acting || tracking.trim() === ""}
                                    title={tracking.trim() === "" ? L("Enter the tracking number first", "Masukkan nombor penjejakan dahulu") : ""}
                                    onClick={() => void act(o, "ship", { tracking_no: tracking.trim(), tracking_courier: courier })}>
                                    {L("Mark shipped", "Tanda dihantar")}
                                  </button>
                                </div>
                              )}
                              {o.status === "shipped" && (
                                <div className="mt-2 space-y-2 text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-muted-foreground">
                                      {o.tracking_no
                                        ? L(`Customer is tracking ${o.tracking_no}`, `Pelanggan menjejak ${o.tracking_no}`)
                                        : L("No tracking number was entered", "Tiada nombor penjejakan dimasukkan")}
                                    </span>
                                    {/* v1.73.0 — one tap sends it. Nothing reaches a
                                        customer on its own: the shop's page updates,
                                        but only if they go and look. */}
                                    {o.tracking_no && o.phone && (
                                      <a className={btnSm} target="_blank" rel="noopener noreferrer"
                                        href={waTrack(o, freshUrl[o.order_number])}
                                        onClick={(e) => e.stopPropagation()}>
                                        {L("WhatsApp the tracking", "WhatsApp penjejakan")}
                                      </a>
                                    )}
                                    <button type="button" className={btnSm} disabled={acting}
                                      onClick={() => void act(o, "complete")}>
                                      {L("Mark delivered", "Tanda sampai")}
                                    </button>
                                  </div>
                                  {/* A tracking number is typed off a label by hand.
                                      Until now a typo was permanent and the customer
                                      followed somebody else's parcel. */}
                                  <div className="flex flex-wrap items-end gap-2">
                                    <label className="flex flex-col gap-1">
                                      <span className="text-muted-foreground">{L("Correct the courier", "Betulkan kurier")}</span>
                                      <select className="border-input bg-background rounded border px-1.5 py-1"
                                        value={courier} onChange={(e) => setCourier(e.target.value)}>
                                        {COURIERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                      </select>
                                    </label>
                                    <label className="flex flex-1 flex-col gap-1" style={{ minWidth: "12rem" }}>
                                      <span className="text-muted-foreground">{L("Correct the number", "Betulkan nombor")}</span>
                                      <input className={inputClass} value={tracking} maxLength={60}
                                        placeholder={o.tracking_no ?? ""}
                                        onChange={(e) => setTracking(e.target.value)} />
                                    </label>
                                    <button type="button" className={btnSm}
                                      disabled={acting || tracking.trim() === "" || tracking.trim() === o.tracking_no}
                                      onClick={() => void act(o, "update_tracking", { tracking_no: tracking.trim(), tracking_courier: courier })}>
                                      {L("Update tracking", "Kemas kini penjejakan")}
                                    </button>
                                  </div>
                                </div>
                              )}
                              {["completed", "cancelled"].includes(o.status) && (
                                <p className="text-muted-foreground mt-1 text-xs">
                                  {L("This order is finished — nothing left to do here.", "Pesanan ini selesai — tiada apa lagi di sini.")}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
