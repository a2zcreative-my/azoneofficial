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
import { Skel } from "@/components/ui/skeleton";
import { dmy } from "@/lib/format";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface ContentItem {
  id: number; title: string; kind: string; platform: string; stage: string;
  scheduled_date?: string | null; script?: string | null; caption?: string | null;
  campaign?: string | null; assigned_to?: number | null; assigned_name?: string | null;
  performance?: string | null; notes?: string | null; posted_at?: string | null; created_at: string;
}

const KINDS = [["video", "Video", "Video"], ["reel", "Reel", "Reel"], ["live", "Live", "Live"], ["campaign", "Campaign", "Kempen"], ["other", "Other", "Lain-lain"]] as const;
const PLATFORMS = [["tiktok", "TikTok", "TikTok"], ["shopee", "Shopee", "Shopee"], ["instagram", "Instagram", "Instagram"], ["facebook", "Facebook", "Facebook"], ["other", "Other", "Lain-lain"]] as const;
const STAGES = ["idea", "script", "shoot", "edit", "approval", "posted"] as const;

/* BM labels for stage/kind VALUES — display only; the values themselves stay
   English everywhere they are compared, filtered or sent to the API. */
const STAGE_MS: Record<string, string> = {
  idea: "idea", script: "skrip", shoot: "penggambaran", edit: "suntingan", approval: "kelulusan", posted: "telah disiarkan",
};
const KIND_MS: Record<string, string> = { video: "video", reel: "reel", live: "live", campaign: "kempen", other: "lain-lain" };
const stageLabel = (s: string) => L(s, STAGE_MS[s] ?? s);

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
  /* v1.77.0 — true once the first list request settles (ok or not); until
     then the stage counts and the list are skeletons, never "No content yet". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ content: ContentItem[]; error?: { message?: string } }>(`/content`);
    if (r.ok && r.data?.content) setRows(r.data.content);
    else if (r.data?.error?.message?.includes("0069") || /route not found/i.test(r.data?.error?.message ?? "")) setNotReady(true);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api<{ staff: { id: number; name: string }[] }>(`/staff-list`).then((r) => { if (r.ok && r.data?.staff) setStaff(r.data.staff); });
  }, []);

  const save = async () => {
    if (!draft.title.trim()) { showToast(L("No changes", "Tiada perubahan"), L("A title is required", "Tajuk diperlukan"), "notice"); return; }
    const body = JSON.stringify({ ...draft, assigned_to: draft.assigned_to ? Number(draft.assigned_to) : null });
    const r = editingId ? await api(`/content/${editingId}`, { method: "PATCH", body }) : await api(`/content`, { method: "POST", body });
    if (!r.ok) { showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Could not save", "Tidak dapat disimpan"), "notice"); return; }
    showToast(L("Saved", "Disimpan"), editingId ? L(`${draft.title} updated`, `${draft.title} dikemas kini`) : L(`${draft.title} added`, `${draft.title} ditambah`));
    setDraft({ ...EMPTY }); setEditingId(null); void load();
  };

  const setStage = async (c: ContentItem, stage: string) => {
    const r = await api(`/content/${c.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`${c.title} → ${stage}`, `${c.title} → ${STAGE_MS[stage] ?? stage}`) : L("Could not update", "Tidak dapat dikemas kini"), r.ok ? undefined : "notice");
    void load();
  };

  const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((c) => c.stage === s).length]));
  const shown = stageFilter ? rows.filter((c) => c.stage === stageFilter) : rows;

  if (notReady) {
    return <div className={card}><p className="text-sm font-semibold">{L("🎬 Content", "🎬 Kandungan")}</p>
      <p className="text-muted-foreground mt-1 text-xs">{L("Content management is temporarily unavailable — the server may need migration 0069 applied.", "Pengurusan kandungan tidak tersedia buat sementara — pelayan mungkin perlu migrasi 0069.")}</p></div>;
  }

  return (
    <div className={card}>
      {toastNode}{confirmNode}
      <p className="text-sm font-semibold">{L("🎬 Content — IDEA → POSTED", "🎬 Kandungan — IDEA → DISIARKAN")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Plan every piece of content, move it through the production stages, and keep the script + caption together. Assigning it notifies the owner.", "Rancang setiap kandungan, gerakkannya melalui peringkat produksi, dan simpan skrip + kapsyen bersama. Penugasan akan memaklumkan pemiliknya.")}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button key={s} type="button"
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STAGE_CHIP[s]} ${stageFilter === s ? "ring-2 ring-ring" : ""}`}
            onClick={() => setStageFilter(stageFilter === s ? null : s)}>
            {stageLabel(s)} {loaded ? counts[s] ?? 0 : <Skel className="inline-block h-3 w-3 align-middle" />}
          </button>
        ))}
      </div>

      {canManage && (
        <div className="border-border mt-3 rounded-lg border p-3">
          <p className="text-xs font-semibold">{editingId ? L("Edit content", "Sunting kandungan") : L("Add content", "Tambah kandungan")}</p>
          <div className={`${fieldRow} mt-2`}>
            <label className="col-span-2 block sm:flex-1">
              <span className={fieldLabel}>{L("Title *", "Tajuk *")}</span>
              {/* v1.27.0: a client-neutral example — this panel plans content
                  for every client, and ELFIA is an independent brand rather
                  than an A2Z product line. */}
              <input className={inputClass} placeholder={L("e.g. Raya haul live, bawal reel", "cth. Raya haul live, reel bawal")} value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{L("Type", "Jenis")}</span>
              <select className={inputClass} value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}>
                {KINDS.map(([v, l, ms]) => <option key={v} value={v}>{L(l, ms)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>{L("Platform", "Platform")}</span>
              <select className={inputClass} value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))}>
                {PLATFORMS.map(([v, l, ms]) => <option key={v} value={v}>{L(l, ms)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>{L("Scheduled", "Dijadualkan")}</span>
              <input type="date" className={inputClass} value={draft.scheduled_date} onChange={(e) => setDraft((d) => ({ ...d, scheduled_date: e.target.value }))} />
            </label>
          </div>
          <div className={`${fieldRow} mt-2`}>
            <label className="block">
              <span className={fieldLabel}>{L("Campaign", "Kempen")}</span>
              <input className={inputClass} placeholder={L("e.g. Raya 2026", "cth. Raya 2026")} value={draft.campaign} onChange={(e) => setDraft((d) => ({ ...d, campaign: e.target.value }))} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{L("Assigned to", "Diberikan kepada")}</span>
              <select className={inputClass} value={draft.assigned_to} onChange={(e) => setDraft((d) => ({ ...d, assigned_to: e.target.value }))}>
                <option value="">{L("— unassigned —", "— tidak diberikan —")}</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-2 block">
            <span className={fieldLabel}>{L("Script", "Skrip")}</span>
            <textarea className={inputClass} rows={2} placeholder={L("the hook, key points, CTA", "cangkuk, isi utama, CTA")} value={draft.script} onChange={(e) => setDraft((d) => ({ ...d, script: e.target.value }))} />
          </label>
          <label className="mt-2 block">
            <span className={fieldLabel}>{L("Caption", "Kapsyen")}</span>
            <textarea className={inputClass} rows={2} placeholder={L("posting caption + hashtags", "kapsyen siaran + hashtag")} value={draft.caption} onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))} />
          </label>
          <div className="mt-2.5 flex items-center gap-3">
            <button type="button" className={btnClass} onClick={() => void save()}>{editingId ? L("Save changes", "Simpan perubahan") : L("Add content", "Tambah kandungan")}</button>
            {editingId && <button type="button" className="text-xs underline" onClick={() => { setEditingId(null); setDraft({ ...EMPTY }); }}>{L("Cancel", "Batal")}</button>}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {/* v1.77.0 — skeleton until the first fetch lands: the same bordered
            rows — title + stage chip, actions on the right, a detail line under. */}
        {!loaded && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border-border rounded-lg border px-3 py-2" aria-hidden>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Skel className="h-4 w-40" />
                <Skel className="h-4 w-14 rounded-full" />
              </span>
              <Skel className="h-6 w-24" />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Skel className="h-1.5 w-12 shrink-0 rounded-full" />
              <Skel className="h-3 w-1/2" />
            </div>
          </div>
        ))}
        {loaded && shown.length === 0 && <p className="text-muted-foreground text-xs">{stageFilter ? L(`Nothing in ${stageFilter}.`, `Tiada dalam ${STAGE_MS[stageFilter] ?? stageFilter}.`) : L("No content yet — plan the first piece above.", "Belum ada kandungan — rancang yang pertama di atas.")}</p>}
        {shown.map((c) => (
          <div key={c.id} className="border-border rounded-lg border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                <RecordToggle open={open === c.id} title={L("Script, caption and performance", "Skrip, kapsyen dan prestasi")} onToggle={() => setOpen(open === c.id ? null : c.id)}>
                  {c.title}
                </RecordToggle>
                <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STAGE_CHIP[c.stage] ?? "bg-secondary"}`}>{stageLabel(c.stage)}</span>
              </span>
              <span className={rowActions}>
                {canManage && (
                  <select className="rounded-lg border border-input bg-background px-2 py-1 text-xs capitalize" value={c.stage}
                    onChange={(e) => void setStage(c, e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                  </select>
                )}
                {canManage && (
                  <button type="button" className={rowBtn} onClick={() => {
                    setEditingId(c.id);
                    setDraft({ title: c.title, kind: c.kind, platform: c.platform, scheduled_date: c.scheduled_date ?? "", script: c.script ?? "", caption: c.caption ?? "", campaign: c.campaign ?? "", assigned_to: c.assigned_to ? String(c.assigned_to) : "", notes: c.notes ?? "" });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}>{L("Edit", "Sunting")}</button>
                )}
                {canManage && (
                  <button type="button" className={rowBtnDanger} onClick={async () => {
                    if (!(await confirm({ title: L("Delete this content?", "Padam kandungan ini?"), message: L(`${c.title} will be removed.`, `${c.title} akan dibuang.`), confirmLabel: L("Delete", "Padam") }))) return;
                    const r = await api(`/content/${c.id}`, { method: "DELETE" });
                    showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`${c.title} removed`, `${c.title} dibuang`) : L("Could not delete", "Tidak dapat dipadam"), r.ok ? undefined : "notice");
                    void load();
                  }}>{L("Delete", "Padam")}</button>
                )}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
              <MiniBar className="w-12 shrink-0" pct={((STAGES.indexOf(c.stage as typeof STAGES[number]) + 1) / STAGES.length) * 100} tone={c.stage === "posted" ? "green" : "gold"} />
              <span className="capitalize">{L(c.kind, KIND_MS[c.kind] ?? c.kind)} · {c.platform}
                {c.campaign ? ` · ${c.campaign}` : ""}
                {c.assigned_name ? ` · 👤 ${c.assigned_name.split(" ")[0]}` : ""}
                {c.scheduled_date ? ` · 📅 ${dmy(c.scheduled_date)}` : ""}
                {c.posted_at ? L(` · ✅ posted ${dmy(c.posted_at)}`, ` · ✅ disiarkan ${dmy(c.posted_at)}`) : ""}
              </span>
            </p>
            {open === c.id && (
              <>
                <DetailGrid items={[
                  { label: L("Script", "Skrip"), wide: true, value: c.script ?? "" },
                  { label: L("Caption", "Kapsyen"), wide: true, value: c.caption ?? "" },
                  { label: L("Performance", "Prestasi"), wide: true, value: c.performance ?? "" },
                ]} />
                {canManage && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="flex-1">
                      <span className={fieldLabel}>{L("Log performance (views / GMV / notes)", "Catat prestasi (tontonan / GMV / nota)")}</span>
                      <input className={inputClass} defaultValue={c.performance ?? ""} placeholder={L("e.g. 42k views · RM3,200 GMV · 3.1% CVR", "cth. 42k tontonan · RM3,200 GMV · 3.1% CVR")}
                        onBlur={async (e) => { if (e.target.value !== (c.performance ?? "")) { await api(`/content/${c.id}`, { method: "PATCH", body: JSON.stringify({ performance: e.target.value }) }); showToast(L("Saved", "Disimpan"), L("Performance logged", "Prestasi dicatat")); void load(); } }} />
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
