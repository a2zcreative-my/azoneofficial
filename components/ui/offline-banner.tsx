"use client";

/**
 * THE CONNECTION LINE — v1.105.0 (roadmap phase 03).
 *
 * v1.4.x said: "You are offline. Changes cannot be saved until connectivity
 * is restored." True then, and the worst possible thing to read in a lift
 * with a clock-in to make. Now there is an outbox (lib/outbox.ts), so the
 * line says what is actually happening, in three states:
 *
 *   offline, nothing waiting   - you are offline; anything you save is kept
 *                                on this phone
 *   offline, N waiting         - N changes kept on this phone, sending when
 *                                you are back
 *   online, N waiting          - sending N changes... (the drain is running)
 *
 * and one more, which is the honest part: a kept change the server later
 * REFUSED - an offline clock-in that turned out to be the day's second - is
 * shown here with the server's own words, until dismissed. Dropping it
 * silently would be the old failure wearing a new coat.
 *
 * Mounted in the root layout, so it is on every page. On the public site the
 * outbox scope is "anon" and the count is always zero; nothing shows unless
 * the phone is offline, exactly as before.
 */

import { useEffect, useState } from "react";
import { outboxCount, subscribeOutbox, setRefusalHandler, type Refusal } from "@/lib/outbox";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const KIND_LABEL: Record<string, [string, string]> = {
  punch: ["clock-in/out", "daftar masuk/keluar"],
  task: ["task update", "kemas kini tugasan"],
  leave: ["leave request", "permohonan cuti"],
  claim: ["claim", "tuntutan"],
  hotel_call: ["call note", "nota panggilan"],
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const myt = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${String(myt.getUTCHours()).padStart(2, "0")}:${String(myt.getUTCMinutes()).padStart(2, "0")}`;
}

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [refused, setRefused] = useState<Refusal[]>([]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    setIsOffline(!navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    let alive = true;
    const recount = () => { void outboxCount().then((n) => { if (alive) setWaiting(n); }); };
    recount();
    const unsub = subscribeOutbox(recount);
    setRefusalHandler((r) => setRefused((list) => [...list, r].slice(-5)));

    return () => {
      alive = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsub();
      setRefusalHandler(null);
    };
  }, []);

  const line = isOffline
    ? waiting > 0
      ? L(`You are offline — ${waiting} change${waiting === 1 ? "" : "s"} kept on this phone, sending when you are back.`,
          `Anda di luar talian — ${waiting} perubahan disimpan pada telefon ini, akan dihantar apabila anda kembali.`)
      : L("You are offline — anything you save is kept on this phone and sent when you are back.",
          "Anda di luar talian — apa yang anda simpan disimpan pada telefon ini dan dihantar apabila anda kembali.")
    : waiting > 0
      ? L(`Sending ${waiting} change${waiting === 1 ? "" : "s"} kept while you were offline…`,
          `Menghantar ${waiting} perubahan yang disimpan semasa anda di luar talian…`)
      : null;

  if (!line && refused.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 z-50 flex w-full flex-col items-stretch gap-px text-sm font-medium"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {line && (
        <div className={`flex items-center justify-center px-4 py-2 backdrop-blur ${isOffline ? "bg-destructive/90 text-destructive-foreground" : "bg-primary/90 text-primary-foreground"}`}
          role="status" aria-live="polite">
          {isOffline ? (
            <svg className="mr-2 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.163a1 1 0 111.414 1.414M3 3l18 18" />
            </svg>
          ) : (
            <span className="mr-2 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-current" aria-hidden />
          )}
          {line}
        </div>
      )}
      {refused.map((r, i) => (
        <div key={`${r.entry.id}-${i}`} className="bg-warning-soft text-warning flex items-start justify-between gap-3 px-4 py-2" role="alert">
          <span className="min-w-0">
            {L(`Your ${KIND_LABEL[r.entry.kind]?.[0] ?? "change"} from ${hhmm(r.entry.clientAt)} was not accepted: `,
               `${KIND_LABEL[r.entry.kind]?.[1] ?? "perubahan"} anda dari ${hhmm(r.entry.clientAt)} tidak diterima: `)}
            <span className="font-normal">{r.message}</span>
          </span>
          <button type="button" className="shrink-0 underline" onClick={() => setRefused((list) => list.filter((_, j) => j !== i))}>
            {L("Dismiss", "Tutup")}
          </button>
        </div>
      ))}
    </div>
  );
}
