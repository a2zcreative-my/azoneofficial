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
import { UsersOverview, type UsersView } from "@/components/portal/users-overview";
import { GeofenceCard, TabAccessCard } from "@/components/portal/lazy-panels";
import { AccessPolicyCard, AccessReviewDrawer, ExceptionsCard, usePolicy, useReview } from "@/components/portal/access-policy";
import { OwnerCard, useOwner } from "@/components/portal/owner-card";
import { AuditPanel } from "@/components/admin/audit-panel";
import { AccountSheet } from "@/components/portal/account-sheet";
import { CustomerRecoverySheet } from "@/components/portal/customer-recovery-sheet"; // v1.266.0
import { SupportCard } from "@/components/portal/support-card";
import { SystemHealthCard } from "@/components/admin/system-health";
import { CustomersAgents } from "@/components/portal/customers-agents"; // v1.327.0
import { SecuritySessions } from "@/components/portal/security-sessions"; // v1.327.0
import { withStepUp } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import ap from "./access-policy.module.css";
import { Avatar } from "@/components/ui/avatar";
import { LineTabs } from "@/components/ui/line-tabs";
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
const USERS_VIEWS: readonly string[] = ["overview", "staff", "customers", "roles", "security", "audit"];
type StaffFilter = "all" | "active" | "disabled" | "no2fa";
const PAGE = 25; // v1.253.0 - accounts shown before Show more

export function UsersPanel({ role, owner = false, go, initialView }: { role: string; owner?: boolean; go?: (tab: TabName) => void; initialView?: string }) {
  /* v1.250.2 - Agents > Manage Agent Access opens Customer Accounts directly */
  const [secPart, setSecPart] = useState<"overview" | "owner" | "location" | "reports" | "health">(() => (initialView === "health" ? "health" : "overview"));
  const [secSeen, setSecSeen] = useState(initialView === "health"); // the owner part opens first once, while no owner is verified
  /* v1.327.0 - "health" is a start word, not a view: Security & Sessions opened at its System health part
     (the Dashboard's alert), so the card is on the page before revealAnchor looks for it */
  const startOfView = (v?: string): UsersView => (v === "health" ? "security" : USERS_VIEWS.includes(v ?? "") ? v as UsersView : "overview");
  const [view, setView] = useState<UsersView>(() => startOfView(initialView));
  const [seenStart, setSeenStart] = useState(initialView);
  if (initialView !== seenStart) { setSeenStart(initialView); if (initialView && (USERS_VIEWS.includes(initialView) || initialView === "health")) { setView(startOfView(initialView)); if (initialView === "health") { setSecPart("health"); setSecSeen(true); } } }
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
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [custSheetId, setCustSheetId] = useState<number | null>(null); // v1.266.0 - customer recovery
  /* v1.137.0 - one find box over both lists. The customer list is Google
     sign-ups and only grows; finding a person was scrolling. From v1.189.0
     each list is its own tab, and the box on either one is this one. */
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<StaffFilter>("all");
  /* v1.253.0 (the owner, D3) - one page scroll: no list scrolls inside the
     page; 25 accounts, then Show more (the HR and Finance pattern). A new
     search starts again at the first 25. */
  const pageKey = `${q}|${sf}`;
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
      {!u.email.toLowerCase().endsWith("@azoneofficial.com") && draft.role !== "customer" && (
        <p className="text-muted-foreground col-span-2 w-full text-[11px]">
          {L("Personal-email (Google) account — staff roles are saved as", "Akaun e-mel peribadi (Google) — peranan kakitangan disimpan sebagai")}{" "}
          <span className="font-medium">{L("part time", "separuh masa")}</span>
          {L("; permanent staff need an @azoneofficial.com account.", "; kakitangan tetap memerlukan akaun @azoneofficial.com.")}
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
  const staffRows = allStaff.filter(match).filter(statusOk);
  /* "3 of 12" while a search is on, plain "12" otherwise: a heading that only
     ever says 3 cannot be told from a list that lost nine rows. */
  const countOf = (shown: number, all: number) => (shown !== all ? `${shown}/${all}` : `${all}`);
  const headcount = allStaff.reduce<Record<string, number>>((m, u) => { if (u.is_active) m[u.role] = (m[u.role] ?? 0) + 1; return m; }, {});

  /* One row, drawn the same in both tables. The name on its own line and the
     email under it: on a 390px screen they cannot share one without the email
     - which is what tells two accounts apart - being the half that is cut.
     A phone folds the role, status and 2FA into a line of their own under the
     identity; a desk lays each out as a column. */
  const accountRow = (u: Account, kind: "staff" | "customer") => (
    <li key={u.id} className={`${css.row} ${kind === "customer" ? css.rowCust : ""}`}>
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
            {(u.employment_status ?? "permanent") !== "permanent" && (
              <span className={["resigned", "terminated"].includes(u.employment_status ?? "") ? chipSmDanger : chipSmNeutral}>
                {statusLabel(u.employment_status ?? "")}
              </span>
            )}
          </div>
        )}
        <div className={css.cell}>
          {u.is_active
            ? <span className={chipSmSuccess}>{L("Active", "Aktif")}</span>
            : <span className={chipSmDanger}>{L("Disabled", "Dinyahaktif")}</span>}
        </div>
        {kind === "staff" ? (
          <div className={css.cell}>
            {u.totp_enabled
              ? <span className={chipSmSuccess}>{L("2FA on", "2FA hidup")}</span>
              : <span className={chipSmWarn}>{L("No 2FA", "Tiada 2FA")}</span>}
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
        <select className={selectClassSm} value={sf} aria-label={L("Show", "Papar")} onChange={(e) => setSf(e.target.value as StaffFilter)}>
          <option value="all">{L("All accounts", "Semua akaun")}</option>
          <option value="active">{L("Active", "Aktif")}</option>
          <option value="disabled">{L("Disabled", "Dinyahaktif")}</option>
          <option value="no2fa">{L("Active without 2FA", "Aktif tanpa 2FA")}</option>
        </select>
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
  const tabs: readonly (readonly [UsersView, string])[] = [
    ["overview", L("Overview", "Gambaran")],
    ["staff", L("Staff Accounts", "Akaun kakitangan")],
    ["customers", L("Customers & Agents", "Pelanggan & Ejen")],
    ["roles", L("Roles & Permissions", "Peranan & kebenaran")],
    ["security", L("Security & Sessions", "Keselamatan & sesi")],
    /* v1.251.0 - the full audit trail, its own tab; Signatures & Stamps
       moved to Companies > Document & Signing (the owner, 02-11-2026) */
    ...(auditTab ? [["audit", L("Audit History", "Sejarah audit")] as const] : []),
  ];
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
  const policy = usePolicy(seenRoles, policyTick);
  const review = useReview(seenRoles && holds, reviewTick);
  const [ownerTick, setOwnerTick] = useState(0);

  const ownerState = useOwner(["ceo", "coo", "cco", "admin", "super_admin"].includes(role), ownerTick);
  const auditRead = ["ceo", "admin", "super_admin"].includes(role); // = PERMS.audit_read
  const geofence = holdsCap("geofence_admin", ["super_admin", "ceo", "coo"].includes(role));
  const adminDoor = ["super_admin", "admin"].includes(role);
  /* v1.252.1 (the owner, 02-11-2026: the Super Admin looked in /admin and
     could not find where to name the owner) - one Company owner zone, shown
     first in Security & Sessions while no owner is verified. */
  const ownerFirst = !ownerState?.d?.owner?.verified;
  const ownerZone = (
    <TabZone label={L("Company owner", "Pemilik syarikat")}>
      <div data-testid="owner-zone"><OwnerCard state={ownerState} onChanged={() => setOwnerTick((n) => n + 1)} /></div>
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

      <div hidden={view !== "overview"} className={css.body}>
        <UsersOverview rows={rows} events={events} loaded={loaded} eventsLoaded={eventsLoaded} open={openView} role={role} go={go} onAddUser={canInvite ? () => setInviteOpen(true) : undefined} />
      </div>

      <div hidden={view !== "staff"} className={css.body}>
        <TabZone label={L("Staff accounts", "Akaun kakitangan")}>
          <section className={`${card} ${css.outset}`}>
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="person" /></span>
                <div className={css.headText}>
                  <p className={css.title}>
                    {L("Staff accounts", "Akaun kakitangan")}{" "}
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
              <div className={css.quick}>
                {canInvite && <button type="button" className={btnClass} data-testid="add-user" onClick={() => setInviteOpen(true)}><AppIcon name="add" />{L("Add User", "Tambah Pengguna")}</button>}
                <button type="button" className={btnSm} onClick={() => openView("roles")}><AppIcon name="lock" />{L("Roles & permissions", "Peranan & kebenaran")}</button>
                {adminDoor && <Link className={btnSm} href="/admin"><AppIcon name="external" />{L("Passwords & deactivation", "Kata laluan & penyahaktifan")}</Link>}
              </div>
            </div>
            {toolbar(staffRows.length, allStaff.length, true)}
            <div className={css.table}>
              <div className={css.header} aria-hidden="true">
                <span>{L("Account", "Akaun")}</span><span>{L("Role", "Peranan")}</span><span>{L("Status", "Status")}</span><span>2FA</span><span>{canEdit ? L("Manage", "Urus") : ""}</span>
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

      <div hidden={view !== "customers"} className={css.body}>
        {/* v1.327.0 (the CEO's Users & Security brief) - the directory beside the chosen account:
            status, portal access and the authorised Grant / Revoke Agent Access (customers-agents.tsx).
            The same accounts, the same actions and the same gates as the list it replaces. */}
        <TabZone label={L("Customers & agents", "Pelanggan & ejen")}>
          <CustomersAgents accounts={allCustomers} loaded={loaded} busy={saving}
            canGrant={canEdit && (owner || superAdmin)} canRecover={recovery} canPromote={canEdit}
            editor={(u) => editId === u.id && canEdit ? <div className={`${css.detailEditor} erp-desktop-only`}>{roleFields(u)}</div> : null}
            onGrant={(u) => void grantAgent(u)} onRevoke={(u) => void revokeAgent(u)}
            onRecover={(id) => setCustSheetId(id)} onManage={(id) => setSheetId(id)}
            onPromote={(u) => { setEditId(u.id); setDraft({ role: "live_host", employment_status: "part_time" }); }}
            onAudit={auditTab ? (u) => { setAuditPerson({ id: u.id, name: properName(u.full_name || u.name) }); openView("audit"); } : undefined} />
        </TabZone>
      </div>

      <div hidden={view !== "roles"} className={css.body}>
        <div className={ap.pageHead}>
          <div>
            <h2 className={ap.title}>{L("Roles & Permissions", "Peranan & Kebenaran")}</h2>
            <p className={ap.sub}>{L("The single place to see what each role may do and see. Every action is enforced by the server on each request; hiding a tab is never a permission.", "Satu-satunya tempat untuk melihat apa yang setiap peranan boleh lakukan dan lihat. Setiap tindakan dikuatkuasa pelayan pada setiap permintaan; menyembunyikan tab bukan kebenaran.")}</p>
          </div>
          {holds && <button type="button" className={btnSm} onClick={() => { setReviewTick((n) => n + 1); setReviewOpen(true); }}><AppIcon name="verify" />{L("Access review", "Semakan akses")}</button>}
        </div>
        <div className={ap.summary}>
          <section className={`${card} ${ap.sumCard}`}><p className={ap.eyebrow}>{L("Access policy", "Polisi akses")}</p><p className={ap.sumTitle}>{L("One policy, enforced by the server", "Satu polisi, dikuatkuasa pelayan")}</p><p className={ap.sub}>{L("Role → module → action, checked on every request", "Peranan → modul → tindakan, disemak setiap permintaan")}</p></section>
          <section className={`${card} ${ap.sumCard}`}><p className={ap.eyebrow}>{L("Role assignments", "Penetapan peranan")}</p><p className={ap.sumTitle}>{L(`${allStaff.filter((u) => u.is_active).length} active staff accounts`, `${allStaff.filter((u) => u.is_active).length} akaun kakitangan aktif`)}</p><p className={ap.sub}>{Object.entries(headcount).map(([r, n]) => `${roleLabel(r)} ${n}`).join(" · ") || "—"}</p></section>
          <section className={`${card} ${ap.sumCard}`}><p className={ap.eyebrow}>{L("User exceptions", "Pengecualian pengguna")}</p><p className={ap.sumTitle}>{holds ? (review?.d ? L(`${review.d.exceptions.length} exception(s)`, `${review.d.exceptions.length} pengecualian`) : "…") : L("Kept by the CEO", "Disimpan oleh CEO")}</p><p className={ap.sub}>{holds && review?.d ? L(`${review.d.exceptions.filter((x) => x.needs_review || x.verdict === "hollow").length} to review`, `${review.d.exceptions.filter((x) => x.needs_review || x.verdict === "hollow").length} untuk disemak`) : L("Each with its reason and approver", "Setiap satu dengan sebab dan pelulusnya")}</p></section>
        </div>
        {/* v1.251.0 - ONE editor: the matrix shows, per module, whether each
            role sees the tab and what it may do; the tab rows are edited in
            "Who sees each tab" right under it (the same /staff/tabs/access
            route). One zone, not two matrices. */}
        <TabZone label={L("What each role may see and do", "Apa yang setiap peranan boleh lihat dan lakukan")}>
          <AccessPolicyCard policy={policy} onChanged={() => { setPolicyTick((n) => n + 1); setReviewTick((n) => n + 1); }} />
          <details className={css.seesEditor} data-testid="sees-editor">
            <summary>{L("Who sees each tab", "Siapa melihat setiap tab")}<span className={css.sub}>{holds ? L(" - open to change which roles see a tab", " - buka untuk menukar peranan yang melihat tab") : L(" - the CEO changes it", " - CEO menukarnya")}</span></summary>
            <TabAccessCard canEdit={holds} headcount={headcount} onSaved={() => setPolicyTick((n) => n + 1)} />
          </details>
        </TabZone>
        <TabZone label={L("Exceptions and accounts", "Pengecualian dan akaun")} cols={2}>
          {holds ? (
            <ExceptionsCard review={review} canEdit={holds} onChanged={() => setReviewTick((n) => n + 1)}
              people={allStaff.filter((u) => u.is_active && !["super_admin"].includes(u.role)).map((u) => ({ id: u.id, name: properName(u.full_name || u.name), role: u.role }))} />
          ) : (
            <section className={card}><p className={ap.title}>{L("Per-user exceptions", "Pengecualian setiap pengguna")}</p><p className={ap.sub}>{L("Kept by the CEO here, each with a reason and an approver. They hide a tab or show one the role can already read - never more.", "Disimpan oleh CEO di sini, setiap satu dengan sebab dan pelulus. Ia menyembunyikan tab atau memaparkan tab yang peranan sudah boleh baca - tidak lebih.")}</p></section>
          )}
          <section className={card}>
            <p className={ap.title}>{L("Manage user access", "Urus akses pengguna")}</p>
            <p className={ap.sub}>{L("Staff Accounts assigns each account its role. This tab shows what each role may do and see. A person's job title and reporting line live in Staff → Organisation, and never grant access.", "Akaun Kakitangan menetapkan peranan setiap akaun. Tab ini menunjukkan apa yang setiap peranan boleh lakukan dan lihat. Jawatan dan garis pelaporan seseorang berada di Kakitangan → Organisasi, dan tidak memberi akses.")}</p>
            <div className={ap.formRow}><button type="button" className={btnSm} onClick={() => setView("staff")}><AppIcon name="person" />{L("Open Staff Accounts", "Buka Akaun Kakitangan")}</button></div>
          </section>
        </TabZone>
        {holds && <AccessReviewDrawer open={reviewOpen} onClose={() => setReviewOpen(false)} review={review} />}
      </div>

      <div hidden={view !== "security"} className={css.body}>
        {/* v1.327.0 (the Security & Sessions picture) - one row of parts: the workspace (figure strip,
            Authentication Controls, Security Attention, the Sign-in Log, the principles) fills the screen;
            the company owner, the office location, problem reports and system health are each one press
            away, unchanged. Until an owner is verified the owner card still comes first (v1.252.1). */}
        <LineTabs value={secPart} onChange={setSecPart} label={L("Security parts", "Bahagian keselamatan")} testid="sec-part" tabs={secParts} />
        {secPart === "overview" && (
          <TabZone label={L("Security", "Keselamatan")}>
            <SecuritySessions staff={allStaff} loaded={loaded} events={events} eventsLoaded={eventsLoaded} canSettings={holds}
              onManage={recovery ? (id) => setSheetId(id) : undefined} onStaffAccounts={() => openView("staff")} onAudit={auditTab ? () => openView("audit") : undefined} />
          </TabZone>
        )}
        {secPart === "owner" && ownerState && ownerZone}
        {secPart === "location" && geofence && (
          <TabZone label={L("Office location", "Lokasi pejabat")}>
            <GeofenceCard />
          </TabZone>
        )}
        {/* v1.238.0 - who receives Report a problem, and the system's
            health (errors, backups, migrations) next to the audit trail */}
        {secPart === "reports" && holds && view === "security" && (
          <TabZone label={L("Problem reports", "Laporan masalah")}>
            <SupportCard />
          </TabZone>
        )}
        {secPart === "health" && auditRead && view === "security" && (
          <TabZone label={L("System health", "Kesihatan sistem")}>
            {/* v1.326.0 - the Dashboard's alert opens Security & Sessions AT this card (revealAnchor) */}
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
