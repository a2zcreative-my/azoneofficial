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
import { Skel } from "@/components/ui/skeleton";
import { card, inputClass, btnClass, btnSm, fieldRow, fieldLabel, chipSuccess, chipNeutral, chipWarn } from "@/lib/ui-styles";
import { dmy, fmtRM, ym } from "@/lib/format";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

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
  /* v1.77.0 — true once the first list request settles (ok or not); until
     then the summary line and the list are skeletons, never "0 active". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ stokis: Stokis[]; month: string; error?: { message?: string } }>(`/stokis`);
    if (r.ok && r.data?.stokis) { setRows(r.data.stokis); setMonth(r.data.month); }
    else if (r.data?.error?.message?.includes("0069") || /route not found/i.test(r.data?.error?.message ?? "")) setNotReady(true);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadOrders = async (id: number) => {
    const r = await api<{ orders: Order[] }>(`/stokis/${id}/orders`);
    if (r.ok && r.data?.orders) setOrders((o) => ({ ...o, [id]: r.data!.orders }));
  };

  const save = async () => {
    if (!draft.name.trim()) { showToast(L("No changes", "Tiada perubahan"), L("Stokis name is required", "Nama stokis diperlukan"), "notice"); return; }
    const body = JSON.stringify({ ...draft, commission_pct: draft.commission_pct ? Number(draft.commission_pct) : 0 });
    const r = editingId ? await api(`/stokis/${editingId}`, { method: "PATCH", body }) : await api(`/stokis`, { method: "POST", body });
    if (!r.ok) { showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Could not save", "Tidak dapat disimpan"), "notice"); return; }
    showToast(L("Saved", "Disimpan"), editingId ? L(`${draft.name} updated`, `${draft.name} dikemas kini`) : L(`${draft.name} registered`, `${draft.name} didaftarkan`));
    setDraft({ ...EMPTY }); setEditingId(null); void load();
  };

  const addOrder = async (id: number) => {
    const cents = Math.round(Number(orderDraft.amount) * 100);
    if (!cents || cents < 0) { showToast(L("No changes", "Tiada perubahan"), L("Enter an amount", "Masukkan amaun"), "notice"); return; }
    const r = await api(`/stokis/${id}/orders`, { method: "POST", body: JSON.stringify({ amount_cents: cents, qty: orderDraft.qty ? Number(orderDraft.qty) : null, note: orderDraft.note, payment_status: orderDraft.paid ? "paid" : "unpaid" }) });
    if (r.ok) { showToast(L("Saved", "Disimpan"), L("Purchase recorded", "Pembelian direkodkan")); setOrderDraft({ amount: "", qty: "", note: "", paid: false }); void loadOrders(id); void load(); }
  };

  if (notReady) {
    return <div className={card}><p className="text-sm font-semibold">🏪 Stokis</p>
      <p className="text-muted-foreground mt-1 text-xs">{L("Stokis management is temporarily unavailable — the server may need migration 0069 applied.", "Pengurusan stokis tidak tersedia buat sementara — pelayan mungkin perlu migrasi 0069.")}</p></div>;
  }

  const activeCount = rows.filter((s) => s.status === "active").length;
  const monthTotal = rows.reduce((a, s) => a + (s.month_cents ?? 0), 0);
  const balanceTotal = rows.reduce((a, s) => a + (s.balance_cents ?? 0), 0);

  return (
    <div className={card}>
      {toastNode}{confirmNode}
      <p className="text-sm font-semibold">{L("🏪 Stokis — reseller network", "🏪 Stokis — rangkaian pengedar")}</p>
      {/* v1.77.0 — skeleton until the first fetch lands (the summary line
          would otherwise read "0 active · RM 0.00" while loading). */}
      {!loaded ? <Skel className="mt-1.5 h-3 w-72 max-w-full" /> : (
        <p className="text-muted-foreground mt-0.5 text-xs">
          {activeCount} {L("active", "aktif")} · {L("this month", "bulan ini")} {fmtRM(monthTotal)} · {L("outstanding balance", "baki tertunggak")} {fmtRM(balanceTotal)}{month ? ` · ${ym(month)}` : ""}.
        </p>
      )}

      {canManage && (
        <div className="border-border mt-3 rounded-lg border p-3">
          <p className="text-xs font-semibold">{editingId ? L("Edit stokis", "Sunting stokis") : L("Register a stokis", "Daftarkan stokis")}</p>
          <div className={`${fieldRow} mt-2`}>
            <label className="col-span-2 block sm:flex-1">
              <span className={fieldLabel}>{L("Name *", "Nama *")}</span>
              <input className={inputClass} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{L("Company", "Syarikat")}</span>
              <input className={inputClass} value={draft.company} onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{L("Commission %", "Komisen %")}</span>
              <input type="number" min={0} step="0.1" className={inputClass} placeholder={L("e.g. 10", "cth. 10")} value={draft.commission_pct} onChange={(e) => setDraft((d) => ({ ...d, commission_pct: e.target.value }))} />
            </label>
          </div>
          <div className={`${fieldRow} mt-2`}>
            <label className="block">
              <span className={fieldLabel}>{L("Phone", "Telefon")}</span>
              <input className={inputClass} value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{L("Email", "E-mel")}</span>
              <input className={inputClass} value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
            </label>
            <label className="col-span-2 block sm:flex-1">
              <span className={fieldLabel}>{L("Location", "Lokasi")}</span>
              <input className={inputClass} placeholder={L("city / state", "bandar / negeri")} value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />
            </label>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <button type="button" className={btnClass} onClick={() => void save()}>{editingId ? L("Save changes", "Simpan perubahan") : L("Register", "Daftar")}</button>
            {editingId && <button type="button" className="text-xs underline" onClick={() => { setEditingId(null); setDraft({ ...EMPTY }); }}>{L("Cancel", "Batal")}</button>}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {/* v1.77.0 — skeleton until the first fetch lands: the same bordered
            rows, name + chip on the left, amount on the right, detail line under. */}
        {!loaded && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border-border rounded-lg border px-3 py-2" aria-hidden>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Skel className="h-4 w-32" />
                <Skel className="h-4 w-12 rounded-full" />
              </span>
              <Skel className="h-4 w-20" />
            </div>
            <Skel className="mt-1.5 h-3 w-2/3" />
          </div>
        ))}
        {loaded && rows.length === 0 && <p className="text-muted-foreground text-xs">{L("No stokis registered yet.", "Belum ada stokis didaftarkan.")}</p>}
        {rows.map((s) => {
          const pct = s.target_cents && s.target_cents > 0 ? Math.round((s.month_cents / s.target_cents) * 100) : null;
          return (
            <div key={s.id} className="border-border rounded-lg border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm">
                  <RecordToggle open={open === s.id} title={L("Purchases, target and details", "Pembelian, sasaran dan butiran")}
                    onToggle={() => { const n = open === s.id ? null : s.id; setOpen(n); if (n) void loadOrders(s.id); }}>
                    {s.name}
                  </RecordToggle>
                  <span className={`ml-1.5 ${s.status === "active" ? chipSuccess : chipNeutral}`}>{L(s.status, s.status === "active" ? "aktif" : s.status === "inactive" ? "tidak aktif" : s.status)}</span>
                </span>
                <span className={rowActions}>
                  <span className="text-xs tabular-nums font-semibold">{fmtRM(s.month_cents)}<span className="text-muted-foreground">{L("/mo", "/bln")}</span></span>
                  {s.balance_cents > 0 && <span className={chipWarn}>{L("owes", "hutang")} {fmtRM(s.balance_cents)}</span>}
                  {canManage && (
                    <button type="button" className={btnSm} onClick={async () => {
                      await api(`/stokis/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: s.status === "active" ? "inactive" : "active" }) }); void load();
                    }}>{s.status === "active" ? L("Deactivate", "Nyahaktifkan") : L("Activate", "Aktifkan")}</button>
                  )}
                  {canManage && (
                    <button type="button" className={rowBtn} onClick={() => {
                      setEditingId(s.id);
                      setDraft({ name: s.name, company: s.company ?? "", phone: s.phone ?? "", email: s.email ?? "", location: s.location ?? "", commission_pct: s.commission_pct ? String(s.commission_pct) : "", notes: s.notes ?? "" });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}>{L("Edit", "Sunting")}</button>
                  )}
                  {canManage && (
                    <button type="button" className={rowBtnDanger} onClick={async () => {
                      if (!(await confirm({ title: L("Delete this stokis?", "Padam stokis ini?"), message: L(`${s.name} and their purchase records will be removed.`, `${s.name} dan rekod pembelian mereka akan dibuang.`), confirmLabel: L("Delete", "Padam") }))) return;
                      const r = await api(`/stokis/${s.id}`, { method: "DELETE" });
                      showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`${s.name} removed`, `${s.name} dibuang`) : L("Could not delete", "Tidak dapat dipadam"), r.ok ? undefined : "notice");
                      void load();
                    }}>{L("Delete", "Padam")}</button>
                  )}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                {pct !== null && <MiniBar className="w-16 shrink-0" pct={Math.min(100, pct)} tone={pct >= 100 ? "green" : "gold"} />}
                <span>
                  {L("total", "jumlah")} {fmtRM(s.total_cents)}
                  {s.commission_pct > 0 ? L(` · comm ${s.commission_pct}% = ${fmtRM(s.commission_cents)}`, ` · komisen ${s.commission_pct}% = ${fmtRM(s.commission_cents)}`) : ""}
                  {s.target_cents ? L(` · target ${fmtRM(s.target_cents)} (${pct}%)`, ` · sasaran ${fmtRM(s.target_cents)} (${pct}%)`) : ""}
                  {s.location ? ` · 📍 ${s.location}` : ""}
                  {s.joined_at ? L(` · since ${dmy(s.joined_at)}`, ` · sejak ${dmy(s.joined_at)}`) : ""}
                </span>
              </p>
              {open === s.id && (
                <div className="mt-2 rounded-lg bg-secondary/40 p-2.5">
                  {canManage && (
                    <div className="mb-2 flex flex-wrap items-end gap-2">
                      <label className="text-xs">{L("Amount RM", "Amaun RM")}<input type="number" min={0} step="0.01" className={`${inputClass} ml-1 h-8 w-28`} value={orderDraft.amount} onChange={(e) => setOrderDraft((o) => ({ ...o, amount: e.target.value }))} /></label>
                      <label className="text-xs">{L("Qty", "Kuantiti")}<input type="number" min={0} className={`${inputClass} ml-1 h-8 w-16`} value={orderDraft.qty} onChange={(e) => setOrderDraft((o) => ({ ...o, qty: e.target.value }))} /></label>
                      <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={orderDraft.paid} onChange={(e) => setOrderDraft((o) => ({ ...o, paid: e.target.checked }))} /> {L("paid", "dibayar")}</label>
                      <button type="button" className={btnSm} onClick={() => void addOrder(s.id)}>{L("Add purchase", "Tambah pembelian")}</button>
                      <label className="text-xs">{L("Target RM", "Sasaran RM")}<input type="number" min={0} step="100" className={`${inputClass} ml-1 h-8 w-28`} placeholder={month ? ym(month) : ""}
                        defaultValue={s.target_cents ? (s.target_cents / 100).toString() : ""}
                        onBlur={async (e) => { if (e.target.value && month) { await api(`/stokis/${s.id}/target`, { method: "POST", body: JSON.stringify({ month, target_cents: Math.round(Number(e.target.value) * 100) }) }); showToast(L("Saved", "Disimpan"), L("Target set", "Sasaran ditetapkan")); void load(); } }} /></label>
                    </div>
                  )}
                  {(orders[s.id] ?? []).length === 0
                    ? <p className="text-muted-foreground text-xs">{L("No purchases recorded.", "Tiada pembelian direkodkan.")}</p>
                    : (
                      <div className="space-y-1">
                        {(orders[s.id] ?? []).map((o) => (
                          <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>{dmy(o.ordered_at)}{o.qty ? L(` · ${o.qty} units`, ` · ${o.qty} unit`) : ""}{o.note ? ` · ${o.note}` : ""}</span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums font-medium">{fmtRM(o.amount_cents)}</span>
                              <button type="button" className={o.payment_status === "paid" ? chipSuccess : chipWarn}
                                title={L("toggle paid/unpaid", "togol dibayar/belum bayar")} disabled={!canManage}
                                onClick={async () => { await api(`/stokis/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ payment_status: o.payment_status === "paid" ? "unpaid" : "paid" }) }); void loadOrders(s.id); void load(); }}>
                                {L(o.payment_status, o.payment_status === "paid" ? "dibayar" : "belum bayar")}
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
