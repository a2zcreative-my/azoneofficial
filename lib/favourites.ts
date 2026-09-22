/**
 * PINNED MODULES — v1.175.0.
 *
 * Six modules a person chooses to keep within one tap. This is NOT a second
 * navigation system: it is a preference that the navigation the portal
 * already has reads. The pins drive the phone's bottom bar
 * (lib/portal-tabs.ts `mobileNavStops`), open a Pinned group at the top of
 * the command palette, and are toggled from the More sheet — the three
 * surfaces that already list modules. Nothing new appears anywhere.
 *
 * THREE RULES THIS FILE EXISTS TO KEEP:
 *
 * 1. PER ACCOUNT. The key carries the user id, so a shared office PC cannot
 *    show one person's pins to the next person who signs in. The retired
 *    `azone-tab:{id}` localStorage scheme (purged in app/portal/page.tsx) is
 *    why the convention is spelled this way.
 * 2. PERMISSIONS DECIDE, NOT THE DEVICE. A pin is remembered on the device
 *    and can therefore outlive the access that justified it. `readFavourites`
 *    never returns a tab the caller's own permission-filtered list does not
 *    contain, exactly as the command palette already clamps its recents. The
 *    stored list is left alone — access restored later brings the pin back
 *    rather than silently losing it.
 * 3. THE ORDER IS THE PERSON'S. Pins are kept in the order they were added,
 *    not re-sorted into registry order, because "first" is the whole point.
 *
 * Storage is best-effort: a private window, cleared site data or a quota
 * error must cost the pins, never the portal. Every read and write is
 * wrapped, and the callers all have a sensible default when there is nothing.
 */

export const FAVOURITES_MAX = 6;

const keyFor = (userId: number | null | undefined): string | null =>
  userId == null || !Number.isFinite(userId) ? null : `azone-pinned:${userId}`;

/* Same shape as the palette's recents (components/layout/command-palette.tsx):
   a module-level listener set plus the `storage` event, so two tabs of the
   portal agree and React re-renders through useSyncExternalStore. */
const listeners = new Set<() => void>();

function raw(userId: number | null | undefined): string {
  const k = keyFor(userId);
  if (!k || typeof localStorage === "undefined") return "[]";
  try {
    return localStorage.getItem(k) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The stored list, unfiltered. Callers that render should use `readFavourites`. */
export function storedFavourites(userId: number | null | undefined): string[] {
  return parse(raw(userId)).slice(0, FAVOURITES_MAX);
}

/**
 * The pins this person may actually open, in their order.
 * `allowed` is the caller's own permission-filtered tab list — the same array
 * the shell computes with `canSeeTab`, so there is one source of truth for
 * access and this file re-derives none of it.
 */
export function readFavourites(userId: number | null | undefined, allowed: readonly string[]): string[] {
  const permitted = new Set(allowed);
  return storedFavourites(userId).filter((t) => permitted.has(t));
}

export function isPinned(userId: number | null | undefined, tab: string): boolean {
  return storedFavourites(userId).includes(tab);
}

/** Add at the end (the order is the person's), or remove. Returns the new stored list. */
export function toggleFavourite(userId: number | null | undefined, tab: string): string[] {
  const k = keyFor(userId);
  const current = storedFavourites(userId);
  const next = current.includes(tab)
    ? current.filter((t) => t !== tab)
    : [...current, tab].slice(0, FAVOURITES_MAX);
  if (k && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(k, JSON.stringify(next));
    } catch {
      /* a convenience, not state: a full quota costs the pin, not the tap */
    }
  }
  listeners.forEach((fn) => fn());
  return next;
}

/** True when another pin would be refused — so the button can say so before it is pressed. */
export function favouritesFull(userId: number | null | undefined, tab: string): boolean {
  const current = storedFavourites(userId);
  return current.length >= FAVOURITES_MAX && !current.includes(tab);
}

export function subscribeFavourites(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== "undefined") window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", cb);
  };
}

/** Server snapshot for useSyncExternalStore: no device, no pins. */
export function favouritesServerSnapshot(): string {
  return "[]";
}

/** Client snapshot for useSyncExternalStore — a stable string, so React can compare it. */
export function favouritesSnapshot(userId: number | null | undefined): string {
  return raw(userId);
}
