"use client";

/* v1.351.0 - PARTNER APPLICATIONS inside the existing Agents tab.
   v1.354.0 - STAFF-ONLY MANAGEMENT (the CEO, 17-11-2026, with his picture of
   Agents > Requests): the list of applications from /apply/partner beside the
   selected application, inside the EXISTING Requests tab behind a Client
   Requests | Partner Applications switch. Overview, the Agent Pipeline, the KPI
   strip and Conversion Performance are not touched.

     New -> Assigned -> Screening -> Shortlisted -> Pre-Approved -> Approved -> Activated, or Rejected
     Sales / agent staff   Pick Up, Contact, Screen, Add Notes, Shortlist
     COO or CCO            Pre-Approve, Return or Reject a shortlisted one
     CEO                   final Approve, Return or Reject; then Activate

   Who may do what is the SERVER's (worker/src/partners.ts): every button here
   is drawn only when the application's own `can` says so, and every route
   checks again. An external agent never reaches this screen or its data - the
   Agents panel does not mount it for an agent, and the server refuses an agent
   by role. Activation links an Agent account already given in Users & Security
   -> Customers & Agents and a responsible salesperson set in Agents -> Agents;
   this screen never creates an account or grants access. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { usePortal } from "@/components/portal/portal-provider";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, TaskToolbar, type TableCol } from "@/components/portal/task-table";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { LineTabs } from "@/components/ui/line-tabs";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { btnSm, btnSmAccent, btnSmPrimary, btnSmQuiet, chipSmNeutral, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./agents-panel.module.css";
import pa from "./partner-applications.module.css";

export type PStage = "new" | "assigned" | "screening" | "shortlisted" | "pre_approved" | "approved" | "rejected" | "activated" | "on_hold";
export interface PRow {
  id: number; ref: string; full_name: string; gender: string; age_range: string; phone: string; email: string; location: string; contact_method: string; source: string; source_detail: string | null;
  utm_campaign: string | null; referred_before: number; intro_per_week: string; customer_groups: string[]; lead_channels: string[]; time_available: string; status: PStage;
  owner_id: number | null; owner_name: string | null; picked_at: string | null; first_response_at: string | null; next_follow_up_on: string | null; version: number; created_at: string; overdue: boolean;
}
export interface PList { applications: PRow[]; counts: Record<string, number>; me: number; can_manage: boolean; can_preapprove: boolean; can_approve: boolean; settings: { unclaimed_hours: number; remind_hours: number; escalate_hours: number }; pending_migration?: boolean }
interface PCan { pickup: boolean; release: boolean; contact: boolean; note: boolean; shortlist: boolean; shortlist_needs_contact: boolean; preapprove: boolean; approve: boolean; activate: boolean }
interface PDetail {
  application: PRow & { best_time: string | null; utm_source: string | null; utm_medium: string | null; utm_term: string | null; utm_content: string | null; groups_other: string | null; channels_other: string | null;
    approach: string; screening_window: string; marketing_opt_in: number; lang: string | null; recommended_by_name: string | null; preapproved_by_name: string | null; preapproved_at: string | null;
    approved_by_name: string | null; approved_at: string | null; agreement_signed_on: string | null; agreement_note: string | null; agent_user_id: number | null; activated_by_name: string | null; activated_at: string | null };
  events: { id: number; kind: string; body: string | null; channel: string | null; status_from: string | null; status_to: string | null; created_at: string; actor: string | null }[];
  agent_accounts: { id: number; name: string; email: string; is_active: number; salesperson_name: string | null }[];
  can: PCan;
}

type Bi = [string, string];
/* the status words and their definitions, as the CEO's picture states them */
const ST: Record<PStage, { w: Bi; d: Bi }> = {
  new: { w: ["New", "Baharu"], d: ["New application, not yet picked up.", "Permohonan baharu (belum diambil)."] },
  assigned: { w: ["Assigned", "Ditugaskan"], d: ["Picked up by staff for review.", "Telah diambil oleh staf untuk disemak."] },
  screening: { w: ["Screening", "Saringan"], d: ["Being reviewed; the applicant is contacted.", "Dalam proses semakan & hubungi calon."] },
  shortlisted: { w: ["Shortlisted", "Disenarai Pendek"], d: ["Suitable - recommended for pre-approval.", "Calon sesuai, dicadang untuk pra-kelulusan."] },
  pre_approved: { w: ["Pre-Approved", "Pra-Lulus"], d: ["Confirmed by the COO or CCO, waiting for the CEO.", "Disahkan oleh COO atau CCO, menunggu tindakan CEO."] },
  approved: { w: ["Approved", "Diluluskan"], d: ["Approved by the CEO; the Agent role is being set.", "Diluluskan oleh CEO dan peranan Ejen ditetapkan."] },
  activated: { w: ["Activated", "Diaktifkan"], d: ["Agent Portal access is active and ready to use.", "Akses Portal Ejen aktif dan sedia digunakan."] },
  rejected: { w: ["Rejected", "Ditolak"], d: ["Not accepted - the record and the reason are kept.", "Tidak diterima (rekod dan sebab disimpan)."] },
  on_hold: { w: ["On Hold", "Ditangguh"], d: ["Paused before this process changed.", "Ditangguh sebelum proses ini berubah."] },
};
const FLOW: PStage[] = ["new", "assigned", "screening", "shortlisted", "pre_approved", "approved", "activated", "rejected"];
/* the filter row, in the picture's order */
const TABS: ("all" | PStage)[] = ["all", "new", "assigned", "screening", "shortlisted", "pre_approved", "approved", "rejected"];
const TONE: Record<PStage, string | undefined> = { new: css.wait, assigned: css.info, screening: css.violet, shortlisted: css.ok, pre_approved: css.gold, approved: css.ok, rejected: css.bad, on_hold: css.off, activated: css.ok };
export const pWord = (s: PStage) => L(ST[s]?.w[0] ?? s, ST[s]?.w[1] ?? s);
const PChip = ({ s }: { s: PStage }) => <span className={`${css.chip} ${TONE[s] ?? ""}`}>{pWord(s)}</span>;
const SRC: Record<string, [Bi, AppIconName | null]> = {
  facebook: [["Facebook", "Facebook"], "facebook"], instagram: [["Instagram", "Instagram"], "instagram"], x: [["X", "X"], null], threads: [["Threads", "Threads"], "threads"],
  tiktok: [["TikTok", "TikTok"], "tiktok"], linkedin: [["LinkedIn", "LinkedIn"], "linkedin"], whatsapp: [["WhatsApp", "WhatsApp"], "chat"], google: [["Google", "Google"], "google"],
  website: [["Website", "Laman web"], "website"], referral: [["Referral", "Rujukan"], "person"], event: [["Event", "Acara"], "date"], other: [["Other", "Lain-lain"], "more"],
};
export const srcWord = (k: string) => (SRC[k] ? L(SRC[k][0][0], SRC[k][0][1]) : k);
const Src = ({ k }: { k: string }) => (
  <span className={pa.src}><span className={pa.srcMark} aria-hidden>{SRC[k]?.[1] ? <AppIcon name={SRC[k]![1]!} /> : <b>X</b>}</span>{srcWord(k)}</span>
);
const LOC: Record<string, string> = {
  johor: "Johor", kedah: "Kedah", kelantan: "Kelantan", melaka: "Melaka", negeri_sembilan: "Negeri Sembilan", pahang: "Pahang", perak: "Perak", perlis: "Perlis", pulau_pinang: "Pulau Pinang",
  sabah: "Sabah", sarawak: "Sarawak", selangor: "Selangor", terengganu: "Terengganu", kuala_lumpur: "W.P. Kuala Lumpur", labuan: "W.P. Labuan", putrajaya: "W.P. Putrajaya", outside_malaysia: "Outside Malaysia",
};
const GRP: Record<string, Bi> = { sme: ["SME / Business owners", "PKS / Pemilik perniagaan"], individuals: ["Individuals / Consumers", "Individu / Pengguna"], corporate: ["Corporate clients", "Pelanggan korporat"], community: ["Local community", "Komuniti setempat"], other: ["Other", "Lain-lain"] };
const CHN: Record<string, Bi> = { personal: ["Personal network", "Rangkaian peribadi"], business: ["Business network", "Rangkaian perniagaan"], social: ["Social media", "Media sosial"], events: ["Events / Community", "Acara / Komuniti"], other: ["Other", "Lain-lain"] };
const AV: Record<string, Bi> = { occasional: ["Occasional", "Sekali-sekala"], "2-5": ["2-5 hours / week", "2-5 jam / minggu"], "5+": ["5+ hours / week", "5+ jam / minggu"] };
const WIN: Record<string, Bi> = { "48h": ["Within 48 hours", "Dalam 48 jam"], "7d": ["Within 7 days", "Dalam 7 hari"], "14d": ["Within 14 days", "Dalam 14 hari"], flexible: ["Flexible", "Fleksibel"] };
const TIME: Record<string, Bi> = { morning: ["Morning", "Pagi"], afternoon: ["Afternoon", "Petang"], evening: ["Evening", "Malam"], any: ["Any time", "Bila-bila masa"] };
const word = (m: Record<string, Bi>, k: string | null | undefined) => (k && m[k] ? L(m[k][0], m[k][1]) : k ?? "—");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
/* the server keeps UTC; a person reads Malaysia time */
const mytOf = (v: string | null | undefined) => {
  if (!v) return null;
  const t = Date.parse(`${v.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? null : new Date(t + 8 * 3600_000).toISOString();
};
const day = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("-") : "");
const myt = (v: string | null | undefined) => { const d = mytOf(v); return d ? `${day(d)} ${d.slice(11, 16)}` : v ?? ""; };
const mytToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
/** "Today, 10:24 AM" / "Yesterday" / "10 Nov" - the picture's Submitted column */
function submitted(v: string): string {
  const d = mytOf(v);
  if (!d) return v;
  const today = mytToday();
  const yday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const h = Number(d.slice(11, 13)), m = d.slice(14, 16);
  const clock = `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
  if (d.slice(0, 10) === today) return L(`Today, ${clock}`, `Hari ini, ${clock}`);
  if (d.slice(0, 10) === yday) return L("Yesterday", "Semalam");
  const mi = Number(d.slice(5, 7)) - 1;
  return `${Number(d.slice(8, 10))} ${L(MON[mi]!, MON_MS[mi]!)}`;
}
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

/* =====================================================================
   One application's record and the actions it allows - shared by the
   preview beside the list and the full drawer, so the two never disagree
   ===================================================================== */
function usePartnerApp(id: number | null, onChanged: (msg?: string) => void, rev = 0) {
  const [d, setD] = useState<PDetail | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const { prompt, node: promptNode } = usePrompt();
  const [seen, setSeen] = useState(id);
  if (seen !== id) { setSeen(id); setD(null); setProblem(""); }
  useEffect(() => {
    if (id == null) return;
    const c = new AbortController();
    void api<PDetail & { error?: { message?: string } }>(`/staff/partner-applications/${id}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data?.application) { setD(r.data); setProblem(""); } else setProblem(r.data?.error?.message ?? L("The application could not be opened.", "Permohonan tidak dapat dibuka."));
    });
    return () => c.abort();
  }, [id, tick, rev]);
  const run = useCallback(async (action: string, body: Record<string, unknown>, done: string) => {
    if (!d || id == null) return false;
    setBusy(true); setProblem("");
    const r = await api<{ error?: { message?: string } }>(`/staff/partner-applications/${id}/${action}`, { method: "POST", body: JSON.stringify({ version: d.application.version, ...body }) });
    setBusy(false);
    setTick((t) => t + 1);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.")); if (r.status === 409) onChanged(); return false; }
    onChanged(done);
    return true;
  }, [d, id, onChanged]);
  /** a decision with its reason, kept with the application */
  const decide = useCallback(async (action: "shortlist" | "preapprove" | "approve", decision: string, title: string, label: string, done: string, danger = false) => {
    const a = await prompt({ title, label, required: true, variant: danger ? "danger" : "default" });
    if (!a) return;
    if (a.value.trim().length < 5) { setProblem(L("Give a reason of at least 5 characters.", "Beri sebab sekurang-kurangnya 5 aksara.")); return; }
    await run(action, action === "shortlist" ? { reason: a.value.trim() } : { decision, reason: a.value.trim() }, done);
  }, [prompt, run]);
  return { d, problem, busy, run, decide, promptNode, reload: () => setTick((t) => t + 1) };
}

/** The decisions this person may take now, as buttons - drawn from the server's `can` only */
function DecisionButtons({ can, busy, decide, testid }: { can: PCan; busy: boolean; decide: ReturnType<typeof usePartnerApp>["decide"]; testid: string }) {
  const why = L("Why? (kept with the application and in the audit history)", "Mengapa? (disimpan bersama permohonan dan dalam sejarah audit)");
  return (<>
    {can.shortlist && <button type="button" className={btnSm} disabled={busy} data-testid={`${testid}-shortlist`}
      onClick={() => void decide("shortlist", "", L("Shortlist for management review", "Senarai pendek untuk semakan pengurusan"), L("Why do you recommend this applicant?", "Mengapa anda mengesyorkan pemohon ini?"), L("Shortlisted - sent to the COO / CCO", "Disenarai pendek - dihantar kepada COO / CCO"))}><AppIcon name="star" />{L("Shortlist", "Senarai Pendek")}</button>}
    {can.preapprove && <>
      <button type="button" className={btnSmPrimary} disabled={busy} data-testid={`${testid}-preapprove`} onClick={() => void decide("preapprove", "preapprove", L("Pre-approve this applicant", "Pra-lulus pemohon ini"), why, L("Pre-approved - sent to the CEO", "Pra-lulus - dihantar kepada CEO"))}><AppIcon name="verify" />{L("Pre-Approve", "Pra-Lulus")}</button>
      <button type="button" className={btnSm} disabled={busy} data-testid={`${testid}-return`} onClick={() => void decide("preapprove", "return", L("Return for more screening", "Pulangkan untuk saringan lanjut"), why, L("Returned to the owner", "Dipulangkan kepada pemilik"))}><AppIcon name="returned" />{L("Return", "Pulangkan")}</button>
      <button type="button" className={btnSmQuiet} disabled={busy} data-testid={`${testid}-reject`} onClick={() => void decide("preapprove", "reject", L("Reject the application", "Tolak permohonan"), why, L("Rejected", "Ditolak"), true)}><AppIcon name="error" />{L("Reject", "Tolak")}</button>
    </>}
    {can.approve && <>
      <button type="button" className={btnSmPrimary} disabled={busy} data-testid={`${testid}-approve`} onClick={() => void decide("approve", "approve", L("Final approval", "Kelulusan akhir"), why, L("Approved - activation is a separate step", "Diluluskan - pengaktifan langkah berasingan"))}><AppIcon name="verify" />{L("Approve", "Luluskan")}</button>
      <button type="button" className={btnSm} disabled={busy} data-testid={`${testid}-return`} onClick={() => void decide("approve", "return", L("Return for more screening", "Pulangkan untuk saringan lanjut"), why, L("Returned to the owner", "Dipulangkan kepada pemilik"))}><AppIcon name="returned" />{L("Return", "Pulangkan")}</button>
      <button type="button" className={btnSmQuiet} disabled={busy} data-testid={`${testid}-reject`} onClick={() => void decide("approve", "reject", L("Reject the application", "Tolak permohonan"), why, L("Rejected", "Ditolak"), true)}><AppIcon name="error" />{L("Reject", "Tolak")}</button>
    </>}
  </>);
}

/* =====================================================================
   Requests -> Partner Applications: the list beside the selected one
   ===================================================================== */
export function PartnerInbox({ list, failed, onChanged, onAgents, onSettings, open, onOpen }: {
  list: PList | null; failed: string; onChanged: (msg?: string) => void; onAgents: () => void; onSettings: () => void;
  /** the application a bell, the Desk or a search asked for */
  open: number | null; onOpen: (id: number | null) => void;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [srcF, setSrcF] = useState("");
  const [ownF, setOwnF] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<{ id: number; form: "" | "contact" | "note" | "activate" } | null>(null);
  /* a change made in the drawer re-reads the preview beside the list, so the two always agree */
  const [rev, setRev] = useState(0);
  const changed = useCallback((msg?: string) => { setRev((r) => r + 1); onChanged(msg); }, [onChanged]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const key = `${q}|${tab}|${srcF}|${ownF}`;
  const [seen, setSeen] = useState(key);
  if (key !== seen) { setSeen(key); setPage(1); }
  /* a bell / Desk / search opening: select it, and open its full record on a phone */
  const [asked, setAsked] = useState<number | null>(null);
  if (open !== asked) {
    setAsked(open);
    if (open != null) { setSel(open); setTab("all"); if (narrow()) setDrawer({ id: open, form: "" }); }
  }
  const rows = useMemo(() => list?.applications ?? [], [list]);
  const count = (s: (typeof TABS)[number]) => (s === "all" ? rows.length : rows.filter((r) => r.status === s).length);
  const owners = useMemo(() => [...new Map(rows.filter((r) => r.owner_id).map((r) => [r.owner_id!, r.owner_name ?? `#${r.owner_id}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const shown = useMemo(() => rows.filter((r) => (
    (tab === "all" || r.status === tab)
    && (!srcF || r.source === srcF)
    && (!ownF || (ownF === "none" ? !r.owner_id : ownF === "me" ? r.owner_id === list?.me : String(r.owner_id) === ownF))
    && (!q || `${r.ref} ${r.full_name} ${r.email} ${r.phone} ${r.source} ${r.utm_campaign ?? ""} ${r.owner_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
  )), [rows, tab, srcF, ownF, q, list]);
  const pick = (id: number) => { setSel(id); onOpen(id); if (narrow()) setDrawer({ id, form: "" }); };
  const cols: TableCol<PRow>[] = [
    { key: "ref", label: L("Ref. ID", "ID Ruj."), cell: (r) => <span className={pa.ref} data-testid={`partner-ref-${r.id}`}>{r.ref}</span> },
    { key: "name", label: L("Name", "Nama"), main: true, cell: (r) => <><TaskRowTitle title={r.full_name} onOpen={() => pick(r.id)} />{r.overdue && <TaskRowSub><span className={css.dueLate}>{L("Overdue", "Lewat")}</span></TaskRowSub>}</> },
    { key: "src", label: L("Source", "Sumber"), cell: (r) => <Src k={r.source} /> },
    { key: "status", label: L("Status", "Status"), cell: (r) => <PChip s={r.status} /> },
    { key: "owner", label: L("Assigned To", "Ditugaskan Kepada"), cell: (r) => r.owner_name ?? <span className={css.mutedInline}>–</span> },
    { key: "when", label: L("Submitted", "Dihantar"), cell: (r) => <span className={pa.when}>{submitted(r.created_at)}</span> },
  ];
  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  const empty = rows.length === 0 ? (
    <div className={css.emptyBox} data-testid="partner-empty">
      <span className={css.emptyIcon} aria-hidden><AppIcon name="users" /></span>
      <strong>{L("No partner applications yet.", "Belum ada permohonan rakan kongsi.")}</strong>
      <p>{L("Applications from a2zcreative.my/apply/partner land here for A2Z staff to pick up.", "Permohonan dari a2zcreative.my/apply/partner sampai di sini untuk diambil oleh staf A2Z.")}</p>
    </div>
  ) : <p className={css.calm}><AppIcon name="search" />{L("No application matches this filter.", "Tiada permohonan sepadan dengan penapis ini.")}</p>;
  const tabLabel = (s: (typeof TABS)[number]) => (s === "all" ? L("All Requests", "Semua Permohonan") : pWord(s));
  return (<>
    {/* the picture's order: the status row across the whole workspace, the search at its right */}
    <div className={pa.bar}>
      <LineTabs testid="partner-tab" label={L("Application status", "Status permohonan")} value={tab} onChange={setTab}
        tabs={TABS.map((s) => [s, `${tabLabel(s)} (${list ? count(s) : "…"})`, null, tabLabel(s)] as const)} />
    </div>
    <WorkspaceSplit testid="partner-split" ratio="60-40">
      <SplitPane testid="partner-inbox" title={L("Partner Applications", "Permohonan Rakan Kongsi")} label={L("Partner applications", "Permohonan rakan kongsi")}
        actions={<span className={chipSmNeutral} data-testid="partner-count">{list ? (shown.length !== rows.length ? L(`${shown.length} of ${rows.length}`, `${shown.length} daripada ${rows.length}`) : L(`${rows.length} application${rows.length === 1 ? "" : "s"}`, `${rows.length} permohonan`)) : "…"}</span>}
        toolbar={<TaskToolbar q={q} onQ={setQ} placeholder={L("Search name, phone or ID…", "Cari nama, telefon atau ID…")} testid="partner-toolbar">
          <button type="button" className={btnSm} aria-pressed={showFilters} aria-label={L("Filters", "Penapis")} onClick={() => setShowFilters((v) => !v)} data-testid="partner-filter-btn"><AppIcon name="filter" /></button>
          {showFilters && <>
            <select className={selectClassSm} value={srcF} onChange={(e) => setSrcF(e.target.value)} aria-label={L("Source", "Sumber")} data-testid="partner-filter-source">
              <option value="">{L("Every source", "Semua sumber")}</option>
              {Object.keys(SRC).map((k) => <option key={k} value={k}>{srcWord(k)}</option>)}
            </select>
            <select className={selectClassSm} value={ownF} onChange={(e) => setOwnF(e.target.value)} aria-label={L("Assigned to", "Ditugaskan kepada")} data-testid="partner-filter-owner">
              <option value="">{L("Anyone", "Sesiapa")}</option>
              <option value="me">{L("Assigned to me", "Ditugaskan kepada saya")}</option>
              <option value="none">{L("Not picked up", "Belum diambil")}</option>
              {owners.map(([id, n]) => <option key={id} value={String(id)}>{n}</option>)}
            </select>
          </>}
        </TaskToolbar>}>
        <CompactTaskTable rows={shown} cols={cols} label={L("Partner applications", "Permohonan rakan kongsi")} loading={!list} record="partner" testid="partner-table" dense fill
          onOpen={pick} picked={sel} rowClass={(r) => (r.overdue ? css.lateRow ?? "" : "")} empty={empty} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} />
      </SplitPane>
      {sel != null ? (
        <PartnerPreview id={sel} rev={rev} onClose={() => { setSel(null); onOpen(null); }} onChanged={changed} onFull={(form) => setDrawer({ id: sel, form })} />
      ) : (
        <SplitPane testid="partner-workflow" title={L("Application Status Flow & Definition", "Aliran & Definisi Status Permohonan")} label={L("Application status flow", "Aliran status permohonan")}
          sub={L("Choose an application to see it here. Sales screens and shortlists; the COO or CCO pre-approves; the CEO gives the final approval and activates.", "Pilih permohonan untuk melihatnya di sini. Jualan menyaring dan menyenarai pendek; COO atau CCO memberi pra-kelulusan; CEO memberi kelulusan akhir dan mengaktifkan.")}>
          <ol className={pa.defs} data-testid="partner-defs">
            {FLOW.map((s) => (
              <li key={s}><span className={pa.defDot} aria-hidden /><PChip s={s} /><span className={pa.defText}>{L(ST[s].d[0], ST[s].d[1])}</span><span className={pa.defCount}>{list ? count(s as (typeof TABS)[number]) || "" : ""}</span></li>
            ))}
          </ol>
          <div className={css.goldNote} data-testid="partner-note">
            <AppIcon name="lock" />
            <span><strong>{L("A2Z staff only:", "Staf A2Z sahaja:")}</strong> {L("external agents never see these applications. An application creates no account; Agent access is given in Users & Security › Customers & Agents only after the CEO's approval and the signed agreement.", "ejen luar tidak pernah melihat permohonan ini. Permohonan tidak membuat akaun; akses Ejen diberi dalam Pengguna & Keselamatan › Pelanggan & Ejen hanya selepas kelulusan CEO dan perjanjian ditandatangani.")}</span>
            {list?.can_manage && <button type="button" className={btnSmQuiet} onClick={onSettings} data-testid="partner-settings-open">{L("Reminder settings", "Tetapan peringatan")}</button>}
          </div>
        </SplitPane>
      )}
    </WorkspaceSplit>
    {drawer && <PartnerDrawer id={drawer.id} start={drawer.form} onClose={() => setDrawer(null)} onChanged={changed} onAgents={() => { setDrawer(null); onAgents(); }} />}
  </>);
}

/* the selected application beside the list - the picture's right-hand card */
function PartnerPreview({ id, rev, onClose, onChanged, onFull }: { id: number; rev: number; onClose: () => void; onChanged: (msg?: string) => void; onFull: (form: "" | "contact" | "note" | "activate") => void }) {
  const { d, problem, busy, run, decide, promptNode } = usePartnerApp(id, onChanged, rev);
  const a = d?.application;
  const can = d?.can;
  return (
    <SplitPane testid="partner-preview" title={a ? a.ref : L("Partner application", "Permohonan rakan kongsi")} label={L("Selected application", "Permohonan dipilih")}
      actions={<span className={pa.headActs}>{a && <PChip s={a.status} />}<button type="button" className={btnSmQuiet} aria-label={L("Close", "Tutup")} onClick={onClose} data-testid="partner-preview-close"><AppIcon name="close" /></button></span>}>
      {promptNode}
      {problem && <p className={css.warn} role="alert">{problem}</p>}
      {!a || !can ? <SkelRows rows={5} /> : (
        <div className={pa.preview}>
          <div className={pa.person}>
            <span className={pa.avatar} aria-hidden><AppIcon name="person" /></span>
            <div className={pa.personText}>
              <strong>{a.full_name}</strong>
              <span className={pa.metaLine}>{a.gender === "male" ? L("Male", "Lelaki") : L("Female", "Perempuan")} <span aria-hidden>|</span> {L(`${a.age_range} years`, `${a.age_range} tahun`)}</span>
            </div>
            <button type="button" className={btnSm} onClick={() => onFull("")} data-testid="partner-view-full">{L("View Full Application", "Lihat Permohonan Penuh")}</button>
          </div>
          <ul className={pa.contact}>
            <li><AppIcon name="chat" /><a className={css.linkBtn} href={`https://wa.me/${a.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{a.phone}</a></li>
            <li><AppIcon name="document" /><a className={css.linkBtn} href={`mailto:${a.email}`}>{a.email}</a></li>
            <li><AppIcon name="place" /><span>{LOC[a.location] ?? a.location}</span></li>
            <li><AppIcon name="person" /><span>{a.owner_name ? L(`Owner: ${a.owner_name}`, `Pemilik: ${a.owner_name}`) : L("Not picked up yet", "Belum diambil")}</span></li>
          </ul>
          <section aria-label={L("Quick actions", "Tindakan pantas")} className={pa.quick} data-testid="partner-quick">
            <h3 className={css.h3}>{L("Quick Actions", "Tindakan Pantas")}</h3>
            <div className={css.row}>
              {can.pickup && <button type="button" className={btnSmAccent} disabled={busy} onClick={() => void run("pickup", {}, L("Picked up - it is yours", "Diambil - ia milik anda"))} data-testid="partner-pickup"><AppIcon name="person" />{L("Pick Up", "Ambil")}</button>}
              {can.note && <button type="button" className={btnSm} disabled={busy} onClick={() => onFull("note")} data-testid="partner-add-note"><AppIcon name="chat" />{L("Add Note", "Tambah Nota")}</button>}
              {can.contact && <button type="button" className={btnSm} disabled={busy} onClick={() => onFull("contact")} data-testid="partner-contact"><AppIcon name="chat" />{L("Contact", "Hubungi")}</button>}
              <DecisionButtons can={can} busy={busy} decide={decide} testid="partner-quick" />
              {can.activate && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => onFull("activate")} data-testid="partner-quick-activate"><AppIcon name="success" />{L("Activate", "Aktifkan")}</button>}
              <button type="button" className={btnSmQuiet} aria-label={L("More - the full application", "Lagi - permohonan penuh")} onClick={() => onFull("")} data-testid="partner-more"><AppIcon name="more" /></button>
            </div>
            {can.shortlist_needs_contact && <p className={css.muted}>{L("Record a contact with the applicant before shortlisting.", "Rekod hubungan dengan pemohon sebelum menyenarai pendek.")}</p>}
            {a.status === "shortlisted" && !can.preapprove && <p className={css.muted}>{L("Waiting for the COO or CCO to pre-approve.", "Menunggu pra-kelulusan COO atau CCO.")}</p>}
            {a.status === "pre_approved" && !can.approve && <p className={css.muted}>{L(`Pre-approved by ${a.preapproved_by_name ?? "management"} - waiting for the CEO's final decision.`, `Pra-lulus oleh ${a.preapproved_by_name ?? "pengurusan"} - menunggu keputusan akhir CEO.`)}</p>}
            {a.status === "approved" && !can.activate && <p className={css.muted}>{L("Approved by the CEO - waiting for activation.", "Diluluskan oleh CEO - menunggu pengaktifan.")}</p>}
          </section>
          <dl className={css.dl}>
            <dt>{L("Source", "Sumber")}</dt><dd><Src k={a.source} />{a.source_detail ? ` · ${a.source_detail}` : ""}</dd>
            <dt>{L("Campaign", "Kempen")}</dt><dd>{a.utm_campaign ?? "—"}</dd>
            <dt>{L("Introductions / week", "Perkenalan / minggu")}</dt><dd>{a.intro_per_week}{a.referred_before ? L(" · has referred before", " · pernah merujuk") : ""}</dd>
            <dt>{L("Submitted", "Dihantar")}</dt><dd>{myt(a.created_at)}</dd>
          </dl>
        </div>
      )}
    </SplitPane>
  );
}

/* =====================================================================
   The full application: everything it says, its history, every action
   ===================================================================== */
export function PartnerDrawer({ id, start = "", onClose, onChanged, onAgents }: { id: number; start?: "" | "contact" | "note" | "activate"; onClose: () => void; onChanged: (msg?: string) => void; onAgents: () => void }) {
  const { d, problem, busy, run, decide, promptNode } = usePartnerApp(id, onChanged);
  const [form, setForm] = useState<"" | "contact" | "note" | "activate">(start);
  const [contact, setContact] = useState({ channel: "whatsapp", note: "", next_follow_up_on: "" });
  const [note, setNote] = useState({ note: "", next_follow_up_on: "" });
  const [actv, setActv] = useState({ agent_user_id: 0, agreement_signed_on: mytToday(), agreement_note: "" });
  const { prompt, node: releaseNode } = usePrompt();
  const { setTab, setTabStart } = usePortal();
  const done = async (p: Promise<boolean>) => { if (await p) setForm(""); };
  const release = async () => {
    const a = await prompt({ title: L("Hand the application back", "Serahkan semula permohonan"), label: L("Why? Somebody else can then pick it up.", "Mengapa? Orang lain boleh mengambilnya."), required: true });
    if (!a || a.value.trim().length < 5) return;
    await run("release", { reason: a.value.trim() }, L("Handed back", "Diserahkan semula"));
  };
  const toAccess = () => { setTabStart({ tab: "Users", view: "customers" }); setTab("Users"); };
  const a = d?.application;
  const can = d?.can;
  const acct = d?.agent_accounts.find((x) => x.id === actv.agent_user_id);
  const footer = a && can ? (
    <div className={css.footer} data-testid="partner-actions">
      {can.pickup && <button type="button" className={btnSmAccent} disabled={busy} onClick={() => void run("pickup", {}, L("Picked up - it is yours", "Diambil - ia milik anda"))} data-testid="partner-drawer-pickup"><AppIcon name="person" />{L("Pick Up", "Ambil")}</button>}
      {can.contact && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm(form === "contact" ? "" : "contact")} data-testid="partner-drawer-contact"><AppIcon name="chat" />{L("Contact", "Hubungi")}</button>}
      {can.note && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm(form === "note" ? "" : "note")} data-testid="partner-drawer-note"><AppIcon name="edit" />{L("Add Note", "Tambah Nota")}</button>}
      <DecisionButtons can={can} busy={busy} decide={decide} testid="partner-drawer" />
      {can.activate && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => setForm(form === "activate" ? "" : "activate")} data-testid="partner-activate"><AppIcon name="success" />{L("Activate", "Aktifkan")}</button>}
      {can.release && <button type="button" className={btnSmQuiet} disabled={busy} onClick={() => void release()} data-testid="partner-release">{L("Hand back", "Serah semula")}</button>}
    </div>
  ) : undefined;

  return (
    <SideDrawer open onClose={onClose} wide full title={a ? `${a.ref} · ${a.full_name}` : L("Partner application", "Permohonan rakan kongsi")} subtitle={a ? <PChip s={a.status} /> : undefined} footer={footer}>
      {promptNode}{releaseNode}
      <div className={css.drawer} data-testid="partner-drawer">
        {problem && <p className={css.warn} role="alert">{problem}</p>}
        {!a || !can ? <SkelRows rows={6} /> : (<>
          <p className={css.lock}>{L("A2Z staff only. Submitting this form created no account and grants no access; nothing here is an employment decision.", "Staf A2Z sahaja. Borang ini tidak membuat akaun dan tidak memberi akses; tiada apa di sini keputusan pekerjaan.")}</p>
          {form === "contact" && can.contact && (
            <section className={css.block} aria-label={L("Record a contact", "Rekod hubungan")} data-testid="partner-contact-form">
              <h3 className={css.h3}>{L("Record the contact", "Rekod hubungan")}</h3>
              <div className={css.row}>
                <select className={selectClassSm} value={contact.channel} onChange={(e) => setContact({ ...contact, channel: e.target.value })} aria-label={L("How", "Bagaimana")}>
                  <option value="whatsapp">WhatsApp</option><option value="call">{L("Call", "Panggilan")}</option><option value="email">{L("Email", "E-mel")}</option><option value="other">{L("Other", "Lain-lain")}</option>
                </select>
                <label className={css.inline}>{L("Next follow-up", "Susulan seterusnya")}<input type="date" className={inputClassSm} min={mytToday()} value={contact.next_follow_up_on} onChange={(e) => setContact({ ...contact, next_follow_up_on: e.target.value })} /></label>
              </div>
              <textarea className={inputClass} rows={2} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} placeholder={L("What happened - e.g. WhatsApp sent, screening call booked", "Apa yang berlaku - cth. WhatsApp dihantar, panggilan saringan ditempah")} aria-label={L("What happened", "Apa yang berlaku")} data-testid="partner-contact-note" />
              <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || contact.note.trim().length < 3} onClick={() => void done(run("contact", { ...contact, next_follow_up_on: contact.next_follow_up_on || null }, L("Contact recorded", "Hubungan direkod")))} data-testid="partner-contact-save">{L("Save contact", "Simpan hubungan")}</button></div>
            </section>
          )}
          {form === "note" && can.note && (
            <section className={css.block} aria-label={L("Screening note", "Nota saringan")} data-testid="partner-note-form">
              <h3 className={css.h3}>{L("Screening note", "Nota saringan")}</h3>
              <textarea className={inputClass} rows={3} value={note.note} onChange={(e) => setNote({ ...note, note: e.target.value })} placeholder={L("What you learned in screening - kept with the application", "Apa yang anda pelajari dalam saringan - disimpan bersama permohonan")} aria-label={L("Note", "Nota")} data-testid="partner-note-text" />
              <div className={css.row}>
                <label className={css.inline}>{L("Next follow-up", "Susulan seterusnya")}<input type="date" className={inputClassSm} min={mytToday()} value={note.next_follow_up_on} onChange={(e) => setNote({ ...note, next_follow_up_on: e.target.value })} /></label>
                <button type="button" className={btnSmPrimary} disabled={busy || (note.note.trim().length < 3 && !note.next_follow_up_on)} onClick={() => void done(run("note", { note: note.note, ...(note.next_follow_up_on ? { next_follow_up_on: note.next_follow_up_on } : {}) }, L("Note saved", "Nota disimpan")))} data-testid="partner-note-save">{L("Save note", "Simpan nota")}</button>
              </div>
            </section>
          )}
          {form === "activate" && can.activate && (
            <section className={css.verify} aria-label={L("Activate", "Aktifkan")} data-testid="partner-activate-form">
              <h3 className={css.h3}>{L("Activate the Agent Portal access", "Aktifkan akses Portal Ejen")}</h3>
              <p className={css.muted}>{L("Recorded separately from the approval. First give the Agent role in Users & Security › Customers & Agents (the person signs in with a proven email) and set the responsible salesperson in Agents › Agents, then record the signed agreement here.", "Direkod berasingan daripada kelulusan. Mula-mula beri peranan Ejen dalam Pengguna & Keselamatan › Pelanggan & Ejen (orang itu log masuk dengan e-mel yang dibuktikan) dan tetapkan jurujual bertanggungjawab dalam Ejen › Ejen, kemudian rekod perjanjian yang ditandatangani di sini.")}</p>
              <div className={css.row}>
                <select className={selectClassSm} value={actv.agent_user_id} onChange={(e) => setActv({ ...actv, agent_user_id: Number(e.target.value) })} aria-label={L("Agent account", "Akaun ejen")} data-testid="partner-agent-account">
                  <option value={0}>{d!.agent_accounts.length ? L("Choose the Agent account…", "Pilih akaun Ejen…") : L("No Agent account with this email yet", "Belum ada akaun Ejen dengan e-mel ini")}</option>
                  {d!.agent_accounts.map((u) => <option key={u.id} value={u.id} disabled={!u.is_active}>{u.name} · {u.email}</option>)}
                </select>
                <button type="button" className={btnSm} onClick={toAccess} data-testid="partner-to-access"><AppIcon name="users" />{L("Give the Agent role", "Beri peranan Ejen")}</button>
              </div>
              {acct && (acct.salesperson_name
                ? <p className={css.muted} data-testid="partner-salesperson">{L(`Responsible salesperson: ${acct.salesperson_name}`, `Jurujual bertanggungjawab: ${acct.salesperson_name}`)}</p>
                : <p className={css.warn} data-testid="partner-salesperson">{L("No responsible salesperson yet. ", "Belum ada jurujual bertanggungjawab. ")}<button type="button" className={css.linkBtn} onClick={onAgents}>{L("Set it in Agents › Agents", "Tetapkan dalam Ejen › Ejen")}</button></p>)}
              <div className={css.row}>
                <label className={css.inline}>{L("Agreement signed on", "Perjanjian ditandatangani pada")}<input type="date" className={inputClassSm} max={mytToday()} value={actv.agreement_signed_on} onChange={(e) => setActv({ ...actv, agreement_signed_on: e.target.value })} /></label>
                <input className={inputClassSm} value={actv.agreement_note} onChange={(e) => setActv({ ...actv, agreement_note: e.target.value })} placeholder={L("Where the signed agreement is kept", "Di mana perjanjian bertandatangan disimpan")} aria-label={L("Where the agreement is kept", "Di mana perjanjian disimpan")} data-testid="partner-agreement-note" />
              </div>
              <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || !actv.agent_user_id || !acct?.salesperson_name || !actv.agreement_signed_on || actv.agreement_note.trim().length < 5} onClick={() => void done(run("activate", actv, L("Activated - the agent can sign in to the Agent Portal", "Diaktifkan - ejen boleh log masuk ke Portal Ejen")))} data-testid="partner-activate-save">{L("Record and activate", "Rekod dan aktifkan")}</button></div>
            </section>
          )}

          <section className={css.block} aria-label={L("Contact & source", "Hubungan & sumber")}>
            <h3 className={css.h3}>{L("Contact & source", "Hubungan & sumber")}</h3>
            <dl className={css.dl}>
              <dt>{L("Full name", "Nama penuh")}</dt><dd>{a.full_name}</dd>
              <dt>{L("Gender · age", "Jantina · umur")}</dt><dd>{a.gender === "male" ? L("Male", "Lelaki") : L("Female", "Perempuan")} · {a.age_range}</dd>
              <dt>WhatsApp</dt><dd><a className={css.linkBtn} href={`https://wa.me/${a.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{a.phone}</a></dd>
              <dt>{L("Email", "E-mel")}</dt><dd><a className={css.linkBtn} href={`mailto:${a.email}`}>{a.email}</a></dd>
              <dt>{L("City / State", "Bandar / Negeri")}</dt><dd>{LOC[a.location] ?? a.location}</dd>
              <dt>{L("Prefers · best time", "Pilihan · masa terbaik")}</dt><dd>{word({ whatsapp: ["WhatsApp", "WhatsApp"], email: ["Email", "E-mel"], call: ["Call", "Panggilan"] }, a.contact_method)} · {word(TIME, a.best_time)}</dd>
              <dt>{L("Recruitment source", "Sumber pengambilan")}</dt><dd><Src k={a.source} />{a.source_detail ? ` · ${a.source_detail}` : ""}</dd>
              <dt>{L("Campaign (UTM)", "Kempen (UTM)")}</dt><dd>{[a.utm_campaign, a.utm_source, a.utm_medium, a.utm_term, a.utm_content].filter(Boolean).join(" · ") || L("None recorded", "Tiada direkod")}</dd>
              <dt>{L("Submitted", "Dihantar")}</dt><dd>{myt(a.created_at)} · {a.lang === "ms" ? "BM" : "EN"}</dd>
            </dl>
          </section>
          <section className={css.block} aria-label={L("Referral capability", "Keupayaan rujukan")}>
            <h3 className={css.h3}>{L("Referral capability", "Keupayaan rujukan")}</h3>
            <dl className={css.dl}>
              <dt>{L("Referred before", "Pernah merujuk")}</dt><dd>{a.referred_before ? L("Yes", "Ya") : L("No - interested to start", "Tidak - berminat untuk bermula")}</dd>
              <dt>{L("Introductions / week", "Perkenalan / minggu")}</dt><dd>{a.intro_per_week}</dd>
              <dt>{L("Customer groups", "Kumpulan pelanggan")}</dt><dd>{a.customer_groups.map((g) => word(GRP, g)).join(", ")}{a.groups_other ? ` (${a.groups_other})` : ""}</dd>
              <dt>{L("Lead channels", "Saluran petunjuk")}</dt><dd>{a.lead_channels.map((g) => word(CHN, g)).join(", ")}{a.channels_other ? ` (${a.channels_other})` : ""}</dd>
              <dt>{L("Approach", "Pendekatan")}</dt><dd className={css.pre}>{a.approach}</dd>
            </dl>
          </section>
          <section className={css.block} aria-label={L("Availability & consent", "Ketersediaan & persetujuan")}>
            <h3 className={css.h3}>{L("Availability & consent", "Ketersediaan & persetujuan")}</h3>
            <dl className={css.dl}>
              <dt>{L("Time available", "Masa tersedia")}</dt><dd>{word(AV, a.time_available)}</dd>
              <dt>{L("Screening call", "Panggilan saringan")}</dt><dd>{word(WIN, a.screening_window)}</dd>
              <dt>{L("Acknowledged", "Diakui")}</dt><dd>{L("Independent referral, not employment · terms before activation · privacy notice", "Rujukan bebas, bukan pekerjaan · terma sebelum pengaktifan · notis privasi")}</dd>
              <dt>{L("Promotional messages", "Mesej promosi")}</dt><dd>{a.marketing_opt_in ? L("Yes - opted in", "Ya - bersetuju") : L("No", "Tidak")}</dd>
            </dl>
          </section>
          <section className={css.block} aria-label={L("Review", "Semakan")}>
            <h3 className={css.h3}>{L("Review and decisions", "Semakan dan keputusan")}</h3>
            <dl className={css.dl}>
              <dt>{L("Staff owner", "Pemilik kakitangan")}</dt><dd>{a.owner_name ?? L("Not picked up", "Belum diambil")}{a.picked_at ? ` · ${myt(a.picked_at)}` : ""}</dd>
              <dt>{L("First response", "Respons pertama")}</dt><dd>{a.first_response_at ? myt(a.first_response_at) : L("Not yet", "Belum")}</dd>
              <dt>{L("Next follow-up", "Susulan seterusnya")}</dt><dd>{a.next_follow_up_on ? day(a.next_follow_up_on) : "—"}</dd>
              {a.recommended_by_name && <><dt>{L("Shortlisted by", "Disenarai pendek oleh")}</dt><dd>{a.recommended_by_name}</dd></>}
              {a.preapproved_by_name && <><dt>{L("Pre-approved by", "Pra-lulus oleh")}</dt><dd>{a.preapproved_by_name} · {myt(a.preapproved_at)}</dd></>}
              {a.approved_by_name && <><dt>{L("Approved by", "Diluluskan oleh")}</dt><dd>{a.approved_by_name} · {myt(a.approved_at)}</dd></>}
              {a.activated_by_name && <><dt>{L("Activated by", "Diaktifkan oleh")}</dt><dd>{a.activated_by_name} · {myt(a.activated_at)} · {L(`agreement ${day(a.agreement_signed_on)}`, `perjanjian ${day(a.agreement_signed_on)}`)}</dd></>}
            </dl>
          </section>
          <section className={css.block} aria-label={L("History", "Sejarah")}>
            <h3 className={css.h3}>{L("History", "Sejarah")}</h3>
            <ul className={css.timeline} data-testid="partner-history">
              {[...(d?.events ?? [])].reverse().map((e) => (
                <li key={e.id}>
                  <span className={css.tlHead}><span className={css.strong}>{e.actor ?? L("Applicant", "Pemohon")}</span>{e.status_to && e.status_to !== e.status_from && ST[e.status_to as PStage] && <PChip s={e.status_to as PStage} />}{e.channel && <span className={chipSmNeutral}>{e.channel}</span>}<span className={css.muted}>{myt(e.created_at)}</span></span>
                  {e.body && <span className={css.pre}>{e.body}</span>}
                </li>
              ))}
            </ul>
          </section>
        </>)}
      </div>
    </SideDrawer>
  );
}

/* the reminder hours - management's, with a reason, audited on the server */
export function PartnerSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<{ unclaimed_hours: number; remind_hours: number; escalate_hours: number } | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { void api<{ settings: { unclaimed_hours: number; remind_hours: number; escalate_hours: number } }>("/staff/partner-applications/settings").then((r) => { if (r.ok && r.data) setV(r.data.settings); }); }, []);
  const save = async () => {
    const r = await api<{ error?: { message?: string } }>("/staff/partner-applications/settings", { method: "PUT", body: JSON.stringify({ ...v, reason }) });
    if (r.ok) { onSaved(); onClose(); } else setMsg(r.data?.error?.message ?? L("Not saved", "Tidak disimpan"));
  };
  const field = (k: "unclaimed_hours" | "remind_hours" | "escalate_hours", en: string, ms: string) => (
    <label className={css.field}><span>{L(en, ms)}</span><input type="number" min={1} max={336} className={inputClassSm} value={v?.[k] ?? ""} onChange={(e) => v && setV({ ...v, [k]: Number(e.target.value) })} data-testid={`partner-set-${k}`} /></label>
  );
  return (
    <SideDrawer open onClose={onClose} title={L("Partner application reminders", "Peringatan permohonan rakan kongsi")} subtitle={L("Once a day each, by notification", "Sekali sehari setiap satu, melalui pemberitahuan")}
      footer={<div className={css.footer}><button type="button" className={btnSm} onClick={onClose}>{L("Cancel", "Batal")}</button><button type="button" className={btnSmPrimary} disabled={!v || reason.trim().length < 5} onClick={() => void save()} data-testid="partner-set-save">{L("Save", "Simpan")}</button></div>}>
      {!v ? <SkelRows rows={3} /> : (
        <div className={css.form} data-testid="partner-settings">
          {field("unclaimed_hours", "Tell management when nobody has picked an application up after (hours)", "Maklumkan pengurusan apabila permohonan belum diambil selepas (jam)")}
          {field("remind_hours", "Remind the owner, the COO / CCO or the CEO when an application waits on them after (hours)", "Ingatkan pemilik, COO / CCO atau CEO apabila permohonan menunggu mereka selepas (jam)")}
          {field("escalate_hours", "Escalate an overdue screening to management after (hours)", "Eskalasi saringan lewat kepada pengurusan selepas (jam)")}
          <label className={css.field}><span>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}</span><input className={inputClassSm} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {msg && <p className={css.warn} role="alert">{msg}</p>}
        </div>
      )}
    </SideDrawer>
  );
}
