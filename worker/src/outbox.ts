/**
 * THE OUTBOX, SERVER SIDE — v1.105.0 (roadmap phase 03).
 *
 * The client keeps a write it could not deliver and sends it later
 * (lib/outbox.ts). Two things have to be true on this side for that to be
 * safe, and this module is both of them:
 *
 * 1. THE SAME ANSWER TWICE. Every queueable write carries an Idempotency-Key
 *    minted when the button was pressed. The first time a key is seen the
 *    handler runs and its answer is stored under (key, user). Every later
 *    time, the STORED answer is returned and the handler does not run. So a
 *    request that reached us but whose reply died in the tunnel cannot clock
 *    somebody in twice when the phone replays it - the second attempt gets
 *    the first attempt's "ok", and the version counter is not bumped because
 *    nothing changed.
 *
 * 2. WHEN THE PHONE SAID. X-Client-At is the moment the button was pressed,
 *    in ISO. A handler that cares about time (the punch) asks clientAt() for
 *    it and gets a Date only when it is plausible: carried with a key, in
 *    the past by more than a minute (otherwise this is a live request and
 *    now is the truth), and not more than 48 h ago (a phone clock set to
 *    last year is not a punch). Everything else gets null and uses now.
 *
 * THE LIST IS THE SAME LIST. QUEUEABLE below names exactly the routes the
 * client may queue; a key on any other route is ignored - stored nowhere,
 * replayed never. tests/outbox.mjs compares this list with lib/outbox.ts's,
 * because a route queueable on one side and not the other is a write that
 * either never lands or lands twice.
 */

import type { Env } from "./index";

/** Method + a regex over the STAFF sub-path (after /api/v1/staff). */
export const QUEUEABLE: readonly { method: string; path: RegExp }[] = [
  { method: "POST",  path: /^\/attendance$/ },
  { method: "PATCH", path: /^\/tasks\/\d+$/ },
  { method: "POST",  path: /^\/tasks\/\d+\/items\/\d+\/toggle$/ },
  { method: "POST",  path: /^\/tasks\/\d+\/ack$/ },
  { method: "POST",  path: /^\/leave$/ },
  { method: "POST",  path: /^\/claims$/ },
  { method: "POST",  path: /^\/hotels\/\d+\/calls$/ },
];

export function isQueueable(method: string, subPath: string): boolean {
  return QUEUEABLE.some((r) => r.method === method && r.path.test(subPath));
}

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** The idempotency key on this request, if it is one we honour. */
export function idempotencyKey(request: Request, subPath: string): string | null {
  const k = request.headers.get("Idempotency-Key");
  if (!k || !KEY_RE.test(k)) return null;
  if (!isQueueable(request.method, subPath)) return null;
  return k;
}

const MIN_LATE_MS = 60 * 1000;
const MAX_LATE_MS = 48 * 3600 * 1000;

/** When the phone says the button was pressed - or null, meaning "now". */
export function clientAt(request: Request, subPath: string): Date | null {
  if (!idempotencyKey(request, subPath)) return null;
  const raw = request.headers.get("X-Client-At");
  if (!raw) return null;
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return null;
  const late = Date.now() - t.getTime();
  if (late < MIN_LATE_MS || late > MAX_LATE_MS) return null;
  return t;
}

export const REPLAY_HEADER = "X-Idempotent-Replay";

/**
 * Run the handler once per key. A stored answer is returned as-is with
 * X-Idempotent-Replay: 1, so the dispatcher can skip the version bump.
 * A database without 0114 yet degrades to "run every time" - the pre-outbox
 * behaviour - rather than failing the request.
 */
export async function replayOrRun(
  env: Env, request: Request, userId: number, subPath: string,
  run: () => Promise<Response | null>,
): Promise<Response | null> {
  const key = idempotencyKey(request, subPath);
  if (!key) return run();

  let hit: { status: number; body: string } | null = null;
  try {
    hit = await env.DB.prepare(
      `SELECT status, body FROM idempotency_keys WHERE key = ?1 AND user_id = ?2`,
    ).bind(key, userId).first<{ status: number; body: string }>();
  } catch (e) {
    if (!String(e).includes("no such table")) throw e;
    return run(); // pre-0114
  }
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { "Content-Type": "application/json", [REPLAY_HEADER]: "1" },
    });
  }

  const res = await run();
  if (!res) return res;
  /* Store every definite answer, refusals included: a 409 "already punched"
     replayed a third time should still say "already punched", not run the
     handler again and find a different day. 5xx is NOT stored - a transient
     failure must be retryable. */
  if (res.status < 500) {
    const body = await res.clone().text();
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO idempotency_keys (key, user_id, path, status, body) VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(key, userId, subPath, res.status, body.slice(0, 20_000)).run();
    } catch { /* storing the answer is an optimisation of safety, never a reason to fail the write */ }
  }
  return res;
}

/** Nightly: keys older than seven days have outlived any phone's queue
    (lib/outbox.ts forgets entries after 48 h). */
export async function purgeIdempotencyKeys(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM idempotency_keys WHERE created_at <= datetime('now', '-7 days')`).run();
  } catch { /* pre-0114 */ }
}
