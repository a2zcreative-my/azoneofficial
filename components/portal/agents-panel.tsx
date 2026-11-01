"use client";

/* v1.249.0 - THE AGENT DESK. v1.250.0 - THE AGENT PORTAL WORKFLOW (the owner's
   brief "Complete Agent Portal, Client Submission, Quotation Distribution &
   Collaboration", claude/AGENT-PORTAL-AUDIT.md, his "Approved", 01-11-2026).

   One tab, two views decided by the server's answer, never by the menu:

   - An AGENT: Overview, Packages to promote, My Requests, My Quotations,
     Updates. Submit a client (a package or a custom requirement, draft or
     send), answer Sales' questions, share the PUBLISHED quotation (a portal
     email when mail is set up, otherwise the link and a self-reported
     share), report what the client said - a "yes" needs evidence.
   - SALES & MANAGEMENT: Overview (the request statuses, overdue follow-ups),
     Requests (the latest update on every row) and Agents. The drawer has the
     request, its quotation (Create quotation in Sales - the existing form,
     prefilled; Publish to Agent; Record acceptance + Verify) and a
     task-style timeline where every entry is internal or visible to the agent.

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
import { LineTabs, TabAction } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
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

export function AgentsPanel({ role }: { role: string }) {
  const isAgent = role === "agent";
  type View = "overview" | "packages" | "requests" | "quotations" | "updates" | "agents";
  const [view, setView] = useState<View>(isAgent ? "overview" : "requests");
  const [pkgs, setPkgs] = useState<Pkg[] | null>(null);
  const [list, setList] = useState<ListRes | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const [submit, setSubmit] = useState<{ pkg: Pkg | null } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [statusF, setStatusF] = useState<"" | Status | "open" | "overdue">("");
  const [q, setQ] = useState("");
  const { show, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<{ packages?: Pkg[]; error?: { message?: string } }>("/staff/agent/packages", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok) setPkgs(r.data?.packages ?? []); else setFailed(r.data?.error?.message ?? L("The agent desk could not be loaded.", "Meja ejen tidak dapat dimuatkan."));
    });
    void api<ListRes>("/staff/agent/requests", { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setList(r.data); });
    return () => c.abort();
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const rows = useMemo(() => list?.requests ?? [], [list]);
  const shown = useMemo(() => rows.filter((r) => (!statusF || (statusF === "open" ? OPEN.includes(r.status) : statusF === "overdue" ? !!r.overdue : r.status === statusF))
    && (!q || `${r.ref} ${r.client_name} ${r.company ?? ""} ${r.agent_name ?? ""} ${r.package_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, statusF, q]);
  const cnt = (...s: Status[]) => s.reduce((n, k) => n + (list?.counts?.[k] ?? 0), 0);

  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  const tabs: readonly (readonly [View, string])[] = isAgent
    ? [["overview", L("Overview", "Ringkasan")], ["packages", L("Packages", "Pakej")], ["requests", L("My Requests", "Permintaan Saya")], ["quotations", L("My Quotations", "Sebut Harga Saya")], ["updates", L("Updates", "Kemas Kini")]]
    : [["overview", L("Overview", "Ringkasan")], ["requests", L("Requests", "Permintaan")], ["agents", L("Agents", "Ejen")], ["packages", L("Packages", "Pakej")]];
  const go = (v: View, f: typeof statusF = "") => { setStatusF(f); setView(v); };
  const submitBtn = isAgent && list?.can_submit ? <TabAction icon="add" onClick={() => setSubmit({ pkg: null })}>{L("Submit client request", "Hantar permintaan pelanggan")}</TabAction> : undefined;

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
      </header>
      <LineTabs value={view} onChange={(v) => go(v)} tabs={tabs} label={L("Agents", "Ejen")} aside={submitBtn} />

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
            <RequestTable rows={rows.filter((r) => r.status !== "draft").slice(0, 6)} isAgent={isAgent} onOpen={setOpen} empty={isAgent ? L("No requests yet - open Packages and submit a client.", "Belum ada permintaan - buka Pakej dan hantar pelanggan.") : L("No agent requests yet.", "Belum ada permintaan ejen.")} />
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
        !list ? <SkelRows rows={5} /> : (
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
            <RequestTable rows={shown} isAgent={isAgent} onOpen={setOpen} empty={L("No requests match.", "Tiada permintaan sepadan.")} />
          </section>
        )
      )}

      {view === "quotations" && (!list ? <SkelRows rows={3} /> : (
        <section className={css.panel} aria-label={L("My quotations", "Sebut harga saya")}>
          {rows.filter((r) => r.published_number).length === 0
            ? <p className={css.muted}>{L("No quotation has been published to you yet. Sales publishes it here once it is approved.", "Belum ada sebut harga diterbitkan kepada anda. Jualan menerbitkannya di sini selepas diluluskan.")}</p>
            : <ul className={css.qlist}>{rows.filter((r) => r.published_number).map((r) => (
                <li key={r.id} className={css.qrow} data-testid={`agent-qt-${r.id}`}>
                  <div className={css.qmain}><span className={css.strong}>{r.published_number}{r.published_revision ? ` · REV ${r.published_revision}` : ""}</span><span className={css.muted}>{r.ref} · {r.company || r.client_name} · {r.package_name ?? L("Custom requirement", "Keperluan khas")}</span></div>
                  <Chip s={r.status} />
                  <button type="button" className={btnSm} onClick={() => setOpen(r.id)}>{L("Open", "Buka")}</button>
                </li>))}</ul>}
        </section>
      ))}

      {view === "updates" && (!list ? <SkelRows rows={4} /> : (
        <section className={css.panel} aria-label={L("Updates", "Kemas kini")}>
          {rows.filter((r) => r.last_at).length === 0 ? <p className={css.muted}>{L("Nothing yet.", "Belum ada.")}</p> : (
            <ul className={css.timeline}>{[...rows].filter((r) => r.last_at).sort((a, b) => String(b.last_at).localeCompare(String(a.last_at))).slice(0, 30).map((r) => (
              <li key={r.id}><button type="button" className={css.tlBtn} onClick={() => setOpen(r.id)}>
                <span className={css.strong}>{r.ref} · {r.company || r.client_name}</span>
                <span>{r.last_text}</span>
                <span className={css.muted}>{r.last_by ?? ""} · {when(r.last_at)}</span>
              </button></li>))}</ul>)}
        </section>
      ))}

      {view === "agents" && !isAgent && <AgentsList />}

      {submit && pkgs && <SubmitSheet pkgs={pkgs} initial={submit.pkg} onClose={() => setSubmit(null)} onDone={(draft) => { setSubmit(null); go("requests"); reload(); show(draft ? L("Draft saved", "Draf disimpan") : L("Sent to the sales team", "Dihantar kepada pasukan jualan")); }} />}
      {open !== null && <RequestDrawer id={open} isAgent={isAgent} canManage={!!list?.can_manage} onClose={() => setOpen(null)} onChanged={(msg) => { reload(); if (msg) show(msg); }} />}
    </div>
  );
}

function RequestTable({ rows, isAgent, onOpen, empty }: { rows: Row[]; isAgent: boolean; onOpen: (id: number) => void; empty: string }) {
  if (!rows.length) return <p className={css.muted}>{empty}</p>;
  return (
    <div className={css.tableWrap}>
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
              <td data-label={L("Request", "Permintaan")}><button type="button" className={css.linkBtn} onClick={() => onOpen(r.id)}>{r.ref}</button><span className={css.muted}>{day(r.created_at)}</span></td>
              {!isAgent && <td data-label={L("Agent", "Ejen")}>{r.agent_name ?? "—"}</td>}
              <td data-label={L("Client · package", "Pelanggan · pakej")}><span className={css.strong}>{r.company || r.client_name}</span><span className={css.muted}>{r.package_name ?? L("Custom requirement", "Keperluan khas")}</span></td>
              {!isAgent && <td data-label={L("Sales", "Jualan")}>{r.assigned_name ?? <span className={css.muted}>{L("Not assigned", "Belum ditugaskan")}</span>}</td>}
              <td data-label={L("Status", "Status")}><Chip s={r.status} />{r.published_number && <span className={css.muted}>{r.published_number}</span>}</td>
              <td data-label={L("Latest update", "Kemas kini terkini")}><span className={css.clamp}>{r.last_text ?? "—"}</span><span className={css.muted}>{[r.last_by, when(r.last_at)].filter(Boolean).join(" · ")}</span></td>
              {!isAgent && <td data-label={L("Follow-up", "Susulan")} className={r.overdue ? css.late : undefined}>{r.next_follow_up_on ? day(r.next_follow_up_on) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface AgentRow { id: number; name: string; email: string; is_active: number; requests: number; won: number }
function AgentsList() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  useEffect(() => { const c = new AbortController(); void api<{ agents?: AgentRow[] }>("/staff/agent/agents", { signal: c.signal }).then((r) => { if (!c.signal.aborted) setAgents(r.data?.agents ?? []); }); return () => c.abort(); }, []);
  if (!agents) return <SkelRows rows={3} />;
  return (
    <section className={css.panel} aria-label={L("Agents", "Ejen")}>
      <p className={css.muted}>{L("Agent access is given by the company owner in Users › Customer Accounts (Grant Agent Access), to an account whose email is verified. Taking it away keeps every request.", "Akses ejen diberi oleh pemilik syarikat dalam Pengguna › Akaun Pelanggan (Beri Akses Ejen), kepada akaun yang e-melnya disahkan. Menariknya kekalkan setiap permintaan.")}</p>
      {agents.length === 0 ? <p className={css.muted}>{L("No agents yet.", "Belum ada ejen.")}</p> : (
        <div className={css.tableWrap}><table className={css.table}>
          <thead><tr><th>{L("Agent", "Ejen")}</th><th>{L("Email", "E-mel")}</th><th>{L("Requests", "Permintaan")}</th><th>{L("Won", "Berjaya")}</th><th>{L("Account", "Akaun")}</th></tr></thead>
          <tbody>{agents.map((a) => (
            <tr key={a.id}><td data-label={L("Agent", "Ejen")} className={css.strong}>{a.name}</td><td data-label={L("Email", "E-mel")}>{a.email}</td><td data-label={L("Requests", "Permintaan")}>{a.requests}</td><td data-label={L("Won", "Berjaya")}>{a.won}</td>
              <td data-label={L("Account", "Akaun")}><span className={`${css.chip} ${a.is_active ? css.ok : css.off}`}>{a.is_active ? L("Active", "Aktif") : L("Suspended", "Digantung")}</span></td></tr>))}</tbody>
        </table></div>)}
    </section>
  );
}

/* ------------------------------------------------------------- submit */
function SubmitSheet({ pkgs, initial, onClose, onDone }: { pkgs: Pkg[]; initial: Pkg | null; onClose: () => void; onDone: (draft: boolean) => void }) {
  /* skeleton: none - the form is drawn in full from the packages already loaded */
  const [f, setF] = useState({ client_name: "", contact_person: "", client_phone: "", client_email: "", package_id: initial?.id ?? 0, custom: false, issuer_code: "", requirement: "", timeline: "", budget_text: "", note: "" });
  const key = useRef(newKey());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const pkg = pkgs.find((p) => p.id === f.package_id) ?? null;
  const ready = f.client_name.trim().length >= 2 && !!(f.client_phone.trim() || f.client_email.trim()) && (!!f.package_id || (f.custom && f.requirement.trim().length >= 10));
  const send = async (draft: boolean) => {
    setBusy(true); setProblem("");
    const r = await api<{ error?: { message?: string } }>("/staff/agent/requests", { method: "POST", body: JSON.stringify({
      ...f, package_id: f.custom ? null : f.package_id || null, issuer_code: f.custom ? f.issuer_code || null : pkg?.issuers.length === 1 ? pkg.issuers[0] : f.issuer_code || null, draft, client_key: key.current,
    }) });
    setBusy(false);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not sent - try again", "Tidak dihantar - cuba lagi")); return; }
    onDone(draft);
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <SideDrawer open onClose={onClose} full title={L("Submit client request", "Hantar permintaan pelanggan")} subtitle={L("Sales prepares the official quotation from this.", "Jualan menyediakan sebut harga rasmi daripada ini.")}
      footer={<div className={css.footer}>
        <button type="button" className={btnSm} disabled={busy || f.client_name.trim().length < 2} onClick={() => void send(true)}>{L("Save draft", "Simpan draf")}</button>
        <button type="button" className={btnClass} disabled={busy || !ready} aria-busy={busy || undefined} onClick={() => void send(false)}>{busy ? L("Sending…", "Menghantar…") : L("Send to Sales", "Hantar kepada Jualan")}</button>
      </div>}>
      <div className={css.form}>
        <label className={css.field}><span>{L("Client or company *", "Pelanggan atau syarikat *")}</span><input className={inputClass} value={f.client_name} onChange={set("client_name")} /></label>
        <label className={css.field}><span>{L("Contact person", "Orang untuk dihubungi")}</span><input className={inputClass} value={f.contact_person} onChange={set("contact_person")} /></label>
        <div className={css.two}>
          <label className={css.field}><span>{L("Phone", "Telefon")}</span><input className={inputClass} type="tel" value={f.client_phone} onChange={set("client_phone")} /></label>
          <label className={css.field}><span>{L("Email", "E-mel")}</span><input className={inputClass} type="email" value={f.client_email} onChange={set("client_email")} /></label>
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
        <label className={css.field}><span>{L("Note for Sales (optional)", "Nota untuk Jualan (pilihan)")}</span><textarea className={inputClass} rows={2} value={f.note} onChange={set("note")} /></label>
        <p className={css.muted}>{L("Files can be added on the request once it is saved.", "Fail boleh ditambah pada permintaan selepas disimpan.")}</p>
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

function RequestDrawer({ id, isAgent, canManage, onClose, onChanged }: { id: number; isAgent: boolean; canManage: boolean; onClose: () => void; onChanged: (msg?: string) => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState("");
  const [vis, setVis] = useState<"agent" | "internal">(isAgent ? "agent" : "internal");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [team, setTeam] = useState<{ id: number; name: string; role?: string }[]>([]);
  const [fb, setFb] = useState<null | "interest" | "revision" | "accepted" | "declined">(null);
  const [fbText, setFbText] = useState("");
  const [fbFile, setFbFile] = useState<File | null>(null);
  const [shareCh, setShareCh] = useState("whatsapp");
  const [mailTo, setMailTo] = useState("");
  const [answer, setAnswer] = useState("");
  const [acc, setAcc] = useState({ accepted_name: "", channel: "whatsapp" });
  const { setTab } = usePortal();
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
  const toCreateQt = async () => {
    const pf = await api<{ prefill?: Record<string, unknown> }>(`/staff/agent/requests/${id}/prefill`);
    if (!pf.ok || !pf.data?.prefill) { setProblem(L("The Sales form could not be prepared", "Borang Jualan tidak dapat disediakan")); return; }
    try { localStorage.setItem("azone-qt-prefill", JSON.stringify({ ...pf.data.prefill, package_name: r.package_name ?? undefined })); } catch { setProblem(L(`This browser blocked the handoff - open Sales and use the reference ${r.ref}`, `Pelayar ini menyekat - buka Jualan dan guna rujukan ${r.ref}`)); return; }
    onClose(); setTab("Sales");
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
  const sendFeedback = async () => {
    if (!fb || fbText.trim().length < 2) return;
    let evidence: number | undefined;
    if (fb === "accepted") {
      if (!fbFile) { setProblem(L("Attach the client's confirmation as evidence", "Lampirkan pengesahan pelanggan sebagai bukti")); return; }
      setBusy(true); const up = await uploadFile(id, fbFile, "agent"); setBusy(false);
      if (!up.ok || !up.id) { setProblem(up.msg || L("The evidence was not uploaded", "Bukti tidak dimuat naik")); return; }
      evidence = up.id;
    }
    if (await run(`/staff/agent/requests/${id}/feedback`, { kind: fb, body: fbText.trim(), evidence_file_id: evidence }, L("Sent to Sales", "Dihantar kepada Jualan"))) { setFb(null); setFbText(""); setFbFile(null); }
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

  const footer = isAgent && d.can.edit ? (
    r.status === "more_info"
      ? <div className={css.footer}><button type="button" className={btnClass} disabled={busy || answer.trim().length < 2} onClick={() => void run(`/staff/agent/requests/${id}`, { submit: true, answer: answer.trim() }, L("Sent to Sales", "Dihantar kepada Jualan"), "PATCH")}>{L("Send the answer", "Hantar jawapan")}</button></div>
      : <div className={css.footer}><button type="button" className={btnClass} disabled={busy} onClick={() => void run(`/staff/agent/requests/${id}`, { submit: true }, L("Sent to Sales", "Dihantar kepada Jualan"), "PATCH")}>{L("Send to Sales", "Hantar kepada Jualan")}</button></div>
  ) : undefined;

  return (
    <SideDrawer open onClose={onClose} wide full title={`${r.ref} · ${r.company || r.client_name}`} subtitle={<Chip s={r.status} />} footer={footer}>
      {promptNode}
      <div className={css.drawer} data-testid="agent-request-drawer">
        {isAgent && <p className={css.lock}>{L("You share the quotation and report what the client says. Price, issuing company, signature and payment are Sales'.", "Anda berkongsi sebut harga dan melaporkan maklum balas pelanggan. Harga, syarikat pengeluar, tandatangan dan bayaran milik Jualan.")}</p>}
        {problem && <p className={css.warn} role="alert">{problem}</p>}

        <section className={css.block} aria-label={L("Details", "Butiran")}>
          <dl className={css.dl}>
            {!isAgent && <><dt>{L("Agent", "Ejen")}</dt><dd>{r.agent_name ?? "—"}</dd></>}
            <dt>{L("Client", "Pelanggan")}</dt><dd>{[...new Set([r.company, r.client_name, r.contact_person].filter(Boolean))].join(" · ")}</dd>
            <dt>{L("Contact", "Hubungan")}</dt><dd>{[r.client_phone, r.client_email].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>{L("Package", "Pakej")}</dt><dd>{r.package_name ?? L("Custom requirement", "Keperluan khas")}{r.issuer_code ? ` · ${ISSUER[r.issuer_code] ?? r.issuer_code}` : ""}</dd>
            {r.requirement && <><dt>{L("Needs", "Keperluan")}</dt><dd className={css.pre}>{r.requirement}</dd></>}
            {(r.timeline || r.budget_text) && <><dt>{L("Timeline · budget", "Tempoh · bajet")}</dt><dd>{[r.timeline, r.budget_text].filter(Boolean).join(" · ")}</dd></>}
            {r.note && <><dt>{L("Note", "Nota")}</dt><dd className={css.pre}>{r.note}</dd></>}
            <dt>{L("Sales", "Jualan")}</dt><dd>{r.assigned_name ?? L("Not assigned yet", "Belum ditugaskan")}</dd>
          </dl>
        </section>

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
          <h3 className={css.h3}>{L("Quotation", "Sebut harga")}</h3>
          {q ? (
            <div className={css.qt} data-testid="agent-quotation">
              <div className={css.qmain}>
                <span className={css.strong}>{q.doc_number}{q.revision ? ` · REV ${q.revision}` : ""}</span>
                <span className={css.muted}>{q.issuer_name}{q.customer ? ` · ${q.customer}` : ""}</span>
                <span className={css.price}>{fmtRM(q.total_cents)} <span className={css.muted}>{L(`valid to ${day(q.valid_until)}`, `sah hingga ${day(q.valid_until)}`)}</span></span>
                {q.lines.length > 0 && <span className={css.muted}>{q.lines.slice(0, 4).map((l) => `${l.qty > 1 ? `${l.qty} × ` : ""}${l.name}`).join(" · ")}</span>}
              </div>
              {q.notice ? <p className={css.warn}>{q.notice}</p> : q.link && <a className={btnSm} href={q.link} target="_blank" rel="noopener noreferrer">{L("Open quotation", "Buka sebut harga")}</a>}
              {q.acceptance && <span className={`${css.chip} ${css.ok}`}>{L("Accepted on the link", "Diterima pada pautan")} {day(q.acceptance.accepted_at)}</span>}
            </div>
          ) : isAgent ? <p className={css.muted}>{L("Sales publishes the official quotation here once it is approved.", "Jualan menerbitkan sebut harga rasmi di sini selepas diluluskan.")}</p> : null}

          {isAgent && d.can.share && q?.link && (
            <div className={css.share}>
              <div className={css.row}>
                <button type="button" className={btnSm} onClick={() => { void navigator.clipboard?.writeText(q.link!).then(() => onChanged(L("Link copied", "Pautan disalin"))).catch(() => undefined); }}>{L("Copy link", "Salin pautan")}</button>
                <select className={selectClassSm} value={shareCh} onChange={(e) => setShareCh(e.target.value)} aria-label={L("How you shared it", "Cara anda kongsi")}>
                  <option value="whatsapp">WhatsApp</option><option value="email">{L("Email (my own)", "E-mel (sendiri)")}</option><option value="phone">{L("Phone", "Telefon")}</option><option value="in_person">{L("In person", "Bersemuka")}</option><option value="other">{L("Other", "Lain")}</option>
                </select>
                <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void run(`/staff/agent/requests/${id}/shared`, { channel: shareCh }, L("Recorded as shared", "Direkod sebagai dikongsi"))}>{L("I shared it", "Saya sudah kongsi")}</button>
              </div>
              {d.mail_ready ? (
                <div className={css.row}>
                  <input className={inputClassSm} type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder={r.client_email ?? L("client@email", "pelanggan@emel")} aria-label={L("Client's email", "E-mel pelanggan")} />
                  <button type="button" className={btnSm} disabled={busy || !/\S+@\S+\.\S+/.test(mailTo || r.client_email || "")} onClick={() => void run(`/staff/agent/requests/${id}/send`, { to: mailTo || r.client_email }, L("Sent to the client", "Dihantar kepada pelanggan"))}>{L("Send by email", "Hantar melalui e-mel")}</button>
                </div>
              ) : <p className={css.muted}>{L("Email from the portal is not switched on yet - share the link and record how.", "E-mel daripada portal belum dihidupkan - kongsi pautan dan rekod caranya.")}</p>}
            </div>
          )}
          {isAgent && d.can.feedback && (
            <div className={css.share}>
              <p className={css.muted}>{L("What did the client say?", "Apa kata pelanggan?")}</p>
              <div className={css.row}>
                {(["interest", "revision", "accepted", "declined"] as const).map((k) => (
                  <button key={k} type="button" className={fb === k ? btnSmPrimary : btnSm} onClick={() => setFb(fb === k ? null : k)}>
                    {{ interest: L("Interested", "Berminat"), revision: L("Wants changes", "Mahu perubahan"), accepted: L("Says yes", "Setuju"), declined: L("Declined", "Menolak") }[k]}
                  </button>))}
              </div>
              {fb && (<>
                <textarea className={inputClass} rows={2} value={fbText} onChange={(e) => setFbText(e.target.value)} placeholder={L("In the client's words", "Dalam kata-kata pelanggan")} aria-label={L("What the client said", "Kata pelanggan")} />
                {fb === "accepted" && <label className={css.field}><span>{L("Evidence * (screenshot, email or signed order)", "Bukti * (tangkapan skrin, e-mel atau pesanan ditandatangani)")}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFbFile(e.target.files?.[0] ?? null)} /></label>}
                {fb === "accepted" && <p className={css.muted}>{L("Sales verifies the acceptance before it counts. This report accepts or invoices nothing.", "Jualan mengesahkan penerimaan sebelum dikira. Laporan ini tidak menerima atau menginvois apa-apa.")}</p>}
                <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || fbText.trim().length < 2 || (fb === "accepted" && !fbFile)} onClick={() => void sendFeedback()}>{L("Send to Sales", "Hantar kepada Jualan")}</button></div>
              </>)}
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
                    <p className={css.muted}>{L("Check the agent's evidence below, then record who agreed and how - this is the quotation's own acceptance record.", "Semak bukti ejen di bawah, kemudian rekod siapa yang bersetuju dan bagaimana - ini rekod penerimaan sebut harga itu sendiri.")}</p>
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

        {isAgent && d.can.edit && r.status === "more_info" && (
          <section className={css.block} aria-label={L("Answer Sales", "Jawab Jualan")}>
            <label className={css.field}><span>{L("Your answer to Sales *", "Jawapan anda kepada Jualan *")}</span><textarea className={inputClass} rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
          </section>
        )}

        <section className={css.block} aria-label={L("Updates", "Kemas kini")}>
          <h3 className={css.h3}>{L("Updates & comments", "Kemas kini & komen")}</h3>
          <ul className={css.timeline}>
            {[...d.history].reverse().map((e) => {
              const files = e.kind === "file" ? d.files.filter((f) => `File: ${f.file_name}` === e.body && f.visibility === e.visibility) : [];
              return (
                <li key={e.id} className={e.visibility === "internal" ? css.internal : undefined} data-visibility={e.visibility}>
                  <span className={css.tlHead}><span className={css.strong}>{e.actor ?? L("System", "Sistem")}</span>{!isAgent && <span className={`${css.vis} ${e.visibility === "internal" ? css.bad : css.ok}`}>{e.visibility === "internal" ? L("Internal", "Dalaman") : L("Agent can see", "Ejen boleh lihat")}</span>}<span className={css.muted}>{when(e.created_at)}</span></span>
                  {files.length ? files.slice(0, 1).map((f) => <a key={f.id} className={css.linkBtn} href={`/api/v1/staff/agent/requests/${id}/files/${f.id}`} target="_blank" rel="noopener noreferrer">{f.file_name}</a>) : <span className={css.pre}>{e.body}</span>}
                  {(e.next_action || e.follow_up_on) && <span className={css.muted}>{[e.next_action && `${L("Next", "Seterusnya")}: ${e.next_action}`, e.follow_up_on && `${L("Follow up", "Susulan")} ${day(e.follow_up_on)}`].filter(Boolean).join(" · ")}</span>}
                </li>);
            })}
          </ul>
          {r.status !== "draft" && (
            <div className={css.composer}>
              <textarea className={inputClass} rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={isAgent ? L("An update for Sales - what the client said, the next step", "Kemas kini untuk Jualan - kata pelanggan, langkah seterusnya") : L("A comment - choose who sees it", "Komen - pilih siapa yang melihat")} aria-label={L("Comment", "Komen")} />
              <div className={css.row}>
                {!isAgent && (
                  <div className={css.seg} role="radiogroup" aria-label={L("Who sees it", "Siapa melihat")}>
                    <button type="button" role="radio" aria-checked={vis === "internal"} className={vis === "internal" ? css.segOn : undefined} onClick={() => setVis("internal")}>{L("Internal only", "Dalaman sahaja")}</button>
                    <button type="button" role="radio" aria-checked={vis === "agent"} className={vis === "agent" ? css.segOn : undefined} onClick={() => setVis("agent")}>{L("Agent can see", "Ejen boleh lihat")}</button>
                  </div>
                )}
                <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ""; }} />
                <button type="button" className={btnSm} disabled={busy} onClick={() => fileRef.current?.click()}>{L("Attach file", "Lampir fail")}</button>
                <button type="button" className={btnSmPrimary} disabled={busy || msg.trim().length < 2} onClick={() => void post()}>{L("Post", "Hantar")}</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </SideDrawer>
  );
}
