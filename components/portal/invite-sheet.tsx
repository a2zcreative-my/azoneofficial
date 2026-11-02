"use client";

/* v1.251.0 - ADD USER, IN USERS (the owner, 02-11-2026: "Create and invite
   users"; claude/CEO-ADMIN-USERS-AUDIT.md section 4). The same account
   creation as /admin and Staff Details (POST /api/v1/users), in invite mode:
   nobody types a password for somebody else. The server creates the account
   with a secret nobody sees and issues the existing single-use set-password
   link - emailed when sending is set up, otherwise shown here ONCE to hand
   over in person. Staff roles only: an Agent is given from a verified
   customer account, a Super Admin is created in /admin. The worker decides
   every role (mayGrant), and asks for a reason and the inviter's code. */

import { useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { L, withStepUp } from "@/components/portal/page-shared";
import { roleLabel } from "@/components/portal/users-shared";
import { api } from "@/lib/api";
import { btnClass, btnSm, inputClassSm } from "@/lib/ui-styles";
import css from "./account-sheet.module.css";

const WORKING = ["sales_marketing", "marketing", "editor", "live_host", "live_host_part_time", "hr_admin"];
const EXEC = ["coo", "cco", "admin", "ceo"];

export function InviteSheet({ open, onClose, onDone, executive }: {
  open: boolean; onClose: () => void; onDone: () => void;
  /** the company owner or the super admin: executive and Admin roles too (the server checks again) */
  executive: boolean;
}) {
  const { prompt, node: promptNode } = usePrompt();
  const [f, setF] = useState({ name: "", email: "", role: "sales_marketing", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ name: string; emailed: boolean; link?: string } | null>(null);
  const roles = executive ? [...WORKING, ...EXEC] : WORKING;
  const valid = f.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) && f.reason.trim().length >= 10;
  const close = () => { setF({ name: "", email: "", role: "sales_marketing", reason: "" }); setError(""); setDone(null); onClose(); };

  const submit = async () => {
    setBusy(true); setError("");
    const r = await withStepUp<{ id?: number; emailed?: boolean; link?: string; error?: { message?: string } }>(
      (totp) => api("/users", { method: "POST", body: JSON.stringify({ invite: true, name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, reason: f.reason.trim(), ...(totp ? { totp } : {}) }) }),
      prompt, { title: L(`Create the account for ${f.name.trim()}`, `Cipta akaun untuk ${f.name.trim()}`), label: L("Your 6-digit authenticator code - a new account is being created", "Kod pengesah 6 digit anda - akaun baharu sedang dicipta") },
    );
    setBusy(false);
    if (!r.ok || !r.data?.id) { setError(r.data?.error?.message ?? L("The account was not created.", "Akaun tidak dicipta.")); return; }
    setDone({ name: f.name.trim(), emailed: !!r.data.emailed, link: r.data.link });
    onDone();
  };

  return (
    <SideDrawer open={open} onClose={close} full title={L("Add User", "Tambah Pengguna")}
      subtitle={L("They choose their own password with a one-time link, then set up two-factor sign-in.", "Mereka memilih kata laluan sendiri melalui pautan sekali guna, kemudian menetapkan log masuk dua faktor.")}>
      {promptNode}
      {done ? (
        <div className={css.sheet} data-testid="invite-done">
          <section className={css.block} role="status">
            <p className={css.label}>{L("Account created", "Akaun dicipta")}</p>
            <p>{done.emailed
              ? L(`${done.name} has been emailed a link to choose their password (24 hours).`, `${done.name} telah dihantar e-mel pautan untuk memilih kata laluan (24 jam).`)
              : L(`Email sending is not set up yet. Hand this link to ${done.name} in person - it is shown once, works once, for 24 hours.`, `Penghantaran e-mel belum disediakan. Serahkan pautan ini kepada ${done.name} secara bersemuka - ia dipaparkan sekali, berfungsi sekali, selama 24 jam.`)}</p>
            {done.link && (
              <>
                <input className={inputClassSm} value={done.link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={L("Set-password link", "Pautan kata laluan")} />
                <div className={css.row}>
                  <button type="button" className={btnSm} onClick={() => { void navigator.clipboard?.writeText(done.link!); }}>{L("Copy", "Salin")}</button>
                </div>
              </>
            )}
            <div className={css.row}><button type="button" className={btnClass} onClick={close}>{L("Done", "Selesai")}</button></div>
          </section>
        </div>
      ) : (
        <div className={css.sheet}>
          <fieldset className={css.form} disabled={busy} data-testid="invite-form">
            <label>{L("Full name", "Nama penuh")}<input className={inputClassSm} maxLength={120} autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label>{L("Login email", "E-mel log masuk")}<input className={inputClassSm} type="email" maxLength={200} autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label>{L("Role", "Peranan")}<select className={inputClassSm} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{r === "live_host_part_time" ? L("Live host (part time)", "Hos langsung (separuh masa)") : roleLabel(r)}</option>)}
            </select></label>
            <p className={css.muted}>{L("The role decides what they see and do; you can change it later in their account. Admin needs a company email. An Agent is given from a verified customer account (Customers & Agents).", "Peranan menentukan apa yang mereka lihat dan lakukan; anda boleh menukarnya kemudian. Admin memerlukan e-mel syarikat. Ejen diberi daripada akaun pelanggan yang disahkan (Pelanggan & Ejen).")}</p>
            <label>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}<input className={inputClassSm} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
            {error && <p role="alert" className={css.error}>{error}</p>}
            <div className={css.row}>
              <button type="button" className={btnClass} disabled={!valid} onClick={() => void submit()}><AppIcon name="add" />{busy ? L("Creating…", "Mencipta…") : L("Create account", "Cipta akaun")}</button>
              <button type="button" className={btnSm} onClick={close}>{L("Cancel", "Batal")}</button>
            </div>
          </fieldset>
        </div>
      )}
    </SideDrawer>
  );
}
