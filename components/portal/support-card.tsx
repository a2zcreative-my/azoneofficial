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
import { btnClass, btnSm, btnSmPrimary, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, selectClassSm, textareaClass } from "@/lib/ui-styles";
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
const critical = (r: ReportRow) => r.status !== "completed" && (r.kind === "security" || r.priority === "urgent");

export function ReportsRegister() {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState<{ rows: ReportRow[] } | "denied" | "failed" | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "completed" | "critical">("all");
  const [page, setPage] = useState(1);
  const portal = useOptionalPortal();
  useEffect(() => {
    let live = true;
    void api<{ reports: ReportRow[] }>("/staff/support/reports").then((r) => {
      if (live) setGot(r.ok && r.data ? { rows: r.data.reports } : r.status === 403 ? "denied" : "failed");
    });
    return () => { live = false; };
  }, [tick]);
  const rows = useMemo(() => (got && typeof got === "object" ? got.rows : []), [got]);
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const done = rows.filter((r) => r.status === "completed" && Number.isFinite(parseT(r.closed_at)) && Number.isFinite(parseT(r.created_at)));
  const avgH = done.length ? done.reduce((a, r) => a + (parseT(r.closed_at) - parseT(r.created_at)) / 3600_000, 0) / done.length : null;
  const shown = useMemo(() => rows.filter((r) => filter === "all" || (filter === "critical" ? critical(r) : r.status === filter)), [rows, filter]);
  const [seen, setSeen] = useState(filter);
  if (seen !== filter) { setSeen(filter); setPage(1); }
  const pick = (f: typeof filter) => setFilter((x) => (x === f ? "all" : f));
  const cols: TableCol<ReportRow>[] = [
    { key: "id", label: "#", cell: (r) => <span className="erp-nowrap">#{r.id}</span> },
    { key: "subject", label: L("Subject", "Subjek"), main: true, cell: (r) => <span className={css.subject}><strong>{r.title.replace(/^\[[^\]]+\]\s*/, "")}</strong>{r.reporter && <small>{L(`by ${r.reporter}`, `oleh ${r.reporter}`)}</small>}</span> },
    { key: "kind", label: L("Category", "Kategori"), cell: (r) => <span>{L(r.kind_label, KIND_MS[r.kind ?? ""] ?? r.kind_label)}</span> },
    { key: "sev", label: L("Severity", "Keterukan"), cell: (r) => <span className={r.kind === "security" || r.priority === "urgent" ? chipSmDanger : r.priority === "high" ? chipSmWarn : chipSmNeutral}>{r.kind === "security" ? L("Critical", "Kritikal") : r.priority === "high" ? L("High", "Tinggi") : r.priority === "urgent" ? L("Urgent", "Segera") : L("Normal", "Biasa")}</span> },
    { key: "status", label: L("Status", "Status"), cell: (r) => { const c = STATUS_CHIP[r.status] ?? [chipSmNeutral, r.status, r.status]; return <span className={c[0]}>{L(c[1], c[2])}</span>; } },
    { key: "when", label: L("Reported", "Dilaporkan"), cell: (r) => <span className="erp-nowrap">{myt(r.created_at)}</span> },
  ];
  if (got === "denied") return <p className={ap.sub}>{L("The report receiver, the company owner, the CEO and the Super Admin see the reports.", "Penerima laporan, pemilik syarikat, CEO dan Super Admin melihat laporan.")}</p>;
  return (
    <section className={card} aria-label={L("Security and problem reports", "Laporan keselamatan dan masalah")} data-testid="reports-register">
      <div className={ap.head}>
        <div>
          <h3 className={ap.title}>{L("Reports", "Laporan")}</h3>
          <p className={ap.sub}>{L("Every report, security incidents included, is a task - it is reviewed and closed there. A row opens it.", "Setiap laporan, termasuk insiden keselamatan, ialah satu tugasan - ia disemak dan ditutup di sana. Satu baris membukanya.")}</p>
        </div>
        <ReportProblem tab="Users & Security" onSent={() => setTick((n) => n + 1)}
          trigger={(open) => <button type="button" className={btnSmPrimary} onClick={open} data-testid="new-report"><AppIcon name="add" />{L("New report", "Laporan baharu")}</button>} />
      </div>
      {got === "failed" ? <p role="alert" className={ap.error}>{L("The reports could not be read - the server may need the latest release.", "Laporan tidak dapat dibaca - pelayan mungkin memerlukan keluaran terkini.")}</p> : (
        <>
          <KpiRow label={L("Report figures", "Angka laporan")} testid="reports-strip">
            <KpiTile icon="warning" tone="gold" label={L("Open", "Terbuka")} busy={got === null} value={count("open")} onClick={() => pick("open")} pressed={filter === "open"} />
            <KpiTile icon="pending" tone="blue" label={L("In Progress", "Dalam Proses")} busy={got === null} value={count("in_progress")} onClick={() => pick("in_progress")} pressed={filter === "in_progress"} />
            <KpiTile icon="success" tone="green" label={L("Resolved", "Selesai")} busy={got === null} value={count("completed")} onClick={() => pick("completed")} pressed={filter === "completed"} />
            <KpiTile icon="verify" tone="red" label={L("Critical", "Kritikal")} busy={got === null} value={rows.filter(critical).length} sub={L("Open security incidents", "Insiden keselamatan terbuka")} onClick={() => pick("critical")} pressed={filter === "critical"} />
            <KpiTile icon="time" tone="purple" label={L("Avg Resolution", "Purata Penyelesaian")} busy={got === null}
              value={avgH === null ? "—" : avgH < 48 ? L(`${avgH.toFixed(1)} hours`, `${avgH.toFixed(1)} jam`) : L(`${(avgH / 24).toFixed(1)} days`, `${(avgH / 24).toFixed(1)} hari`)}
              sub={done.length ? L(`From ${done.length} closed report(s)`, `Daripada ${done.length} laporan ditutup`) : L("No closed report yet", "Belum ada laporan ditutup")} />
          </KpiRow>
          {got === null ? <SkelRows rows={4} /> : (
            <CompactTaskTable rows={shown} cols={cols} label={L("Reports", "Laporan")} record="report" testid="reports-table"
              onOpen={(id) => portal?.openRecord("Tasks", "task", id)} page={page} size={10} onPage={setPage}
              empty={<p className={ap.sub}>{filter === "all" ? L("No reports yet.", "Belum ada laporan.") : L("Nothing in this filter.", "Tiada dalam penapis ini.")}</p>} />
          )}
        </>
      )}
    </section>
  );
}
