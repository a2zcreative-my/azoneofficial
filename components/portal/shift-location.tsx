"use client";

/* v1.294.0 - ON SHIFT v2.0, RELEASE 1 (CEO directive "A2Z OS - ON SHIFT
   v2.0", 12-11-2026; "approve continuously", 13-11-2026; decision O3: a
   drawn diagram, no third-party map and no key).

   WHERE A PUNCH WAS. This file only DRAWS, like on-shift.tsx: it makes no
   request and never punches. Every value is handed in by the On Shift page
   from responses it already reads:

     the outcome of a punch   GET /staff/attendance - each record carries the
                              server's verdict (worker/src/punch-location.ts):
                              a status word, the distance and the reported
                              accuracy. The coordinates are never sent.
     the site                 GET /staff/attendance/geofence - its label and
                              radius (coordinates go only to geofence admins)
     the check                POST /staff/attendance/geofence/check - the
                              existing "Check my location" mirror

   The diagram is drawn to scale by DISTANCE only. The page is not given the
   direction of a punch from the site, so it does not pretend to know it: the
   punch is placed on one axis and the caption says so. No map tiles, no
   third party, no key, nothing about a person's position leaves the page. */

import { useState, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { L, type LocOutcome, type LocStatus } from "@/components/portal/page-shared";
import { PunchMap, type MapPoint } from "@/components/portal/punch-map";
import { chipDanger, chipInfo, chipNeutral, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, chipSuccess, chipWarn } from "@/lib/ui-styles";
import css from "./shift-location.module.css";

/* ------------------------------------------------------------------ */
/* the words                                                           */
/* ------------------------------------------------------------------ */

type Tone = "success" | "warn" | "danger" | "neutral" | "info";
const CHIP: Record<Tone, string> = { success: chipSuccess, warn: chipWarn, danger: chipDanger, neutral: chipNeutral, info: chipInfo };
const CHIP_SM: Record<Tone, string> = { success: chipSmSuccess, warn: chipSmWarn, danger: chipSmDanger, neutral: chipSmNeutral, info: chipSmInfo };

const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** A location outcome in words. `exempt`: CEO, COO and CCO are not flagged
    for being outside (CEO, v1.21.0) - their location is still recorded and
    said plainly, never coloured as a fault. `pending`: a punch held on this
    phone, which the server has not judged yet. */
export function locWord(loc: LocOutcome | null | undefined, exempt = false, pending = false): { long: string; short: string; tone: Tone } {
  if (pending) return { long: L("Verification pending", "Pengesahan belum selesai"), short: L("Pending", "Belum selesai"), tone: "info" };
  if (!loc) return { long: L("No punch yet", "Belum ada punch"), short: "—", tone: "neutral" };
  const d = loc.distance_m;
  const W: Record<LocStatus, () => { long: string; short: string; tone: Tone }> = {
    verified: () => ({ long: L("Within geofence", "Dalam geofence"), short: L("Verified", "Disahkan"), tone: "success" }),
    outside: () => exempt
      ? { long: L(`Outside geofence${d !== null ? ` (${metres(d)})` : ""} · recorded, not flagged`, `Luar geofence${d !== null ? ` (${metres(d)})` : ""} · direkod, tidak ditanda`), short: L(`Recorded${d !== null ? ` · ${metres(d)}` : ""}`, `Direkod${d !== null ? ` · ${metres(d)}` : ""}`), tone: "neutral" }
      : { long: L(`Outside geofence${d !== null ? ` (${metres(d)})` : ""}`, `Luar geofence${d !== null ? ` (${metres(d)})` : ""}`), short: L(`Outside${d !== null ? ` (${metres(d)})` : ""}`, `Luar${d !== null ? ` (${metres(d)})` : ""}`), tone: "danger" },
    low_accuracy: () => ({ long: L("Low GPS accuracy", "Ketepatan GPS rendah"), short: L("Low accuracy", "Ketepatan rendah"), tone: "warn" }),
    recorded: () => ({ long: L("Location recorded · no geofence set", "Lokasi direkod · tiada geofence"), short: L("Recorded", "Direkod"), tone: "neutral" }),
    denied: () => ({ long: L("Location permission denied", "Kebenaran lokasi ditolak"), short: L("Denied", "Ditolak"), tone: exempt ? "neutral" : "warn" }),
    unavailable: () => ({ long: L("GPS unavailable", "GPS tidak tersedia"), short: L("No GPS", "Tiada GPS"), tone: exempt ? "neutral" : "warn" }),
    none: () => ({ long: L("No location stored", "Tiada lokasi disimpan"), short: L("No location", "Tiada lokasi"), tone: "neutral" }),
  };
  return W[loc.status]();
}

/** Whether a punch's outcome is one management reviews (the allow-but-flag
    rule: outside, or no location at all). Low accuracy is not a flag. */
export const locFlagged = (loc: LocOutcome | null | undefined, exempt = false): boolean =>
  !!loc && !exempt && (loc.status === "outside" || loc.status === "denied" || loc.status === "unavailable" || loc.status === "none");

export function LocChip({ loc, exempt = false, pending = false, small = false, long = false }: {
  loc: LocOutcome | null | undefined; exempt?: boolean; pending?: boolean; small?: boolean; long?: boolean;
}) {
  const w = locWord(loc, exempt, pending);
  const ok = w.tone === "success";
  return (
    <span className={(small ? CHIP_SM : CHIP)[w.tone]} data-loc={pending ? "pending" : loc?.status ?? "nopunch"}>
      {ok && <AppIcon name="success" />}{long ? w.long : w.short}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* the diagram                                                         */
/* ------------------------------------------------------------------ */

const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];

/** The site, its fence and the punch, to scale by distance. No tiles and no
    coordinates: the page knows how far, not which way. */
export function FenceDiagram({ radius, distance, accuracy, outside, siteLabel }: {
  radius: number;
  /** metres from the site, or null when no punch location is known */
  distance: number | null;
  accuracy: number | null;
  outside: boolean;
  siteLabel: string;
}) {
  const [zoom, setZoom] = useState(0);
  const W = 360, H = 232, cx = 150, cy = 118, R = 96;
  const reach = distance === null ? 0 : distance + Math.min(accuracy ?? 0, Math.max(distance, radius));
  const fit = Math.max(radius * 1.3, reach * 1.12, 20);
  const span = fit / Math.pow(1.6, zoom); // metres shown across R pixels
  const k = R / span;
  const fenceR = radius * k;
  const rawX = distance === null ? null : distance * k;
  const maxX = W - cx - 22;
  const clamped = rawX !== null && rawX > maxX;
  const px = rawX === null ? null : cx + Math.min(rawX, maxX);
  const accR = accuracy !== null && px !== null ? Math.min(accuracy * k, 220) : 0;
  const bar = NICE.find((n) => n * k >= 48) ?? NICE[NICE.length - 1]!;
  const barW = Math.min(bar * k, 140);
  const grid: number[] = [];
  for (let g = 24; g < Math.max(W, H); g += 24) grid.push(g);
  return (
    <figure className={css.diagram} data-testid="fence-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" className={css.svg}
        aria-label={distance === null
          ? L(`Site ${siteLabel} with a ${radius} metre geofence. No punch location recorded.`, `Tapak ${siteLabel} dengan geofence ${radius} meter. Tiada lokasi punch direkod.`)
          : L(`Site ${siteLabel}, geofence ${radius} metres. Your punch was ${distance} metres away${outside ? ", outside the geofence" : ", within the geofence"}.`,
              `Tapak ${siteLabel}, geofence ${radius} meter. Punch anda ${distance} meter dari tapak${outside ? ", di luar geofence" : ", dalam geofence"}.`)}>
        <rect x="0" y="0" width={W} height={H} className={css.ground} />
        {grid.map((g) => <line key={`v${g}`} x1={g} y1="0" x2={g} y2={H} className={css.gridLine} />)}
        {grid.filter((g) => g < H).map((g) => <line key={`h${g}`} x1="0" y1={g} x2={W} y2={g} className={css.gridLine} />)}
        <circle cx={cx} cy={cy} r={fenceR} className={css.fence} />
        {px !== null && (
          <>
            <line x1={cx} y1={cy} x2={px} y2={cy} className={outside ? css.reachOut : css.reach} />
            {accR > 0 && <circle cx={px} cy={cy} r={accR} className={css.accuracy} />}
            <circle cx={px} cy={cy} r="9" className={css.punchHalo} />
            <circle cx={px} cy={cy} r="6" className={outside ? css.punchOut : css.punch} />
            {clamped && <path d={`M ${px + 10} ${cy - 6} L ${px + 17} ${cy} L ${px + 10} ${cy + 6}`} className={css.beyond} />}
          </>
        )}
        {/* the site: a gold pin standing on the centre */}
        <path d={`M ${cx} ${cy} C ${cx - 4} ${cy - 10} ${cx - 11} ${cy - 15} ${cx - 11} ${cy - 23} A 11 11 0 1 1 ${cx + 11} ${cy - 23} C ${cx + 11} ${cy - 15} ${cx + 4} ${cy - 10} ${cx} ${cy} Z`} className={css.site} />
        <circle cx={cx} cy={cy - 23} r="4" className={css.siteDot} />
        <rect x="14" y={H - 22} width={barW} height="4" rx="2" className={css.scaleBar} />
        <text x="14" y={H - 28} className={css.scaleText}>{metres(bar)}</text>
      </svg>
      <div className={css.zoom} role="group" aria-label={L("Diagram zoom", "Zum rajah")}>
        <button type="button" onClick={() => setZoom((z) => Math.min(z + 1, 6))} aria-label={L("Zoom in", "Zum masuk")}>+</button>
        <button type="button" onClick={() => setZoom((z) => Math.max(z - 1, -4))} aria-label={L("Zoom out", "Zum keluar")}>−</button>
        <button type="button" onClick={() => setZoom(0)} aria-label={L("Fit the site and the punch", "Muatkan tapak dan punch")}><AppIcon name="place" /></button>
      </div>
      <ul className={css.legend}>
        <li><span className={css.keySite} aria-hidden />{L("Assigned location", "Lokasi ditetapkan")}</li>
        {distance !== null && <li><span className={outside ? css.keyPunchOut : css.keyPunch} aria-hidden />{L("Your punch location", "Lokasi punch anda")}</li>}
        <li><span className={css.keyFence} aria-hidden />{L(`Geofence (${radius} m radius)`, `Geofence (jejari ${radius} m)`)}</li>
      </ul>
      {distance !== null && (
        <figcaption className={css.caption}>
          {L("Drawn to scale by distance from the site. The direction of the punch is not shown, so it is placed to the right of the site.",
             "Dilukis mengikut skala jarak dari tapak. Arah punch tidak ditunjukkan, jadi ia diletakkan di sebelah kanan tapak.")}
          {clamped && <> {L("The arrow means the punch lies beyond the edge - press the location button to fit it.", "Anak panah bermaksud punch berada di luar tepi - tekan butang lokasi untuk memuatkannya.")}</>}
        </figcaption>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* the Location Verification card                                      */
/* ------------------------------------------------------------------ */

export interface LatestPunch { type: string; at: string; loc: LocOutcome; pos?: { lat: number; lng: number; acc: number | null } | null }

const mytHmLocal = (at: string) => new Date(Date.parse(`${at.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString().slice(11, 16);

export function LocationCard({ fence, fenceFailed, latest, exempt, waiting, known, mapSite = null, children }: {
  /** v1.297.0 - the site's point, sent only with the person's own day: draws the real map */
  mapSite?: MapPoint | null;
  /** the site, as GET /staff/attendance/geofence answers it; null = not read yet */
  fence: { configured: boolean; radius_m?: number; label?: string } | null;
  /** the site could not be read */
  fenceFailed: boolean;
  /** today's most recent punch with its outcome, or null */
  latest: LatestPunch | null;
  exempt: boolean;
  /** punches held on this phone, not yet judged by the server */
  waiting: number;
  known: boolean;
  /** the existing "Check my location" control and the location guidance */
  children?: ReactNode;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const configured = !!fence?.configured;
  const radius = fence?.radius_m ?? 0;
  const label = fence?.label ?? L("the office", "pejabat");
  const pending = waiting > 0;
  const head = locWord(latest?.loc ?? null, exempt, pending);
  const loc = latest?.loc ?? null;
  const hasPoint = loc !== null && loc.distance_m !== null;
  const outside = loc?.status === "outside";
  return (
    <section className={`erp-card ${css.card}`} aria-label={L("Location verification", "Pengesahan lokasi")} data-testid="location-card">
      <div className={css.head}>
        <span className={css.headIcon} aria-hidden><AppIcon name="place" /></span>
        <div className={css.headText}>
          <h3 className={css.title}>{L("Location Verification", "Pengesahan Lokasi")}</h3>
          <p className={css.sub}>{L("Work location, punch location and geofence status", "Lokasi kerja, lokasi punch dan status geofence")}</p>
        </div>
        {known && fence && (
          <span className={CHIP[head.tone]} role="status" data-testid="location-status">
            {head.tone === "success" && <AppIcon name="success" />}{head.long}
          </span>
        )}
      </div>
      {!known || (!fence && !fenceFailed) ? <SkelRows rows={4} /> : fenceFailed && !fence ? (
        <p className={css.empty} role="alert">{L("The work location could not be read. Your punches still record your location; reopen this page to try again.", "Lokasi kerja tidak dapat dibaca. Punch anda tetap merekod lokasi; buka semula halaman ini untuk cuba lagi.")}</p>
      ) : (
        <div className={css.body}>
          {configured ? (
            <div className={css.mapWrap} data-open={mapOpen ? "" : undefined}>
              <button type="button" className={css.mapToggle} aria-expanded={mapOpen} onClick={() => setMapOpen((o) => !o)}>
                <AppIcon name="place" />{mapOpen ? L("Hide the map", "Sembunyikan peta") : L("Show the map", "Tunjukkan peta")}
              </button>
              <div className={css.mapBody}>
                {mapSite && !tilesFailed ? (
                  <PunchMap site={mapSite} radius={radius} punch={latest?.pos ? { lat: latest.pos.lat, lng: latest.pos.lng } : null}
                    accuracy={latest?.pos?.acc ?? null} outside={outside} siteLabel={label} onFail={() => setTilesFailed(true)} />
                ) : (
                  <>
                    {tilesFailed && <p className={css.note} role="status">{L("The map could not load, so the distance diagram is shown instead.", "Peta tidak dapat dimuatkan, jadi rajah jarak dipaparkan.")}</p>}
                    <FenceDiagram radius={radius} distance={hasPoint ? loc!.distance_m : null} accuracy={hasPoint ? loc!.accuracy_m : null} outside={outside} siteLabel={label} />
                  </>
                )}
                {mapSite && !tilesFailed && (
                  <ul className={css.legend}>
                    <li><span className={css.keySite} aria-hidden />{L("Assigned location", "Lokasi ditetapkan")}</li>
                    {latest?.pos && <li><span className={outside ? css.keyPunchOut : css.keyPunch} aria-hidden />{L("Your punch location", "Lokasi punch anda")}</li>}
                    <li><span className={css.keyFence} aria-hidden />{L(`Geofence (${radius} m radius)`, `Geofence (jejari ${radius} m)`)}</li>
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className={css.empty}>{L("No geofence is set for the office. Your location is still recorded with every punch; management sets the geofence in Users.", "Tiada geofence ditetapkan untuk pejabat. Lokasi anda tetap direkod pada setiap punch; pengurusan menetapkan geofence dalam Pengguna.")}</p>
          )}
          <dl className={css.facts}>
            <div className={`${css.fact} ${css.factTop}`}>
              <dt><AppIcon name="store" />{L("Assigned work location", "Lokasi kerja ditetapkan")}</dt>
              <dd>{configured ? label : L("Not set", "Belum ditetapkan")}</dd>
            </div>
            <div className={css.fact}>
              <dt><AppIcon name="target" />{L("Geofence radius", "Jejari geofence")}</dt>
              <dd>{configured ? L(`${radius} metres`, `${radius} meter`) : "—"}</dd>
            </div>
            <div className={css.fact}>
              <dt><AppIcon name="place" />{L("Your distance", "Jarak anda")}</dt>
              <dd className={hasPoint ? (outside && !exempt ? css.bad : css.good) : undefined}>{hasPoint ? L(`${loc!.distance_m} metres`, `${loc!.distance_m} meter`) : "—"}</dd>
            </div>
            <div className={css.fact}>
              <dt><AppIcon name="verify" />{L("Verification", "Pengesahan")}</dt>
              <dd><LocChip loc={loc} exempt={exempt} pending={pending} small long /></dd>
            </div>
            <div className={css.fact}>
              <dt><AppIcon name="time" />{L("Location captured", "Lokasi dirakam")}</dt>
              <dd>{latest ? `${L("Today", "Hari ini")}, ${mytHmLocal(latest.at)} · ${latest.type === "clock_out" ? L("Clock out", "Daftar keluar") : L("Clock in", "Daftar masuk")}` : "—"}</dd>
            </div>
            <div className={css.fact}>
              <dt><AppIcon name="connection" />{L("GPS accuracy", "Ketepatan GPS")}</dt>
              <dd>{loc?.accuracy_m !== null && loc?.accuracy_m !== undefined ? L(`±${loc.accuracy_m} metres`, `±${loc.accuracy_m} meter`) : latest ? L("Not reported", "Tidak dilaporkan") : "—"}</dd>
            </div>
          </dl>
          {!latest && !pending && (
            <p className={css.note}>{L("No punch location is recorded today. Your location is taken only when you press Clock In or Clock Out - never in the background.",
              "Tiada lokasi punch direkod hari ini. Lokasi anda diambil hanya apabila anda menekan Daftar Masuk atau Daftar Keluar - tidak sekali-kali di latar belakang.")}</p>
          )}
          {exempt && outside && (
            <p className={css.note}>{L("Your role is not flagged for punching outside the geofence; the location is still recorded.", "Peranan anda tidak ditanda kerana punch di luar geofence; lokasi tetap direkod.")}</p>
          )}
          {children && <div className={css.check}>{children}</div>}
        </div>
      )}
    </section>
  );
}
