"use client";

/* v1.284.0 - FINANCIAL ADVISORY (the CEO, 11-11-2026: "proceed with
   Financial Advisory"; claude/FINANCIAL-ADVISORY-BLUEPRINT.md). One tab in
   the existing A2Z OS, never a separate loan CRM: the client is an ordinary
   A2Z customer, a case task is an ordinary task, every change is audited.

     Overview          four counts from the server, the cases that need a
                       hand, the legal switches and the disclaimer
     Clients           the pipeline: search, product and status filters,
                       one row per case; a new case finds the existing
                       customer by phone instead of creating a second one
     Bankers           v1.286.0 - the ONE bank, branch and banker registry
                       (fa-registry.tsx); nobody sends client documents from here
     Bank criteria     the ONE place a bank's rule is written: a draft until
                       management verifies it with its source and date
     Agreements        switched off until counsel clears the agreement

   Nothing here decides for a bank: the pre-screen is preliminary, a
   banker's words are feedback, and only the bank's own letter is a decision. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { useSaveToast } from "@/components/ui/save-toast";
import { SideDrawer } from "@/components/ui/side-drawer";
import { LineTabs } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { btnSm, btnSmPrimary, btnSmQuiet, card, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { APPLICATION, BANKER, Chip, FaCase, PRESCREEN, PRODUCT } from "./fa-case";
import { BankerRegistry } from "./fa-registry";
import css from "./financial-advisory.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Err = { error?: { message?: string; code?: string }; customer_id?: number; customer?: string; case_id?: number };
type View = "overview" | "clients" | "bankers" | "criteria" | "agreements";
interface Summary { open: number; awaiting_banker: number; incomplete: number; official_decisions: number; legal: Record<string, boolean>; can: { create: boolean; decide: boolean; criteria: boolean } }
interface Row { id: number; case_ref: string; product: string; stage: string; prescreen: string; banker_status: string; application_status: string; override_result: string | null; issuer_code: string; updated_at: string; client: string | null; owner: string | null; projected_dsr_bp: number | null }
interface Criterion { id: number; family: string; version: number; bank: string; product: string; income_definition: string; commitment_definition: string; dsr_guideline_bp: number | null; min_income_cents: number | null; employment_categories: string | null; min_service_months: number | null; required_documents: string | null; source: string; last_verified_on: string | null; state: string }
const STAGE_WORD: Record<string, [string, string]> = {
  intake: ["Intake", "Pengambilan"], profile: ["Profile", "Profil"], prescreen: ["Pre-screened", "Disaring"], review: ["Management review", "Semakan pengurusan"], matching: ["Bank matching", "Padanan bank"],
  agreement: ["Agreement", "Perjanjian"], enquiry: ["Bank enquiry", "Pertanyaan bank"], application: ["Application", "Permohonan"], decision: ["Decision", "Keputusan"], disbursed: ["Disbursed", "Dikeluarkan"], fee: ["Fee", "Yuran"], closed: ["Closed", "Ditutup"],
};
const list = (s: string | null) => { try { return s ? (JSON.parse(s) as string[]) : []; } catch { return []; } };

export function FinancialAdvisoryPanel() {
  const { show, node: toastNode } = useSaveToast();
  const [view, setView] = useState<View>("overview");
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    void Promise.all([api<Summary>("/staff/fa/summary"), api<{ cases: Row[] }>("/staff/fa/cases")]).then(([s, c]) => {
      if (!live) return;
      if (s.ok && s.data && c.ok && c.data) { setSum(s.data); setRows(c.data.cases); setFailed(false); }
      else setFailed(true);
    });
    return () => { live = false; };
  }, [tick]);

  return (
    <div className={css.stack} data-testid="fa-panel">
      {toastNode}
      <LineTabs value={view} onChange={setView} label={L("Financial advisory", "Nasihat kewangan")} tabs={[
        ["overview", L("Overview", "Gambaran")],
        ["clients", L("Clients", "Pelanggan"), sum?.open || null],
        ["bankers", L("Bankers", "Pegawai bank")],
        ["criteria", L("Bank criteria", "Kriteria bank"), null, L("Criteria", "Kriteria")],
        ["agreements", L("Agreements", "Perjanjian")],
      ]} />
      {!failed && !sum ? <SkelRows rows={5} /> : failed ? (
        <div className={`${card} ${css.sec}`}><p className={css.empty}>{L("Financial advisory could not load. If this is the first day of the release, the database update may not be applied yet.", "Nasihat kewangan tidak dapat dimuatkan. Jika ini hari pertama keluaran, kemas kini pangkalan data mungkin belum digunakan.")}</p><button type="button" className={btnSm} onClick={refresh}>{L("Try again", "Cuba lagi")}</button></div>
      ) : (
        <>
          {view === "overview" && <Overview sum={sum} rows={rows} openCase={setOpen} create={() => setCreating(true)} go={setView} />}
          {view === "clients" && <Clients rows={rows} can={sum?.can.create ?? false} openCase={setOpen} create={() => setCreating(true)} />}
          {view === "bankers" && <BankerRegistry toast={show} />}
          {view === "criteria" && <Criteria toast={show} />}
          {view === "agreements" && <Agreements />}
        </>
      )}
      <p className={css.disclaimer}><AppIcon name="info" /><span><b>{L("Indicative only. Subject to official bank approval.", "Indikatif sahaja. Tertakluk kepada kelulusan rasmi bank.")}</b> {L("A2Z is not affiliated with any bank. Eligibility, terms and approval are decided by the bank. Never ask a client for a password, OTP, PIN or online-banking login.", "A2Z tidak bergabung dengan mana-mana bank. Kelayakan, terma dan kelulusan ditentukan oleh bank. Jangan sekali-kali minta kata laluan, OTP, PIN atau log masuk perbankan dalam talian.")}</span></p>
      {open != null && <FaCase caseId={open} onClose={() => setOpen(null)} onChanged={refresh} toast={show} />}
      {creating && <NewCase onClose={() => setCreating(false)} toast={show} opened={(id) => { setCreating(false); refresh(); setOpen(id); }} />}
    </div>
  );
}

function Overview({ sum, rows, openCase, create, go }: { sum: Summary | null; rows: Row[] | null; openCase: (id: number) => void; create: () => void; go: (v: View) => void }) {
  const needs = (rows ?? []).filter((r) => r.stage !== "closed" && (r.prescreen === "incomplete" || r.prescreen === "manual_review" || r.stage === "review" || r.banker_status === "documents_required")).slice(0, 6);
  return (
    <div className={css.stack}>
      <KpiRow label={L("Financial advisory counts", "Kiraan nasihat kewangan")}>
        <KpiTile icon="clients" tone="navy" label={L("Open cases", "Kes terbuka")} value={sum?.open ?? 0} busy={!sum} sub={L("Not closed", "Belum ditutup")} onClick={() => go("clients")} />
        <KpiTile icon="pending" tone="gold" label={L("Information missing", "Maklumat tiada")} value={sum?.incomplete ?? 0} busy={!sum} sub={L("Pre-screen cannot run yet", "Saringan belum boleh dijalankan")} />
        <KpiTile icon="chat" tone="blue" label={L("Waiting on a banker", "Menunggu bank")} value={sum?.awaiting_banker ?? 0} busy={!sum} sub={L("Enquiry sent or under review", "Pertanyaan dihantar atau dalam semakan")} />
        <KpiTile icon="document" tone="green" label={L("Official bank decisions", "Keputusan rasmi bank")} value={sum?.official_decisions ?? 0} busy={!sum} sub={L("Recorded with the bank's letter", "Direkod dengan surat bank")} />
      </KpiRow>
      <div className={css.grid2}>
        <section className={`${card} ${css.sec}`} aria-label={L("Cases that need a hand", "Kes yang perlu dibantu")}>
          <div className={css.head}><h3 className={css.h}><AppIcon name="target" />{L("Cases that need a hand", "Kes yang perlu dibantu")}</h3>{sum?.can.create && <button type="button" className={btnSmPrimary} onClick={create}><AppIcon name="add" />{L("New case", "Kes baharu")}</button>}</div>
          {!rows ? <SkelRows rows={3} /> : needs.length === 0 ? <p className={css.sub}>{rows.length === 0 ? L("No advisory case yet. Open one from a client conversation.", "Belum ada kes nasihat. Buka satu daripada perbualan pelanggan.") : L("Nothing waiting on you.", "Tiada yang menunggu anda.")}</p> : (
            <ul className={css.rows}>{needs.map((r) => <CaseRow key={r.id} r={r} onOpen={() => openCase(r.id)} />)}</ul>
          )}
        </section>
        <section className={`${card} ${css.sec}`} aria-label={L("Switched off until counsel clears them", "Dimatikan sehingga peguam meluluskan")} data-testid="fa-legal">
          <h3 className={css.h}><AppIcon name="lock" />{L("Switched off until counsel clears them", "Dimatikan sehingga peguam meluluskan")}</h3>
          <ul className={css.list}>
            {[["Client agreement and e-signing", "Perjanjian pelanggan dan tandatangan-e"], ["The proposed 15% fee — no quotation or invoice", "Yuran 15% yang dicadangkan — tiada sebut harga atau invois"], ["Sending client documents to a bank", "Menghantar dokumen pelanggan kepada bank"], ["Commission on advisory fees", "Komisen atas yuran nasihat"]].map(([en, ms]) => (
              <li key={en}><AppIcon name="lock" /><span>{L(en!, ms!)}</span></li>
            ))}
          </ul>
          <p className={css.sub}>{L("CTOS reporting, blacklisting and penalty clauses are not built and will not be.", "Pelaporan CTOS, senarai hitam dan klausa penalti tidak dibina dan tidak akan dibina.")}</p>
        </section>
      </div>
    </div>
  );
}

function CaseRow({ r, onOpen }: { r: Row; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className={css.caseRow} onClick={onOpen} data-testid="fa-case-row">
        <span className={css.who}><b>{r.client ?? "—"}</b><span className={css.sub}>{r.case_ref} · {L(...(PRODUCT[r.product] ?? [r.product, r.product]))} · {r.owner ?? "—"}</span></span>
        <span className={css.stage}>{L(...(STAGE_WORD[r.stage] ?? [r.stage, r.stage]))}</span>
        <span className={css.chips}><Chip map={PRESCREEN} k={r.override_result ?? r.prescreen} /><Chip map={BANKER} k={r.banker_status} /><Chip map={APPLICATION} k={r.application_status} /></span>
        <span className={css.dsr}>{r.projected_dsr_bp == null ? "—" : `${(r.projected_dsr_bp / 100).toFixed(1)}%`}<small>{L("projected DSR", "DSR unjuran")}</small></span>
        <span className={css.when}>{dmyMYT(r.updated_at)}</span>
      </button>
    </li>
  );
}

function Clients({ rows, can, openCase, create }: { rows: Row[] | null; can: boolean; openCase: (id: number) => void; create: () => void }) {
  const [q, setQ] = useState("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState("open");
  const shown = useMemo(() => (rows ?? []).filter((r) => {
    if (status === "open" && r.stage === "closed") return false;
    if (status === "closed" && r.stage !== "closed") return false;
    if (status === "decision" && !["conditional_offer", "officially_approved", "declined", "disbursed"].includes(r.application_status)) return false;
    if (product && r.product !== product) return false;
    const n = q.trim().toLowerCase();
    return !n || `${r.client ?? ""} ${r.case_ref} ${r.owner ?? ""}`.toLowerCase().includes(n);
  }), [rows, q, product, status]);
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Client pipeline", "Saluran pelanggan")}>
      <div className={css.tools}>
        <input className={inputClassSm} type="search" value={q} placeholder={L("Search client, case or owner", "Cari pelanggan, kes atau pemilik")} aria-label={L("Search", "Cari")} onChange={(e) => setQ(e.target.value)} />
        <select className={selectClassSm} value={product} onChange={(e) => setProduct(e.target.value)} aria-label={L("Product", "Produk")}><option value="">{L("All products", "Semua produk")}</option>{Object.entries(PRODUCT).map(([k, w]) => <option key={k} value={k}>{L(w[0], w[1])}</option>)}</select>
        <select className={selectClassSm} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={L("Status", "Status")}>
          <option value="open">{L("Open", "Terbuka")}</option><option value="decision">{L("Official decision recorded", "Keputusan rasmi direkod")}</option><option value="closed">{L("Closed", "Ditutup")}</option><option value="all">{L("All", "Semua")}</option>
        </select>
        {can && <button type="button" className={btnSmPrimary} onClick={create}><AppIcon name="add" />{L("New case", "Kes baharu")}</button>}
      </div>
      {!rows ? <SkelRows rows={5} /> : shown.length === 0 ? <p className={css.empty}>{rows.length === 0 ? L("No advisory case yet.", "Belum ada kes nasihat.") : L("No case matches.", "Tiada kes sepadan.")}</p> : (
        <ul className={css.rows} data-testid="fa-pipeline">{shown.map((r) => <CaseRow key={r.id} r={r} onOpen={() => openCase(r.id)} />)}</ul>
      )}
    </section>
  );
}

function NewCase({ onClose, toast, opened }: { onClose: () => void; toast: (t: string, m: string, v?: "notice") => void; opened: (id: number) => void }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", product: "personal_financing", issuer: "", purpose: "" });
  const [dup, setDup] = useState<{ id: number; name: string } | null>(null);
  const [existing, setExisting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !!(f.name || f.phone || f.purpose);
  const save = async (customerId?: number) => {
    setBusy(true);
    const body = { product: f.product, issuer_code: f.issuer, purpose: f.purpose || undefined, ...(customerId ? { customer_id: customerId } : { new_customer: { name: f.name, phone: f.phone, email: f.email || undefined } }) };
    const r = await api<{ id: number; case_ref: string } & Err>("/staff/fa/cases", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    const d = r.data as Err | null;
    if (r.ok && r.data) { toast(L("Case opened", "Kes dibuka"), r.data.case_ref); opened(r.data.id); return; }
    if (d?.error?.code === "duplicate_customer" && d.customer_id) { setDup({ id: d.customer_id, name: d.customer ?? "" }); return; }
    if (d?.error?.code === "case_exists" && d.case_id) { setExisting(d.case_id); }
    toast(L("Not opened", "Tidak dibuka"), d?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };
  return (
    <SideDrawer open onClose={onClose} dirty={dirty} title={L("New advisory case", "Kes nasihat baharu")} subtitle={L("The client becomes (or stays) one A2Z customer", "Pelanggan menjadi (atau kekal) satu pelanggan A2Z")}>
      <div className={css.stack} data-testid="fa-new">
        <div className={css.form}>
          <label className={css.field}>{L("Client name", "Nama pelanggan")}<input className={inputClassSm} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className={css.field}>{L("Phone", "Telefon")}<input className={inputClassSm} inputMode="tel" value={f.phone} maxLength={20} onChange={(e) => { setF({ ...f, phone: e.target.value }); setDup(null); }} /></label>
          <label className={css.field}>{L("Email (optional)", "E-mel (pilihan)")}<input className={inputClassSm} type="email" value={f.email} maxLength={160} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className={css.field}>{L("Service", "Perkhidmatan")}<select className={selectClassSm} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}>{Object.entries(PRODUCT).map(([k, w]) => <option key={k} value={k}>{L(w[0], w[1])}</option>)}</select></label>
          <label className={css.field}>{L("Company providing the service", "Syarikat yang memberi perkhidmatan")}<select className={selectClassSm} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })}><option value="">{L("Choose for this case", "Pilih untuk kes ini")}</option><option value="a2z">A2Z CREATIVE MARKETING</option><option value="azoo">AZ ONE OFFICIAL</option></select></label>
          <label className={`${css.field} ${css.wide}`}>{L("What the client wants to achieve", "Apa yang pelanggan mahu capai")}<textarea className={textareaClass} rows={2} maxLength={300} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></label>
        </div>
        <p className={css.sub}>{L("No figures, IC or documents here: record the consents first, inside the case.", "Tiada angka, IC atau dokumen di sini: rekod persetujuan dahulu, dalam kes.")}</p>
        {dup && (
          <div className="erp-note" data-testid="fa-duplicate">
            <p><b>{dup.name}</b> {L("already has this phone number. One person stays one client.", "sudah mempunyai nombor telefon ini. Satu orang kekal satu pelanggan.")}</p>
            <button type="button" className={btnSmPrimary} disabled={busy || !f.issuer} onClick={() => void save(dup.id)}>{L("Open the case on this customer", "Buka kes pada pelanggan ini")}</button>
          </div>
        )}
        {existing != null && <button type="button" className={btnSm} onClick={() => opened(existing)}>{L("Open the existing case", "Buka kes sedia ada")}</button>}
        {!dup && <button type="button" className={btnSmPrimary} disabled={busy || f.name.trim().length < 2 || f.phone.replace(/\D/g, "").length < 9 || !f.issuer} onClick={() => void save()}>{busy ? L("Opening…", "Membuka…") : L("Open case", "Buka kes")}</button>}
      </div>
    </SideDrawer>
  );
}

const EMP = ["permanent", "contract", "government", "glc", "private", "business_owner", "commission_based"];
const REQ_DOCS: [string, string][] = [["payslip", "Payslip"], ["bank_statement", "Bank statement"], ["epf", "EPF statement"], ["facility_statement", "Facility statement"], ["ccris_by_client", "CCRIS"], ["ic", "IC copy"]];

function Criteria({ toast }: { toast: (t: string, m: string, v?: "notice") => void }) {
  const [data, setData] = useState<{ criteria: Criterion[]; can: { propose: boolean; verify: boolean } } | null>(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState<"live" | "all">("live");
  const [verifying, setVerifying] = useState<Criterion | null>(null);
  const [on, setOn] = useState(mytToday());
  useEffect(() => { let live = true; void api<typeof data>("/staff/fa/criteria").then((r) => { if (live && r.ok) setData(r.data); }); return () => { live = false; }; }, [tick]);
  const act = async (id: number, what: "verify" | "retire", body: unknown) => {
    const r = await api<Err>(`/staff/fa/criteria/${id}/${what}`, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), (r.data as Err | null)?.error?.message ?? "", "notice"); return; }
    toast(what === "verify" ? L("Criterion verified", "Kriteria disahkan") : L("Criterion retired", "Kriteria ditamatkan"), ""); setVerifying(null); setTick((t) => t + 1);
  };
  const rows = (data?.criteria ?? []).filter((c) => show === "all" || c.state !== "retired");
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Bank criteria", "Kriteria bank")} data-testid="fa-criteria">
      <div className={css.head}>
        <h3 className={css.h}><AppIcon name="balance" />{L("Bank criteria", "Kriteria bank")}</h3>
        <span className={css.inline}>
          <select className={selectClassSm} value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label={L("Show", "Tunjuk")}><option value="live">{L("Draft and verified", "Draf dan disahkan")}</option><option value="all">{L("Include retired", "Termasuk ditamatkan")}</option></select>
          {data?.can.propose && <button type="button" className={btnSmPrimary} onClick={() => setAdding(true)}><AppIcon name="add" />{L("Propose a criterion", "Cadang kriteria")}</button>}
        </span>
      </div>
      <p className={css.sub}>{L("No limit is built in: each bank's rule is written here with its source, and counts only after management verifies it. A rule older than 90 days is flagged for re-checking.", "Tiada had terbina: peraturan setiap bank ditulis di sini dengan sumbernya, dan dikira hanya selepas pengurusan mengesahkannya. Peraturan lebih 90 hari ditanda untuk disemak semula.")}</p>
      {!data ? <SkelRows rows={3} /> : rows.length === 0 ? <p className={css.empty}>{L("No bank criterion yet. Until one is verified, every pre-screen goes to manual review.", "Belum ada kriteria bank. Sehingga satu disahkan, setiap saringan ke semakan manual.")}</p> : (
        <ul className={css.items}>{rows.map((c) => (
          <li key={c.id} className={css.item} data-testid="fa-criterion">
            <span className={css.itemMain}>
              <b>{c.bank} · {L(...(PRODUCT[c.product] ?? [c.product, c.product]))} <span className={css.sub}>v{c.version}</span></b>
              <span className={css.sub}>
                {L("DSR guideline", "Garis panduan DSR")} {c.dsr_guideline_bp == null ? "—" : `${c.dsr_guideline_bp / 100}%`} {L("of", "daripada")} {c.income_definition} {L("income", "pendapatan")}
                {c.commitment_definition === "exclude_ptptn" ? ` · ${L("PTPTN excluded", "PTPTN dikecualikan")}` : ""}
                {c.min_income_cents ? ` · ${L("min income", "pendapatan min")} ${fmtRM(c.min_income_cents)}` : ""}
                {c.min_service_months != null ? ` · ${c.min_service_months} ${L("months' service", "bulan berkhidmat")}` : ""}
                {list(c.employment_categories).length ? ` · ${list(c.employment_categories).join(", ")}` : ""}
                {list(c.required_documents).length ? ` · ${L("needs", "perlu")} ${list(c.required_documents).join(", ")}` : ""}
              </span>
              <span className={css.sub}>{L("Source", "Sumber")}: {c.source}{c.last_verified_on ? ` · ${L("verified", "disahkan")} ${dmy(c.last_verified_on)}` : ""}</span>
            </span>
            <span className={c.state === "verified" ? chipSmSuccess : c.state === "draft" ? chipSmWarn : chipSmNeutral}>{c.state === "verified" ? L("Verified", "Disahkan") : c.state === "draft" ? L("Draft - not used", "Draf - tidak digunakan") : L("Retired", "Ditamatkan")}</span>
            {data.can.verify && c.state !== "retired" && (
              <span className={css.inline}>
                {c.state === "draft" && <button type="button" className={btnSm} onClick={() => { setVerifying(c); setOn(mytToday()); }}>{L("Verify", "Sahkan")}</button>}
                <button type="button" className={btnSmQuiet} onClick={() => void act(c.id, "retire", {})}>{L("Retire", "Tamatkan")}</button>
              </span>
            )}
            {verifying?.id === c.id && (
              <span className={css.inline}>
                <label className={css.field}>{L("Confirmed with the source on", "Disahkan dengan sumber pada")}<input className={inputClassSm} type="date" value={on} max={mytToday()} onChange={(e) => setOn(e.target.value)} /></label>
                <button type="button" className={btnSmPrimary} onClick={() => void act(c.id, "verify", { last_verified_on: on })}>{L("Confirm", "Sahkan")}</button>
              </span>
            )}
          </li>
        ))}</ul>
      )}
      {adding && <NewCriterion onClose={() => setAdding(false)} toast={toast} saved={() => { setAdding(false); setTick((t) => t + 1); }} />}
    </section>
  );
}

function NewCriterion({ onClose, toast, saved }: { onClose: () => void; toast: (t: string, m: string, v?: "notice") => void; saved: () => void }) {
  /* v1.286.0 - the bank comes from the one bank registry */
  const [banks, setBanks] = useState<{ id: number; name: string; status: string }[] | null>(null);
  const [offers, setOffers] = useState<{ bank_id: number; product: string; status: string }[]>([]);
  useEffect(() => { let live = true; void api<{ banks: NonNullable<typeof banks>; products: typeof offers }>("/staff/fa/registry").then((r) => { if (live && r.ok && r.data) { setBanks(r.data.banks.filter((b) => b.status !== "retired")); setOffers(r.data.products.filter((p) => p.status === "active")); } }); return () => { live = false; }; }, []);
  const [f, setF] = useState({ bank: "", product: "personal_financing", min_age: "", max_age: "", min_tenure: "", max_tenure: "", income_definition: "net", commitment_definition: "all", dsr: "", min_income: "", min_service: "", source: "", emp: [] as string[], docs: [] as string[] });
  const toggle = (k: "emp" | "docs", v: string, on: boolean) => setF({ ...f, [k]: on ? [...f[k], v] : f[k].filter((x) => x !== v) });
  const save = async () => {
    const dsr = Number(f.dsr), inc = Number(f.min_income.replace(/,/g, ""));
    const r = await api<Err>("/staff/fa/criteria", { method: "POST", body: JSON.stringify({
      bank_id: Number(f.bank), product: f.product,
      min_age: f.min_age ? Number(f.min_age) : undefined, max_age: f.max_age ? Number(f.max_age) : undefined, min_tenure_months: f.min_tenure ? Number(f.min_tenure) : undefined, max_tenure_months: f.max_tenure ? Number(f.max_tenure) : undefined, income_definition: f.income_definition, commitment_definition: f.commitment_definition, source: f.source,
      dsr_guideline_pct: f.dsr.trim() && Number.isFinite(dsr) ? dsr : undefined, min_income_cents: f.min_income.trim() && Number.isFinite(inc) ? Math.round(inc * 100) : undefined,
      min_service_months: f.min_service.trim() ? Number(f.min_service) : undefined, employment_categories: f.emp.length ? f.emp : undefined, required_documents: f.docs.length ? f.docs : undefined,
    }) });
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), (r.data as Err | null)?.error?.message ?? "", "notice"); return; }
    toast(L("Draft saved", "Draf disimpan"), L("Management verifies it before it is used.", "Pengurusan mengesahkannya sebelum digunakan.")); saved();
  };
  return (
    <SideDrawer open onClose={onClose} dirty={!!(f.bank || f.source)} title={L("Propose a bank criterion", "Cadang kriteria bank")} subtitle={L("A draft is never used for matching", "Draf tidak digunakan untuk padanan")}>
      {!banks ? <SkelRows rows={4} /> : <div className={css.stack}>
        <div className={css.form}>
          <label className={css.field}>{L("Bank (from the registry)", "Bank (daripada daftar)")}<select className={selectClassSm} value={f.bank} data-testid="fa-crit-bank" onChange={(e) => setF({ ...f, bank: e.target.value })}><option value="">—</option>{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className={css.field}>{L("Product", "Produk")}<select className={selectClassSm} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}><option value="personal_financing">{L("Personal financing", "Pembiayaan peribadi")}</option><option value="debt_consolidation">{L("Debt consolidation", "Penyatuan hutang")}</option></select></label>
          {f.bank && !offers.some((o) => String(o.bank_id) === f.bank && o.product === f.product) && <p className={`erp-note ${css.wide}`}>{L("This bank has no such product in the registry yet - management adds it in Bankers, Bank registry.", "Bank ini belum ada produk tersebut dalam daftar - pengurusan menambahnya dalam Pegawai bank, Daftar bank.")}</p>}
          <label className={css.field}>{L("Age from - to (optional)", "Umur dari - hingga (pilihan)")}<span className={css.inline}><input className={inputClassSm} inputMode="numeric" aria-label={L("Minimum age", "Umur minimum")} value={f.min_age} onChange={(e) => setF({ ...f, min_age: e.target.value.replace(/\D/g, "") })} /><input className={inputClassSm} inputMode="numeric" aria-label={L("Maximum age", "Umur maksimum")} value={f.max_age} onChange={(e) => setF({ ...f, max_age: e.target.value.replace(/\D/g, "") })} /></span></label>
          <label className={css.field}>{L("Tenure months from - to (optional)", "Tempoh bulan dari - hingga (pilihan)")}<span className={css.inline}><input className={inputClassSm} inputMode="numeric" aria-label={L("Minimum tenure", "Tempoh minimum")} value={f.min_tenure} onChange={(e) => setF({ ...f, min_tenure: e.target.value.replace(/\D/g, "") })} /><input className={inputClassSm} inputMode="numeric" aria-label={L("Maximum tenure", "Tempoh maksimum")} value={f.max_tenure} onChange={(e) => setF({ ...f, max_tenure: e.target.value.replace(/\D/g, "") })} /></span></label>
          <label className={css.field}>{L("DSR guideline (%)", "Garis panduan DSR (%)")}<input className={inputClassSm} inputMode="decimal" value={f.dsr} onChange={(e) => setF({ ...f, dsr: e.target.value })} /></label>
          <label className={css.field}>{L("Measured on", "Diukur atas")}<select className={selectClassSm} value={f.income_definition} onChange={(e) => setF({ ...f, income_definition: e.target.value })}><option value="net">{L("Net income", "Pendapatan bersih")}</option><option value="gross">{L("Gross income", "Pendapatan kasar")}</option></select></label>
          <label className={css.field}>{L("Commitments counted", "Komitmen dikira")}<select className={selectClassSm} value={f.commitment_definition} onChange={(e) => setF({ ...f, commitment_definition: e.target.value })}><option value="all">{L("All", "Semua")}</option><option value="exclude_ptptn">{L("All except PTPTN", "Semua kecuali PTPTN")}</option></select></label>
          <label className={css.field}>{L("Minimum income (RM, optional)", "Pendapatan minimum (RM, pilihan)")}<input className={inputClassSm} inputMode="decimal" value={f.min_income} onChange={(e) => setF({ ...f, min_income: e.target.value })} /></label>
          <label className={css.field}>{L("Minimum service (months, optional)", "Tempoh minimum (bulan, pilihan)")}<input className={inputClassSm} inputMode="numeric" value={f.min_service} onChange={(e) => setF({ ...f, min_service: e.target.value.replace(/\D/g, "") })} /></label>
          <label className={`${css.field} ${css.wide}`}>{L("Source (document or contact, and date)", "Sumber (dokumen atau kenalan, dan tarikh)")}<input className={inputClassSm} value={f.source} maxLength={300} onChange={(e) => setF({ ...f, source: e.target.value })} /></label>
        </div>
        <fieldset className={css.fieldset}><legend>{L("Employment accepted (none ticked = not stated)", "Pekerjaan diterima (tiada = tidak dinyatakan)")}</legend>{EMP.map((x) => <label key={x} className={css.check}><input type="checkbox" checked={f.emp.includes(x)} onChange={(e) => toggle("emp", x, e.target.checked)} /> {x.replace("_", " ")}</label>)}</fieldset>
        <fieldset className={css.fieldset}><legend>{L("Documents the bank requires", "Dokumen yang diperlukan bank")}</legend>{REQ_DOCS.map(([k, w]) => <label key={k} className={css.check}><input type="checkbox" checked={f.docs.includes(k)} onChange={(e) => toggle("docs", k, e.target.checked)} /> {w}</label>)}</fieldset>
        <button type="button" className={btnSmPrimary} disabled={!f.bank || !offers.some((o) => String(o.bank_id) === f.bank && o.product === f.product) || f.source.trim().length < 5} onClick={() => void save()}>{L("Save draft", "Simpan draf")}</button>
      </div>}
    </SideDrawer>
  );
}

function Agreements() {
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Agreements", "Perjanjian")} data-testid="fa-agreements">
      <h3 className={css.h}><AppIcon name="lock" />{L("Client agreements", "Perjanjian pelanggan")} <span className={`${chipSmNeutral} ${css.chip}`}>{L("Switched off", "Dimatikan")}</span></h3>
      <p>{L("No agreement can be generated, signed or sent yet. The agreement wording, the fee basis and the regulatory position (including registration under the Consumer Credit Act 2025) need a Malaysian lawyer's review first.", "Tiada perjanjian boleh dijana, ditandatangani atau dihantar lagi. Kata-kata perjanjian, asas yuran dan kedudukan kawal selia (termasuk pendaftaran di bawah Akta Kredit Pengguna 2025) perlu disemak peguam Malaysia dahulu.")}</p>
      <p className={css.sub}><span className={`${chipSmWarn} ${css.chip}`}>{L("15% PROPOSED — subject to legal and commercial approval", "15% DICADANGKAN — tertakluk kepada kelulusan undang-undang dan komersial")}</span></p>
    </section>
  );
}
