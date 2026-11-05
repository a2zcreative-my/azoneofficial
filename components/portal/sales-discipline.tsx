"use client";

/* v1.262.0 - PHASE 1, SALES DISCIPLINE (claude/SALES-RECOVERY-AUDIT.md
   revision 2, approved "Phase by Phase", 05-11-2026).

   The pieces the Dashboard's Weekly Sales Target card and Sales -> Weekly
   targets share: management's command strip (target, collected, invoiced,
   open quotations, the required pace, the best week, forecast confidence,
   sales recovery risk - each shown on its own), the Sales advice cards with
   one "Do it", the open quotations with what the customer said, the week's
   allocation with its reconciliation line, Copy last week, and the advisory
   settings. Every figure and every card is the worker's
   (/staff/sales/week/...); nothing is computed, predicted or judged here.
   No message goes to a customer: a person contacts them and records it. */

import { useEffect, useState } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { AcceptanceSheet } from "@/components/portal/project-workspace";
import { makeApi, type ApiResult } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, textareaClass } from "@/lib/ui-styles";
import { GOAL_LABEL } from "@/lib/week-status";
import css from "./sales-discipline.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const message = (r: ApiResult<unknown>) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Nothing was saved.", "Sambungan gagal. Tiada apa disimpan.");
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nextWeekday = (d: string) => { let x = addDays(d, 1); while ([0, 6].includes(new Date(`${x}T00:00:00Z`).getUTCDay())) x = addDays(x, 1); return x; };

/* ---------------- types (the worker's answers) ---------------- */
export interface Outlook {
  invoiced: { cents: number; n: number }; open_quotations: { cents: number; n: number }; followups_scheduled: number; days_left: number;
  required_per_day_cents: number | null; best_week: { from: string; cents: number } | null; ageing_quotations: number;
  confidence: { level: string; target_weeks: number; achieved_weeks: number; decided_quotations: number; needs: { target_weeks: number; decided_quotations: number } };
  risk: { level: string | null; ratio: number | null; reasons: string[] };
}
export interface AdviceCard {
  key: string; rule: string; severity: "critical" | "warn" | "info"; owner: { id: number | null; name: string | null };
  record: { kind: string; id: number | null; label: string | null }; evidence: Record<string, unknown>; risk: string;
  action: "followup" | "task" | "allocate" | "plan" | "tasks"; due_on: string | null; amount_cents: number;
}
export interface Opportunity {
  id: number; doc_number: string; customer_id: number; company: string | null; total_cents: number; created_on: string; age_days: number; idle_days: number;
  valid_until: string | null; revision: number; issuer_code: string | null; shared_online: boolean; owner: { id: number | null; name: string | null };
  next: { id: number; due_on: string; note: string; owner: string | null; linked: boolean } | null;
  last_contact: { at: string | null; by: string | null; outcome: string | null; obstacle: string | null; note: string | null } | null;
  acceptance: { revision: number; name: string; at: string; channel: string | null; current: boolean } | null;
}

/* ---------------- words ---------------- */
export const OUTCOME: Record<string, [string, string, string]> = {
  interested: ["Interested", "Berminat", chipSmInfo], negotiating: ["Negotiating", "Sedang berunding", chipSmInfo], waiting: ["Waiting for decision", "Menunggu keputusan", chipSmNeutral],
  accepted: ["Accepted", "Diterima", chipSmSuccess], lost: ["Lost", "Tidak berjaya", chipSmDanger], no_response: ["No response yet", "Belum ada jawapan", chipSmWarn],
  promised: ["Payment promised", "Bayaran dijanjikan", chipSmInfo], paid: ["Says it is paid", "Kata sudah bayar", chipSmSuccess], disputed: ["Disputed", "Dipertikaikan", chipSmDanger],
};
export const outcomeChip = (o: string | null | undefined) => (o && OUTCOME[o] ? <span className={OUTCOME[o]![2]}>{L(OUTCOME[o]![0], OUTCOME[o]![1])}</span> : null);
const RULE: Record<string, [string, string]> = {
  qt_very_old: ["Very old quotation - confirm it is still wanted", "Sebut harga sangat lama - sahkan masih diperlukan"],
  qt_ageing: ["Quotation going cold", "Sebut harga semakin sejuk"],
  invoice_unpaid: ["Unpaid invoice", "Invois belum dibayar"],
  low_pipeline: ["Pipeline too thin for the gap", "Saluran terlalu nipis untuk baki"],
  no_activity: ["No sales activity yet this week", "Tiada aktiviti jualan minggu ini"],
  delivery_bottleneck: ["Delivery is behind", "Penghantaran kerja ketinggalan"],
};
const RISK: Record<string, [string, string]> = {
  pipeline_overstated: ["The pipeline may be overstated", "Saluran mungkin terlebih anggaran"], going_cold: ["The opportunity is going cold", "Peluang semakin sejuk"],
  cash_not_collected: ["Cash not collected", "Tunai belum dikutip"], target_unreachable: ["The target cannot be reached from today's opportunities", "Sasaran tidak tercapai dengan peluang semasa"],
  pace_lost: ["The week's pace is being lost", "Rentak minggu ini hilang"], delivery_not_sales: ["A delivery issue, not a sales one", "Isu penghantaran, bukan jualan"],
};
const ACTION: Record<AdviceCard["action"], [string, string, AppIconName]> = {
  followup: ["Schedule follow-up", "Jadualkan susulan", "calendarAdd"], task: ["Create task", "Cipta tugasan", "assignment"],
  allocate: ["Allocate this week", "Agihkan minggu ini", "target"], plan: ["Open my plan", "Buka pelan saya", "idea"], tasks: ["Open Tasks", "Buka Tugasan", "assignment"],
};
const SEV: Record<AdviceCard["severity"], string> = { critical: chipSmDanger, warn: chipSmWarn, info: chipSmNeutral };
const SEV_WORD: Record<AdviceCard["severity"], [string, string]> = { critical: ["Act now", "Tindakan segera"], warn: ["Attention needed", "Perlu perhatian"], info: ["Note", "Nota"] };
export const KIND: Record<string, [string, string, string, string]> = {
  revenue: ["Revenue target", "Sasaran hasil", "You close deals, so your target counts invoices paid in full that you closed.", "Anda menutup jualan, jadi sasaran anda mengira invois dibayar penuh yang anda tutup."],
  contribution: ["Contribution goal", "Matlamat sumbangan", "You support sales: your goal counts the quotations, follow-ups and verified introductions you make. It is never added to the company RM.", "Anda menyokong jualan: matlamat anda mengira sebut harga, susulan dan petunjuk disahkan yang anda buat. Ia tidak ditambah ke RM syarikat."],
  operational: ["Operational KPIs", "KPI operasi", "Your role supports delivery: your linked tasks done on time are your contribution. A lead you introduce still helps.", "Peranan anda menyokong penghantaran: tugasan berpaut yang siap tepat masa ialah sumbangan anda. Petunjuk yang anda perkenalkan tetap membantu."],
};
const kindChip = (k: string) => <span className={k === "revenue" ? chipSmInfo : k === "contribution" ? chipSmSuccess : chipSmNeutral}>{L(KIND[k]?.[0] ?? k, KIND[k]?.[1] ?? k)}</span>;

function evidenceLine(c: AdviceCard): string {
  const e = c.evidence as Record<string, number | string | boolean | null>;
  const rm = (k: string) => fmtRM(Number(e[k] ?? 0));
  switch (c.rule) {
    case "qt_very_old": case "qt_ageing":
      return L(`${e.doc_number} · ${e.company ?? "-"} · ${rm("total_cents")} · ${e.age_days} days old · ${e.last_contact ? `last contact ${dmyMYT(String(e.last_contact))}` : "no contact recorded"} · no follow-up scheduled`,
        `${e.doc_number} · ${e.company ?? "-"} · ${rm("total_cents")} · ${e.age_days} hari · ${e.last_contact ? `hubungan terakhir ${dmyMYT(String(e.last_contact))}` : "tiada hubungan direkod"} · tiada susulan dijadualkan`);
    case "invoice_unpaid":
      return L(`${e.doc_number} · ${e.company ?? "-"} · ${rm("total_cents")} · ${e.fallback ? `issued ${dmy(String(e.issued_on))}, no due date` : `due ${dmy(String(e.due_date))}`} · ${e.days_late} days late`,
        `${e.doc_number} · ${e.company ?? "-"} · ${rm("total_cents")} · ${e.fallback ? `dikeluarkan ${dmy(String(e.issued_on))}, tiada tarikh akhir` : `tamat ${dmy(String(e.due_date))}`} · lewat ${e.days_late} hari`);
    case "low_pipeline":
      return L(`${e.company ? "Company" : c.owner.name ?? ""}: open quotations ${rm("pipeline_cents")} vs gap ${rm("gap_cents")} = ${e.ratio}× (needs ${e.multiple}×)`,
        `${e.company ? "Syarikat" : c.owner.name ?? ""}: sebut harga terbuka ${rm("pipeline_cents")} vs baki ${rm("gap_cents")} = ${e.ratio}× (perlu ${e.multiple}×)`);
    case "no_activity":
      return L(`${c.owner.name ?? ""}: 0 follow-ups done, 0 quotations, 0 linked tasks done since ${dmy(String(e.since))}`, `${c.owner.name ?? ""}: 0 susulan, 0 sebut harga, 0 tugasan berpaut siap sejak ${dmy(String(e.since))}`);
    case "delivery_bottleneck":
      return L(`${c.owner.name ?? ""}: ${e.overdue_tasks} overdue task(s) on a project or quotation, the oldest due ${dmy(String(e.oldest_deadline))}`, `${c.owner.name ?? ""}: ${e.overdue_tasks} tugasan lewat pada projek atau sebut harga, paling lama ${dmy(String(e.oldest_deadline))}`);
    default: return "";
  }
}

/* ---------------- the command strip ---------------- */
const CONF: Record<string, [string, string]> = { not_enough_data: ["Not enough data", "Data tidak mencukupi"], high: ["High", "Tinggi"], medium: ["Medium", "Sederhana"], low: ["Low", "Rendah"] };
const RISKL: Record<string, [string, string, string]> = { high: ["High", "Tinggi", chipSmDanger], medium: ["Medium", "Sederhana", chipSmWarn], low: ["Low", "Rendah", chipSmSuccess], none: ["Target reached", "Sasaran dicapai", chipSmSuccess] };
const REASON: Record<string, [string, string]> = {
  pipeline_low: ["open quotations below the cover needed", "sebut harga terbuka di bawah perlindungan diperlukan"], no_followups: ["no follow-ups scheduled for the rest of the week", "tiada susulan dijadualkan untuk baki minggu"],
  ageing_quotations: ["quotations going cold", "sebut harga semakin sejuk"], gap_above_best_week: ["the gap is above the best week on record", "baki melebihi minggu terbaik"],
  no_target: ["no company target this week", "tiada sasaran syarikat minggu ini"], reached: ["the target is reached", "sasaran dicapai"],
};
export function CommandStrip({ o, gap }: { o: Outlook; gap: number | null }) {
  const c = o.confidence;
  const tiles: { k: string; label: string; value: string; note: string; tone?: string }[] = [
    { k: "inv", label: L("Invoiced", "Diinvois"), value: fmtRM(o.invoiced.cents), note: L(`${o.invoiced.n} invoice(s) raised this week - not yet collected`, `${o.invoiced.n} invois minggu ini - belum dikutip`) },
    { k: "open", label: L("Open quotations", "Sebut harga terbuka"), value: fmtRM(o.open_quotations.cents), note: L(`${o.open_quotations.n} open${o.ageing_quotations ? ` · ${o.ageing_quotations} going cold` : ""}`, `${o.open_quotations.n} terbuka${o.ageing_quotations ? ` · ${o.ageing_quotations} semakin sejuk` : ""}`) },
    { k: "pace", label: L("Required pace", "Rentak diperlukan"), value: o.required_per_day_cents === null ? "—" : fmtRM(o.required_per_day_cents),
      note: o.required_per_day_cents === null ? (gap === null ? L("No company target", "Tiada sasaran syarikat") : (gap ?? 0) <= 0 ? L("Target reached", "Sasaran dicapai") : L("No working days left", "Tiada hari bekerja lagi"))
        : L(`collected per working day · ${o.days_left} day(s) left`, `dikutip setiap hari bekerja · ${o.days_left} hari lagi`) },
    { k: "best", label: L("Best week", "Minggu terbaik"), value: o.best_week ? fmtRM(o.best_week.cents) : "—", note: o.best_week ? L(`week of ${dmy(o.best_week.from)}`, `minggu ${dmy(o.best_week.from)}`) : L("No finished week yet", "Belum ada minggu selesai") },
    { k: "conf", label: L("Forecast confidence", "Keyakinan ramalan"), value: L(CONF[c.level]?.[0] ?? c.level, CONF[c.level]?.[1] ?? c.level),
      note: c.level === "not_enough_data" ? L(`${c.target_weeks} of ${c.needs.target_weeks} weeks with a target · ${c.decided_quotations} of ${c.needs.decided_quotations} decided quotations`, `${c.target_weeks} daripada ${c.needs.target_weeks} minggu bersasaran · ${c.decided_quotations} daripada ${c.needs.decided_quotations} sebut harga diputuskan`)
        : L(`target reached in ${c.achieved_weeks} of ${c.target_weeks} weeks`, `sasaran dicapai ${c.achieved_weeks} daripada ${c.target_weeks} minggu`) },
  ];
  const r = o.risk;
  return (
    <div className={css.strip} aria-label={L("This week at a glance", "Minggu ini sepintas lalu")}>
      <ul className={css.tiles}>
        {tiles.map((t) => <li key={t.k}><span className={css.tLabel}>{t.label}</span><strong className={css.tValue}>{t.value}</strong><span className={css.tNote}>{t.note}</span></li>)}
        <li><span className={css.tLabel}>{L("Sales recovery risk", "Risiko pemulihan jualan")}</span>
          <strong className={css.tValue}>{r.level && RISKL[r.level] ? <span className={RISKL[r.level]![2]}>{L(RISKL[r.level]![0], RISKL[r.level]![1])}</span> : "—"}</strong>
          <span className={css.tNote}>{r.ratio !== null ? L(`open quotations cover ${r.ratio}× the gap · `, `sebut harga terbuka meliputi ${r.ratio}× baki · `) : ""}{r.reasons.map((x) => L(REASON[x]?.[0] ?? x, REASON[x]?.[1] ?? x)).join("; ")}</span></li>
      </ul>
      <p className={css.fine}>{L("The CEO's target is never changed by the system. The pace is the remaining gap over the working days left; confidence needs 8 weeks with a target and 20 decided quotations before it says anything; nothing here is a sales prediction.", "Sasaran CEO tidak pernah diubah oleh sistem. Rentak ialah baki dibahagi hari bekerja yang tinggal; keyakinan perlukan 8 minggu bersasaran dan 20 sebut harga diputuskan; tiada ramalan jualan di sini.")}</p>
    </div>
  );
}

/* ---------------- Sales advice ---------------- */
export function AdviceList({ cards, total, inactive, onDone, onNavigate }: {
  cards: AdviceCard[]; total: number; inactive?: { rule: string; needs: string }[]; onDone: () => void; onNavigate: (action: "allocate" | "plan" | "tasks") => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  const act = async (c: AdviceCard) => {
    if (c.action === "allocate" || c.action === "plan" || c.action === "tasks") { onNavigate(c.action); return; }
    setBusy(c.key); setProblem(null);
    const r = await api<{ kind: string; id: number; existing: boolean }>(`/sales/week/advisory/act`, { method: "POST", body: JSON.stringify({ key: c.key }) });
    setBusy(null);
    if (!r.ok || !r.data) { setProblem({ key: c.key, text: message(r) }); return; }
    toast(r.data.existing ? L("Already in hand", "Sudah dalam tindakan") : r.data.kind === "task" ? L("Task created", "Tugasan dicipta") : L("Follow-up scheduled", "Susulan dijadualkan"),
      r.data.existing ? L(`The open ${r.data.kind === "task" ? "task" : "follow-up"} #${r.data.id} is kept - no duplicate made`, `${r.data.kind === "task" ? "Tugasan" : "Susulan"} terbuka #${r.data.id} dikekalkan - tiada pendua`)
        : r.data.kind === "task" ? L("It is in Tasks for the owner", "Ia dalam Tugasan untuk pemilik") : L("For the closer, due the next working day. Record what the customer says when it is done.", "Untuk penutup, pada hari bekerja berikutnya. Rekod jawapan pelanggan apabila selesai."));
    onDone();
  };
  return (
    <div className={css.block}>
      {toastNode}
      <p className={css.label}>{L(`Sales advice${total > cards.length ? ` · ${cards.length} of ${total}` : ""}`, `Nasihat jualan${total > cards.length ? ` · ${cards.length} daripada ${total}` : ""}`)}</p>
      {cards.length === 0 ? <p className={css.muted}>{L("Nothing needs attention from the records right now.", "Tiada yang perlu perhatian daripada rekod buat masa ini.")}</p> : (
        <ul className={css.cards}>
          {cards.map((c) => (
            <li key={c.key} className={css.advice} data-severity={c.severity}>
              <span className={css.adviceTop}><span className={SEV[c.severity]}>{L(SEV_WORD[c.severity][0], SEV_WORD[c.severity][1])}</span><strong>{L(RULE[c.rule]?.[0] ?? c.rule, RULE[c.rule]?.[1] ?? c.rule)}</strong></span>
              <span className={css.evidence}>{evidenceLine(c)}</span>
              <span className={css.meta}>
                <span>{L("Risk", "Risiko")}: {L(RISK[c.risk]?.[0] ?? c.risk, RISK[c.risk]?.[1] ?? c.risk)}</span>
                <span>{L("Owner", "Pemilik")}: {c.owner.name ?? (c.record.kind === "company" ? L("Management", "Pengurusan") : L("No closer", "Tiada penutup"))}</span>
                {c.due_on && <span>{L("Due", "Tarikh")}: {dmy(c.due_on)}</span>}
              </span>
              <span className={css.adviceAct}>
                <button type="button" className={c.severity === "critical" ? btnSmPrimary : btnSm} disabled={busy !== null} onClick={() => void act(c)}><AppIcon name={ACTION[c.action][2]} />{busy === c.key ? L("Working…", "Sedang…") : L(ACTION[c.action][0], ACTION[c.action][1])}</button>
                {problem?.key === c.key && <span role="alert" className={css.error}>{problem.text}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {inactive && inactive.length > 0 && <p className={css.fine}>{L(`Not active yet (no data): ${inactive.map((x) => (x.rule === "low_conversion" ? `low conversion - needs ${x.needs}` : `margin risk - needs ${x.needs}`)).join("; ")}.`, `Belum aktif (tiada data): ${inactive.map((x) => (x.rule === "low_conversion" ? "penukaran rendah" : "risiko margin")).join("; ")}.`)}</p>}
    </div>
  );
}

/* ---------------- what the customer said ---------------- */
export function OutcomeSheet({ followupId, docType, docNumber, company, onClose, onDone }: {
  followupId: number; docType: "QT" | "INV"; docNumber: string; company: string | null; onClose: () => void; onDone: (next: string | null) => void;
}) {
  const codes = docType === "INV" ? ["promised", "paid", "disputed", "no_response"] : ["interested", "negotiating", "waiting", "accepted", "lost", "no_response"];
  const [outcome, setOutcome] = useState("");
  const [obstacle, setObstacle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const needsWhy = outcome === "lost" || outcome === "disputed";
  const save = async () => {
    setBusy(true); setProblem("");
    const r = await api<{ next: string | null }>(`/followups/${followupId}/done`, { method: "POST", body: JSON.stringify({ outcome, obstacle: obstacle.trim() || undefined, note: note.trim() || undefined }) });
    setBusy(false);
    if (!r.ok) { setProblem(message(r)); return; }
    onDone(r.data?.next ?? null);
  };
  return (
    <SideDrawer open onClose={onClose} title={L("What did the customer say?", "Apa kata pelanggan?")} subtitle={`${docNumber} · ${company ?? "-"}`}
      footer={<button type="button" className={btnClass} disabled={busy || !outcome || (needsWhy && obstacle.trim().length < 3)} onClick={() => void save()}><AppIcon name="save" />{busy ? L("Saving…", "Menyimpan…") : L("Record and close the follow-up", "Rekod dan tutup susulan")}</button>}>
      <fieldset className={css.form} disabled={busy}>
        <p className={css.muted}>{L("Record what you heard from the customer, by your usual channel. Nothing is sent to them and the document does not change: Sales still decides whether to revise, invoice or void it.", "Rekod apa yang anda dengar daripada pelanggan. Tiada apa dihantar kepada mereka dan dokumen tidak berubah.")}</p>
        <div className={css.choices} role="radiogroup" aria-label={L("Outcome", "Hasil")}>
          {codes.map((c) => (
            <label key={c} className={css.choice}><input type="radio" name="outcome" value={c} checked={outcome === c} onChange={() => setOutcome(c)} />{L(OUTCOME[c]![0], OUTCOME[c]![1])}</label>
          ))}
        </div>
        <label>{needsWhy ? (outcome === "lost" ? L("Why it was lost (required)", "Sebab tidak berjaya (wajib)") : L("What they dispute (required)", "Apa yang dipertikaikan (wajib)")) : L("Obstacle, if any", "Halangan, jika ada")}
          <input className={inputClassSm} maxLength={300} value={obstacle} placeholder={L("e.g. budget moved to next month", "cth. bajet ke bulan depan")} onChange={(e) => setObstacle(e.target.value)} /></label>
        <label>{L("Note (optional)", "Nota (pilihan)")}<textarea className={textareaClass} rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {outcome === "accepted" && <p className={css.muted}><AppIcon name="info" />{L("Next you record who accepted and how - the same acceptance record a project needs.", "Seterusnya rekod siapa menerima dan bagaimana - rekod penerimaan yang diperlukan projek.")}</p>}
        {problem && <p role="alert" className={css.error}>{problem}</p>}
      </fieldset>
    </SideDrawer>
  );
}

function FollowupSheet({ o, onClose, onDone }: { o: Opportunity; onClose: () => void; onDone: (existing: boolean) => void }) {
  const [due, setDue] = useState(nextWeekday(mytToday()));
  const [note, setNote] = useState(L(`Confirm the status of ${o.doc_number} with the customer`, `Sahkan status ${o.doc_number} dengan pelanggan`));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const save = async () => {
    setBusy(true); setProblem("");
    const r = await api<{ existing?: boolean }>(`/customers/${o.customer_id}/followups`, { method: "POST", body: JSON.stringify({ due_on: due, note, doc_id: o.id, owner_id: o.owner.id ?? undefined }) });
    setBusy(false);
    if (!r.ok) { setProblem(message(r)); return; }
    onDone(Boolean(r.data?.existing));
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Schedule a follow-up", "Jadualkan susulan")} subtitle={`${o.doc_number} · ${o.company ?? "-"}`}
      footer={<button type="button" className={btnClass} disabled={busy || !due || note.trim().length < 3} onClick={() => void save()}><AppIcon name="calendarAdd" />{busy ? L("Saving…", "Menyimpan…") : L("Schedule", "Jadualkan")}</button>}>
      <fieldset className={css.form} disabled={busy}>
        <label>{L("Follow up on", "Susulan pada")}<input type="date" className={inputClassSm} min={mytToday()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label>{L("About", "Tentang")}<input className={inputClassSm} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <p className={css.muted}>{L(`For ${o.owner.name ?? "the closer"}. One open follow-up per quotation: if one is open already, it is kept.`, `Untuk ${o.owner.name ?? "penutup"}. Satu susulan terbuka bagi setiap sebut harga.`)}</p>
        {problem && <p role="alert" className={css.error}>{problem}</p>}
      </fieldset>
    </SideDrawer>
  );
}

/* ---------------- the open quotations ---------------- */
export function Opportunities({ rows, canAct, onChanged, title }: { rows: Opportunity[]; canAct: boolean; onChanged: () => void; title?: string }) {
  const [outcome, setOutcome] = useState<Opportunity | null>(null);
  const [schedule, setSchedule] = useState<Opportunity | null>(null);
  const [accept, setAccept] = useState<Opportunity | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  return (
    <div className={css.block}>
      {toastNode}
      <p className={css.label}>{title ?? L("Open quotations", "Sebut harga terbuka")}</p>
      {rows.length === 0 ? <p className={css.muted}>{L("No open quotations.", "Tiada sebut harga terbuka.")}</p> : (
        <ul className={css.opps}>
          {rows.map((o) => (
            <li key={o.id} className={css.opp}>
              <span className={css.oppTop}><strong>{o.doc_number}</strong><span className={css.oppCo}>{o.company ?? "-"}</span><strong className={css.amt}>{fmtRM(o.total_cents)}</strong></span>
              <span className={css.meta}>
                <span>{o.owner.name ?? L("No closer", "Tiada penutup")}</span>
                <span>{L(`${o.age_days} days old`, `${o.age_days} hari`)}</span>
                <span>{o.last_contact?.at ? L(`last contact ${dmyMYT(o.last_contact.at)}${o.last_contact.by ? ` by ${o.last_contact.by}` : ""}`, `hubungan terakhir ${dmyMYT(o.last_contact.at)}`) : L("no contact recorded", "tiada hubungan direkod")}</span>
                <span>{o.next ? L(`follow-up ${dmy(o.next.due_on)}`, `susulan ${dmy(o.next.due_on)}`) : L("no follow-up scheduled", "tiada susulan")}</span>
                {o.acceptance && <span className={o.acceptance.current ? chipSmSuccess : chipSmNeutral}>{o.acceptance.current ? L(`Accepted by ${o.acceptance.name}`, `Diterima oleh ${o.acceptance.name}`) : L(`An earlier revision was accepted`, `Semakan lebih awal diterima`)}</span>}
                {outcomeChip(o.last_contact?.outcome)}
                {o.last_contact?.obstacle && <span>{L("Obstacle", "Halangan")}: {o.last_contact.obstacle}</span>}
              </span>
              {canAct && (
                <span className={css.adviceAct}>
                  {o.next?.linked && o.next ? <button type="button" className={btnSmPrimary} onClick={() => setOutcome(o)}><AppIcon name="edit" />{L("Record what they said", "Rekod jawapan mereka")}</button>
                    : !o.next && <button type="button" className={btnSm} onClick={() => setSchedule(o)}><AppIcon name="calendarAdd" />{L("Ask for status", "Tanya status")}</button>}
                  {!o.acceptance?.current && <button type="button" className={btnSm} onClick={() => setAccept(o)}><AppIcon name="verify" />{L("Record acceptance", "Rekod penerimaan")}</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {outcome?.next && <OutcomeSheet followupId={outcome.next.id} docType="QT" docNumber={outcome.doc_number} company={outcome.company} onClose={() => setOutcome(null)}
        onDone={(next) => { const o = outcome; setOutcome(null); toast(L("Recorded", "Direkod"), L("The follow-up is closed with what the customer said", "Susulan ditutup dengan jawapan pelanggan")); if (next === "record_acceptance") setAccept(o); onChanged(); }} />}
      {schedule && <FollowupSheet o={schedule} onClose={() => setSchedule(null)} onDone={(existing) => { setSchedule(null); toast(existing ? L("Already scheduled", "Sudah dijadualkan") : L("Follow-up scheduled", "Susulan dijadualkan"), existing ? L("The open follow-up is kept - no duplicate made", "Susulan terbuka dikekalkan - tiada pendua") : L("It is on the closer's Desk", "Ia di Meja penutup")); onChanged(); }} />}
      {accept && <AcceptanceSheet quotationId={accept.id} docNumber={accept.doc_number} company={accept.company ?? "-"} onClose={() => setAccept(null)} onDone={(t, x) => { setAccept(null); toast(t, x); onChanged(); }} />}
    </div>
  );
}

/* ---------------- the week's rhythm and Cash Watch ---------------- */
export function WeeklyRhythm({ checkpoint }: { checkpoint: string }) {
  const steps: [string, string, string, string, string][] = [
    ["planning", "Mon", "Isn", "Allocate - targets and goals for the week", "Agih - sasaran dan matlamat minggu ini"],
    ["early_warning", "Wed", "Rab", "Check-in - plans and blockers", "Semak - pelan dan halangan"],
    ["review", "Fri", "Jum", "Review - the week's results and outcomes", "Semakan - keputusan dan hasil minggu ini"],
  ];
  return (
    <ol className={css.rhythm} aria-label={L("The weekly rhythm", "Rentak mingguan")}>
      {steps.map(([k, d, dm, en, ms]) => <li key={k} aria-current={checkpoint === k ? "step" : undefined}><strong>{L(d, dm)}</strong><span>{L(en, ms)}</span></li>)}
    </ol>
  );
}
export function CashWatchPlaceholder() {
  return (
    <div className={css.cash}>
      <AppIcon name="lock" />
      <span><strong>{L("Cash Watch", "Pantauan Tunai")}</strong> · {L("Not available until a bank account per company and verified opening balances are entered. A2Z Creative Marketing and AZ ONE OFFICIAL are never added together.", "Belum tersedia sehingga akaun bank setiap syarikat dan baki pembukaan disahkan dimasukkan. A2Z Creative Marketing dan AZ ONE OFFICIAL tidak dicampur.")}</span>
    </div>
  );
}

/* ---------------- the week's allocation (CEO, COO, super admin edit) ---------------- */
interface AllocResp {
  week: { from: string; to: string; today: string; start_dow: number }; can_set: boolean;
  company: { target_cents: number | null; from: string | null; set_by: string | null };
  people: { id: number; name: string; role: string; kind: string; suggested: string; holds_unallocated: boolean; deals_90d: number; open_quotations: { n: number; cents: number }; target_cents: number | null; target_from: string | null; target_set_by: string | null; goals: Record<string, number | null> }[];
  revenue_sum_cents: number; unallocated_cents: number | null; over_allocated: boolean;
}
type CopyChange = { scope: string; user_id: number | null; name: string; metric: string; from_value: number | null; to_value: number | null };
export function AllocationDrawer({ week, onClose, onSaved, onGoals }: { week: string; onClose: () => void; onSaved: () => void; onGoals?: (userId: number) => void }) {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState<{ d: AllocResp | null; e: string } | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [copy, setCopy] = useState<{ changes: CopyChange[]; source_week: string } | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<AllocResp>(`/sales/week/allocation?week=${week}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      setGot({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) });
      if (r.ok && r.data) setAmounts(Object.fromEntries(r.data.people.map((p) => [p.id, p.target_cents === null ? "" : (p.target_cents / 100).toFixed(2)])));
    });
    return () => c.abort();
  }, [week, tick]);
  const d = got?.d;
  const cents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s) * 100));
  const changed = d ? d.people.filter((p) => { const v = cents(amounts[p.id] ?? ""); return (v === null ? null : v) !== p.target_cents && (v === null || (Number.isFinite(v) && v >= 0)); }) : [];
  const draftSum = d ? d.people.reduce((n, p) => n + (cents(amounts[p.id] ?? "") ?? 0), 0) : 0;
  const unalloc = d?.company.target_cents == null ? null : d.company.target_cents - draftSum;
  const save = async () => {
    if (!d) return;
    setBusy(true); setProblem("");
    for (const p of changed) {
      const r = await api(`/sales/week/targets`, { method: "POST", body: JSON.stringify({ scope: "person", user_id: p.id, week_from: d.week.from, target_cents: cents(amounts[p.id] ?? ""), reason }) });
      if (!r.ok) { setBusy(false); setProblem(`${p.name}: ${message(r)}`); setTick((t) => t + 1); return; }
    }
    setBusy(false); setReason("");
    toast(L("Allocation saved", "Agihan disimpan"), L(`${changed.length} target(s) from the week of ${dmy(d.week.from)}; earlier weeks keep theirs`, `${changed.length} sasaran mulai minggu ${dmy(d.week.from)}`));
    setTick((t) => t + 1); onSaved();
  };
  const previewCopy = async () => {
    if (!d) return;
    setBusy(true); setProblem("");
    const r = await api<{ changes: CopyChange[]; source_week: string }>(`/sales/week/targets/copy`, { method: "POST", body: JSON.stringify({ week_from: d.week.from, dry_run: true }) });
    setBusy(false);
    if (!r.ok || !r.data) { setProblem(message(r)); return; }
    setCopy(r.data);
  };
  const doCopy = async () => {
    if (!d) return;
    setBusy(true); setProblem("");
    const r = await api<{ written: number[] }>(`/sales/week/targets/copy`, { method: "POST", body: JSON.stringify({ week_from: d.week.from, reason }) });
    setBusy(false);
    if (!r.ok) { setProblem(message(r)); return; }
    setCopy(null); setReason("");
    toast(L("Last week copied", "Minggu lepas disalin"), L(`${r.data?.written.length ?? 0} row(s) written, each with your reason`, `${r.data?.written.length ?? 0} baris ditulis, setiap satu dengan sebab anda`));
    setTick((t) => t + 1); onSaved();
  };
  const valueWord = (c: CopyChange, v: number | null) => (v === null ? L("none", "tiada") : c.metric === "revenue" ? fmtRM(v) : String(v));
  return (
    <SideDrawer open onClose={onClose} wide title={L("Week allocation", "Agihan minggu")} subtitle={d ? `${dmy(d.week.from)} – ${dmy(d.week.to)}` : undefined}>
      {toastNode}
      {got?.e ? <p role="alert" className={css.error}>{got.e}</p> : !d ? <SkelRows rows={8} /> : (
        <div className={css.drawer}>
          <div className={css.recon} data-over={d.over_allocated || (unalloc !== null && unalloc < 0) ? "1" : undefined}>
            <p className={css.reconLine}>
              {d.company.target_cents === null ? L("No company target this week - set it under Manage first.", "Tiada sasaran syarikat minggu ini.")
                : L(`Company target ${fmtRM(d.company.target_cents)} = revenue targets ${fmtRM(draftSum)} + Unallocated (management) ${fmtRM(unalloc ?? 0)}`,
                  `Sasaran syarikat ${fmtRM(d.company.target_cents)} = sasaran hasil ${fmtRM(draftSum)} + Belum diagih (pengurusan) ${fmtRM(unalloc ?? 0)}`)}
            </p>
            {unalloc !== null && unalloc < 0 && <p className={css.warn}><AppIcon name="warning" />{L(`Over-allocated by ${fmtRM(-unalloc)}: the people's targets add up to more than the company's. This is allowed, but check it is intended.`, `Terlebih agih ${fmtRM(-unalloc)}: sasaran individu melebihi syarikat. Dibenarkan, tetapi pastikan ia disengajakan.`)}</p>}
            <p className={css.fine}>{L("Each invoice counts once, for its verified closer. Contribution goals are never added to the RM. Nothing is split equally or pre-filled.", "Setiap invois dikira sekali, untuk penutupnya. Matlamat sumbangan tidak ditambah ke RM. Tiada pembahagian sama rata.")}</p>
          </div>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead><tr><th>{L("Person", "Individu")}</th><th>{L("Holds", "Memegang")}</th><th className={css.num}>{L("Open quotations", "Sebut harga terbuka")}</th><th className={css.num}>{L("Revenue target (RM)", "Sasaran hasil (RM)")}</th><th>{L("Goals", "Matlamat")}</th></tr></thead>
              <tbody>
                {d.people.map((p) => {
                  const goals = Object.entries(p.goals).filter(([, n]) => n !== null && Number(n) > 0);
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong><span className={css.why}>{p.holds_unallocated && p.target_cents === null ? L("Holds the unallocated line", "Memegang baki belum diagih") : L(KIND[p.kind]?.[2] ?? "", KIND[p.kind]?.[3] ?? "")}</span></td>
                      <td>{kindChip(p.kind)}{p.kind !== p.suggested && !p.holds_unallocated && <span className={css.why}>{L(`Records suggest: ${KIND[p.suggested]?.[0] ?? p.suggested}${p.deals_90d ? ` (${p.deals_90d} deal(s) in 90 days)` : ""}`, `Rekod mencadangkan: ${KIND[p.suggested]?.[1] ?? p.suggested}`)}</span>}</td>
                      <td className={css.num}>{p.open_quotations.n ? `${fmtRM(p.open_quotations.cents)} · ${p.open_quotations.n}` : "—"}</td>
                      <td className={css.num}>{d.can_set ? <input aria-label={L(`Revenue target for ${p.name}`, `Sasaran hasil untuk ${p.name}`)} className={`${inputClassSm} ${css.amount}`} type="number" min="0" step="0.01" placeholder={L("none", "tiada")} value={amounts[p.id] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))} /> : p.target_cents === null ? "—" : fmtRM(p.target_cents)}</td>
                      <td>{goals.length ? goals.map(([m, n]) => `${GOAL_LABEL[m] ? L(GOAL_LABEL[m]![0], GOAL_LABEL[m]![1]) : m} ${n}`).join(" · ") : "—"}{d.can_set && onGoals && <button type="button" className={css.link} onClick={() => onGoals(p.id)}>{L("Set goals", "Tetapkan matlamat")}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.can_set && (
            <fieldset className={css.form} disabled={busy}>
              <label>{L("Reason (kept with every row written)", "Sebab (disimpan dengan setiap baris)")}<textarea className={textareaClass} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <div className={css.row}>
                <button type="button" className={btnClass} disabled={changed.length === 0 || reason.trim().length < 8} onClick={() => void save()}><AppIcon name="save" />{L(`Save ${changed.length || ""} changed target(s)`, `Simpan ${changed.length || ""} sasaran berubah`)}</button>
                <button type="button" className={btnSm} onClick={() => void previewCopy()}><AppIcon name="refresh" />{L("Copy last week", "Salin minggu lepas")}</button>
              </div>
              {copy && (
                <div className={css.copy}>
                  {copy.changes.length === 0 ? <p className={css.muted}>{L(`Nothing to copy: this week already carries the week of ${dmy(copy.source_week)} (a target stays in force until it is changed).`, `Tiada untuk disalin: minggu ini sudah membawa minggu ${dmy(copy.source_week)}.`)}</p> : (
                    <>
                      <p className={css.muted}>{L(`Copying the week of ${dmy(copy.source_week)} writes these rows for this week:`, `Menyalin minggu ${dmy(copy.source_week)} menulis baris ini untuk minggu ini:`)}</p>
                      <ul className={css.changes}>{copy.changes.map((c, i) => <li key={i}>{c.scope === "company" ? L("Company", "Syarikat") : c.name} · {c.metric === "revenue" ? L("revenue", "hasil") : GOAL_LABEL[c.metric] ? L(GOAL_LABEL[c.metric]![0], GOAL_LABEL[c.metric]![1]) : c.metric}: {valueWord(c, c.from_value)} → <strong>{valueWord(c, c.to_value)}</strong></li>)}</ul>
                      <button type="button" className={btnSmPrimary} disabled={reason.trim().length < 8} onClick={() => void doCopy()}>{L("Confirm copy", "Sahkan salinan")}</button>
                      {reason.trim().length < 8 && <span className={css.fine}>{L("Add a reason above first.", "Tambah sebab di atas dahulu.")}</span>}
                    </>
                  )}
                </div>
              )}
              {problem && <p role="alert" className={css.error}>{problem}</p>}
            </fieldset>
          )}
        </div>
      )}
    </SideDrawer>
  );
}

/* ---------------- advisory settings (CEO, COO, super admin) ---------------- */
interface Settings { pipeline_multiple: number; quote_age_days: number; very_old_days: number; invoice_fallback_days: number; package_days: Record<string, number>; updated_at?: string | null; updated_by?: string | null }
export function AdvisorySettingsDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [can, setCan] = useState(false);
  const [pkgs, setPkgs] = useState<{ id: number; name: string }[]>([]);
  const [f, setF] = useState<Record<string, string>>({});
  const [pd, setPd] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<{ settings: Settings; can_configure: boolean }>(`/sales/week/advisory`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted || !r.ok || !r.data) { if (!c.signal.aborted && !r.ok) setProblem(message(r)); return; }
      const x = r.data.settings;
      setS(x); setCan(r.data.can_configure);
      setF({ pipeline_multiple: String(x.pipeline_multiple), quote_age_days: String(x.quote_age_days), very_old_days: String(x.very_old_days), invoice_fallback_days: String(x.invoice_fallback_days) });
      setPd(Object.fromEntries(Object.entries(x.package_days).map(([k, v]) => [k, String(v)])));
    });
    void api<{ packages: { id: number; name: string; status: string }[] }>(`/packages`, { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setPkgs(r.data.packages.filter((p) => p.status === "active")); });
    return () => c.abort();
  }, []);
  const save = async () => {
    setBusy(true); setProblem("");
    const package_days = Object.fromEntries(Object.entries(pd).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]));
    const r = await api<{ settings: Settings }>(`/sales/week/advisory/settings`, { method: "PUT", body: JSON.stringify({ ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])), package_days, reason }) });
    setBusy(false);
    if (!r.ok || !r.data) { setProblem(message(r)); return; }
    setS(r.data.settings); setReason("");
    toast(L("Advisory settings saved", "Tetapan nasihat disimpan"), L("Recorded in the audit log with your reason", "Direkod dalam log audit dengan sebab anda"));
    onSaved();
  };
  const FIELDS: [keyof Settings, string, string, string][] = [
    ["pipeline_multiple", "Pipeline cover needed (× the gap)", "Perlindungan saluran (× baki)", "0.1"],
    ["quote_age_days", "A quotation goes cold after (days without contact)", "Sebut harga sejuk selepas (hari tanpa hubungan)", "1"],
    ["very_old_days", "A quotation is very old after (days)", "Sebut harga sangat lama selepas (hari)", "1"],
    ["invoice_fallback_days", "An invoice with no due date is late after (days)", "Invois tanpa tarikh akhir lewat selepas (hari)", "1"],
  ];
  return (
    <SideDrawer open onClose={onClose} title={L("Sales advice settings", "Tetapan nasihat jualan")} subtitle={s?.updated_at ? L(`Last changed ${dmyMYT(s.updated_at)}${s.updated_by ? ` by ${s.updated_by}` : ""}`, `Diubah ${dmyMYT(s.updated_at)}`) : L("The defaults are in use", "Tetapan asal digunakan")}>
      {toastNode}
      {!s ? (problem ? <p role="alert" className={css.error}>{problem}</p> : <SkelRows rows={5} />) : (
        <fieldset className={css.form} disabled={busy || !can}>
          {FIELDS.map(([k, en, ms, step]) => <label key={k}>{L(en, ms)}<input className={inputClassSm} type="number" step={step} value={f[k] ?? ""} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></label>)}
          {pkgs.length > 0 && (
            <div>
              <p className={css.label}>{L("Follow-up interval per package (optional, days)", "Selang susulan setiap pakej (pilihan, hari)")}</p>
              <ul className={css.changes}>{pkgs.map((p) => <li key={p.id} className={css.pkg}><span>{p.name}</span><input aria-label={L(`Days for ${p.name}`, `Hari untuk ${p.name}`)} className={`${inputClassSm} ${css.amount}`} type="number" min="1" max="90" placeholder={String(s.quote_age_days)} value={pd[String(p.id)] ?? ""} onChange={(e) => setPd((x) => ({ ...x, [String(p.id)]: e.target.value }))} /></li>)}</ul>
            </div>
          )}
          <label>{L("Reason", "Sebab")}<textarea className={textareaClass} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {can ? <button type="button" className={btnClass} disabled={reason.trim().length < 8} onClick={() => void save()}><AppIcon name="save" />{L("Save settings", "Simpan tetapan")}</button>
            : <p className={css.muted}>{L("Only the CEO, COO or super admin changes these.", "Hanya CEO, COO atau super admin mengubah ini.")}</p>}
          {problem && <p role="alert" className={css.error}>{problem}</p>}
        </fieldset>
      )}
    </SideDrawer>
  );
}

