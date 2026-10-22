"use client";

/* v1.189.0 - THE USERS OVERVIEW, laid out as the owner's reference
   (22-10-2026: "follow the photo exactly as it is"):

     five tiles      Total · Active · Inactive · Staff · Customer accounts,
                     the two shares with a bar under them
     left column     Recent Login Activity (a table) and Access Control
                     Overview (a module, how many people open it, which roles)
     right column    Account Summary (four doors) and Pending / Attention
     last row        Quick Actions

   Every figure is read from a GET the Users roles can already call, through
   the same cache the rest of the portal uses: the panel's own /staff/users
   and /staff/users/activity (handed in), /staff/tabs/access (the overrides
   every signed-in person reads to build their own tab strip),
   /staff/attendance/geofence (configured or not - open to every role),
   /staff/dashboard/attendance-today and /staff/attendance/monitor (exec_view
   / hr_manage, which every Users role holds) and /staff/leave/month (open,
   v1.184.0). Nothing is written from here, no API changed, and nothing
   sensitive is shown: the reference's IP-address column is a Method column
   here, because the sign-in log does not carry an address and adding one is
   an API change; no password, token or secret is read at all.

   Pending / Attention is facts, not new rules: a late first clock-in today
   (the 10:00 cutoff the donut uses), a clock-out still missing after 18:00
   (the monitor's own rule), a leave application waiting, and the account
   facts - active after leaving, 2FA switched off, active without 2FA. */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { L } from "@/components/portal/page-shared";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { TAB_ICON } from "@/components/layout/nav-icons";
import { useCachedApi } from "@/lib/cached-api";
import { properName } from "@/lib/names";
import { ASSIGNABLE_ROLES, canSeeTab, type TabName } from "@/lib/portal-tabs";
import { btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import { eventLabel, isSignIn, mytStamp2, roleLabel, type Account, type AuthEvent } from "@/components/portal/users-shared";
import type { AttendanceMonitor } from "@/components/portal/attendance";
import css from "./users-panel.module.css";

export type UsersView = "overview" | "staff" | "customers" | "roles" | "security";

/** one named person from an event row (the audit join can leave the name empty) */
const who = (e: AuthEvent) => properName(e.name ?? "") || e.email || "-";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** a stored UTC stamp (or a plain YYYY-MM-DD date) -> "22 Oct", in MYT */
const shortDay = (stamp: string, utc = true) => {
  const d = utc
    ? new Date(new Date(stamp.replace(" ", "T") + (stamp.includes("Z") ? "" : "Z")).getTime() + 8 * 3600 * 1000)
    : new Date(`${stamp.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? stamp.slice(0, 10) : `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
const minutesAfter = (hhmm: string, cutoff: string) => {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return Math.max(0, m(hhmm) - m(cutoff));
};
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min} mins`);

/* The access-control rows the reference lists: a module, or two that are one
   job, and the tabs behind it. "Users with access" counts the active staff
   whose role opens ANY of those tabs (the same canSeeTab() the tab strip is
   drawn with); Details names those roles. */
const MODULES: { label: [string, string]; tabs: TabName[]; glyph: string }[] = [
  { label: ["Dashboard", "Papan pemuka"], tabs: ["Dashboard"], glyph: "Dashboard" },
  { label: ["Ecommerce", "E-dagang"], tabs: ["Ecommerce"], glyph: "Ecommerce" },
  { label: ["Sales", "Jualan"], tabs: ["Sales"], glyph: "Sales" },
  { label: ["Inventory", "Inventori"], tabs: ["Inventory"], glyph: "Inventory" },
  { label: ["HR & Attendance", "HR & Kehadiran"], tabs: ["HR", "Attendance"], glyph: "HR" },
  { label: ["Finance & Payroll", "Kewangan & Gaji"], tabs: ["Finance", "Payroll", "Accounting"], glyph: "Payroll" },
  { label: ["Assets & Hotels", "Aset & Hotel"], tabs: ["Assets", "Hotels"], glyph: "Assets" },
  { label: ["ELFIA (Store & Traffic)", "ELFIA (Kedai & Trafik)"], tabs: ["ELFIA Store", "ELFIA Traffic"], glyph: "ELFIA Store" },
  { label: ["Settings & Users", "Tetapan & Pengguna"], tabs: ["Users"], glyph: "Users" },
];

/* the role names short enough for one line of Details (the full names are
   the row's tooltip and the Roles & Permissions matrix) */
const SHORT: Record<string, string> = {
  admin: "Admin", ceo: "CEO", coo: "COO", cco: "CCO", hr_admin: "HR",
  sales_marketing: "Sales", marketing: "Marketing", editor: "Editor", live_host: "Live host",
};

type Tone = "gold" | "green" | "red" | "blue" | "purple" | "navy";
type Attention = { key: string; name: string; photo?: string | null; what: string; day: string; chip: string; tone: "danger" | "warn" | "info" | "neutral" };
const CHIP = { danger: chipSmDanger, warn: chipSmWarn, info: chipSmInfo, neutral: chipSmNeutral } as const;
type LeaveRow = { id: number; user_id: number; name: string; photo_key?: string | null; type: string; status: string; created_at?: string | null; start_date: string };

export function UsersOverview({ rows, events, loaded, eventsLoaded, open, role, go }: {
  rows: Account[]; events: AuthEvent[]; loaded: boolean; eventsLoaded: boolean;
  open: (v: UsersView) => void; role: string;
  /** the portal's tab switch, for the action whose home is another tab */
  go?: (tab: TabName) => void;
}) {
  const people = ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"].includes(role); // hr_manage or exec_view
  const access = useCachedApi<{ overrides?: Record<string, string[]> }>("/staff/tabs/access");
  const fence = useCachedApi<{ configured?: boolean }>("/staff/attendance/geofence");
  const today = useCachedApi<{ cutoff?: string; late?: { id: number; name: string; first_in: string }[] }>(people ? "/staff/dashboard/attendance-today" : null);
  const monitor = useCachedApi<AttendanceMonitor>(people ? "/staff/attendance/monitor" : null);
  const leave = useCachedApi<{ leave?: LeaveRow[] }>("/staff/leave/month");

  const staff = rows.filter((u) => u.role !== "customer");
  const customers = rows.filter((u) => u.role === "customer");
  const active = rows.filter((u) => u.is_active).length;
  const inactive = rows.length - active;
  const share = (n: number) => (rows.length > 0 ? Math.round((n / rows.length) * 100) : 0);
  const byId = new Map(rows.map((u) => [u.id, u]));
  const byEmail = new Map(rows.map((u) => [u.email.toLowerCase(), u]));

  /* ---- Pending / Attention ---- */
  const items: Attention[] = [];
  /* the clock is read once when the page opens (render must stay pure) */
  const [openedAt] = useState(() => Date.now());
  const nowMYT = new Date(openedAt + 8 * 3600 * 1000);
  const todayLabel = `${nowMYT.getUTCDate()} ${MON[nowMYT.getUTCMonth()]}`;
  if (monitor.data && nowMYT.getUTCHours() >= 18) {
    for (const s of monitor.data.staff) {
      const stillIn = s.last_type ? s.last_type === "clock_in" : Boolean(s.in_at && !s.out_at);
      if (stillIn) items.push({ key: `out-${s.id}`, name: properName(s.name), photo: byId.get(s.id)?.photo_key, what: L("No clock-out record", "Tiada rekod daftar keluar"), day: todayLabel, chip: L("Missing out", "Tiada keluar"), tone: "danger" });
    }
  }
  const cutoff = today.data?.cutoff ?? "10:00";
  for (const p of today.data?.late ?? []) {
    const late = dur(minutesAfter(p.first_in, cutoff));
    items.push({ key: `late-${p.id}`, name: properName(p.name), photo: byId.get(p.id)?.photo_key, what: L(`Late arrival (${late})`, `Lewat tiba (${late})`), day: todayLabel, chip: L("Late", "Lewat"), tone: "warn" });
  }
  for (const l of (leave.data?.leave ?? []).filter((x) => x.status === "pending")) {
    items.push({ key: `leave-${l.id}`, name: properName(l.name), photo: l.photo_key ?? byId.get(l.user_id)?.photo_key, what: L("Leave application pending", "Permohonan cuti menunggu"), day: l.created_at ? shortDay(l.created_at) : shortDay(l.start_date, false), chip: L("Pending", "Menunggu"), tone: "info" });
  }
  for (const u of staff.filter((x) => x.is_active && x.left_on && !x.rejoined_on)) {
    items.push({ key: `left-${u.id}`, name: properName(u.full_name || u.name), photo: u.photo_key, what: L("Account still active after leaving", "Akaun masih aktif selepas berhenti"), day: shortDay(u.left_on ?? "", false), chip: L("Still active", "Masih aktif"), tone: "danger" });
  }
  for (const e of events.filter((x) => x.action.includes("2fa_disabled")).slice(0, 3)) {
    items.push({ key: `off-${e.created_at}-${e.email ?? ""}`, name: who(e), photo: e.email ? byEmail.get(e.email.toLowerCase())?.photo_key : null, what: L("Two-factor sign-in switched off", "Log masuk dua faktor dimatikan"), day: shortDay(e.created_at), chip: L("2FA off", "2FA mati"), tone: "warn" });
  }
  for (const u of staff.filter((x) => x.is_active && !x.totp_enabled)) {
    items.push({ key: `2fa-${u.id}`, name: properName(u.full_name || u.name), photo: u.photo_key, what: L("Active account without 2FA", "Akaun aktif tanpa 2FA"), day: "", chip: L("No 2FA", "Tiada 2FA"), tone: "neutral" });
  }
  const attentionBusy = !loaded || (people && (today.loading || monitor.loading)) || leave.loading;

  /* ---- Access Control Overview ---- */
  const overrides = access.data?.overrides ?? {};
  const activeStaff = staff.filter((u) => u.is_active);
  const moduleRows = MODULES.map((m) => {
    const opens = (r: string) => m.tabs.some((t) => canSeeTab(r, t, overrides));
    const roles = ASSIGNABLE_ROLES.map(([r]) => r).filter(opens);
    return {
      ...m,
      count: activeStaff.filter((u) => opens(u.role)).length,
      details: roles.length === ASSIGNABLE_ROLES.length
        ? L("All staff", "Semua kakitangan")
        : roles.map((r) => SHORT[r] ?? roleLabel(r)).join(", ") || L("Super admin only", "Super admin sahaja"),
      full: roles.map(roleLabel).join(", "),
    };
  });

  const signIns = events.filter((e) => isSignIn(e.action)).slice(0, 5);
  const canAddStaff = ["super_admin", "admin", "ceo"].includes(role); // the Staff tab's Add staff (not read-only there)
  const adminDoor = ["super_admin", "admin"].includes(role); // /admin is where a customer account is created
  const geofenceRole = ["super_admin", "ceo", "coo"].includes(role);

  const kpi = (icon: AppIconName, tone: Tone, label: string, value: number, sub: ReactNode, bar?: { pct: number; tone: "green" | "red" }) => (
    <div className={`${card} ${css.kpi}`}>
      <span className={`${css.kpiIcon} ${css[tone]}`}><AppIcon name={icon} /></span>
      <div className={css.kpiBody}>
        <p className={css.kpiLabel}>{label}</p>
        <p className={css.kpiValue} aria-busy={!loaded}>{loaded ? value : "–"}</p>
        <p className={css.kpiSub}>{sub}</p>
        {bar && loaded && (
          <span className={css.bar} role="img" aria-label={`${bar.pct}%`}>
            <span className={`${css.barFill} ${bar.tone === "green" ? css.barGreen : css.barRed}`} style={{ width: `${bar.pct}%` }} />
          </span>
        )}
      </div>
    </div>
  );

  const door = (icon: AppIconName, tone: Tone, title: string, strong: ReactNode, sub: string, onClick: () => void) => (
    <button type="button" className={css.sumRow} onClick={onClick}>
      <span className={`${css.sumIcon} ${css[tone]}`}><AppIcon name={icon} /></span>
      <span className={css.sumText}>
        <span className={css.sumTitle}>{title}</span>
        <span className={css.sumStrong}>{strong}</span>
        <span className={css.sumSub}>{sub}</span>
      </span>
      <span className={css.sumChevron}><AppIcon name="next" /></span>
    </button>
  );

  return (
    <div className={css.ov}>
      <div className={css.kpis}>
        {kpi("users", "gold", L("Total Accounts", "Jumlah Akaun"), rows.length, L(`${staff.length} staff + ${customers.length} customer`, `${staff.length} kakitangan + ${customers.length} pelanggan`))}
        {kpi("success", "green", L("Active Accounts", "Akaun Aktif"), active,
          <span className={css.up}>▲ {L(`${share(active)}% active`, `${share(active)}% aktif`)}</span>, { pct: share(active), tone: "green" })}
        {kpi("blocked", "red", L("Inactive Accounts", "Akaun Tidak Aktif"), inactive,
          <span className={css.down}>▼ {L(`${share(inactive)}% inactive`, `${share(inactive)}% tidak aktif`)}</span>, { pct: share(inactive), tone: "red" })}
        {kpi("person", "blue", L("Staff Accounts", "Akaun Kakitangan"), staff.length, L("Internal team members", "Ahli pasukan dalaman"))}
        {kpi("cart", "purple", L("Customer Accounts", "Akaun Pelanggan"), customers.length, L("Google & self sign-up", "Google & daftar sendiri"))}
      </div>

      <div className={css.ovGrid}>
        <div className={css.ovCol}>
          {/* ---- Recent Login Activity ---- */}
          <section className={card}>
            <div className={css.cardHead}>
              <div className={css.cardLead}>
                <span className={css.headGlyph}><AppIcon name="access" /></span>
                <div>
                  <p className={css.cardTitle}>{L("Recent Login Activity", "Aktiviti Log Masuk Terkini")}</p>
                  <p className={css.cardSub}>{L("Latest login activities across staff and customer accounts.", "Aktiviti log masuk terkini merentas akaun kakitangan dan pelanggan.")}</p>
                </div>
              </div>
              <button type="button" className={btnSm} onClick={() => open("security")}>{L("View all logs", "Lihat semua log")}</button>
            </div>
            <div className={css.gTable}>
              <div className={`${css.gHead} ${css.loginCols}`} aria-hidden="true">
                <span>{L("User", "Pengguna")}</span><span>{L("Email", "E-mel")}</span><span>{L("Login time", "Masa log masuk")}</span><span>{L("Method", "Kaedah")}</span><span>{L("Status", "Status")}</span>
              </div>
              {!eventsLoaded && <SkelRows rows={5} />}
              {eventsLoaded && signIns.length === 0 && <p className={css.empty}>{L("No sign-ins recorded yet.", "Tiada log masuk direkodkan lagi.")}</p>}
              {eventsLoaded && signIns.map((e, i) => {
                const acct = e.email ? byEmail.get(e.email.toLowerCase()) : undefined;
                const name = acct?.role === "customer" ? L(`Customer (${who(e)})`, `Pelanggan (${who(e)})`) : who(e);
                return (
                  <div key={i} className={`${css.gRow} ${css.loginCols}`}>
                    <span className={css.gUser}><Avatar name={who(e)} photoKey={acct?.photo_key} size="sm" /><span className={css.gName}>{name}</span></span>
                    <span className={css.gEmail}>{e.email ?? ""}</span>
                    <span className={css.gMuted}>{mytStamp2(e.created_at).replace(" MYT", "")}</span>
                    <span className={css.gMuted}>{eventLabel(e.action)}</span>
                    <span><span className={chipSmSuccess}>{L("Success", "Berjaya")}</span></span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- Access Control Overview ---- */}
          <section className={card}>
            <div className={css.cardHead}>
              <div className={css.cardLead}>
                <span className={`${css.headWell} ${css.gold}`}><AppIcon name="lock" /></span>
                <div>
                  <p className={css.cardTitle}>{L("Access Control Overview", "Gambaran Kawalan Akses")}</p>
                  <p className={css.cardSub}>{L("Quick view of system modules and who can access them.", "Paparan pantas modul sistem dan siapa yang boleh mengaksesnya.")}</p>
                </div>
              </div>
              <button type="button" className={btnSm} onClick={() => open("roles")}>{L("View permissions", "Lihat kebenaran")}</button>
            </div>
            <div className={css.gTable}>
              <div className={`${css.gHead} ${css.accessCols}`} aria-hidden="true">
                <span>{L("Module", "Modul")}</span><span>{L("Users with access", "Pengguna dengan akses")}</span><span>{L("Details", "Butiran")}</span>
              </div>
              {!loaded || access.loading ? <SkelRows rows={6} /> : moduleRows.map((m) => {
                const Icon = TAB_ICON[m.glyph];
                return (
                  <div key={m.label[0]} className={`${css.gRow} ${css.accessCols}`}>
                    <span className={css.gUser}>{Icon && <Icon className={css.modIcon} aria-hidden />}<span className={css.gName}>{L(m.label[0], m.label[1])}</span></span>
                    <span className={css.gCount}>{L(`${m.count} user${m.count === 1 ? "" : "s"}`, `${m.count} pengguna`)}</span>
                    <span className={`${css.gMuted} ${css.gEmail}`} title={m.full}>{m.details}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className={css.ovCol}>
          {/* ---- Account Summary ---- */}
          <section className={card}>
            <p className={css.cardTitle}>{L("Account Summary", "Ringkasan Akaun")}</p>
            <div className={css.sumList}>
              {door("users", "gold", L("Staff Accounts", "Akaun Kakitangan"), L(`${staff.length} accounts`, `${staff.length} akaun`), L("Internal team members with system access", "Ahli pasukan dalaman dengan akses sistem"), () => open("staff"))}
              {door("person", "blue", L("Customer Accounts", "Akaun Pelanggan"), L(`${customers.length} accounts`, `${customers.length} akaun`), L("Google & self sign-up accounts", "Akaun Google & daftar sendiri"), () => open("customers"))}
              {door("access", "navy", L("Login & Security", "Log Masuk & Keselamatan"), L("View logs", "Lihat log"), L("Monitor login activities and security events", "Pantau aktiviti log masuk dan peristiwa keselamatan"), () => open("security"))}
              {door("place", "red", L("Office Check-in", "Daftar Masuk Pejabat"),
                fence.loading ? "…" : fence.data?.configured ? L("Configured", "Dikonfigurasi") : L("Not set", "Belum ditetapkan"),
                L("Geofence location for staff check-in", "Lokasi geopagar untuk daftar masuk kakitangan"), () => open("security"))}
            </div>
          </section>

          {/* ---- Pending / Attention ---- */}
          <section className={card}>
            <div className={css.cardLead}>
              <span className={css.warnGlyph}><AppIcon name="warning" /></span>
              <p className={css.cardTitle}>{L("Pending / Attention", "Menunggu / Perhatian")}</p>
            </div>
            {attentionBusy ? <SkelRows rows={4} /> : items.length === 0 ? (
              <p className={css.empty}>{L("Nothing needs attention right now.", "Tiada apa yang perlu perhatian sekarang.")}</p>
            ) : (
              <ul className={css.attn}>
                {items.map((it) => (
                  <li key={it.key} className={css.attnRow}>
                    <Avatar name={it.name} photoKey={it.photo} size="sm" />
                    <span className={css.attnText}>
                      <span className={css.gName}>{it.name}</span>
                      <span className={css.gMuted}>{it.what}</span>
                    </span>
                    <span className={css.attnDay}>{it.day}</span>
                    <span className={css.attnChip}><span className={CHIP[it.tone]}>{it.chip}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ---- Quick Actions: each one only where it works for this role ---- */}
      <section className={`${card} ${css.quickBar}`}>
        <div className={css.cardLead}>
          <span className={css.warnGlyph}><AppIcon name="fast" /></span>
          <p className={css.cardTitle}>{L("Quick Actions", "Tindakan Pantas")}</p>
        </div>
        <div className={css.quickList}>
          {canAddStaff && go && (
            <button type="button" className={css.qa} onClick={() => go("Staff Details")}
              title={L("Opens the Staff tab, where Add staff creates the account", "Membuka tab Kakitangan, tempat Tambah kakitangan mencipta akaun")}>
              <span className={`${css.qaIcon} ${css.gold}`}><AppIcon name="add" /></span>{L("Add Staff Account", "Tambah Akaun Kakitangan")}
            </button>
          )}
          {adminDoor && (
            <Link className={css.qa} href="/admin" title={L("Customer accounts are created in /admin, Users", "Akaun pelanggan dicipta di /admin, Users")}>
              <span className={`${css.qaIcon} ${css.blue}`}><AppIcon name="person" /></span>{L("Add Customer Account", "Tambah Akaun Pelanggan")}
            </Link>
          )}
          <button type="button" className={css.qa} onClick={() => open("roles")}>
            <span className={`${css.qaIcon} ${css.navy}`}><AppIcon name="access" /></span>{L("Manage Roles & Permissions", "Urus Peranan & Kebenaran")}
          </button>
          <button type="button" className={css.qa} onClick={() => open("security")}>
            <span className={`${css.qaIcon} ${css.blue}`}><AppIcon name="documents" /></span>{L("View Login Logs", "Lihat Log Masuk")}
          </button>
          {geofenceRole && (
            <button type="button" className={css.qa} onClick={() => open("security")}>
              <span className={`${css.qaIcon} ${css.blue}`}><AppIcon name="place" /></span>{L("Office Check-in Settings", "Tetapan Daftar Masuk Pejabat")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
