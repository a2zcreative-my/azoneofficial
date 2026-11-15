"use client";

/* v1.318.0 - THE CLOCK-IN / CLOCK-OUT CONFIRMATION (the CEO's picture and
   words, 15-11-2026: "update for clock in and clock out when staff click the
   button. make sure it is fit with PWA", then "A2Z OS change to my own logo.
   make it standardize").

   Two pieces, both drawn by On Shift's one punch() (dashboard.tsx):

     <PunchRecording />   while the punch is on its way: the company's logo,
                          a turning ring, "Recording attendance..."
     <PunchReceipt />     when the server has recorded it: the tick, what was
                          recorded, and Done

   NOTHING HERE IS A NEW FACT. Every figure is the server's own record of the
   punch that was just made, handed in by the caller:
     the time     the record's created_at, shown in Malaysia time
     the shift    the schedule the server judged the punch by (its hours),
                  and which shift of the day this is
     total hours  today's worked sessions (lib/clock-sessions.ts), the same
                  figure the shift timer shows
     the place    the record's own location outcome (verified / outside /
                  none) and distance - the same outcome the register shows
     recorded by  the signed-in person; a punch is always one's own

   It writes nothing and decides nothing. A punch that is waiting for the
   CEO, kept on the phone with no signal, or refused never reaches this
   sheet: those keep the words they have always had (PunchToast).

   PWA: the shared result sheet (components/ui/result-sheet.tsx) - a bottom
   sheet on a phone (full width, the home-indicator inset under Done, 44px
   targets, scrolls inside itself at any height), a centred card from 640px.
   Escape, the backdrop and the X close it; focus lands on Done. */

import { useEffect, useRef } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon } from "@/components/ui/app-icon";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ResultSheet, WaitCard } from "@/components/ui/result-sheet";
import type { LocOutcome } from "@/components/portal/page-shared";
import { locFlagged } from "@/components/portal/shift-location";
import { getLang } from "@/lib/i18n";
import css from "./punch-receipt.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface PunchReceiptData {
  type: "clock_in" | "clock_out";
  /** the record's created_at (UTC, "YYYY-MM-DD HH:MM:SS"), or the moment the server answered */
  at: string | number;
  /** the schedule the punch was judged by, and which shift of the day it is */
  shift?: { start?: string | null; end?: string | null; n: number } | null;
  /** today's worked minutes, for a clock-out */
  workedMinutes?: number | null;
  /** the record's own location outcome; undefined = not read back yet */
  loc?: LocOutcome | null;
  /** the outside flag does not apply to this person (CEO, COO, CCO) */
  exempt?: boolean;
  /** the server's verdict in words when it is not a plain on-time punch (e.g. "Marked late") */
  note?: string | null;
  /** overtime the clock-out measured, already worded */
  ot?: string | null;
}

const DAYS: [string, string][] = [["Sun", "Ahd"], ["Mon", "Isn"], ["Tue", "Sel"], ["Wed", "Rab"], ["Thu", "Kha"], ["Fri", "Jum"], ["Sat", "Sab"]];
const MONTHS: [string, string][] = [["Jan", "Jan"], ["Feb", "Feb"], ["Mar", "Mac"], ["Apr", "Apr"], ["May", "Mei"], ["Jun", "Jun"], ["Jul", "Jul"], ["Aug", "Ogo"], ["Sep", "Sep"], ["Oct", "Okt"], ["Nov", "Nov"], ["Dec", "Dis"]];

/** the instant as Malaysia wall time (UTC+8, no daylight saving) */
export function mytParts(at: string | number): { day: string; date: string; time: string } {
  const ms = typeof at === "number" ? at : Date.parse(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  const d = new Date((Number.isFinite(ms) ? ms : Date.now()) + 8 * 3600 * 1000);
  const ms2 = getLang() === "ms" ? 1 : 0;
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]![ms2]} ${d.getUTCFullYear()}`;
  return { day: DAYS[d.getUTCDay()]![ms2], date, time: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` };
}

const dist = (m: number | null) => (m == null ? "" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const hours = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min) % 60).padStart(2, "0")}m`;

/** The place band: the record's own outcome. Whether it is tagged for HR is the
    one rule the register and On Shift use (locFlagged, shift-location.tsx) -
    outside or no location, and never for the CEO, COO or CCO. */
export function placeOf(loc: LocOutcome | null | undefined, exempt: boolean): { title: string; sub: string; tone: "ok" | "warn" | "plain" } | null {
  if (loc === undefined) return null;
  const tagged = locFlagged(loc, exempt);
  const d = dist(loc?.distance_m ?? null), at = d ? ` (${d})` : "";
  const st = loc?.status ?? "none";
  const title = st === "verified" ? L(`Within Geofence${at}`, `Dalam Geofence${at}`)
    : st === "outside" ? L(`Outside Geofence${at}`, `Luar Geofence${at}`)
    : st === "low_accuracy" || st === "recorded" ? L(`Location recorded${at}`, `Lokasi direkodkan${at}`)
    : L("No location", "Tiada lokasi");
  const sub = tagged ? L("Recorded and tagged for HR", "Direkodkan dan ditanda untuk HR")
    : st === "verified" ? L("Location verified", "Lokasi disahkan")
    : st === "low_accuracy" ? L("Low GPS accuracy", "Ketepatan GPS rendah")
    : st === "recorded" ? L("No office geofence is set", "Tiada geofence pejabat ditetapkan")
    : L("Recorded, not tagged", "Direkodkan, tidak ditanda");
  return { title, sub, tone: tagged ? "warn" : st === "verified" ? "ok" : "plain" };
}

/* ------------------------------ recording ------------------------------ */

export function PunchRecording() {
  return (
    <WaitCard testid="punch-recording">
      <BrandLogo label={L("Attendance", "Kehadiran")} />
      <p className={css.waitTitle}>{L("Recording attendance…", "Merekod kehadiran…")}</p>
      <p className={css.waitSub}>{L("Please wait a moment.", "Sila tunggu sebentar.")}</p>
    </WaitCard>
  );
}

/* ------------------------------- receipt ------------------------------- */

export function PunchReceipt({ data, who, onDone }: {
  data: PunchReceiptData;
  who: { name: string; photoKey?: string | null };
  onDone: () => void;
}) {
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => { done.current?.focus(); }, []);

  const isIn = data.type === "clock_in";
  const t = mytParts(data.at);
  const place = placeOf(data.loc, data.exempt === true);
  const sh = data.shift;
  const shiftHours = sh?.start && sh?.end ? `${sh.start}–${sh.end}` : null;

  return (
    <ResultSheet titleId="punch-receipt-title" head={<BrandLogo label={L("Attendance", "Kehadiran")} />} onClose={onDone} testid="punch-receipt" kind={isIn ? "in" : "out"}>
      <div className={css.body} data-kind={isIn ? "in" : "out"}>
        <span className={css.tick} aria-hidden>
          <svg viewBox="0 0 48 48" width="48" height="48"><path d="M13 25.5l7.5 7.5L35.5 17" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <h2 id="punch-receipt-title" className={css.title}>{isIn ? L("Clock-In Recorded!", "Daftar Masuk Direkodkan!") : L("Clock-Out Recorded!", "Daftar Keluar Direkodkan!")}</h2>
        <p className={css.lead}>{isIn ? L("You have clocked in for today.", "Anda telah daftar masuk untuk hari ini.") : L("You have clocked out for today.", "Anda telah daftar keluar untuk hari ini.")}</p>
        {data.note && <p className={css.note} data-testid="punch-note">{data.note}</p>}

        <dl className={css.facts}>
          <div><dt><AppIcon name="date" />{L("Date", "Tarikh")}</dt><dd>{t.day}, {t.date}</dd></div>
          <div><dt><AppIcon name="time" />{isIn ? L("Clock-In Time", "Masa Masuk") : L("Clock-Out Time", "Masa Keluar")}</dt><dd data-testid="punch-time">{t.time} MYT</dd></div>
          {isIn
            ? <div><dt><AppIcon name="assignment" />{L("Shift", "Syif")}</dt><dd data-testid="punch-shift">{L(`Shift ${sh?.n ?? 1}`, `Syif ${sh?.n ?? 1}`)}{shiftHours && <small>{shiftHours}</small>}</dd></div>
            : <div><dt><AppIcon name="time" />{L("Total Hours", "Jumlah Jam")}</dt><dd data-testid="punch-hours">{data.workedMinutes != null ? hours(data.workedMinutes) : "—"}</dd></div>}
        </dl>

        {place && (
          <p className={css.place} data-tone={place.tone} data-testid="punch-place">
            <span className={css.pin} aria-hidden><AppIcon name="place" /></span>
            <span className={css.pair}><strong>{place.title}</strong><span>{place.sub}</span></span>
          </p>
        )}
        {data.ot && <p className={css.ot} data-testid="punch-ot"><AppIcon name="info" />{data.ot}</p>}

        <p className={css.by}>
          <Avatar name={who.name} photoKey={who.photoKey} size="lg" />
          <span className={css.pair}><strong>{L(`Recorded by ${who.name}`, `Direkodkan oleh ${who.name}`)}</strong><span>{t.date}, {t.time} MYT</span></span>
        </p>

        <button ref={done} type="button" className={css.done} onClick={onDone} data-testid="punch-done">{L("Done", "Selesai")}</button>
      </div>
    </ResultSheet>
  );
}
