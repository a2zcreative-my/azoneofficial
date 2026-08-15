"use client";

/* v1.18.0 — Finance: Cash Flow + Reconciliation (programme phase 5).
 * The DZI reference screens, on the shared primitives: StatStrip tiles up
 * top, DataTable below, a small always-visible entry form. Amounts are typed
 * in RM and sent as decimals; the Worker converts to cents ONCE at the edge.
 */

import { useCallback, useEffect, useState } from "react";

import { StatStrip, StatTile } from "@/components/ui/stat-tile";
import { DataTable } from "@/components/ui/data-table";
import { useSaveToast } from "@/components/ui/save-toast";
import { makeApi } from "@/lib/api";
import { fmtRM, ym } from "@/lib/format";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, chipWarn, fieldLabel, fieldRow, inputClass, inputClassSm, rowHead } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");

/** DD-MM-YYYY, the system-wide date format. */
const dmy2 = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso);

const MigrationNote = ({ show }: { show: boolean }) => !show ? null : (
  <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">
    The ERP tables are not migrated yet — run DEPLOY.bat so step 2 applies migration 0071, then reload.
  </p>
);

/* ============================ Cash Flow ============================ */

interface Bank { id: number; name: string; bank: string; number_masked: string; active: number }
interface CashEntry {
  id: number; entry_date: string; type: "in" | "out"; category: string;
  bank_id: number | null; bank_name?: string | null; amount_cents: number; description: string; ref: string;
}

export function CashFlowPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showBanks, setShowBanks] = useState(false);
  const [draft, setDraft] = useState({ entry_date: "", type: "out", category: "", bank_id: "", amount: "", description: "", ref: "" });
  const [bankDraft, setBankDraft] = useState({ name: "", bank: "", number_masked: "" });

  const load = useCallback(async () => {
    const r = await api<{ entries: CashEntry[]; pending_migration?: boolean }>(`/cashflow`);
    setEntries(r.data?.entries ?? []);
    setPending(r.data?.pending_migration === true);
    const b = await api<{ banks: Bank[] }>(`/banks`);
    setBanks(b.data?.banks ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const moneyIn = entries.filter((e) => e.type === "in").reduce((a, e) => a + e.amount_cents, 0);
  const moneyOut = entries.filter((e) => e.type === "out").reduce((a, e) => a + e.amount_cents, 0);

  const save = async () => {
    setBusy(true);
    const r = await api(`/cashflow`, {
      method: "POST",
      body: JSON.stringify({
        entry_date: draft.entry_date, type: draft.type, category: draft.category,
        bank_id: draft.bank_id ? Number(draft.bank_id) : undefined,
        amount: draft.amount ? Number(draft.amount) : undefined,
        description: draft.description, ref: draft.ref,
      }),
    });
    setBusy(false);
    if (r.ok) {
      setDraft((d) => ({ ...d, amount: "", description: "", ref: "" }));
      showToast("Saved", "Cash flow entry recorded");
      void load();
    } else {
      showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the fields", "notice");
    }
  };

  const addBank = async () => {
    const r = await api(`/banks`, { method: "POST", body: JSON.stringify(bankDraft) });
    if (r.ok) { setBankDraft({ name: "", bank: "", number_masked: "" }); showToast("Saved", "Bank account added"); void load(); }
    else showToast("No changes", "The account needs a name", "notice");
  };

  /* v1.21.1 (CEO: "I didnt see yet it populate the existing data!"): one
     click books everything Finance already holds — paid expenses, claims,
     payroll runs, paid invoices. Idempotent server-side (dup-check by ref),
     so pressing it twice adds nothing. */
  const [syncBusy, setSyncBusy] = useState(false);
  const syncExisting = async () => {
    setSyncBusy(true);
    const r = await api<{ created?: number }>(`/cashflow/backfill`, { method: "POST", body: JSON.stringify({}) });
    setSyncBusy(false);
    if (r.ok) {
      const n = r.data?.created ?? 0;
      showToast(n > 0 ? "Synced" : "Up to date", n > 0 ? `${n} movement${n === 1 ? "" : "s"} booked from Finance` : "Everything paid is already booked");
      void load();
    } else showToast("No changes", "Sync failed — try again", "notice");
  };

  return (
    <div className={card}>
      {toastNode}
      <MigrationNote show={pending} />
      <div className={rowHead}>
        <p className="text-sm font-semibold">Cash Flow</p>
        <span className="flex flex-wrap gap-2">
          <button type="button" className={btnSm} disabled={syncBusy} onClick={() => void syncExisting()}>
            {syncBusy ? "Syncing…" : "Sync existing Finance data"}
          </button>
          <button type="button" className={btnSm} onClick={() => setShowBanks((v) => !v)}>
            {showBanks ? "Hide banks" : `Manage banks (${banks.length})`}
          </button>
        </span>
      </div>
      {/* v1.21.0 (CEO: "should sync with the data of the Finance… semi
          automation instead of manually logged"): the sync already runs —
          say so, so nobody re-types what the system books itself. */}
      <p className="text-muted-foreground mt-0.5 text-xs">
        Synced with Finance automatically: paid expenses, payroll runs and claims book money out; paid invoices and
        channel settlements (Reconciliation → Pull) book money in — marked <span className={`${chipNeutral} px-1.5 py-0 text-[10px]`}>auto</span> below.
        The form is for movements the system cannot see (capital in, transfers, cash top-ups).
      </p>

      <div className="mt-3">
        <StatStrip>
          <StatTile tone="success" label="Money in" value={fmtRM(moneyIn)} icon="↓" />
          <StatTile tone="danger" label="Money out" value={fmtRM(moneyOut)} icon="↑" />
          <StatTile tone="brand" label="Balance" value={fmtRM(moneyIn - moneyOut)} icon="◎" />
          <StatTile tone="muted" label="Entries" value={entries.length} hint="last 1,000 shown" icon="≡" />
        </StatStrip>
      </div>

      {showBanks && (
        <div className="border-border mb-4 rounded-xl border p-3">
          <p className="mb-2 text-xs font-semibold">Bank accounts</p>
          {banks.map((b) => (
            <p key={b.id} className="border-border flex justify-between border-b py-1.5 text-sm last:border-0">
              <span>{b.name}{b.bank ? ` · ${b.bank}` : ""}</span>
              <span className="text-muted-foreground tabular-nums">{b.number_masked}</span>
            </p>
          ))}
          <div className={`${fieldRow} mt-2`}>
            <label className="min-w-32 flex-1"><span className={fieldLabel}>Account name</span>
              <input className={inputClassSm} value={bankDraft.name} onChange={(e) => setBankDraft((d) => ({ ...d, name: e.target.value }))} /></label>
            <label className="min-w-28"><span className={fieldLabel}>Bank</span>
              <input className={inputClassSm} placeholder="Maybank" value={bankDraft.bank} onChange={(e) => setBankDraft((d) => ({ ...d, bank: e.target.value }))} /></label>
            <label className="min-w-28"><span className={fieldLabel}>Number (masked)</span>
              <input className={inputClassSm} placeholder="•••• 1234" value={bankDraft.number_masked} onChange={(e) => setBankDraft((d) => ({ ...d, number_masked: e.target.value }))} /></label>
            <button type="button" className={btnSm} onClick={() => void addBank()}>Add</button>
          </div>
        </div>
      )}

      {/* New entry — always visible; recording money movement is this tab's job. */}
      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>Date</span>
          <input type="date" className={inputClass} value={draft.entry_date} onChange={(e) => setDraft((d) => ({ ...d, entry_date: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Type</span>
          <select className={inputClass} value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
            <option value="in">Money in</option><option value="out">Money out</option>
          </select></label>
        <label><span className={fieldLabel}>Category</span>
          <input className={inputClass} placeholder="Live sales / Ads / Rent…" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Bank</span>
          <select className={inputClass} value={draft.bank_id} onChange={(e) => setDraft((d) => ({ ...d, bank_id: e.target.value }))}>
            <option value="">—</option>
            {banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
        <label><span className={fieldLabel}>Amount (RM)</span>
          <input type="number" min="0.01" step="0.01" className={inputClass} value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
        <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Description</span>
          <input className={inputClass} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={busy || !draft.entry_date || !draft.amount} onClick={() => void save()}>
          + New entry
        </button>
      </div>

      <DataTable
        rows={entries}
        searchText={(e) => `${e.category} ${e.description} ${e.ref} ${e.bank_name ?? ""}`}
        defaultSort="entry_date"
        columns={[
          { key: "entry_date", label: "Date", render: (e) => <span className="tabular-nums">{dmy2(e.entry_date)}</span> },
          { key: "type", label: "Type", render: (e) => <span className={e.type === "in" ? chipSuccess : chipDanger}>{e.type === "in" ? "In" : "Out"}</span> },
          { key: "category", label: "Category" },
          { key: "bank_name", label: "Bank", render: (e) => e.bank_name ?? "—" },
          { key: "amount_cents", label: "Amount", numeric: true, sortValue: (e) => e.amount_cents, render: (e) => fmtRM(e.amount_cents) },
          { key: "description", label: "Description", render: (e) => (
            <span>
              {e.description}
              {/* v1.21.0: a ref means the system booked this row itself
                  (EXP-/PAYROLL-/CLM-/INV-/RECON-) — mark it so manual and
                  automatic movements read apart at a glance. */}
              {e.ref ? <span className={`${chipNeutral} ml-1.5 px-1.5 py-0 text-[10px]`} title={e.ref}>auto</span> : null}
            </span>
          ) },
        ]}
        empty="No cash flow entries yet — paid expenses, payroll, claims and invoices will appear here automatically."
      />
    </div>
  );
}

/* ============================ Reconciliation ============================ */

interface ReconRow {
  id: number; period: string; channel: string; order_no: string; customer: string;
  est_sales_cents: number; actual_sales_cents: number; actual_cost_cents: number;
  fees_cents: number; shipping_cents: number; status: "pending" | "reconciled" | "disputed";
}
const profitOf = (r: ReconRow) => r.actual_sales_cents - r.actual_cost_cents - r.fees_cents - r.shipping_cents;

export function ReconciliationPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const thisMonth = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  const [draft, setDraft] = useState({ period: thisMonth, channel: "tiktok", order_no: "", customer: "", est_sales: "", actual_sales: "", actual_cost: "", fees: "", shipping: "" });

  const load = useCallback(async () => {
    const r = await api<{ rows: ReconRow[]; pending_migration?: boolean }>(`/reconciliation`);
    setRows(r.data?.rows ?? []);
    setPending(r.data?.pending_migration === true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const est = rows.reduce((a, r) => a + r.est_sales_cents, 0);
  const actual = rows.reduce((a, r) => a + r.actual_sales_cents, 0);
  const reconciled = rows.filter((r) => r.status === "reconciled").length;

  const save = async () => {
    setBusy(true);
    const r = await api(`/reconciliation`, {
      method: "POST",
      body: JSON.stringify({
        period: draft.period, channel: draft.channel, order_no: draft.order_no, customer: draft.customer,
        est_sales: draft.est_sales ? Number(draft.est_sales) : 0,
        actual_sales: draft.actual_sales ? Number(draft.actual_sales) : 0,
        actual_cost: draft.actual_cost ? Number(draft.actual_cost) : 0,
        fees: draft.fees ? Number(draft.fees) : 0,
        shipping: draft.shipping ? Number(draft.shipping) : 0,
      }),
    });
    setBusy(false);
    if (r.ok) { setDraft((d) => ({ ...d, order_no: "", customer: "", est_sales: "", actual_sales: "", actual_cost: "", fees: "", shipping: "" })); showToast("Saved", "Reconciliation row added"); void load(); }
    else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the fields", "notice");
  };

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/reconciliation/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? "Saved" : "No changes", r.ok ? `Marked ${status}` : "Could not update", r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      <MigrationNote show={pending} />
      <div className={rowHead}>
        <p className="text-sm font-semibold">Order Reconciliation</p>
        {/* v1.20.0 C4: prefill from the channel records the system already
            holds — actual sales stop being hand-typed. Idempotent by order
            number; pull twice, add once. */}
        <button type="button" className={btnSm}
          onClick={async () => {
            const r = await api<{ created: number; skipped: number }>(`/reconciliation/pull`, {
              method: "POST", body: JSON.stringify({ period: draft.period }) });
            if (r.ok) {
              showToast(r.data?.created ? "Saved" : "No changes",
                r.data?.created
                  ? `Pulled ${r.data.created} order${r.data.created === 1 ? "" : "s"} from the channel records (${r.data.skipped} already present)`
                  : "Every channel order for this period is already here",
                r.data?.created ? undefined : "notice");
              void load();
            } else showToast("No changes", "Could not pull — check the period", "notice");
          }}>
          Pull {ym(draft.period)} from channels
        </button>
      </div>
      <div className="mt-3">
        <StatStrip>
          <StatTile tone="info" label="Rows" value={rows.length} icon="≡" />
          <StatTile tone="success" label="Reconciled" value={reconciled} icon="✓" />
          <StatTile tone="muted" label="Estimated sales" value={fmtRM(est)} icon="~" />
          <StatTile tone="gold" label="Actual (reconciled)" value={fmtRM(actual)} icon="$" />
        </StatStrip>
      </div>

      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>Period</span>
          <input type="month" className={inputClass} value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Channel</span>
          <select className={inputClass} value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value }))}>
            {["tiktok", "shopee", "lazada", "direct", "stokis"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label><span className={fieldLabel}>Order no</span>
          <input className={inputClass} value={draft.order_no} onChange={(e) => setDraft((d) => ({ ...d, order_no: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Customer</span>
          <input className={inputClass} value={draft.customer} onChange={(e) => setDraft((d) => ({ ...d, customer: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Est. sales</span>
          <input type="number" step="0.01" className={inputClass} value={draft.est_sales} onChange={(e) => setDraft((d) => ({ ...d, est_sales: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Actual sales</span>
          <input type="number" step="0.01" className={inputClass} value={draft.actual_sales} onChange={(e) => setDraft((d) => ({ ...d, actual_sales: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Cost</span>
          <input type="number" step="0.01" className={inputClass} value={draft.actual_cost} onChange={(e) => setDraft((d) => ({ ...d, actual_cost: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Fees</span>
          <input type="number" step="0.01" className={inputClass} value={draft.fees} onChange={(e) => setDraft((d) => ({ ...d, fees: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Shipping</span>
          <input type="number" step="0.01" className={inputClass} value={draft.shipping} onChange={(e) => setDraft((d) => ({ ...d, shipping: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={busy} onClick={() => void save()}>+ Add row</button>
      </div>

      <DataTable
        rows={rows}
        searchText={(r) => `${r.order_no} ${r.customer} ${r.channel} ${r.period}`}
        defaultSort="id"
        columns={[
          { key: "period", label: "Period", render: (r) => <span className="tabular-nums">{ym(r.period)}</span> },
          { key: "channel", label: "Channel", render: (r) => <span className={chipNeutral}>{r.channel}</span> },
          { key: "order_no", label: "Order no" },
          { key: "customer", label: "Customer" },
          { key: "est_sales_cents", label: "Est. sales", numeric: true, sortValue: (r) => r.est_sales_cents, render: (r) => fmtRM(r.est_sales_cents) },
          { key: "actual_sales_cents", label: "Actual", numeric: true, sortValue: (r) => r.actual_sales_cents, render: (r) => fmtRM(r.actual_sales_cents) },
          { key: "fees_cents", label: "Fees", numeric: true, sortValue: (r) => r.fees_cents, render: (r) => fmtRM(r.fees_cents) },
          {
            key: "profit", label: "Profit", numeric: true, sortValue: profitOf,
            render: (r) => <span className={profitOf(r) >= 0 ? "text-success font-semibold" : "text-danger font-semibold"}>{fmtRM(profitOf(r))}</span>,
          },
          {
            key: "status", label: "Status", sortable: false,
            render: (r) => (
              <span className="flex items-center gap-1.5">
                <span className={r.status === "reconciled" ? chipSuccess : r.status === "disputed" ? chipDanger : chipWarn}>{r.status}</span>
                {r.status === "pending" && (
                  <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(r.id, "reconciled")}>✓</button>
                )}
              </span>
            ),
          },
        ]}
        empty="Nothing to reconcile yet — add the first row above."
      />
    </div>
  );
}
