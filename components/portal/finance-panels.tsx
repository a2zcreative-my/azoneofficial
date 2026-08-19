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
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, chipWarn, fieldLabel, fieldRow, inputClass, inputClassSm, rowHead } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
/** BM display names for reconciliation statuses — display only, never compared. */
const reconStatusMs: Record<string, string> = { pending: "menunggu", reconciled: "diselaraskan", disputed: "dipertikaikan" };

/** DD-MM-YYYY, the system-wide date format. */
const dmy2 = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso);

const MigrationNote = ({ show }: { show: boolean }) => !show ? null : (
  <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">
    {L("The ERP tables are not migrated yet — run DEPLOY.bat so step 2 applies migration 0071, then reload.", "Jadual ERP belum dimigrasi lagi — jalankan DEPLOY.bat supaya langkah 2 menggunakan migrasi 0071, kemudian muat semula.")}
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
      showToast(L("Saved", "Disimpan"), L("Cash flow entry recorded", "Catatan aliran tunai direkodkan"));
      void load();
    } else {
      showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
    }
  };

  const addBank = async () => {
    const r = await api(`/banks`, { method: "POST", body: JSON.stringify(bankDraft) });
    if (r.ok) { setBankDraft({ name: "", bank: "", number_masked: "" }); showToast(L("Saved", "Disimpan"), L("Bank account added", "Akaun bank ditambah")); void load(); }
    else showToast(L("No changes", "Tiada perubahan"), L("The account needs a name", "Akaun perlu ada nama"), "notice");
  };

  /* v1.21.1 (CEO: "I didnt see yet it populate the existing data!"): one
     click books everything Finance already holds — paid expenses, claims,
     payroll runs, paid invoices. Idempotent server-side (dup-check by ref),
     so pressing it twice adds nothing. */
  const [syncBusy, setSyncBusy] = useState(false);
  const syncExisting = async () => {
    setSyncBusy(true);
    const r = await api<{ created?: number; error?: { message?: string } }>(`/cashflow/backfill`, { method: "POST", body: JSON.stringify({}) });
    setSyncBusy(false);
    if (r.ok) {
      const n = r.data?.created ?? 0;
      showToast(n > 0 ? L("Synced", "Disegerakkan") : L("Up to date", "Terkini"), n > 0 ? L(`${n} movement${n === 1 ? "" : "s"} booked from Finance`, `${n} pergerakan direkodkan dari Kewangan`) : L("Everything paid is already booked", "Semua yang dibayar sudah direkodkan"));
      void load();
      return;
    }
    /* v1.21.3 (live showed a bare "Sync failed"): say WHY. A 404 means the
       API worker is still the previous build — the button shipped in the
       site before the worker was redeployed. */
    const why =
      r.status === 404 ? L("API worker is an older build — run DEPLOY.bat fully (step 3 deploys the worker), then retry.", "Worker API adalah binaan lama — jalankan DEPLOY.bat sepenuhnya (langkah 3 melancarkan worker), kemudian cuba lagi.")
      : r.status === 403 ? L("Your role has no cash-flow access.", "Peranan anda tiada akses aliran tunai.")
      : (r.data?.error?.message ?? L(`Sync failed (HTTP ${r.status || "network"}) — try again.`, `Segerakan gagal (HTTP ${r.status || "network"}) — cuba lagi.`));
    showToast(L("Sync failed", "Segerakan gagal"), why, "notice");
  };

  return (
    <div className={card}>
      {toastNode}
      <MigrationNote show={pending} />
      <div className={rowHead}>
        <p className="text-sm font-semibold">{L("Cash Flow", "Aliran Tunai")}</p>
        <span className="flex flex-wrap gap-2">
          <button type="button" className={btnSm} disabled={syncBusy} onClick={() => void syncExisting()}>
            {syncBusy ? L("Syncing…", "Menyegerak…") : L("Sync existing Finance data", "Segerakkan data Kewangan sedia ada")}
          </button>
          <button type="button" className={btnSm} onClick={() => setShowBanks((v) => !v)}>
            {showBanks ? L("Hide banks", "Sembunyikan bank") : L(`Manage banks (${banks.length})`, `Urus bank (${banks.length})`)}
          </button>
        </span>
      </div>
      {/* v1.21.0 (CEO: "should sync with the data of the Finance… semi
          automation instead of manually logged"): the sync already runs —
          say so, so nobody re-types what the system books itself. */}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Synced with Finance automatically: paid expenses, payroll runs and claims book money out; paid invoices and channel settlements (Reconciliation → Pull) book money in — marked", "Disegerakkan dengan Kewangan secara automatik: perbelanjaan dibayar, larian gaji dan tuntutan merekod tunai keluar; invois dibayar dan penyelesaian saluran (Penyelarasan → Tarik) merekod tunai masuk — ditanda")} <span className={`${chipNeutral} px-1.5 py-0 text-[10px]`}>auto</span> {L("below. The form is for movements the system cannot see (capital in, transfers, cash top-ups).", "di bawah. Borang ini untuk pergerakan yang sistem tidak dapat lihat (modal masuk, pemindahan, tambah nilai tunai).")}
      </p>

      <div className="mt-3">
        <StatStrip>
          <StatTile tone="success" label={L("Money in", "Tunai masuk")} value={fmtRM(moneyIn)} icon="↓" />
          <StatTile tone="danger" label={L("Money out", "Tunai keluar")} value={fmtRM(moneyOut)} icon="↑" />
          <StatTile tone="brand" label={L("Balance", "Baki")} value={fmtRM(moneyIn - moneyOut)} icon="◎" />
          <StatTile tone="muted" label={L("Entries", "Catatan")} value={entries.length} hint={L("last 1,000 shown", "1,000 terakhir ditunjukkan")} icon="≡" />
        </StatStrip>
      </div>

      {showBanks && (
        <div className="border-border mb-4 rounded-xl border p-3">
          <p className="mb-2 text-xs font-semibold">{L("Bank accounts", "Akaun bank")}</p>
          {banks.map((b) => (
            <p key={b.id} className="border-border flex justify-between border-b py-1.5 text-sm last:border-0">
              <span>{b.name}{b.bank ? ` · ${b.bank}` : ""}</span>
              <span className="text-muted-foreground tabular-nums">{b.number_masked}</span>
            </p>
          ))}
          <div className={`${fieldRow} mt-2`}>
            <label className="min-w-32 flex-1"><span className={fieldLabel}>{L("Account name", "Nama akaun")}</span>
              <input className={inputClassSm} value={bankDraft.name} onChange={(e) => setBankDraft((d) => ({ ...d, name: e.target.value }))} /></label>
            <label className="min-w-28"><span className={fieldLabel}>Bank</span>
              <input className={inputClassSm} placeholder="Maybank" value={bankDraft.bank} onChange={(e) => setBankDraft((d) => ({ ...d, bank: e.target.value }))} /></label>
            <label className="min-w-28"><span className={fieldLabel}>{L("Number (masked)", "Nombor (bertopeng)")}</span>
              <input className={inputClassSm} placeholder="•••• 1234" value={bankDraft.number_masked} onChange={(e) => setBankDraft((d) => ({ ...d, number_masked: e.target.value }))} /></label>
            <button type="button" className={btnSm} onClick={() => void addBank()}>{L("Add", "Tambah")}</button>
          </div>
        </div>
      )}

      {/* New entry — always visible; recording money movement is this tab's job. */}
      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
          <input type="date" className={inputClass} value={draft.entry_date} onChange={(e) => setDraft((d) => ({ ...d, entry_date: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Type", "Jenis")}</span>
          <select className={inputClass} value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
            <option value="in">{L("Money in", "Tunai masuk")}</option><option value="out">{L("Money out", "Tunai keluar")}</option>
          </select></label>
        <label><span className={fieldLabel}>{L("Category", "Kategori")}</span>
          <input className={inputClass} placeholder={L("Live sales / Ads / Rent…", "Jualan live / Iklan / Sewa…")} value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Bank</span>
          <select className={inputClass} value={draft.bank_id} onChange={(e) => setDraft((d) => ({ ...d, bank_id: e.target.value }))}>
            <option value="">—</option>
            {banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
        <label><span className={fieldLabel}>{L("Amount (RM)", "Amaun (RM)")}</span>
          <input type="number" min="0.01" step="0.01" className={inputClass} value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
        <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>{L("Description", "Keterangan")}</span>
          <input className={inputClass} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={busy || !draft.entry_date || !draft.amount} onClick={() => void save()}>
          {L("+ New entry", "+ Catatan baharu")}
        </button>
      </div>

      <DataTable
        rows={entries}
        searchText={(e) => `${e.category} ${e.description} ${e.ref} ${e.bank_name ?? ""}`}
        defaultSort="entry_date"
        columns={[
          { key: "entry_date", label: L("Date", "Tarikh"), render: (e) => <span className="tabular-nums">{dmy2(e.entry_date)}</span> },
          { key: "type", label: L("Type", "Jenis"), render: (e) => <span className={e.type === "in" ? chipSuccess : chipDanger}>{e.type === "in" ? L("In", "Masuk") : L("Out", "Keluar")}</span> },
          { key: "category", label: L("Category", "Kategori") },
          { key: "bank_name", label: "Bank", render: (e) => e.bank_name ?? "—" },
          { key: "amount_cents", label: L("Amount", "Amaun"), numeric: true, sortValue: (e) => e.amount_cents, render: (e) => fmtRM(e.amount_cents) },
          { key: "description", label: L("Description", "Keterangan"), render: (e) => (
            <span>
              {e.description}
              {/* v1.21.0: a ref means the system booked this row itself
                  (EXP-/PAYROLL-/CLM-/INV-/RECON-) — mark it so manual and
                  automatic movements read apart at a glance. */}
              {e.ref ? <span className={`${chipNeutral} ml-1.5 px-1.5 py-0 text-[10px]`} title={e.ref}>auto</span> : null}
            </span>
          ) },
        ]}
        empty={L("No cash flow entries yet — paid expenses, payroll, claims and invoices will appear here automatically.", "Tiada catatan aliran tunai lagi — perbelanjaan dibayar, gaji, tuntutan dan invois akan muncul di sini secara automatik.")}
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
    if (r.ok) { setDraft((d) => ({ ...d, order_no: "", customer: "", est_sales: "", actual_sales: "", actual_cost: "", fees: "", shipping: "" })); showToast(L("Saved", "Disimpan"), L("Reconciliation row added", "Baris penyelarasan ditambah")); void load(); }
    else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
  };

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/reconciliation/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`Marked ${status}`, `Ditanda ${reconStatusMs[status] ?? status}`) : L("Could not update", "Tidak dapat kemas kini"), r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      <MigrationNote show={pending} />
      <div className={rowHead}>
        <p className="text-sm font-semibold">{L("Order Reconciliation", "Penyelarasan Pesanan")}</p>
        {/* v1.20.0 C4: prefill from the channel records the system already
            holds — actual sales stop being hand-typed. Idempotent by order
            number; pull twice, add once. */}
        <button type="button" className={btnSm}
          onClick={async () => {
            const r = await api<{ created: number; skipped: number }>(`/reconciliation/pull`, {
              method: "POST", body: JSON.stringify({ period: draft.period }) });
            if (r.ok) {
              showToast(r.data?.created ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
                r.data?.created
                  ? L(`Pulled ${r.data.created} order${r.data.created === 1 ? "" : "s"} from the channel records (${r.data.skipped} already present)`, `${r.data.created} pesanan ditarik dari rekod saluran (${r.data.skipped} sudah ada)`)
                  : L("Every channel order for this period is already here", "Semua pesanan saluran untuk tempoh ini sudah ada di sini"),
                r.data?.created ? undefined : "notice");
              void load();
            } else showToast(L("No changes", "Tiada perubahan"), L("Could not pull — check the period", "Tidak dapat tarik — semak tempoh"), "notice");
          }}>
          {L("Pull", "Tarik")} {ym(draft.period)} {L("from channels", "dari saluran")}
        </button>
      </div>
      <div className="mt-3">
        <StatStrip>
          <StatTile tone="info" label={L("Rows", "Baris")} value={rows.length} icon="≡" />
          <StatTile tone="success" label={L("Reconciled", "Diselaraskan")} value={reconciled} icon="✓" />
          <StatTile tone="muted" label={L("Estimated sales", "Anggaran jualan")} value={fmtRM(est)} icon="~" />
          <StatTile tone="gold" label={L("Actual (reconciled)", "Sebenar (diselaraskan)")} value={fmtRM(actual)} icon="$" />
        </StatStrip>
      </div>

      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>{L("Period", "Tempoh")}</span>
          <input type="month" className={inputClass} value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Channel", "Saluran")}</span>
          <select className={inputClass} value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value }))}>
            {["tiktok", "shopee", "lazada", "direct", "stokis"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label><span className={fieldLabel}>{L("Order no", "No pesanan")}</span>
          <input className={inputClass} value={draft.order_no} onChange={(e) => setDraft((d) => ({ ...d, order_no: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Customer", "Pelanggan")}</span>
          <input className={inputClass} value={draft.customer} onChange={(e) => setDraft((d) => ({ ...d, customer: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Est. sales", "Angg. jualan")}</span>
          <input type="number" step="0.01" className={inputClass} value={draft.est_sales} onChange={(e) => setDraft((d) => ({ ...d, est_sales: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Actual sales", "Jualan sebenar")}</span>
          <input type="number" step="0.01" className={inputClass} value={draft.actual_sales} onChange={(e) => setDraft((d) => ({ ...d, actual_sales: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Cost", "Kos")}</span>
          <input type="number" step="0.01" className={inputClass} value={draft.actual_cost} onChange={(e) => setDraft((d) => ({ ...d, actual_cost: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Fees", "Fi")}</span>
          <input type="number" step="0.01" className={inputClass} value={draft.fees} onChange={(e) => setDraft((d) => ({ ...d, fees: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Shipping", "Penghantaran")}</span>
          <input type="number" step="0.01" className={inputClass} value={draft.shipping} onChange={(e) => setDraft((d) => ({ ...d, shipping: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={busy} onClick={() => void save()}>{L("+ Add row", "+ Tambah baris")}</button>
      </div>

      <DataTable
        rows={rows}
        searchText={(r) => `${r.order_no} ${r.customer} ${r.channel} ${r.period}`}
        defaultSort="id"
        columns={[
          { key: "period", label: L("Period", "Tempoh"), render: (r) => <span className="tabular-nums">{ym(r.period)}</span> },
          { key: "channel", label: L("Channel", "Saluran"), render: (r) => <span className={chipNeutral}>{r.channel}</span> },
          { key: "order_no", label: L("Order no", "No pesanan") },
          { key: "customer", label: L("Customer", "Pelanggan") },
          { key: "est_sales_cents", label: L("Est. sales", "Angg. jualan"), numeric: true, sortValue: (r) => r.est_sales_cents, render: (r) => fmtRM(r.est_sales_cents) },
          { key: "actual_sales_cents", label: L("Actual", "Sebenar"), numeric: true, sortValue: (r) => r.actual_sales_cents, render: (r) => fmtRM(r.actual_sales_cents) },
          { key: "fees_cents", label: L("Fees", "Fi"), numeric: true, sortValue: (r) => r.fees_cents, render: (r) => fmtRM(r.fees_cents) },
          {
            key: "profit", label: L("Profit", "Untung"), numeric: true, sortValue: profitOf,
            render: (r) => <span className={profitOf(r) >= 0 ? "text-success font-semibold" : "text-danger font-semibold"}>{fmtRM(profitOf(r))}</span>,
          },
          {
            key: "status", label: "Status", sortable: false,
            render: (r) => (
              <span className="flex items-center gap-1.5">
                <span className={r.status === "reconciled" ? chipSuccess : r.status === "disputed" ? chipDanger : chipWarn}>{L(r.status, reconStatusMs[r.status] ?? r.status)}</span>
                {r.status === "pending" && (
                  <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(r.id, "reconciled")}>✓</button>
                )}
              </span>
            ),
          },
        ]}
        empty={L("Nothing to reconcile yet — add the first row above.", "Tiada apa untuk diselaraskan lagi — tambah baris pertama di atas.")}
      />
    </div>
  );
}
