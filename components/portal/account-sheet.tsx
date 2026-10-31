"use client";

/* v1.238.0 - SIGN-IN & RECOVERY FOR ONE STAFF ACCOUNT (the owner,
   31-10-2026; claude/ACCOUNT-RECOVERY-AUDIT.md). Opened from Users -> Staff
   Accounts by the company owner or the super admin; a phone gets the same
   sheet full screen. Everything is read from and written to
   /staff/accounts/:id - the worker judges every step (permission, the
   account's tier, never your own account) and asks for the editor's
   authenticator code (withStepUp) and a reason.

   What it never shows: a password, a 2FA secret, a backup code. A
   set-password link is shown ONCE, only when email sending is not set up,
   to hand over in person. Role and module access are NOT here - they live in
   Roles & Permissions and the role editor. */

import { useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { L, withStepUp } from "@/components/portal/page-shared";
import { roleLabel } from "@/components/portal/users-shared";
import { api } from "@/lib/api";
import { btnClass, btnSm, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm } from "@/lib/ui-styles";
import css from "./account-sheet.module.css";

interface Sheet {
  account: {
    id: number; employee_id: string | null; name: string; email: string; role: string; is_active: boolean; employment_status: string | null;
    email_verified_at: string | null; methods: { password: boolean; google: boolean; google_unlinked_signup: boolean };
    totp_enabled: boolean; backup_codes_left: number; last_login: string | null;
  };
  pending: { id: number; new_email: string; route: "email" | "google" | "in_person"; needs_second: number; approved: number; requested_by: number; requested_by_name: string | null; reason: string; created_at: string; expires_at: string }[];
  sessions: { ref: string; created_at: string; expires_at: string; last_seen_at: string | null; user_agent: string | null }[];
  history: { id: number; action: string; created_at: string; detail: string | null; who: string | null }[];
  can: { email: boolean; recovery: boolean };
  mail_ready: boolean; privileged: boolean; me: number;
}
type Route = "email" | "google" | "in_person";
type Act = "reset-2fa" | "password-link" | "google/unlink" | "suspend" | "restore" | "signout-all";

const stamp = (s: string | null) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)} UTC` : "—");
/** "Chrome · Windows" from a user-agent - a label, not a fingerprint */
export function deviceLabel(ua: string | null): string {
  if (!ua) return L("Unknown device", "Peranti tidak diketahui");
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const o = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return o ? `${b} · ${o}` : b;
}
const ACTION_LABEL: Record<string, [string, string]> = {
  "auth.login": ["Signed in (password)", "Log masuk (kata laluan)"], "auth.login_google": ["Signed in (Google)", "Log masuk (Google)"],
  "auth.login_2fa": ["Signed in (2FA)", "Log masuk (2FA)"], "auth.2fa_challenge": ["2FA asked", "2FA diminta"],
  "auth.2fa_enabled": ["2FA switched on", "2FA dihidupkan"], "auth.2fa_disabled": ["2FA switched off", "2FA dimatikan"],
  "auth.2fa_reset_by_admin": ["2FA reset for re-enrolment", "2FA diset semula"], "auth.change_password": ["Password changed", "Kata laluan ditukar"],
  "auth.password_link_issued": ["Set-password link issued", "Pautan kata laluan dikeluarkan"], "auth.password_set_by_link": ["Password set by link", "Kata laluan ditetapkan melalui pautan"],
  "auth.google_linked": ["Google account linked", "Akaun Google dipautkan"], "auth.google_unlinked": ["Google account unlinked", "Akaun Google dinyahpautkan"],
  "auth.google_refused": ["A different Google account was refused", "Akaun Google lain ditolak"],
  "user.email_change_requested": ["Login email change requested", "Pertukaran e-mel diminta"], "user.email_change": ["Login email changed", "E-mel log masuk ditukar"],
  "user.email_change_approved": ["Email change approved", "Pertukaran e-mel diluluskan"], "user.email_change_cancelled": ["Email change cancelled", "Pertukaran e-mel dibatalkan"],
  "user.force_logout": ["Signed out by an admin", "Dilog keluar oleh admin"], "user.suspend": ["Access suspended", "Akses digantung"], "user.restore": ["Access restored", "Akses dipulihkan"],
  "staff.role_change": ["Role changed", "Peranan ditukar"], "user.update": ["Account changed", "Akaun ditukar"], "staff.offboard": ["Offboarded", "Ditamatkan khidmat"],
};

export function AccountSheet({ userId, open, onClose, onChanged }: { userId: number | null; open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();
  const [data, setData] = useState<{ d: Sheet | null; e: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{ new_email: string; route: Route; reason: string; identity_checked: string; target_totp: string } | null>(null);
  const [act, setAct] = useState<{ kind: Act; reason: string; identity_checked: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    const c = new AbortController();
    void api<Sheet>(`/staff/accounts/${userId}`, { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setData({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : ((r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Could not open this account.", "Tidak dapat membuka akaun ini.")) });
    });
    return () => c.abort();
  }, [open, userId, tick]);
  const reload = () => { setTick((n) => n + 1); onChanged?.(); };

  const send = async (path: string, body: Record<string, unknown>, done: string, title: string) => {
    setBusy(true); setError("");
    const r = await withStepUp<{ error?: { message?: string }; applied?: boolean; link?: string; emailed?: boolean; needs_second?: boolean; sent?: boolean }>(
      (totp) => api(path, { method: "POST", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) }),
      prompt,
      { title, label: L("Your 6-digit authenticator code - this changes how this person signs in", "Kod pengesah 6 digit anda - ini menukar cara orang ini log masuk") },
    );
    setBusy(false);
    if (!r.ok) { setError(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan.")); return null; }
    toast(L("Saved", "Disimpan"), done);
    reload();
    return r.data;
  };

  const d = data?.d ?? null;
  const a = d?.account;
  const submitEmail = async () => {
    if (!form || !a) return;
    const out = await send(`/staff/accounts/${a.id}/email`, { new_email: form.new_email.trim(), route: form.route, reason: form.reason.trim(), identity_checked: form.identity_checked.trim(), target_totp: form.target_totp.trim() },
      form.route === "in_person" ? L("Login email changed - signed out everywhere", "E-mel log masuk ditukar - dilog keluar di semua tempat") : L("Change requested - waiting for verification", "Pertukaran diminta - menunggu pengesahan"),
      L(`Confirm: ${a.email} → ${form.new_email.trim()}`, `Sahkan: ${a.email} → ${form.new_email.trim()}`));
    if (out) setForm(null);
  };
  const runAct = async () => {
    if (!act || !a) return;
    const k = act.kind;
    const path = k === "restore" || k === "suspend" ? `/staff/accounts/${a.id}/suspend` : k === "signout-all" ? `/staff/accounts/${a.id}/sessions/revoke` : `/staff/accounts/${a.id}/${k}`;
    const body: Record<string, unknown> = { reason: act.reason.trim(), ...(k === "reset-2fa" ? { identity_checked: act.identity_checked.trim() } : {}), ...(k === "suspend" ? { suspend: true } : k === "restore" ? { suspend: false } : {}), ...(k === "signout-all" ? { all: true } : {}) };
    const word: Record<Act, [string, string]> = {
      "reset-2fa": ["2FA reset - they set it up again at the next sign-in", "2FA diset semula - mereka menetapkannya semula pada log masuk seterusnya"],
      "password-link": ["Set-password link issued", "Pautan kata laluan dikeluarkan"], "google/unlink": ["Google account unlinked", "Akaun Google dinyahpautkan"],
      suspend: ["Access suspended - signed out everywhere", "Akses digantung - dilog keluar di semua tempat"], restore: ["Access restored", "Akses dipulihkan"],
      "signout-all": ["Signed out on every device", "Dilog keluar di semua peranti"],
    };
    const out = await send(path, body, L(word[k][0], word[k][1]), L(word[k][0].split(" - ")[0]!, word[k][1].split(" - ")[0]!));
    if (out) { setAct(null); if (k === "password-link" && out.link) setLink(out.link); }
  };
  const signOutOne = async (ref: string) => { if (a) await send(`/staff/accounts/${a.id}/sessions/revoke`, { ref }, L("Signed out on that device", "Dilog keluar pada peranti itu"), L("Sign out this device", "Log keluar peranti ini")); };
  const approve = async (cid: number) => { await send(`/staff/accounts/email-changes/${cid}/approve`, {}, L("Approved", "Diluluskan"), L("Approve the login email change", "Luluskan pertukaran e-mel")); };
  const cancel = async (cid: number) => {
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/accounts/email-changes/${cid}/cancel`, { method: "POST", body: "{}" });
    setBusy(false);
    if (r.ok) { toast(L("Cancelled", "Dibatalkan"), L("The old email keeps working", "E-mel lama terus berfungsi")); reload(); } else setError(r.data?.error?.message ?? "");
  };

  const routeHelp: Record<Route, [string, string]> = {
    email: ["A single-use link goes to the new address (24 hours). The old email keeps working until it is opened.", "Pautan sekali guna dihantar ke alamat baharu (24 jam). E-mel lama terus berfungsi sehingga ia dibuka."],
    google: ["The person signs in with Google AS the new address. Google proves they own it. If they are moving to a different Google account, unlink Google first.", "Orang itu log masuk dengan Google SEBAGAI alamat baharu. Google membuktikan pemilikannya. Jika beralih ke akaun Google lain, nyahpautkan Google dahulu."],
    in_person: ["The old mailbox is lost: you checked who they are, and they type their own authenticator code here.", "Peti mel lama hilang: anda telah menyemak identiti mereka, dan mereka menaip kod pengesah mereka sendiri di sini."],
  };

  return (
    <SideDrawer open={open} onClose={() => { setForm(null); setAct(null); setLink(null); setError(""); onClose(); }} wide full
      title={a ? a.name : L("Staff account", "Akaun kakitangan")}
      subtitle={a ? `${roleLabel(a.role)} · ${a.employee_id ? `${a.employee_id} · ` : ""}${L("User", "Pengguna")} #${a.id}` : undefined}>
      {toastNode}{promptNode}
      {data?.e ? <p role="alert" className={css.error}>{data.e}</p> : !d || !a ? <SkelRows rows={8} /> : (
        <div className={css.sheet}>
          <div className={css.chips}>
            <span className={a.is_active ? chipSmSuccess : chipSmDanger}>{a.is_active ? L("Active", "Aktif") : L("Suspended", "Digantung")}</span>
            {a.employment_status && ["resigned", "terminated"].includes(a.employment_status) && <span className={chipSmNeutral}>{L("Former employee", "Bekas pekerja")}</span>}
            <span className={a.totp_enabled ? chipSmSuccess : chipSmWarn}>{a.totp_enabled ? L("2FA on", "2FA hidup") : L("No 2FA", "Tiada 2FA")}</span>
            {d.privileged && <span className={chipSmInfo}>{L("High-privilege account", "Akaun keistimewaan tinggi")}</span>}
          </div>

          <section className={css.block} aria-label={L("Sign-in", "Log masuk")}>
            <p className={css.label}>{L("Sign-in", "Log masuk")}</p>
            <dl className={css.dl}>
              <dt>{L("Login email", "E-mel log masuk")}</dt><dd><strong>{a.email}</strong>{a.email_verified_at ? <span className={css.muted}> · {L("verified", "disahkan")} {stamp(a.email_verified_at)}</span> : null}</dd>
              <dt>{L("Sign-in methods", "Kaedah log masuk")}</dt><dd className={css.chips}>
                {a.methods.password && <span className={chipSmNeutral}>{L("Email + password", "E-mel + kata laluan")}</span>}
                {a.methods.google && <span className={chipSmNeutral}>{L("Google (linked)", "Google (dipautkan)")}</span>}
                {a.methods.google_unlinked_signup && <span className={chipSmWarn}>{L("Google - links at the next Google sign-in", "Google - dipautkan pada log masuk Google seterusnya")}</span>}
              </dd>
              <dt>{L("Two-factor", "Dua faktor")}</dt><dd>{a.totp_enabled ? L(`On · ${a.backup_codes_left} backup code(s) left`, `Hidup · ${a.backup_codes_left} kod sandaran berbaki`) : L("Off - set up at the next sign-in", "Mati - ditetapkan pada log masuk seterusnya")}</dd>
              <dt>{L("Last sign-in", "Log masuk terakhir")}</dt><dd>{stamp(a.last_login)}</dd>
            </dl>
          </section>

          {d.pending.length > 0 && (
            <section className={css.block} aria-label={L("Waiting email change", "Pertukaran e-mel menunggu")}>
              <p className={css.label}>{L("Waiting email change", "Pertukaran e-mel menunggu")}</p>
              {d.pending.map((p) => (
                <div key={p.id} className={css.pending}>
                  <p><strong>{a.email} → {p.new_email}</strong></p>
                  <p className={css.muted}>{p.route === "email" ? L("By email link", "Melalui pautan e-mel") : p.route === "google" ? L("By Google sign-in as the new address", "Melalui log masuk Google sebagai alamat baharu") : L("In person", "Secara bersemuka")} · {p.requested_by_name ?? "—"} · {L("until", "sehingga")} {stamp(p.expires_at)} · {p.reason}</p>
                  {p.needs_second && !p.approved ? <p className={css.warnText}>{L("Needs the second approval (the other of owner and super admin).", "Memerlukan kelulusan kedua (pemilik atau super admin yang lain).")}</p> : null}
                  <div className={css.row}>
                    {d.can.email && p.needs_second && !p.approved && p.requested_by !== d.me && <button type="button" className={btnClass} disabled={busy} onClick={() => void approve(p.id)}><AppIcon name="verify" />{L("Approve", "Luluskan")}</button>}
                    {d.can.email && <button type="button" className={btnSm} disabled={busy} onClick={() => void cancel(p.id)}>{L("Cancel the change", "Batalkan pertukaran")}</button>}
                  </div>
                </div>
              ))}
            </section>
          )}

          {d.can.email && (
            <section className={css.block} aria-label={L("Change login email", "Tukar e-mel log masuk")}>
              <div className={css.headRow}>
                <p className={css.label}>{L("Change login email", "Tukar e-mel log masuk")}</p>
                {!form && <button type="button" className={btnSm} onClick={() => setForm({ new_email: "", route: d.mail_ready ? "email" : a.methods.google || a.methods.google_unlinked_signup ? "google" : "in_person", reason: "", identity_checked: "", target_totp: "" })}><AppIcon name="edit" />{L("Change email", "Tukar e-mel")}</button>}
              </div>
              <p className={css.muted}>{L("Same account, same staff ID - every attendance, sale, commission and payroll record stays theirs. Role and access are not changed here.", "Akaun sama, ID kakitangan sama - setiap rekod kehadiran, jualan, komisen dan gaji kekal milik mereka. Peranan dan akses tidak ditukar di sini.")}</p>
              {form && (
                <fieldset className={css.form} disabled={busy}>
                  <label>{L("Current login email", "E-mel log masuk semasa")}<input className={inputClassSm} value={a.email} readOnly aria-readonly="true" /></label>
                  <label>{L("New login email", "E-mel log masuk baharu")}<input className={inputClassSm} type="email" autoComplete="off" value={form.new_email} onChange={(e) => setForm({ ...form, new_email: e.target.value })} /></label>
                  <div role="radiogroup" aria-label={L("How the new address is proven", "Cara alamat baharu dibuktikan")} className={css.routes}>
                    {(["email", "google", "in_person"] as Route[]).map((r) => (
                      <label key={r} className={css.radio}>
                        <input type="radio" name="route" value={r} checked={form.route === r} disabled={r === "email" && !d.mail_ready} onChange={() => setForm({ ...form, route: r })} />
                        <span><strong>{r === "email" ? L("Email link", "Pautan e-mel") : r === "google" ? L("Google sign-in", "Log masuk Google") : L("In person (old mailbox lost)", "Bersemuka (peti mel lama hilang)")}</strong>
                          <small>{r === "email" && !d.mail_ready ? L("Email sending is not set up yet.", "Penghantaran e-mel belum disediakan.") : L(routeHelp[r][0], routeHelp[r][1])}</small></span>
                      </label>
                    ))}
                  </div>
                  {form.route === "in_person" && (
                    <>
                      <label>{L("Who checked their identity (in person or video call)", "Siapa menyemak identiti mereka (bersemuka atau panggilan video)")}<input className={inputClassSm} maxLength={120} value={form.identity_checked} onChange={(e) => setForm({ ...form, identity_checked: e.target.value })} /></label>
                      <label>{L(`${a.name} types their own 6-digit authenticator code`, `${a.name} menaip kod pengesah 6 digit mereka sendiri`)}<input className={inputClassSm} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.target_totp} onChange={(e) => setForm({ ...form, target_totp: e.target.value.replace(/\D/g, "") })} /></label>
                      {d.privileged && <p className={css.warnText}>{L("A high-privilege account: the other of owner and super admin must approve before it applies.", "Akaun keistimewaan tinggi: pemilik atau super admin yang lain mesti meluluskan sebelum ia berkuat kuasa.")}</p>}
                    </>
                  )}
                  <label>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}<input className={inputClassSm} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
                  {error && <p role="alert" className={css.error}>{error}</p>}
                  <div className={css.row}>
                    <button type="button" className={btnClass} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.new_email.trim()) || form.reason.trim().length < 10 || (form.route === "in_person" && (form.identity_checked.trim().length < 3 || form.target_totp.length !== 6))}
                      onClick={() => void submitEmail()}><AppIcon name="verify" />{form.route === "in_person" ? L("Change login email", "Tukar e-mel log masuk") : L("Send for verification", "Hantar untuk pengesahan")}</button>
                    <button type="button" className={btnSm} onClick={() => { setForm(null); setError(""); }}>{L("Cancel", "Batal")}</button>
                  </div>
                </fieldset>
              )}
            </section>
          )}

          {d.can.recovery && (
            <section className={css.block} aria-label={L("Recovery", "Pemulihan")}>
              <p className={css.label}>{L("Recovery", "Pemulihan")}</p>
              {link && (
                <div className={css.linkBox} role="status">
                  <p><strong>{L("Hand this link to them in person - it is shown once, works once, for 24 hours.", "Serahkan pautan ini secara bersemuka - ia dipaparkan sekali, berfungsi sekali, selama 24 jam.")}</strong></p>
                  <input className={inputClassSm} value={link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={L("Set-password link", "Pautan kata laluan")} />
                  <div className={css.row}><button type="button" className={btnSm} onClick={() => { void navigator.clipboard?.writeText(link); toast(L("Copied", "Disalin"), ""); }}>{L("Copy", "Salin")}</button><button type="button" className={btnSm} onClick={() => setLink(null)}>{L("Done - hide it", "Selesai - sembunyikan")}</button></div>
                </div>
              )}
              {!act ? (
                <div className={css.actions}>
                  <button type="button" className={btnSm} onClick={() => setAct({ kind: "password-link", reason: "", identity_checked: "" })}><AppIcon name="link" />{L("Set-password link", "Pautan kata laluan")}</button>
                  <button type="button" className={btnSm} onClick={() => setAct({ kind: "reset-2fa", reason: "", identity_checked: "" })}><AppIcon name="lock" />{L("Reset 2FA (re-enrol)", "Set semula 2FA (daftar semula)")}</button>
                  {a.methods.google && <button type="button" className={btnSm} onClick={() => setAct({ kind: "google/unlink", reason: "", identity_checked: "" })}><AppIcon name="connection" />{L("Unlink Google", "Nyahpaut Google")}</button>}
                  <button type="button" className={btnSm} onClick={() => setAct({ kind: "signout-all", reason: "", identity_checked: "" })}><AppIcon name="offboard" />{L("Sign out everywhere", "Log keluar di semua tempat")}</button>
                  {a.is_active
                    ? <button type="button" className={btnSm} onClick={() => setAct({ kind: "suspend", reason: "", identity_checked: "" })}><AppIcon name="blocked" />{L("Suspend access", "Gantung akses")}</button>
                    : <button type="button" className={btnSm} onClick={() => setAct({ kind: "restore", reason: "", identity_checked: "" })}><AppIcon name="success" />{L("Restore access", "Pulihkan akses")}</button>}
                </div>
              ) : (
                <fieldset className={css.form} disabled={busy}>
                  <p className={css.muted}>{act.kind === "reset-2fa" ? L("Clears their authenticator and backup codes and signs them out; they set 2FA up again at the next sign-in. Check who they are first.", "Mengosongkan pengesah dan kod sandaran mereka serta melog keluar; mereka menetapkan 2FA semula pada log masuk seterusnya. Semak identiti mereka dahulu.")
                    : act.kind === "password-link" ? (d.mail_ready ? L("Emails them a single-use link to choose their own password (24 hours). Nobody else sees it.", "Menghantar e-mel pautan sekali guna untuk memilih kata laluan sendiri (24 jam).") : L("Email sending is not set up: the single-use link is shown to you once, to hand over in person.", "Penghantaran e-mel belum disediakan: pautan sekali guna dipaparkan kepada anda sekali, untuk diserahkan secara bersemuka."))
                    : act.kind === "google/unlink" ? L("Their next Google sign-in links the Google account they use then.", "Log masuk Google seterusnya memautkan akaun Google yang mereka gunakan ketika itu.")
                    : act.kind === "suspend" ? L("Stops sign-in at once and signs them out - the same switch as Deactivate in /admin. A payroll run lists active accounts only, so restore them before the run if they are still paid. Ending employment is Offboard on the Staff tab.", "Menghentikan log masuk serta-merta dan melog keluar - suis yang sama dengan Nyahaktif di /admin. Larian gaji hanya menyenaraikan akaun aktif, jadi pulihkan sebelum larian jika mereka masih dibayar. Menamatkan pekerjaan ialah Tamat Khidmat di tab Kakitangan.")
                    : act.kind === "restore" ? L("They can sign in again.", "Mereka boleh log masuk semula.") : L("Every device is signed out.", "Setiap peranti dilog keluar.")}</p>
                  {act.kind === "reset-2fa" && <label>{L("Who checked their identity", "Siapa menyemak identiti mereka")}<input className={inputClassSm} maxLength={120} value={act.identity_checked} onChange={(e) => setAct({ ...act, identity_checked: e.target.value })} /></label>}
                  <label>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}<input className={inputClassSm} maxLength={300} value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} /></label>
                  {error && <p role="alert" className={css.error}>{error}</p>}
                  <div className={css.row}>
                    <button type="button" className={btnClass} disabled={(act.kind !== "signout-all" && act.reason.trim().length < 10) || (act.kind === "reset-2fa" && act.identity_checked.trim().length < 3)} onClick={() => void runAct()}>{L("Continue", "Teruskan")}</button>
                    <button type="button" className={btnSm} onClick={() => { setAct(null); setError(""); }}>{L("Cancel", "Batal")}</button>
                  </div>
                </fieldset>
              )}
            </section>
          )}

          <section className={css.block} aria-label={L("Devices signed in", "Peranti yang log masuk")}>
            <p className={css.label}>{L(`Devices signed in (${d.sessions.length})`, `Peranti yang log masuk (${d.sessions.length})`)}</p>
            {d.sessions.length === 0 ? <p className={css.muted}>{L("Not signed in anywhere.", "Tidak log masuk di mana-mana.")}</p> : (
              <ul className={css.list}>{d.sessions.map((x) => (
                <li key={x.ref}><span className={css.main}><strong>{deviceLabel(x.user_agent)}</strong><span>{L("signed in", "log masuk")} {stamp(x.created_at)}{x.last_seen_at ? ` · ${L("last seen", "terakhir dilihat")} ${stamp(x.last_seen_at)}` : ""}</span></span>
                  {d.can.recovery && <button type="button" className={btnSm} disabled={busy} onClick={() => void signOutOne(x.ref)}>{L("Sign out", "Log keluar")}</button>}</li>
              ))}</ul>
            )}
          </section>

          <section className={css.block} aria-label={L("Security history", "Sejarah keselamatan")}>
            <p className={css.label}>{L("Security history", "Sejarah keselamatan")}</p>
            {d.history.length === 0 ? <p className={css.muted}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p> : (
              <ul className={css.list}>{d.history.map((h) => (
                <li key={h.id}><span className={css.main}><strong>{ACTION_LABEL[h.action] ? L(ACTION_LABEL[h.action]![0], ACTION_LABEL[h.action]![1]) : h.action}</strong><span>{stamp(h.created_at)}{h.who ? ` · ${h.who}` : ""}</span></span></li>
              ))}</ul>
            )}
          </section>
        </div>
      )}
    </SideDrawer>
  );
}
