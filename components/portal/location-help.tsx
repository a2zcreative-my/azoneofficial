"use client";

/* v1.25.3 — "how do I actually fix this?" for a blocked location.
 *
 * v1.25.2 started telling staff the truth ("blocked for this site") but the
 * instruction was "tap the padlock/⋮ menu" — and the staff member's phone had
 * NO ADDRESS BAR: she runs the portal as an installed home-screen app, where
 * that menu does not exist. Unfollowable advice reads as a broken system.
 *
 * So the steps are chosen from what the phone actually is: installed app vs
 * browser tab, and which browser. Everything here is detection of the CURRENT
 * device only — no data leaves the page.
 */

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";

type Ctx = "standalone" | "samsung" | "chrome" | "firefox" | "ios" | "other";

function detect(): Ctx {
  if (typeof window === "undefined") return "other";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return "standalone";
  const ua = navigator.userAgent;
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/CriOS|Chrome/i.test(ua) && !/Edg|OPR/i.test(ua)) return "chrome";
  if (/Firefox|FxiOS/i.test(ua)) return "firefox";
  if (/iPhone|iPad/i.test(ua)) return "ios";
  return "other";
}

const STEPS: Record<Ctx, { en: string[]; ms: string[] }> = {
  standalone: {
    en: [
      "You opened the portal from the home-screen icon, so there is no address bar to tap.",
      /* v1.27.0: this name must track public/manifest.json short_name — it is
         the caption Android shows for the installed app, and the rebrand moved
         it from "AZ ONE" to "A2Z Staff". A stale name here sends staff hunting
         for an entry that no longer exists on their phone. */
      "Open Android Settings → Apps → find A2Z Staff (or Samsung Internet / Chrome, whichever installed it).",
      "Tap Permissions → Location → allow it.",
      "If Location is already allowed there, open a2zcreative.my in the browser itself, allow location when it asks, then reopen the icon.",
    ],
    ms: [
      "Anda buka portal dari ikon skrin utama, jadi tiada bar alamat untuk ditekan.",
      "Buka Tetapan Android → Apl → cari A2Z Staff (atau Samsung Internet / Chrome).",
      "Tekan Kebenaran → Lokasi → benarkan.",
      "Jika sudah dibenarkan, buka a2zcreative.my dalam pelayar, benarkan lokasi, kemudian buka semula ikon.",
    ],
  },
  samsung: {
    en: [
      "Tap the ⋮ menu (bottom-right) → Settings.",
      "Sites and downloads → Site permissions → Location.",
      "Find a2zcreative.my under Blocked and move it to Allowed.",
      "Come back and tap Check my location.",
    ],
    ms: [
      "Tekan menu ⋮ (bawah kanan) → Tetapan.",
      "Sites and downloads → Site permissions → Location.",
      "Cari a2zcreative.my di bawah Blocked, pindahkan ke Allowed.",
      "Kembali dan tekan Semak lokasi saya.",
    ],
  },
  chrome: {
    en: [
      "Tap the padlock (or ⓘ) beside a2zcreative.my in the address bar.",
      "Tap Permissions → Location → Allow.",
      "Reload the page, then tap Check my location.",
    ],
    ms: [
      "Tekan ikon mangga (atau ⓘ) di sebelah a2zcreative.my pada bar alamat.",
      "Tekan Permissions → Location → Allow.",
      "Muat semula halaman, kemudian tekan Semak lokasi saya.",
    ],
  },
  firefox: {
    en: [
      "Tap the padlock beside the address → Clear permissions (or Edit site permissions).",
      "Reload the page and choose Allow when Firefox asks for location.",
    ],
    ms: [
      "Tekan ikon mangga di sebelah alamat → Clear permissions.",
      "Muat semula halaman dan pilih Allow bila Firefox bertanya.",
    ],
  },
  ios: {
    en: [
      "iPhone Settings → Privacy & Security → Location Services → Safari Websites → While Using the App, and switch Precise Location ON.",
      "In Safari on a2zcreative.my: tap AA in the address bar → Website Settings → Location → Allow.",
      "Reload, then tap Check my location.",
    ],
    ms: [
      "Tetapan iPhone → Privacy & Security → Location Services → Safari Websites → While Using the App, hidupkan Precise Location.",
      "Dalam Safari di a2zcreative.my: tekan AA → Website Settings → Location → Allow.",
      "Muat semula, kemudian tekan Semak lokasi saya.",
    ],
  },
  other: {
    en: [
      "Open your browser's site settings for a2zcreative.my (usually the padlock or ⋮ menu).",
      "Set Location to Allow, reload the page, then tap Check my location.",
      "Also check the phone's own Location switch is on.",
    ],
    ms: [
      "Buka tetapan tapak untuk a2zcreative.my dalam pelayar anda (ikon mangga atau menu ⋮).",
      "Tetapkan Lokasi kepada Allow, muat semula, kemudian tekan Semak lokasi saya.",
      "Pastikan juga suis Lokasi telefon dihidupkan.",
    ],
  },
};

/** Expandable, device-aware instructions. Renders only when asked to show. */
export function LocationHelp({ lang }: { lang: Lang }) {
  const [ctx, setCtx] = useState<Ctx>("other");
  const [open, setOpen] = useState(false);
  // detection touches window — run it after mount so the prerendered HTML and
  // the first client render agree
  useEffect(() => { setCtx(detect()); }, []);
  const steps = STEPS[ctx][lang === "ms" ? "ms" : "en"];
  return (
    <span className="mt-1 block">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="text-gold-deep text-xs font-semibold underline underline-offset-2">
        {open ? (lang === "ms" ? "Sembunyikan langkah" : "Hide the steps")
              : (lang === "ms" ? "Tunjukkan cara betulkan" : "Show me how to fix it")}
      </button>
      {open && (
        <ol className="text-muted-foreground mt-1.5 list-decimal space-y-1 pl-4 text-[11.5px] leading-snug">
          {steps.map((t, i) => <li key={i}>{t}</li>)}
        </ol>
      )}
    </span>
  );
}
