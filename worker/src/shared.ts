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

/* ============ v1.20.0 (consolidation C5) — GL auto-posting ============
 * Every bank movement drafts one balanced journal entry, keyed by the SAME
 * unique ref as the movement — post twice, book once. Category names map to
 * the 0071 seeded chart; anything unrecognised books to 6900 Other expenses
 * rather than failing (the accountant re-classes in the journal; a missing
 * mapping must never block an expense from being marked paid). Pre-0071
 * databases no-op silently, same rule as the movements themselves. */

const GL_BANK = "1100"; // Bank — operating

/** Lower-cased category → expense/income account code. */
const GL_CATEGORY: Record<string, string> = {
  // expenses (money out)
  rent: "6200", utilities: "6200",
  marketing: "6000", "ads fund": "6000", ads: "6000",
  salaries: "6100", payroll: "6100", commission: "6100",
  claims: "6900",
  software: "6900", equipment: "6900", supplies: "6900", logistics: "6900", other: "6900",
  "platform fees": "6300", fees: "6300",
  // income (money in)
  "live sales": "4100", service: "4100", live: "4100",
  sales: "4000", product: "4000",
};

export function glCodeFor(category: string, direction: "in" | "out"): string {
  const key = category.trim().toLowerCase();
  if (GL_CATEGORY[key]) return GL_CATEGORY[key]!;
  for (const [k, v] of Object.entries(GL_CATEGORY)) {
    if (key.includes(k)) return v;
  }
  return direction === "out" ? "6900" : "4000";
}

/** Draft one balanced two-line journal entry, idempotent by ref. */
export async function postJournal(
  env: Env, userId: number, ref: string, memo: string, category: string,
  amountCents: number, direction: "in" | "out",
): Promise<void> {
  if (amountCents <= 0) return;
  try {
    const dup = await env.DB.prepare(`SELECT id FROM journal_entries WHERE ref = ?1 LIMIT 1`)
      .bind(ref).first<{ id: number }>();
    if (dup) return;
    const otherCode = glCodeFor(category, direction);
    const acc = async (code: string) => (await env.DB.prepare(
      `SELECT id FROM gl_accounts WHERE code = ?1 AND active = 1`,
    ).bind(code).first<{ id: number }>())?.id ?? null;
    const bankId = await acc(GL_BANK);
    const otherId = await acc(otherCode);
    if (!bankId || !otherId) return; // chart edited away — skip, never block
    const entry = await env.DB.prepare(
      `INSERT INTO journal_entries (entry_date, memo, ref, created_by)
       VALUES (date('now', '+8 hours'), ?1, ?2, ?3) RETURNING id`,
    ).bind(memo.slice(0, 200), ref, userId).first<{ id: number }>();
    if (!entry?.id) return;
    // out: debit expense, credit bank · in: debit bank, credit income
    const [debitAcc, creditAcc] = direction === "out" ? [otherId, bankId] : [bankId, otherId];
    await env.DB.prepare(
      `INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES (?1, ?2, ?3, 0)`,
    ).bind(entry.id, debitAcc, amountCents).run();
    await env.DB.prepare(
      `INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES (?1, ?2, 0, ?3)`,
    ).bind(entry.id, creditAcc, amountCents).run();
  } catch { /* pre-0071 — Accounting simply not in use yet */ }
}

/* ===================== v1.65.0 — live cards =============================
   One counter per topic, bumped when a write on that topic succeeds. A card
   watching a topic reloads when its number moves. That is the whole protocol.

   WHY A COUNTER AND NOT AN EVENT PAYLOAD: an event carrying the changed row
   has to be authorised per recipient, ordered, and de-duplicated, and gets
   any of those wrong in a way that shows the wrong number to the wrong
   person. A counter says only "something in this topic moved" — every card
   then refetches through its own already-authorised endpoint. Nothing new is
   exposed and nothing can arrive out of order, because a number that only
   increases cannot be applied backwards. */

/** The topic a staff route belongs to: the first path segment, which is how
    the routes are already organised (/tasks/12/comments -> tasks). Derived
    rather than declared, so a new route joins the system by existing. */
export function topicOf(path: string): string {
  const seg = path.replace(/^\/+/, "").split("/")[0] ?? "";
  return /^[a-z0-9_-]{1,32}$/i.test(seg) ? seg.toLowerCase() : "";
}

/** Bump one topic. Never throws and never blocks the caller's response: a
    failed bump costs a card its live update, which is not worth failing a
    save the user already completed. */
export async function bumpVersion(env: Env, topic: string): Promise<void> {
  if (!topic) return;
  try {
    await env.DB.prepare(
      `INSERT INTO data_versions (topic, v, at) VALUES (?1, 1, ?2)
       ON CONFLICT(topic) DO UPDATE SET v = v + 1, at = ?2`,
    ).bind(topic, Date.now()).run();
  } catch { /* table missing (pre-0094) or write failed - cards stay manual */ }
}

/** Every topic and its current number. Small by construction: one row per
    topic, roughly twenty rows, no history. */
export async function readVersions(env: Env): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const { results } = await env.DB.prepare(`SELECT topic, v FROM data_versions`)
      .all<{ topic: string; v: number }>();
    for (const r of results) out[r.topic] = r.v;
  } catch { /* pre-0094 - an empty map means "nothing ever changes", which
                degrades to the manual behaviour that came before. */ }
  return out;
}

/* =====================================================================
   UPLOAD LIMITS — v1.177.2.

   Three routes streamed `request.body` straight into R2 with NO byte cap:
   POST /api/v1/media, POST /users/:id/photo and POST /users/:id/documents.
   Their buffered siblings all cap (5 MB for an ELFIA photo, 10 MB for a
   catalogue PDF) — the cap was intended and missed wherever streaming was
   used. An authenticated account could put a multi-gigabyte body into R2 and
   repeat it, and nothing said no.

   Two things are wrong with the obvious fixes, so this does neither:

     - Content-Length is ADVISORY. A client may omit it or lie. It is a useful
       FAST path (refuse before reading a byte) and worthless as the only one.
     - Buffering with arrayBuffer() to measure honestly is what the capped
       siblings do, and it is fine for 5 MB. It is not fine for a 64 MB video
       in a Worker with a 128 MB memory ceiling.

   So the body is passed through a counting stream that aborts the moment the
   cap is passed: the real length is enforced, nothing is buffered, and an
   over-size upload dies mid-flight instead of completing.

   MAGIC BYTES. The declared Content-Type was the only check, and a header is
   the client's word. The first bytes of a file are the file's own word, so
   for every type these routes accept, the leading bytes must agree with the
   declared type. This is not a virus scanner - it stops the mundane case of
   an arbitrary blob stored under image/jpeg, which is what makes a bucket a
   free file host.
   ===================================================================== */

/** The signature(s) that may open a file of this type. `null` = no check. */
const MAGIC: Record<string, readonly (readonly number[])[] | null> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38]],                      // GIF8
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],                     // RIFF; "WEBP" at byte 8
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],                // %PDF
  "video/webm": [[0x1a, 0x45, 0xdf, 0xa3]],                     // EBML
  "video/mp4": [[0x66, 0x74, 0x79, 0x70]],                      // "ftyp" at byte 4 - offset handled below
  /* The OOXML/DOC family is a ZIP or an OLE compound file; both are checked,
     and a .doc from Word 97 is the OLE one. */
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4b, 0x03, 0x04]],
  "application/msword": [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b, 0x03, 0x04]],
  "application/octet-stream": null,
  "image/svg+xml": null,          // text, and the media route forces it to download
};

/** mp4 carries its signature at byte 4, not byte 0. */
const MAGIC_OFFSET: Record<string, number> = { "video/mp4": 4 };

export class UploadRejected extends Error {
  constructor(readonly code: "too_large" | "content_mismatch", message: string) {
    super(message);
  }
}

function leadingBytesAgree(head: Uint8Array, contentType: string): boolean {
  const sigs = MAGIC[contentType];
  if (sigs === null || sigs === undefined) return true;      // nothing to check against
  const off = MAGIC_OFFSET[contentType] ?? 0;
  return sigs.some((sig) => sig.every((b, i) => head[off + i] === b));
}

/**
 * The request body, capped and sniffed. The returned stream is what goes to
 * R2; it errors with an `UploadRejected` if the cap is passed or the leading
 * bytes disagree with `contentType`, which makes `MEDIA.put` reject — see
 * `putGuarded` for the caller's side.
 *
 * `maxBytes` is per route and per kind: a badge photo and a product video do
 * not deserve the same allowance.
 */
export function guardedBody(body: ReadableStream<Uint8Array>, maxBytes: number, contentType: string): ReadableStream<Uint8Array> {
  let seen = 0;
  let head = new Uint8Array(0);
  let checked = false;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(new UploadRejected("too_large",
          `the file is larger than the ${Math.round(maxBytes / 1048576)} MB limit for this kind of upload`));
        return;
      }
      /* collect enough of the opening to judge it, then judge it once */
      if (!checked) {
        const merged = new Uint8Array(head.byteLength + chunk.byteLength);
        merged.set(head); merged.set(chunk, head.byteLength);
        head = merged;
        if (head.byteLength >= 12) {
          checked = true;
          if (!leadingBytesAgree(head, contentType)) {
            controller.error(new UploadRejected("content_mismatch",
              "the file's contents do not match the type it was sent as"));
            return;
          }
        }
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      /* a file shorter than 12 bytes never reached the check above; judge what
         there is rather than letting a 3-byte body through unexamined */
      if (!checked && head.byteLength > 0 && !leadingBytesAgree(head, contentType)) {
        controller.error(new UploadRejected("content_mismatch",
          "the file's contents do not match the type it was sent as"));
      }
    },
  }));
}

/** Declared length, when the client offers one. A fast refusal costs nothing. */
export function declaredTooLarge(request: Request, maxBytes: number): boolean {
  const len = Number(request.headers.get("Content-Length") ?? "");
  return Number.isFinite(len) && len > maxBytes;
}

/**
 * Put a capped, sniffed body into R2. On rejection the partial object is
 * removed - a stream that errors mid-put can leave one behind, and a bucket
 * full of half-written rejects is the same bill by another route.
 * Returns null on success, or the Response to send.
 */
export async function putGuarded(
  bucket: R2Bucket, key: string, request: Request, opts: { max: number; contentType: string },
): Promise<Response | null> {
  if (declaredTooLarge(request, opts.max)) {
    return err("too_large", `the file is larger than the ${Math.round(opts.max / 1048576)} MB limit for this kind of upload`, 413);
  }
  try {
    await bucket.put(key, guardedBody(request.body!, opts.max, opts.contentType), {
      httpMetadata: { contentType: opts.contentType },
    });
    return null;
  } catch (e) {
    try { await bucket.delete(key); } catch { /* nothing to clean up */ }
    if (e instanceof UploadRejected) return err(e.code, e.message, e.code === "too_large" ? 413 : 400);
    /* anything else is ours, not the client's: say so without the detail */
    return err("upload_failed", "the file could not be stored — try again", 500);
  }
}
