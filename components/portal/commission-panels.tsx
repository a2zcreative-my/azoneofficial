"use client";

/* v1.18.0 — Commission + Ads Fund (programme phase 6).
 * Commission amounts are computed SERVER-SIDE from the rate table — the form
 * here sends host + period + basis and shows what came back; a typo in a
 * form can never overpay a host. Ads Fund claims are budget-checked
 * server-side against the allocation the same way.
 */

import { useCallback, useEffect, useState } from "react";

import { StatStrip, StatTile } from "@/components/ui/stat-tile";
import { DataTable } from "@/components/ui/data-table";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelTable } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { fmtRM, ym } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, chipWarn, fieldLabel, fieldRow, inputClass, rowHead } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
/** BM display names for commission/claim statuses — display only, never compared. */
const statusMs: Record<string, string> = { pending: "menunggu", approved: "diluluskan", paid: "dibayar", rejected: "ditolak" };
const MYT_MONTH = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

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

/* ============================ Commission ============================ */

interface Host { id: number; name: string }
interface Rate { id: number; host_id: number; host_name: string; percent: number; per_hour_cents: number; effective_from: string }
interface CommEntry {
  id: number; host_id: number; host_name: string; period: string;
  basis_cents: number; amount_cents: number; status: "pending" | "approved" | "paid"; note: string;
}

export function CommissionPanel({ canDecide }: { canDecide: boolean }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [entries, setEntries] = useState<CommEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [rateDraft, setRateDraft] = useState({ host_id: "", percent: "", per_hour: "", effective_from: "" });
  const [draft, setDraft] = useState({ host_id: "", period: MYT_MONTH(), basis: "", hours: "", note: "" });
  /* v1.77.0 — true once the first load settles (ok or not); until then the
     KPI strip and the table are skeletons, never "RM 0.00" and "No entries". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const h = await api<{ hosts: Host[] }>(`/hosts`); setHosts(h.data?.hosts ?? []);
    const r = await api<{ rates: Rate[] }>(`/commission/rates`); setRates(r.data?.rates ?? []);
    const e = await api<{ entries: CommEntry[]; pending_migration?: boolean }>(`/commission`);
    setEntries(e.data?.entries ?? []); setPending(e.data?.pending_migration === true);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const month = MYT_MONTH();
  const thisMonth = entries.filter((e) => e.period === month);
  const owed = entries.filter((e) => e.status === "approved").reduce((a, e) => a + e.amount_cents, 0);
  const paid = entries.filter((e) => e.status === "paid").reduce((a, e) => a + e.amount_cents, 0);

  const addRate = async () => {
    const r = await api(`/commission/rates`, {
      method: "POST",
      body: JSON.stringify({
        host_id: rateDraft.host_id ? Number(rateDraft.host_id) : undefined,
        percent: rateDraft.percent ? Number(rateDraft.percent) : undefined,
        per_hour: rateDraft.per_hour ? Number(rateDraft.per_hour) : 0,
        effective_from: rateDraft.effective_from,
      }),
    });
    if (r.ok) { setRateDraft({ host_id: "", percent: "", per_hour: "", effective_from: "" }); showToast(L("Saved", "Disimpan"), L("Commission rate set", "Kadar komisen ditetapkan")); void load(); }
    else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
  };

  const addEntry = async () => {
    const r = await api<{ amount_cents?: number }>(`/commission`, {
      method: "POST",
      body: JSON.stringify({
        host_id: draft.host_id ? Number(draft.host_id) : undefined,
        period: draft.period,
        basis: draft.basis ? Number(draft.basis) : undefined,
        hours: draft.hours ? Number(draft.hours) : 0,
        note: draft.note,
      }),
    });
    if (r.ok) {
      setDraft((d) => ({ ...d, basis: "", hours: "", note: "" }));
      showToast(L("Saved", "Disimpan"), r.data?.amount_cents !== undefined ? L(`Computed ${fmtRM(r.data.amount_cents)} from the rate table`, `${fmtRM(r.data.amount_cents)} dikira dari jadual kadar`) : L("Entry added", "Catatan ditambah"));
      void load();
    } else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
  };

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/commission/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`Marked ${status}`, `Ditanda ${statusMs[status] ?? status}`) : L("Only the CEO tier approves commission", "Hanya peringkat CEO boleh meluluskan komisen"), r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">{L("The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.", "Jadual ERP belum dimigrasi lagi — jalankan DEPLOY.bat (langkah 2 menggunakan 0071), kemudian muat semula.")}</p>}
      <div className={rowHead}>
        <p className="text-sm font-semibold">{L("Commission", "Komisen")}</p>
        <button type="button" className={btnSm} onClick={() => setShowRates((v) => !v)}>{showRates ? L("Hide rates", "Sembunyikan kadar") : L(`Rates (${rates.length})`, `Kadar (${rates.length})`)}</button>
      </div>

      <div className="mt-3">
        {/* v1.77.0 — skeleton until the first fetch lands: four tiles in the
            same strip, so the figures never read RM 0.00 while loading. */}
        {!loaded ? <SkelTileStrip /> : (
          <StatStrip>
            <StatTile tone="info" label={L("Entries · this month", "Catatan · bulan ini")} value={thisMonth.length} icon="≡" />
            <StatTile tone="gold" label={L("This month", "Bulan ini")} value={fmtRM(thisMonth.reduce((a, e) => a + e.amount_cents, 0))} icon="%" />
            <StatTile tone="brand" label={L("Approved, unpaid", "Diluluskan, belum dibayar")} value={fmtRM(owed)} icon="◷" />
            <StatTile tone="success" label={L("Paid out", "Telah dibayar")} value={fmtRM(paid)} icon="✓" />
          </StatStrip>
        )}
      </div>

      {showRates && (
        <div className="border-border mb-4 rounded-xl border p-3">
          <p className="mb-2 text-xs font-semibold">{L("Rates (latest effective wins; only the CEO tier can set)", "Kadar (yang berkuat kuasa terkini digunakan; hanya peringkat CEO boleh tetapkan)")}</p>
          {rates.map((r) => (
            <p key={r.id} className="border-border flex flex-wrap justify-between gap-2 border-b py-1.5 text-sm last:border-0">
              <span>{r.host_name}</span>
              <span className="text-muted-foreground tabular-nums">{r.percent}% {r.per_hour_cents > 0 ? `+ ${fmtRM(r.per_hour_cents)}/h` : ""} · {L("from", "dari")} {r.effective_from}</span>
            </p>
          ))}
          {canDecide && (
            <div className={`${fieldRow} mt-2`}>
              <label><span className={fieldLabel}>{L("Host", "Hos")}</span>
                <select className={inputClass} value={rateDraft.host_id} onChange={(e) => setRateDraft((d) => ({ ...d, host_id: e.target.value }))}>
                  <option value="">—</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select></label>
              <label><span className={fieldLabel}>{L("Percent", "Peratus")}</span>
                <input type="number" min="0" max="50" step="0.1" className={inputClass} value={rateDraft.percent} onChange={(e) => setRateDraft((d) => ({ ...d, percent: e.target.value }))} /></label>
              <label><span className={fieldLabel}>{L("+ RM/hour", "+ RM/jam")}</span>
                <input type="number" min="0" step="0.01" className={inputClass} value={rateDraft.per_hour} onChange={(e) => setRateDraft((d) => ({ ...d, per_hour: e.target.value }))} /></label>
              <label><span className={fieldLabel}>{L("Effective from", "Berkuat kuasa dari")}</span>
                <input type="date" className={inputClass} value={rateDraft.effective_from} onChange={(e) => setRateDraft((d) => ({ ...d, effective_from: e.target.value }))} /></label>
              <button type="button" className={btnSm} onClick={() => void addRate()}>{L("Set rate", "Tetapkan kadar")}</button>
            </div>
          )}
        </div>
      )}

      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>{L("Host", "Hos")}</span>
          <select className={inputClass} value={draft.host_id} onChange={(e) => setDraft((d) => ({ ...d, host_id: e.target.value }))}>
            <option value="">—</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select></label>
        <label><span className={fieldLabel}>{L("Period", "Tempoh")}</span>
          <input type="month" className={inputClass} value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Sales basis (RM)", "Asas jualan (RM)")}</span>
          <input type="number" min="0" step="0.01" className={inputClass} value={draft.basis} onChange={(e) => setDraft((d) => ({ ...d, basis: e.target.value }))} /></label>
        <label><span className={fieldLabel}>{L("Live hours", "Jam live")}</span>
          <input type="number" min="0" step="0.5" className={inputClass} value={draft.hours} onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={!draft.host_id || !draft.basis} onClick={() => void addEntry()}>
          {L("+ Compute entry", "+ Kira catatan")}
        </button>
      </div>
      <p className="text-muted-foreground -mt-2 mb-3 text-[11px]">{L("The amount is computed from the host's rate on the server — the form cannot set it.", "Amaun dikira dari kadar hos di pelayan — borang tidak boleh menetapkannya.")}</p>

      {/* v1.77.0 — skeleton until the first fetch lands: five columns, like
          the table below. */}
      {!loaded ? <SkelTable rows={5} cols={5} /> : (
      <DataTable
        rows={entries}
        searchText={(e) => `${e.host_name} ${e.period} ${e.note}`}
        defaultSort="id"
        columns={[
          { key: "period", label: L("Period", "Tempoh"), render: (e) => <span className="tabular-nums">{ym(e.period)}</span> },
          { key: "host_name", label: L("Host", "Hos") },
          { key: "basis_cents", label: L("Basis", "Asas"), numeric: true, sortValue: (e) => e.basis_cents, render: (e) => fmtRM(e.basis_cents) },
          { key: "amount_cents", label: L("Commission", "Komisen"), numeric: true, sortValue: (e) => e.amount_cents, render: (e) => <b>{fmtRM(e.amount_cents)}</b> },
          {
            key: "status", label: "Status", sortable: false,
            render: (e) => (
              <span className="flex items-center gap-1.5">
                <span className={e.status === "paid" ? chipSuccess : e.status === "approved" ? chipNeutral : chipWarn}>{L(e.status, statusMs[e.status] ?? e.status)}</span>
                {canDecide && e.status === "pending" && (
                  <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(e.id, "approved")}>{L("approve", "luluskan")}</button>
                )}
                {canDecide && e.status === "approved" && (
                  <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(e.id, "paid")}>{L("mark paid", "tanda dibayar")}</button>
                )}
              </span>
            ),
          },
        ]}
        empty={L("No commission entries yet.", "Tiada catatan komisen lagi.")}
      />
      )}
    </div>
  );
}

/* ============================ Ads Fund ============================ */

interface Allocation {
  id: number; period: string; channel: string; amount_cents: number; notes: string;
  approved_cents: number; pending_cents: number;
}
interface Claim {
  id: number; allocation_id: number; amount_cents: number; description: string;
  status: "pending" | "approved" | "rejected"; claimant: string;
}

export function AdsFundPanel({ canManage }: { canManage: boolean }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [pending, setPending] = useState(false);
  const [allocDraft, setAllocDraft] = useState({ period: MYT_MONTH(), channel: "tiktok", amount: "", notes: "" });
  const [claimDraft, setClaimDraft] = useState({ allocation_id: "", amount: "", description: "" });
  /* v1.77.0 — true once the first load settles (ok or not); until then the
     KPI strip and the table are skeletons, never "RM 0.00" and "No spend". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ allocations: Allocation[]; claims: Claim[]; pending_migration?: boolean }>(`/adsfund`);
    setAllocations(r.data?.allocations ?? []);
    setClaims(r.data?.claims ?? []);
    setPending(r.data?.pending_migration === true);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const allocated = allocations.reduce((a, x) => a + x.amount_cents, 0);
  const approved = allocations.reduce((a, x) => a + x.approved_cents, 0);

  const addAllocation = async () => {
    const r = await api(`/adsfund`, {
      method: "POST",
      body: JSON.stringify({ period: allocDraft.period, channel: allocDraft.channel, amount: allocDraft.amount ? Number(allocDraft.amount) : undefined, notes: allocDraft.notes }),
    });
    if (r.ok) { setAllocDraft((d) => ({ ...d, amount: "", notes: "" })); showToast(L("Saved", "Disimpan"), L("Allocation created", "Peruntukan dibuat")); void load(); }
    else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
  };

  /* v1.20.0 C4: spend RECORD, not a claim — managers book spend directly
     (born approved, budget cap enforced server-side). Staff who paid from
     their own pocket use the Claims tab, the one reimbursement workflow. */
  const addSpend = async () => {
    const r = await api(`/adsfund/${claimDraft.allocation_id}/claims`, {
      method: "POST",
      body: JSON.stringify({ amount: claimDraft.amount ? Number(claimDraft.amount) : undefined, description: claimDraft.description }),
    });
    if (r.ok) { setClaimDraft({ allocation_id: "", amount: "", description: "" }); showToast(L("Saved", "Disimpan"), L("Spend recorded against the allocation", "Perbelanjaan direkodkan terhadap peruntukan")); void load(); }
    else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Check the fields", "Semak medan"), "notice");
  };

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">{L("The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.", "Jadual ERP belum dimigrasi lagi — jalankan DEPLOY.bat (langkah 2 menggunakan 0071), kemudian muat semula.")}</p>}
      <p className="text-sm font-semibold">{L("Ads Fund", "Dana Iklan")}</p>

      <div className="mt-3">
        {/* v1.77.0 — skeleton until the first fetch lands. */}
        {!loaded ? <SkelTileStrip /> : (
          <StatStrip>
            <StatTile tone="brand" label={L("Allocated", "Diperuntukkan")} value={fmtRM(allocated)} icon="◎" />
            <StatTile tone="success" label={L("Approved spend", "Perbelanjaan diluluskan")} value={fmtRM(approved)} icon="✓" />
            <StatTile tone="gold" label={L("Remaining", "Baki")} value={fmtRM(allocated - approved)} icon="~" />
            <StatTile tone="muted" label={L("Spend entries", "Catatan perbelanjaan")} value={claims.length} icon="≡" />
          </StatStrip>
        )}
      </div>

      {canManage && (
        <div className={`${fieldRow} mb-3`}>
          <label><span className={fieldLabel}>{L("Period", "Tempoh")}</span>
            <input type="month" className={inputClass} value={allocDraft.period} onChange={(e) => setAllocDraft((d) => ({ ...d, period: e.target.value }))} /></label>
          <label><span className={fieldLabel}>{L("Channel", "Saluran")}</span>
            <select className={inputClass} value={allocDraft.channel} onChange={(e) => setAllocDraft((d) => ({ ...d, channel: e.target.value }))}>
              {["tiktok", "shopee", "lazada", "direct"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label><span className={fieldLabel}>{L("Budget (RM)", "Bajet (RM)")}</span>
            <input type="number" min="0.01" step="0.01" className={inputClass} value={allocDraft.amount} onChange={(e) => setAllocDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
          <button type="button" className={btnClass} disabled={!allocDraft.amount} onClick={() => void addAllocation()}>{L("+ Allocate", "+ Peruntukkan")}</button>
        </div>
      )}

      {canManage && (
      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>{L("Spend against", "Belanja terhadap")}</span>
          <select className={inputClass} value={claimDraft.allocation_id} onChange={(e) => setClaimDraft((d) => ({ ...d, allocation_id: e.target.value }))}>
            <option value="">—</option>
            {allocations.map((a) => (
              <option key={a.id} value={a.id}>{ym(a.period)} · {a.channel} · {fmtRM(a.amount_cents - a.approved_cents - a.pending_cents)} {L("left", "baki")}</option>
            ))}
          </select></label>
        <label><span className={fieldLabel}>{L("Amount (RM)", "Amaun (RM)")}</span>
          <input type="number" min="0.01" step="0.01" className={inputClass} value={claimDraft.amount} onChange={(e) => setClaimDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
        <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>{L("Spent on", "Dibelanjakan untuk")}</span>
          <input className={inputClass} placeholder={L("TikTok ads top-up 12–14 Aug", "Tambah nilai iklan TikTok 12–14 Ogos")} value={claimDraft.description} onChange={(e) => setClaimDraft((d) => ({ ...d, description: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={!claimDraft.allocation_id || !claimDraft.amount || !claimDraft.description} onClick={() => void addSpend()}>
          {L("Record spend", "Rekod perbelanjaan")}
        </button>
      </div>
      )}
      <p className="text-muted-foreground -mt-2 mb-3 text-[11px]">
        {L("Paid for ads out of pocket? Submit it on the", "Bayar iklan dari poket sendiri? Hantarkannya pada tab")} <b>{L("Claims", "Tuntutan")}</b> {L("tab (receipt + approval chain) — this card is the budget book, not a reimbursement queue.", "(resit + rantaian kelulusan) — kad ini ialah buku bajet, bukan barisan bayaran balik.")}
      </p>

      {/* v1.77.0 — skeleton until the first fetch lands: four columns, like
          the table below. */}
      {!loaded ? <SkelTable rows={5} cols={4} /> : (
      <DataTable
        rows={claims}
        searchText={(c) => `${c.claimant} ${c.description}`}
        defaultSort="id"
        columns={[
          { key: "claimant", label: L("By", "Oleh") },
          { key: "description", label: L("Spent on", "Dibelanjakan untuk") },
          { key: "amount_cents", label: L("Amount", "Amaun"), numeric: true, sortValue: (c) => c.amount_cents, render: (c) => fmtRM(c.amount_cents) },
          {
            key: "status", label: "Status", sortable: false,
            // Legacy pending/rejected rows (pre-v1.20.0) still display; new
            // entries are born approved.
            render: (c) => <span className={c.status === "approved" ? chipSuccess : c.status === "rejected" ? chipDanger : chipWarn}>{L(c.status, statusMs[c.status] ?? c.status)}</span>,
          },
        ]}
        empty={L("No spend recorded yet — allocate a budget, then record spend against it.", "Tiada perbelanjaan direkodkan lagi — peruntukkan bajet, kemudian rekod perbelanjaan terhadapnya.")}
      />
      )}
    </div>
  );
}
