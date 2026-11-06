/**
 * THE CLAIM CHAIN - v1.254.0 (the owner, 02-11-2026: "Claims Approval &
 * Payment Timeline"; claude/CLAIMS-TIMELINE-AUDIT.md, D1-D3).
 *
 * The chain itself has not changed. `claimChain` is the function staff.ts
 * carried since v1.4.106, moved here unchanged so that the endpoints that
 * enforce the chain and the timeline that describes it read ONE copy. The
 * page used to keep a third copy (role-panels.tsx claimChainOf); it now
 * reads `waiting_on`, `my_turn` and `actions` from GET /claims.
 *
 *   staff  (marketing, sales_marketing, editor, live_host):
 *            HR review -> COO pre-approval -> CEO final
 *   hr     (hr_admin):        CCO pre-approval -> CEO final
 *   exec   (coo, cco):        CEO only
 *   top    (ceo, admin tier): CEO only
 *
 * The CEO (claims_decide) may approve before the chain is complete; the
 * server records it as an override (decision_note, audit chain_override).
 * A stage whose approver is the PAYEE is waived (v1.4.175). Approval is not
 * payment: the payment step is done only when Mark paid recorded it.
 *
 * Nothing here reads the database. Every time and name comes from the row
 * the route read; a stamp that was never stored stays empty - no history
 * is invented.
 */

export type ClaimChain = "staff" | "hr" | "exec" | "top";
export const claimChain = (role: string): ClaimChain =>
  ["marketing", "sales_marketing", "editor", "live_host"].includes(role) ? "staff"
    : role === "hr_admin" ? "hr"
      : ["coo", "cco"].includes(role) ? "exec" : "top";

/** The decision stages of a chain, in order. */
export type ClaimStageKey = "hr" | "pre" | "final";
export function claimStages(chain: ClaimChain): ClaimStageKey[] {
  return chain === "staff" ? ["hr", "pre", "final"] : chain === "hr" ? ["pre", "final"] : ["final"];
}

/** Who signs a stage, by role. */
export function claimStageRole(chain: ClaimChain, k: ClaimStageKey): "hr_admin" | "coo" | "cco" | "ceo" {
  return k === "hr" ? "hr_admin" : k === "pre" ? (chain === "staff" ? "coo" : "cco") : "ceo";
}

export interface ClaimChainRow {
  id?: number;
  user_id: number;
  status: string;
  claimant_role: string | null;
  hr_reviewed_at?: string | null;
  pre_approved_at?: string | null;
  decided_at?: string | null;
  paid_at?: string | null;
  payee_user_id?: number | null;
  payee_role?: string | null;
  returned_from?: string | null;
  returned_at?: string | null;
  return_answered_at?: string | null;
}

/** An open return: sent back with a question and not answered yet. */
export const claimReturnOpen = (r: ClaimChainRow): boolean => !!r.returned_at && !r.return_answered_at;

/** The stage a PENDING claim stands at. The pre-approval cannot start
    before the HR review (staff chain); a stage whose role is the payee's is
    waived, and with it every stage that depends on it, so the claim stands
    at the CEO. */
export function claimCurrentStage(r: ClaimChainRow): ClaimStageKey {
  const chain = claimChain(r.claimant_role ?? "");
  if (chain === "staff") {
    if (!r.hr_reviewed_at) return r.payee_role === "hr_admin" ? "final" : "hr";
    if (!r.pre_approved_at) return r.payee_role === "coo" ? "final" : "pre";
    return "final";
  }
  if (chain === "hr") return !r.pre_approved_at && r.payee_role !== "cco" ? "pre" : "final";
  return "final";
}

export type ClaimWaiter = "hr" | "coo" | "cco" | "ceo" | "applicant" | "payment";
/** Whom a claim waits on now; null when it is finished (paid or rejected). */
export function claimWaitingOn(r: ClaimChainRow): ClaimWaiter | null {
  if (r.status === "approved") return r.paid_at ? null : "payment";
  if (r.status !== "pending") return null;
  if (claimReturnOpen(r)) return "applicant";
  const k = claimCurrentStage(r);
  const role = claimStageRole(claimChain(r.claimant_role ?? ""), k);
  return role === "hr_admin" ? "hr" : role;
}

export type ClaimAction = "review" | "preapprove" | "approve" | "reject" | "return" | "resubmit" | "pay";
const ADMIN_TIER = ["admin", "super_admin"];
const DECIDERS = ["super_admin", "ceo"]; // = PERMS.claims_decide

/** What this person may do to this claim NOW - exactly what the endpoints
    accept (POST /claims/:id/review, /preapprove, /decide, /return,
    /resubmit, /paid). The endpoints still decide; this only lets the page
    draw the buttons the server would take. */
export function claimActions(r: ClaimChainRow, actor: { id: number; role: string; is_owner?: boolean }): ClaimAction[] {
  const out: ClaimAction[] = [];
  const chain = claimChain(r.claimant_role ?? "");
  const own = r.user_id === actor.id;
  const payee = r.payee_user_id != null && r.payee_user_id === actor.id;
  /* v1.271.0 (Phase 0, decision-policy.ts) - a decider never decides or pays
     their own claim, or one paid to them; the company owner's own claim is
     an executive record, so his buttons stay */
  const decider = DECIDERS.includes(actor.role) && (!(own || payee) || (actor.role === "ceo" && actor.is_owner === true));
  if (r.status === "pending") {
    const open = claimReturnOpen(r);
    if (open) {
      if (own) out.push("resubmit");
    } else {
      if (!own && !payee && chain === "staff" && !r.hr_reviewed_at && ["hr_admin", ...ADMIN_TIER].includes(actor.role)) out.push("review");
      if (!own && !payee && !r.pre_approved_at && (
        (chain === "staff" && !!r.hr_reviewed_at && ["coo", ...ADMIN_TIER].includes(actor.role))
        || (chain === "hr" && ["cco", ...ADMIN_TIER].includes(actor.role)))) out.push("preapprove");
      if (decider) out.push("approve");
      if (out.some((a) => a === "review" || a === "preapprove" || a === "approve")) out.push("return");
    }
    if (decider) out.push("reject");
  }
  if (r.status === "approved" && !r.paid_at && decider) out.push("pay");
  return out;
}

/** True when the claim waits on THIS person's own stage - the "Waiting for
    my approval" filter. The CEO's override is an action, not a turn: a claim
    still waiting on the CCO is not the CEO's turn. */
export function claimMyTurn(r: ClaimChainRow, actor: { id: number; role: string; is_owner?: boolean }): boolean {
  const w = claimWaitingOn(r);
  const acts = claimActions(r, actor);
  if (w === "applicant") return acts.includes("resubmit");
  if (w === "payment") return acts.includes("pay");
  if (w === "hr") return acts.includes("review");
  if (w === "coo" || w === "cco") return acts.includes("preapprove");
  if (w === "ceo") return acts.includes("approve");
  return false;
}

/** The stages an approval made now would pass without a signature - what
    the CEO is told before an override ("Approve (skip CCO pre-approval)"). */
export function claimSkippedIfApproved(r: ClaimChainRow): ("hr" | "pre")[] {
  const chain = claimChain(r.claimant_role ?? "");
  const out: ("hr" | "pre")[] = [];
  if (chain === "staff") {
    if (!r.hr_reviewed_at && r.payee_role !== "hr_admin") out.push("hr");
    if (!r.pre_approved_at && r.payee_role !== "coo") out.push("pre");
  } else if (chain === "hr" && !r.pre_approved_at && r.payee_role !== "cco") out.push("pre");
  return out;
}

export interface ClaimTimelineRow extends ClaimChainRow {
  created_at: string;
  claimant_name?: string | null;
  hr_by_name?: string | null;
  pre_by_name?: string | null;
  decided_by_name?: string | null;
  decision_note?: string | null;
  returned_by_name?: string | null;
  return_question?: string | null;
  paid_by_name?: string | null;
  /** the payout record: the day the money left (the cash book row) */
  paid_bank_date?: string | null;
  /** the cash book row of this payment was reversed in Finance */
  paid_reversed_on?: string | null;
  payment_proof?: boolean;
  claim_type?: string | null;
  payroll_month?: string | null;
}
export type ClaimStepState = "done" | "now" | "todo" | "skipped" | "rejected" | "returned" | "off";
export interface ClaimStep {
  key: "submitted" | ClaimStageKey | "payment";
  state: ClaimStepState;
  who: string | null;
  at: string | null;
  /** the words a person wrote at this step: the reason, the question */
  text: string | null;
  /** facts the page says in words: role, override, waived, answered,
      bank_date, proof, reversed_on, payroll_month */
  flags?: Record<string, string | boolean>;
}

/** v1.254.0 - THE TIMELINE of one claim, from its row alone. Signed stages
    are done with who and when; a stage the CEO approved past is "skipped"
    (override) and one the payee could not sign is "skipped" (waived) -
    never shown as signed. A rejected claim ends red at the stage it stood
    at, with the reason. The payment step is done ONLY when Mark paid
    recorded it; an approved claim waits at Payment due. */
export function claimTimeline(r: ClaimTimelineRow): ClaimStep[] {
  const chain = claimChain(r.claimant_role ?? "");
  const order = claimStages(chain);
  const roleOf = (k: ClaimStageKey) => claimStageRole(chain, k);
  const sig: Record<ClaimStageKey, [string | null, string | null]> = {
    hr: [r.hr_by_name ?? null, r.hr_reviewed_at ?? null],
    pre: [r.pre_by_name ?? null, r.pre_approved_at ?? null],
    final: r.status === "approved" ? [r.decided_by_name ?? null, r.decided_at ?? null] : [null, null],
  };
  const signed = (k: ClaimStageKey) => !!sig[k][1];
  const waived = (k: ClaimStageKey) => (k === "hr" && r.payee_role === "hr_admin") || (k === "pre" && r.payee_role === (chain === "staff" ? "coo" : "cco"));
  const steps: ClaimStep[] = [{ key: "submitted", state: "done", who: r.claimant_name ?? null, at: r.created_at, text: null }];
  const answered = !!r.returned_at && !!r.return_answered_at;

  if (r.status === "approved") {
    const skipped = order.filter((k) => k !== "final" && !signed(k));
    for (const k of order) {
      if (k === "final") {
        steps.push({ key: k, state: "done", who: sig.final[0], at: sig.final[1], text: r.decision_note ?? null,
          flags: { role: roleOf(k), ...(skipped.some((s) => !waived(s)) ? { override: true } : {}) } });
      } else if (signed(k)) {
        steps.push({ key: k, state: "done", who: sig[k][0], at: sig[k][1], text: null, flags: { role: roleOf(k) } });
      } else {
        steps.push({ key: k, state: "skipped", who: null, at: null, text: null, flags: { role: roleOf(k), ...(waived(k) ? { waived: true } : { override: true }) } });
      }
    }
    const flags: Record<string, string | boolean> = {};
    if (r.paid_bank_date) flags.bank_date = r.paid_bank_date;
    if (r.payment_proof) flags.proof = true;
    if (r.claim_type === "salary_advance" && r.payroll_month) flags.payroll_month = r.payroll_month;
    if (!r.paid_at) steps.push({ key: "payment", state: "now", who: null, at: null, text: null, flags });
    else if (r.paid_reversed_on) steps.push({ key: "payment", state: "rejected", who: r.paid_by_name ?? null, at: r.paid_at, text: null, flags: { ...flags, reversed_on: r.paid_reversed_on } });
    else steps.push({ key: "payment", state: "done", who: r.paid_by_name ?? null, at: r.paid_at, text: null, flags });
    return steps;
  }

  if (r.status === "rejected") {
    /* red at the stage the claim stood at; the CEO's decision, the reason */
    const at = claimCurrentStage(r);
    let before = true;
    for (const k of order) {
      if (k === at) {
        before = false;
        steps.push({ key: k, state: "rejected", who: r.decided_by_name ?? null, at: r.decided_at ?? null, text: r.decision_note ?? null, flags: { role: roleOf(k) } });
      } else if (before) {
        steps.push(signed(k)
          ? { key: k, state: "done", who: sig[k][0], at: sig[k][1], text: null, flags: { role: roleOf(k) } }
          : { key: k, state: "skipped", who: null, at: null, text: null, flags: { role: roleOf(k), waived: true } });
      } else steps.push({ key: k, state: "off", who: null, at: null, text: null, flags: { role: roleOf(k) } });
    }
    steps.push({ key: "payment", state: "off", who: null, at: null, text: null });
    return steps;
  }

  /* pending, or returned with a question */
  const open = claimReturnOpen(r);
  const cur: ClaimStageKey = open && (order as string[]).includes(r.returned_from ?? "") ? r.returned_from as ClaimStageKey : claimCurrentStage(r);
  let past = true;
  for (const k of order) {
    if (k === cur) {
      past = false;
      steps.push(open
        ? { key: k, state: "returned", who: r.returned_by_name ?? null, at: r.returned_at ?? null, text: r.return_question ?? null, flags: { role: roleOf(k) } }
        : { key: k, state: "now", who: null, at: null, text: null,
            flags: { role: roleOf(k), ...(answered && r.returned_from === k ? { answered: true } : {}) } });
      continue;
    }
    if (past && signed(k)) steps.push({ key: k, state: "done", who: sig[k][0], at: sig[k][1], text: null, flags: { role: roleOf(k) } });
    /* before the current stage and unsigned: waived for the payee (or
       unreachable because the stage before it was waived) */
    else if (past) steps.push({ key: k, state: "skipped", who: null, at: null, text: null, flags: { role: roleOf(k), waived: true } });
    else steps.push({ key: k, state: "todo", who: null, at: null, text: null, flags: { role: roleOf(k) } });
  }
  steps.push({ key: "payment", state: "todo", who: null, at: null, text: null });
  return steps;
}
