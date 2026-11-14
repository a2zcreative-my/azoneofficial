"use client";

/* v1.305.0 - ASSETS WORKSPACE 4.0, PHASE 3: MAINTENANCE AND DISPOSAL (the
   CEO, 14-11-2026: "Phase 3"; claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md
   section 6, D-6, D-8; migration 0195). Three pieces; the server decides
   every action (worker/src/assets.ts handleCare):

     CareBoard    the Maintenance & Disposal tab: In Repair / Lost / Disposed
                  counts, what waits (open issues, disposals to decide), and
                  the sub-tabs In Repair · Lost · Disposed · Service History
     CarePanel    one asset's Maintenance tab: its records, and the actions
                  the viewer may take on it
     CareReport   Report an issue / Report lost, from My assets (the holder or
                  their manager) and from the board (the register's readers)
   A repair cost and disposal proceeds are notes; an expense is only linked
   (read only). Nothing here writes to Finance. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dmy, dmyMYT, fmtRM as rm } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import av from "./assets-page.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Toast = (t: string, m: string, v?: "notice") => void;
type Err = { error?: { message?: string } };
const msgOf = (r: { data: unknown }) => (r.data as Err | null)?.error?.message ?? L("Please try again.", "Sila cuba lagi.");

export const METHODS: [string, string, string][] = [
  ["sold", "Sold", "Dijual"], ["scrapped", "Scrapped", "Dilupus sebagai sisa"], ["donated", "Donated", "Didermakan"],
  ["returned_to_vendor", "Returned to vendor", "Dipulangkan kepada pembekal"], ["written_off", "Written off (a record only — nothing is posted)", "Dihapus kira (rekod sahaja — tiada catatan)"],
];
const methodLabel = (k: string | null) => { const m = METHODS.find(([v]) => v === k); return m ? L(m[1], m[2]).replace(/ \(.*\)$/, "") : k ?? "—"; };
const EVENT: Record<string, [string, string, string]> = {
  "issue:report": ["Issue reported", "Isu dilaporkan", chipSmWarn], "issue:resolve": ["Issue resolved", "Isu diselesaikan", chipSmSuccess],
  "repair:sent": ["Sent for repair", "Dihantar untuk dibaiki", chipSmWarn], "repair:back": ["Back from repair", "Kembali dari pembaikan", chipSmInfo],
  "incident:lost": ["Reported lost", "Dilaporkan hilang", chipSmDanger], "incident:found": ["Found", "Dijumpai", chipSmSuccess],
  "disposal:request": ["Disposal requested", "Pelupusan dimohon", chipSmWarn], "disposal:approve": ["Disposal approved", "Pelupusan diluluskan", chipSmNeutral],
  "disposal:reject": ["Disposal rejected", "Pelupusan ditolak", chipSmInfo],
};
export interface CareEvent { area: string; id: number; asset_id: number; kind: string; detail: string | null; day: string | null; repairer: string | null; reference: string | null; outcome: string | null; method: string | null; cost_cents?: number | null; proceeds_cents?: number | null; expense_id?: number | null; place: string | null; police_ref: string | null; created_at: string; actor: string | null; asset_tag: string; name: string }
export const eventLabel = (e: { area: string; kind: string }) => { const w = EVENT[`${e.area}:${e.kind}`]; return w ? L(w[0], w[1]) : `${e.area} ${e.kind}`; };
const eventChip = (e: CareEvent) => { const w = EVENT[`${e.area}:${e.kind}`] ?? [e.kind, e.kind, chipSmNeutral]; return <span className={w[2]}>{L(w[0], w[1])}</span>; };
/** what one record says, in a line - money only as the note it is */
export const eventText = (e: CareEvent) => [
  e.area === "repair" && e.kind === "sent" ? [e.repairer, e.reference ? `ref ${e.reference}` : null, e.day ? L(`expected back ${dmy(e.day)}`, `dijangka kembali ${dmy(e.day)}`) : null].filter(Boolean).join(" · ") : null,
  e.area === "repair" && e.kind === "back" ? (e.outcome === "fixed" ? L("fixed", "dibaiki") : L("not repairable", "tidak boleh dibaiki")) : null,
  e.area === "incident" && e.kind === "lost" ? [e.place ? L(`last seen at ${e.place}`, `kali terakhir dilihat di ${e.place}`) : null, e.day ? dmy(e.day) : null, e.police_ref ? L(`police ref ${e.police_ref}`, `rujukan polis ${e.police_ref}`) : null].filter(Boolean).join(" · ") : null,
  e.area === "incident" && e.kind === "found" && e.place ? L(`found at ${e.place}`, `dijumpai di ${e.place}`) : null,
  e.area === "issue" && e.kind === "report" && e.day ? L(`since ${dmy(e.day)}`, `sejak ${dmy(e.day)}`) : null,
  e.method ? methodLabel(e.method) : null,
  e.detail,
  e.cost_cents != null ? L(`repair cost (note) ${rm(e.cost_cents)}`, `kos pembaikan (nota) ${rm(e.cost_cents)}`) : null,
  e.expense_id != null ? L(`expense #${e.expense_id}`, `perbelanjaan #${e.expense_id}`) : null,
  e.proceeds_cents != null ? L(`proceeds (note) ${rm(e.proceeds_cents)}`, `hasil (nota) ${rm(e.proceeds_cents)}`) : null,
].filter(Boolean).join(" · ");

function Timeline({ events, withAsset }: { events: CareEvent[]; withAsset?: boolean }) {
  return (
    <ol className={av.timeline} data-testid="care-events">
      {events.map((e) => (
        <li key={`${e.area}${e.id}`}>
          <span className={av.strong}>{eventChip(e)}{withAsset ? <> <span className={av.mono}>{e.asset_tag}</span> {e.name}</> : null}</span>
          {eventText(e) && <span>{eventText(e)}</span>}
          <span className={av.muted}>{dmyMYT(e.created_at)} · {e.actor ?? "—"}</span>
        </li>
      ))}
    </ol>
  );
}

const post = (assetId: number, body: Record<string, unknown>) => api<Err>(`/staff/assets/${assetId}/care`, { method: "POST", body: JSON.stringify(body) });

/* ------------------------------------------------------------------ report an issue or a loss */
export function CareReport({ assetId, what, toast, onDone, onCancel }: { assetId: number; what: "issue" | "lost"; toast: Toast; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ text: "", day: "", place: "", police: "" });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const r = await post(assetId, what === "issue" ? { action: "issue", description: f.text, noticed_on: f.day } : { action: "lost", circumstances: f.text, last_seen_on: f.day, last_seen_place: f.place, police_ref: f.police });
    setBusy(false);
    if (!r.ok) { toast(L("Not sent", "Tidak dihantar"), msgOf(r), "notice"); return; }
    toast(what === "issue" ? L("Issue reported", "Isu dilaporkan") : L("Reported lost", "Dilaporkan hilang"), L("The register's keepers are told.", "Penjaga daftar dimaklumkan.")); onDone();
  };
  return (
    <div className={av.custForm} data-testid={what === "issue" ? "care-issue-form" : "care-lost-form"}>
      <label className={av.field}><span>{what === "issue" ? L("What is wrong *", "Apa yang rosak *") : L("What happened *", "Apa yang berlaku *")}</span>
        <input className={inputClassSm} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={L("at least 10 characters", "sekurang-kurangnya 10 aksara")} data-testid="care-text" /></label>
      <label className={av.field}><span>{what === "issue" ? L("Since when", "Sejak bila") : L("Last seen on", "Kali terakhir dilihat pada")}</span>
        <input type="date" className={inputClassSm} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></label>
      {what === "lost" && <>
        <label className={av.field}><span>{L("Last seen where", "Kali terakhir dilihat di mana")}</span><input className={inputClassSm} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></label>
        <label className={av.field}><span>{L("Police report ref (optional)", "Rujukan laporan polis (pilihan)")}</span><input className={inputClassSm} value={f.police} onChange={(e) => setF({ ...f, police: e.target.value })} /></label>
      </>}
      <div className={av.custActs}>
        <button type="button" className={btnSmPrimary} disabled={busy || f.text.trim().length < 10} onClick={() => void send()} data-testid="care-send">{what === "issue" ? L("Report the issue", "Laporkan isu") : L("Report it lost", "Laporkan hilang")}</button>
        <button type="button" className={btnSm} onClick={onCancel}>{L("Cancel", "Batal")}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ one asset's Maintenance tab */
interface PanelData { events: CareEvent[]; status: string; open: { issues: number[]; repair: number | null; lost: number | null; disposal: { id: number; method: string; requested_by_id: number } | null }; me: number; can: { report: boolean; lost: boolean; manage: boolean; approve: boolean; money: boolean; own_ok?: boolean } }
type Form = "" | "issue" | "lost" | "sent" | "back" | "found" | "resolve" | "dispose" | "decide";
export function CarePanel({ assetId, held, toast, onChanged }: { assetId: number; held: boolean; toast: Toast; onChanged: () => void }) {
  const [d, setD] = useState<PanelData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<Form>("");
  const [f, setF] = useState({ repairer: "", reference: "", expected_on: "", note: "", outcome: "fixed", cost: "", expense_id: "", where: "", method: "sold", reason: "", proceeds: "", issue_id: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void api<PanelData>(`/staff/assets/${assetId}/care`).then((r) => { if (!live) return; if (r.ok && r.data) { setD(r.data); setFailed(false); } else setFailed(true); }); return () => { live = false; }; }, [assetId, tick]);
  const done = () => { setForm(""); setF((x) => ({ ...x, note: "", reason: "", cost: "", expense_id: "", where: "", proceeds: "" })); setTick((t) => t + 1); onChanged(); };
  const send = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await post(assetId, body);
    setBusy(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), msgOf(r), "notice"); return; }
    toast(ok, ""); done();
  };
  if (failed && !d) return <p className={av.empty}><AppIcon name="warning" />{L("The maintenance records could not be read just now.", "Rekod penyelenggaraan tidak dapat dibaca sekarang.")}</p>;
  if (!d) return <SkelRows rows={3} />;
  const s = d.status;
  const toggle = (k: Form) => setForm(form === k ? "" : k);
  const ownRequest = !!d.open.disposal && d.open.disposal.requested_by_id === d.me && !d.can.own_ok;
  return (
    <div className={av.custPanel} data-testid="care-panel">
      <div className={av.custActs}>
        {d.can.report && <button type="button" className={btnSm} onClick={() => toggle("issue")} data-testid="care-issue">{L("Report issue", "Lapor isu")}</button>}
        {d.can.lost && <button type="button" className={btnSm} onClick={() => toggle("lost")} data-testid="care-lost">{L("Report lost", "Lapor hilang")}</button>}
        {d.can.manage && s !== "disposed" && s !== "lost" && !d.open.repair && <button type="button" className={btnSm} onClick={() => toggle("sent")} data-testid="care-sent">{L("Send for repair", "Hantar untuk dibaiki")}</button>}
        {d.can.manage && s === "repair" && <button type="button" className={btnSm} onClick={() => toggle("back")} data-testid="care-back">{L("Back from repair", "Kembali dari pembaikan")}</button>}
        {d.can.manage && s === "lost" && <button type="button" className={btnSm} onClick={() => toggle("found")} data-testid="care-found">{L("Found again", "Dijumpai semula")}</button>}
        {d.can.manage && d.open.issues.length > 0 && <button type="button" className={btnSm} onClick={() => toggle("resolve")}>{L("Resolve issue", "Selesaikan isu")}</button>}
        {d.can.manage && s !== "disposed" && !d.open.disposal && <button type="button" className={btnSm} disabled={held} title={held ? L("Someone holds it — return it first", "Seseorang memegangnya — pulangkan dahulu") : undefined} onClick={() => toggle("dispose")} data-testid="care-dispose">{L("Request disposal", "Mohon pelupusan")}</button>}
        {d.can.approve && d.open.disposal && !ownRequest && <button type="button" className={btnSmPrimary} onClick={() => toggle("decide")} data-testid="care-decide">{L("Decide disposal", "Putuskan pelupusan")}</button>}
      </div>
      {d.open.disposal && <p className={av.warnText}>{L(`Disposal requested (${methodLabel(d.open.disposal.method)}) — waiting for the CEO or COO.`, `Pelupusan dimohon (${methodLabel(d.open.disposal.method)}) — menunggu CEO atau COO.`)}{ownRequest ? L(" You requested it — the other approver decides.", " Anda memohonnya — pelulus lain memutuskan.") : ""}</p>}
      {held && d.can.manage && s !== "disposed" && !d.open.disposal && <p className={av.sub}>{L("A disposal is requested once nobody holds the asset — return it first.", "Pelupusan dimohon apabila tiada sesiapa memegang aset — pulangkan dahulu.")}</p>}

      {(form === "issue" || form === "lost") && <CareReport assetId={assetId} what={form} toast={toast} onDone={done} onCancel={() => setForm("")} />}
      {form === "sent" && (
        <div className={av.custForm}>
          <label className={av.field}><span>{L("Repairer *", "Pembaiki *")}</span><input className={inputClassSm} value={f.repairer} onChange={(e) => setF({ ...f, repairer: e.target.value })} placeholder={L("shop, technician or in-house", "kedai, juruteknik atau dalaman")} data-testid="care-repairer" /></label>
          <label className={av.field}><span>{L("Reference", "Rujukan")}</span><input className={inputClassSm} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={L("job or ticket no.", "no. kerja atau tiket")} /></label>
          <label className={av.field}><span>{L("Expected back", "Dijangka kembali")}</span><input type="date" className={inputClassSm} value={f.expected_on} onChange={(e) => setF({ ...f, expected_on: e.target.value })} /></label>
          {d.open.issues.length > 0 && (
            <label className={av.field}><span>{L("For the issue", "Untuk isu")}</span>
              <select className={selectClassSm} value={f.issue_id} onChange={(e) => setF({ ...f, issue_id: e.target.value })}>
                <option value="">{L("None", "Tiada")}</option>
                {d.events.filter((e) => e.area === "issue" && e.kind === "report" && d.open.issues.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{(e.detail ?? "").slice(0, 60)}</option>)}
              </select></label>
          )}
          <label className={av.field}><span>{L("Note", "Nota")}</span><input className={inputClassSm} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <p className={av.sub}>{L("A passed expected-back date becomes one Task for you.", "Tarikh dijangka kembali yang berlalu menjadi satu Tugasan untuk anda.")}</p>
          <button type="button" className={btnSmPrimary} disabled={busy || f.repairer.trim().length < 2} onClick={() => void send({ action: "repair_sent", repairer: f.repairer, reference: f.reference, expected_on: f.expected_on, note: f.note, issue_id: f.issue_id || (d.open.issues.length === 1 ? d.open.issues[0] : "") }, L("Sent for repair", "Dihantar untuk dibaiki"))} data-testid="care-save">{L("Record it sent", "Rekod dihantar")}</button>
        </div>
      )}
      {form === "back" && (
        <div className={av.custForm}>
          <label className={av.field}><span>{L("Outcome *", "Keputusan *")}</span>
            <select className={selectClassSm} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} data-testid="care-outcome">
              <option value="fixed">{L(held ? "Fixed — back to its holder" : "Fixed — back to Spare", held ? "Dibaiki — kembali kepada pemegang" : "Dibaiki — kembali ke Simpanan")}</option>
              <option value="not_repairable">{L("Not repairable — stays In repair until a disposal", "Tidak boleh dibaiki — kekal Dalam pembaikan sehingga pelupusan")}</option>
            </select></label>
          <label className={av.field}><span>{L("Repair cost, RM (a note)", "Kos pembaikan, RM (nota)")}</span><input inputMode="decimal" className={inputClassSm} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
          <label className={av.field}><span>{L("Expense no. in Finance (optional link)", "No. perbelanjaan dalam Kewangan (pautan pilihan)")}</span><input inputMode="numeric" className={inputClassSm} value={f.expense_id} onChange={(e) => setF({ ...f, expense_id: e.target.value })} /></label>
          <label className={av.field}><span>{f.outcome === "not_repairable" ? L("Why it cannot be repaired *", "Sebab tidak boleh dibaiki *") : L("Note", "Nota")}</span><input className={inputClassSm} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <p className={av.sub}>{L("The cost is kept as a note. The bill itself is paid and recorded in Finance → Expenses; nothing is posted from here.", "Kos disimpan sebagai nota. Bil dibayar dan direkod dalam Kewangan → Perbelanjaan; tiada apa dicatat dari sini.")}</p>
          <button type="button" className={btnSmPrimary} disabled={busy || (f.outcome === "not_repairable" && f.note.trim().length < 5)} onClick={() => void send({ action: "repair_back", outcome: f.outcome, cost: f.cost, expense_id: f.expense_id, note: f.note }, L("Back from repair", "Kembali dari pembaikan"))} data-testid="care-save">{L("Record it back", "Rekod kembali")}</button>
        </div>
      )}
      {form === "found" && (
        <div className={av.custForm}>
          <label className={av.field}><span>{L("Found where", "Dijumpai di mana")}</span><input className={inputClassSm} value={f.where} onChange={(e) => setF({ ...f, where: e.target.value })} /></label>
          <label className={av.field}><span>{L("Note", "Nota")}</span><input className={inputClassSm} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void send({ action: "found", where: f.where, note: f.note }, L("Recorded as found", "Direkod sebagai dijumpai"))} data-testid="care-save">{L("Record it found", "Rekod dijumpai")}</button>
        </div>
      )}
      {form === "resolve" && (
        <div className={av.custForm}>
          <label className={av.field}><span>{L("Issue", "Isu")}</span>
            <select className={selectClassSm} value={f.issue_id} onChange={(e) => setF({ ...f, issue_id: e.target.value })}>
              <option value="">{L("Choose…", "Pilih…")}</option>
              {d.events.filter((e) => e.area === "issue" && e.kind === "report" && d.open.issues.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{(e.detail ?? "").slice(0, 60)}</option>)}
            </select></label>
          <label className={av.field}><span>{L("How it was resolved *", "Cara diselesaikan *")}</span><input className={inputClassSm} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <button type="button" className={btnSmPrimary} disabled={busy || !f.issue_id || f.note.trim().length < 5} onClick={() => void send({ action: "resolve", issue_id: Number(f.issue_id), note: f.note }, L("Issue resolved", "Isu diselesaikan"))}>{L("Resolve", "Selesaikan")}</button>
        </div>
      )}
      {form === "dispose" && (
        <div className={av.custForm} data-testid="care-dispose-form">
          <label className={av.field}><span>{L("How *", "Bagaimana *")}</span>
            <select className={selectClassSm} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} data-testid="care-method">{METHODS.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
          <label className={av.field}><span>{L("Reason *", "Sebab *")}</span><input className={inputClassSm} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={L("at least 10 characters", "sekurang-kurangnya 10 aksara")} data-testid="care-reason" /></label>
          {f.method === "sold" && <label className={av.field}><span>{L("Proceeds, RM (a note)", "Hasil, RM (nota)")}</span><input inputMode="decimal" className={inputClassSm} value={f.proceeds} onChange={(e) => setF({ ...f, proceeds: e.target.value })} /></label>}
          <p className={av.sub}>{L("The CEO or COO approves or rejects it — never the person who asked. Approval marks it Disposed; the record stays. No write-off is posted and proceeds are not income here — Finance records a sale in its own module.", "CEO atau COO meluluskan atau menolaknya — tidak sekali-kali pemohon. Kelulusan menandakannya Dilupuskan; rekod kekal. Tiada hapus kira dicatat dan hasil bukan pendapatan di sini — Kewangan merekod jualan dalam modulnya sendiri.")}</p>
          <button type="button" className={btnSmPrimary} disabled={busy || f.reason.trim().length < 10} onClick={() => void send({ action: "disposal_request", method: f.method, reason: f.reason, proceeds: f.method === "sold" ? f.proceeds : "" }, L("Disposal requested", "Pelupusan dimohon"))} data-testid="care-save">{L("Request the disposal", "Mohon pelupusan")}</button>
        </div>
      )}
      {form === "decide" && <Decide assetId={assetId} toast={toast} onDone={done} />}

      {d.events.length === 0 ? <p className={av.sub}>{L("No maintenance record yet. A status set before 4.0 is the starting point — earlier changes are in the History tab.", "Belum ada rekod penyelenggaraan. Status sebelum 4.0 ialah titik mula — perubahan terdahulu ada dalam tab Sejarah.")}</p> : <Timeline events={d.events} />}
      {!d.can.money && d.events.length > 0 && <p className={av.sub}>{L("Costs are kept with the register's keepers.", "Kos disimpan oleh penjaga daftar.")}</p>}
    </div>
  );
}

function Decide({ assetId, toast, onDone }: { assetId: number; toast: Toast; onDone: () => void }) {
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    const r = await post(assetId, { action: "disposal_decide", decision, reason: why });
    setBusy(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), msgOf(r), "notice"); return; }
    toast(decision === "approve" ? L("Approved — marked Disposed", "Diluluskan — ditanda Dilupuskan") : L("Rejected", "Ditolak"), ""); onDone();
  };
  return (
    <div className={av.custActs}>
      <input className={inputClassSm} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={L("Reason (needed to reject)", "Sebab (perlu untuk menolak)")} aria-label={L("Reason", "Sebab")} />
      <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void decide("approve")} data-testid="care-approve">{L("Approve", "Luluskan")}</button>
      <button type="button" className={btnSm} disabled={busy || why.trim().length < 5} onClick={() => void decide("reject")} data-testid="care-reject">{L("Reject", "Tolak")}</button>
    </div>
  );
}

/* ------------------------------------------------------------------ the Maintenance & Disposal tab */
interface Board {
  issues: { id: number; asset_id: number; asset_tag: string; name: string; status: string; description: string; noticed_on: string | null; created_at: string; reported_by: string | null }[];
  repair: { id: number; asset_tag: string; name: string; location: string | null; holder: string | null; repair_id: number | null; repairer: string | null; reference: string | null; expected_on: string | null; sent_at: string | null }[];
  lost: { id: number; asset_tag: string; name: string; holder: string | null; incident_id: number | null; last_seen_place: string | null; last_seen_on: string | null; circumstances: string | null; police_ref: string | null; reported_at: string | null; reported_by: string | null }[];
  disposed: { id: number; asset_tag: string; name: string; approval_id: number | null; method: string | null; reason: string | null; proceeds_cents: number | null; disposed_at: string | null; approved_by: string | null; requested_by: string | null }[];
  pending: { id: number; asset_id: number; asset_tag: string; name: string; status: string; method: string; reason: string; proceeds_cents: number | null; created_at: string; requested_by_id: number; requested_by: string | null }[];
  history: CareEvent[]; me: number; can: { manage: boolean; approve: boolean; own_ok?: boolean };
}
type Sub = "repair" | "lost" | "disposed" | "history";
export function CareBoard({ toast, onChanged, openAsset, assets, refreshKey }: { toast: Toast; onChanged: () => void; openAsset: (id: number) => void; assets: { id: number; asset_tag: string; name: string; status: string }[]; refreshKey: number }) {
  const [b, setB] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [sub, setSub] = useState<Sub>("repair");
  const [rep, setRep] = useState<{ id: string; what: "issue" | "lost" } | null>(null);
  const [deciding, setDeciding] = useState<number | null>(null);
  useEffect(() => { let live = true; void api<Board>("/staff/assets/care").then((r) => { if (!live) return; if (r.ok && r.data) { setB(r.data); setFailed(false); } else setFailed(true); }); return () => { live = false; }; }, [tick, refreshKey]);
  const changed = () => { setRep(null); setDeciding(null); setTick((t) => t + 1); onChanged(); };
  if (failed && !b) return <section className={card}><p className={av.empty}><AppIcon name="warning" />{L("Maintenance and disposal could not be read just now — try again later.", "Penyelenggaraan dan pelupusan tidak dapat dibaca sekarang — cuba lagi kemudian.")}</p></section>;
  const tag = (id: number, t: string) => <button type="button" className={`${av.mono} ${av.linkBtn} ${av.careTag}`} onClick={() => openAsset(id)}>{t}</button>;
  const SUBS: [Sub, string][] = [["repair", L("In Repair", "Dalam Pembaikan")], ["lost", L("Lost", "Hilang")], ["disposed", L("Disposed", "Dilupuskan")], ["history", L("Service History", "Sejarah Servis")]];
  const reportable = assets.filter((a) => a.status !== "disposed");
  return (
    <>
      <KpiRow label={L("Maintenance and disposal", "Penyelenggaraan dan pelupusan")}>
        <KpiTile icon="fix" tone="gold" label={L("In Repair", "Dalam Pembaikan")} value={b?.repair.length ?? 0} busy={!b} onClick={() => setSub("repair")} />
        <KpiTile icon="warning" tone="red" label={L("Lost", "Hilang")} value={b?.lost.length ?? 0} busy={!b} onClick={() => setSub("lost")} />
        <KpiTile icon="blocked" tone="navy" label={L("Disposed", "Dilupuskan")} value={b?.disposed.length ?? 0} busy={!b} onClick={() => setSub("disposed")} />
      </KpiRow>

      <section className={card} aria-label={L("Waiting", "Menunggu")} data-testid="care-waiting">
        <div className={av.head}><div className={av.lead}><span className={`${av.well} ${av.goldWell}`}><AppIcon name="pending" /></span>
          <div className={av.headText}><p className={av.title}>{L("Waiting on Maintenance", "Menunggu Penyelenggaraan")}</p><p className={av.sub}>{L("Issues reported and not yet repaired or resolved, and disposals waiting for the CEO or COO.", "Isu dilaporkan yang belum dibaiki atau diselesaikan, dan pelupusan menunggu CEO atau COO.")}</p></div></div>
          <span className={av.custActs}>
            <button type="button" className={btnSmPrimary} onClick={() => setRep(rep ? null : { id: "", what: "issue" })} data-testid="care-new">{L("+ Report Issue", "+ Lapor Isu")}</button>
          </span>
        </div>
        {rep && (
          <div className={av.custForm}>
            <span className={av.custActs}>
              <select className={selectClassSm} value={rep.id} onChange={(e) => setRep({ ...rep, id: e.target.value })} aria-label={L("Asset", "Aset")} data-testid="care-asset">
                <option value="">{L("Choose the asset…", "Pilih aset…")}</option>
                {reportable.map((a) => <option key={a.id} value={a.id}>{`${a.asset_tag} · ${a.name}`}</option>)}
              </select>
              <select className={selectClassSm} value={rep.what} onChange={(e) => setRep({ ...rep, what: e.target.value as "issue" | "lost" })} aria-label={L("What", "Apa")}>
                <option value="issue">{L("An issue (something is wrong)", "Isu (ada yang rosak)")}</option>
                <option value="lost">{L("Lost", "Hilang")}</option>
              </select>
            </span>
            {rep.id && <CareReport key={`${rep.id}${rep.what}`} assetId={Number(rep.id)} what={rep.what} toast={toast} onDone={changed} onCancel={() => setRep(null)} />}
          </div>
        )}
        {!b ? <SkelRows rows={2} /> : b.issues.length === 0 && b.pending.length === 0 ? <p className={av.empty}><AppIcon name="success" />{L("Nothing waiting — no open issue and no disposal to decide.", "Tiada yang menunggu — tiada isu terbuka dan tiada pelupusan untuk diputuskan.")}</p> : (
          <ul className={av.custList}>
            {b.pending.map((p) => (
              <li key={`d${p.id}`} data-testid="care-pending">
                <div className={av.custTop}>{tag(p.asset_id, p.asset_tag)}<strong>{p.name}</strong><span className={chipSmWarn}>{L("Disposal to decide", "Pelupusan untuk diputuskan")}</span></div>
                <span className={av.muted}>{methodLabel(p.method)} · {p.reason}{p.proceeds_cents != null ? L(` · proceeds (note) ${rm(p.proceeds_cents)}`, ` · hasil (nota) ${rm(p.proceeds_cents)}`) : ""} · {L(`asked by ${p.requested_by ?? "—"} on ${dmyMYT(p.created_at)}`, `dimohon oleh ${p.requested_by ?? "—"} pada ${dmyMYT(p.created_at)}`)}</span>
                {b.can.approve && (p.requested_by_id === b.me && !b.can.own_ok ? <span className={av.muted}>{L("Your own request — the other approver decides it.", "Permohonan anda sendiri — pelulus lain memutuskannya.")}</span>
                  : deciding === p.asset_id ? <Decide assetId={p.asset_id} toast={toast} onDone={changed} />
                  : <span className={av.custActs}><button type="button" className={btnSmPrimary} onClick={() => setDeciding(p.asset_id)} data-testid="care-decide">{L("Decide", "Putuskan")}</button></span>)}
              </li>
            ))}
            {b.issues.map((i) => (
              <li key={`i${i.id}`} data-testid="care-issue-row">
                <div className={av.custTop}>{tag(i.asset_id, i.asset_tag)}<strong>{i.name}</strong><span className={chipSmWarn}>{L("Issue open", "Isu terbuka")}</span></div>
                <span className={av.muted}>{i.description}{i.noticed_on ? L(` · since ${dmy(i.noticed_on)}`, ` · sejak ${dmy(i.noticed_on)}`) : ""} · {L(`reported by ${i.reported_by ?? "—"} on ${dmyMYT(i.created_at)}`, `dilaporkan oleh ${i.reported_by ?? "—"} pada ${dmyMYT(i.created_at)}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card} aria-label={L("Maintenance records", "Rekod penyelenggaraan")} data-testid="care-board">
        <span role="group" aria-label={L("Maintenance view", "Paparan penyelenggaraan")} className={`${av.mode} ${av.careTabs}`}>
          {SUBS.map(([k, label]) => <button key={k} type="button" aria-pressed={sub === k} onClick={() => setSub(k)} data-testid={`care-sub-${k}`}>{label}</button>)}
        </span>
        {!b ? <SkelRows rows={3} /> : sub === "repair" ? (
          b.repair.length === 0 ? <p className={av.empty}><AppIcon name="success" />{L("No assets in repair.", "Tiada aset dalam pembaikan.")}</p> : (
            <ul className={av.custList}>{b.repair.map((r) => (
              <li key={r.id} data-testid="care-row">
                <div className={av.custTop}>{tag(r.id, r.asset_tag)}<strong>{r.name}</strong>{r.expected_on && r.expected_on < new Date().toISOString().slice(0, 10) ? <span className={chipSmDanger}>{L("Past its expected date", "Melepasi tarikh dijangka")}</span> : null}</div>
                <span className={av.muted}>{r.repair_id ? [r.repairer, r.reference ? `ref ${r.reference}` : null, r.sent_at ? L(`sent ${dmyMYT(r.sent_at)}`, `dihantar ${dmyMYT(r.sent_at)}`) : null, r.expected_on ? L(`expected back ${dmy(r.expected_on)}`, `dijangka kembali ${dmy(r.expected_on)}`) : null].filter(Boolean).join(" · ") : L("In repair with no repair record (set before 4.0, or returned damaged) — open it to record where it went.", "Dalam pembaikan tanpa rekod pembaikan (sebelum 4.0, atau dipulangkan rosak) — buka untuk merekod ke mana ia dihantar.")}{r.holder ? ` · ${r.holder}` : ""}</span>
              </li>
            ))}</ul>
          )
        ) : sub === "lost" ? (
          b.lost.length === 0 ? <p className={av.empty}><AppIcon name="success" />{L("No asset is recorded as lost.", "Tiada aset direkod hilang.")}</p> : (
            <ul className={av.custList}>{b.lost.map((r) => (
              <li key={r.id} data-testid="care-row">
                <div className={av.custTop}>{tag(r.id, r.asset_tag)}<strong>{r.name}</strong>{r.police_ref ? <span className={chipSmNeutral}>{L(`police ref ${r.police_ref}`, `rujukan polis ${r.police_ref}`)}</span> : null}</div>
                <span className={av.muted}>{r.incident_id ? [r.last_seen_place ? L(`last seen at ${r.last_seen_place}`, `kali terakhir dilihat di ${r.last_seen_place}`) : null, r.last_seen_on ? dmy(r.last_seen_on) : null, r.circumstances, L(`reported by ${r.reported_by ?? "—"}`, `dilaporkan oleh ${r.reported_by ?? "—"}`)].filter(Boolean).join(" · ") : L("Marked lost before 4.0 — no incident was recorded.", "Ditanda hilang sebelum 4.0 — tiada insiden direkod.")}{r.holder ? ` · ${L("last holder", "pemegang terakhir")} ${r.holder}` : ""}</span>
              </li>
            ))}</ul>
          )
        ) : sub === "disposed" ? (
          b.disposed.length === 0 ? <p className={av.empty}><AppIcon name="success" />{L("No asset is disposed.", "Tiada aset dilupuskan.")}</p> : (
            <ul className={av.custList}>{b.disposed.map((r) => (
              <li key={r.id} data-testid="care-row">
                <div className={av.custTop}>{tag(r.id, r.asset_tag)}<strong>{r.name}</strong>{r.method ? <span className={chipSmNeutral}>{methodLabel(r.method)}</span> : null}</div>
                <span className={av.muted}>{r.approval_id ? [r.reason, r.proceeds_cents != null ? L(`proceeds (note) ${rm(r.proceeds_cents)}`, `hasil (nota) ${rm(r.proceeds_cents)}`) : null, L(`asked by ${r.requested_by ?? "—"}, approved by ${r.approved_by ?? "—"}`, `dimohon oleh ${r.requested_by ?? "—"}, diluluskan oleh ${r.approved_by ?? "—"}`), r.disposed_at ? dmyMYT(r.disposed_at) : null].filter(Boolean).join(" · ") : L("Marked disposed before 4.0 — no approval was recorded.", "Ditanda dilupuskan sebelum 4.0 — tiada kelulusan direkod.")}</span>
              </li>
            ))}</ul>
          )
        ) : (
          b.history.length === 0 ? <p className={av.empty}><AppIcon name="time" />{L("No maintenance record yet.", "Belum ada rekod penyelenggaraan.")}</p> : <Timeline events={b.history} withAsset />
        )}
      </section>

      <section className={card} aria-label={L("How maintenance works", "Cara penyelenggaraan berfungsi")}>
        <ul className={av.rules}>
          <li>{L("An issue is a report, not a status. The register's keepers send the asset for repair; it comes back fixed (to its holder, or Spare) or not repairable.", "Isu ialah laporan, bukan status. Penjaga daftar menghantar aset untuk dibaiki; ia kembali dibaiki (kepada pemegang, atau Simpanan) atau tidak boleh dibaiki.")}</li>
          <li>{L("Lost and Disposed keep the asset and its records — nothing is deleted. A disposal is approved by the CEO or COO, never by the person who asked.", "Hilang dan Dilupuskan menyimpan aset dan rekodnya — tiada yang dipadam. Pelupusan diluluskan oleh CEO atau COO, tidak sekali-kali oleh pemohon.")}</li>
          <li>{L("Repair costs and sale proceeds are notes. Finance pays and records them in its own module; no expense, write-off or income is posted from Assets.", "Kos pembaikan dan hasil jualan ialah nota. Kewangan membayar dan merekodnya dalam modulnya sendiri; tiada perbelanjaan, hapus kira atau pendapatan dicatat dari Aset.")}</li>
        </ul>
      </section>
    </>
  );
}
