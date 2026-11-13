"use client";

/* v1.298.0 - FA 2.0 Phase 1 (the CEO approved the blueprint, 13-11-2026):
   two columns on a desktop as in his photo - the inputs on the left, the
   result with the case under it on the right; the directive's outcome words;
   a flat or reducing illustrative rate (D-1); the bank fit snapshot says
   Unknown when no verified rule exists; missing evidence in its own block. */
/* v1.288.0 - FINANCIAL ADVISORY: THE DSR PRE-CHECK (the CEO approved DSR
   blueprint v1.2, 12-11-2026: D1-D4 as recommended, D5 "proceed without
   lawyers"; layout from his photo).

     DsrWorkspace   the DSR Pre-Check tab. Desktop: figures | live result |
                    case and notes. Phone: five steps (income, commitments,
                    financing, result, save or submit) with the DSR strip
                    always on top. Two modes:
                      Quick Check - figures only, no name; nothing is stored
                      Client Case Assessment - the case's own figures (one
                        set, PUT /fa/cases/:id/figures), saved with /assess
                    The result is the server's ONE engine (POST /fa/preview),
                    never a copy of the formula in this file.
     CaseReview     inside a case: the assessment history, Submit for review
                    and the management decision (never a loan approval)
     BankerMatching inside a case: after a Proceed - the shortlist, the
                    proposed and approved banker, the enquiry, and documents
                    sent under the client's disclosure consent */

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiResult } from "@/lib/api";
import { dmy, dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { btnSm, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import css from "./financial-advisory.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Toast = (t: string, m: string, v?: "notice") => void;
type Err = { error?: { message?: string; code?: string }; line?: number };
const errOf = (r: { data: unknown }, fb: string) => (r.data as Err | null)?.error?.message ?? fb;
const sen = (s: string) => { const t = String(s).replace(/,/g, "").trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const rmIn = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
const pct = (bp: number | null | undefined) => (bp == null ? "—" : `${(bp / 100).toFixed(1)}%`);
const send = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

/* ---------- what the engine returns (worker/src/fa-engine.ts) ---------- */
interface Check { key: string; state: "ok" | "unverified" | "failed"; text: string }
interface Match { criterion_id: number; bank: string; version: number; checks: Check[]; missing_documents: string[]; stale: boolean; last_verified_on: string | null; fit: string }
export interface DsrResult {
  income_net_cents: number | null; gross_cents: number | null; deductions_cents: number; commitments_cents: number; instalment_cents: number | null;
  current_dsr_bp: number | null; projected_dsr_bp: number | null; remaining_cents: number | null; living_cents: number | null; residual_cents: number | null;
  outcome: string; reasons: string[]; missing: string[]; unverified_commitments: number; matches: Match[]; engine_version?: string;
  confidence?: { verified: number; declared: number };
  consolidation: null | { before: { dsr_bp: number | null }; overlap: { dsr_bp: number | null }; after: { dsr_bp: number | null; commitments_cents: number } };
  consolidation_totals?: null | { settled_monthly_cents: number; monthly_difference_cents: number | null; new_total_cents: number | null; settled_remaining_cents: number | null; total_difference_cents: number | null; risks: string[] };
}
/* the directive's own words for the five outcomes - preliminary, never a bank decision */
export const OUTCOME: Record<string, [string, string, string, string]> = {
  /* v1.298.0 - FA 2.0 (the CEO, 13-11-2026): the directive's exact words; "Proceed" is never a
     result - it exists only as a management decision (fa_reviews), never a loan approval */
  potentially_suitable: ["Potentially Suitable — Subject to Review", "Berpotensi Sesuai — Tertakluk kepada Semakan", "ok", "✓"],
  manual_review: ["Management Review Required", "Semakan Pengurusan Diperlukan", "warn", "!"],
  incomplete: ["Information Incomplete", "Maklumat Tidak Lengkap", "mute", "…"],
  affordability_concern: ["Affordability Concern", "Kebimbangan Kemampuan", "bad", "!"],
  no_product: ["No Suitable Product Currently Identified", "Tiada Produk Sesuai Dikenal Pasti", "mute", "–"],
};
const FIT: Record<string, [string, string, string]> = {
  fits: ["Within verified guideline", "Dalam garis panduan disahkan", chipSmSuccess], near: ["Near guideline", "Hampir garis panduan", chipSmWarn],
  fails: ["Above guideline", "Melebihi garis panduan", chipSmDanger], unknown: ["Guideline not verified", "Garis panduan belum disahkan", chipSmNeutral],
};
const COMMIT: [string, string, string][] = [["housing", "Housing financing", "Pembiayaan rumah"], ["car", "Vehicle financing", "Pembiayaan kenderaan"], ["personal_financing", "Personal financing", "Pembiayaan peribadi"],
  ["credit_card", "Credit card (min.)", "Kad kredit (min.)"], ["ptptn", "PTPTN", "PTPTN"], ["bnpl", "Buy now pay later", "Beli sekarang bayar kemudian"], ["non_bank", "Non-bank instalment", "Ansuran bukan bank"], ["other_bank", "Other bank facility", "Kemudahan bank lain"], ["other", "Other contractual debt", "Hutang kontrak lain"]];

/* ---------- the form ---------- */
interface Row { key: number; id: number | null; kind: string; monthly: string; lender: string; last4: string; remaining: string; settle: boolean; verified: boolean; dup: string }
interface Form {
  product: string; gross: string; epf: string; socso: string; eis: string; tax: string; other: string; addinc: string; addVerified: boolean; incomeVerified: boolean;
  rows: Row[]; amount: string; tenureYears: string; rate: string; rateType: "flat" | "reducing"; living: string;
  ids: Partial<Record<"gross" | "epf" | "socso" | "eis" | "tax" | "other" | "addinc" | "living", number>>;
  verifiedIds: number[];
}
let rowKey = 1;
const blankRow = (): Row => ({ key: rowKey++, id: null, kind: "personal_financing", monthly: "", lender: "", last4: "", remaining: "", settle: false, verified: false, dup: "" });
const blankForm = (product = "personal_financing"): Form => ({ product, gross: "", epf: "", socso: "", eis: "", tax: "", other: "", addinc: "", addVerified: false, incomeVerified: false, rows: [blankRow()], amount: "", tenureYears: "5", rate: "", rateType: "flat", living: "", ids: {}, verifiedIds: [] });

interface CaseItem { id: number; side: string; kind: string; monthly_cents: number; state: string; voided_at: string | null; label: string | null }
interface Meta { item_id: number; lender_name: string | null; account_last4: string | null; remaining_months: number | null; duplicate_reason: string | null }
export interface DsrPic {
  case: { id: number; case_ref: string; product: string; stage: string; prescreen: string; owner_id?: number; updated_at: string; created_at: string };
  customer: { name: string } | null; owner: { id: number; name: string } | null;
  items: CaseItem[]; item_meta?: Meta[]; consents: { kind: string; institution: string | null; documents: string | null; withdrawn_at: string | null }[];
  assessments: { id: number; result: string; outcome: string; created_at: string; by_name: string | null }[];
  notes: { id: number; note_type: string; bank: string | null; status_value: string | null; body: string; created_at: string; author: string | null }[];
  reviews?: { id: number; assessment_id: number | null; action: string; reason: string | null; next_action: string | null; actor: string | null; actor_role: string; created_at: string }[];
  review?: { pending: boolean; decision: string | null; assessment_id: number | null; submitted_by: number | null };
  allocations?: { id: number; bank: string; banker: string; branch: string | null; state: string; reason: string | null; created_at: string; enquiry_id: number | null; enquiry_state: string | null; sent_at: string | null }[];
  disclosures?: { id: number; enquiry_id: number; document_kind: string | null; channel: string; recipient: string; purpose: string; sent_at: string; sent_by: string | null }[];
  documents: { id: number; kind: string; uploaded_at: string }[];
  can: { edit: boolean; decide: boolean; note: boolean; allocate?: boolean };
}

function formFromCase(p: DsrPic): Form {
  const f = blankForm(p.case.product);
  const live = p.items.filter((i) => !i.voided_at && i.state !== "rejected");
  const meta = new Map((p.item_meta ?? []).map((m) => [m.item_id, m]));
  const take = (side: string, kind: string, field: keyof Form["ids"]) => {
    const it = live.find((i) => i.side === side && i.kind === kind && !Object.values(f.ids).includes(i.id));
    if (!it) return;
    (f as unknown as Record<string, string>)[field] = rmIn(it.monthly_cents);
    f.ids[field] = it.id;
    if (it.state === "verified") f.verifiedIds.push(it.id);
  };
  take("income", "gross_salary", "gross"); take("deduction", "epf", "epf"); take("deduction", "socso", "socso"); take("deduction", "eis", "eis");
  take("deduction", "tax", "tax"); take("deduction", "other_deduction", "other");
  const add = live.find((i) => i.side === "income" && ["allowance", "other_income"].includes(i.kind));
  if (add) { f.addinc = rmIn(add.monthly_cents); f.ids.addinc = add.id; f.addVerified = add.state === "verified"; if (add.state === "verified") f.verifiedIds.push(add.id); }
  const exp = live.filter((i) => i.side === "expense");
  if (exp.length === 1) { f.living = rmIn(exp[0]!.monthly_cents); f.ids.living = exp[0]!.id; }
  else if (exp.length > 1) f.living = rmIn(exp.reduce((a, i) => a + i.monthly_cents, 0));
  f.incomeVerified = f.ids.gross != null && f.verifiedIds.includes(f.ids.gross);
  const rows = live.filter((i) => i.side === "commitment").map((i): Row => {
    const m = meta.get(i.id);
    return { key: rowKey++, id: i.id, kind: i.kind, monthly: rmIn(i.monthly_cents), lender: m?.lender_name ?? "", last4: m?.account_last4 ?? "", remaining: m?.remaining_months == null ? "" : String(m.remaining_months), settle: false, verified: i.state === "verified", dup: m?.duplicate_reason ?? "" };
  });
  f.rows = rows.length ? rows : [blankRow()];
  return f; /* the proposal (amount, tenure, rate) is typed for each assessment */
}

/** the figures as the engine reads them (preview) */
function previewItems(f: Form, mode: "quick" | "case") {
  const out: Record<string, unknown>[] = [];
  const v = (field: keyof Form["ids"]) => (mode === "quick" ? false : f.ids[field] != null && f.verifiedIds.includes(f.ids[field]!));
  const push = (side: string, kind: string, val: string, verified: boolean) => { const c = sen(val); if (c != null && c > 0) out.push({ side, kind, monthly_cents: c, verified }); };
  push("income", "gross_salary", f.gross, mode === "quick" ? f.incomeVerified : v("gross"));
  push("deduction", "epf", f.epf, false); push("deduction", "socso", f.socso, false); push("deduction", "eis", f.eis, false);
  push("deduction", "tax", f.tax, false); push("deduction", "other_deduction", f.other, false);
  push("income", "other_income", f.addinc, mode === "quick" ? f.addVerified : v("addinc"));
  push("expense", "other", f.living, false);
  for (const r of f.rows) {
    const c = sen(r.monthly);
    if (c != null && c > 0) out.push({ side: "commitment", kind: r.kind, monthly_cents: c, verified: mode === "case" && r.verified, settle: mode === "quick" && f.product === "debt_consolidation" && r.settle, remaining_months: r.remaining ? Number(r.remaining) : undefined });
  }
  return out;
}
/** the figures as one set for the case (PUT /fa/cases/:id/figures); an id marks the line it came from */
function caseLines(f: Form) {
  const out: Record<string, unknown>[] = [];
  const push = (side: string, kind: string, val: string, field: keyof Form["ids"]) => {
    const c = sen(val); if (c == null || c === 0) return;
    out.push({ ...(f.ids[field] != null ? { id: f.ids[field] } : {}), side, kind, monthly_cents: c });
  };
  push("income", "gross_salary", f.gross, "gross"); push("deduction", "epf", f.epf, "epf"); push("deduction", "socso", f.socso, "socso");
  push("deduction", "eis", f.eis, "eis"); push("deduction", "tax", f.tax, "tax"); push("deduction", "other_deduction", f.other, "other");
  push("income", "other_income", f.addinc, "addinc"); push("expense", "other", f.living, "living");
  for (const r of f.rows) {
    const c = sen(r.monthly); if (c == null || c === 0) continue;
    out.push({ ...(r.id != null ? { id: r.id } : {}), side: "commitment", kind: r.kind, monthly_cents: c, lender_name: r.lender || undefined, account_last4: r.last4 || undefined,
      remaining_months: r.remaining ? Number(r.remaining) : undefined, duplicate_reason: r.dup || undefined });
  }
  return out;
}
const proposalOf = (f: Form) => {
  const years = Number(f.tenureYears) || 0;
  const rate = f.rate.trim() ? Math.round(Number(f.rate) * 100) : 0;
  return { amount_cents: sen(f.amount), tenure_months: years > 0 ? years * 12 : null, rate_bp: Number.isFinite(rate) && rate >= 0 ? rate : 0, rate_type: f.rateType };
};

/* =============================== the workspace =============================== */

/** "+ New DSR Assessment" remounts this (a new key), so it always starts empty */
export function DsrWorkspace({ toast, openCase, newCase }: { toast: Toast; openCase: (id: number, tab?: string) => void; newCase: () => void }) {
  const [mode, setMode] = useState<"case" | "quick">("case");
  const [cases, setCases] = useState<{ id: number; case_ref: string; client: string | null; product: string; stage: string }[] | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [pic, setPic] = useState<DsrPic | null>(null);
  const [f, setF] = useState<Form>(blankForm());
  const [result, setResult] = useState<DsrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [dupLine, setDupLine] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; void api<{ cases: NonNullable<typeof cases> }>("/staff/fa/cases").then((r) => { if (live && r.ok && r.data) setCases(r.data.cases.filter((c) => c.stage !== "closed")); }); return () => { live = false; }; }, [tick]);
  useEffect(() => {
    if (caseId == null) return;
    let live = true;
    void api<DsrPic>(`/staff/fa/cases/${caseId}`).then((r) => { if (live && r.ok && r.data) { setPic(r.data); setF((old) => ({ ...formFromCase(r.data!), amount: old.amount, tenureYears: old.tenureYears, rate: old.rate, rateType: old.rateType })); } });
    return () => { live = false; };
  }, [caseId, tick]);
  /* the live result: the server's engine, a moment after the last keystroke; nothing is stored */
  const seq = useRef(0);
  const body = useMemo(() => ({ product: f.product, items: previewItems(f, mode), proposal: proposalOf(f) }), [f, mode]);
  useEffect(() => {
    const my = ++seq.current;
    const t = window.setTimeout(() => {
      void api<{ result: DsrResult }>("/staff/fa/preview", send(body)).then((r) => { if (my === seq.current && r.ok && r.data) setResult(r.data.result); });
    }, 350);
    return () => window.clearTimeout(t);
  }, [body]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((o) => ({ ...o, [k]: v }));
  const setRow = (key: number, patch: Partial<Row>) => setF((o) => ({ ...o, rows: o.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const consentsOk = !!pic && ["privacy_notice", "assessment"].every((k) => pic.consents.some((c) => c.kind === k && !c.withdrawn_at));
  const latest = pic?.assessments[0] ?? null;
  const review = pic?.review;

  const calculate = async () => {
    const r = await api<{ result: DsrResult }>("/staff/fa/preview", send({ ...body, final: true }));
    if (r.ok && r.data) { setResult(r.data.result); toast(L("Calculated", "Dikira"), L("Preliminary - nothing was saved.", "Awal - tiada apa disimpan.")); }
    else toast(L("Not calculated", "Tidak dikira"), errOf(r, L("Check the figures.", "Semak angka.")), "notice");
  };
  const save = async () => {
    if (!pic) return;
    setBusy(true); setDupLine(null);
    const r1 = await api<Err>(`/staff/fa/cases/${pic.case.id}/figures`, send({ items: caseLines(f) }, "PUT"));
    if (!r1.ok) {
      setBusy(false);
      const d = r1.data as Err | null;
      if (d?.error?.code === "possible_duplicate" && typeof d.line === "number") setDupLine(d.line);
      toast(L("Not saved", "Tidak disimpan"), errOf(r1, L("Try again", "Cuba lagi")), "notice"); return;
    }
    const r2 = await api<Err>(`/staff/fa/cases/${pic.case.id}/assess`, send(proposalOf(f)));
    setBusy(false);
    if (!r2.ok) { toast(L("Figures saved, assessment not run", "Angka disimpan, penilaian belum dijalankan"), errOf(r2, ""), "notice"); setTick((t) => t + 1); return; }
    toast(L("Assessment saved", "Penilaian disimpan"), L("A new version - earlier ones stay in the history.", "Versi baharu - yang terdahulu kekal dalam sejarah.")); setTick((t) => t + 1);
  };
  const submit = async () => {
    if (!pic || !latest) return;
    const r = await api<Err>(`/staff/fa/cases/${pic.case.id}/review`, send({ assessment_id: latest.id, note: note.trim() || undefined }));
    if (!r.ok) { toast(L("Not submitted", "Tidak dihantar"), errOf(r, ""), "notice"); return; }
    toast(L("Submitted for review", "Dihantar untuk semakan"), L("The CEO, COO and CCO are told. It is not a loan application.", "CEO, COO dan CCO dimaklumkan. Ia bukan permohonan pinjaman.")); setNote(""); setTick((t) => t + 1);
  };
  const out = result ? OUTCOME[result.outcome] ?? OUTCOME.incomplete! : null;
  const totalC = f.rows.reduce((a, r) => a + (sen(r.monthly) ?? 0), 0);
  const net = (() => { const g = sen(f.gross); if (g == null) return null; return g - ["epf", "socso", "eis", "tax", "other"].reduce((a, k) => a + (sen(f[k as "epf"]) ?? 0), 0); })();
  const STEPS: [string, string][] = [["Income", "Pendapatan"], ["Commitments", "Komitmen"], ["Financing", "Pembiayaan"], ["Result", "Keputusan"], [mode === "quick" ? "Keep or clear" : "Save or submit", mode === "quick" ? "Simpan atau kosongkan" : "Simpan atau hantar"]];
  const canSubmit = mode === "case" && !!latest && latest.outcome !== "incomplete" && !review?.pending && pic?.can.edit;

  return (
    <div className={css.dsrWs} data-step={step} data-testid="fa-dsr">
      {/* phone: the steps and the DSR strip stay on top */}
      <div className={css.dsrPhoneTop}>
        <div className={css.dsrStepLine}><b>{L("Step", "Langkah")} {step} / 5 · {L(...STEPS[step - 1]!)}</b><span className={css.dsrBar}><i style={{ width: `${step * 20}%` }} /></span></div>
        <div className={css.dsrStrip} aria-live="polite"><span>{L("Current", "Semasa")} <b>{pct(result?.current_dsr_bp)}</b></span><span>{L("Projected", "Unjuran")} <b>{pct(result?.projected_dsr_bp)}</b></span></div>
      </div>

      {/* ---------------- inputs ---------------- */}
      <section className={`${card} ${css.dsrPane} ${css.dsrIn}`} aria-label={L("DSR pre-assessment", "Pra-penilaian DSR")}>
        <div className={css.head}>
          <h3 className={css.h}><AppIcon name="balance" />{L("DSR Pre-Assessment", "Pra-Penilaian DSR")}</h3>
          <span className={css.seg} role="group" aria-label={L("Mode", "Mod")}>
            <button type="button" aria-pressed={mode === "case"} className={mode === "case" ? css.segOn : ""} onClick={() => setMode("case")} data-testid="dsr-mode-case">{L("Client Case Assessment", "Penilaian Kes Pelanggan")}</button>
            <button type="button" aria-pressed={mode === "quick"} className={mode === "quick" ? css.segOn : ""} onClick={() => { setMode("quick"); setCaseId(null); setPic(null); setF(blankForm(f.product)); }} data-testid="dsr-mode-quick">{L("Quick Check", "Semakan Pantas")}</button>
          </span>
        </div>
        <div className={css.dsrBlk} data-s="1">
          {mode === "case" ? (<>
            <b>{L("1. Client & case", "1. Pelanggan & kes")}</b>
            <div className={css.form}>
              <label className={css.field}>{L("Advisory case (existing customer)", "Kes nasihat (pelanggan sedia ada)")}
                {!cases ? <SkelRows rows={1} /> : (
                  <select className={selectClassSm} value={caseId ?? ""} data-testid="dsr-case" onChange={(e) => { setPic(null); setCaseId(e.target.value ? Number(e.target.value) : null); }}>
                    <option value="">—</option>
                    {cases.map((c) => <option key={c.id} value={c.id}>{c.case_ref} · {c.client ?? ""}</option>)}
                  </select>)}
              </label>
              <label className={css.field}>{L("Case type", "Jenis kes")}<select className={selectClassSm} value={f.product} disabled={!!pic} onChange={(e) => set("product", e.target.value)}><option value="personal_financing">{L("Personal financing", "Pembiayaan peribadi")}</option><option value="debt_consolidation">{L("Debt consolidation", "Penyatuan hutang")}</option></select></label>
            </div>
            <button type="button" className={btnSmQuiet} onClick={newCase}><AppIcon name="add" />{L("New client case", "Kes pelanggan baharu")}</button>
            {pic && !consentsOk && <p className="erp-note" data-testid="dsr-consent">{L("This case has no live privacy notice and assessment consent yet - record them in the case's Consents tab before saving figures.", "Kes ini belum ada notis privasi dan persetujuan penilaian - rekodkan dalam tab Persetujuan kes sebelum menyimpan angka.")} <button type="button" className={btnSmQuiet} onClick={() => openCase(pic.case.id, "consents")}>{L("Open consents", "Buka persetujuan")}</button></p>}
          </>) : (
            <p className="erp-note" data-testid="dsr-quick-note"><b>{L("Quick Check: nothing is saved.", "Semakan Pantas: tiada apa disimpan.")}</b> {L("No name, IC or phone is asked for; the figures go to the engine and come back as a result. To keep them, choose Client Case Assessment.", "Tiada nama, IC atau telefon diminta; angka dihantar ke enjin dan kembali sebagai keputusan. Untuk menyimpan, pilih Penilaian Kes Pelanggan.")}</p>
          )}
          <b className={css.dsrRowHead}>{L("2. Income (monthly)", "2. Pendapatan (bulanan)")}
            {mode === "quick" ? <label className={css.check}><input type="checkbox" checked={f.incomeVerified} onChange={(e) => set("incomeVerified", e.target.checked)} /> {L("Seen on a payslip", "Dilihat pada slip gaji")}</label>
              : <span className={f.incomeVerified ? chipSmSuccess : chipSmWarn}>{f.incomeVerified ? L("Verified by document", "Disahkan dokumen") : L("Declared - not counted until verified", "Diisytihar - tidak dikira sehingga disahkan")}</span>}
          </b>
          <div className={css.dsrGrid3}>
            {([["gross", L("Gross income (RM)", "Pendapatan kasar (RM)")], ["epf", "EPF (RM)"], ["socso", "SOCSO (RM)"], ["eis", "EIS (RM)"], ["tax", L("Tax / PCB (RM)", "Cukai / PCB (RM)")], ["other", L("Other deductions (RM)", "Potongan lain (RM)")]] as const).map(([k, lab]) => (
              <label key={k} className={css.field}>{lab}<input className={inputClassSm} inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`dsr-${k}`} /></label>
            ))}
            <label className={css.field}>{L("Net income (RM)", "Pendapatan bersih (RM)")}<input className={`${inputClassSm} ${css.dsrCalc}`} readOnly tabIndex={-1} value={net == null ? "" : rmIn(net)} data-testid="dsr-net" /></label>
            <label className={css.field}>{L("Additional income (RM)", "Pendapatan tambahan (RM)")}<input className={inputClassSm} inputMode="decimal" value={f.addinc} onChange={(e) => set("addinc", e.target.value)} /></label>
            {mode === "quick" && <label className={css.field}>{L("Additional verified?", "Tambahan disahkan?")}<select className={selectClassSm} value={f.addVerified ? "1" : "0"} onChange={(e) => set("addVerified", e.target.value === "1")}><option value="0">{L("No - not counted", "Tidak - tidak dikira")}</option><option value="1">{L("Yes - counted", "Ya - dikira")}</option></select></label>}
          </div>
        </div>
        <div className={css.dsrBlk} data-s="2">
          <b>{L("3. Existing commitments (monthly)", "3. Komitmen sedia ada (bulanan)")}</b>
          <ul className={css.dsrRows}>
            {f.rows.map((r, i) => (
              <li key={r.key} className={`${css.dsrRow} ${dupLine === i ? css.dsrDup : ""}`} data-testid="dsr-commitment">
                <select className={selectClassSm} aria-label={L("Commitment type", "Jenis komitmen")} value={r.kind} onChange={(e) => setRow(r.key, { kind: e.target.value })}>{COMMIT.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select>
                <input className={inputClassSm} inputMode="decimal" aria-label={L("Monthly amount (RM)", "Amaun bulanan (RM)")} placeholder="RM" value={r.monthly} onChange={(e) => setRow(r.key, { monthly: e.target.value })} />
                <input className={inputClassSm} aria-label={L("Lender", "Pemberi pinjaman")} placeholder={L("Lender", "Pemberi")} value={r.lender} maxLength={80} onChange={(e) => setRow(r.key, { lender: e.target.value })} />
                <input className={inputClassSm} inputMode="numeric" aria-label={L("Account last 4 digits", "4 digit akhir akaun")} placeholder={L("Last 4", "4 akhir")} value={r.last4} maxLength={4} onChange={(e) => setRow(r.key, { last4: e.target.value.replace(/\D/g, "") })} />
                {f.product === "debt_consolidation" && <input className={inputClassSm} inputMode="numeric" aria-label={L("Months remaining", "Baki bulan")} placeholder={L("Months left", "Baki bulan")} value={r.remaining} onChange={(e) => setRow(r.key, { remaining: e.target.value.replace(/\D/g, "") })} />}
                {f.product === "debt_consolidation" && mode === "quick" && <label className={css.check}><input type="checkbox" checked={r.settle} onChange={(e) => setRow(r.key, { settle: e.target.checked })} /> {L("settle", "selesai")}</label>}
                <span className={r.verified ? chipSmSuccess : chipSmNeutral}>{r.verified ? L("verified", "disahkan") : L("declared", "diisytihar")}</span>
                <button type="button" className={btnSmQuiet} aria-label={L("Remove commitment", "Buang komitmen")} onClick={() => setF((o) => ({ ...o, rows: o.rows.filter((x) => x.key !== r.key) }))}><AppIcon name="blocked" /></button>
                {dupLine === i && <label className={`${css.field} ${css.wide}`}>{L("Why is this a second facility? (at least 10 characters)", "Mengapa ini kemudahan kedua? (sekurang-kurangnya 10 aksara)")}<input className={inputClassSm} value={r.dup} maxLength={300} onChange={(e) => setRow(r.key, { dup: e.target.value })} /></label>}
              </li>
            ))}
          </ul>
          <button type="button" className={btnSmQuiet} onClick={() => setF((o) => ({ ...o, rows: [...o.rows, blankRow()] }))} data-testid="dsr-add-commitment"><AppIcon name="add" />{L("Add commitment", "Tambah komitmen")}</button>
          <div className={css.dsrTotal}><span>{L("Total commitments", "Jumlah komitmen")}</span><b>{fmtRM(totalC)}</b></div>
          {f.product === "debt_consolidation" && mode === "case" && <p className={css.sub}>{L("A debt leaves the after-settlement DSR only when it is marked for settlement with its settlement letter, in the case's Financial profile.", "Hutang keluar daripada DSR selepas penyelesaian hanya apabila ditanda dengan surat penyelesaiannya, dalam Profil kewangan kes.")}</p>}
        </div>
        <div className={css.dsrBlk} data-s="3">
          <b>{L("4. Requested financing", "4. Pembiayaan dimohon")}</b>
          <div className={css.dsrGrid3}>
            <label className={css.field}>{L("Requested amount (RM)", "Jumlah dimohon (RM)")}<input className={inputClassSm} inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} data-testid="dsr-amount" /></label>
            <label className={css.field}>{L("Tenure (years)", "Tempoh (tahun)")}<select className={selectClassSm} value={f.tenureYears} onChange={(e) => set("tenureYears", e.target.value)}>{["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
            <label className={css.field}>{L("Illustrative rate % p.a.", "Kadar ilustrasi % setahun")}<input className={inputClassSm} inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} data-testid="dsr-rate" /></label>
            <label className={css.field}>{L("Rate type", "Jenis kadar")}<select className={selectClassSm} value={f.rateType} onChange={(e) => set("rateType", e.target.value === "reducing" ? "reducing" : "flat")} data-testid="dsr-rate-type"><option value="flat">{L("Flat rate", "Kadar rata")}</option><option value="reducing">{L("Reducing balance", "Baki berkurangan")}</option></select></label>
            <label className={css.field}>{L("Est. instalment (RM)", "Anggaran ansuran (RM)")}<input className={`${inputClassSm} ${css.dsrCalc}`} readOnly tabIndex={-1} value={rmIn(result?.instalment_cents)} data-testid="dsr-instalment" /></label>
            <label className={css.field}>{L("Living costs, declared (RM)", "Kos sara hidup, diisytihar (RM)")}<input className={inputClassSm} inputMode="decimal" value={f.living} onChange={(e) => set("living", e.target.value)} /></label>
          </div>
          <p className={css.sub}><span className={chipSmWarn}>{L("Assumption", "Andaian")}</span> {f.rateType === "flat" ? L("Flat rate: interest on the whole amount for the whole tenure.", "Kadar rata: faedah atas seluruh jumlah untuk seluruh tempoh.") : L("Reducing balance: an annuity on the balance left.", "Baki berkurangan: anuiti atas baki.")} {L("The instalment is illustrated from the rate typed - not a bank quotation. Living costs are what the client declared; none is estimated for them.", "Ansuran diilustrasi daripada kadar ditaip - bukan sebut harga bank. Kos sara hidup ialah yang diisytihar pelanggan; tiada anggaran dibuat.")}</p>
        </div>
        <div className={`${css.row} ${css.dsrDeskOnly}`}>
          <button type="button" className={btnSm} onClick={() => setF(mode === "case" && pic ? formFromCase(pic) : blankForm(f.product))}>{mode === "case" && pic ? L("Undo changes", "Batal perubahan") : L("Clear", "Kosongkan")}</button>
          {mode === "quick" ? <button type="button" className={btnSmPrimary} onClick={() => void calculate()} data-testid="dsr-calc">{L("Calculate DSR", "Kira DSR")}</button>
            : <button type="button" className={btnSmPrimary} disabled={!pic || !consentsOk || busy} onClick={() => void save()} data-testid="dsr-save">{busy ? L("Saving…", "Menyimpan…") : L("Save assessment", "Simpan penilaian")}</button>}
        </div>
      </section>

      {/* ---------------- result ---------------- */}
      <section className={`${card} ${css.dsrPane}`} data-s="4" aria-label={L("Assessment result", "Keputusan penilaian")} data-testid="dsr-result">
        <div className={css.head}><h3 className={css.h}><AppIcon name="chart" />{L("Assessment Result", "Keputusan Penilaian")}</h3><span className={chipSmNeutral}>{L("Preliminary · internal", "Awal · dalaman")}</span></div>
        {!result ? <SkelRows rows={5} /> : (<>
          <div className={`${css.dsrOut} ${css[`dsrOut_${out![2]}`] ?? ""}`} data-testid="dsr-outcome"><span aria-hidden="true">{out![3]}</span><div><b>{L(out![0], out![1])}</b><p>{result.reasons.slice(0, 2).join(". ")}{result.reasons.length ? "." : ""} {L("Not a bank decision.", "Bukan keputusan bank.")}</p></div></div>
          <dl className={css.dsrKpi}>
            <div><dt>{L("Current DSR", "DSR semasa")}</dt><dd data-testid="dsr-current">{pct(result.current_dsr_bp)}</dd><small>{result.income_net_cents ? `${rmIn(result.commitments_cents)} ÷ ${rmIn(result.income_net_cents)}` : L("verified net income needed", "pendapatan bersih disahkan diperlukan")}</small></div>
            <div><dt>{L("Projected DSR", "DSR unjuran")}</dt><dd data-testid="dsr-projected">{pct(result.projected_dsr_bp)}</dd><small>{result.income_net_cents && result.instalment_cents != null ? `(${rmIn(result.commitments_cents)} + ${rmIn(result.instalment_cents)}) ÷ ${rmIn(result.income_net_cents)}` : ""}</small></div>
            <div><dt>{L("Remaining income", "Baki pendapatan")}</dt><dd>{result.remaining_cents == null ? "—" : fmtRM(result.remaining_cents)}</dd><small>{L("after all commitments incl. proposed", "selepas semua komitmen termasuk dicadang")}</small></div>
            <div><dt>{L("Residual (after living cost)", "Baki (selepas kos sara hidup)")}</dt><dd>{result.residual_cents == null ? "—" : fmtRM(result.residual_cents)}</dd><small>{result.living_cents ? `${L("declared", "diisytihar")} ${fmtRM(result.living_cents)}` : L("no living cost declared", "tiada kos sara hidup diisytihar")}</small></div>
          </dl>
          {result.consolidation && (
            <div className={css.dsrCons} data-testid="dsr-consolidation">
              <b>{L("Debt consolidation", "Penyatuan hutang")}</b>
              <span>{L("Today", "Kini")} {pct(result.consolidation.before.dsr_bp)} · {L("Overlap (old debts still running)", "Pertindihan (hutang lama masih berjalan)")} {pct(result.consolidation.overlap.dsr_bp)} · {L("After settlement", "Selepas penyelesaian")} {pct(result.consolidation.after.dsr_bp)}</span>
              {result.consolidation_totals && <span>{L("Monthly difference", "Beza bulanan")} {result.consolidation_totals.monthly_difference_cents == null ? "—" : fmtRM(result.consolidation_totals.monthly_difference_cents)} · {L("Total repaid", "Jumlah dibayar")} {result.consolidation_totals.new_total_cents == null ? "—" : fmtRM(result.consolidation_totals.new_total_cents)} {L("vs left on the old debts", "berbanding baki hutang lama")} {result.consolidation_totals.settled_remaining_cents == null ? L("(months left not given)", "(baki bulan tiada)") : fmtRM(result.consolidation_totals.settled_remaining_cents)}</span>}
              {(result.consolidation_totals?.risks ?? []).map((x) => <span key={x} className={css.bad}>! {x}</span>)}
            </div>
          )}
          <div className={css.dsrKa}>
            <b>{L("Key assessment", "Penilaian utama")}</b>
            <ul>
              {result.matches.filter((m) => m.fit === "fits" && !m.stale).map((m) => <li key={m.criterion_id} className={css.ok}>{L(`Projected DSR within ${m.bank}'s verified guideline`, `DSR unjuran dalam garis panduan disahkan ${m.bank}`)}</li>)}
              {result.residual_cents != null && <li className={result.residual_cents >= 0 ? css.ok : css.bad}>{L(`Residual after living cost ${fmtRM(result.residual_cents)}`, `Baki selepas kos sara hidup ${fmtRM(result.residual_cents)}`)}</li>}
              {result.unverified_commitments > 0 && <li className={css.unv}>{L(`${result.unverified_commitments} commitment(s) declared, not verified`, `${result.unverified_commitments} komitmen diisytihar, belum disahkan`)}</li>}
              {result.matches.length === 0 && <li className={css.unv} data-testid="dsr-unknown">{L("No verified, current bank rule for this product - bank fit is Unknown, never assumed", "Tiada peraturan bank disahkan dan semasa untuk produk ini - kesesuaian bank Tidak Diketahui, tidak diandaikan")}</li>}
              {result.matches.some((m) => m.stale) && <li className={css.unv}>{L("A bank rule was last verified over 90 days ago - re-check it", "Peraturan bank disahkan lebih 90 hari lalu - semak semula")}</li>}
              {result.instalment_cents != null && <li className={css.unv}>{f.rateType === "flat" ? L("Instalment is an assumption from the illustrative flat rate", "Ansuran ialah andaian daripada kadar rata ilustrasi") : L("Instalment is an assumption from the illustrative reducing-balance rate", "Ansuran ialah andaian daripada kadar baki berkurangan ilustrasi")}</li>}
              {result.confidence && <li>{L(`${result.confidence.verified} of ${result.confidence.verified + result.confidence.declared} figures verified`, `${result.confidence.verified} daripada ${result.confidence.verified + result.confidence.declared} angka disahkan`)}</li>}
            </ul>
          </div>
          <div className={css.dsrKa}>
            <b>{L("Bank fit snapshot", "Gambaran kesesuaian bank")} <span className={css.sub}>{L("verified criteria only · no score", "kriteria disahkan sahaja · tiada skor")}</span></b>
            {result.matches.length === 0 ? <p className={css.sub} data-testid="dsr-fit-unknown"><span className={chipSmNeutral}>{L("Unknown", "Tidak diketahui")}</span> {L("No verified bank criterion for this product yet - management verifies criteria in Bank Criteria. Unknown is never a yes.", "Belum ada kriteria bank disahkan untuk produk ini. Tidak diketahui bukan bermaksud ya.")}</p> : (
              <div className={css.dsrTableWrap}><table className={css.dsrTable}>
                <thead><tr><th>{L("Bank", "Bank")}</th><th>{L("Rule", "Peraturan")}</th><th>{L("Status", "Status")}</th></tr></thead>
                <tbody>{result.matches.map((m) => (
                  <tr key={m.criterion_id} data-testid="dsr-bank">
                    <td><b>{m.bank}</b></td>
                    <td>{(m.checks.find((k) => k.key === "dsr")?.text ?? "").replace(/^.*vs guideline /, "≤ ")} · v{m.version}{m.last_verified_on ? ` · ${dmy(m.last_verified_on)}` : ""}</td>
                    <td><span className={(FIT[m.fit] ?? FIT.unknown!)[2]}>{L(...((FIT[m.fit] ?? FIT.unknown!).slice(0, 2) as [string, string]))}</span>{m.stale && <span className={chipSmWarn}> {L("stale", "lapuk")}</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
          <div className={css.dsrKa} data-testid="dsr-missing">
            <b>{L("Missing information & evidence", "Maklumat & bukti tiada")}</b>
            {result.missing.length === 0 && result.unverified_commitments === 0 ? <p className={css.sub}>{L("Nothing missing for this assessment.", "Tiada yang tiada untuk penilaian ini.")}</p> : (
              <ul>
                {result.missing.map((x) => <li key={x} className={css.unv}>{x}</li>)}
                {result.unverified_commitments > 0 && <li className={css.unv}>{L(`Statements for ${result.unverified_commitments} declared commitment(s)`, `Penyata untuk ${result.unverified_commitments} komitmen diisytihar`)}</li>}
              </ul>
            )}
          </div>
          <p className={css.sub}>{L("DSR = monthly debt commitments ÷ verified net monthly income × 100. Projected adds the proposed instalment.", "DSR = komitmen hutang bulanan ÷ pendapatan bersih bulanan disahkan × 100. Unjuran menambah ansuran dicadangkan.")} {result.engine_version ? `· engine ${result.engine_version}` : ""}</p>
        </>)}
      </section>

      {/* ---------------- case and actions ---------------- */}
      <section className={`${card} ${css.dsrPane}`} data-s="5" aria-label={L("Case and actions", "Kes dan tindakan")} data-testid="dsr-case-pane">
        {mode === "quick" ? (<>
          <h3 className={css.h}><AppIcon name="info" />{L("Quick Check", "Semakan Pantas")}</h3>
          <p className={css.sub}>{L("Nothing is saved when you close this screen. To keep these figures, open or create the client's case and choose Client Case Assessment - the consents come first.", "Tiada apa disimpan apabila skrin ditutup. Untuk menyimpan, buka atau cipta kes pelanggan dan pilih Penilaian Kes Pelanggan - persetujuan didahulukan.")}</p>
          <div className={css.row}><button type="button" className={btnSmPrimary} onClick={() => void calculate()}>{L("Calculate DSR", "Kira DSR")}</button><button type="button" className={btnSm} onClick={() => setMode("case")}>{L("Keep as a client case", "Simpan sebagai kes pelanggan")}</button></div>
        </>) : !pic ? (
          <p className={css.empty}>{L("Choose the client's advisory case, or create one, to save this assessment.", "Pilih kes nasihat pelanggan, atau cipta satu, untuk menyimpan penilaian ini.")}</p>
        ) : (<>
          <div className={css.head}><h3 className={css.h}><AppIcon name="document" />{L("Case details", "Butiran kes")}</h3><span className={chipSmNeutral}>{pic.case.case_ref}</span></div>
          <dl className={css.kv}>
            <div><dt>{L("Client", "Pelanggan")}</dt><dd>{pic.customer?.name ?? "—"}</dd></div>
            <div><dt>{L("Owner", "Pemilik")}</dt><dd>{pic.owner?.name ?? "—"}</dd></div>
            <div><dt>{L("Review", "Semakan")}</dt><dd>{review?.pending ? <span className={chipSmWarn}>{L("Waiting for Management", "Menunggu Pengurusan")}</span> : review?.decision ? <span className={review.decision === "proceed" ? chipSmSuccess : chipSmWarn}>{decisionWord(review.decision)}</span> : <span className={chipSmNeutral}>{L("Not submitted", "Belum dihantar")}</span>}</dd></div>
            <div><dt>{L("Last saved", "Terakhir disimpan")}</dt><dd>{latest ? `#${latest.id} · ${dmyMYT(latest.created_at)}` : "—"}</dd></div>
          </dl>
          <div className={css.dsrKa}>
            <b>{L("Kelayakan notes & timeline", "Nota kelayakan & garis masa")}</b>
            <ul className={css.dsrTl}>
              {[...(pic.reviews ?? []).map((r) => ({ at: r.created_at, k: "M", t: `${L("Management", "Pengurusan")}: ${decisionWord(r.action)}`, s: `${r.actor ?? ""}${r.reason ? ` · ${r.reason}` : ""}${r.next_action ? ` · ${r.next_action}` : ""}` })),
                ...pic.notes.filter((n) => n.note_type === "system").slice(0, 3).map((n) => ({ at: n.created_at, k: "A", t: L("System assessment", "Penilaian sistem"), s: n.body.split("\n")[1] ?? n.body })),
                ...pic.notes.filter((n) => n.note_type === "banker").slice(0, 2).map((n) => ({ at: n.created_at, k: "B", t: `${L("Banker", "Bank")}: ${n.bank ?? ""}`, s: n.body }))]
                .sort((a, z) => z.at.localeCompare(a.at)).slice(0, 5).map((x, i) => (
                  <li key={i}><span className={css.dsrTlK} aria-hidden="true">{x.k}</span><span><b>{x.t}</b><small>{dmyMYT(x.at)} · {x.s}</small></span></li>
                ))}
            </ul>
            <button type="button" className={btnSmQuiet} onClick={() => openCase(pic.case.id, "notes")}>{L("All notes", "Semua nota")}</button>
          </div>
          <label className={css.field}>{L("Note for Management (optional)", "Nota untuk Pengurusan (pilihan)")}<textarea className={textareaClass} rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className={css.row}>
            <button type="button" className={`${btnSm} ${css.dsrPhoneOnly}`} disabled={!pic || !consentsOk || busy} onClick={() => void save()}>{L("Save assessment", "Simpan penilaian")}</button>
            <button type="button" className={btnSm} disabled={!canSubmit} onClick={() => void submit()} data-testid="dsr-submit">{L("Submit for review", "Hantar untuk semakan")}</button>
            <button type="button" className={btnSmPrimary} disabled={review?.decision !== "proceed"} title={review?.decision === "proceed" ? undefined : L("Opens after Management decides Proceed", "Dibuka selepas Pengurusan memutuskan Teruskan")} onClick={() => openCase(pic.case.id, "matching")} data-testid="dsr-match">
              <AppIcon name={review?.decision === "proceed" ? "next" : "lock"} />{L("Match a banker", "Padankan pegawai bank")}
            </button>
          </div>
          <p className="erp-note">{review?.decision === "proceed" ? L("Management decided Proceed: match a banker from the verified shortlist. The client's disclosure consent comes before anything is sent.", "Pengurusan memutuskan Teruskan: padankan pegawai bank daripada senarai pendek disahkan. Persetujuan pendedahan pelanggan didahulukan.")
            : review?.pending ? L("Waiting for the CEO, COO or CCO.", "Menunggu CEO, COO atau CCO.")
              : latest ? L("Save, then submit this assessment for Management review.", "Simpan, kemudian hantar penilaian ini untuk semakan Pengurusan.") : L("Enter the figures and save the assessment.", "Masukkan angka dan simpan penilaian.")}</p>
        </>)}
      </section>

      {/* phone: one step at a time, the buttons always reachable */}
      <div className={css.dsrPhoneFoot}>
        <button type="button" className={btnSm} disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>{L("Back", "Kembali")}</button>
        {step < 5 ? <button type="button" className={btnSmPrimary} onClick={() => setStep((s) => Math.min(5, s + 1))} data-testid="dsr-next">{step === 3 ? L("See result", "Lihat keputusan") : L("Next", "Seterusnya")}</button>
          : mode === "quick" ? <button type="button" className={btnSmPrimary} onClick={() => void calculate()}>{L("Calculate DSR", "Kira DSR")}</button>
            : <button type="button" className={btnSmPrimary} disabled={!canSubmit} onClick={() => void submit()}>{L("Submit for review", "Hantar untuk semakan")}</button>}
      </div>
    </div>
  );
}

export const decisionWord = (a: string) => ({
  submitted: L("Submitted for review", "Dihantar untuk semakan"), proceed: L("Proceed - internal progression (not a loan approval)", "Teruskan - kemajuan dalaman (bukan kelulusan pinjaman)"),
  request_info: L("More information requested", "Maklumat lanjut diminta"), concern: L("Affordability concern", "Kebimbangan kemampuan"),
  unsuitable: L("Not progressed", "Tidak diteruskan"), withdrawn: L("Withdrawn", "Ditarik balik"),
} as Record<string, string>)[a] ?? a;

/* =============================== inside a case: history, submit, decide =============================== */

type Post = (call: Promise<ApiResult<Err>>, done: string) => Promise<boolean>;
export function CaseReview({ pic, post }: { pic: DsrPic; post: Post }) {
  const [hist, setHist] = useState<{ id: number; outcome: string; current_dsr_bp: number | null; projected_dsr_bp: number | null; created_at: string; by_name: string | null; engine_version: string | null; review: string | null }[] | null>(null);
  const [d, setD] = useState({ decision: "proceed", reason: "", next: "" });
  const [note, setNote] = useState("");
  const c = pic.case, review = pic.review;
  useEffect(() => { let live = true; void api<{ assessments: NonNullable<typeof hist> }>(`/staff/fa/cases/${c.id}/assessments`).then((r) => { if (live && r.ok && r.data) setHist(r.data.assessments); }); return () => { live = false; }; }, [c.id, pic.assessments.length, pic.reviews?.length]);
  const latest = pic.assessments[0];
  const min = d.decision === "concern" || d.decision === "unsuitable" ? 20 : 10;
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Management review", "Semakan pengurusan")} data-testid="fa-review">
      <h3 className={css.h}><AppIcon name="verify" />{L("Management review", "Semakan pengurusan")}
        {review?.pending ? <span className={chipSmWarn}>{L("Waiting", "Menunggu")}</span> : review?.decision ? <span className={review.decision === "proceed" ? chipSmSuccess : chipSmWarn}>{decisionWord(review.decision)}</span> : null}</h3>
      {pic.can.edit && !review?.pending && c.stage !== "closed" && latest && latest.outcome !== "incomplete" && (
        <div className={css.row}>
          <input className={inputClassSm} placeholder={L("Note for Management (optional)", "Nota untuk Pengurusan (pilihan)")} value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className={btnSm} data-testid="fa-submit-review" onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/review`, send({ assessment_id: latest.id, note: note || undefined })), L("Submitted for review", "Dihantar untuk semakan"))}>{L(`Submit assessment #${latest.id} for review`, `Hantar penilaian #${latest.id} untuk semakan`)}</button>
        </div>
      )}
      {pic.can.decide && review?.pending && (
        <div className={css.stack} data-testid="fa-decide">
          <p className={css.sub}>{L(`Assessment #${review.assessment_id} is waiting. Your decision is internal - it is never a loan approval, and you cannot decide a review you submitted.`, `Penilaian #${review.assessment_id} menunggu. Keputusan anda dalaman - bukan kelulusan pinjaman, dan anda tidak boleh memutuskan semakan yang anda hantar.`)}</p>
          <div className={css.form}>
            <label className={css.field}>{L("Decision", "Keputusan")}<select className={selectClassSm} value={d.decision} onChange={(e) => setD({ ...d, decision: e.target.value })} data-testid="fa-decision">
              <option value="proceed">{L("Proceed to banker matching", "Teruskan ke padanan pegawai bank")}</option><option value="request_info">{L("Request information", "Minta maklumat")}</option>
              <option value="concern">{L("Affordability concern", "Kebimbangan kemampuan")}</option><option value="unsuitable">{L("Not suitable for further borrowing assessment", "Tidak sesuai untuk penilaian pinjaman lanjut")}</option></select></label>
            {d.decision === "request_info" && <label className={css.field}>{L("What is needed", "Apa yang diperlukan")}<input className={inputClassSm} value={d.next} maxLength={300} onChange={(e) => setD({ ...d, next: e.target.value })} /></label>}
            <label className={`${css.field} ${css.wide}`}>{L(`Reason (at least ${min} characters)`, `Sebab (sekurang-kurangnya ${min} aksara)`)}<textarea className={textareaClass} rows={2} maxLength={1000} value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} data-testid="fa-decision-reason" /></label>
          </div>
          <button type="button" className={btnSmPrimary} disabled={d.reason.trim().length < min || (d.decision === "request_info" && !d.next.trim())} data-testid="fa-decide-save"
            onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/review`, send({ decision: d.decision, reason: d.reason, next_action: d.next || undefined }, "PUT")), L("Decision recorded", "Keputusan direkod"))}>{L("Record decision", "Rekod keputusan")}</button>
        </div>
      )}
      <h4 className={css.h}>{L("Assessment history", "Sejarah penilaian")}</h4>
      {!hist ? <SkelRows rows={3} /> : hist.length === 0 ? <p className={css.sub}>{L("No saved assessment yet.", "Belum ada penilaian disimpan.")}</p> : (
        <div className={css.dsrTableWrap}><table className={css.dsrTable} data-testid="fa-history">
          <thead><tr><th>#</th><th>{L("When", "Bila")}</th><th>{L("Current", "Semasa")}</th><th>{L("Projected", "Unjuran")}</th><th>{L("Outcome", "Hasil")}</th><th>{L("Review", "Semakan")}</th></tr></thead>
          <tbody>{hist.map((h) => (
            <tr key={h.id}><td>{h.id}</td><td>{dmyMYT(h.created_at)}<br /><small className={css.sub}>{h.by_name}{h.engine_version ? ` · ${h.engine_version}` : ""}</small></td><td>{pct(h.current_dsr_bp)}</td><td>{pct(h.projected_dsr_bp)}</td>
              <td>{L(...((OUTCOME[h.outcome] ?? OUTCOME.incomplete!).slice(0, 2) as [string, string]))}</td><td>{h.review ? decisionWord(h.review) : "—"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

/* =============================== inside a case: banker matching =============================== */

interface Short { banker_id: number; banker: string; bank: string; branch: string | null; tier: string; reasons: string[] }
export function BankerMatching({ pic, post, toast }: { pic: DsrPic; post: Post; toast: Toast }) {
  const c = pic.case;
  const [states, setStates] = useState<string[] | null>(null);
  const [where, setWhere] = useState({ state: "", district: "" });
  const [m, setM] = useState<{ match_id: number; shortlist: Short[]; excluded: { banker: string; bank: string; why: string }[] } | null>(null);
  const [why, setWhy] = useState<Record<number, string>>({});
  const [enq, setEnq] = useState({ channel: "work_email", summary: "" });
  const [dis, setDis] = useState<{ docs: number[]; channel: string; purpose: string }>({ docs: [], channel: "work_email", purpose: "" });
  useEffect(() => { let live = true; void api<{ states: string[] }>("/staff/fa/registry").then((r) => { if (live && r.ok && r.data) setStates(r.data.states); }); return () => { live = false; }; }, []);
  if (pic.review?.decision !== "proceed") {
    return (
      <section className={`${card} ${css.sec}`} data-testid="fa-matching">
        <h3 className={css.h}><AppIcon name="lock" />{L("Banker matching", "Padanan pegawai bank")}</h3>
        <p className={css.sub}>{L("Opens after Management decides Proceed on a submitted DSR assessment (DSR assessment tab).", "Dibuka selepas Pengurusan memutuskan Teruskan pada penilaian DSR yang dihantar (tab Penilaian DSR).")}</p>
      </section>
    );
  }
  const run = async () => {
    const r = await api<NonNullable<typeof m>>(`/staff/fa/cases/${c.id}/match`, send({ state: where.state, district: where.district || undefined }));
    if (!r.ok || !r.data) { toast(L("Not matched", "Tidak dipadan"), errOf(r, ""), "notice"); return; }
    setM(r.data);
  };
  const active = (pic.allocations ?? []).filter((a) => ["pending_review", "assigned", "awaiting_consent", "ready"].includes(a.state));
  const STATE: Record<string, [string, string, string]> = {
    pending_review: ["Proposed - waiting for CEO/COO", "Dicadang - menunggu CEO/COO", chipSmWarn], assigned: ["Approved", "Diluluskan", chipSmInfo],
    awaiting_consent: ["Approved - waiting for the client's disclosure consent", "Diluluskan - menunggu persetujuan pendedahan", chipSmWarn], ready: ["Ready - contact the banker", "Sedia - hubungi pegawai bank", chipSmSuccess],
    cancelled: ["Cancelled", "Dibatalkan", chipSmNeutral], reassigned: ["Reassigned", "Diagih semula", chipSmNeutral],
  };
  return (
    <div className={css.stack} data-testid="fa-matching">
      <section className={`${card} ${css.sec}`}>
        <h3 className={css.h}><AppIcon name="users" />{L("Banker matching", "Padanan pegawai bank")} <span className={css.sub}>{L("verified criteria, then the banker directory · no score", "kriteria disahkan, kemudian direktori · tiada skor")}</span></h3>
        <div className={css.form}>
          <label className={css.field}>{L("Client's state", "Negeri pelanggan")}{!states ? <SkelRows rows={1} /> : <select className={selectClassSm} value={where.state} onChange={(e) => setWhere({ ...where, state: e.target.value })} data-testid="fa-match-state"><option value="">—</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select>}</label>
          <label className={css.field}>{L("District (optional)", "Daerah (pilihan)")}<input className={inputClassSm} value={where.district} maxLength={60} onChange={(e) => setWhere({ ...where, district: e.target.value })} /></label>
        </div>
        <button type="button" className={btnSmPrimary} disabled={!where.state || !pic.can.edit} onClick={() => void run()} data-testid="fa-match-run">{L("Find bankers", "Cari pegawai bank")}</button>
        {m && (m.shortlist.length === 0 ? <p className={css.empty}>{L("No verified banker fits yet. See why below.", "Tiada pegawai bank disahkan sesuai lagi. Lihat sebab di bawah.")}</p> : (
          <ul className={css.items}>{m.shortlist.map((s) => (
            <li key={s.banker_id} className={css.item} data-testid="fa-shortlist">
              <span className={css.itemMain}><b>{s.banker} · {s.bank}</b><span className={css.sub}>{s.reasons.join(" · ")}</span></span>
              <span className={s.tier === "ready" ? chipSmSuccess : chipSmWarn}>{s.tier === "ready" ? L("Ready", "Sedia") : L("Check first", "Semak dahulu")}</span>
              {active.length === 0 && pic.can.edit && (<span className={css.inline}>
                {s.tier === "check" && <input className={inputClassSm} placeholder={L("Why this banker (10+ characters)", "Mengapa pegawai ini (10+ aksara)")} value={why[s.banker_id] ?? ""} onChange={(e) => setWhy({ ...why, [s.banker_id]: e.target.value })} />}
                <button type="button" className={btnSm} data-testid="fa-propose" onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/allocations`, send({ match_id: m.match_id, banker_id: s.banker_id, reason: why[s.banker_id] || undefined })), L("Banker proposed - waiting for approval", "Pegawai dicadang - menunggu kelulusan"))}>{L("Propose", "Cadang")}</button>
              </span>)}
            </li>
          ))}</ul>
        ))}
        {m && m.excluded.length > 0 && <details className={css.sub}><summary>{L("Not shortlisted", "Tidak tersenarai")} ({m.excluded.length})</summary><ul className={css.list}>{m.excluded.map((x, i) => <li key={i}>{x.banker} · {x.bank} — {x.why}</li>)}</ul></details>}
      </section>
      <section className={`${card} ${css.sec}`}>
        <h3 className={css.h}><AppIcon name="person" />{L("Allocated banker", "Pegawai bank diperuntukkan")}</h3>
        {(pic.allocations ?? []).length === 0 ? <p className={css.sub}>{L("None yet.", "Belum ada.")}</p> : (
          <ul className={css.items}>{(pic.allocations ?? []).map((a) => (
            <li key={a.id} className={css.item} data-testid="fa-allocation">
              <span className={css.itemMain}><b>{a.banker} · {a.bank}{a.branch ? ` · ${a.branch}` : ""}</b><span className={css.sub}>{dmyMYT(a.created_at)}{a.reason ? ` · ${a.reason}` : ""}{a.sent_at ? ` · ${L("enquiry", "pertanyaan")} ${dmyMYT(a.sent_at)}` : ""}</span></span>
              <span className={(STATE[a.state] ?? STATE.cancelled!)[2]}>{L(...((STATE[a.state] ?? STATE.cancelled!).slice(0, 2) as [string, string]))}</span>
              {a.state === "pending_review" && pic.can.allocate && <button type="button" className={btnSm} data-testid="fa-approve-allocation" onClick={() => void post(api<Err>(`/staff/fa/allocations/${a.id}`, send({ action: "approve" })), L("Allocation approved", "Peruntukan diluluskan"))}>{L("Approve", "Lulus")}</button>}
              {["pending_review", "assigned", "awaiting_consent", "ready"].includes(a.state) && !a.enquiry_id && <button type="button" className={btnSmQuiet} onClick={() => void post(api<Err>(`/staff/fa/allocations/${a.id}`, send({ action: "cancel", reason: "Cancelled from the case" })), L("Allocation cancelled", "Peruntukan dibatalkan"))}>{L("Cancel", "Batal")}</button>}
            </li>
          ))}</ul>
        )}
        {active.filter((a) => ["assigned", "awaiting_consent", "ready"].includes(a.state) && !a.enquiry_id).map((a) => (
          <div key={a.id} className={css.stack} data-testid="fa-enquiry-form">
            <p className={css.sub}>{L(`Needs the client's disclosure consent naming ${a.bank} (Consents tab). Then record what you sent or asked.`, `Perlu persetujuan pendedahan pelanggan yang menamakan ${a.bank} (tab Persetujuan). Kemudian rekod apa yang dihantar atau ditanya.`)}</p>
            <div className={css.form}>
              <label className={css.field}>{L("Channel", "Saluran")}<select className={selectClassSm} value={enq.channel} onChange={(e) => setEnq({ ...enq, channel: e.target.value })}><option value="work_email">{L("Work email", "E-mel kerja")}</option><option value="work_phone">{L("Work phone", "Telefon kerja")}</option><option value="whatsapp_work">WhatsApp</option><option value="in_person">{L("In person", "Bersemuka")}</option></select></label>
              <label className={`${css.field} ${css.wide}`}>{L("What was sent or asked", "Apa yang dihantar atau ditanya")}<input className={inputClassSm} value={enq.summary} maxLength={600} onChange={(e) => setEnq({ ...enq, summary: e.target.value })} data-testid="fa-enquiry-summary" /></label>
            </div>
            <button type="button" className={btnSmPrimary} disabled={enq.summary.trim().length < 5} data-testid="fa-enquiry-send" onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/enquiries`, send({ allocation_id: a.id, channel: enq.channel, summary: enq.summary })), L("Enquiry recorded", "Pertanyaan direkod"))}>{L("Record enquiry", "Rekod pertanyaan")}</button>
          </div>
        ))}
      </section>
      {active.some((a) => a.enquiry_id) && (
        <section className={`${card} ${css.sec}`} data-testid="fa-disclose">
          <h3 className={css.h}><AppIcon name="upload" />{L("Send documents to the banker", "Hantar dokumen kepada pegawai bank")}</h3>
          <p className={css.sub}>{L("Only documents the client's disclosure consent covers, to the banker's verified work contact. Send them yourself on that channel; this records what went, to whom, under which consent.", "Hanya dokumen yang diliputi persetujuan pendedahan pelanggan, ke hubungan kerja pegawai yang disahkan. Hantar sendiri melalui saluran itu; ini merekod apa yang dihantar, kepada siapa, di bawah persetujuan mana.")}</p>
          <fieldset className={css.fieldset}><legend>{L("Documents", "Dokumen")}</legend>{pic.documents.map((d) => (
            <label key={d.id} className={css.check}><input type="checkbox" checked={dis.docs.includes(d.id)} onChange={(e) => setDis({ ...dis, docs: e.target.checked ? [...dis.docs, d.id] : dis.docs.filter((x) => x !== d.id) })} /> {d.kind.replace(/_/g, " ")} · {dmyMYT(d.uploaded_at)}</label>
          ))}</fieldset>
          <div className={css.form}>
            <label className={css.field}>{L("Channel", "Saluran")}<select className={selectClassSm} value={dis.channel} onChange={(e) => setDis({ ...dis, channel: e.target.value })}><option value="work_email">{L("Work email", "E-mel kerja")}</option><option value="whatsapp_work">WhatsApp ({L("work number", "nombor kerja")})</option><option value="in_person">{L("In person", "Bersemuka")}</option></select></label>
            <label className={css.field}>{L("Purpose", "Tujuan")}<input className={inputClassSm} value={dis.purpose} maxLength={200} onChange={(e) => setDis({ ...dis, purpose: e.target.value })} /></label>
          </div>
          <button type="button" className={btnSmPrimary} disabled={!dis.docs.length || dis.purpose.trim().length < 5} data-testid="fa-disclose-send"
            onClick={() => void post(api<Err>(`/staff/fa/cases/${c.id}/disclosures`, send({ enquiry_id: active.find((a) => a.enquiry_id)!.enquiry_id, document_ids: dis.docs, channel: dis.channel, purpose: dis.purpose })), L("Disclosure recorded", "Pendedahan direkod")).then((ok) => { if (ok) setDis({ docs: [], channel: dis.channel, purpose: "" }); })}>{L("Record what was sent", "Rekod apa yang dihantar")}</button>
          {(pic.disclosures ?? []).length > 0 && <ul className={css.items}>{(pic.disclosures ?? []).map((x) => <li key={x.id} className={css.item}><span className={css.itemMain}><b>{(x.document_kind ?? "").replace(/_/g, " ")} → {x.recipient}</b><span className={css.sub}>{dmyMYT(x.sent_at)} · {x.sent_by} · {x.purpose}</span></span></li>)}</ul>}
        </section>
      )}
    </div>
  );
}
