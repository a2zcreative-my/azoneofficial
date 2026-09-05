/**
 * v1.5.0 — ONE api() helper for every client page and panel.
 *
 * This function existed as fifteen separate copies (portal page, role-panels,
 * payroll, admin, account, login, …) with real behavioural drift: only some
 * copies attached the CSRF header, and only some guarded res.json() against
 * a non-JSON body — so the same failure produced different symptoms on
 * different tabs. One definition ends the drift.
 *
 * Contract (identical to the strictest of the old copies):
 * - credentials always included (session cookie);
 * - Content-Type: application/json added when a body is present;
 * - X-CSRF-Token attached on every mutating method (double-submit cookie);
 * - res.json() guarded — an HTML error page or empty body yields data: null
 *   while PRESERVING the real HTTP status (the old page.tsx copy collapsed
 *   every parse failure to { status: 0 }, hiding 502s from callers);
 * - network failure yields { ok: false, status: 0, data: null }.
 */

import { queueableKind, newIdempotencyKey, enqueue, type OutboxEntry } from "@/lib/outbox";

const API = "/api/v1";

export function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match?.[1] ?? "";
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** v1.105.0 - true when the write could not reach the server and is
      waiting on this device (lib/outbox.ts). ok is true and status is 202:
      the person did their part. The caller's toast MUST say it is waiting -
      "saved" and "saved on this phone, sending when you are back online" are
      different sentences, and the difference is the point. */
  queued?: boolean;
}

/**
 * Base-prefixed variant. Several panels historically used a helper whose base
 * was "/api/v1/staff" and call paths like "/claims/12/decide". `makeApi("/staff")`
 * preserves that exactly: makeApi("/staff")("/claims") → /api/v1/staff/claims.
 */
export function makeApi(prefix = "") {
  return <T>(path: string, init?: RequestInit) => api<T>(`${prefix}${path}`, init);
}

/* v1.26.2 — CSRF self-heal. A browser can hold a live (HttpOnly) session
   cookie while the script-visible csrf_token cookie has been evicted; every
   save then 403s with "CSRF token mismatch or missing" until re-login (the
   CEO's screenshot). /auth/me now re-issues the cookie when it is missing,
   so the recovery is: hit /auth/me once, then retry the request with the
   fresh token. One retry only — a genuine forgery still fails closed. */
async function refreshCsrfCookie(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: "include" });
    return res.ok && getCsrfToken() !== "";
  } catch {
    return false;
  }
}

function isCsrfFailure(status: number, data: unknown): boolean {
  return status === 403 &&
    (data as { error?: { code?: string } } | null)?.error?.code === "csrf_failed";
}

/**
 * The ONLY sanctioned way to make a raw mutating request outside api() —
 * for binary bodies (photo/receipt/document uploads) and custom headers.
 * Attaches the CSRF token, self-heals a missing csrf cookie exactly like
 * api(), and returns the raw Response so callers keep res.ok / res.json().
 * tests/csrf-guard.mjs fails the build on any bare fetch() mutation.
 */
export async function csrfFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = () => {
    const headers = new Headers((init.headers as Record<string, string>) ?? {});
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
    return fetch(url, { credentials: "include", ...init, headers });
  };
  let res = await doFetch();
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null) as { error?: { code?: string } } | null;
    if (body?.error?.code === "csrf_failed" && (await refreshCsrfCookie())) {
      res = await doFetch();
    }
  }
  return res;
}

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const isMutating = Boolean(init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method));
  /* v1.105.0 - a queueable write (lib/outbox.ts QUEUEABLE) carries an
     idempotency key and the moment it was pressed on EVERY attempt, so a
     reply lost in a tunnel cannot become a second clock-in when the queue
     replays it. Minted here, once per call, never per retry. */
  const kind = isMutating ? queueableKind(init?.method, path) : null;
  const idem = kind ? newIdempotencyKey() : null;
  const clientAt = kind ? new Date().toISOString() : null;
  const park = async (): Promise<ApiResult<T>> => {
    await enqueue({
      id: idem!, path, method: init!.method!, kind: kind!, clientAt: clientAt!,
      body: typeof init?.body === "string" ? init.body : init?.body ? JSON.stringify(init.body) : null,
    });
    return { ok: true, status: 202, data: null, queued: true };
  };
  /* offline for certain: do not even try - a fetch that is going to fail
     takes seconds to say so on a phone with one bar */
  if (kind && typeof navigator !== "undefined" && navigator.onLine === false) return park();
  try {
    const attempt = async (): Promise<{ res: Response; data: T | null }> => {
      const headers = new Headers((init?.headers as Record<string, string>) ?? {});
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      if (isMutating) {
        const csrf = getCsrfToken();
        if (csrf) headers.set("X-CSRF-Token", csrf);
      }
      if (idem) { headers.set("Idempotency-Key", idem); headers.set("X-Client-At", clientAt!); }
      const res = await fetch(`${API}${path}`, {
        credentials: "include",
        ...init,
        headers,
      });
      const data =
        res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
      return { res, data };
    };
    let { res, data } = await attempt();
    if (isMutating && isCsrfFailure(res.status, data) && (await refreshCsrfCookie())) {
      ({ res, data } = await attempt());
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    /* fetch threw: no network, DNS, the tunnel. A queueable write is kept;
       anything else fails as it always did. */
    if (kind) return park();
    return { ok: false, status: 0, data: null };
  }
}

/** v1.105.0 - how the outbox re-sends one waiting entry: the same headers a
    live attempt carried, the SAME idempotency key and the SAME pressed-at
    time. null means the network is still not there. */
export async function sendOutboxEntry(e: OutboxEntry): Promise<{ status: number; data: unknown } | null> {
  try {
    const headers = new Headers({ "Content-Type": "application/json", "Idempotency-Key": e.id, "X-Client-At": e.clientAt });
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
    let res = await fetch(`${API}${e.path}`, { method: e.method, credentials: "include", headers, body: e.body });
    let data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (isCsrfFailure(res.status, data) && (await refreshCsrfCookie())) {
      const c2 = getCsrfToken();
      if (c2) headers.set("X-CSRF-Token", c2);
      res = await fetch(`${API}${e.path}`, { method: e.method, credentials: "include", headers, body: e.body });
      data = res.status === 204 ? null : await res.json().catch(() => null);
    }
    return { status: res.status, data };
  } catch {
    return null;
  }
}
