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
import { Skel, SkelTable } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, chipWarn, fieldLabel, fieldRow, inputClass, inputClassSm, rowHead, td, tdR2, th, thR2 } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
/** BM display names for PO statuses — display only, never compared. */
const poStatusMs: Record<string, string> = { draft: "draf", sent: "dihantar", received: "diterima", cancelled: "dibatalkan" };
const dmy2 = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—");

/* v1.77.0 — the KPI strip's skeleton: four tiles inside the real StatStrip,
   so the grid geometry is the strip's own and nothing jumps when the numbers
   land. */
function SkelTileStrip() {
  return (
    <StatStrip>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-secondary rounded-xl p-3" aria-hidden>
          <Skel className="h-2.5 w-24" />
          <Skel className="mt-2 h-7 w-28" />
        </div>
      ))}
    </StatStrip>
  );
}

/* ============================ Purchasing ============================ */

interface Supplier { id: number; name: string; contact: string; phone: string; email: string; active: number }
interface StockItem { id: number; sku: string; name: string; stock: number }
interface Po {
  id: number; po_no: string; supplier_id: number; supplier_name: string;
  status: "draft" | "sent" | "received" | "cancelled"; items: string; total_cents: number;
  expected_date: string | null;
}
interface PoItemDraft { title: string; qty: string; unit_price: string; inventory_item_id: string }

export function PurchasingPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [pos, setPos] = useState<Po[]>([]);
  const [pending, setPending] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ name: "", contact: "", phone: "" });
  const [poDraft, setPoDraft] = useState<{ supplier_id: string; expected_date: string; items: PoItemDraft[] }>({
    supplier_id: "", expected_date: "", items: [{ title: "", qty: "", unit_price: "", inventory_item_id: "" }],
  });

  /* v1.77.0 — true once the first load settles (ok or not); until then the
     KPI strip and the table are skeletons, never "0 POs" and "No purchase
     orders yet". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const s = await api<{ suppliers: Supplier[] }>(`/suppliers`); setSuppliers(s.data?.suppliers ?? []);
    const st = await api<{ items: StockItem[] }>(`/stock-items`); setStockItems(st.data?.items ?? []);
    const p = await api<{ pos: Po[]; pending_migration?: boolean }>(`/purchase-orders`);
    setPos(p.data?.pos ?? []); setPending(p.data?.pending_migration === true);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = pos.filter((p) => ["draft", "sent"].includes(p.status));
  /* v1.88.0 — the Open POs tile scopes the table below. */
  const [openOnly, setOpenOnly] = useState(false);
  const openValue = open.reduce((a, p) => a + p.total_cents, 0);

  const addSupplier = async () => {
    const r = await api(`/suppliers`, { method: "POST", body: JSON.stringify(supplierDraft) });
    if (r.ok) { setSupplierDraft({ name: "", contact: "", phone: "" }); showToast(L("Saved", "Disimpan"), L("Supplier added", "Pembekal ditambah")); void load(); }
    else showToast(L("No changes", "Tiada perubahan"), L("The supplier needs a name", "Pembekal perlu ada nama"), "notice");
  };

  const createPo = async () => {
    const items = poDraft.items
      .filter((it) => it.title.trim())
      .map((it) => ({
        title: it.title, qty: it.qty ? Number(it.qty) : undefined,
        unit_price: it.unit_price ? Number(it.unit_price) : undefined,
        // v1.20.0 C4: the link that makes goods receipt move stock.
        inventory_item_id: it.inventory_item_id ? Number(it.inventory_item_id) : undefined,
      }));
    const r = await api<{ po_no?: string }>(`/purchase-orders`, {
      method: "POST",
      body: JSON.stringify({
        supplier_id: poDraft.supplier_id ? Number(poDraft.supplier_id) : undefined,
        expected_date: poDraft.expected_date || undefined,
        items,
      }),
    });
    if (r.ok) {
      setPoDraft({ supplier_id: "", expected_date: "", items: [{ title: "", qty: "", unit_price: "", inventory_item_id: "" }] });
      showToast(L("Saved", "Disimpan"), L(`${r.data?.po_no ?? "PO"} created as draft`, `${r.data?.po_no ?? "PO"} dibuat sebagai draf`));
      void load();
    } else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
  };

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`Marked ${status}`, `Ditanda ${poStatusMs[status] ?? status}`) : L("Could not update", "Tidak dapat kemas kini"), r.ok ? undefined : "notice");
    void load();
  };

  const setItem = (i: number, patch: Partial<PoItemDraft>) =>
    setPoDraft((d) => ({ ...d, items: d.items.map((it, x) => (x === i ? { ...it, ...patch } : it)) }));

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">{L("The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.", "Jadual ERP belum dimigrasi lagi — jalankan DEPLOY.bat (langkah 2 menggunakan 0071), kemudian muat semula.")}</p>}
      <div className={rowHead}>
        <p className="text-sm font-semibold">{L("Purchasing", "Pembelian")}</p>
        <button type="button" className={btnSm} onClick={() => setShowSuppliers((v) => !v)}>{showSuppliers ? L("Hide suppliers", "Sembunyikan pembekal") : L(`Suppliers (${suppliers.length})`, `Pembekal (${suppliers.length})`)}</button>
      </div>

      <div className="mt-3">
        {/* v1.77.0 — skeleton until the first fetch lands: four tiles in the
            same strip, so the figures never read 0 while loading. */}
        {!loaded ? <SkelTileStrip /> : (
          <StatStrip>
            <StatTile tone="info" label={L("Purchase orders", "Pesanan pembelian")} value={pos.length} icon="≡" />
            {/* v1.88.0 — Open POs now narrows the table below to them. */}
            <StatTile tone="brand" label={L("Open POs", "PO terbuka")} value={open.length} icon="◷"
              active={openOnly} onClick={() => setOpenOnly((v) => !v)}
              title={L("Show only the purchase orders still open", "Tunjuk hanya pesanan pembelian yang masih terbuka")} />
            <StatTile tone="gold" label={L("Open value", "Nilai terbuka")} value={fmtRM(openValue)} icon="$" />
            {/* The Suppliers button above already reveals this list; the tile
                was its inert twin, which is the confusing pair. */}
            <StatTile tone="muted" label={L("Suppliers", "Pembekal")} value={suppliers.filter((s) => s.active).length} icon="⌂"
              active={showSuppliers} onClick={() => setShowSuppliers((v) => !v)}
              title={L("Show the supplier list", "Tunjukkan senarai pembekal")} />
          </StatStrip>
        )}
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
            <label className="min-w-32 flex-1"><span className={fieldLabel}>{L("Name", "Nama")}</span>
              <input className={inputClassSm} value={supplierDraft.name} onChange={(e) => setSupplierDraft((d) => ({ ...d, name: e.target.value }))} /></label>
            <label><span className={fieldLabel}>{L("Contact person", "Orang hubungan")}</span>
              <input className={inputClassSm} value={supplierDraft.contact} onChange={(e) => setSupplierDraft((d) => ({ ...d, contact: e.target.value }))} /></label>
            <label><span className={fieldLabel}>{L("Phone", "Telefon")}</span>
              <input className={inputClassSm} value={supplierDraft.phone} onChange={(e) => setSupplierDraft((d) => ({ ...d, phone: e.target.value }))} /></label>
            <button type="button" className={btnSm} onClick={() => void addSupplier()}>{L("Add supplier", "Tambah pembekal")}</button>
          </div>
        </div>
      )}

      {/* New PO */}
      <div className="border-border mb-4 rounded-xl border p-3">
        <p className="mb-2 text-xs font-semibold">{L("New purchase order", "Pesanan pembelian baharu")}</p>
        <div className={fieldRow}>
          <label><span className={fieldLabel}>{L("Supplier", "Pembekal")}</span>
            <select className={inputClass} value={poDraft.supplier_id} onChange={(e) => setPoDraft((d) => ({ ...d, supplier_id: e.target.value }))}>
              <option value="">—</option>
              {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label><span className={fieldLabel}>{L("Expected date", "Tarikh dijangka")}</span>
            <input type="date" className={inputClass} value={poDraft.expected_date} onChange={(e) => setPoDraft((d) => ({ ...d, expected_date: e.target.value }))} /></label>
        </div>
        {poDraft.items.map((it, i) => (
          <div key={i} className={`${fieldRow} mt-2`}>
            <label><span className={fieldLabel}>{L("Stock item", "Item stok")}</span>
              {/* v1.20.0 C4: pick a stock item and receiving this PO will
                  add its qty to the shelves — leave on "— not stock —" for
                  services/one-offs, which never touch inventory. */}
              <select className={inputClassSm} value={it.inventory_item_id}
                onChange={(e) => {
                  const si = stockItems.find((x) => String(x.id) === e.target.value);
                  setItem(i, { inventory_item_id: e.target.value, ...(si && !it.title ? { title: si.name } : {}) });
                }}>
                <option value="">{L("— not stock —", "— bukan stok —")}</option>
                {stockItems.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.sku})</option>)}
              </select></label>
            <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Item</span>
              <input className={inputClassSm} value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} /></label>
            <label><span className={fieldLabel}>{L("Qty", "Kuantiti")}</span>
              <input type="number" min="1" className={inputClassSm} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></label>
            <label><span className={fieldLabel}>Unit (RM)</span>
              <input type="number" min="0.01" step="0.01" className={inputClassSm} value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })} /></label>
          </div>
        ))}
        <div className="mt-2 flex gap-2">
          <button type="button" className={btnSm} onClick={() => setPoDraft((d) => ({ ...d, items: [...d.items, { title: "", qty: "", unit_price: "", inventory_item_id: "" }] }))}>+ Item</button>
          <button type="button" className={btnClass} disabled={!poDraft.supplier_id || !poDraft.items.some((it) => it.title.trim())} onClick={() => void createPo()}>
            {L("Create PO", "Buat PO")}
          </button>
        </div>
      </div>

      {/* v1.77.0 — skeleton until the first fetch lands: five columns, like
          the table below. */}
      {!loaded ? <SkelTable rows={5} cols={5} /> : (
      <DataTable
        rows={openOnly ? open : pos}
        searchText={(p) => `${p.po_no} ${p.supplier_name}`}
        defaultSort="id"
        columns={[
          { key: "po_no", label: L("PO no", "No PO"), render: (p) => <b className="tabular-nums">{p.po_no}</b> },
          { key: "supplier_name", label: L("Supplier", "Pembekal") },
          { key: "expected_date", label: L("Expected", "Dijangka"), render: (p) => <span className="tabular-nums">{dmy2(p.expected_date)}</span> },
          { key: "total_cents", label: L("Total", "Jumlah"), numeric: true, sortValue: (p) => p.total_cents, render: (p) => fmtRM(p.total_cents) },
          {
            key: "status", label: "Status", sortable: false,
            render: (p) => (
              <span className="flex items-center gap-1.5">
                <span className={p.status === "received" ? chipSuccess : p.status === "cancelled" ? chipDanger : p.status === "sent" ? chipNeutral : chipWarn}>{L(p.status, poStatusMs[p.status] ?? p.status)}</span>
                {p.status === "draft" && <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(p.id, "sent")}>{L("send", "hantar")}</button>}
                {p.status === "sent" && <button type="button" className="text-success text-[11px] font-semibold" title={L("Adds linked items to stock", "Menambah item berpaut ke stok")}
                  onClick={() => void setStatus(p.id, "received")}>{L("received → stock", "diterima → stok")}</button>}
              </span>
            ),
          },
        ]}
        empty={L("No purchase orders yet.", "Tiada pesanan pembelian lagi.")}
      />
      )}
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

  /* v1.77.0 — true once the first load settles (ok or not); until then the
     KPI strip and the trial balance are skeletons, never "0 accounts" and
     "No journal entries yet". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const a = await api<{ accounts: GlAccount[]; pending_migration?: boolean }>(`/gl/accounts`);
    setAccounts(a.data?.accounts ?? []);
    setPending(a.data?.pending_migration === true);
    const t = await api<{ accounts: GlAccount[] }>(`/gl/trial-balance`);
    setTrial(t.data?.accounts ?? []);
    setLoaded(true);
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
      showToast(L("Saved", "Disimpan"), L("Journal entry posted", "Catatan jurnal diposkan"));
      void load();
    } else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Debits must equal credits", "Debit mesti sama dengan kredit"), "notice");
  };

  const setLine = (i: number, patch: Partial<JournalLineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) }));

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">{L("The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.", "Jadual ERP belum dimigrasi lagi — jalankan DEPLOY.bat (langkah 2 menggunakan 0071), kemudian muat semula.")}</p>}
      <p className="text-sm font-semibold">{L("Accounting", "Perakaunan")}</p>

      <div className="mt-3">
        {/* v1.77.0 — skeleton until the first fetch lands. */}
        {!loaded ? <SkelTileStrip /> : (
          <StatStrip>
            <StatTile tone="brand" label={L("Accounts", "Akaun")} value={accounts.length} icon="≡" />
            <StatTile tone="info" label={L("Total debits", "Jumlah debit")} value={fmtRM(trialDebit)} icon="◧" />
            <StatTile tone="info" label={L("Total credits", "Jumlah kredit")} value={fmtRM(trialCredit)} icon="◨" />
            <StatTile tone={trialDebit === trialCredit ? "success" : "danger"}
              label={trialDebit === trialCredit ? L("Balanced", "Seimbang") : L("OUT OF BALANCE", "TIDAK SEIMBANG")}
              value={trialDebit === trialCredit ? "✓" : fmtRM(Math.abs(trialDebit - trialCredit))} icon="⚖" />
          </StatStrip>
        )}
      </div>

      <p className="text-muted-foreground mb-3 text-[11.5px]">
        {L("Bank movements post here automatically (paid expenses, payroll runs, claim payouts, Finance-tab entries) — this composer is for adjustments only.", "Pergerakan bank diposkan di sini secara automatik (perbelanjaan dibayar, larian gaji, bayaran tuntutan, catatan tab Kewangan) — borang ini untuk pelarasan sahaja.")}
      </p>
      {/* Journal entry — the server refuses unbalanced entries; the button
          mirrors that rule so nobody types a whole entry to be told no. */}
      <div className="border-border mb-4 rounded-xl border p-3">
        <p className="mb-2 text-xs font-semibold">{L("New journal entry", "Catatan jurnal baharu")}</p>
        <div className={fieldRow}>
          <label><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
            <input type="date" className={inputClass} value={draft.entry_date} onChange={(e) => setDraft((d) => ({ ...d, entry_date: e.target.value }))} /></label>
          <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Memo</span>
            <input className={inputClass} placeholder={L("August TikTok payout banked", "Bayaran TikTok Ogos dibankkan")} value={draft.memo} onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))} /></label>
        </div>
        {draft.lines.map((l, i) => (
          <div key={i} className={`${fieldRow} mt-2`}>
            <label className="col-span-2 min-w-44 flex-1 sm:col-span-1"><span className={fieldLabel}>{L("Account", "Akaun")}</span>
              <select className={inputClassSm} value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select></label>
            <label><span className={fieldLabel}>Debit (RM)</span>
              <input type="number" min="0" step="0.01" className={inputClassSm} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })} /></label>
            <label><span className={fieldLabel}>{L("Credit (RM)", "Kredit (RM)")}</span>
              <input type="number" min="0" step="0.01" className={inputClassSm} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })} /></label>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={btnSm} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { account_id: "", debit: "", credit: "" }] }))}>{L("+ Line", "+ Baris")}</button>
          <button type="button" className={btnClass} disabled={!draft.entry_date || !balanced} onClick={() => void post()}>{L("Post entry", "Pos catatan")}</button>
          <span className={`text-xs font-medium tabular-nums ${balanced ? "text-success" : "text-muted-foreground"}`}>
            Dr {totalDebit.toFixed(2)} / Cr {totalCredit.toFixed(2)} {balanced ? L("— balanced ✓", "— seimbang ✓") : L("— must match", "— mesti sepadan")}
          </span>
        </div>
      </div>

      {/* Trial balance */}
      <p className="mb-2 text-xs font-semibold">{L("Trial balance", "Imbangan duga")}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead><tr>
            <th className={th}>{L("Code", "Kod")}</th><th className={th}>{L("Account", "Akaun")}</th><th className={th}>{L("Type", "Jenis")}</th>
            <th className={thR2}>Debit</th><th className={thR2}>{L("Credit", "Kredit")}</th>
          </tr></thead>
          <tbody>
            {/* v1.77.0 — skeleton until the first fetch lands: shimmering
                cells under the real header, same five columns. */}
            {!loaded && Array.from({ length: 5 }, (_, i) => (
              <tr key={`skel-${i}`} className="border-border border-t" aria-hidden>
                <td className={td}><Skel className="h-4 w-10" /></td>
                <td className={td}><Skel className="h-4 w-36" /></td>
                <td className={td}><Skel className="h-5 w-16 rounded-full" /></td>
                <td className={tdR2}><Skel className="ml-auto h-4 w-20" /></td>
                <td className={tdR2}><Skel className="ml-auto h-4 w-20" /></td>
              </tr>
            ))}
            {loaded && trial.filter((t) => (t.debit_cents ?? 0) !== 0 || (t.credit_cents ?? 0) !== 0).map((t) => (
              <tr key={t.id} className="border-border border-t">
                <td className={`${td} tabular-nums`}>{t.code}</td>
                <td className={td}>{t.name}</td>
                <td className={td}><span className={chipNeutral}>{t.type}</span></td>
                <td className={tdR2}>{(t.debit_cents ?? 0) > 0 ? fmtRM(t.debit_cents ?? 0) : ""}</td>
                <td className={tdR2}>{(t.credit_cents ?? 0) > 0 ? fmtRM(t.credit_cents ?? 0) : ""}</td>
              </tr>
            ))}
            {loaded && trial.every((t) => (t.debit_cents ?? 0) === 0 && (t.credit_cents ?? 0) === 0) && (
              <tr><td colSpan={5} className="text-muted-foreground px-3 py-6 text-center text-sm">{L(`No journal entries yet — the ${accounts.length}-account chart is seeded and ready.`, `Tiada catatan jurnal lagi — carta ${accounts.length} akaun sudah dibenih dan sedia.`)}</td></tr>
            )}
          </tbody>
          {trialDebit + trialCredit > 0 && (
            <tfoot><tr className="border-border border-t-2">
              <td className={td} colSpan={3}><b>{L("Total", "Jumlah")}</b></td>
              <td className={tdR2}><b>{fmtRM(trialDebit)}</b></td>
              <td className={tdR2}><b>{fmtRM(trialCredit)}</b></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
