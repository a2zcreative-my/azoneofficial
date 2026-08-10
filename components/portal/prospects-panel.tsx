"use client";

/* v1.4.267 — 📇 Prospects (CEO: "something that may approach my potential
   customer in Malaysia which is easier for me to get my team approach them").

   The bottleneck was never finding brands — TikTok category rankings, Shopee,
   IG hashtags and expos are full of them — it's that a lead found in five
   places dies in a WhatsApp screenshot. This is where it lives instead: any
   staff member logs a find in twenty seconds from their phone; the sales tier
   moves it through the stages; the cron nags whoever owns it on the
   follow-up date.

   Built entirely on the house standards: fieldRow form, RecordToggle rows,
   global buttons, save toasts, displayName-style server names. */

import { useCallback, useEffect, useState } from "react";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RecordToggle, DetailGrid } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowActions } from "@/components/ui/row-button";
import { card, inputClass, btnClass, fieldRow } from "@/lib/ui-styles";
import { MiniBar, dueChip, accentRowWarn } from "@/components/ui/stat-card";
import { dmy, mytToday } from "@/lib/format";

const API = "/api/v1/staff";

interface Prospect {
  id: number;
  brand_name: string;
  source: string;
  niche?: string | null;
  contact_name?: string | null;
  contact_channel?: string | null;
  contact_value?: string | null;
  notes?: string | null;
  stage: string;
  assigned_to?: number | null;
  assigned_name?: string | null;
  created_name?: string | null;
  next_followup?: string | null;
  created_at: string;
}

const SOURCES = [
  ["tiktok", "TikTok Shop"], ["shopee", "Shopee"], ["instagram", "Instagram"],
  ["facebook", "Facebook"], ["expo", "Expo / bazaar"], ["referral", "Referral"], ["other", "Other"],
] as const;
const CHANNELS = [["", "—"], ["whatsapp", "WhatsApp"], ["dm", "DM"], ["email", "Email"], ["phone", "Phone"]] as const;
const STAGES = ["identified", "contacted", "replied", "meeting", "proposal", "won", "lost"] as const;

/** Stage chip colours: cool while cold, warm while live, settled when done. */
const STAGE_CHIP: Record<string, string> = {
  identified: "bg-secondary text-foreground",
  contacted: "bg-sky-100 text-sky-800",
  replied: "bg-amber-100 text-amber-800",
  meeting: "bg-violet-100 text-violet-800",
  proposal: "bg-orange-100 text-orange-800",
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-700",
};

const EMPTY = { brand_name: "", source: "tiktok", niche: "", contact_name: "", contact_channel: "", contact_value: "", notes: "", assigned_to: "", next_followup: "" };

async function api<T>(p: string, init?: RequestInit): Promise<{ ok: boolean; data: (T & { error?: { message?: string } }) | null }> {
  try {
    const r = await fetch(`${API}${p}`, { credentials: "include", headers: { "content-type": "application/json" }, ...init });
    return { ok: r.ok, data: (await r.json().catch(() => null)) as (T & { error?: { message?: string } }) | null };
  } catch { return { ok: false, data: null }; }
}

export function ProspectsPanel({ canManage }: { canManage: boolean }) {
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
    const r = await api<{ prospects: Prospect[]; today: string }>(`/prospects`);
    if (r.ok && r.data?.prospects) { setRows(r.data.prospects); setToday(r.data.today); }
    // v1.4.269: a stale worker (no /prospects route yet) must NOT read as an
    // empty pipeline — "No prospects yet" would also invite an Add that
    // cannot save. Both the missing migration and the missing route show the
    // deploy notice instead of the form.
    else if (r.data?.error?.message?.includes("0066") || /route not found/i.test(r.data?.error?.message ?? "")) setNotReady(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void (async () => {
      const r = await api<{ staff: { id: number; name: string }[] }>(`/staff-list`);
      if (r.ok && r.data?.staff) setStaff(r.data.staff);
    })();
  }, []);

  const save = async () => {
    if (!draft.brand_name.trim()) { showToast("No changes", "The brand name is the one required field", "notice"); return; }
    const body = JSON.stringify({ ...draft, assigned_to: draft.assigned_to ? Number(draft.assigned_to) : null });
    const r = editingId
      ? await api(`/prospects/${editingId}`, { method: "PATCH", body })
      : await api(`/prospects`, { method: "POST", body });
    if (!r.ok) { showToast("No changes", r.data?.error?.message ?? "Could not save — try again", "notice"); return; }
    showToast("Saved", editingId ? `${draft.brand_name} updated` : `${draft.brand_name} added to the pipeline`);
    setDraft({ ...EMPTY }); setEditingId(null);
    void load();
  };

  const setStage = async (p: Prospect, stage: string) => {
    const r = await api(`/prospects/${p.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    showToast(r.ok ? "Saved" : "No changes",
      r.ok ? `${p.brand_name} → ${stage}` : "Could not update the stage", r.ok ? undefined : "notice");
    void load();
  };

  const overdue = (p: Prospect) => p.next_followup && p.next_followup < today && !["won", "lost"].includes(p.stage);
  const active = rows.filter((p) => !["won", "lost"].includes(p.stage));
  const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((p) => p.stage === s).length]));
  const shown = stageFilter ? rows.filter((p) => p.stage === stageFilter) : rows;

  if (notReady) {
    return <div className={card}><p className="text-sm font-semibold">📇 Prospects</p>
      <p className="text-muted-foreground mt-1 text-xs">The server doesn&apos;t have the prospects update yet — run migration 0066 and redeploy the worker (<span className="font-mono">npx wrangler d1 migrations apply azoneofficial --remote</span>, then <span className="font-mono">cd worker && wrangler deploy</span>). The form appears once it&apos;s live, so nothing typed here can be lost.</p></div>;
  }

  return (
    <div className={card}>
      {toastNode}{confirmNode}
      <p className="text-sm font-semibold">📇 Prospects — the team&apos;s lead list</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Spot a Malaysian brand selling well with a weak live game — TikTok rankings, Shopee, IG, an expo — and log it here in twenty seconds. It gets an owner, a stage and a follow-up date, and the owner is reminded on the day. {active.length > 0 && <>Active: <span className="font-semibold">{active.length}</span>.</>}
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

      {/* the twenty-second form */}
      <div className="border-border mt-3 rounded-lg border p-3">
        <p className="text-xs font-semibold">{editingId ? "Edit prospect" : "Add a prospect"}</p>
        <div className={`${fieldRow} mt-2`}>
          <label className="col-span-2 block sm:flex-1">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Brand *</span>
            <input className={inputClass} placeholder="e.g. a tudung brand you spotted" value={draft.brand_name}
              onChange={(e) => setDraft((d) => ({ ...d, brand_name: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Found on</span>
            <select className={inputClass} value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}>
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Niche</span>
            <input className={inputClass} placeholder="hijab / skincare / F&B" value={draft.niche}
              onChange={(e) => setDraft((d) => ({ ...d, niche: e.target.value }))} />
          </label>
        </div>
        <div className={`${fieldRow} mt-2`}>
          <label className="block">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Contact person</span>
            <input className={inputClass} value={draft.contact_name} onChange={(e) => setDraft((d) => ({ ...d, contact_name: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Channel</span>
            <select className={inputClass} value={draft.contact_channel} onChange={(e) => setDraft((d) => ({ ...d, contact_channel: e.target.value }))}>
              {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="col-span-2 block sm:col-span-1 sm:flex-1">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Number / handle</span>
            <input className={inputClass} placeholder="+60 12-… or @handle — business pages only (PDPA)" value={draft.contact_value}
              onChange={(e) => setDraft((d) => ({ ...d, contact_value: e.target.value }))} />
          </label>
        </div>
        <div className={`${fieldRow} mt-2`}>
          <label className="block">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Assigned to</span>
            <select className={inputClass} value={draft.assigned_to} onChange={(e) => setDraft((d) => ({ ...d, assigned_to: e.target.value }))}>
              <option value="">— unassigned —</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Next follow-up</span>
            <input type="date" className={inputClass} value={draft.next_followup}
              onChange={(e) => setDraft((d) => ({ ...d, next_followup: e.target.value }))} />
          </label>
          <label className="col-span-2 block sm:flex-1">
            <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Notes</span>
            <input className={inputClass} placeholder="what you saw — sales rank, live schedule, why they need us" value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          </label>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <button type="button" className={btnClass} onClick={() => void save()}>{editingId ? "Save changes" : "Add prospect"}</button>
          {editingId && <button type="button" className="text-xs underline" onClick={() => { setEditingId(null); setDraft({ ...EMPTY }); }}>Cancel</button>}
        </div>
      </div>

      {/* the list — minimalist rows, one open at a time */}
      <div className="mt-3 space-y-1.5">
        {shown.length === 0 && <p className="text-muted-foreground text-xs">{stageFilter ? `No prospects in ${stageFilter}.` : "No prospects yet — the first find starts the pipeline."}</p>}
        {shown.map((p) => (
          <div key={p.id} className={`border-border rounded-lg border px-3 py-2 ${overdue(p) ? `${accentRowWarn} border-l-4 border-l-amber-400` : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                <RecordToggle open={open === p.id} title="Contact, notes and history"
                  onToggle={() => setOpen(open === p.id ? null : p.id)}>
                  {p.brand_name}
                </RecordToggle>
                <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STAGE_CHIP[p.stage] ?? "bg-secondary"}`}>{p.stage}</span>
                {/* v1.4.271 audit: the ⏰ chip was removed — dueChip on the
                    meta line already says "Nd overdue"; one row, one chip. */}
              </span>
              <span className={rowActions}>
                {canManage && (
                  <select className="rounded-lg border border-input bg-background px-2 py-1 text-xs capitalize" value={p.stage}
                    title="Move this prospect along the pipeline"
                    onChange={(e) => void setStage(p, e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {canManage && (
                  <button type="button" className={rowBtn} onClick={() => {
                    setEditingId(p.id);
                    setDraft({ brand_name: p.brand_name, source: p.source, niche: p.niche ?? "", contact_name: p.contact_name ?? "",
                      contact_channel: p.contact_channel ?? "", contact_value: p.contact_value ?? "", notes: p.notes ?? "",
                      assigned_to: p.assigned_to ? String(p.assigned_to) : "", next_followup: p.next_followup ?? "" });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}>Edit</button>
                )}
                {canManage && (
                  <button type="button" className={rowBtnDanger} onClick={async () => {
                    if (!(await confirm({ title: "Delete this prospect?", message: `${p.brand_name} will be removed from the pipeline.`, confirmLabel: "Delete" }))) return;
                    const r = await api(`/prospects/${p.id}`, { method: "DELETE" });
                    showToast(r.ok ? "Saved" : "No changes", r.ok ? `${p.brand_name} removed` : "Could not delete", r.ok ? undefined : "notice");
                    void load();
                  }}>Delete</button>
                )}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
              {/* v1.4.270: the stage as a POSITION — a five-second read of how
                  far along this lead is, before any word is read. */}
              <MiniBar className="w-12 shrink-0"
                pct={p.stage === "lost" ? 100 : ((STAGES.indexOf(p.stage as typeof STAGES[number]) + 1) / 6) * 100}
                tone={p.stage === "won" ? "green" : p.stage === "lost" ? "red" : "gold"} />
              <span>
                {SOURCES.find(([v]) => v === p.source)?.[1] ?? p.source}
                {p.niche ? ` · ${p.niche}` : ""}
                {p.assigned_name ? ` · 👤 ${p.assigned_name.split(" ")[0]}` : " · unassigned"}
                {p.next_followup ? ` · 📞 ${dmy(p.next_followup)}` : ""}
              </span>
              {(() => { const c = dueChip(p.next_followup, today); return c && !["won", "lost"].includes(p.stage)
                ? <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${c.cls}`}>{c.text}</span> : null; })()}
            </p>
            {open === p.id && (
              <DetailGrid items={[
                { label: "Contact", value: [p.contact_name, p.contact_channel].filter(Boolean).join(" · ") },
                {
                  label: "Number / handle",
                  value: p.contact_value
                    ? (p.contact_channel === "whatsapp"
                      ? <a className="underline" href={`https://wa.me/${p.contact_value.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer">{p.contact_value}</a>
                      : p.contact_value)
                    : "",
                },
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
