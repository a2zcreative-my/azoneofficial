/* v1.373.0 - SHIFT TEMPLATES BULK ASSIGNMENT (the CEO, 18-11-2026, "A2Z OS -
   SHIFT TEMPLATES BULK ASSIGNMENT", his three pictures; decisions: a bulk
   assignment starts TOMORROW or later, and the existing editor, single
   assign and history stay as they are, in a drawer).

   ONE pattern, ONE effective date, many staff - written through the SAME
   history table every reader already uses (staff_shifts: the newest row that
   has started on or before a day is that day's hours). No new engine, no
   migration. A day that has started is never re-measured: the date is
   tomorrow or later, so attendance, approved shifts, leave and payroll that
   exist today keep what they were measured against.

     POST /staff-shifts/bulk  { user_ids, pattern_id, effective_from, dry_run }
       dry_run true  -> the preview, per person: change | no_change | conflict | refused,
                        the pattern before and after, and warnings (a later planned
                        assignment still takes over; approved leave on a new rest day)
       dry_run false -> writes ONLY the "change" rows, each a conditional INSERT
                        ("only if nothing starts that day for that person"), so a double
                        press or a retry writes nothing twice; answers saved + skipped

   hr_manage, as every other shift write. Every person written is told (the
   same notice single assign sends) and gets an audit row with the actor, the
   old and the new pattern and the date; the batch gets one more audit row. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify, currentStaffSql, payslipsOutFor } from "./staff";
import { json, err, audit } from "./shared";
import { canUser } from "./permissions";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MAX = 100;
const mytDay = (offsetDays = 0) => new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400_000).toISOString().slice(0, 10);

type Pat = Record<string, unknown> & { id: number; name: string; is_default?: number; retired_at?: string | null };
export type BulkState = "change" | "no_change" | "conflict" | "refused";
export interface BulkRow {
  user_id: number; name: string | null; state: BulkState; reason: string | null;
  previous: { pattern_id: number; name: string; from: string | null } | null;
  warnings: string[];
}

export async function handleShiftBulk(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response | null> {
  if (path !== "/staff-shifts/bulk") return null;
  if (method !== "POST") return err("not_found", "Unknown route", 404);
  if (!canUser(user, "hr_manage")) return err("forbidden", "Only scheduling management assigns working hours", 403);
  const dry = body?.dry_run === true;
  const pid = Number(body?.pattern_id);
  const from = typeof body?.effective_from === "string" ? body.effective_from : "";
  const ids = Array.isArray(body?.user_ids) ? [...new Set((body!.user_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (!ids.length) return err("invalid_input", "Choose at least one staff member.", 400);
  if (ids.length > MAX) return err("invalid_input", `At most ${MAX} staff in one assignment.`, 400);
  if (!Number.isInteger(pid) || pid <= 0) return err("invalid_input", "Choose a pattern.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) return err("invalid_input", "Choose the effective date.", 400);
  /* the CEO's answer: a bulk assignment starts tomorrow or later - a day that has started is never re-measured */
  const tomorrow = mytDay(1);
  if (from < tomorrow) return err("date_too_early", `A bulk assignment starts tomorrow (${tomorrow}) or later - days that have started keep their hours.`, 400);
  if (from > mytDay(400)) return err("invalid_input", "The effective date is more than a year ahead.", 400);

  let pats: Pat[];
  try {
    pats = (await env.DB.prepare(`SELECT * FROM shift_patterns`).all<Pat>()).results ?? [];
  } catch (e) {
    if (/no such table/i.test(String(e))) return err("migration_missing", "Working-hour patterns arrive with the next database update.", 503);
    throw e;
  }
  const pat = pats.find((p) => p.id === pid);
  if (!pat || pat.retired_at) return err("not_found", "That working-hours pattern is no longer available - pick another.", 404);
  const def = pats.find((p) => p.is_default === 1) ?? null;
  const nameOf = (id: number) => pats.find((p) => p.id === id)?.name ?? `#${id}`;

  /* who may be assigned: the same people the staff pickers list (staff-list), on staff today */
  const marks = ids.map((_, i) => `?${i + 1}`).join(", ");
  const people = (await env.DB.prepare(
    `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.left_on FROM users u
      WHERE u.id IN (${marks}) AND u.is_active = 1 AND ${currentStaffSql("u.")}
        AND (u.role NOT IN ('customer', 'agent', 'super_admin', 'admin') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0))`,
  ).bind(...ids).all<{ id: number; name: string; left_on: string | null }>()).results ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const shifts = (await env.DB.prepare(`SELECT id, user_id, pattern_id, effective_from FROM staff_shifts WHERE user_id IN (${marks})`).bind(...ids)
    .all<{ id: number; user_id: number; pattern_id: number; effective_from: string }>()).results ?? [];
  const released = await payslipsOutFor(env, from.slice(0, 7));
  /* the new pattern's rest days, to warn about approved leave that would land on one */
  const restDows = DAYS.map((d, i) => (pat[`${d}_start`] == null ? i : -1)).filter((i) => i >= 0);
  const leaves = restDows.length ? ((await env.DB.prepare(
    `SELECT user_id, start_date, end_date FROM leave_requests WHERE user_id IN (${marks}) AND status = 'approved' AND end_date >= ?${ids.length + 1}`,
  ).bind(...ids, from).all<{ user_id: number; start_date: string; end_date: string }>()).results ?? []) : [];
  const leaveOnRest = (uid: number) => {
    let n = 0;
    for (const l of leaves) {
      if (l.user_id !== uid) continue;
      for (let t = Date.parse(`${l.start_date < from ? from : l.start_date}T00:00:00Z`); t <= Date.parse(`${l.end_date}T00:00:00Z`) && n < 99; t += 86400_000) {
        if (restDows.includes(new Date(t).getUTCDay())) n++;
      }
    }
    return n;
  };

  const rows: BulkRow[] = ids.map((uid) => {
    const p = byId.get(uid);
    if (!p) return { user_id: uid, name: null, state: "refused", reason: "Not on staff - only current staff are assigned working hours.", previous: null, warnings: [] };
    const mine = shifts.filter((s) => s.user_id === uid).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id);
    const before = mine.find((s) => s.effective_from <= from) ?? null;
    const previous = before ? { pattern_id: before.pattern_id, name: nameOf(before.pattern_id), from: before.effective_from }
      : def ? { pattern_id: def.id, name: def.name, from: null } : null;
    const warnings: string[] = [];
    for (const later of mine.filter((s) => s.effective_from > from).reverse()) {
      warnings.push(`${nameOf(later.pattern_id)} is already planned from ${later.effective_from} and will still take over then.`);
    }
    const lv = leaveOnRest(uid);
    if (lv) warnings.push(`${lv} day${lv === 1 ? "" : "s"} of approved leave fall${lv === 1 ? "s" : ""} on a rest day of ${pat.name} - the leave is kept as approved.`);
    if (p.left_on && p.left_on < from) return { user_id: uid, name: p.name, state: "refused", reason: `Leaves on ${p.left_on}, before the effective date.`, previous, warnings };
    const same = mine.find((s) => s.effective_from === from);
    if (same && same.pattern_id === pid) return { user_id: uid, name: p.name, state: "no_change", reason: `Already assigned ${pat.name} from ${from}.`, previous, warnings };
    if (same) return { user_id: uid, name: p.name, state: "conflict", reason: `${nameOf(same.pattern_id)} already starts on ${from} - move or withdraw it first.`, previous, warnings };
    if (released) return { user_id: uid, name: p.name, state: "conflict", reason: `The ${from.slice(0, 7)} payslips are already released.`, previous, warnings };
    if (previous && previous.pattern_id === pid) return { user_id: uid, name: p.name, state: "no_change", reason: `Already on ${pat.name} on ${from}.`, previous, warnings };
    return { user_id: uid, name: p.name, state: "change", reason: null, previous, warnings };
  });
  const tally = (st: BulkState) => rows.filter((r) => r.state === st).length;
  const pattern = { id: pat.id, name: pat.name };
  if (dry) return json({ ok: true, dry_run: true, pattern, effective_from: from, rows, counts: { change: tally("change"), no_change: tally("no_change"), conflict: tally("conflict"), refused: tally("refused") } });

  /* write only the changes; each insert stands alone and adds nothing if a row for that person and day appeared meanwhile */
  const saved: number[] = [];
  const batch = `bulk:${user.id}:${Date.now()}`;
  for (const r of rows) {
    if (r.state !== "change") continue;
    const ins = await env.DB.prepare(
      `INSERT INTO staff_shifts (user_id, pattern_id, effective_from, created_by)
       SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM staff_shifts WHERE user_id = ?1 AND effective_from = ?3)`,
    ).bind(r.user_id, pid, from, user.id).run();
    if (!(ins as { meta?: { changes?: number } }).meta?.changes) { r.state = "no_change"; r.reason = `An assignment from ${from} was saved meanwhile - nothing added.`; continue; }
    saved.push(r.user_id);
    await audit(env, user.id, "staff_shift.assign", "users", String(r.user_id), {
      pattern_id: pid, pattern: pat.name, from, previous_pattern_id: r.previous?.pattern_id ?? null, previous_pattern: r.previous?.name ?? null, bulk: batch,
    });
    try { await notify(env, r.user_id, "attendance", `Your working hours change from ${from}: ${pat.name}.`, `shift:${r.user_id}:${from}`); } catch { /* a notice never blocks the record */ }
  }
  await audit(env, user.id, "staff_shift.bulk_assign", "shift_patterns", String(pid), {
    batch, pattern: pat.name, from, saved, no_change: rows.filter((r) => r.state === "no_change").map((r) => r.user_id),
    conflict: rows.filter((r) => r.state === "conflict").map((r) => r.user_id), refused: rows.filter((r) => r.state === "refused").map((r) => r.user_id),
  });
  return json({ ok: true, pattern, effective_from: from, saved: saved.length, rows, counts: { change: saved.length, no_change: tally("no_change"), conflict: tally("conflict"), refused: tally("refused") } });
}
