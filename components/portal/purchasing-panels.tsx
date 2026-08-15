"use client";

/* v1.18.0 — Purchasing + Accounting (programme phase 7).
 * Purchasing: suppliers + POs with a draft→sent→received flow. Accounting:
 * chart of accounts, a balanced-only journal (the server refuses an entry
 * whose debits ≠ credits — the invariant lives where it cannot be bypassed)
 * and a trial balance computed from the journal.
 */

import { useCallback, useEffect, useState } from "react";

import { StatStrip, StatTile } from "@/components/ui/stat-tile";
import { DataTable } from "@/components/ui/data-table";
import { useSaveToast } from "@/components/ui/save-toast";
import { makeApi } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, chipWarn, fieldLabel, fieldRow, inputClass, inputClassSm, rowHead, td, tdR2, th, thR2 } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");
const dmy2 = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—");

/* ============================ Purchasing ============================ */

interface Supplier { id: number; name: string; contact: string; phone: string; email: string; active: number }
interface Po {
  id: number; po_no: string; supplier_id: number; supplier_name: string;
  status: "draft" | "sent" | "received" | "cancelled"; items: string; total_cents: number;
  expected_date: string | null;
}
interface PoItemDraft { title: string; qty: string; unit_price: string }

export function PurchasingPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<Po[]>([]);
  const [pending, setPending] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ name: "", contact: "", phone: "" });
  const [poDraft, setPoDraft] = useState<{ supplier_id: string; expected_date: string; items: PoItemDraft[] }>({
    supplier_id: "", expected_date: "", items: [{ title: "", qty: "", unit_price: "" }],
  });

  const load = useCallback(async () => {
    const s = await api<{ suppliers: Supplier[] }>(`/suppliers`); setSuppliers(s.data?.suppliers ?? []);
    const p = await api<{ pos: Po[]; pending_migration?: boolean }>(`/purchase-orders`);
    setPos(p.data?.pos ?? []); setPending(p.data?.pending_migration === true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = pos.filter((p) => ["draft", "sent"].includes(p.status));
  const openValue = open.reduce((a, p) => a + p.total_cents, 0);

  const addSupplier = async () => {
    const r = await api(`/suppliers`, { method: "POST", body: JSON.stringify(supplierDraft) });
    if (r.ok) { setSupplierDraft({ name: "", contact: "", phone: "" }); showToast("Saved", "Supplier added"); void load(); }
    else showToast("No changes", "The supplier needs a name", "notice");
  };

  const createPo = async () => {
    const items = poDraft.items
      .filter((it) => it.title.trim())
      .map((it) => ({ title: it.title, qty: it.qty ? Number(it.qty) : undefined, unit_price: it.unit_price ? Number(it.unit_price) : undefined }));
    const r = await api<{ po_no?: string }>(`/purchase-orders`, {
      method: "POST",
      body: JSON.stringify({
        supplier_id: poDraft.supplier_id ? Number(poDraft.supplier_id) : undefined,
        expected_date: poDraft.expected_date || undefined,
        items,
      }),
    });
    if (r.ok) {
      setPoDraft({ supplier_id: "", expected_date: "", items: [{ title: "", qty: "", unit_price: "" }] });
      showToast("Saved", `${r.data?.po_no ?? "PO"} created as draft`);
      void load();
    } else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the fields", "notice");
  };

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? "Saved" : "No changes", r.ok ? `Marked ${status}` : "Could not update", r.ok ? undefined : "notice");
    void load();
  };

  const setItem = (i: number, patch: Partial<PoItemDraft>) =>
    setPoDraft((d) => ({ ...d, items: d.items.map((it, x) => (x === i ? { ...it, ...patch } : it)) }));

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.</p>}
      <div className={rowHead}>
        <p className="text-sm font-semibold">Purchasing</p>
        <button type="button" className={btnSm} onClick={() => setShowSuppliers((v) => !v)}>{showSuppliers ? "Hide suppliers" : `Suppliers (${suppliers.length})`}</button>
      </div>

      <div className="mt-3">
        <StatStrip>
          <StatTile tone="info" label="Purchase orders" value={pos.length} icon="≡" />
          <StatTile tone="brand" label="Open POs" value={open.length} icon="◷" />
          <StatTile tone="gold" label="Open value" value={fmtRM(openValue)} icon="$" />
          <StatTile tone="muted" label="Suppliers" value={suppliers.filter((s) => s.active).length} icon="⌂" />
        </StatStrip>
      </div>

      {showSuppliers && (
        <div className="border-border mb-4 rounded-xl border p-3">
          {suppliers.map((s) => (
            <p key={s.id} className="border-border flex flex-wrap justify-between gap-2 border-b py-1.5 text-sm last:border-0">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">{[s.contact, s.phone].filter(Boolean).join(" · ") || "—"}</span>
            </p>
          ))}
          <div className={`${fieldRow} mt-2`}>
            <label className="min-w-32 flex-1"><span className={fieldLabel}>Name</span>
              <input className={inputClassSm} value={supplierDraft.name} onChange={(e) => setSupplierDraft((d) => ({ ...d, name: e.target.value }))} /></label>
            <label><span className={fieldLabel}>Contact person</span>
              <input className={inputClassSm} value={supplierDraft.contact} onChange={(e) => setSupplierDraft((d) => ({ ...d, contact: e.target.value }))} /></label>
            <label><span className={fieldLabel}>Phone</span>
              <input className={inputClassSm} value={supplierDraft.phone} onChange={(e) => setSupplierDraft((d) => ({ ...d, phone: e.target.value }))} /></label>
            <button type="button" className={btnSm} onClick={() => void addSupplier()}>Add supplier</button>
          </div>
        </div>
      )}

      {/* New PO */}
      <div className="border-border mb-4 rounded-xl border p-3">
        <p className="mb-2 text-xs font-semibold">New purchase order</p>
        <div className={fieldRow}>
          <label><span className={fieldLabel}>Supplier</span>
            <select className={inputClass} value={poDraft.supplier_id} onChange={(e) => setPoDraft((d) => ({ ...d, supplier_id: e.target.value }))}>
              <option value="">—</option>
              {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label><span className={fieldLabel}>Expected date</span>
            <input type="date" className={inputClass} value={poDraft.expected_date} onChange={(e) => setPoDraft((d) => ({ ...d, expected_date: e.target.value }))} /></label>
        </div>
        {poDraft.items.map((it, i) => (
          <div key={i} className={`${fieldRow} mt-2`}>
            <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Item</span>
              <input className={inputClassSm} value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} /></label>
            <label><span className={fieldLabel}>Qty</span>
              <input type="number" min="1" className={inputClassSm} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></label>
            <label><span className={fieldLabel}>Unit (RM)</span>
              <input type="number" min="0.01" step="0.01" className={inputClassSm} value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })} /></label>
          </div>
        ))}
        <div className="mt-2 flex gap-2">
          <button type="button" className={btnSm} onClick={() => setPoDraft((d) => ({ ...d, items: [...d.items, { title: "", qty: "", unit_price: "" }] }))}>+ Item</button>
          <button type="button" className={btnClass} disabled={!poDraft.supplier_id || !poDraft.items.some((it) => it.title.trim())} onClick={() => void createPo()}>
            Create PO
          </button>
        </div>
      </div>

      <DataTable
        rows={pos}
        searchText={(p) => `${p.po_no} ${p.supplier_name}`}
        defaultSort="id"
        columns={[
          { key: "po_no", label: "PO no", render: (p) => <b className="tabular-nums">{p.po_no}</b> },
          { key: "supplier_name", label: "Supplier" },
          { key: "expected_date", label: "Expected", render: (p) => <span className="tabular-nums">{dmy2(p.expected_date)}</span> },
          { key: "total_cents", label: "Total", numeric: true, sortValue: (p) => p.total_cents, render: (p) => fmtRM(p.total_cents) },
          {
            key: "status", label: "Status", sortable: false,
            render: (p) => (
              <span className="flex items-center gap-1.5">
                <span className={p.status === "received" ? chipSuccess : p.status === "cancelled" ? chipDanger : p.status === "sent" ? chipNeutral : chipWarn}>{p.status}</span>
                {p.status === "draft" && <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(p.id, "sent")}>send</button>}
                {p.status === "sent" && <button type="button" className="text-success text-[11px] font-semibold" onClick={() => void setStatus(p.id, "received")}>received</button>}
              </span>
            ),
          },
        ]}
        empty="No purchase orders yet."
      />
    </div>
  );
}

/* ============================ Accounting ============================ */

interface GlAccount { id: number; code: string; name: string; type: string; debit_cents?: number; credit_cents?: number }
interface JournalLineDraft { account_id: string; debit: string; credit: string }

export function AccountingPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [trial, setTrial] = useState<GlAccount[]>([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<{ entry_date: string; memo: string; lines: JournalLineDraft[] }>({
    entry_date: "", memo: "", lines: [{ account_id: "", debit: "", credit: "" }, { account_id: "", debit: "", credit: "" }],
  });

  const load = useCallback(async () => {
    const a = await api<{ accounts: GlAccount[]; pending_migration?: boolean }>(`/gl/accounts`);
    setAccounts(a.data?.accounts ?? []);
    setPending(a.data?.pending_migration === true);
    const t = await api<{ accounts: GlAccount[] }>(`/gl/trial-balance`);
    setTrial(t.data?.accounts ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const totalDebit = draft.lines.reduce((a, l) => a + (l.debit ? Number(l.debit) : 0), 0);
  const totalCredit = draft.lines.reduce((a, l) => a + (l.credit ? Number(l.credit) : 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  const trialDebit = trial.reduce((a, t) => a + (t.debit_cents ?? 0), 0);
  const trialCredit = trial.reduce((a, t) => a + (t.credit_cents ?? 0), 0);

  const post = async () => {
    const r = await api(`/gl/journal`, {
      method: "POST",
      body: JSON.stringify({
        entry_date: draft.entry_date, memo: draft.memo,
        lines: draft.lines
          .filter((l) => l.account_id && (l.debit || l.credit))
          .map((l) => ({ account_id: Number(l.account_id), debit: l.debit ? Number(l.debit) : 0, credit: l.credit ? Number(l.credit) : 0 })),
      }),
    });
    if (r.ok) {
      setDraft({ entry_date: "", memo: "", lines: [{ account_id: "", debit: "", credit: "" }, { account_id: "", debit: "", credit: "" }] });
      showToast("Saved", "Journal entry posted");
      void load();
    } else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Debits must equal credits", "notice");
  };

  const setLine = (i: number, patch: Partial<JournalLineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) }));

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.</p>}
      <p className="text-sm font-semibold">Accounting</p>

      <div className="mt-3">
        <StatStrip>
          <StatTile tone="brand" label="Accounts" value={accounts.length} icon="≡" />
          <StatTile tone="info" label="Total debits" value={fmtRM(trialDebit)} icon="◧" />
          <StatTile tone="info" label="Total credits" value={fmtRM(trialCredit)} icon="◨" />
          <StatTile tone={trialDebit === trialCredit ? "success" : "danger"}
            label={trialDebit === trialCredit ? "Balanced" : "OUT OF BALANCE"}
            value={trialDebit === trialCredit ? "✓" : fmtRM(Math.abs(trialDebit - trialCredit))} icon="⚖" />
        </StatStrip>
      </div>

      {/* Journal entry — the server refuses unbalanced entries; the button
          mirrors that rule so nobody types a whole entry to be told no. */}
      <div className="border-border mb-4 rounded-xl border p-3">
        <p className="mb-2 text-xs font-semibold">New journal entry</p>
        <div className={fieldRow}>
          <label><span className={fieldLabel}>Date</span>
            <input type="date" className={inputClass} value={draft.entry_date} onChange={(e) => setDraft((d) => ({ ...d, entry_date: e.target.value }))} /></label>
          <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Memo</span>
            <input className={inputClass} placeholder="August TikTok payout banked" value={draft.memo} onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))} /></label>
        </div>
        {draft.lines.map((l, i) => (
          <div key={i} className={`${fieldRow} mt-2`}>
            <label className="col-span-2 min-w-44 flex-1 sm:col-span-1"><span className={fieldLabel}>Account</span>
              <select className={inputClassSm} value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select></label>
            <label><span className={fieldLabel}>Debit (RM)</span>
              <input type="number" min="0" step="0.01" className={inputClassSm} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })} /></label>
            <label><span className={fieldLabel}>Credit (RM)</span>
              <input type="number" min="0" step="0.01" className={inputClassSm} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })} /></label>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={btnSm} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { account_id: "", debit: "", credit: "" }] }))}>+ Line</button>
          <button type="button" className={btnClass} disabled={!draft.entry_date || !balanced} onClick={() => void post()}>Post entry</button>
          <span className={`text-xs font-medium tabular-nums ${balanced ? "text-success" : "text-muted-foreground"}`}>
            Dr {totalDebit.toFixed(2)} / Cr {totalCredit.toFixed(2)} {balanced ? "— balanced ✓" : "— must match"}
          </span>
        </div>
      </div>

      {/* Trial balance */}
      <p className="mb-2 text-xs font-semibold">Trial balance</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead><tr>
            <th className={th}>Code</th><th className={th}>Account</th><th className={th}>Type</th>
            <th className={thR2}>Debit</th><th className={thR2}>Credit</th>
          </tr></thead>
          <tbody>
            {trial.filter((t) => (t.debit_cents ?? 0) !== 0 || (t.credit_cents ?? 0) !== 0).map((t) => (
              <tr key={t.id} className="border-border border-t">
                <td className={`${td} tabular-nums`}>{t.code}</td>
                <td className={td}>{t.name}</td>
                <td className={td}><span className={chipNeutral}>{t.type}</span></td>
                <td className={tdR2}>{(t.debit_cents ?? 0) > 0 ? fmtRM(t.debit_cents ?? 0) : ""}</td>
                <td className={tdR2}>{(t.credit_cents ?? 0) > 0 ? fmtRM(t.credit_cents ?? 0) : ""}</td>
              </tr>
            ))}
            {trial.every((t) => (t.debit_cents ?? 0) === 0 && (t.credit_cents ?? 0) === 0) && (
              <tr><td colSpan={5} className="text-muted-foreground px-3 py-6 text-center text-sm">No journal entries yet — the {accounts.length}-account chart is seeded and ready.</td></tr>
            )}
          </tbody>
          {trialDebit + trialCredit > 0 && (
            <tfoot><tr className="border-border border-t-2">
              <td className={td} colSpan={3}><b>Total</b></td>
              <td className={tdR2}><b>{fmtRM(trialDebit)}</b></td>
              <td className={tdR2}><b>{fmtRM(trialCredit)}</b></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
