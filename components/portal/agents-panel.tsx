"use client";

/* v1.249.0 - THE AGENT DESK. v1.250.0 - THE AGENT PORTAL WORKFLOW (the owner's
   brief "Complete Agent Portal, Client Submission, Quotation Distribution &
   Collaboration", claude/AGENT-PORTAL-AUDIT.md, his "Approved", 01-11-2026).
   v1.250.2 - "FIX AGENT PORTAL ACTIONS, REQUEST SUBMISSION & PROGRESS UPDATES"
   (the owner, 01-11-2026): every action has a visible button.

   One tab, two views decided by the server's answer, never by the menu:

   - An AGENT (their whole portal - no Tasks since 1.250.2): Overview,
     Packages, Requests, Quotations - the phone bar's four stops - with a
     prominent "+ Submit Client Request" on every view, an empty state that
     offers it, and each request opening on Overview (progress, details,
     the published quotation) / Updates & Comments / Files with a visible
     "+ Add Status Update": one form for every report (progress, client
     feedback, shared, interested, revision, declined, acceptance with
     evidence). Reports are events; Sales decides the official records.
   - SALES & MANAGEMENT: Overview, Requests, Agents (the real agent accounts,
     verified email, active or suspended, scope, requests, latest activity)
     and "Manage Agent Access" for the owner and the super admin - it opens
     Users > Customer Accounts, the one place agent access is given.

   The quotation stays in Sales: nothing here prices, issues, signs or marks
   paid. The server decides every action (worker/src/agent.ts). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, csrfFetch } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { usePortal } from "@/components/portal/portal-provider";
import { fmtRM } from "@/lib/format";
import { useSaveToast } from "@/components/ui/save-toast";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelCard, SkelRows } from "@/components/ui/skeleton";
import { LineTabs } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { AppIcon } from "@/components/ui/app-icon";
import { btnClass, btnSm, btnSmPrimary, btnSmQuiet, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./agents-panel.module.css";

type Status = "draft" | "submitted" | "under_review" | "more_info" | "preparing" | "quotation_ready" | "with_client" | "revision_requested" | "acceptance_pending" | "won" | "not_proceeding";
interface Pkg { id: number; name: string; category: string | null; description: string | null; issuers: string[]; total_cents: number; lines: { name: string; qty: number }[] }
interface Row {
  id: number; ref: string; agent_id: number; agent_name?: string | null; client_name: string; contact_person: string | null; company: string | null; client_phone: string | null; client_email: string | null;
  package_name: string | null; custom: number; status: Status; assigned_name: string | null; assigned_to?: number | null; published_number: string | null; published_revision: number | null;
  quotation_number?: string | null; next_follow_up_on?: string | null; overdue?: boolean; last_text: string | null; last_at: string | null; last_by: string | null; created_at: string;
}
interface ListRes { requests: Row[]; counts: Record<string, number>; can_manage: boolean; can_submit: boolean; mail_ready: boolean; me: number }
interface Ev { id: number; kind: string; visibility: "agent" | "internal"; body: string | null; next_action: string | null; follow_up_on: string | null; status_to: string | null; channel: string | null; created_at: string; actor: string | null; actor_id: number | null }
interface FileRow { id: number; file_name: string; visibility: "agent" | "internal"; created_at: string; uploader: string | null }
interface Qt { doc_number: string; revision: number; issuer_name: string; customer: string | null; total_cents: number; valid_until: string; lines: { name: string; qty: number }[]; link: string | null; notice: string | null; acceptance: { accepted_at: string } | null }
interface Detail {
  request: Row & { requirement: string | null; timeline: string | null; budget_text: string | null; note: string | null; issuer_code: string | null; quotation_id?: number | null; manager_note?: string | null };
  history: Ev[]; files: FileRow[]; quotation: Qt | null; mail_ready?: boolean;
  linked?: { id: number; doc_number: string; revision: number; total_cents: number; valid_until: string | null; voided_at: string | null; customer: string | null; acceptance: { accepted_name: string; accepted_at: string; channel: string | null } | null } | null;
  can: { edit?: boolean; share?: boolean; feedback?: boolean; handle?: boolean; manage?: boolean; to?: Status[]; publish?: boolean; verify?: boolean };
}

const ISSUER: Record<string, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
const WORD: Record<Status, [string, string]> = {
  draft: ["Draft", "Draf"], submitted: ["Submitted", "Dihantar"], under_review: ["Under review", "Dalam semakan"], more_info: ["More info needed", "Perlu maklumat"],
  preparing: ["Preparing quotation", "Menyediakan sebut harga"], quotation_ready: ["Quotation ready", "Sebut harga sedia"], with_client: ["With client", "Dengan pelanggan"],
  revision_requested: ["Revision requested", "Minta semakan"], acceptance_pending: ["Acceptance to verify", "Penerimaan untuk disahkan"], won: ["Won", "Berjaya"], not_proceeding: ["Not proceeding", "Tidak diteruskan"],
};
const word = (s: Status) => L(WORD[s][0], WORD[s][1]);
const TONE: Record<Status, string | undefined> = {
  draft: css.off, submitted: css.off, under_review: css.info, more_info: css.wait, preparing: css.violet, quotation_ready: css.ok,
  with_client: css.info, revision_requested: css.wait, acceptance_pending: css.gold, won: css.ok, not_proceeding: css.bad,
};
const OPEN: Status[] = ["submitted", "under_review", "more_info", "preparing", "quotation_ready", "with_client", "revision_requested", "acceptance_pending"];
const day = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("-") : "");
const when = (v: string | null | undefined) => (v ? `${day(v)} ${v.slice(11, 16)}` : "");
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const Chip = ({ s }: { s: Status }) => <span className={`${css.chip} ${TONE[s]}`}>{word(s)}</span>;

/* The four steps a request walks, for the progress line on its Overview */
const STEPS: [string, string][] = [["Submitted", "Dihantar"], ["Quotation ready", "Sebut harga sedia"], ["With client", "Dengan pelanggan"], ["Closed", "Ditutup"]];
const stepOf = (s: Status) => (s === "won" || s === "not_proceeding" ? 3 : ["with_client", "revision_requested", "acceptance_pending"].includes(s) ? 2 : s === "quotation_ready" ? 1 : 0);

type View = "overview" | "packages" | "requests" | "quotations" | "agents" | "commission";
const AGENT_VIEWS: View[] = ["overview", "packages", "requests", "quotations", "commission"];
const STAFF_VIEWS: View[] = ["overview", "requests", "agents", "packages"];

export function AgentsPanel({ role, owner = false, initialView }: { role: string; owner?: boolean; initialView?: string }) {
  const isAgent = role === "agent";
  const views = isAgent ? AGENT_VIEWS : STAFF_VIEWS;
  const canGrant = owner || role === "super_admin"; // the server decides; this only offers the way there
  const pick = (v?: string): View => (views.includes(v as View) ? v as View : isAgent ? "overview" : "requests");
  const [view, setView] = useState<View>(() => pick(initialView));
  /* the phone bar asked for another view: follow it (adjusted while rendering, not in an effect) */
  const [seenStart, setSeenStart] = useState(initialView);
  if (initialView !== seenStart) { setSeenStart(initialView); if (initialView) setView(pick(initialView)); }
  const [pkgs, setPkgs] = useState<Pkg[] | null>(null);
  const [list, setList] = useState<ListRes | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const [submit, setSubmit] = useState<{ pkg: Pkg | null } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [statusF, setStatusF] = useState<"" | Status | "open" | "overdue">("");
  const [q, setQ] = useState("");
  const { show, node: toastNode } = useSaveToast();
  const { setTab, setTabStart } = usePortal();
  useEffect(() => {
    const c = new AbortController();
    void api<{ packages?: Pkg[]; error?: { message?: string } }>("/staff/agent/packages", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok) setPkgs(r.data?.packages ?? []); else setFailed(r.data?.error?.message ?? L("The agent desk could not be loaded.", "Meja ejen tidak dapat dimuatkan."));
    });
    /* v1.250.1 - a refused or failed list says why; it used to leave the skeleton up for good */
    void api<ListRes & { error?: { message?: string } }>("/staff/agent/requests", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data) setList(r.data); else setFailed(r.data?.error?.message ?? L("The requests could not be loaded - try again.", "Permintaan tidak dapat dimuatkan - cuba lagi."));
    });
    return () => c.abort();
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const rows = useMemo(() => list?.requests ?? [], [list]);
  const shown = useMemo(() => rows.filter((r) => (!statusF || (statusF === "open" ? OPEN.includes(r.status) : statusF === "overdue" ? !!r.overdue : r.status === statusF))
    && (!q || `${r.ref} ${r.client_name} ${r.company ?? ""} ${r.agent_name ?? ""} ${r.package_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, statusF, q]);
  const cnt = (...s: Status[]) => s.reduce((n, k) => n + (list?.counts?.[k] ?? 0), 0);
  /* keep the phone bar's stop in step with the view shown */
  const go = (v: View, f: typeof statusF = "") => { setStatusF(f); setView(v); setTabStart({ tab: "Agents", view: v }); };
  const manageAccess = () => { setTabStart({ tab: "Users", view: "customers" }); setTab("Users"); };

  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  const tabs: readonly (readonly [View, string])[] = isAgent
    ? [["overview", L("Overview", "Ringkasan")], ["packages", L("Packages", "Pakej")], ["requests", L("My Requests", "Permintaan Saya")], ["quotations", L("My Quotations", "Sebut Harga Saya")], ["commission", L("My Commission", "Komisen Saya")]]
    : [["overview", L("Overview", "Ringkasan")], ["requests", L("Requests", "Permintaan")], ["agents", L("Agents", "Ejen")], ["packages", L("Packages", "Pakej")]];
  const submitBig = isAgent && list?.can_submit ? (
    <button type="button" className={css.bigBtn} data-testid="submit-client-request" onClick={() => setSubmit({ pkg: null })}><AppIcon name="add" />{L("Submit Client Request", "Hantar Permintaan Pelanggan")}</button>
  ) : null;
  const emptyAgent = (
    <div className={css.empty} data-testid="agent-empty">
      <p>{L("No client requests yet. Submit your first client request to get started.", "Belum ada permintaan pelanggan. Hantar permintaan pertama anda untuk bermula.")}</p>
      {submitBig}
    </div>
  );
  const emptyStaff = (
    <div className={css.empty} data-testid="staff-empty">
      <p>{L("No Agent submissions have been received yet.", "Belum ada permintaan daripada ejen.")}</p>
      <div className={css.row}>
        {canGrant && <button type="button" className={btnSmPrimary} onClick={manageAccess}><AppIcon name="users" />{L("Manage Agent Access", "Urus Akses Ejen")}</button>}
        <button type="button" className={btnSm} onClick={() => go("agents")}>{L("See the agents", "Lihat ejen")}</button>
      </div>
      <p className={css.muted}>{L("How it works: the owner gives a verified customer account Agent access; the agent submits a client; Sales prepares the quotation in Sales and publishes it to the agent; the agent shares it and reports back; Sales verifies the acceptance.", "Cara ia berfungsi: pemilik memberi akses Ejen kepada akaun pelanggan yang disahkan; ejen menghantar pelanggan; Jualan menyediakan sebut harga dan menerbitkannya kepada ejen; ejen berkongsi dan melapor; Jualan mengesahkan penerimaan.")}</p>
    </div>
  );

  return (
    <div className={css.wrap} data-testid="agents-panel">
      {toastNode}
      <header className={css.head}>
        <div>
          <h2 className={css.title}>{isAgent ? L("Agent workspace", "Ruang kerja ejen") : L("Agents", "Ejen")}</h2>
          <p className={css.sub}>{isAgent
            ? L("Bring us clients for the packages below. Sales prepares the official quotation; you share it and tell us what the client says.", "Bawa pelanggan untuk pakej di bawah. Jualan menyediakan sebut harga rasmi; anda kongsikan dan beritahu kami maklum balas pelanggan.")
            : L("Clients the agents bring in. Sales prepares the quotation in Sales, publishes it to the agent, and verifies the client's acceptance.", "Pelanggan yang dibawa ejen. Jualan menyediakan sebut harga dalam Jualan, menerbitkannya kepada ejen, dan mengesahkan penerimaan pelanggan.")}</p>
        </div>
        {!isAgent && canGrant && <button type="button" className={btnSm} data-testid="manage-agent-access" onClick={manageAccess}><AppIcon name="users" />{L("Manage Agent Access", "Urus Akses Ejen")}</button>}
      </header>
      <LineTabs value={view} onChange={(v) => go(v)} tabs={tabs} label={L("Agents", "Ejen")} />
      {isAgent && view !== "packages" && view !== "commission" && list && rows.length > 0 && submitBig}

      {view === "overview" && (!list ? <SkelCard lines={3} /> : (
        <>
          <KpiRow label={L("Requests by status", "Permintaan mengikut status")}>
            {isAgent ? (<>
              <KpiTile icon="assignment" tone="navy" label={L("Open requests", "Permintaan terbuka")} value={cnt(...OPEN)} onClick={() => go("requests", "open")} />
              <KpiTile icon="warning" tone="gold" label={L("Need your reply", "Perlu jawapan anda")} value={cnt("more_info")} onClick={() => go("requests", "more_info")} />
              <KpiTile icon="document" tone="green" label={L("Quotations ready", "Sebut harga sedia")} value={cnt("quotation_ready")} onClick={() => go("quotations")} />
              <KpiTile icon="chat" tone="blue" label={L("With clients", "Dengan pelanggan")} value={cnt("with_client", "revision_requested", "acceptance_pending")} onClick={() => go("quotations")} />
              <KpiTile icon="trophy" tone="purple" label={L("Won", "Berjaya")} value={cnt("won")} onClick={() => go("requests", "won")} />
            </>) : (<>
              <KpiTile icon="assignment" tone="navy" label={L("New", "Baharu")} value={cnt("submitted")} onClick={() => go("requests", "submitted")} />
              <KpiTile icon="search" tone="blue" label={L("Under review", "Dalam semakan")} value={cnt("under_review", "more_info")} onClick={() => go("requests", "under_review")} />
              <KpiTile icon="document" tone="purple" label={L("Preparing quotation", "Menyediakan sebut harga")} value={cnt("preparing", "revision_requested")} onClick={() => go("requests", "preparing")} />
              <KpiTile icon="chat" tone="green" label={L("With client", "Dengan pelanggan")} value={cnt("quotation_ready", "with_client")} onClick={() => go("requests", "with_client")} />
              <KpiTile icon="verify" tone="gold" label={L("Acceptance to verify", "Penerimaan untuk disahkan")} value={cnt("acceptance_pending")} onClick={() => go("requests", "acceptance_pending")} />
              <KpiTile icon="time" tone="red" label={L("Overdue follow-up", "Susulan lewat")} value={rows.filter((r) => r.overdue).length} onClick={() => go("requests", "overdue")} />
            </>)}
          </KpiRow>
          <section className={css.panel} aria-label={L("Latest", "Terkini")}>
            <h3 className={css.h3}>{L("Latest updates", "Kemas kini terkini")}</h3>
            {rows.filter((r) => r.status !== "draft").length === 0 && rows.length === 0 ? (isAgent ? emptyAgent : emptyStaff)
              : <RequestList rows={[...rows].filter((r) => r.status !== "draft" || isAgent).slice(0, 6)} isAgent={isAgent} onOpen={setOpen} />}
          </section>
        </>
      ))}

      {view === "packages" && (
        !pkgs ? <SkelCard lines={4} /> : pkgs.length === 0 ? <p className={css.muted}>{L("No active packages yet.", "Belum ada pakej aktif.")}</p> : (
          <ul className={css.grid}>
            {pkgs.map((p) => (
              <li key={p.id} className={css.card} data-testid={`agent-pkg-${p.id}`}>
                <div className={css.cardHead}><span className={css.cat}>{p.category ?? L("Package", "Pakej")}</span><span className={css.price}>{fmtRM(p.total_cents)}</span></div>
                <h3 className={css.pkgName}>{p.name}</h3>
                {p.description && <p className={css.desc}>{p.description}</p>}
                {p.lines.length > 0 && <ul className={css.lines}>{p.lines.slice(0, 6).map((l, i) => <li key={i}>{l.qty > 1 ? `${l.qty} × ` : ""}{l.name}</li>)}</ul>}
                <p className={css.muted}>{p.issuers.map((i) => ISSUER[i] ?? i).join(" · ")}</p>
                {isAgent && <button type="button" className={btnSmPrimary} onClick={() => setSubmit({ pkg: p })}>{L("Submit a client", "Hantar pelanggan")}</button>}
              </li>
            ))}
          </ul>
        )
      )}

      {view === "requests" && (
        !list ? <SkelRows rows={5} /> : rows.length === 0 ? (isAgent ? emptyAgent : emptyStaff) : (
          <section className={css.panel} aria-label={L("Requests", "Permintaan")}>
            <div className={css.toolbar}>
              <input className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={isAgent ? L("Find a client or request", "Cari pelanggan atau permintaan") : L("Find a client, agent or request", "Cari pelanggan, ejen atau permintaan")} aria-label={L("Find", "Cari")} />
              <select className={selectClassSm} value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} aria-label={L("Status", "Status")}>
                <option value="">{L("All statuses", "Semua status")}</option>
                <option value="open">{L("Open", "Terbuka")}</option>
                {!isAgent && <option value="overdue">{L("Overdue follow-up", "Susulan lewat")}</option>}
                {(Object.keys(WORD) as Status[]).filter((s) => isAgent || s !== "draft").map((s) => <option key={s} value={s}>{word(s)}</option>)}
              </select>
              <span className={css.muted}>{L(`${shown.length} shown`, `${shown.length} dipaparkan`)}</span>
            </div>
            {shown.length === 0 ? <p className={css.muted}>{L("No requests match this filter.", "Tiada permintaan sepadan dengan penapis ini.")}</p> : <RequestList rows={shown} isAgent={isAgent} onOpen={setOpen} />}
          </section>
        )
      )}

      {view === "quotations" && (!list ? <SkelRows rows={3} /> : (
        <section className={css.panel} aria-label={L("My quotations", "Sebut harga saya")}>
          {rows.filter((r) => r.published_number).length === 0
            ? <p className={css.empty}>{L("No quotation has been published to you yet. Sales publishes it here once it is approved.", "Belum ada sebut harga diterbitkan kepada anda. Jualan menerbitkannya di sini selepas diluluskan.")}</p>
            : <ul className={css.qlist}>{rows.filter((r) => r.published_number).map((r) => (
                <li key={r.id} className={css.qrow} data-testid={`agent-qt-${r.id}`}>
                  <div className={css.qmain}><span className={css.strong}>{r.published_number}{r.published_revision ? ` · REV ${r.published_revision}` : ""}</span><span className={css.muted}>{r.ref} · {r.company || r.client_name} · {r.package_name ?? L("Custom requirement", "Keperluan khas")}</span></div>
                  <Chip s={r.status} />
                  <button type="button" className={btnSm} onClick={() => setOpen(r.id)}>{L("Open", "Buka")}</button>
                </li>))}</ul>}
        </section>
      ))}

      {view === "agents" && !isAgent && <AgentsList canGrant={canGrant} onManage={manageAccess} />}
      {view === "commission" && isAgent && <MyCommission />}

      {submit && pkgs && <SubmitSheet pkgs={pkgs} initial={submit.pkg} onClose={() => setSubmit(null)} onDone={(draft) => { setSubmit(null); go("requests"); reload(); show(draft ? L("Draft saved", "Draf disimpan") : L("Sent to the sales team", "Dihantar kepada pasukan jualan")); }} />}
      {open !== null && <RequestDrawer id={open} isAgent={isAgent} canManage={!!list?.can_manage} onClose={() => setOpen(null)} onChanged={(msg) => { reload(); if (msg) show(msg); }} />}
    </div>
  );
}

/* A table on a desk; touch cards on a phone (the module's own CSS). */
function RequestList({ rows, isAgent, onOpen }: { rows: Row[]; isAgent: boolean; onOpen: (id: number) => void }) {
  return (
    <>
      <div className={`${css.tableWrap} ${css.deskOnly}`}>
        <table className={css.table}>
          <thead><tr>
            <th>{L("Request", "Permintaan")}</th>
            {!isAgent && <th>{L("Agent", "Ejen")}</th>}
            <th>{L("Client · package", "Pelanggan · pakej")}</th>
            {!isAgent && <th>{L("Sales", "Jualan")}</th>}
            <th>{L("Status", "Status")}</th>
            <th>{L("Latest update", "Kemas kini terkini")}</th>
            {!isAgent && <th>{L("Follow-up", "Susulan")}</th>}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`agent-req-${r.id}`}>
                <td><button type="button" className={css.linkBtn} onClick={() => onOpen(r.id)}>{r.ref}</button><span className={css.muted}>{day(r.created_at)}</span></td>
                {!isAgent && <td>{r.agent_name ?? "—"}</td>}
                <td><span className={css.strong}>{r.company || r.client_name}</span><span className={css.muted}>{r.package_name ?? L("Custom requirement", "Keperluan khas")}</span></td>
                {!isAgent && <td>{r.assigned_name ?? <span className={css.muted}>{L("Not assigned", "Belum ditugaskan")}</span>}</td>}
                <td><Chip s={r.status} />{r.published_number && <span className={css.muted}>{r.published_number}</span>}</td>
                <td><span className={css.clamp}>{r.last_text ?? "—"}</span><span className={css.muted}>{[r.last_by, when(r.last_at)].filter(Boolean).join(" · ")}</span></td>
                {!isAgent && <td className={r.overdue ? css.late : undefined}>{r.next_follow_up_on ? day(r.next_follow_up_on) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={`${css.cards} ${css.phoneOnly}`}>
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className={css.reqCard} data-testid={`agent-card-${r.id}`} onClick={() => onOpen(r.id)}>
              <span className={css.cardTop}><span className={css.strong}>{r.ref}</span><Chip s={r.status} /></span>
              <span className={css.strong}>{r.company || r.client_name}</span>
              <span className={css.muted}>{r.package_name ?? L("Custom requirement", "Keperluan khas")}{!isAgent && r.agent_name ? ` · ${r.agent_name}` : ""}</span>
              {r.last_text && <span className={css.clamp}>{r.last_text}</span>}
              <span className={css.muted}>{L("Updated", "Dikemas kini")} {when(r.last_at ?? r.created_at)}</span>
              <span className={css.chev} aria-hidden><AppIcon name="next" /></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

interface AgentRow { id: number; name: string; email: string; is_active: number; email_verified: number; requests: number; open_requests: number; won: number; last_activity: string | null; scope: string }
function AgentsList({ canGrant, onManage }: { canGrant: boolean; onManage: () => void }) {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [failed, setFailed] = useState("");
  const [asg, setAsg] = useState<AssignRes | null>(null);
  const [aTick, setATick] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const { show, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<{ agents?: AgentRow[]; error?: { message?: string } }>("/staff/agent/agents", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok) setAgents(r.data?.agents ?? []); else setFailed(r.data?.error?.message ?? L("The agents could not be loaded.", "Ejen tidak dapat dimuatkan."));
    });
    return () => c.abort();
  }, []);
  /* v1.255.0 - the standing salesperson of each agent (append-only history) */
  useEffect(() => {
    const c = new AbortController();
    void api<AssignRes>("/staff/agent/assignments", { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setAsg(r.data); });
    return () => c.abort();
  }, [aTick]);
  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  if (!agents) return <SkelRows rows={3} />;
  const manageBtn = canGrant ? <button type="button" className={btnSmPrimary} onClick={onManage}><AppIcon name="users" />{L("Manage Agent Access", "Urus Akses Ejen")}</button> : null;
  return (
    <section className={css.panel} aria-label={L("Agents", "Ejen")}>
      {toastNode}
      {agents.length === 0 ? (
        <div className={css.empty} data-testid="agents-empty">
          <p>{L("No active agents yet.", "Belum ada ejen aktif.")}</p>
          {manageBtn}
          <p className={css.muted}>{canGrant
            ? L("Agent access is given in Users › Customer Accounts to a customer account whose email is verified - the same account becomes an agent.", "Akses ejen diberi dalam Pengguna › Akaun Pelanggan kepada akaun pelanggan yang e-melnya disahkan - akaun yang sama menjadi ejen.")
            : L("The company owner gives Agent access in Users › Customer Accounts.", "Pemilik syarikat memberi akses Ejen dalam Pengguna › Akaun Pelanggan.")}</p>
        </div>
      ) : (<>
        <div className={css.row}>{manageBtn}<span className={css.muted}>{L("Taking access away keeps every request with its agent.", "Menarik akses kekalkan setiap permintaan bersama ejennya.")}</span></div>
        <ul className={css.agentList}>
          {agents.map((a) => (
            <li key={a.id} className={css.agentRow} data-testid={`agent-acct-${a.id}`}>
              <div className={css.qmain}>
                <span className={css.strong}>{a.name}</span>
                <span className={css.muted}>{a.email} <span className={`${css.chip} ${a.email_verified ? css.ok : css.wait}`}>{a.email_verified ? L("Verified email", "E-mel disahkan") : L("Email not verified", "E-mel belum disahkan")}</span></span>
                <span className={css.muted}>{L("Scope", "Skop")}: {a.scope}</span>
              </div>
              <span className={`${css.chip} ${a.is_active ? css.ok : css.off}`}>{a.is_active ? L("Active", "Aktif") : L("Suspended", "Digantung")}</span>
              <span className={css.stat}><strong>{a.requests}</strong> {L("requests", "permintaan")} · {a.open_requests} {L("open", "terbuka")} · {a.won} {L("won", "berjaya")}</span>
              <span className={css.muted}>{L("Latest activity", "Aktiviti terkini")}: {a.last_activity ? when(a.last_activity) : L("none yet", "belum ada")}</span>
              <span className={css.muted} data-testid={`agent-assigned-${a.id}`}>{L("Assigned salesperson", "Jurujual ditugaskan")}: {asg?.current?.[a.id] ? `${asg.current[a.id]!.salesperson_name} · ${L("from", "mulai")} ${day(asg.current[a.id]!.effective_from)}` : L("none - Sales assigns each request", "tiada - Jualan menugaskan setiap permintaan")}
                {asg?.can_manage && editing !== a.id && <> <button type="button" className={btnSmQuiet} onClick={() => setEditing(a.id)}>{asg.current?.[a.id] ? L("Change", "Tukar") : L("Assign", "Tugaskan")}</button></>}</span>
              {asg?.can_manage && editing === a.id && <AssignForm agentId={a.id} people={asg.salespeople} today={asg.today ?? ""} onClose={() => setEditing(null)} onDone={(name) => { setEditing(null); setATick((t) => t + 1); show(L(`Assigned to ${name}`, `Ditugaskan kepada ${name}`), L("New requests go to them; past requests keep whom they had", "Permintaan baharu pergi kepada mereka; permintaan lama kekal")); }} />}
            </li>
          ))}
        </ul>
      </>)}
    </section>
  );
}

/* ------------------------------------------------------------- submit */
function SubmitSheet({ pkgs, initial, onClose, onDone }: { pkgs: Pkg[]; initial: Pkg | null; onClose: () => void; onDone: (draft: boolean) => void }) {
  /* skeleton: none - the form is drawn in full from the packages already loaded */
  const [f, setF] = useState({ client_name: "", contact_person: "", client_phone: "", client_email: "", package_id: initial?.id ?? 0, custom: false, issuer_code: "", requirement: "", timeline: "", budget_text: "", note: "" });
  const key = useRef(newKey());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const pkg = pkgs.find((p) => p.id === f.package_id) ?? null;
  const ready = f.client_name.trim().length >= 2 && !!(f.client_phone.trim() || f.client_email.trim()) && (!!f.package_id || (f.custom && f.requirement.trim().length >= 10));
  const send = async (draft: boolean) => {
    setBusy(true); setProblem("");
    const r = await api<{ id?: number; error?: { message?: string } }>("/staff/agent/requests", { method: "POST", body: JSON.stringify({
      ...f, package_id: f.custom ? null : f.package_id || null, issuer_code: f.custom ? f.issuer_code || null : pkg?.issuers.length === 1 ? pkg.issuers[0] : f.issuer_code || null, draft, client_key: key.current,
    }) });
    if (!r.ok || !r.data?.id) { setBusy(false); setProblem(r.data?.error?.message ?? L("Not sent - try again", "Tidak dihantar - cuba lagi")); return; }
    if (file && !draft) {
      const up = await uploadFile(r.data.id, file, "agent");
      if (!up.ok) { setBusy(false); setProblem(L(`The request was sent, but the file was not: ${up.msg}`, `Permintaan dihantar, tetapi fail tidak: ${up.msg}`)); return; }
    }
    setBusy(false);
    onDone(draft);
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <SideDrawer open onClose={onClose} full title={L("Submit Client Request", "Hantar Permintaan Pelanggan")} subtitle={L("Sales prepares the official quotation from this.", "Jualan menyediakan sebut harga rasmi daripada ini.")}
      footer={<div className={css.footer}>
        <button type="button" className={btnSm} disabled={busy || f.client_name.trim().length < 2} onClick={() => void send(true)}>{L("Save draft", "Simpan draf")}</button>
        <button type="button" className={btnClass} disabled={busy || !ready} aria-busy={busy || undefined} onClick={() => void send(false)}>{busy ? L("Sending…", "Menghantar…") : L("Send to Sales", "Hantar kepada Jualan")}</button>
      </div>}>
      <div className={css.form}>
        <label className={css.field}><span>{L("Client or company *", "Pelanggan atau syarikat *")}</span><input className={inputClass} value={f.client_name} onChange={set("client_name")} /></label>
        <label className={css.field}><span>{L("Contact person", "Orang untuk dihubungi")}</span><input className={inputClass} value={f.contact_person} onChange={set("contact_person")} /></label>
        <div className={css.two}>
          <label className={css.field}><span>{L("Phone", "Telefon")}</span><input className={inputClass} type="tel" inputMode="tel" value={f.client_phone} onChange={set("client_phone")} /></label>
          <label className={css.field}><span>{L("Email", "E-mel")}</span><input className={inputClass} type="email" inputMode="email" value={f.client_email} onChange={set("client_email")} /></label>
        </div>
        <p className={css.muted}>{L("A phone or an email is needed so Sales can reach the client.", "Telefon atau e-mel diperlukan supaya Jualan boleh menghubungi pelanggan.")}</p>
        <label className={css.field}><span>{L("Package *", "Pakej *")}</span>
          <select className={inputClass} value={f.custom ? "custom" : String(f.package_id || "")} onChange={(e) => setF({ ...f, custom: e.target.value === "custom", package_id: e.target.value === "custom" ? 0 : Number(e.target.value) })}>
            <option value="">{L("Choose a package…", "Pilih pakej…")}</option>
            {pkgs.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtRM(p.total_cents)}</option>)}
            <option value="custom">{L("Custom requirement (no package fits)", "Keperluan khas (tiada pakej sesuai)")}</option>
          </select>
        </label>
        {(f.custom || (pkg && pkg.issuers.length > 1)) && (
          <label className={css.field}><span>{L("Issuing company", "Syarikat pengeluar")}</span>
            <select className={inputClass} value={f.issuer_code} onChange={set("issuer_code")}>
              <option value="">{L("Let Sales decide", "Biar Jualan tentukan")}</option>
              {(pkg?.issuers ?? ["a2z", "azoo"]).map((i) => <option key={i} value={i}>{ISSUER[i] ?? i}</option>)}
            </select>
          </label>
        )}
        <label className={css.field}><span>{f.custom ? L("What the client needs * (10+ characters)", "Keperluan pelanggan * (10+ aksara)") : L("What the client needs", "Keperluan pelanggan")}</span><textarea className={inputClass} rows={3} value={f.requirement} onChange={set("requirement")} /></label>
        <div className={css.two}>
          <label className={css.field}><span>{L("Timeline (optional)", "Tempoh (pilihan)")}</span><input className={inputClass} value={f.timeline} onChange={set("timeline")} placeholder={L("e.g. before 15 Dec", "cth. sebelum 15 Dis")} /></label>
          <label className={css.field}><span>{L("Budget (optional)", "Bajet (pilihan)")}</span><input className={inputClass} value={f.budget_text} onChange={set("budget_text")} placeholder="RM" /></label>
        </div>
        <label className={css.field}><span>{L("Your notes for Sales (optional)", "Nota anda untuk Jualan (pilihan)")}</span><textarea className={inputClass} rows={2} value={f.note} onChange={set("note")} /></label>
        <label className={css.field}><span>{L("Attachment (optional - PDF, image or Word)", "Lampiran (pilihan - PDF, imej atau Word)")}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {problem && <p className={css.warn} role="alert">{problem}</p>}
      </div>
    </SideDrawer>
  );
}

/* ------------------------------------------------------------- the request */
async function uploadFile(reqId: number, file: File, visibility: "agent" | "internal"): Promise<{ ok: boolean; id?: number; msg: string }> {
  const res = await csrfFetch(`/api/v1/staff/agent/requests/${reqId}/files?visibility=${visibility}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name.slice(0, 160), "Idempotency-Key": newKey() } });
  const j = (await res.json().catch(() => null)) as { id?: number; error?: { message?: string } } | null;
  return { ok: res.ok, id: j?.id, msg: j?.error?.message ?? "" };
}

/* v1.250.2 - THE ONE STATUS UPDATE FORM. Every report an agent makes is an
   append-only event on the request (worker/src/agent.ts): the type decides
   only which route records it and which request status it may move -
   never the quotation, the acceptance record, an invoice or a payment. */
type UpdateType = "general" | "feedback" | "shared" | "interest" | "revision" | "declined" | "accepted";
const TYPES: { k: UpdateType; en: string; ms: string; needsQt: boolean }[] = [
  { k: "general", en: "General progress update", ms: "Kemas kini kemajuan umum", needsQt: false },
  { k: "feedback", en: "Client feedback", ms: "Maklum balas pelanggan", needsQt: false },
  { k: "shared", en: "Quotation shared with client", ms: "Sebut harga dikongsi dengan pelanggan", needsQt: true },
  { k: "interest", en: "Client interested", ms: "Pelanggan berminat", needsQt: true },
  { k: "revision", en: "Revision requested", ms: "Minta semakan", needsQt: true },
  { k: "declined", en: "Client declined / not proceeding (reported)", ms: "Pelanggan menolak / tidak meneruskan (dilaporkan)", needsQt: true },
  { k: "accepted", en: "Client acceptance reported", ms: "Penerimaan pelanggan dilaporkan", needsQt: true },
];

function AddUpdateForm({ id, holdsQt, start, onClose, onDone }: { id: number; holdsQt: boolean; start: UpdateType; onClose: () => void; onDone: (msg: string) => void }) {
  const [type, setType] = useState<UpdateType>(start);
  const [body, setBody] = useState("");
  const [next, setNext] = useState("");
  const [follow, setFollow] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const key = useRef(newKey());
  const allowed = TYPES.filter((t) => !t.needsQt || holdsQt);
  const ready = body.trim().length >= 2 && (type !== "accepted" || !!file);
  const send = async () => {
    setBusy(true); setProblem("");
    let fileId: number | undefined;
    if (file) {
      const up = await uploadFile(id, file, "agent");
      if (!up.ok || !up.id) { setBusy(false); setProblem(up.msg || L("The file was not uploaded", "Fail tidak dimuat naik")); return; }
      fileId = up.id;
    }
    const extra = { next_action: next.trim() || undefined, follow_up_on: follow || undefined };
    const label = TYPES.find((t) => t.k === type)!;
    const r = type === "general" || type === "feedback"
      ? await api<{ error?: { message?: string } }>(`/staff/agent/requests/${id}/events`, { method: "POST", body: JSON.stringify({ kind: "update", body: `${L(label.en, label.ms)}: ${body.trim()}`, client_feedback: type === "feedback" ? body.trim() : undefined, client_key: key.current, ...extra }) })
      : type === "shared"
        ? await api<{ error?: { message?: string } }>(`/staff/agent/requests/${id}/shared`, { method: "POST", body: JSON.stringify({ channel, note: body.trim(), ...extra }) })
        : await api<{ error?: { message?: string } }>(`/staff/agent/requests/${id}/feedback`, { method: "POST", body: JSON.stringify({ kind: type, body: body.trim(), evidence_file_id: type === "accepted" ? fileId : undefined, ...extra }) });
    setBusy(false);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not sent - try again", "Tidak dihantar - cuba lagi")); return; }
    onDone(L("Update sent to Sales", "Kemas kini dihantar kepada Jualan"));
  };
  return (
    <section className={css.updateForm} aria-label={L("Add Status Update", "Tambah Kemas Kini Status")} data-testid="add-update-form">
      <div className={css.cardTop}><h3 className={css.h3}>{L("Add Status Update", "Tambah Kemas Kini Status")}</h3><button type="button" className={btnSmQuiet} onClick={onClose}>{L("Cancel", "Batal")}</button></div>
      <label className={css.field}><span>{L("Update type *", "Jenis kemas kini *")}</span>
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as UpdateType)}>
          {allowed.map((t) => <option key={t.k} value={t.k}>{L(t.en, t.ms)}</option>)}
        </select>
      </label>
      {!holdsQt && <p className={css.muted}>{L("Sharing, revision and acceptance reports open once Sales publishes the quotation to you.", "Laporan kongsi, semakan dan penerimaan dibuka selepas Jualan menerbitkan sebut harga kepada anda.")}</p>}
      {type === "shared" && (
        <label className={css.field}><span>{L("How you shared it", "Cara anda kongsi")}</span>
          <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="whatsapp">WhatsApp</option><option value="email">{L("Email (my own)", "E-mel (sendiri)")}</option><option value="phone">{L("Phone", "Telefon")}</option><option value="in_person">{L("In person", "Bersemuka")}</option><option value="other">{L("Other", "Lain")}</option>
          </select>
        </label>
      )}
      <label className={css.field}><span>{L("What happened *", "Apa yang berlaku *")}</span><textarea className={inputClass} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={L("e.g. The client reviewed the quotation and will reply by Friday", "cth. Pelanggan telah menyemak sebut harga dan akan membalas sebelum Jumaat")} /></label>
      <div className={css.two}>
        <label className={css.field}><span>{L("Next action (optional)", "Tindakan seterusnya (pilihan)")}</span><input className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <label className={css.field}><span>{L("Follow-up date (optional)", "Tarikh susulan (pilihan)")}</span><input className={inputClass} type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></label>
      </div>
      <label className={css.field}><span>{type === "accepted" ? L("Evidence * (screenshot, email or signed order)", "Bukti * (tangkapan skrin, e-mel atau pesanan ditandatangani)") : L("Attachment (optional)", "Lampiran (pilihan)")}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {type === "accepted" && <p className={css.lock}>{L("This reports the client's yes. Sales verifies it on the quotation before it counts - nothing is accepted, invoiced or paid by this report.", "Ini melaporkan persetujuan pelanggan. Jualan mengesahkannya pada sebut harga sebelum dikira - laporan ini tidak menerima, menginvois atau membayar apa-apa.")}</p>}
      {type === "declined" && <p className={css.muted}>{L("Sales decides whether the request stops; your report goes to them.", "Jualan menentukan sama ada permintaan dihentikan; laporan anda dihantar kepada mereka.")}</p>}
      {problem && <p className={css.warn} role="alert">{problem}</p>}
      <div className={css.footer}><button type="button" className={btnClass} disabled={busy || !ready} aria-busy={busy || undefined} onClick={() => void send()}>{busy ? L("Sending…", "Menghantar…") : L("Submit Update", "Hantar Kemas Kini")}</button></div>
    </section>
  );
}

function RequestDrawer({ id, isAgent, canManage, onClose, onChanged }: { id: number; isAgent: boolean; canManage: boolean; onClose: () => void; onChanged: (msg?: string) => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"overview" | "updates" | "files">("overview");
  const [form, setForm] = useState<UpdateType | null>(null);
  const [msg, setMsg] = useState("");
  const [vis, setVis] = useState<"agent" | "internal">(isAgent ? "agent" : "internal");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [team, setTeam] = useState<{ id: number; name: string; role?: string }[]>([]);
  const [mailTo, setMailTo] = useState("");
  const [answer, setAnswer] = useState("");
  const [acc, setAcc] = useState({ accepted_name: "", channel: "whatsapp" });
  const { setTab: goTab } = usePortal();
  const { prompt, node: promptNode } = usePrompt();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<Detail & { error?: { message?: string } }>(`/staff/agent/requests/${id}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data) { setD(r.data); setFailed(""); } else setFailed(r.data?.error?.message ?? L("This request could not be opened.", "Permintaan ini tidak dapat dibuka."));
    });
    return () => c.abort();
  }, [id, tick]);
  useEffect(() => { if (canManage) void api<{ staff?: { id: number; name: string; role?: string }[] }>("/staff/staff-list").then((r) => setTeam((r.data?.staff ?? []).filter((u) => ["sales_marketing", "ceo", "coo", "cco"].includes(u.role ?? "")))); }, [canManage]);
  const refresh = (m?: string) => { setTick((t) => t + 1); onChanged(m); };
  const run = async (path: string, body: Record<string, unknown>, okMsg: string, method = "POST") => {
    setBusy(true); setProblem("");
    const r = await api<{ error?: { message?: string } }>(path, { method, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved - try again", "Tidak disimpan - cuba lagi")); return false; }
    refresh(okMsg); return true;
  };

  if (failed) return <SideDrawer open onClose={onClose} title={L("Request", "Permintaan")}><p className={css.warn} role="alert">{failed}</p></SideDrawer>;
  if (!d) return <SideDrawer open onClose={onClose} title={L("Request", "Permintaan")}><SkelCard lines={6} /></SideDrawer>;
  const r = d.request; const q = d.quotation;
  const holdsQt = !!d.can.feedback;
  const canUpdate = isAgent && r.status !== "draft" && !["won", "not_proceeding"].includes(r.status);
  const openForm = (t: UpdateType) => { setForm(t); setTab("updates"); };
  const toCreateQt = async () => {
    const pf = await api<{ prefill?: Record<string, unknown> }>(`/staff/agent/requests/${id}/prefill`);
    if (!pf.ok || !pf.data?.prefill) { setProblem(L("The Sales form could not be prepared", "Borang Jualan tidak dapat disediakan")); return; }
    try { localStorage.setItem("azone-qt-prefill", JSON.stringify({ ...pf.data.prefill, package_name: r.package_name ?? undefined })); } catch { setProblem(L(`This browser blocked the handoff - open Sales and use the reference ${r.ref}`, `Pelayar ini menyekat - buka Jualan dan guna rujukan ${r.ref}`)); return; }
    onClose(); goTab("Sales");
  };
  const post = async () => {
    if (msg.trim().length < 2) return;
    if (await run(`/staff/agent/requests/${id}/events`, { kind: "comment", body: msg.trim(), visibility: vis, client_key: newKey() }, L("Posted", "Dihantar"))) setMsg("");
  };
  const attach = async (file: File) => {
    setBusy(true); setProblem("");
    const res = await uploadFile(id, file, isAgent ? "agent" : vis);
    setBusy(false);
    if (!res.ok) { setProblem(res.msg || L("File not added", "Fail tidak ditambah")); return; }
    refresh(L("File added", "Fail ditambah"));
  };
  const setStatus = async (to: Status) => {
    let reason = "";
    if (to === "more_info" || to === "not_proceeding") {
      const a = await prompt({ title: to === "more_info" ? L("Ask the agent for more information", "Minta maklumat lanjut daripada ejen") : L("Not proceeding", "Tidak diteruskan"),
        label: to === "more_info" ? L("What should the agent tell you? (they see this)", "Apa yang perlu ejen beritahu? (ejen nampak ini)") : L("Why? (kept in the history; the agent sees it)", "Kenapa? (disimpan dalam sejarah; ejen nampak)"), required: true, variant: to === "not_proceeding" ? "danger" : "default" });
      if (!a || a.value.trim().length < 5) return;
      reason = a.value.trim();
    }
    await run(`/staff/agent/requests/${id}`, { status: to, reason }, L("Status changed", "Status ditukar"), "PATCH");
  };

  const step = stepOf(r.status);
  const comments = d.history.filter((e) => e.kind !== "file");
  const footer = isAgent && d.can.edit ? (
    r.status === "more_info"
      ? <div className={css.footer}><button type="button" className={btnClass} disabled={busy || answer.trim().length < 2} onClick={() => void run(`/staff/agent/requests/${id}`, { submit: true, answer: answer.trim() }, L("Sent to Sales", "Dihantar kepada Jualan"), "PATCH")}>{L("Send the answer", "Hantar jawapan")}</button></div>
      : <div className={css.footer}><button type="button" className={btnClass} disabled={busy} onClick={() => void run(`/staff/agent/requests/${id}`, { submit: true }, L("Sent to Sales", "Dihantar kepada Jualan"), "PATCH")}>{L("Send to Sales", "Hantar kepada Jualan")}</button></div>
  ) : undefined;
  const addBtn = canUpdate && !form ? (
    <button type="button" className={css.bigBtn} data-testid="add-status-update" onClick={() => openForm("general")}><AppIcon name="add" />{L("Add Status Update", "Tambah Kemas Kini Status")}</button>
  ) : null;

  return (
    <SideDrawer open onClose={onClose} wide full title={`${r.ref} · ${r.company || r.client_name}`} subtitle={<Chip s={r.status} />} footer={footer}>
      {promptNode}
      <div className={css.drawer} data-testid="agent-request-drawer">
        <LineTabs value={tab} onChange={setTab} label={L("Request", "Permintaan")} tabs={[
          ["overview", L("Overview", "Ringkasan")],
          ["updates", L(`Updates & Comments (${comments.length})`, `Kemas Kini & Komen (${comments.length})`)],
          ["files", L(`Files (${d.files.length})`, `Fail (${d.files.length})`)],
        ] as const} />
        {problem && <p className={css.warn} role="alert">{problem}</p>}

        {tab === "overview" && (<>
          {isAgent && <p className={css.lock}>{L("You share the quotation and report what the client says. Price, issuing company, signature and payment are Sales'.", "Anda berkongsi sebut harga dan melaporkan maklum balas pelanggan. Harga, syarikat pengeluar, tandatangan dan bayaran milik Jualan.")}</p>}
          {r.status !== "draft" && (
            <ol className={css.steps} aria-label={L("Request progress", "Kemajuan permintaan")}>
              {STEPS.map(([en, ms], i) => <li key={en} data-state={i < step || (i === 3 && step === 3) ? "done" : i === step ? "now" : "todo"}><span className={css.dot} aria-hidden />{L(en, ms)}</li>)}
            </ol>
          )}
          {addBtn}
          <section className={css.block} aria-label={L("Details", "Butiran")}>
            <dl className={css.dl}>
              {!isAgent && <><dt>{L("Agent", "Ejen")}</dt><dd>{r.agent_name ?? "—"}</dd></>}
              <dt>{L("Client", "Pelanggan")}</dt><dd>{[...new Set([r.company, r.client_name, r.contact_person].filter(Boolean))].join(" · ")}</dd>
              <dt>{L("Contact", "Hubungan")}</dt><dd>{[r.client_phone, r.client_email].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>{L("Package", "Pakej")}</dt><dd>{r.package_name ?? L("Custom requirement", "Keperluan khas")}{r.issuer_code ? ` · ${ISSUER[r.issuer_code] ?? r.issuer_code}` : ""}</dd>
              {r.requirement && <><dt>{L("Needs", "Keperluan")}</dt><dd className={css.pre}>{r.requirement}</dd></>}
              {(r.timeline || r.budget_text) && <><dt>{L("Timeline · budget", "Tempoh · bajet")}</dt><dd>{[r.timeline, r.budget_text].filter(Boolean).join(" · ")}</dd></>}
              {r.note && <><dt>{L("Note", "Nota")}</dt><dd className={css.pre}>{r.note}</dd></>}
              <dt>{L("Assigned Sales", "Jualan ditugaskan")}</dt><dd>{r.assigned_name ?? L("Not assigned yet", "Belum ditugaskan")}</dd>
            </dl>
          </section>

          {isAgent && d.can.edit && r.status === "more_info" && (
            <section className={css.block} aria-label={L("Answer Sales", "Jawab Jualan")}>
              <p className={css.lock}>{d.history.filter((e) => e.status_to === "more_info").slice(-1)[0]?.body ?? L("Sales needs more information.", "Jualan perlukan maklumat lanjut.")}</p>
              <label className={css.field}><span>{L("Your answer to Sales *", "Jawapan anda kepada Jualan *")}</span><textarea className={inputClass} rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
            </section>
          )}

          {!isAgent && d.can.handle && (
            <section className={css.block} aria-label={L("Handle", "Urus")}>
              {(d.can.to ?? []).length > 0 && <div className={css.row}>
                {(d.can.to ?? []).map((s) => <button key={s} type="button" className={s === "not_proceeding" ? btnSmQuiet : btnSm} disabled={busy} onClick={() => void setStatus(s)}>{L("Move to: ", "Ke: ")}{word(s)}</button>)}
              </div>}
              <div className={css.row}>
                {d.can.manage && (
                  <label className={css.inline}>{L("Sales", "Jualan")}
                    <select className={selectClassSm} value={r.assigned_to ?? 0} disabled={busy} onChange={(e) => void run(`/staff/agent/requests/${id}`, { assigned_to: Number(e.target.value) || null }, L("Assigned", "Ditugaskan"), "PATCH")}>
                      <option value={0}>{L("Nobody yet", "Belum ada")}</option>
                      {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                )}
                <label className={css.inline}>{L("Next follow-up", "Susulan seterusnya")}
                  <input type="date" className={inputClassSm} value={r.next_follow_up_on ?? ""} disabled={busy} onChange={(e) => void run(`/staff/agent/requests/${id}`, { next_follow_up_on: e.target.value || null }, L("Follow-up set", "Susulan ditetapkan"), "PATCH")} />
                </label>
              </div>
            </section>
          )}

          <section className={css.block} aria-label={L("Quotation", "Sebut harga")}>
            <h3 className={css.h3}>{isAgent ? L("Approved quotation", "Sebut harga diluluskan") : L("Quotation", "Sebut harga")}</h3>
            {q ? (
              <div className={css.qt} data-testid="agent-quotation">
                <div className={css.qmain}>
                  <span className={css.strong}>{q.doc_number}{q.revision ? ` · REV ${q.revision}` : ""}</span>
                  <span className={css.muted}>{q.issuer_name}{q.customer ? ` · ${q.customer}` : ""}</span>
                  <span className={css.price}>{fmtRM(q.total_cents)} <span className={css.muted}>{L(`valid to ${day(q.valid_until)}`, `sah hingga ${day(q.valid_until)}`)}</span></span>
                  {q.lines.length > 0 && <span className={css.muted}>{q.lines.slice(0, 4).map((l) => `${l.qty > 1 ? `${l.qty} × ` : ""}${l.name}`).join(" · ")}</span>}
                </div>
                {q.notice ? <p className={css.warn}>{q.notice}</p> : q.link && <a className={btnSm} href={q.link} target="_blank" rel="noopener noreferrer">{L("View approved quotation", "Lihat sebut harga diluluskan")}</a>}
                {q.acceptance && <span className={`${css.chip} ${css.ok}`}>{L("Accepted on the link", "Diterima pada pautan")} {day(q.acceptance.accepted_at)}</span>}
              </div>
            ) : isAgent ? <p className={css.muted}>{L("Sales publishes the official quotation here once it is approved.", "Jualan menerbitkan sebut harga rasmi di sini selepas diluluskan.")}</p> : null}

            {isAgent && d.can.share && q?.link && (
              <div className={css.share}>
                <div className={css.row}>
                  <button type="button" className={btnSm} onClick={() => { void navigator.clipboard?.writeText(q.link!).then(() => onChanged(L("Link copied", "Pautan disalin"))).catch(() => undefined); }}>{L("Copy link", "Salin pautan")}</button>
                  <button type="button" className={btnSmPrimary} onClick={() => openForm("shared")}>{L("I shared it with the client", "Saya sudah kongsi dengan pelanggan")}</button>
                  <button type="button" className={btnSm} onClick={() => openForm("revision")}>{L("Request revision", "Minta semakan")}</button>
                  <button type="button" className={btnSm} onClick={() => openForm("accepted")}>{L("Report client acceptance", "Lapor penerimaan pelanggan")}</button>
                </div>
                {d.mail_ready ? (
                  <div className={css.row}>
                    <input className={inputClassSm} type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder={r.client_email ?? L("client@email", "pelanggan@emel")} aria-label={L("Client's email", "E-mel pelanggan")} />
                    <button type="button" className={btnSm} disabled={busy || !/\S+@\S+\.\S+/.test(mailTo || r.client_email || "")} onClick={() => void run(`/staff/agent/requests/${id}/send`, { to: mailTo || r.client_email }, L("Sent to the client", "Dihantar kepada pelanggan"))}>{L("Send approved quotation by email", "Hantar sebut harga melalui e-mel")}</button>
                  </div>
                ) : <p className={css.muted}>{L("Email from the portal is not switched on yet - share the link and record how with “I shared it”.", "E-mel daripada portal belum dihidupkan - kongsi pautan dan rekod caranya dengan “Saya sudah kongsi”.")}</p>}
              </div>
            )}

            {!isAgent && (
              <div className={css.share}>
                {d.linked && <p className={css.muted}>{L("Linked in Sales: ", "Dipaut dalam Jualan: ")}<span className={css.strong}>{d.linked.doc_number}{d.linked.revision ? ` REV ${d.linked.revision}` : ""}</span> · {fmtRM(d.linked.total_cents)}{d.linked.valid_until ? ` · ${L("valid to", "sah hingga")} ${day(d.linked.valid_until)}` : ""}{d.linked.voided_at ? ` · ${L("void", "batal")}` : ""}{d.linked.acceptance ? ` · ${L("accepted by", "diterima oleh")} ${d.linked.acceptance.accepted_name}` : ""}</p>}
                {d.can.handle && !["won", "not_proceeding"].includes(r.status) && (
                  <div className={css.row}>
                    <button type="button" className={btnSm} onClick={() => void toCreateQt()}>{d.linked ? L("New quotation in Sales", "Sebut harga baharu dalam Jualan") : L("Create quotation in Sales", "Buat sebut harga dalam Jualan")}</button>
                    {d.can.publish && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void run(`/staff/agent/requests/${id}/publish`, { doc_id: r.quotation_id }, L("Published to the agent", "Diterbitkan kepada ejen"))}>{q ? L("Publish the current revision", "Terbitkan semakan semasa") : L("Publish to Agent", "Terbitkan kepada Ejen")}</button>}
                  </div>
                )}
                {d.can.verify && r.quotation_id && (
                  <div className={css.verify}>
                    {d.linked?.acceptance ? (
                      <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void run(`/staff/agent/requests/${id}/verify`, {}, L("Won - acceptance verified", "Berjaya - penerimaan disahkan"))}>{L("Verify acceptance → Won", "Sahkan penerimaan → Berjaya")}</button>
                    ) : (<>
                      <p className={css.muted}>{L("Check the agent's evidence (Files), then record who agreed and how - this is the quotation's own acceptance record.", "Semak bukti ejen (Fail), kemudian rekod siapa yang bersetuju dan bagaimana - ini rekod penerimaan sebut harga itu sendiri.")}</p>
                      <div className={css.row}>
                        <input className={inputClassSm} value={acc.accepted_name} onChange={(e) => setAcc({ ...acc, accepted_name: e.target.value })} placeholder={L("Who agreed (client side)", "Siapa bersetuju (pihak pelanggan)")} aria-label={L("Who agreed", "Siapa bersetuju")} />
                        <select className={selectClassSm} value={acc.channel} onChange={(e) => setAcc({ ...acc, channel: e.target.value })} aria-label={L("How", "Bagaimana")}>
                          <option value="whatsapp">WhatsApp</option><option value="email">{L("Email", "E-mel")}</option><option value="phone">{L("Phone", "Telefon")}</option><option value="signed">{L("Signed order", "Pesanan ditandatangani")}</option><option value="in_person">{L("In person", "Bersemuka")}</option>
                        </select>
                        <button type="button" className={btnSmPrimary} disabled={busy || acc.accepted_name.trim().length < 2} onClick={async () => {
                          if (await run(`/staff/docs/${r.quotation_id}/acceptance`, { ...acc, note: `Verified from agent request ${r.ref}` }, L("Acceptance recorded", "Penerimaan direkod"))) await run(`/staff/agent/requests/${id}/verify`, {}, L("Won - acceptance verified", "Berjaya - penerimaan disahkan"));
                        }}>{L("Record and verify", "Rekod dan sahkan")}</button>
                      </div>
                    </>)}
                  </div>
                )}
              </div>
            )}
          </section>
          {comments.length > 0 && (
            <section className={css.block} aria-label={L("Latest update", "Kemas kini terkini")}>
              <div className={css.cardTop}><h3 className={css.h3}>{L("Latest update", "Kemas kini terkini")}</h3><button type="button" className={css.linkBtn} onClick={() => setTab("updates")}>{L("View all", "Lihat semua")}</button></div>
              <Timeline items={comments.slice(-1)} isAgent={isAgent} files={[]} reqId={id} />
            </section>
          )}
        </>)}

        {tab === "updates" && (<>
          {form && <AddUpdateForm id={id} holdsQt={holdsQt} start={form} onClose={() => setForm(null)} onDone={(m) => { setForm(null); refresh(m); }} />}
          {addBtn}
          <section className={css.block} aria-label={L("Updates & comments", "Kemas kini & komen")}>
            {comments.length === 0 ? <p className={css.muted}>{L("No updates yet.", "Belum ada kemas kini.")}</p> : <Timeline items={[...comments].reverse()} isAgent={isAgent} files={[]} reqId={id} />}
          </section>
          {r.status !== "draft" && (
            <section className={css.composer} aria-label={L("Comment", "Komen")}>
              <h3 className={css.h3}>{isAgent ? L("Reply or comment", "Balas atau komen") : L("Comment", "Komen")}</h3>
              <textarea className={inputClass} rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={isAgent ? L("A reply to Sales or management", "Balasan kepada Jualan atau pengurusan") : L("A comment, question or instruction - choose who sees it", "Komen, soalan atau arahan - pilih siapa yang melihat")} aria-label={L("Write a comment", "Tulis komen")} />
              <div className={css.row}>
                {!isAgent && (
                  <div className={css.seg} role="radiogroup" aria-label={L("Who sees it", "Siapa melihat")}>
                    <button type="button" role="radio" aria-checked={vis === "internal"} className={vis === "internal" ? css.segOn : undefined} onClick={() => setVis("internal")}>{L("Internal only", "Dalaman sahaja")}</button>
                    <button type="button" role="radio" aria-checked={vis === "agent"} className={vis === "agent" ? css.segOn : undefined} onClick={() => setVis("agent")}>{L("Agent can see", "Ejen boleh lihat")}</button>
                  </div>
                )}
                <button type="button" className={btnSmPrimary} disabled={busy || msg.trim().length < 2} onClick={() => void post()}>{L("Post", "Hantar")}</button>
              </div>
            </section>
          )}
        </>)}

        {tab === "files" && (
          <section className={css.block} aria-label={L("Files", "Fail")}>
            {d.files.length === 0 ? <p className={css.muted}>{L("No files yet.", "Belum ada fail.")}</p> : (
              <ul className={css.files}>
                {d.files.map((f) => (
                  <li key={f.id}>
                    <a className={css.linkBtn} href={`/api/v1/staff/agent/requests/${id}/files/${f.id}`} target="_blank" rel="noopener noreferrer">{f.file_name}</a>
                    <span className={css.muted}>{f.uploader ?? ""} · {when(f.created_at)}</span>
                    {!isAgent && <span className={`${css.vis} ${f.visibility === "internal" ? css.bad : css.ok}`}>{f.visibility === "internal" ? L("Internal", "Dalaman") : L("Agent can see", "Ejen boleh lihat")}</span>}
                  </li>))}
              </ul>
            )}
            {r.status !== "draft" && (<>
              <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ""; }} />
              <div className={css.row}>
                {!isAgent && (
                  <div className={css.seg} role="radiogroup" aria-label={L("Who sees the file", "Siapa melihat fail")}>
                    <button type="button" role="radio" aria-checked={vis === "internal"} className={vis === "internal" ? css.segOn : undefined} onClick={() => setVis("internal")}>{L("Internal only", "Dalaman sahaja")}</button>
                    <button type="button" role="radio" aria-checked={vis === "agent"} className={vis === "agent" ? css.segOn : undefined} onClick={() => setVis("agent")}>{L("Agent can see", "Ejen boleh lihat")}</button>
                  </div>
                )}
                <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => fileRef.current?.click()}><AppIcon name="attach" />{L("Add file", "Tambah fail")}</button>
              </div>
            </>)}
          </section>
        )}
      </div>
    </SideDrawer>
  );
}

function Timeline({ items, isAgent }: { items: Ev[]; isAgent: boolean; files: FileRow[]; reqId: number }) {
  return (
    <ul className={css.timeline}>
      {items.map((e) => (
        <li key={e.id} className={e.visibility === "internal" ? css.internal : undefined} data-visibility={e.visibility}>
          <span className={css.tlHead}><span className={css.strong}>{e.actor ?? L("System", "Sistem")}</span>{!isAgent && <span className={`${css.vis} ${e.visibility === "internal" ? css.bad : css.ok}`}>{e.visibility === "internal" ? L("Internal", "Dalaman") : L("Agent can see", "Ejen boleh lihat")}</span>}<span className={css.muted}>{when(e.created_at)}</span></span>
          <span className={css.pre}>{e.body}</span>
          {(e.next_action || e.follow_up_on) && <span className={css.muted}>{[e.next_action && `${L("Next", "Seterusnya")}: ${e.next_action}`, e.follow_up_on && `${L("Follow up", "Susulan")} ${day(e.follow_up_on)}`].filter(Boolean).join(" · ")}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------- v1.255.0 */
interface AssignRow { id: number; agent_id: number; salesperson_id: number; salesperson_name: string; effective_from: string; reason: string; set_by_name: string }
interface AssignRes { history: AssignRow[]; current: Record<number, AssignRow | undefined>; salespeople: { id: number; name: string }[]; can_manage: boolean; today?: string }
function AssignForm({ agentId, people, today, onClose, onDone }: { agentId: number; people: { id: number; name: string }[]; today: string; onClose: () => void; onDone: (name: string) => void }) {
  const [sp, setSp] = useState(0);
  const [from, setFrom] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    const r = await api<{ salesperson?: string; error?: { message?: string } }>("/staff/agent/assignments", { method: "POST", body: JSON.stringify({ agent_id: agentId, salesperson_id: sp, effective_from: from || undefined, reason }) });
    setBusy(false);
    if (r.ok) onDone(r.data?.salesperson ?? ""); else setErr(r.data?.error?.message ?? L("Could not save - try again.", "Tidak dapat disimpan - cuba lagi."));
  };
  return (
    <fieldset className={css.assign} disabled={busy}>
      <select aria-label={L("Salesperson", "Jurujual")} className={selectClassSm} value={sp} onChange={(e) => setSp(Number(e.target.value))}>
        <option value={0}>{L("Choose the salesperson…", "Pilih jurujual…")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input type="date" aria-label={L("From", "Mulai")} className={inputClassSm} min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
      <input aria-label={L("Reason", "Sebab")} className={inputClassSm} placeholder={L("Reason (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)")} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      <span className={css.row}>
        <button type="button" className={btnSmPrimary} disabled={!sp || reason.trim().length < 10} onClick={() => void save()}>{L("Save", "Simpan")}</button>
        <button type="button" className={btnSm} onClick={onClose}>{L("Cancel", "Batal")}</button>
      </span>
      {err && <p className={css.warn} role="alert">{err}</p>}
    </fieldset>
  );
}

/* The agent's own commission: their rate, their sales, their payouts - never anyone else's. */
interface MyRow { id: number | string; kind: string; stage: "estimated" | "eligible" | "pending_payout" | "paid" | "under_review"; request_ref: string | null; client: string | null; quotation_number: string | null; invoice_number: string; rate_bp: number | null; amount_cents: number | null; at: string; payout: { ref: string; status: string; settled_on: string | null; bank_ref: string | null } | null }
interface MyRes { rate_bp: number | null; rows: MyRow[]; totals: { estimated: number; eligible: number; pending_payout: number; paid: number; under_review: number }; error?: { message?: string } }
const STAGE_WORD: Record<MyRow["stage"], [string, string, string | undefined]> = {
  estimated: ["Estimated - not paid yet", "Anggaran - belum dibayar", css.off], eligible: ["Eligible - waiting for payout", "Layak - menunggu bayaran", css.info],
  pending_payout: ["Payout authorised", "Bayaran dibenarkan", css.gold], paid: ["Paid", "Dibayar", css.ok], under_review: ["Under review", "Dalam semakan", css.wait],
};
const pctAg = (bp: number | null) => (bp === null ? "—" : `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`);
function MyCommission() {
  const [d, setD] = useState<MyRes | null>(null);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void api<MyRes>("/staff/agent/commission", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data) setD(r.data); else setFailed(r.data?.error?.message ?? L("Your commission could not be loaded - try again.", "Komisen anda tidak dapat dimuatkan - cuba lagi."));
    });
    return () => c.abort();
  }, []);
  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  if (!d) return <SkelCard lines={3} />;
  return (
    <section className={css.panel} aria-label={L("My commission", "Komisen saya")} data-testid="agent-commission">
      <p className={css.strong} data-testid="agent-rate">{L("Your commission rate", "Kadar komisen anda")}: {pctAg(d.rate_bp)}</p>
      <p className={css.muted}>{L("Earned on the sales value of a client you brought in, once the client has paid in full and A2Z has confirmed it. Paid to you by bank transfer, recorded with the reference.", "Diperoleh atas nilai jualan pelanggan yang anda bawa, setelah pelanggan membayar penuh dan A2Z mengesahkannya. Dibayar melalui pindahan bank, direkod dengan rujukan.")}</p>
      <KpiRow label={L("My commission", "Komisen saya")}>
        <KpiTile icon="pending" tone="navy" label={L("Estimated", "Anggaran")} value={fmtRM(d.totals.estimated)} sub={L("Not paid by the client yet", "Belum dibayar pelanggan")} />
        <KpiTile icon="verify" tone="gold" label={L("Eligible", "Layak")} value={fmtRM(d.totals.eligible)} sub={d.totals.under_review ? L(`${d.totals.under_review} under review`, `${d.totals.under_review} dalam semakan`) : L("Waiting for the payout", "Menunggu bayaran")} />
        <KpiTile icon="money" tone="blue" label={L("Payout authorised", "Bayaran dibenarkan")} value={fmtRM(d.totals.pending_payout)} sub={L("The bank transfer is next", "Pindahan bank seterusnya")} />
        <KpiTile icon="paid" tone="green" label={L("Paid", "Dibayar")} value={fmtRM(d.totals.paid)} sub={L("Settled to your bank", "Diselesaikan ke bank anda")} />
      </KpiRow>
      {d.rows.length === 0 ? <div className={css.empty}><p>{L("No commission yet. It appears here once a client you brought in is invoiced.", "Belum ada komisen. Ia dipaparkan di sini apabila pelanggan yang anda bawa diinvois.")}</p></div> : (
        <ul className={css.cards}>
          {d.rows.map((r) => (
            <li key={r.id} className={css.reqCard} data-testid={`agent-comm-${r.id}`}>
              <span className={css.cardTop}><span className={css.strong}>{r.client ?? "—"}</span><span className={`${css.chip} ${STAGE_WORD[r.stage][2]}`}>{L(STAGE_WORD[r.stage][0], STAGE_WORD[r.stage][1])}</span></span>
              <span className={css.muted}>{[r.request_ref, r.quotation_number, r.invoice_number].filter(Boolean).join(" · ")}</span>
              <span>{r.amount_cents === null ? L("The amount shows once A2Z completes its review", "Jumlah dipaparkan setelah A2Z selesai menyemak") : <><strong>{fmtRM(r.amount_cents)}</strong> · {L("Your commission rate", "Kadar komisen anda")}: {pctAg(r.rate_bp)}</>}</span>
              {r.payout?.status === "settled" && <span className={css.muted}>{L("Paid", "Dibayar")} {day(r.payout.settled_on)} · {L("bank ref", "rujukan bank")} {r.payout.bank_ref} · {r.payout.ref}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
