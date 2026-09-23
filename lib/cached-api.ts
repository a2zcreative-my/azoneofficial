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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/use-live-refresh";

const PREFIX = "azone-cache:";
/**
 * v1.177.2 — THE CACHE EPOCH.
 *
 * Securing an endpoint does not un-send what it already sent. Until v1.177.2
 * `GET /staff/dashboard/summary` returned the month's cash in and cash out to
 * every staff role, and `components/portal/trading-desk.tsx` fetched it
 * UNCONDITIONALLY — before the role check that decides whether anything is
 * drawn — so those figures were written into the localStorage of every person
 * who ever opened the Dashboard, `live_host` and `editor` included. Gating the
 * route stops new copies; it does nothing about the ones already on the
 * phones, which this layer would happily keep serving as `stale` data for 24
 * hours, and for ever if the person never regains network.
 *
 * So the cache carries an epoch. When the stored epoch is not this one, every
 * `azone-cache:` entry is dropped on the first import after the deploy —
 * before any component can read one. Bump EPOCH whenever a release changes
 * what an endpoint is ALLOWED to return; the cost is one cold fetch per
 * person, and the alternative is a figure nobody is entitled to sitting on a
 * device with no way to reach it.
 */
const EPOCH = "2";
const EPOCH_KEY = `${PREFIX}epoch`;
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

/* =====================================================================
   THE CACHE IS AN EXTERNAL STORE — P0.4.

   It lives in localStorage, outside React, and more than one component reads
   the same entry. That is the exact shape `useSyncExternalStore` exists for,
   and adopting it is what lets the hook below stop calling setState from an
   effect: the cached value is READ during render instead of pushed into state
   by one.

   Two rules make it safe, and both matter:

   1. getSnapshot RETURNS A STRING, never a parsed object. React compares
      snapshots with Object.is; a fresh object every call is an infinite render
      loop, while two equal strings ARE Object.is-equal. The parse is memoised
      on that string.
   2. getSnapshot IS PURE. The old `readCache` DELETED an expired entry while
      reading it — a write during render. Expiry is now decided by the parse
      (which simply reports null) and the removal happens on the next write.

   It is declared HERE, above `clearApiCache`, because `enforceEpoch()` runs at
   import and may call it: a `const` further down the file would still be in
   its temporal dead zone and the epoch sweep would throw into its own catch.
   ===================================================================== */
const cacheListeners = new Set<() => void>();

/** Bumped whenever the cache is emptied wholesale (sign-out, account switch,
    epoch). It is part of the identity of a view, so anything remembered in
    component state stops matching and an answer in flight stops applying. */
let cacheGen = 0;

function notifyCache(): void {
  for (const fn of cacheListeners) { try { fn(); } catch { /* a listener must not break the cache */ } }
}
function subscribeCache(fn: () => void): () => void {
  cacheListeners.add(fn);
  /* another TAB of the portal writing the same account's cache */
  if (typeof window !== "undefined") window.addEventListener("storage", fn);
  return () => {
    cacheListeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", fn);
  };
}

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
  const before = scope;
  scope = next;
  try {
    const lastKey = `${PREFIX}account`;
    const prev = window.localStorage.getItem(lastKey);
    if (next !== "anon") {
      if (prev && prev !== next) clearApiCache(); // a different person signed in here
      window.localStorage.setItem(lastKey, next);
    }
  } catch { /* private mode */ }
  /* P0.4 — the KEY every reader reads through just changed, so every mounted
     consumer must re-read. Without this a sign-out (scope → "anon", which
     clears nothing because there is nothing of "anon" to clear) left the
     previous account's figures painted until something else re-rendered. */
  if (before !== next) notifyCache();
}

/* Runs once, at import, before any component reads a cached value. */
function enforceEpoch(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (window.localStorage.getItem(EPOCH_KEY) === EPOCH) return;
    clearApiCache();
    window.localStorage.setItem(EPOCH_KEY, EPOCH);
  } catch { /* private mode - nothing was stored, so nothing can linger */ }
}

export function clearApiCache(): void {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      /* the epoch is metadata ABOUT the cache, not cached data: wiping it
         here would make the next load think the deploy had just happened and
         wipe again. Every other `azone-cache:` key goes. */
      if (k && k.startsWith(PREFIX) && k !== EPOCH_KEY) window.localStorage.removeItem(k);
    }
  } catch { /* private mode */ }
  /* every mounted consumer re-reads, and the generation moves so that an
     answer already in flight cannot land afterwards and a value held in a
     component stops matching: a sign-out must empty the screen, not leave the
     previous account's figures painted until something re-renders */
  cacheGen++;
  notifyCache();
}

/* v1.177.2 - at import, before any component can read a stale value. */
enforceEpoch();


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

/** The stored string for a path, or null. Pure, cheap, stable identity. */
function rawCache(path: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(path));
  } catch {
    return null;
  }
}

/** Parse a stored string. Pure: an expired entry reports null, it does not
    delete — deletion during a render is exactly the hazard this avoids. */
function parseCache<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { t: number; d: T };
    if (!parsed || typeof parsed.t !== "number") return null;
    if (Date.now() - parsed.t > TTL_MS) return null;
    return parsed.d;
  } catch {
    return null;
  }
}

function readCache<T>(path: string): T | null {
  const raw = rawCache(path);
  const parsed = parseCache<T>(raw);
  /* the imperative reader may still tidy up: it is never called from a render */
  if (raw && parsed === null) { try { window.localStorage.removeItem(keyFor(path)); } catch { /* private mode */ } }
  return parsed;
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
    notifyCache();
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
    notifyCache();
  } catch {
    /* still no room, or private mode - caching is an optimisation, never a requirement */
  }
}

/* =====================================================================
   THE REQUEST LAYER — P0.4.

   The old hook fetched from an effect and pushed every part of the answer
   into component state with a synchronous setState, which is what produced
   78 of the repository's 147 inherited React hook warnings — attributed, in
   every case, to the CALL SITE of useCachedApi rather than to one line here.

   What replaced it is not a new data policy; it is the same policy with the
   pieces put where they belong. Three facts are external to React and are
   now read as such:

     what is remembered   -> localStorage, above
     what is in flight    -> the map below
     what the last answer was -> the only remaining useState, and it is set
                                 from a promise callback, never synchronously
                                 from an effect

   Two races the old shape could lose, which a single shared registry cannot:

     A. OUT OF ORDER. Two requests for the same view — a mount and a save's
        refresh — could settle in either order, and the LAST to arrive won.
        Every request now carries a sequence number and only the newest one
        for a view is allowed to write.
     B. WRONG ACCOUNT. A request begun as one person could land after another
        signed in on the same phone and be written under the new person's
        key. Each request captures the scope (and the cache generation) it
        began in and refuses to apply if either has moved.

   Concurrent MOUNTS of the same path share one request — `/staff/desk` is
   read by two cards, and `/staff/dashboard/summary` by three. An explicit
   refresh() never joins an older request, because an answer that predates
   the save it is refreshing for is worse than no answer.
   ===================================================================== */

/** The identity of a view for this session: generation + account + path. */
function viewKey(path: string): string {
  return `${cacheGen}|${keyFor(path)}`;
}

interface Outcome<T> {
  /** the view this answer belongs to; "" when it must not be applied */
  key: string;
  ok: boolean;
  data: T | null;
  /** false when a newer request, a different account or a cache clear
      overtook this one — the caller must ignore it entirely */
  applied: boolean;
}

interface Settled<T> {
  key: string;
  value: T | null;
  failed: boolean;
}

const inFlight = new Map<string, { seq: number; p: Promise<Outcome<unknown>> }>();
const flightListeners = new Set<() => void>();
let requestSeq = 0;

function notifyFlight(): void {
  for (const fn of flightListeners) { try { fn(); } catch { /* a listener must not break the fetch */ } }
}
function subscribeFlight(fn: () => void): () => void {
  flightListeners.add(fn);
  return () => { flightListeners.delete(fn); };
}

function fetchPath<T>(path: string, force: boolean): Promise<Outcome<T>> {
  const key = viewKey(path);
  const live = inFlight.get(key);
  if (live && !force) return live.p as Promise<Outcome<T>>;

  const seq = ++requestSeq;
  const scopeAt = scope;
  const genAt = cacheGen;

  const p: Promise<Outcome<T>> = api<T>(path).then((r) => {
    const current = inFlight.get(key);
    const newest = current !== undefined && current.seq === seq;
    if (newest) inFlight.delete(key);

    /* race A: a later request for the same view has already been issued.
       race B: the account changed, or the cache was emptied, under us. */
    if (!newest || scopeAt !== scope || genAt !== cacheGen) {
      notifyFlight();
      return { key: "", ok: false, data: null, applied: false };
    }

    const ok = r.ok && r.data != null;
    if (ok) writeCache(path, r.data as T);
    notifyFlight();
    return { key, ok, data: ok ? (r.data as T) : null, applied: true };
  });

  inFlight.set(key, { seq, p: p as Promise<Outcome<unknown>> });
  notifyFlight();
  return p;
}

/* Stable server snapshots: a static export renders these on a machine with no
   localStorage, and React requires the same value every call. */
const NO_KEY = () => "";
const NO_RAW = (): string | null => null;
const NOT_FETCHING = () => false;

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
  const active = enabled && Boolean(path);

  /* ---- what is remembered (the external store, read during render) ----
     Two snapshots, both STRINGS, so Object.is compares them by value and the
     identity is stable across calls. `key` is scope-qualified, so an account
     switch changes it and everything below re-reads for the new account. */
  const key = useSyncExternalStore(
    subscribeCache,
    useCallback(() => (active && path ? viewKey(path) : ""), [active, path]),
    NO_KEY,
  );
  const raw = useSyncExternalStore(
    subscribeCache,
    useCallback(() => (active && path ? rawCache(path) : null), [active, path]),
    NO_RAW,
  );
  const cached = useMemo(() => parseCache<T>(raw), [raw]);

  /* ---- whether a request for THIS view is in flight (also external, and a
     plain boolean, so the snapshot is stable) ---- */
  const fetching = useSyncExternalStore(
    subscribeFlight,
    useCallback(() => inFlight.has(key), [key]),
    NOT_FETCHING,
  );

  /* ---- the outcome of the last settled request ----
     The only React state left, and it is written from a promise callback, not
     synchronously from an effect. It carries the key it belongs to, so a
     change of path or of account invalidates it without a reset effect:
     `settled` below is false again the moment the key moves. `value` exists
     for the one case the cache cannot cover — a response the cache refused
     (over MAX_BYTES) or evicted under quota pressure — which the old hook
     held in `data` state. */
  const [last, setLast] = useState<Settled<T> | null>(null);

  /* A card can be closed while its refresh is in the air. React 19 makes a
     setState on a gone component a silent no-op rather than a warning, which
     is exactly why it is worth saying out loud that we do not do it. The ref
     is written from an EFFECT, never during render. */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const take = useCallback((o: Outcome<T>) => {
    if (!o.applied || !live.current) return;
    setLast((prev) => ({
      key: o.key,
      /* a failed refresh must not erase figures already on screen */
      value: o.ok ? o.data : (prev && prev.key === o.key ? prev.value : null),
      failed: !o.ok,
    }));
  }, []);

  useEffect(() => {
    if (!path || !enabled) return;
    void fetchPath<T>(path, false).then(take);
  }, [path, enabled, take]);

  const refresh = useCallback(() => {
    if (!path || !enabled) return;
    /* an explicit refresh is never served by a request that was already in
       flight when it was asked for: after a save, that answer predates the
       save. It starts its own request and supersedes the older one. */
    void fetchPath<T>(path, true).then(take);
  }, [path, enabled, take]);

  useLiveRefresh(topics, refresh, active);

  const settled = last !== null && last.key === key && key !== "";
  const data = cached ?? (settled ? last.value : null);

  return {
    data,
    /* remembered figures on screen with a refresh either running or not yet
       started — the money cards render <StaleHint/> for exactly this window */
    stale: active && data !== null && (fetching || !settled),
    /* nothing to show at all, and no answer yet */
    loading: active && data === null && !settled,
    failed: settled && last.failed,
    refresh,
  };
}
