"use client";

/* v1.238.0 - REPORT A PROBLEM (the owner, 31-10-2026; claude/ACCOUNT-
   RECOVERY-AUDIT.md: "Use existing Tasks/Desk infrastructure ... Avoid a
   duplicate ticket-management system. Do not store passwords, tokens or
   sensitive account credentials in support reports").

   A report is a Task assigned to the person the company owner or the super
   admin chose here (SupportCard, Users -> Security & Settings), else the
   owner, else an active CEO. The reporter sees it in their own Tasks. What
   is attached: the tab, the portal version and the last refused request's
   status, code and route - never a body, a message or a password. The
   worker (POST /staff/support/report) decides everything. */

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { useOptionalPortal } from "@/components/portal/portal-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { L } from "@/components/portal/page-shared";
import { roleLabel } from "@/components/portal/users-shared";
import { api, lastApiError } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import { btnClass, btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split"; // v1.344.0
import ap from "./access-policy.module.css";
import css from "./support-card.module.css";

interface Settings {
  assignee: { id: number; name: string } | null;
  can_edit: boolean;
  people: { id: number; name: string; role: string }[];
  kinds: Record<string, string>;
}
const KIND_MS: Record<string, string> = {
  login: "Masalah log masuk", access: "Akses tiada", data: "Data salah",
  clock: "Gagal daftar masuk", quotation: "Ralat sebut harga", system: "Ralat sistem",
  security: "Insiden keselamatan", // v1.341.0
};
/* the same rule the worker refuses on - said before sending, not after */
const SECRETISH = /\b(password|kata laluan|passcode|pin)\s*[:=]/i;

function useSupport(enabled: boolean, tick: number) {
  const [got, setGot] = useState<{ d: Settings | null; e: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void api<Settings>("/staff/support/settings", { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : L("Problem reports need the latest server.", "Laporan masalah memerlukan pelayan terkini.") });
    });
    return () => c.abort();
  }, [enabled, tick]);
  return got;
}

/** Users -> Security & Settings: who receives problem reports. */
export function SupportCard() {
  const [tick, setTick] = useState(0);
  const s = useSupport(true, tick);
  const { show: toast, node: toastNode } = useSaveToast();
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = s?.d ?? null;
  const chosen = pick || d?.assignee?.id || 0;

  const save = async () => {
    setBusy(true); setError("");
    const r = await api<{ error?: { message?: string } }>("/staff/support/settings", { method: "POST", body: JSON.stringify({ user_id: chosen }) });
    setBusy(false);
    if (r.ok) { toast(L("Saved", "Disimpan"), L("Problem reports go to the new person", "Laporan masalah pergi kepada orang baharu")); setPick(0); setTick((n) => n + 1); }
    else setError(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan."));
  };

  return (
    <section className={card} aria-label={L("Problem reports", "Laporan masalah")}>
      {toastNode}
      <div className={ap.head}>
        <div>
          <h3 className={ap.title}>{L("Problem reports", "Laporan masalah")}</h3>
          <p className={ap.sub}>{L("Report a problem on the Desk becomes a task for this person - login trouble, missing access, wrong data, a clock-in that failed. A report never carries a password.", "Laporkan masalah di Meja menjadi tugasan untuk orang ini - masalah log masuk, akses tiada, data salah, daftar masuk yang gagal. Laporan tidak pernah membawa kata laluan.")}</p>
        </div>
      </div>
      {s?.e ? <p role="alert" className={ap.error}>{s.e}</p> : !d ? <SkelRows rows={1} /> : (
        <>
          <p className={css.who}>
            {d.assignee
              ? <><AppIcon name="person" /><span>{L("Reports go to", "Laporan pergi kepada")} <strong>{d.assignee.name}</strong></span></>
              : <><AppIcon name="warning" /><span>{L("Nobody receives reports yet - choose someone below.", "Tiada siapa menerima laporan lagi - pilih seseorang di bawah.")}</span></>}
          </p>
          {d.can_edit && (
            <fieldset className={ap.form} disabled={busy}>
              <div className={ap.formRow}>
                <label>{L("Send reports to", "Hantar laporan kepada")}
                  <select className={selectClassSm} value={chosen} onChange={(e) => setPick(Number(e.target.value))}>
                    {!chosen && <option value={0}>{L("Choose a person", "Pilih seseorang")}</option>}
                    {d.people.map((p) => <option key={p.id} value={p.id}>{p.name} - {roleLabel(p.role)}</option>)}
                  </select>
                </label>
                <button type="button" className={btnClass} disabled={!chosen || chosen === d.assignee?.id} onClick={() => void save()}>
                  <AppIcon name="save" />{L("Save", "Simpan")}
                </button>
              </div>
              {error && <p role="alert" className={ap.error}>{error}</p>}
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}

/** The Desk's "Report a problem" button and its sheet. */
export function ReportProblem({ tab, trigger, onSent }: { tab: string; trigger?: (open: () => void) => ReactNode; onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const s = useSupport(open, 0);
  const { show: toast, node: toastNode } = useSaveToast();
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ task: number; to: string } | null>(null);
  const kinds = s?.d?.kinds ?? {};
  const secret = SECRETISH.test(text);
  const close = () => { setOpen(false); setError(""); setDone(null); };

  const send = async () => {
    setBusy(true); setError("");
    const context = { tab, version: APP_VERSION, last_error: lastApiError() };
    const r = await api<{ task_id?: number; assigned_to?: string; error?: { message?: string } }>("/staff/support/report", {
      method: "POST", body: JSON.stringify({ kind, description: text.trim(), context }),
    });
    setBusy(false);
    if (r.ok && r.data?.task_id) {
      setDone({ task: r.data.task_id, to: r.data.assigned_to ?? "" });
      onSent?.(); // v1.341.0 - the register re-reads
      setKind(""); setText("");
      toast(L("Sent", "Dihantar"), L("Your report is a task now", "Laporan anda kini satu tugasan"));
    } else setError(r.data?.error?.message ?? (r.status === 0 ? L("No connection - nothing was sent. Try again when you are online.", "Tiada sambungan - tiada apa dihantar. Cuba lagi apabila dalam talian.") : L("The report was not sent.", "Laporan tidak dihantar.")));
  };

  return (
    <>
      {toastNode}
      {trigger ? trigger(() => setOpen(true)) : <button type="button" className={btnSm} onClick={() => setOpen(true)}><AppIcon name="fix" />{L("Report a problem", "Laporkan masalah")}</button>}
      <SideDrawer open={open} onClose={close} title={L("Report a problem", "Laporkan masalah")}
        subtitle={L("It becomes a task for the person who looks after the portal", "Ia menjadi tugasan untuk orang yang menjaga portal")}>
        {!s ? <SkelRows rows={3} /> : s.e ? <p role="alert" className={ap.error}>{s.e}</p> : done ? (
          <div className={css.done} role="status">
            <AppIcon name="success" />
            <p>{L(`Sent as task #${done.task}${done.to ? ` to ${done.to}` : ""}. You will see it in your Tasks.`, `Dihantar sebagai tugasan #${done.task}${done.to ? ` kepada ${done.to}` : ""}. Anda akan melihatnya dalam Tugasan anda.`)}</p>
            <button type="button" className={btnSm} onClick={() => setDone(null)}>{L("Report another", "Laporkan lagi")}</button>
          </div>
        ) : (
          <fieldset className={css.form} disabled={busy}>
            <label>{L("What kind of problem?", "Jenis masalah?")}
              <select className={selectClassSm} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">{L("Choose one", "Pilih satu")}</option>
                {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{L(v, KIND_MS[k] ?? v)}</option>)}
              </select>
            </label>
            <label>{L("What happened?", "Apa yang berlaku?")}
              <textarea className={textareaClass} rows={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={L("What you were doing, what you expected, what you saw instead", "Apa yang anda lakukan, apa yang dijangka, apa yang anda lihat")} />
            </label>
            <p className={secret ? css.warn : css.note}>
              <AppIcon name={secret ? "warning" : "lock"} />
              {secret
                ? L("Take the password out - nobody needs it to help you, and the report would be refused.", "Keluarkan kata laluan - tiada siapa memerlukannya untuk membantu anda, dan laporan akan ditolak.")
                : L("Never write a password, an authenticator code or a backup code here.", "Jangan sekali-kali tulis kata laluan, kod pengesah atau kod sandaran di sini.")}
            </p>
            <p className={css.note}><AppIcon name="info" />{L(`Sent with it: this tab (${tab}), portal ${APP_VERSION}${lastApiError() ? `, the last refused request (${lastApiError()})` : ""}.`, `Dihantar bersama: tab ini (${tab}), portal ${APP_VERSION}${lastApiError() ? `, permintaan terakhir yang ditolak (${lastApiError()})` : ""}.`)}</p>
            {error && <p role="alert" className={ap.error}>{error}</p>}
            <div className={css.actions}>
              <button type="button" className={btnClass} disabled={!kind || text.trim().length < 10 || secret} onClick={() => void send()}>
                <AppIcon name="next" />{busy ? L("Sending…", "Menghantar…") : L("Send report", "Hantar laporan")}
              </button>
            </div>
          </fieldset>
        )}
      </SideDrawer>
    </>
  );
}

/* v1.341.0 - THE REPORTS REGISTER (the CEO's picture, 17-11-2026: "support
   authorized security incident reporting and review without duplicating
   existing reporting workflows"). Read-only, over GET /staff/support/reports:
   every row IS the Task the report made, so its status and closing time are
   the task's own and the review happens in that task (a row opens it). New
   report is the same Report a problem sheet; a security incident is one of
   its kinds (high priority, the same receiver). The receiver, the company
   owner, the CEO and the Super Admin read it - the server decides. */
interface ReportRow { id: number; title: string; priority: string; status: string; stage: string | null; created_at: string; kind: string | null; kind_label: string; reporter: string | null; assignee: string | null; closed_at: string | null }
const STATUS_CHIP: Record<string, [string, string, string]> = {
  open: [chipSmWarn, "Open", "Terbuka"], in_progress: [chipSmInfo, "In progress", "Dalam proses"], completed: [chipSmSuccess, "Resolved", "Selesai"],
};
const parseT = (s: string | null) => (s ? Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`) : NaN);
const myt = (s: string | null) => {
  const t = parseT(s); if (!Number.isFinite(t)) return "—";
  const d = new Date(t + 8 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
};
const mytFull = (s: string | null) => {
  const t = parseT(s); if (!Number.isFinite(t)) return "—";
  const d = new Date(t + 8 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const critical = (r: ReportRow) => r.status !== "completed" && (r.kind === "security" || r.priority === "urgent");

/* v1.344.0 (image 03) - Problem reports as incident management: the register
   with search and filters (left), the SELECTED incident (right) and its
   resolution trail (below, GET /staff/support/reports/:id/trail - the report
   and its task's own updates). Every row is still the Task the report made;
   the review and the closing happen there. Read-only here. */
const sevOf = (r: ReportRow): "critical" | "high" | "normal" => (r.kind === "security" || r.priority === "urgent" ? "critical" : r.priority === "high" ? "high" : "normal");
const SEV: Record<"critical" | "high" | "normal", [string, string, string]> = {
  critical: [chipSmDanger, "Critical", "Kritikal"], high: [chipSmWarn, "High", "Tinggi"], normal: [chipSmNeutral, "Normal", "Biasa"],
};
interface TrailRow { kind: string; created_at: string; actor: string | null; text: string | null }
const TRAIL_WORD: Record<string, [string, string]> = {
  "support.report": ["Reported", "Dilaporkan"], progress: ["Progress update", "Kemas kini kemajuan"], blocker: ["Blocked", "Tersekat"],
  review_request: ["Sent for review", "Dihantar untuk semakan"], review_approved: ["Approved - closed", "Diluluskan - ditutup"], review_returned: ["Returned", "Dikembalikan"],
  closed: ["Closed", "Ditutup"], closed_with_exception: ["Closed with an exception", "Ditutup dengan pengecualian"], reopened: ["Reopened", "Dibuka semula"],
  cancel: ["Cancelled", "Dibatalkan"], note: ["Note", "Nota"], file: ["File added", "Fail ditambah"], waiting_client: ["Waiting", "Menunggu"],
};

export function ReportsRegister() {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState<{ rows: ReportRow[] } | "denied" | "failed" | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "completed" | "critical">("all");
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<"" | "critical" | "high" | "normal">("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);
  const [trail, setTrail] = useState<{ id: number; rows: TrailRow[] | null }>({ id: 0, rows: null });
  const portal = useOptionalPortal();
  useEffect(() => {
    let live = true;
    void api<{ reports: ReportRow[] }>("/staff/support/reports").then((r) => {
      if (live) setGot(r.ok && r.data ? { rows: r.data.reports } : r.status === 403 ? "denied" : "failed");
    });
    return () => { live = false; };
  }, [tick]);
  const rows = useMemo(() => (got && typeof got === "object" ? got.rows : []), [got]);
  const sel = rows.find((r) => r.id === picked) ?? rows[0] ?? null;
  useEffect(() => {
    if (!sel) return;
    let live = true;
    void api<{ trail: TrailRow[] }>(`/staff/support/reports/${sel.id}/trail`).then((r) => { if (live) setTrail({ id: sel.id, rows: r.ok && r.data ? r.data.trail : [] }); });
    return () => { live = false; };
  }, [sel?.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const done = rows.filter((r) => r.status === "completed" && Number.isFinite(parseT(r.closed_at)) && Number.isFinite(parseT(r.created_at)));
  const avgH = done.length ? done.reduce((a, r) => a + (parseT(r.closed_at) - parseT(r.created_at)) / 3600_000, 0) / done.length : null;
  const shown = useMemo(() => rows.filter((r) => (filter === "all" || (filter === "critical" ? critical(r) : r.status === filter))
    && (!sev || sevOf(r) === sev)
    && (!q.trim() || `#${r.id} ${r.title} ${r.reporter ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, filter, sev, q]);
  const fkey = `${filter}|${sev}|${q}`;
  const [seen, setSeen] = useState(fkey);
  if (seen !== fkey) { setSeen(fkey); setPage(1); }
  const pick = (f: typeof filter) => setFilter((x) => (x === f ? "all" : f));
  const openTask = (id: number) => portal?.openRecord("Tasks", "task", id);
  const subject = (r: ReportRow) => r.title.replace(/^\[[^\]]+\]\s*/, "");
  const statusChip = (st: string) => { const c = STATUS_CHIP[st] ?? [chipSmNeutral, st, st]; return <span className={c[0]}>{L(c[1], c[2])}</span>; };
  const cols: TableCol<ReportRow>[] = [
    { key: "subject", label: L("Report", "Laporan"), main: true, cell: (r) => <span className={css.subject}><strong>{subject(r)}</strong><small>#{r.id}{r.reporter ? L(` · by ${r.reporter}`, ` · oleh ${r.reporter}`) : ""}</small></span> },
    { key: "kind", label: L("Category", "Kategori"), cell: (r) => <span>{L(r.kind_label, KIND_MS[r.kind ?? ""] ?? r.kind_label)}</span> },
    { key: "sev", label: L("Severity", "Keterukan"), cell: (r) => { const v = SEV[sevOf(r)]; return <span className={v[0]}>{L(v[1], v[2])}</span>; } },
    { key: "status", label: L("Status", "Status"), cell: (r) => statusChip(r.status) },
    { key: "when", label: L("Reported", "Dilaporkan"), cell: (r) => <span className="erp-nowrap">{myt(r.created_at)}</span> },
  ];
  type TRow = TrailRow & { id: number };
  const trailRows: TRow[] = trail.id === sel?.id && trail.rows ? trail.rows.map((t, i) => ({ ...t, id: i + 1 })) : [];
  const trailCols: TableCol<TRow>[] = [
    { key: "what", label: L("Action", "Tindakan"), main: true, cell: (t) => <span className={css.subject}><strong>{TRAIL_WORD[t.kind] ? L(TRAIL_WORD[t.kind]![0], TRAIL_WORD[t.kind]![1]) : t.kind}</strong>{t.text && <small>{t.text.slice(0, 140)}</small>}</span> },
    { key: "who", label: L("Actor", "Pelaku"), cell: (t) => <span>{t.actor ?? "—"}</span> },
    { key: "when", label: L("When (MYT)", "Bila (MYT)"), cell: (t) => <span className="erp-nowrap">{mytFull(t.created_at)}</span> },
  ];
  if (got === "denied") return <p className={ap.sub}>{L("The report receiver, the company owner, the CEO and the Super Admin see the reports.", "Penerima laporan, pemilik syarikat, CEO dan Super Admin melihat laporan.")}</p>;
  if (got === "failed") return <p role="alert" className={ap.error}>{L("The reports could not be read - the server may need the latest release.", "Laporan tidak dapat dibaca - pelayan mungkin memerlukan keluaran terkini.")}</p>;
  return (
    <div className={css.stack} data-testid="reports-register">
      <KpiRow label={L("Report figures", "Angka laporan")} testid="reports-strip">
        <KpiTile icon="warning" tone="gold" label={L("Open Reports", "Laporan Terbuka")} busy={got === null} value={count("open")} sub={L("Not started yet", "Belum dimulakan")} onClick={() => pick("open")} pressed={filter === "open"} />
        <KpiTile icon="pending" tone="blue" label={L("In Progress", "Dalam Proses")} busy={got === null} value={count("in_progress")} sub={L("Assigned and being worked on", "Ditugaskan dan sedang diusahakan")} onClick={() => pick("in_progress")} pressed={filter === "in_progress"} />
        <KpiTile icon="success" tone="green" label={L("Resolved", "Selesai")} busy={got === null} value={count("completed")} sub={L("Closed reports", "Laporan ditutup")} onClick={() => pick("completed")} pressed={filter === "completed"} />
        <KpiTile icon="verify" tone="red" label={L("Critical", "Kritikal")} busy={got === null} value={rows.filter(critical).length} sub={L("Open security incidents", "Insiden keselamatan terbuka")} onClick={() => pick("critical")} pressed={filter === "critical"} />
        <KpiTile icon="time" tone="purple" label={L("Avg Resolution", "Purata Penyelesaian")} busy={got === null}
          value={avgH === null ? "—" : avgH < 48 ? L(`${avgH.toFixed(1)} hours`, `${avgH.toFixed(1)} jam`) : L(`${(avgH / 24).toFixed(1)} days`, `${(avgH / 24).toFixed(1)} hari`)}
          sub={done.length ? L(`From ${done.length} closed report(s)`, `Daripada ${done.length} laporan ditutup`) : L("No closed report yet", "Belum ada laporan ditutup")} />
      </KpiRow>
      <WorkspaceSplit testid="reports-split" ratio="60-40">
        <SplitPane testid="reports-list" title={L("Problem Reports & Incidents", "Laporan Masalah & Insiden")} sub={L("Every report is a task; security incidents included", "Setiap laporan ialah tugasan; termasuk insiden keselamatan")} label={L("Problem reports and incidents", "Laporan masalah dan insiden")}
          actions={<ReportProblem tab="Users & Security" onSent={() => setTick((n) => n + 1)}
            trigger={(open) => <button type="button" className={btnSmPrimary} onClick={open} data-testid="new-report"><AppIcon name="add" />{L("New report", "Laporan baharu")}</button>} />}
          toolbar={<>
            <input className={inputClassSm} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search report ID or subject", "Cari ID laporan atau subjek")} aria-label={L("Search reports", "Cari laporan")} data-testid="reports-search" />
            <select className={selectClassSm} value={sev} onChange={(e) => setSev(e.target.value as typeof sev)} aria-label={L("Severity", "Keterukan")}>
              <option value="">{L("Any severity", "Semua keterukan")}</option>
              <option value="critical">{L("Critical", "Kritikal")}</option><option value="high">{L("High", "Tinggi")}</option><option value="normal">{L("Normal", "Biasa")}</option>
            </select>
            <select className={selectClassSm} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={L("Status", "Status")}>
              <option value="all">{L("Any status", "Semua status")}</option>
              <option value="open">{L("Open", "Terbuka")}</option><option value="in_progress">{L("In progress", "Dalam proses")}</option><option value="completed">{L("Resolved", "Selesai")}</option><option value="critical">{L("Critical, open", "Kritikal, terbuka")}</option>
            </select>
          </>}>
          {got === null ? <SkelRows rows={4} /> : (
            <CompactTaskTable rows={shown} cols={cols} label={L("Reports", "Laporan")} record="report" testid="reports-table" picked={sel?.id ?? null}
              onOpen={(id) => setPicked(id)} page={page} size={8} onPage={setPage}
              empty={<p className={ap.sub}>{filter === "all" && !q && !sev ? L("No reports yet.", "Belum ada laporan.") : L("Nothing matches.", "Tiada yang sepadan.")}</p>} />
          )}
        </SplitPane>
        <SplitPane testid="selected-incident" title={L("Selected Incident", "Insiden Dipilih")} sub={sel ? `#${sel.id} · ${subject(sel)}` : L("Choose a report on the left", "Pilih laporan di sebelah kiri")} label={L("Selected incident", "Insiden dipilih")}
          foot={sel ? <span className={css.footRow}><button type="button" className={btnSmPrimary} onClick={() => openTask(sel.id)} data-testid="review-incident">{L("Review in Tasks", "Semak dalam Tugasan")}</button></span> : undefined}>
          {!sel ? <p className={ap.sub}>{L("Click a report to see its state, owner and trail here.", "Klik laporan untuk melihat keadaan, pemilik dan jejaknya di sini.")}</p> : (
            <ul className={`erp-listbox ${css.facts}`} data-testid="incident-facts">
              <li><span className={css.factText}><strong>{L("Severity & current state", "Keterukan & keadaan semasa")}</strong><small>{L(sel.kind_label, KIND_MS[sel.kind ?? ""] ?? sel.kind_label)} · {L(`reported ${myt(sel.created_at)}`, `dilaporkan ${myt(sel.created_at)}`)}</small></span>
                <span className={css.factChips}>{(() => { const v = SEV[sevOf(sel)]; return <span className={v[0]}>{L(v[1], v[2])}</span>; })()}{statusChip(sel.status)}</span></li>
              <li><span className={css.factText}><strong>{L("Owner / response", "Pemilik / tindak balas")}</strong><small>{sel.assignee ? L(`Assigned to ${sel.assignee}`, `Ditugaskan kepada ${sel.assignee}`) : L("Not assigned", "Belum ditugaskan")}{sel.reporter ? L(` · reported by ${sel.reporter}`, ` · dilaporkan oleh ${sel.reporter}`) : ""}</small></span>
                <button type="button" className={btnSm} onClick={() => openTask(sel.id)}>{L("Reassign in Tasks", "Tugaskan semula")}</button></li>
              <li><span className={css.factText}><strong>{L("Evidence & timeline", "Bukti & garis masa")}</strong><small>{sel.closed_at ? L(`Closed ${mytFull(sel.closed_at)}`, `Ditutup ${mytFull(sel.closed_at)}`) : L("Updates and files live in the task", "Kemas kini dan fail berada dalam tugasan")}</small></span>
                <button type="button" className={btnSm} onClick={() => openTask(sel.id)}>{L("Open details", "Buka butiran")}</button></li>
            </ul>
          )}
        </SplitPane>
      </WorkspaceSplit>
      <section className="erp-card" aria-label={L("Resolution and audit trail", "Jejak penyelesaian dan audit")} data-testid="report-trail">
        <header className={css.head}><h3>{L("Resolution & Audit Trail", "Jejak Penyelesaian & Audit")}</h3>
          <p>{sel ? L(`Everything recorded against report #${sel.id}`, `Semua yang direkodkan untuk laporan #${sel.id}`) : L("Choose a report", "Pilih laporan")}</p></header>
        {!sel ? null : trail.id !== sel.id || trail.rows === null ? <SkelRows rows={2} /> : (
          <CompactTaskTable rows={trailRows} cols={trailCols} label={L("Resolution trail", "Jejak penyelesaian")} record="trail" testid="trail-table" onOpen={() => openTask(sel.id)} dense
            empty={<p className={ap.sub}>{L("Nothing recorded yet beyond the report.", "Belum ada rekod selain laporan.")}</p>} />
        )}
      </section>
    </div>
  );
}
