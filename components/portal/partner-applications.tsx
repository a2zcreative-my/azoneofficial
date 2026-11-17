"use client";

/* v1.351.0 - PARTNER APPLICATIONS inside the existing Agents tab (the CEO,
   17-11-2026, "A2Z OS - CREATE PARTNER INTEREST APPLICATION").

   The public form at /apply/partner lands here - never in a new tab:
     Agents -> Requests  a request-type switch (Client Requests | Partner
                         Applications); the applications list beside the
                         Screening Workflow, the same split the client
                         requests use; one application opens in a drawer
     Agents -> Overview  the recruitment figures (one KPI strip) and what
                         agents brought in, read by PartnerOverview

   Who does what is the server's (worker/src/partners.ts); the drawer draws
   only the actions the server says this person may take now (`can`). Pick Up
   claims an application once - a second person is told somebody already
   has it. The final approval and the activation are two separate recorded
   actions, management's only; activation needs the agreement recorded and an
   Agent account already given in Users & Security -> Customers & Agents - this
   screen never creates an account or grants access. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { usePortal } from "@/components/portal/portal-provider";
import { CompactTaskTable, TaskRowSub, TaskRowTitle, TaskToolbar, type TableCol } from "@/components/portal/task-table";
import { fmtRM } from "@/lib/format";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Panel, WorkspaceGrid } from "@/components/ui/panel";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { AppIcon } from "@/components/ui/app-icon";
import { btnSm, btnSmPrimary, btnSmQuiet, chipSmNeutral, chipSmWarn, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./agents-panel.module.css";

export type PStatus = "new" | "assigned" | "screening" | "shortlisted" | "approved" | "rejected" | "on_hold" | "activated";
export interface PRow {
  id: number; ref: string; full_name: string; gender: string; age_range: string; phone: string; email: string; location: string; contact_method: string; source: string; source_detail: string | null;
  utm_campaign: string | null; referred_before: number; intro_per_week: string; customer_groups: string[]; lead_channels: string[]; time_available: string; status: PStatus;
  owner_id: number | null; owner_name: string | null; picked_at: string | null; first_response_at: string | null; next_follow_up_on: string | null; version: number; created_at: string; overdue: boolean;
}
export interface PList { applications: PRow[]; counts: Record<string, number>; me: number; can_manage: boolean; can_approve: boolean; settings: { unclaimed_hours: number; remind_hours: number; escalate_hours: number }; pending_migration?: boolean }
interface PDetail {
  application: PRow & { best_time: string | null; utm_source: string | null; utm_medium: string | null; utm_term: string | null; utm_content: string | null; groups_other: string | null; channels_other: string | null;
    approach: string; screening_window: string; marketing_opt_in: number; lang: string | null; recommended_by_name: string | null; approved_by_name: string | null; approved_at: string | null;
    agreement_signed_on: string | null; agreement_note: string | null; agent_user_id: number | null; activated_by_name: string | null; activated_at: string | null };
  events: { id: number; kind: string; body: string | null; channel: string | null; status_from: string | null; status_to: string | null; created_at: string; actor: string | null }[];
  agent_accounts: { id: number; name: string; email: string; is_active: number }[];
  can: { pickup: boolean; release: boolean; contact: boolean; note: boolean; status: string[]; approve: boolean; activate: boolean };
}
export interface PSummary {
  applications: { total: number; by_status: Record<string, number>; by_source: { key: string; count: number }[]; by_campaign: { key: string; count: number }[]; owners: { id: number; name: string; total: number; open: number }[];
    unclaimed: number; qualified: number; approved: number; activated: number; avg_first_response_hours: number | null; responded: number };
  agents: { id: number; name: string; leads: number; quotations: number; paid_cents: number; paid_sales: number; week_paid_cents: number }[];
  week: { from: string; to: string; company_target_cents: number | null; agent_paid_cents: number; verified_sales: number };
}

type Bi = [string, string];
const ST: Record<PStatus, Bi> = {
  new: ["New", "Baharu"], assigned: ["Assigned", "Ditugaskan"], screening: ["Screening", "Saringan"], shortlisted: ["Shortlisted", "Disenarai pendek"],
  approved: ["Approved", "Diluluskan"], rejected: ["Rejected", "Ditolak"], on_hold: ["On Hold", "Ditangguh"], activated: ["Activated", "Diaktifkan"],
};
const TONE: Record<PStatus, string | undefined> = { new: css.info, assigned: css.gold, screening: css.wait, shortlisted: css.violet, approved: css.ok, rejected: css.bad, on_hold: css.off, activated: css.ok };
export const pWord = (s: PStatus) => L(ST[s][0], ST[s][1]);
const PChip = ({ s }: { s: PStatus }) => <span className={`${css.chip} ${TONE[s]}`}>{pWord(s)}</span>;
const SRC: Record<string, Bi> = {
  facebook: ["Facebook", "Facebook"], instagram: ["Instagram", "Instagram"], x: ["X", "X"], threads: ["Threads", "Threads"], tiktok: ["TikTok", "TikTok"], linkedin: ["LinkedIn", "LinkedIn"],
  whatsapp: ["WhatsApp", "WhatsApp"], google: ["Google", "Google"], website: ["Website", "Laman web"], referral: ["Referral", "Rujukan"], event: ["Event", "Acara"], other: ["Other", "Lain-lain"],
};
export const srcWord = (k: string) => (SRC[k] ? L(SRC[k][0], SRC[k][1]) : k);
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
const day = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("-") : "");
/* the server keeps UTC; a person reads Malaysia time */
const myt = (v: string | null | undefined) => {
  if (!v) return "";
  const t = Date.parse(`${v.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return v;
  const d = new Date(t + 8 * 3600_000).toISOString();
  return `${day(d)} ${d.slice(11, 16)}`;
};
const mytToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

/* the process, in the order the CEO named it */
const FLOW: { s: PStatus[]; who: Bi; what: Bi }[] = [
  { s: ["new"], who: ["New", "Baharu"], what: ["Submitted from the public form - nobody has picked it up", "Dihantar dari borang awam - belum diambil sesiapa"] },
  { s: ["assigned"], who: ["Assigned", "Ditugaskan"], what: ["Picked up by one person - contact the applicant", "Diambil oleh seorang - hubungi pemohon"] },
  { s: ["screening"], who: ["Screening", "Saringan"], what: ["Contacted - the screening discussion and notes", "Telah dihubungi - perbincangan saringan dan nota"] },
  { s: ["shortlisted"], who: ["Shortlisted", "Disenarai pendek"], what: ["Recommended by Sales - waiting for management", "Disyorkan oleh Jualan - menunggu pengurusan"] },
  { s: ["approved", "rejected", "on_hold"], who: ["Approved / Rejected / On Hold", "Lulus / Ditolak / Ditangguh"], what: ["The decision, with its reason", "Keputusan, dengan sebabnya"] },
  { s: ["activated"], who: ["Activated", "Diaktifkan"], what: ["Agreement recorded and Agent access given - a separate step", "Perjanjian direkod dan akses Ejen diberi - langkah berasingan"] },
];

/* =====================================================================
   Requests -> Partner Applications: the list beside the Screening Workflow
   ===================================================================== */
export function PartnerInbox({ list, failed, onOpen, onSettings }: { list: PList | null; failed: string; onOpen: (id: number) => void; onSettings: () => void }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState<"" | "open" | "mine" | "unclaimed" | "overdue" | PStatus>("");
  const [flow, setFlow] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const key = `${q}|${st}|${flow}`;
  const [seen, setSeen] = useState(key);
  if (key !== seen) { setSeen(key); setPage(1); }
  const rows = useMemo(() => list?.applications ?? [], [list]);
  const shown = useMemo(() => rows.filter((r) => (
    (!st || (st === "open" ? !["rejected", "activated"].includes(r.status) : st === "mine" ? r.owner_id === list?.me : st === "unclaimed" ? r.status === "new" : st === "overdue" ? r.overdue : r.status === st))
    && (flow === null || FLOW[flow]!.s.includes(r.status))
    && (!q || `${r.ref} ${r.full_name} ${r.email} ${r.phone} ${r.source} ${r.utm_campaign ?? ""} ${r.owner_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
  )), [rows, st, flow, q, list]);
  const cols: TableCol<PRow>[] = [
    { key: "who", label: L("Applicant · reference", "Pemohon · rujukan"), main: true, cell: (r) => <><TaskRowTitle title={r.full_name} onOpen={() => onOpen(r.id)} /><TaskRowSub><span data-testid={`partner-ref-${r.id}`}>{r.ref}</span><span>{L(`Age ${r.age_range}`, `Umur ${r.age_range}`)}</span></TaskRowSub></> },
    { key: "src", label: L("Source", "Sumber"), cell: (r) => <span className={css.stack}><span>{srcWord(r.source)}</span>{r.utm_campaign && <small className={css.mutedInline}>{r.utm_campaign}</small>}</span> },
    { key: "contact", label: L("Contact", "Hubungan"), cell: (r) => <span className={css.stack}><span>{r.phone}</span><small className={css.mutedInline}>{r.email}</small></span> },
    { key: "cap", label: L("Capability", "Keupayaan"), cell: (r) => <span className={css.stack}><span>{L(`${r.intro_per_week} / week`, `${r.intro_per_week} / minggu`)}</span><small className={css.mutedInline}>{r.referred_before ? L("Referred before", "Pernah merujuk") : L("New to referring", "Baru merujuk")}</small></span> },
    { key: "status", label: L("Review status", "Status semakan"), cell: (r) => <span className={css.stack}><PChip s={r.status} /><small className={css.mutedInline}>{r.owner_name ?? (r.status === "new" ? L("Not picked up", "Belum diambil") : "")}</small>{r.overdue && <small className={css.dueLate}>{L("Overdue", "Lewat")}</small>}<small className={css.mutedInline}>{myt(r.created_at)}</small></span> },
  ];
  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  const empty = rows.length === 0 ? (
    <div className={css.emptyBox} data-testid="partner-empty">
      <span className={css.emptyIcon} aria-hidden><AppIcon name="users" /></span>
      <strong>{L("No partner applications yet.", "Belum ada permohonan rakan kongsi.")}</strong>
      <p>{L("Share a2zcreative.my/apply/partner - every application lands here, with its source and campaign, for the team to pick up.", "Kongsi a2zcreative.my/apply/partner - setiap permohonan sampai di sini, dengan sumber dan kempennya, untuk diambil pasukan.")}</p>
    </div>
  ) : <p className={css.calm}><AppIcon name="search" />{L("No application matches this filter.", "Tiada permohonan sepadan dengan penapis ini.")}</p>;
  const n = (s: PStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  return (
    <WorkspaceSplit testid="partner-split" ratio="60-40">
      <SplitPane testid="partner-inbox" title={L("Partner Applications", "Permohonan Rakan Kongsi")} label={L("Partner applications", "Permohonan rakan kongsi")}
        sub={L("From the public Partner Interest Application. Pick one up, contact the applicant, then recommend, hold or reject.", "Dari Permohonan Minat Rakan Kongsi awam. Ambil satu, hubungi pemohon, kemudian syorkan, tangguh atau tolak.")}
        actions={<span className={chipSmNeutral} data-testid="partner-count">{list ? (shown.length !== rows.length ? L(`${shown.length} of ${rows.length}`, `${shown.length} daripada ${rows.length}`) : L(`${rows.length} application${rows.length === 1 ? "" : "s"}`, `${rows.length} permohonan`)) : "…"}</span>}
        toolbar={<TaskToolbar q={q} onQ={setQ} placeholder={L("Search name, reference, phone or campaign", "Cari nama, rujukan, telefon atau kempen")} testid="partner-toolbar">
          <select className={selectClassSm} value={st} onChange={(e) => { setSt(e.target.value as typeof st); setFlow(null); }} aria-label={L("Status", "Status")} data-testid="partner-filter">
            <option value="">{L("All applications", "Semua permohonan")}</option>
            <option value="open">{L("Open", "Terbuka")}</option>
            <option value="unclaimed">{L("Not picked up", "Belum diambil")}</option>
            <option value="mine">{L("Mine", "Milik saya")}</option>
            <option value="overdue">{L("Overdue", "Lewat")}</option>
            {(Object.keys(ST) as PStatus[]).map((s) => <option key={s} value={s}>{pWord(s)}</option>)}
          </select>
        </TaskToolbar>}>
        <CompactTaskTable rows={shown} cols={cols} label={L("Partner applications", "Permohonan rakan kongsi")} loading={!list} record="partner" testid="partner-table" dense fill
          onOpen={onOpen} rowClass={(r) => (r.overdue ? css.lateRow ?? "" : "")} empty={empty} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} />
      </SplitPane>
      <SplitPane testid="partner-workflow" title={L("Screening Workflow", "Aliran Saringan")} label={L("Screening workflow", "Aliran saringan")}
        sub={L("Sales screens and recommends; management gives the final approval and, separately, activates. Press a step to see its applications.", "Jualan menyaring dan mengesyorkan; pengurusan memberi kelulusan akhir dan, secara berasingan, mengaktifkan. Tekan langkah untuk melihat permohonannya.")}>
        <ol className={css.flow}>
          {FLOW.map((f, i) => {
            const on = flow === i;
            return (
              <li key={f.who[0]}>
                <button type="button" className={css.flowStep} aria-pressed={on} onClick={() => { setFlow(on ? null : i); setSt(""); }} data-testid={`partner-flow-${i}`}>
                  <span className={css.flowNo} aria-hidden>{i + 1}</span>
                  <span className={css.flowText}><strong>{L(f.who[0], f.who[1])}</strong><small>{L(f.what[0], f.what[1])}</small></span>
                  <span className={css.flowCount}>{list ? n(f.s) : "…"}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className={css.goldNote} data-testid="partner-note">
          <AppIcon name="lock" />
          <span><strong>{L("No account from a form:", "Tiada akaun dari borang:")}</strong> {L(`an application never signs anyone in. Agent access is given in Users & Security › Customers & Agents after approval. Reminders: not picked up after ${list?.settings.unclaimed_hours ?? 4} h, no contact after ${list?.settings.remind_hours ?? 24} h, escalation after ${list?.settings.escalate_hours ?? 48} h.`, `permohonan tidak pernah memberi akses. Akses Ejen diberi dalam Pengguna & Keselamatan › Pelanggan & Ejen selepas kelulusan. Peringatan: belum diambil selepas ${list?.settings.unclaimed_hours ?? 4} j, tiada hubungan selepas ${list?.settings.remind_hours ?? 24} j, eskalasi selepas ${list?.settings.escalate_hours ?? 48} j.`)}</span>
          {list?.can_manage && <button type="button" className={btnSmQuiet} onClick={onSettings} data-testid="partner-settings-open">{L("Reminder settings", "Tetapan peringatan")}</button>}
        </div>
      </SplitPane>
    </WorkspaceSplit>
  );
}

/* =====================================================================
   One application: everything it says, its history, and the next step
   ===================================================================== */
export function PartnerDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: (msg?: string) => void }) {
  const [d, setD] = useState<PDetail | null>(null);
  const [problem, setProblem] = useState("");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"" | "contact" | "note" | "activate">("");
  const [contact, setContact] = useState({ channel: "whatsapp", note: "", next_follow_up_on: "" });
  const [note, setNote] = useState({ note: "", next_follow_up_on: "" });
  const [actv, setActv] = useState({ agent_user_id: 0, agreement_signed_on: mytToday(), agreement_note: "" });
  const { prompt, node: promptNode } = usePrompt();
  const { setTab, setTabStart } = usePortal();
  useEffect(() => {
    const c = new AbortController();
    void api<PDetail & { error?: { message?: string } }>(`/staff/partner-applications/${id}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data?.application) { setD(r.data); setProblem(""); } else setProblem(r.data?.error?.message ?? L("The application could not be opened.", "Permohonan tidak dapat dibuka."));
    });
    return () => c.abort();
  }, [id, tick]);
  const run = useCallback(async (action: string, body: Record<string, unknown>, done: string) => {
    if (!d) return false;
    setBusy(true); setProblem("");
    const r = await api<{ error?: { code?: string; message?: string } }>(`/staff/partner-applications/${id}/${action}`, { method: "POST", body: JSON.stringify({ version: d.application.version, ...body }) });
    setBusy(false);
    setTick((t) => t + 1);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.")); if (r.status === 409) onChanged(); return false; }
    setForm("");
    onChanged(done);
    return true;
  }, [d, id, onChanged]);
  const decide = async (to: string) => {
    const t: Record<string, [Bi, Bi, "danger" | "default"]> = {
      shortlisted: [["Shortlist and recommend", "Senarai pendek dan syorkan"], ["Why do you recommend this applicant? (kept with the application)", "Mengapa anda mengesyorkan pemohon ini? (disimpan bersama permohonan)"], "default"],
      on_hold: [["Put on hold", "Tangguhkan"], ["Why is it on hold?", "Mengapa ditangguhkan?"], "default"],
      rejected: [["Reject the application", "Tolak permohonan"], ["Why? (kept with the application)", "Mengapa? (disimpan bersama permohonan)"], "danger"],
      screening: [["Back to screening", "Kembali ke saringan"], ["Why is it reopened?", "Mengapa dibuka semula?"], "default"],
    };
    const [title, label, variant] = t[to]!;
    const a = await prompt({ title: L(title[0], title[1]), label: L(label[0], label[1]), required: true, variant });
    if (!a || a.value.trim().length < 5) { if (a) setProblem(L("Give a reason of at least 5 characters.", "Beri sebab sekurang-kurangnya 5 aksara.")); return; }
    await run("status", { to, reason: a.value.trim() }, pWord(to as PStatus));
  };
  const approve = async (decision: "approve" | "reject") => {
    const a = await prompt({ title: decision === "approve" ? L("Approve this partner", "Luluskan rakan kongsi ini") : L("Reject this partner", "Tolak rakan kongsi ini"),
      label: L("Your reason (kept with the application and in the audit history)", "Sebab anda (disimpan bersama permohonan dan dalam sejarah audit)"), required: true, variant: decision === "reject" ? "danger" : "default" });
    if (!a || a.value.trim().length < 5) { if (a) setProblem(L("Give a reason of at least 5 characters.", "Beri sebab sekurang-kurangnya 5 aksara.")); return; }
    await run("approve", { decision, reason: a.value.trim() }, decision === "approve" ? L("Approved - activation is a separate step", "Diluluskan - pengaktifan langkah berasingan") : L("Rejected", "Ditolak"));
  };
  const release = async () => {
    const a = await prompt({ title: L("Hand the application back", "Serahkan semula permohonan"), label: L("Why? Somebody else can then pick it up.", "Mengapa? Orang lain boleh mengambilnya."), required: true });
    if (!a || a.value.trim().length < 5) return;
    await run("release", { reason: a.value.trim() }, L("Handed back", "Diserahkan semula"));
  };
  const toAccess = () => { setTabStart({ tab: "Users", view: "customers" }); setTab("Users"); };

  const a = d?.application;
  const can = d?.can;
  const footer = a && can ? (
    <div className={css.footer} data-testid="partner-actions">
      {can.pickup && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void run("pickup", {}, L("Picked up - it is yours", "Diambil - ia milik anda"))} data-testid="partner-pickup"><AppIcon name="add" />{L("Pick Up", "Ambil")}</button>}
      {can.contact && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm(form === "contact" ? "" : "contact")} data-testid="partner-contact"><AppIcon name="chat" />{L("Contact", "Hubungi")}</button>}
      {can.note && <button type="button" className={btnSm} disabled={busy} onClick={() => setForm(form === "note" ? "" : "note")} data-testid="partner-note-btn"><AppIcon name="edit" />{L("Review Notes", "Nota Semakan")}</button>}
      {can.status.includes("shortlisted") && <button type="button" className={btnSm} disabled={busy} onClick={() => void decide("shortlisted")} data-testid="partner-shortlist"><AppIcon name="star" />{L("Shortlist", "Senarai Pendek")}</button>}
      {can.status.includes("on_hold") && <button type="button" className={btnSm} disabled={busy} onClick={() => void decide("on_hold")} data-testid="partner-hold"><AppIcon name="pending" />{L("Hold", "Tangguh")}</button>}
      {can.status.includes("screening") && <button type="button" className={btnSm} disabled={busy} onClick={() => void decide("screening")} data-testid="partner-reopen"><AppIcon name="refresh" />{L("Back to screening", "Kembali ke saringan")}</button>}
      {can.status.includes("rejected") && <button type="button" className={btnSmQuiet} disabled={busy} onClick={() => void decide("rejected")} data-testid="partner-reject"><AppIcon name="error" />{L("Reject", "Tolak")}</button>}
      {can.approve && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void approve("approve")} data-testid="partner-approve"><AppIcon name="verify" />{L("Approve (final)", "Luluskan (akhir)")}</button>}
      {can.approve && <button type="button" className={btnSmQuiet} disabled={busy} onClick={() => void approve("reject")} data-testid="partner-approve-reject">{L("Reject (final)", "Tolak (akhir)")}</button>}
      {can.activate && <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => setForm(form === "activate" ? "" : "activate")} data-testid="partner-activate"><AppIcon name="success" />{L("Activate", "Aktifkan")}</button>}
      {can.release && <button type="button" className={btnSmQuiet} disabled={busy} onClick={() => void release()} data-testid="partner-release">{L("Hand back", "Serah semula")}</button>}
    </div>
  ) : undefined;

  return (
    <SideDrawer open onClose={onClose} wide full title={a ? `${a.ref} · ${a.full_name}` : L("Partner application", "Permohonan rakan kongsi")} subtitle={a ? <PChip s={a.status} /> : undefined} footer={footer}>
      {promptNode}
      <div className={css.drawer} data-testid="partner-drawer">
        {problem && <p className={css.warn} role="alert">{problem}</p>}
        {!a ? <SkelRows rows={6} /> : (<>
          <p className={css.lock}>{L("Screening only. Submitting this form created no account and grants no access; nothing here is an employment decision.", "Saringan sahaja. Borang ini tidak membuat akaun dan tidak memberi akses; tiada apa di sini keputusan pekerjaan.")}</p>
          {form === "contact" && (
            <section className={css.block} aria-label={L("Record a contact", "Rekod hubungan")} data-testid="partner-contact-form">
              <h3 className={css.h3}>{L("Record the contact", "Rekod hubungan")}</h3>
              <div className={css.row}>
                <select className={selectClassSm} value={contact.channel} onChange={(e) => setContact({ ...contact, channel: e.target.value })} aria-label={L("How", "Bagaimana")}>
                  <option value="whatsapp">WhatsApp</option><option value="call">{L("Call", "Panggilan")}</option><option value="email">{L("Email", "E-mel")}</option><option value="other">{L("Other", "Lain-lain")}</option>
                </select>
                <label className={css.inline}>{L("Next follow-up", "Susulan seterusnya")}<input type="date" className={inputClassSm} min={mytToday()} value={contact.next_follow_up_on} onChange={(e) => setContact({ ...contact, next_follow_up_on: e.target.value })} /></label>
              </div>
              <textarea className={inputClass} rows={2} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} placeholder={L("What happened - e.g. WhatsApp sent, screening call booked", "Apa yang berlaku - cth. WhatsApp dihantar, panggilan saringan ditempah")} aria-label={L("What happened", "Apa yang berlaku")} data-testid="partner-contact-note" />
              <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || contact.note.trim().length < 3} onClick={() => void run("contact", { ...contact, next_follow_up_on: contact.next_follow_up_on || null }, L("Contact recorded", "Hubungan direkod"))} data-testid="partner-contact-save">{L("Save contact", "Simpan hubungan")}</button></div>
            </section>
          )}
          {form === "note" && (
            <section className={css.block} aria-label={L("Review notes", "Nota semakan")} data-testid="partner-note-form">
              <h3 className={css.h3}>{L("Review note", "Nota semakan")}</h3>
              <textarea className={inputClass} rows={3} value={note.note} onChange={(e) => setNote({ ...note, note: e.target.value })} placeholder={L("What you learned in screening - kept with the application", "Apa yang anda pelajari dalam saringan - disimpan bersama permohonan")} aria-label={L("Note", "Nota")} data-testid="partner-note-text" />
              <div className={css.row}>
                <label className={css.inline}>{L("Next follow-up", "Susulan seterusnya")}<input type="date" className={inputClassSm} min={mytToday()} value={note.next_follow_up_on} onChange={(e) => setNote({ ...note, next_follow_up_on: e.target.value })} /></label>
                <button type="button" className={btnSmPrimary} disabled={busy || (note.note.trim().length < 3 && !note.next_follow_up_on)} onClick={() => void run("note", { note: note.note, ...(note.next_follow_up_on ? { next_follow_up_on: note.next_follow_up_on } : {}) }, L("Note saved", "Nota disimpan"))} data-testid="partner-note-save">{L("Save note", "Simpan nota")}</button>
              </div>
            </section>
          )}
          {form === "activate" && (
            <section className={css.verify} aria-label={L("Activate", "Aktifkan")} data-testid="partner-activate-form">
              <h3 className={css.h3}>{L("Activate the partnership", "Aktifkan perkongsian")}</h3>
              <p className={css.muted}>{L("Activation is recorded separately from the approval. First give Agent access in Users & Security › Customers & Agents (the person signs in with a proven email), then choose that account here.", "Pengaktifan direkod berasingan daripada kelulusan. Mula-mula beri akses Ejen dalam Pengguna & Keselamatan › Pelanggan & Ejen (orang itu log masuk dengan e-mel yang dibuktikan), kemudian pilih akaun itu di sini.")}</p>
              <div className={css.row}>
                <select className={selectClassSm} value={actv.agent_user_id} onChange={(e) => setActv({ ...actv, agent_user_id: Number(e.target.value) })} aria-label={L("Agent account", "Akaun ejen")} data-testid="partner-agent-account">
                  <option value={0}>{d!.agent_accounts.length ? L("Choose the Agent account…", "Pilih akaun Ejen…") : L("No Agent account with this email yet", "Belum ada akaun Ejen dengan e-mel ini")}</option>
                  {d!.agent_accounts.map((u) => <option key={u.id} value={u.id} disabled={!u.is_active}>{u.name} · {u.email}</option>)}
                </select>
                <button type="button" className={btnSm} onClick={toAccess} data-testid="partner-to-access"><AppIcon name="users" />{L("Give Agent access", "Beri akses Ejen")}</button>
              </div>
              <div className={css.row}>
                <label className={css.inline}>{L("Agreement signed on", "Perjanjian ditandatangani pada")}<input type="date" className={inputClassSm} max={mytToday()} value={actv.agreement_signed_on} onChange={(e) => setActv({ ...actv, agreement_signed_on: e.target.value })} /></label>
                <input className={inputClassSm} value={actv.agreement_note} onChange={(e) => setActv({ ...actv, agreement_note: e.target.value })} placeholder={L("Where the signed agreement is kept", "Di mana perjanjian bertandatangan disimpan")} aria-label={L("Where the agreement is kept", "Di mana perjanjian disimpan")} data-testid="partner-agreement-note" />
              </div>
              <div className={css.row}><button type="button" className={btnSmPrimary} disabled={busy || !actv.agent_user_id || !actv.agreement_signed_on || actv.agreement_note.trim().length < 5} onClick={() => void run("activate", actv, L("Activated - assign a salesperson in the Agents directory", "Diaktifkan - tugaskan jurujual dalam direktori Ejen"))} data-testid="partner-activate-save">{L("Record and activate", "Rekod dan aktifkan")}</button></div>
            </section>
          )}

          <section className={css.block} aria-label={L("Contact", "Hubungan")}>
            <h3 className={css.h3}>{L("Contact & source", "Hubungan & sumber")}</h3>
            <dl className={css.dl}>
              <dt>{L("Full name", "Nama penuh")}</dt><dd>{a.full_name}</dd>
              <dt>{L("Gender · age", "Jantina · umur")}</dt><dd>{a.gender === "male" ? L("Male", "Lelaki") : L("Female", "Perempuan")} · {a.age_range}</dd>
              <dt>{L("WhatsApp", "WhatsApp")}</dt><dd><a className={css.linkBtn} href={`https://wa.me/${a.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{a.phone}</a></dd>
              <dt>{L("Email", "E-mel")}</dt><dd><a className={css.linkBtn} href={`mailto:${a.email}`}>{a.email}</a></dd>
              <dt>{L("City / State", "Bandar / Negeri")}</dt><dd>{LOC[a.location] ?? a.location}</dd>
              <dt>{L("Prefers · best time", "Pilihan · masa terbaik")}</dt><dd>{word({ whatsapp: ["WhatsApp", "WhatsApp"], email: ["Email", "E-mel"], call: ["Call", "Panggilan"] }, a.contact_method)} · {word(TIME, a.best_time)}</dd>
              <dt>{L("Recruitment source", "Sumber pengambilan")}</dt><dd>{srcWord(a.source)}{a.source_detail ? ` · ${a.source_detail}` : ""}</dd>
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
            <h3 className={css.h3}>{L("Review", "Semakan")}</h3>
            <dl className={css.dl}>
              <dt>{L("Staff owner", "Pemilik kakitangan")}</dt><dd>{a.owner_name ?? L("Not picked up", "Belum diambil")}{a.picked_at ? ` · ${myt(a.picked_at)}` : ""}</dd>
              <dt>{L("First response", "Respons pertama")}</dt><dd>{a.first_response_at ? myt(a.first_response_at) : L("Not yet", "Belum")}</dd>
              <dt>{L("Next follow-up", "Susulan seterusnya")}</dt><dd>{a.next_follow_up_on ? day(a.next_follow_up_on) : "—"}</dd>
              {a.recommended_by_name && <><dt>{L("Recommended by", "Disyorkan oleh")}</dt><dd>{a.recommended_by_name}</dd></>}
              {a.approved_by_name && <><dt>{L("Approved by", "Diluluskan oleh")}</dt><dd>{a.approved_by_name} · {myt(a.approved_at)}</dd></>}
              {a.activated_by_name && <><dt>{L("Activated by", "Diaktifkan oleh")}</dt><dd>{a.activated_by_name} · {myt(a.activated_at)} · {L(`agreement ${day(a.agreement_signed_on)}`, `perjanjian ${day(a.agreement_signed_on)}`)}</dd></>}
            </dl>
          </section>
          <section className={css.block} aria-label={L("History", "Sejarah")}>
            <h3 className={css.h3}>{L("History", "Sejarah")}</h3>
            <ul className={css.timeline} data-testid="partner-history">
              {[...(d?.events ?? [])].reverse().map((e) => (
                <li key={e.id}>
                  <span className={css.tlHead}><span className={css.strong}>{e.actor ?? L("Applicant", "Pemohon")}</span>{e.status_to && e.status_to !== e.status_from && <PChip s={e.status_to as PStatus} />}{e.channel && <span className={chipSmNeutral}>{e.channel}</span>}<span className={css.muted}>{myt(e.created_at)}</span></span>
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
          {field("remind_hours", "Remind the owner when there is no contact, or the follow-up is due, after (hours)", "Ingatkan pemilik apabila tiada hubungan, atau susulan tiba, selepas (jam)")}
          {field("escalate_hours", "Escalate to management after (hours)", "Eskalasi kepada pengurusan selepas (jam)")}
          <label className={css.field}><span>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}</span><input className={inputClassSm} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {msg && <p className={css.warn} role="alert">{msg}</p>}
        </div>
      )}
    </SideDrawer>
  );
}

/* =====================================================================
   Agents -> Overview: recruitment and what agents brought in
   ===================================================================== */
export function PartnerOverview({ s, failed, onList }: { s: PSummary | null; failed: boolean; onList: () => void }) {
  if (failed) return null;
  const ap = s?.applications;
  const open = ap ? (ap.by_status.assigned ?? 0) + (ap.by_status.screening ?? 0) + (ap.by_status.on_hold ?? 0) : 0;
  const max = (list: { count: number }[]) => Math.max(1, ...list.map((x) => x.count));
  const target = s?.week.company_target_cents ?? null;
  const pct = target ? Math.min(100, Math.round(((s?.week.agent_paid_cents ?? 0) / target) * 100)) : 0;
  return (
    <Panel icon="users" tone="gold" title={L("Partner Recruitment", "Pengambilan Rakan Kongsi")} testid="partner-overview"
      sub={L("Applications from the public Partner Interest Application, their screening, and the CEO-verified sales agents brought in. Gender and age are never used to decide.", "Permohonan dari Permohonan Minat Rakan Kongsi awam, saringannya, dan jualan yang disahkan CEO yang dibawa ejen. Jantina dan umur tidak pernah digunakan untuk membuat keputusan.")}
      aside={<button type="button" className={btnSm} onClick={onList} data-testid="partner-overview-open">{L("Open applications", "Buka permohonan")}<AppIcon name="next" /></button>}>
      <KpiRow label={L("Partner applications at a glance", "Permohonan rakan kongsi sepintas lalu")} testid="partner-strip">
        <KpiTile icon="documents" tone="navy" label={L("Applications", "Permohonan")} busy={!s} value={ap?.total ?? 0} sub={ap ? L(`${ap.unclaimed} not picked up`, `${ap.unclaimed} belum diambil`) : undefined} onClick={onList} />
        <KpiTile icon="search" tone="blue" label={L("In Screening", "Dalam Saringan")} busy={!s} value={open} sub={ap ? L(`${ap.owners.length} staff owner(s)`, `${ap.owners.length} pemilik kakitangan`) : undefined} />
        <KpiTile icon="star" tone="purple" label={L("Qualified", "Layak")} busy={!s} value={ap?.qualified ?? 0} sub={L("Shortlisted, approved or active", "Disenarai pendek, lulus atau aktif")} />
        <KpiTile icon="verify" tone="green" label={L("Approved", "Diluluskan")} busy={!s} value={ap?.approved ?? 0} sub={ap ? L(`${ap.activated} activated agent(s)`, `${ap.activated} ejen diaktifkan`) : undefined} />
        <KpiTile icon="time" tone="gold" label={L("First Response", "Respons Pertama")} busy={!s} value={ap?.avg_first_response_hours == null ? "—" : L(`${ap.avg_first_response_hours} h`, `${ap.avg_first_response_hours} j`)} sub={ap ? L(`Average over ${ap.responded}`, `Purata bagi ${ap.responded}`) : undefined} />
        <KpiTile icon="money" tone="green" label={L("Agent Sales This Week", "Jualan Ejen Minggu Ini")} busy={!s} value={s ? fmtRM(s.week.agent_paid_cents) : "—"}
          sub={s ? (target ? L(`${pct}% of the RM ${(target / 100).toLocaleString("en-MY")} weekly target`, `${pct}% daripada sasaran mingguan RM ${(target / 100).toLocaleString("en-MY")}`) : L("No weekly target set", "Tiada sasaran mingguan")) : undefined} />
      </KpiRow>
      <WorkspaceGrid testid="partner-overview-grid"
        main={
          <div className={css.two}>
            <section className={css.block} aria-label={L("By recruitment source", "Mengikut sumber pengambilan")} data-testid="partner-by-source">
              <h3 className={css.h3}>{L("By recruitment source", "Mengikut sumber pengambilan")}</h3>
              {!ap ? <SkelRows rows={3} /> : ap.by_source.length === 0 ? <p className={css.calm}><AppIcon name="info" />{L("No applications yet.", "Belum ada permohonan.")}</p> : (
                <ul className={css.feed}>{ap.by_source.map((x) => (
                  <li key={x.key} className={css.barRow}><strong title={String(x.key)}>{srcWord(x.key)}</strong><span className={css.convBar} aria-hidden><span style={{ width: `${Math.round((x.count / max(ap.by_source)) * 100)}%` }} /></span><span className={css.num}>{x.count}</span></li>
                ))}</ul>
              )}
            </section>
            <section className={css.block} aria-label={L("By campaign", "Mengikut kempen")} data-testid="partner-by-campaign">
              <h3 className={css.h3}>{L("By campaign (UTM)", "Mengikut kempen (UTM)")}</h3>
              {!ap ? <SkelRows rows={3} /> : ap.by_campaign.length === 0 ? <p className={css.calm}><AppIcon name="info" />{L("No campaign link has brought an application yet.", "Belum ada pautan kempen yang membawa permohonan.")}</p> : (
                <ul className={css.feed}>{ap.by_campaign.map((x) => (
                  <li key={x.key} className={css.barRow}><strong title={String(x.key)}>{x.key}</strong><span className={css.convBar} aria-hidden><span style={{ width: `${Math.round((x.count / max(ap.by_campaign)) * 100)}%` }} /></span><span className={css.num}>{x.count}</span></li>
                ))}</ul>
              )}
            </section>
          </div>
        }
        rail={
          <section className={css.block} aria-label={L("Screening and ownership", "Saringan dan pemilikan")} data-testid="partner-owners">
            <h3 className={css.h3}>{L("Screening status · staff ownership", "Status saringan · pemilikan kakitangan")}</h3>
            {!ap ? <SkelRows rows={3} /> : (<>
              <div className={css.row}>{(Object.keys(ST) as PStatus[]).filter((k) => ap.by_status[k]).map((k) => <span key={k} className={`${css.chip} ${TONE[k]}`}>{pWord(k)} {ap.by_status[k]}</span>)}</div>
              {ap.owners.length === 0 ? <p className={css.calm}><AppIcon name="info" />{L("Nobody has picked an application up yet.", "Belum ada yang mengambil permohonan.")}</p> : (
                <ul className={css.feed}>{ap.owners.map((o) => <li key={o.id}><span className={css.feedItem}><span className={css.feedText}><strong>{o.name}</strong><small>{L(`${o.open} open · ${o.total} in all`, `${o.open} terbuka · ${o.total} keseluruhan`)}</small></span></span></li>)}</ul>
              )}
              {target ? <p className={css.muted}>{L(`Agents' CEO-verified sales, ${day(s!.week.from)} - ${day(s!.week.to)}: ${fmtRM(s!.week.agent_paid_cents)} toward the company's RM ${(target / 100).toLocaleString("en-MY")} weekly target.`, `Jualan ejen yang disahkan CEO, ${day(s!.week.from)} - ${day(s!.week.to)}: ${fmtRM(s!.week.agent_paid_cents)} ke arah sasaran mingguan syarikat RM ${(target / 100).toLocaleString("en-MY")}.`)}</p> : null}
              <span className={chipSmWarn}>{L("Paid = verified by the CEO, each sale once", "Dibayar = disahkan CEO, setiap jualan sekali")}</span>
            </>)}
          </section>
        } />
    </Panel>
  );
}
