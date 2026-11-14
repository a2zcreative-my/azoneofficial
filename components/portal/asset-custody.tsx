"use client";

/* v1.304.0 - ASSETS WORKSPACE 4.0, PHASE 2: CUSTODY (the CEO, 14-11-2026:
   "Phase 2 now"; claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md section 5, D-2,
   D-4, D-5; migration 0194). Three pieces, the server decides every one
   (worker/src/assets.ts):

     MyAssets      every staff member: the assets they hold, Acknowledge a
                   hand-over (only they can), Return their own; a manager
                   (reports_to) also sees the team's assets and REQUESTS a
                   hand-over inside the team - the keepers decide it
     CustodyQueue  the keepers: hand-overs not yet acknowledged (cancel one)
                   and the requests waiting (approve or decline - never
                   their own)
     CustodyPanel  one asset's Assignment tab: its custody steps, and
                   Assign / Transfer / Return / Cancel for the keepers
   No cost is shown here: custody is about who holds what. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { CareReport } from "./asset-care"; // v1.305.0 - phase 3: report an issue or a loss from My assets
import av from "./assets-page.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Toast = (t: string, m: string, v?: "notice") => void;
type Err = { error?: { message?: string } };
const msgOf = (r: { data: unknown }) => (r.data as Err | null)?.error?.message ?? L("Please try again.", "Sila cuba lagi.");
const STATUS: Record<string, string> = { in_use: "In use", spare: "Spare", repair: "In repair", lost: "Lost", disposed: "Disposed" };
const CONDITION: [string, string, string][] = [["good", "Good", "Baik"], ["fair", "Fair", "Sederhana"], ["damaged", "Damaged", "Rosak"]];
const STEP: Record<string, [string, string, string]> = {
  assign: ["Handed over", "Diserahkan", chipSmInfo], acknowledge: ["Acknowledged", "Disahkan", chipSmSuccess], transfer: ["Transferred", "Dipindahkan", chipSmInfo],
  return: ["Returned", "Dipulangkan", chipSmNeutral], cancel: ["Hand-over cancelled", "Serahan dibatalkan", chipSmWarn], request: ["Requested", "Dimohon", chipSmWarn],
  approve: ["Request approved", "Permohonan diluluskan", chipSmSuccess], decline: ["Request declined", "Permohonan ditolak", chipSmNeutral],
};
interface Held { id: number; asset_tag: string; name: string; category: string; brand_model: string | null; serial_no: string | null; location: string | null; status: string; assigned_to: number | null; holder: string | null; pending_id: number | null; handed_at: string | null; handed_by: string | null }
interface Mine { mine: Held[]; team: Held[]; people: { id: number; name: string }[]; spare: { id: number; asset_tag: string; name: string }[]; requests: { id: number; asset_tag: string; name: string; to_name: string | null; reason: string; created_at: string; decision: string | null; decline_reason: string | null }[]; me: number; can: { manage: boolean; team: boolean; care?: boolean } }
interface StepRow { id: number; kind: string; from_name: string | null; to_name: string | null; location: string | null; reason: string | null; condition: string | null; created_at: string; actor: string | null }
const stepChip = (k: string) => { const w = STEP[k] ?? [k, k, chipSmNeutral]; return <span className={w[2]}>{L(w[0], w[1])}</span>; };

/* ------------------------------------------------------------------ My assets (every staff member) */
export function MyAssets({ toast, compact = false }: { toast: Toast; compact?: boolean }) {
  const [d, setD] = useState<Mine | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<{ id: number; what: "ack" | "return" | "issue" | "lost" } | null>(null);
  const [cond, setCond] = useState("good");
  const [note, setNote] = useState("");
  const [rq, setRq] = useState({ asset_id: "", to_holder: "", reason: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void api<Mine>("/staff/assets/mine").then((r) => { if (!live) return; if (r.ok && r.data) { setD(r.data); setFailed(false); } else setFailed(true); }); return () => { live = false; }; }, [tick]);
  const act = async (id: number, body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await api<Err>(`/staff/assets/${id}/custody`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), msgOf(r), "notice"); return; }
    toast(ok, ""); setOpen(null); setNote(""); setTick((t) => t + 1);
  };
  const request = async () => {
    setBusy(true);
    const r = await api<Err>("/staff/assets/custody/requests", { method: "POST", body: JSON.stringify({ asset_id: Number(rq.asset_id), to_holder: Number(rq.to_holder), reason: rq.reason }) });
    setBusy(false);
    if (!r.ok) { toast(L("Not sent", "Tidak dihantar"), msgOf(r), "notice"); return; }
    toast(L("Request sent", "Permohonan dihantar"), L("The register's keepers decide it.", "Penjaga daftar akan memutuskannya.")); setRq({ asset_id: "", to_holder: "", reason: "" }); setTick((t) => t + 1);
  };
  if (failed && !d) return compact ? null : <section className={card}><p className={av.empty}><AppIcon name="warning" />{L("Your assets could not be read just now — try again later.", "Aset anda tidak dapat dibaca sekarang — cuba lagi kemudian.")}</p></section>;
  const pending = d?.mine.filter((a) => a.pending_id) ?? [];
  return (
    <>
      <section className={card} aria-label={L("My assets", "Aset saya")} data-testid="my-assets">
        <div className={av.head}><div className={av.lead}><span className={`${av.well} ${av.goldWell}`}><AppIcon name="person" /></span>
          <div className={av.headText}><p className={av.title}>{L("My Assets", "Aset Saya")}</p><p className={av.sub}>{L("What the company has handed to you. Acknowledge a hand-over once you have it; return it here when you give it back.", "Apa yang syarikat serahkan kepada anda. Sahkan serahan apabila anda menerimanya; pulangkan di sini apabila anda memberikannya semula.")}</p></div></div>
          {pending.length > 0 && <span className={chipSmWarn}>{L(`${pending.length} to acknowledge`, `${pending.length} untuk disahkan`)}</span>}
        </div>
        {!d ? <SkelRows rows={3} /> : d.mine.length === 0 ? <p className={av.empty}><AppIcon name="package" />{L("No company asset is held by you.", "Tiada aset syarikat dipegang oleh anda.")}</p> : (
          <ul className={av.custList}>
            {d.mine.map((a) => (
              <li key={a.id} data-testid="my-asset">
                <div className={av.custTop}><span className={av.mono}>{a.asset_tag}</span><strong>{a.name}</strong>{a.pending_id ? <span className={chipSmWarn}>{L("Waiting for your acknowledgement", "Menunggu pengesahan anda")}</span> : <span className={a.status === "repair" ? chipSmWarn : a.status === "lost" ? chipSmDanger : a.status === "in_use" ? chipSmSuccess : chipSmNeutral}>{L(STATUS[a.status] ?? a.status, STATUS[a.status] ?? a.status)}</span>}</div>
                <span className={av.muted}>{[a.brand_model, a.serial_no ? `S/N ${a.serial_no}` : null, a.location].filter(Boolean).join(" · ")}{a.handed_at ? ` · ${L("handed over", "diserahkan")} ${dmyMYT(a.handed_at)}${a.handed_by ? ` ${L("by", "oleh")} ${a.handed_by}` : ""}` : ""}</span>
                <div className={av.custActs}>
                  {a.pending_id ? <button type="button" className={btnSmPrimary} onClick={() => { setOpen({ id: a.id, what: "ack" }); setCond("good"); }} data-testid="asset-ack">{L("Acknowledge", "Sahkan")}</button> : null}
                  <button type="button" className={btnSm} onClick={() => { setOpen({ id: a.id, what: "return" }); setCond("good"); }} data-testid="asset-return-own">{L("Return", "Pulangkan")}</button>
                  {d.can.care && a.status !== "disposed" && <button type="button" className={btnSm} onClick={() => setOpen({ id: a.id, what: "issue" })} data-testid="my-asset-issue">{L("Report issue", "Lapor isu")}</button>}
                  {d.can.care && a.status !== "lost" && a.status !== "disposed" && <button type="button" className={btnSm} onClick={() => setOpen({ id: a.id, what: "lost" })} data-testid="my-asset-lost">{L("Report lost", "Lapor hilang")}</button>}
                </div>
                {open?.id === a.id && (open.what === "issue" || open.what === "lost") && <CareReport assetId={a.id} what={open.what} toast={toast} onDone={() => { setOpen(null); setTick((t) => t + 1); }} onCancel={() => setOpen(null)} />}
                {open?.id === a.id && (open.what === "ack" || open.what === "return") && (
                  <div className={av.custForm}>
                    <label className={av.field}><span>{open.what === "ack" ? L("Condition when received", "Keadaan semasa diterima") : L("Condition now", "Keadaan sekarang")}</span>
                      <select className={selectClassSm} value={cond} onChange={(e) => setCond(e.target.value)}>{CONDITION.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
                    <label className={av.field}><span>{L("Note", "Nota")}</span><input className={inputClassSm} value={note} onChange={(e) => setNote(e.target.value)} placeholder={cond === "damaged" ? L("What is damaged", "Apa yang rosak") : L("Optional", "Pilihan")} /></label>
                    <div className={av.custActs}>
                      <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void act(a.id, open.what === "ack" ? { action: "acknowledge", condition: cond, note } : { action: "return", condition: cond, reason: note }, open.what === "ack" ? L("Acknowledged", "Disahkan") : L("Returned", "Dipulangkan"))} data-testid="asset-custody-save">{open.what === "ack" ? L("I have it", "Saya menerimanya") : L("Record the return", "Rekod pemulangan")}</button>
                      <button type="button" className={btnSm} onClick={() => setOpen(null)}>{L("Cancel", "Batal")}</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {d?.can.team && (
        <section className={card} aria-label={L("My team's assets", "Aset pasukan saya")} data-testid="team-assets">
          <div className={av.head}><div className={av.lead}><span className={`${av.well} ${av.blueWell}`}><AppIcon name="users" /></span>
            <div className={av.headText}><p className={av.title}>{L("My Team's Assets", "Aset Pasukan Saya")}</p><p className={av.sub}>{L("Held by the people who report to you. Ask for a hand-over inside your team; the register's keepers decide it.", "Dipegang oleh orang yang melapor kepada anda. Mohon serahan dalam pasukan anda; penjaga daftar akan memutuskannya.")}</p></div></div></div>
          {d.team.length === 0 ? <p className={av.empty}><AppIcon name="package" />{L("Nobody in your team holds a company asset.", "Tiada sesiapa dalam pasukan anda memegang aset syarikat.")}</p> : (
            <ul className={av.custList}>{d.team.map((a) => (
              <li key={a.id}><div className={av.custTop}><span className={av.mono}>{a.asset_tag}</span><strong>{a.name}</strong>{a.pending_id ? <span className={chipSmWarn}>{L("Not acknowledged yet", "Belum disahkan")}</span> : null}{a.status !== "in_use" ? <span className={chipSmNeutral}>{L(STATUS[a.status] ?? a.status, STATUS[a.status] ?? a.status)}</span> : null}</div><span className={av.muted}>{a.holder}{a.location ? ` · ${a.location}` : ""}</span>
                {d.can.care && a.status !== "disposed" && <div className={av.custActs}>
                  <button type="button" className={btnSm} onClick={() => setOpen({ id: a.id, what: "issue" })} data-testid="team-asset-issue">{L("Report issue", "Lapor isu")}</button>
                  {a.status !== "lost" && <button type="button" className={btnSm} onClick={() => setOpen({ id: a.id, what: "lost" })}>{L("Report lost", "Lapor hilang")}</button>}
                </div>}
                {open?.id === a.id && (open.what === "issue" || open.what === "lost") && <CareReport assetId={a.id} what={open.what} toast={toast} onDone={() => { setOpen(null); setTick((t) => t + 1); }} onCancel={() => setOpen(null)} />}
              </li>
            ))}</ul>
          )}
          <div className={av.custForm} data-testid="asset-request-form">
            <p className={av.title}>{L("Request a hand-over", "Mohon serahan")}</p>
            <select className={selectClassSm} value={rq.asset_id} onChange={(e) => setRq({ ...rq, asset_id: e.target.value })} aria-label={L("Asset", "Aset")}>
              <option value="">{L("Choose an asset (your team's, or a spare one)", "Pilih aset (pasukan anda, atau simpanan)")}</option>
              {d.team.map((a) => <option key={a.id} value={a.id}>{`${a.asset_tag} · ${a.name} · ${a.holder ?? ""}`}</option>)}
              {d.spare.map((a) => <option key={a.id} value={a.id}>{`${a.asset_tag} · ${a.name} · ${L("spare", "simpanan")}`}</option>)}
            </select>
            <select className={selectClassSm} value={rq.to_holder} onChange={(e) => setRq({ ...rq, to_holder: e.target.value })} aria-label={L("To", "Kepada")}>
              <option value="">{L("To whom (your team)", "Kepada siapa (pasukan anda)")}</option>
              {d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className={inputClassSm} value={rq.reason} onChange={(e) => setRq({ ...rq, reason: e.target.value })} placeholder={L("Why (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)")} aria-label={L("Why", "Sebab")} />
            <button type="button" className={btnSmPrimary} disabled={busy || !rq.asset_id || !rq.to_holder || rq.reason.trim().length < 10} onClick={() => void request()} data-testid="asset-request-send">{L("Send request", "Hantar permohonan")}</button>
          </div>
          {d.requests.length > 0 && (
            <ul className={av.custList} aria-label={L("My requests", "Permohonan saya")}>
              {d.requests.map((r) => (
                <li key={r.id}><div className={av.custTop}><span className={av.mono}>{r.asset_tag}</span><span>{L(`to ${r.to_name ?? ""}`, `kepada ${r.to_name ?? ""}`)}</span>{r.decision ? stepChip(r.decision) : <span className={chipSmWarn}>{L("Waiting", "Menunggu")}</span>}</div>
                  <span className={av.muted}>{r.reason}{r.decline_reason ? ` — ${r.decline_reason}` : ""} · {dmyMYT(r.created_at)}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ the keepers' queue */
interface Queue { waiting: { id: number; asset_tag: string; name: string; holder: string | null; kind: string; since: string; issued_by: string | null }[]; requests: { id: number; asset_tag: string; name: string; from_name: string | null; to_name: string | null; reason: string; created_at: string; requested_by: string | null; requested_by_id: number }[]; me: number; can: { decide: boolean } }
export function CustodyQueue({ toast, onChanged, openAsset }: { toast: Toast; onChanged: () => void; openAsset: (id: number) => void }) {
  const [q, setQ] = useState<Queue | null>(null);
  const [tick, setTick] = useState(0);
  const [why, setWhy] = useState<Record<number, string>>({});
  useEffect(() => { let live = true; void api<Queue>("/staff/assets/custody").then((r) => { if (live && r.ok && r.data) setQ(r.data); }); return () => { live = false; }; }, [tick]);
  const decide = async (id: number, decision: "approve" | "decline") => {
    const r = await api<Err>(`/staff/assets/custody/requests/${id}/decide`, { method: "POST", body: JSON.stringify({ decision, reason: why[id] ?? "" }) });
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), msgOf(r), "notice"); return; }
    toast(decision === "approve" ? L("Approved — handed over", "Diluluskan — diserahkan") : L("Declined", "Ditolak"), ""); setTick((t) => t + 1); onChanged();
  };
  if (!q) return <section className={card}><SkelRows rows={2} /></section>;
  return (
    <section className={card} aria-label={L("Custody queue", "Barisan jagaan")} data-testid="custody-queue">
      <div className={av.head}><div className={av.lead}><span className={`${av.well} ${av.goldWell}`}><AppIcon name="pending" /></span>
        <div className={av.headText}><p className={av.title}>{L("Waiting on Custody", "Menunggu Jagaan")}</p><p className={av.sub}>{L("Hand-overs the holder has not acknowledged yet, and hand-over requests from managers.", "Serahan yang belum disahkan pemegang, dan permohonan serahan daripada pengurus.")}</p></div></div></div>
      {q.waiting.length === 0 && q.requests.length === 0 ? <p className={av.empty}><AppIcon name="success" />{L("Nothing waiting — every hand-over is acknowledged.", "Tiada yang menunggu — setiap serahan telah disahkan.")}</p> : (
        <ul className={av.custList}>
          {q.waiting.map((w) => (
            <li key={`w${w.id}`} data-testid="custody-waiting">
              <div className={av.custTop}><button type="button" className={`${av.mono} ${av.linkBtn}`} onClick={() => openAsset(w.id)}>{w.asset_tag}</button><strong>{w.name}</strong><span className={chipSmWarn}>{L("Not acknowledged", "Belum disahkan")}</span></div>
              <span className={av.muted}>{L(`Handed to ${w.holder ?? ""} on ${dmyMYT(w.since)} by ${w.issued_by ?? ""}`, `Diserahkan kepada ${w.holder ?? ""} pada ${dmyMYT(w.since)} oleh ${w.issued_by ?? ""}`)}</span>
            </li>
          ))}
          {q.requests.map((r) => (
            <li key={`r${r.id}`} data-testid="custody-request">
              <div className={av.custTop}><span className={av.mono}>{r.asset_tag}</span><strong>{r.name}</strong><span className={chipSmWarn}>{L("Request", "Permohonan")}</span></div>
              <span className={av.muted}>{L(`${r.requested_by ?? ""} asks: ${r.from_name ? `from ${r.from_name} ` : ""}to ${r.to_name ?? ""} — ${r.reason}`, `${r.requested_by ?? ""} memohon: ${r.from_name ? `daripada ${r.from_name} ` : ""}kepada ${r.to_name ?? ""} — ${r.reason}`)}</span>
              {q.can.decide && (r.requested_by_id === q.me ? <span className={av.muted}>{L("Your own request — another keeper decides it.", "Permohonan anda sendiri — penjaga lain memutuskannya.")}</span> : (
                <div className={av.custActs}>
                  <input className={inputClassSm} value={why[r.id] ?? ""} onChange={(e) => setWhy({ ...why, [r.id]: e.target.value })} placeholder={L("Reason (needed to decline)", "Sebab (perlu untuk menolak)")} aria-label={L("Reason", "Sebab")} />
                  <button type="button" className={btnSmPrimary} onClick={() => void decide(r.id, "approve")} data-testid="custody-approve">{L("Approve", "Luluskan")}</button>
                  <button type="button" className={btnSm} disabled={(why[r.id] ?? "").trim().length < 5} onClick={() => void decide(r.id, "decline")}>{L("Decline", "Tolak")}</button>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ one asset's custody (the drawer's Assignment tab) */
export function CustodyPanel({ assetId, holderId, staff, canManage, toast, onChanged }: { assetId: number; holderId: number | null; staff: { id: number; name: string }[]; canManage: boolean; toast: Toast; onChanged: () => void }) {
  const [d, setD] = useState<{ steps: StepRow[]; pending_id: number | null; can: { manage: boolean; acknowledge: boolean; return: boolean } } | null>(null);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<"" | "handover" | "return" | "cancel">("");
  const [f, setF] = useState({ to_holder: "", location: "", reason: "", condition: "good" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void api<NonNullable<typeof d>>(`/staff/assets/${assetId}/custody`).then((r) => { if (live && r.ok && r.data) setD(r.data); }); return () => { live = false; }; }, [assetId, tick]);
  const send = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await api<Err>(`/staff/assets/${assetId}/custody`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), msgOf(r), "notice"); return; }
    toast(ok, ""); setForm(""); setF({ to_holder: "", location: "", reason: "", condition: "good" }); setTick((t) => t + 1); onChanged();
  };
  const transfer = holderId != null;
  return (
    <div className={av.custPanel} data-testid="custody-panel">
      {canManage && (
        <div className={av.custActs}>
          <button type="button" className={btnSm} onClick={() => setForm(form === "handover" ? "" : "handover")} data-testid="custody-handover">{transfer ? L("Transfer", "Pindah") : L("Assign", "Tugaskan")}</button>
          {transfer && <button type="button" className={btnSm} onClick={() => setForm(form === "return" ? "" : "return")} data-testid="custody-return">{L("Return", "Pulangkan")}</button>}
          {d?.pending_id ? <button type="button" className={btnSm} onClick={() => setForm(form === "cancel" ? "" : "cancel")} data-testid="custody-cancel">{L("Cancel hand-over", "Batal serahan")}</button> : null}
        </div>
      )}
      {form === "handover" && (
        <div className={av.custForm}>
          <select className={selectClassSm} value={f.to_holder} onChange={(e) => setF({ ...f, to_holder: e.target.value })} aria-label={L("To", "Kepada")} data-testid="custody-to">
            <option value="">{L("Hand it to…", "Serahkan kepada…")}</option>
            {staff.filter((u) => u.id !== holderId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input className={inputClassSm} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder={L("Location (optional)", "Lokasi (pilihan)")} aria-label={L("Location", "Lokasi")} />
          <input className={inputClassSm} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={transfer ? L("Why (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)") : L("Note (optional)", "Nota (pilihan)")} aria-label={L("Reason", "Sebab")} data-testid="custody-reason" />
          <button type="button" className={btnSmPrimary} disabled={busy || !f.to_holder || (transfer && f.reason.trim().length < 10)} onClick={() => void send({ action: transfer ? "transfer" : "assign", to_holder: Number(f.to_holder), location: f.location, reason: f.reason }, transfer ? L("Transferred — waiting for acknowledgement", "Dipindahkan — menunggu pengesahan") : L("Handed over — waiting for acknowledgement", "Diserahkan — menunggu pengesahan"))} data-testid="custody-save">{transfer ? L("Transfer", "Pindah") : L("Assign", "Tugaskan")}</button>
        </div>
      )}
      {form === "return" && (
        <div className={av.custForm}>
          <select className={selectClassSm} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} aria-label={L("Condition", "Keadaan")}>{CONDITION.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select>
          <input className={inputClassSm} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder={L("Back to (location, optional)", "Kembali ke (lokasi, pilihan)")} aria-label={L("Location", "Lokasi")} />
          <input className={inputClassSm} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={f.condition === "damaged" ? L("What is damaged", "Apa yang rosak") : L("Note (optional)", "Nota (pilihan)")} aria-label={L("Note", "Nota")} />
          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void send({ action: "return", condition: f.condition, location: f.location, reason: f.reason }, L("Return recorded", "Pemulangan direkod"))}>{L("Record the return", "Rekod pemulangan")}</button>
        </div>
      )}
      {form === "cancel" && (
        <div className={av.custForm}>
          <input className={inputClassSm} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={L("Why it is cancelled", "Sebab dibatalkan")} aria-label={L("Reason", "Sebab")} />
          <button type="button" className={btnSmPrimary} disabled={busy || f.reason.trim().length < 5} onClick={() => void send({ action: "cancel", reason: f.reason }, L("Hand-over cancelled", "Serahan dibatalkan"))}>{L("Cancel the hand-over", "Batalkan serahan")}</button>
        </div>
      )}
      {!d ? <SkelRows rows={3} /> : d.steps.length === 0 ? <p className={av.sub}>{L("No custody step recorded yet. Any holder named before 4.0 is the starting point — earlier holders are in the History tab.", "Belum ada langkah jagaan direkodkan. Pemegang sebelum 4.0 ialah titik mula — pemegang terdahulu ada dalam tab Sejarah.")}</p> : (
        <ol className={av.timeline} data-testid="custody-steps">
          {d.steps.map((s) => (
            <li key={s.id}>
              <span className={av.strong}>{stepChip(s.kind)} {s.to_name || s.from_name ? <span>{s.from_name ? `${s.from_name} → ` : ""}{s.to_name ?? (s.kind === "return" ? L("returned", "dipulangkan") : "")}</span> : null}</span>
              {(s.reason || s.condition || s.location) && <span>{[s.condition ? L(`condition: ${s.condition}`, `keadaan: ${s.condition}`) : null, s.location, s.reason].filter(Boolean).join(" · ")}</span>}
              <span className={av.muted}>{dmyMYT(s.created_at)} · {s.actor ?? "—"}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
