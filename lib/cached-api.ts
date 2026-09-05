"use client";

/* v1.25.0 — remember-the-last-view (the "Threads trick").
 *
 * A card that has been seen before should NEVER show a skeleton again: it
 * paints its last known data instantly, then quietly refreshes and swaps in
 * the new numbers. Only the first-ever load of a card shows a skeleton.
 *
 * CEO's decision on staleness: instant everywhere, but MONEY says so — the
 * hook reports `stale` while the refresh is in flight, and financial cards
 * render <StaleHint/> ("updating…") until fresh figures land, so nobody acts
 * on a number that is a few minutes old.
 *
 * Storage rules:
 *  - localStorage, so it survives closing the browser (cold opens are
 *    instant too, which sessionStorage could not do).
 *  - 24-hour ceiling: anything older is ignored and refetched normally.
 *  - Namespaced PER USER — a shared phone must never flash one account's
 *    figures at another. clearApiCache() runs on sign-out and whenever a
 *    different account is seen.
 *  - Every access is wrapped: private mode, full quota and corrupt JSON all
 *    degrade to "no cache", never to a broken page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/use-live-refresh";

const PREFIX = "azone-cache:";
const TTL_MS = 24 * 60 * 60 * 1000;
/* v1.104.0 (roadmap phase 02) - 120 KB was chosen for a handful of dashboard
   figures. It silently refused the views that would gain most from being
   remembered: the whole hotel directory (442 hotels with their contacts is
   ~230 KB of JSON) and a month of web orders. The ceiling is now 400 KB per
   entry, and a write that trips the browser quota evicts the OLDEST entries
   and tries once more rather than giving up - so the cache degrades to
   "remembers less" instead of "remembers nothing" as it fills. */
const MAX_BYTES = 400_000;

let scope = "anon"; // set to the signed-in user id

/**
 * Point the cache at an account.
 *
 * Isolation comes from the KEY (azone-cache:{account}:{path}) — one account
 * can never read another's entries. So this only wipes on a genuine account
 * SWITCH on the same device.
 *
 * The subtle bug this guards against: every page load starts at "anon" and
 * then learns the real id from /auth/me. Treating that as a switch wiped the
 * cache on every single load — remembered data never survived a refresh,
 * which is the whole point of it.
 */
export function setCacheScope(userId: number | string | null): void {
  const next = userId == null ? "anon" : String(userId);
  scope = next;
  try {
    const lastKey = `${PREFIX}account`;
    const prev = window.localStorage.getItem(lastKey);
    if (next !== "anon") {
      if (prev && prev !== next) clearApiCache(); // a different person signed in here
      window.localStorage.setItem(lastKey, next);
    }
  } catch { /* private mode */ }
}

export function clearApiCache(): void {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) window.localStorage.removeItem(k);
    }
  } catch { /* private mode */ }
}

function keyFor(path: string): string {
  return `${PREFIX}${scope}:${path}`;
}

/** Low-level read — for cards whose shape does not fit the hook. */
export function cacheRead<T>(path: string): T | null {
  return readCache<T>(path);
}

/** Low-level write — pair with cacheRead. */
export function cacheWrite<T>(path: string, data: T): void {
  writeCache<T>(path, data);
}

function readCache<T>(path: string): T | null {
  try {
    const raw = window.localStorage.getItem(keyFor(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; d: T };
    if (!parsed || typeof parsed.t !== "number") return null;
    if (Date.now() - parsed.t > TTL_MS) {
      window.localStorage.removeItem(keyFor(path));
      return null;
    }
    return parsed.d;
  } catch {
    return null;
  }
}

/** Oldest first: every entry of ours, with the time it was written. */
function ourEntries(): { key: string; t: number }[] {
  const out: { key: string; t: number }[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(PREFIX) || k === `${PREFIX}account`) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(k) ?? "") as { t?: number };
        out.push({ key: k, t: typeof parsed?.t === "number" ? parsed.t : 0 });
      } catch { out.push({ key: k, t: 0 }); }
    }
  } catch { /* private mode */ }
  return out.sort((a, b) => a.t - b.t);
}

function writeCache<T>(path: string, data: T): void {
  let raw: string;
  try {
    raw = JSON.stringify({ t: Date.now(), d: data });
  } catch { return; }
  if (raw.length > MAX_BYTES) return;
  try {
    window.localStorage.setItem(keyFor(path), raw);
    return;
  } catch {
    /* quota (or private mode, in which case the retry fails the same way and
       we stop). Make room by forgetting the oldest views first - the ones
       least likely to be opened next - then try exactly once more. */
  }
  try {
    let freed = 0;
    for (const e of ourEntries()) {
      if (e.key === keyFor(path)) continue;
      freed += (window.localStorage.getItem(e.key) ?? "").length;
      window.localStorage.removeItem(e.key);
      if (freed >= raw.length * 2) break;
    }
    window.localStorage.setItem(keyFor(path), raw);
  } catch {
    /* still no room, or private mode - caching is an optimisation, never a requirement */
  }
}

export interface CachedState<T> {
  /** Last known data (from cache) or fresh data. null = nothing yet → skeleton. */
  data: T | null;
  /** True while showing remembered data with a refresh in flight. */
  stale: boolean;
  /** True only when there is nothing to show at all (first ever load). */
  loading: boolean;
  /** v1.104.0 - the most recent fetch did not succeed. With `data` still set
      the card is showing remembered figures it could not refresh; with `data`
      null there is nothing to show and the card should say why. */
  failed: boolean;
  /** Re-fetch now (after a save, or on a sync event). */
  refresh: () => void;
}

/**
 * Cache-first fetch. Renders remembered data immediately, revalidates always.
 *
 * @param path   API path, e.g. "/staff/roster" — also the cache key.
 * @param enabled  Skip entirely when false (role-gated cards).
 */
/**
 * v1.104.0 - `topics`: the live-version topics (lib/live.ts) this view
 * depends on. When one moves, the card refetches through this same hook, so
 * a remembered view is never stale for longer than the SSE stream takes to
 * say so. Optional, because not every endpoint has a topic yet.
 */
export function useCachedApi<T>(path: string | null, enabled = true, topics: string[] = []): CachedState<T> {
  const [data, setData] = useState<T | null>(() => (path && enabled ? readCache<T>(path) : null));
  const [stale, setStale] = useState<boolean>(() => Boolean(path && enabled && readCache<T>(path)));
  const [loading, setLoading] = useState<boolean>(() => !(path && enabled && readCache<T>(path)));
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(() => {
    if (!path || !enabled) { setLoading(false); setStale(false); return; }
    const cached = readCache<T>(path);
    if (cached !== null) { setData(cached); setStale(true); setLoading(false); }
    else { setLoading(true); }
    void api<T>(path).then((r) => {
      if (!alive.current) return;
      if (r.ok && r.data != null) {
        setData(r.data);
        writeCache(path, r.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setStale(false);
      setLoading(false);
    });
  }, [path, enabled]);

  useEffect(() => { run(); }, [run]);
  useLiveRefresh(topics, run, enabled && Boolean(path));

  return { data, stale, loading, failed, refresh: run };
}
