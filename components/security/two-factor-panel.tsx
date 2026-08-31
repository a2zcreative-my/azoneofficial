"use client";

/**
 * Two-factor authentication panel (v1.4.37).
 *
 * Shown to super_admin, admin and CEO accounts. Enrolment: Start setup →
 * add the secret to an authenticator app → confirm a code → backup codes are
 * shown ONCE. Disabling requires the account password.
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { useCallback, useEffect, useState } from "react";
import { card, btnGhost, btnClass as btn } from "@/lib/ui-styles"; // v1.5.0: shared button styles
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelHead, SkelText } from "@/components/ui/skeleton";
import { getLang } from "@/lib/i18n";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);



const input =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export function TwoFactorPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [status, setStatus] = useState<{ enabled: boolean; eligible: boolean; backup_codes_left: number } | null>(null);
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  /* v1.77.0 — skeleton until the first fetch lands. `status` is null both
     while /auth/2fa/status is out and when the answer had no data, so a
     flag tells "still loading" from "nothing to show". */
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await api<{ enabled: boolean; eligible: boolean; backup_codes_left: number }>("/auth/2fa/status");
      if (res.data) setStatus(res.data);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (status === null && !loaded) {
    /* The real card: title with its ON/OFF pill, two lines of copy, one button. */
    return (
      <div className={card} aria-hidden>
        <div className="flex items-center gap-2">
          <SkelHead sub={false} />
          <Skel className="h-4 w-10 rounded-full" />
        </div>
        <SkelText lines={2} className="mt-2" />
        <Skel className="mt-3 h-9 w-40 rounded-lg" />
      </div>
    );
  }
  if (!status?.eligible) return null;

  const startSetup = async () => {
    setErr("");
    const res = await api<{ secret: string; otpauth: string }>("/auth/2fa/setup", { method: "POST" });
    if (res.ok && res.data) {
      setSecret(res.data.secret);
      setOtpauth(res.data.otpauth);
    } else {
      setErr(L("Could not start setup — try again.", "Tidak dapat memulakan persediaan — cuba lagi."));
      showToast(L("No changes", "Tiada perubahan"), L("Could not start two-factor setup — try again", "Tidak dapat memulakan persediaan dua faktor — cuba lagi"), "notice");
    }
  };

  const enable = async () => {
    setErr("");
    const res = await api<{ backup_codes?: string[]; error?: { message?: string } }>("/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (res.ok && res.data?.backup_codes) {
      setBackupCodes(res.data.backup_codes);
      setSecret("");
      setCode("");
      setMsg(L("Two-factor authentication is on.", "Pengesahan dua faktor telah diaktifkan."));
      showToast(L("Saved", "Disimpan"), L("Two-factor is ON — save your backup codes before leaving this page", "Dua faktor AKTIF — simpan kod sandaran anda sebelum meninggalkan halaman ini"));
      void load();
    } else {
      const m = res.data?.error?.message ?? L("That code is not correct.", "Kod itu tidak betul.");
      setErr(m);
      showToast(L("No changes", "Tiada perubahan"), m, "notice");
    }
  };

  const disable = async () => {
    setErr("");
    const res = await api<{ error?: { message?: string } }>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setPassword("");
      setMsg(L("Two-factor authentication is off.", "Pengesahan dua faktor telah dinyahaktifkan."));
      showToast(L("Saved", "Disimpan"), L("Two-factor is OFF for this account", "Dua faktor DIMATIKAN untuk akaun ini"));
      void load();
    } else {
      const m = res.data?.error?.message ?? L("Your current password is required.", "Kata laluan semasa anda diperlukan.");
      setErr(m);
      showToast(L("No changes", "Tiada perubahan"), m, "notice");
    }
  };

  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">
        {L("Two-factor authentication", "Pengesahan dua faktor")}
        {status.enabled ? (
          <span className="ml-2 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">{L("On", "Aktif")}</span>
        ) : (
          <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white uppercase">{L("Off", "Mati")}</span>
        )}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        {L(
          "A stolen password is not enough to reach this account — signing in also needs a 6-digit code from your phone. All staff accounts hold company data, so turning this on is strongly recommended for everyone.",
          "Kata laluan yang dicuri tidak cukup untuk mencapai akaun ini — log masuk juga memerlukan kod 6 digit daripada telefon anda. Semua akaun kakitangan menyimpan data syarikat, jadi mengaktifkannya amat disyorkan untuk semua orang.",
        )}
      </p>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}
      {err && <p className="text-destructive mt-2 text-xs font-medium">{err}</p>}

      {backupCodes.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="text-xs font-semibold">{L("Save these backup codes now — they are shown only once.", "Simpan kod sandaran ini sekarang — ia dipaparkan sekali sahaja.")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Each works once if you lose your phone. Keep them somewhere safe and private.", "Setiap satu berfungsi sekali jika anda kehilangan telefon. Simpan di tempat yang selamat dan peribadi.")}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button type="button" className={`${btnGhost} mt-3`} onClick={() => setBackupCodes([])}>
            {L("I have saved them", "Saya sudah menyimpannya")}
          </button>
        </div>
      )}

      {!status.enabled && !secret && backupCodes.length === 0 && (
        <button type="button" className={`${btn} mt-3`} onClick={() => void startSetup()}>
          {L("Turn on two-factor", "Aktifkan dua faktor")}
        </button>
      )}

      {!status.enabled && secret && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium">{L("1. Add this key to your authenticator app", "1. Tambah kunci ini ke aplikasi pengesah anda")}</p>
            <p className="text-muted-foreground text-xs">
              {L(
                "Google Authenticator, Authy, 1Password or Microsoft Authenticator → \"Add account\" → \"Enter setup key\".",
                "Google Authenticator, Authy, 1Password atau Microsoft Authenticator → \"Add account\" → \"Enter setup key\".",
              )}
            </p>
            <p className="border-border bg-secondary/40 mt-2 rounded-lg border px-3 py-2 font-mono text-sm break-all">
              {secret}
            </p>
            {/* v1.27.0 — must match the issuer the Worker writes into the
                otpauth URI (worker/src/index.ts, /auth/2fa/setup). Split-brain
                on purpose: staff who enrolled before this deploy still see
                "AZ ONE OFFICIAL" in their authenticator and their codes keep
                working (the issuer is a caption, never verified) — this line
                only describes what a NEW enrolment will look like. */}
            <p className="text-muted-foreground mt-1 text-xs">
              {L("Account name: A2Z CREATIVE MARKETING · Type: time-based", "Nama akaun: A2Z CREATIVE MARKETING · Jenis: berasaskan masa")}
            </p>
            {otpauth && (
              <a href={otpauth} className="mt-1 inline-block text-xs underline">
                {L("Or open in your authenticator app", "Atau buka dalam aplikasi pengesah anda")}
              </a>
            )}
          </div>
          <div>
            <p className="text-xs font-medium">{L("2. Enter the 6-digit code it shows", "2. Masukkan kod 6 digit yang dipaparkan")}</p>
            <input
              className={`${input} mt-1 max-w-40 text-center tracking-[0.3em]`}
              inputMode="numeric"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button type="button" className={btn} disabled={code.length < 6} onClick={() => void enable()}>
            {L("Confirm and turn on", "Sahkan dan aktifkan")}
          </button>
        </div>
      )}

      {status.enabled && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-xs">
            {L("Backup codes remaining:", "Kod sandaran berbaki:")} <span className="font-medium">{status.backup_codes_left}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              className={`${input} max-w-56`}
              placeholder={L("Current password to turn off", "Kata laluan semasa untuk mematikan")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className={btnGhost} disabled={!password} onClick={() => void disable()}>
              {L("Turn off", "Matikan")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
