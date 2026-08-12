"use client";

/* v1.7.0 — 🎬 Content management for live commerce. Plan TikTok / Reels / Live
   content on a schedule, move each piece through IDEA → SCRIPT → SHOOT → EDIT →
   APPROVAL → POSTED, keep the script + caption + campaign together, and record
   performance after posting. */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowActions } from "@/components/ui/row-button";
import { card, inputClass, btnClass, fieldRow, fieldLabel } from "@/lib/ui-styles";
import { MiniBar } from "@/components/ui/stat-card";
import { dmy } from "@/lib/format";

const api = makeApi("/staff");

interface ContentItem {
  id: number; title: string; kind: string; platform: string; stage: string;
  scheduled_date?: string | null; script?: string | null; caption?: string | null;
  campaign?: string | null; assigned_to?: number | null; assigned_name?: string | null;
  performance?: string | null; notes?: string | null; posted_at?: string | null; created_at: string;
}

const KINDS = [["video", "Video"], ["reel", "Reel"], ["live", "Live"], ["campaign", "Campaign"], ["other", "Other"]] as const;
const PLATFORMS = [["tiktok", "TikTok"], ["shopee", "Shopee"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["other", "Other"]] as const;
const STAGES = ["idea", "script", "shoot", "edit", "approval", "posted"] as const;

const STAGE_CHIP: Record<string, string> = {
  idea: "bg-secondary text-foreground",
  script: "bg-info-soft text-info",
  shoot: "bg-info-soft text-info",
  edit: "bg-warning-soft text-warning",
  approval: "bg-warning-soft text-warning",
  posted: "bg-success-soft text-success",
};

const EMPTY = { title: "", kind: "video", platform: "tiktok", scheduled_date: "", script: "", caption: "", campaign: "", assigned_to: "", notes: "" };

export function ContentPanel({ canManage }: { canManage: boolean }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [rows, setRows] = useState<ContentItem[]>([]);
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ content: ContentItem[]; error?: { message?: string } }>(`/content`);
    if (r.ok && r.data?.content) setRows(r.data.content);
    else if (r.data?.error?.message?.includes("0069") || /route not found/i.test(r.data?.error?.message ?? "")) setNotReady(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api<{ staff: { id: number; name: string }[] }>(`/staff-list`).then((r) => { if (r.ok && r.data?.staff) setStaff(r.data.staff); });
  }, []);

  const save = async () => {
    if (!draft.title.trim()) { showToast("No changes", "A title is required", "notice"); return; }
    const body = JSON.stringify({ ...draft, assigned_to: draft.assigned_to ? Number(draft.assigned_to) : null });
    const r = editingId ? await api(`/content/${editingId}`, { method: "PATCH", body }) : await api(`/content`, { method: "POST", body });
    if (!r.ok) { showToast("No changes", (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Could not save", "notice"); return; }
    showToast("Saved", editingId ? `${draft.title} updated` : `${draft.title} added`);
    setDraft({ ...EMPTY }); setEditingId(null); void load();
  };

  const setStage = async (c: ContentItem, stage: string) => {
    const r = await api(`/content/${c.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    showToast(r.ok ? "Saved" : "No changes", r.ok ? `${c.title} → ${stage}` : "Could not update", r.ok ? undefined : "notice");
    void load();
  };

  const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((c) => c.stage === s).length]));
  const shown = stageFilter ? rows.filter((c) => c.stage === stageFilter) : rows;

  if (notReady) {
    return <div className={card}><p className="text-sm font-semibold">🎬 Content</p>
      <p className="text-muted-foreground mt-1 text-xs">Content management is temporarily unavailable — the server may need migration 0069 applied.</p></div>;
  }

  return (
    <div className={card}>
      {toastNode}{confirmNode}
      <p className="text-sm font-semibold">🎬 Content — IDEA → POSTED</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Plan every piece of content, move it through the production stages, and keep the script + caption together. Assigning it notifies the owner.
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button key={s} type="button"
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STAGE_CHIP[s]} ${stageFilter === s ? "ring-2 ring-ring" : ""}`}
            onClick={() => setStageFilter(stageFilter === s ? null : s)}>
            {s} {counts[s] ?? 0}
          </button>
        ))}
      </div>

      {canManage && (
        <div className="border-border mt-3 rounded-lg border p-3">
          <p className="text-xs font-semibold">{editingId ? "Edit content" : "Add content"}</p>
          <div className={`${fieldRow} mt-2`}>
            <label className="col-span-2 block sm:flex-1">
              <span className={fieldLabel}>Title *</span>
              <input className={inputClass} placeholder="e.g. Raya haul live, ELFIA bawal reel" value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>Type</span>
              <select className={inputClass} value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>Platform</span>
              <select className={inputClass} value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))}>
                {PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>Scheduled</span>
              <input type="date" className={inputClass} value={draft.scheduled_date} onChange={(e) => setDraft((d) => ({ ...d, scheduled_date: e.target.value }))} />
            </label>
          </div>
          <div className={`${fieldRow} mt-2`}>
            <label className="block">
              <span className={fieldLabel}>Campaign</span>
              <input className={inputClass} placeholder="e.g. Raya 2026" value={draft.campaign} onChange={(e) => setDraft((d) => ({ ...d, campaign: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>Assigned to</span>
              <select className={inputClass} value={draft.assigned_to} onChange={(e) => setDraft((d) => ({ ...d, assigned_to: e.target.value }))}>
                <option value="">— unassigned —</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-2 block">
            <span className={fieldLabel}>Script</span>
            <textarea className={inputClass} rows={2} placeholder="the hook, key points, CTA" value={draft.script} onChange={(e) => setDraft((d) => ({ ...d, script: e.target.value }))} />
          </label>
          <label className="mt-2 block">
            <span className={fieldLabel}>Caption</span>
            <textarea className={inputClass} rows={2} placeholder="posting caption + hashtags" value={draft.caption} onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))} />
          </label>
          <div className="mt-2.5 flex items-center gap-3">
            <button type="button" className={btnClass} onClick={() => void save()}>{editingId ? "Save changes" : "Add content"}</button>
            {editingId && <button type="button" className="text-xs underline" onClick={() => { setEditingId(null); setDraft({ ...EMPTY }); }}>Cancel</button>}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {shown.length === 0 && <p className="text-muted-foreground text-xs">{stageFilter ? `Nothing in ${stageFilter}.` : "No content yet — plan the first piece above."}</p>}
        {shown.map((c) => (
          <div key={c.id} className="border-border rounded-lg border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                <RecordToggle open={open === c.id} title="Script, caption and performance" onToggle={() => setOpen(open === c.id ? null : c.id)}>
                  {c.title}
                </RecordToggle>
                <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STAGE_CHIP[c.stage] ?? "bg-secondary"}`}>{c.stage}</span>
              </span>
              <span className={rowActions}>
                {canManage && (
                  <select className="rounded-lg border border-input bg-background px-2 py-1 text-xs capitalize" value={c.stage}
                    onChange={(e) => void setStage(c, e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {canManage && (
                  <button type="button" className={rowBtn} onClick={() => {
                    setEditingId(c.id);
                    setDraft({ title: c.title, kind: c.kind, platform: c.platform, scheduled_date: c.scheduled_date ?? "", script: c.script ?? "", caption: c.caption ?? "", campaign: c.campaign ?? "", assigned_to: c.assigned_to ? String(c.assigned_to) : "", notes: c.notes ?? "" });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}>Edit</button>
                )}
                {canManage && (
                  <button type="button" className={rowBtnDanger} onClick={async () => {
                    if (!(await confirm({ title: "Delete this content?", message: `${c.title} will be removed.`, confirmLabel: "Delete" }))) return;
                    const r = await api(`/content/${c.id}`, { method: "DELETE" });
                    showToast(r.ok ? "Saved" : "No changes", r.ok ? `${c.title} removed` : "Could not delete", r.ok ? undefined : "notice");
                    void load();
                  }}>Delete</button>
                )}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
              <MiniBar className="w-12 shrink-0" pct={((STAGES.indexOf(c.stage as typeof STAGES[number]) + 1) / STAGES.length) * 100} tone={c.stage === "posted" ? "green" : "gold"} />
              <span className="capitalize">{c.kind} · {c.platform}
                {c.campaign ? ` · ${c.campaign}` : ""}
                {c.assigned_name ? ` · 👤 ${c.assigned_name.split(" ")[0]}` : ""}
                {c.scheduled_date ? ` · 📅 ${dmy(c.scheduled_date)}` : ""}
                {c.posted_at ? ` · ✅ posted ${dmy(c.posted_at)}` : ""}
              </span>
            </p>
            {open === c.id && (
              <>
                <DetailGrid items={[
                  { label: "Script", wide: true, value: c.script ?? "" },
                  { label: "Caption", wide: true, value: c.caption ?? "" },
                  { label: "Performance", wide: true, value: c.performance ?? "" },
                ]} />
                {canManage && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="flex-1">
                      <span className={fieldLabel}>Log performance (views / GMV / notes)</span>
                      <input className={inputClass} defaultValue={c.performance ?? ""} placeholder="e.g. 42k views · RM3,200 GMV · 3.1% CVR"
                        onBlur={async (e) => { if (e.target.value !== (c.performance ?? "")) { await api(`/content/${c.id}`, { method: "PATCH", body: JSON.stringify({ performance: e.target.value }) }); showToast("Saved", "Performance logged"); void load(); } }} />
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
