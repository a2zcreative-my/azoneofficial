"use client";

/* v1.360.0 - PUSH ALERTS ARE REQUIRED FOR STAFF (the CEO, 18-11-2026: "Push notifications should enforce
   since my staff requires to alert on any updates"; his answers: block until on, every staff role).

   A website cannot switch notifications on by itself - the person must tap Allow once on each device,
   and an iPhone only offers push to the portal added to the Home Screen. So this is a GATE, like the
   2FA one: for every staff role (agents and customers are not staff), the portal on this device waits
   behind one screen until push is on for THIS person on THIS device (devicePushStatus - the server must
   hold the address, permission alone is not enough). It re-checks whenever the app comes back to the
   front, so turning it off in the phone's settings brings the screen back.

   Never a lock-out the server caused: when the server has no push keys (`/staff/push/public-key` gives
   no key), nobody is held. Sign out always works. */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { devicePushStatus, enablePush, signOutRequest, type DevicePush } from "@/lib/push-client";
import { L } from "@/components/portal/page-shared";
import { btnClass, card } from "@/lib/ui-styles";
import css from "@/app/portal/portal.module.css";

/** Agents and customers are not staff; every other role must have push on (the CEO's answer). */
export const pushRequiredFor = (role: string | undefined | null) => Boolean(role) && !["agent", "customer"].includes(String(role));

type GateState = "checking" | "ok" | DevicePush;

const isIos = () => typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

/** Watches this device. "ok" lets the portal through; the others are the gate's reasons. */
export function usePushGate(role: string | undefined | null, onOn?: () => void) {
  const required = pushRequiredFor(role);
  const [state, setState] = useState<GateState>("checking");
  const check = useCallback(async () => {
    if (!required) { setState("ok"); return; }
    const key = await api<{ key: string | null }>("/staff/push/public-key");
    if (key.ok && !key.data?.key) { setState("ok"); return; } // the server cannot push yet - never hold anyone
    const d = await devicePushStatus();
    setState(d === "on" ? "ok" : d);
    if (d === "on") onOn?.();
  }, [required, onOn]);
  useEffect(() => {
    void check();
    const again = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, [check]);
  return { state, check, setState };
}

export function PushGate({ state, check, onOn }: { state: DevicePush; check: () => Promise<void>; onOn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const turnOn = async () => {
    setBusy(true); setNote("");
    const r = await enablePush();
    setBusy(false);
    if (r === "ok") { onOn(); await check(); return; }
    if (r === "denied") { await check(); return; }
    if (r === "unconfigured") { await check(); return; }
    setNote(L("It did not switch on. Check the connection and try again.", "Ia tidak dihidupkan. Semak sambungan dan cuba lagi."));
  };
  const ios = isIos();
  const steps: string[] = state === "unsupported"
    ? (ios && !isStandalone()
      ? [L("Tap the Share button in Safari.", "Tekan butang Kongsi dalam Safari."),
        L("Choose \"Add to Home Screen\", then Add.", "Pilih \"Tambah ke Skrin Utama\", kemudian Tambah."),
        L("Open A2Z from the new icon on your Home Screen and sign in there.", "Buka A2Z daripada ikon baharu pada Skrin Utama anda dan log masuk di sana.")]
      : [L("This browser cannot receive alerts (an app's built-in browser often cannot).", "Pelayar ini tidak boleh menerima makluman (pelayar dalam aplikasi selalunya tidak boleh)."),
        L("Open the portal in Chrome, Safari or Edge instead.", "Buka portal dalam Chrome, Safari atau Edge.")])
    : state === "denied"
      ? (ios
        ? [L("Open the iPhone Settings app, then Notifications.", "Buka aplikasi Tetapan iPhone, kemudian Pemberitahuan."),
          L("Choose A2Z and switch Allow Notifications on.", "Pilih A2Z dan hidupkan Benarkan Pemberitahuan."),
          L("Come back here and tap Check again.", "Kembali ke sini dan tekan Semak semula.")]
        : [L("Tap the icon at the left of the address bar (or the browser's site settings).", "Tekan ikon di kiri bar alamat (atau tetapan laman pelayar)."),
          L("Set Notifications to Allow.", "Tetapkan Pemberitahuan kepada Benarkan."),
          L("Come back here and tap Check again.", "Kembali ke sini dan tekan Semak semula.")])
      : [];
  return (
    <div className={css.stepUp} data-testid="push-gate" data-state={state}>
      <div className={card}>
        <h1 className={css.stepUpTitle}>{L("Turn on alerts to continue", "Hidupkan makluman untuk meneruskan")}</h1>
        <p className={css.stepUpText}>
          {L("A2Z sends every update to staff as a push alert - approvals, tasks, leave, claims and shift reminders. Push alerts must be on for this device before you can use the portal.",
            "A2Z menghantar setiap kemas kini kepada kakitangan sebagai makluman push - kelulusan, tugasan, cuti, tuntutan dan peringatan syif. Makluman push mesti dihidupkan untuk peranti ini sebelum anda boleh menggunakan portal.")}
        </p>
        {state === "off" && (
          <button type="button" className={btnClass} disabled={busy} onClick={() => void turnOn()} data-testid="push-gate-on">
            {busy ? L("Turning on...", "Menghidupkan...") : L("Turn on push alerts", "Hidupkan makluman push")}
          </button>
        )}
        {steps.length > 0 && (
          <>
            <p className={css.stepUpText}><strong>{state === "denied" ? L("Alerts are blocked on this device. To allow them:", "Makluman disekat pada peranti ini. Untuk membenarkannya:") : L("This browser cannot receive alerts. To fix it:", "Pelayar ini tidak boleh menerima makluman. Untuk membaikinya:")}</strong></p>
            <ol className={css.stepUpText} data-testid="push-gate-steps">{steps.map((s, i) => <li key={s}>{`${i + 1}. ${s}`}</li>)}</ol>
            <button type="button" className={btnClass} onClick={() => void check()} data-testid="push-gate-check">{L("Check again", "Semak semula")}</button>
          </>
        )}
        {note && <p className={css.stepUpText} role="alert">{note}</p>}
        <div className={css.stepUpFoot}>
          <button type="button" className={css.quietLink} onClick={() => { void signOutRequest().then(() => { window.location.href = "/login"; }); }}>
            {L("Sign out", "Log keluar")}
          </button>
        </div>
      </div>
    </div>
  );
}
