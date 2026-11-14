/* v1.303.0 - ASSETS WORKSPACE 4.0, PHASE 1 (the CEO, 14-11-2026: "approve as
   recommendation" on claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md, D-0 ... D-10;
   migration 0193).

   The register routes stay where they are (worker/src/staff.ts /assets, the
   same paths, no second API); this file holds what phase 1 adds beside them:
     - the asset profile (0193): the owning company and, for a shared-use
       asset, the team or place that keeps it. A company is SET by someone
       who keeps the register (A5: never guessed); once set, only the CEO or
       COO moves it to the other company, with a reason (asset_company_change).
       A shared asset has no single holder.
     - the asset history (D-7): the asset events of the audit log - never the
       whole system log - for everyone who may open the register.
   Before 0193 is applied every asset reads "Company not set" and a company
   or shared label answers 503 not_ready; the register itself is untouched. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit } from "./shared";
import { can, rolesFor } from "./permissions";
import { notify } from "./staff";
import { isExecutiveOwner } from "./decision-policy";

const skew = (e: unknown) => /no such (table|column)/i.test(String(e));
export interface AssetProfile { issuer_code: string | null; shared_label: string | null }
export type ProfileInput = { issuer_code?: string | null; shared_label?: string | null; company_reason?: string };

export async function profileOf(env: Env, assetId: number | string): Promise<AssetProfile | null | "missing"> {
  try {
    return await env.DB.prepare(`SELECT issuer_code, shared_label FROM asset_profile WHERE asset_id = ?1`).bind(assetId).first<AssetProfile>();
  } catch (e) { if (skew(e)) return "missing"; throw e; }
}

/** what a body asks of the profile, checked - or a refusal. `holder` is the asset's
    holder AFTER the same request (a shared asset has nobody named). */
export function readProfile(body: Record<string, unknown> | null): { want: ProfileInput; any: boolean } | { error: Response } {
  const want: ProfileInput = {};
  if (body && "issuer_code" in body) {
    const v = body.issuer_code;
    if (v === null || v === "") want.issuer_code = null;
    else if (v === "a2z" || v === "azoo") want.issuer_code = v;
    else return { error: err("invalid_input", "The company is a2z (A2Z CREATIVE MARKETING), azoo (AZ ONE OFFICIAL) or not set.", 400) };
  }
  if (body && "shared_label" in body) {
    const v = body.shared_label;
    const t = typeof v === "string" ? v.trim() : "";
    if (v !== null && v !== "" && (t.length < 2 || t.length > 60)) return { error: err("invalid_input", "Name who shares it (2 to 60 characters, e.g. Studio team, Reception).", 400) };
    want.shared_label = t || null;
  }
  if (body && typeof body.company_reason === "string") want.company_reason = body.company_reason.trim();
  return { want, any: "issuer_code" in want || "shared_label" in want };
}

/** write the profile for one asset; refuses a company move without the right and a reason */
export async function writeProfile(env: Env, user: StaffUser, assetId: number, tag: string, want: ProfileInput, holder: number | null): Promise<Response | null> {
  const prev = await profileOf(env, assetId);
  if (prev === "missing") return err("not_ready", "The company and shared-use fields open once the database update (0193) is applied.", 503);
  const was = prev ?? { issuer_code: null, shared_label: null };
  const company = "issuer_code" in want ? want.issuer_code ?? null : was.issuer_code;
  const shared = "shared_label" in want ? want.shared_label ?? null : was.shared_label;
  if (shared && holder != null) return err("invalid_input", "A shared-use asset has no single holder - clear Assigned to, or clear the shared label.", 400);
  const moved = was.issuer_code != null && company !== was.issuer_code;
  if (moved) {
    if (!can(user.role, "asset_company_change")) return err("forbidden", "Only the CEO or COO moves an asset to the other company once its company is set.", 403);
    if ((want.company_reason ?? "").length < 10) return err("invalid_input", "Give the reason for the company change (at least 10 characters).", 400);
  }
  if (company === was.issuer_code && shared === was.shared_label) return null;
  await env.DB.prepare(
    `INSERT INTO asset_profile (asset_id, issuer_code, shared_label, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
     ON CONFLICT(asset_id) DO UPDATE SET issuer_code = excluded.issuer_code, shared_label = excluded.shared_label, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(assetId, company, shared, user.id).run();
  if (moved) await audit(env, user.id, "asset.company_change", "assets", String(assetId), { tag, from: was.issuer_code, to: company, reason: want.company_reason });
  else await audit(env, user.id, "asset.profile", "assets", String(assetId), { tag, changes: {
    ...(company !== was.issuer_code ? { issuer_code: [was.issuer_code, company] } : {}),
    ...(shared !== was.shared_label ? { shared_label: [was.shared_label, shared] } : {}),
  } });
  return null;
}

/** GET /assets/history[?asset=ID] - the asset events of the audit log (D-7), newest first */
export async function handleAssetHistory(env: Env, path: string, method: string, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  if (path !== "/assets/history" || method !== "GET") return null;
  if (!can(user.role, "asset_view")) return err("forbidden", "The asset register is not open to your role", 403);
  const one = params.get("asset");
  const id = one && /^\d+$/.test(one) ? one : null;
  const limit = Math.min(500, Math.max(1, Number(params.get("limit")) || 300));
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.action, l.entity_id, l.detail, l.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS user_name
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.entity = 'assets' AND l.action LIKE 'asset.%' ${id ? "AND l.entity_id = ?1" : ""}
      ORDER BY l.id DESC LIMIT ${limit}`,
  ).bind(...(id ? [id] : [])).all();
  return json({ entries: results ?? [] });
}

/** the changed fields of an edit, as [before, after] - what the audit keeps since 4.0 */
export function changesOf(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of fields) {
    const a = before[f] ?? null, b = after[f] ?? null;
    if (a !== b) out[f] = [a, b];
  }
  return out;
}

/* =====================================================================
   v1.304.0 - PHASE 2: CUSTODY (the CEO, 14-11-2026: "Phase 2 now";
   blueprint section 5, decisions D-2, D-4, D-5; migration 0194).

     assign       a free asset to a person (asset_manage)
     acknowledge  ONLY the new holder, from their own account - nobody
                  acknowledges for someone else; until then the register
                  shows "Waiting for acknowledgement" (3 days on, the issuer
                  gets an ordinary Task - assetAckSweep)
     transfer     to another person, with a reason (asset_manage); the
                  previous holder is kept and told
     return       by management or by the holder themself, with the
                  condition (damaged goes to In repair)
     cancel       an unacknowledged hand-over, back to who held it before
     request      a manager (users.reports_to) asks for an assignment or a
                  transfer inside their team; management approves (never
                  their own request, the verified owner apart) or declines
   One append-only row per step; the register's holder (assets.assigned_to)
   is written in the SAME batch, so the two never disagree. After 0194 a
   plain edit of the holder is refused (D-5). Holders from before 4.0 are
   the starting point - no earlier step is invented. Notifications carry the
   asset tag only, never a cost. */

export async function custodyLive(env: Env): Promise<boolean> {
  try { await env.DB.prepare(`SELECT id FROM asset_custody LIMIT 1`).first(); return true; }
  catch (e) { if (skew(e)) return false; throw e; }
}
interface AssetRow { id: number; asset_tag: string; name: string; status: string; assigned_to: number | null; location: string | null; deleted_at?: string | null }
interface Step { id: number; asset_id: number; kind: string; from_holder: number | null; to_holder: number | null; actor_id: number; created_at: string; reason: string | null; request_id: number | null }
const PERSON_SQL = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
/** the hand-over still waiting for its holder's acknowledgement, if any */
export const PENDING_SQL = (a: string) => `(SELECT c.id FROM asset_custody c WHERE c.asset_id = ${a}.id AND c.kind IN ('assign', 'transfer') AND c.to_holder = ${a}.assigned_to
  AND NOT EXISTS (SELECT 1 FROM asset_custody k WHERE k.asset_id = ${a}.id AND k.id > c.id AND k.kind IN ('acknowledge', 'return', 'cancel', 'assign', 'transfer')) ORDER BY c.id DESC LIMIT 1)`;
async function pendingOf(env: Env, a: AssetRow): Promise<Step | null> {
  if (a.assigned_to == null) return null;
  const id = await env.DB.prepare(`SELECT ${PENDING_SQL("a")} AS pid FROM assets a WHERE a.id = ?1`).bind(a.id).first<{ pid: number | null }>();
  return id?.pid ? env.DB.prepare(`SELECT * FROM asset_custody WHERE id = ?1`).bind(id.pid).first<Step>() : null;
}
/** an active staff member who may hold an asset (asset_self) */
async function staffOk(env: Env, id: unknown): Promise<number | null> {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const u = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ?1 AND is_active = 1`).bind(n).first<{ id: number; role: string }>();
  return u && can(u.role as StaffUser["role"], "asset_self") ? u.id : null;
}
async function teamOf(env: Env, managerId: number): Promise<number[]> {
  return ((await env.DB.prepare(`SELECT id FROM users WHERE reports_to = ?1 AND is_active = 1`).bind(managerId).all<{ id: number }>()).results ?? []).map((r) => r.id);
}
const textOf = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const CONDITIONS = ["good", "fair", "damaged"] as const;

/** one custody step and the register's holder, in one batch */
async function step(env: Env, user: StaffUser, a: AssetRow, kind: string, x: { from?: number | null; to?: number | null; location?: string | null; reason?: string | null; condition?: string | null; request?: number | null }, holderAfter: number | null | undefined, status?: string) {
  const stmts = [env.DB.prepare(`INSERT INTO asset_custody (asset_id, kind, from_holder, to_holder, location, reason, condition, request_id, actor_id, actor_role) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(a.id, kind, x.from ?? null, x.to ?? null, x.location ?? null, x.reason ?? null, x.condition ?? null, x.request ?? null, user.id, user.role)];
  if (holderAfter !== undefined) {
    stmts.push(env.DB.prepare(`UPDATE assets SET assigned_to = ?1, status = COALESCE(?2, status), location = COALESCE(?3, location), updated_at = datetime('now') WHERE id = ?4`)
      .bind(holderAfter, status ?? null, x.location ?? null, a.id));
  }
  await env.DB.batch(stmts);
  await audit(env, user.id, `asset.custody_${kind}`, "assets", String(a.id), { tag: a.asset_tag, from: x.from ?? null, to: x.to ?? null, ...(x.reason ? { reason: x.reason } : {}), ...(x.condition ? { condition: x.condition } : {}), ...(x.request ? { request: x.request } : {}) });
}
async function managers(env: Env, except: number): Promise<number[]> {
  const roles = rolesFor("asset_manage") as readonly string[];
  return ((await env.DB.prepare(`SELECT id, role FROM users WHERE is_active = 1`).all<{ id: number; role: string }>()).results ?? []).filter((u) => roles.includes(u.role) && u.id !== except && u.role !== "super_admin").map((u) => u.id);
}

/** assign or transfer: shared by the direct action and an approved request */
async function handOver(env: Env, user: StaffUser, a: AssetRow, to: number, reason: string | null, location: string | null, request: number | null): Promise<Response | null> {
  if (["lost", "disposed"].includes(a.status)) return err("invalid_state", `${a.asset_tag} is ${a.status} - it is not handed to anyone.`, 409);
  if (a.assigned_to === to) return err("invalid_state", "That person already holds it.", 409);
  const transfer = a.assigned_to != null;
  if (transfer && (reason ?? "").length < 10) return err("invalid_input", "A transfer needs its reason (at least 10 characters).", 400);
  await step(env, user, a, transfer ? "transfer" : "assign", { from: a.assigned_to, to, location, reason, request }, to, a.status === "spare" ? "in_use" : undefined);
  /* one holder, or shared - never both: a person named ends the shared use */
  await env.DB.prepare(`UPDATE asset_profile SET shared_label = NULL, updated_by = ?1, updated_at = datetime('now') WHERE asset_id = ?2 AND shared_label IS NOT NULL`).bind(user.id, a.id).run().catch(() => null);
  await notify(env, to, "asset", `${a.asset_tag} was handed to you - open Assets to acknowledge it.`, `asset_ho:${a.id}:${to}:${Date.now()}`);
  if (transfer && a.assigned_to != null) await notify(env, a.assigned_to, "asset", `${a.asset_tag} was transferred from you.`, `asset_tr:${a.id}:${a.assigned_to}:${Date.now()}`);
  return null;
}

export async function handleCustody(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response | null> {
  try { return await custodyRoute(env, path, method, body ?? {}, user); }
  catch (e) { if (skew(e)) return err("not_ready", "Custody opens once the database update (0194) is applied.", 503); throw e; }
}

async function custodyRoute(env: Env, path: string, method: string, b: Record<string, unknown>, user: StaffUser): Promise<Response | null> {
  const manage = can(user.role, "asset_manage");

  /* ---- My assets (D-4), my team's (D-2), my requests ---- */
  if (path === "/assets/mine" && method === "GET") {
    if (!can(user.role, "asset_self")) return err("forbidden", "Not open to your role", 403);
    const cols = `a.id, a.asset_tag, a.name, a.category, a.brand_model, a.serial_no, a.location, a.status, a.assigned_to, ${PERSON_SQL("u")} AS holder,
      ${PENDING_SQL("a")} AS pending_id,
      (SELECT c.created_at FROM asset_custody c WHERE c.asset_id = a.id AND c.kind IN ('assign', 'transfer') AND c.to_holder = a.assigned_to ORDER BY c.id DESC LIMIT 1) AS handed_at,
      (SELECT ${PERSON_SQL("iu")} FROM asset_custody c JOIN users iu ON iu.id = c.actor_id WHERE c.asset_id = a.id AND c.kind IN ('assign', 'transfer') AND c.to_holder = a.assigned_to ORDER BY c.id DESC LIMIT 1) AS handed_by`;
    const mine = (await env.DB.prepare(`SELECT ${cols} FROM assets a LEFT JOIN users u ON u.id = a.assigned_to WHERE a.assigned_to = ?1 AND a.deleted_at IS NULL ORDER BY a.asset_tag`).bind(user.id).all()).results ?? [];
    const team = await teamOf(env, user.id);
    const teamAssets = team.length ? (await env.DB.prepare(`SELECT ${cols} FROM assets a LEFT JOIN users u ON u.id = a.assigned_to WHERE a.assigned_to IN (${team.map(() => "?").join(", ")}) AND a.deleted_at IS NULL ORDER BY holder, a.asset_tag`).bind(...team).all()).results ?? [] : [];
    const people = team.length ? (await env.DB.prepare(`SELECT id, ${PERSON_SQL("u")} AS name FROM users u WHERE id IN (${team.map(() => "?").join(", ")}) ORDER BY name`).bind(...team).all()).results ?? [] : [];
    const spare = team.length ? (await env.DB.prepare(`SELECT a.id, a.asset_tag, a.name, a.category FROM assets a LEFT JOIN asset_profile p ON p.asset_id = a.id WHERE a.assigned_to IS NULL AND a.status IN ('spare', 'in_use') AND a.deleted_at IS NULL AND p.shared_label IS NULL ORDER BY a.asset_tag`).all().catch(() => env.DB.prepare(`SELECT a.id, a.asset_tag, a.name, a.category FROM assets a WHERE a.assigned_to IS NULL AND a.status IN ('spare', 'in_use') AND a.deleted_at IS NULL ORDER BY a.asset_tag`).all())).results ?? [] : [];
    const requests = (await env.DB.prepare(
      `SELECT r.id, r.asset_id, a.asset_tag, a.name, r.to_holder, ${PERSON_SQL("tu")} AS to_name, r.reason, r.created_at,
              (SELECT d.kind FROM asset_custody d WHERE d.request_id = r.id AND d.kind IN ('approve', 'decline') ORDER BY d.id DESC LIMIT 1) AS decision,
              (SELECT d.reason FROM asset_custody d WHERE d.request_id = r.id AND d.kind = 'decline' ORDER BY d.id DESC LIMIT 1) AS decline_reason
         FROM asset_custody r JOIN assets a ON a.id = r.asset_id LEFT JOIN users tu ON tu.id = r.to_holder
        WHERE r.kind = 'request' AND r.actor_id = ?1 ORDER BY r.id DESC LIMIT 30`,
    ).bind(user.id).all()).results ?? [];
    return json({ mine, team: teamAssets, people, spare, requests, me: user.id, can: { manage, team: team.length > 0, care: await careLive(env) } });
  }

  /* ---- the management queue: hand-overs not acknowledged, requests waiting ---- */
  if (path === "/assets/custody" && method === "GET") {
    if (!can(user.role, "asset_view")) return err("forbidden", "The asset register is not open to your role", 403);
    const waiting = (await env.DB.prepare(
      `SELECT a.id, a.asset_tag, a.name, ${PERSON_SQL("u")} AS holder, c.id AS step_id, c.kind, c.created_at AS since, ${PERSON_SQL("iu")} AS issued_by
         FROM assets a JOIN asset_custody c ON c.id = ${PENDING_SQL("a")} LEFT JOIN users u ON u.id = a.assigned_to LEFT JOIN users iu ON iu.id = c.actor_id
        WHERE a.deleted_at IS NULL ORDER BY c.id`,
    ).all()).results ?? [];
    const requests = (await env.DB.prepare(
      `SELECT r.id, r.asset_id, a.asset_tag, a.name, r.from_holder, ${PERSON_SQL("fu")} AS from_name, r.to_holder, ${PERSON_SQL("tu")} AS to_name, r.reason, r.created_at, r.actor_id AS requested_by_id, ${PERSON_SQL("ru")} AS requested_by
         FROM asset_custody r JOIN assets a ON a.id = r.asset_id LEFT JOIN users fu ON fu.id = r.from_holder LEFT JOIN users tu ON tu.id = r.to_holder LEFT JOIN users ru ON ru.id = r.actor_id
        WHERE r.kind = 'request' AND NOT EXISTS (SELECT 1 FROM asset_custody d WHERE d.request_id = r.id AND d.kind IN ('approve', 'decline')) ORDER BY r.id`,
    ).all()).results ?? [];
    return json({ waiting, requests, me: user.id, can: { decide: manage } });
  }

  /* ---- a manager asks for an assignment or a transfer inside their team (D-2) ---- */
  if (path === "/assets/custody/requests" && method === "POST") {
    if (!can(user.role, "asset_self")) return err("forbidden", "Not open to your role", 403);
    const team = await teamOf(env, user.id);
    const to = await staffOk(env, b.to_holder);
    if (!to || !team.includes(to)) return err("forbidden", "You request a hand-over only to someone in your own team.", 403);
    const a = await env.DB.prepare(`SELECT * FROM assets WHERE id = ?1 AND deleted_at IS NULL`).bind(Number(b.asset_id)).first<AssetRow>();
    if (!a) return err("not_found", "Asset not found", 404);
    if (a.assigned_to != null && !team.includes(a.assigned_to)) return err("forbidden", "That asset is held outside your team - ask its keepers.", 403);
    if (["lost", "disposed"].includes(a.status)) return err("invalid_state", `${a.asset_tag} is ${a.status}.`, 409);
    if (a.assigned_to === to) return err("invalid_state", "That person already holds it.", 409);
    const reason = textOf(b.reason, 300);
    if (reason.length < 10) return err("invalid_input", "Say why (at least 10 characters).", 400);
    const open = await env.DB.prepare(`SELECT r.id FROM asset_custody r WHERE r.asset_id = ?1 AND r.kind = 'request' AND NOT EXISTS (SELECT 1 FROM asset_custody d WHERE d.request_id = r.id AND d.kind IN ('approve', 'decline'))`).bind(a.id).first();
    if (open) return err("duplicate", "A request for this asset is already waiting.", 409);
    await step(env, user, a, "request", { from: a.assigned_to, to, reason }, undefined);
    for (const id of await managers(env, user.id)) await notify(env, id, "asset", `A hand-over of ${a.asset_tag} is requested - open Assets > Assignments.`, `asset_rq:${a.id}:${Date.now()}`);
    return json({ ok: true }, 201);
  }
  const mD = /^\/assets\/custody\/requests\/(\d+)\/decide$/.test(path) ? path.split("/")[4] : null;
  if (mD && method === "POST") {
    if (!manage) return err("forbidden", "Only the register's keepers decide a hand-over request", 403);
    const r = await env.DB.prepare(`SELECT * FROM asset_custody WHERE id = ?1 AND kind = 'request'`).bind(Number(mD)).first<Step>();
    if (!r) return err("not_found", "Request not found", 404);
    if (await env.DB.prepare(`SELECT id FROM asset_custody WHERE request_id = ?1 AND kind IN ('approve', 'decline')`).bind(r.id).first()) return err("invalid_state", "This request was already decided.", 409);
    if (r.actor_id === user.id && !isExecutiveOwner(user)) {
      await audit(env, user.id, "auth.self_approval_refused", "assets", String(r.asset_id), { action: "asset.custody_request" });
      return err("self_approval", "You made this request - another keeper decides it.", 403);
    }
    const a = await env.DB.prepare(`SELECT * FROM assets WHERE id = ?1 AND deleted_at IS NULL`).bind(r.asset_id).first<AssetRow>();
    if (!a) return err("not_found", "Asset not found", 404);
    const reason = textOf(b.reason, 300);
    if (b.decision === "decline") {
      if (reason.length < 5) return err("invalid_input", "Say why it is declined.", 400);
      await step(env, user, a, "decline", { from: r.from_holder, to: r.to_holder, reason, request: r.id }, undefined);
      await notify(env, r.actor_id, "asset", `Your hand-over request for ${a.asset_tag} was declined.`, `asset_rqd:${r.id}`, { once: true });
      return json({ ok: true });
    }
    if (b.decision !== "approve") return err("invalid_input", "decision is approve or decline", 400);
    if (a.assigned_to !== r.from_holder) return err("stale", "The asset changed hands since the request - decline it and ask again.", 409);
    const to = await staffOk(env, r.to_holder);
    if (!to) return err("invalid_state", "The person it was for is no longer active - decline it.", 409);
    await step(env, user, a, "approve", { from: r.from_holder, to, reason: reason || null, request: r.id }, undefined);
    const refused = await handOver(env, user, a, to, r.reason, null, r.id);
    if (refused) return refused;
    await notify(env, r.actor_id, "asset", `Your hand-over request for ${a.asset_tag} was approved.`, `asset_rqa:${r.id}`, { once: true });
    return json({ ok: true });
  }

  /* ---- one asset's custody: its steps, and the actions ---- */
  const mA = /^\/assets\/(\d+)\/custody$/.test(path) ? path.split("/")[2] : null;
  if (!mA) return null;
  const a = await env.DB.prepare(`SELECT * FROM assets WHERE id = ?1 AND deleted_at IS NULL`).bind(Number(mA)).first<AssetRow>();
  if (!a) return err("not_found", "Asset not found", 404);
  const holder = a.assigned_to === user.id;

  if (method === "GET") {
    const team = a.assigned_to != null ? await teamOf(env, user.id) : [];
    if (!can(user.role, "asset_view") && !holder && !(a.assigned_to != null && team.includes(a.assigned_to))) return err("forbidden", "Not an asset you hold or keep", 403);
    const steps = (await env.DB.prepare(
      `SELECT c.id, c.kind, c.from_holder, ${PERSON_SQL("fu")} AS from_name, c.to_holder, ${PERSON_SQL("tu")} AS to_name, c.location, c.reason, c.condition, c.request_id, c.created_at, ${PERSON_SQL("au")} AS actor
         FROM asset_custody c LEFT JOIN users fu ON fu.id = c.from_holder LEFT JOIN users tu ON tu.id = c.to_holder LEFT JOIN users au ON au.id = c.actor_id
        WHERE c.asset_id = ?1 ORDER BY c.id DESC`,
    ).bind(a.id).all()).results ?? [];
    const pending = await pendingOf(env, a);
    return json({ steps, pending_id: pending?.id ?? null, can: { manage, acknowledge: holder && !!pending, return: manage || holder } });
  }
  if (method !== "POST") return null;
  const action = String(b.action ?? "");
  const location = textOf(b.location, 120) || null;

  if (action === "acknowledge") {
    /* the holder only - nobody acknowledges for someone else, not even management */
    if (!holder) return err("forbidden", "Only the person it was handed to acknowledges it.", 403);
    const p = await pendingOf(env, a);
    if (!p) return err("invalid_state", "Nothing is waiting for your acknowledgement on this asset.", 409);
    await step(env, user, a, "acknowledge", { from: p.from_holder, to: user.id, condition: CONDITIONS.includes(b.condition as typeof CONDITIONS[number]) ? String(b.condition) : null, reason: textOf(b.note, 300) || null }, undefined);
    return json({ ok: true });
  }
  if (action === "return") {
    if (!manage && !holder) return err("forbidden", "The holder or the register's keepers return an asset.", 403);
    if (a.assigned_to == null) return err("invalid_state", "Nobody holds it.", 409);
    const condition = String(b.condition ?? "");
    if (!CONDITIONS.includes(condition as typeof CONDITIONS[number])) return err("invalid_input", "Say its condition: good, fair or damaged.", 400);
    const note = textOf(b.reason, 300) || null;
    if (condition === "damaged" && (note ?? "").length < 5) return err("invalid_input", "Say what is damaged.", 400);
    await step(env, user, a, "return", { from: a.assigned_to, to: null, location, reason: note, condition }, null, condition === "damaged" ? "repair" : a.status === "in_use" ? "spare" : undefined);
    /* v1.305.0 - a damaged return is also an issue on the asset, so the repair that follows answers it */
    if (condition === "damaged" && (await careLive(env))) await careStep(env, user, { ...a, status: "repair" }, "asset_issues", { kind: "report", description: `Returned damaged: ${note}` });
    if (!holder) await notify(env, a.assigned_to, "asset", `${a.asset_tag} was recorded as returned from you.`, `asset_rt:${a.id}:${Date.now()}`);
    return json({ ok: true });
  }
  if (!manage) return err("forbidden", "Only the register's keepers hand an asset over", 403);
  if (action === "assign" || action === "transfer") {
    const to = await staffOk(env, b.to_holder);
    if (!to) return err("invalid_input", "Choose an active member of staff.", 400);
    if (action === "assign" && a.assigned_to != null) return err("invalid_state", "Someone holds it - transfer it instead.", 409);
    if (action === "transfer" && a.assigned_to == null) return err("invalid_state", "Nobody holds it - assign it instead.", 409);
    const refused = await handOver(env, user, a, to, textOf(b.reason, 300) || null, location, null);
    return refused ?? json({ ok: true });
  }
  if (action === "cancel") {
    const p = await pendingOf(env, a);
    if (!p) return err("invalid_state", "No unacknowledged hand-over to cancel.", 409);
    const reason = textOf(b.reason, 300);
    if (reason.length < 5) return err("invalid_input", "Say why it is cancelled.", 400);
    await step(env, user, a, "cancel", { from: p.to_holder, to: p.from_holder, reason }, p.from_holder);
    if (p.to_holder != null) await notify(env, p.to_holder, "asset", `The hand-over of ${a.asset_tag} to you was cancelled.`, `asset_cx:${p.id}`, { once: true });
    return json({ ok: true });
  }
  return err("invalid_input", "action is assign, transfer, return, acknowledge or cancel", 400);
}

/** v1.304.0 - hourly: a hand-over unacknowledged for 3 days becomes an ordinary Task for whoever issued it (once) */
export async function assetAckSweep(env: Env): Promise<number> {
  let rows: { id: number; asset_tag: string; actor_id: number }[] = [];
  try {
    rows = ((await env.DB.prepare(
      `SELECT c.id, a.asset_tag, c.actor_id FROM assets a JOIN asset_custody c ON c.id = ${PENDING_SQL("a")}
        WHERE a.deleted_at IS NULL AND c.created_at <= datetime('now', '-3 days')
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.link_kind = 'asset_custody' AND t.link_id = c.id)`,
    ).all<{ id: number; asset_tag: string; actor_id: number }>()).results ?? []);
  } catch (e) { if (skew(e)) return 0; throw e; }
  for (const r of rows) {
    await env.DB.prepare(`INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id) VALUES (?1, ?2, ?3, ?3, 'normal', date('now', '+8 hours'), 'asset_custody', ?4)`)
      .bind(`${r.asset_tag}: hand-over not acknowledged yet`, "The person it was handed to has not acknowledged it for 3 days - check with them, or cancel the hand-over in Assets.", r.actor_id, r.id).run();
  }
  return rows.length;
}

/* =====================================================================
   v1.305.0 - PHASE 3: MAINTENANCE AND DISPOSAL (the CEO, 14-11-2026:
   "Phase 3"; blueprint section 6, decisions D-6 and D-8; migration 0195).

     issue     report what is wrong (the register's readers, the holder, the
               holder's manager); not a status change. Resolve closes it with
               no repair (asset_manage).
     repair    sent (asset_manage) sets In repair; an expected-back date that
               passes becomes one ordinary Task for whoever sent it. Back:
               fixed returns it to the holder (In use) or to Spare; not
               repairable leaves it In repair. The cost is a NOTE and the
               expense is a read-only LINK to what Finance recorded - nothing
               is created or posted from here.
     lost      reported by the same people as an issue; sets Lost. Found again
               (asset_manage) sets In use with the holder, or Spare.
     disposal  requested by the keepers once nobody holds it; approved or
               rejected by the CEO or COO (asset_dispose_approve) - never the
               requester, the verified owner apart. Approval sets Disposed.
               No write-off, journal, cash or income row: proceeds are a note.
   Every table is append-only; the asset row is never deleted. Before 4.0 an
   asset may already be In repair or Lost with no record - that is the
   starting point, nothing earlier is invented. Once 0195 is applied a plain
   edit no longer moves an asset to or from In repair, Lost or Disposed
   (use_care). Notifications carry the asset tag only. */

export async function careLive(env: Env): Promise<boolean> {
  try { await env.DB.prepare(`SELECT id FROM asset_disposals LIMIT 1`).first(); return true; }
  catch (e) { if (skew(e)) return false; throw e; }
}
export const CARE_STATUSES = ["repair", "lost", "disposed"] as const;
const METHODS = ["sold", "scrapped", "donated", "returned_to_vendor", "written_off"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v: unknown): string | null | false => (v == null || v === "" ? null : typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : false);
/** a ringgit amount typed as a note - or null; false when it is not a number */
const centsOf = (v: unknown): number | null | false => {
  if (v == null || String(v).trim() === "") return null;
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : false;
};
/* an issue is open until it is resolved, a repair sent for it comes back fixed, or the asset is disposed */
const OPEN_ISSUE = `NOT EXISTS (SELECT 1 FROM asset_issues r WHERE r.kind = 'resolve' AND r.ref_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM asset_repairs b JOIN asset_repairs s ON s.id = b.ref_id WHERE b.kind = 'back' AND b.outcome = 'fixed' AND s.issue_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM asset_disposals d WHERE d.kind = 'approve' AND d.asset_id = i.asset_id)`;
const OPEN_REPAIR = `NOT EXISTS (SELECT 1 FROM asset_repairs b WHERE b.kind = 'back' AND b.ref_id = s.id)`;
const OPEN_LOST = `NOT EXISTS (SELECT 1 FROM asset_incidents f WHERE f.kind = 'found' AND f.ref_id = l.id)`;
const OPEN_DISPOSAL = `NOT EXISTS (SELECT 1 FROM asset_disposals x WHERE x.kind IN ('approve', 'reject') AND x.ref_id = q.id)`;

async function openOf(env: Env, assetId: number) {
  const [issues, repair, lost, disposal] = await Promise.all([
    env.DB.prepare(`SELECT i.id FROM asset_issues i WHERE i.asset_id = ?1 AND i.kind = 'report' AND ${OPEN_ISSUE} ORDER BY i.id`).bind(assetId).all<{ id: number }>(),
    env.DB.prepare(`SELECT s.* FROM asset_repairs s WHERE s.asset_id = ?1 AND s.kind = 'sent' AND ${OPEN_REPAIR} ORDER BY s.id DESC LIMIT 1`).bind(assetId).first<{ id: number; actor_id: number; repairer: string | null }>(),
    env.DB.prepare(`SELECT l.* FROM asset_incidents l WHERE l.asset_id = ?1 AND l.kind = 'lost' AND ${OPEN_LOST} ORDER BY l.id DESC LIMIT 1`).bind(assetId).first<{ id: number; status_before: string | null }>(),
    env.DB.prepare(`SELECT q.* FROM asset_disposals q WHERE q.asset_id = ?1 AND q.kind = 'request' AND ${OPEN_DISPOSAL} ORDER BY q.id DESC LIMIT 1`).bind(assetId).first<{ id: number; actor_id: number; method: string; reason: string | null; proceeds_cents: number | null }>(),
  ]);
  return { issues: (issues.results ?? []).map((r) => r.id), repair: repair ?? null, lost: lost ?? null, disposal: disposal ?? null };
}

/** the step row and the asset's new status in ONE batch, then the audit */
async function careStep(env: Env, user: StaffUser, a: AssetRow, table: "asset_issues" | "asset_repairs" | "asset_incidents" | "asset_disposals", row: Record<string, unknown>, status?: string) {
  const cols = Object.keys(row);
  const stmts = [env.DB.prepare(`INSERT INTO ${table} (asset_id, ${cols.join(", ")}, actor_id, actor_role) VALUES (?1, ${cols.map((_, i) => `?${i + 2}`).join(", ")}, ?${cols.length + 2}, ?${cols.length + 3})`)
    .bind(a.id, ...cols.map((c) => (row[c] ?? null) as string | number | null), user.id, user.role)];
  if (status && status !== a.status) stmts.push(env.DB.prepare(`UPDATE assets SET status = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(status, a.id));
  await env.DB.batch(stmts);
  const money = new Set(["cost_cents", "proceeds_cents"]);
  await audit(env, user.id, `asset.care_${table.slice(6)}_${String(row.kind)}`, "assets", String(a.id), {
    tag: a.asset_tag, ...(status && status !== a.status ? { status: [a.status, status] } : {}),
    ...Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== "kind" && v != null && !money.has(k))),
  });
}
async function peopleWith(env: Env, cap: Parameters<typeof rolesFor>[0], except: number): Promise<number[]> {
  const roles = rolesFor(cap) as readonly string[];
  return ((await env.DB.prepare(`SELECT id, role FROM users WHERE is_active = 1`).all<{ id: number; role: string }>()).results ?? []).filter((u) => roles.includes(u.role) && u.id !== except && u.role !== "super_admin").map((u) => u.id);
}

export async function handleCare(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser): Promise<Response | null> {
  try { return await careRoute(env, path, method, body ?? {}, user); }
  catch (e) { if (skew(e)) return err("not_ready", "Maintenance and disposal open once the database update (0195) is applied.", 503); throw e; }
}

const EVENTS_SQL = (where: string) => `SELECT * FROM (
  SELECT 'issue' AS area, i.id, i.asset_id, i.kind, i.ref_id, i.description AS detail, i.noticed_on AS day, NULL AS repairer, NULL AS reference, NULL AS outcome, NULL AS method, NULL AS cost_cents, NULL AS proceeds_cents, NULL AS expense_id, NULL AS place, NULL AS police_ref, i.actor_id, i.created_at FROM asset_issues i
  UNION ALL SELECT 'repair', r.id, r.asset_id, r.kind, r.ref_id, r.note, r.expected_on, r.repairer, r.reference, r.outcome, NULL, r.cost_cents, NULL, r.expense_id, NULL, NULL, r.actor_id, r.created_at FROM asset_repairs r
  UNION ALL SELECT 'incident', n.id, n.asset_id, n.kind, n.ref_id, n.circumstances, n.last_seen_on, NULL, NULL, NULL, NULL, NULL, NULL, NULL, n.last_seen_place, n.police_ref, n.actor_id, n.created_at FROM asset_incidents n
  UNION ALL SELECT 'disposal', d.id, d.asset_id, d.kind, d.ref_id, d.reason, NULL, NULL, NULL, NULL, d.method, NULL, d.proceeds_cents, NULL, NULL, NULL, d.actor_id, d.created_at FROM asset_disposals d
) e ${where}`;
const withNames = (inner: string) => `SELECT e.*, a.asset_tag, a.name, a.status, ${PERSON_SQL("u")} AS actor FROM (${inner}) e JOIN assets a ON a.id = e.asset_id LEFT JOIN users u ON u.id = e.actor_id`;

async function careRoute(env: Env, path: string, method: string, b: Record<string, unknown>, user: StaffUser): Promise<Response | null> {
  const manage = can(user.role, "asset_manage");
  const approve = can(user.role, "asset_dispose_approve");

  /* ---- the Maintenance & Disposal board ---- */
  if (path === "/assets/care" && method === "GET") {
    if (!can(user.role, "asset_view")) return err("forbidden", "The asset register is not open to your role", 403);
    const issues = (await env.DB.prepare(
      `SELECT i.id, i.asset_id, a.asset_tag, a.name, a.status, i.description, i.noticed_on, i.created_at, ${PERSON_SQL("u")} AS reported_by
         FROM asset_issues i JOIN assets a ON a.id = i.asset_id LEFT JOIN users u ON u.id = i.actor_id
        WHERE i.kind = 'report' AND a.deleted_at IS NULL AND ${OPEN_ISSUE} ORDER BY i.id`,
    ).all()).results ?? [];
    const repair = (await env.DB.prepare(
      `SELECT a.id, a.asset_tag, a.name, a.location, a.assigned_to, ${PERSON_SQL("h")} AS holder, s.id AS repair_id, s.repairer, s.reference, s.expected_on, s.created_at AS sent_at
         FROM assets a LEFT JOIN users h ON h.id = a.assigned_to
         LEFT JOIN asset_repairs s ON s.id = (SELECT s.id FROM asset_repairs s WHERE s.asset_id = a.id AND s.kind = 'sent' AND ${OPEN_REPAIR} ORDER BY s.id DESC LIMIT 1)
        WHERE a.status = 'repair' AND a.deleted_at IS NULL ORDER BY a.asset_tag`,
    ).all()).results ?? [];
    const lost = (await env.DB.prepare(
      `SELECT a.id, a.asset_tag, a.name, a.assigned_to, ${PERSON_SQL("h")} AS holder, l.id AS incident_id, l.last_seen_place, l.last_seen_on, l.circumstances, l.police_ref, l.created_at AS reported_at, ${PERSON_SQL("ru")} AS reported_by
         FROM assets a LEFT JOIN users h ON h.id = a.assigned_to
         LEFT JOIN asset_incidents l ON l.id = (SELECT l.id FROM asset_incidents l WHERE l.asset_id = a.id AND l.kind = 'lost' AND ${OPEN_LOST} ORDER BY l.id DESC LIMIT 1)
         LEFT JOIN users ru ON ru.id = l.actor_id
        WHERE a.status = 'lost' AND a.deleted_at IS NULL ORDER BY a.asset_tag`,
    ).all()).results ?? [];
    const disposed = (await env.DB.prepare(
      `SELECT a.id, a.asset_tag, a.name, d.id AS approval_id, q.method, q.reason, q.proceeds_cents, d.created_at AS disposed_at, ${PERSON_SQL("du")} AS approved_by, ${PERSON_SQL("qu")} AS requested_by
         FROM assets a
         LEFT JOIN asset_disposals d ON d.id = (SELECT d.id FROM asset_disposals d WHERE d.asset_id = a.id AND d.kind = 'approve' ORDER BY d.id DESC LIMIT 1)
         LEFT JOIN asset_disposals q ON q.id = d.ref_id LEFT JOIN users du ON du.id = d.actor_id LEFT JOIN users qu ON qu.id = q.actor_id
        WHERE a.status = 'disposed' AND a.deleted_at IS NULL ORDER BY a.asset_tag`,
    ).all()).results ?? [];
    const pending = (await env.DB.prepare(
      `SELECT q.id, q.asset_id, a.asset_tag, a.name, a.status, q.method, q.reason, q.proceeds_cents, q.created_at, q.actor_id AS requested_by_id, ${PERSON_SQL("u")} AS requested_by
         FROM asset_disposals q JOIN assets a ON a.id = q.asset_id LEFT JOIN users u ON u.id = q.actor_id
        WHERE q.kind = 'request' AND a.deleted_at IS NULL AND ${OPEN_DISPOSAL} ORDER BY q.id`,
    ).all()).results ?? [];
    const history = (await env.DB.prepare(`${withNames(EVENTS_SQL(""))} WHERE a.deleted_at IS NULL ORDER BY e.created_at DESC, e.id DESC LIMIT 300`).all()).results ?? [];
    return json({ issues, repair, lost, disposed, pending, history, me: user.id, can: { manage, approve, own_ok: isExecutiveOwner(user) } });
  }

  const mC = /^\/assets\/(\d+)\/care$/.test(path) ? path.split("/")[2] : null;
  if (!mC) return null;
  const a = await env.DB.prepare(`SELECT * FROM assets WHERE id = ?1 AND deleted_at IS NULL`).bind(Number(mC)).first<AssetRow>();
  if (!a) return err("not_found", "Asset not found", 404);
  const view = can(user.role, "asset_view");
  const holder = a.assigned_to != null && a.assigned_to === user.id;
  const teamLead = !holder && a.assigned_to != null && (await teamOf(env, user.id)).includes(a.assigned_to);
  /* who may report an issue or a loss: the register's readers, the holder, the holder's manager (blueprint section 9) */
  const reporter = view || holder || teamLead;

  if (method === "GET") {
    if (!reporter) return err("forbidden", "Not an asset you hold or keep", 403);
    const rows = (await env.DB.prepare(`${withNames(EVENTS_SQL("WHERE e.asset_id = ?1"))} ORDER BY e.created_at DESC, e.id DESC`).bind(a.id).all<Record<string, unknown>>()).results ?? [];
    /* the holder and their manager see what happened, never a cost or proceeds note */
    const events = view ? rows : rows.map(({ cost_cents: _c, proceeds_cents: _p, expense_id: _e, ...r }) => r);
    const open = await openOf(env, a.id);
    return json({
      events, status: a.status,
      open: { issues: open.issues, repair: open.repair?.id ?? null, lost: open.lost?.id ?? null, disposal: open.disposal ? { id: open.disposal.id, method: open.disposal.method, requested_by_id: open.disposal.actor_id } : null },
      me: user.id, can: { report: reporter && a.status !== "disposed", lost: reporter && !["lost", "disposed"].includes(a.status), manage, approve, money: view, own_ok: isExecutiveOwner(user) },
    });
  }
  if (method !== "POST") return null;
  const action = String(b.action ?? "");
  if (a.status === "disposed" && action !== "disposal_decide") return err("invalid_state", `${a.asset_tag} is disposed - its record is kept as it is.`, 409);

  if (action === "issue") {
    if (!reporter) return err("forbidden", "The holder, their manager or the register's keepers report an issue.", 403);
    const description = textOf(b.description, 500);
    if (description.length < 10) return err("invalid_input", "Say what is wrong (at least 10 characters).", 400);
    const noticed = dayOf(b.noticed_on);
    if (noticed === false) return err("invalid_input", "Since when is a date (YYYY-MM-DD).", 400);
    await careStep(env, user, a, "asset_issues", { kind: "report", description, noticed_on: noticed });
    for (const id of await peopleWith(env, "asset_manage", user.id)) await notify(env, id, "asset", `An issue was reported on ${a.asset_tag} - open Assets > Maintenance & Disposal.`, `asset_is:${a.id}:${Date.now()}`);
    return json({ ok: true }, 201);
  }
  if (action === "lost") {
    if (!reporter) return err("forbidden", "The holder, their manager or the register's keepers report a loss.", 403);
    if (a.status === "lost") return err("invalid_state", `${a.asset_tag} is already recorded as lost.`, 409);
    const circumstances = textOf(b.circumstances, 500);
    if (circumstances.length < 10) return err("invalid_input", "Say what happened (at least 10 characters).", 400);
    const seen = dayOf(b.last_seen_on);
    if (seen === false) return err("invalid_input", "Last seen on is a date (YYYY-MM-DD).", 400);
    await careStep(env, user, a, "asset_incidents", { kind: "lost", last_seen_place: textOf(b.last_seen_place, 120) || null, last_seen_on: seen, circumstances, police_ref: textOf(b.police_ref, 60) || null, holder_id: a.assigned_to, status_before: a.status }, "lost");
    for (const id of await peopleWith(env, "asset_manage", user.id)) await notify(env, id, "asset", `${a.asset_tag} was reported lost - open Assets > Maintenance & Disposal.`, `asset_lo:${a.id}:${Date.now()}`);
    return json({ ok: true }, 201);
  }

  /* everything below keeps the register: management (and the CEO or COO for a disposal decision) */
  if (action === "disposal_decide") {
    if (!approve) return err("forbidden", "Only the CEO or COO decides a disposal.", 403);
    const open = await openOf(env, a.id);
    if (!open.disposal) return err("invalid_state", "No disposal request is waiting on this asset.", 409);
    if (open.disposal.actor_id === user.id && !isExecutiveOwner(user)) {
      await audit(env, user.id, "auth.self_approval_refused", "assets", String(a.id), { action: "asset.disposal_request" });
      return err("self_approval", "You requested this disposal - the other approver decides it.", 403);
    }
    const reason = textOf(b.reason, 300);
    if (b.decision === "reject") {
      if (reason.length < 5) return err("invalid_input", "Say why it is rejected.", 400);
      await careStep(env, user, a, "asset_disposals", { kind: "reject", ref_id: open.disposal.id, reason });
      await notify(env, open.disposal.actor_id, "asset", `The disposal of ${a.asset_tag} was rejected.`, `asset_dsr:${open.disposal.id}`, { once: true });
      return json({ ok: true });
    }
    if (b.decision !== "approve") return err("invalid_input", "decision is approve or reject", 400);
    if (a.status === "disposed") return err("invalid_state", `${a.asset_tag} is already disposed.`, 409);
    if (a.assigned_to != null) return err("stale", "Someone holds it again since the request - reject it, return the asset, and ask again.", 409);
    await careStep(env, user, a, "asset_disposals", { kind: "approve", ref_id: open.disposal.id, reason: reason || null, status_before: a.status }, "disposed");
    await notify(env, open.disposal.actor_id, "asset", `The disposal of ${a.asset_tag} was approved.`, `asset_dsa:${open.disposal.id}`, { once: true });
    return json({ ok: true });
  }
  if (!manage) return err("forbidden", "Only the register's keepers record repairs and disposals", 403);

  if (action === "resolve") {
    const open = await openOf(env, a.id);
    const id = Number(b.issue_id);
    if (!open.issues.includes(id)) return err("invalid_state", "That issue is not open on this asset.", 409);
    const note = textOf(b.note, 300);
    if (note.length < 5) return err("invalid_input", "Say how it was resolved.", 400);
    await careStep(env, user, a, "asset_issues", { kind: "resolve", ref_id: id, description: note });
    return json({ ok: true });
  }
  if (action === "repair_sent") {
    if (a.status === "lost") return err("invalid_state", `${a.asset_tag} is lost - record it found first.`, 409);
    const open = await openOf(env, a.id);
    if (open.repair) return err("invalid_state", "It is already out for repair - record it back first.", 409);
    const repairer = textOf(b.repairer, 120);
    if (repairer.length < 2) return err("invalid_input", "Name the repairer (a shop, a technician or in-house).", 400);
    const expected = dayOf(b.expected_on);
    if (expected === false) return err("invalid_input", "Expected back is a date (YYYY-MM-DD).", 400);
    const issueId = b.issue_id != null && b.issue_id !== "" ? Number(b.issue_id) : null;
    if (issueId != null && !open.issues.includes(issueId)) return err("invalid_input", "That issue is not open on this asset.", 400);
    await careStep(env, user, a, "asset_repairs", { kind: "sent", issue_id: issueId, repairer, reference: textOf(b.reference, 60) || null, expected_on: expected, note: textOf(b.note, 300) || null, status_before: a.status }, "repair");
    return json({ ok: true }, 201);
  }
  if (action === "repair_back") {
    if (a.status !== "repair") return err("invalid_state", `${a.asset_tag} is not in repair.`, 409);
    const outcome = String(b.outcome ?? "");
    if (outcome !== "fixed" && outcome !== "not_repairable") return err("invalid_input", "Say the outcome: fixed or not repairable.", 400);
    const cost = centsOf(b.cost);
    if (cost === false) return err("invalid_input", "The repair cost is an amount in RM (a note only).", 400);
    let expense: number | null = null;
    if (b.expense_id != null && String(b.expense_id).trim() !== "") {
      expense = Number(b.expense_id);
      /* a link to what Finance recorded - checked, never created or changed */
      const ok = Number.isInteger(expense) && expense > 0 ? await env.DB.prepare(`SELECT id FROM expenses WHERE id = ?1`).bind(expense).first().catch(() => null) : null;
      if (!ok) return err("invalid_input", "No expense with that number - Finance records the bill in Expenses first.", 400);
    }
    const note = textOf(b.note, 300) || null;
    if (outcome === "not_repairable" && (note ?? "").length < 5) return err("invalid_input", "Say why it cannot be repaired.", 400);
    const open = await openOf(env, a.id);
    /* fixed: back to its holder (In use) or to Spare; not repairable stays In repair until a disposal */
    await careStep(env, user, a, "asset_repairs", { kind: "back", ref_id: open.repair?.id ?? null, outcome, cost_cents: cost, expense_id: expense, note, status_before: a.status }, outcome === "fixed" ? (a.assigned_to != null ? "in_use" : "spare") : undefined);
    return json({ ok: true });
  }
  if (action === "found") {
    if (a.status !== "lost") return err("invalid_state", `${a.asset_tag} is not recorded as lost.`, 409);
    const open = await openOf(env, a.id);
    const where = textOf(b.where, 120) || null;
    await careStep(env, user, a, "asset_incidents", { kind: "found", ref_id: open.lost?.id ?? null, last_seen_place: where, circumstances: textOf(b.note, 300) || null, holder_id: a.assigned_to, status_before: a.status }, a.assigned_to != null ? "in_use" : "spare");
    if (a.assigned_to != null) await notify(env, a.assigned_to, "asset", `${a.asset_tag} was recorded as found.`, `asset_fd:${a.id}:${Date.now()}`);
    return json({ ok: true });
  }
  if (action === "disposal_request") {
    if (a.assigned_to != null) return err("invalid_state", "Someone holds it - return it first, then request the disposal.", 409);
    const open = await openOf(env, a.id);
    if (open.disposal) return err("duplicate", "A disposal request for this asset is already waiting.", 409);
    if (open.repair) return err("invalid_state", "It is out for repair - record it back (not repairable) first.", 409);
    const m = String(b.method ?? "");
    if (!(METHODS as readonly string[]).includes(m)) return err("invalid_input", "Choose how: sold, scrapped, donated, returned to vendor or written off (a record only).", 400);
    const reason = textOf(b.reason, 500);
    if (reason.length < 10) return err("invalid_input", "Give the reason (at least 10 characters).", 400);
    const proceeds = centsOf(b.proceeds);
    if (proceeds === false) return err("invalid_input", "Proceeds are an amount in RM (a note only).", 400);
    await careStep(env, user, a, "asset_disposals", { kind: "request", method: m, reason, proceeds_cents: proceeds, status_before: a.status });
    for (const id of await peopleWith(env, "asset_dispose_approve", user.id)) await notify(env, id, "asset", `A disposal of ${a.asset_tag} waits for your decision - open Assets > Maintenance & Disposal.`, `asset_dq:${a.id}:${Date.now()}`);
    return json({ ok: true }, 201);
  }
  return err("invalid_input", "action is issue, lost, resolve, repair_sent, repair_back, found, disposal_request or disposal_decide", 400);
}

/** v1.305.0 - hourly: a repair past its expected-back date becomes one ordinary Task for whoever sent it */
export async function assetRepairSweep(env: Env): Promise<number> {
  let rows: { id: number; asset_tag: string; actor_id: number; repairer: string | null }[] = [];
  try {
    rows = ((await env.DB.prepare(
      `SELECT s.id, a.asset_tag, s.actor_id, s.repairer FROM asset_repairs s JOIN assets a ON a.id = s.asset_id
        WHERE s.kind = 'sent' AND s.expected_on IS NOT NULL AND s.expected_on < date('now') AND a.deleted_at IS NULL AND a.status = 'repair' AND ${OPEN_REPAIR}
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.link_kind = 'asset_repair' AND t.link_id = s.id)`,
    ).all<{ id: number; asset_tag: string; actor_id: number; repairer: string | null }>()).results ?? []);
  } catch (e) { if (skew(e)) return 0; throw e; }
  for (const r of rows) {
    await env.DB.prepare(`INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline, link_kind, link_id) VALUES (?1, ?2, ?3, ?3, 'normal', date('now', '+8 hours'), 'asset_repair', ?4)`)
      .bind(`${r.asset_tag}: repair past its expected date`, `It has not been recorded back from ${r.repairer ?? "the repairer"} - check on it, then record it back in Assets.`, r.actor_id, r.id).run();
  }
  return rows.length;
}
