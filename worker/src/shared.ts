/* v1.18.0 — the shared Worker helpers (CODE-AUDIT item 1).
 *
 * The audit found json / err / str / audit / logError duplicated between
 * index.ts and staff.ts — with the two logError copies DISAGREEING: index.ts
 * carried the v1.5.0 six-hour dedupe and the 500-row trim, staff.ts was a
 * bare INSERT, and staff.ts is the copy the whole portal API calls. So most
 * error rows bypassed the dedupe and the "22 new system errors" bell-spam
 * the v1.5.0 fix closed was still open through the staff module.
 *
 * New modules (erp.ts) import from HERE. The two legacy files keep their
 * local copies for now — retro-wiring 9,900 lines of call sites is its own
 * change — but staff.ts's logError BODY is replaced with the deduped logic
 * in the same release, which closes the live bug without touching call sites.
 */

import type { Env } from "./index";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function err(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

export function str(v: unknown, max = 2000): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/** NUMBERS ONLY (the geofence 0°,0° lesson): a NaN serialises to JSON null
 *  and Number(null) === 0, which silently stores zero. typeof + finite. */
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** RM decimal from the client → integer cents, or null if not a sane amount.
 *  Cap 10 million ringgit: a fat-fingered extra digit should fail loudly at
 *  the API, not become a 9-figure ledger row someone finds at audit time. */
export function cents(v: unknown): number | null {
  const n = num(v);
  if (n === null || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100);
}

export async function audit(
  env: Env, userId: number, action: string, entity?: string, entityId?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  // Never fatal: the trail records actions, it must not break them.
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(userId, action, entity ?? null, entityId ?? null,
      detail ? JSON.stringify(detail) : null).run();
  } catch (e) {
    console.error("audit write failed:", action, e);
    try {
      await env.DB.prepare(
        `INSERT INTO error_log (source, message) VALUES ('audit', ?1)`,
      ).bind(`${action}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500)).run();
    } catch { /* pre-0024 or DB down — console above is the fallback */ }
  }
}

/** The ONE error-log writer: six-hour dedupe + opportunistic 500-row trim. */
export async function logError(env: Env, source: string, message: string, path?: string): Promise<void> {
  try {
    const src = source.slice(0, 40);
    const msg = message.slice(0, 500);
    const pth = path?.slice(0, 200) ?? null;
    const dup = await env.DB.prepare(
      `SELECT id FROM error_log WHERE source = ?1 AND message = ?2
         AND (path IS ?3 OR path = ?3)
         AND created_at > datetime('now', '-6 hours') LIMIT 1`,
    ).bind(src, msg, pth).first<{ id: number }>();
    if (dup) return;
    await env.DB.prepare(
      `INSERT INTO error_log (source, message, path) VALUES (?1, ?2, ?3)`,
    ).bind(src, msg, pth).run();
    if (Math.random() < 0.05) {
      await env.DB.prepare(
        `DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 500)`,
      ).run();
    }
  } catch (e) {
    console.error("error_log write failed:", source, message, e);
  }
}
