"use client";

/* v1.221.0 - COMPANIES 2.0. The owner's answers, 28-10-2026: "Build the 3
   tabs", "Bulk with preview", "Checklist now, enforce later", "Count them,
   read-only".

   Three tabs - Ownership Review, Staff Access, Audit & History - over the
   same reconciliation the page has always done. Nothing here restricts
   anyone: roles still decide what each person can open, and the company
   access plan is planning data until a separate, approved release turns it
   on. A proposal never changes an invoice, its Paid status or commission.
   Ownership is never inferred from a supplier name, a category or any other
   text: every proposal is a person's decision with a reason. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs, TabAside } from "@/components/ui/line-tabs";
import { SideDrawer } from "@/components/ui/side-drawer";
import { useSaveToast } from "@/components/ui/save-toast";
import { makeApi, type ApiResult } from "@/lib/api";
import { COMPANY_CODES, COMPANY_NAMES, REVIEW_KINDS, type CompanyCode, type CompanyStaffSetup, type ReviewDetail, type ReviewKind, type ReviewRecord, type ReviewState } from "@/lib/company-review";
import { dmy, dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipGold, chipInfo, chipNeutral, chipSuccess, chipWarn, fieldLabel, inputClass } from "@/lib/ui-styles";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { SkelRows } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import css from "./companies.module.css";

const api = makeApi("/staff/companies");
const L = (en: string, ms: string) => getLang() === "ms" ? ms : en;
const companyName = (code: CompanyCode | string | null | undefined) => code && code in COMPANY_NAMES ? COMPANY_NAMES[code as CompanyCode] : L("Unassigned", "Belum ditetapkan");
const kindName = (kind: string) => kind in REVIEW_KINDS ? L(REVIEW_KINDS[kind as ReviewKind].en, REVIEW_KINDS[kind as ReviewKind].ms) : kind;
const stateLabel = (state: ReviewState) => ({
  unassigned: L("Not yet reviewed", "Belum disemak"), proposed: L("Proposed", "Dicadangkan"),
  deferred: L("Deferred", "Ditangguhkan"), stale: L("Changed since review", "Berubah selepas semakan"),
})[state];
const stateChip = (state: ReviewState) => state === "stale" ? chipWarn : state === "proposed" ? chipInfo : state === "deferred" ? chipGold : chipNeutral;
const message = (result: ApiResult<unknown>) => (result.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Retry when online.", "Sambungan gagal. Cuba semula apabila dalam talian.");
type Attempt = { signature: string; id: string } | null;
function requestId(ref: { current: Attempt }, payload: object) {
  const signature = JSON.stringify(payload);
  if (ref.current?.signature !== signature) ref.current = { signature, id: crypto.randomUUID() };
  return ref.current.id;
}

type View = "review" | "staff" | "history";
type StateFilter = "all" | ReviewState;
interface Summary {
  registers: { kind: ReviewKind; total: number; unassigned: number; proposed: number; deferred: number; stale: number; by_company: Record<string, number> }[];
  totals: { unassigned: number; proposed: number; deferred: number; stale: number; pending: number };
  staff: { active: number; with_employer: number; with_access: number; without_access: number };
  stamped: { register: string; company: string; n: number }[];
  checklist: { key: string; done: boolean; detail: string }[];
  enforcement: string;
}
interface EventRow { seq: number; created_at: string; subject_kind: string; subject_id: number; before_json: string | null; after_json: string; actor_name: string | null; staff_name: string | null }
type Plan = { proposed_company?: string | null; reason?: string; bulk?: boolean; employer_code?: string | null; memberships?: { company_code: string; access_mode: string }[] };
const parse = (s: string | null): Plan | null => { if (!s) return null; try { return JSON.parse(s) as Plan | null; } catch { return null; } };
const accessWord = (mode: string | undefined) => mode === "write" ? L("Read and write", "Baca dan tulis") : mode === "read" ? L("Read only", "Baca sahaja") : L("No access planned", "Tiada akses dirancang");

/* ------------------------------------------------------------------ *
 * One record's review - the save flow the page has always had.
 * ------------------------------------------------------------------ */
type History = ReviewDetail["history"];
function HistoryList({ rows }: { rows: History }) {
  return <details className={css.fold}>
    <summary>{L("Review history", "Sejarah semakan")} ({rows.length})</summary>
    <ol className={css.history}>
      {rows.map((row, index) => {
        const detail = parse(row.after_json) ?? {};
        return <li key={`${row.created_at}-${index}`}>
          <strong>{row.actor_name ?? L("Former user", "Bekas pengguna")} <span className={css.muted}>{dmyMYT(row.created_at)}</span></strong>
          <span>{detail.employer_code !== undefined ? `${L("Employer", "Majikan")}: ${companyName(detail.employer_code)}` : detail.proposed_company ? companyName(detail.proposed_company) : L("Deferred", "Ditangguhkan")}{detail.bulk ? ` · ${L("bulk review", "semakan pukal")}` : ""}</span>
          {detail.memberships?.map(m => <span key={m.company_code}>{companyName(m.company_code)}: {accessWord(m.access_mode)}</span>)}
          <span className={css.reason}>{detail.reason}</span>
        </li>;
      })}
    </ol>
  </details>;
}

function RecordReview({ detail, onSaved, onRelated }: { detail: ReviewDetail; onSaved: (company: CompanyCode | null) => void; onRelated: (kind: ReviewKind, id: number) => void }) {
  const [company, setCompany] = useState<CompanyCode | "">(detail.decision?.proposed_company ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<Attempt>(null);
  const { confirm, node } = useConfirm();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (!(await confirm({ title: company ? L("Save ownership proposal?", "Simpan cadangan pemilikan?") : L("Defer ownership decision?", "Tangguhkan keputusan pemilikan?"), message: `${detail.title}\n${companyName(company || null)}`, confirmLabel: L("Confirm review", "Sahkan semakan") }))) return;
      setError("");
      const payload = { proposed_company: company || null, reason, snapshot: detail.snapshot, version: detail.decision?.version ?? 0 };
      const r = await api(`/records/${detail.kind}/${detail.id}`, { method: "PUT", body: JSON.stringify({ ...payload, request_id: requestId(attempt, payload) }) });
      if (r.ok) onSaved(company || null); else setError(message(r));
    } finally { setBusy(false); }
  };
  const conflicts = detail.related.filter(r => company && r.proposed_company && r.proposed_company !== company);
  const tab = REVIEW_KINDS[detail.kind].tab;
  return <section aria-label={L("Ownership review", "Semakan pemilikan")} className={css.drawerBody}>
    {node}
    <div className={css.drawerHead}>
      <p className={css.sub}>{kindName(detail.kind)} #{detail.id} · <span className={stateChip(detail.state)}>{stateLabel(detail.state)}</span></p>
      {tab && <a href={`/portal?tab=${encodeURIComponent(tab)}`} target="_blank" rel="noopener noreferrer" title={L("Open source register", "Buka daftar sumber")} aria-label={L("Open source register", "Buka daftar sumber")} className={btnSm}><AppIcon name="external" /></a>}
    </div>
    <details className={css.fold} open>
      <summary>{L("Source record", "Rekod sumber")}</summary>
      <dl className={css.facts}>
        {Object.entries(detail.source).filter(([, value]) => value !== null && value !== "").map(([key, value]) => <div key={key}>
          <dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd>
        </div>)}
      </dl>
    </details>
    {detail.related.length > 0 && <div>
      <h3 className={fieldLabel}>{L("Linked records", "Rekod berkaitan")}</h3>
      <ul className={css.related}>
        {detail.related.map(r => <li key={`${r.kind}-${r.id}`}><button type="button" disabled={busy} className={css.linkBtn} onClick={() => onRelated(r.kind, r.id)}>{r.title} (#{r.id})</button><span className={css.recId}>{kindName(r.kind)} · {companyName(r.proposed_company)}{r.stale ? ` / ${stateLabel("stale")}` : ""}</span></li>)}
      </ul>
      {detail.related_truncated && <p className={css.warnLine}>{L("Additional linked records remain to be reviewed.", "Rekod berkaitan tambahan masih perlu disemak.")}</p>}
    </div>}
    <form onSubmit={e => void submit(e)}>
      <fieldset disabled={busy} className={css.form}>
        <label>{L("Proposed company", "Syarikat dicadangkan")}
          <select aria-label={L("Proposed company", "Syarikat dicadangkan")} className={inputClass} value={company} onChange={e => setCompany(e.target.value as CompanyCode | "")}>
            <option value="">{L("Uncertain / defer", "Tidak pasti / tangguh")}</option>
            {COMPANY_CODES.map(code => <option key={code} value={code}>{COMPANY_NAMES[code]}</option>)}
          </select>
        </label>
        {conflicts.length > 0 && <p role="status" className={css.warnLine}>{L("Linked records have a different proposed company. Reconciliation is unresolved.", "Rekod berkaitan mempunyai syarikat cadangan berbeza. Penyesuaian belum selesai.")}</p>}
        <label>{L("Evidence / reason", "Bukti / sebab")}
          <textarea className={inputClass} required minLength={8} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <p className={css.sub}>{L("A proposal is a review decision only. It does not change the record, an invoice's Paid status or any commission.", "Cadangan hanyalah keputusan semakan. Ia tidak mengubah rekod, status Dibayar invois atau sebarang komisen.")}</p>
        <div className={css.formRow}><button type="submit" className={btnClass} disabled={reason.trim().length < 8}><AppIcon name="save" />{L("Save review", "Simpan semakan")}</button></div>
      </fieldset>
      {error && <p role="alert" className={css.error}>{error}</p>}
    </form>
    <HistoryList rows={detail.history} />
  </section>;
}

function RecordDrawer({ target, onClose, onSaved, onRelated }: { target: { kind: ReviewKind; id: number } | null; onClose: () => void; onSaved: (company: CompanyCode | null) => void; onRelated: (kind: ReviewKind, id: number) => void }) {
  /* the answer is kept with the request it answers, so a reopened record
     never shows the previous read while its own is on the way */
  const [got, setGot] = useState<{ for: typeof target; detail: ReviewDetail | null; error: string } | null>(null);
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    void api<ReviewDetail>(`/records/${target.kind}/${target.id}`, { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      setGot({ for: target, detail: r.ok && r.data ? r.data : null, error: r.ok && r.data ? "" : message(r) });
    });
    return () => controller.abort();
  }, [target]);
  const mine = got && got.for === target ? got : null;
  const detail = mine?.detail ?? null;
  const error = mine?.error ?? "";
  const ready = detail && target && detail.kind === target.kind && detail.id === target.id;
  return <SideDrawer open={Boolean(target)} onClose={onClose} wide title={ready ? detail.title : target ? `${kindName(target.kind)} #${target.id}` : ""} subtitle={ready ? [detail.date ? dmy(detail.date) : "", detail.amount_cents !== null ? fmtRM(detail.amount_cents) : "", detail.party ?? ""].filter(Boolean).join(" · ") : undefined}>
    {error ? <p role="alert" className={css.error}>{error}</p> : ready ? <RecordReview key={`${detail.kind}-${detail.id}-${detail.snapshot}-${detail.decision?.version ?? 0}`} detail={detail} onSaved={onSaved} onRelated={onRelated} /> : <SkelRows rows={6} />}
  </SideDrawer>;
}

/* ------------------------------------------------------------------ *
 * Bulk review - the single review repeated, previewed, all or nothing.
 * ------------------------------------------------------------------ */
function BulkDrawer({ kind, items, preset, onClose, onSaved }: { kind: ReviewKind; items: ReviewRecord[]; preset: CompanyCode | ""; onClose: () => void; onSaved: (count: number, company: CompanyCode | null) => void }) {
  const [company, setCompany] = useState<CompanyCode | "">(preset);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ signature: string; count: number; total_cents: number } | null>(null);
  const attempt = useRef<Attempt>(null);
  const payload = useMemo(() => ({
    kind, proposed_company: company || null, reason: reason.trim(),
    items: items.map(r => ({ id: r.id, snapshot: r.snapshot ?? "", version: r.decision?.version ?? 0 })),
  }), [kind, company, reason, items]);
  const signature = JSON.stringify(payload);
  const previewed = preview?.signature === signature ? preview : null;
  const replacing = items.filter(r => r.decision?.proposed_company && r.decision.proposed_company !== (company || null)).length;
  const changed = items.filter(r => r.state === "stale").length;
  const run = async (dry: boolean) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await api<{ count?: number; total_cents?: number }>("/records/bulk", { method: "PUT", body: JSON.stringify({ ...payload, request_id: requestId(attempt, payload), ...(dry ? { dry_run: true } : {}) }) });
      if (!r.ok) { setError(message(r)); setPreview(null); return; }
      const fallback = items.reduce((a, x) => a + (x.amount_cents ?? 0), 0);
      if (dry) setPreview({ signature, count: r.data?.count ?? items.length, total_cents: r.data?.total_cents ?? fallback });
      else onSaved(r.data?.count ?? items.length, company || null);
    } finally { setBusy(false); }
  };
  return <SideDrawer open onClose={onClose} title={L("Review selected records", "Semak rekod dipilih")} subtitle={`${items.length} · ${kindName(kind)}`}>
    <div className={css.drawerBody}>
      <fieldset disabled={busy} className={css.form}>
        <label>{L("Proposed company", "Syarikat dicadangkan")}
          <select aria-label={L("Proposed company for the selection", "Syarikat dicadangkan untuk pilihan")} className={inputClass} value={company} onChange={e => setCompany(e.target.value as CompanyCode | "")}>
            <option value="">{L("Uncertain / defer", "Tidak pasti / tangguh")}</option>
            {COMPANY_CODES.map(code => <option key={code} value={code}>{COMPANY_NAMES[code]}</option>)}
          </select>
        </label>
        <label>{L("Evidence / reason (saved on every record)", "Bukti / sebab (disimpan pada setiap rekod)")}
          <textarea aria-label={L("Reason for the selection", "Sebab untuk pilihan")} className={inputClass} required minLength={8} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        {!previewed && <div className={css.formRow}><button type="button" className={btnClass} disabled={reason.trim().length < 8} onClick={() => void run(true)}><AppIcon name="preview" />{L("Preview impact", "Pratonton kesan")}</button></div>}
      </fieldset>
      {previewed && <section className={css.preview} aria-label={L("Impact preview", "Pratonton kesan")}>
        <dl>
          <dt>{L("Records", "Rekod")}</dt><dd>{previewed.count} · {kindName(kind)}</dd>
          <dt>{L("Their value", "Nilainya")}</dt><dd>{fmtRM(previewed.total_cents)}</dd>
          <dt>{L("Decision", "Keputusan")}</dt><dd>{company ? `${L("Propose", "Cadang")} ${COMPANY_NAMES[company]}` : L("Defer", "Tangguh")}</dd>
        </dl>
        {replacing > 0 && <p className={css.warnLine}>{L(`${replacing} already have a different proposal - saving replaces it.`, `${replacing} sudah mempunyai cadangan berbeza - menyimpan akan menggantikannya.`)}</p>}
        {changed > 0 && <p className={css.warnLine}>{L(`${changed} changed since their last review - this review records the record as it is now.`, `${changed} berubah sejak semakan terakhir - semakan ini merekod keadaan semasa.`)}</p>}
        <p className={css.sub}>{L("Nothing is saved yet. Saving writes one review, with your name and reason, on each record - all of them or none. Records, invoices, Paid status and commission are not changed.", "Belum disimpan. Menyimpan menulis satu semakan, dengan nama dan sebab anda, pada setiap rekod - semua atau tiada. Rekod, invois, status Dibayar dan komisen tidak diubah.")}</p>
        <div className={css.formRow}>
          <button type="button" className={btnClass} disabled={busy} onClick={() => void run(false)}><AppIcon name="save" />{L(`Save ${previewed.count} reviews`, `Simpan ${previewed.count} semakan`)}</button>
          <button type="button" className={btnSm} disabled={busy} onClick={() => setPreview(null)}>{L("Change", "Ubah")}</button>
        </div>
      </section>}
      {error && <p role="alert" className={css.error}>{error}</p>}
    </div>
  </SideDrawer>;
}

/* ------------------------------------------------------------------ *
 * One person's planned company access.
 * ------------------------------------------------------------------ */
function StaffSetup({ employee, onSaved }: { employee: CompanyStaffSetup; onSaved: () => void }) {
  const [employer, setEmployer] = useState<CompanyCode | "">(employee.employer_code ?? "");
  const [memberships, setMemberships] = useState(employee.memberships);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState("");
  const attempt = useRef<Attempt>(null);
  const { confirm, node } = useConfirm();
  useEffect(() => {
    const controller = new AbortController();
    void api<{ history: History }>(`/staff/${employee.id}`, { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      if (r.ok && r.data) setHistory(r.data.history); else setHistoryError(message(r));
    });
    return () => controller.abort();
  }, [employee.id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (!(await confirm({ title: L("Save staff company setup?", "Simpan tetapan syarikat staf?"), message: `${employee.name}\n${companyName(employer || null)}`, confirmLabel: L("Confirm setup", "Sahkan tetapan") }))) return;
      const payload = { employer_code: employer || null, memberships, reason, version: employee.version };
      const r = await api(`/staff/${employee.id}`, { method: "PUT", body: JSON.stringify({ ...payload, request_id: requestId(attempt, payload) }) });
      if (r.ok) onSaved(); else setError(message(r));
    } finally { setBusy(false); }
  };
  return <section className={css.drawerBody} aria-label={L("Staff company setup", "Tetapan syarikat staf")}>
    {node}
    <p className={css.notice}><AppIcon name="info" /><span>{L("Planned access - not enforced yet. Roles still decide what this person can open.", "Akses dirancang - belum dikuatkuasakan. Peranan masih menentukan apa yang boleh dibuka.")}</span></p>
    <form onSubmit={e => void submit(e)}>
      <fieldset disabled={busy} className={css.form}>
        <label>{L("Employer", "Majikan")}
          <select aria-label={L("Employer", "Majikan")} className={inputClass} value={employer} onChange={e => setEmployer(e.target.value as CompanyCode | "")}>
            <option value="">{L("Unassigned", "Belum ditetapkan")}</option>{COMPANY_CODES.map(code => <option key={code} value={code}>{COMPANY_NAMES[code]}</option>)}
          </select>
        </label>
        <div className={css.planRow}>
          <span className={fieldLabel}>{L("Company access plan", "Pelan akses syarikat")}</span>
          {COMPANY_CODES.map(code => {
            const member = memberships.find(m => m.company_code === code);
            return <div key={code} className={css.planRow}>
              <label className={css.planCheck}><input type="checkbox" checked={Boolean(member)} onChange={e => setMemberships(current => e.target.checked ? [...current, { company_code: code, access_mode: "read" }] : current.filter(m => m.company_code !== code))} />{COMPANY_NAMES[code]}</label>
              {member && <select aria-label={`${COMPANY_NAMES[code]} ${L("access", "akses")}`} className={inputClass} value={member.access_mode} onChange={e => setMemberships(current => current.map(m => m.company_code === code ? { ...m, access_mode: e.target.value as "read" | "write" } : m))}>
                <option value="read">{L("Read only", "Baca sahaja")}</option><option value="write">{L("Read and write", "Baca dan tulis")}</option>
              </select>}
            </div>;
          })}
        </div>
        <label>{L("Reason", "Sebab")}<textarea className={inputClass} required minLength={8} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className={css.formRow}><button type="submit" className={btnClass} disabled={reason.trim().length < 8}><AppIcon name="save" />{L("Save setup", "Simpan tetapan")}</button></div>
      </fieldset>
    </form>
    {error && <p role="alert" className={css.error}>{error}</p>}
    {history ? <HistoryList rows={history} /> : historyError ? <p role="alert" className={css.error}>{historyError}</p> : <SkelRows rows={2} />}
  </section>;
}

/* ------------------------------------------------------------------ *
 * The readiness checklist - what must be true before access could ever
 * be switched on. Nothing here switches it on.
 * ------------------------------------------------------------------ */
const CHECKS: Record<string, { en: string; ms: string; stage: "data" | "build" }> = {
  reviewed: { en: "Every operational record reviewed", ms: "Setiap rekod operasi disemak", stage: "data" },
  settled: { en: "No deferred or changed reviews left", ms: "Tiada semakan ditangguh atau berubah", stage: "data" },
  staff_setup: { en: "Every active staff member has an employer and an access plan", ms: "Setiap staf aktif mempunyai majikan dan pelan akses", stage: "data" },
  management: { en: "CEO, COO and super admin planned with write access to both companies", ms: "CEO, COO dan super admin dirancang dengan akses tulis ke kedua-dua syarikat", stage: "data" },
  ownership_columns: { en: "Each operational record stores its company", ms: "Setiap rekod operasi menyimpan syarikatnya", stage: "build" },
  scoped_queries: { en: "Every list, report and export filtered by company", ms: "Setiap senarai, laporan dan eksport ditapis ikut syarikat", stage: "build" },
  jobs_scope: { en: "Scheduled jobs, syncs and webhooks company-aware", ms: "Tugas berjadual, segerak dan webhook sedar syarikat", stage: "build" },
  pilot: { en: "A pilot with one team, read-only first", ms: "Perintis dengan satu pasukan, baca sahaja dahulu", stage: "build" },
  rollback_switch: { en: "One switch that turns restrictions off again", ms: "Satu suis untuk mematikan sekatan semula", stage: "build" },
};
function checkDetail(key: string, detail: string) {
  if (detail === "not_built") return L("Not built", "Belum dibina");
  if (detail === "not_run") return L("Not run", "Belum dijalankan");
  if (key === "reviewed") return L(`${detail} not yet reviewed`, `${detail} belum disemak`);
  if (key === "settled") { const [s, d] = detail.split("/"); return L(`${s} changed · ${d} deferred`, `${s} berubah · ${d} ditangguh`); }
  return L(`${detail} set up`, `${detail} ditetapkan`);
}
function Checklist({ summary }: { summary: Summary | null }) {
  if (!summary) return <SkelRows rows={5} />;
  const stage = (s: "data" | "build") => summary.checklist.filter(c => CHECKS[c.key]?.stage === s);
  return <div>
    {(["data", "build"] as const).map(s => <div key={s}>
      <p className={css.checkStage}>{s === "data" ? L("The data - done on this page", "Data - dibuat di halaman ini") : L("The build - a separate release you approve", "Binaan - keluaran berasingan yang anda luluskan")}</p>
      <ul className={css.checklist} aria-label={s === "data" ? L("Data readiness", "Kesediaan data") : L("Build readiness", "Kesediaan binaan")}>
        {stage(s).map(c => <li key={c.key} className={c.done ? css.done : css.todo}>
          <AppIcon name={c.done ? "success" : "pending"} />
          <span>{L(CHECKS[c.key]!.en, CHECKS[c.key]!.ms)}<span className={css.checkDetail}>{checkDetail(c.key, c.detail)}</span></span>
          <span className={c.done ? chipSuccess : c.detail === "not_built" || c.detail === "not_run" ? chipNeutral : chipWarn}>{c.done ? L("Done", "Selesai") : c.detail === "not_built" || c.detail === "not_run" ? L("Later", "Kemudian") : L("To do", "Perlu dibuat")}</span>
        </li>)}
      </ul>
    </div>)}
  </div>;
}

/* ------------------------------------------------------------------ */
const STAMPED: Record<string, [string, string]> = {
  invoices: ["Invoices", "Invois"], quotations: ["Quotations", "Sebut harga"], delivery_orders: ["Delivery orders", "Pesanan penghantaran"],
  receipts: ["Receipts", "Resit"], credit_notes: ["Credit notes", "Nota kredit"], claims: ["Claims", "Tuntutan"], payslip_months: ["Payslip months", "Bulan slip gaji"],
};

export function CompaniesPanel() {
  const [view, setView] = useState<View>("review");
  const [seen, setSeen] = useState<Record<View, boolean>>({ review: true, staff: false, history: false });
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  const open = (v: View) => { setView(v); setSeen(s => ({ ...s, [v]: true })); };
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void api<Summary>("/summary", { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      if (r.ok && r.data) { setSummary(r.data); setSummaryError(""); } else setSummaryError(message(r));
    });
    return () => controller.abort();
  }, [revision]);

  /* ---- Ownership Review ---- */
  const [kind, setKind] = useState<ReviewKind>("expenses");
  const [state, setState] = useState<StateFilter>("unassigned");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<{ key: string; records: ReviewRecord[] | null; total: number; error: string } | null>(null);
  const [picked, setPicked] = useState<Map<number, ReviewRecord>>(new Map());
  const [target, setTarget] = useState<{ kind: ReviewKind; id: number } | null>(null);
  const [bulk, setBulk] = useState<CompanyCode | "" | null>(null);
  useEffect(() => { const t = window.setTimeout(() => { setQ(qInput.trim()); setPage(0); }, 300); return () => window.clearTimeout(t); }, [qInput]);
  const listKey = `${new URLSearchParams({ kind, state, page: String(page), ...(q ? { q } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}#${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    void api<{ records: ReviewRecord[]; total: number }>(`/records?${listKey.split("#")[0]}`, { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      setList(r.ok && r.data ? { key: listKey, records: r.data.records, total: r.data.total, error: "" } : { key: listKey, records: null, total: 0, error: message(r) });
    });
    return () => controller.abort();
  }, [listKey]);
  const current = list?.key === listKey ? list : null;
  const records = current?.records ?? null;
  const total = current?.total ?? 0;
  const recordsError = current?.error ?? "";
  const resetList = () => { setPage(0); setPicked(new Map()); };
  const pickRegister = (k: ReviewKind) => { setKind(k); resetList(); };
  const toggle = (r: ReviewRecord) => setPicked(current => {
    const next = new Map(current);
    if (next.has(r.id)) next.delete(r.id); else if (next.size < 100) next.set(r.id, r);
    return next;
  });
  const pageAll = records !== null && records.length > 0 && records.every(r => picked.has(r.id));
  const togglePage = () => setPicked(current => {
    const next = new Map(current);
    if (pageAll) records?.forEach(r => next.delete(r.id));
    else records?.forEach(r => { if (next.size < 100) next.set(r.id, r); });
    return next;
  });
  const reviewSaved = (company: CompanyCode | null) => {
    toast(L("Review saved", "Semakan disimpan"), company ? L(`Proposed for ${COMPANY_NAMES[company]} - reconciliation still pending`, `Dicadangkan untuk ${COMPANY_NAMES[company]} - penyesuaian masih belum selesai`) : L("Deferred, with your reason", "Ditangguhkan, dengan sebab anda"));
    setTarget(null); setPicked(new Map()); reload();
  };
  const bulkSaved = (count: number, company: CompanyCode | null) => {
    toast(L(`${count} reviews saved`, `${count} semakan disimpan`), company ? L(`Proposed for ${COMPANY_NAMES[company]}, with your reason on each`, `Dicadangkan untuk ${COMPANY_NAMES[company]}, dengan sebab anda pada setiap satu`) : L("Deferred, with your reason on each", "Ditangguhkan, dengan sebab anda pada setiap satu"));
    setBulk(null); setPicked(new Map()); reload();
  };

  /* ---- Staff Access ---- */
  const [staff, setStaff] = useState<CompanyStaffSetup[] | null>(null);
  const [staffError, setStaffError] = useState("");
  const [staffQ, setStaffQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [person, setPerson] = useState<number | null>(null);
  useEffect(() => {
    if (!seen.staff) return;
    const controller = new AbortController();
    void api<{ staff: CompanyStaffSetup[] }>("/staff", { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      if (r.ok && r.data) { setStaff(r.data.staff); setStaffError(""); } else setStaffError(message(r));
    });
    return () => controller.abort();
  }, [seen.staff, revision]);
  const shownStaff = (staff ?? []).filter(s => (showInactive || s.is_active) && (!staffQ.trim() || s.name.toLowerCase().includes(staffQ.trim().toLowerCase())));
  const employee = staff?.find(s => s.id === person) ?? null;

  /* ---- Audit & History ---- */
  const [evType, setEvType] = useState<"all" | "ownership" | "staff">("all");
  const [evFrom, setEvFrom] = useState("");
  const [evTo, setEvTo] = useState("");
  const [evPage, setEvPage] = useState(0);
  const [log, setLog] = useState<{ key: string; events: EventRow[] | null; total: number; error: string } | null>(null);
  const logKey = `${new URLSearchParams({ type: evType, page: String(evPage), ...(evFrom ? { from: evFrom } : {}), ...(evTo ? { to: evTo } : {}) }).toString()}#${revision}`;
  useEffect(() => {
    if (!seen.history) return;
    const controller = new AbortController();
    void api<{ events: EventRow[]; total: number }>(`/events?${logKey.split("#")[0]}`, { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      setLog(r.ok && r.data ? { key: logKey, events: r.data.events, total: r.data.total, error: "" } : { key: logKey, events: null, total: 0, error: message(r) });
    });
    return () => controller.abort();
  }, [seen.history, logKey]);
  const shownLog = log?.key === logKey ? log : null;
  const events = shownLog?.events ?? null;
  const evTotal = shownLog?.total ?? 0;
  const evError = shownLog?.error ?? "";

  const tabs: [View, string][] = [
    ["review", L("Ownership Review", "Semakan Pemilikan")],
    ["staff", L("Staff Access", "Akses Staf")],
    ["history", L("Audit & History", "Audit & Sejarah")],
  ];
  const doneSteps = summary?.checklist.filter(c => c.done).length ?? 0;
  const pickedList = [...picked.values()];

  return <TabPage className={css.page}>
    {toastNode}
    <LineTabs value={view} onChange={open} tabs={tabs} label={L("Companies", "Syarikat")}
      aside={<TabAside><button type="button" className={btnSm} title={L("Refresh", "Muat semula")} aria-label={L("Refresh companies", "Muat semula syarikat")} onClick={reload}><AppIcon name="refresh" /></button></TabAside>} />
    <p role="status" className={css.notice}><AppIcon name="warning" /><span><strong>{L("Reconciliation only.", "Penyesuaian sahaja.")}</strong> {L("Company access restrictions are not active - roles still decide what each person can open. Proposals never change a record, an invoice's Paid status or commission.", "Sekatan akses syarikat belum aktif - peranan masih menentukan apa yang boleh dibuka. Cadangan tidak mengubah rekod, status Dibayar invois atau komisen.")}</span></p>
    {summaryError && <p role="alert" className={css.error}>{summaryError}</p>}
    <KpiRow label={L("Companies at a glance", "Ringkasan syarikat")}>
      <KpiTile icon="store" tone="navy" label={L("Companies", "Syarikat")} value={COMPANY_CODES.length} sub={COMPANY_CODES.map(c => COMPANY_NAMES[c]).join(" · ")} />
      <KpiTile icon="pending" tone="gold" busy={!summary} label={L("Not yet reviewed", "Belum disemak")} value={summary?.totals.unassigned ?? 0} sub={L(`across ${summary?.registers.length ?? 9} registers`, `merentasi ${summary?.registers.length ?? 9} daftar`)} onClick={() => { open("review"); setState("unassigned"); resetList(); }} />
      <KpiTile icon="verify" tone="blue" busy={!summary} label={L("Reviewed, not settled", "Disemak, belum muktamad")} value={summary?.totals.pending ?? 0} sub={summary ? L(`${summary.totals.proposed} proposed · ${summary.totals.deferred} deferred · ${summary.totals.stale} changed`, `${summary.totals.proposed} dicadang · ${summary.totals.deferred} ditangguh · ${summary.totals.stale} berubah`) : undefined} />
      <KpiTile icon="lock" tone="red" busy={!summary} label={L("Company access", "Akses syarikat")} value={L("Not active", "Belum aktif")} sub={L(`${doneSteps} of ${summary?.checklist.length ?? 9} readiness steps`, `${doneSteps} daripada ${summary?.checklist.length ?? 9} langkah kesediaan`)} onClick={() => open("staff")} />
    </KpiRow>

    {/* ================= Ownership Review ================= */}
    <div className={css.body} hidden={view !== "review"}>
      <TabZone label={L("Registers", "Daftar")} hint={L("Where each register stands. Choose one to review its records.", "Kedudukan setiap daftar. Pilih satu untuk menyemak rekodnya.")}>
        <div className={card}>
          {!summary ? <SkelRows rows={5} /> : <div className={css.tableWrap}>
            <table className={`${css.table} ${css.regTable}`} aria-label={L("Registers", "Daftar")}>
              <thead><tr><th>{L("Register", "Daftar")}</th><th className={css.num}>{L("Not reviewed", "Belum disemak")}</th>{COMPANY_CODES.map(c => <th key={c} className={css.num}>{COMPANY_NAMES[c]}</th>)}<th className={css.num}>{L("Deferred", "Ditangguh")}</th><th className={css.num}>{L("Changed", "Berubah")}</th><th className={css.num}>{L("Records", "Rekod")}</th></tr></thead>
              <tbody>
                {summary.registers.map(r => <tr key={r.kind} className={r.kind === kind ? css.regOn : undefined}>
                  <td><button type="button" aria-pressed={r.kind === kind} onClick={() => pickRegister(r.kind)}>{kindName(r.kind)}</button></td>
                  <td className={`${css.num} ${r.unassigned ? "" : css.zero}`}>{r.unassigned}</td>
                  {COMPANY_CODES.map(c => <td key={c} className={`${css.num} ${r.by_company[c] ? "" : css.zero}`}>{r.by_company[c] ?? 0}</td>)}
                  <td className={`${css.num} ${r.deferred ? "" : css.zero}`}>{r.deferred}</td>
                  <td className={`${css.num} ${r.stale ? "" : css.zero}`}>{r.stale}</td>
                  <td className={css.num}>{r.total}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        </div>
      </TabZone>

      <TabZone label={L("Records", "Rekod")} hint={L("Open a record to review it, or tick several from one register to review them together.", "Buka rekod untuk menyemak, atau tanda beberapa dari satu daftar untuk disemak bersama.")}>
        <div className={card}>
          <div className={css.filters}>
            <label><span className={fieldLabel}>{L("Register", "Daftar")}</span>
              <select aria-label={L("Register", "Daftar")} className={inputClass} value={kind} onChange={e => pickRegister(e.target.value as ReviewKind)}>
                {(Object.keys(REVIEW_KINDS) as ReviewKind[]).map(k => { const n = summary?.registers.find(r => r.kind === k)?.unassigned; return <option key={k} value={k}>{kindName(k)}{n ? ` (${n})` : ""}</option>; })}
              </select>
            </label>
            <label><span className={fieldLabel}>{L("Review status", "Status semakan")}</span>
              <select aria-label={L("Review status", "Status semakan")} className={inputClass} value={state} onChange={e => { setState(e.target.value as StateFilter); resetList(); }}>
                <option value="unassigned">{stateLabel("unassigned")}</option>
                <option value="proposed">{stateLabel("proposed")}</option>
                <option value="deferred">{stateLabel("deferred")}</option>
                <option value="stale">{stateLabel("stale")}</option>
                <option value="all">{L("All records", "Semua rekod")}</option>
              </select>
            </label>
            <label><span className={fieldLabel}>{L("From", "Dari")}</span><input type="date" aria-label={L("From date", "Tarikh dari")} className={inputClass} value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); resetList(); }} /></label>
            <label><span className={fieldLabel}>{L("To", "Hingga")}</span><input type="date" aria-label={L("To date", "Tarikh hingga")} className={inputClass} value={to} min={from || undefined} onChange={e => { setTo(e.target.value); resetList(); }} /></label>
            <label className={css.search}><span className={fieldLabel}>{L("Search", "Cari")}</span><input type="search" aria-label={L("Search records", "Cari rekod")} className={inputClass} placeholder={L("Description, party, category or #id", "Keterangan, pihak, kategori atau #id")} value={qInput} onChange={e => setQInput(e.target.value)} /></label>
          </div>
          {recordsError ? <p role="alert" className={css.error}>{recordsError}</p> : records === null ? <div className={css.tableWrap}><SkelRows rows={6} /></div> : records.length === 0 ? <p className={css.empty}>{state === "unassigned" && !q && !from && !to ? L(`Every ${kindName(kind).toLowerCase()} record has been reviewed.`, `Setiap rekod ${kindName(kind).toLowerCase()} telah disemak.`) : L("No records match these filters.", "Tiada rekod sepadan dengan penapis ini.")}</p> : <>
            <div className={`${css.desk} ${css.tableWrap}`}>
              <table className={css.table} aria-label={L("Records to review", "Rekod untuk disemak")}>
                <thead><tr>
                  <th className={css.checkCell}><input type="checkbox" aria-label={L("Select this page", "Pilih halaman ini")} checked={pageAll} onChange={togglePage} /></th>
                  <th>{L("Date", "Tarikh")}</th><th>{L("Record", "Rekod")}</th><th>{L("Party", "Pihak")}</th><th>{L("Category", "Kategori")}</th><th className={css.num}>{L("Amount", "Amaun")}</th><th>{L("Status", "Status")}</th><th>{L("Proposed company", "Syarikat dicadangkan")}</th><th><span className="erp-sr-only">{L("Open", "Buka")}</span></th>
                </tr></thead>
                <tbody>
                  {records.map(r => <tr key={r.id} className={picked.has(r.id) ? css.picked : undefined} onClick={() => setTarget({ kind, id: r.id })}>
                    <td className={css.checkCell} onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={L(`Select #${r.id}`, `Pilih #${r.id}`)} checked={picked.has(r.id)} onChange={() => toggle(r)} /></td>
                    <td className={css.nowrap}>{r.date ? dmy(r.date) : <span className={css.muted}>-</span>}</td>
                    <td><span className={css.recTitle}>{r.title}</span><span className={css.recId}>#{r.id}{r.quantity !== null ? ` · ${r.quantity} ${L("units", "unit")}` : ""}</span></td>
                    <td>{r.party ?? <span className={css.muted}>-</span>}</td>
                    <td>{r.category ?? <span className={css.muted}>-</span>}</td>
                    <td className={css.num}>{r.amount_cents !== null ? fmtRM(r.amount_cents) : <span className={css.muted}>-</span>}</td>
                    <td><span className={stateChip(r.state)}>{stateLabel(r.state)}</span></td>
                    <td>{r.decision ? (r.decision.proposed_company ? companyName(r.decision.proposed_company) : <span className={css.muted}>{L("Deferred", "Ditangguhkan")}</span>) : <span className={css.muted}>-</span>}</td>
                    <td><button type="button" className={css.openBtn} aria-label={L(`Review #${r.id}`, `Semak #${r.id}`)} onClick={e => { e.stopPropagation(); setTarget({ kind, id: r.id }); }}><AppIcon name="next" /></button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <ul className={css.phone} aria-label={L("Records to review", "Rekod untuk disemak")}>
              {records.map(r => <li key={r.id} className={`${css.card} ${picked.has(r.id) ? css.picked : ""}`}>
                <span className={css.cardCheck}><input type="checkbox" aria-label={L(`Select #${r.id}`, `Pilih #${r.id}`)} checked={picked.has(r.id)} onChange={() => toggle(r)} /></span>
                <button type="button" className={css.cardOpen} onClick={() => setTarget({ kind, id: r.id })}>
                  <span className={css.cardTop}><span>{r.date ? dmy(r.date) : "-"} · #{r.id}</span>{r.amount_cents !== null && <strong>{fmtRM(r.amount_cents)}</strong>}</span>
                  <span className={css.recTitle}>{r.title}</span>
                  <span className={css.cardChips}><span className={stateChip(r.state)}>{stateLabel(r.state)}</span>{r.decision?.proposed_company && <span>{companyName(r.decision.proposed_company)}</span>}{r.party && <span className={css.muted}>{r.party}</span>}</span>
                </button>
              </li>)}
            </ul>
            <div className={css.pager}>
              <span>{total} {L("records", "rekod")} · {L("page", "halaman")} {page + 1} / {Math.max(1, Math.ceil(total / 25))}</span>
              <div className={css.pagerBtns}>
                <button type="button" className={btnSm} aria-label={L("Previous page", "Halaman sebelumnya")} title={L("Previous page", "Halaman sebelumnya")} disabled={page === 0} onClick={() => setPage(p => p - 1)}><AppIcon name="previous" /></button>
                <button type="button" className={btnSm} aria-label={L("Next page", "Halaman seterusnya")} title={L("Next page", "Halaman seterusnya")} disabled={(page + 1) * 25 >= total} onClick={() => setPage(p => p + 1)}><AppIcon name="next" /></button>
              </div>
            </div>
          </>}
          {picked.size > 0 && <div className={css.bulk} role="region" aria-label={L("Selected records", "Rekod dipilih")}>
            <span><strong>{picked.size}</strong> {L("selected", "dipilih")} · {kindName(kind)}{picked.size >= 100 ? ` · ${L("100 at a time", "100 pada satu masa")}` : ""}</span>
            <div className={css.bulkBtns}>
              {COMPANY_CODES.map(c => <button key={c} type="button" className={btnSmPrimary} onClick={() => setBulk(c)}>{L(`Propose ${COMPANY_NAMES[c]}…`, `Cadang ${COMPANY_NAMES[c]}…`)}</button>)}
              <button type="button" className={btnSm} onClick={() => setBulk("")}>{L("Defer…", "Tangguh…")}</button>
              <button type="button" className={btnSm} onClick={() => setPicked(new Map())}>{L("Clear", "Kosongkan")}</button>
            </div>
          </div>}
        </div>
      </TabZone>

      <TabZone label={L("Already stamped when issued", "Sudah dicop semasa dikeluarkan")} hint={L("Counted only. These documents carry their company from the moment they were issued; nothing here reviews or changes them.", "Dikira sahaja. Dokumen ini membawa syarikatnya sejak dikeluarkan; tiada apa di sini menyemak atau mengubahnya.")}>
        <div className={card}>
          {!summary ? <SkelRows rows={4} /> : summary.stamped.length === 0 ? <p className={css.empty}>{L("No issued documents yet.", "Tiada dokumen dikeluarkan lagi.")}</p> : <div className={css.tableWrap}>
            <table className={`${css.table} ${css.regTable}`} aria-label={L("Stamped documents", "Dokumen bercop")}>
              <thead><tr><th>{L("Document", "Dokumen")}</th>{COMPANY_CODES.map(c => <th key={c} className={css.num}>{COMPANY_NAMES[c]}</th>)}<th className={css.num}>{L("Before stamping", "Sebelum dicop")}</th></tr></thead>
              <tbody>
                {Object.keys(STAMPED).filter(k => summary.stamped.some(s => s.register === k)).map(k => {
                  const n = (c: string) => summary.stamped.filter(s => s.register === k && s.company === c).reduce((a, s) => a + s.n, 0);
                  const other = summary.stamped.filter(s => s.register === k && !(COMPANY_CODES as readonly string[]).includes(s.company)).reduce((a, s) => a + s.n, 0);
                  return <tr key={k}><td>{L(STAMPED[k]![0], STAMPED[k]![1])}</td>{COMPANY_CODES.map(c => <td key={c} className={`${css.num} ${n(c) ? "" : css.zero}`}>{n(c)}</td>)}<td className={`${css.num} ${other ? "" : css.zero}`}>{other}</td></tr>;
                })}
              </tbody>
            </table>
          </div>}
        </div>
      </TabZone>
    </div>

    {/* ================= Staff Access ================= */}
    <div className={css.body} hidden={view !== "staff"}>
      <TabZone label={L("Planned access - not enforced yet", "Akses dirancang - belum dikuatkuasakan")} hint={L("Each person's employer and the companies they would see once access is switched on. Today, roles alone decide.", "Majikan setiap orang dan syarikat yang akan dilihat apabila akses dihidupkan. Hari ini, peranan sahaja yang menentukan.")}>
        <div className={card}>
          <div className={`${css.filters} ${css.filters3}`}>
            <label className={css.search}><span className={fieldLabel}>{L("Search", "Cari")}</span><input type="search" aria-label={L("Search staff", "Cari staf")} className={inputClass} value={staffQ} onChange={e => setStaffQ(e.target.value)} placeholder={L("Name", "Nama")} /></label>
            <label className={css.planCheck}><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />{L("Show inactive", "Tunjuk tidak aktif")}</label>
          </div>
          {summary && <p className={css.sub}>{L(`${summary.staff.active} active · ${summary.staff.with_employer} with an employer · ${summary.staff.with_access} with an access plan · ${summary.staff.without_access} without`, `${summary.staff.active} aktif · ${summary.staff.with_employer} dengan majikan · ${summary.staff.with_access} dengan pelan akses · ${summary.staff.without_access} tanpa`)}</p>}
          {staffError ? <p role="alert" className={css.error}>{staffError}</p> : staff === null ? <div className={css.tableWrap}><SkelRows rows={6} /></div> : shownStaff.length === 0 ? <p className={css.empty}>{L("No staff match.", "Tiada staf sepadan.")}</p> : <>
            <div className={`${css.desk} ${css.tableWrap}`}>
              <table className={css.table} aria-label={L("Staff access plan", "Pelan akses staf")}>
                <thead><tr><th>{L("Name", "Nama")}</th><th>{L("Role", "Peranan")}</th><th>{L("Employer", "Majikan")}</th>{COMPANY_CODES.map(c => <th key={c}>{COMPANY_NAMES[c]}</th>)}<th><span className="erp-sr-only">{L("Open", "Buka")}</span></th></tr></thead>
                <tbody>
                  {shownStaff.map(s => <tr key={s.id} onClick={() => setPerson(s.id)}>
                    <td><span className={css.recTitle}>{s.name}</span>{!s.is_active && <span className={css.recId}>{L("Inactive", "Tidak aktif")}</span>}</td>
                    <td className={css.muted}>{s.role.replaceAll("_", " ")}</td>
                    <td>{s.employer_code ? companyName(s.employer_code) : <span className={chipWarn}>{L("Unassigned", "Belum ditetapkan")}</span>}</td>
                    {COMPANY_CODES.map(c => { const m = s.memberships.find(x => x.company_code === c); return <td key={c}><span className={m ? css.access : `${css.access} ${css.none}`}>{m ? accessWord(m.access_mode) : "-"}</span></td>; })}
                    <td><button type="button" className={css.openBtn} aria-label={L(`Set up ${s.name}`, `Tetapkan ${s.name}`)} onClick={e => { e.stopPropagation(); setPerson(s.id); }}><AppIcon name="next" /></button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <ul className={css.phone} aria-label={L("Staff access plan", "Pelan akses staf")}>
              {shownStaff.map(s => <li key={s.id} className={`${css.card} ${css.cardWide}`}>
                <button type="button" className={css.cardOpen} onClick={() => setPerson(s.id)}>
                  <span className={css.cardTop}><span>{s.role.replaceAll("_", " ")}{!s.is_active ? ` · ${L("Inactive", "Tidak aktif")}` : ""}</span><strong>{companyName(s.employer_code)}</strong></span>
                  <span className={css.recTitle}>{s.name}</span>
                  <span className={css.cardChips}>{COMPANY_CODES.map(c => { const m = s.memberships.find(x => x.company_code === c); return <span key={c} className={m ? chipNeutral : css.none}>{COMPANY_NAMES[c]}: {m ? accessWord(m.access_mode) : "-"}</span>; })}</span>
                </button>
              </li>)}
            </ul>
          </>}
        </div>
      </TabZone>
      <TabZone label={L("Before access can be switched on", "Sebelum akses boleh dihidupkan")} hint={L("A checklist only. Switching restrictions on is a separate release that you approve; nothing on this page turns it on.", "Senarai semak sahaja. Menghidupkan sekatan ialah keluaran berasingan yang anda luluskan; tiada apa di halaman ini menghidupkannya.")}>
        <div className={card}><Checklist summary={summary} /></div>
      </TabZone>
    </div>

    {/* ================= Audit & History ================= */}
    <div className={css.body} hidden={view !== "history"}>
      <TabZone label={L("Every decision, with who and why", "Setiap keputusan, dengan siapa dan mengapa")} hint={L("Ownership reviews and staff access plans, newest first, in Malaysia time. Entries are never edited or removed.", "Semakan pemilikan dan pelan akses staf, terbaru dahulu, waktu Malaysia. Catatan tidak pernah diubah atau dibuang.")}>
        <div className={card}>
          <div className={`${css.filters} ${css.filters3}`}>
            <label><span className={fieldLabel}>{L("Activity", "Aktiviti")}</span>
              <select aria-label={L("Activity", "Aktiviti")} className={inputClass} value={evType} onChange={e => { setEvType(e.target.value as typeof evType); setEvPage(0); }}>
                <option value="all">{L("All activity", "Semua aktiviti")}</option>
                <option value="ownership">{L("Ownership reviews", "Semakan pemilikan")}</option>
                <option value="staff">{L("Staff access plans", "Pelan akses staf")}</option>
              </select>
            </label>
            <label><span className={fieldLabel}>{L("From", "Dari")}</span><input type="date" aria-label={L("History from", "Sejarah dari")} className={inputClass} value={evFrom} max={evTo || undefined} onChange={e => { setEvFrom(e.target.value); setEvPage(0); }} /></label>
            <label><span className={fieldLabel}>{L("To", "Hingga")}</span><input type="date" aria-label={L("History to", "Sejarah hingga")} className={inputClass} value={evTo} min={evFrom || undefined} onChange={e => { setEvTo(e.target.value); setEvPage(0); }} /></label>
          </div>
          {evError ? <p role="alert" className={css.error}>{evError}</p> : events === null ? <div className={css.tableWrap}><SkelRows rows={6} /></div> : events.length === 0 ? <p className={css.empty}>{L("No decisions in this range.", "Tiada keputusan dalam julat ini.")}</p> : <>
            <ul className={`${css.history} ${css.tableWrap}`} aria-label={L("Company history", "Sejarah syarikat")}>
              {events.map(e => {
                const after = parse(e.after_json) ?? {};
                const before = parse(e.before_json);
                const isStaff = e.subject_kind === "staff";
                return <li key={e.seq}>
                  <span className={css.cardTop}><span>{dmyMYT(e.created_at)}</span><span>{e.actor_name ?? L("Former user", "Bekas pengguna")}</span></span>
                  <strong>{isStaff ? `${e.staff_name ?? L("Former staff", "Bekas staf")} · ${L("access plan", "pelan akses")}` : `${kindName(e.subject_kind)} #${e.subject_id}`}</strong>
                  {isStaff ? <span className={css.change}>
                    <span>{L("Employer", "Majikan")}: {companyName(before?.employer_code)} → {companyName(after.employer_code)}</span>
                    {(after.memberships ?? []).map(m => <span key={m.company_code} className={chipNeutral}>{companyName(m.company_code)}: {accessWord(m.access_mode)}</span>)}
                  </span> : <span className={css.change}>
                    <span>{before ? (before.proposed_company ? companyName(before.proposed_company) : L("Deferred", "Ditangguhkan")) : L("Not yet reviewed", "Belum disemak")}</span><span aria-hidden="true">→</span>
                    <span className={after.proposed_company ? chipInfo : chipGold}>{after.proposed_company ? companyName(after.proposed_company) : L("Deferred", "Ditangguhkan")}</span>
                    {after.bulk && <span className={chipNeutral}>{L("Bulk review", "Semakan pukal")}</span>}
                  </span>}
                  <span className={css.reason}>{after.reason}</span>
                </li>;
              })}
            </ul>
            <div className={css.pager}>
              <span>{evTotal} {L("entries", "catatan")} · {L("page", "halaman")} {evPage + 1} / {Math.max(1, Math.ceil(evTotal / 25))}</span>
              <div className={css.pagerBtns}>
                <button type="button" className={btnSm} aria-label={L("Previous page", "Halaman sebelumnya")} title={L("Previous page", "Halaman sebelumnya")} disabled={evPage === 0} onClick={() => setEvPage(p => p - 1)}><AppIcon name="previous" /></button>
                <button type="button" className={btnSm} aria-label={L("Next page", "Halaman seterusnya")} title={L("Next page", "Halaman seterusnya")} disabled={(evPage + 1) * 25 >= evTotal} onClick={() => setEvPage(p => p + 1)}><AppIcon name="next" /></button>
              </div>
            </div>
          </>}
        </div>
      </TabZone>
    </div>

    <RecordDrawer target={target} onClose={() => setTarget(null)} onSaved={reviewSaved} onRelated={(k, id) => setTarget({ kind: k, id })} />
    {bulk !== null && pickedList.length > 0 && <BulkDrawer kind={kind} items={pickedList} preset={bulk} onClose={() => setBulk(null)} onSaved={bulkSaved} />}
    <SideDrawer open={Boolean(employee)} onClose={() => setPerson(null)} title={employee?.name ?? ""} subtitle={employee ? `${employee.role.replaceAll("_", " ")} · ${companyName(employee.employer_code)}` : undefined}>
      {employee && <StaffSetup key={`${employee.id}-${employee.version}`} employee={employee} onSaved={() => { toast(L("Access plan saved", "Pelan akses disimpan"), L("Planned only - not enforced", "Dirancang sahaja - belum dikuatkuasakan")); setPerson(null); reload(); }} />}
    </SideDrawer>
  </TabPage>;
}
