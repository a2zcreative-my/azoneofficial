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
import { AccessReviewCard, GeofenceCard, TabAccessCard } from "@/components/portal/lazy-panels";
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

export function UsersPanel({ role, go }: { role: string; go?: (tab: TabName) => void }) {
  const [view, setView] = useState<UsersView>("overview");
  const [rows, setRows] = useState<Account[]>([]);
  const [msg, setMsg] = useState("");
  // v1.4.153: user log (recent sign-ins + account events) for monitoring
  const [events, setEvents] = useState<AuthEvent[]>([]);
  // v1.4.157 (CEO): role changes are SUPER_ADMIN ONLY - Google sign-ups
  // always land as customer, and keeping promotion out of every business
  // account (including the CEO's) means a breached sign-in can't escalate.
  const canEdit = role === "super_admin";
  const ROLE_OPTIONS = ["customer", "live_host", "editor", "marketing", "sales_marketing", "hr_admin", "cco", "coo", "ceo"];
  const EMP_OPTIONS = ["permanent", "contract", "part_time", "probation"];
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ role: string; employment_status: string }>({ role: "live_host", employment_status: "part_time" });
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
      if (r.ok && r.data) setRows((r.data.users ?? r.data.staff ?? []).filter((u) => !["super_admin", "admin"].includes(u.role)));
      else setMsg(L("Could not load user accounts — check access.", "Tidak dapat memuatkan akaun pengguna — semak akses."));
      setLoaded(true);
    });
    void api<{ events: AuthEvent[] }>(`/staff/users/activity`).then((r) => {
      if (r.ok && r.data) setEvents(r.data.events);
      setEventsLoaded(true);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(["users"], load);

  const saveRole = async (u: { id: number; name: string; email: string }) => {
    if (saving) return; // v1.137.0 - the button had no busy state and could be pressed twice
    setSaving(true);
    const res = await api<{ role?: string; employment_status?: string; error?: { message?: string } }>(
      `/staff/users/${u.id}/role`,
      { method: "POST", body: JSON.stringify({ role: draft.role, employment_status: draft.employment_status }) },
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
      <button type="button" className={`${btnClass} col-span-1 justify-center`} disabled={saving} onClick={() => void saveRole(u)}>
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
      {canEdit && (
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
  const holds = ["ceo", "super_admin"].includes(role); // Who sees what, and the matrix's editor
  const geofence = ["super_admin", "ceo", "coo"].includes(role);
  const adminDoor = ["super_admin", "admin"].includes(role);

  return (
    <TabPage className={css.page}>
      {toastNode}
      {/* v1.189.0 - the reference's underline tabs (gold rule under the open
          one); the shared LineTabs from v1.190.0, which Desk draws too */}
      <LineTabs value={view} onChange={setView} tabs={tabs} label={L("Users", "Pengguna")} />
      {msg && <p className="text-destructive mt-2 text-xs font-medium">{msg}</p>}

      <div hidden={view !== "overview"} className={css.body}>
        <UsersOverview rows={rows} events={events} loaded={loaded} eventsLoaded={eventsLoaded} open={setView} role={role} go={go} />
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
                    {canEdit
                      ? L("Change role sets the account's role and employment status — part-time staff are not OT-eligible. Passwords and deactivation stay in /admin.",
                          "Tukar peranan menetapkan peranan dan status pekerjaan akaun — kakitangan separuh masa tidak layak OT. Kata laluan dan penyahaktifan kekal di /admin.")
                      : L("Read-only here — role changes are made by the system super admin only, so no signed-in business account (or breached Google sign-in) can ever escalate a role.",
                          "Baca sahaja di sini — penukaran peranan dibuat oleh super admin sistem sahaja, jadi tiada akaun perniagaan yang log masuk (atau log masuk Google yang dicerobohi) boleh menaikkan peranan.")}
                  </p>
                </div>
              </div>
              <div className={css.quick}>
                <button type="button" className={btnSm} onClick={() => setView("roles")}><AppIcon name="lock" />{L("Roles & permissions", "Peranan & kebenaran")}</button>
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
        <TabZone label={L("Permission matrix", "Matriks kebenaran")}>
          <TabAccessCard canEdit={holds} headcount={headcount} />
        </TabZone>
      </div>

      <div hidden={view !== "security"} className={css.body}>
        <TabZone label={L("Sign-in log", "Log log masuk")}>
          <section className={card}>
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="access" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("User log — recent sign-ins & account events", "Log pengguna — log masuk & peristiwa akaun terkini")}</p>
                  <p className={css.sub}>
                    {L("Last 60 authentication events from the audit trail — sign-ins (password, 2FA, Google) and 2FA changes. The full audit lives in /admin.",
                       "60 peristiwa pengesahan terakhir daripada jejak audit — log masuk (kata laluan, 2FA, Google) dan perubahan 2FA. Audit penuh berada di /admin.")}
                  </p>
                </div>
              </div>
            </div>
            <div className={`${listBox} ${css.logBox} mt-3`}>
              {/* v1.137.0 - the skeleton is the shape of what arrives: these are
                  divided rows, not a table, and SkelTable drew three columns that
                  never appeared. */}
              {!eventsLoaded && <SkelRows rows={5} />}
              {eventsLoaded && events.length === 0 && (
                <p className={css.empty}>{L("No events recorded yet.", "Tiada peristiwa direkodkan lagi.")}</p>
              )}
              {eventsLoaded && events.length > 0 && (
                <ul className={css.list}>
                  {events.map((e, i) => (
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
        </TabZone>
        {(holds || geofence) && (
          <TabZone label={L("Access and locations", "Akses dan lokasi")} cols={2}>
            {holds && <AccessReviewCard />}
            {geofence && <GeofenceCard />}
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
