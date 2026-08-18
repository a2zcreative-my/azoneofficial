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

const PREFIX = "azone-cache:";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 120_000; // don't fill the device with giant payloads

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

function writeCache<T>(path: string, data: T): void {
  try {
    const raw = JSON.stringify({ t: Date.now(), d: data });
    if (raw.length > MAX_BYTES) return;
    window.localStorage.setItem(keyFor(path), raw);
  } catch {
    /* quota or private mode — caching is an optimisation, never a requirement */
  }
}

export interface CachedState<T> {
  /** Last known data (from cache) or fresh data. null = nothing yet → skeleton. */
  data: T | null;
  /** True while showing remembered data with a refresh in flight. */
  stale: boolean;
  /** True only when there is nothing to show at all (first ever load). */
  loading: boolean;
  /** Re-fetch now (after a save, or on a sync event). */
  refresh: () => void;
}

/**
 * Cache-first fetch. Renders remembered data immediately, revalidates always.
 *
 * @param path   API path, e.g. "/staff/roster" — also the cache key.
 * @param enabled  Skip entirely when false (role-gated cards).
 */
export function useCachedApi<T>(path: string | null, enabled = true): CachedState<T> {
  const [data, setData] = useState<T | null>(() => (path && enabled ? readCache<T>(path) : null));
  const [stale, setStale] = useState<boolean>(() => Boolean(path && enabled && readCache<T>(path)));
  const [loading, setLoading] = useState<boolean>(() => !(path && enabled && readCache<T>(path)));
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
      }
      setStale(false);
      setLoading(false);
    });
  }, [path, enabled]);

  useEffect(() => { run(); }, [run]);

  return { data, stale, loading, refresh: run };
}
