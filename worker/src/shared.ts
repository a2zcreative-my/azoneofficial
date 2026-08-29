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
