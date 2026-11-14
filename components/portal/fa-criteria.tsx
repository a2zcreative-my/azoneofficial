"use client";

/* v1.301.0 - FINANCIAL ADVISORY 2.0, PHASE 4: BANK CRITERIA 2.0 (the CEO,
   13-11-2026: "Go ahead"; claude/FINANCIAL-ADVISORY-2.0-BLUEPRINT.md section
   9, the CEO's photo 4; migration 0191). One searchable repository:

     category     Official bank criteria (the lender's own document) or
                  Banker-provided indicative (a verified banker's words, with
                  the banker, the day, the channel and the words). The A2Z
                  internal baseline and case-specific feedback are explained,
                  not stored here (the DSR engine and the case's notes)
     confidence   high / medium / low, on every entry
     dates        effective, last reviewed, review due, expiry
     state        Draft, Indicative, Verified, Review required, Expired,
                  Archived - worked out by the server, never typed here
     versions     the newest of each family first; earlier versions kept

   Only an OFFICIAL, verified, in-date rule is ever matched (worker/src/
   fa-engine.ts); a banker's words never are, and management cannot publish
   them as the bank's rule - an official entry with its source is written
   instead. Sales propose and ask for verification; the CEO or COO verify,
   never their own proposal (the owner account apart). The server decides. */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { SideDrawer } from "@/components/ui/side-drawer";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { btnSm, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { PRODUCT } from "./fa-case";
import css from "./financial-advisory.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Toast = (t: string, m: string, v?: "notice") => void;
type Err = { error?: { message?: string; code?: string }; notified?: number };
export interface Criterion {
  id: number; family: string; version: number; bank: string; product: string; income_definition: string; commitment_definition: string; dsr_guideline_bp: number | null; min_income_cents: number | null;
  employment_categories: string | null; min_service_months: number | null; required_documents: string | null; source: string; last_verified_on: string | null; state: string; effective_from?: string | null;
  min_age?: number | null; max_age?: number | null; min_tenure_months?: number | null; max_tenure_months?: number | null;
  category?: string; confidence?: string | null; review_due_on?: string | null; expires_on?: string | null; source_banker?: string | null; heard_on?: string | null; channel?: string | null; exact_feedback?: string | null;
  verified_by_name?: string | null; created_by_name?: string | null; created_by?: number; shows?: string;
}
const list = (s: string | null) => { try { return s ? (JSON.parse(s) as string[]) : []; } catch { return []; } };
export const SHOWS: Record<string, [string, string, string]> = {
  draft: ["Draft", "Draf", chipSmNeutral], indicative: ["Indicative - unverified", "Indikatif - belum disahkan", chipSmInfo], verified: ["Verified", "Disahkan", chipSmSuccess],
  review_required: ["Review required", "Perlu semakan", chipSmWarn], expired: ["Expired", "Tamat tempoh", chipSmDanger], archived: ["Archived", "Diarkib", chipSmNeutral],
};
const CONF: Record<string, [string, string, string]> = { high: ["High", "Tinggi", chipSmSuccess], medium: ["Medium", "Sederhana", chipSmWarn], low: ["Low", "Rendah", chipSmNeutral] };
const CHANNEL: Record<string, [string, string]> = { work_email: ["Work email", "E-mel kerja"], work_phone: ["Work phone", "Telefon kerja"], whatsapp_work: ["WhatsApp", "WhatsApp"], in_person: ["In person", "Bersemuka"] };
const chip = (map: Record<string, [string, string, string]>, k: string | null | undefined) => { const w = (k && map[k]) || null; return w ? <span className={`${w[2]} ${css.chip}`}>{L(w[0], w[1])}</span> : <span className={css.sub}>—</span>; };
/* when a rule says nothing about its state the server has not told us yet (before 0191): its stored state */
const showsOf = (c: Criterion) => c.shows ?? (c.state === "retired" ? "archived" : c.state === "draft" ? "draft" : "verified");
const summary = (c: Criterion) => [
  c.min_income_cents ? `${L("min income", "pendapatan min")} ${fmtRM(c.min_income_cents)}` : "",
  c.min_age != null || c.max_age != null ? `${L("age", "umur")} ${c.min_age ?? "-"}-${c.max_age ?? "-"}` : "",
  c.max_tenure_months != null ? `${L("up to", "hingga")} ${c.max_tenure_months} ${L("months", "bulan")}` : "",
  c.min_service_months != null ? `${c.min_service_months} ${L("months' service", "bulan berkhidmat")}` : "",
  list(c.employment_categories).join(", "),
  c.commitment_definition === "exclude_ptptn" ? L("PTPTN excluded", "PTPTN dikecualikan") : "",
].filter(Boolean).join(" · ") || L("No condition stated", "Tiada syarat dinyatakan");

type Filter = "live" | "verified" | "draft" | "indicative" | "review" | "archived" | "all";
export function Criteria({ toast }: { toast: Toast }) {
  const [data, setData] = useState<{ criteria: Criterion[]; can: { propose: boolean; verify: boolean }; me?: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState<"official" | "banker_indicative" | null>(null);
  const [filter, setFilter] = useState<Filter>("live");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [verifying, setVerifying] = useState<number | null>(null);
  const [on, setOn] = useState(mytToday());
  const [due, setDue] = useState("");
  const [earlier, setEarlier] = useState<string | null>(null);
  useEffect(() => { let live = true; void api<NonNullable<typeof data>>("/staff/fa/criteria").then((r) => { if (live && r.ok && r.data) setData(r.data); }); return () => { live = false; }; }, [tick]);
  const act = async (id: number, what: "verify" | "retire" | "request-verification", body: unknown) => {
    const r = await api<Err>(`/staff/fa/criteria/${id}/${what}`, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), (r.data as Err | null)?.error?.message ?? "", "notice"); return; }
    toast(what === "verify" ? L("Criterion verified", "Kriteria disahkan") : what === "retire" ? L("Criterion archived", "Kriteria diarkib") : L("Management asked to verify", "Pengurusan diminta mengesahkan"), what === "request-verification" ? L(`${(r.data as Err | null)?.notified ?? 0} told`, `${(r.data as Err | null)?.notified ?? 0} dimaklumkan`) : "");
    setVerifying(null); setTick((t) => t + 1);
  };
  const all = useMemo(() => data?.criteria ?? [], [data]);
  /* the newest version of each family leads; earlier versions open under it */
  const fams = useMemo(() => {
    const by = new Map<string, Criterion[]>();
    for (const c of all) by.set(c.family, [...(by.get(c.family) ?? []), c]);
    return [...by.values()].map((v) => v.sort((a, z) => z.version - a.version));
  }, [all]);
  const want = (c: Criterion) => {
    const s = showsOf(c);
    if (filter === "live" && s === "archived") return false;
    if (filter === "verified" && s !== "verified") return false;
    if (filter === "draft" && s !== "draft") return false;
    if (filter === "indicative" && s !== "indicative") return false;
    if (filter === "review" && s !== "review_required" && s !== "expired") return false;
    if (filter === "archived" && s !== "archived") return false;
    if (cat && (c.category ?? "official") !== cat) return false;
    const n = q.trim().toLowerCase();
    return !n || `${c.bank} ${c.product} ${c.source} ${c.source_banker ?? ""}`.toLowerCase().includes(n);
  };
  const lead = fams.map((v) => v.find(want)).filter((x): x is Criterion => !!x);
  const count = (s: string[]) => all.filter((c) => s.includes(showsOf(c))).length;
  const banks = new Set(all.filter((c) => showsOf(c) === "verified").map((c) => c.bank)).size;
  return (
    <div className={css.stack}>
      <KpiRow label={L("Bank criteria counts", "Kiraan kriteria bank")}>
        <KpiTile icon="verify" tone="green" label={L("Verified rules", "Peraturan disahkan")} value={count(["verified"])} busy={!data} sub={L("Official, in date - used by the DSR engine", "Rasmi, dalam tempoh - digunakan enjin DSR")} onClick={() => setFilter("verified")} />
        <KpiTile icon="document" tone="gold" label={L("Draft rules", "Peraturan draf")} value={count(["draft", "indicative"])} busy={!data} sub={L("Drafts and banker-indicative - never matched", "Draf dan indikatif - tidak dipadankan")} onClick={() => setFilter("draft")} />
        <KpiTile icon="warning" tone="red" label={L("Need re-check", "Perlu semak semula")} value={count(["review_required", "expired"])} busy={!data} sub={L("Review due, over 90 days, or expired", "Semakan tiba, lebih 90 hari, atau tamat")} onClick={() => setFilter("review")} />
        <KpiTile icon="balance" tone="blue" label={L("Banks covered", "Bank diliputi")} value={banks} busy={!data} sub={L("With a verified rule", "Dengan peraturan disahkan")} />
      </KpiRow>
      <section className={`${card} ${css.sec}`} aria-label={L("Bank criteria repository", "Repositori kriteria bank")} data-testid="fa-criteria">
        <div className={css.head}>
          <h3 className={css.h}><AppIcon name="balance" />{L("Bank criteria repository", "Repositori kriteria bank")}</h3>
          {data?.can.propose && (
            <span className={css.inline}>
              <button type="button" className={btnSm} onClick={() => setAdding("banker_indicative")} data-testid="fa-crit-banker-update"><AppIcon name="chat" />{L("Record banker update", "Rekod maklumat pegawai bank")}</button>
              <button type="button" className={btnSmPrimary} onClick={() => setAdding("official")} data-testid="fa-crit-add"><AppIcon name="add" />{L("Add criteria", "Tambah kriteria")}</button>
            </span>
          )}
        </div>
        <p className={css.sub}>{L("Each rule carries its category, source, confidence and dates. Only an official, verified, in-date rule is used to match; drafts, a banker's indicative words, rules due for review or expired are never a bank's requirement.", "Setiap peraturan ada kategori, sumber, keyakinan dan tarikh. Hanya peraturan rasmi, disahkan dan dalam tempoh digunakan untuk padanan; draf, kata-kata indikatif pegawai bank, peraturan perlu semakan atau tamat tidak sekali-kali menjadi syarat bank.")}</p>
        <div className={css.tools}>
          <input className={inputClassSm} type="search" value={q} placeholder={L("Search bank, product, source or banker", "Cari bank, produk, sumber atau pegawai")} aria-label={L("Search", "Cari")} onChange={(e) => setQ(e.target.value)} />
          <select className={selectClassSm} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label={L("State", "Keadaan")} data-testid="fa-crit-filter">
            <option value="live">{L("All but archived", "Semua kecuali diarkib")}</option><option value="verified">{L("Verified", "Disahkan")}</option><option value="draft">{L("Draft", "Draf")}</option>
            <option value="indicative">{L("Indicative", "Indikatif")}</option><option value="review">{L("Review required or expired", "Perlu semakan atau tamat")}</option><option value="archived">{L("Archived", "Diarkib")}</option><option value="all">{L("Everything", "Semua")}</option>
          </select>
          <select className={selectClassSm} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={L("Category", "Kategori")}>
            <option value="">{L("All categories", "Semua kategori")}</option><option value="official">{L("Official bank criteria", "Kriteria rasmi bank")}</option><option value="banker_indicative">{L("Banker-provided indicative", "Indikatif daripada pegawai bank")}</option>
          </select>
        </div>
        {!data ? <SkelRows rows={4} /> : lead.length === 0 ? <p className={css.empty}>{all.length === 0 ? L("No bank criterion yet. Until one is verified, every pre-screen goes to manual review.", "Belum ada kriteria bank. Sehingga satu disahkan, setiap saringan ke semakan manual.") : L("No rule matches these filters.", "Tiada peraturan sepadan dengan penapis ini.")}</p> : (
          <ul className={css.critRows}>{lead.map((c) => {
            const fam = fams.find((v) => v[0]?.family === c.family) ?? [c];
            const older = fam.filter((x) => x.id !== c.id);
            return (
              <li key={c.family} className={css.critLi}>
                <CritRow c={c} can={data.can} me={data.me} verifying={verifying === c.id} setVerifying={(x) => { setVerifying(x ? c.id : null); setOn(mytToday()); setDue(""); }} on={on} setOn={setOn} due={due} setDue={setDue} act={act} />
                {older.length > 0 && (
                  <button type="button" className={css.linkBtn} onClick={() => setEarlier(earlier === c.family ? null : c.family)} aria-expanded={earlier === c.family} data-testid="fa-crit-versions">
                    {earlier === c.family ? L("Hide earlier versions", "Sorok versi terdahulu") : L(`${older.length} earlier version(s)`, `${older.length} versi terdahulu`)}
                  </button>
                )}
                {earlier === c.family && <ul className={css.critOlder}>{older.map((x) => <li key={x.id}><CritRow c={x} can={{ propose: false, verify: false }} me={data.me} verifying={false} setVerifying={() => {}} on={on} setOn={setOn} due={due} setDue={setDue} act={act} /></li>)}</ul>}
              </li>
            );
          })}</ul>
        )}
      </section>
      <div className={css.grid2}>
        <section className={`${card} ${css.sec}`} aria-label={L("The four kinds of criteria", "Empat jenis kriteria")} data-testid="fa-crit-kinds">
          <h3 className={css.h}><AppIcon name="info" />{L("The four kinds of criteria", "Empat jenis kriteria")}</h3>
          <ul className={css.list}>
            <li><AppIcon name="chart" /><span><b>{L("1 A2Z internal baseline", "1 Asas dalaman A2Z")}</b> - {L("DSR, residual income, verified figures: the DSR engine's own triage, never a bank's rule.", "DSR, baki pendapatan, angka disahkan: saringan enjin DSR sendiri, bukan peraturan bank.")}</span></li>
            <li><AppIcon name="verify" /><span><b>{L("2 Official bank criteria", "2 Kriteria rasmi bank")}</b> - {L("from the lender's own document, with its source and dates; matched once verified and in date.", "daripada dokumen bank sendiri, dengan sumber dan tarikh; dipadankan selepas disahkan dan dalam tempoh.")}</span></li>
            <li><AppIcon name="chat" /><span><b>{L("3 Banker-provided indicative", "3 Indikatif daripada pegawai bank")}</b> - {L("a verified banker's own words; shown for review, never matched, never upgraded by itself.", "kata-kata pegawai bank yang disahkan; ditunjuk untuk semakan, tidak dipadankan, tidak dinaik taraf sendiri.")}</span></li>
            <li><AppIcon name="document" /><span><b>{L("4 Case-specific feedback", "4 Maklum balas khusus kes")}</b> - {L("one client only: it stays in that case's Kelayakan notes.", "seorang pelanggan sahaja: kekal dalam nota Kelayakan kes itu.")}</span></li>
          </ul>
        </section>
        <section className={`${card} ${css.sec}`} aria-label={L("When no verified rule exists", "Apabila tiada peraturan disahkan")} data-testid="fa-fallback">
          <h3 className={css.h}><AppIcon name="info" />{L("When no verified rule exists", "Apabila tiada peraturan disahkan")}</h3>
          <ol className={css.steps7}>
            {[["Calculate the general assessment", "Kira penilaian umum"], ["Show preliminary affordability only", "Tunjuk kemampuan awal sahaja"], ["Bank fit: Unknown - never a yes", "Kesesuaian bank: Tidak diketahui - bukan ya"], ["Send it to management review", "Hantar ke semakan pengurusan"], ["Ask a verified banker, lawfully and with the client's consent", "Tanya pegawai bank disahkan, secara sah dan dengan persetujuan pelanggan"], ["Record the answer as a banker update (indicative)", "Rekod jawapan sebagai maklumat pegawai bank (indikatif)"], ["Management writes the official rule with its source before it counts", "Pengurusan menulis peraturan rasmi dengan sumbernya sebelum dikira"]].map(([en, ms]) => <li key={en}>{L(en!, ms!)}</li>)}
          </ol>
        </section>
      </div>
      {adding && <NewCriterion kind={adding} onClose={() => setAdding(null)} toast={toast} saved={() => { setAdding(null); setTick((t) => t + 1); }} />}
    </div>
  );
}

function CritRow({ c, can, me, verifying, setVerifying, on, setOn, due, setDue, act }: {
  c: Criterion; can: { propose: boolean; verify: boolean }; me?: number; verifying: boolean; setVerifying: (x: boolean) => void;
  on: string; setOn: (s: string) => void; due: string; setDue: (s: string) => void; act: (id: number, what: "verify" | "retire" | "request-verification", body: unknown) => void;
}) {
  const s = showsOf(c);
  const ind = (c.category ?? "official") === "banker_indicative";
  return (
    <div className={css.critRow} data-testid="fa-criterion">
      <span className={css.itemMain}>
        <b>{c.bank} · {L(...(PRODUCT[c.product] ?? [c.product, c.product]))} <span className={css.sub}>v{c.version}</span></b>
        <span>{ind ? <span className={`${chipSmInfo} ${css.chip}`}>{L("Banker-indicative", "Indikatif pegawai")}</span> : <span className={`${chipSmNeutral} ${css.chip}`}>{L("Official", "Rasmi")}</span>}</span>
      </span>
      <span className={css.itemMain}><span>{summary(c)}</span>{list(c.required_documents).length > 0 && <span className={css.sub}>{L("needs", "perlu")} {list(c.required_documents).join(", ")}</span>}</span>
      <span className={css.critDsr}><b>{c.dsr_guideline_bp == null ? "—" : `${c.dsr_guideline_bp / 100}%`}</b><small>{L("DSR, as the source says", "DSR, seperti sumber")}</small></span>
      <span className={css.itemMain}>
        {ind ? <><span>{c.source_banker ?? "—"} · {c.heard_on ? dmy(c.heard_on) : "—"} · {c.channel ? L(...(CHANNEL[c.channel] ?? [c.channel, c.channel])) : "—"}</span>{c.exact_feedback && <span className={`${css.sub} ${css.lines}`}>&ldquo;{c.exact_feedback}&rdquo;</span>}</> : <span>{c.source}</span>}
        <span>{chip(CONF, c.confidence)}</span>
      </span>
      <span className={css.itemMain}>
        <span className={css.sub}>{L("Effective", "Berkuat kuasa")} {c.effective_from ? dmy(c.effective_from) : "—"} · {L("reviewed", "disemak")} {c.last_verified_on ? dmy(c.last_verified_on) : "—"}</span>
        <span className={css.sub}>{L("Review due", "Semakan")} {c.review_due_on ? dmy(c.review_due_on) : "—"} · {L("expires", "tamat")} {c.expires_on ? dmy(c.expires_on) : "—"}</span>
        <span className={css.sub}>{c.verified_by_name ? `${L("Approved by", "Diluluskan oleh")} ${c.verified_by_name}` : `${L("Proposed by", "Dicadang oleh")} ${c.created_by_name ?? "—"}`}</span>
      </span>
      <span className={css.critAct}>
        <span data-testid="fa-crit-state">{chip(SHOWS, s)}</span>
        {can.verify && s === "draft" && c.created_by !== me && <button type="button" className={btnSm} onClick={() => setVerifying(!verifying)}>{L("Verify", "Sahkan")}</button>}
        {can.propose && (s === "draft" || s === "indicative") && <button type="button" className={btnSmQuiet} onClick={() => act(c.id, "request-verification", {})} data-testid="fa-crit-ask">{L("Ask to verify", "Minta pengesahan")}</button>}
        {can.verify && s !== "archived" && <button type="button" className={btnSmQuiet} onClick={() => act(c.id, "retire", {})}>{L("Archive", "Arkib")}</button>}
      </span>
      {verifying && (
        <span className={`${css.inline} ${css.wide}`} data-testid="fa-crit-verify-form">
          <label className={css.field}>{L("Confirmed with the source on", "Disahkan dengan sumber pada")}<input className={inputClassSm} type="date" value={on} max={mytToday()} onChange={(e) => setOn(e.target.value)} /></label>
          <label className={css.field}>{L("Next review (optional)", "Semakan seterusnya (pilihan)")}<input className={inputClassSm} type="date" value={due} min={mytToday()} onChange={(e) => setDue(e.target.value)} /></label>
          <button type="button" className={btnSmPrimary} onClick={() => act(c.id, "verify", { last_verified_on: on, ...(due ? { review_due_on: due } : {}) })}>{L("Verify and publish", "Sahkan dan terbit")}</button>
        </span>
      )}
    </div>
  );
}

const EMP = ["permanent", "contract", "government", "glc", "private", "business_owner", "commission_based"];
const REQ_DOCS: [string, string][] = [["payslip", "Payslip"], ["bank_statement", "Bank statement"], ["epf", "EPF statement"], ["facility_statement", "Facility statement"], ["ccris_by_client", "CCRIS"], ["ic", "IC copy"]];

function NewCriterion({ kind, onClose, toast, saved }: { kind: "official" | "banker_indicative"; onClose: () => void; toast: Toast; saved: () => void }) {
  /* v1.286.0 - the bank (and v1.301.0 the banker) come from the one registry */
  const [reg, setReg] = useState<{ banks: { id: number; name: string; status: string }[]; products: { bank_id: number; product: string; status: string }[]; bankers: { id: number; bank_id: number; full_name: string; status?: string }[] } | null>(null);
  useEffect(() => { let live = true; void api<NonNullable<typeof reg>>("/staff/fa/registry").then((r) => { if (live && r.ok && r.data) setReg({ banks: r.data.banks.filter((b) => b.status !== "retired"), products: r.data.products.filter((p) => p.status === "active"), bankers: r.data.bankers ?? [] }); }); return () => { live = false; }; }, []);
  const ind = kind === "banker_indicative";
  const [f, setF] = useState({ bank: "", product: "personal_financing", min_age: "", max_age: "", min_tenure: "", max_tenure: "", income_definition: "net", commitment_definition: "all", dsr: "", min_income: "", min_service: "", source: "",
    emp: [] as string[], docs: [] as string[], confidence: "", effective: "", review: "", expires: "", banker: "", heard: mytToday(), channel: "work_phone", words: "" });
  const toggle = (k: "emp" | "docs", v: string, on: boolean) => setF({ ...f, [k]: on ? [...f[k], v] : f[k].filter((x) => x !== v) });
  const offered = !!reg && reg.products.some((o) => String(o.bank_id) === f.bank && o.product === f.product);
  const ready = !!f.bank && offered && f.source.trim().length >= 5 && !!f.confidence && (!ind || (!!f.banker && f.words.trim().length >= 10 && !!f.heard));
  const save = async () => {
    const dsr = Number(f.dsr), inc = Number(f.min_income.replace(/,/g, ""));
    const n = (s: string) => (s ? Number(s) : undefined);
    const r = await api<Err>("/staff/fa/criteria", { method: "POST", body: JSON.stringify({
      bank_id: Number(f.bank), product: f.product, category: kind, confidence: f.confidence,
      min_age: n(f.min_age), max_age: n(f.max_age), min_tenure_months: n(f.min_tenure), max_tenure_months: n(f.max_tenure), income_definition: f.income_definition, commitment_definition: f.commitment_definition, source: f.source,
      dsr_guideline_pct: f.dsr.trim() && Number.isFinite(dsr) ? dsr : undefined, min_income_cents: f.min_income.trim() && Number.isFinite(inc) ? Math.round(inc * 100) : undefined,
      min_service_months: n(f.min_service), employment_categories: f.emp.length ? f.emp : undefined, required_documents: f.docs.length ? f.docs : undefined,
      effective_from: f.effective || undefined, review_due_on: f.review || undefined, expires_on: f.expires || undefined,
      ...(ind ? { banker_id: Number(f.banker), heard_on: f.heard, channel: f.channel, exact_feedback: f.words.trim() } : {}),
    }) });
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), (r.data as Err | null)?.error?.message ?? "", "notice"); return; }
    toast(ind ? L("Banker update recorded", "Maklumat pegawai direkod") : L("Draft saved", "Draf disimpan"), ind ? L("Indicative only - never used to match.", "Indikatif sahaja - tidak digunakan untuk padanan.") : L("Management verifies it before it is used.", "Pengurusan mengesahkannya sebelum digunakan.")); saved();
  };
  return (
    <SideDrawer open onClose={onClose} dirty={!!(f.bank || f.source || f.words)} title={ind ? L("Record a banker update", "Rekod maklumat pegawai bank") : L("Add a bank criterion", "Tambah kriteria bank")}
      subtitle={ind ? L("Indicative - shown for review, never matched", "Indikatif - ditunjuk untuk semakan, tidak dipadankan") : L("A draft is never used for matching until verified", "Draf tidak digunakan untuk padanan sehingga disahkan")}>
      {!reg ? <SkelRows rows={4} /> : <div className={`${css.stack} ${css.touch}`} data-testid="fa-crit-form">
        <div className={css.form}>
          <label className={css.field}>{L("Bank (from the registry)", "Bank (daripada daftar)")}<select className={selectClassSm} value={f.bank} data-testid="fa-crit-bank" onChange={(e) => setF({ ...f, bank: e.target.value, banker: "" })}><option value="">—</option>{reg.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className={css.field}>{L("Product", "Produk")}<select className={selectClassSm} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}><option value="personal_financing">{L("Personal financing", "Pembiayaan peribadi")}</option><option value="debt_consolidation">{L("Debt consolidation", "Penyatuan hutang")}</option></select></label>
          {f.bank && !offered && <p className={`erp-note ${css.wide}`}>{L("This bank has no such product in the registry yet - management adds it in Bankers, Bank registry.", "Bank ini belum ada produk tersebut dalam daftar - pengurusan menambahnya dalam Pegawai bank, Daftar bank.")}</p>}
          {ind && (<>
            <label className={css.field}>{L("Banker who said it", "Pegawai yang menyatakan")}<select className={selectClassSm} value={f.banker} onChange={(e) => setF({ ...f, banker: e.target.value })} data-testid="fa-crit-banker"><option value="">—</option>{reg.bankers.filter((b) => String(b.bank_id) === f.bank).map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}</select></label>
            <label className={css.field}>{L("Day they said it", "Tarikh dinyatakan")}<input className={inputClassSm} type="date" max={mytToday()} value={f.heard} onChange={(e) => setF({ ...f, heard: e.target.value })} /></label>
            <label className={css.field}>{L("How", "Bagaimana")}<select className={selectClassSm} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{Object.entries(CHANNEL).map(([k, w]) => <option key={k} value={k}>{L(w[0], w[1])}</option>)}</select></label>
            <label className={`${css.field} ${css.wide}`}>{L("Their exact words (no client details)", "Kata-kata mereka (tanpa butiran pelanggan)")}<textarea className={textareaClass} rows={3} maxLength={1000} value={f.words} onChange={(e) => setF({ ...f, words: e.target.value })} data-testid="fa-crit-words" /></label>
          </>)}
          <label className={css.field}>{L("Confidence", "Keyakinan")}<select className={selectClassSm} value={f.confidence} onChange={(e) => setF({ ...f, confidence: e.target.value })} data-testid="fa-crit-confidence"><option value="">—</option>{Object.entries(CONF).map(([k, w]) => <option key={k} value={k}>{L(w[0], w[1])}</option>)}</select></label>
          <label className={css.field}>{L("DSR guideline (%), only if the source states one", "Garis panduan DSR (%), hanya jika sumber menyatakannya")}<input className={inputClassSm} inputMode="decimal" value={f.dsr} onChange={(e) => setF({ ...f, dsr: e.target.value })} /></label>
          <label className={css.field}>{L("Measured on", "Diukur atas")}<select className={selectClassSm} value={f.income_definition} onChange={(e) => setF({ ...f, income_definition: e.target.value })}><option value="net">{L("Net income", "Pendapatan bersih")}</option><option value="gross">{L("Gross income", "Pendapatan kasar")}</option></select></label>
          <label className={css.field}>{L("Commitments counted", "Komitmen dikira")}<select className={selectClassSm} value={f.commitment_definition} onChange={(e) => setF({ ...f, commitment_definition: e.target.value })}><option value="all">{L("All", "Semua")}</option><option value="exclude_ptptn">{L("All except PTPTN", "Semua kecuali PTPTN")}</option></select></label>
          <label className={css.field}>{L("Minimum income (RM, optional)", "Pendapatan minimum (RM, pilihan)")}<input className={inputClassSm} inputMode="decimal" value={f.min_income} onChange={(e) => setF({ ...f, min_income: e.target.value })} /></label>
          <label className={css.field}>{L("Age from - to (optional)", "Umur dari - hingga (pilihan)")}<span className={css.inline}><input className={inputClassSm} inputMode="numeric" aria-label={L("Minimum age", "Umur minimum")} value={f.min_age} onChange={(e) => setF({ ...f, min_age: e.target.value.replace(/\D/g, "") })} /><input className={inputClassSm} inputMode="numeric" aria-label={L("Maximum age", "Umur maksimum")} value={f.max_age} onChange={(e) => setF({ ...f, max_age: e.target.value.replace(/\D/g, "") })} /></span></label>
          <label className={css.field}>{L("Tenure months from - to (optional)", "Tempoh bulan dari - hingga (pilihan)")}<span className={css.inline}><input className={inputClassSm} inputMode="numeric" aria-label={L("Minimum tenure", "Tempoh minimum")} value={f.min_tenure} onChange={(e) => setF({ ...f, min_tenure: e.target.value.replace(/\D/g, "") })} /><input className={inputClassSm} inputMode="numeric" aria-label={L("Maximum tenure", "Tempoh maksimum")} value={f.max_tenure} onChange={(e) => setF({ ...f, max_tenure: e.target.value.replace(/\D/g, "") })} /></span></label>
          <label className={css.field}>{L("Minimum service (months, optional)", "Tempoh minimum (bulan, pilihan)")}<input className={inputClassSm} inputMode="numeric" value={f.min_service} onChange={(e) => setF({ ...f, min_service: e.target.value.replace(/\D/g, "") })} /></label>
          <label className={css.field}>{L("Effective from (optional)", "Berkuat kuasa dari (pilihan)")}<input className={inputClassSm} type="date" value={f.effective} onChange={(e) => setF({ ...f, effective: e.target.value })} /></label>
          <label className={css.field}>{L("Review due (optional)", "Semakan pada (pilihan)")}<input className={inputClassSm} type="date" min={mytToday()} value={f.review} onChange={(e) => setF({ ...f, review: e.target.value })} /></label>
          <label className={css.field}>{L("Expires (optional)", "Tamat tempoh (pilihan)")}<input className={inputClassSm} type="date" min={mytToday()} value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} /></label>
          <label className={`${css.field} ${css.wide}`}>{ind ? L("Note (where it was said, and date)", "Catatan (di mana dinyatakan, dan tarikh)") : L("Source (document or contact, and date)", "Sumber (dokumen atau kenalan, dan tarikh)")}<input className={inputClassSm} value={f.source} maxLength={300} onChange={(e) => setF({ ...f, source: e.target.value })} data-testid="fa-crit-source" /></label>
        </div>
        <fieldset className={css.fieldset}><legend>{L("Employment accepted (none ticked = not stated)", "Pekerjaan diterima (tiada = tidak dinyatakan)")}</legend>{EMP.map((x) => <label key={x} className={css.check}><input type="checkbox" checked={f.emp.includes(x)} onChange={(e) => toggle("emp", x, e.target.checked)} /> {x.replace("_", " ")}</label>)}</fieldset>
        <fieldset className={css.fieldset}><legend>{L("Documents the bank requires", "Dokumen yang diperlukan bank")}</legend>{REQ_DOCS.map(([k, w]) => <label key={k} className={css.check}><input type="checkbox" checked={f.docs.includes(k)} onChange={(e) => toggle("docs", k, e.target.checked)} /> {w}</label>)}</fieldset>
        <button type="button" className={btnSmPrimary} disabled={!ready} onClick={() => void save()} data-testid="fa-crit-save">{ind ? L("Record the banker update", "Rekod maklumat pegawai") : L("Save draft", "Simpan draf")}</button>
      </div>}
    </SideDrawer>
  );
}
