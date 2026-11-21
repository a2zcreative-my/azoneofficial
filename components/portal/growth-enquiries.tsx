"use client";

/* v1.369.0 - THE BUSINESS GROWTH CHECK on Sales -> Customers & Follow-ups
   (the CEO, 18-11-2026, his picture of the Customers & Follow-ups workspace).
   The enquiries from /apply/business, beside the one that is selected, inside
   the EXISTING Customers & Follow-ups tab row - no new tab, no new module.

     New -> Assigned -> Contacted -> Problem Identified -> Free Advice Delivered
         -> Qualified | Follow-Up | Not Interested

   Who may do what is the SERVER's (worker/src/growth.ts): every button is drawn
   only when the enquiry's own `can` says so, and every route checks again.
   WhatsApp Usahawan opens WhatsApp's own click-to-chat link with the CEO's
   message prefilled - it is NOT a record that a message was sent, so the screen
   asks for the contact to be recorded afterwards. A paid solution goes through
   the normal Sales quotation (Create quotation prefills it); the acceptance,
   invoice and CEO verification shown here are READ from Sales. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { getLang } from "@/lib/i18n";
import { L } from "@/components/portal/page-shared";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, TaskToolbar, type TableCol } from "@/components/portal/task-table";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { LineTabs } from "@/components/ui/line-tabs";
import { MetricStrip, type StripCell } from "@/components/ui/metric-strip";
import { AppIcon } from "@/components/ui/app-icon";
import { btnSm, btnSmAccent, btnSmPrimary, btnSmQuiet, chipSmNeutral, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import {
  GROWTH_CHALLENGES, GROWTH_INDUSTRIES, GROWTH_INTERESTS, GROWTH_METHODS, GROWTH_PLATFORMS, GROWTH_SOURCES, GROWTH_STATES, GROWTH_STATUS, GROWTH_TIMES,
  growthWhatsAppLink, growthWhatsAppText, wordOf,
} from "@/lib/growth-words";
import css from "./agents-panel.module.css";
import pa from "./partner-applications.module.css";
import gx from "./growth-enquiries.module.css";
import { ConvertToLead } from "@/components/portal/crm-leads"; // v1.398.0 - a Growth Check entry becomes a lead after the duplicate check

export type GStatus = "new" | "assigned" | "contacted" | "problem_identified" | "advice_delivered" | "qualified" | "follow_up" | "not_interested";
export interface GRow {
  id: number; ref: string; full_name: string; whatsapp: string; email: string | null; business_name: string; industry: string; city: string; state: string; source: string;
  utm_campaign: string | null; challenges: string[]; interests: string[]; contact_method: string; contact_time: string; status: GStatus; owner_id: number | null; owner_name: string | null;
  picked_at: string | null; first_response_at: string | null; contact_attempts: number; next_follow_up_on: string | null; advice_at: string | null; quotation_id: number | null;
  resubmissions: number; version: number; created_at: string; closed_at: string | null; overdue: boolean; accepted: boolean; verified: boolean;
}
export interface GAnalytics {
  total: number; sources: Record<string, number>; challenges: Record<string, number>; responded: number; response_median_hours: number | null; response_avg_hours: number | null;
  assessments: number; qualified: number; quotations: number; accepted: number; verified: number; verified_cents: number;
}
export interface GList { enquiries: GRow[]; counts: Record<string, number>; analytics: GAnalytics; me: number; can_manage: boolean; pending_migration?: boolean }
interface GCan { pickup: boolean; release: boolean; assign: boolean; contact: boolean; note: boolean; problem: boolean; advice: boolean; outcome: boolean; quotation: boolean; whatsapp: boolean }
interface GDetail {
  enquiry: GRow & { industry_other: string | null; social_url: string | null; source_detail: string | null; utm_source: string | null; utm_medium: string | null; utm_term: string | null; utm_content: string | null;
    referrer: string | null; landing_path: string | null; challenge_other: string | null; urgent_problem: string; goal_90d: string; platforms: string[]; consent_contact: number; consent_privacy: number;
    consent_marketing: number; privacy_version: string; consent_at: string; lang: string | null; problem_summary: string | null; advice_summary: string | null; advice_by_name: string | null;
    outcome_reason: string | null; closed_by_name: string | null; last_submitted_at: string | null };
  events: { id: number; kind: string; body: string | null; channel: string | null; status_from: string | null; status_to: string | null; created_at: string; actor: string | null }[];
  quotation: { id: number; doc_number: string; total_cents: number; created_at: string; accepted: number | null; invoice_number: string | null; verified: number | null } | null;
  candidates: { id: number; doc_number: string; total_cents: number; created_at: string }[];
  people: { id: number; name: string }[];
  staff_name: string;
  can: GCan;
}

const lang = () => (getLang() === "ms" ? "ms" : "en");
const w = (m: Parameters<typeof wordOf>[0], k: string | null | undefined) => wordOf(m, k, lang());
export const gWord = (s: GStatus) => w(GROWTH_STATUS, s);
const TONE: Record<GStatus, string | undefined> = {
  new: css.wait, assigned: css.info, contacted: css.violet, problem_identified: css.violet, advice_delivered: css.gold, qualified: css.ok, follow_up: css.info, not_interested: css.off,
};
const GChip = ({ s }: { s: GStatus }) => <span className={`${css.chip} ${TONE[s] ?? ""}`} data-testid="growth-chip">{gWord(s)}</span>;
type View = "open" | "new" | "mine" | "due" | "qualified" | "closed";
const mytOf = (v: string | null | undefined) => { if (!v) return null; const t = Date.parse(`${v.replace(" ", "T")}Z`); return Number.isNaN(t) ? null : new Date(t + 8 * 3600_000).toISOString(); };
const day = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("-") : "");
const myt = (v: string | null | undefined) => { const d = mytOf(v); return d ? `${day(d)} ${d.slice(11, 16)}` : v ?? ""; };
const mytToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const rm = (cents: number) => `RM ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
const KIND: Record<string, [string, string]> = {
  submitted: ["Submitted", "Dihantar"], resubmitted: ["Submitted again", "Dihantar semula"], picked_up: ["Picked up", "Diambil"], released: ["Handed back", "Diserah semula"],
  assigned: ["Given to", "Diberi kepada"], contacted: ["Contact - reached", "Hubungan - berjaya"], attempt: ["Contact attempt", "Cubaan hubungan"], note: ["Note", "Nota"],
  follow_up: ["Follow-up date", "Tarikh susulan"], problem: ["Problem identified", "Masalah dikenal pasti"], advice: ["Free advice given", "Cadangan percuma diberi"],
  qualified: ["Qualified", "Layak"], not_interested: ["Not interested", "Tidak berminat"], quotation: ["Quotation linked", "Sebut harga dipautkan"],
};

/** The list through the shared cache - live when anyone changes an enquiry (the "business-growth" version) */
export function useGrowthList(enabled: boolean) {
  return useCachedApi<GList>(enabled ? "/staff/business-growth" : null, enabled, ["business-growth"]);
}

/* =====================================================================
   One enquiry: what it says, its history and the actions it allows
   ===================================================================== */
function useGrowthRecord(id: number | null, onChanged: (msg?: string) => void) {
  const [d, setD] = useState<GDetail | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [seen, setSeen] = useState(id);
  if (seen !== id) { setSeen(id); setD(null); setProblem(""); }
  useEffect(() => {
    if (id == null) return;
    const c = new AbortController();
    void api<GDetail & { error?: { message?: string } }>(`/staff/business-growth/${id}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data?.enquiry) { setD(r.data); setProblem(""); } else setProblem(r.data?.error?.message ?? L("The enquiry could not be opened.", "Pertanyaan tidak dapat dibuka."));
    });
    return () => c.abort();
  }, [id, tick]);
  const run = useCallback(async (action: string, body: Record<string, unknown>, done: string) => {
    if (!d || id == null) return false;
    setBusy(true); setProblem("");
    const r = await api<{ error?: { message?: string } }>(`/staff/business-growth/${id}/${action}`, { method: "POST", body: JSON.stringify({ version: d.enquiry.version, ...body }) });
    setBusy(false);
    setTick((t) => t + 1);
    if (!r.ok) {
      setProblem(r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya."));
      if (r.status === 409) onChanged();
      return false;
    }
    onChanged(done);
    return true;
  }, [d, id, onChanged]);
  return { d, problem, busy, run };
}

type Form = "" | "contact" | "note" | "problem" | "advice" | "outcome" | "assign" | "quotation";

function GrowthRecord({ id, onClose, onChanged, onQuote, testid, full = false, onOpenLead }: {
  id: number; onClose: () => void; onChanged: (msg?: string) => void; onQuote: (e: GRow) => void; testid: string; full?: boolean;
  /** v1.398.0 - for people who may make a customer (Sales) */
  onOpenLead?: (customerId: number) => void;
}) {
  const { d, problem, busy, run } = useGrowthRecord(id, onChanged);
  const [form, setForm] = useState<Form>("");
  const [waHint, setWaHint] = useState(false);
  const [contact, setContact] = useState({ channel: "whatsapp", reached: true, note: "", next_follow_up_on: "" });
  const [note, setNote] = useState({ note: "", next_follow_up_on: "" });
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState({ outcome: "qualified", reason: "", next_follow_up_on: "" });
  const [assign, setAssign] = useState({ owner_id: 0, reason: "" });
  const [qid, setQid] = useState(0);
  const { prompt, node: promptNode } = usePrompt();
  const [seen, setSeen] = useState(id);
  if (seen !== id) { setSeen(id); setForm(""); setWaHint(false); }
  const done = async (p: Promise<boolean>) => { if (await p) { setForm(""); setSummary(""); } };
  const open = (f: Form) => {
    setForm(form === f ? "" : f);
    if (f === "problem") setSummary(d?.enquiry.problem_summary ?? "");
    if (f === "advice") setSummary(d?.enquiry.advice_summary ?? "");
  };
  const release = async () => {
    const a = await prompt({ title: L("Hand the enquiry back", "Serahkan semula pertanyaan"), label: L("Why? Somebody else can then pick it up.", "Mengapa? Orang lain boleh mengambilnya."), required: true });
    if (!a || a.value.trim().length < 5) return;
    await run("release", { reason: a.value.trim() }, L("Handed back", "Diserah semula"));
  };
  const e = d?.enquiry;
  const can = d?.can;
  const wa = e && d ? growthWhatsAppLink(e.whatsapp, growthWhatsAppText(e.full_name, d.staff_name, e.business_name)) : "";
  const list = (m: Parameters<typeof wordOf>[0], keys: string[]) => (keys.length ? keys.map((k) => w(m, k)).join(", ") : "—");

  return (
    <div className={pa.preview} data-testid={testid}>
      {promptNode}
      {problem && <p className={css.warn} role="alert" data-testid="growth-problem">{problem}</p>}
      {!e || !can ? <SkelRows rows={6} /> : (<>
        <div className={pa.person}>
          <span className={pa.avatar} aria-hidden><AppIcon name="store" /></span>
          <div className={pa.personText}>
            <strong>{e.business_name}</strong>
            <span className={pa.metaLine}>{e.full_name} <span aria-hidden>|</span> {w(GROWTH_INDUSTRIES, e.industry)}{e.industry_other ? ` (${e.industry_other})` : ""}</span>
          </div>
          {!full && <button type="button" className={btnSmQuiet} aria-label={L("Close", "Tutup")} onClick={onClose} data-testid="growth-preview-close"><AppIcon name="close" /></button>}
        </div>
        <ul className={pa.contact}>
          <li><AppIcon name="chat" /><span>{e.whatsapp}</span></li>
          {e.email && <li><AppIcon name="document" /><a className={css.linkBtn} href={`mailto:${e.email}`}>{e.email}</a></li>}
          <li><AppIcon name="place" /><span>{e.city}, {w(GROWTH_STATES, e.state)}</span></li>
          <li><AppIcon name="person" /><span>{e.owner_name ? L(`Owner: ${e.owner_name}`, `Pemilik: ${e.owner_name}`) : L("Not picked up yet", "Belum diambil")}</span></li>
        </ul>

        <section aria-label={L("Actions", "Tindakan")} className={pa.quick} data-testid="growth-actions">
          <div className={css.row}>
            {can.pickup && <button type="button" className={btnSmAccent} disabled={busy} onClick={() => void run("pickup", {}, L("Picked up - it is yours", "Diambil - ia milik anda"))} data-testid="growth-pickup"><AppIcon name="person" />{L("Pick Up", "Ambil")}</button>}
            {can.whatsapp && <a className={btnSmPrimary} href={wa} target="_blank" rel="noopener noreferrer" data-testid="growth-whatsapp"
              onClick={() => { setWaHint(true); setContact((c) => ({ ...c, channel: "whatsapp" })); }}><AppIcon name="chat" />{L("WhatsApp Usahawan", "WhatsApp Usahawan")}</a>}
            {can.contact && <button type="button" className={btnSm} disabled={busy} onClick={() => open("contact")} data-testid="growth-contact"><AppIcon name="time" />{L("Record contact", "Rekod hubungan")}</button>}
            {can.note && <button type="button" className={btnSm} disabled={busy} onClick={() => open("note")} data-testid="growth-note"><AppIcon name="edit" />{L("Add Note", "Tambah Nota")}</button>}
            {can.problem && <button type="button" className={btnSm} disabled={busy} onClick={() => open("problem")} data-testid="growth-problem-btn"><AppIcon name="search" />{L("Problem identified", "Masalah dikenal pasti")}</button>}
            {can.advice && <button type="button" className={btnSm} disabled={busy} onClick={() => open("advice")} data-testid="growth-advice"><AppIcon name="success" />{L("Free advice given", "Cadangan percuma diberi")}</button>}
            {can.outcome && <button type="button" className={btnSm} disabled={busy} onClick={() => open("outcome")} data-testid="growth-outcome"><AppIcon name="target" />{L("Outcome", "Keputusan")}</button>}
            {can.quotation && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => onQuote(e)} data-testid="growth-quote"><AppIcon name="add" />{L("Create quotation", "Buat sebut harga")}</button>}
            {onOpenLead && <ConvertToLead source="growth" id={e.id} onOpenLead={onOpenLead} testid="growth-convert" />}
            {can.quotation && <button type="button" className={btnSm} disabled={busy} onClick={() => open("quotation")} data-testid="growth-link-quote"><AppIcon name="documents" />{L("Link quotation", "Pautkan sebut harga")}</button>}
            {can.assign && <button type="button" className={btnSmQuiet} disabled={busy} onClick={() => open("assign")} data-testid="growth-assign">{L("Give to…", "Beri kepada…")}</button>}
            {can.release && <button type="button" className={btnSmQuiet} disabled={busy} onClick={() => void release()} data-testid="growth-release">{L("Hand back", "Serah semula")}</button>}
          </div>
          {waHint && <p className={css.muted} role="status" data-testid="growth-wa-hint">{L("WhatsApp opened with the message ready. Opening it is not a record - after you press Send there, record the contact here.", "WhatsApp dibuka dengan mesej sedia. Membukanya bukan rekod - selepas anda tekan Hantar di sana, rekod hubungan di sini.")}</p>}
          {e.status === "new" && !can.pickup && <p className={css.muted}>{L("Waiting to be picked up.", "Menunggu untuk diambil.")}</p>}
        </section>

        {form === "contact" && can.contact && (
          <section className={css.block} aria-label={L("Record a contact", "Rekod hubungan")} data-testid="growth-contact-form">
            <h3 className={css.h3}>{L("Record the contact attempt", "Rekod cubaan hubungan")}</h3>
            <div className={css.row}>
              <select className={selectClassSm} value={contact.channel} onChange={(x) => setContact({ ...contact, channel: x.target.value })} aria-label={L("How", "Bagaimana")} data-testid="growth-contact-channel">
                <option value="whatsapp">WhatsApp</option><option value="call">{L("Call", "Panggilan")}</option><option value="email">{L("Email", "E-mel")}</option><option value="other">{L("Other", "Lain-lain")}</option>
              </select>
              <label className={css.inline}><input type="checkbox" checked={contact.reached} onChange={(x) => setContact({ ...contact, reached: x.target.checked })} data-testid="growth-contact-reached" />{L("Reached them", "Berjaya dihubungi")}</label>
              <label className={css.inline}>{L("Next follow-up", "Susulan seterusnya")}<input type="date" className={inputClassSm} min={mytToday()} value={contact.next_follow_up_on} onChange={(x) => setContact({ ...contact, next_follow_up_on: x.target.value })} /></label>
            </div>
            <textarea className={inputClass} rows={2} value={contact.note} onChange={(x) => setContact({ ...contact, note: x.target.value })} placeholder={L("What happened - e.g. sent the WhatsApp, they replied, call booked for Friday", "Apa yang berlaku - cth. WhatsApp dihantar, mereka membalas, panggilan ditempah Jumaat")} aria-label={L("What happened", "Apa yang berlaku")} data-testid="growth-contact-note" />
            <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || contact.note.trim().length < 3} onClick={() => void done(run("contact", { ...contact, next_follow_up_on: contact.next_follow_up_on || null }, L("Contact recorded", "Hubungan direkod")))} data-testid="growth-contact-save">{L("Save contact", "Simpan hubungan")}</button></div>
          </section>
        )}
        {form === "note" && can.note && (
          <section className={css.block} aria-label={L("Note", "Nota")} data-testid="growth-note-form">
            <h3 className={css.h3}>{L("Note and next follow-up", "Nota dan susulan seterusnya")}</h3>
            <textarea className={inputClass} rows={3} value={note.note} onChange={(x) => setNote({ ...note, note: x.target.value })} placeholder={L("What you learned - kept with the enquiry", "Apa yang anda pelajari - disimpan bersama pertanyaan")} aria-label={L("Note", "Nota")} data-testid="growth-note-text" />
            <div className={css.row}>
              <label className={css.inline}>{L("Next follow-up", "Susulan seterusnya")}<input type="date" className={inputClassSm} min={mytToday()} value={note.next_follow_up_on} onChange={(x) => setNote({ ...note, next_follow_up_on: x.target.value })} data-testid="growth-note-date" /></label>
              <button type="button" className={btnSmPrimary} disabled={busy || (note.note.trim().length < 3 && !note.next_follow_up_on)} onClick={() => void done(run("note", { note: note.note, ...(note.next_follow_up_on ? { next_follow_up_on: note.next_follow_up_on } : {}) }, L("Saved", "Disimpan")))} data-testid="growth-note-save">{L("Save", "Simpan")}</button>
            </div>
          </section>
        )}
        {(form === "problem" || form === "advice") && (form === "problem" ? can.problem : can.advice) && (
          <section className={css.block} aria-label={form === "problem" ? L("Problem identified", "Masalah dikenal pasti") : L("Free advice", "Cadangan percuma")} data-testid={`growth-${form}-form`}>
            <h3 className={css.h3}>{form === "problem" ? L("The problem you identified together", "Masalah yang dikenal pasti bersama") : L("The free first advice you gave", "Cadangan awal percuma yang diberi")}</h3>
            {form === "advice" && <p className={css.muted}>{L("Free advice only. A paid service is never required; it needs its own quotation and the customer's acceptance.", "Cadangan percuma sahaja. Perkhidmatan berbayar tidak diwajibkan; ia memerlukan sebut harga sendiri dan penerimaan pelanggan.")}</p>}
            <textarea className={inputClass} rows={4} value={summary} onChange={(x) => setSummary(x.target.value)} aria-label={L("Summary", "Ringkasan")} data-testid={`growth-${form}-text`} />
            <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || summary.trim().length < 10} onClick={() => void done(run(form, { summary }, form === "problem" ? L("Problem recorded", "Masalah direkod") : L("Free advice recorded", "Cadangan percuma direkod")))} data-testid={`growth-${form}-save`}>{L("Save", "Simpan")}</button></div>
          </section>
        )}
        {form === "outcome" && can.outcome && (
          <section className={css.block} aria-label={L("Outcome", "Keputusan")} data-testid="growth-outcome-form">
            <h3 className={css.h3}>{L("Outcome", "Keputusan")}</h3>
            <div className={css.row} role="radiogroup" aria-label={L("Outcome", "Keputusan")}>
              {(["qualified", "follow_up", "not_interested"] as const).map((o) => (
                <label key={o} className={css.inline}><input type="radio" name={`outcome-${id}`} checked={outcome.outcome === o} onChange={() => setOutcome({ ...outcome, outcome: o })} data-testid={`growth-outcome-${o}`} />{gWord(o)}</label>
              ))}
            </div>
            {outcome.outcome === "follow_up" && <label className={css.inline}>{L("Follow up on", "Susulan pada")}<input type="date" className={inputClassSm} min={mytToday()} value={outcome.next_follow_up_on} onChange={(x) => setOutcome({ ...outcome, next_follow_up_on: x.target.value })} data-testid="growth-outcome-date" /></label>}
            {outcome.outcome === "qualified" && <p className={css.muted}>{L("Qualified means interested in a paid solution. It is not a sale: the quotation, the customer's acceptance, the invoice and the CEO's payment verification follow in Sales.", "Layak bermaksud berminat dengan penyelesaian berbayar. Ia bukan jualan: sebut harga, penerimaan pelanggan, invois dan pengesahan bayaran oleh CEO menyusul dalam Jualan.")}</p>}
            <textarea className={inputClass} rows={2} value={outcome.reason} onChange={(x) => setOutcome({ ...outcome, reason: x.target.value })} placeholder={L("The reason - kept with the enquiry", "Sebabnya - disimpan bersama pertanyaan")} aria-label={L("Reason", "Sebab")} data-testid="growth-outcome-reason" />
            <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || outcome.reason.trim().length < 5 || (outcome.outcome === "follow_up" && !outcome.next_follow_up_on)} onClick={() => void done(run("outcome", { ...outcome, next_follow_up_on: outcome.next_follow_up_on || null }, L("Outcome recorded", "Keputusan direkod")))} data-testid="growth-outcome-save">{L("Save outcome", "Simpan keputusan")}</button></div>
          </section>
        )}
        {form === "assign" && can.assign && (
          <section className={css.block} aria-label={L("Give to", "Beri kepada")} data-testid="growth-assign-form">
            <h3 className={css.h3}>{L("Give the enquiry to", "Beri pertanyaan kepada")}</h3>
            <div className={css.row}>
              <select className={selectClassSm} value={assign.owner_id} onChange={(x) => setAssign({ ...assign, owner_id: Number(x.target.value) })} aria-label={L("Person", "Orang")} data-testid="growth-assign-to">
                <option value={0}>{L("Choose…", "Pilih…")}</option>
                {d!.people.filter((p) => p.id !== e.owner_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className={inputClassSm} value={assign.reason} onChange={(x) => setAssign({ ...assign, reason: x.target.value })} placeholder={L("Why", "Mengapa")} aria-label={L("Why", "Mengapa")} data-testid="growth-assign-reason" />
              <button type="button" className={btnSmPrimary} disabled={busy || !assign.owner_id || assign.reason.trim().length < 5} onClick={() => void done(run("assign", assign, L("Given", "Diberi")))} data-testid="growth-assign-save">{L("Give", "Beri")}</button>
            </div>
          </section>
        )}
        {form === "quotation" && can.quotation && (
          <section className={css.block} aria-label={L("Link a quotation", "Pautkan sebut harga")} data-testid="growth-quote-form">
            <h3 className={css.h3}>{L("Link the quotation made for this enquiry", "Pautkan sebut harga untuk pertanyaan ini")}</h3>
            {d!.candidates.length ? (
              <div className={css.row}>
                <select className={selectClassSm} value={qid} onChange={(x) => setQid(Number(x.target.value))} aria-label={L("Quotation", "Sebut harga")} data-testid="growth-quote-pick">
                  <option value={0}>{L("Choose…", "Pilih…")}</option>
                  {d!.candidates.map((q) => <option key={q.id} value={q.id}>{q.doc_number} · {rm(q.total_cents)}</option>)}
                </select>
                <button type="button" className={btnSmPrimary} disabled={busy || !qid} onClick={() => void done(run("quotation", { quotation_id: qid }, L("Quotation linked", "Sebut harga dipautkan")))} data-testid="growth-quote-save">{L("Link", "Pautkan")}</button>
              </div>
            ) : <p className={css.muted} data-testid="growth-quote-none">{L(`No quotation names ${e.ref} yet. Create the quotation first - its reference is ${e.ref}.`, `Belum ada sebut harga yang menamakan ${e.ref}. Buat sebut harga dahulu - rujukannya ${e.ref}.`)}</p>}
          </section>
        )}

        <dl className={css.dl} data-testid="growth-answers">
          <dt>{L("Status", "Status")}</dt><dd><GChip s={e.status} />{e.overdue ? <span className={css.dueLate}> {L("Overdue", "Lewat")}</span> : null}</dd>
          <dt>{L("Challenges", "Cabaran")}</dt><dd>{list(GROWTH_CHALLENGES, e.challenges)}{e.challenge_other ? ` (${e.challenge_other})` : ""}</dd>
          <dt>{L("Most urgent", "Paling mendesak")}</dt><dd className={gx.long}>{e.urgent_problem}</dd>
          <dt>{L("90-day goal", "Matlamat 90 hari")}</dt><dd className={gx.long}>{e.goal_90d}</dd>
          <dt>{L("Platforms", "Platform")}</dt><dd>{list(GROWTH_PLATFORMS, e.platforms)}</dd>
          <dt>{L("Interested in", "Berminat dengan")}</dt><dd>{list(GROWTH_INTERESTS, e.interests)}</dd>
          <dt>{L("Contact", "Hubungan")}</dt><dd>{w(GROWTH_METHODS, e.contact_method)} · {w(GROWTH_TIMES, e.contact_time)}</dd>
          <dt>{L("Contact attempts", "Cubaan hubungan")}</dt><dd data-testid="growth-attempts">{e.contact_attempts}{e.first_response_at ? L(` · first ${myt(e.first_response_at)}`, ` · pertama ${myt(e.first_response_at)}`) : ""}</dd>
          <dt>{L("Next follow-up", "Susulan seterusnya")}</dt><dd>{e.next_follow_up_on ? day(e.next_follow_up_on) : "—"}</dd>
          {e.problem_summary && <><dt>{L("Problem", "Masalah")}</dt><dd className={gx.long}>{e.problem_summary}</dd></>}
          {e.advice_summary && <><dt>{L("Free advice", "Cadangan percuma")}</dt><dd className={gx.long}>{e.advice_summary}{e.advice_by_name ? ` - ${e.advice_by_name}` : ""}</dd></>}
          {e.outcome_reason && <><dt>{L("Outcome reason", "Sebab keputusan")}</dt><dd className={gx.long}>{e.outcome_reason}</dd></>}
          <dt>{L("Source", "Sumber")}</dt><dd>{w(GROWTH_SOURCES, e.source)}{e.source_detail ? ` · ${e.source_detail}` : ""}</dd>
          <dt>{L("Campaign", "Kempen")}</dt><dd>{[e.utm_source, e.utm_medium, e.utm_campaign, e.utm_term, e.utm_content].filter(Boolean).join(" · ") || "—"}</dd>
          {e.social_url && <><dt>{L("Social / website", "Media sosial / laman web")}</dt><dd className={gx.long}>{e.social_url}</dd></>}
          <dt>{L("Consent", "Persetujuan")}</dt><dd data-testid="growth-consent">{L(`Contact: yes · Privacy Notice (${e.privacy_version}): yes · Marketing: ${e.consent_marketing ? "yes" : "no"} · ${myt(e.consent_at)}`, `Hubungan: ya · Notis Privasi (${e.privacy_version}): ya · Pemasaran: ${e.consent_marketing ? "ya" : "tidak"} · ${myt(e.consent_at)}`)}</dd>
          <dt>{L("Submitted", "Dihantar")}</dt><dd>{myt(e.created_at)}{e.resubmissions ? L(` · submitted again ${e.resubmissions}x`, ` · dihantar semula ${e.resubmissions}x`) : ""}</dd>
        </dl>

        {d!.quotation && (
          <section className={css.block} aria-label={L("Quotation", "Sebut harga")} data-testid="growth-quotation">
            <h3 className={css.h3}>{L("Paid solution - from Sales", "Penyelesaian berbayar - daripada Jualan")}</h3>
            <p>{d!.quotation.doc_number} · {rm(d!.quotation.total_cents)} · {d!.quotation.accepted ? L("accepted by the customer", "diterima pelanggan") : L("not accepted yet", "belum diterima")}
              {d!.quotation.invoice_number ? ` · ${d!.quotation.invoice_number}` : ""} · {d!.quotation.verified ? L("payment verified by the CEO", "bayaran disahkan CEO") : L("payment not verified", "bayaran belum disahkan")}</p>
          </section>
        )}

        <section className={css.block} aria-label={L("History", "Sejarah")} data-testid="growth-history">
          <h3 className={css.h3}>{L("History", "Sejarah")}</h3>
          <ol className={gx.history}>
            {d!.events.map((v) => (
              <li key={v.id}>
                <span className={gx.histHead}><strong>{L(KIND[v.kind]?.[0] ?? v.kind, KIND[v.kind]?.[1] ?? v.kind)}</strong>{v.channel ? ` · ${v.channel}` : ""} · {myt(v.created_at)}{v.actor ? ` · ${v.actor}` : ""}</span>
                {v.body && <span className={gx.long}>{v.body}</span>}
              </li>
            ))}
          </ol>
        </section>
      </>)}
    </div>
  );
}

/* =====================================================================
   The analytics the CEO asked for, from the records only
   ===================================================================== */
function GrowthAnalytics({ a }: { a: GAnalytics }) {
  const top = (o: Record<string, number>, m: Parameters<typeof wordOf>[0]) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => [w(m, k), n] as const);
  const hours = (h: number | null) => (h === null ? "—" : h < 1 ? L(`${Math.round(h * 60)} min`, `${Math.round(h * 60)} min`) : L(`${h} h`, `${h} j`));
  const bars = (rows: readonly (readonly [string, number])[], testid: string) => {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.length ? (
      <ul className={gx.bars} data-testid={testid}>
        {rows.map(([k, n]) => <li key={k}><span className={gx.barLabel}>{k}</span><span className={gx.barTrack}><span className={gx.barFill} style={{ inlineSize: `${(n / max) * 100}%` }} /></span><span className={gx.barN}>{n}</span></li>)}
      </ul>
    ) : <p className={css.muted}>{L("Nothing yet.", "Belum ada.")}</p>;
  };
  return (
    <div className={gx.analytics} data-testid="growth-analytics">
      <SplitPane title={L("Where they came from", "Dari mana mereka datang")} label={L("Sources", "Sumber")} testid="growth-an-sources">{bars(top(a.sources, GROWTH_SOURCES), "growth-sources")}</SplitPane>
      <SplitPane title={L("Most common challenges", "Cabaran paling biasa")} label={L("Challenges", "Cabaran")} testid="growth-an-challenges">{bars(top(a.challenges, GROWTH_CHALLENGES), "growth-challenges")}</SplitPane>
      <SplitPane title={L("From enquiry to verified sale", "Daripada pertanyaan ke jualan disahkan")} label={L("Conversion", "Penukaran")} testid="growth-an-funnel">
        <dl className={css.dl}>
          <dt>{L("Enquiries", "Pertanyaan")}</dt><dd data-testid="growth-an-total">{a.total}</dd>
          <dt>{L("First response (median)", "Respons pertama (median)")}</dt><dd data-testid="growth-an-median">{hours(a.response_median_hours)}{a.responded ? L(` · ${a.responded} contacted`, ` · ${a.responded} dihubungi`) : ""}</dd>
          <dt>{L("First response (average)", "Respons pertama (purata)")}</dt><dd>{hours(a.response_avg_hours)}</dd>
          <dt>{L("Free assessments completed", "Penilaian percuma selesai")}</dt><dd data-testid="growth-an-assess">{a.assessments}</dd>
          <dt>{L("Qualified leads", "Petunjuk layak")}</dt><dd data-testid="growth-an-qualified">{a.qualified}</dd>
          <dt>{L("Quotations linked", "Sebut harga dipautkan")}</dt><dd>{a.quotations}</dd>
          <dt>{L("Quotations accepted", "Sebut harga diterima")}</dt><dd data-testid="growth-an-accepted">{a.accepted}</dd>
          <dt>{L("CEO-verified sales", "Jualan disahkan CEO")}</dt><dd data-testid="growth-an-verified">{a.verified}{a.verified ? ` · ${rm(a.verified_cents)}` : ""}</dd>
        </dl>
        <p className={css.muted}>{L("Counted from the enquiries and the Sales records linked to them. A sale counts only after the CEO verified its payment.", "Dikira daripada pertanyaan dan rekod Jualan yang dipautkan. Jualan dikira hanya selepas CEO mengesahkan bayarannya.")}</p>
      </SplitPane>
    </div>
  );
}

/* =====================================================================
   Customers & Follow-ups -> Business Growth: the list beside the one selected
   ===================================================================== */
export function GrowthEnquiries({ state, open, onOpen, onQuote, onOpenLead, tabs: leadTabs }: {
  state: ReturnType<typeof useGrowthList>;
  /** the enquiry a bell, the Desk or a search asked for */
  open: number | null; onOpen: (id: number | null) => void;
  onQuote: (e: GRow) => void;
  onOpenLead?: (customerId: number) => void;
  /** the Leads & CRM sub-tab row - drawn UNDER the figure strip (the Payments order) */
  tabs?: ReactNode;
}) {
  const data = state.data;
  const [mode, setMode] = useState<"list" | "analytics">("list");
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const key = `${q}|${view}`;
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) { setSeenKey(key); setPage(1); }
  const [asked, setAsked] = useState<number | null>(null);
  if (open !== asked) {
    setAsked(open);
    if (open != null) { setSel(open); setView("open"); setMode("list"); setQ(""); if (narrow()) setDrawer(open); }
  }
  const changed = useCallback((msg?: string) => { state.refresh(); if (msg) setToast(msg); }, [state]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(""), 3500); return () => window.clearTimeout(t); }, [toast]);
  const rows = useMemo(() => data?.enquiries ?? [], [data]);
  const today = mytToday();
  const due = (r: GRow) => r.status !== "not_interested" && !!r.next_follow_up_on && r.next_follow_up_on <= today;
  const inView = useCallback((r: GRow, v: View) => (
    v === "open" ? r.status !== "not_interested" : v === "new" ? r.status === "new" : v === "mine" ? r.owner_id === data?.me && r.status !== "not_interested"
      : v === "due" ? due(r) : v === "qualified" ? r.status === "qualified" : r.status === "not_interested"
  ), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => rows.filter((r) => inView(r, view) && (!q || `${r.ref} ${r.full_name} ${r.business_name} ${r.whatsapp} ${r.email ?? ""} ${r.owner_name ?? ""} ${r.utm_campaign ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, view, q, inView]);
  const pick = (id: number) => { setSel(id); onOpen(id); if (narrow()) setDrawer(id); };

  if (state.failed && !data) return <>{leadTabs}<p className={css.warn} role="alert" data-testid="growth-failed">{L("Business Growth enquiries could not be loaded.", "Pertanyaan Pertumbuhan Bisnes tidak dapat dimuatkan.")}</p></>;
  if (data?.pending_migration) return <>{leadTabs}<p className={css.calm} data-testid="growth-pending"><AppIcon name="info" />{L("Business Growth enquiries arrive with the next database update.", "Pertanyaan Pertumbuhan Bisnes tiba dengan kemas kini pangkalan data seterusnya.")}</p></>;
  const a = data?.analytics;
  const n = (v: View) => rows.filter((r) => inView(r, v)).length;
  const cells: StripCell[] = [
    { key: "new", icon: "alert", tone: "gold", label: L("New - to pick up", "Baharu - untuk diambil"), value: data ? n("new") : "…", busy: !data, onClick: () => { setMode("list"); setView("new"); }, pressed: mode === "list" && view === "new" },
    { key: "first", icon: "time", tone: "bad", label: L("Waiting first contact", "Menunggu hubungan pertama"), value: data ? rows.filter((r) => r.owner_id && !r.first_response_at && r.status !== "not_interested").length : "…", busy: !data },
    { key: "due", icon: "date", tone: "info", label: L("Follow-up due", "Susulan perlu"), value: data ? n("due") : "…", busy: !data, onClick: () => { setMode("list"); setView("due"); }, pressed: mode === "list" && view === "due" },
    { key: "advice", icon: "success", tone: "neutral", label: L("Free advice given", "Cadangan percuma diberi"), value: a ? a.assessments : "…", busy: !data },
    { key: "qualified", icon: "target", tone: "ok", label: L("Qualified", "Layak"), value: data ? n("qualified") : "…", busy: !data, onClick: () => { setMode("list"); setView("qualified"); }, pressed: mode === "list" && view === "qualified" },
  ];
  const cols: TableCol<GRow>[] = [
    { key: "ref", label: L("Ref.", "Ruj."), cell: (r) => <span className={pa.ref} data-testid={`growth-ref-${r.id}`}>{r.ref}</span> },
    { key: "biz", label: L("Business · main challenge", "Bisnes · cabaran utama"), main: true, cell: (r) => <><TaskRowTitle title={r.business_name} onOpen={() => pick(r.id)} />
      <TaskRowSub>{r.full_name} · {w(GROWTH_CHALLENGES, r.challenges[0])}{r.challenges.length > 1 ? ` +${r.challenges.length - 1}` : ""}{r.overdue ? <span className={css.dueLate}> · {L("Overdue", "Lewat")}</span> : null}{r.resubmissions ? ` · ${L("sent again", "dihantar semula")}` : ""}</TaskRowSub></> },
    { key: "src", label: L("Source", "Sumber"), cell: (r) => w(GROWTH_SOURCES, r.source) },
    { key: "status", label: L("Status", "Status"), cell: (r) => <GChip s={r.status} /> },
    { key: "owner", label: L("Owner", "Pemilik"), cell: (r) => r.owner_name ?? <span className={css.mutedInline}>–</span> },
    { key: "when", label: L("Submitted", "Dihantar"), cell: (r) => <span className={pa.when}>{myt(r.created_at)}</span> },
  ];
  const tabs: [View, string][] = [["open", L("Open", "Terbuka")], ["new", L("New", "Baharu")], ["mine", L("Mine", "Saya")], ["due", L("Follow-up", "Susulan")], ["qualified", L("Qualified", "Layak")], ["closed", L("Closed", "Ditutup")]];
  const empty = rows.length === 0 ? (
    <div className={css.emptyBox} data-testid="growth-empty">
      <span className={css.emptyIcon} aria-hidden><AppIcon name="target" /></span>
      <strong>{L("No Business Growth Check enquiries yet.", "Belum ada pertanyaan Semakan Pertumbuhan Bisnes.")}</strong>
      <p>{L("Enquiries from a2zcreative.my/apply/business land here to pick up.", "Pertanyaan dari a2zcreative.my/apply/business sampai di sini untuk diambil.")}</p>
    </div>
  ) : <p className={css.calm}><AppIcon name="search" />{L("No enquiry matches this filter.", "Tiada pertanyaan sepadan dengan penapis ini.")}</p>;

  return (
    <div className="erp-stack-tight" data-testid="growth-enquiries">
      {/* 21-11-2026 (the CEO: "strip KPI card above while sub tabs at downside", the Payments page as the reference) - the
     view's figure strip first, then the Leads & CRM sub-tab row, then the work */}
      <MetricStrip cells={cells} label={L("Business Growth Check", "Semakan Pertumbuhan Bisnes")} testid="growth-strip" />
      {leadTabs}
      <div className={pa.bar}>
        <LineTabs testid="growth-mode" label={L("Business Growth view", "Paparan Pertumbuhan Bisnes")} value={mode} onChange={setMode}
          tabs={[["list", L("Enquiries", "Pertanyaan")], ["analytics", L("Analytics", "Analitik")]] as const} />
      </div>
      {toast && <p className={css.calm} role="status" data-testid="growth-toast"><AppIcon name="success" />{toast}</p>}
      {mode === "analytics" ? (a ? <GrowthAnalytics a={a} /> : <SkelRows rows={4} />) : (
        <WorkspaceSplit testid="growth-split" ratio="60-40">
          <SplitPane testid="growth-inbox" title={L("Business Growth Enquiries", "Pertanyaan Pertumbuhan Bisnes")} label={L("Business Growth enquiries", "Pertanyaan Pertumbuhan Bisnes")}
            actions={<span className={chipSmNeutral} data-testid="growth-count">{data ? L(`${shown.length} of ${rows.length}`, `${shown.length} daripada ${rows.length}`) : "…"}</span>}
            toolbar={<>
              <LineTabs testid="growth-tab" label={L("Enquiry filter", "Penapis pertanyaan")} value={view} onChange={setView} tabs={tabs.map(([k, l]) => [k, l, data ? n(k) : null, l] as const)} />
              <TaskToolbar q={q} onQ={setQ} placeholder={L("Search business, name, WhatsApp or ref…", "Cari bisnes, nama, WhatsApp atau ruj…")} testid="growth-toolbar" />
            </>}>
            <CompactTaskTable rows={shown} cols={cols} label={L("Business Growth enquiries", "Pertanyaan Pertumbuhan Bisnes")} loading={!data} record="growth" testid="growth-table" dense fill
              onOpen={pick} picked={sel} rowClass={(r) => (r.overdue ? css.lateRow ?? "" : "")} empty={empty} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} />
          </SplitPane>
          {sel != null ? (
            <SplitPane testid="growth-preview" title={rows.find((r) => r.id === sel)?.ref ?? L("Enquiry", "Pertanyaan")} label={L("Selected enquiry", "Pertanyaan dipilih")}
              actions={<button type="button" className={btnSm} onClick={() => setDrawer(sel)} data-testid="growth-open-full">{L("Full view", "Paparan penuh")}</button>}>
              <GrowthRecord id={sel} onClose={() => { setSel(null); onOpen(null); }} onChanged={changed} onQuote={onQuote} onOpenLead={onOpenLead} testid="growth-record" />
            </SplitPane>
          ) : (
            <SplitPane testid="growth-flow" title={L("How a Business Growth Check is handled", "Cara Semakan Pertumbuhan Bisnes diurus")} label={L("Enquiry status flow", "Aliran status pertanyaan")}
              sub={L("Choose an enquiry to see it here. The first review is free; a paid service is never required and goes through a normal quotation.", "Pilih pertanyaan untuk melihatnya di sini. Semakan pertama percuma; perkhidmatan berbayar tidak diwajibkan dan melalui sebut harga biasa.")}>
              <ol className={`${pa.defs} ${gx.defsWide}`} data-testid="growth-defs">
                {GROWTH_STATUS.map(([s, , def]) => (
                  <li key={s}><span className={pa.defDot} aria-hidden /><GChip s={s as GStatus} /><span className={pa.defText}>{L(def[0], def[1])}</span><span className={pa.defCount}>{data ? rows.filter((r) => r.status === s).length || "" : ""}</span></li>
                ))}
              </ol>
              <div className={css.goldNote}>
                <AppIcon name="lock" />
                <span><strong>{L("A2Z staff only:", "Staf A2Z sahaja:")}</strong> {L("agents and customers never see these enquiries. An enquiry creates no account, no customer and no sale.", "ejen dan pelanggan tidak pernah melihat pertanyaan ini. Pertanyaan tidak membuat akaun, pelanggan atau jualan.")}</span>
              </div>
            </SplitPane>
          )}
        </WorkspaceSplit>
      )}
      {drawer != null && (
        <SideDrawer open onClose={() => setDrawer(null)} wide full title={rows.find((r) => r.id === drawer)?.ref ?? L("Enquiry", "Pertanyaan")} subtitle={L("Business Growth Check", "Semakan Pertumbuhan Bisnes")}>
          <GrowthRecord id={drawer} full onClose={() => setDrawer(null)} onChanged={changed} onQuote={(e) => { setDrawer(null); onQuote(e); }} onOpenLead={onOpenLead ? (c) => { setDrawer(null); onOpenLead(c); } : undefined} testid="growth-drawer" />
        </SideDrawer>
      )}
    </div>
  );
}
