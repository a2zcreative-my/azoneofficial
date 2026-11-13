/* v1.294.0 - On Shift v2.0, Release 1 (CEO directive 12-11-2026, "approve
   continuously" 13-11-2026).

   WHERE A PUNCH WAS, AS A WORD. Every punch already stores its own `gps`
   text since v1.18.1 ("lat,lng,acc", or "no_location:<why>" since v1.25.3)
   and the office fence lives in system_meta. This turns the two into the
   verification outcome the On Shift page shows, on the server, so the page
   receives a status, a distance and an accuracy and NEVER the coordinates.

   The rule is the punch gate's own (staff.ts gateGeofence and the
   "Check my location" route): a punch is outside when it is further than the
   radius plus a grace of the reported accuracy, capped at 150 m. Nothing
   here refuses or flags a punch; it only reads what was stored.

   One honest addition, written down for the CEO: a punch inside the fence
   whose reported accuracy is WIDER than the fence itself is "low_accuracy",
   not "verified" - the reading cannot tell inside from outside. Management's
   allow-but-flag rule is unchanged: low accuracy is not a flag.

   Read-time, like the v1.21.0 flag: it judges against the CURRENT fence.
   Freezing the verdict at punch time needs the punch_locations table
   (Release 2, a migration the CEO approves separately). */

export interface FenceLite { lat: number; lng: number; radius_m: number; label: string }

/** verified - inside the fence with a usable reading
    outside - beyond radius + min(accuracy, 150) m
    low_accuracy - inside only because the reading is wider than the fence
    recorded - a position was stored but no fence is set to judge it
    denied - the browser refused location (the punch was still taken)
    unavailable - no fix: timeout, no GPS, unsupported, or a blocked build
    none - nothing stored (punches older than the v1.18.1 requirement) */
export type LocStatus = "verified" | "outside" | "low_accuracy" | "recorded" | "denied" | "unavailable" | "none";

export interface LocOutcome { status: LocStatus; distance_m: number | null; accuracy_m: number | null }

/** The same pattern the punch gate accepts. */
export const GPS_TEXT = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?$/;

/** The grace cap the gate applies to a reported accuracy. */
export const ACCURACY_GRACE_CAP_M = 150;

/** CEO, COO and CCO are exempt from the outside FLAG (CEO, v1.21.0); their
    location is still captured and its outcome still shown to them. */
export const LOC_FLAG_EXEMPT_ROLES: readonly string[] = ["ceo", "coo", "cco"];

/** Great-circle distance in metres (haversine - plenty for a 100 m fence). */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function locOutcome(gps: string | null | undefined, fence: FenceLite | null): LocOutcome {
  const raw = typeof gps === "string" ? gps.trim() : "";
  if (!raw) return { status: "none", distance_m: null, accuracy_m: null };
  if (raw.startsWith("no_location:")) {
    const why = raw.slice("no_location:".length);
    return { status: why === "denied" ? "denied" : "unavailable", distance_m: null, accuracy_m: null };
  }
  const m = GPS_TEXT.exec(raw);
  const plat = m ? Number(m[1]) : NaN;
  const plng = m ? Number(m[2]) : NaN;
  if (!m || !(plat >= -90 && plat <= 90) || !(plng >= -180 && plng <= 180)) {
    return { status: "none", distance_m: null, accuracy_m: null };
  }
  const acc = m[3] !== undefined ? Number(m[3]) : null;
  const accuracy_m = acc === null ? null : Math.round(acc);
  if (!fence) return { status: "recorded", distance_m: null, accuracy_m };
  const dist = haversineM(plat, plng, fence.lat, fence.lng);
  const grace = acc === null ? 0 : Math.min(acc, ACCURACY_GRACE_CAP_M);
  const distance_m = Math.round(dist);
  if (dist > fence.radius_m + grace) return { status: "outside", distance_m, accuracy_m };
  if (acc !== null && acc > fence.radius_m) return { status: "low_accuracy", distance_m, accuracy_m };
  return { status: "verified", distance_m, accuracy_m };
}
