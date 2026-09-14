"use client";

/**
 * ADVISORS - five AI desks that advise and never decide. v1.160.0.
 *
 * The CEO, 14-09-2026: *"This AI should not make their decision ... they
 * need me to review their plan and implementation for me to final approved.
 * they only provide me suggestion."* His decisions on the plan: ONE tab with
 * the five desks inside (D1); the CEO alone approves (D2); Workers AI now
 * (D3); daily at 06:30 MYT plus "Ask the desk", ten a day (D4); personal
 * details stripped before any model reads a customer (D5).
 *
 * One page, top to bottom: the meter and the switch, the five desks, the
 * queue of proposals with the decision row, the company brief every desk
 * reads first, and the run log. The browser computes nothing: every figure
 * and every proposal is what /staff/advisors sent, and a decision is one
 * POST that the worker turns into a task (or, for a customer-service draft,
 * into the suggested reply the Enquiries tab shows staff).
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { makeApi } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { Skel, SkelRows, StaleHint } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { mytDateTime } from "@/components/portal/page-shared";
import { getLang } from "@/lib/i18n";
import {
  card, insetCard, modalCard, inputClassSm, selectClass, fieldLabel, btnSm, btnSmPrimary,
  chipSmNeutral, chipSmSuccess, chipSmWarn, chipSmDanger, chipSmInfo, tabPill, tabPillOn,
} from "@/lib/ui-styles";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const api = makeApi("/staff/advisors");

/* ---- what the worker sends ---- */
interface Run { id: number; desk: string; trigger: string; model: string | null; status: string; input_tokens: number; output_tokens: number; neurons: number; proposals: number; note: string | null; started_at: string }
interface Desk {
  id: string; name: { en: string; ms: string }; about: { en: string; ms: string }; kinds: string[]; planned: string | null;
  enabled: boolean; cap: number; today: number; month: number; tokens_month: number; runs: number; lessons: number; last: Run | null;
}
interface Ref { ref: string; label: string; tab?: string }
interface Proposal {
  id: number; desk: string; kind: string; title: string; why: string; plan: string[]; evidence: Ref[];
  owner_hint: string | null; expected: string | null; measure: string | null; priority: string; status: string;
  draft: { en: string; ms: string } | null; triage: { sentiment: string; urgency: string } | null;
  decision_note: string | null; decided_at: string | null; decided_name: string | null; task_id: number | null;
  created_at: string; expires_at: string; implemented_at: string | null;
}
interface Person { id: number; name: string; role: string }
interface Overview {
  can_decide: boolean; enabled: boolean; model: string; gateway: boolean; ai_bound: boolean; free_per_day: number; global_cap: number;
  asks_left: number; max_asks: number; brief: string; desks: Desk[]; proposals: Proposal[]; runs: Run[]; people: Person[];
}
interface Err { ok?: boolean; error?: { code?: string; message?: string } }
const say = (r: { data: Err | null }, fallback: string) => r.data?.error?.message ?? fallback;

const MODELS: [string, string][] = [
  ["@cf/openai/gpt-oss-120b", "gpt-oss 120b (default - best reasoning per neuron)"],
  ["@cf/openai/gpt-oss-20b", "gpt-oss 20b (cheaper, lighter)"],
  ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "Llama 3.3 70b (dear on output)"],
  ["@cf/meta/llama-3.1-8b-instruct-fp8", "Llama 3.1 8b (cheapest, simplest)"],
];
const KIND: Record<string, [string, string]> = {
  finding: ["Finding", "Penemuan"], plan: ["Plan", "Pelan"], draft_reply: ["Draft reply", "Draf balasan"], idea: ["Idea", "Idea"], research: ["Research", "Kajian"],
};
const STATUS: Record<string, [string, string, string]> = {
  proposed: ["Waiting for you", "Menunggu anda", chipSmWarn],
  changes: ["Changes asked", "Perubahan diminta", chipSmInfo],
  approved: ["Approved", "Diluluskan", chipSmSuccess],
  later: ["Later", "Kemudian", chipSmNeutral],
  rejected: ["Rejected", "Ditolak", chipSmDanger],
  implemented: ["Implemented", "Dilaksanakan", chipSmSuccess],
  verified: ["Verified", "Disahkan", chipSmSuccess],
  expired: ["Expired", "Tamat", chipSmNeutral],
  superseded: ["Superseded", "Diganti", chipSmNeutral],
};
const PRIO: Record<string, string> = { low: chipSmNeutral, normal: chipSmNeutral, high: chipSmWarn, urgent: chipSmDanger };
const RUN_STATUS: Record<string, [string, string]> = {
  done: ["ran", "berjalan"], skipped: ["skipped", "dilangkau"], capped: ["capped", "had dicapai"], disabled: ["off", "dimatikan"], failed: ["failed", "gagal"], planned: ["planned", "dirancang"],
};
const n = (v: number) => v.toLocaleString("en-MY");
const kindLabel = (k: string) => { const t = KIND[k]; return t ? L(t[0], t[1]) : k; };
const runLabel = (k: string) => { const t = RUN_STATUS[k]; return t ? L(t[0], t[1]) : k; };

/* ---- the drawer every form opens in (module scope, rule #30) ---- */
function Drawer({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`${modalCard} max-h-[92vh] overflow-y-auto overscroll-contain rounded-b-none pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:pb-6`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">{title}</p>
            {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
          </div>
          <button type="button" className={`${btnSm} h-8 w-8 justify-center px-0`} aria-label={L("Close", "Tutup")} onClick={onClose}><AppIcon name="blocked" className="h-4 w-4" /></button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/* ---- the approve form: who, when, how urgent (module scope: it holds inputs) ---- */
function ApproveForm({ p, people, busy, onSubmit }: { p: Proposal; people: Person[]; busy: boolean; onSubmit: (v: { assigned_to: number; deadline: string; priority: string; note: string }) => void }) {
  const [who, setWho] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState(p.priority);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm">{L("Approving creates a task with the plan as its checklist. The desk does nothing itself.", "Meluluskan mencipta tugasan dengan pelan sebagai senarai semaknya. Meja itu sendiri tidak melakukan apa-apa.")}</p>
      <label className="block"><span className={fieldLabel}>{L("Who will do it", "Siapa yang akan melakukannya")}</span>
        <select className={`${selectClass} w-full`} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{L("Pick a person", "Pilih seseorang")}</option>
          {people.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role.replace("_", " ")}</option>)}
        </select>
        {p.owner_hint && <span className="text-muted-foreground mt-1 block text-xs">{L("The desk suggests", "Meja mencadangkan")}: {p.owner_hint}</span>}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className={fieldLabel}>{L("Deadline", "Tarikh akhir")}</span><input type="date" className={`${inputClassSm} w-full`} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        <label className="block"><span className={fieldLabel}>{L("Priority", "Keutamaan")}</span>
          <select className={`${selectClass} w-full`} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {["low", "normal", "high", "urgent"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      <label className="block"><span className={fieldLabel}>{L("A note for the task (optional)", "Nota untuk tugasan (pilihan)")}</span><textarea className={`${inputClassSm} w-full`} rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button type="button" className={btnSmPrimary} disabled={busy || !who} onClick={() => onSubmit({ assigned_to: Number(who), deadline, priority, note })}>
        {busy ? <Skel className="inline-block h-3 w-16" /> : L("Approve and create the task", "Luluskan dan cipta tugasan")}
      </button>
    </div>
  );
}

/* ---- the ask form (module scope: it holds an input) ---- */
function AskForm({ desk, left, busy, onSubmit }: { desk: Desk; left: number; busy: boolean; onSubmit: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm">{L(desk.about.en, desk.about.ms)}</p>
      <label className="block"><span className={fieldLabel}>{L("Anything specific? (optional)", "Ada yang khusus? (pilihan)")}</span>
        <textarea className={`${inputClassSm} w-full`} rows={2} maxLength={400} value={q} placeholder={L("e.g. focus on the enquiries about packages", "cth. tumpukan pada pertanyaan tentang pakej")} onChange={(e) => setQ(e.target.value)} />
      </label>
      <p className="text-muted-foreground text-xs">{L(`${left} of your asks left today. The desk reads today's digest and proposes at most three things; nothing is sent anywhere.`, `${left} permintaan anda berbaki hari ini. Meja membaca ringkasan hari ini dan mencadangkan paling banyak tiga perkara; tiada apa dihantar ke mana-mana.`)}</p>
      <button type="button" className={btnSmPrimary} disabled={busy || left <= 0} onClick={() => onSubmit(q.trim())}>
        {busy ? <Skel className="inline-block h-3 w-16" /> : L("Ask now", "Tanya sekarang")}
      </button>
    </div>
  );
}

/* ---- the brief editor (module scope: it holds a textarea) ---- */
function BriefEditor({ initial, canEdit, busy, onSave }: { initial: string; canEdit: boolean; busy: boolean; onSave: (t: string) => void }) {
  const [text, setText] = useState(initial);
  useEffect(() => { setText(initial); }, [initial]);
  if (!canEdit) return text ? <p className="whitespace-pre-wrap text-sm">{text}</p> : <p className="text-muted-foreground text-sm">{L("The CEO has not written the brief yet.", "CEO belum menulis ringkasan itu.")}</p>;
  return (
    <div className="space-y-2">
      <textarea className={`${inputClassSm} w-full`} rows={8} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={L("What we sell and at what price. Our tone in EN and BM. Promises we make. Things we never say. Who handles what.", "Apa yang kita jual dan pada harga berapa. Nada kita dalam EN dan BM. Janji yang kita buat. Perkara yang kita tidak pernah kata. Siapa uruskan apa.")} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSmPrimary} disabled={busy || text === initial} onClick={() => onSave(text)}>{busy ? <Skel className="inline-block h-3 w-12" /> : L("Save brief", "Simpan ringkasan")}</button>
        <span className="text-muted-foreground text-xs tabular-nums">{text.length} / 8000</span>
      </div>
    </div>
  );
}

/* ---- one proposal ---- */
function ProposalCard({ p, deskName, canDecide, canOpen, go, busy, onDecide }: {
  p: Proposal; deskName: string; canDecide: boolean; canOpen: (t: string) => boolean; go: (t: string) => void; busy: boolean;
  onDecide: (p: Proposal, decision: "approve" | "changes" | "reject" | "later") => void;
}) {
  const st = STATUS[p.status] ?? [p.status, p.status, chipSmNeutral];
  const open = ["proposed", "changes", "later"].includes(p.status);
  return (
    <article className={insetCard}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chipSmInfo}>{deskName}</span>
        <span className={chipSmNeutral}>{kindLabel(p.kind)}</span>
        <span className={PRIO[p.priority] ?? chipSmNeutral}>{p.priority}</span>
        <span className={st[2]}>{L(st[0], st[1])}</span>
        <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">{mytDateTime(p.created_at)}</span>
      </div>
      <p className="mt-2 text-sm font-semibold">{p.title}</p>
      <p className="mt-1 text-sm">{p.why}</p>
      {p.evidence.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {p.evidence.map((e) => e.tab && canOpen(e.tab)
            ? <button key={e.ref} type="button" className={`${chipSmNeutral} hover:bg-secondary/70`} title={e.ref} onClick={() => go(e.tab!)}>{e.label}</button>
            : <span key={e.ref} className={chipSmNeutral} title={e.ref}>{e.label}</span>)}
        </p>
      )}
      {p.draft && (
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div><p className={fieldLabel}>EN</p><p className="whitespace-pre-wrap text-sm">{p.draft.en}</p></div>
          <div><p className={fieldLabel}>BM</p><p className="whitespace-pre-wrap text-sm">{p.draft.ms}</p></div>
        </div>
      )}
      {p.triage && <p className="text-muted-foreground mt-1.5 text-xs">{L("Triage", "Saringan")}: {p.triage.sentiment} · {L("urgency", "keutamaan")} {p.triage.urgency}</p>}
      {p.plan.length > 0 && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">{p.plan.map((s, i) => <li key={i}>{s}</li>)}</ol>
      )}
      {(p.expected || p.measure || p.owner_hint) && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          {p.owner_hint && <>{L("Owner", "Pemilik")}: {p.owner_hint}. </>}
          {p.expected && <>{L("Expected", "Dijangka")}: {p.expected}. </>}
          {p.measure && <>{L("Measure", "Ukuran")}: {p.measure}</>}
        </p>
      )}
      {(p.decided_at || p.task_id) && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          {p.decided_name && <>{p.decided_name}{p.decided_at ? ` · ${mytDateTime(p.decided_at)}` : ""}</>}
          {p.decision_note && <> · {p.decision_note}</>}
          {p.task_id && <> · {L(`Task #${p.task_id}`, `Tugasan #${p.task_id}`)}</>}
          {p.status === "approved" && p.kind === "draft_reply" && <> · {L("shown in the reply box on Enquiries", "dipaparkan di kotak balasan Pertanyaan")}</>}
        </p>
      )}
      {canDecide && open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => onDecide(p, "approve")}>{L("Approve", "Luluskan")}</button>
          <button type="button" className={btnSm} disabled={busy} onClick={() => onDecide(p, "changes")}>{L("Ask for changes", "Minta perubahan")}</button>
          <button type="button" className={btnSm} disabled={busy} onClick={() => onDecide(p, "reject")}>{L("Reject", "Tolak")}</button>
          {p.status !== "later" && <button type="button" className={btnSm} disabled={busy} onClick={() => onDecide(p, "later")}>{L("Later", "Kemudian")}</button>}
        </div>
      )}
      {!canDecide && open && <p className="text-muted-foreground mt-2 text-xs">{L("Waiting for the CEO's decision.", "Menunggu keputusan CEO.")}</p>}
    </article>
  );
}

export function AdvisorsPanel({ go, canOpen }: { go: (tab: string) => void; canOpen: (tab: string) => boolean }) {
  const view = useCachedApi<Overview>("/staff/advisors", true, ["advisors", "enquiries"]);
  const ov = view.data;
  const refresh = view.refresh;
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const { prompt, node: promptNode } = usePrompt();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"open" | "approved" | "decided" | "all">("open");
  const [drawer, setDrawer] = useState<{ kind: "approve"; p: Proposal } | { kind: "ask"; desk: Desk } | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const canDecide = Boolean(ov?.can_decide);
  const deskName = (id: string) => { const d = ov?.desks.find((x) => x.id === id); return d ? L(d.name.en, d.name.ms) : id; };

  const decide = async (p: Proposal, decision: "approve" | "changes" | "reject" | "later", extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await api<Err>(`/proposals/${p.id}/decide`, { method: "POST", body: JSON.stringify({ decision, ...extra }) });
    setBusy(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, L("The server refused that", "Pelayan menolaknya")), "notice"); return false; }
    toast(decision === "approve" ? L("Approved", "Diluluskan") : decision === "reject" ? L("Rejected - the desk will remember why", "Ditolak - meja akan ingat sebabnya") : decision === "changes" ? L("Sent back for changes", "Dihantar semula untuk perubahan") : L("Parked for later", "Ditangguhkan"), p.title);
    setDrawer(null);
    refresh();
    return true;
  };
  const onDecide = async (p: Proposal, decision: "approve" | "changes" | "reject" | "later") => {
    if (decision === "approve") {
      if (p.kind === "draft_reply") {
        const ok = await confirm({ title: L("Approve this draft?", "Luluskan draf ini?"), message: L("It appears in the reply box on the Enquiries tab. Staff still read it, edit it and send it themselves.", "Ia muncul di kotak balasan tab Pertanyaan. Staf masih membaca, menyunting dan menghantarnya sendiri."), confirmLabel: L("Approve", "Luluskan") });
        if (ok) await decide(p, "approve");
      } else setDrawer({ kind: "approve", p });
      return;
    }
    if (decision === "later") { await decide(p, "later"); return; }
    const r = await prompt({
      title: decision === "reject" ? L("Why reject it?", "Kenapa tolak?") : L("What should change?", "Apa yang perlu diubah?"),
      message: decision === "reject" ? L("The reason is kept as a lesson: the desk reads its last ten before it proposes again.", "Sebabnya disimpan sebagai pengajaran: meja membaca sepuluh yang terakhir sebelum mencadang lagi.") : L("The desk revises it on its next run, or when you press Ask.", "Meja menyemaknya pada larian seterusnya, atau apabila anda tekan Tanya."),
      label: L("Your note", "Nota anda"), required: true, confirmLabel: decision === "reject" ? L("Reject", "Tolak") : L("Send back", "Hantar semula"), variant: decision === "reject" ? "danger" : "default",
    });
    if (!r || !r.value.trim()) return;
    await decide(p, decision, { note: r.value.trim() });
  };
  const ask = async (desk: Desk, question: string) => {
    setBusy(true);
    const r = await api<Err & { status?: string; proposals?: number; neurons?: number; note?: string }>("/ask", { method: "POST", body: JSON.stringify({ desk: desk.id, question }) });
    setBusy(false);
    if (!r.ok) { toast(L("The desk did not run", "Meja tidak berjalan"), say(r, ""), "notice"); return; }
    const d = r.data ?? {};
    const status = d.status ?? "done";
    toast(
      status === "done" ? L(`${d.proposals ?? 0} new proposal${d.proposals === 1 ? "" : "s"}`, `${d.proposals ?? 0} cadangan baharu`) : L(`Desk ${RUN_STATUS[status]?.[0] ?? status}`, `Meja ${RUN_STATUS[status]?.[1] ?? status}`),
      status === "done" ? L(`${n(d.neurons ?? 0)} neurons spent`, `${n(d.neurons ?? 0)} neuron digunakan`) : (d.note ?? ""),
      status === "done" ? "success" : "notice",
    );
    setDrawer(null);
    refresh();
  };
  const setting = async (body: Record<string, unknown>, done: [string, string]) => {
    setBusy(true);
    const r = await api<Err>("/settings", { method: "PUT", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, ""), "notice"); return; }
    toast(L(done[0], done[1]));
    refresh();
  };

  const waiting = ov?.proposals.filter((p) => p.status === "proposed").length ?? 0;
  const todayAll = ov?.desks.reduce((a, d) => a + d.today, 0) ?? 0;
  const monthAll = ov?.desks.reduce((a, d) => a + d.month, 0) ?? 0;
  const shown = (ov?.proposals ?? []).filter((p) =>
    filter === "open" ? ["proposed", "changes", "later"].includes(p.status)
    : filter === "approved" ? ["approved", "implemented", "verified"].includes(p.status)
    : filter === "decided" ? ["rejected", "expired"].includes(p.status)
    : true);

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}{confirmNode}{promptNode}

      {/* ---- the meter and the switch ---- */}
      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PanelTitle icon="idea">{L("Advisors", "Penasihat")} <span className="text-muted-foreground font-normal">· {L("five desks, your decision", "lima meja, keputusan anda")}</span></PanelTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              {L("The desks read what the portal already knows, propose at most three things each at 06:30, and wait. Nothing is sent, changed or created until the CEO approves it.", "Meja membaca apa yang portal sudah tahu, mencadangkan paling banyak tiga perkara setiap satu pada 06:30, dan menunggu. Tiada apa dihantar, diubah atau dicipta sehingga CEO meluluskannya.")}
            </p>
            <StaleHint show={Boolean(view.stale)} className="mt-1" />
          </div>
          {ov && canDecide && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ov.enabled} disabled={busy} onChange={(e) => void setting({ enabled: e.target.checked }, e.target.checked ? ["Advisors switched on", "Penasihat dihidupkan"] : ["Advisors switched off - no desk will run", "Penasihat dimatikan - tiada meja akan berjalan"])} />
              {ov.enabled ? L("On", "Hidup") : L("Off", "Mati")}
            </label>
          )}
        </div>
        {!ov ? <SkelRows rows={2} className="mt-3" /> : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
              <StatTile label={L("Waiting for you", "Menunggu anda")} value={waiting} tone={waiting ? "gold" : "muted"} />
              <StatTile label={L("Neurons today", "Neuron hari ini")} value={`${n(todayAll)} / ${n(ov.free_per_day)}`} tone={todayAll > ov.global_cap ? "danger" : "brand"} hint={L(`free every day · cap ${n(ov.global_cap)}`, `percuma setiap hari · had ${n(ov.global_cap)}`)} />
              <StatTile label={L("This month", "Bulan ini")} value={n(monthAll)} tone="info" hint={L("neurons, all desks", "neuron, semua meja")} />
              <StatTile label={L("Asks left today", "Permintaan berbaki hari ini")} value={`${ov.asks_left} / ${ov.max_asks}`} tone="muted" />
            </div>
            {!ov.ai_bound && <p className="text-warning mt-2 text-xs">{L("Workers AI is not bound yet - run PUSH.bat so the [ai] binding deploys. Until then no desk can run.", "Workers AI belum diikat - jalankan PUSH.bat supaya ikatan [ai] dikerahkan. Sehingga itu tiada meja boleh berjalan.")}</p>}
            {ov.ai_bound && !ov.gateway && canDecide && <p className="text-muted-foreground mt-2 text-xs">{L("Tip: create an AI Gateway in the Cloudflare dashboard, set AI_GATEWAY_ID in wrangler.toml, and every call gets a cache, a log and a dollar spend limit.", "Petua: cipta AI Gateway di papan pemuka Cloudflare, tetapkan AI_GATEWAY_ID dalam wrangler.toml, dan setiap panggilan mendapat cache, log dan had perbelanjaan dolar.")}</p>}
          </>
        )}
      </section>

      {/* ---- the five desks ---- */}
      <section className={card}>
        <PanelTitle icon="assignment">{L("The desks", "Meja-meja")}</PanelTitle>
        {!ov ? <SkelRows rows={3} className="mt-3" /> : (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {ov.desks.map((d) => {
              const last = d.last;
              return (
                <div key={d.id} className={insetCard}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{L(d.name.en, d.name.ms)}</span>
                    {d.planned ? <span className={chipSmNeutral}>{L(`planned · ${d.planned}`, `dirancang · ${d.planned}`)}</span>
                      : !ov.enabled || !d.enabled ? <span className={chipSmDanger}>{L("off", "mati")}</span>
                      : <span className={chipSmSuccess}>{L("active", "aktif")}</span>}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{L(d.about.en, d.about.ms)}</p>
                  {!d.planned && (
                    <p className="text-muted-foreground mt-1.5 text-xs tabular-nums">
                      {last ? L(`Last: ${RUN_STATUS[last.status]?.[0] ?? last.status} · ${mytDateTime(last.started_at)}${last.proposals ? ` · ${last.proposals} proposed` : ""}${last.note ? ` · ${last.note}` : ""}`, `Terakhir: ${RUN_STATUS[last.status]?.[1] ?? last.status} · ${mytDateTime(last.started_at)}${last.proposals ? ` · ${last.proposals} dicadang` : ""}${last.note ? ` · ${last.note}` : ""}`) : L("Has not run yet", "Belum berjalan")}
                      {" · "}{L(`today ${n(d.today)} · month ${n(d.month)} neurons`, `hari ini ${n(d.today)} · bulan ${n(d.month)} neuron`)}
                      {d.lessons > 0 && <> · {L(`${d.lessons} lesson${d.lessons === 1 ? "" : "s"}`, `${d.lessons} pengajaran`)}</>}
                    </p>
                  )}
                  {!d.planned && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" className={btnSm} disabled={busy || !ov.enabled || !d.enabled || ov.asks_left <= 0} onClick={() => setDrawer({ kind: "ask", desk: d })}>{L("Ask the desk", "Tanya meja")}</button>
                      {canDecide && (
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={d.enabled} disabled={busy} onChange={(e) => void setting({ desk: d.id, desk_enabled: e.target.checked }, e.target.checked ? [`${d.name.en} desk on`, `Meja ${d.name.ms} hidup`] : [`${d.name.en} desk off`, `Meja ${d.name.ms} mati`])} />
                          {L("on", "hidup")}
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- the queue ---- */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle icon="verify">{L("Proposals", "Cadangan")} <span className="text-muted-foreground font-normal tabular-nums">· {shown.length}</span></PanelTitle>
          <div role="tablist" className="flex flex-wrap gap-1.5">
            {([["open", L("Waiting", "Menunggu")], ["approved", L("Approved", "Diluluskan")], ["decided", L("Rejected", "Ditolak")], ["all", L("All recent", "Semua terkini")]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? tabPillOn : tabPill} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
        </div>
        {!ov ? <SkelRows rows={4} className="mt-3" /> : shown.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {filter === "open"
              ? L("Nothing is waiting. The desks run at 06:30; press Ask the desk to run one now.", "Tiada apa yang menunggu. Meja berjalan pada 06:30; tekan Tanya meja untuk menjalankan satu sekarang.")
              : L("Nothing here in the last seven days.", "Tiada apa di sini dalam tujuh hari lepas.")}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {shown.map((p) => <ProposalCard key={p.id} p={p} deskName={deskName(p.desk)} canDecide={canDecide} canOpen={canOpen} go={go} busy={busy} onDecide={onDecide} />)}
          </div>
        )}
      </section>

      {/* ---- the brief every desk reads first ---- */}
      <section className={card}>
        <PanelTitle icon="document">{L("Company brief", "Ringkasan syarikat")} <span className="text-muted-foreground font-normal">· {L("what every desk reads first", "apa yang setiap meja baca dahulu")}</span></PanelTitle>
        <p className="text-muted-foreground mt-1 text-xs">{L("One page in the CEO's words: products, services and packages with prices; tone in EN and BM; promises we make; things we never say; who handles what. Cached, so it costs nothing per run.", "Satu halaman dalam kata-kata CEO: produk, perkhidmatan dan pakej dengan harga; nada dalam EN dan BM; janji yang kita buat; perkara yang kita tidak pernah kata; siapa uruskan apa. Dicache, jadi tiada kos setiap larian.")}</p>
        <div className="mt-3">{!ov ? <SkelRows rows={3} /> : <BriefEditor initial={ov.brief} canEdit={canDecide} busy={busy} onSave={(t) => void setting({ brief: t }, ["Brief saved - every desk reads it from its next run", "Ringkasan disimpan - setiap meja membacanya dari larian seterusnya"])} />}</div>
      </section>

      {/* ---- settings and the run log ---- */}
      {ov && canDecide && (
        <section className={card}>
          <PanelTitle icon="fix">{L("Settings", "Tetapan")}</PanelTitle>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block"><span className={fieldLabel}>{L("Model (Workers AI)", "Model (Workers AI)")}</span>
              <select className={`${selectClass} w-full`} value={ov.model} disabled={busy} onChange={(e) => void setting({ model: e.target.value }, ["Model changed for the next run", "Model ditukar untuk larian seterusnya"])}>
                {MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="block"><span className={fieldLabel}>{L("Daily cap, all desks (neurons)", "Had harian, semua meja (neuron)")}</span>
              <select className={`${selectClass} w-full`} value={String(ov.global_cap)} disabled={busy} onChange={(e) => void setting({ cap: Number(e.target.value) }, ["Cap saved", "Had disimpan"])}>
                {[3000, 6000, 9000, 15000, 30000].map((c) => <option key={c} value={c}>{n(c)}{c <= ov.free_per_day ? ` · ${L("inside the free allowance", "dalam peruntukan percuma")}` : ""}</option>)}
              </select>
            </label>
          </div>
        </section>
      )}
      {ov && (
        <section className={card}>
          <button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={showRuns} onClick={() => setShowRuns((v) => !v)}>
            <PanelTitle icon="time">{L("Run log", "Log larian")} <span className="text-muted-foreground font-normal tabular-nums">· {ov.runs.length}</span></PanelTitle>
            <span aria-hidden className={`text-muted-foreground text-xs transition-transform ${showRuns ? "rotate-180" : ""}`}>▾</span>
          </button>
          {showRuns && (ov.runs.length === 0 ? <p className="text-muted-foreground mt-3 text-sm">{L("No run yet.", "Belum ada larian.")}</p> : (
            <ul className="divide-border mt-3 divide-y text-xs">
              {ov.runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 tabular-nums">
                  <span className="text-muted-foreground w-32">{mytDateTime(r.started_at)}</span>
                  <span className="font-medium">{deskName(r.desk)}</span>
                  <span className={r.status === "done" ? chipSmSuccess : r.status === "failed" ? chipSmDanger : chipSmNeutral}>{runLabel(r.status)}</span>
                  <span className="text-muted-foreground">{r.trigger}</span>
                  <span>{n(r.input_tokens + r.output_tokens)} {L("tokens", "token")} · {n(r.neurons)} {L("neurons", "neuron")}{r.proposals ? ` · ${r.proposals} ${L("proposed", "dicadang")}` : ""}</span>
                  {r.note && <span className="text-muted-foreground min-w-0 whitespace-pre-line">{r.note}</span>}
                </li>
              ))}
            </ul>
          ))}
        </section>
      )}

      {drawer?.kind === "approve" && ov && (
        <Drawer title={L("Approve", "Luluskan")} sub={drawer.p.title} onClose={closeDrawer}>
          <ApproveForm p={drawer.p} people={ov.people} busy={busy} onSubmit={(v) => void decide(drawer.p, "approve", v)} />
        </Drawer>
      )}
      {drawer?.kind === "ask" && ov && (
        <Drawer title={L(`Ask the ${drawer.desk.name.en} desk`, `Tanya meja ${drawer.desk.name.ms}`)} onClose={closeDrawer}>
          <AskForm desk={drawer.desk} left={ov.asks_left} busy={busy} onSubmit={(q) => void ask(drawer.desk, q)} />
        </Drawer>
      )}
    </div>
  );
}
