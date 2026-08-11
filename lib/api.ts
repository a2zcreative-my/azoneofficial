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
}

/**
 * Base-prefixed variant. Several panels historically used a helper whose base
 * was "/api/v1/staff" and call paths like "/claims/12/decide". `makeApi("/staff")`
 * preserves that exactly: makeApi("/staff")("/claims") → /api/v1/staff/claims.
 */
export function makeApi(prefix = "") {
  return <T>(path: string, init?: RequestInit) => api<T>(`${prefix}${path}`, init);
}

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const isMutating = init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method);
    const headers = new Headers((init?.headers as Record<string, string>) ?? {});
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (isMutating) {
      const csrf = getCsrfToken();
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      ...init,
      headers,
    });
    const data =
      res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
