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
import { L } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { UsersOverview, type UsersView } from "@/components/portal/users-overview";
import { GeofenceCard, TabAccessCard } from "@/components/portal/lazy-panels";
import { AccessPolicyCard, AccessReviewDrawer, ExceptionsCard, usePolicy, useReview } from "@/components/portal/access-policy";
import { OwnerCard, useOwner } from "@/components/portal/owner-card";
import { AuditPanel } from "@/components/admin/audit-panel";
import { withStepUp } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import ap from "./access-policy.module.css";
import { Avatar } from "@/components/ui/avatar";
import { LineTabs } from "@/components/ui/line-tabs";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { firstName, properName } from "@/lib/names";
import {
  btnClass, btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn,
  fieldLabel, iconBtn, inputClassSm, listBox, selectClass, selectClassSm, sheetCard,
} from "@/lib/ui-styles";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import {
  eventLabel, eventTone, mytStamp2, roleLabel, statusLabel, type Account, type AuthEvent,
} from "@/components/portal/users-shared";
import type { TabName } from "@/lib/portal-tabs";
import css from "./users-panel.module.css";

export { mytStamp2 };

const EVENT_CHIP = { success: chipSmSuccess, info: chipSmInfo, warn: chipSmWarn, neutral: chipSmNeutral } as const;
type StaffFilter = "all" | "active" | "disabled" | "no2fa";

export function UsersPanel({ role, owner = false, go }: { role: string; owner?: boolean; go?: (tab: TabName) => void }) {
  const [view, setView] = useState<UsersView>("overview");
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
  const ROLE_OPTIONS = ["customer", "live_host", "editor", "marketing", "sales_marketing", "hr_admin", "cco", "coo", "admin", ...(superAdmin ? ["ceo"] : [])];
  const PRIVILEGED = ["customer", "cco", "coo", "admin", "ceo"];
  const { prompt, node: promptNode } = usePrompt();
  const EMP_OPTIONS = ["permanent", "contract", "part_time", "probation"];
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ role: string; employment_status: string; reason?: string }>({ role: "live_host", employment_status: "part_time" });
  const [saving, setSaving] = useState(false);
  /* v1.137.0 - one find box over both lists. The customer list is Google
     sign-ups and only grows; finding a person was scrolling. From v1.189.0
     each list is its own tab, and the box on either one is this one. */
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<StaffFilter>("all");
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
  const allStaff = rows.filter((u) => u.role !== "customer");
  const allCustomers = rows.filter((u) => u.role === "customer");
  const staffRows = allStaff.filter(match).filter(statusOk);
  const customerRows = allCustomers.filter(match);
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
            <span className={chipSmNeutral}>{L("No staff access", "Tiada akses kakitangan")}</span>
          </div>
        )}
      </div>
      {canEdit && (superAdmin || (u.role !== "ceo" && u.role !== "super_admin")) && (
        <div className={css.act}>
          <button type="button" className={iconBtn}
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
          </button>
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

  const tabs: readonly (readonly [UsersView, string])[] = [
    ["overview", L("Overview", "Gambaran")],
    ["staff", L("Staff Accounts", "Akaun kakitangan")],
    ["customers", L("Customer Accounts", "Akaun pelanggan")],
    ["roles", L("Roles & Permissions", "Peranan & kebenaran")],
    ["security", L("Security & Settings", "Keselamatan & tetapan")],
  ];
  const holds = ["ceo", "super_admin"].includes(role); // the exceptions and the matrix's editor (= TAB_ACCESS_EDITORS)
  const [reviewTick, setReviewTick] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [seenRoles, setSeenRoles] = useState(false);
  const openView = (v: UsersView) => { setView(v); if (v === "roles") setSeenRoles(true); };
  const policy = usePolicy(seenRoles);
  const review = useReview(seenRoles && holds, reviewTick);
  const [ownerTick, setOwnerTick] = useState(0);
  const ownerState = useOwner(["ceo", "coo", "cco", "admin", "super_admin"].includes(role), ownerTick);
  const auditRead = ["ceo", "admin", "super_admin"].includes(role); // = PERMS.audit_read
  /* the user log's filters (v1.234.0): the same 60 events, narrowed here */
  const [logWho, setLogWho] = useState("");
  const [logKind, setLogKind] = useState<"" | "signin" | "twofa" | "other">("");
  const shownEvents = events.filter((e) => (!logWho || e.email === logWho)
    && (!logKind || (logKind === "signin" ? /^auth\.login/.test(e.action) : logKind === "twofa" ? /2fa/.test(e.action) && !/^auth\.login/.test(e.action) : !/^auth\.login|2fa/.test(e.action))));
  const geofence = ["super_admin", "ceo", "coo"].includes(role);
  const adminDoor = ["super_admin", "admin"].includes(role);

  return (
    <TabPage className={css.page}>
      {toastNode}{promptNode}
      {/* v1.189.0 - the reference's underline tabs (gold rule under the open
          one); the shared LineTabs from v1.190.0, which Desk draws too */}
      <LineTabs value={view} onChange={openView} tabs={tabs} label={L("Users", "Pengguna")} />
      {msg && <p className="text-destructive mt-2 text-xs font-medium">{msg}</p>}

      <div hidden={view !== "overview"} className={css.body}>
        <UsersOverview rows={rows} events={events} loaded={loaded} eventsLoaded={eventsLoaded} open={openView} role={role} go={go} />
      </div>

      <div hidden={view !== "staff"} className={css.body}>
        <TabZone label={L("Staff accounts", "Akaun kakitangan")}>
          <section className={card}>
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="person" /></span>
                <div className={css.headText}>
                  <p className={css.title}>
                    {L("Staff accounts", "Akaun kakitangan")}{" "}
                    <span className={css.sub}>{countOf(staffRows.length, allStaff.length)}</span>
                  </p>
                  <p className={css.sub}>
                    {owner && !superAdmin
                      ? L("As the company owner you change any staff role here - executive, customer and Admin changes ask for a reason and your authenticator code. The CEO role and super admin accounts stay with the super admin.",
                          "Sebagai pemilik syarikat anda menukar sebarang peranan kakitangan di sini - perubahan eksekutif, pelanggan dan Admin memerlukan sebab dan kod pengesah anda. Peranan CEO dan akaun super admin kekal dengan super admin.")
                      : canEdit
                      ? L("Change role sets the account's role and employment status — part-time staff are not OT-eligible. Passwords and deactivation stay in /admin.",
                          "Tukar peranan menetapkan peranan dan status pekerjaan akaun — kakitangan separuh masa tidak layak OT. Kata laluan dan penyahaktifan kekal di /admin.")
                      : L("Read-only here — role changes are made by the system super admin only, so no signed-in business account (or breached Google sign-in) can ever escalate a role.",
                          "Baca sahaja di sini — penukaran peranan dibuat oleh super admin sistem sahaja, jadi tiada akaun perniagaan yang log masuk (atau log masuk Google yang dicerobohi) boleh menaikkan peranan.")}
                  </p>
                </div>
              </div>
              <div className={css.quick}>
                <button type="button" className={btnSm} onClick={() => openView("roles")}><AppIcon name="lock" />{L("Roles & permissions", "Peranan & kebenaran")}</button>
                {adminDoor && <Link className={btnSm} href="/admin"><AppIcon name="external" />{L("Passwords & deactivation", "Kata laluan & penyahaktifan")}</Link>}
              </div>
            </div>
            {toolbar(staffRows.length, allStaff.length, true)}
            <div className={css.table}>
              <div className={css.header} aria-hidden="true">
                <span>{L("Account", "Akaun")}</span><span>{L("Role", "Peranan")}</span><span>{L("Status", "Status")}</span><span>2FA</span><span>{canEdit ? L("Manage", "Urus") : ""}</span>
              </div>
              <ul className={`${css.list} ${css.scroll}`}>
                {/* v1.77.0 - skeleton until the first fetch lands. */}
                {!loaded && <li><SkelRows rows={6} className="px-3" /></li>}
                {loaded && staffRows.length === 0 && (
                  <li className={css.empty}>
                    {allStaff.length === 0
                      ? L("No staff accounts yet.", "Tiada akaun kakitangan lagi.")
                      : L("No staff account matches that.", "Tiada akaun kakitangan yang sepadan.")}
                  </li>
                )}
                {loaded && staffRows.map((u) => accountRow(u, "staff"))}
              </ul>
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
        {/* v1.4.156: Google sign-ups land here as customers - the CEO promotes
            them into part-time roles (e.g. part-time live host) from this list. */}
        <TabZone label={L("Customer accounts", "Akaun pelanggan")}>
          <section className={card}>
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="cart" /></span>
                <div className={css.headText}>
                  <p className={css.title}>
                    {L("Customer accounts — Google & self sign-ups", "Akaun pelanggan — Google & daftar sendiri")}{" "}
                    <span className={css.sub}>{countOf(customerRows.length, allCustomers.length)}</span>
                  </p>
                  <p className={css.sub}>
                    {canEdit
                      ? L("Promote here when someone joins — personal emails hold part-time roles only.",
                          "Naik taraf di sini apabila seseorang menyertai — e-mel peribadi memegang peranan separuh masa sahaja.")
                      : L("Sign-ups land here with zero staff access — promotions by the super admin only.",
                          "Pendaftaran mendarat di sini tanpa akses kakitangan — naik taraf oleh super admin sahaja.")}
                  </p>
                </div>
              </div>
            </div>
            {toolbar(customerRows.length, allCustomers.length, false)}
            <div className={css.table}>
              <div className={`${css.header} ${css.rowCust}`} aria-hidden="true">
                <span>{L("Account", "Akaun")}</span><span>{L("Status", "Status")}</span><span>{L("Access", "Akses")}</span><span>{canEdit ? L("Manage", "Urus") : ""}</span>
              </div>
              <ul className={`${css.list} ${css.scroll}`}>
                {/* v1.77.0 - skeleton until the first fetch lands. */}
                {!loaded && <li><SkelRows rows={4} className="px-3" /></li>}
                {loaded && customerRows.length === 0 && (
                  <li className={css.empty}>
                    {allCustomers.length === 0
                      ? L("No customer accounts yet.", "Tiada akaun pelanggan lagi.")
                      : L("No customer account matches that.", "Tiada akaun pelanggan yang sepadan.")}
                  </li>
                )}
                {loaded && customerRows.map((u) => accountRow(u, "customer"))}
              </ul>
            </div>
          </section>
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
        <TabZone label={L("What each role may do", "Apa yang setiap peranan boleh lakukan")}>
          <AccessPolicyCard policy={policy} />
        </TabZone>
        <TabZone label={L("What each role sees", "Apa yang setiap peranan lihat")}>
          <TabAccessCard canEdit={holds} headcount={headcount} />
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
        <div className={ap.pageHead}>
          <div>
            <h2 className={ap.title}>{L("Security & Settings", "Keselamatan & Tetapan")}</h2>
            <p className={ap.sub}>{L("Sign-in protection, session oversight and the authentication audit - module access lives in Roles & Permissions.", "Perlindungan log masuk, pengawasan sesi dan audit pengesahan - akses modul berada di Peranan & Kebenaran.")}</p>
          </div>
        </div>
        <div className={ap.summary}>
          <section className={`${card} ${ap.sumCard}`}><p className={ap.eyebrow}>{L("Authentication", "Pengesahan")}</p><p className={ap.sumTitle}>{L("Password · Google · 2FA", "Kata laluan · Google · 2FA")}</p><p className={ap.sub}>{L("2FA is required for every staff role before anything opens", "2FA diwajibkan untuk setiap peranan kakitangan sebelum apa-apa dibuka")}</p></section>
          <section className={`${card} ${ap.sumCard}`}><p className={ap.eyebrow}>{L("Session security", "Keselamatan sesi")}</p><p className={ap.sumTitle}>{L("Sign out everywhere", "Log keluar di semua tempat")}</p><p className={ap.sub}>{L("Each person in Profile → Security; an admin revokes a leaver's sessions in /admin", "Setiap orang di Profil → Keselamatan; admin membatalkan sesi bekas staf di /admin")}</p></section>
          <section className={`${card} ${ap.sumCard}`}><p className={ap.eyebrow}>{L("Security audit", "Audit keselamatan")}</p><p className={ap.sumTitle}>{L("One log source", "Satu sumber log")}</p><p className={ap.sub}>{L("The audit trail every module writes - read-only", "Jejak audit yang ditulis setiap modul - baca sahaja")}</p></section>
        </div>
        <TabZone label={L("Sign-in log", "Log log masuk")} cols={2}>
          <section className={card}>
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="access" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("User log — recent sign-ins & account events", "Log pengguna — log masuk & peristiwa akaun terkini")}</p>
                  <p className={css.sub}>
                    {auditRead
                      ? L("Last 60 authentication events from the audit trail — sign-ins (password, 2FA, Google) and 2FA changes. The full audit log is below.",
                          "60 peristiwa pengesahan terakhir daripada jejak audit — log masuk (kata laluan, 2FA, Google) dan perubahan 2FA. Log audit penuh di bawah.")
                      : L("Last 60 authentication events from the audit trail — sign-ins (password, 2FA, Google) and 2FA changes.",
                          "60 peristiwa pengesahan terakhir daripada jejak audit — log masuk (kata laluan, 2FA, Google) dan perubahan 2FA.")}
                  </p>
                </div>
              </div>
            </div>
            <div className={ap.filters}>
              <select className={selectClassSm} aria-label={L("Filter by account", "Tapis mengikut akaun")} value={logWho} onChange={(e) => setLogWho(e.target.value)}>
                <option value="">{L("Every account", "Semua akaun")}</option>
                {[...new Set(events.map((e) => e.email ?? ""))].filter(Boolean).map((em) => <option key={em} value={em}>{em}</option>)}
              </select>
              <select className={selectClassSm} aria-label={L("Event type", "Jenis peristiwa")} value={logKind} onChange={(e) => setLogKind(e.target.value as typeof logKind)}>
                <option value="">{L("Event type: all", "Jenis peristiwa: semua")}</option>
                <option value="signin">{L("Sign-ins", "Log masuk")}</option>
                <option value="twofa">{L("2FA changes and checks", "Perubahan dan semakan 2FA")}</option>
                <option value="other">{L("Other account events", "Peristiwa akaun lain")}</option>
              </select>
            </div>
            <div className={`${listBox} ${css.logBox} mt-3`}>
              {/* v1.137.0 - the skeleton is the shape of what arrives: these are
                  divided rows, not a table, and SkelTable drew three columns that
                  never appeared. */}
              {!eventsLoaded && <SkelRows rows={5} />}
              {eventsLoaded && shownEvents.length === 0 && (
                <p className={css.empty}>{L("No events recorded yet.", "Tiada peristiwa direkodkan lagi.")}</p>
              )}
              {eventsLoaded && shownEvents.length > 0 && (
                <ul className={css.list}>
                  {shownEvents.map((e, i) => (
                    /* v1.137.0 - on a phone the identity took what was left of the
                       line after a chip and a timestamp, which was "Nurul Ai...". It
                       gets the line to itself below sm:, and shares one from sm: up. */
                    <li key={i} className={css.feedRow}>
                      <div className={css.who}>
                        <span className={css.name}>{properName(e.name ?? "")}</span>
                        <span className={css.email}>{e.email ?? ""}</span>
                      </div>
                      <div className={css.feedMeta}>
                        <span className={EVENT_CHIP[eventTone(e.action)]}>{eventLabel(e.action)}</span>
                        <span>{mytStamp2(e.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <section className={card} aria-label={L("Authentication controls", "Kawalan pengesahan")}>
            <p className={ap.title}>{L("Authentication controls", "Kawalan pengesahan")}</p>
            <ul className={ap.controls}>
              <li><span className={ap.main}><strong>{L("Two-factor authentication", "Pengesahan dua faktor")}</strong><span>{L("Required for every staff role; enrolment is the only thing open until it is on", "Diwajibkan untuk setiap peranan kakitangan; hanya pendaftaran dibuka sehingga ia dihidupkan")}</span></span>
                {(() => { const n = allStaff.filter((u) => u.is_active && !u.totp_enabled).length; return <span className={n ? chipSmWarn : chipSmSuccess}>{n ? L(`${n} without 2FA`, `${n} tanpa 2FA`) : L("All on", "Semua aktif")}</span>; })()}</li>
              <li><span className={ap.main}><strong>{L("Active sessions", "Sesi aktif")}</strong><span>{L("Sign out everywhere (Profile → Security); revoke a leaver's sessions in /admin. No per-device list is kept.", "Log keluar di semua tempat (Profil → Keselamatan); batalkan sesi bekas staf di /admin. Tiada senarai setiap peranti disimpan.")}</span></span>
                {adminDoor ? <Link className={btnSm} href="/admin">{L("Open /admin", "Buka /admin")}</Link> : <span className={chipSmNeutral}>{L("Per person", "Setiap orang")}</span>}</li>
              <li><span className={ap.main}><strong>{L("Security alerts", "Amaran keselamatan")}</strong><span>{L("2FA changes and backup-code use in the last 60 events", "Perubahan 2FA dan penggunaan kod sandaran dalam 60 peristiwa terakhir")}</span></span>
                {(() => { const n = events.filter((e) => eventTone(e.action) === "warn").length; return <span className={n ? chipSmWarn : chipSmNeutral}>{n ? L(`${n} to review`, `${n} untuk disemak`) : L("None", "Tiada")}</span>; })()}</li>
            </ul>
            <ul className={ap.ownership} aria-label={L("Who owns what", "Siapa memiliki apa")}>
              <li><strong>{L("Module access", "Akses modul")}</strong> → {L("Roles & Permissions", "Peranan & Kebenaran")}</li>
              <li><strong>{L("Office geofence", "Geofence pejabat")}</strong> → {L("Security & Settings (below)", "Keselamatan & Tetapan (di bawah)")}</li>
              <li><strong>{L("Sign-in & 2FA logs", "Log log masuk & 2FA")}</strong> → {L("Security & Settings", "Keselamatan & Tetapan")}</li>
            </ul>
          </section>
        </TabZone>
        {ownerState && (
          <TabZone label={L("Company owner", "Pemilik syarikat")}>
            <OwnerCard state={ownerState} onChanged={() => setOwnerTick((n) => n + 1)} />
          </TabZone>
        )}
        {geofence && (
          <TabZone label={L("Office location", "Lokasi pejabat")}>
            <GeofenceCard />
          </TabZone>
        )}
        {auditRead && view === "security" && (
          <TabZone label={L("Audit log", "Log audit")}>
            <section className={card} aria-label={L("Full audit log", "Log audit penuh")}><AuditPanel /></section>
          </TabZone>
        )}
      </div>

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
