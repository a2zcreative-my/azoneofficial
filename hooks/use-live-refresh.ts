"use client";

/**
 * v1.65.0 — the two lines that make a card live.
 *
 *   const load = useCallback(async () => { … }, []);
 *   useEffect(() => { void load(); }, [load]);
 *   useLiveRefresh(["tasks"], load);          // <- this
 *
 * That is the whole integration. A card keeps its own loader, its own
 * endpoint and its own permissions; this only decides WHEN to call it.
 */

import { useEffect, useRef } from "react";
import { getVersion, subscribeVersions } from "@/lib/live";

export function useLiveRefresh(
  topics: string[],
  reload: () => void | Promise<void>,
  enabled = true,
): void {
  /* The array is rebuilt on every render at almost every call site, so the
     effect keys off its contents rather than its identity. Otherwise this
     resubscribes forever and the baseline below never settles. */
  const key = topics.join(",");

  /* The latest loader, without making it an effect dependency. A card's
     loader is often recreated each render; re-subscribing for that would
     reset the baseline and lose the very change it was waiting for. */
  const cb = useRef(reload);
  cb.current = reload;

  useEffect(() => {
    if (!enabled) return;
    const list = key.split(",").filter(Boolean);
    if (list.length === 0) return;

    /* The FIRST observation is a baseline, never a reload. The card has just
       mounted and fetched for itself; reloading because it saw a number for
       the first time would double every card's traffic on every page load. */
    const seen: Record<string, number> = {};
    for (const t of list) seen[t] = getVersion(t);

    return subscribeVersions(() => {
      /* Hidden tabs do not refetch, and — this is the important half — they
         do not CONSUME the change either. `seen` is left alone, so the card
         is still owed a reload when the tab comes back; the portal shell
         pokes the store on visibility and this runs again for real. A phone
         in a pocket costs nothing and still shows the truth when it is
         taken out. */
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      let changed = false;
      for (const t of list) {
        const now = getVersion(t);
        if (now !== seen[t]) {
          seen[t] = now;
          changed = true;
        }
      }
      if (changed) void cb.current();
    });
  }, [key, enabled]);
}
