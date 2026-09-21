"use client";

/* v1.18.0 — Finance: Cash Flow (programme phase 5).
 * The DZI reference screens, on the shared primitives: StatStrip tiles up
 * top, DataTable below, a small always-visible entry form. Amounts are typed
 * in RM and sent as decimals; the Worker converts to cents ONCE at the edge.
 *
 * v1.172.0 — Reconciliation, which lived in the second half of this file, is
 * retired: no tab, no panel, no role default, no icon, no strings. The
 * worker's /erp/reconciliation routes and the reconciliations table stay,
 * dormant - nothing calls them, nothing is dropped.
 */

import { useCallback, useEffect, useState } from "react";

import { StatStrip, StatTile } from "@/components/ui/stat-tile";
import { DataTable } from "@/components/ui/data-table";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelTable } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, fieldLabel, fieldRow, inputClass, inputClassSm, rowHead } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** DD-MM-YYYY, the system-wide date format. */
const dmy2 = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso);

const MigrationNote = ({ show }: { show: boolean }) => !show ? null : (
  <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">
    {L("The ERP tables are not migrated yet — run DEPLOY.bat so step 2 applies migration 0071, then reload.", "Jadual ERP belum dimigrasi lagi — jalankan DEPLOY.bat supaya langkah 2 menggunakan migrasi 0071, kemudian muat semula.")}
  </p>
);

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
  /* v1.77.0 — true once the first load settles (ok or not); until then the
     KPI strip and the table are skeletons, never "RM 0.00" and "No entries". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ entries: CashEntry[]; pending_migration?: boolean }>(`/cashflow`);
    setEntries(r.data?.entries ?? []);
    setPending(r.data?.pending_migration === true);
    const b = await api<{ banks: Bank[] }>(`/banks`);
    setBanks(b.data?.banks ?? []);
    setLoaded(true);
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
          say so, so nobody re-types what the system books itself.
          v1.172.0 - Reconciliation is retired; the sentence no longer sends
          anybody to a tab that is not there. Rows it booked in the past keep
          their RECON- ref and still read "auto" below. */}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Synced with Finance automatically: paid expenses, payroll runs and claims book money out; paid invoices book money in — marked", "Disegerakkan dengan Kewangan secara automatik: perbelanjaan dibayar, larian gaji dan tuntutan merekod tunai keluar; invois dibayar merekod tunai masuk — ditanda")} <span className={`${chipNeutral} px-1.5 py-0 text-[10px]`}>auto</span> {L("below. The form is for movements the system cannot see (capital in, transfers, cash top-ups).", "di bawah. Borang ini untuk pergerakan yang sistem tidak dapat lihat (modal masuk, pemindahan, tambah nilai tunai).")}
      </p>

      <div className="mt-3">
        {/* v1.77.0 — skeleton until the first fetch lands: four tiles in the
            same strip, so the figures never read RM 0.00 while loading. */}
        {!loaded ? <SkelTileStrip /> : (
          <StatStrip>
            <StatTile tone="success" label={L("Money in", "Tunai masuk")} value={fmtRM(moneyIn)} icon="↓" />
            <StatTile tone="danger" label={L("Money out", "Tunai keluar")} value={fmtRM(moneyOut)} icon="↑" />
            <StatTile tone="brand" label={L("Balance", "Baki")} value={fmtRM(moneyIn - moneyOut)} icon="◎" />
            <StatTile tone="muted" label={L("Entries", "Catatan")} value={entries.length} hint={L("last 1,000 shown", "1,000 terakhir ditunjukkan")} icon="≡" />
          </StatStrip>
        )}
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

      {/* v1.77.0 — skeleton until the first fetch lands: six columns, like
          the table below. */}
      {!loaded ? <SkelTable rows={5} cols={6} /> : (
      <DataTable
        id="cash-flow"
        rows={entries}
        searchText={(e) => `${e.category} ${e.description} ${e.ref} ${e.bank_name ?? ""}`}
        defaultSort="entry_date"
        /* v1.172.0 - quick filters over the loaded entries (direction, bank),
           and a CSV of exactly the rows on screen. */
        filters={[
          { key: "type", label: L("Direction", "Arah"), options: [{ value: "in", label: L("In", "Masuk") }, { value: "out", label: L("Out", "Keluar") }], test: (e, v) => e.type === v },
          { key: "bank", label: "Bank", options: banks.map((b) => ({ value: String(b.id), label: b.name })), test: (e, v) => String(e.bank_id ?? "") === v },
        ]}
        csvExport={{
          name: "cash-flow",
          headers: [L("Date", "Tarikh"), L("Type", "Jenis"), L("Category", "Kategori"), "Bank", L("Amount (RM)", "Amaun (RM)"), L("Description", "Keterangan"), L("Ref", "Ruj")],
          row: (e) => [e.entry_date, e.type, e.category, e.bank_name ?? "", (e.amount_cents / 100).toFixed(2), e.description, e.ref],
        }}
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
      )}
    </div>
  );
}
