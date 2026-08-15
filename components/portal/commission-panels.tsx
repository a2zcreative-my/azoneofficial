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
import { makeApi } from "@/lib/api";
import { fmtRM, ym } from "@/lib/format";
import { btnClass, btnSm, card, chipDanger, chipNeutral, chipSuccess, chipWarn, fieldLabel, fieldRow, inputClass, rowHead } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");
const MYT_MONTH = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

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

  const load = useCallback(async () => {
    const h = await api<{ hosts: Host[] }>(`/hosts`); setHosts(h.data?.hosts ?? []);
    const r = await api<{ rates: Rate[] }>(`/commission/rates`); setRates(r.data?.rates ?? []);
    const e = await api<{ entries: CommEntry[]; pending_migration?: boolean }>(`/commission`);
    setEntries(e.data?.entries ?? []); setPending(e.data?.pending_migration === true);
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
    if (r.ok) { setRateDraft({ host_id: "", percent: "", per_hour: "", effective_from: "" }); showToast("Saved", "Commission rate set"); void load(); }
    else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the fields", "notice");
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
      showToast("Saved", r.data?.amount_cents !== undefined ? `Computed ${fmtRM(r.data.amount_cents)} from the rate table` : "Entry added");
      void load();
    } else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the fields", "notice");
  };

  const setStatus = async (id: number, status: string) => {
    const r = await api(`/commission/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? "Saved" : "No changes", r.ok ? `Marked ${status}` : "Only the CEO tier approves commission", r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.</p>}
      <div className={rowHead}>
        <p className="text-sm font-semibold">Commission</p>
        <button type="button" className={btnSm} onClick={() => setShowRates((v) => !v)}>{showRates ? "Hide rates" : `Rates (${rates.length})`}</button>
      </div>

      <div className="mt-3">
        <StatStrip>
          <StatTile tone="info" label="Entries · this month" value={thisMonth.length} icon="≡" />
          <StatTile tone="gold" label="This month" value={fmtRM(thisMonth.reduce((a, e) => a + e.amount_cents, 0))} icon="%" />
          <StatTile tone="brand" label="Approved, unpaid" value={fmtRM(owed)} icon="◷" />
          <StatTile tone="success" label="Paid out" value={fmtRM(paid)} icon="✓" />
        </StatStrip>
      </div>

      {showRates && (
        <div className="border-border mb-4 rounded-xl border p-3">
          <p className="mb-2 text-xs font-semibold">Rates (latest effective wins; only the CEO tier can set)</p>
          {rates.map((r) => (
            <p key={r.id} className="border-border flex flex-wrap justify-between gap-2 border-b py-1.5 text-sm last:border-0">
              <span>{r.host_name}</span>
              <span className="text-muted-foreground tabular-nums">{r.percent}% {r.per_hour_cents > 0 ? `+ ${fmtRM(r.per_hour_cents)}/h` : ""} · from {r.effective_from}</span>
            </p>
          ))}
          {canDecide && (
            <div className={`${fieldRow} mt-2`}>
              <label><span className={fieldLabel}>Host</span>
                <select className={inputClass} value={rateDraft.host_id} onChange={(e) => setRateDraft((d) => ({ ...d, host_id: e.target.value }))}>
                  <option value="">—</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select></label>
              <label><span className={fieldLabel}>Percent</span>
                <input type="number" min="0" max="50" step="0.1" className={inputClass} value={rateDraft.percent} onChange={(e) => setRateDraft((d) => ({ ...d, percent: e.target.value }))} /></label>
              <label><span className={fieldLabel}>+ RM/hour</span>
                <input type="number" min="0" step="0.01" className={inputClass} value={rateDraft.per_hour} onChange={(e) => setRateDraft((d) => ({ ...d, per_hour: e.target.value }))} /></label>
              <label><span className={fieldLabel}>Effective from</span>
                <input type="date" className={inputClass} value={rateDraft.effective_from} onChange={(e) => setRateDraft((d) => ({ ...d, effective_from: e.target.value }))} /></label>
              <button type="button" className={btnSm} onClick={() => void addRate()}>Set rate</button>
            </div>
          )}
        </div>
      )}

      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>Host</span>
          <select className={inputClass} value={draft.host_id} onChange={(e) => setDraft((d) => ({ ...d, host_id: e.target.value }))}>
            <option value="">—</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select></label>
        <label><span className={fieldLabel}>Period</span>
          <input type="month" className={inputClass} value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Sales basis (RM)</span>
          <input type="number" min="0" step="0.01" className={inputClass} value={draft.basis} onChange={(e) => setDraft((d) => ({ ...d, basis: e.target.value }))} /></label>
        <label><span className={fieldLabel}>Live hours</span>
          <input type="number" min="0" step="0.5" className={inputClass} value={draft.hours} onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={!draft.host_id || !draft.basis} onClick={() => void addEntry()}>
          + Compute entry
        </button>
      </div>
      <p className="text-muted-foreground -mt-2 mb-3 text-[11px]">The amount is computed from the host&apos;s rate on the server — the form cannot set it.</p>

      <DataTable
        rows={entries}
        searchText={(e) => `${e.host_name} ${e.period} ${e.note}`}
        defaultSort="id"
        columns={[
          { key: "period", label: "Period", render: (e) => <span className="tabular-nums">{ym(e.period)}</span> },
          { key: "host_name", label: "Host" },
          { key: "basis_cents", label: "Basis", numeric: true, sortValue: (e) => e.basis_cents, render: (e) => fmtRM(e.basis_cents) },
          { key: "amount_cents", label: "Commission", numeric: true, sortValue: (e) => e.amount_cents, render: (e) => <b>{fmtRM(e.amount_cents)}</b> },
          {
            key: "status", label: "Status", sortable: false,
            render: (e) => (
              <span className="flex items-center gap-1.5">
                <span className={e.status === "paid" ? chipSuccess : e.status === "approved" ? chipNeutral : chipWarn}>{e.status}</span>
                {canDecide && e.status === "pending" && (
                  <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(e.id, "approved")}>approve</button>
                )}
                {canDecide && e.status === "approved" && (
                  <button type="button" className="text-gold-deep text-[11px] font-semibold" onClick={() => void setStatus(e.id, "paid")}>mark paid</button>
                )}
              </span>
            ),
          },
        ]}
        empty="No commission entries yet."
      />
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

  const load = useCallback(async () => {
    const r = await api<{ allocations: Allocation[]; claims: Claim[]; pending_migration?: boolean }>(`/adsfund`);
    setAllocations(r.data?.allocations ?? []);
    setClaims(r.data?.claims ?? []);
    setPending(r.data?.pending_migration === true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const allocated = allocations.reduce((a, x) => a + x.amount_cents, 0);
  const approved = allocations.reduce((a, x) => a + x.approved_cents, 0);
  const awaiting = claims.filter((c) => c.status === "pending").length;

  const addAllocation = async () => {
    const r = await api(`/adsfund`, {
      method: "POST",
      body: JSON.stringify({ period: allocDraft.period, channel: allocDraft.channel, amount: allocDraft.amount ? Number(allocDraft.amount) : undefined, notes: allocDraft.notes }),
    });
    if (r.ok) { setAllocDraft((d) => ({ ...d, amount: "", notes: "" })); showToast("Saved", "Allocation created"); void load(); }
    else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the fields", "notice");
  };

  const addClaim = async () => {
    const r = await api(`/adsfund/${claimDraft.allocation_id}/claims`, {
      method: "POST",
      body: JSON.stringify({ amount: claimDraft.amount ? Number(claimDraft.amount) : undefined, description: claimDraft.description }),
    });
    if (r.ok) { setClaimDraft({ allocation_id: "", amount: "", description: "" }); showToast("Saved", "Claim submitted for approval"); void load(); }
    else showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Check the fields", "notice");
  };

  const decide = async (id: number, status: "approved" | "rejected") => {
    const r = await api(`/adsfund/claims/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    showToast(r.ok ? "Saved" : "No changes", r.ok ? `Claim ${status}` : "Could not decide that claim", r.ok ? undefined : "notice");
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.</p>}
      <p className="text-sm font-semibold">Ads Fund</p>

      <div className="mt-3">
        <StatStrip>
          <StatTile tone="brand" label="Allocated" value={fmtRM(allocated)} icon="◎" />
          <StatTile tone="success" label="Approved spend" value={fmtRM(approved)} icon="✓" />
          <StatTile tone="gold" label="Remaining" value={fmtRM(allocated - approved)} icon="~" />
          <StatTile tone={awaiting > 0 ? "danger" : "muted"} label="Awaiting decision" value={awaiting} icon="!" />
        </StatStrip>
      </div>

      {canManage && (
        <div className={`${fieldRow} mb-3`}>
          <label><span className={fieldLabel}>Period</span>
            <input type="month" className={inputClass} value={allocDraft.period} onChange={(e) => setAllocDraft((d) => ({ ...d, period: e.target.value }))} /></label>
          <label><span className={fieldLabel}>Channel</span>
            <select className={inputClass} value={allocDraft.channel} onChange={(e) => setAllocDraft((d) => ({ ...d, channel: e.target.value }))}>
              {["tiktok", "shopee", "lazada", "direct"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label><span className={fieldLabel}>Budget (RM)</span>
            <input type="number" min="0.01" step="0.01" className={inputClass} value={allocDraft.amount} onChange={(e) => setAllocDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
          <button type="button" className={btnClass} disabled={!allocDraft.amount} onClick={() => void addAllocation()}>+ Allocate</button>
        </div>
      )}

      <div className={`${fieldRow} mb-4`}>
        <label><span className={fieldLabel}>Claim against</span>
          <select className={inputClass} value={claimDraft.allocation_id} onChange={(e) => setClaimDraft((d) => ({ ...d, allocation_id: e.target.value }))}>
            <option value="">—</option>
            {allocations.map((a) => (
              <option key={a.id} value={a.id}>{ym(a.period)} · {a.channel} · {fmtRM(a.amount_cents - a.approved_cents - a.pending_cents)} left</option>
            ))}
          </select></label>
        <label><span className={fieldLabel}>Amount (RM)</span>
          <input type="number" min="0.01" step="0.01" className={inputClass} value={claimDraft.amount} onChange={(e) => setClaimDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
        <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Spent on</span>
          <input className={inputClass} placeholder="TikTok ads top-up 12–14 Aug" value={claimDraft.description} onChange={(e) => setClaimDraft((d) => ({ ...d, description: e.target.value }))} /></label>
        <button type="button" className={btnClass} disabled={!claimDraft.allocation_id || !claimDraft.amount || !claimDraft.description} onClick={() => void addClaim()}>
          Submit claim
        </button>
      </div>

      <DataTable
        rows={claims}
        searchText={(c) => `${c.claimant} ${c.description}`}
        defaultSort="id"
        columns={[
          { key: "claimant", label: "By" },
          { key: "description", label: "Spent on" },
          { key: "amount_cents", label: "Amount", numeric: true, sortValue: (c) => c.amount_cents, render: (c) => fmtRM(c.amount_cents) },
          {
            key: "status", label: "Status", sortable: false,
            render: (c) => (
              <span className="flex items-center gap-1.5">
                <span className={c.status === "approved" ? chipSuccess : c.status === "rejected" ? chipDanger : chipWarn}>{c.status}</span>
                {canManage && c.status === "pending" && (
                  <>
                    <button type="button" className="text-success text-[11px] font-semibold" onClick={() => void decide(c.id, "approved")}>approve</button>
                    <button type="button" className="text-danger text-[11px] font-semibold" onClick={() => void decide(c.id, "rejected")}>reject</button>
                  </>
                )}
              </span>
            ),
          },
        ]}
        empty="No claims yet — allocate a budget, then claim spend against it."
      />
    </div>
  );
}
