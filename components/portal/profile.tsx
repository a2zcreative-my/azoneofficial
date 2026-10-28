"use client";

/* v1.220.0 - PROFILE 2.0 (the owner's brief and answers, 28-10-2026; the
 * audit is claude/PROFILE-AUDIT.md). One page, three tabs:
 *
 *   My Profile         - who I am, read from MY staff record (GET
 *                        /staff/profile, the session user only); the one
 *                        thing I change is my phone ("Phone only, name
 *                        locked"); my role and responsibilities as the CEO or
 *                        HR wrote them, with a request to update them that
 *                        rings HR and the CEO ("Button notifies HR and CEO").
 *   Security & Account - the existing password form and two-factor panel
 *                        (turning two-factor on now asks who you are first),
 *                        and "Sign out of all devices" over the existing
 *                        route.
 *   My Payslips        - Payroll's own payslip view (MyPayslip, handed in):
 *                        the months, their release state, and the slip's own
 *                        figures. Profile computes nothing.
 *
 * Every protected field (name, position, employee ID, role, pay) is shown,
 * never edited: the server refuses them too.
 *
 * v1.114.0 history: moved verbatim from app/portal/page.tsx.
 */
import { useEffect, useState, type ReactNode } from "react";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { L } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { roleLabel } from "@/components/portal/users-shared";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { ResponsibilitiesView } from "@/components/staff/responsibilities"; // v1.174.0
import { AppIcon } from "@/components/ui/app-icon";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { LineTabs } from "@/components/ui/line-tabs";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { SideDrawer } from "@/components/ui/side-drawer";
import { Skel } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { btnClass, btnSm, card, fieldLabel, inputClass } from "@/lib/ui-styles";
import css from "./profile-page.module.css";

type View = "profile" | "security" | "payslips";
type Prof = Record<string, string | null>; // is_active arrives as 0/1 and is read with Number()

const TYPE: Record<string, [string, string]> = {
  permanent: ["Permanent", "Tetap"], contract: ["Contract", "Kontrak"], part_time: ["Part-time", "Separuh masa"],
  resigned: ["Resigned", "Meletak jawatan"], terminated: ["Terminated", "Ditamatkan"],
};
const dmy = (iso: string | null | undefined) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—");

export function Profile({ payslips }: { payslips?: ReactNode }) {
  const [view, setView] = useState<View>("profile");
  const [profile, setProfile] = useState<Prof>({});
  /* v1.77.0 - skeleton until the first fetch lands: a "—" for every field
     while loading read as a blank profile. */
  const [loaded, setLoaded] = useState(false);
  /* v1.181.4 - a photo that will not load falls back to the initial. */
  const [photoFailed, setPhotoFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [phoneErr, setPhoneErr] = useState("");
  const { show: showToast, node: toastNode } = useSaveToast();
  const { prompt, node: promptNode } = usePrompt();
  const { confirm, node: confirmNode } = useConfirm();

  useEffect(() => {
    void api<{ profile: Prof }>(`/staff/profile`).then((r) => {
      if (r.data?.profile) setProfile(r.data.profile);
      setLoaded(true);
    });
  }, []);

  const name = (profile.name ?? "") || L("My profile", "Profil saya");
  const officialName = (profile.full_name ?? "");
  const active = profile.is_active == null ? null : Number(profile.is_active) === 1;
  const type = TYPE[(profile.employment_status ?? "")];

  const savePhone = async () => {
    setPhoneErr("");
    if (phone.trim() === (profile.phone ?? "")) { setEditing(false); return; }
    setSaving(true);
    const res = await api<{ error?: { message?: string } }>(`/staff/profile`, { method: "PATCH", body: JSON.stringify({ phone }) });
    setSaving(false);
    if (res.ok) {
      setProfile((p) => ({ ...p, phone: phone.trim() || null }));
      setEditing(false);
      showToast(L("Saved", "Disimpan"), L("Phone number updated", "Nombor telefon dikemas kini"));
    } else {
      setPhoneErr(res.data?.error?.message ?? L("The phone number was not saved. Try again.", "Nombor telefon tidak disimpan. Cuba lagi."));
    }
  };

  const requestUpdate = async () => {
    const r0 = await prompt({
      title: L("Ask for an update", "Minta kemas kini"),
      message: L("HR and the CEO get a notification with your note. They update your role and responsibilities on the Staff tab.", "HR dan CEO menerima pemberitahuan dengan catatan anda. Mereka mengemas kini peranan dan tanggungjawab anda di tab Kakitangan."),
      label: L("What should change?", "Apa yang perlu diubah?"),
      required: true,
      confirmLabel: L("Send request", "Hantar permintaan"),
    });
    if (!r0) return;
    const res = await api<{ sent_to?: number; error?: { message?: string } }>(`/staff/profile/update-request`, { method: "POST", body: JSON.stringify({ note: r0.value }) });
    if (res.ok) showToast(L("Request sent", "Permintaan dihantar"), L("HR and the CEO have been notified", "HR dan CEO telah dimaklumkan"));
    else showToast(L("Not sent", "Tidak dihantar"), res.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice");
  };

  const signOutAll = async () => {
    const ok = await confirm({
      title: L("Sign out of all devices?", "Log keluar dari semua peranti?"),
      message: L("Every browser and phone signed in to your account is signed out - this one too. You sign in again with your password or Google (and your two-factor code, if it is on).", "Setiap pelayar dan telefon yang log masuk ke akaun anda akan dilog keluar - termasuk yang ini. Anda log masuk semula dengan kata laluan atau Google (dan kod dua faktor, jika aktif)."),
      confirmLabel: L("Sign out everywhere", "Log keluar di semua tempat"),
      variant: "danger",
    });
    if (!ok) return;
    await api(`/auth/logout`, { method: "POST", body: JSON.stringify({ all: true }) });
    window.location.replace("/login");
  };

  const facts: [string, ReactNode][] = [
    [L("Employee ID", "ID pekerja"), (profile.employee_id ?? "") || "—"],
    [L("Role", "Peranan"), (profile.role ?? "") ? roleLabel((profile.role ?? "")) : "—"],
    [L("Department", "Jabatan"), (profile.department ?? "") || "—"],
    [L("Employment type", "Jenis pekerjaan"), type ? L(type[0], type[1]) : ((profile.employment_status ?? "") || "—")],
    [L("Email", "E-mel"), (profile.email ?? "") || "—"],
    [L("Phone", "Telefon"), (profile.phone ?? "") || "—"],
    [L("Joined", "Menyertai"), dmy((profile.joined_on ?? ""))],
    ...(officialName && officialName !== (profile.name ?? "") ? [[L("Official name", "Nama rasmi"), officialName] as [string, ReactNode]] : []),
  ];

  const tabs: [View, string][] = [
    ["profile", L("My Profile", "Profil Saya")],
    ["security", L("Security & Account", "Keselamatan & Akaun")],
    ["payslips", L("My Payslips", "Slip Gaji Saya")],
  ];

  return (
    <TabPage className={css.page}>
      {toastNode}{promptNode}{confirmNode}
      <LineTabs value={view} onChange={setView} tabs={tabs} label={L("Profile", "Profil")} />

      {/* ================= MY PROFILE ================= */}
      <div hidden={view !== "profile"} className={css.body}>
        <section className={`${card} ${css.head}`} aria-label={L("My details", "Butiran saya")}>
          <div className={css.who}>
            {loaded && profile.photo_key && !photoFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/v1/media/file/${encodeURIComponent((profile.photo_key ?? ""))}`} alt="" className={css.photo} onError={() => setPhotoFailed(true)} />
            ) : (
              <span className={css.initial} aria-hidden>{loaded ? ((profile.name ?? "").trim().charAt(0).toUpperCase() || "?") : ""}</span>
            )}
            <div className={css.lines}>
              {loaded ? (
                <>
                  <p className={css.name}>{name}{active !== null && <span className={active ? css.active : css.inactive}>{active ? L("Active", "Aktif") : L("Inactive", "Tidak aktif")}</span>}</p>
                  <p className={css.position}>{[(profile.position ?? ""), (profile.department ?? "")].filter(Boolean).join(" - ") || "—"}</p>
                  <p className={css.company}>A2Z Creative Marketing</p>
                </>
              ) : (
                <><Skel className={css.skName} /><Skel className={css.skLine} /></>
              )}
            </div>
            <button type="button" className={`${btnSm} ${css.editBtn}`} disabled={!loaded} onClick={() => { setPhone((profile.phone ?? "")); setPhoneErr(""); setEditing(true); }}>
              <AppIcon name="edit" /> {L("Edit contact", "Sunting hubungan")}
            </button>
          </div>
          <dl className={css.facts}>
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{loaded ? v : <Skel className={css.skLine} />}</dd>
              </div>
            ))}
          </dl>
          <p className={css.note}><AppIcon name="lock" /> {L("Your name, position, employee ID, role and pay are kept on your staff record by HR and the CEO. You can change your phone number here.", "Nama, jawatan, ID pekerja, peranan dan gaji anda disimpan pada rekod kakitangan oleh HR dan CEO. Anda boleh menukar nombor telefon di sini.")}</p>
        </section>

        {/* v1.174.0 - what is expected of me, as the CEO / HR wrote it on
            the Staff tab (PUT /staff/users/:id/responsibilities). Read-only. */}
        <section className={`${card} ${css.duties}`} aria-label={L("My roles and responsibilities", "Peranan dan tanggungjawab saya")}>
          <div>
            <p className={css.cardTitle}><AppIcon name="target" /> {L("My roles and responsibilities", "Peranan dan tanggungjawab saya")}</p>
            <p className={css.meta}>{L("Written by the CEO or HR on the Staff tab.", "Ditulis oleh CEO atau HR di tab Kakitangan.")}</p>
            <ResponsibilitiesView loaded={loaded}
              value={{ role_title: profile.role_title, responsibilities: profile.responsibilities, responsibilities_updated_at: profile.responsibilities_updated_at }}
              emptyText={L("Nothing written for you yet.", "Belum ada yang ditulis untuk anda.")} />
          </div>
          <aside className={css.ask}>
            <span className={css.askIcon}><AppIcon name="edit" /></span>
            <p className={css.askTitle}>{L("Need to update your responsibilities?", "Perlu kemas kini tanggungjawab anda?")}</p>
            <p className={css.meta}>{L("If something here is out of date, ask HR and the CEO to update it.", "Jika ada yang tidak terkini, minta HR dan CEO mengemas kininya.")}</p>
            <button type="button" className={btnSm} onClick={() => void requestUpdate()}>{L("Request update", "Minta kemas kini")}</button>
          </aside>
        </section>
      </div>

      {/* ================= SECURITY & ACCOUNT ================= */}
      <div hidden={view !== "security"} className={css.body}>
        <TabZone label={L("Sign-in and two-factor", "Log masuk dan dua faktor")} hint={L("Changing your password or two-factor signs out every other device straight away.", "Menukar kata laluan atau dua faktor akan melog keluar semua peranti lain serta-merta.")} cols={2}>
          <section className={`${card} ${css.stack}`} aria-label={L("Change password", "Tukar kata laluan")}>
            <p className={css.cardTitle}><AppIcon name="lock" /> {L("Change password", "Tukar kata laluan")}</p>
            <p className={css.meta}>{L("Google sign-in accounts manage their password with Google instead.", "Akaun log masuk Google mengurus kata laluan mereka dengan Google.")}</p>
            <ChangePasswordForm />
          </section>
          <TwoFactorPanel />
        </TabZone>
        <TabZone label={L("Devices and privacy", "Peranti dan privasi")}>
          <section className={`${card} ${css.devices}`} aria-label={L("Devices", "Peranti")}>
            <div>
              <p className={css.cardTitle}><AppIcon name="connection" /> {L("Signed-in devices", "Peranti yang log masuk")}</p>
              <p className={css.meta}>{L("If you think someone else is signed in to your account, sign out everywhere, then change your password.", "Jika anda rasa orang lain log masuk ke akaun anda, log keluar di semua tempat, kemudian tukar kata laluan.")}</p>
            </div>
            <button type="button" className={btnSm} onClick={() => void signOutAll()}>{L("Sign out of all devices", "Log keluar dari semua peranti")}</button>
          </section>
          {/* v1.4.191: staff read how their personal data (NRIC, bank,
              photos, payroll) is handled - PDPA notice */}
          <p className={css.privacy}>
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              {L("How your personal data is handled — Privacy Notice (PDPA)", "Bagaimana data peribadi anda diurus — Notis Privasi (PDPA)")}
            </a>
          </p>
        </TabZone>
      </div>

      {/* ================= MY PAYSLIPS (Payroll's own view) ================= */}
      <div hidden={view !== "payslips"} className={css.body}>
        <TabZone label={L("My payslips", "Slip gaji saya")} hint={L("From Payroll, as released. Amounts cannot be changed here.", "Daripada Gaji, seperti yang dikeluarkan. Amaun tidak boleh diubah di sini.")}>
          {view === "payslips" ? payslips : null}
        </TabZone>
      </div>

      <SideDrawer open={editing} onClose={() => setEditing(false)} title={L("Edit contact", "Sunting hubungan")}
        subtitle={L("Your phone number is the one thing you change yourself. HR sees the change.", "Nombor telefon ialah satu-satunya perkara yang anda ubah sendiri. HR melihat perubahan itu.")}
        footer={<div className={css.drawerFoot}><button type="button" className={btnClass} disabled={saving} onClick={() => void savePhone()}>{L("Save", "Simpan")}</button></div>}>
        <label className={css.field}>
          <span className={fieldLabel}>{L("Phone", "Telefon")}</span>
          <input className={inputClass} type="tel" inputMode="tel" autoComplete="tel" placeholder="+60 12-345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        {phoneErr && <p className={css.err} role="alert">{phoneErr}</p>}
        <p className={css.meta}>{L(`Email (${(profile.email ?? "")}) is your sign-in and is changed by an administrator.`, `E-mel (${(profile.email ?? "")}) ialah log masuk anda dan diubah oleh pentadbir.`)}</p>
      </SideDrawer>
    </TabPage>
  );
}
