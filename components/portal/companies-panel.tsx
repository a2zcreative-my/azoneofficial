"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { makeApi, type ApiResult } from "@/lib/api";
import { COMPANY_CODES, COMPANY_NAMES, REVIEW_KINDS, type CompanyCode, type CompanyStaffSetup, type ReviewDetail, type ReviewKind, type ReviewRecord, type ReviewState } from "@/lib/company-review";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, inputClass, chipNeutral, chipWarn } from "@/lib/ui-styles";
import { SkelRows } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";

const api = makeApi("/staff/companies");
const L = (en: string, ms: string) => getLang() === "ms" ? ms : en;
const companyName = (code: CompanyCode | null) => code ? COMPANY_NAMES[code] : L("Unassigned", "Belum ditetapkan");
const stateLabel = (state: ReviewState) => ({
  unassigned: L("Unassigned", "Belum ditetapkan"), proposed: L("Proposed", "Dicadangkan"),
  deferred: L("Deferred", "Ditangguhkan"), stale: L("Changed since review", "Berubah selepas semakan"),
})[state];
const message = (result: ApiResult<unknown>) => (result.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Retry when online.", "Sambungan gagal. Cuba semula apabila dalam talian.");
type Attempt = { signature: string; id: string } | null;
function requestId(ref: { current: Attempt }, payload: object) {
  const signature = JSON.stringify(payload);
  if (ref.current?.signature !== signature) ref.current = { signature, id: crypto.randomUUID() };
  return ref.current.id;
}
type History = ReviewDetail["history"];
function HistoryList({ rows }: { rows: History }) {
  return <details className="border-border border-t pt-3">
    <summary className="cursor-pointer text-sm font-medium">{L("Review history", "Sejarah semakan")} ({rows.length})</summary>
    <ol className="divide-border mt-2 divide-y text-xs">
      {rows.map((row, index) => {
        let detail: { reason?: string; proposed_company?: CompanyCode | null; employer_code?: CompanyCode | null; memberships?: { company_code: CompanyCode; access_mode: string }[] } = {};
        try { detail = JSON.parse(row.after_json); } catch { /* retain actor and timestamp */ }
        return <li key={`${row.created_at}-${index}`} className="space-y-1 py-2 break-words">
          <p className="font-medium">{row.actor_name ?? L("Former user", "Bekas pengguna")} <span className="text-muted-foreground font-normal">{row.created_at} UTC</span></p>
          <p>{companyName(detail.proposed_company ?? detail.employer_code ?? null)}</p>
          {detail.memberships?.map(m => <p key={m.company_code}>{companyName(m.company_code)}: {m.access_mode === "write" ? L("Read and write", "Baca dan tulis") : L("Read only", "Baca sahaja")}</p>)}
          <p className="text-muted-foreground whitespace-pre-wrap">{detail.reason}</p>
        </li>;
      })}
    </ol>
  </details>;
}

function RecordReview({ detail, onSaved, onRelated }: { detail: ReviewDetail; onSaved: () => void; onRelated: (kind: ReviewKind, id: number) => void }) {
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
      if (r.ok) onSaved(); else setError(message(r));
    } finally { setBusy(false); }
  };
  const conflicts = detail.related.filter(r => company && r.proposed_company && r.proposed_company !== company);
  return <section aria-label={L("Ownership review", "Semakan pemilikan")} className="min-w-0 space-y-4 border-border border-t pt-4 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5">
    {node}
    <div className="flex items-start justify-between gap-3">
      <h2 className="break-words text-base font-semibold">{detail.title}</h2>
      <a href={`/portal?tab=${encodeURIComponent(REVIEW_KINDS[detail.kind].tab)}`} target="_blank" rel="noopener noreferrer" title={L("Open source register", "Buka daftar sumber")} aria-label={L("Open source register", "Buka daftar sumber")} className={`${btnSm} shrink-0`}><AppIcon name="external" /></a>
    </div>
    <p className="text-muted-foreground text-xs">#{detail.id} <span className={detail.state === "stale" ? chipWarn : chipNeutral}>{stateLabel(detail.state)}</span></p>
    <details className="border-border border-b pb-3">
      <summary className="cursor-pointer text-sm font-medium">{L("Source record", "Rekod sumber")}</summary>
      <dl className="mt-2 space-y-2 text-xs">
        {Object.entries(detail.source).filter(([, value]) => value !== null && value !== "").map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <dt className="text-muted-foreground break-words">{key.replaceAll("_", " ")}</dt><dd className="break-all whitespace-pre-wrap">{String(value)}</dd>
        </div>)}
      </dl>
    </details>
    {detail.related.length > 0 && <div>
      <h3 className="text-sm font-medium">{L("Linked records", "Rekod berkaitan")}</h3>
      <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-xs">
        {detail.related.map(r => <li key={`${r.kind}-${r.id}`}><button type="button" disabled={busy} className="text-primary text-left underline underline-offset-2 break-words" onClick={() => onRelated(r.kind, r.id)}>{r.title} (#{r.id})</button><p className="text-muted-foreground">{companyName(r.proposed_company)}{r.stale ? ` / ${stateLabel("stale")}` : ""}</p></li>)}
      </ul>
      {detail.related_truncated && <p className="text-warning mt-2 text-xs">{L("Additional linked records remain to be reviewed.", "Rekod berkaitan tambahan masih perlu disemak.")}</p>}
    </div>}
    <form onSubmit={e => void submit(e)} className="space-y-3">
      <fieldset disabled={busy} className="min-w-0 space-y-3 disabled:opacity-60">
        <label className="block text-sm">{L("Proposed company", "Syarikat dicadangkan")}
          <select aria-label={L("Proposed company", "Syarikat dicadangkan")} className={`${inputClass} mt-1 w-full min-w-0`} value={company} onChange={e => setCompany(e.target.value as CompanyCode | "")}>
            <option value="">{L("Uncertain / defer", "Tidak pasti / tangguh")}</option>
            {COMPANY_CODES.map(code => <option key={code} value={code}>{COMPANY_NAMES[code]}</option>)}
          </select>
        </label>
        {conflicts.length > 0 && <p role="status" className="text-warning text-xs">{L("Linked records have a different proposed company. Reconciliation is unresolved.", "Rekod berkaitan mempunyai syarikat cadangan berbeza. Penyesuaian belum selesai.")}</p>}
        <label className="block text-sm">{L("Evidence / reason", "Bukti / sebab")}
          <textarea className={`${inputClass} mt-1 min-h-24 w-full resize-y`} required minLength={8} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <button type="submit" className={`${btnClass} gap-2`} disabled={reason.trim().length < 8}><AppIcon name="save" />{L("Save review", "Simpan semakan")}</button>
      </fieldset>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    </form>
    <HistoryList rows={detail.history} />
  </section>;
}

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
      const r = await api(`/staff/${employee.id}`, { method: "PUT", body: JSON.stringify({ ...payload, request_id: requestId(attempt,payload) }) });
      if (r.ok) onSaved(); else setError(message(r));
    } finally { setBusy(false); }
  };
  return <section className="min-w-0 space-y-4 border-border border-t pt-4 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5" aria-label={L("Staff company setup", "Tetapan syarikat staf")}>
    {node}
    <h2 className="break-words text-base font-semibold">{employee.name}</h2>
    <form onSubmit={e => void submit(e)}>
      <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
        <label className="block text-sm">{L("Employer", "Majikan")}
          <select aria-label={L("Employer", "Majikan")} className={`${inputClass} mt-1 w-full min-w-0`} value={employer} onChange={e => setEmployer(e.target.value as CompanyCode | "")}>
            <option value="">{L("Unassigned", "Belum ditetapkan")}</option>{COMPANY_CODES.map(code => <option key={code} value={code}>{COMPANY_NAMES[code]}</option>)}
          </select>
        </label>
        <div className="space-y-3">
          <p className="text-sm font-medium">{L("Company access plan", "Pelan akses syarikat")}</p>
          {COMPANY_CODES.map(code => {
            const member = memberships.find(m => m.company_code === code);
            return <div key={code} className="space-y-2">
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={Boolean(member)} onChange={e => setMemberships(current => e.target.checked ? [...current,{ company_code: code, access_mode: "read" }] : current.filter(m => m.company_code !== code))} />{COMPANY_NAMES[code]}</label>
              {member && <select aria-label={`${COMPANY_NAMES[code]} ${L("access", "akses")}`} className={`${inputClass} w-full min-w-0`} value={member.access_mode} onChange={e => setMemberships(current => current.map(m => m.company_code === code ? { ...m, access_mode: e.target.value as "read" | "write" } : m))}>
                <option value="read">{L("Read only", "Baca sahaja")}</option><option value="write">{L("Read and write", "Baca dan tulis")}</option>
              </select>}
            </div>;
          })}
        </div>
        <label className="block text-sm">{L("Reason", "Sebab")}<textarea className={`${inputClass} mt-1 min-h-24 w-full`} required minLength={8} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button type="submit" className={`${btnClass} gap-2`} disabled={reason.trim().length < 8}><AppIcon name="save" />{L("Save setup", "Simpan tetapan")}</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    {history ? <HistoryList rows={history} /> : historyError ? <p role="alert" className="text-danger text-sm">{historyError}</p> : <SkelRows rows={2} />}
  </section>;
}

export function CompaniesPanel() {
  const [view, setView] = useState<"records" | "staff">("records");
  const [kind, setKind] = useState<ReviewKind>("expenses");
  const [filter, setFilter] = useState("unassigned");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [records, setRecords] = useState<ReviewRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [staff, setStaff] = useState<CompanyStaffSetup[] | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  const reviewPane = useRef<HTMLDivElement>(null);
  const saved = useCallback(() => { setSuccess(L("Review saved. Reconciliation remains pending.", "Semakan disimpan. Penyesuaian masih belum selesai.")); setSelected(null); setRevision(v => v + 1); }, []);
  const clear = () => { setSelected(null); setDetail(null); setError(""); setSuccess(""); setPage(0); };
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setRecords(null); setStaff(null);
    if (view === "records") void api<{ records: ReviewRecord[]; total: number }>(`/records?kind=${kind}&filter=${filter}&page=${page}`, { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      if (r.ok && r.data) { setRecords(r.data.records); setTotal(r.data.total); } else setError(message(r));
    });
    else void api<{ staff: CompanyStaffSetup[] }>("/staff", { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      if (r.ok && r.data) setStaff(r.data.staff); else setError(message(r));
    });
    return () => controller.abort();
  }, [view,kind,filter,page,revision]);
  useEffect(() => {
    setDetail(null); setDetailError("");
    if (view !== "records" || selected === null) return;
    const controller = new AbortController();
    void api<ReviewDetail>(`/records/${kind}/${selected}`, { signal: controller.signal }).then(r => {
      if (controller.signal.aborted) return;
      if (r.ok && r.data) setDetail(r.data); else setDetailError(message(r));
    });
    return () => controller.abort();
  }, [view,kind,selected,revision]);
  const employee = staff?.find(s => s.id === selected);
  useEffect(() => {
    if (selected !== null && (detail || employee || detailError) && window.innerWidth < 1280) reviewPane.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selected,detail,employee,detailError]);
  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b pb-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label={L("Company administration", "Pentadbiran syarikat")}>
        {(["records","staff"] as const).map(v => <button key={v} type="button" aria-pressed={view === v} className={`${btnSm} ${view === v ? "bg-secondary font-semibold" : ""}`} onClick={() => { clear(); setView(v); }}>{v === "records" ? L("Ownership review", "Semakan pemilikan") : L("Staff setup", "Tetapan staf")}</button>)}
      </div>
      <button type="button" className={btnSm} title={L("Refresh", "Muat semula")} aria-label={L("Refresh company review", "Muat semula semakan syarikat")} onClick={() => { clear(); setRevision(v => v + 1); }}><AppIcon name="refresh" /></button>
    </div>
    <p role="status" className="text-warning text-xs">{L("Reconciliation pending. Company access restrictions are not active.", "Penyesuaian belum selesai. Sekatan akses syarikat belum aktif.")}</p>
    {success && <p role="status" className="text-success flex items-start gap-2 text-sm"><AppIcon name="success" />{success}</p>}
    {view === "records" && <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">{L("Register", "Daftar")}<select aria-label={L("Register", "Daftar")} className={`${inputClass} mt-1 w-full min-w-0`} value={kind} onChange={e => { clear(); setKind(e.target.value as ReviewKind); }}>{Object.entries(REVIEW_KINDS).map(([key,label]) => <option key={key} value={key}>{L(label.en,label.ms)}</option>)}</select></label>
      <label className="text-xs">{L("Review status", "Status semakan")}<select className={`${inputClass} mt-1 w-full min-w-0`} value={filter} onChange={e => { clear(); setFilter(e.target.value); }}><option value="unassigned">{L("Not yet reviewed", "Belum disemak")}</option><option value="reviewed">{L("Previously reviewed", "Telah disemak")}</option><option value="all">{L("All records", "Semua rekod")}</option></select></label>
    </div>}
    {error ? <p role="alert" className="text-danger text-sm">{error}</p> : <div className={`grid min-w-0 gap-5 ${selected !== null ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
      <div className="min-w-0">
        {view === "records" ? records === null ? <SkelRows rows={5} /> : <>
          <ul className="divide-border divide-y">
            {records.map(r => <li key={r.id}><button type="button" aria-pressed={selected === r.id} className={`w-full min-w-0 py-3 text-left ${selected === r.id ? "bg-secondary" : "hover:bg-secondary/50"}`} onClick={() => setSelected(r.id)}>
              <span className="flex flex-wrap items-start justify-between gap-2 text-sm"><span className="min-w-0 flex-1 break-words font-medium">{r.title}</span><span className={r.state === "stale" ? chipWarn : chipNeutral}>{stateLabel(r.state)}</span></span>
              <span className="text-muted-foreground mt-1 block text-xs">#{r.id} / {r.date?.slice(0,10)}{r.amount_cents !== null ? ` / RM ${(r.amount_cents/100).toFixed(2)}` : ""}{r.quantity !== null ? ` / ${r.quantity} ${L("units", "unit")}` : ""}</span>
              {r.decision && <span className="mt-1 block break-words text-xs">{companyName(r.decision.proposed_company)}</span>}
            </button></li>)}
          </ul>
          {records.length === 0 && <p className="text-muted-foreground py-6 text-sm">{L("No matching records.", "Tiada rekod sepadan.")}</p>}
          <div className="mt-4 flex items-center justify-between gap-2 text-xs">
            <span>{total} {L("records", "rekod")} / {L("Page", "Halaman")} {page+1}</span>
            <div className="flex gap-2"><button type="button" className={btnSm} aria-label={L("Previous page", "Halaman sebelumnya")} title={L("Previous page", "Halaman sebelumnya")} disabled={page === 0} onClick={() => { setSelected(null); setPage(p => p-1); }}><AppIcon name="previous" /></button><button type="button" className={btnSm} aria-label={L("Next page", "Halaman seterusnya")} title={L("Next page", "Halaman seterusnya")} disabled={(page+1)*25 >= total} onClick={() => { setSelected(null); setPage(p => p+1); }}><AppIcon name="next" /></button></div>
          </div>
        </> : staff === null ? <SkelRows rows={5} /> : <ul className="divide-border divide-y">{staff.map(s => <li key={s.id}><button type="button" aria-pressed={selected === s.id} className={`w-full py-3 text-left ${selected === s.id ? "bg-secondary" : "hover:bg-secondary/50"}`} onClick={() => setSelected(s.id)}><span className="block break-words text-sm font-medium">{s.name}{!s.is_active ? ` (${L("Inactive", "Tidak aktif")})` : ""}</span><span className="text-muted-foreground mt-1 block break-words text-xs">{companyName(s.employer_code)} / {s.memberships.length} {L("memberships", "keahlian")}</span></button></li>)}</ul>}
      </div>
      {selected !== null && <div ref={reviewPane} className="min-w-0 scroll-mt-24">{view === "records" ? detailError ? <p role="alert" className="text-danger text-sm">{detailError}</p> : detail && detail.kind === kind && detail.id === selected ? <RecordReview key={`${detail.kind}-${detail.id}-${detail.snapshot}-${detail.decision?.version ?? 0}`} detail={detail} onSaved={saved} onRelated={(nextKind,id) => { setKind(nextKind); setFilter("all"); setPage(0); setSelected(id); }} /> : <SkelRows rows={5} /> : employee && <StaffSetup key={`${employee.id}-${employee.version}`} employee={employee} onSaved={saved} />}</div>}
    </div>}
  </div>;
}
