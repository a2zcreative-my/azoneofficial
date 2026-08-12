"use client";

/* v1.7.0 — 🏪 Stokis (reseller) management. Register a stokis, record each
   purchase they make from AZ ONE, and the panel rolls up their total, their
   outstanding balance, this month's sales vs target, and the commission the
   set rate would pay. */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RecordToggle } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowActions } from "@/components/ui/row-button";
import { MiniBar } from "@/components/ui/stat-card";
import { card, inputClass, btnClass, btnSm, fieldRow, fieldLabel, chipSuccess, chipNeutral, chipWarn } from "@/lib/ui-styles";
import { dmy, fmtRM, ym } from "@/lib/format";

const api = makeApi("/staff");

interface Stokis {
  id: number; name: string; company?: string | null; phone?: string | null; email?: string | null;
  location?: string | null; status: string; commission_pct: number; notes?: string | null; joined_at?: string | null;
  total_cents: number; balance_cents: number; month_cents: number; target_cents?: number | null; commission_cents: number;
}
interface Order { id: number; amount_cents: number; qty?: number | null; note?: string | null; payment_status: string; ordered_at: string }

const EMPTY = { name: "", company: "", phone: "", email: "", location: "", commission_pct: "", notes: "" };

export function StokisPanel({ canManage }: { canManage: boolean }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [rows, setRows] = useState<Stokis[]>([]);
  const [month, setMonth] = useState("");
  const [draft, setDraft] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [orders, setOrders] = useState<Record<number, Order[]>>({});
  const [orderDraft, setOrderDraft] = useState({ amount: "", qty: "", note: "", paid: false });
  const [notReady, setNotReady] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ stokis: Stokis[]; month: string; error?: { message?: string } }>(`/stokis`);
    if (r.ok && r.data?.stokis) { setRows(r.data.stokis); setMonth(r.data.month); }
    else if (r.data?.error?.message?.includes("0069") || /route not found/i.test(r.data?.error?.message ?? "")) setNotReady(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadOrders = async (id: number) => {
    const r = await api<{ orders: Order[] }>(`/stokis/${id}/orders`);
    if (r.ok && r.data?.orders) setOrders((o) => ({ ...o, [id]: r.data!.orders }));
  };

  const save = async () => {
    if (!draft.name.trim()) { showToast("No changes", "Stokis name is required", "notice"); return; }
    const body = JSON.stringify({ ...draft, commission_pct: draft.commission_pct ? Number(draft.commission_pct) : 0 });
    const r = editingId ? await api(`/stokis/${editingId}`, { method: "PATCH", body }) : await api(`/stokis`, { method: "POST", body });
    if (!r.ok) { showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Could not save", "notice"); return; }
    showToast("Saved", editingId ? `${draft.name} updated` : `${draft.name} registered`);
    setDraft({ ...EMPTY }); setEditingId(null); void load();
  };

  const addOrder = async (id: number) => {
    const cents = Math.round(Number(orderDraft.amount) * 100);
    if (!cents || cents < 0) { showToast("No changes", "Enter an amount", "notice"); return; }
    const r = await api(`/stokis/${id}/orders`, { method: "POST", body: JSON.stringify({ amount_cents: cents, qty: orderDraft.qty ? Number(orderDraft.qty) : null, note: orderDraft.note, payment_status: orderDraft.paid ? "paid" : "unpaid" }) });
    if (r.ok) { showToast("Saved", "Purchase recorded"); setOrderDraft({ amount: "", qty: "", note: "", paid: false }); void loadOrders(id); void load(); }
  };

  if (notReady) {
    return <div className={card}><p className="text-sm font-semibold">🏪 Stokis</p>
      <p className="text-muted-foreground mt-1 text-xs">Stokis management is temporarily unavailable — the server may need migration 0069 applied.</p></div>;
  }

  const activeCount = rows.filter((s) => s.status === "active").length;
  const monthTotal = rows.reduce((a, s) => a + (s.month_cents ?? 0), 0);
  const balanceTotal = rows.reduce((a, s) => a + (s.balance_cents ?? 0), 0);

  return (
    <div className={card}>
      {toastNode}{confirmNode}
      <p className="text-sm font-semibold">🏪 Stokis — reseller network</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {activeCount} active · this month {fmtRM(monthTotal)} · outstanding balance {fmtRM(balanceTotal)}{month ? ` · ${ym(month)}` : ""}.
      </p>

      {canManage && (
        <div className="border-border mt-3 rounded-lg border p-3">
          <p className="text-xs font-semibold">{editingId ? "Edit stokis" : "Register a stokis"}</p>
          <div className={`${fieldRow} mt-2`}>
            <label className="col-span-2 block sm:flex-1">
              <span className={fieldLabel}>Name *</span>
              <input className={inputClass} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>Company</span>
              <input className={inputClass} value={draft.company} onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>Commission %</span>
              <input type="number" min={0} step="0.1" className={inputClass} placeholder="e.g. 10" value={draft.commission_pct} onChange={(e) => setDraft((d) => ({ ...d, commission_pct: e.target.value }))} />
            </label>
          </div>
          <div className={`${fieldRow} mt-2`}>
            <label className="block">
              <span className={fieldLabel}>Phone</span>
              <input className={inputClass} value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>Email</span>
              <input className={inputClass} value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
            </label>
            <label className="col-span-2 block sm:flex-1">
              <span className={fieldLabel}>Location</span>
              <input className={inputClass} placeholder="city / state" value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />
            </label>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <button type="button" className={btnClass} onClick={() => void save()}>{editingId ? "Save changes" : "Register"}</button>
            {editingId && <button type="button" className="text-xs underline" onClick={() => { setEditingId(null); setDraft({ ...EMPTY }); }}>Cancel</button>}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {rows.length === 0 && <p className="text-muted-foreground text-xs">No stokis registered yet.</p>}
        {rows.map((s) => {
          const pct = s.target_cents && s.target_cents > 0 ? Math.round((s.month_cents / s.target_cents) * 100) : null;
          return (
            <div key={s.id} className="border-border rounded-lg border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm">
                  <RecordToggle open={open === s.id} title="Purchases, target and details"
                    onToggle={() => { const n = open === s.id ? null : s.id; setOpen(n); if (n) void loadOrders(s.id); }}>
                    {s.name}
                  </RecordToggle>
                  <span className={`ml-1.5 ${s.status === "active" ? chipSuccess : chipNeutral}`}>{s.status}</span>
                </span>
                <span className={rowActions}>
                  <span className="text-xs tabular-nums font-semibold">{fmtRM(s.month_cents)}<span className="text-muted-foreground">/mo</span></span>
                  {s.balance_cents > 0 && <span className={chipWarn}>owes {fmtRM(s.balance_cents)}</span>}
                  {canManage && (
                    <button type="button" className={btnSm} onClick={async () => {
                      await api(`/stokis/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: s.status === "active" ? "inactive" : "active" }) }); void load();
                    }}>{s.status === "active" ? "Deactivate" : "Activate"}</button>
                  )}
                  {canManage && (
                    <button type="button" className={rowBtn} onClick={() => {
                      setEditingId(s.id);
                      setDraft({ name: s.name, company: s.company ?? "", phone: s.phone ?? "", email: s.email ?? "", location: s.location ?? "", commission_pct: s.commission_pct ? String(s.commission_pct) : "", notes: s.notes ?? "" });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}>Edit</button>
                  )}
                  {canManage && (
                    <button type="button" className={rowBtnDanger} onClick={async () => {
                      if (!(await confirm({ title: "Delete this stokis?", message: `${s.name} and their purchase records will be removed.`, confirmLabel: "Delete" }))) return;
                      const r = await api(`/stokis/${s.id}`, { method: "DELETE" });
                      showToast(r.ok ? "Saved" : "No changes", r.ok ? `${s.name} removed` : "Could not delete", r.ok ? undefined : "notice");
                      void load();
                    }}>Delete</button>
                  )}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                {pct !== null && <MiniBar className="w-16 shrink-0" pct={Math.min(100, pct)} tone={pct >= 100 ? "green" : "gold"} />}
                <span>
                  total {fmtRM(s.total_cents)}
                  {s.commission_pct > 0 ? ` · comm ${s.commission_pct}% = ${fmtRM(s.commission_cents)}` : ""}
                  {s.target_cents ? ` · target ${fmtRM(s.target_cents)} (${pct}%)` : ""}
                  {s.location ? ` · 📍 ${s.location}` : ""}
                  {s.joined_at ? ` · since ${dmy(s.joined_at)}` : ""}
                </span>
              </p>
              {open === s.id && (
                <div className="mt-2 rounded-lg bg-secondary/40 p-2.5">
                  {canManage && (
                    <div className="mb-2 flex flex-wrap items-end gap-2">
                      <label className="text-xs">Amount RM<input type="number" min={0} step="0.01" className={`${inputClass} ml-1 h-8 w-28`} value={orderDraft.amount} onChange={(e) => setOrderDraft((o) => ({ ...o, amount: e.target.value }))} /></label>
                      <label className="text-xs">Qty<input type="number" min={0} className={`${inputClass} ml-1 h-8 w-16`} value={orderDraft.qty} onChange={(e) => setOrderDraft((o) => ({ ...o, qty: e.target.value }))} /></label>
                      <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={orderDraft.paid} onChange={(e) => setOrderDraft((o) => ({ ...o, paid: e.target.checked }))} /> paid</label>
                      <button type="button" className={btnSm} onClick={() => void addOrder(s.id)}>Add purchase</button>
                      <label className="text-xs">Target RM<input type="number" min={0} step="100" className={`${inputClass} ml-1 h-8 w-28`} placeholder={month ? ym(month) : ""}
                        defaultValue={s.target_cents ? (s.target_cents / 100).toString() : ""}
                        onBlur={async (e) => { if (e.target.value && month) { await api(`/stokis/${s.id}/target`, { method: "POST", body: JSON.stringify({ month, target_cents: Math.round(Number(e.target.value) * 100) }) }); showToast("Saved", "Target set"); void load(); } }} /></label>
                    </div>
                  )}
                  {(orders[s.id] ?? []).length === 0
                    ? <p className="text-muted-foreground text-xs">No purchases recorded.</p>
                    : (
                      <div className="space-y-1">
                        {(orders[s.id] ?? []).map((o) => (
                          <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>{dmy(o.ordered_at)}{o.qty ? ` · ${o.qty} units` : ""}{o.note ? ` · ${o.note}` : ""}</span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums font-medium">{fmtRM(o.amount_cents)}</span>
                              <button type="button" className={o.payment_status === "paid" ? chipSuccess : chipWarn}
                                title="toggle paid/unpaid" disabled={!canManage}
                                onClick={async () => { await api(`/stokis/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ payment_status: o.payment_status === "paid" ? "unpaid" : "paid" }) }); void loadOrders(s.id); void load(); }}>
                                {o.payment_status}
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
