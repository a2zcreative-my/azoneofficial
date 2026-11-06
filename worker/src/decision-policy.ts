/* v1.271.0 - PHASE 0: NO ORDINARY SELF-DECISION (claude/PHASE0-SAFETY-REVIEW.md;
   the CEO, 06-11-2026: "Do overall phase 0", and on D10: "I am a CEO why I
   need to get an approval?").

   ONE rule, applied on the server at every decision route that can pay,
   approve or correct a person's own record: the person who holds the
   permission may not use it on a record that is their own (they are its
   applicant, payee, subject or recipient). It adds to each route's existing
   permission check; it never widens one.

   The one exception is the verified company owner (role ceo, named owner,
   active, two-factor on - is_owner, computed in getSessionUser). The CEO has
   no manager and approves on his own authority, so on his own record the
   decision goes through as an EXECUTIVE RECORD: it is audited as
   auth.executive_self_record and the COO is told. Any code the route itself
   already asks for (a claim approval's authenticator code) still applies.
   A second CEO-role account that is not the owner, the Super Admin, and any
   role given these permissions in Roles & Permissions are refused.

   Refusals answer 403 self_approval and are audited as
   auth.self_approval_refused with the route and the record. */
import type { Env } from "./index";
import { audit, err } from "./shared";
import { notify } from "./staff";

export type SelfDecision =
  | "claim.decide" | "claim.paid"
  | "punch.forgotten" | "attendance.manual" | "attendance.amend" | "attendance.delete"
  | "unpaid.record" | "unpaid.change" | "unpaid.remove"
  | "commission.decide";

/** Every action this rule covers, with the words the COO notice uses. */
export const SELF_DECISIONS: Record<SelfDecision, string> = {
  "claim.decide": "decided his own claim",
  "claim.paid": "marked his own claim paid",
  "punch.forgotten": "approved his own forgotten punch",
  "attendance.manual": "added a punch to his own attendance",
  "attendance.amend": "changed a punch on his own attendance",
  "attendance.delete": "deleted a punch from his own attendance",
  "unpaid.record": "recorded an unpaid day on his own record",
  "unpaid.change": "changed an unpaid day on his own record",
  "unpaid.remove": "removed an unpaid day from his own record",
  "commission.decide": "decided his own commission entry",
};

type Actor = { id: number; role: string; is_owner?: boolean };

/** True when the actor is one of the people the record belongs to. */
export function isOwnRecord(actor: { id: number }, people: readonly (number | null | undefined)[]): boolean {
  return people.some((p) => p != null && Number(p) === actor.id);
}

/** The verified company owner acting on his own authority. */
export const isExecutiveOwner = (actor: Actor): boolean => actor.role === "ceo" && actor.is_owner === true;

/**
 * Call after the route's permission check and before any write.
 * null = go on; a Response = stop and answer it.
 */
export async function refuseSelf(
  env: Env, actor: Actor, action: SelfDecision,
  people: readonly (number | null | undefined)[], entity: string, entityId: string | number,
): Promise<Response | null> {
  if (!isOwnRecord(actor, people)) return null;
  if (isExecutiveOwner(actor)) {
    await audit(env, actor.id, "auth.executive_self_record", entity, String(entityId), { action });
    try {
      const coo = await env.DB.prepare(
        `SELECT id FROM users WHERE role = 'coo' AND is_active = 1 AND COALESCE(employment_status, '') NOT IN ('resigned', 'terminated') AND id != ?1`,
      ).bind(actor.id).all<{ id: number }>();
      for (const c of coo.results) {
        await notify(env, c.id, "security", `For the record: the CEO ${SELF_DECISIONS[action]} (${entity} #${entityId}).`, `self_record:${action}:${entityId}:${c.id}`, { once: true });
      }
    } catch { /* a notice never decides */ }
    return null;
  }
  await audit(env, actor.id, "auth.self_approval_refused", entity, String(entityId), { action, role: actor.role });
  return err("self_approval", "This is your own record - another authorised person decides it.", 403);
}
