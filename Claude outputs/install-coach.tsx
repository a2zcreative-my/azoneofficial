"use client";

/**
 * INSTALL COACHING — v1.105.0 (roadmap phase 03).
 *
 * The portal has been installable since v1.4.49, and on Android the browser
 * says so. On an iPhone it says nothing: Safari has no install prompt, and
 * Web Push on iOS works ONLY once the site is on the Home Screen. So the two
 * features this phase most wants a phone to have - the outbox surviving a
 * closed tab, and a tap on a notification landing on the right tab - are
 * both a Share-sheet away from an iPhone user who was never told.
 *
 * One card, once. Shown only when all of these are true: the device is iOS,
 * the browser is Safari (Chrome on iOS cannot install a PWA at all), the
 * page is NOT already running standalone, and the person has not dismissed
 * it before. Dismissal is remembered per device in localStorage and is
 * final - nagging is how people learn to dismiss without reading.
 */

import { useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const KEY = "azone-install-coach-dismissed";

function shouldCoach(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (window.localStorage.getItem(KEY)) return false;
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIOS) return false;
    /* Chrome, Firefox and Edge on iOS carry these markers; only Safari proper
       can add a PWA to the Home Screen. */
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    if (!isSafari) return false;
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    return !standalone;
  } catch {
    return false;
  }
}

export function InstallCoach() {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(shouldCoach()); }, []);
  if (!show) return null;
  const dismiss = () => {
    try { window.localStorage.setItem(KEY, new Date().toISOString()); } catch { /* private mode */ }
    setShow(false);
  };
  return (
    <div className={`${card} border-primary/30 relative`} role="note">
      <div className="flex items-start gap-3">
        <span aria-hidden className="bg-primary text-primary-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg">
          ⬇
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{L("Put A2Z on your Home Screen", "Letakkan A2Z pada Skrin Utama anda")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Tap the Share button (the square with an arrow), then “Add to Home Screen”. It opens like an app, keeps your clock-ins if the signal drops, and notifications only work once it is installed.",
               "Tekan butang Kongsi (kotak dengan anak panah), kemudian “Tambah ke Skrin Utama”. Ia dibuka seperti aplikasi, menyimpan daftar masuk anda jika isyarat hilang, dan pemberitahuan hanya berfungsi selepas dipasang.")}
          </p>
        </div>
        <button type="button" className="text-muted-foreground shrink-0 text-xs underline" onClick={dismiss}>
          {L("Got it", "Faham")}
        </button>
      </div>
    </div>
  );
}
