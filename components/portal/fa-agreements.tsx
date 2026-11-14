"use client";

/* v1.302.0 - FINANCIAL ADVISORY 2.0, PHASE 5: AGREEMENTS (the CEO,
   13-11-2026: "Phase 5 now"; blueprint sections 10-11, the CEO's photo 5;
   migration 0192). Three parts, the server decides every one
   (worker/src/fa-templates.ts):

     builder   pick a case and a PUBLISHED template version of its company
               and service; the fields fill from the records (the IC masked;
               the full IC typed for this one document only, checked against
               the profile, never stored); missing fields are listed and the
               draft cannot be prepared; the preview and the PDF are drawn
               from the same blocks, watermarked DRAFT. Sending and signing
               are shown LOCKED with the reason (FA_LEGAL.agreement).
     fee       a disbursement recorded with the bank's evidence and amount ->
               the fee at the published version's rate -> the normal Sales
               quotation (the agent-request handoff, source fa_fee). Nothing
               is invoiced here; commission on it stays off.
     library   management drafts (upload the Word file or type the text),
               edits a draft, submits it; the CEO publishes with the legal
               basis recorded; every change is a new version. */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { usePortal } from "@/components/portal/portal-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { buildAgreementPdf, downloadPdf, type Block } from "@/lib/fa-agreement";
import { PRODUCT } from "./fa-case";
import type { Row } from "./financial-advisory";
import css from "./financial-advisory.module.css";
import ac from "./fa-agreements.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Toast = (t: string, m: string, v?: "notice") => void;
type Check = { unknown: string[]; broken: boolean; prohibited: string[]; required: string[]; fee_needed: boolean; ok: boolean };
type ErrBody = { error?: { message?: string; code?: string; check?: Check; missing?: string[] } };
interface Tpl { id: number; name: string; issuer_code: string; service_type: string; created_by_name?: string | null }
interface Ver {
  id: number; template_id: number; version: number; format: string; source_name: string | null; source_sha256: string | null; body: string; fee_bp: number | null; state: string;
  created_by: number; created_at: string; created_by_name: string | null; submitted_at: string | null; submitted_by_name: string | null; legal_basis: string | null; legal_reviewer: string | null;
  legal_firm: string | null; legal_reviewed_on: string | null; legal_reference: string | null; published_at: string | null; published_by_name: string | null; archived_at: string | null; archived_reason: string | null; check: Check;
}
interface Lib { templates: Tpl[]; versions: Ver[]; fields: Record<string, string>; me: number; owner: boolean; can: { draft: boolean; publish: boolean }; legal: Record<string, boolean> }
interface Field { key: string; label: string; value: string | null; masked: boolean; missing: boolean }
interface Preview { blocks: Block[]; fields: Field[]; missing: string[]; ready: boolean; sha256: string | null; version: { id: number; version: number; name: string; state: string; fee_bp: number | null }; company: { name: string; registration: string }; case_ref: string | null }
interface Fee { note_id: number; case_id: number; bank: string | null; approved_cents: number | null; has_evidence: number; recorded_at: string; corrected: number; case_ref: string; product: string; issuer_code: string; client: string | null; bill_id: number | null; fee_bp: number | null; base_cents: number | null; fee_cents: number | null; reference: string | null; prepared_at: string | null; prepared_by: string | null; billable: boolean }

const STATE: Record<string, [string, string, string]> = {
  draft: ["Draft", "Draf", chipSmNeutral], review: ["Waiting for publishing", "Menunggu diterbitkan", chipSmWarn],
  approved: ["Published", "Diterbitkan", chipSmSuccess], archived: ["Archived", "Diarkib", chipSmNeutral],
};
const COMPANY: Record<string, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
const stateChip = (s: string) => { const w = STATE[s] ?? STATE.draft!; return <span className={`${w[2]} ${css.chip}`}>{L(w[0], w[1])}</span>; };
const rate = (bp: number | null | undefined) => (bp ? `${(bp / 100).toFixed(2)}%` : L("not set", "belum ditetapkan"));
const msgOf = (r: { data: unknown }) => (r.data as ErrBody | null)?.error?.message ?? L("Please try again.", "Sila cuba lagi.");
const checkWords = (c: Check) => [
  ...c.unknown.map((f) => L(`Unknown field {{${f}}}`, `Medan tidak dikenali {{${f}}}`)),
  c.broken ? L("A field is broken (unmatched {{ or }})", "Medan rosak ({{ atau }} tidak sepadan)") : "",
  ...c.required.map((f) => L(`The text must use {{${f}}}`, `Teks mesti menggunakan {{${f}}}`)),
  c.fee_needed ? L("The text uses the fee - set the fee rate", "Teks menggunakan yuran - tetapkan kadar yuran") : "",
  ...c.prohibited.map((w) => L(`Not allowed: "${w}" (no CTOS reporting, blacklisting or penalty clauses)`, `Tidak dibenarkan: "${w}" (tiada pelaporan CTOS, senarai hitam atau klausa penalti)`)),
].filter(Boolean);
const toBase64 = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => no(r.error); r.readAsDataURL(f); });

export function Agreements({ legal, rows, toast }: { legal: Record<string, boolean> | null; rows: Row[] | null; toast: Toast }) {
  const [lib, setLib] = useState<Lib | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let live = true;
    void api<Lib>("/staff/fa/templates").then((r) => { if (!live) return; if (r.ok && r.data) { setLib(r.data); setFailed(false); } else setFailed(true); });
    return () => { live = false; };
  }, [tick]);
  const feeOn = !!legal?.fee;
  return (
    <div className={css.stack}>
      {failed && <p className={`${card} ${css.sec} ${css.sub}`} role="status">{L("The agreement library opens once the database update (0192) is applied.", "Pustaka perjanjian dibuka selepas kemas kini pangkalan data (0192) digunakan.")}</p>}
      {!lib && !failed ? <SkelRows rows={6} /> : <Builder lib={lib} rows={rows} toast={toast} />}
      <div className={ac.pair}>
        <Fees lib={lib} toast={toast} />
        <section className={`${card} ${css.sec}`} aria-label={L("Advisory fee", "Yuran nasihat")} data-testid="fa-fee">
          <h3 className={css.h}><AppIcon name="money" />{L("Advisory fee", "Yuran nasihat")} <span className={`${feeOn ? chipSmSuccess : chipSmNeutral} ${css.chip}`}>{feeOn ? L("On - CEO decision 13-11-2026", "Hidup - keputusan CEO 13-11-2026") : L("Switched off", "Dimatikan")}</span></h3>
          <dl className={css.kv}>
            <div><dt>{L("Rate", "Kadar")}</dt><dd>{L("Set on the published agreement template version (15% is your proposal) - never written in the system's code", "Ditetapkan pada versi templat perjanjian yang diterbitkan (15% ialah cadangan anda) - tidak ditulis dalam kod sistem")}</dd></div>
            <div><dt>{L("When it is billed", "Bila dibilkan")}</dt><dd>{L("Only after a disbursement is recorded with the bank's evidence - never from an estimated eligibility", "Hanya selepas pengeluaran direkod dengan bukti bank - tidak sekali-kali daripada anggaran kelayakan")}</dd></div>
            <div><dt>{L("How", "Bagaimana")}</dt><dd>{L("Sales quotation -> invoice -> your payment verification (no second invoice engine)", "Sebut harga Jualan -> invois -> pengesahan bayaran anda (tiada enjin invois kedua)")}</dd></div>
            <div><dt>{L("Legal review", "Semakan undang-undang")}</dt><dd>{L("Not done - switched on by your decision. Counsel is still advised before the first client is billed (Consumer Credit Act 2025).", "Belum dibuat - dihidupkan dengan keputusan anda. Peguam masih dinasihatkan sebelum pelanggan pertama dibilkan (Akta Kredit Pengguna 2025).")}</dd></div>
            <div><dt>{L("Commission", "Komisen")}</dt><dd>{legal?.commission ? "" : L("None on advisory fees until you approve it - the fee line must earn nothing under the commission policy", "Tiada atas yuran nasihat sehingga anda luluskan - baris yuran mesti tidak menjana apa-apa di bawah polisi komisen")}</dd></div>
            <div><dt>{L("CTOS / blacklisting / penalties", "CTOS / senarai hitam / penalti")}</dt><dd>{L("Never used. Not built.", "Tidak sekali-kali digunakan. Tidak dibina.")}</dd></div>
          </dl>
        </section>
      </div>
      <Library lib={lib} toast={toast} reload={reload} />
      <section className={`${card} ${css.sec}`} aria-label={L("Agreements", "Perjanjian")} data-testid="fa-agreements">
        <h3 className={css.h}><AppIcon name="lock" />{L("Client agreements", "Perjanjian pelanggan")} <span className={`${chipSmNeutral} ${css.chip}`}>{L("Sending and signing switched off", "Penghantaran dan tandatangan dimatikan")}</span></h3>
        <p className={css.sub}>{L("A draft can be prepared and checked here. Sending an agreement to a client and signing (e-sign) stay off until legal review and your separate approval - a reviewed release, never a switch. An uploaded signature image is never proof of signing.", "Draf boleh disediakan dan disemak di sini. Menghantar perjanjian kepada pelanggan dan tandatangan (e-tandatangan) kekal dimatikan sehingga semakan undang-undang dan kelulusan berasingan anda - keluaran yang disemak, bukan suis. Imej tandatangan yang dimuat naik bukan bukti tandatangan.")}</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ the builder (photo 5) */
function Builder({ lib, rows, toast }: { lib: Lib | null; rows: Row[] | null; toast: Toast }) {
  const cases = useMemo(() => (rows ?? []).filter((r) => r.stage !== "closed"), [rows]);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [verId, setVerId] = useState<number | null>(null);
  const [ic, setIc] = useState("");
  const [icUsed, setIcUsed] = useState("");
  const [got, setGot] = useState<{ key: string; pv: Preview | null; problem: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const row = cases.find((r) => r.id === caseId) ?? null;
  const tplOf = (v: Ver) => lib?.templates.find((t) => t.id === v.template_id);
  const choices = useMemo(() => (lib?.versions ?? []).filter((v) => {
    const t = lib?.templates.find((x) => x.id === v.template_id);
    return !!row && !!t && t.issuer_code === row.issuer_code && t.service_type === row.product && v.state !== "archived" && (v.state === "approved" || lib?.can.draft || lib?.can.publish);
  }), [lib, row]);
  /* the chosen version, else the published one; a new case forgets the typed IC */
  const vid = choices.some((v) => v.id === verId) ? verId : choices.find((v) => v.state === "approved")?.id ?? null;
  const ver = choices.find((v) => v.id === vid) ?? null;
  const pickCase = (id: number | null) => { setCaseId(id); setIc(""); setIcUsed(""); setVerId(null); };
  const key = caseId && vid ? `${caseId}:${vid}:${icUsed}` : "";
  const pv = got && got.key === key ? got.pv : null;
  const problem = got && got.key === key ? got.problem : "";
  useEffect(() => {
    if (!key) return;
    let live = true;
    void api<Preview>(`/staff/fa/cases/${caseId}/agreement/preview`, { method: "POST", body: JSON.stringify({ version_id: vid, ...(icUsed ? { full_ic: icUsed } : {}) }) }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setGot({ key, pv: r.data, problem: "" });
      else if (icUsed) { toast(L("IC not used", "IC tidak digunakan"), msgOf(r), "notice"); setIcUsed(""); } // back to the masked draft
      else setGot({ key, pv: null, problem: msgOf(r) });
    });
    return () => { live = false; };
  }, [key, caseId, vid, icUsed, toast]);
  const prepare = async () => {
    if (!caseId || !vid || !pv?.ready) return;
    setBusy(true);
    const r = await api<Preview & { draft_id: number }>(`/staff/fa/cases/${caseId}/agreement/preview`, { method: "POST", body: JSON.stringify({ version_id: vid, record: true, ...(icUsed ? { full_ic: icUsed } : {}) }) });
    setBusy(false);
    if (!r.ok || !r.data) { toast(L("Draft not prepared", "Draf tidak disediakan"), msgOf(r), "notice"); return; }
    downloadPdf(buildAgreementPdf(r.data), `DRAFT-${(r.data.case_ref ?? "agreement").replace(/[^\w-]/g, "_")}-v${r.data.version.version}.pdf`);
    toast(L("Draft PDF prepared", "PDF draf disediakan"), L("Recorded on the case. It is a draft - not for signing or sending.", "Direkod pada kes. Ia draf - bukan untuk ditandatangani atau dihantar."));
  };
  const steps: [string, boolean][] = [
    [L("Template", "Templat"), !!ver],
    [L("Fields complete", "Medan lengkap"), !!pv && pv.missing.length === 0],
    [L("Draft PDF", "PDF draf"), !!pv?.ready],
  ];
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Agreement builder", "Pembina perjanjian")} data-testid="fa-agr-builder">
      <h3 className={css.h}><AppIcon name="document" />{L("Agreement builder", "Pembina perjanjian")}</h3>
      <div className={ac.builder}>
        <div className={ac.col}>
          <label className={ac.field}><span>{L("1 · Client & case", "1 · Pelanggan & kes")}</span>
            <select className={selectClassSm} value={caseId ?? ""} onChange={(e) => pickCase(e.target.value ? Number(e.target.value) : null)} data-testid="fa-agr-case">
              <option value="">{L("Choose a case", "Pilih kes")}</option>
              {cases.map((r) => <option key={r.id} value={r.id}>{`${r.case_ref} · ${r.client ?? ""} · ${L(...(PRODUCT[r.product] ?? [r.product, r.product]) as [string, string])}`}</option>)}
            </select>
          </label>
          <label className={ac.field}><span>{L("2 · Template", "2 · Templat")}</span>
            <select className={selectClassSm} value={vid ?? ""} onChange={(e) => setVerId(e.target.value ? Number(e.target.value) : null)} disabled={!row} data-testid="fa-agr-version">
              <option value="">{row && !choices.length ? L("No published template for this company and service", "Tiada templat diterbitkan untuk syarikat dan perkhidmatan ini") : L("Choose a template", "Pilih templat")}</option>
              {choices.map((v) => <option key={v.id} value={v.id}>{`${tplOf(v)?.name ?? ""} v${v.version} · ${L(...(STATE[v.state] ?? STATE.draft!).slice(0, 2) as [string, string])}`}</option>)}
            </select>
          </label>
          {row && <p className={css.sub}>{L(`Company: ${COMPANY[row.issuer_code] ?? row.issuer_code} · only templates of the case's company and service are offered.`, `Syarikat: ${COMPANY[row.issuer_code] ?? row.issuer_code} · hanya templat syarikat dan perkhidmatan kes ini ditawarkan.`)}</p>}
          <div className={ac.field}>
            <span>{L("3 · IC number", "3 · Nombor IC")}</span>
            <div className={css.row}>
              <input className={inputClassSm} value={ic} onChange={(e) => setIc(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={14} placeholder={L("Full IC - only if this document needs it", "IC penuh - hanya jika dokumen ini memerlukannya")} aria-label={L("Full IC for this document", "IC penuh untuk dokumen ini")} disabled={!pv} data-testid="fa-agr-ic" />
              <button type="button" className={btnSm} disabled={!pv || ic.replace(/\D/g, "").length !== 12} onClick={() => setIcUsed(ic)} data-testid="fa-agr-ic-use">{L("Use for this document", "Guna untuk dokumen ini")}</button>
              {icUsed && <button type="button" className={btnSm} onClick={() => { setIc(""); setIcUsed(""); }}>{L("Mask again", "Topeng semula")}</button>}
            </div>
            <p className={css.sub}>{L("Masked unless typed here from the client's IC copy. Checked against the profile, used for this document only, never saved.", "Bertopeng kecuali ditaip di sini daripada salinan IC pelanggan. Disemak dengan profil, untuk dokumen ini sahaja, tidak disimpan.")}</p>
          </div>
          <div className={ac.field}><span>{L("4 · Fields from the records", "4 · Medan daripada rekod")}</span>
            {!pv ? <p className={css.sub}>{problem || L("Choose a case and a template.", "Pilih kes dan templat.")}</p> : (
              <ul className={ac.fields} data-testid="fa-agr-fields">{pv.fields.map((f) => (
                <li key={f.key} className={f.missing ? ac.missing : undefined} data-testid="fa-agr-field">
                  <code>{`{{${f.key}}}`}</code><span>{f.label}</span>
                  <b>{f.missing ? L("Missing - complete the record", "Tiada - lengkapkan rekod") : f.value}</b>
                  {f.masked && <span className={`${chipSmInfo} ${css.chip}`}>{L("Masked", "Bertopeng")}</span>}
                </li>
              ))}</ul>
            )}
          </div>
          <div className={ac.locked} data-testid="fa-agr-setup">
            <p><b>{L("Service fee", "Yuran perkhidmatan")}</b> {pv ? rate(pv.version.fee_bp) : "—"} <span className={css.sub}>{L("(set on the template version)", "(ditetapkan pada versi templat)")}</span></p>
            <p><b>{L("E-sign", "E-tandatangan")}</b> <span className={`${chipSmNeutral} ${css.chip}`}><AppIcon name="lock" />{L("Off - legal review", "Dimatikan - semakan undang-undang")}</span></p>
          </div>
        </div>
        <div className={ac.col}>
          <ol className={ac.track} aria-label={L("Progress", "Kemajuan")} data-testid="fa-agr-track">
            {steps.map(([w, on], i) => <li key={i} className={on ? ac.on : undefined}><AppIcon name={on ? "success" : "info"} />{w}</li>)}
            <li className={ac.off}><AppIcon name="lock" />{L("E-sign: switched off", "E-tandatangan: dimatikan")}</li>
          </ol>
          <div className={ac.paper} data-testid="fa-agr-preview" aria-label={L("Draft preview", "Pratonton draf")}>
            <span className={ac.mark} aria-hidden="true">DRAFT</span>
            {!pv ? <SkelRows rows={6} /> : (
              <>
                <header className={ac.letter}><b>{pv.company.name}</b><span>{pv.company.registration}</span><em>{L("Draft - not for signing or sending", "Draf - bukan untuk ditandatangani atau dihantar")} · {pv.case_ref}</em></header>
                {pv.blocks.map((b, i) => {
                  const parts = b.parts.map((p, k) => (p.field ? <mark key={k} className={p.missing ? ac.gap : ac.filled} data-field={p.field}>{p.t}</mark> : <span key={k}>{p.t}</span>));
                  return b.kind === "h" ? <h4 key={i}>{parts}</h4> : <p key={i}>{parts}</p>;
                })}
              </>
            )}
          </div>
          {pv && pv.missing.length > 0 && <p className={ac.warn} role="status" data-testid="fa-agr-missing">{L(`Missing: ${pv.missing.map((k) => lib?.fields[k] ?? k).join(", ")} - nothing is invented; complete the client's records.`, `Tiada: ${pv.missing.map((k) => lib?.fields[k] ?? k).join(", ")} - tiada yang direka; lengkapkan rekod pelanggan.`)}</p>}
          {pv && pv.version.state !== "approved" && <p className={ac.warn} role="status">{L("This version is not published - a check only; a draft agreement comes from the published version.", "Versi ini belum diterbitkan - semakan sahaja; draf perjanjian daripada versi yang diterbitkan.")}</p>}
          <div className={css.row}>
            <button type="button" className={btnSmPrimary} disabled={!pv?.ready || busy} onClick={() => void prepare()} data-testid="fa-agr-pdf"><AppIcon name="download" />{L("Prepare draft PDF", "Sediakan PDF draf")}</button>
            <button type="button" className={btnSm} disabled aria-describedby="fa-agr-send-why" data-testid="fa-agr-send"><AppIcon name="lock" />{L("Send for e-sign", "Hantar untuk e-tandatangan")}</button>
            <span id="fa-agr-send-why" className={css.sub}>{L("Locked: sending and signing stay off until legal review and the CEO's separate approval.", "Dikunci: hantar dan tandatangan kekal dimatikan sehingga semakan undang-undang dan kelulusan berasingan CEO.")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the fee after a recorded disbursement */
function Fees({ lib, toast }: { lib: Lib | null; toast: Toast }) {
  const { setTab: goTab } = usePortal();
  const [data, setData] = useState<{ fees: Fee[]; fee_line: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [pick, setPick] = useState<Record<number, number>>({});
  const [problem, setProblem] = useState<Record<number, string>>({});
  useEffect(() => { let live = true; void api<NonNullable<typeof data>>("/staff/fa/fees").then((r) => { if (live && r.ok && r.data) setData(r.data); }); return () => { live = false; }; }, [tick]);
  const choicesOf = (f: Fee) => (lib?.versions ?? []).filter((v) => { const t = lib?.templates.find((x) => x.id === v.template_id); return v.state === "approved" && !!v.fee_bp && t?.issuer_code === f.issuer_code && t?.service_type === f.product; });
  const prepare = async (f: Fee) => {
    const vid = f.bill_id ? undefined : pick[f.note_id] ?? choicesOf(f)[0]?.id;
    const r = await api<{ prefill?: Record<string, unknown>; again?: boolean }>(`/staff/fa/cases/${f.case_id}/fee`, { method: "POST", body: JSON.stringify({ decision_note_id: f.note_id, ...(vid ? { version_id: vid } : {}) }) });
    if (!r.ok || !r.data?.prefill) { setProblem((p) => ({ ...p, [f.note_id]: msgOf(r) })); return; }
    setTick((t) => t + 1);
    try { localStorage.setItem("azone-qt-prefill", JSON.stringify(r.data.prefill)); } catch { toast(L("Open Sales yourself", "Buka Jualan sendiri"), L(`This browser blocked the handoff - use the reference ${String(r.data.prefill.reference ?? "")}`, `Pelayar ini menyekat - guna rujukan ${String(r.data.prefill.reference ?? "")}`), "notice"); return; }
    goTab("Sales");
  };
  const rows = data?.fees ?? [];
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Fee after disbursement", "Yuran selepas pengeluaran")} data-testid="fa-fee-bills">
      <h3 className={css.h}><AppIcon name="money" />{L("Fee after a recorded disbursement", "Yuran selepas pengeluaran direkod")}</h3>
      <p className={css.sub}>{L("Each disbursement management recorded with the bank's evidence and amount. Preparing the fee opens the Sales quotation form filled in - the quotation, the invoice and your payment verification are the normal Sales steps.", "Setiap pengeluaran yang direkod pengurusan dengan bukti dan jumlah bank. Menyediakan yuran membuka borang sebut harga Jualan yang diisi - sebut harga, invois dan pengesahan bayaran anda ialah langkah biasa Jualan.")}</p>
      {!data ? <SkelRows rows={2} /> : rows.length === 0 ? <p className={css.empty}>{L("No disbursement recorded yet - nothing to bill.", "Belum ada pengeluaran direkod - tiada untuk dibilkan.")}</p> : (
        <ul className={ac.fees}>{rows.map((f) => {
          const opts = choicesOf(f);
          return (
            <li key={f.note_id} data-testid="fa-fee-row">
              <div><b>{f.client ?? "—"}</b> <span className={css.sub}>{f.case_ref} · {f.bank ?? "—"} · {dmy(f.recorded_at.slice(0, 10))}</span></div>
              <div className={css.row}>
                <span>{L("Disbursed", "Dikeluarkan")} <b>{f.approved_cents ? fmtRM(f.approved_cents) : "—"}</b></span>
                {f.has_evidence ? <span className={`${chipSmSuccess} ${css.chip}`}>{L("Bank evidence", "Bukti bank")}</span> : <span className={`${chipSmDanger} ${css.chip}`}>{L("No evidence", "Tiada bukti")}</span>}
                {Number(f.corrected) ? <span className={`${chipSmWarn} ${css.chip}`}>{L("Corrected - record again", "Dibetulkan - rekod semula")}</span> : null}
              </div>
              {f.bill_id ? (
                <div className={css.row}>
                  <span className={`${chipSmInfo} ${css.chip}`}>{L("Prepared", "Disediakan")} {f.reference}</span>
                  <span>{fmtRM(f.fee_cents ?? 0)} · {rate(f.fee_bp)} · {f.prepared_by ?? ""} {f.prepared_at ? dmy(f.prepared_at.slice(0, 10)) : ""}</span>
                  <button type="button" className={btnSm} onClick={() => void prepare(f)} data-testid="fa-fee-again">{L("Open in Sales again", "Buka di Jualan semula")}</button>
                </div>
              ) : f.billable ? (
                <div className={css.row}>
                  <select className={selectClassSm} value={pick[f.note_id] ?? opts[0]?.id ?? ""} onChange={(e) => setPick((p) => ({ ...p, [f.note_id]: Number(e.target.value) }))} aria-label={L("Template version (its fee rate)", "Versi templat (kadar yurannya)")} disabled={!opts.length}>
                    {!opts.length && <option value="">{L("No published template with a fee rate", "Tiada templat diterbitkan dengan kadar yuran")}</option>}
                    {opts.map((v) => <option key={v.id} value={v.id}>{`${lib?.templates.find((t) => t.id === v.template_id)?.name ?? ""} v${v.version} · ${rate(v.fee_bp)} = ${fmtRM(Math.floor(((f.approved_cents ?? 0) * (v.fee_bp ?? 0) + 5000) / 10000))}`}</option>)}
                  </select>
                  <button type="button" className={btnSmPrimary} disabled={!opts.length} onClick={() => void prepare(f)} data-testid="fa-fee-prepare"><AppIcon name="document" />{L("Prepare fee quotation", "Sediakan sebut harga yuran")}</button>
                </div>
              ) : <p className={css.sub}>{L("Not billable: the record needs the bank's evidence and the disbursed amount.", "Tidak boleh dibilkan: rekod perlu bukti bank dan jumlah dikeluarkan.")}</p>}
              {problem[f.note_id] && <p className={ac.warn} role="alert">{problem[f.note_id]}</p>}
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ the template library */
function Library({ lib, toast, reload }: { lib: Lib | null; toast: Toast; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ name: "", issuer_code: "a2z", service_type: "personal_financing" });
  const draft = !!lib?.can.draft;
  const add = async () => {
    const r = await api<ErrBody>("/staff/fa/templates", { method: "POST", body: JSON.stringify(nf) });
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), msgOf(r), "notice"); return; }
    toast(L("Template added", "Templat ditambah"), L("Upload its Word file or type its text as version 1.", "Muat naik fail Word atau taip teksnya sebagai versi 1."));
    setAdding(false); setNf({ name: "", issuer_code: "a2z", service_type: "personal_financing" }); reload();
  };
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Template library", "Pustaka templat")} data-testid="fa-agr-library">
      <div className={css.head}>
        <h3 className={css.h}><AppIcon name="folder" />{L("Template library", "Pustaka templat")}</h3>
        {draft && <button type="button" className={btnSmPrimary} onClick={() => setAdding((a) => !a)} data-testid="fa-tpl-add"><AppIcon name="add" />{L("New template", "Templat baharu")}</button>}
      </div>
      <p className={css.sub}>{draft ? L("Upload the agreement as a Word file (or type it). Use the fields below in double braces. Every change is a new version; the CEO publishes, with the legal basis recorded.", "Muat naik perjanjian sebagai fail Word (atau taip). Guna medan di bawah dalam kurungan berganda. Setiap perubahan ialah versi baharu; CEO menerbitkan, dengan asas undang-undang direkod.") : L("The published agreement templates. Management drafts them; the CEO publishes.", "Templat perjanjian yang diterbitkan. Pengurusan mendraf; CEO menerbitkan.")}</p>
      {adding && (
        <div className={ac.form} data-testid="fa-tpl-form">
          <input className={inputClassSm} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder={L("Template name", "Nama templat")} aria-label={L("Template name", "Nama templat")} data-testid="fa-tpl-name" />
          <select className={selectClassSm} value={nf.issuer_code} onChange={(e) => setNf({ ...nf, issuer_code: e.target.value })} aria-label={L("Company", "Syarikat")}>{Object.entries(COMPANY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className={selectClassSm} value={nf.service_type} onChange={(e) => setNf({ ...nf, service_type: e.target.value })} aria-label={L("Service", "Perkhidmatan")}>{Object.keys(PRODUCT).map((k) => <option key={k} value={k}>{L(...(PRODUCT[k] as [string, string]))}</option>)}</select>
          <button type="button" className={btnSmPrimary} disabled={nf.name.trim().length < 3} onClick={() => void add()} data-testid="fa-tpl-save">{L("Add template", "Tambah templat")}</button>
        </div>
      )}
      {draft && lib && (
        <details className={ac.ref}><summary>{L("Merge fields", "Medan gabungan")}</summary>
          <ul className={ac.chips}>{Object.entries(lib.fields).map(([k, v]) => <li key={k}><code>{`{{${k}}}`}</code> {v}</li>)}</ul>
        </details>
      )}
      {!lib ? <SkelRows rows={3} /> : lib.templates.length === 0 ? <p className={css.empty}>{L("No agreement template yet.", "Belum ada templat perjanjian.")}</p> : (
        <ul className={ac.tpls}>{lib.templates.map((t) => <TemplateRow key={t.id} t={t} lib={lib} toast={toast} reload={reload} />)}</ul>
      )}
    </section>
  );
}

function TemplateRow({ t, lib, toast, reload }: { t: Tpl; lib: Lib; toast: Toast; reload: () => void }) {
  const vers = lib.versions.filter((v) => v.template_id === t.id);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!vers.length && !lib.can.draft) return null;
  const post = async (path: string, body: unknown, ok: string, method = "POST") => {
    setBusy(true);
    const r = await api<ErrBody & { check?: Check }>(path, { method, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      const ck = (r.data as ErrBody | null)?.error?.check;
      toast(L("Not saved", "Tidak disimpan"), ck ? checkWords(ck).join(" · ") : msgOf(r), "notice");
      return false;
    }
    toast(ok, ""); reload(); return true;
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast(L("Too large", "Terlalu besar"), L("A template file is at most 2 MB.", "Fail templat paling besar 2 MB."), "notice"); return; }
    await post(`/staff/fa/templates/${t.id}/versions`, { docx_base64: await toBase64(f), file_name: f.name }, L("Word file read - check the text and the fields", "Fail Word dibaca - semak teks dan medan"));
  };
  return (
    <li className={ac.tpl} data-testid="fa-tpl">
      <div className={css.head}>
        <div><b>{t.name}</b> <span className={css.sub}>{COMPANY[t.issuer_code] ?? t.issuer_code} · {L(...(PRODUCT[t.service_type] ?? [t.service_type, t.service_type]) as [string, string])}</span></div>
        {lib.can.draft && (
          <span className={css.row}>
            <label className={btnSm}><AppIcon name="upload" />{L("Upload Word file", "Muat naik fail Word")}<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className={ac.file} disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} data-testid="fa-tpl-upload" /></label>
            <button type="button" className={btnSm} onClick={() => setTyping((x) => !x)} data-testid="fa-tpl-type">{L("Type text", "Taip teks")}</button>
          </span>
        )}
      </div>
      {typing && (
        <div className={ac.form}>
          <textarea className={textareaClass} rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label={L("Agreement text", "Teks perjanjian")} placeholder={L("# Heading\n\nA paragraph with {{client_name}} ...", "# Tajuk\n\nPerenggan dengan {{client_name}} ...")} data-testid="fa-tpl-text" />
          <button type="button" className={btnSmPrimary} disabled={busy || text.trim().length < 50} onClick={async () => { if (await post(`/staff/fa/templates/${t.id}/versions`, { body: text }, L("Version saved as a draft", "Versi disimpan sebagai draf"))) { setTyping(false); setText(""); } }} data-testid="fa-tpl-text-save">{L("Save as new version", "Simpan sebagai versi baharu")}</button>
        </div>
      )}
      <ul className={ac.vers}>{vers.map((v) => <VersionRow key={v.id} t={t} v={v} lib={lib} post={post} busy={busy} />)}</ul>
    </li>
  );
}

function VersionRow({ t, v, lib, post, busy }: { t: Tpl; v: Ver; lib: Lib; post: (path: string, body: unknown, ok: string, method?: string) => Promise<boolean>; busy: boolean }) {
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(v.body);
  const [fee, setFee] = useState(v.fee_bp ? (v.fee_bp / 100).toFixed(2) : "");
  const [pub, setPub] = useState(false);
  const [basis, setBasis] = useState<"counsel_reviewed" | "ceo_without_review">("counsel_reviewed");
  const [lg, setLg] = useState({ legal_reviewer: "", legal_firm: "", legal_reviewed_on: mytToday(), legal_reference: "" });
  const [ack, setAck] = useState(false);
  const [arch, setArch] = useState("");
  const [archOpen, setArchOpen] = useState(false);
  const feeBp = fee.trim() === "" ? null : Math.round(Number(fee) * 100);
  const issues = checkWords(v.check);
  const mine = v.created_by === lib.me && !lib.owner;
  return (
    <li className={ac.ver} data-testid="fa-tpl-version">
      <div className={css.row}>
        <b>v{v.version}</b>{stateChip(v.state)}
        <span className={css.sub}>{v.format === "docx" ? `${v.source_name ?? "Word"} · SHA-256 ${v.source_sha256?.slice(0, 12) ?? ""}` : L("Typed text", "Teks ditaip")} · {L("fee", "yuran")} {rate(v.fee_bp)} · {v.created_by_name ?? ""} {dmy(v.created_at.slice(0, 10))}</span>
      </div>
      {v.state === "approved" && <p className={css.sub} data-testid="fa-tpl-basis">{v.legal_basis === "ceo_without_review" ? L(`Published by ${v.published_by_name ?? "the CEO"} WITHOUT a legal review (recorded so)`, `Diterbitkan oleh ${v.published_by_name ?? "CEO"} TANPA semakan undang-undang (direkod)`) : L(`Reviewed by ${v.legal_reviewer} (${v.legal_firm}) on ${v.legal_reviewed_on ? dmy(v.legal_reviewed_on) : ""}, ref ${v.legal_reference} · published by ${v.published_by_name ?? ""}`, `Disemak oleh ${v.legal_reviewer} (${v.legal_firm}) pada ${v.legal_reviewed_on ? dmy(v.legal_reviewed_on) : ""}, rujukan ${v.legal_reference} · diterbitkan oleh ${v.published_by_name ?? ""}`)}</p>}
      {v.state === "archived" && <p className={css.sub}>{L("Archived", "Diarkib")}: {v.archived_reason}</p>}
      {v.state === "draft" && issues.length > 0 && <ul className={ac.issues} data-testid="fa-tpl-issues">{issues.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {edit && v.state === "draft" ? (
        <div className={ac.form}>
          <textarea className={textareaClass} rows={10} value={body} onChange={(e) => setBody(e.target.value)} aria-label={L("Agreement text", "Teks perjanjian")} data-testid="fa-tpl-edit-text" />
          <label className={ac.field}><span>{L("Service fee rate (%) - empty if this agreement carries no fee", "Kadar yuran perkhidmatan (%) - kosong jika tiada yuran")}</span>
            <input className={inputClassSm} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} data-testid="fa-tpl-fee" /></label>
          <div className={css.row}>
            <button type="button" className={btnSmPrimary} disabled={busy || (feeBp !== null && !(feeBp > 0 && feeBp <= 10000))} onClick={async () => { if (await post(`/staff/fa/templates/versions/${v.id}`, { body, fee_bp: feeBp }, L("Draft saved", "Draf disimpan"), "PUT")) setEdit(false); }} data-testid="fa-tpl-edit-save">{L("Save draft", "Simpan draf")}</button>
            <button type="button" className={btnSm} onClick={() => setEdit(false)}>{L("Cancel", "Batal")}</button>
          </div>
        </div>
      ) : (
        <details className={ac.ref}><summary>{L("Text", "Teks")}</summary><pre className={`${css.lines} ${ac.body}`}>{v.body}</pre></details>
      )}
      <div className={css.row}>
        {lib.can.draft && v.state === "draft" && !edit && <button type="button" className={btnSm} onClick={() => setEdit(true)} data-testid="fa-tpl-edit">{L("Edit draft", "Sunting draf")}</button>}
        {lib.can.draft && v.state === "draft" && <button type="button" className={btnSmPrimary} disabled={busy || !v.check.ok} onClick={() => void post(`/staff/fa/templates/versions/${v.id}/submit`, {}, L("Submitted for publishing", "Dihantar untuk diterbitkan"))} data-testid="fa-tpl-submit">{L("Submit for review", "Hantar untuk semakan")}</button>}
        {lib.can.draft && v.state !== "draft" && <button type="button" className={btnSm} disabled={busy} onClick={() => void post(`/staff/fa/templates/${t.id}/versions`, { from_version_id: v.id }, L("New draft version made from it", "Versi draf baharu dibuat daripadanya"))} data-testid="fa-tpl-copy">{L("New version from this", "Versi baharu daripada ini")}</button>}
        {lib.can.publish && v.state === "review" && (mine ? <span className={css.sub}>{L("You drafted it - another person publishes it", "Anda mendrafnya - orang lain menerbitkannya")}</span> : <button type="button" className={btnSmPrimary} onClick={() => setPub((p) => !p)} data-testid="fa-tpl-publish">{L("Publish", "Terbitkan")}</button>)}
        {v.source_sha256 && (lib.can.draft || lib.can.publish) && <a className={btnSm} href={`/api/v1/staff/fa/templates/versions/${v.id}/source`} data-testid="fa-tpl-source"><AppIcon name="download" />{L("Word file", "Fail Word")}</a>}
        {v.state !== "archived" && (v.state === "approved" ? lib.can.publish : lib.can.draft) && <button type="button" className={btnSm} onClick={() => setArchOpen((a) => !a)} data-testid="fa-tpl-archive">{L("Archive", "Arkib")}</button>}
      </div>
      {archOpen && (
        <div className={css.row}>
          <input className={inputClassSm} value={arch} onChange={(e) => setArch(e.target.value)} placeholder={L("Reason", "Sebab")} aria-label={L("Reason to archive", "Sebab diarkib")} />
          <button type="button" className={btnSm} disabled={busy || arch.trim().length < 5} onClick={() => void post(`/staff/fa/templates/versions/${v.id}/archive`, { reason: arch }, L("Archived", "Diarkib"))}>{L("Archive this version", "Arkibkan versi ini")}</button>
        </div>
      )}
      {pub && (
        <div className={ac.form} data-testid="fa-tpl-publish-form">
          <fieldset className={ac.basis}><legend>{L("Legal basis", "Asas undang-undang")}</legend>
            <label><input type="radio" checked={basis === "counsel_reviewed"} onChange={() => setBasis("counsel_reviewed")} /> {L("Reviewed by counsel", "Disemak oleh peguam")}</label>
            {lib.owner && <label><input type="radio" checked={basis === "ceo_without_review"} onChange={() => setBasis("ceo_without_review")} data-testid="fa-tpl-no-review" /> {L("Publish without a legal review (my decision)", "Terbitkan tanpa semakan undang-undang (keputusan saya)")}</label>}
          </fieldset>
          {basis === "counsel_reviewed" ? (
            <div className={ac.grid2}>
              <input className={inputClassSm} value={lg.legal_reviewer} onChange={(e) => setLg({ ...lg, legal_reviewer: e.target.value })} placeholder={L("Lawyer's name", "Nama peguam")} aria-label={L("Lawyer's name", "Nama peguam")} />
              <input className={inputClassSm} value={lg.legal_firm} onChange={(e) => setLg({ ...lg, legal_firm: e.target.value })} placeholder={L("Firm", "Firma")} aria-label={L("Firm", "Firma")} />
              <input className={inputClassSm} type="date" max={mytToday()} value={lg.legal_reviewed_on} onChange={(e) => setLg({ ...lg, legal_reviewed_on: e.target.value })} aria-label={L("Day of the review", "Tarikh semakan")} />
              <input className={inputClassSm} value={lg.legal_reference} onChange={(e) => setLg({ ...lg, legal_reference: e.target.value })} placeholder={L("Letter or reference", "Surat atau rujukan")} aria-label={L("Letter or reference", "Surat atau rujukan")} />
            </div>
          ) : (
            <label className={css.row}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="fa-tpl-ack" /> {L("I publish this version without a legal review. It is shown so on the version. Sending and signing stay off.", "Saya menerbitkan versi ini tanpa semakan undang-undang. Ia ditunjukkan begitu pada versi. Hantar dan tandatangan kekal dimatikan.")}</label>
          )}
          <p className={css.sub}>{L(`Fee rate on this version: ${rate(v.fee_bp)}. Publishing archives the version it replaces.`, `Kadar yuran pada versi ini: ${rate(v.fee_bp)}. Menerbitkan mengarkibkan versi yang diganti.`)}</p>
          <button type="button" className={btnSmPrimary} disabled={busy || (basis === "ceo_without_review" && !ack)} onClick={async () => { if (await post(`/staff/fa/templates/versions/${v.id}/publish`, basis === "counsel_reviewed" ? { legal_basis: basis, ...lg } : { legal_basis: basis, acknowledge: ack }, L("Version published", "Versi diterbitkan"))) setPub(false); }} data-testid="fa-tpl-publish-save">{L("Publish this version", "Terbitkan versi ini")}</button>
        </div>
      )}
    </li>
  );
}
