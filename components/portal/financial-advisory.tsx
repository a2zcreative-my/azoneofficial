"use client";

/* v1.298.0 - FINANCIAL ADVISORY 2.0, PHASE 1 (the CEO, 13-11-2026: "approve
   as per recommendation, fees switched without waiting for lawyer";
   claude/FINANCIAL-ADVISORY-2.0-BLUEPRINT.md): the six views in the address
   and, on a phone, the Dashboard's view switch; the directive's Overview (four
   figures, one list to act on); Clients & Cases with quick filters, the next
   follow-up (the case's own Task) and today's follow-ups; Bank Criteria with
   its counts and the fallback; Agreements with the fee switched on by the CEO
   - billed only after a recorded disbursement, never from an estimate.
   Signing and sending agreements and commission stay off. */
/* v1.284.0 - FINANCIAL ADVISORY (the CEO, 11-11-2026: "proceed with
   Financial Advisory"; claude/FINANCIAL-ADVISORY-BLUEPRINT.md). One tab in
   the existing A2Z OS, never a separate loan CRM: the client is an ordinary
   A2Z customer, a case task is an ordinary task, every change is audited.

     Overview          four counts from the server, v1.288.0 the assessments
                       waiting for management review, the cases that need a
                       hand, the legal switches and the disclaimer
     DSR Pre-Check     v1.288.0 - the workspace (fa-dsr.tsx): Quick Check or
                       Client Case; "+ New DSR Assessment" starts it empty
     Clients & Cases   the pipeline: search, product and status filters,
                       one row per case; a new case finds the existing
                       customer by phone instead of creating a second one
     Bankers           v1.286.0 - the ONE bank, branch and banker registry
                       (fa-registry.tsx); documents go to a banker only from
                       a case's Banker matching, under the client's consent
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
import { ViewSwitch } from "@/components/portal/executive-cards";
import { useTabViewAddress } from "@/lib/tab-view";
import { btnSm, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { APPLICATION, BANKER, Chip, FaCase, PRESCREEN, PRIORITY, PRODUCT } from "./fa-case";
import { BankerRegistry } from "./fa-registry";
import { DsrWorkspace, OUTCOME } from "./fa-dsr";
import type { Tab as CaseTab } from "./fa-case";
import css from "./financial-advisory.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Err = { error?: { message?: string; code?: string }; customer_id?: number; customer?: string; case_id?: number };
type View = "overview" | "dsr" | "clients" | "bankers" | "criteria" | "agreements";
const VIEWS: readonly View[] = ["overview", "dsr", "clients", "bankers", "criteria", "agreements"];
/* v1.298.0 - the phone's view switch: one line under each view's name */
const PHONE_SUB: Record<View, () => string> = {
  overview: () => L("What needs a hand, and who", "Apa yang perlu dibantu, dan siapa"),
  dsr: () => L("Quick Check or a client's case", "Semakan Pantas atau kes pelanggan"),
  clients: () => L("Every case, its follow-up and next step", "Setiap kes, susulan dan langkah seterusnya"),
  bankers: () => L("Directory, branches and matching", "Direktori, cawangan dan padanan"),
  criteria: () => L("Each bank's verified rules", "Peraturan bank yang disahkan"),
  agreements: () => L("Agreements and the advisory fee", "Perjanjian dan yuran nasihat"),
};
interface Pending { id: number; case_id: number; assessment_id: number | null; reason: string | null; created_at: string; submitted_by: string | null; case_ref: string; product: string; client: string | null; current_dsr_bp: number | null; projected_dsr_bp: number | null; outcome: string | null }
interface Summary {
  open: number; awaiting_banker: number; incomplete: number; official_decisions: number;
  /* v1.298.0 - the directive's four figures */
  active?: number; requiring_action?: number; reviews?: number; banker_pending?: number;
  legal: Record<string, boolean>; can: { create: boolean; decide: boolean; criteria: boolean };
}
export interface Row {
  id: number; case_ref: string; product: string; stage: string; prescreen: string; banker_status: string; application_status: string; override_result: string | null; issuer_code: string; updated_at: string; client: string | null; owner: string | null; projected_dsr_bp: number | null;
  /* v1.298.0 - FA 2.0: the next follow-up is the case's own Task; the banker is the approved allocation */
  current_dsr_bp?: number | null; owner_id?: number; next_follow_up?: string | null; next_task?: string | null; next_task_owner?: string | null; banker?: string | null; review_pending?: number; review_at?: string | null; review_action?: string | null;
  /* v1.299.0 - FA 2.0 phase 2: the priority worked out on the server (and any management override), what the case waits on */
  priority?: string | null; priority_auto?: string | null; priority_why?: string[]; priority_override?: string | null; priority_reason?: string | null; priority_by?: string | null;
  waiting_on?: string | null; blocker?: string | null; blocker_urgent?: number; ops_next_action?: string | null; closed_kind?: string | null; allocation_state?: string | null;
}
const RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const rank = (r: Row) => RANK[r.priority ?? ""] ?? 4;
function PriorityChip({ r }: { r: Row }) {
  if (!r.priority) return null;
  const w = PRIORITY[r.priority] ?? [r.priority, r.priority, chipSmNeutral];
  return <span className={`${w[2]} ${css.chip}`} title={[...(r.priority_why ?? []), r.priority_override ? `${L("Set by", "Oleh")} ${r.priority_by ?? ""}: ${r.priority_reason ?? ""}` : ""].filter(Boolean).join(" · ")} data-testid="fa-row-priority">{L(w[0], w[1])}{r.priority_override ? " *" : ""}</span>;
}
interface Criterion { id: number; family: string; version: number; bank: string; product: string; income_definition: string; commitment_definition: string; dsr_guideline_bp: number | null; min_income_cents: number | null; employment_categories: string | null; min_service_months: number | null; required_documents: string | null; source: string; last_verified_on: string | null; state: string }
const STAGE_WORD: Record<string, [string, string]> = {
  intake: ["Intake", "Pengambilan"], profile: ["Financial information pending", "Maklumat kewangan belum lengkap"], prescreen: ["Pre-assessment", "Pra-penilaian"], review: ["Awaiting management review", "Menunggu semakan pengurusan"], matching: ["Banker matching", "Padanan pegawai bank"],
  agreement: ["Agreement", "Perjanjian"], enquiry: ["Banker enquiry", "Pertanyaan bank"], application: ["Application processing", "Permohonan diproses"], decision: ["Outcome received", "Keputusan diterima"], disbursed: ["Disbursed", "Dikeluarkan"], fee: ["Fee", "Yuran"], closed: ["Closed", "Ditutup"],
};
const list = (s: string | null) => { try { return s ? (JSON.parse(s) as string[]) : []; } catch { return []; } };
const pctOf = (bp: number | null | undefined) => (bp == null ? "—" : `${(bp / 100).toFixed(1)}%`);
/** the task's own words, without the "FA-000001: " the server puts in front */
const taskWords = (t: string | null | undefined) => (t ?? "").replace(/^FA-\d+:\s*/, "");

/* v1.298.0 - FA 2.0: each open case's next step, who holds it and by when -
   worked out from the records (review, banker, tasks, figures), never typed */
export interface Next { what: string; who: string; due: string | null; overdue: boolean; today: boolean; kind: "review" | "client" | "banker" | "task" | "figures" | "move" }
export function nextOf(r: Row): Next {
  const today = mytToday();
  const day = (d: string | null | undefined) => (d ? d.slice(0, 10) : null);
  const mk = (what: string, who: string, due: string | null, kind: Next["kind"]): Next => ({ what, who, due, kind, overdue: !!due && day(due)! < today, today: !!due && day(due) === today });
  const owner = r.owner ?? "—";
  if (r.review_pending) return mk(L("Management review of the DSR", "Semakan pengurusan DSR"), L("CEO, COO or CCO", "CEO, COO atau CCO"), null, "review");
  if (r.review_action === "request_info" || r.review_action === "concern") return mk(r.review_action === "request_info" ? L("Get the information management asked for", "Dapatkan maklumat yang diminta pengurusan") : L("Answer management's concern", "Jawab kebimbangan pengurusan"), owner, r.next_follow_up ?? null, "client");
  if (r.banker_status === "documents_required") return mk(L("Send the documents the banker asked for", "Hantar dokumen yang diminta pegawai bank"), owner, r.next_follow_up ?? null, "client");
  if (r.next_task) return mk(taskWords(r.next_task), r.next_task_owner ?? owner, r.next_follow_up ?? null, "task");
  if (r.ops_next_action) return mk(r.ops_next_action, owner, null, "move");
  if (r.prescreen === "incomplete") return mk(L("Complete the client's figures", "Lengkapkan angka pelanggan"), owner, null, "figures");
  if (r.banker_status === "enquiry_sent" || r.banker_status === "under_review") return mk(L("Waiting for the banker's feedback", "Menunggu maklum balas pegawai bank"), owner, null, "banker");
  return mk(`${L("Continue", "Teruskan")}: ${L(...(STAGE_WORD[r.stage] ?? [r.stage, r.stage]))}`, owner, null, "move");
}
const needsAction = (r: Row) => r.stage !== "closed" && (r.priority === "critical" || r.prescreen === "incomplete" || r.banker_status === "documents_required" || r.review_action === "request_info" || r.review_action === "concern" || !!r.review_pending
  || (!!r.next_follow_up && r.next_follow_up.slice(0, 10) <= mytToday()));

export function FinancialAdvisoryPanel({ startView }: { startView?: string }) {
  const { show, node: toastNode } = useSaveToast();
  /* v1.298.0 - FA 2.0: the view is in the address (Back / Forward, a link opens it) */
  const [view, setViewRaw] = useState<View>(() => ((VIEWS as readonly string[]).includes(startView ?? "") ? startView as View : "overview"));
  const [seenStart, setSeenStart] = useState(startView);
  if (startView !== seenStart) { setSeenStart(startView); if ((VIEWS as readonly string[]).includes(startView ?? "")) setViewRaw(startView as View); }
  const setView = setViewRaw;
  const allowed = useCallback((v: string | null): v is View => !!v && (VIEWS as readonly string[]).includes(v), []);
  useTabViewAddress("Financial Advisory", view, setView, allowed);
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<{ id: number; tab?: CaseTab } | null>(null);
  const [pending, setPending] = useState<{ pending: Pending[]; can: { decide: boolean } } | null>(null);
  const [fresh, setFresh] = useState(0);
  const openCase = useCallback((id: number, tab?: string) => setOpen({ id, tab: tab as CaseTab | undefined }), []);
  const newAssessment = useCallback(() => { setView("dsr"); setFresh((k) => k + 1); }, [setView]);
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    void Promise.all([api<Summary>("/staff/fa/summary"), api<{ cases: Row[]; me?: number }>("/staff/fa/cases"), api<NonNullable<typeof pending>>("/staff/fa/reviews")]).then(([s, c, p]) => {
      if (!live) return;
      if (p.ok && p.data) setPending(p.data);
      if (s.ok && s.data && c.ok && c.data) { setSum(s.data); setRows(c.data.cases); setMe(c.data.me ?? null); setFailed(false); }
      else setFailed(true);
    });
    return () => { live = false; };
  }, [tick]);
  const tabs = [
    ["overview", L("Overview", "Gambaran")],
    ["dsr", L("DSR Pre-Check", "Pra-Semakan DSR"), null, "DSR"],
    ["clients", L("Clients & Cases", "Pelanggan & Kes"), (sum?.active ?? sum?.open) || null, L("Cases", "Kes")],
    ["bankers", L("Bankers", "Pegawai bank")],
    ["criteria", L("Bank Criteria", "Kriteria Bank"), null, L("Criteria", "Kriteria")],
    ["agreements", L("Agreements", "Perjanjian")],
  ] as const;

  return (
    <div className={css.stack} data-testid="fa-panel">
      {toastNode}
      {/* v1.298.0 - FA 2.0 "ensure PWA standardize": the tab row on a wide
          screen; on a phone the Dashboard's view switch with + DSR beside it,
          as Ecommerce, the Desk and Sales do - never a row cut off at the edge */}
      <div className={`erp-desktop-only ${css.head}`} data-testid="fa-tabs">
        <LineTabs value={view} onChange={setView} label={L("Financial advisory", "Nasihat kewangan")} tabs={tabs} />
        {sum?.can.create && <button type="button" className={btnSmPrimary} onClick={newAssessment} data-testid="fa-new-dsr"><AppIcon name="add" />{L("New DSR Assessment", "Penilaian DSR Baharu")}</button>}
      </div>
      <div className={`erp-phone-only ${css.viewBar}`} data-testid="fa-view-bar">
        <ViewSwitch value={view} onChange={setView} label={L("Financial advisory view", "Paparan nasihat kewangan")} options={tabs.map(([k, label]) => [k, label, PHONE_SUB[k]()] as const)} />
        {sum?.can.create && <button type="button" className={css.phoneNew} onClick={newAssessment} data-testid="fa-new-dsr-phone"><AppIcon name="add" />DSR</button>}
      </div>
      {!failed && !sum ? <SkelRows rows={5} /> : failed ? (
        <div className={`${card} ${css.sec}`}><p className={css.empty}>{L("Financial advisory could not load. If this is the first day of the release, the database update may not be applied yet.", "Nasihat kewangan tidak dapat dimuatkan. Jika ini hari pertama keluaran, kemas kini pangkalan data mungkin belum digunakan.")}</p><button type="button" className={btnSm} onClick={refresh}>{L("Try again", "Cuba lagi")}</button></div>
      ) : (
        <>
          {view === "overview" && <Overview sum={sum} rows={rows} pending={pending} openCase={openCase} create={() => setCreating(true)} go={setView} />}
          {view === "dsr" && <DsrWorkspace key={fresh} toast={show} openCase={openCase} newCase={() => setCreating(true)} />}
          {view === "clients" && <Clients rows={rows} me={me} can={sum?.can.create ?? false} openCase={openCase} create={() => setCreating(true)} />}
          {view === "bankers" && <BankerRegistry toast={show} openCase={openCase} />}
          {view === "criteria" && <Criteria toast={show} />}
          {view === "agreements" && <Agreements legal={sum?.legal ?? null} />}
        </>
      )}
      <p className={css.disclaimer}><AppIcon name="info" /><span><b>{L("Indicative only. Subject to official bank approval.", "Indikatif sahaja. Tertakluk kepada kelulusan rasmi bank.")}</b> {L("A2Z is not affiliated with any bank. Eligibility, terms and approval are decided by the bank. Never ask a client for a password, OTP, PIN or online-banking login.", "A2Z tidak bergabung dengan mana-mana bank. Kelayakan, terma dan kelulusan ditentukan oleh bank. Jangan sekali-kali minta kata laluan, OTP, PIN atau log masuk perbankan dalam talian.")}</span></p>
      {open != null && <FaCase key={`${open.id}-${open.tab ?? ""}`} caseId={open.id} initialTab={open.tab} onClose={() => setOpen(null)} onChanged={refresh} toast={show} />}
      {creating && <NewCase onClose={() => setCreating(false)} toast={show} opened={(id) => { setCreating(false); refresh(); setOpen({ id, tab: "consents" }); }} />}
    </div>
  );
}

/* v1.298.0 - FA 2.0 Overview (directive section 9): the four figures and ONE
   list to act on - the next step, who holds it, by when. The legal switches
   are one line; the calculator and the directory stay in their own tabs. */
function Overview({ sum, rows, pending, openCase, create, go }: { sum: Summary | null; rows: Row[] | null; pending: { pending: Pending[]; can: { decide: boolean } } | null; openCase: (id: number, tab?: string) => void; create: () => void; go: (v: View) => void }) {
  const act = useMemo(() => (rows ?? []).filter(needsAction).map((r) => ({ r, n: nextOf(r) }))
    .sort((a, z) => rank(a.r) - rank(z.r) || Number(z.n.overdue) - Number(a.n.overdue) || Number(z.n.kind === "review") - Number(a.n.kind === "review") || (a.n.due ?? "9999").localeCompare(z.n.due ?? "9999") || z.r.updated_at.localeCompare(a.r.updated_at)), [rows]);
  const decide = pending?.can.decide ?? false;
  return (
    <div className={css.stack}>
      <KpiRow label={L("Financial advisory figures", "Angka nasihat kewangan")}>
        <KpiTile icon="clients" tone="navy" label={L("Active cases", "Kes aktif")} value={sum?.active ?? sum?.open ?? 0} busy={!sum} sub={L("Not closed", "Belum ditutup")} onClick={() => go("clients")} />
        <KpiTile icon="pending" tone="red" label={L("Cases requiring action", "Kes perlu tindakan")} value={sum?.requiring_action ?? 0} busy={!sum} sub={L("Follow-up due, information or documents missing", "Susulan tiba, maklumat atau dokumen tiada")} />
        <KpiTile icon="verify" tone="gold" label={L("Management reviews", "Semakan pengurusan")} value={sum?.reviews ?? pending?.pending.length ?? 0} busy={!sum} sub={L("Waiting for a decision", "Menunggu keputusan")} />
        <KpiTile icon="chat" tone="blue" label={L("Banker responses pending", "Maklum balas bank belum diterima")} value={sum?.banker_pending ?? sum?.awaiting_banker ?? 0} busy={!sum} sub={L("Enquiry sent, no feedback yet", "Pertanyaan dihantar, belum ada maklum balas")} />
      </KpiRow>
      <section className={`${card} ${css.sec}`} aria-label={L("Needs action", "Perlu tindakan")} data-testid="fa-action-list">
        <div className={css.head}>
          <h3 className={css.h}><AppIcon name="target" />{L("Needs action", "Perlu tindakan")} {act.length > 0 && <span className={chipSmWarn}>{act.length}</span>}</h3>
          {sum?.can.create && <button type="button" className={btnSmPrimary} onClick={create}><AppIcon name="add" />{L("New case", "Kes baharu")}</button>}
        </div>
        {!rows ? <SkelRows rows={3} /> : act.length === 0 ? <p className={css.sub}>{rows.length === 0 ? L("No advisory case yet. Open one from a client conversation.", "Belum ada kes nasihat. Buka satu daripada perbualan pelanggan.") : L("Nothing waiting on anyone.", "Tiada yang menunggu sesiapa.")}</p> : (
          <ul className={css.rows}>{act.map(({ r, n }) => (
            <li key={r.id}>
              <button type="button" className={css.actRow} onClick={() => openCase(r.id, n.kind === "review" ? "dsr" : undefined)} data-testid="fa-action-row">
                <span className={css.who}><b>{r.client ?? "—"}</b><span className={css.sub}>{r.case_ref} · {L(...(PRODUCT[r.product] ?? [r.product, r.product]))}</span></span>
                <span className={css.actWhat}>{n.what}</span>
                <span className={css.sub}>{n.who}</span>
                <span className={css.when}>{n.due ? <span className={n.overdue ? chipSmDanger : n.today ? chipSmWarn : chipSmNeutral}>{n.overdue ? L("Overdue", "Lewat") : n.today ? L("Today", "Hari ini") : dmy(n.due.slice(0, 10))}</span> : n.kind === "review" ? <span className={chipSmWarn}>{L("Waiting", "Menunggu")}</span> : "—"}</span>
                <span className={css.actGo}><PriorityChip r={r} />{n.kind === "review" && decide ? L("Review", "Semak") : L("Open case", "Buka kes")}</span>
              </button>
            </li>
          ))}</ul>
        )}
        {(pending?.pending.length ?? 0) > 0 && (
          <p className={css.sub} data-testid="fa-review-queue">{decide ? L("Waiting for your review", "Menunggu semakan anda") : L("Waiting for management review", "Menunggu semakan pengurusan")}: {pending!.pending.map((p) => `${p.client ?? "—"} · ${p.case_ref} (${L("projected DSR", "DSR unjuran")} ${pctOf(p.projected_dsr_bp)}${p.outcome ? `, ${L(...((OUTCOME[p.outcome] ?? OUTCOME.incomplete!).slice(0, 2) as [string, string]))}` : ""})`).join(" · ")}. {L("A Proceed is an internal decision, never a loan approval.", "Teruskan ialah keputusan dalaman, bukan kelulusan pinjaman.")}</p>
        )}
      </section>
      <p className={css.lockLine} data-testid="fa-legal"><AppIcon name="lock" /><span>{L("Client agreements (sending and signing) and commission on advisory fees are switched off. The advisory fee is ON by your decision of 13-11-2026 - billed only after a disbursement is recorded with the bank's evidence. No CTOS reporting, blacklisting or penalty clauses. Documents go to an approved banker only under the client's disclosure consent.", "Perjanjian pelanggan (penghantaran dan tandatangan) dan komisen atas yuran nasihat dimatikan. Yuran nasihat DIHIDUPKAN dengan keputusan anda 13-11-2026 - dibilkan hanya selepas pengeluaran direkod dengan bukti bank. Tiada pelaporan CTOS, senarai hitam atau klausa penalti. Dokumen kepada pegawai bank hanya di bawah persetujuan pendedahan pelanggan.")}</span> <button type="button" className={css.linkBtn} onClick={() => go("agreements")}>{L("Details", "Butiran")}</button></p>
    </div>
  );
}

function CaseRow({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const n = r.stage === "closed" ? null : nextOf(r);
  return (
    <li>
      <button type="button" className={css.caseRow} onClick={onOpen} data-testid="fa-case-row">
        <span className={css.who}><b>{r.client ?? "—"}</b><span className={css.sub}>{r.case_ref} · {L(...(PRODUCT[r.product] ?? [r.product, r.product]))} · {r.owner ?? "—"}</span></span>
        <span className={css.stage}><PriorityChip r={r} />{L(...(STAGE_WORD[r.stage] ?? [r.stage, r.stage]))}{r.banker ? <small className={css.sub}>{r.banker}</small> : null}</span>
        <span className={css.chips}><Chip map={PRESCREEN} k={r.override_result ?? r.prescreen} /><Chip map={BANKER} k={r.banker_status} /><Chip map={APPLICATION} k={r.application_status} /></span>
        <span className={css.dsr}>{pctOf(r.projected_dsr_bp)}<small>{L("projected DSR", "DSR unjuran")}</small></span>
        <span className={css.when}>{n?.due ? <><span className={n.overdue ? chipSmDanger : n.today ? chipSmWarn : chipSmInfo}>{n.overdue ? L("Overdue", "Lewat") : n.today ? L("Today", "Hari ini") : dmy(n.due.slice(0, 10))}</span><small>{L("next follow-up", "susulan seterusnya")}</small></> : dmyMYT(r.updated_at)}</span>
      </button>
    </li>
  );
}

/* v1.298.0 - FA 2.0 Clients & Cases (directive section 4, photo 2): the quick
   filters the records can answer today, the four counts, the case list with
   its next follow-up (the case's own Task), and today's follow-ups beside it.
   v1.299.0 - Phase 2: the priority (worked out on the server, or set by
   management with a reason), High priority and Ready for authorized
   submission, sorted by priority first. */
type Quick = "mine" | "all" | "today" | "high" | "client" | "banker" | "review" | "ready" | "closed";
function Clients({ rows, me, can, openCase, create }: { rows: Row[] | null; me: number | null; can: boolean; openCase: (id: number) => void; create: () => void }) {
  const [q, setQ] = useState("");
  const [product, setProduct] = useState("");
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const today = mytToday();
  const isToday = (r: Row) => r.stage !== "closed" && !!r.next_follow_up && r.next_follow_up.slice(0, 10) <= today;
  const isClient = (r: Row) => r.stage !== "closed" && (r.waiting_on === "client" || r.banker_status === "documents_required" || r.review_action === "request_info" || r.prescreen === "incomplete");
  /* v1.299.0 - ready for authorized submission: an APPROVED banker allocation with the client's disclosure consent (state ready), nothing sent yet */
  const isReady = (r: Row) => r.stage !== "closed" && r.allocation_state === "ready" && r.banker_status === "not_contacted";
  const isHigh = (r: Row) => r.stage !== "closed" && (r.priority === "critical" || r.priority === "high");
  const isBanker = (r: Row) => r.stage !== "closed" && (r.banker_status === "enquiry_sent" || r.banker_status === "under_review");
  const isReview = (r: Row) => r.stage !== "closed" && (!!r.review_pending || r.stage === "review");
  const QUICK: Record<Quick, [string, string, (r: Row) => boolean]> = {
    mine: ["My cases", "Kes saya", (r) => r.stage !== "closed" && me != null && r.owner_id === me],
    all: ["All authorized", "Semua dibenarkan", (r) => r.stage !== "closed"],
    today: ["Follow-up today", "Susulan hari ini", isToday],
    high: ["High priority", "Keutamaan tinggi", isHigh],
    client: ["Waiting for client", "Menunggu pelanggan", isClient],
    banker: ["Waiting for banker", "Menunggu bank", isBanker],
    review: ["Management review", "Semakan pengurusan", isReview],
    ready: ["Ready for authorized submission", "Sedia untuk penghantaran dibenarkan", isReady],
    closed: ["Closed / archived", "Ditutup / arkib", (r) => r.stage === "closed"],
  };
  const owners = useMemo(() => [...new Set((rows ?? []).map((r) => r.owner ?? "").filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) => {
    if (!QUICK[quick][2](r)) return false;
    if (product && r.product !== product) return false;
    if (stage && r.stage !== stage) return false;
    if (owner && r.owner !== owner) return false;
    const n = q.trim().toLowerCase();
    return !n || `${r.client ?? ""} ${r.case_ref} ${r.owner ?? ""}`.toLowerCase().includes(n);
  }).sort((a, z) => rank(a) - rank(z) || (a.next_follow_up ?? "9999").localeCompare(z.next_follow_up ?? "9999") || z.updated_at.localeCompare(a.updated_at)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- QUICK is rebuilt from rows and me, both listed
  [rows, q, product, stage, owner, quick, me]);
  const due = (rows ?? []).filter(isToday).sort((a, z) => (a.next_follow_up ?? "").localeCompare(z.next_follow_up ?? ""));
  const count = (k: Quick) => (rows ?? []).filter(QUICK[k][2]).length;
  return (
    <div className={css.stack}>
      <section className={`${card} ${css.sec}`} aria-label={L("Find a case", "Cari kes")}>
        <div className={css.tools}>
          <input className={inputClassSm} type="search" value={q} placeholder={L("Search client, case or owner", "Cari pelanggan, kes atau pemilik")} aria-label={L("Search", "Cari")} onChange={(e) => setQ(e.target.value)} />
          <select className={selectClassSm} value={product} onChange={(e) => setProduct(e.target.value)} aria-label={L("Product", "Produk")}><option value="">{L("All products", "Semua produk")}</option>{Object.entries(PRODUCT).map(([k, w]) => <option key={k} value={k}>{L(w[0], w[1])}</option>)}</select>
          <select className={selectClassSm} value={stage} onChange={(e) => setStage(e.target.value)} aria-label={L("Stage", "Peringkat")}><option value="">{L("All stages", "Semua peringkat")}</option>{Object.entries(STAGE_WORD).map(([k, w]) => <option key={k} value={k}>{L(w[0], w[1])}</option>)}</select>
          <select className={selectClassSm} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={L("Owner", "Pemilik")}><option value="">{L("All owners", "Semua pemilik")}</option>{owners.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          {can && <button type="button" className={btnSmPrimary} onClick={create}><AppIcon name="add" />{L("New case", "Kes baharu")}</button>}
        </div>
        <div className={css.quick} role="group" aria-label={L("Quick filters", "Penapis pantas")} data-testid="fa-quick">
          {(Object.keys(QUICK) as Quick[]).map((k) => (
            <button key={k} type="button" aria-pressed={quick === k} className={quick === k ? css.quickOn : ""} onClick={() => setQuick(k)}>{L(QUICK[k][0], QUICK[k][1])} <span>{count(k)}</span></button>
          ))}
        </div>
      </section>
      <KpiRow label={L("Case counts", "Kiraan kes")}>
        <KpiTile icon="date" tone="red" label={L("Needs follow-up today", "Perlu susulan hari ini")} value={count("today")} busy={!rows} onClick={() => setQuick("today")} />
        <KpiTile icon="warning" tone="gold" label={L("High priority", "Keutamaan tinggi")} value={count("high")} busy={!rows} onClick={() => setQuick("high")} />
        <KpiTile icon="clients" tone="purple" label={L("Waiting on client", "Menunggu pelanggan")} value={count("client")} busy={!rows} onClick={() => setQuick("client")} />
        <KpiTile icon="balance" tone="blue" label={L("Waiting on banker", "Menunggu bank")} value={count("banker")} busy={!rows} onClick={() => setQuick("banker")} />
        <KpiTile icon="success" tone="green" label={L("Ready to submit", "Sedia dihantar")} value={count("ready")} busy={!rows} onClick={() => setQuick("ready")} />
      </KpiRow>
      <div className={css.casesGrid}>
        <section className={`${card} ${css.sec}`} aria-label={L("Client cases", "Kes pelanggan")}>
          <div className={css.head}><h3 className={css.h}><AppIcon name="clients" />{L("Client cases", "Kes pelanggan")}</h3><span className={chipSmNeutral}>{L("Shown", "Ditunjuk")}: {shown.length}</span></div>
          {!rows ? <SkelRows rows={5} /> : shown.length === 0 ? <p className={css.empty}>{rows.length === 0 ? L("No advisory case yet.", "Belum ada kes nasihat.") : L("No case matches.", "Tiada kes sepadan.")}</p> : (
            <ul className={css.rows} data-testid="fa-pipeline">{shown.map((r) => <CaseRow key={r.id} r={r} onOpen={() => openCase(r.id)} />)}</ul>
          )}
        </section>
        <section className={`${card} ${css.sec}`} aria-label={L("Today's follow-ups", "Susulan hari ini")} data-testid="fa-today">
          <h3 className={css.h}><AppIcon name="date" />{L("Today's follow-ups", "Susulan hari ini")} <span className={due.length ? chipSmWarn : chipSmNeutral}>{due.length}</span></h3>
          {!rows ? <SkelRows rows={3} /> : due.length === 0 ? <p className={css.sub}>{L("No follow-up due today. A follow-up is a task on the case (Tasks).", "Tiada susulan hari ini. Susulan ialah tugasan pada kes (Tugasan).")}</p> : (
            <ul className={css.rows}>{due.map((r) => (
              <li key={r.id}>
                <button type="button" className={`${css.fuRow} ${r.next_follow_up!.slice(0, 10) < today ? css.fuLate : ""}`} onClick={() => openCase(r.id)}>
                  <b>{r.client ?? "—"}</b>
                  <span className={css.sub}>{L(...(PRODUCT[r.product] ?? [r.product, r.product]))}{r.banker ? ` · ${r.banker}` : ""}</span>
                  <span className={css.sub}>{taskWords(r.next_task) || "—"} · {r.next_task_owner ?? r.owner ?? "—"}</span>
                  <span className={r.next_follow_up!.slice(0, 10) < today ? chipSmDanger : chipSmWarn}>{r.next_follow_up!.slice(0, 10) < today ? `${L("Overdue since", "Lewat sejak")} ${dmy(r.next_follow_up!.slice(0, 10))}` : L("Today", "Hari ini")}</span>
                </button>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
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
  /* v1.298.0 - FA 2.0 (photo 4): counted from the records, never typed */
  const all = data?.criteria ?? [];
  const staleOn = new Date(Date.parse(`${mytToday()}T00:00:00Z`) - 90 * 864e5).toISOString().slice(0, 10);
  const verified = all.filter((c) => c.state === "verified");
  const recheck = verified.filter((c) => !c.last_verified_on || c.last_verified_on < staleOn).length;
  const banks = new Set(verified.map((c) => c.bank)).size;
  return (
    <div className={css.stack}>
    <KpiRow label={L("Bank criteria counts", "Kiraan kriteria bank")}>
      <KpiTile icon="verify" tone="green" label={L("Verified rules", "Peraturan disahkan")} value={verified.length} busy={!data} sub={L("Used by the DSR engine", "Digunakan enjin DSR")} />
      <KpiTile icon="document" tone="gold" label={L("Draft rules", "Peraturan draf")} value={all.filter((c) => c.state === "draft").length} busy={!data} sub={L("Never used until verified", "Tidak digunakan sehingga disahkan")} />
      <KpiTile icon="warning" tone="red" label={L("Need re-check", "Perlu semak semula")} value={recheck} busy={!data} sub={L("Verified over 90 days ago", "Disahkan lebih 90 hari lalu")} />
      <KpiTile icon="balance" tone="blue" label={L("Banks covered", "Bank diliputi")} value={banks} busy={!data} sub={L("With a verified rule", "Dengan peraturan disahkan")} />
    </KpiRow>
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
    <div className={css.grid2}>
      <section className={`${card} ${css.sec}`} aria-label={L("When no verified rule exists", "Apabila tiada peraturan disahkan")} data-testid="fa-fallback">
        <h3 className={css.h}><AppIcon name="info" />{L("When no verified rule exists", "Apabila tiada peraturan disahkan")}</h3>
        <ol className={css.steps7}>
          {[["Calculate the general assessment", "Kira penilaian umum"], ["Show preliminary affordability only", "Tunjuk kemampuan awal sahaja"], ["Bank fit: Unknown - never a yes", "Kesesuaian bank: Tidak diketahui - bukan ya"], ["Send it to management review", "Hantar ke semakan pengurusan"], ["Ask a verified banker, lawfully and with the client's consent", "Tanya pegawai bank disahkan, secara sah dan dengan persetujuan pelanggan"], ["Record the answer as a draft, with its source", "Rekod jawapan sebagai draf, dengan sumbernya"], ["Management verifies it before it counts", "Pengurusan mengesahkannya sebelum dikira"]].map(([en, ms]) => <li key={en}>{L(en!, ms!)}</li>)}
        </ol>
      </section>
      <section className={`${card} ${css.sec}`} aria-label={L("Minimum fields per rule", "Medan minimum setiap peraturan")}>
        <h3 className={css.h}><AppIcon name="success" />{L("Minimum fields per rule", "Medan minimum setiap peraturan")}</h3>
        <ul className={css.list}>
          {[["Bank and product (from the registry)", "Bank dan produk (daripada daftar)"], ["Source - document or contact, and date", "Sumber - dokumen atau kenalan, dan tarikh"], ["Income measured on (net or gross) and what commitments count", "Pendapatan diukur atas (bersih atau kasar) dan komitmen yang dikira"], ["DSR guideline, only if the source states one", "Garis panduan DSR, hanya jika sumber menyatakannya"], ["Employment accepted and documents required", "Pekerjaan diterima dan dokumen diperlukan"], ["The date management confirmed it with the source", "Tarikh pengurusan mengesahkannya dengan sumber"]].map(([en, ms]) => <li key={en}><AppIcon name="success" /><span>{L(en!, ms!)}</span></li>)}
        </ul>
        <p className={css.sub}>{L("Category, confidence and review dates per rule come with Phase 4.", "Kategori, keyakinan dan tarikh semakan setiap peraturan datang dengan Fasa 4.")}</p>
      </section>
    </div>
    </div>
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

/* v1.298.0 - the fee is ON by the CEO's decision (13-11-2026, without legal
   review). The agreement itself - generating for a client, sending, signing -
   stays OFF, and the template library is Phase 5. No rate is written here: it
   is set on the approved template; the fee is billed only after a recorded
   disbursement, through Sales (quotation -> invoice -> CEO verification). */
function Agreements({ legal }: { legal: Record<string, boolean> | null }) {
  const feeOn = !!legal?.fee;
  return (
    <div className={css.stack}>
      <section className={`${card} ${css.sec}`} aria-label={L("Advisory fee", "Yuran nasihat")} data-testid="fa-fee">
        <h3 className={css.h}><AppIcon name="money" />{L("Advisory fee", "Yuran nasihat")} <span className={`${feeOn ? chipSmSuccess : chipSmNeutral} ${css.chip}`}>{feeOn ? L("On - CEO decision 13-11-2026", "Hidup - keputusan CEO 13-11-2026") : L("Switched off", "Dimatikan")}</span></h3>
        <dl className={css.kv}>
          <div><dt>{L("Rate", "Kadar")}</dt><dd>{L("Set on the approved agreement template (15% is your proposal) - never written in the system's code", "Ditetapkan pada templat perjanjian yang diluluskan (15% ialah cadangan anda) - tidak ditulis dalam kod sistem")}</dd></div>
          <div><dt>{L("When it is billed", "Bila dibilkan")}</dt><dd>{L("Only after a disbursement is recorded with the bank's evidence - never from an estimated eligibility", "Hanya selepas pengeluaran direkod dengan bukti bank - tidak sekali-kali daripada anggaran kelayakan")}</dd></div>
          <div><dt>{L("How", "Bagaimana")}</dt><dd>{L("Sales quotation -> invoice -> your payment verification (no second invoice engine)", "Sebut harga Jualan -> invois -> pengesahan bayaran anda (tiada enjin invois kedua)")}</dd></div>
          <div><dt>{L("Legal review", "Semakan undang-undang")}</dt><dd>{L("Not done - switched on by your decision. Counsel is still advised before the first client is billed (Consumer Credit Act 2025).", "Belum dibuat - dihidupkan dengan keputusan anda. Peguam masih dinasihatkan sebelum pelanggan pertama dibilkan (Akta Kredit Pengguna 2025).")}</dd></div>
          <div><dt>{L("Commission", "Komisen")}</dt><dd>{legal?.commission ? "" : L("None on advisory fees until you approve it", "Tiada atas yuran nasihat sehingga anda luluskan")}</dd></div>
          <div><dt>{L("CTOS / blacklisting / penalties", "CTOS / senarai hitam / penalti")}</dt><dd>{L("Never used. Not built.", "Tidak sekali-kali digunakan. Tidak dibina.")}</dd></div>
        </dl>
      </section>
      <section className={`${card} ${css.sec}`} aria-label={L("Agreements", "Perjanjian")} data-testid="fa-agreements">
        <h3 className={css.h}><AppIcon name="lock" />{L("Client agreements", "Perjanjian pelanggan")} <span className={`${chipSmNeutral} ${css.chip}`}>{L("Sending and signing switched off", "Penghantaran dan tandatangan dimatikan")}</span></h3>
        <p>{L("The template library - upload your approved Word agreement once, pick a case, and the client's name and IC fill in (IC masked) with a draft PDF - is Phase 5. Sending an agreement to a client and signing stay off until legal review and your separate approval.", "Pustaka templat - muat naik perjanjian Word yang diluluskan sekali, pilih kes, dan nama serta IC pelanggan diisi (IC bertopeng) dengan PDF draf - ialah Fasa 5. Menghantar perjanjian kepada pelanggan dan tandatangan kekal dimatikan sehingga semakan undang-undang dan kelulusan berasingan anda.")}</p>
      </section>
    </div>
  );
}
