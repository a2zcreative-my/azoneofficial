/* v1.412.0 - PAYROLL ALLOWANCES (the CEO 21-11-2026, "As recommended" on D1-D8 of
   docs/PAYROLL-ALLOWANCES-STAGE-0-AUDIT.md; migration 0231).

   Named allowance TYPES (parking, transport, ...) and each person's fixed MONTHLY amount of a type.
   This module is the SETUP only. It never writes payroll_entries, never computes a net and never
   touches a saved, released or paid month: the monthly row's Allowance is pre-filled from these
   amounts by the screen ONLY for a person with no saved row, exactly as Basic is pre-filled from the
   base salary, and it becomes a payroll figure only when someone presses Save (POST /payroll, which
   keeps every release lock). allowance_cents stays the one allowance term in net (tests/payroll-module.mjs).

   D1  types: payroll_allowance_types (the CEO; the super admin as the technical account).
   D2  amounts: payroll_process (the people who set the basic).
   D5  an allowance is never part of ORP, overtime, holiday pay or the unpaid-leave deduction - nothing
       here is read by those formulas.
   Types are never deleted (trigger) - retired with active = 0. Every change writes one
   payroll_allowance_events row (append-only) and the audit. */
import type { Env } from "./index";
import { payrollBaseStaffSql, staffRolesSql, type StaffUser } from "./staff";
import { canUser } from "./permissions";
import { audit, err, json } from "./shared";

export const ALLOWANCE_NAME_MAX = 40;
/** the cap on one monthly amount, in sen (RM 100,000) - a fat-fingered digit fails loudly */
export const ALLOWANCE_MAX_CENTS = 10_000_000;

type TypeRow = { id: number; name_en: string; name_ms: string; active: number; sort: number; version: number };

const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const nameOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= 2 && t.length <= ALLOWANCE_NAME_MAX ? t : null;
};

export async function handlePayrollAllowances(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser,
): Promise<Response | null> {
  /* ---- read: every type and every person's amounts ---- */
  if (path === "/payroll/allowances" && method === "GET") {
    if (!canUser(user, "payroll_process")) return err("forbidden", "Payroll access required", 403);
    try {
      const types = (await env.DB.prepare(
        `SELECT id, name_en, name_ms, active, sort, version FROM payroll_allowance_types ORDER BY active DESC, sort, id`,
      ).all<TypeRow>()).results ?? [];
      const amounts = (await env.DB.prepare(
        `SELECT a.user_id, a.type_id, a.amount_cents FROM payroll_allowance_amounts a
         JOIN users u ON u.id = a.user_id WHERE a.amount_cents > 0`,
      ).all<{ user_id: number; type_id: number; amount_cents: number }>()).results ?? [];
      return json({ types, amounts, can_types: canUser(user, "payroll_allowance_types") });
    } catch (e) {
      if (!missing(e)) throw e;
      return json({ types: [], amounts: [], can_types: false, missing: true });
    }
  }

  /* ---- D1: create a type ---- */
  if (path === "/payroll/allowance-types" && method === "POST") {
    if (!canUser(user, "payroll_allowance_types")) return err("forbidden", "Only the CEO sets up allowance types", 403);
    const en = nameOf(body?.name_en);
    const ms = nameOf(body?.name_ms) ?? en;
    if (!en || !ms) return err("invalid_input", `A name of 2 to ${ALLOWANCE_NAME_MAX} characters is required`, 400);
    try {
      const dup = await env.DB.prepare(`SELECT id FROM payroll_allowance_types WHERE lower(name_en) = lower(?1)`).bind(en).first();
      if (dup) return err("duplicate", "An allowance type with that name already exists", 409);
      const sort = (await env.DB.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM payroll_allowance_types`).first<{ n: number }>())?.n ?? 1;
      const row = await env.DB.prepare(
        `INSERT INTO payroll_allowance_types (name_en, name_ms, sort, created_by, updated_by) VALUES (?1, ?2, ?3, ?4, ?4) RETURNING id`,
      ).bind(en, ms, sort, user.id).first<{ id: number }>();
      if (!row) return err("server_error", "The allowance type was not saved", 500);
      await env.DB.prepare(
        `INSERT INTO payroll_allowance_events (kind, type_id, new_value, by_user) VALUES ('type_create', ?1, ?2, ?3)`,
      ).bind(row.id, JSON.stringify({ name_en: en, name_ms: ms }), user.id).run();
      await audit(env, user.id, "payroll.allowance_type_create", "payroll_allowance_types", String(row.id), { name_en: en, name_ms: ms });
      return json({ ok: true, id: row.id });
    } catch (e) {
      if (missing(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0231_payroll_allowances)", 500);
      if (/UNIQUE/i.test(String(e))) return err("duplicate", "An allowance type with that name already exists", 409);
      throw e;
    }
  }

  /* ---- D1: rename, reorder, retire or restore a type, from the version the editor started from ---- */
  const mType = path.match(/^\/payroll\/allowance-types\/(\d+)$/);
  if (mType && method === "PATCH") {
    if (!canUser(user, "payroll_allowance_types")) return err("forbidden", "Only the CEO sets up allowance types", 403);
    const id = Number(mType[1]);
    const version = Number(body?.version);
    if (!Number.isInteger(version)) return err("invalid_input", "version is required", 400);
    let cur: TypeRow | null;
    try {
      cur = await env.DB.prepare(`SELECT id, name_en, name_ms, active, sort, version FROM payroll_allowance_types WHERE id = ?1`).bind(id).first<TypeRow>();
    } catch (e) {
      if (missing(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0231_payroll_allowances)", 500);
      throw e;
    }
    if (!cur) return err("not_found", "No such allowance type", 404);
    if (cur.version !== version) return err("changed", "Someone changed this allowance type - reload and try again", 409);
    const en = body?.name_en === undefined ? cur.name_en : nameOf(body.name_en);
    const ms = body?.name_ms === undefined ? cur.name_ms : nameOf(body.name_ms);
    if (!en || !ms) return err("invalid_input", `A name of 2 to ${ALLOWANCE_NAME_MAX} characters is required`, 400);
    const sort = body?.sort === undefined ? cur.sort : Number(body.sort);
    if (!Number.isInteger(sort) || sort < 0 || sort > 10000) return err("invalid_input", "sort must be a whole number", 400);
    const active = body?.active === undefined ? cur.active : body.active ? 1 : 0;
    if (en.toLowerCase() !== cur.name_en.toLowerCase()) {
      const dup = await env.DB.prepare(`SELECT id FROM payroll_allowance_types WHERE lower(name_en) = lower(?1) AND id != ?2`).bind(en, id).first();
      if (dup) return err("duplicate", "An allowance type with that name already exists", 409);
    }
    const kind = active !== cur.active ? (active ? "type_restore" : "type_retire") : "type_update";
    const r = await env.DB.prepare(
      `UPDATE payroll_allowance_types SET name_en = ?1, name_ms = ?2, sort = ?3, active = ?4,
         version = version + 1, updated_by = ?5, updated_at = datetime('now')
       WHERE id = ?6 AND version = ?7`,
    ).bind(en, ms, sort, active, user.id, id, version).run();
    if (!r.meta.changes) return err("changed", "Someone changed this allowance type - reload and try again", 409);
    const before = { name_en: cur.name_en, name_ms: cur.name_ms, sort: cur.sort, active: cur.active };
    const after = { name_en: en, name_ms: ms, sort, active };
    await env.DB.prepare(
      `INSERT INTO payroll_allowance_events (kind, type_id, old_value, new_value, by_user) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(kind, id, JSON.stringify(before), JSON.stringify(after), user.id).run();
    await audit(env, user.id, `payroll.allowance_${kind}`, "payroll_allowance_types", String(id), { from: before, to: after });
    return json({ ok: true, version: version + 1 });
  }

  /* ---- D2: one person's monthly amounts. `amounts` = {type_id: cents}; `expected` = the amounts the
     editor started from. A figure someone else changed in between is refused (409), never overwritten. ---- */
  const mAmt = path.match(/^\/payroll\/allowances\/(\d+)$/);
  if (mAmt && method === "PUT") {
    if (!canUser(user, "payroll_process")) return err("forbidden", "Payroll access required", 403);
    const uid = Number(mAmt[1]);
    const want = body?.amounts && typeof body.amounts === "object" ? body.amounts as Record<string, unknown> : null;
    const expected = body?.expected && typeof body.expected === "object" ? body.expected as Record<string, unknown> : {};
    if (!want) return err("invalid_input", "amounts is required", 400);
    const payee = await env.DB.prepare(
      `SELECT id FROM users WHERE id = ?1 AND ${staffRolesSql()} AND role NOT IN ('super_admin', 'admin') AND is_active = 1 AND ${payrollBaseStaffSql()}`,
    ).bind(uid).first();
    if (!payee) return err("invalid_input", "That account is not on the payroll", 400);
    let types: TypeRow[]; let cur: Map<number, number>;
    try {
      types = (await env.DB.prepare(`SELECT id, name_en, name_ms, active, sort, version FROM payroll_allowance_types`).all<TypeRow>()).results ?? [];
      cur = new Map(((await env.DB.prepare(`SELECT type_id, amount_cents FROM payroll_allowance_amounts WHERE user_id = ?1`)
        .bind(uid).all<{ type_id: number; amount_cents: number }>()).results ?? []).map((r) => [r.type_id, r.amount_cents]));
    } catch (e) {
      if (missing(e)) return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0231_payroll_allowances)", 500);
      throw e;
    }
    const byId = new Map(types.map((t) => [t.id, t]));
    const changes: { type_id: number; from: number; to: number }[] = [];
    for (const [k, v] of Object.entries(want)) {
      const tid = Number(k);
      const t = byId.get(tid);
      if (!t) return err("invalid_input", `No allowance type ${k}`, 400);
      const to = Math.round(Number(v));
      if (!Number.isFinite(to) || to < 0 || to > ALLOWANCE_MAX_CENTS) return err("invalid_input", "Each amount must be between RM 0 and RM 100,000", 400);
      const from = cur.get(tid) ?? 0;
      if (to === from) continue;
      if (!t.active && to > 0) return err("invalid_input", `${t.name_en} is retired - restore it before giving anyone an amount`, 400);
      const exp = Math.round(Number(expected[k] ?? 0));
      if (exp !== from) return err("changed", "Someone changed these allowances - reload and try again", 409);
      changes.push({ type_id: tid, from, to });
    }
    if (!changes.length) return json({ ok: true, changed: 0 });
    const stmts = [];
    for (const c of changes) {
      stmts.push(c.to === 0
        ? env.DB.prepare(`DELETE FROM payroll_allowance_amounts WHERE user_id = ?1 AND type_id = ?2`).bind(uid, c.type_id)
        : env.DB.prepare(
          `INSERT INTO payroll_allowance_amounts (user_id, type_id, amount_cents, updated_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (user_id, type_id) DO UPDATE SET amount_cents = ?3, updated_by = ?4, updated_at = datetime('now')`,
        ).bind(uid, c.type_id, c.to, user.id));
      stmts.push(env.DB.prepare(
        `INSERT INTO payroll_allowance_events (kind, type_id, user_id, old_value, new_value, by_user) VALUES ('amount_set', ?1, ?2, ?3, ?4, ?5)`,
      ).bind(c.type_id, uid, String(c.from), String(c.to), user.id));
    }
    await env.DB.batch(stmts);
    await audit(env, user.id, "payroll.allowance_update", "users", String(uid), { changes });
    return json({ ok: true, changed: changes.length });
  }
  return null;
}

/** The breakdown a monthly row may carry (POST /payroll `allowance_items`): stored only when its items add
    up to the row's allowance exactly, otherwise NULL - so a payslip can never itemise a figure that is
    not the one paid. */
export function allowanceItemsJson(v: unknown, allowanceCents: number): string | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) return null;
  const items: { type_id: number; name: string; cents: number }[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") return null;
    const o = it as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
    const c = Math.round(Number(o.cents));
    const tid = Number(o.type_id);
    if (!name || !Number.isFinite(c) || c <= 0 || !Number.isInteger(tid)) return null;
    items.push({ type_id: tid, name, cents: c });
  }
  return items.reduce((a, b) => a + b.cents, 0) === allowanceCents ? JSON.stringify(items) : null;
}
