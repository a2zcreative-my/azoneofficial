"use client";

/* v1.284.0 - FINANCIAL ADVISORY, ONE CLIENT CASE (the CEO, 11-11-2026:
   "proceed with Financial Advisory"; claude/FINANCIAL-ADVISORY-BLUEPRINT.md
   sections 13-20, the third image). A full-screen sheet on a phone, a wide
   sheet on a desktop:

     header   the client, the case reference, the three statuses as three
              chips (pre-screen, banker feedback, formal application) -
              never one "Eligible" flag
     tabs     Overview, Profile & figures, DSR & matching, Kelayakan notes,
              Documents, Consents, Timeline, Agreement
     legal    the agreement, the proposed fee and sending documents to a
              bank are shown as switched off until counsel clears them

   The screen offers only what the server allows (worker/src/fa.ts); every
   figure on it comes from the server's own snapshot. */

import { useEffect, useState } from "react";
import { api, csrfFetch, type ApiResult } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmDanger, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { SideDrawer } from "@/components/ui/side-drawer";
import { LineTabs } from "@/components/ui/line-tabs";
import { AppIcon } from "@/components/ui/app-icon";
import { StageTimeline, type Stage } from "@/components/ui/stage-timeline";
import { SkelRows } from "@/components/ui/skeleton";
import { openAttachment } from "@/components/ui/document-preview";
import css from "./financial-advisory.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Err = { error?: { message?: string; code?: string } };
const msg = (r: { data: unknown }, fb: string) => (r.data as Err | null)?.error?.message ?? fb;
const toCents = (s: string) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) && n >= 0 && String(s).trim() !== "" ? Math.round(n * 100) : null; };
const pct = (bp: number | null | undefined) => (bp == null ? "—" : `${(bp / 100).toFixed(1)}%`);

/* the three status dimensions - their own words, never mixed */
export const PRESCREEN: Record<string, [string, string, string]> = {
  incomplete: ["Insufficient information", "Maklumat tidak mencukupi", chipSmNeutral],
  potentially_suitable: ["Potentially suitable — preliminary", "Mungkin sesuai — awal", chipSmInfo],
  manual_review: ["Requires manual review", "Perlu semakan manual", chipSmWarn],
  affordability_concern: ["Affordability concern", "Kebimbangan kemampuan", chipSmDanger],
  no_product: ["No suitable product identified", "Tiada produk sesuai dikenal pasti", chipSmNeutral],
};
export const BANKER: Record<string, [string, string, string]> = {
  not_contacted: ["Banker: not contacted", "Bank: belum dihubungi", chipSmNeutral],
  enquiry_sent: ["Banker: enquiry sent", "Bank: pertanyaan dihantar", chipSmWarn],
  under_review: ["Banker: under review", "Bank: dalam semakan", chipSmWarn],
  indicatively_suitable: ["Banker: indicatively suitable", "Bank: sesuai secara indikatif", chipSmInfo],
  documents_required: ["Banker: documents required", "Bank: dokumen diperlukan", chipSmWarn],
  not_supported: ["Banker: not supported", "Bank: tidak disokong", chipSmDanger],
};
export const APPLICATION: Record<string, [string, string, string]> = {
  not_submitted: ["Application: not submitted", "Permohonan: belum dihantar", chipSmNeutral],
  submitted: ["Application: submitted", "Permohonan: dihantar", chipSmWarn],
  processing: ["Application: processing", "Permohonan: diproses", chipSmWarn],
  conditional_offer: ["Conditional offer (official)", "Tawaran bersyarat (rasmi)", chipSmInfo],
  officially_approved: ["Officially approved (bank letter)", "Diluluskan secara rasmi (surat bank)", chipSmSuccess],
  declined: ["Declined (official)", "Ditolak (rasmi)", chipSmDanger],
  withdrawn: ["Withdrawn", "Ditarik balik", chipSmNeutral],
  disbursed: ["Disbursed (evidence)", "Dikeluarkan (bukti)", chipSmSuccess],
};
export const PRODUCT: Record<string, [string, string]> = {
  personal_financing: ["Personal financing", "Pembiayaan peribadi"], debt_consolidation: ["Debt consolidation", "Penyatuan hutang"], advisory_only: ["Advisory only", "Nasihat sahaja"],
};
export function Chip({ map, k }: { map: Record<string, [string, string, string]>; k: string }) {
  const w = map[k] ?? [k, k, chipSmNeutral];
  return <span className={`${w[2]} ${css.chip}`}>{L(w[0], w[1])}</span>;
}

const KINDS: Record<string, [string, string][]> = {
  income: [["gross_salary", "Gross salary"], ["net_salary", "Net salary (only net known)"], ["allowance", "Fixed allowance"], ["other_income", "Other regular income"]],
  deduction: [["epf", "EPF"], ["socso", "SOCSO"], ["eis", "EIS"], ["tax", "Tax (PCB)"], ["zakat", "Zakat"], ["other_deduction", "Other deduction"]],
  commitment: [["personal_financing", "Personal financing"], ["car", "Car financing"], ["housing", "Housing financing"], ["credit_card", "Credit card"], ["ptptn", "PTPTN"], ["bnpl", "Buy now pay later"], ["other_bank", "Other bank"], ["non_bank", "Non-bank"], ["other", "Other"]],
  expense: [["food", "Food"], ["rent", "Rent"], ["utilities", "Utilities"], ["transport", "Transport"], ["dependants", "Dependants"], ["insurance", "Insurance"], ["other", "Other"]],
};
const SIDE_WORD: Record<string, [string, string]> = { income: ["Income", "Pendapatan"], deduction: ["Deductions", "Potongan"], commitment: ["Monthly commitments", "Komitmen bulanan"], expense: ["Living costs", "Kos sara hidup"] };
const DOC_KINDS: [string, string][] = [["payslip", "Payslip"], ["bank_statement", "Bank statement"], ["epf", "EPF statement"], ["facility_statement", "Facility statement"], ["settlement_letter", "Settlement letter"], ["ccris_by_client", "CCRIS (from the client)"], ["ctos_by_client", "CTOS (from the client)"], ["ic", "IC copy"], ["consent", "Signed consent"], ["bank_decision", "Bank decision letter"], ["disbursement", "Disbursement proof"], ["other", "Other"]];
const docWord = (k: string) => DOC_KINDS.find((d) => d[0] === k)?.[1] ?? k;
const STEPS: [string, string, string][] = [["intake", "Client intake", "Pengambilan"], ["prescreen", "DSR pre-screen", "Saringan DSR"], ["matching", "Bank matching", "Padanan bank"], ["agreement", "Agreement", "Perjanjian"], ["application", "Application", "Permohonan"], ["decision", "Decision", "Keputusan"], ["fee", "Fee", "Yuran"]];
const STAGE_INDEX: Record<string, number> = { intake: 0, profile: 0, prescreen: 1, review: 1, matching: 2, agreement: 3, enquiry: 3, application: 4, decision: 5, disbursed: 5, fee: 6, closed: 7 };
const LOCKED_STEPS = new Set(["agreement", "application", "fee"]);

interface Item { id: number; side: string; kind: string; label: string | null; monthly_cents: number; outstanding_cents: number | null; arrears: number; settle_in_consolidation: number; settlement_doc_id: number | null; state: string; source: string; voided_at: string | null }
interface Doc { id: number; kind: string; doc_date: string | null; verified: number; uploaded_at: string; by_name: string | null }
interface Note { id: number; note_type: string; bank: string | null; source: string | null; status_value: string | null; body: string; conditions: string | null; missing_documents: string | null; follow_up_on: string | null; bank_reference: string | null; approved_cents: number | null; evidence_id: number | null; corrects_id: number | null; author: string | null; author_role: string | null; created_at: string }
interface Check { key: string; state: string; text: string }
interface Match { criterion_id: number; bank: string; checks: Check[]; missing_documents: string[]; stale: boolean; last_verified_on: string | null; fit: string }
interface Result {
  income_net_cents: number | null; commitments_cents: number; instalment_cents: number | null; expenses_cents: number; current_dsr_bp: number | null; projected_dsr_bp: number | null;
  disposable_cents: number | null; outcome: string; reasons: string[]; missing: string[]; matches: Match[]; unverified_commitments: number;
  consolidation: null | { before: { commitments_cents: number; dsr_bp: number | null }; overlap: { commitments_cents: number; instalment_cents: number | null; dsr_bp: number | null }; after: { commitments_cents: number; instalment_cents: number | null; dsr_bp: number | null; settled_ids: number[] } };
}
interface Pic {
  case: { id: number; case_ref: string; product: string; stage: string; prescreen: string; banker_status: string; application_status: string; override_result: string | null; override_reason: string | null; issuer_code: string; purpose: string | null; closed_reason: string | null; created_at: string; updated_at: string };
  customer: { id: number; name: string; phone: string | null; email: string | null } | null;
  owner: { id: number; name: string } | null;
  profile: { version: number; employment_status: string | null; employment_category: string | null; employer_type: string | null; service_months: number | null; salary_pattern: string | null; dependants: number | null; age_years: number | null; ic_masked: string | null } | null;
  items: Item[]; documents: Doc[]; consents: { id: number; kind: string; notice_version: string | null; institution: string | null; documents: string | null; captured_how: string; given_at: string; withdrawn_at: string | null; withdrawn_note: string | null }[];
  assessments: { id: number; result: string; outcome: string; created_at: string; by_name: string | null }[];
  notes: Note[]; events: { id: number; event: string; detail: string | null; created_at: string; actor: string | null }[];
  tasks: { id: number; title: string; deadline: string | null; status: string; assignee: string | null }[];
  can: { edit: boolean; decide: boolean; note: boolean };
  legal: { agreement: boolean; fee: boolean; disclosure: boolean; commission: boolean };
}
type Tab = "overview" | "figures" | "dsr" | "notes" | "documents" | "consents" | "timeline" | "agreement";
const EVENT_WORDS: Record<string, string> = {
  case_created: "Case created", consent_recorded: "Consent recorded", consent_withdrawn: "Consent withdrawn", profile_saved: "Profile saved", item_added: "Figure added",
  item_verify: "Figure verified", item_void: "Figure removed", item_settlement: "Settlement evidenced", document_uploaded: "Document uploaded", document_verified: "Document checked",
  prescreen_completed: "DSR pre-screen completed", prescreen_overridden: "Pre-screen overridden", banker_feedback: "Banker feedback recorded", bank_decision: "Official bank decision recorded",
  note_corrected: "Note corrected", task_created: "Task created", stage_changed: "Stage changed", case_closed: "Case closed", case_updated: "Case updated", member_added: "Assisting staff added",
};

export function FaCase({ caseId, onClose, onChanged, toast }: { caseId: number; onClose: () => void; onChanged: () => void; toast: (title: string, m: string, tone?: "notice") => void }) {
  const [pic, setPic] = useState<Pic | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    let live = true;
    void api<Pic>(`/staff/fa/cases/${caseId}`).then((r) => { if (!live) return; if (r.ok && r.data) { setPic(r.data); setFailed(false); } else setFailed(true); });
    return () => { live = false; };
  }, [caseId, tick]);
  const reload = () => { setTick((t) => t + 1); onChanged(); setDirty(false); };
  const post = async (call: Promise<ApiResult<Err>>, done: string) => {
    const r = await call;
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), msg(r, L("Try again", "Cuba lagi")), "notice"); return false; }
    toast(L("Saved", "Disimpan"), done); reload(); return true;
  };

  const c = pic?.case;
  const latest: Result | null = pic?.assessments[0] ? (() => { try { return JSON.parse(pic.assessments[0].result) as Result; } catch { return null; } })() : null;
  const step = c ? STAGE_INDEX[c.stage] ?? 0 : 0;

  return (
    <SideDrawer open onClose={onClose} wide full dirty={dirty}
      title={pic ? `${pic.customer?.name ?? L("Client", "Pelanggan")} · ${c?.case_ref}` : L("Client case", "Kes pelanggan")}
      subtitle={pic && c ? `${L(...PRODUCT[c.product]!)} · ${c.issuer_code === "a2z" ? "A2Z CREATIVE MARKETING" : "AZ ONE OFFICIAL"} · ${L("owner", "pemilik")} ${pic.owner?.name ?? "-"}` : undefined}>
      {failed ? <p className={css.empty}>{L("This case could not be opened.", "Kes ini tidak dapat dibuka.")}</p> : !pic || !c ? <SkelRows rows={6} /> : (
        <div className={css.stack} data-testid="fa-case">
          <div className={css.chips} data-testid="fa-statuses">
            <Chip map={PRESCREEN} k={c.override_result ?? c.prescreen} />
            <Chip map={BANKER} k={c.banker_status} />
            <Chip map={APPLICATION} k={c.application_status} />
            {c.override_result && <span className={`${chipSmNeutral} ${css.chip}`}>{L("Overridden by management", "Diatasi oleh pengurusan")}</span>}
            {c.stage === "closed" && <span className={`${chipSmNeutral} ${css.chip}`}>{L("Closed", "Ditutup")}: {c.closed_reason}</span>}
          </div>
          <ol className={css.strip} aria-label={L("Case progress", "Kemajuan kes")}>
            {STEPS.map(([k, en, ms], i) => (
              <li key={k} className={i < step ? css.done : i === step ? css.now : css.todo}>
                <span className={css.dot} aria-hidden="true"><AppIcon name={i < step ? "success" : LOCKED_STEPS.has(k) ? "lock" : "time"} /></span>
                <span>{L(en, ms)}{LOCKED_STEPS.has(k) && i >= step ? <small>{L("needs legal clearance", "perlu kelulusan undang-undang")}</small> : null}</span>
              </li>
            ))}
          </ol>
          <LineTabs value={tab} onChange={setTab} label={L("Case", "Kes")} tabs={[
            ["overview", L("Overview", "Gambaran")],
            ["figures", L("Profile & figures", "Profil & angka"), null, L("Figures", "Angka")],
            ["dsr", L("DSR & matching", "DSR & padanan"), null, "DSR"],
            ["notes", L("Kelayakan notes", "Nota kelayakan"), null, L("Notes", "Nota")],
            ["documents", L("Documents", "Dokumen"), null, L("Docs", "Dok")],
            ["consents", L("Consents", "Persetujuan")],
            ["timeline", L("Timeline", "Garis masa")],
            ["agreement", L("Agreement", "Perjanjian")],
          ]} />
          {tab === "overview" && <Overview pic={pic} latest={latest} go={setTab} post={post} />}
          {tab === "figures" && <Figures pic={pic} post={post} setDirty={setDirty} />}
          {tab === "dsr" && <Dsr pic={pic} latest={latest} post={post} setDirty={setDirty} />}
          {tab === "notes" && <Notes pic={pic} post={post} setDirty={setDirty} />}
          {tab === "documents" && <Documents pic={pic} reload={reload} toast={toast} post={post} />}
          {tab === "consents" && <Consents pic={pic} post={post} setDirty={setDirty} />}
          {tab === "timeline" && <Timeline pic={pic} post={post} setDirty={setDirty} />}
          {tab === "agreement" && <Agreement pic={pic} />}
          <p className={css.disclaimer}><AppIcon name="info" /><span><b>{L("Indicative only. Subject to official bank approval.", "Indikatif sahaja. Tertakluk kepada kelulusan rasmi bank.")}</b> {L("A2Z is not affiliated with any bank. Eligibility, terms and approval are decided by the bank.", "A2Z tidak bergabung dengan mana-mana bank. Kelayakan, terma dan kelulusan ditentukan oleh bank.")}</span></p>
        </div>
      )}
    </SideDrawer>
  );
}

type Post = (call: Promise<ApiResult<Err>>, done: string) => Promise<boolean>;
const send = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

function Overview({ pic, latest, go, post }: { pic: Pic; latest: Result | null; go: (t: Tab) => void; post: Post }) {
  const c = pic.case;
  const [closing, setClosing] = useState(false);
  const [why, setWhy] = useState("");
  const openTasks = pic.tasks.filter((t) => t.status !== "completed");
  const banker = pic.notes.find((n) => n.note_type === "banker");
  const consentsOk = ["privacy_notice", "assessment"].every((k) => pic.consents.some((x) => x.kind === k && !x.withdrawn_at));
  return (
    <div className={css.grid2}>
      <section className={`${card} ${css.sec}`} aria-label={L("DSR summary", "Ringkasan DSR")}>
        <h3 className={css.h}><AppIcon name="chart" />{L("DSR pre-screen", "Saringan DSR")} <span className={`${chipSmWarn} ${css.chip}`}>{L("Preliminary only", "Awal sahaja")}</span></h3>
        {!latest ? <p className={css.empty}>{consentsOk ? L("No pre-screen yet - add the figures, then run it.", "Belum ada saringan - tambah angka, kemudian jalankan.") : L("Record the privacy notice and the assessment consent first.", "Rekod notis privasi dan persetujuan penilaian dahulu.")}</p> : (
          <>
            <dl className={css.five} data-testid="fa-dsr">
              <div><dt>{L("Net income", "Pendapatan bersih")}</dt><dd>{latest.income_net_cents == null ? "—" : fmtRM(latest.income_net_cents)}</dd></div>
              <div><dt>{L("Commitments", "Komitmen")}</dt><dd>{fmtRM(latest.commitments_cents)}</dd></div>
              <div><dt>{L("Current DSR", "DSR semasa")}</dt><dd>{pct(latest.current_dsr_bp)}</dd></div>
              <div><dt>{L("Instalment*", "Ansuran*")}</dt><dd>{latest.instalment_cents == null ? "—" : fmtRM(latest.instalment_cents)}</dd></div>
              <div className={css.key}><dt>{L("Projected DSR", "DSR unjuran")}</dt><dd>{pct(latest.projected_dsr_bp)}</dd></div>
            </dl>
            <p className={css.sub}>{latest.reasons.join(". ")}. <i>{L("*Illustrative; not an offer.", "*Ilustrasi; bukan tawaran.")}</i></p>
          </>
        )}
        <button type="button" className={btnSm} onClick={() => go("dsr")}>{L("Open DSR & matching", "Buka DSR & padanan")}</button>
      </section>
      <section className={`${card} ${css.sec}`} aria-label={L("Next action", "Tindakan seterusnya")}>
        <h3 className={css.h}><AppIcon name="target" />{L("Next action", "Tindakan seterusnya")}</h3>
        {openTasks.length === 0 ? <p className={css.sub}>{L("No open task - add one in Timeline.", "Tiada tugasan terbuka - tambah dalam Garis masa.")}</p> : (
          <ul className={css.list}>{openTasks.slice(0, 4).map((t) => <li key={t.id}><AppIcon name="time" /><span>{t.title.replace(`${c.case_ref}: `, "")}{t.deadline ? ` · ${dmy(t.deadline)}` : ""}</span></li>)}</ul>
        )}
        <h3 className={css.h}><AppIcon name="chat" />{L("Latest banker feedback", "Maklum balas bank terkini")}</h3>
        {!banker ? <p className={css.sub}>{L("None yet.", "Belum ada.")}</p> : <p className={css.sub}><b>{banker.bank}</b> · {dmyMYT(banker.created_at)} — {banker.body} <em>{L("Not a bank approval.", "Bukan kelulusan bank.")}</em></p>}
        <button type="button" className={btnSm} onClick={() => go("notes")}>{L("Open notes", "Buka nota")}</button>
        {pic.can.edit && c.stage !== "closed" && (
          <div className={css.row}>
            {c.stage === "prescreen" && <button type="button" className={btnSm} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}`, send({ stage: "matching" }, "PATCH")), L("Moved to bank matching", "Dipindah ke padanan bank"))}>{L("Move to bank matching", "Pindah ke padanan bank")}</button>}
            {c.stage === "prescreen" && <button type="button" className={btnSm} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}`, send({ stage: "review" }, "PATCH")), L("Sent for management review", "Dihantar untuk semakan"))}>{L("Ask for management review", "Minta semakan pengurusan")}</button>}
            {!closing ? <button type="button" className={btnSmQuiet} onClick={() => setClosing(true)}>{L("Close case", "Tutup kes")}</button> : (
              <span className={css.inline}>
                <select className={selectClassSm} value={why} onChange={(e) => setWhy(e.target.value)} aria-label={L("Reason", "Sebab")}>
                  <option value="">{L("Why does it close?", "Mengapa ditutup?")}</option>
                  {[["No loan advised (advisory outcome)", "Tiada pinjaman dinasihatkan"], ["Declined by the bank", "Ditolak oleh bank"], ["Withdrawn by the client", "Ditarik balik oleh pelanggan"], ["Client stopped responding", "Pelanggan berhenti membalas"], ["Completed", "Selesai"]].map(([en, ms]) => <option key={en} value={en}>{L(en!, ms!)}</option>)}
                </select>
                <button type="button" className={btnSmDanger} disabled={!why} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}`, send({ stage: "closed", closed_reason: why }, "PATCH")), L("Case closed", "Kes ditutup"))}>{L("Close", "Tutup")}</button>
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Figures({ pic, post, setDirty }: { pic: Pic; post: Post; setDirty: (d: boolean) => void }) {
  const c = pic.case;
  const p = pic.profile;
  const [f, setF] = useState({ employment_status: p?.employment_status ?? "", employment_category: p?.employment_category ?? "", employer_type: p?.employer_type ?? "", service_months: p?.service_months?.toString() ?? "", salary_pattern: p?.salary_pattern ?? "", dependants: p?.dependants?.toString() ?? "", age_years: p?.age_years?.toString() ?? "", ic: "" });
  const [it, setIt] = useState({ side: "income", kind: "gross_salary", label: "", monthly: "", outstanding: "", arrears: false, source: "declared" });
  const [verifyFor, setVerifyFor] = useState<{ id: number; mode: "verify" | "settlement" } | null>(null);
  const [doc, setDoc] = useState<number | "">("");
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setDirty(true); };
  const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s)) || 0));
  const live = pic.items.filter((i) => !i.voided_at);
  const docs = pic.documents;
  return (
    <div className={css.stack}>
      <section className={`${card} ${css.sec}`} aria-label={L("Profile", "Profil")}>
        <h3 className={css.h}><AppIcon name="person" />{L("Profile", "Profil")} {p ? <span className={css.sub}>v{p.version}{p.ic_masked ? ` · IC ${p.ic_masked}` : ""}</span> : null}</h3>
        <div className={css.form}>
          <label className={css.field}>{L("Employment status", "Status pekerjaan")}<select className={selectClassSm} value={f.employment_status} onChange={(e) => set("employment_status", e.target.value)}><option value="">—</option>{["employed", "self_employed", "retired", "unemployed"].map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select></label>
          <label className={css.field}>{L("Employment category", "Kategori pekerjaan")}<select className={selectClassSm} value={f.employment_category} onChange={(e) => set("employment_category", e.target.value)}><option value="">—</option>{["permanent", "contract", "government", "glc", "private", "business_owner", "commission_based"].map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select></label>
          <label className={css.field}>{L("Employer type", "Jenis majikan")}<input className={inputClassSm} value={f.employer_type} maxLength={60} onChange={(e) => set("employer_type", e.target.value)} /></label>
          <label className={css.field}>{L("Length of service (months)", "Tempoh berkhidmat (bulan)")}<input className={inputClassSm} inputMode="numeric" value={f.service_months} onChange={(e) => set("service_months", e.target.value.replace(/\D/g, ""))} /></label>
          <label className={css.field}>{L("Salary paid", "Gaji dibayar")}<select className={selectClassSm} value={f.salary_pattern} onChange={(e) => set("salary_pattern", e.target.value)}><option value="">—</option>{["bank_credit", "cash", "variable"].map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select></label>
          <label className={css.field}>{L("Dependants", "Tanggungan")}<input className={inputClassSm} inputMode="numeric" value={f.dependants} onChange={(e) => set("dependants", e.target.value.replace(/\D/g, ""))} /></label>
          <label className={css.field}>{L("Age", "Umur")}<input className={inputClassSm} inputMode="numeric" value={f.age_years} onChange={(e) => set("age_years", e.target.value.replace(/\D/g, ""))} /></label>
          <label className={css.field}>{L("MyKad number (stored masked)", "No. MyKad (disimpan bertopeng)")}<input className={inputClassSm} inputMode="numeric" autoComplete="off" value={f.ic} placeholder={p?.ic_masked ?? "000000-00-0000"} onChange={(e) => set("ic", e.target.value.replace(/[^0-9-]/g, "").slice(0, 14))} /></label>
        </div>
        {pic.can.edit && <button type="button" className={btnSmPrimary} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/profile`, send({ ...f, service_months: num(f.service_months), dependants: num(f.dependants), age_years: num(f.age_years), ic: f.ic || undefined }, "PUT")), L("Profile saved", "Profil disimpan"))}>{L("Save profile", "Simpan profil")}</button>}
      </section>
      {(["income", "deduction", "commitment", "expense"] as const).map((side) => {
        const rows = live.filter((i) => i.side === side);
        return (
          <section key={side} className={`${card} ${css.sec}`} aria-label={L(...SIDE_WORD[side]!)}>
            <h3 className={css.h}>{L(...SIDE_WORD[side]!)} <span className={css.sub}>{fmtRM(rows.reduce((a, i) => a + i.monthly_cents, 0))} / {L("month", "bulan")}</span></h3>
            {rows.length === 0 ? <p className={css.sub}>{L("None recorded.", "Tiada direkod.")}</p> : (
              <ul className={css.items}>
                {rows.map((i) => (
                  <li key={i.id} className={css.item} data-testid="fa-item">
                    <span className={css.itemMain}><b>{KINDS[side]?.find((k) => k[0] === i.kind)?.[1] ?? i.kind}</b>{i.label ? ` · ${i.label}` : ""}<span className={css.sub}>{i.source}{i.outstanding_cents ? ` · ${L("outstanding", "baki")} ${fmtRM(i.outstanding_cents)}` : ""}{i.arrears ? ` · ${L("arrears", "tunggakan")}` : ""}{i.settle_in_consolidation ? ` · ${L("settled in consolidation (evidenced)", "dijelaskan dalam penyatuan (berbukti)")}` : ""}</span></span>
                    <b className={css.num}>{fmtRM(i.monthly_cents)}</b>
                    <span className={i.state === "verified" ? chipSmSuccess : chipSmWarn}>{i.state === "verified" ? L("Verified", "Disahkan") : L("Declared", "Diisytihar")}</span>
                    {pic.can.edit && (
                      <span className={css.inline}>
                        {i.state !== "verified" && <button type="button" className={btnSmQuiet} onClick={() => { setVerifyFor({ id: i.id, mode: "verify" }); setDoc(""); }}>{L("Verify", "Sahkan")}</button>}
                        {side === "commitment" && c.product === "debt_consolidation" && !i.settle_in_consolidation && <button type="button" className={btnSmQuiet} onClick={() => { setVerifyFor({ id: i.id, mode: "settlement" }); setDoc(""); }}>{L("Settled by consolidation", "Dijelaskan oleh penyatuan")}</button>}
                        <button type="button" className={btnSmQuiet} onClick={() => void post(api<Err>(`/staff/fa/items/${i.id}/void`, send({ reason: "Entered in error" }, "POST")), L("Removed", "Dibuang"))}>{L("Remove", "Buang")}</button>
                      </span>
                    )}
                    {verifyFor?.id === i.id && (
                      <span className={css.inline}>
                        <select className={selectClassSm} value={doc} onChange={(e) => setDoc(e.target.value ? Number(e.target.value) : "")} aria-label={L("Evidence document", "Dokumen bukti")}>
                          <option value="">{L("Choose the document", "Pilih dokumen")}</option>
                          {docs.filter((d) => verifyFor.mode === "settlement" ? d.kind === "settlement_letter" : d.kind !== "settlement_letter").map((d) => <option key={d.id} value={d.id}>{docWord(d.kind)} · {d.doc_date ? dmy(d.doc_date) : dmyMYT(d.uploaded_at)}</option>)}
                        </select>
                        <button type="button" className={btnSmPrimary} disabled={doc === ""} onClick={() => void post(api<Err>(`/staff/fa/items/${i.id}/${verifyFor.mode}`, send(verifyFor.mode === "verify" ? { evidence_id: doc } : { settlement_doc_id: doc }, "POST")), L("Saved", "Disimpan")).then(() => setVerifyFor(null))}>{L("Confirm", "Sahkan")}</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {pic.can.edit && (
        <section className={`${card} ${css.sec}`} aria-label={L("Add a figure", "Tambah angka")}>
          <h3 className={css.h}><AppIcon name="add" />{L("Add a figure", "Tambah angka")}</h3>
          <div className={css.form}>
            <label className={css.field}>{L("Type", "Jenis")}<select className={selectClassSm} value={it.side} onChange={(e) => setIt({ ...it, side: e.target.value, kind: KINDS[e.target.value]![0]![0] })}>{Object.keys(KINDS).map((s) => <option key={s} value={s}>{L(...SIDE_WORD[s]!)}</option>)}</select></label>
            <label className={css.field}>{L("What", "Apa")}<select className={selectClassSm} value={it.kind} onChange={(e) => setIt({ ...it, kind: e.target.value })}>{KINDS[it.side]!.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></label>
            <label className={css.field}>{L("Label (lender or note)", "Label (pemberi pinjaman atau nota)")}<input className={inputClassSm} value={it.label} maxLength={80} onChange={(e) => { setIt({ ...it, label: e.target.value }); setDirty(true); }} /></label>
            <label className={css.field}>{L("Monthly (RM)", "Bulanan (RM)")}<input className={inputClassSm} inputMode="decimal" value={it.monthly} onChange={(e) => { setIt({ ...it, monthly: e.target.value }); setDirty(true); }} /></label>
            {it.side === "commitment" && <label className={css.field}>{L("Outstanding (RM)", "Baki (RM)")}<input className={inputClassSm} inputMode="decimal" value={it.outstanding} onChange={(e) => setIt({ ...it, outstanding: e.target.value })} /></label>}
            <label className={css.field}>{L("Source", "Sumber")}<select className={selectClassSm} value={it.source} onChange={(e) => setIt({ ...it, source: e.target.value })}>{["declared", "payslip", "bank_statement", "epf", "facility_statement", "ccris_by_client", "ctos_by_client", "letter", "other"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></label>
            {it.side === "commitment" && <label className={css.check}><input type="checkbox" checked={it.arrears} onChange={(e) => setIt({ ...it, arrears: e.target.checked })} /> {L("In arrears", "Dalam tunggakan")}</label>}
          </div>
          <p className={css.sub}>{L("Never record a password, OTP, PIN or online-banking login. A figure counts as verified only after you link its document.", "Jangan rekod kata laluan, OTP, PIN atau log masuk perbankan. Angka dikira disahkan hanya selepas dokumennya dipautkan.")}</p>
          <button type="button" className={btnSmPrimary} disabled={toCents(it.monthly) == null} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/items`, send({ side: it.side, kind: it.kind, label: it.label || undefined, monthly_cents: toCents(it.monthly), outstanding_cents: toCents(it.outstanding) ?? undefined, arrears: it.arrears, source: it.source }, "POST")), L("Figure added", "Angka ditambah")).then((ok) => ok && setIt({ ...it, label: "", monthly: "", outstanding: "", arrears: false }))}>{L("Add", "Tambah")}</button>
        </section>
      )}
    </div>
  );
}

function Dsr({ pic, latest, post, setDirty }: { pic: Pic; latest: Result | null; post: Post; setDirty: (d: boolean) => void }) {
  const c = pic.case;
  const [mode, setMode] = useState<"instalment" | "loan">("instalment");
  const [inst, setInst] = useState("");
  const [amount, setAmount] = useState("");
  const [tenure, setTenure] = useState("");
  const [rate, setRate] = useState("");
  const [ov, setOv] = useState({ outcome: "manual_review", reason: "" });
  const run = () => post(api<Err>(`/staff/fa/cases/${c.id}/assess`, send(mode === "instalment" ? { instalment_cents: toCents(inst) } : { amount_cents: toCents(amount), tenure_months: Number(tenure) || null, rate_bp: Math.round((Number(rate) || 0) * 100) }, "POST")), L("Pre-screen completed", "Saringan selesai"));
  const k = latest?.consolidation;
  return (
    <div className={css.stack}>
      {pic.can.edit && c.product !== "advisory_only" && (
        <section className={`${card} ${css.sec}`} aria-label={L("Run the pre-screen", "Jalankan saringan")}>
          <h3 className={css.h}><AppIcon name="chart" />{L("Run the DSR pre-screen", "Jalankan saringan DSR")}</h3>
          <div className={css.form}>
            <label className={css.field}>{L("Proposed", "Dicadangkan")}<select className={selectClassSm} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="instalment">{L("Monthly instalment", "Ansuran bulanan")}</option><option value="loan">{L("Amount, tenure, illustrative rate", "Jumlah, tempoh, kadar ilustrasi")}</option></select></label>
            {mode === "instalment" ? <label className={css.field}>{L("Instalment (RM / month)", "Ansuran (RM / bulan)")}<input className={inputClassSm} inputMode="decimal" value={inst} onChange={(e) => { setInst(e.target.value); setDirty(true); }} /></label> : (<>
              <label className={css.field}>{L("Amount (RM)", "Jumlah (RM)")}<input className={inputClassSm} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label className={css.field}>{L("Tenure (months)", "Tempoh (bulan)")}<input className={inputClassSm} inputMode="numeric" value={tenure} onChange={(e) => setTenure(e.target.value.replace(/\D/g, ""))} /></label>
              <label className={css.field}>{L("Illustrative rate (% a year)", "Kadar ilustrasi (% setahun)")}<input className={inputClassSm} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
            </>)}
          </div>
          <p className={css.sub}>{L("The rate is an assumption for planning, never an offer. Only verified income counts.", "Kadar ialah andaian untuk perancangan, bukan tawaran. Hanya pendapatan disahkan dikira.")}</p>
          <button type="button" className={btnSmPrimary} data-testid="fa-run" onClick={() => void run()}>{L("Run pre-screen", "Jalankan saringan")}</button>
        </section>
      )}
      {!latest ? <p className={css.empty}>{L("No pre-screen yet.", "Belum ada saringan.")}</p> : (
        <>
          <section className={`${card} ${css.sec}`} aria-label={L("Result", "Keputusan")}>
            <h3 className={css.h}>{L("Result", "Keputusan")} <Chip map={PRESCREEN} k={latest.outcome} /> <span className={css.sub}>{dmyMYT(pic.assessments[0]!.created_at)} · {pic.assessments[0]!.by_name}</span></h3>
            <dl className={css.five}>
              <div><dt>{L("Net income (verified)", "Pendapatan bersih (disahkan)")}</dt><dd>{latest.income_net_cents == null ? "—" : fmtRM(latest.income_net_cents)}</dd></div>
              <div><dt>{L("Commitments", "Komitmen")}</dt><dd>{fmtRM(latest.commitments_cents)}</dd></div>
              <div><dt>{L("Current DSR", "DSR semasa")}</dt><dd>{pct(latest.current_dsr_bp)}</dd></div>
              <div><dt>{L("Instalment*", "Ansuran*")}</dt><dd>{latest.instalment_cents == null ? "—" : fmtRM(latest.instalment_cents)}</dd></div>
              <div className={css.key}><dt>{L("Projected DSR", "DSR unjuran")}</dt><dd>{pct(latest.projected_dsr_bp)}</dd></div>
            </dl>
            <ul className={css.reasons}>{latest.reasons.map((r) => <li key={r}>{r}</li>)}{latest.disposable_cents != null && <li>{L("Left after commitments and instalment", "Baki selepas komitmen dan ansuran")}: {fmtRM(latest.disposable_cents)}{latest.expenses_cents ? ` · ${L("living costs", "kos sara hidup")} ${fmtRM(latest.expenses_cents)}` : ""}</li>}{latest.unverified_commitments > 0 && <li>{latest.unverified_commitments} {L("commitment(s) declared, not verified", "komitmen diisytihar, belum disahkan")}</li>}</ul>
            {c.override_result && <p className="erp-note">{L("Management override", "Penggantian pengurusan")}: <b>{L(...(PRESCREEN[c.override_result] ?? [c.override_result, c.override_result]).slice(0, 2) as [string, string])}</b> — {c.override_reason}</p>}
          </section>
          {k && (
            <section className={`${card} ${css.sec}`} aria-label={L("Debt consolidation periods", "Tempoh penyatuan hutang")} data-testid="fa-consolidation">
              <h3 className={css.h}>{L("Debt consolidation — three periods", "Penyatuan hutang — tiga tempoh")}</h3>
              <dl className={css.periods}>
                <div><dt>{L("A · Before", "A · Sebelum")}</dt><dd>{fmtRM(k.before.commitments_cents)} · <b>{pct(k.before.dsr_bp)}</b></dd></div>
                <div className={css.warnRow}><dt>{L("B · Overlap (until settlement)", "B · Bertindih (hingga dijelaskan)")}</dt><dd>{fmtRM(k.overlap.commitments_cents)} + {k.overlap.instalment_cents == null ? "—" : fmtRM(k.overlap.instalment_cents)} · <b>{pct(k.overlap.dsr_bp)}</b></dd></div>
                <div><dt>{L("C · After evidenced settlement", "C · Selepas penjelasan berbukti")}</dt><dd>{fmtRM(k.after.commitments_cents)} + {k.after.instalment_cents == null ? "—" : fmtRM(k.after.instalment_cents)} · <b>{pct(k.after.dsr_bp)}</b></dd></div>
              </dl>
              <p className={css.sub}>{L("Only facilities with a settlement letter leave in period C. A lower monthly figure does not make a consolidation beneficial: compare the total cost and tenure with the client.", "Hanya kemudahan dengan surat penjelasan dikeluarkan dalam tempoh C. Ansuran lebih rendah tidak bermakna penyatuan menguntungkan: bandingkan jumlah kos dan tempoh dengan pelanggan.")}</p>
            </section>
          )}
          <section className={`${card} ${css.sec}`} aria-label={L("Bank matches", "Padanan bank")} data-testid="fa-matches">
            <h3 className={css.h}><AppIcon name="balance" />{L("Bank matches", "Padanan bank")} <span className={css.sub}>{L("verified criteria only · no score", "kriteria disahkan sahaja · tiada skor")}</span></h3>
            {latest.matches.length === 0 ? <p className={css.sub}>{L("No verified bank criterion for this product yet. Management verifies criteria in Bank criteria.", "Belum ada kriteria bank disahkan untuk produk ini. Pengurusan mengesahkan kriteria dalam Kriteria bank.")}</p> : latest.matches.map((m) => (
              <div key={m.criterion_id} className={css.match}>
                <div><b>{m.bank}</b><span className={css.sub}>{L("verified", "disahkan")} {m.last_verified_on ? dmy(m.last_verified_on) : "—"}{m.stale ? ` · ${L("stale - re-check", "lapuk - semak semula")}` : ""}</span></div>
                <ul>{m.checks.map((x) => <li key={x.key + x.text} className={x.state === "ok" ? css.ok : x.state === "failed" ? css.bad : css.unv}>{x.text}</li>)}{m.missing_documents.map((d) => <li key={d} className={css.bad}>{L("Missing", "Tiada")}: {docWord(d)}</li>)}</ul>
                <span className={`${chipSmWarn} ${css.chip}`}>{L("Banker review required", "Semakan bank diperlukan")}</span>
              </div>
            ))}
          </section>
          {pic.can.decide && (
            <section className={`${card} ${css.sec}`} aria-label={L("Override", "Atasi")}>
              <h3 className={css.h}>{L("Management override", "Penggantian pengurusan")}</h3>
              <div className={css.form}>
                <label className={css.field}>{L("Set the pre-screen to", "Tetapkan saringan kepada")}<select className={selectClassSm} value={ov.outcome} onChange={(e) => setOv({ ...ov, outcome: e.target.value })}>{["potentially_suitable", "manual_review", "affordability_concern", "no_product"].map((o) => <option key={o} value={o}>{L(...(PRESCREEN[o]!.slice(0, 2) as [string, string]))}</option>)}</select></label>
                <label className={css.field}>{L("Why (at least 20 characters; audited)", "Mengapa (sekurang-kurangnya 20 aksara; diaudit)")}<textarea className={textareaClass} rows={2} value={ov.reason} onChange={(e) => { setOv({ ...ov, reason: e.target.value }); setDirty(true); }} /></label>
              </div>
              <button type="button" className={btnSm} disabled={ov.reason.trim().length < 20} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/override`, send(ov, "POST")), L("Override recorded", "Penggantian direkod"))}>{L("Record override", "Rekod penggantian")}</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Notes({ pic, post, setDirty }: { pic: Pic; post: Post; setDirty: (d: boolean) => void }) {
  const c = pic.case;
  const [mode, setMode] = useState<"" | "banker" | "decision">("");
  const [n, setN] = useState({ bank: "", source: "call", status: "under_review", body: "", conditions: "", missing: "", follow: "", ref: "", approved: "", evidence: "" as number | "" });
  const set = (k: keyof typeof n, v: string | number) => { setN({ ...n, [k]: v }); setDirty(true); };
  const GROUPS: [string, string, string, string][] = [["system", "A · System assessment", "A · Penilaian sistem", css.nA ?? ""], ["banker", "B · Banker feedback", "B · Maklum balas bank", css.nB ?? ""], ["decision", "C · Official bank decision", "C · Keputusan rasmi bank", css.nC ?? ""]];
  return (
    <div className={css.stack}>
      {(pic.can.note || pic.can.decide) && c.stage !== "closed" && (
        <div className={css.row}>
          {pic.can.note && <button type="button" className={btnSmPrimary} onClick={() => { setMode("banker"); setN({ ...n, status: "under_review" }); }}><AppIcon name="add" />{L("Add banker feedback", "Tambah maklum balas bank")}</button>}
          {pic.can.decide && <button type="button" className={btnSm} onClick={() => { setMode("decision"); setN({ ...n, status: "officially_approved" }); }}>{L("Record official bank decision", "Rekod keputusan rasmi bank")}</button>}
        </div>
      )}
      {mode && (
        <section className={`${card} ${css.sec}`} aria-label={L("New note", "Nota baharu")} data-testid="fa-note-form">
          <div className={css.form}>
            <label className={css.field}>{L("Bank", "Bank")}<input className={inputClassSm} value={n.bank} maxLength={80} onChange={(e) => set("bank", e.target.value)} /></label>
            {mode === "banker" && <label className={css.field}>{L("Source", "Sumber")}<select className={selectClassSm} value={n.source} onChange={(e) => set("source", e.target.value)}>{["call", "email", "whatsapp", "meeting", "other"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>}
            <label className={css.field}>{mode === "banker" ? L("Indicative assessment", "Penilaian indikatif") : L("Decision", "Keputusan")}
              <select className={selectClassSm} value={n.status} onChange={(e) => set("status", e.target.value)}>
                {(mode === "banker" ? ["enquiry_sent", "under_review", "indicatively_suitable", "documents_required", "not_supported"] : ["conditional_offer", "officially_approved", "declined", "disbursed"]).map((s) => <option key={s} value={s}>{L(...((mode === "banker" ? BANKER : APPLICATION)[s]!.slice(0, 2) as [string, string]))}</option>)}
              </select>
            </label>
            <label className={`${css.field} ${css.wide}`}>{L("What was said / decided", "Apa yang dinyatakan / diputuskan")}<textarea className={textareaClass} rows={3} maxLength={2000} value={n.body} onChange={(e) => set("body", e.target.value)} /></label>
            <label className={css.field}>{L("Conditions", "Syarat")}<input className={inputClassSm} value={n.conditions} maxLength={600} onChange={(e) => set("conditions", e.target.value)} /></label>
            {mode === "banker" && <label className={css.field}>{L("Missing documents", "Dokumen tiada")}<input className={inputClassSm} value={n.missing} maxLength={600} onChange={(e) => set("missing", e.target.value)} /></label>}
            {mode === "banker" && <label className={css.field}>{L("Follow up on", "Susulan pada")}<input className={inputClassSm} type="date" value={n.follow} min={mytToday()} onChange={(e) => set("follow", e.target.value)} /></label>}
            {mode === "decision" && <label className={css.field}>{L("Bank reference", "Rujukan bank")}<input className={inputClassSm} value={n.ref} maxLength={80} onChange={(e) => set("ref", e.target.value)} /></label>}
            {mode === "decision" && <label className={css.field}>{L("Amount as stated by the bank (RM)", "Jumlah seperti dinyatakan bank (RM)")}<input className={inputClassSm} inputMode="decimal" value={n.approved} onChange={(e) => set("approved", e.target.value)} /></label>}
            <label className={css.field}>{mode === "decision" ? L("Bank's document (required)", "Dokumen bank (wajib)") : L("Evidence (optional)", "Bukti (pilihan)")}
              <select className={selectClassSm} value={n.evidence} onChange={(e) => set("evidence", e.target.value ? Number(e.target.value) : "")}>
                <option value="">—</option>
                {pic.documents.map((d) => <option key={d.id} value={d.id}>{docWord(d.kind)} · {dmyMYT(d.uploaded_at)}</option>)}
              </select>
            </label>
          </div>
          <p className="erp-note">{mode === "banker" ? L("A banker's feedback is never an approval. It moves the banker status only.", "Maklum balas bank bukan kelulusan. Ia hanya mengubah status bank.") : L("Record only what the bank's own letter says, with the letter attached.", "Rekod hanya apa yang dinyatakan surat bank, dengan surat dilampirkan.")}</p>
          <div className={css.row}>
            <button type="button" className={btnSmPrimary} disabled={!n.bank.trim() || n.body.trim().length < 5 || (mode === "decision" && n.evidence === "")}
              onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/notes`, send({ type: mode, bank: n.bank, source: n.source, status: n.status, body: n.body, conditions: n.conditions || undefined, missing_documents: n.missing || undefined, follow_up_on: n.follow || undefined, bank_reference: n.ref || undefined, approved_cents: toCents(n.approved) ?? undefined, evidence_id: n.evidence === "" ? undefined : n.evidence }, "POST")), L("Note saved", "Nota disimpan")).then((ok) => ok && setMode(""))}>{L("Save note", "Simpan nota")}</button>
            <button type="button" className={btnSmQuiet} onClick={() => { setMode(""); setDirty(false); }}>{L("Cancel", "Batal")}</button>
          </div>
        </section>
      )}
      {GROUPS.map(([type, en, ms, cls]) => {
        const list = pic.notes.filter((x) => x.note_type === type);
        return (
          <section key={type} className={`${card} ${css.sec} ${cls}`} aria-label={L(en, ms)} data-testid={`fa-notes-${type}`}>
            <h3 className={css.h}>{L(en, ms)}</h3>
            {list.length === 0 ? <p className={css.sub}>{type === "decision" ? L("None yet - needs the bank's written decision.", "Belum ada - perlu keputusan bertulis bank.") : L("None yet.", "Belum ada.")}</p> : list.map((x) => (
              <article key={x.id} className={css.note}>
                <div className={css.noteHead}><b>{x.bank ?? (type === "system" ? L("System", "Sistem") : "")}</b>{x.status_value && type !== "system" ? <Chip map={type === "banker" ? BANKER : APPLICATION} k={x.status_value} /> : null}<span className={css.sub}>{dmyMYT(x.created_at)} · {x.author ?? L("System", "Sistem")}{x.author_role && x.author_role !== "system" ? ` (${x.author_role})` : ""}{x.source ? ` · ${x.source}` : ""}{x.corrects_id ? ` · ${L("corrects note", "membetulkan nota")} #${x.corrects_id}` : ""}</span></div>
                <p className={css.lines}>{x.body}</p>
                {x.conditions && <p className={css.sub}>{L("Conditions", "Syarat")}: {x.conditions}</p>}
                {x.missing_documents && <p className={css.sub}>{L("Missing", "Tiada")}: {x.missing_documents}</p>}
                {x.follow_up_on && <p className={css.sub}>{L("Follow up", "Susulan")}: {dmy(x.follow_up_on)}</p>}
                {x.bank_reference && <p className={css.sub}>{L("Bank reference", "Rujukan bank")}: {x.bank_reference}{x.approved_cents ? ` · ${L("amount stated", "jumlah dinyatakan")} ${fmtRM(x.approved_cents)}` : ""}</p>}
                {type === "banker" && <p className={css.sub}><em>{L("Not a bank approval.", "Bukan kelulusan bank.")}</em></p>}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Documents({ pic, reload, toast, post }: { pic: Pic; reload: () => void; toast: (t: string, m: string, tone?: "notice") => void; post: Post }) {
  const c = pic.case;
  const [kind, setKind] = useState("payslip");
  const [date, setDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    if (!file) return;
    const type = file.type === "application/pdf" ? "application/pdf" : file.type === "image/png" ? "image/png" : "image/jpeg";
    if (file.size > 8 * 1024 * 1024) { toast(L("Not uploaded", "Tidak dimuat naik"), L("The file is larger than 8 MB.", "Fail melebihi 8 MB."), "notice"); return; }
    setBusy(true);
    const r = await csrfFetch(`/api/v1/staff/fa/cases/${c.id}/documents?kind=${encodeURIComponent(kind)}${date ? `&date=${date}` : ""}`, { method: "POST", headers: { "Content-Type": type }, body: file });
    setBusy(false);
    if (!r.ok) { const j = (await r.json().catch(() => null)) as Err | null; toast(L("Not uploaded", "Tidak dimuat naik"), j?.error?.message ?? L("Try again", "Cuba lagi"), "notice"); return; }
    toast(L("Uploaded", "Dimuat naik"), L("The document is on the case.", "Dokumen ada pada kes.")); setFile(null); reload();
  };
  return (
    <div className={css.stack}>
      {pic.can.edit && (
        <section className={`${card} ${css.sec}`} aria-label={L("Upload a document", "Muat naik dokumen")}>
          <div className={css.form}>
            <label className={css.field}>{L("Document", "Dokumen")}<select className={selectClassSm} value={kind} onChange={(e) => setKind(e.target.value)}>{DOC_KINDS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></label>
            <label className={css.field}>{L("Document date", "Tarikh dokumen")}<input className={inputClassSm} type="date" value={date} max={mytToday()} onChange={(e) => setDate(e.target.value)} /></label>
            <label className={css.field}>{L("File - PDF, JPEG or PNG (camera works)", "Fail - PDF, JPEG atau PNG (kamera boleh)")}<input className={inputClassSm} type="file" accept="application/pdf,image/jpeg,image/png" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          </div>
          <button type="button" className={btnSmPrimary} disabled={!file || busy} onClick={() => void upload()}><AppIcon name="upload" />{busy ? L("Uploading…", "Memuat naik…") : L("Upload", "Muat naik")}</button>
          <p className={css.sub}>{L("Private to this case. Every view is recorded.", "Peribadi untuk kes ini. Setiap paparan direkod.")}</p>
        </section>
      )}
      <section className={`${card} ${css.sec}`} aria-label={L("Documents", "Dokumen")}>
        {pic.documents.length === 0 ? <p className={css.sub}>{L("No documents yet.", "Belum ada dokumen.")}</p> : (
          <ul className={css.items}>{pic.documents.map((d) => (
            <li key={d.id} className={css.item} data-testid="fa-doc">
              <span className={css.itemMain}><b>{docWord(d.kind)}</b><span className={css.sub}>{d.doc_date ? dmy(d.doc_date) : ""} · {L("uploaded", "dimuat naik")} {dmyMYT(d.uploaded_at)} · {d.by_name}</span></span>
              <span className={d.verified ? chipSmSuccess : chipSmNeutral}>{d.verified ? L("Checked", "Disemak") : L("Not checked", "Belum disemak")}</span>
              <span className={css.inline}>
                <button type="button" className={btnSmQuiet} onClick={() => openAttachment(`/api/v1/staff/fa/documents/${d.id}`, docWord(d.kind))}><AppIcon name="preview" />{L("View", "Lihat")}</button>
                {pic.can.edit && !d.verified && <button type="button" className={btnSmQuiet} onClick={() => void post(api<Err>(`/staff/fa/documents/${d.id}/verify`, send({}, "POST")), L("Marked checked", "Ditanda disemak"))}>{L("Mark checked", "Tanda disemak")}</button>}
              </span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}

function Consents({ pic, post, setDirty }: { pic: Pic; post: Post; setDirty: (d: boolean) => void }) {
  const c = pic.case;
  const [f, setF] = useState({ kind: "privacy_notice", notice_version: "v1-draft", captured_how: "signed_form", given_at: mytToday(), institution: "", documents: [] as string[] });
  const [withdraw, setWithdraw] = useState<number | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className={css.stack}>
      <p className="erp-note">{L("Record the privacy notice and the assessment consent before any figure. A disclosure consent names one institution and the documents it covers; sending to a bank stays switched off until counsel clears the wording.", "Rekod notis privasi dan persetujuan penilaian sebelum sebarang angka. Persetujuan pendedahan menamakan satu institusi dan dokumennya; penghantaran kepada bank kekal dimatikan sehingga peguam meluluskan.")}</p>
      <section className={`${card} ${css.sec}`} aria-label={L("Consents", "Persetujuan")}>
        {pic.consents.length === 0 ? <p className={css.sub}>{L("None recorded.", "Tiada direkod.")}</p> : (
          <ul className={css.items}>{pic.consents.map((k) => (
            <li key={k.id} className={css.item} data-testid="fa-consent">
              <span className={css.itemMain}><b>{k.kind.replace("_", " ")}</b><span className={css.sub}>{k.notice_version ?? ""}{k.institution ? ` · ${k.institution}` : ""} · {k.captured_how.replace(/_/g, " ")} · {dmy(k.given_at)}</span></span>
              <span className={k.withdrawn_at ? chipSmNeutral : chipSmSuccess}>{k.withdrawn_at ? L("Withdrawn", "Ditarik balik") : L("Live", "Aktif")}</span>
              {pic.can.edit && !k.withdrawn_at && (withdraw === k.id ? (
                <span className={css.inline}><input className={inputClassSm} value={note} placeholder={L("How the client withdrew it", "Bagaimana pelanggan menarik balik")} onChange={(e) => setNote(e.target.value)} aria-label={L("Withdrawal note", "Nota penarikan")} /><button type="button" className={btnSmDanger} disabled={note.trim().length < 5} onClick={() => void post(api<Err>(`/staff/fa/consents/${k.id}/withdraw`, send({ note }, "POST")), L("Consent withdrawn", "Persetujuan ditarik balik")).then(() => setWithdraw(null))}>{L("Withdraw", "Tarik balik")}</button></span>
              ) : <button type="button" className={btnSmQuiet} onClick={() => setWithdraw(k.id)}>{L("Withdraw", "Tarik balik")}</button>)}
            </li>
          ))}</ul>
        )}
      </section>
      {pic.can.edit && (
        <section className={`${card} ${css.sec}`} aria-label={L("Record a consent", "Rekod persetujuan")}>
          <div className={css.form}>
            <label className={css.field}>{L("Consent", "Persetujuan")}<select className={selectClassSm} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="privacy_notice">{L("Privacy notice", "Notis privasi")}</option><option value="assessment">{L("Assessment of my finances", "Penilaian kewangan saya")}</option><option value="disclosure">{L("Disclosure to one institution", "Pendedahan kepada satu institusi")}</option></select></label>
            {f.kind !== "disclosure" && <label className={css.field}>{L("Notice version", "Versi notis")}<input className={inputClassSm} value={f.notice_version} maxLength={40} onChange={(e) => { setF({ ...f, notice_version: e.target.value }); setDirty(true); }} /></label>}
            <label className={css.field}>{L("Captured by", "Diperoleh melalui")}<select className={selectClassSm} value={f.captured_how} onChange={(e) => setF({ ...f, captured_how: e.target.value })}>{["signed_form", "email", "whatsapp", "in_person_recorded"].map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}</select></label>
            <label className={css.field}>{L("Given on", "Diberi pada")}<input className={inputClassSm} type="date" value={f.given_at} max={mytToday()} onChange={(e) => setF({ ...f, given_at: e.target.value })} /></label>
            {f.kind === "disclosure" && <label className={css.field}>{L("Institution (one)", "Institusi (satu)")}<input className={inputClassSm} value={f.institution} maxLength={80} onChange={(e) => setF({ ...f, institution: e.target.value })} /></label>}
          </div>
          {f.kind === "disclosure" && <fieldset className={css.fieldset}><legend>{L("Documents it covers", "Dokumen yang diliputi")}</legend>{DOC_KINDS.filter(([k]) => !["consent", "bank_decision", "disbursement"].includes(k)).map(([k, w]) => <label key={k} className={css.check}><input type="checkbox" checked={f.documents.includes(k)} onChange={(e) => setF({ ...f, documents: e.target.checked ? [...f.documents, k] : f.documents.filter((x) => x !== k) })} /> {w}</label>)}</fieldset>}
          <button type="button" className={btnSmPrimary} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/consents`, send(f.kind === "disclosure" ? { kind: f.kind, captured_how: f.captured_how, given_at: f.given_at, institution: f.institution, documents: f.documents } : { kind: f.kind, notice_version: f.notice_version, captured_how: f.captured_how, given_at: f.given_at }, "POST")), L("Consent recorded", "Persetujuan direkod"))}>{L("Record consent", "Rekod persetujuan")}</button>
        </section>
      )}
    </div>
  );
}

function Timeline({ pic, post, setDirty }: { pic: Pic; post: Post; setDirty: (d: boolean) => void }) {
  const c = pic.case;
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const stages: Stage[] = pic.events.map((e) => ({ key: String(e.id), state: e.event === "case_closed" ? "off" : "done", title: EVENT_WORDS[e.event] ?? e.event.replace(/_/g, " "), sub: `${e.actor ?? L("System", "Sistem")} · ${dmyMYT(e.created_at)}` }));
  return (
    <div className={css.grid2}>
      <section className={`${card} ${css.sec}`} aria-label={L("Timeline", "Garis masa")}>
        <h3 className={css.h}>{L("What happened", "Apa yang berlaku")}</h3>
        <StageTimeline stages={stages} label={L("Case timeline", "Garis masa kes")} testId="fa-timeline" />
      </section>
      <section className={`${card} ${css.sec}`} aria-label={L("Tasks", "Tugasan")}>
        <h3 className={css.h}>{L("Case tasks", "Tugasan kes")}</h3>
        {pic.tasks.length === 0 ? <p className={css.sub}>{L("None yet.", "Belum ada.")}</p> : <ul className={css.list}>{pic.tasks.map((t) => <li key={t.id}><AppIcon name={t.status === "completed" ? "success" : "time"} /><span>{t.title.replace(`${c.case_ref}: `, "")} · {t.assignee}{t.deadline ? ` · ${dmy(t.deadline)}` : ""}</span></li>)}</ul>}
        {pic.can.edit && c.stage !== "closed" && (<>
          <div className={css.form}>
            <label className={css.field}>{L("Next action", "Tindakan seterusnya")}<input className={inputClassSm} value={title} maxLength={120} placeholder={L("e.g. Request EPF statement (no client figures)", "cth. Minta penyata KWSP (tanpa angka pelanggan)")} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></label>
            <label className={css.field}>{L("Due", "Tarikh akhir")}<input className={inputClassSm} type="date" value={deadline} min={mytToday()} onChange={(e) => setDeadline(e.target.value)} /></label>
          </div>
          <button type="button" className={btnSmPrimary} disabled={title.trim().length < 3} onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/tasks`, send({ title, deadline: deadline || undefined }, "POST")), L("Task added to Tasks", "Tugasan ditambah ke Tugasan")).then((ok) => ok && setTitle(""))}>{L("Add task", "Tambah tugasan")}</button>
          <p className={css.sub}>{L("Case tasks are ordinary A2Z tasks: they appear in Tasks, titled by the case reference.", "Tugasan kes ialah tugasan A2Z biasa: ia muncul dalam Tugasan, bertajuk rujukan kes.")}</p>
        </>)}
      </section>
    </div>
  );
}

function Agreement({ pic }: { pic: Pic }) {
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Client agreement", "Perjanjian pelanggan")} data-testid="fa-agreement">
      <h3 className={css.h}><AppIcon name="lock" />{L("Client agreement", "Perjanjian pelanggan")} <span className={`${chipSmNeutral} ${css.chip}`}>{L("Switched off", "Dimatikan")}</span></h3>
      <p>{L("The agreement, the proposed fee and sending documents to a bank are switched off until a Malaysian lawyer clears them (Consumer Credit Act 2025 registration, PDPA consent wording, the fee basis).", "Perjanjian, yuran yang dicadangkan dan penghantaran dokumen kepada bank dimatikan sehingga peguam Malaysia meluluskannya (pendaftaran Akta Kredit Pengguna 2025, kata-kata persetujuan PDPA, asas yuran).")}</p>
      <dl className={css.kv}>
        <div><dt>{L("Fee", "Yuran")}</dt><dd><span className={`${chipSmWarn} ${css.chip}`}>{L("15% PROPOSED — subject to legal and commercial approval", "15% DICADANGKAN — tertakluk kepada kelulusan undang-undang dan komersial")}</span></dd></div>
        <div><dt>{L("Payable now", "Perlu dibayar sekarang")}</dt><dd>{L("Nothing - no quotation or invoice is raised", "Tiada - tiada sebut harga atau invois")}</dd></div>
        <div><dt>{L("CTOS / blacklisting", "CTOS / senarai hitam")}</dt><dd>{L("Never used. Not built.", "Tidak sekali-kali digunakan. Tidak dibina.")}</dd></div>
        <div><dt>{L("Commission", "Komisen")}</dt><dd>{pic.legal.commission ? "" : L("None on advisory fees until you approve it", "Tiada atas yuran nasihat sehingga anda luluskan")}</dd></div>
      </dl>
    </section>
  );
}
