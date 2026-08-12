"use client";

/* v1.7.0 — 🧲 Sales Pipeline (LEAD → WON). Rebuilt on the retained prospects
   table. Any staff member logs a lead in seconds; the sales tier moves it
   through the stages; the follow-up cron reminds (and web-pushes) the owner on
   the due date. Kanban-style stage strip + a quick add form + list. */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowActions } from "@/components/ui/row-button";
import { card, inputClass, btnClass, fieldRow, fieldLabel } from "@/lib/ui-styles";
import { MiniBar, dueChip, accentRowWarn } from "@/components/ui/stat-card";
import { dmy, mytToday } from "@/lib/format";

const api = makeApi("/staff");

interface Prospect {
  id: number; brand_name: string; source: string; niche?: string | null;
  referred_by?: string | null; contact_name?: string | null; contact_channel?: string | null;
  contact_value?: string | null; notes?: string | null; stage: string;
  assigned_to?: number | null; assigned_name?: string | null; created_name?: string | null;
  next_followup?: string | null; created_at: string;
}

const SOURCES = [
  ["tiktok", "TikTok Shop"], ["shopee", "Shopee"], ["instagram", "Instagram"],
  ["facebook", "Facebook"], ["expo", "Expo / bazaar"], ["referral", "Referral"], ["other", "Other"],
] as const;
const CHANNELS = [["", "—"], ["whatsapp", "WhatsApp"], ["dm", "DM"], ["email", "Email"], ["phone", "Phone"]] as const;
// The pipeline the CEO asked for: LEAD → CONTACTED → MEETING → PROPOSAL → NEGOTIATION → WON.
const STAGES = ["lead", "contacted", "meeting", "proposal", "negotiation", "won", "lost"] as const;
const OPEN_STAGES = ["lead", "contacted", "meeting", "proposal", "negotiation"] as const;

// Legacy rows (pre-v1.7) used identified/replied — map them for display.
function normStage(s: string): string {
  if (s === "identified") return "lead";
  if (s === "replied") return "contacted";
  return s;
}

const STAGE_CHIP: Record<string, string> = {
  lead: "bg-secondary text-foreground",
  contacted: "bg-info-soft text-info",
  meeting: "bg-info-soft text-info",
  proposal: "bg-warning-soft text-warning",
  negotiation: "bg-warning-soft text-warning",
  won: "bg-success-soft text-success",
  lost: "bg-danger-soft text-danger",
};

const EMPTY = { brand_name: "", source: "tiktok", niche: "", contact_name: "", contact_channel: "", contact_value: "", notes: "", assigned_to: "", next_followup: "", referred_by: "" };

export function PipelinePanel({ canManage, onQuote }: { canManage: boolean; onQuote?: (brand: string) => void }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [rows, setRows] = useState<Prospect[]>([]);
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [today, setToday] = useState(mytToday());
  const [draft, setDraft] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ prospects: Prospect[]; today: string; error?: { message?: string } }>(`/pipeline`);
    if (r.ok && r.data?.prospects) {
      setRows(r.data.prospects.map((p) => ({ ...p, stage: normStage(p.stage) })));
      if (r.data.today) setToday(r.data.today);
    } else if (r.data?.error?.message?.includes("0066") || /route not found/i.test(r.data?.error?.message ?? "")) {
      setNotReady(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api<{ staff: { id: number; name: string }[] }>(`/staff-list`).then((r) => { if (r.ok && r.data?.staff) setStaff(r.data.staff); });
  }, []);

  const save = async () => {
    if (!draft.brand_name.trim()) { showToast("No changes", "The lead / brand name is required", "notice"); return; }
    const body = JSON.stringify({ ...draft, assigned_to: draft.assigned_to ? Number(draft.assigned_to) : null });
    const r = editingId
      ? await api(`/pipeline/${editingId}`, { method: "PATCH", body })
      : await api(`/pipeline`, { method: "POST", body });
    if (!r.ok) { showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Could not save", "notice"); return; }
    showToast("Saved", editingId ? `${draft.brand_name} updated` : `${draft.brand_name} added to the pipeline`);
    setDraft({ ...EMPTY }); setEditingId(null);
    void load();
  };

  const setStage = async (p: Prospect, stage: string) => {
    const r = await api(`/pipeline/${p.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    showToast(r.ok ? "Saved" : "No changes", r.ok ? `${p.brand_name} → ${stage}` : "Could not update the stage", r.ok ? undefined : "notice");
    void load();
  };

  const overdue = (p: Prospect) => p.next_followup && p.next_followup < today && !["won", "lost"].includes(p.stage);
  const active = rows.filter((p) => !["won", "lost"].includes(p.stage));
  const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((p) => p.stage === s).length]));
  const shown = stageFilter ? rows.filter((p) => p.stage === stageFilter) : rows;

  if (notReady) {
    return <div className={card}><p className="text-sm font-semibold">🧲 Sales Pipeline</p>
      <p className="text-muted-foreground mt-1 text-xs">The pipeline is temporarily unavailable — the server may need migration 0066 applied. Try again shortly.</p></div>;
  }

  return (
    <div className={card}>
      {toastNode}{confirmNode}
      <p className="text-sm font-semibold">🧲 Sales Pipeline — LEAD → WON</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Log a lead in seconds; it gets an owner, a stage and a follow-up date, and the owner is reminded on the day. {active.length > 0 && <>Active: <span className="font-semibold">{active.length}</span>.</>}
      </p>

      {/* pipeline strip — each chip filters */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button key={s} type="button"
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STAGE_CHIP[s]} ${stageFilter === s ? "ring-2 ring-ring" : ""}`}
            onClick={() => setStageFilter(stageFilter === s ? null : s)}>
            {s} {counts[s] ?? 0}
          </button>
        ))}
      </div>

      {/* quick add / edit */}
      <div className="border-border mt-3 rounded-lg border p-3">
        <p className="text-xs font-semibold">{editingId ? "Edit lead" : "Add a lead"}</p>
        <div className={`${fieldRow} mt-2`}>
          <label className="col-span-2 block sm:flex-1">
            <span className={fieldLabel}>Lead / brand *</span>
            <input className={inputClass} placeholder="e.g. a brand you spotted" value={draft.brand_name}
              onChange={(e) => setDraft((d) => ({ ...d, brand_name: e.target.value }))} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Found on</span>
            <select className={inputClass} value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}>
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>Niche</span>
            <input className={inputClass} placeholder="hijab / skincare / F&B" value={draft.niche}
              onChange={(e) => setDraft((d) => ({ ...d, niche: e.target.value }))} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Referred by</span>
            <input className={inputClass} placeholder="who sent this lead" value={draft.referred_by}
              onChange={(e) => setDraft((d) => ({ ...d, referred_by: e.target.value }))} />
          </label>
        </div>
        <div className={`${fieldRow} mt-2`}>
          <label className="block">
            <span className={fieldLabel}>Contact person</span>
            <input className={inputClass} value={draft.contact_name} onChange={(e) => setDraft((d) => ({ ...d, contact_name: e.target.value }))} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Channel</span>
            <select className={inputClass} value={draft.contact_channel} onChange={(e) => setDraft((d) => ({ ...d, contact_channel: e.target.value }))}>
              {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="col-span-2 block sm:col-span-1 sm:flex-1">
            <span className={fieldLabel}>Number / handle</span>
            <input className={inputClass} placeholder="+60 12-… or @handle (business pages only — PDPA)" value={draft.contact_value}
              onChange={(e) => setDraft((d) => ({ ...d, contact_value: e.target.value }))} />
          </label>
        </div>
        <div className={`${fieldRow} mt-2`}>
          <label className="block">
            <span className={fieldLabel}>Assigned to</span>
            <select className={inputClass} value={draft.assigned_to} onChange={(e) => setDraft((d) => ({ ...d, assigned_to: e.target.value }))}>
              <option value="">— unassigned —</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>Next follow-up</span>
            <input type="date" className={inputClass} value={draft.next_followup}
              onChange={(e) => setDraft((d) => ({ ...d, next_followup: e.target.value }))} />
          </label>
          <label className="col-span-2 block sm:flex-1">
            <span className={fieldLabel}>Notes</span>
            <input className={inputClass} placeholder="what you saw — why they need us" value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          </label>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <button type="button" className={btnClass} onClick={() => void save()}>{editingId ? "Save changes" : "Add lead"}</button>
          {editingId && <button type="button" className="text-xs underline" onClick={() => { setEditingId(null); setDraft({ ...EMPTY }); }}>Cancel</button>}
        </div>
      </div>

      {/* list */}
      <div className="mt-3 space-y-1.5">
        {shown.length === 0 && <p className="text-muted-foreground text-xs">{stageFilter ? `No leads in ${stageFilter}.` : "No leads yet — the first find starts the pipeline."}</p>}
        {shown.map((p) => (
          <div key={p.id} className={`border-border rounded-lg border px-3 py-2 ${overdue(p) ? `${accentRowWarn} border-l-4 border-l-warning` : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                <RecordToggle open={open === p.id} title="Contact, notes and history" onToggle={() => setOpen(open === p.id ? null : p.id)}>
                  {p.brand_name}
                </RecordToggle>
                <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STAGE_CHIP[p.stage] ?? "bg-secondary"}`}>{p.stage}</span>
              </span>
              <span className={rowActions}>
                {canManage && (
                  <select className="rounded-lg border border-input bg-background px-2 py-1 text-xs capitalize" value={p.stage}
                    title="Move this lead along the pipeline" onChange={(e) => void setStage(p, e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {canManage && onQuote && ["meeting", "proposal", "negotiation"].includes(p.stage) && (
                  <button type="button" className={rowBtn} onClick={() => {
                    try {
                      localStorage.setItem("azone-qt-prefill", JSON.stringify({
                        company: p.brand_name, contact_person: p.contact_name ?? "",
                        phone: p.contact_channel === "whatsapp" ? (p.contact_value ?? "") : "",
                        reference: `From lead: ${p.brand_name}`,
                      }));
                    } catch { /* storage blocked — the jump still helps */ }
                    onQuote(p.brand_name);
                  }}>📄 Prepare quotation</button>
                )}
                {canManage && (
                  <button type="button" className={rowBtn} onClick={() => {
                    setEditingId(p.id);
                    setDraft({ brand_name: p.brand_name, source: p.source, niche: p.niche ?? "", contact_name: p.contact_name ?? "",
                      contact_channel: p.contact_channel ?? "", contact_value: p.contact_value ?? "", notes: p.notes ?? "",
                      assigned_to: p.assigned_to ? String(p.assigned_to) : "", next_followup: p.next_followup ?? "", referred_by: p.referred_by ?? "" });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}>Edit</button>
                )}
                {canManage && (
                  <button type="button" className={rowBtnDanger} onClick={async () => {
                    if (!(await confirm({ title: "Delete this lead?", message: `${p.brand_name} will be removed from the pipeline.`, confirmLabel: "Delete" }))) return;
                    const r = await api(`/pipeline/${p.id}`, { method: "DELETE" });
                    showToast(r.ok ? "Saved" : "No changes", r.ok ? `${p.brand_name} removed` : "Could not delete", r.ok ? undefined : "notice");
                    void load();
                  }}>Delete</button>
                )}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
              <MiniBar className="w-12 shrink-0"
                pct={p.stage === "lost" ? 100 : p.stage === "won" ? 100 : ((OPEN_STAGES.indexOf(p.stage as typeof OPEN_STAGES[number]) + 1) / OPEN_STAGES.length) * 100}
                tone={p.stage === "won" ? "green" : p.stage === "lost" ? "red" : "gold"} />
              <span>
                {SOURCES.find(([v]) => v === p.source)?.[1] ?? p.source}
                {p.niche ? ` · ${p.niche}` : ""}
                {p.referred_by ? ` · ↗ ${p.referred_by}` : ""}
                {p.assigned_name ? ` · 👤 ${p.assigned_name.split(" ")[0]}` : " · unassigned"}
                {p.next_followup ? ` · 📞 ${dmy(p.next_followup)}` : ""}
              </span>
              {(() => { const c = dueChip(p.next_followup, today); return c && !["won", "lost"].includes(p.stage)
                ? <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${c.cls}`}>{c.text}</span> : null; })()}
            </p>
            {open === p.id && (
              <DetailGrid items={[
                { label: "Contact", value: [p.contact_name, p.contact_channel].filter(Boolean).join(" · ") },
                { label: "Number / handle", value: p.contact_value
                  ? (p.contact_channel === "whatsapp"
                    ? <a className="underline" href={`https://wa.me/${p.contact_value.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer">{p.contact_value}</a>
                    : p.contact_value)
                  : "" },
                { label: "Assigned to", value: p.assigned_name ?? "" },
                { label: "Next follow-up", value: p.next_followup ? dmy(p.next_followup) : "" },
                { label: "Logged by", value: `${p.created_name ?? ""} · ${dmy(p.created_at)}` },
                { label: "Notes", wide: true, value: p.notes ?? "" },
              ]} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
