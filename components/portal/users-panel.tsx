"use client";

/* USER ACCOUNTS - v1.137.0, in five tabs from v1.189.0.
 *
 * The CEO, 08-09-2026: *"review Users UI/UX for webview and mobile apps view
 * which is globally css/style use."* (v1.137.0 put every surface, chip, field
 * and button on lib/ui-styles.ts, gave the phone a 44px labelled row action
 * and made the role editor the house bottom sheet.)
 *
 * The owner, 22-10-2026 (v1.189.0): the Users module as five tabs -
 *
 *   Overview              the counts, the latest sign-ins, the alerts
 *   Staff Accounts        the searchable table; Change role (super admin)
 *   Customer Accounts     Google and self sign-ups; Promote (super admin)
 *   Roles & Permissions   the permission matrix (tab-access-card.tsx)
 *   Security & Settings   the sign-in log, Who sees what, the office geofence
 *
 * v1.234.0 - ONE ACCESS PLACE (the owner, 30-10-2026; claude/USERS-ACCESS-
 * AUDIT.md). Roles & Permissions holds everything about access: what each
 * role may DO (the server's own rules, read-only), what each role SEES (the
 * tab matrix), and the per-user exceptions that replaced "Who sees what"
 * (with reason, approver and end date), plus the access review export.
 * Security & Settings is sign-in only: methods, 2FA, sessions, the user log
 * with filters - and the office geofence, which the owner kept here.
 *
 * The same requests (/staff/users, /staff/users/activity), the same role
 * editor and the same gates: ONE fetch here feeds every tab, and every body
 * stays mounted and hidden, never unmounted, so a search typed or a role
 * half chosen survives a look at another tab. Nothing about an account, a
 * role, a permission or the worker changed; the worker still enforces every
 * route (role changes are the super admin's alone, v1.4.157).
 *
 * Held by tests/users-ui.mjs.
 */
import { holds as holdsCap } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { L } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
/* v1.387.0 (the CEO's decision D5) - the Overview tab is gone: its figures are
   the Users strip. users-overview.tsx stays in the repository for rollback. */
type UsersView = "users" | "roles" | "company_access" | "security" | "audit";
import { CompanyAccess } from "@/components/portal/company-access"; // v1.387.0 (D1) - moved from Companies
import { PillSwitch } from "@/components/ui/panel";
import { verbOf, VERBS } from "@/components/portal/roles-permissions";
import { downloadCsv } from "@/lib/csv";
import { COMPANY_CODES, type CompanyStaffSetup } from "@/lib/company-review";
import { GeofenceCard, TabAccessCard } from "@/components/portal/lazy-panels";
import { AccessReviewDrawer, ExceptionsCard, usePolicy, useReview } from "@/components/portal/access-policy";
import { RolesPermissions } from "@/components/portal/roles-permissions"; // v1.331.0 - replaces the AccessPolicyCard matrix
import { OwnerPage, useOwner } from "@/components/portal/owner-card";
import { AuditPanel } from "@/components/admin/audit-panel";
import { AccountSheet } from "@/components/portal/account-sheet";
import { EmailMoveCard } from "@/components/portal/email-move"; // v1.376.0 - staff move to @a2zcreative.my
import { CustomerRecoverySheet } from "@/components/portal/customer-recovery-sheet"; // v1.266.0
import { ReportsRegister, SupportCard } from "@/components/portal/support-card";
import { SystemHealthCard } from "@/components/admin/system-health";
import { CustomersAgents } from "@/components/portal/customers-agents"; // v1.327.0
import { SecuritySessions } from "@/components/portal/security-sessions"; // v1.327.0
import { SecurityHealth, useSecurityStatus } from "@/components/portal/security-status"; // v1.341.0
import { withStepUp } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { Avatar } from "@/components/ui/avatar";
import { LineTabs } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile"; // 18-11-2026 - the one connected KPI strip
import { InviteSheet } from "@/components/portal/invite-sheet"; // v1.251.0 - Add User (invite)
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { firstName, properName } from "@/lib/names";
import {
  btnClass, btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn,
  fieldLabel, iconBtn, inputClassSm, selectClass, selectClassSm, sheetCard,
} from "@/lib/ui-styles";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import {
  mytStamp2, roleLabel, statusLabel, type Account, type AuthEvent,
} from "@/components/portal/users-shared";
import type { TabName } from "@/lib/portal-tabs";
import css from "./users-panel.module.css";

export { mytStamp2 };

/* v1.251.0 - the Users tabs (the owner, 02-11-2026; claude/CEO-ADMIN-USERS-AUDIT.md):
   Signatures & Stamps moved to Companies > Document & Signing; the full
   audit log is its own tab */
const USERS_VIEWS: readonly string[] = ["users", "roles", "company_access", "security", "audit"];
/* v1.387.0 - the start words other pages and old links still use: the old
   Overview, Staff Accounts and Customers & Agents views open Users (its
   Customers part for "customers"); "health" opens Security & MFA; the
   Companies reconciliation's words open Company Access at their part. */
const verbWord = (v: string) => ({ view: L("View", "Lihat"), create: L("Create", "Cipta"), edit: L("Edit", "Sunting"), approve: L("Approve", "Lulus"), delete: L("Delete", "Padam"), export: L("Export", "Eksport"), manage: L("Manage", "Urus") } as Record<string, string>)[v] ?? v;
const START_ALIAS: Record<string, UsersView> = { overview: "users", staff: "users", customers: "users", health: "security", company_review: "company_access", ownership_review: "company_access" };
type StaffFilter = "all" | "active" | "disabled" | "no2fa";
const PAGE = 25; // v1.253.0 - accounts shown before Show more

export function UsersPanel({ role, owner = false, go: _go, initialView }: { role: string; owner?: boolean; go?: (tab: TabName) => void; initialView?: string }) {
  /* v1.250.2 - Agents > Manage Agent Access opens Customer Accounts directly */
  const [secPart, setSecPart] = useState<"overview" | "owner" | "location" | "reports" | "health">(() => (initialView === "health" ? "health" : "overview"));
  const [secSeen, setSecSeen] = useState(initialView === "health"); // the owner part opens first once, while no owner is verified
  /* v1.327.0 - "health" is a start word, not a view: Security & Sessions opened at its System health part
     (the Dashboard's alert), so the card is on the page before revealAnchor looks for it */
  const startOfView = (v?: string): UsersView => (v && START_ALIAS[v] ? START_ALIAS[v]! : USERS_VIEWS.includes(v ?? "") ? v as UsersView : "users");
  const [view, setView] = useState<UsersView>(() => startOfView(initialView));
  const [seenStart, setSeenStart] = useState(initialView);
  const [userPart, setUserPart] = useState<"staff" | "customers">(() => (initialView === "customers" ? "customers" : "staff"));
  if (initialView !== seenStart) { setSeenStart(initialView); if (initialView && (USERS_VIEWS.includes(initialView) || START_ALIAS[initialView])) { setView(startOfView(initialView)); if (initialView === "customers") setUserPart("customers"); else if (initialView === "staff" || initialView === "overview") setUserPart("staff"); if (initialView === "health") { setSecPart("health"); setSecSeen(true); } } }
  /* v1.251.0 - Add User (invite) and the one person the Audit History shows */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [auditPerson, setAuditPerson] = useState<{ id: number; name: string } | null>(null);
  const [rows, setRows] = useState<Account[]>([]);
  const [msg, setMsg] = useState("");
  // v1.4.153: user log (recent sign-ins + account events) for monitoring
  const [events, setEvents] = useState<AuthEvent[]>([]);
  // v1.4.157 (CEO): role changes are SUPER_ADMIN ONLY - Google sign-ups
  // always land as customer, and keeping promotion out of every business
  // account (including the CEO's) means a breached sign-in can't escalate.
  /* v1.236.0 - and the verified company owner (the owner, 30-10-2026; the
     worker's roleChangeRule decides every change - this only draws it):
     executive, customer and technical Admin roles, never the CEO role or a
     super admin account; each privileged change asks for a reason and the
     owner's authenticator code. */
  const superAdmin = role === "super_admin";
  const canEdit = superAdmin || owner;
  const ROLE_OPTIONS = ["customer", "agent", "live_host", "editor", "marketing", "sales_marketing", "hr_admin", "cco", "coo", "admin", "ceo"]; // v1.249.0 - agent (the owner gives it); v1.249.2 - the owner gives the CEO role too (Super Admin: /admin > Users)
  const PRIVILEGED = ["customer", "cco", "coo", "admin", "ceo"];
  const { prompt, node: promptNode } = usePrompt();
  const EMP_OPTIONS = ["permanent", "contract", "part_time", "probation"];
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ role: string; employment_status: string; reason?: string }>({ role: "live_host", employment_status: "part_time" });
  const [saving, setSaving] = useState(false);
  /* v1.238.0 - the Sign-in & recovery sheet (components/portal/account-sheet) */
  const recovery = holdsCap("account_recovery", superAdmin || owner) || holdsCap("account_email", superAdmin || owner);
  const canMove = holdsCap("account_email", superAdmin || owner); // v1.376.0 - the staff email move (owner or super admin)
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [custSheetId, setCustSheetId] = useState<number | null>(null); // v1.266.0 - customer recovery
  /* v1.137.0 - one find box over both lists. The customer list is Google
     sign-ups and only grows; finding a person was scrolling. From v1.189.0
     each list is its own tab, and the box on either one is this one. */
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<StaffFilter>("all");
  /* 18-11-2026 (the CEO's Users & Security reference) - a role pick beside the status pick, and the
     email move opened as a page of Staff Accounts (a breadcrumb, never another tab) */
  const [rf, setRf] = useState("all");
  const [cf, setCf] = useState<"all" | "a2z" | "azoo">("all"); // v1.387.0 - company (proposed plan), Company Access holders only
  const planReader = holdsCap("company_review", ["super_admin", "ceo"].includes(role));
  const [companyPlan, setCompanyPlan] = useState<CompanyStaffSetup[]>([]);
  useEffect(() => {
    if (!planReader || view !== "users") return;
    const c = new AbortController();
    void api<{ staff: CompanyStaffSetup[] }>("/staff/companies/staff", { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setCompanyPlan(r.data.staff); });
    return () => c.abort();
  }, [planReader, view]);
  const [staffPart, setStaffPart] = useState<"list" | "move">("list");
  /* v1.253.0 (the owner, D3) - one page scroll: no list scrolls inside the
     page; 25 accounts, then Show more (the HR and Finance pattern). A new
     search starts again at the first 25. */
  const pageKey = `${q}|${sf}|${rf}`;
  /* v1.327.0 - the customers are the directory's register (customers-agents.tsx, 10 a page) */
  const [shown, setShown] = useState({ key: pageKey, staff: PAGE });
  const staffShown = shown.key === pageKey ? shown.staff : PAGE;
  const showMore = () => setShown({ key: pageKey, staff: staffShown + PAGE });
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.77.0 - skeleton until the first fetch lands (accounts and activity
     are two requests; each region clears its own skeleton). */
  const [loaded, setLoaded] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const load = useCallback(() => {
    void api<{ users?: Account[]; staff?: Account[] }>(`/staff/users`).then((r) => {
      if (r.ok && r.data) setRows((r.data.users ?? r.data.staff ?? []).filter((u) => (owner ? u.role !== "super_admin" : !["super_admin", "admin"].includes(u.role))));
      else setMsg(L("Could not load user accounts — check access.", "Tidak dapat memuatkan akaun pengguna — semak akses."));
      setLoaded(true);
    });
    void api<{ events: AuthEvent[] }>(`/staff/users/activity`).then((r) => {
      if (r.ok && r.data) setEvents(r.data.events);
      setEventsLoaded(true);
    });
  }, [owner]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(["users"], load);

  const stepUpNeeded = (u: { role: string }) => owner && !superAdmin && (PRIVILEGED.includes(u.role) || PRIVILEGED.includes(draft.role)) && u.role !== draft.role;
  const saveRole = async (u: { id: number; name: string; email: string; role: string }) => {
    if (saving) return; // v1.137.0 - the button had no busy state and could be pressed twice
    setSaving(true);
    const body = { role: draft.role, employment_status: draft.employment_status, ...(draft.reason?.trim() ? { reason: draft.reason.trim() } : {}) };
    const res = await withStepUp<{ role?: string; employment_status?: string; error?: { message?: string } }>(
      (totp) => api(`/staff/users/${u.id}/role`, { method: "POST", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) }),
      prompt,
      { title: L(`Confirm: ${firstName(u.name)} → ${roleLabel(draft.role)}`, `Sahkan: ${firstName(u.name)} → ${roleLabel(draft.role)}`),
        label: L("Your 6-digit authenticator code - an executive, admin or customer role is changing", "Kod pengesah 6 digit anda - peranan eksekutif, admin atau pelanggan sedang berubah") },
    );
    setSaving(false);
    if (res.ok) {
      showToast(L("Saved", "Disimpan"),
        `${firstName(u.name)} → ${roleLabel(draft.role)} (${statusLabel(res.data?.employment_status ?? draft.employment_status)})`);
      setEditId(null);
      load();
    } else {
      showToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Role change failed", "Penukaran peranan gagal"), "notice");
    }
  };

  /* v1.331.0 - Roles & Permissions → Assigned Users: give a staff account the chosen role, through
     the SAME role door as Staff Accounts (a reason, the authenticator code when the server asks; the
     worker's roleChangeRule decides). Nothing here decides who may change a role. */
  const assignRole = async (u: Account, to: string): Promise<boolean> => {
    if (saving) return false;
    const why = await prompt({ title: L(`${properName(u.full_name || u.name)} → ${roleLabel(to)}`, `${properName(u.full_name || u.name)} → ${roleLabel(to)}`),
      label: L(`Why (at least 10 characters, kept in the audit history). ${roleLabel(u.role)} becomes ${roleLabel(to)}; what the person may do changes at once.`, `Sebab (sekurang-kurangnya 10 aksara, disimpan dalam sejarah audit). ${roleLabel(u.role)} menjadi ${roleLabel(to)}; apa yang orang itu boleh lakukan berubah serta-merta.`), required: true });
    if (!why || why.value.trim().length < 10) return false;
    setSaving(true);
    const res = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api(`/staff/users/${u.id}/role`, { method: "POST", body: JSON.stringify({ role: to, ...(u.employment_status ? { employment_status: u.employment_status } : {}), reason: why.value.trim(), ...(totp ? { totp } : {}) }) }),
      prompt, { title: L(`Confirm: ${firstName(u.name)} → ${roleLabel(to)}`, `Sahkan: ${firstName(u.name)} → ${roleLabel(to)}`), label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") });
    setSaving(false);
    if (res.ok) { showToast(L("Saved", "Disimpan"), `${firstName(u.name)} → ${roleLabel(to)}`); load(); setPolicyTick((n) => n + 1); return true; }
    showToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Role change failed", "Penukaran peranan gagal"), "error");
    return false;
  };

  /* v1.250.0 (the agent portal brief) - Grant Agent Access: the SAME account
     becomes an agent (no second user), on the existing role door - the
     owner or the super admin, a reason and the authenticator code. The
     server refuses an email nobody has proven (Google sign-in or a verify
     link); the customer's history is keyed by email and stays. */
  const grantAgent = async (u: Account) => {
    if (saving) return;
    const why = await prompt({ title: L(`Grant Agent Access: ${properName(u.full_name || u.name)}`, `Beri Akses Ejen: ${properName(u.full_name || u.name)}`),
      label: L("Why (at least 10 characters, kept in the audit history). The same account becomes an agent; they no longer see their customer pages while an agent.", "Sebab (sekurang-kurangnya 10 aksara, disimpan dalam sejarah audit). Akaun yang sama menjadi ejen; mereka tidak lagi melihat halaman pelanggan semasa menjadi ejen."), required: true });
    if (!why || why.value.trim().length < 10) return;
    setSaving(true);
    const res = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api(`/staff/users/${u.id}/role`, { method: "POST", body: JSON.stringify({ role: "agent", reason: why.value.trim(), ...(totp ? { totp } : {}) }) }),
      prompt, { title: L("Confirm Agent access", "Sahkan akses ejen"), label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") });
    setSaving(false);
    if (res.ok) { showToast(L("Agent access given", "Akses ejen diberi"), L(`${firstName(u.name)} signs in to the Agents workspace now`, `${firstName(u.name)} kini log masuk ke ruang kerja Ejen`)); load(); }
    else showToast(L("Not given", "Tidak diberi"), res.data?.error?.message ?? L("Agent access was not given", "Akses ejen tidak diberi"), "notice");
  };

  /* v1.327.0 - Revoke Agent Access: the same role door back to "customer" (the owner or the Super
     Admin, a reason, the authenticator code); the server's roleChangeRule decides, as for the grant */
  const revokeAgent = async (u: Account) => {
    if (saving) return;
    const why = await prompt({ title: L(`Revoke Agent Access: ${properName(u.full_name || u.name)}`, `Tarik Akses Ejen: ${properName(u.full_name || u.name)}`),
      label: L("Why (at least 10 characters, kept in the audit history). The account returns to a customer account; its history stays.", "Sebab (sekurang-kurangnya 10 aksara, disimpan dalam sejarah audit). Akaun kembali menjadi akaun pelanggan; sejarahnya kekal."), required: true });
    if (!why || why.value.trim().length < 10) return;
    setSaving(true);
    const res = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api(`/staff/users/${u.id}/role`, { method: "POST", body: JSON.stringify({ role: "customer", reason: why.value.trim(), ...(totp ? { totp } : {}) }) }),
      prompt, { title: L("Confirm revoking Agent access", "Sahkan tarik akses ejen"), label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") });
    setSaving(false);
    if (res.ok) { showToast(L("Agent access revoked", "Akses ejen ditarik"), L(`${firstName(u.name)} is a customer account again`, `${firstName(u.name)} kembali menjadi akaun pelanggan`)); load(); }
    else showToast(L("Not revoked", "Tidak ditarik"), res.data?.error?.message ?? L("Agent access was not revoked", "Akses ejen tidak ditarik"), "notice");
  };

  /* The two fields and their Save, without a wrapper: the same markup is the
     inline panel on a desk and the body of the bottom sheet on a phone, so
     the two can never offer different choices. */
  const roleFields = (u: Account) => (
    <>
      <label className="block">
        <span className={fieldLabel}>{L("Role", "Peranan")}</span>
        <select className={selectClass} value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={fieldLabel}>{L("Employment status", "Status pekerjaan")}</span>
        <select className={selectClass} value={draft.employment_status}
          onChange={(e) => setDraft((d) => ({ ...d, employment_status: e.target.value }))}>
            {/* A status the CEO cannot set from here (resigned, terminated)
              still has to be SHOWN, or saving would silently change it. */}
          {(EMP_OPTIONS.includes(draft.employment_status) ? EMP_OPTIONS : [draft.employment_status, ...EMP_OPTIONS])
            .map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </label>
      {stepUpNeeded(u) && (
        <label className="block">
          <span className={fieldLabel}>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}</span>
          <input className={inputClassSm} maxLength={300} value={draft.reason ?? ""} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
        </label>
      )}
      <button type="button" className={`${btnClass} col-span-1 justify-center`} disabled={saving || (stepUpNeeded(u) && (draft.reason ?? "").trim().length < 10)} onClick={() => void saveRole(u)}>
        {saving ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}
      </button>
      <button type="button" className="inline-flex h-9 items-center text-xs underline" onClick={() => setEditId(null)}>{L("Cancel", "Batal")}</button>
      {!/@(azoneofficial\.com|a2zcreative\.my)$/.test(u.email.toLowerCase()) && draft.role !== "customer" && (
        <p className="text-muted-foreground col-span-2 w-full text-[11px]">
          {L("Personal-email (Google) account — staff roles are saved as", "Akaun e-mel peribadi (Google) — peranan kakitangan disimpan sebagai")}{" "}
          <span className="font-medium">{L("part time", "separuh masa")}</span>
          {L("; permanent staff need an @a2zcreative.my account.", "; kakitangan tetap memerlukan akaun @a2zcreative.my.")}
        </p>
      )}
    </>
  );

  const needle = q.trim().toLowerCase();
  /* v1.139.0 - BOTH names, and the role as it is written on screen. Testing
     `full_name || name` missed the other one, and matching the raw key meant
     typing what the chip says ("Sales & Marketing") found nobody. */
  const match = (u: Account) =>
    !needle || u.email.toLowerCase().includes(needle)
    || (u.full_name ?? "").toLowerCase().includes(needle)
    || (u.name ?? "").toLowerCase().includes(needle)
    || roleLabel(u.role).toLowerCase().includes(needle)
    || u.role.replace(/_/g, " ").includes(needle);
  /* v1.189.0 - the staff table's status pick: everyone, the active, the
     disabled, or the active ones still missing 2FA */
  const statusOk = (u: Account) =>
    sf === "all" || (sf === "active" ? Boolean(u.is_active) : sf === "disabled" ? !u.is_active : Boolean(u.is_active && !u.totp_enabled));
  /* v1.251.0 - an agent is not staff (v1.249.0): agents sit with the
     customers they were made from, in Customers & Agents */
  const allStaff = rows.filter((u) => u.role !== "customer" && u.role !== "agent");
  const allCustomers = rows.filter((u) => u.role === "customer" || u.role === "agent");
  /* v1.377.0 - the CEO (18-11-2026): "resigned staff need to put at the below list". Working
     accounts first, disabled ones next, leavers (resigned / terminated, or a leaving date with no
     rejoin) last - a stable partition, so the order inside each group is the one it had. Leavers
     and disabled accounts are drawn grey. Order and colour only: nobody is hidden. */
  const leftOf = (u: Account) => ["resigned", "terminated"].includes(u.employment_status ?? "") || (!!u.left_on && !u.rejoined_on);
  const dimRank = (u: Account) => (leftOf(u) ? 2 : !u.is_active ? 1 : 0);
  const leaversLast = <T extends Account>(list: T[]): T[] => [0, 1, 2].flatMap((r) => list.filter((u) => dimRank(u) === r));
  const roleOk = (u: Account) => rf === "all" || u.role === rf;
  const planOf = (id: number) => companyPlan.find((p) => p.id === id)?.memberships ?? null;
  const coOk = (u: Account) => cf === "all" || (planOf(u.id) ?? []).some((m) => m.company_code === cf);
  const staffRows = leaversLast(allStaff.filter(match).filter(statusOk).filter(roleOk).filter(coOk));
  /* the roles the staff list holds, for the role pick - from the accounts, never a fixed list */
  const staffRoles = [...new Set(allStaff.map((u) => u.role))].sort((a, b) => roleLabel(a).localeCompare(roleLabel(b)));
  /* the strip's figures: the same tests as the status pick, over every staff account */
  const fig = {
    all: allStaff.length,
    active: allStaff.filter((u) => u.is_active).length,
    no2fa: allStaff.filter((u) => u.is_active && !u.totp_enabled).length,
    disabled: allStaff.filter((u) => !u.is_active).length,
  };
  /* the last sign-in each account shows in the recent sign-in log (/staff/users/activity, the newest
     60 events) - a date only when the log holds one; older ones say so, never a guess */
  const lastIn = new Map<string, string>();
  for (const e of events) {
    if (!/^auth\.login/.test(e.action) || !e.email) continue;
    const k = e.email.toLowerCase();
    if (!lastIn.has(k) || lastIn.get(k)! < e.created_at) lastIn.set(k, e.created_at);
  }
  /* "3 of 12" while a search is on, plain "12" otherwise: a heading that only
     ever says 3 cannot be told from a list that lost nine rows. */
  const countOf = (shown: number, all: number) => (shown !== all ? `${shown}/${all}` : `${all}`);
  const headcount = allStaff.reduce<Record<string, number>>((m, u) => { if (u.is_active) m[u.role] = (m[u.role] ?? 0) + 1; return m; }, {});
  /* v1.387.0 - the reference's strip and columns, from what the server says:
     roles in use = distinct roles of active staff; MFA = active staff with
     2FA on; Permissions = the verbs the role holds in the access matrix (the
     same reading Roles & Permissions uses); Company access = EFFECTIVE access,
     which is the role while company restrictions are not active, with the
     proposed plan (Company Access) beside it for those who keep the review. */
  const activeStaff = allStaff.filter((u) => u.is_active);
  const rolesInUse = [...new Set(activeStaff.map((u) => u.role))];
  const mfaOn = activeStaff.filter((u) => u.totp_enabled).length;
  const mfaPct = activeStaff.length ? Math.round((mfaOn / activeStaff.length) * 100) : 0;
  const verbsOf = (r: string): string | null => {
    if (!policy?.d) return null;
    const held = new Set(policy.d.actions.filter((a) => a.roles.includes(r)).map((a) => verbOf(a.key)));
    const words = VERBS.filter((v) => v !== "manage" && held.has(v)).map((v) => verbWord(v));
    return words.length ? words.join(" · ") : held.has("manage") ? verbWord("manage") : L("None", "Tiada");
  };


  /* One row, drawn the same in both tables. The name on its own line and the
     email under it: on a 390px screen they cannot share one without the email
     - which is what tells two accounts apart - being the half that is cut.
     A phone folds the role, status and 2FA into a line of their own under the
     identity; a desk lays each out as a column. */
  const accountRow = (u: Account, kind: "staff" | "customer") => (
    <li key={u.id} className={`${css.row} ${kind === "customer" ? css.rowCust : ""} ${kind === "staff" && dimRank(u) > 0 ? css.rowGone : ""}`} data-gone={kind === "staff" && dimRank(u) > 0 ? "" : undefined}>
      <div className={css.identity}>
        <Avatar name={properName(u.full_name || u.name)} photoKey={u.photo_key} size="md" />
        <div className={css.who}>
          <span className={css.name}>{properName(u.full_name || u.name)}</span>
          <span className={css.email}>{u.email}</span>
          {/* v1.137.0 - these dates were a title= tooltip, which a phone
              cannot show at all. The house rule is that the reason is on
              screen. */}
          {(u.left_on || u.rejoined_on) && (
            <span className={css.dates}>
              {u.left_on ? L(`Left ${dmy(u.left_on)}`, `Berhenti ${dmy(u.left_on)}`) : ""}
              {u.left_on && u.rejoined_on ? " · " : ""}
              {u.rejoined_on ? L(`rejoined ${dmy(u.rejoined_on)}`, `kembali ${dmy(u.rejoined_on)}`) : ""}
            </span>
          )}
        </div>
      </div>
      <div className={css.chips}>
        {kind === "staff" && (
          <div className={css.cell}>
            <span className={chipSmNeutral}>{roleLabel(u.role)}</span>
            {ownerState?.d?.owner?.verified && ownerState.d.owner.user_id === u.id && <span className={chipSmSuccess}>{L("Owner", "Pemilik")}</span>}
            {u.not_staff ? <span className={chipSmWarn} title={L("Keeps its role; not counted as staff (payroll, headcount, pickers)", "Kekal peranannya; tidak dikira sebagai kakitangan (gaji, bilangan, pemilih)")}>{L("Test account", "Akaun ujian")}</span> : null}
            {(u.employment_status ?? "permanent") !== "permanent" && (
              <span className={["resigned", "terminated"].includes(u.employment_status ?? "") ? chipSmDanger : chipSmNeutral}>
                {statusLabel(u.employment_status ?? "")}
              </span>
            )}
          </div>
        )}
        {kind === "staff" && (
          <div className={`${css.cell} ${css.deskCell}`} data-col="company">
            <span className={chipSmInfo} title={L("Effective today: restrictions are not active - the role decides", "Berkuat kuasa hari ini: sekatan belum aktif - peranan menentukan")}>A2Z</span>
            <span className={chipSmInfo} title={L("Effective today: restrictions are not active - the role decides", "Berkuat kuasa hari ini: sekatan belum aktif - peranan menentukan")}>AZ ONE</span>
            {planReader && (() => { const p = planOf(u.id); return p && p.length ? <span className={css.planLine} title={L("Proposed plan in Company Access - not enforced", "Pelan dicadang dalam Akses Syarikat - belum dikuatkuasa")}>{L("plan", "pelan")}: {p.map((m) => `${m.company_code === "a2z" ? "A2Z" : "AZ ONE"} ${m.access_mode === "write" ? L("write", "tulis") : L("read", "baca")}`).join(" · ")}</span> : null; })()}
          </div>
        )}
        {kind === "staff" && (
          <div className={`${css.cell} ${css.deskCell} ${css.perm}`} data-col="permissions">
            {verbsOf(u.role) ?? <span className={css.dim}>{policy?.e ? "—" : "···"}</span>}
          </div>
        )}
        {kind === "customer" && <div className={css.cell}>
          {u.is_active
            ? <span className={chipSmSuccess}>{L("Active", "Aktif")}</span>
            : <span className={chipSmDanger}>{L("Disabled", "Dinyahaktif")}</span>}
        </div>}
        {kind === "staff" ? (
          <div className={css.cell}>
            {u.totp_enabled
              ? <span className={chipSmSuccess} title={L("Two-factor sign-in is on", "Log masuk dua faktor hidup")}><AppIcon name="success" />{L("On", "Hidup")}</span>
              : <span className={chipSmWarn} title={L("Two-factor sign-in is off", "Log masuk dua faktor mati")}>{L("Off", "Mati")}</span>}
          </div>
        ) : (
          <div className={css.cell}>
            {u.role === "agent"
              ? <span className={chipSmInfo}>{L("Agent", "Ejen")}</span>
              : <span className={chipSmNeutral}>{L("No staff access", "Tiada akses kakitangan")}</span>}
            {/* v1.253.0 (the owner, D1) - beside the access it changes, not in
                Manage: Manage holds icons only, one width on both tabs. The
                same condition as before (canEdit came with the Manage cell). */}
            {u.role === "customer" && canEdit && (owner || superAdmin) && (
              <button type="button" className={btnSm} disabled={saving} data-testid={`grant-agent-${u.id}`} onClick={() => void grantAgent(u)}>
                <AppIcon name="users" />{L("Grant Agent Access", "Beri Akses Ejen")}
              </button>
            )}
          </div>
        )}
        {kind === "staff" && (
          <div className={`${css.cell} ${css.deskCell} ${css.seen}`} data-col="last-sign-in">
            {lastIn.has(u.email.toLowerCase())
              ? <span>{mytStamp2(lastIn.get(u.email.toLowerCase())!)}</span>
              : <span className={css.dim}>{eventsLoaded ? L("Not in recent log", "Tiada dalam log terkini") : "···"}</span>}
          </div>
        )}
        {kind === "staff" && <div className={css.cell}>
          {u.is_active
            ? <span className={chipSmSuccess}>{L("Active", "Aktif")}</span>
            : <span className={chipSmDanger}>{L("Disabled", "Dinyahaktif")}</span>}
        </div>}
      </div>
      {((canEdit && (superAdmin || (u.role !== "ceo" && u.role !== "super_admin"))) || ((kind === "staff" || u.role === "customer") && recovery)) && (
        <div className={css.act}>
          {/* v1.238.0 - Sign-in & recovery: login email, password link, 2FA
              reset, Google link, devices (owner + super admin; the worker's
              canManageAccount decides each account) */}
          {/* v1.266.0 - a customer who cannot sign in: identity check first, then one recovery step */}
          {u.role === "customer" && recovery && (
            <button type="button" className={iconBtn}
              aria-label={L(`Recover sign-in: ${properName(u.full_name || u.name)}`, `Pulihkan log masuk: ${properName(u.full_name || u.name)}`)}
              title={L("Recover sign-in", "Pulihkan log masuk")} data-testid={`recover-${u.id}`}
              onClick={() => setCustSheetId(u.id)}>
              <AppIcon name="access" />
            </button>
          )}
          {(kind === "staff" || u.role === "agent") && recovery && (
            <button type="button" className={iconBtn}
              aria-label={L(`Manage account: ${properName(u.full_name || u.name)}`, `Urus akaun: ${properName(u.full_name || u.name)}`)}
              title={L("Manage account", "Urus akaun")} data-testid={`manage-${u.id}`}
              onClick={() => setSheetId(u.id)}>
              <AppIcon name="access" />
            </button>
          )}
          {canEdit && (superAdmin || (u.role !== "ceo" && u.role !== "super_admin")) && <button type="button" className={iconBtn}
            aria-label={kind === "staff"
              ? L(`Change role for ${properName(u.full_name || u.name)}`, `Tukar peranan untuk ${properName(u.full_name || u.name)}`)
              : L(`Promote ${properName(u.full_name || u.name)}`, `Naik taraf ${properName(u.full_name || u.name)}`)}
            title={kind === "staff" ? L("Change role", "Tukar peranan") : L("Promote", "Naik taraf")}
            onClick={() => {
              setEditId(u.id);
              /* v1.139.0 - a LEAVER keeps their status. Falling back to
                 "permanent" for resigned/terminated meant that changing a
                 leaver's role quietly brought them back into every staff
                 picker and onto payroll, because the route COALESCEs
                 whatever the form sends. */
              setDraft(kind === "staff"
                ? { role: u.role, employment_status: u.employment_status ?? "permanent" }
                : { role: "live_host", employment_status: "part_time" });
            }}>
            <AppIcon name="edit" />
          </button>}
        </div>
      )}
      {/* The desk panel. `hidden` is the ONLY base display class here - the
          v1.15.0 lesson: two unprefixed display utilities on one element let
          the stylesheet order decide, and it decided wrong. */}
      {editId === u.id && (
        <div className={`${css.editor} bg-secondary/40 mt-2 hidden w-full grid-cols-2 items-end gap-2 rounded-lg p-2 md:grid lg:flex lg:flex-wrap`}>
          {roleFields(u)}
        </div>
      )}
    </li>
  );

  /* the find box and the table's head, drawn the same on both lists */
  const toolbar = (shown: number, all: number, withFilter: boolean) => (
    <div className={css.toolbar}>
      <label className={css.search}>
        <AppIcon name="search" className={css.searchIcon} />
        <input className={inputClassSm} value={q} placeholder={L("Find by name, email or role", "Cari ikut nama, e-mel atau peranan")}
          aria-label={L("Find an account", "Cari akaun")} onChange={(e) => setQ(e.target.value)} />
      </label>
      {withFilter && (
        <select className={selectClassSm} value={rf} aria-label={L("Role", "Peranan")} data-testid="staff-role-filter" onChange={(e) => setRf(e.target.value)}>
          <option value="all">{L("All roles", "Semua peranan")}</option>
          {staffRoles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
      )}
      {withFilter && (
        <select className={selectClassSm} value={sf} aria-label={L("Status", "Status")} onChange={(e) => setSf(e.target.value as StaffFilter)}>
          <option value="all">{L("All status", "Semua status")}</option>
          <option value="active">{L("Active", "Aktif")}</option>
          <option value="disabled">{L("Disabled", "Dinyahaktif")}</option>
          <option value="no2fa">{L("Active without 2FA", "Aktif tanpa 2FA")}</option>
        </select>
      )}
      {withFilter && planReader && (
        <select className={selectClassSm} value={cf} aria-label={L("Company (proposed plan)", "Syarikat (pelan dicadang)")} data-testid="staff-company-filter" onChange={(e) => setCf(e.target.value as typeof cf)}>
          <option value="all">{L("Company (proposed): All", "Syarikat (dicadang): Semua")}</option>
          <option value="a2z">{L("Proposed for A2Z", "Dicadang untuk A2Z")}</option>
          <option value="azoo">{L("Proposed for AZ ONE", "Dicadang untuk AZ ONE")}</option>
        </select>
      )}
      {withFilter && (q || rf !== "all" || sf !== "all" || cf !== "all") && (
        <button type="button" className={btnSm} data-testid="staff-reset" onClick={() => { setQ(""); setRf("all"); setSf("all"); setCf("all"); }}><AppIcon name="refresh" />{L("Reset", "Set semula")}</button>
      )}
      <span className={css.count}>{L(`${countOf(shown, all)} shown`, `${countOf(shown, all)} dipaparkan`)}</span>
    </div>
  );

  const editing = rows.find((u) => u.id === editId) ?? null;
  /* v1.139.0 - the phone sheet behaves like the house sheet: the page behind
     it does not scroll, Escape closes it, and focus moves into it. Without
     the lock a drag on the dimmed area scrolled the list underneath, and a
     keyboard user had no way out at all. */
  useEffect(() => {
    if (!editing || !canEdit) return;
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 767px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditId(null); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [editing, canEdit]);

  const auditTab = ["ceo", "admin", "super_admin"].includes(role); // = PERMS.audit_read
  /* v1.387.0 - USERS & SECURITY: the single source of truth for accounts,
     login identities, roles, company access and security (the CEO's brief,
     18-11-2026). Five tabs; Company Access only for the holder of
     company_review (the CEO, the super admin) - the server refuses everyone
     else, so the COO sees exactly what they saw before. */
  const companyAccess = holdsCap("company_review", ["super_admin", "ceo"].includes(role));
  const tabs: readonly (readonly [UsersView, string])[] = [
    ["users", L("Users", "Pengguna")],
    ["roles", L("Roles & Permissions", "Peranan & kebenaran")],
    ...(companyAccess ? [["company_access", L("Company Access", "Akses Syarikat")] as const] : []),
    ["security", L("Security & MFA", "Keselamatan & MFA")],
    ...(auditTab ? [["audit", L("Audit Logs", "Log Audit")] as const] : []),
  ];
  const partSwitch = (
    <PillSwitch testid="users-part" label={L("Accounts", "Akaun")} value={userPart} onChange={setUserPart}
      options={[["staff", L("Staff", "Kakitangan")], ["customers", L("Customers & Agents", "Pelanggan & Ejen")]]} />
  );
  /* the shown list as a CSV: what the table shows, never a secret or a token */
  const exportStaff = () => downloadCsv(`user-accounts-${new Date().toISOString().slice(0, 10)}.csv`, [
    ["Name", "Email", "Role", "Department", "Status", "2FA", "Last sign-in (recent log)"],
    ...staffRows.map((u) => [properName(u.full_name || u.name), u.email, roleLabel(u.role), u.department ?? "", u.is_active ? "Active" : "Disabled", u.totp_enabled ? "On" : "Off", lastIn.get(u.email.toLowerCase()) ?? ""]),
  ]);
  const [caSeen, setCaSeen] = useState(false);
  if (view === "company_access" && !caSeen) setCaSeen(true);
  const canInvite = ["super_admin", "admin", "ceo"].includes(role); // POST /api/v1/users (atLeast admin); executive roles: the server's mayGrant
  /* v1.251.0 - THE OWNER SWITCH, said where the CEO works (the owner,
     02-11-2026: the restriction was real but explained only at the bottom
     of Security). The worker decides is_owner; this only tells him why. */
  const ownerOff = role === "ceo" && !owner;
  const holds = ["ceo", "super_admin"].includes(role); // the exceptions and the matrix's editor (= TAB_ACCESS_EDITORS)
  const [reviewTick, setReviewTick] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [seenRoles, setSeenRoles] = useState(false);
  const openView = (v: UsersView) => { setView(v); if (v === "roles") setSeenRoles(true); };
  const [policyTick, setPolicyTick] = useState(0); // v1.237.0 - reload after a matrix edit
  /* v1.331.0 - an address that opens on Roles & Permissions (?view=roles) reads the policy too, not only a press */
  const rolesOn = seenRoles || view === "roles";
  const policy = usePolicy(rolesOn || view === "users", policyTick); // v1.387.0 - the Users list's Permissions column reads it too
  const review = useReview(rolesOn && holds, reviewTick);
  const [ownerTick, setOwnerTick] = useState(0);

  const ownerState = useOwner(["ceo", "coo", "cco", "admin", "super_admin"].includes(role), ownerTick);
  const auditRead = ["ceo", "admin", "super_admin"].includes(role); // = PERMS.audit_read
  const geofence = holdsCap("geofence_admin", ["super_admin", "ceo", "coo"].includes(role));
  /* v1.341.0 - the security status (sessions, bot check, Cloudflare, files, backup): read while Security & Sessions is open; the server keeps it to the CEO and the Super Admin */
  const secStatus = useSecurityStatus(view === "security" && auditRead, secPart === "health" ? 1 : 0); // re-read on opening System health
  const adminDoor = ["super_admin", "admin"].includes(role);
  /* v1.252.1 (the owner, 02-11-2026: the Super Admin looked in /admin and
     could not find where to name the owner) - one Company owner zone, shown
     first in Security & Sessions while no owner is verified. */
  const ownerFirst = !ownerState?.d?.owner?.verified;
  const ownerZone = (
    <TabZone label={L("Company owner", "Pemilik syarikat")}>
      {/* v1.344.0 (image 04) - the Company owner page: strip, ownership and control, protected actions, the recovery panel and its audit; OwnerCard is inside it (first, until an owner is verified) */}
      <OwnerPage state={ownerState} onChanged={() => setOwnerTick((n) => n + 1)} onRoles={() => openView("roles")} onStaff={() => { setUserPart("staff"); openView("users"); }} onAudit={auditTab ? () => openView("audit") : undefined} />
    </TabZone>
  );

  /* v1.327.0 - Security & Sessions' parts; an anchor revealed from elsewhere (the Dashboard's
     System health alert) opens its part first, then revealAnchor finds the card */
  type SecPart = "overview" | "owner" | "location" | "reports" | "health";
  const secParts: (readonly [SecPart, string])[] = [
    /* v1.252.1 kept: until an owner is verified the Company owner card is the FIRST part, so the Super Admin finds it at once */
    ...(ownerState && ownerFirst ? [["owner", L("Company owner", "Pemilik syarikat")] as const] : []),
    ["overview", L("Overview", "Gambaran")],
    ...(ownerState && !ownerFirst ? [["owner", L("Company owner", "Pemilik syarikat")] as const] : []),
    ...(geofence ? [["location", L("Office location", "Lokasi pejabat")] as const] : []),
    ...(holds ? [["reports", L("Problem reports", "Laporan masalah")] as const] : []),
    ...(auditRead ? [["health", L("System health", "Kesihatan sistem")] as const] : []),
  ];
  if (!secSeen && ownerState?.d && ownerFirst) { setSecSeen(true); setSecPart("owner"); }
  useEffect(() => {
    const onReveal = (e: Event) => { if ((e as CustomEvent<string>).detail === "system-health") { setSecSeen(true); setView("security"); setSecPart("health"); } };
    window.addEventListener("azone:reveal", onReveal);
    return () => window.removeEventListener("azone:reveal", onReveal);
  }, []);

  return (
    <TabPage className={css.page}>
      {toastNode}{promptNode}
      <CustomerRecoverySheet userId={custSheetId} open={custSheetId !== null} onClose={() => setCustSheetId(null)} onChanged={load} />
      <AccountSheet userId={sheetId} open={sheetId !== null} onClose={() => setSheetId(null)} onChanged={load}
        onPermissions={holds ? () => { setSheetId(null); openView("roles"); } : undefined}
        onAudit={auditTab ? (id) => { const u = rows.find((x) => x.id === id); setSheetId(null); setAuditPerson({ id, name: properName(u?.full_name || u?.name || `#${id}`) }); openView("audit"); } : undefined} />
      {canInvite && <InviteSheet open={inviteOpen} executive={owner || superAdmin} onClose={() => setInviteOpen(false)} onDone={load} />}
      {/* v1.189.0 - the reference's underline tabs (gold rule under the open
          one); the shared LineTabs from v1.190.0, which Desk draws too */}
      <LineTabs value={view} onChange={openView} tabs={tabs} label={L("Users", "Pengguna")} />
      {ownerOff && (
        <section className={`${css.ownerOff}`} role="note" data-testid="owner-off">
          <AppIcon name="lock" className={css.noteIcon} />
          <div className={css.ownerOffText}>
            <p className={css.title}>{ownerState?.d?.owner && !ownerState.d.owner.verified
              ? L("Your owner authority is paused", "Kuasa pemilik anda digantung")
              : L("Your owner authority is not switched on yet", "Kuasa pemilik anda belum dihidupkan")}</p>
            <p className={css.sub}>{ownerState?.d?.owner && !ownerState.d.owner.verified && ownerState.d.owner.why_not
              ? L(`You are named company owner, but ${ownerState.d.owner.why_not === "no_2fa" ? "two-factor sign-in is off" : ownerState.d.owner.why_not === "inactive" ? "the account is not active" : "the account no longer holds the CEO role"}. Fix that and it returns at once.`, `Anda dinamakan pemilik syarikat, tetapi ${ownerState.d.owner.why_not === "no_2fa" ? "log masuk dua faktor dimatikan" : ownerState.d.owner.why_not === "inactive" ? "akaun tidak aktif" : "akaun tidak lagi memegang peranan CEO"}. Betulkan dan ia kembali serta-merta.`)
              : L("Giving and taking Agent, COO, CCO, Admin and CEO roles, creating executive accounts, changing login emails, 2FA recovery, suspending, signing out devices and editing what each role may do are built for you and checked by the server. They switch on once: the Super Admin (not this CEO account) signs in and names your account company owner - in /admin → Users → Company owner, or in the portal here under Users → Security & Sessions → Company owner - with a reason and the Super Admin's authenticator code, kept in the audit history. Until then the server refuses them.",
                  "Memberi dan menarik peranan Ejen, COO, CCO, Admin dan CEO, mencipta akaun eksekutif, menukar e-mel log masuk, pemulihan 2FA, menggantung, melog keluar peranti dan menyunting apa yang setiap peranan boleh lakukan telah dibina untuk anda dan disemak pelayan. Ia dihidupkan sekali: Super Admin (bukan akaun CEO ini) log masuk dan menamakan akaun anda pemilik syarikat - di /admin → Pengguna → Pemilik syarikat, atau dalam portal di Pengguna → Keselamatan & Sesi → Pemilik syarikat - dengan sebab dan kod pengesah Super Admin, disimpan dalam sejarah audit. Sehingga itu pelayan menolaknya.")}</p>
          </div>
          <button type="button" className={btnSm} onClick={() => openView("security")}>{L("Company owner", "Pemilik syarikat")}</button>
        </section>
      )}
      {msg && <p className="text-destructive mt-2 text-xs font-medium">{msg}</p>}

      <div hidden={view !== "users" || userPart !== "staff"} className={css.body}>
        <TabZone label={L("Staff accounts", "Akaun kakitangan")}>
          {/* 18-11-2026 (the CEO's Users & Security reference) - the email move is a page OF Staff
              Accounts: a breadcrumb and a way back, never another tab. Both stay mounted (hidden),
              so a half-made selection survives a look at the list. */}
          {canMove && (
            <nav className={css.crumbs} hidden={staffPart !== "move"} aria-label={L("Breadcrumb", "Serbuk roti")} data-testid="email-move-crumbs">
              <span><button type="button" className={css.crumbLink} onClick={() => setStaffPart("list")}>{L("Staff Accounts", "Akaun kakitangan")}</button> / <strong>{L("Move staff to @a2zcreative.my", "Pindahkan kakitangan ke @a2zcreative.my")}</strong></span>
              <button type="button" className={css.crumbLink} data-testid="email-move-back" onClick={() => setStaffPart("list")}>← {L("Back to Staff Accounts", "Kembali ke Akaun kakitangan")}</button>
            </nav>
          )}
          {canMove && <div hidden={staffPart !== "move"} className={css.part}><EmailMoveCard /></div>}
          <section className={`${card} ${css.outset}`} hidden={staffPart !== "list"} data-testid="staff-accounts">
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="person" /></span>
                <div className={css.headText}>
                  <p className={css.title}>
                    {L("User Accounts", "Akaun Pengguna")}{" "}
                    <span className={css.sub}>{countOf(staffRows.length, allStaff.length)}</span>
                  </p>
                  <p className={css.sub}>
                    {/* v1.253.0 - one short line; the same facts */}
                    {owner && !superAdmin
                      ? <>{L("Executive and Admin role changes ask for a reason and your code. Super Admin: ",
                          "Perubahan peranan eksekutif dan Admin memerlukan sebab dan kod anda. Super Admin: ")}<Link href="/admin" className={css.link}>/admin › {L("Users", "Pengguna")}</Link></>
                      : canEdit
                      ? L("Role and employment status (part-time: no OT). Passwords and deactivation: /admin.",
                          "Peranan dan status pekerjaan (separuh masa: tiada OT). Kata laluan dan penyahaktifan: /admin.")
                      : L("Read-only - only the super admin changes roles.",
                          "Baca sahaja - hanya super admin menukar peranan.")}
                  </p>
                </div>
              </div>
              {/* a phone lays these four out two by two, with their short names (the full ones on a desk) */}
              <div className={`${css.quick} ${css.quickStaff}`}>
                <button type="button" className={btnSm} data-testid="users-export" disabled={!loaded || staffRows.length === 0} onClick={exportStaff}><AppIcon name="download" />{L("Export", "Eksport")}</button>
                {canInvite && <button type="button" className="erp-button erp-button-accent" data-testid="add-user" onClick={() => setInviteOpen(true)}><AppIcon name="add" />{L("Add User", "Tambah Pengguna")}</button>}
                {canMove && <button type="button" className={btnSm} data-testid="email-move-open" onClick={() => setStaffPart("move")}><AppIcon name="send" /><span className="erp-desktop-only">{L("Move to @a2zcreative.my", "Pindah ke @a2zcreative.my")}</span><span className="erp-phone-only">{L("Email move", "Pindah e-mel")}</span></button>}
                {adminDoor && <Link className={btnSm} href="/admin"><AppIcon name="external" /><span className="erp-desktop-only">{L("Passwords & deactivation", "Kata laluan & penyahaktifan")}</span><span className="erp-phone-only">{L("Passwords", "Kata laluan")}</span></Link>}
              </div>
            </div>
            {/* the one connected KPI strip (the Tasks module's); each figure is the status pick it names */}
            <div className={css.strip}>
              <KpiRow label={L("User account figures", "Angka akaun pengguna")} testid="staff-figures">
                <KpiTile icon="users" tone="blue" label={L("Active Users", "Pengguna Aktif")} value={fig.active} busy={!loaded} sub={L(`of ${fig.all} accounts`, `daripada ${fig.all} akaun`)} onClick={() => setSf(sf === "active" ? "all" : "active")} pressed={sf === "active"} cell="active" />
                <KpiTile icon="lock" tone="navy" label={L("Roles in use", "Peranan digunakan")} value={rolesInUse.length} busy={!loaded} sub={rolesInUse.map((r) => roleLabel(r)).slice(0, 4).join(", ") + (rolesInUse.length > 4 ? "…" : "")} cell="roles" />
                <KpiTile icon="building" tone="purple" label={L("Companies", "Syarikat")} value={COMPANY_CODES.length} sub={L("Restrictions not active · by role", "Sekatan belum aktif · ikut peranan")} cell="companies" onClick={companyAccess ? () => openView("company_access") : undefined} />
                <KpiTile icon="verify" tone="gold" label={L("MFA (two-factor)", "MFA (dua faktor)")} value={`${mfaOn} / ${activeStaff.length}`} busy={!loaded} sub={L(`${mfaPct}% of active users · ${fig.no2fa} without`, `${mfaPct}% pengguna aktif · ${fig.no2fa} tanpa`)} onClick={() => setSf(sf === "no2fa" ? "all" : "no2fa")} pressed={sf === "no2fa"} cell="no2fa" />
              </KpiRow>
            </div>
            {/* 21-11-2026 (the CEO, the Payments page as the reference) - the figures first, then the Staff / Customers switch */}
            <div className={css.partBar}>{partSwitch}</div>
            {toolbar(staffRows.length, allStaff.length, true)}
            <div className={`${css.table} ${css.staffTable}`}>
              <div className={css.header} aria-hidden="true">
                <span>{L("User", "Pengguna")}</span><span>{L("Role", "Peranan")}</span><span>{L("Company access", "Akses syarikat")}</span><span>{L("Permissions (role)", "Kebenaran (peranan)")}</span><span>MFA</span><span>{L("Last login", "Log masuk terakhir")}</span><span>{L("Status", "Status")}</span><span>{L("Actions", "Tindakan")}</span>
              </div>
              <ul className={css.list}>
                {/* v1.77.0 - skeleton until the first fetch lands. */}
                {!loaded && <li className={css.wide}><SkelRows rows={6} /></li>}
                {loaded && staffRows.length === 0 && (
                  <li className={css.empty}>
                    {allStaff.length === 0
                      ? L("No staff accounts yet.", "Tiada akaun kakitangan lagi.")
                      : L("No staff account matches that.", "Tiada akaun kakitangan yang sepadan.")}
                  </li>
                )}
                {loaded && staffRows.slice(0, staffShown).map((u) => accountRow(u, "staff"))}
              </ul>
              {loaded && staffRows.length > staffShown && (
                <button type="button" className={`${btnSm} ${css.more}`} onClick={showMore}>
                  {L(`Show more (${staffRows.length - staffShown})`, `Tunjuk lagi (${staffRows.length - staffShown})`)}
                </button>
              )}
            </div>
            {allStaff.some((u) => !u.totp_enabled && u.is_active) && (
              <p className={`${css.note} ${css.noteWarn}`}>
                <AppIcon name="warning" className={css.noteIcon} />
                {(() => {
                  const no2fa = allStaff.filter((u) => !u.totp_enabled && u.is_active);
                  return `${no2fa.length} ${no2fa.length === 1
                    ? L("active account without 2FA — worth chasing:", "akaun aktif tanpa 2FA — perlu dikejar:")
                    : L("active accounts without 2FA — worth chasing:", "akaun aktif tanpa 2FA — perlu dikejar:")} ${no2fa.map((u) => firstName(u.name)).join(", ")}`;
                })()}
              </p>
            )}
          </section>
        </TabZone>
      </div>

      <div hidden={view !== "users" || userPart !== "customers"} className={css.body}>
        {/* v1.327.0 (the CEO's Users & Security brief) - the directory beside the chosen account:
            status, portal access and the authorised Grant / Revoke Agent Access (customers-agents.tsx).
            The same accounts, the same actions and the same gates as the list it replaces. */}
        <TabZone label={L("Customers & agents", "Pelanggan & ejen")}>
          <CustomersAgents accounts={allCustomers} loaded={loaded} busy={saving} tabs={<div className={css.partBar}>{partSwitch}</div>}
            canGrant={canEdit && (owner || superAdmin)} canRecover={recovery} canPromote={canEdit}
            editor={(u) => editId === u.id && canEdit ? <div className={`${css.detailEditor} erp-desktop-only`}>{roleFields(u)}</div> : null}
            onGrant={(u) => void grantAgent(u)} onRevoke={(u) => void revokeAgent(u)}
            onRecover={(id) => setCustSheetId(id)} onManage={(id) => setSheetId(id)}
            onPromote={(u) => { setEditId(u.id); setDraft({ role: "live_host", employment_status: "part_time" }); }}
            onAudit={auditTab ? (u) => { setAuditPerson({ id: u.id, name: properName(u.full_name || u.name) }); openView("audit"); } : undefined} />
        </TabZone>
      </div>

      <div hidden={view !== "roles"} className={css.body}>
        {/* v1.331.0 - ONE ROLE AT A TIME (the CEO, 17-11-2026: "REPLACE LEGACY ROLES & PERMISSIONS
            UI"): the role directory beside the chosen role's editor (roles-permissions.tsx), held to
            one screen. It replaces the wide Access policy matrix, the "Who sees each tab" fold and the
            stacked Per-user exceptions zone - those two are now drawers inside it (the same cards and
            routes). Every change is saved and enforced by the server, as before. */}
        <TabZone label={L("Roles & Permissions", "Peranan & Kebenaran")}>
          <RolesPermissions policy={policy} onChanged={() => { setPolicyTick((n) => n + 1); setReviewTick((n) => n + 1); }}
            staff={allStaff} loaded={loaded} canAssign={canEdit} assignable={ROLE_OPTIONS.filter((r) => r !== "customer" && r !== "agent")} onAssign={assignRole}
            exceptionCount={holds && review?.d ? review.d.exceptions.length : null}
            onReview={holds ? () => { setReviewTick((n) => n + 1); setReviewOpen(true); } : null}
            exceptions={holds ? (
              <ExceptionsCard bare review={review} canEdit={holds} onChanged={() => setReviewTick((n) => n + 1)}
                people={allStaff.filter((u) => u.is_active && !["super_admin"].includes(u.role)).map((u) => ({ id: u.id, name: properName(u.full_name || u.name), role: u.role }))} />
            ) : null}
            tabVisibility={<TabAccessCard canEdit={holds} headcount={headcount} onSaved={() => setPolicyTick((n) => n + 1)} />} />
        </TabZone>
        {holds && <AccessReviewDrawer open={reviewOpen} onClose={() => setReviewOpen(false)} review={review} />}
      </div>

      {/* v1.387.0 (D1) - COMPANY ACCESS: the whole reconciliation, moved from
          Companies unchanged in its routes, forms, versions, reasons and history */}
      {companyAccess && caSeen && (
        <div hidden={view !== "company_access"} className={css.body}>
          <CompanyAccess initialPart={initialView === "ownership_review" ? "review" : undefined} />
        </div>
      )}

      <div hidden={view !== "security"} className={css.body}>
        {/* v1.327.0 (the Security & Sessions picture) - one row of parts: the workspace (figure strip,
            Authentication Controls, Security Attention, the Sign-in Log, the principles) fills the screen;
            the company owner, the office location, problem reports and system health are each one press
            away, unchanged. Until an owner is verified the owner card still comes first (v1.252.1). */}
        <LineTabs value={secPart} onChange={setSecPart} label={L("Security parts", "Bahagian keselamatan")} testid="sec-part" tabs={secParts} />
        {secPart === "overview" && (
          <TabZone label={L("Security", "Keselamatan")}>
            <SecuritySessions staff={allStaff} loaded={loaded} events={events} eventsLoaded={eventsLoaded} canSettings={holds} status={secStatus} onHealth={auditRead ? () => setSecPart("health") : undefined}
              onManage={recovery ? (id) => setSheetId(id) : undefined} onStaffAccounts={() => { setUserPart("staff"); openView("users"); }} onAudit={auditTab ? () => openView("audit") : undefined} />
          </TabZone>
        )}
        {secPart === "owner" && ownerState && ownerZone}
        {secPart === "location" && geofence && (
          <TabZone label={L("Office location", "Lokasi pejabat")}>
            <GeofenceCard onAudit={auditTab ? () => openView("audit") : undefined} />
          </TabZone>
        )}
        {/* v1.238.0 - who receives Report a problem, and the system's
            health (errors, backups, migrations) next to the audit trail */}
        {secPart === "reports" && holds && view === "security" && (
          <TabZone label={L("Problem reports", "Laporan masalah")}>
            {/* v1.341.0 - the register (strip + every report, security incidents included) over the same report flow; who receives them stays below */}
            <ReportsRegister />
            <SupportCard />
          </TabZone>
        )}
        {secPart === "health" && auditRead && view === "security" && (
          <TabZone label={L("System health", "Kesihatan sistem")}>
            {/* v1.326.0 - the Dashboard's alert opens Security & Sessions AT this card (revealAnchor) */}
            {/* v1.341.0 - the security strip and the protection list read the one status (security-status.tsx); the errors and backups card below is unchanged */}
            <SecurityHealth s={secStatus} onAudit={auditTab ? () => openView("audit") : undefined} />
            <div id="system-health"><SystemHealthCard /></div>
          </TabZone>
        )}
      </div>

      {/* v1.251.0 - AUDIT HISTORY: the existing audit log (GET /api/v1/audit,
          audit_read), whole or for one person from their account */}
      {auditTab && (
        <div hidden={view !== "audit"} className={css.body}>
          {/* v1.327.0 (the Audit History picture) - the figure strip, the register and the chosen event: the panel draws its own panes */}
          <TabZone label={L("Audit history", "Sejarah audit")}>
            {view === "audit" && <AuditPanel person={auditPerson?.id ?? null} personName={auditPerson?.name ?? null} onClearPerson={() => setAuditPerson(null)} />}
          </TabZone>
        </div>
      )}

      {/* v1.137.0 — THE PHONE'S EDITOR. Two selects and a Save inside a
          flex-wrap list row reflowed the row they belonged to; as the house
          bottom sheet (app/portal/page.tsx) they sit over the page, full
          width, with the row still visible behind them. md: and up use the
          inline panel above, so only one of the two is ever displayed. */}
      {editing && canEdit && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true"
          aria-label={L("Change role", "Tukar peranan")}>
          <button type="button" aria-label={L("Close", "Tutup")} className="absolute inset-0 cursor-pointer bg-black/40"
            onClick={() => setEditId(null)} />
          <div className={sheetCard}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{properName(editing.full_name || editing.name)}</p>
                <p className="text-muted-foreground truncate text-xs">{editing.email}</p>
              </div>
              <button type="button" aria-label={L("Close", "Tutup")}
                className="border-border text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base"
                onClick={() => setEditId(null)}>✕</button>
            </div>
            <div className="grid grid-cols-2 items-end gap-2">{roleFields(editing)}</div>
          </div>
        </div>
      )}
    </TabPage>
  );
}
