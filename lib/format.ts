/**
 * v1.4.254 — dates and money, in one file.
 *
 * `dmy` was defined identically in four files and `mytToday` in two. Identical
 * today; one edit away from a portal that shows 06-08-2026 in one card and
 * 2026-08-06 in the next.
 *
 * House rules baked in here so no caller has to remember them:
 *   · display is always DD-MM-YYYY (the database keeps ISO)
 *   · every time shown is Malaysia time (+8), never the device clock
 *   · money is sen in, RM out, always two decimals
 */

/** ISO date (or datetime) → DD-MM-YYYY. Empty in, empty out. */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  return `${d[2]}-${d[1]}-${d[0]}`;
}

/** A stored UTC timestamp → DD-MM-YYYY HH:MM in Malaysia time. */
export function dmyMYT(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return dmy(iso);
  const s = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)}`;
}

/** Today in Malaysia as YYYY-MM-DD — for date inputs and their `max`. */
export function mytToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

/** A stored UTC timestamp → the MYT calendar day it falls on (YYYY-MM-DD). */
export function mytDateOf(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z")
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

/** Sen → "1,234.56". No currency symbol: callers put "RM" where it belongs. */
export function rm(cents: number): string {
  return (cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Sen → "RM 1,234.56". */
export function fmtRM(cents: number): string {
  return `RM ${rm(cents)}`;
}
