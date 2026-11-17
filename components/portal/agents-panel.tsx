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
   - SALES & MANAGEMENT: v1.347.0 - the CEO's four pictures (17-11-2026,
     "A2Z OS - AGENTS MODULE UI REDESIGN"), one layout per tab, never the
     same screen twice:
       Overview  the connected KPI strip, the Agent Pipeline (the Sales
                 Pipeline's chevron row, FlowStrip arrows) and Conversion
                 Performance per agent, with Important Follow-Ups and Recent
                 Agent Activity in the rail
       Requests  the Requests Inbox (one compact table: client, agent, Sales
                 assignment, quotation progress, follow-up) beside the
                 Request-to-Sale Workflow, whose steps filter the inbox
       Agents    the Agent Directory beside the chosen agent's Profile &
                 Ownership: verified access, company scope, the standing
                 salesperson (the existing append-only assignment), the
                 agent's figures and the commission rule
       Packages  the Package Catalogue (the active packages at their current
                 version and price, each with the company that issues it)
                 beside Package Governance
     Every figure is counted from the rows the server already sends
     (/staff/agent/requests, /agents, /assignments, /packages); nothing new
     is stored and no rule moves. "Manage Agent Access" for the owner and
     the super admin opens Users > Customer Accounts, the one place agent
     access is given.

   The quotation stays in Sales: nothing here prices, issues, signs or marks
   paid. The server decides every action (worker/src/agent.ts). The agent's
   own commission (7%) is calculated in Commission and read only by that
   agent; the salesperson's internal share (3%) is never drawn on any agent
   screen. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, csrfFetch } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { usePortal } from "@/components/portal/portal-provider";
import { TabPage } from "@/components/portal/tab-concept";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, TaskToolbar, type TableCol } from "@/components/portal/task-table";
import { fmtRM } from "@/lib/format";
import { useSaveToast } from "@/components/ui/save-toast";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelCard, SkelRows } from "@/components/ui/skeleton";
import { LineTabs } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { FlowStrip, type FlowStep, type FlowTone } from "@/components/ui/flow-strip";
import { Panel, WorkspaceGrid } from "@/components/ui/panel";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { btnClass, btnSm, btnSmPrimary, btnSmQuiet, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./agents-panel.module.css";

type Status = "draft" | "submitted" | "under_review" | "more_info" | "preparing" | "quotation_ready" | "with_client" | "revision_requested" | "acceptance_pending" | "won" | "not_proceeding";
interface Pkg { id: number; name: string; category: string | null; description: string | null; kind?: string | null; version?: number; issuers: string[]; total_cents: number; lines: { name: string; qty: number }[] }
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
interface AgentRow { id: number; name: string; email: string; is_active: number; email_verified: number; requests: number; open_requests: number; won: number; last_activity: string | null; scope: string }

const ISSUER: Record<string, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
/* the company as the pictures write it in a sentence (the legal names stay in capitals on the chips) */
const COMPANY: Record<string, string> = { a2z: "A2Z Creative Marketing", azoo: "AZ ONE OFFICIAL" };
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
/* today in Malaysia (the server's overdue rule is MYT), and a day k days on */
const mytToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

/* The four steps a request walks, for the progress line on its Overview */
const STEPS: [string, string][] = [["Submitted", "Dihantar"], ["Quotation ready", "Sebut harga sedia"], ["With client", "Dengan pelanggan"], ["Closed", "Ditutup"]];
const stepOf = (s: Status) => (s === "won" || s === "not_proceeding" ? 3 : ["with_client", "revision_requested", "acceptance_pending"].includes(s) ? 2 : s === "quotation_ready" ? 1 : 0);

/* v1.347.0 - THE AGENT PIPELINE: the request statuses the server keeps, read
   as the six stages of picture 01. A stage is only a group of statuses - it
   stores nothing and moves nothing. The first five are also the Requests
   tab's Request-to-Sale Workflow (picture 02), with the words of who acts. */
type StageKey = "submitted" | "review" | "quotation" | "client" | "acceptance" | "won";
const STAGES: { k: StageKey; s: Status[]; icon: AppIconName; tone: FlowTone; en: string; ms: string; who: [string, string]; what: [string, string] }[] = [
  { k: "submitted", s: ["submitted"], icon: "chat", tone: "neutral", en: "Agent Request", ms: "Permintaan Ejen",
    who: ["Agent submits client details", "Ejen menghantar butiran pelanggan"], what: ["The agent cannot open or edit the Sales quotation", "Ejen tidak boleh membuka atau mengubah sebut harga Jualan"] },
  { k: "review", s: ["under_review", "more_info"], icon: "search", tone: "gold", en: "In Review", ms: "Dalam Semakan",
    who: ["Sales reviews & takes ownership", "Jualan menyemak & mengambil alih"], what: ["Assign the salesperson and the follow-up date", "Tugaskan jurujual dan tarikh susulan"] },
  { k: "quotation", s: ["preparing", "revision_requested"], icon: "document", tone: "gold", en: "Quotation", ms: "Sebut Harga",
    who: ["Sales prepares the quotation", "Jualan menyediakan sebut harga"], what: ["The quotation is created in the existing Sales module", "Sebut harga dibuat dalam modul Jualan sedia ada"] },
  { k: "client", s: ["quotation_ready", "with_client"], icon: "person", tone: "blue", en: "To Client", ms: "Kepada Pelanggan",
    who: ["Agent presents to the client", "Ejen membentangkan kepada pelanggan"], what: ["Shares the approved quotation, records the response", "Berkongsi sebut harga diluluskan, merekod maklum balas"] },
  { k: "acceptance", s: ["acceptance_pending"], icon: "verify", tone: "purple", en: "Acceptance", ms: "Penerimaan",
    who: ["Sales verifies the acceptance", "Jualan mengesahkan penerimaan"], what: ["Payment verification remains with the CEO", "Pengesahan bayaran kekal dengan CEO"] },
  { k: "won", s: ["won"], icon: "success", tone: "green", en: "Won", ms: "Berjaya", who: ["", ""], what: ["", ""] },
];
const stageWord = (k: StageKey) => { const s = STAGES.find((x) => x.k === k)!; return L(s.en, s.ms); };
/* a filter is a status, a stage ("stage:review"), a group, or the overdue follow-ups */
type Filter = "" | Status | "open" | "overdue" | "awaiting" | `stage:${StageKey}`;
const AWAITING: Status[] = ["under_review", "more_info", "preparing", "revision_requested"];
const GROUP: Record<string, Status[]> = {
  open: OPEN, awaiting: AWAITING,
  ...Object.fromEntries(STAGES.map((s) => [`stage:${s.k}`, s.s])),
};
const matches = (r: Row, f: Filter) => !f || (f === "overdue" ? !!r.overdue : GROUP[f] ? GROUP[f].includes(r.status) : r.status === f);
const filterWord = (f: Filter) => !f ? "" : f === "overdue" ? L("Overdue follow-up", "Susulan lewat") : f === "open" ? L("Open", "Terbuka") : f === "awaiting" ? L("Awaiting quotation", "Menunggu sebut harga")
  : f.startsWith("stage:") ? stageWord(f.slice(6) as StageKey) : word(f as Status);

type View = "overview" | "packages" | "requests" | "quotations" | "agents" | "commission";
const AGENT_VIEWS: View[] = ["overview", "packages", "requests", "quotations", "commission"];
const STAFF_VIEWS: View[] = ["overview", "requests", "agents", "packages"];

export function AgentsPanel({ role, owner = false, initialView }: { role: string; owner?: boolean; initialView?: string }) {
  const isAgent = role === "agent";
  const views = isAgent ? AGENT_VIEWS : STAFF_VIEWS;
  const canGrant = owner || role === "super_admin"; // the server decides; this only offers the way there
  const pick = (v?: string): View => (views.includes(v as View) ? v as View : "overview");
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
  const [statusF, setStatusF] = useState<Filter>("");
  const [agentF, setAgentF] = useState(0);
  const [q, setQ] = useState("");
  /* v1.255.0 / v1.347.0 - staff: the agent accounts and the standing salesperson of each (read once, here, for every tab) */
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [agentsFailed, setAgentsFailed] = useState("");
  const [asg, setAsg] = useState<AssignRes | null>(null);
  const [aTick, setATick] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const { show, node: toastNode } = useSaveToast();
  const { setTab, setTabStart, canOpen } = usePortal();
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
  useEffect(() => {
    if (isAgent) return;
    const c = new AbortController();
    void api<{ agents?: AgentRow[]; error?: { message?: string } }>("/staff/agent/agents", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok) setAgents(r.data?.agents ?? []); else setAgentsFailed(r.data?.error?.message ?? L("The agents could not be loaded.", "Ejen tidak dapat dimuatkan."));
    });
    return () => c.abort();
  }, [isAgent, tick]);
  useEffect(() => {
    if (isAgent) return;
    const c = new AbortController();
    void api<AssignRes>("/staff/agent/assignments", { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setAsg(r.data); });
    return () => c.abort();
  }, [isAgent, aTick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const rows = useMemo(() => list?.requests ?? [], [list]);
  const shown = useMemo(() => rows.filter((r) => matches(r, statusF) && (!agentF || r.agent_id === agentF)
    && (!q || `${r.ref} ${r.client_name} ${r.company ?? ""} ${r.agent_name ?? ""} ${r.package_name ?? ""} ${r.assigned_name ?? ""} ${r.published_number ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, statusF, agentF, q]);
  const cnt = (...s: Status[]) => s.reduce((n, k) => n + (list?.counts?.[k] ?? 0), 0);
  /* keep the phone bar's stop in step with the view shown */
  const go = (v: View, f: Filter = "", agent = 0) => { setStatusF(f); setAgentF(agent); setView(v); setTabStart({ tab: "Agents", view: v }); };
  const manageAccess = () => { setTabStart({ tab: "Users", view: "customers" }); setTab("Users"); };
  const toSalesPackages = canOpen("Sales") ? () => { setTabStart({ tab: "Sales", view: "packages" }); setTab("Sales"); } : undefined;

  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  const drawers = (<>
    {submit && pkgs && <SubmitSheet pkgs={pkgs} initial={submit.pkg} onClose={() => setSubmit(null)} onDone={(draft) => { setSubmit(null); go("requests"); reload(); show(draft ? L("Draft saved", "Draf disimpan") : L("Sent to the sales team", "Dihantar kepada pasukan jualan")); }} />}
    {open !== null && <RequestDrawer id={open} isAgent={isAgent} canManage={!!list?.can_manage} onClose={() => setOpen(null)} onChanged={(msg) => { reload(); if (msg) show(msg); }} />}
  </>);

  /* ------------------------------------------------ Sales & management */
  if (!isAgent) {
    const waiting = cnt("submitted");
    const tabs: readonly (readonly [View, string] | readonly [View, string, number | null])[] = [
      ["overview", L("Overview", "Ringkasan")], ["requests", L("Requests", "Permintaan"), waiting || null], ["agents", L("Agents", "Ejen")], ["packages", L("Packages", "Pakej")],
    ];
    const pickAgent = (id: number) => { setPicked(id); go("agents"); };
    return (
      <TabPage className={css.page}>
        <div className={css.staff} data-testid="agents-panel">
          {toastNode}
          <LineTabs value={view} onChange={(v) => go(v)} tabs={tabs} label={L("Agents", "Ejen")} testid="agents-tab" />
          <div hidden={view !== "overview"} className={css.view} data-testid="agents-overview">
            <StaffOverview rows={rows} loaded={!!list} cnt={cnt} agents={agents} asg={asg} onFilter={(f) => go("requests", f)} onOpen={setOpen} onAgent={pickAgent} onAgents={() => go("agents")} />
          </div>
          <div hidden={view !== "requests"} className={css.view} data-testid="agents-requests">
            <RequestsInbox rows={rows} shown={shown} loaded={!!list} agents={agents} filter={statusF} onFilter={setStatusF} agentF={agentF} onAgentF={setAgentF} q={q} onQ={setQ}
              onOpen={setOpen} canGrant={canGrant} onManage={manageAccess} onAgents={() => go("agents")} />
          </div>
          <div hidden={view !== "agents"} className={css.view} data-testid="agents-directory">
            <AgentDirectory agents={agents} failed={agentsFailed} rows={rows} asg={asg} picked={picked} onPick={setPicked} canGrant={canGrant} onManage={manageAccess}
              onRequests={(id) => go("requests", "", id)} onAssigned={(name) => { setATick((t) => t + 1); show(L(`Assigned to ${name}`, `Ditugaskan kepada ${name}`), L("New requests go to them; past requests keep whom they had", "Permintaan baharu pergi kepada mereka; permintaan lama kekal")); }} />
          </div>
          <div hidden={view !== "packages"} className={css.view} data-testid="agents-packages">
            <PackageCatalogue pkgs={pkgs} isAgent={false} toSales={toSalesPackages} onRequests={() => go("requests")} />
          </div>
          {drawers}
        </div>
      </TabPage>
    );
  }

  /* ------------------------------------------------ the agent's own portal */
  const tabs: readonly (readonly [View, string])[] = [["overview", L("Overview", "Ringkasan")], ["packages", L("Packages", "Pakej")], ["requests", L("My Requests", "Permintaan Saya")], ["quotations", L("My Quotations", "Sebut Harga Saya")], ["commission", L("My Commission", "Komisen Saya")]];
  const submitBig = list?.can_submit ? (
    <button type="button" className={css.bigBtn} data-testid="submit-client-request" onClick={() => setSubmit({ pkg: null })}><AppIcon name="add" />{L("Submit Client Request", "Hantar Permintaan Pelanggan")}</button>
  ) : null;
  const emptyAgent = (
    <div className={css.empty} data-testid="agent-empty">
      <p>{L("No client requests yet. Submit your first client request to get started.", "Belum ada permintaan pelanggan. Hantar permintaan pertama anda untuk bermula.")}</p>
      {submitBig}
    </div>
  );
  return (
    <div className={css.wrap} data-testid="agents-panel">
      {toastNode}
      <header className={css.head}>
        <div>
          <h2 className={css.title}>{L("Agent workspace", "Ruang kerja ejen")}</h2>
          <p className={css.sub}>{L("Bring us clients for the packages below. Sales prepares the official quotation; you share it and tell us what the client says.", "Bawa pelanggan untuk pakej di bawah. Jualan menyediakan sebut harga rasmi; anda kongsikan dan beritahu kami maklum balas pelanggan.")}</p>
        </div>
      </header>
      <LineTabs value={view} onChange={(v) => go(v)} tabs={tabs} label={L("Agents", "Ejen")} />
      {view !== "packages" && view !== "commission" && list && rows.length > 0 && submitBig}

      {view === "overview" && (!list ? <SkelCard lines={3} /> : (
        <>
          <KpiRow label={L("Requests by status", "Permintaan mengikut status")}>
            <KpiTile icon="assignment" tone="navy" label={L("Open requests", "Permintaan terbuka")} value={cnt(...OPEN)} onClick={() => go("requests", "open")} />
            <KpiTile icon="warning" tone="gold" label={L("Need your reply", "Perlu jawapan anda")} value={cnt("more_info")} onClick={() => go("requests", "more_info")} />
            <KpiTile icon="document" tone="green" label={L("Quotations ready", "Sebut harga sedia")} value={cnt("quotation_ready")} onClick={() => go("quotations")} />
            <KpiTile icon="chat" tone="blue" label={L("With clients", "Dengan pelanggan")} value={cnt("with_client", "revision_requested", "acceptance_pending")} onClick={() => go("quotations")} />
            <KpiTile icon="trophy" tone="purple" label={L("Won", "Berjaya")} value={cnt("won")} onClick={() => go("requests", "won")} />
          </KpiRow>
          <section className={css.panel} aria-label={L("Latest", "Terkini")}>
            <h3 className={css.h3}>{L("Latest updates", "Kemas kini terkini")}</h3>
            {rows.length === 0 ? emptyAgent : <RequestList rows={rows.slice(0, 6)} onOpen={setOpen} />}
          </section>
        </>
      ))}

      {view === "packages" && <PackageCatalogue pkgs={pkgs} isAgent onSubmit={(p) => setSubmit({ pkg: p })} />}

      {view === "requests" && (
        !list ? <SkelRows rows={5} /> : rows.length === 0 ? emptyAgent : (
          <section className={css.panel} aria-label={L("Requests", "Permintaan")}>
            <div className={css.toolbar}>
              <input className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Find a client or request", "Cari pelanggan atau permintaan")} aria-label={L("Find", "Cari")} />
              <select className={selectClassSm} value={statusF} onChange={(e) => setStatusF(e.target.value as Filter)} aria-label={L("Status", "Status")}>
                <option value="">{L("All statuses", "Semua status")}</option>
                <option value="open">{L("Open", "Terbuka")}</option>
                {(Object.keys(WORD) as Status[]).map((s) => <option key={s} value={s}>{word(s)}</option>)}
              </select>
              <span className={css.muted}>{L(`${shown.length} shown`, `${shown.length} dipaparkan`)}</span>
            </div>
            {shown.length === 0 ? <p className={css.muted}>{L("No requests match this filter.", "Tiada permintaan sepadan dengan penapis ini.")}</p> : <RequestList rows={shown} onOpen={setOpen} />}
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

      {view === "commission" && <MyCommission />}
      {drawers}
    </div>
  );
}

/* The agent's own requests: a table on a desk; touch cards on a phone (the module's own CSS). */
function RequestList({ rows, onOpen }: { rows: Row[]; onOpen: (id: number) => void }) {
  return (
    <>
      <div className={`${css.tableWrap} ${css.deskOnly}`}>
        <table className={css.table}>
          <thead><tr>
            <th>{L("Request", "Permintaan")}</th>
            <th>{L("Client · package", "Pelanggan · pakej")}</th>
            <th>{L("Status", "Status")}</th>
            <th>{L("Latest update", "Kemas kini terkini")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`agent-req-${r.id}`}>
                <td><button type="button" className={css.linkBtn} onClick={() => onOpen(r.id)}>{r.ref}</button><span className={css.muted}>{day(r.created_at)}</span></td>
                <td><span className={css.strong}>{r.company || r.client_name}</span><span className={css.muted}>{r.package_name ?? L("Custom requirement", "Keperluan khas")}</span></td>
                <td><Chip s={r.status} />{r.published_number && <span className={css.muted}>{r.published_number}</span>}</td>
                <td><span className={css.clamp}>{r.last_text ?? "—"}</span><span className={css.muted}>{[r.last_by, when(r.last_at)].filter(Boolean).join(" · ")}</span></td>
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
              <span className={css.muted}>{r.package_name ?? L("Custom requirement", "Keperluan khas")}</span>
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

/* ================================================================
   v1.347.0 - Sales & management: picture 01, the Overview
   ================================================================ */
interface AgentPerf { id: number; name: string; email: string; active: boolean; verified: boolean; requests: number; open: number; won: number; lost: number; salesperson: string | null }
function StaffOverview({ rows, loaded, cnt, agents, asg, onFilter, onOpen, onAgent, onAgents }: {
  rows: Row[]; loaded: boolean; cnt: (...s: Status[]) => number; agents: AgentRow[] | null; asg: AssignRes | null;
  onFilter: (f: Filter) => void; onOpen: (id: number) => void; onAgent: (id: number) => void; onAgents: () => void;
}) {
  const today = mytToday();
  const weekOn = addDays(today, 7);
  const active = agents?.filter((a) => a.is_active) ?? [];
  const overdue = rows.filter((r) => r.overdue).length;
  const dueSoon = rows.filter((r) => !r.overdue && r.next_follow_up_on && r.next_follow_up_on >= today && r.next_follow_up_on <= weekOn && OPEN.includes(r.status)).length;
  const closed = cnt("won", "not_proceeding");
  /* the pipeline: each stage's count is how many requests stand on it now */
  const steps: FlowStep[] = STAGES.map((s) => ({ key: s.k, icon: s.icon, label: L(s.en, s.ms), tone: s.tone, count: loaded ? cnt(...s.s) : null, onClick: () => onFilter(`stage:${s.k}`) }));
  /* conversion per agent: every agent account (none hidden for having no request), counted from the requests themselves */
  const by = new Map<number, AgentPerf>();
  for (const a of agents ?? []) by.set(a.id, { id: a.id, name: a.name, email: a.email, active: !!a.is_active, verified: !!a.email_verified, requests: 0, open: 0, won: 0, lost: 0, salesperson: asg?.current?.[a.id]?.salesperson_name ?? null });
  for (const r of rows) {
    const p = by.get(r.agent_id) ?? { id: r.agent_id, name: r.agent_name ?? `#${r.agent_id}`, email: "", active: false, verified: false, requests: 0, open: 0, won: 0, lost: 0, salesperson: asg?.current?.[r.agent_id]?.salesperson_name ?? null };
    p.requests++; if (OPEN.includes(r.status)) p.open++; if (r.status === "won") p.won++; if (r.status === "not_proceeding") p.lost++;
    by.set(r.agent_id, p);
  }
  const perf = [...by.values()].sort((a, b) => b.won - a.won || b.requests - a.requests || a.name.localeCompare(b.name));
  const rate = (p: { requests: number; won: number }) => (p.requests ? Math.round((p.won / p.requests) * 100) : 0);
  const cols: TableCol<AgentPerf>[] = [
    { key: "agent", label: L("Agent", "Ejen"), main: true, cell: (p) => <><TaskRowTitle title={p.name} onOpen={() => onAgent(p.id)} /><TaskRowSub>{p.active ? L("Active", "Aktif") : L("Suspended", "Digantung")}{p.email ? ` · ${p.email}` : ""}</TaskRowSub></> },
    { key: "sales", label: L("Salesperson", "Jurujual"), cell: (p) => p.salesperson ?? <span className={css.mutedInline}>{L("Not assigned", "Belum ditugaskan")}</span> },
    { key: "req", label: L("Requests", "Permintaan"), cell: (p) => <span className={css.num}>{p.requests}</span> },
    { key: "open", label: L("Open", "Terbuka"), cell: (p) => <span className={css.num}>{p.open}</span> },
    { key: "won", label: L("Won", "Berjaya"), cell: (p) => <span className={css.num}>{p.won}</span> },
    { key: "conv", label: L("Conversion", "Penukaran"), cell: (p) => (
      <span className={css.conv} title={L(`${p.won} won of ${p.requests} request(s)`, `${p.won} berjaya daripada ${p.requests} permintaan`)}>
        <span className={css.convBar} aria-hidden><span style={{ width: `${rate(p)}%` }} /></span><span className={css.num}>{rate(p)}%</span>
      </span>) },
  ];
  const follow = rows.filter((r) => r.next_follow_up_on && OPEN.includes(r.status) && r.next_follow_up_on <= weekOn).sort((a, b) => (a.next_follow_up_on ?? "").localeCompare(b.next_follow_up_on ?? ""));
  const recent = [...rows].filter((r) => r.last_at).sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? "")).slice(0, 4);
  /* overdue is the server's word (MYT, open requests only); today is only for "Due today" */
  const due = (r: Row) => { const d = r.next_follow_up_on!; return r.overdue ? <span className={css.dueLate}>{L(`Overdue · ${day(d)}`, `Lewat · ${day(d)}`)}</span> : d === today ? <span className={css.dueLate}>{L("Due today", "Hari ini")}</span> : <span className={chipSmNeutral}>{day(d)}</span>; };
  return (
    <>
      <KpiRow label={L("Agents at a glance", "Ejen sepintas lalu")} testid="agents-strip">
        <KpiTile icon="users" tone="navy" label={L("Active Agents", "Ejen Aktif")} busy={!agents} value={active.length}
          sub={agents ? L(`${agents.filter((a) => a.email_verified).length} verified email · ${agents.length - active.length} suspended`, `${agents.filter((a) => a.email_verified).length} e-mel disahkan · ${agents.length - active.length} digantung`) : undefined} onClick={onAgents} />
        <KpiTile icon="assignment" tone="blue" label={L("Open Requests", "Permintaan Terbuka")} busy={!loaded} value={cnt(...OPEN)}
          sub={L(`${cnt("submitted")} new · not yet reviewed`, `${cnt("submitted")} baharu · belum disemak`)} onClick={() => onFilter("open")} />
        <KpiTile icon="document" tone="gold" label={L("Awaiting Quotation", "Menunggu Sebut Harga")} busy={!loaded} value={cnt(...AWAITING)}
          sub={L(`${cnt("more_info")} waiting on the agent`, `${cnt("more_info")} menunggu ejen`)} onClick={() => onFilter("awaiting")} />
        <KpiTile icon="chat" tone="green" label={L("With Client", "Dengan Pelanggan")} busy={!loaded} value={cnt("quotation_ready", "with_client")}
          sub={L("Quotations published to agents", "Sebut harga diterbitkan kepada ejen")} onClick={() => onFilter("stage:client")} />
        <KpiTile icon="verify" tone="purple" label={L("Acceptance to verify", "Penerimaan untuk disahkan")} busy={!loaded} value={cnt("acceptance_pending")}
          sub={L("Sales verifies · the CEO verifies payment", "Jualan mengesahkan · CEO mengesahkan bayaran")} onClick={() => onFilter("stage:acceptance")} />
        <KpiTile icon="time" tone="red" label={L("Overdue follow-up", "Susulan lewat")} busy={!loaded} value={overdue}
          sub={L(`${dueSoon} more due within 7 days`, `${dueSoon} lagi dalam 7 hari`)} onClick={() => onFilter("overdue")} />
      </KpiRow>

      <Panel icon="person" tone="navy" title={L("Agent Pipeline", "Saluran Ejen")} testid="agent-pipeline-panel"
        sub={L("Track agent leads from submission to a won sale. Each count is the number of agent requests at that stage now; press a stage to open them.", "Jejak petunjuk ejen dari penghantaran hingga jualan berjaya. Setiap kiraan ialah bilangan permintaan ejen pada peringkat itu sekarang; tekan untuk membukanya.")}
        aside={loaded ? <span className={css.asideNote}>{L(`${cnt("won")} won · ${cnt("not_proceeding")} not proceeding${closed ? ` · ${Math.round((cnt("won") / closed) * 100)}% of closed` : ""}`, `${cnt("won")} berjaya · ${cnt("not_proceeding")} tidak diteruskan${closed ? ` · ${Math.round((cnt("won") / closed) * 100)}% daripada yang ditutup` : ""}`)}</span> : undefined}>
        <FlowStrip steps={steps} label={L("Agent pipeline", "Saluran ejen")} testid="agent-pipeline" compact arrows />
      </Panel>

      <WorkspaceGrid testid="agents-overview-grid"
        main={
          <Panel icon="chart" tone="gold" title={L("Conversion Performance", "Prestasi Penukaran")} count={agents ? perf.length : null} testid="agent-conversion" flush
            sub={L("Requests each agent brought in, still open and won. Conversion = won ÷ requests submitted.", "Permintaan yang dibawa setiap ejen, masih terbuka dan berjaya. Penukaran = berjaya ÷ permintaan dihantar.")}
            aside={<button type="button" className={btnSm} onClick={onAgents}>{L("Agent directory", "Direktori ejen")}<AppIcon name="next" /></button>}>
            <CompactTaskTable rows={perf} cols={cols} label={L("Conversion by agent", "Penukaran mengikut ejen")} loading={!agents && !loaded} record="agent" testid="agent-conversion-table"
              onOpen={onAgent} empty={<p className={css.calm}><AppIcon name="info" />{L("No agent accounts yet - the owner gives Agent access in Users › Customer Accounts.", "Belum ada akaun ejen - pemilik memberi akses Ejen dalam Pengguna › Akaun Pelanggan.")}</p>} />
          </Panel>
        }
        rail={<>
          <Panel icon="date" tone="red" title={L("Important Follow-Ups", "Susulan Penting")} count={loaded ? follow.length : null} level={3} testid="agent-followups"
            aside={<button type="button" className={btnSm} onClick={() => onFilter("overdue")}>{L("View all", "Lihat semua")}<AppIcon name="next" /></button>}>
            {!loaded ? <SkelRows rows={3} /> : follow.length === 0 ? <p className={css.calm}><AppIcon name="success" />{L("No follow-up is due this week.", "Tiada susulan perlu minggu ini.")}</p> : (
              <ul className={css.feed}>
                {follow.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <button type="button" className={css.feedItem} onClick={() => onOpen(r.id)}>
                      <span className={css.dot} data-late={r.overdue || undefined} aria-hidden />
                      <span className={css.feedText}><strong>{r.company || r.client_name}</strong><small>{r.ref} · {r.agent_name ?? "—"} · {r.assigned_name ?? L("not assigned", "belum ditugaskan")}</small></span>
                      {due(r)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel icon="chat" tone="blue" title={L("Recent Agent Activity", "Aktiviti Ejen Terkini")} level={3} testid="agent-activity">
            {!loaded ? <SkelRows rows={3} /> : recent.length === 0 ? <p className={css.calm}><AppIcon name="info" />{L("No Agent submissions have been received yet.", "Belum ada permintaan daripada ejen.")}</p> : (
              <ul className={css.feed}>
                {recent.map((r) => (
                  <li key={r.id}>
                    <button type="button" className={css.feedItem} onClick={() => onOpen(r.id)}>
                      <AppIcon name="document" className={css.feedIcon} />
                      <span className={css.feedText}><strong>{r.ref} · {r.company || r.client_name}</strong><small className={css.clampOne}>{r.last_text ?? "—"}</small><small>{[r.last_by, when(r.last_at)].filter(Boolean).join(" · ")}</small></span>
                      <Chip s={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>} />
    </>
  );
}

/* the head of a staff tab (pictures 02-04): its title, one line, its one command */
function Intro({ title, sub, action }: { title: ReactNode; sub: ReactNode; action?: ReactNode }) {
  return (
    <header className={css.intro}>
      <div className={css.introText}><h2 className={css.introTitle}>{title}</h2><p className={css.introSub}>{sub}</p></div>
      {action}
    </header>
  );
}

/* ================================================================
   picture 02: Requests - the inbox beside the Request-to-Sale Workflow
   ================================================================ */
function RequestsInbox({ rows, shown, loaded, agents, filter, onFilter, agentF, onAgentF, q, onQ, onOpen, canGrant, onManage, onAgents }: {
  rows: Row[]; shown: Row[]; loaded: boolean; agents: AgentRow[] | null;
  filter: Filter; onFilter: (f: Filter) => void; agentF: number; onAgentF: (id: number) => void; q: string; onQ: (v: string) => void;
  onOpen: (id: number) => void; canGrant: boolean; onManage: () => void; onAgents: () => void;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const key = `${filter}|${agentF}|${q}`;
  const [seen, setSeen] = useState(key);
  if (key !== seen) { setSeen(key); setPage(1); }
  const today = mytToday();
  const weekOn = addDays(today, 7);
  const overdue = rows.filter((r) => r.overdue).length;
  const dueSoon = rows.filter((r) => !r.overdue && r.next_follow_up_on && r.next_follow_up_on >= today && r.next_follow_up_on <= weekOn && OPEN.includes(r.status)).length;
  /* the agent filter: every account, and anyone who brought a request before they were removed */
  const people = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of agents ?? []) m.set(a.id, a.name);
    for (const r of rows) if (!m.has(r.agent_id)) m.set(r.agent_id, r.agent_name ?? `#${r.agent_id}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [agents, rows]);
  const cols: TableCol<Row>[] = [
    { key: "client", label: L("Client · request", "Pelanggan · permintaan"), main: true, cell: (r) => <><TaskRowTitle title={r.company || r.client_name} onOpen={() => onOpen(r.id)} /><TaskRowSub><span data-testid={`agent-req-${r.id}`}>{r.ref}</span><span>{r.package_name ?? L("Custom requirement", "Keperluan khas")}</span></TaskRowSub></> },
    { key: "agent", label: L("Agent", "Ejen"), cell: (r) => r.agent_name ?? "—" },
    { key: "sales", label: L("Sales", "Jualan"), cell: (r) => r.assigned_name ?? <span className={chipSmWarn}>{L("Not assigned", "Belum ditugaskan")}</span> },
    { key: "status", label: L("Quotation progress", "Kemajuan sebut harga"), cell: (r) => <span className={css.stack}><Chip s={r.status} />{(r.published_number || r.quotation_number) && <small className={css.mutedInline}>{r.published_number ?? r.quotation_number}</small>}</span> },
    { key: "follow", label: L("Follow-up", "Susulan"), cell: (r) => r.next_follow_up_on ? <span className={r.overdue ? css.dueLate : css.mutedInline}>{day(r.next_follow_up_on)}</span> : <span className={css.mutedInline}>—</span> },
  ];
  const empty = rows.length === 0 ? (
    <div className={css.emptyBox} data-testid="staff-empty">
      <span className={css.emptyIcon} aria-hidden><AppIcon name="chat" /></span>
      <strong>{L("No Agent submissions have been received yet.", "Belum ada permintaan daripada ejen.")}</strong>
      <p>{L("Once an agent submits a client, the request appears here for Sales to review and assign. No duplicate enquiry is created.", "Sebaik ejen menghantar pelanggan, permintaan itu muncul di sini untuk Jualan menyemak dan menugaskan. Tiada pertanyaan berganda dibuat.")}</p>
      <span className={css.row}>
        <button type="button" className={btnSmPrimary} onClick={onAgents}>{L("View active agents", "Lihat ejen aktif")}</button>
        {canGrant && <button type="button" className={btnSm} onClick={onManage}><AppIcon name="users" />{L("Manage Agent Access", "Urus Akses Ejen")}</button>}
      </span>
    </div>
  ) : <p className={css.calm}><AppIcon name="search" />{L("No requests match this filter.", "Tiada permintaan sepadan dengan penapis ini.")}</p>;
  return (
    <>
      <Intro title={L("Agent Requests", "Permintaan Ejen")} sub={L("A focused intake queue. Every request stays linked to its original agent and assigned salesperson.", "Barisan masuk yang fokus. Setiap permintaan kekal dipaut kepada ejen asal dan jurujual yang ditugaskan.")}
        action={canGrant ? <button type="button" className={btnSm} data-testid="manage-agent-access" onClick={onManage}><AppIcon name="users" />{L("Manage Agent Access", "Urus Akses Ejen")}</button> : undefined} />
      <WorkspaceSplit testid="agent-requests-split" ratio="60-40">
        <SplitPane testid="requests-inbox" title={L("Requests Inbox", "Peti Permintaan")} label={L("Requests inbox", "Peti permintaan")}
          sub={L("Incoming clients, Sales assignment, quotation progress and follow-up.", "Pelanggan masuk, tugasan Jualan, kemajuan sebut harga dan susulan.")}
          actions={<span className={chipSmNeutral} data-testid="inbox-count">{loaded ? (filter || agentF || q ? L(`${shown.length} of ${rows.length}`, `${shown.length} daripada ${rows.length}`) : L(`${rows.length} request${rows.length === 1 ? "" : "s"}`, `${rows.length} permintaan`)) : "…"}</span>}
          toolbar={<TaskToolbar q={q} onQ={onQ} placeholder={L("Search client, request ID or agent", "Cari pelanggan, ID permintaan atau ejen")} testid="requests-toolbar">
            <select className={selectClassSm} value={filter} onChange={(e) => onFilter(e.target.value as Filter)} aria-label={L("Status", "Status")}>
              <option value="">{L("All statuses", "Semua status")}</option>
              <option value="open">{L("Open", "Terbuka")}</option>
              <option value="overdue">{L("Overdue follow-up", "Susulan lewat")}</option>
              {filter.startsWith("stage:") || filter === "awaiting" ? <option value={filter}>{filterWord(filter)}</option> : null}
              {(Object.keys(WORD) as Status[]).filter((s) => s !== "draft").map((s) => <option key={s} value={s}>{word(s)}</option>)}
            </select>
            <select className={selectClassSm} value={agentF} onChange={(e) => onAgentF(Number(e.target.value))} aria-label={L("Agent", "Ejen")}>
              <option value={0}>{L("All agents", "Semua ejen")}</option>
              {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </TaskToolbar>}>
          <CompactTaskTable rows={shown} cols={cols} label={L("Agent requests", "Permintaan ejen")} loading={!loaded} record="agent-request" testid="requests-table" dense fill
            onOpen={onOpen} rowClass={(r) => (r.overdue ? css.lateRow ?? "" : "")} empty={empty} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} />
        </SplitPane>
        <SplitPane testid="request-workflow" title={L("Request-to-Sale Workflow", "Aliran Permintaan-ke-Jualan")} label={L("Request-to-sale workflow", "Aliran permintaan ke jualan")}
          sub={L("For management and the assigned Sales team. Press a step to see its requests.", "Untuk pengurusan dan pasukan Jualan yang ditugaskan. Tekan langkah untuk melihat permintaannya.")}>
          <ol className={css.flow}>
            {STAGES.filter((s) => s.k !== "won").map((s, i) => {
              const n = rows.filter((r) => s.s.includes(r.status)).length;
              const on = filter === `stage:${s.k}`;
              return (
                <li key={s.k}>
                  <button type="button" className={css.flowStep} aria-pressed={on} onClick={() => onFilter(on ? "" : `stage:${s.k}`)} data-testid={`flow-${s.k}`}>
                    <span className={css.flowNo} aria-hidden>{i + 1}</span>
                    <span className={css.flowText}><strong>{L(s.who[0], s.who[1])}</strong><small>{L(s.what[0], s.what[1])}</small></span>
                    <span className={css.flowCount} aria-label={L(`${n} request(s)`, `${n} permintaan`)}>{loaded ? n : "…"}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className={css.goldNote} data-testid="followup-note">
            <AppIcon name="time" />
            <span><strong>{L("Follow-up controls:", "Kawalan susulan:")}</strong> {L(`${overdue} overdue · ${dueSoon} due within 7 days, each linked to its request. Nothing here approves an acceptance or a payment.`, `${overdue} lewat · ${dueSoon} dalam 7 hari, setiap satu dipaut kepada permintaannya. Tiada apa di sini meluluskan penerimaan atau bayaran.`)}</span>
            {overdue > 0 && <button type="button" className={btnSmQuiet} onClick={() => onFilter("overdue")}>{L("Show overdue", "Tunjuk lewat")}</button>}
          </div>
        </SplitPane>
      </WorkspaceSplit>
    </>
  );
}

/* ================================================================
   picture 03: Agents - the directory beside the chosen agent
   ================================================================ */
function AgentDirectory({ agents, failed, rows, asg, picked, onPick, canGrant, onManage, onRequests, onAssigned }: {
  agents: AgentRow[] | null; failed: string; rows: Row[]; asg: AssignRes | null; picked: number | null; onPick: (id: number) => void;
  canGrant: boolean; onManage: () => void; onRequests: (agentId: number) => void; onAssigned: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<"active" | "suspended" | "all">("all");
  const [editing, setEditing] = useState<number | null>(null);
  const list = (agents ?? []).filter((a) => (state === "all" || (state === "active" ? !!a.is_active : !a.is_active)) && (!q || `${a.name} ${a.email}`.toLowerCase().includes(q.toLowerCase())));
  const a = (agents ?? []).find((x) => x.id === picked) ?? list[0] ?? null;
  const manageBtn = canGrant ? <button type="button" className={btnSmPrimary} data-testid="manage-agent-access-dir" onClick={onManage}><AppIcon name="users" />{L("Manage Agent Access", "Urus Akses Ejen")}</button> : null;
  const cur = a ? asg?.current?.[a.id] : undefined;
  /* the scope the server states for every agent: all active packages, both companies (agents have no company restriction) */
  const scope = a ? Object.entries(ISSUER).filter(([, name]) => a.scope.toUpperCase().includes(name)).map(([code]) => code) : [];
  const theirs = a ? rows.filter((r) => r.agent_id === a.id) : [];
  return (
    <>
      <Intro title={L("Agent Directory", "Direktori Ejen")} sub={L("Verified access, the assigned Sales owner and each agent's performance - on the existing user accounts, never a second user system.", "Akses disahkan, pemilik Jualan yang ditugaskan dan prestasi setiap ejen - pada akaun pengguna sedia ada, tiada sistem pengguna kedua.")} action={manageBtn} />
      {failed ? <p className={css.warn} role="alert">{failed}</p> : (
        <WorkspaceSplit testid="agent-directory-split" ratio="50-50">
          <SplitPane testid="agent-list" title={<>{L("Agents", "Ejen")} {agents && <span className={css.titleCount}>({agents.length})</span>}</>} label={L("Agents", "Ejen")}
            sub={L("Customer accounts given Agent access by the owner.", "Akaun pelanggan yang diberi akses Ejen oleh pemilik.")}
            actions={agents ? <span className={chipSmSuccess}>{L(`${agents.filter((x) => x.is_active).length} active`, `${agents.filter((x) => x.is_active).length} aktif`)}</span> : undefined}
            toolbar={<TaskToolbar q={q} onQ={setQ} placeholder={L("Search agent name or email", "Cari nama atau e-mel ejen")} testid="agents-toolbar">
              <select className={selectClassSm} value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={L("Access", "Akses")}>
                <option value="all">{L("All", "Semua")}</option><option value="active">{L("Active", "Aktif")}</option><option value="suspended">{L("Suspended", "Digantung")}</option>
              </select>
            </TaskToolbar>}
            foot={agents && agents.length > 0 ? <span className={css.mutedInline}>{L("Select an agent to review ownership, submissions and permissions. Taking access away keeps every request with its agent.", "Pilih ejen untuk menyemak pemilikan, penghantaran dan kebenaran. Menarik akses kekalkan setiap permintaan bersama ejennya.")}</span> : undefined}>
            {!agents ? <SkelRows rows={3} /> : agents.length === 0 ? (
              <div className={css.emptyBox} data-testid="agents-empty">
                <span className={css.emptyIcon} aria-hidden><AppIcon name="users" /></span>
                <strong>{L("No active agents yet.", "Belum ada ejen aktif.")}</strong>
                <p>{canGrant
                  ? L("Agent access is given in Users › Customer Accounts to a customer account whose email is verified - the same account becomes an agent.", "Akses ejen diberi dalam Pengguna › Akaun Pelanggan kepada akaun pelanggan yang e-melnya disahkan - akaun yang sama menjadi ejen.")
                  : L("The company owner gives Agent access in Users › Customer Accounts.", "Pemilik syarikat memberi akses Ejen dalam Pengguna › Akaun Pelanggan.")}</p>
                {canGrant && <button type="button" className={btnSmPrimary} onClick={onManage}><AppIcon name="users" />{L("Manage Agent Access", "Urus Akses Ejen")}</button>}
              </div>
            ) : list.length === 0 ? <p className={css.calm}><AppIcon name="search" />{L("No agent matches.", "Tiada ejen sepadan.")}</p> : (
              <ul className={css.agentList} aria-label={L("Agent accounts", "Akaun ejen")}>
                {list.map((x) => (
                  <li key={x.id}>
                    <button type="button" className={css.agentRow} aria-pressed={a?.id === x.id} onClick={() => { onPick(x.id); setEditing(null); }} data-testid={`agent-acct-${x.id}`}>
                      <Avatar name={x.name} photoKey={null} size="md" />
                      <span className={css.agentText}><strong>{x.name}</strong><small>{x.email_verified ? L("Verified email", "E-mel disahkan") : L("Email not verified", "E-mel belum disahkan")} · {L("Agent portal access", "Akses portal ejen")}</small></span>
                      <span className={x.is_active ? chipSmSuccess : chipSmNeutral}>{x.is_active ? L("Active", "Aktif") : L("Suspended", "Digantung")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SplitPane>
          <SplitPane testid="agent-profile" title={L("Agent Profile & Ownership", "Profil & Pemilikan Ejen")} label={L("Agent profile and ownership", "Profil dan pemilikan ejen")}
            sub={L("Only authorised actions for the selected agent.", "Hanya tindakan yang dibenarkan untuk ejen dipilih.")}
            actions={a ? <span className={a.email_verified ? chipSmSuccess : chipSmWarn}>{a.email_verified ? L("Verified", "Disahkan") : L("Not verified", "Belum disahkan")}</span> : undefined}>
            {!a ? <p className={css.calm}><AppIcon name="info" />{agents ? L("No agent is selected.", "Tiada ejen dipilih.") : L("Reading the agents…", "Membaca ejen…")}</p> : (
              <div className={css.profile} data-testid={`agent-profile-${a.id}`}>
                <section className={css.fact}>
                  <span className={css.factLabel}>{L("Account", "Akaun")}</span>
                  <strong className={css.factName}>{a.name}</strong>
                  <span className={css.mutedInline}>{L("Agent portal", "Portal ejen")}: {a.is_active ? L("Active", "Aktif") : L("Suspended", "Digantung")} · {a.email_verified ? L("Verified email", "E-mel disahkan") : L("Email not verified", "E-mel belum disahkan")} · {a.email}</span>
                  <span className={css.mutedInline}>{L("Latest activity", "Aktiviti terkini")}: {a.last_activity ? when(a.last_activity) : L("none yet", "belum ada")}</span>
                </section>
                <section className={css.fact}>
                  <span className={css.factLabel}>{L("Approved company scope", "Skop syarikat diluluskan")}</span>
                  <span className={css.row}>{scope.length ? scope.map((c) => <span key={c} className={css.scopeChip}>{COMPANY[c]}</span>) : <span className={css.mutedInline}>{a.scope}</span>}</span>
                  <span className={css.mutedInline}>{L("All active packages; each request keeps the company that issues its package.", "Semua pakej aktif; setiap permintaan kekal dengan syarikat yang mengeluarkan pakejnya.")}</span>
                </section>
                <section className={css.fact}>
                  <span className={css.factLabel}>{L("Assigned salesperson", "Jurujual ditugaskan")}</span>
                  {cur ? (
                    <span className={css.ownerBox} data-testid={`agent-assigned-${a.id}`}><strong>{cur.salesperson_name}</strong><small>{L(`From ${day(cur.effective_from)} · set by ${cur.set_by_name}`, `Mulai ${day(cur.effective_from)} · ditetapkan oleh ${cur.set_by_name}`)}{cur.reason ? ` · ${cur.reason}` : ""}</small></span>
                  ) : (
                    <span className={css.warnBox} data-testid={`agent-assigned-${a.id}`}><strong>{L("Not assigned", "Belum ditugaskan")}</strong><small>{L("Assign ownership so no incoming client is left unhandled. Until then Sales assigns each request.", "Tugaskan pemilikan supaya tiada pelanggan masuk terbiar. Sehingga itu Jualan menugaskan setiap permintaan.")}</small></span>
                  )}
                  {asg?.can_manage && editing === a.id && <AssignForm agentId={a.id} people={asg.salespeople} today={asg.today ?? ""} onClose={() => setEditing(null)} onDone={(name) => { setEditing(null); onAssigned(name); }} />}
                </section>
                <KpiRow label={L("This agent's requests", "Permintaan ejen ini")} testid="agent-figures">
                  <KpiTile icon="assignment" tone="navy" label={L("Requests", "Permintaan")} value={a.requests} />
                  <KpiTile icon="pending" tone="blue" label={L("Open", "Terbuka")} value={a.open_requests} />
                  <KpiTile icon="trophy" tone="green" label={L("Won", "Berjaya")} value={a.won} sub={a.requests ? L(`${Math.round((a.won / a.requests) * 100)}% conversion`, `${Math.round((a.won / a.requests) * 100)}% penukaran`) : undefined} />
                </KpiRow>
                <span className={css.row}>
                  {asg?.can_manage && editing !== a.id && <button type="button" className="erp-button erp-button-accent erp-button-compact" onClick={() => setEditing(a.id)} data-testid="assign-salesperson">{cur ? L("Change Salesperson", "Tukar Jurujual") : L("Assign Salesperson", "Tugaskan Jurujual")}</button>}
                  {canGrant && <button type="button" className={btnSm} onClick={onManage}>{L("Manage Access", "Urus Akses")}</button>}
                  <button type="button" className={btnSm} onClick={() => onRequests(a.id)} disabled={theirs.length === 0} title={theirs.length === 0 ? L("No request from this agent yet", "Belum ada permintaan daripada ejen ini") : undefined}>{L(`View Requests (${theirs.length})`, `Lihat Permintaan (${theirs.length})`)}</button>
                </span>
                <p className={css.goldNote} data-testid="commission-rule"><AppIcon name="lock" /><span>{L("An agent's commission becomes eligible only after the invoice is paid in full and that payment is verified by the CEO. The salesperson's internal share is never shown in the agent portal.", "Komisen ejen hanya layak selepas invois dibayar penuh dan bayaran itu disahkan oleh CEO. Bahagian dalaman jurujual tidak pernah dipaparkan dalam portal ejen.")}</span></p>
              </div>
            )}
          </SplitPane>
        </WorkspaceSplit>
      )}
    </>
  );
}

/* ================================================================
   picture 04: Packages - the catalogue beside its governance. The agent's
   own Packages tab is the same catalogue, without the governance pane.
   ================================================================ */
const pkgIcon = (p: Pkg): AppIconName => {
  const t = `${p.category ?? ""} ${p.kind ?? ""} ${p.name}`.toLowerCase();
  return /web|site|laman/.test(t) ? "content" : /review|ulasan/.test(t) ? "star" : /design|reka|poster|promosi/.test(t) ? "idea" : /video|live/.test(t) ? "video" : "package";
};
function PackageCatalogue({ pkgs, isAgent, onSubmit, toSales, onRequests }: { pkgs: Pkg[] | null; isAgent: boolean; onSubmit?: (p: Pkg) => void; toSales?: () => void; onRequests?: () => void }) {
  const [q, setQ] = useState("");
  const [co, setCo] = useState("");
  const [cat, setCat] = useState("");
  const [viewing, setViewing] = useState<Pkg | null>(null);
  const cats = useMemo(() => [...new Set((pkgs ?? []).map((p) => p.category).filter((c): c is string => !!c))].sort(), [pkgs]);
  const list = (pkgs ?? []).filter((p) => (!co || p.issuers.includes(co)) && (!cat || p.category === cat)
    && (!q || `${p.name} ${p.category ?? ""} ${p.description ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const body = !pkgs ? <SkelRows rows={4} /> : pkgs.length === 0 ? <p className={css.calm}><AppIcon name="info" />{L("No active packages yet.", "Belum ada pakej aktif.")}</p>
    : list.length === 0 ? <p className={css.calm}><AppIcon name="search" />{L("No package matches.", "Tiada pakej sepadan.")}</p> : (
      <ul className={css.pkgList}>
        {list.map((p) => (
          <li key={p.id} className={css.pkgRow} data-testid={`agent-pkg-${p.id}`}>
            <span className={css.pkgIcon} aria-hidden><AppIcon name={pkgIcon(p)} /></span>
            <span className={css.pkgText}>
              <small className={css.pkgCat}>{p.category ?? L("Package", "Pakej")}</small>
              <strong>{p.name}</strong>
              <small>{[p.description, p.issuers.map((i) => COMPANY[i] ?? i).join(" · ")].filter(Boolean).join(" · ")}</small>
            </span>
            <span className={css.pkgPrice}>{fmtRM(p.total_cents)}</span>
            <span className={css.pkgCmds}>
              <button type="button" className={btnSm} onClick={() => setViewing(p)}>{L("View", "Lihat")}</button>
              {isAgent && onSubmit && <button type="button" className={btnSmPrimary} onClick={() => onSubmit(p)}>{L("Submit a client", "Hantar pelanggan")}</button>}
            </span>
          </li>
        ))}
      </ul>
    );
  const toolbar = (
    <TaskToolbar q={q} onQ={setQ} placeholder={L("Search package name or category", "Cari nama atau kategori pakej")} testid="packages-toolbar">
      <select className={selectClassSm} value={co} onChange={(e) => setCo(e.target.value)} aria-label={L("Company", "Syarikat")}>
        <option value="">{L("All companies", "Semua syarikat")}</option>
        {Object.keys(ISSUER).map((c) => <option key={c} value={c}>{COMPANY[c]}</option>)}
      </select>
      <select className={selectClassSm} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={L("Category", "Kategori")}>
        <option value="">{L("All categories", "Semua kategori")}</option>
        {cats.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </TaskToolbar>
  );
  const listPane = (
    <SplitPane testid="package-list" title={<>{L("Available Packages", "Pakej Tersedia")} {pkgs && <span className={css.titleCount}>({pkgs.length})</span>}</>} label={L("Available packages", "Pakej tersedia")}
      sub={isAgent ? L("The approved packages you can offer, at their current price.", "Pakej diluluskan yang boleh anda tawarkan, pada harga semasa.") : L("The active packages at their current version and price - no duplicate pricing engine.", "Pakej aktif pada versi dan harga semasa - tiada enjin harga berganda.")}
      actions={pkgs ? <span className={chipSmWarn}>{L(`${pkgs.length} listed`, `${pkgs.length} disenaraikan`)}</span> : undefined} toolbar={toolbar}>
      {body}
    </SplitPane>
  );
  const drawer = viewing && (
    <SideDrawer open onClose={() => setViewing(null)} title={viewing.name} subtitle={viewing.category ?? L("Package", "Pakej")}
      footer={isAgent && onSubmit ? <div className={css.footer}><button type="button" className={btnClass} onClick={() => { const p = viewing; setViewing(null); onSubmit(p); }}>{L("Submit a client", "Hantar pelanggan")}</button></div>
        : toSales ? <div className={css.footer}><button type="button" className={btnSm} onClick={toSales}>{L("Open in Sales", "Buka dalam Jualan")}<AppIcon name="external" /></button></div> : undefined}>
      <div className={css.drawer} data-testid="package-detail">
        <dl className={css.dl}>
          <dt>{L("Approved price", "Harga diluluskan")}</dt><dd className={css.strong}>{fmtRM(viewing.total_cents)}</dd>
          <dt>{L("Issuing company", "Syarikat pengeluar")}</dt><dd>{viewing.issuers.map((i) => ISSUER[i] ?? i).join(" · ") || "—"}</dd>
          {viewing.version ? <><dt>{L("Version", "Versi")}</dt><dd>{viewing.version}</dd></> : null}
          {viewing.description && <><dt>{L("Description", "Keterangan")}</dt><dd className={css.pre}>{viewing.description}</dd></>}
        </dl>
        {viewing.lines.length > 0 && (
          <section className={css.block} aria-label={L("What is included", "Apa yang termasuk")}>
            <h3 className={css.h3}>{L("What is included", "Apa yang termasuk")}</h3>
            <ul className={css.lines}>{viewing.lines.map((l, i) => <li key={i}>{l.qty > 1 ? `${l.qty} × ` : ""}{l.name}</li>)}</ul>
          </section>
        )}
        <p className={css.lock}>{L("Sales prepares the official quotation from this package; the agent cannot change its price or terms.", "Jualan menyediakan sebut harga rasmi daripada pakej ini; ejen tidak boleh mengubah harga atau terma.")}</p>
      </div>
    </SideDrawer>
  );
  if (isAgent) return <div className={css.agentPkgs}>{listPane}{drawer}</div>;
  const principle = (icon: AppIconName, t: [string, string], s: [string, string]) => (
    <li className={css.rule}><span className={css.ruleIcon} aria-hidden><AppIcon name={icon} /></span><span className={css.flowText}><strong>{L(t[0], t[1])}</strong><small>{L(s[0], s[1])}</small></span></li>
  );
  return (
    <>
      <Intro title={L("Package Catalogue", "Katalog Pakej")} sub={L("Agents can present only approved packages. Sales owns official quotations and final prices.", "Ejen hanya boleh membentangkan pakej yang diluluskan. Jualan memiliki sebut harga rasmi dan harga akhir.")}
        action={toSales ? <button type="button" className={btnSm} onClick={toSales} data-testid="open-sales-packages">{L("Open Master Packages in Sales", "Buka Pakej Induk dalam Jualan")}<AppIcon name="external" /></button> : undefined} />
      <WorkspaceSplit testid="package-split" ratio="60-40">
        {listPane}
        <SplitPane testid="package-governance" title={L("Package Governance", "Tadbir Urus Pakej")} label={L("Package governance", "Tadbir urus pakej")}
          sub={L("Keep agent offers accurate, sellable and easy to convert.", "Pastikan tawaran ejen tepat, boleh dijual dan mudah ditukar.")}>
          <ul className={css.rules}>
            {principle("success", ["One source of truth", "Satu sumber kebenaran"], ["Prices, versions and availability come from the packages in Sales - this list only reads them.", "Harga, versi dan ketersediaan datang daripada pakej dalam Jualan - senarai ini hanya membacanya."])}
            {principle("success", ["Company ownership retained", "Pemilikan syarikat dikekalkan"], ["Each package names its issuing company: A2Z Creative Marketing or AZ ONE OFFICIAL.", "Setiap pakej menamakan syarikat pengeluarnya: A2Z Creative Marketing atau AZ ONE OFFICIAL."])}
            {principle("success", ["Agent shares a package, never edits a quotation", "Ejen berkongsi pakej, tidak mengubah sebut harga"], ["The agent chooses a package for the client; Sales prepares the official quotation.", "Ejen memilih pakej untuk pelanggan; Jualan menyediakan sebut harga rasmi."])}
            {principle("success", ["Only approved prices and terms", "Hanya harga dan terma diluluskan"], ["Draft and archived packages are never listed, so no outdated offer or unapproved discount reaches a client.", "Pakej draf dan diarkibkan tidak disenaraikan, jadi tiada tawaran lapuk atau diskaun tidak diluluskan sampai kepada pelanggan."])}
          </ul>
          <p className={css.goldNote}><AppIcon name="idea" /><span><strong>{L("Revenue principle:", "Prinsip hasil:")}</strong> {L("every request stays linked to its package, its agent, the assigned salesperson and the Sales quotation; commission follows only a verified payment.", "setiap permintaan kekal dipaut kepada pakejnya, ejennya, jurujual yang ditugaskan dan sebut harga Jualan; komisen hanya mengikut bayaran yang disahkan.")}</span></p>
          <span className={css.row}>
            {toSales && <button type="button" className="erp-button erp-button-accent erp-button-compact" onClick={toSales}>{L("Review Package Visibility", "Semak Keterlihatan Pakej")}</button>}
            {onRequests && <button type="button" className={btnSm} onClick={onRequests}>{L("View Agent Requests", "Lihat Permintaan Ejen")}</button>}
          </span>
        </SplitPane>
      </WorkspaceSplit>
      {drawer}
    </>
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
