"use client";

/* v1.349.0 - THE SUPER ADMIN'S USERS PAGE (Phase 2 of the /admin plan the CEO
   approved, 17-11-2026), on the portal's pages: one KPI strip, the accounts
   register beside the chosen account, Add user in a drawer, and the Company
   owner card. Every action is the one the console already had, on the same
   routes, so the server still decides each one:
     list            GET  /users          (+ GET /staff/users for 2FA)
     add             POST /users          (the authenticator step-up when asked)
     change role     PATCH /users/:id     (confirm first; step-up when asked)
     suspend/restore PATCH /users/:id     {is_active}
     set password    PATCH /users/:id     {password} - signs them out everywhere
     sign out        POST /users/:id/revoke-sessions
     company owner   OwnerCard            (GET/POST /staff/owner)
   Since v1.348.0 only the super admin reaches this page, so the owner-CEO
   branches the old panel carried are gone: the owner gives roles in portal Users. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { dmyMYT } from "@/lib/format";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { SkelRows } from "@/components/ui/skeleton";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { SideDrawer } from "@/components/ui/side-drawer";
import { PasswordInput } from "@/components/ui/password-input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { withStepUp } from "@/components/portal/page-shared";
import { OwnerCard, useOwner } from "@/components/portal/owner-card";
import { roleLabel } from "@/components/portal/users-shared";
import { AccountSheet } from "@/components/portal/account-sheet"; // v1.379.0 - login email and recovery, here too
import { EmailMoveCard } from "@/components/portal/email-move"; // v1.379.0 - the super admin moves the CEO and super admin accounts
import { btnSm, btnSmDanger, btnSmPrimary, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, fieldLabel, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./admin-console.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface AdminUser { id: number; email: string; name: string; role: string; employment_status?: string | null; is_active: number; created_at: string }
/* customer included deliberately: demoting a personal-email account back to
   customer is the cleanup path the domain policy (v1.4.42) depends on.
   live_host_part_time = role live_host with employment_status part_time (v1.4.180, v1.157.0). */
const ROLES = ["super_admin", "admin", "editor", "marketing", "live_host", "live_host_part_time", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "agent", "customer"] as const;
const roleOf = (u: AdminUser) => (u.role === "live_host" && u.employment_status === "part_time" ? "live_host_part_time" : u.role);
/* v1.358.0 - ROLES V2: the roles made in Roles & Permissions (key -> name), read once from the policy */
let OWN_NAMES: Record<string, string> = {};
const roleWord = (r: string) => (r === "live_host_part_time" ? L("Live host (part time)", "Hos live (separuh masa)") : OWN_NAMES[r] ?? roleLabel(r));
const isOwn = (r: string) => /^r_[a-z0-9_]+$/.test(r);
/** staff accounts must have 2FA; customers and agents sign in otherwise */
const needs2fa = (r: string) => !["customer", "agent"].includes(r);

export function AdminUsers({ me }: { me: { id: number; role: string } }) {
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const { prompt: ask, node: askNode } = usePrompt();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [totp, setTotp] = useState<Map<number, boolean> | null>(null);
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("all");
  /* v1.358.0 - the roles you made are listed beside the code roles. Only the Super Admin and the CEO give
     them (role_custom); the server's role door asks for a reason and the code, and checks the key. */
  const [ownKeys, setOwnKeys] = useState<string[]>([]);
  const canGiveOwn = ["super_admin", "ceo"].includes(me.role);
  useEffect(() => {
    if (!canGiveOwn) return;
    let live = true;
    void api<{ role_table?: { key: string; name: string; kind: string }[] }>("/staff/access/policy").then((res) => {
      if (!live || !res.ok) return;
      const own = (res.data?.role_table ?? []).filter((x) => x.kind === "own");
      OWN_NAMES = Object.fromEntries(own.map((x) => [x.key, x.name]));
      setOwnKeys(own.map((x) => x.key));
    });
    return () => { live = false; };
  }, [canGiveOwn]);
  const roleChoices = (cur?: string) => [...ROLES, ...ownKeys, ...(cur && isOwn(cur) && !ownKeys.includes(cur) ? [cur] : [])];
  const [statusF, setStatusF] = useState("all");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ email: "", name: "", role: "editor", password: "" });
  const [addErr, setAddErr] = useState("");
  const [resetPw, setResetPw] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState<number | null>(null);
  const [ownerTick, setOwnerTick] = useState(0);
  const ownerState = useOwner(true, ownerTick);

  const [sheetId, setSheetId] = useState<number | null>(null); // v1.379.0 - the Sign-in & recovery sheet
  const load = useCallback(async () => {
    const r = await api<{ users: AdminUser[] }>("/users");
    if (r.ok && r.data) { setUsers(r.data.users); setFailed(false); } else { setUsers((u) => u ?? []); setFailed(true); }
    const s = await api<{ users?: { id: number; totp_enabled?: number }[]; staff?: { id: number; totp_enabled?: number }[] }>("/staff/users");
    if (s.ok && s.data) setTotp(new Map((s.data.users ?? s.data.staff ?? []).map((u) => [u.id, !!u.totp_enabled])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => users ?? [], [users]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((u) => (roleF === "all" || roleOf(u) === roleF)
      && (statusF === "all" || (statusF === "active" ? !!u.is_active : !u.is_active))
      && (!t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)));
  }, [all, q, roleF, statusF]);
  const sel = all.find((u) => u.id === picked) ?? null;
  const active = all.filter((u) => u.is_active);
  const no2fa = totp ? active.filter((u) => needs2fa(u.role) && totp.has(u.id) && !totp.get(u.id)) : null;
  const twoFa = (u: AdminUser) => (!needs2fa(u.role) ? <span className={chipSmNeutral}>{L("Not required", "Tidak diperlukan")}</span>
    : !totp || !totp.has(u.id) ? <span className={chipSmNeutral}>—</span>
    : totp.get(u.id) ? <span className={chipSmSuccess}>{L("On", "Hidup")}</span> : <span className={chipSmWarn}>{L("Off", "Mati")}</span>);
  const status = (u: AdminUser) => (u.is_active ? <span className={chipSmSuccess}>{L("Active", "Aktif")}</span> : <span className={chipSmDanger}>{L("Suspended", "Digantung")}</span>);

  const cols: TableCol<AdminUser>[] = [
    { key: "account", label: L("Account", "Akaun"), main: true, cell: (u) => <span className={css.cell}><strong>{u.name}</strong><span>{u.email}</span></span> },
    { key: "role", label: L("Role", "Peranan"), cell: (u) => <span className={u.role === "super_admin" ? chipSmInfo : chipSmNeutral}>{roleWord(roleOf(u))}</span> },
    { key: "2fa", label: L("2FA", "2FA"), cell: twoFa },
    { key: "status", label: L("Status", "Status"), cell: status },
    { key: "created", label: L("Created", "Dibuat"), cell: (u) => <span className={css.nowrap}>{dmyMYT(u.created_at).slice(0, 10)}</span> },
  ];

  /* ---- the actions: the same requests the console always sent ---- */
  const stepUp = { title: L("Confirm with your authenticator", "Sahkan dengan pengesah anda"), label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") };

  const create = async () => {
    setAddErr("");
    const res = await withStepUp<{ error?: { code?: string; message?: string } }>((totpCode) => api("/users", {
      method: "POST", body: JSON.stringify({ ...draft, ...(totpCode ? { totp: totpCode } : {}) }),
    }), ask, stepUp);
    if (!res.ok) {
      setAddErr(res.status === 409 ? L("Email already exists.", "E-mel sudah wujud.") : (res.data?.error?.message ?? L("Check all fields — password needs 10+ characters.", "Semak semua medan — kata laluan perlu 10+ aksara.")));
      return;
    }
    toast(L("Saved", "Disimpan"), L(`${draft.email} created`, `${draft.email} dibuat`));
    setDraft({ email: "", name: "", role: "editor", password: "" });
    setAdding(false);
    void load();
  };

  const changeRole = async (u: AdminUser, to: string) => {
    if (isOwn(to) || isOwn(u.role)) {
      /* v1.358.0 - a role you made, given or taken away: the staff role door (reason 10+, the code, audited) */
      const why = await ask({ title: L(`${u.name} → ${roleWord(to)}`, `${u.name} → ${roleWord(to)}`),
        label: L(`Why (at least 10 characters, kept in the audit history). ${roleWord(roleOf(u))} becomes ${roleWord(to)}; what they may do and see changes at once.`, `Sebab (sekurang-kurangnya 10 aksara, disimpan dalam sejarah audit). ${roleWord(roleOf(u))} menjadi ${roleWord(to)}; apa yang mereka boleh lakukan dan lihat berubah serta-merta.`), required: true });
      if (!why) { void load(); return; }
      if (why.value.trim().length < 10) { toast(L("No changes", "Tiada perubahan"), L("Give a reason of at least 10 characters.", "Beri sebab sekurang-kurangnya 10 aksara."), "notice"); void load(); return; }
      const ro = await withStepUp<{ error?: { message?: string } }>((totpCode) => api(`/staff/users/${u.id}/role`, {
        method: "POST", body: JSON.stringify({ role: to, reason: why.value.trim(), ...(totpCode ? { totp: totpCode } : {}) }),
      }), ask, stepUp);
      toast(ro.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), ro.ok ? L(`Role changed to ${roleWord(to)}`, `Peranan ditukar kepada ${roleWord(to)}`) : (ro.data?.error?.message ?? L("The role was not changed", "Peranan tidak ditukar")), ro.ok ? undefined : "notice");
      void load();
      return;
    }
    const wasPart = u.employment_status === "part_time", toPart = to === "live_host_part_time";
    const statusNote = toPart && !wasPart ? L(" Their employment status becomes part time.", " Status pekerjaan mereka menjadi separuh masa.")
      : !toPart && wasPart && to !== "customer" ? L(" They stop being part time: status becomes permanent (set contract or probation in portal Staff if that is wrong).", " Mereka tidak lagi separuh masa: status menjadi tetap (tetapkan kontrak atau percubaan dalam Kakitangan portal jika itu salah).") : "";
    if (!(await confirm({ title: L("Confirm Role Change", "Sahkan Pertukaran Peranan"), message: L(`Change ${u.name}'s role to ${roleWord(to)}?${statusNote}`, `Tukar peranan ${u.name} kepada ${roleWord(to)}?${statusNote}`), confirmLabel: L("Change Role", "Tukar Peranan") }))) return;
    const r = await withStepUp<{ error?: { message?: string } }>((totpCode) => api(`/users/${u.id}`, {
      method: "PATCH", body: JSON.stringify({ role: to, ...(totpCode ? { totp: totpCode } : {}) }),
    }), ask, stepUp);
    toast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`Role changed to ${roleWord(to)}`, `Peranan ditukar kepada ${roleWord(to)}`) : (r.data?.error?.message ?? L("The role was not changed", "Peranan tidak ditukar")), r.ok ? undefined : "notice");
    void load();
  };

  const signOut = async (u: AdminUser) => {
    const r = await api(`/users/${u.id}/revoke-sessions`, { method: "POST" });
    toast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? L(`${u.name} signed out of every device`, `${u.name} dilog keluar dari setiap peranti`) : L("Could not revoke those sessions", "Sesi tersebut tidak dapat dibatalkan"), r.ok ? undefined : "notice");
  };

  const toggleActive = async (u: AdminUser) => {
    if (u.is_active && !(await confirm({ title: L(`Suspend ${u.email}?`, `Gantung ${u.email}?`), message: L("They are signed out everywhere immediately and cannot sign back in until reinstated.", "Mereka dilog keluar di semua tempat serta-merta dan tidak boleh log masuk semula sehingga dipulihkan."), confirmLabel: L("Suspend", "Gantung"), variant: "danger" }))) return;
    const r = await api<{ error?: { message?: string } }>(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ is_active: u.is_active ? 0 : 1 }) });
    toast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"), r.ok ? (u.is_active ? L(`${u.email} suspended — signed out everywhere`, `${u.email} digantung — dilog keluar di semua tempat`) : L(`${u.email} reinstated`, `${u.email} dipulihkan`)) : (r.data?.error?.message ?? L("Could not update that account — try again", "Akaun itu tidak dapat dikemas kini — cuba lagi")), r.ok ? undefined : "notice");
    void load();
  };

  /* the forgotten-password path: the server hashes the new password and ends every session the person had */
  const setPassword = async (u: AdminUser) => {
    if (!resetPw || resetPw.length < 10) return;
    const r = await api<{ error?: { message?: string } }>(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ password: resetPw }) });
    if (r.ok) {
      setResetPw(null); setResetDone(u.id); window.setTimeout(() => setResetDone(null), 5000);
      toast(L("Password set", "Kata laluan ditetapkan"), L(`${u.email} — signed out everywhere. Tell them the new password directly.`, `${u.email} — dilog keluar di semua tempat. Beritahu mereka kata laluan baharu secara terus.`));
    } else toast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("Could not set that password — try again", "Kata laluan itu tidak dapat ditetapkan — cuba lagi"), "notice");
  };

  const self = sel?.id === me.id;
  return (
    <TabPage className={css.page}>
      {toastNode}{confirmNode}{askNode}
      <TabZone label={L("Accounts", "Akaun")}>
        <KpiRow label={L("Account figures", "Angka akaun")} testid="users-strip">
          <KpiTile icon="users" tone="navy" label={L("All Accounts", "Semua Akaun")} busy={users === null} value={all.length} onClick={() => { setStatusF("all"); setRoleF("all"); setPage(1); }} pressed={statusF === "all" && roleF === "all"} testid="tile-all" />
          <KpiTile icon="success" tone="green" label={L("Active", "Aktif")} busy={users === null} value={active.length} onClick={() => { setStatusF("active"); setPage(1); }} pressed={statusF === "active"} testid="tile-active" />
          <KpiTile icon="blocked" tone="red" label={L("Suspended", "Digantung")} busy={users === null} value={all.length - active.length} onClick={() => { setStatusF("suspended"); setPage(1); }} pressed={statusF === "suspended"} testid="tile-suspended" />
          <KpiTile icon="warning" tone={no2fa && no2fa.length ? "gold" : "green"} label={L("Staff Without 2FA", "Kakitangan Tanpa 2FA")} busy={users === null || totp === null} value={no2fa ? no2fa.length : "—"} sub={L("Active staff accounts", "Akaun kakitangan aktif")} testid="tile-no2fa" />
          <KpiTile icon="verify" tone="blue" label={L("Super Admins", "Super Admin")} busy={users === null} value={active.filter((u) => u.role === "super_admin").length} onClick={() => { setRoleF("super_admin"); setPage(1); }} pressed={roleF === "super_admin"} testid="tile-supers" />
        </KpiRow>
      </TabZone>
      <TabZone label={L("Accounts and the chosen account", "Akaun dan akaun dipilih")}>
        <WorkspaceSplit testid="users-split" ratio="60-40">
          <SplitPane testid="users-register" title={L("Accounts", "Akaun")} sub={L("Every account; a row opens it", "Setiap akaun; satu baris membukanya")}
            actions={<button type="button" className={btnSmPrimary} onClick={() => { setAddErr(""); setAdding(true); }} data-testid="add-user">{L("Add user", "Tambah pengguna")}</button>}
            toolbar={
              <div className={css.toolbar}>
                <input className={inputClassSm} type="search" placeholder={L("Search name or email", "Cari nama atau e-mel")} aria-label={L("Search accounts", "Cari akaun")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="users-search" />
                <select className={selectClassSm} aria-label={L("Role", "Peranan")} value={roleF} onChange={(e) => { setRoleF(e.target.value); setPage(1); }} data-testid="users-role">
                  <option value="all">{L("Every role", "Semua peranan")}</option>
                  {roleChoices().map((r) => <option key={r} value={r}>{roleWord(r)}</option>)}
                </select>
                <select className={selectClassSm} aria-label={L("Status", "Status")} value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); }} data-testid="users-status">
                  <option value="all">{L("Any status", "Semua status")}</option>
                  <option value="active">{L("Active", "Aktif")}</option>
                  <option value="suspended">{L("Suspended", "Digantung")}</option>
                </select>
              </div>
            }>
            {users === null ? <SkelRows rows={6} /> : failed && users.length === 0
              ? <p className={css.muted} role="alert">{L("The accounts could not be read.", "Akaun tidak dapat dibaca.")}</p>
              : <CompactTaskTable rows={rows} cols={cols} label={L("Accounts", "Akaun")} loading={users === null} record="account" testid="users-table"
                  onOpen={(id) => { setPicked(id); setResetPw(null); }} picked={picked} page={page} size={8} onPage={setPage}
                  empty={<p className={css.muted}>{L("No account matches.", "Tiada akaun yang sepadan.")}</p>} />}
          </SplitPane>
            <SplitPane testid="user-detail" title={L("Selected Account", "Akaun Dipilih")} sub={sel ? sel.email : L("Choose an account in the list", "Pilih akaun dalam senarai")}
              foot={sel && !self ? (
                <span className={css.actions}>
                  {/* v1.379.0 - the CEO (18-11-2026): "for Admin, I didnt see any option for me to change CEO email".
                      The same Sign-in & recovery sheet as the portal (login email by link / Google / in person,
                      2FA reset, set-password link); the server decides who may (the super admin for CEO and
                      super admin accounts). Staff accounts only - a customer is not a staff account. */}
                  {!["customer", "agent"].includes(sel.role) && <button type="button" className={btnSmPrimary} onClick={() => setSheetId(sel.id)} data-testid="user-email">{L("Change login email", "Tukar e-mel log masuk")}</button>}
                  <button type="button" className={btnSm} onClick={() => void signOut(sel)} data-testid="user-signout">{L("Sign out everywhere", "Log keluar di semua tempat")}</button>
                  <button type="button" className={btnSm} onClick={() => setResetPw(resetPw === null ? "" : null)} aria-expanded={resetPw !== null} data-testid="user-reset">{L("Set password", "Tetapkan kata laluan")}</button>
                  <button type="button" className={sel.is_active ? btnSmDanger : btnSm} onClick={() => void toggleActive(sel)} data-testid="user-suspend">{sel.is_active ? L("Suspend", "Gantung") : L("Reinstate", "Pulihkan")}</button>
                </span>
              ) : undefined}>
              {!sel ? <p className={css.muted}>{L("Its role, 2FA and status, and what you can do, show here.", "Peranan, 2FA dan statusnya, serta apa yang boleh anda lakukan, dipaparkan di sini.")}</p> : (
                <>
                  <dl className={css.facts}>
                    <div className={css.fact}><dt>{L("Name", "Nama")}</dt><dd><strong>{sel.name}</strong></dd></div>
                    <div className={css.fact}><dt>{L("Role", "Peranan")}</dt><dd>
                      <select className={selectClassSm} value={roleOf(sel)} disabled={self} aria-label={L("Role", "Peranan")} data-testid="user-role"
                        title={self ? L("You cannot change your own role", "Anda tidak boleh menukar peranan sendiri") : undefined}
                        onChange={(e) => void changeRole(sel, e.target.value)}>
                        {roleChoices(sel.role).map((r) => <option key={r} value={r}>{roleWord(r)}</option>)}
                      </select>
                    </dd></div>
                    <div className={css.fact}><dt>{L("Two-factor", "Dua faktor")}</dt><dd>{twoFa(sel)}</dd></div>
                    <div className={css.fact}><dt>{L("Status", "Status")}</dt><dd>{status(sel)}</dd></div>
                    <div className={css.fact}><dt>{L("Created", "Dibuat")}</dt><dd>{dmyMYT(sel.created_at)}</dd></div>
                  </dl>
                  {self && <p className={css.note}>{L("This is your own account: its role, password and status are changed by another Super Admin.", "Ini akaun anda sendiri: peranan, kata laluan dan statusnya ditukar oleh Super Admin lain.")}</p>}
                  {resetPw !== null && !self && (
                    <div className={css.reset} data-testid="reset-box">
                      <PasswordInput autoComplete="new-password" className={inputClassSm} placeholder={L("New password (10+ characters)", "Kata laluan baharu (10+ aksara)")} value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                      {resetPw.length > 0 && resetPw.length < 10 && <p className={css.error}>{L(`${resetPw.length} of 10 characters`, `${resetPw.length} daripada 10 aksara`)}</p>}
                      <p className={css.muted}>{L("Setting it signs them out everywhere. Tell them the new password directly and ask them to change it in Profile.", "Menetapkannya melog keluar mereka di semua tempat. Beritahu mereka kata laluan baharu secara terus dan minta mereka menukarnya di Profil.")}</p>
                      <span className={css.actions}>
                        <button type="button" className={btnSmPrimary} disabled={resetPw.length < 10} onClick={() => void setPassword(sel)}>{L("Set password", "Tetapkan kata laluan")}</button>
                        <button type="button" className={btnSm} onClick={() => setResetPw(null)}>{L("Cancel", "Batal")}</button>
                      </span>
                    </div>
                  )}
                  {resetDone === sel.id && <p className={css.ok}>{L("Password set — all their sessions were signed out.", "Kata laluan ditetapkan — semua sesi mereka telah dilog keluar.")}</p>}
                </>
              )}
            </SplitPane>
        </WorkspaceSplit>
      </TabZone>
      {/* v1.379.0 - the move to @a2zcreative.my: the super admin is the one who moves the CEO and super admin accounts */}
      <TabZone label={L("Move staff to @a2zcreative.my", "Pindahkan kakitangan ke @a2zcreative.my")}>
        <EmailMoveCard />
      </TabZone>
      <AccountSheet userId={sheetId} open={sheetId !== null} onClose={() => setSheetId(null)} onChanged={() => void load()} />
      {/* the one Company owner card (v1.252.1), below the register: named by a super admin with a reason and the authenticator code */}
      <TabZone label={L("Company owner", "Pemilik syarikat")}>
        {ownerState ? <div data-testid="admin-owner"><OwnerCard state={ownerState} onChanged={() => setOwnerTick((n) => n + 1)} /></div> : <SkelRows rows={3} />}
      </TabZone>

      <SideDrawer open={adding} onClose={() => setAdding(false)} title={L("Add user", "Tambah pengguna")} subtitle={L("A new account, signed in with the password you set here", "Akaun baharu, log masuk dengan kata laluan yang anda tetapkan di sini")} form
        footer={<button type="button" className={btnSmPrimary} onClick={() => void create()} data-testid="add-user-save">{L("Create user", "Buat pengguna")}</button>}>
        <div className={css.form}>
          <label><span className={fieldLabel}>{L("Email", "E-mel")}</span><input className={inputClass} type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} /></label>
          <label><span className={fieldLabel}>{L("Name", "Nama")}</span><input className={inputClass} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></label>
          <label><span className={fieldLabel}>{L("Role", "Peranan")}</span>
            <select className={inputClass} value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
              {ROLES.map((r) => <option key={r} value={r}>{roleWord(r)}</option>)}
            </select>
          </label>
          <label><span className={fieldLabel}>{L("Password", "Kata laluan")}</span>
            <PasswordInput className={inputClass} placeholder={L("10+ characters", "10+ aksara")} value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} />
          </label>
          {draft.password.length > 0 && draft.password.length < 10 && <p className={css.error}>{L(`${draft.password.length} of 10 characters`, `${draft.password.length} daripada 10 aksara`)}</p>}
          {addErr && <p className={css.error} role="alert">{addErr}</p>}
        </div>
      </SideDrawer>
    </TabPage>
  );
}
