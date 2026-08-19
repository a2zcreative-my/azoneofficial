"use client";

/* v1.22.7 — portal crash recovery (a staff member was locked out: her last
   tab crashed on load, the portal reopens the last tab, so every visit
   white-screened with "Application error"). Any unhandled render error now
   lands HERE instead: a branded recovery screen whose primary action clears
   the remembered tab and restarts on the Dashboard.

   v1.27.0 — the screen is A2Z CREATIVE MARKETING's, and it is bilingual now.
   It used to be the one portal surface that stayed English no matter the
   language switch, which is exactly the wrong moment to lose someone: this is
   what a BM-speaking staff member sees when the app breaks under her. Reading
   the language here is safe (an error boundary only ever renders on the
   client, so there is no prerender to mismatch). */

import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const backToDashboard = () => {
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("azone-tab:")) window.localStorage.removeItem(k);
      }
      // v1.24.0: tab memory moved to sessionStorage — clear it there too so
      // "Back to Dashboard" can never reopen a crashing tab.
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith("azone-tab:")) window.sessionStorage.removeItem(k);
      }
    } catch { /* private mode */ }
    // full reload — a clean mount on the Dashboard, nothing half-broken kept
    window.location.reload();
  };

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="border-border bg-card w-full max-w-md rounded-2xl border p-6 text-center shadow-sm">
        <p className="text-gold-deep text-[10px] font-semibold tracking-[0.25em] uppercase">A2Z CREATIVE MARKETING</p>
        <h1 className="mt-2 text-lg font-semibold">
          {L("Something went wrong on this screen", "Ada masalah pada skrin ini")}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {L(
            "A card on the page hit an error. Your data is safe — go back to the Dashboard and carry on; if this keeps happening, tell the CEO or COO which tab you clicked.",
            "Satu kad pada halaman ini mengalami ralat. Data anda selamat — kembali ke Papan Pemuka dan teruskan; jika ia berulang, beritahu CEO atau COO tab mana yang anda tekan.",
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={backToDashboard}
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            {L("Back to Dashboard", "Kembali ke Papan Pemuka")}
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="border-border rounded-lg border px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            {L("Try again", "Cuba lagi")}
          </button>
        </div>
        {error?.message && (
          <p className="text-muted-foreground/70 mt-4 text-[10px] break-words">
            {L("Detail for support:", "Butiran untuk sokongan:")} {error.message.slice(0, 160)}
          </p>
        )}
      </div>
    </div>
  );
}
