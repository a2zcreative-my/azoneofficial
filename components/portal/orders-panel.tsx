"use client";

/* v1.18.0 — the unified order recorder (programme phase 4).
 * ONE order for both business natures (CEO's requirement): each line is
 * product (sku · qty · unit price) OR service (host · hours · rate); the
 * order's kind — product / service / mixed — is derived from its lines by
 * the server, never chosen by hand. This is the record Reconciliation
 * compares against and Commission pays from.
 */

import { useCallback, useEffect, useState } from "react";

import { StatStrip, StatTile } from "@/components/ui/stat-tile";
import { DataTable } from "@/components/ui/data-table";
import { useSaveToast } from "@/components/ui/save-toast";
import { makeApi } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, chipWarn, fieldLabel, fieldRow, inputClass, inputClassSm } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");

interface Order {
  id: number; doc_no: string; customer: string; kind: "product" | "service" | "mixed";
  status: "draft" | "confirmed" | "fulfilled" | "cancelled"; source: string;
  total_cents: number; line_count: number; created_at: string;
}
interface Host { id: number; name: string }
interface LineDraft {
  kind: "product" | "service"; title: string;
  sku: string; qty: string; unit_price: string; cost: string;
  host_id: string; hours: string; rate: string;
}
const EMPTY_LINE: LineDraft = { kind: "product", title: "", sku: "", qty: "", unit_price: "", cost: "", host_id: "", hours: "", rate: "" };



export function OrdersPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ customer: string; source: string; lines: LineDraft[] }>({
    customer: "", source: "direct", lines: [{ ...EMPTY_LINE }],
  });

  const load = useCallback(async () => {
    const r = await api<{ orders: Order[]; pending_migration?: boolean }>(`/orders`);
    setOrders(r.data?.orders ?? []);
    setPending(r.data?.pending_migration === true);
    const h = await api<{ hosts: Host[] }>(`/hosts`);
    setHosts(h.data?.hosts ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const active = orders.filter((o) => o.status !== "cancelled");
  const revenue = active.filter((o) => o.status !== "draft").reduce((a, o) => a + o.total_cents, 0);
  const serviceish = active.filter((o) => o.kind !== "product").length;

  const lineTotal = (l: LineDraft) =>
    l.kind === "product"
      ? (Number(l.qty) || 0) * (Number(l.unit_price) || 0)
      : (Number(l.hours) || 0) * (Number(l.rate) || 0);
  const draftTotal = draft.lines.reduce((a, l) => a + lineTotal(l), 0);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) }));

  const save = async () => {
    setBusy(true);
    const r = await api<{ doc_no?: string }>(`/orders`, {
      method: "POST",
      body: JSON.stringify({
        customer: draft.customer, source: draft.source,
        lines: draft.lines.filter((l) => l.title.trim()).map((l) => l.kind === "product"
          ? { kind: "product", title: l.title, sku: l.sku || undefined, qty: l.qty ? Number(l.qty) : undefined, unit_price: l.unit_price ? Number(l.unit_price) : undefined, cost: l.cost ? Number(l.cost) : undefined }
          : { kind: "service", title: l.title, host_id: l.host_id ? Number(l.host_id) : undefined, hours: l.hours ? Number(l.hours) : undefined, rate: l.rate ? Number(l.rate) : undefined }),
      }),
    });
    setBusy(false);
    if (r.ok) {
      setDraft({ customer: "", source: "direct", lines: [{ ...EMPTY_LINE }] });
      showToast("Saved", `Order ${r.data?.doc_no ?? ""} created as draft`);
      void load();
    } else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the lines", "notice");
  };

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? "Saved" : "No changes", r.ok ? `Marked ${status}` : "Could not update", r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.</p>}
      <p className="text-sm font-semibold">Orders — products &amp; services, one record</p>

      <div className="mt-3">
        <StatStrip>
          <StatTile tone="brand" label="Orders" value={active.length} icon="≡" />
          <StatTile tone="gold" label="Confirmed revenue" value={fmtRM(revenue)} icon="$" />
          <StatTile tone="info" label="With services" value={serviceish} hint="live hosting inside" icon="◉" />
          <StatTile tone="muted" label="Draft" value={active.filter((o) => o.status === "draft").length} icon="◷" />
        </StatStrip>
      </div>

      {/* Builder */}
      <div className="border-border mb-4 rounded-xl border p-3">
        <div className={fieldRow}>
          <label className="min-w-40 flex-1"><span className={fieldLabel}>Customer</span>
            <input className={inputClass} value={draft.customer} onChange={(e) => setDraft((d) => ({ ...d, customer: e.target.value }))} /></label>
          <label><span className={fieldLabel}>Source</span>
            <select className={inputClass} value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}>
              {["direct", "tiktok", "shopee", "lazada", "stokis"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
        </div>

        {draft.lines.map((l, i) => (
          <div key={i} className="border-border mt-2 rounded-lg border border-dashed p-2">
            <div className={fieldRow}>
              <label><span className={fieldLabel}>Line type</span>
                <select className={inputClassSm} value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as LineDraft["kind"] })}>
                  <option value="product">Product</option><option value="service">Service (live)</option>
                </select></label>
              <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Title</span>
                <input className={inputClassSm} placeholder={l.kind === "product" ? "Pakej Melur set × gift box" : "TikTok Live · 4 hours"} value={l.title} onChange={(e) => setLine(i, { title: e.target.value })} /></label>
              {l.kind === "product" ? (
                <>
                  <label><span className={fieldLabel}>SKU</span>
                    <input className={inputClassSm} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} /></label>
                  <label><span className={fieldLabel}>Qty</span>
                    <input type="number" min="1" className={inputClassSm} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
                  <label><span className={fieldLabel}>Unit (RM)</span>
                    <input type="number" min="0.01" step="0.01" className={inputClassSm} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></label>
                </>
              ) : (
                <>
                  <label><span className={fieldLabel}>Host</span>
                    <select className={inputClassSm} value={l.host_id} onChange={(e) => setLine(i, { host_id: e.target.value })}>
                      <option value="">—</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select></label>
                  <label><span className={fieldLabel}>Hours</span>
                    <input type="number" min="0.5" step="0.5" className={inputClassSm} value={l.hours} onChange={(e) => setLine(i, { hours: e.target.value })} /></label>
                  <label><span className={fieldLabel}>Rate/h (RM)</span>
                    <input type="number" min="0.01" step="0.01" className={inputClassSm} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></label>
                </>
              )}
              <span className="text-muted-foreground self-end pb-2 text-xs whitespace-nowrap tabular-nums">= RM {lineTotal(l).toFixed(2)}</span>
            </div>
          </div>
        ))}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={btnSm} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { ...EMPTY_LINE }] }))}>+ Line</button>
          <button type="button" className={btnClass} disabled={busy || !draft.lines.some((l) => l.title.trim())} onClick={() => void save()}>
            Create order
          </button>
          <span className="text-xs font-semibold tabular-nums">Total RM {draftTotal.toFixed(2)}</span>
        </div>
      </div>

      <DataTable
        rows={orders}
        searchText={(o) => `${o.doc_no} ${o.customer} ${o.source} ${o.kind}`}
        defaultSort="id"
        columns={[
          { key: "doc_no", label: "Order", render: (o) => <b className="tabular-nums">{o.doc_no}</b> },
          { key: "customer", label: "Customer", render: (o) => o.customer || "—" },
          { key: "kind", label: "Nature", render: (o) => <span className={chipNeutral}>{o.kind}</span> },
          { key: "source", label: "Source" },
          { key: "line_count", label: "Lines", numeric: true, sortValue: (o) => o.line_count },
          { key: "total_cents", label: "Total", numeric: true, sortValue: (o) => o.total_cents, render: (o) => fmtRM(o.total_cents) },
          {
            key: "status", label: "Status", sortable: false,
            render: (o) => (
              <span className="flex items-center gap-1.5">
                <span className={o.status === "fulfilled" ? chipSuccess : o.status === "cancelled" ? chipDanger : o.status === "confirmed" ? chipNeutral : chipWarn}>{o.status}</span>
                {o.status === "draft" && <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(o.id, "confirmed")}>confirm</button>}
                {o.status === "confirmed" && <button type="button" className="text-success text-[11px] font-semibold" onClick={() => void setStatus(o.id, "fulfilled")}>fulfil</button>}
              </span>
            ),
          },
        ]}
        empty="No orders yet — record the first one above."
      />
    </div>
  );
}
