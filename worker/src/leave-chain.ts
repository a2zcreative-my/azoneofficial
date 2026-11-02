/**
 * THE LEAVE APPROVAL CHAIN — who may act on a request at each stage.
 *
 * v1.106.0 (roadmap phase 04): lifted out of staff.ts so that One Desk
 * (worker/src/desk.ts) can answer "which leave requests are waiting on THIS
 * person" with the SAME rule the decide route enforces. Two copies of an
 * approval rule is how a desk shows a request its owner cannot act on, or
 * hides one they can. The logic is byte-for-byte what staff.ts had.
 *
 * Staff route:   applied -> hr_reviewed -> pre_approved -> approved
 * COO/CCO route: applied -> hr_reviewed ->               -> approved
 *                (they skip pre-approval - no one pre-approves their own tier;
 *                 v1.243.0: the CEO's action at hr_reviewed is the approval)
 * Reject at any active stage is terminal.
 *
 * v1.252.0 (the owner, 02-11-2026; claude/LEAVE-TIMELINE-AUDIT.md, D1):
 * RETURNED. An approver at the current stage may send the request back to
 * the applicant with a question: stage `returned` (status stays pending),
 * `returned_from` keeps the stage it left. Nobody approves a returned
 * request; the applicant resubmits and it goes back to `returned_from`.
 * The timeline below is worked out HERE, beside the rule, from the row the
 * route reads - every screen draws this one answer.
 */

import type { Role } from "./permissions";
import { can } from "./permissions";

export const HR_STAGE_ROLES: readonly Role[] = ["super_admin", "admin", "hr_admin"];
export const PREAPP_ROLES: readonly Role[] = ["super_admin", "admin", "coo", "cco"];
export const FINAL_ROLES: readonly Role[] = ["super_admin", "admin", "ceo"];

/** v1.205.0 - WHO READS THE WHOLE LEAVE LIST (GET /leave?all=1): the HR
    tier and both approval stages. Lifted from staff.ts, unchanged, so the
    search box (worker/src/search.ts) finds exactly the requests the Leave
    tab lists for the same person - everyone else, their own. */
export function leaveSeesAll(role: string): boolean {
  return can(role, "hr_manage") || (PREAPP_ROLES as readonly string[]).includes(role) || (FINAL_ROLES as readonly string[]).includes(role);
}

export function leaveNextStage(stage: string, applicantRole: string): string {
  if (stage === "applied") return "hr_reviewed";
  if (stage === "hr_reviewed") {
    /* COO/CCO applicants skip pre-approval and go straight to final.
       v1.243.0 (go-live audit D4): the CEO's one action at this stage IS the
       final approval - before, it moved the request to pending_final and
       asked the same CEO to approve it a second time. Who approves is
       unchanged (HR, then the CEO); the CEO no longer signs twice. */
    return applicantRole === "coo" || applicantRole === "cco" ? "approved" : "pre_approved";
  }
  return "approved"; // pre_approved or pending_final -> final approval
}

export function leaveCanActAt(
  user: { id: number; role: string },
  stage: string,
  applicantRole: string,
  applicantId: number,
): boolean {
  // No one reviews their own request at any stage.
  if (user.id === applicantId) return false;
  if (stage === "applied") return (HR_STAGE_ROLES as readonly string[]).includes(user.role);
  if (stage === "hr_reviewed") {
    // COO/CCO applicants go straight to CEO; staff need COO/CCO pre-approval.
    return applicantRole === "coo" || applicantRole === "cco"
      ? (FINAL_ROLES as readonly string[]).includes(user.role)
      : (PREAPP_ROLES as readonly string[]).includes(user.role);
  }
  if (stage === "pre_approved" || stage === "pending_final") return (FINAL_ROLES as readonly string[]).includes(user.role);
  return false; // approved / rejected / cancelled are terminal
}

export function leaveStageLabel(stage: string): string {
  return ({
    applied: "applied",
    hr_reviewed: "HR review done",
    pre_approved: "pre-approved (COO/CCO)",
    pending_final: "awaiting CEO",
    approved: "approved",
    rejected: "rejected",
    cancelled: "cancelled",
    returned: "returned for information",
  } as Record<string, string>)[stage] ?? stage;
}

/** v1.252.0 - who a live request waits on: "hr", "coo_cco" (either one
    decides), "ceo", or "applicant" (returned with a question). null when
    nothing is waited on. */
export type LeaveWaiter = "hr" | "coo_cco" | "ceo" | "applicant";
export function leaveWaitingOn(stage: string, applicantRole: string): LeaveWaiter | null {
  if (stage === "applied") return "hr";
  if (stage === "hr_reviewed") return applicantRole === "coo" || applicantRole === "cco" ? "ceo" : "coo_cco";
  if (stage === "pre_approved" || stage === "pending_final") return "ceo";
  if (stage === "returned") return "applicant";
  return null;
}

/** v1.252.0 - the step a stage belongs to on the timeline */
function stepOf(stage: string, topTier: boolean): "hr" | "pre" | "final" | null {
  if (stage === "applied") return "hr";
  if (stage === "hr_reviewed") return topTier ? "final" : "pre";
  if (stage === "pre_approved" || stage === "pending_final") return "final";
  return null;
}

export interface LeaveTimelineRow {
  stage: string; status: string; applicant_role: string; created_at: string; recorded_direct?: number | null;
  user_name?: string | null; hr_by_name?: string | null; hr_at?: string | null;
  preapp_by_name?: string | null; preapp_at?: string | null; final_by_name?: string | null; final_at?: string | null;
  review_comment?: string | null; cancelled_at?: string | null;
  returned_from?: string | null; returned_at?: string | null; returned_by_name?: string | null; return_question?: string | null;
}
export type LeaveStepState = "done" | "now" | "todo" | "skipped" | "rejected" | "withdrawn" | "returned" | "off";
export interface LeaveStep {
  key: "submitted" | "recorded" | "hr" | "pre" | "final" | "effect";
  state: LeaveStepState;
  who: string | null; at: string | null;
  /** the words a person wrote at that step: the rejection note, the question asked */
  text: string | null;
  /** facts the screen says in words: returned_resubmitted, override, released_months */
  flags?: Record<string, string | boolean>;
}

/** v1.252.0 - THE APPROVAL TIMELINE of one request, from the row alone.
    Signed stages are "done" with who and when; a stage the CEO's override
    passed is "skipped" (never shown as signed); the stage a request was
    rejected or withdrawn at says so and everything after it is "off"; a
    returned request shows the question at the stage it left. A withdrawal
    from before 1.252.0 has no time - none was stored, none is invented. */
export function leaveTimeline(r: LeaveTimelineRow, releasedMonths: string[] = []): LeaveStep[] {
  if (r.recorded_direct) {
    return [
      { key: "recorded", state: "done", who: null, at: r.created_at, text: null },
      { key: "effect", state: "done", who: null, at: r.created_at, text: null, ...(releasedMonths.length ? { flags: { released_months: releasedMonths.join(",") } } : {}) },
    ];
  }
  const topTier = r.applicant_role === "coo" || r.applicant_role === "cco";
  const order: ("hr" | "pre" | "final")[] = topTier ? ["hr", "final"] : ["hr", "pre", "final"];
  const sig: Record<string, [string | null, string | null]> = {
    hr: [r.hr_by_name ?? null, r.hr_at ?? null],
    pre: [r.preapp_by_name ?? null, r.preapp_at ?? null],
    final: r.stage === "approved" ? [r.final_by_name ?? null, r.final_at ?? null] : [null, null],
  };
  const signed = (k: string) => !!sig[k]![1];
  const steps: LeaveStep[] = [{ key: "submitted", state: "done", who: r.user_name ?? null, at: r.created_at, text: null }];
  const st = r.stage;
  if (st === "approved") {
    const override = order.some((k) => k !== "final" && !signed(k));
    for (const k of order) steps.push(signed(k)
      ? { key: k, state: "done", who: sig[k]![0], at: sig[k]![1], text: k === "final" ? r.review_comment ?? null : null, ...(k === "final" && override ? { flags: { override: true } } : {}) }
      : { key: k, state: "skipped", who: null, at: null, text: null, flags: { override: true } });
    steps.push({ key: "effect", state: "done", who: null, at: r.final_at ?? null, text: null, ...(releasedMonths.length ? { flags: { released_months: releasedMonths.join(",") } } : {}) });
    return steps;
  }
  if (st === "rejected" || st === "cancelled") {
    let ended = false;
    for (const k of order) {
      if (ended) { steps.push({ key: k, state: "off", who: null, at: null, text: null }); continue; }
      if (k !== "final" && signed(k)) { steps.push({ key: k, state: "done", who: sig[k]![0], at: sig[k]![1], text: null }); continue; }
      ended = true;
      steps.push(st === "rejected"
        ? { key: k, state: "rejected", who: r.final_by_name ?? null, at: r.final_at ?? null, text: r.review_comment ?? null }
        : { key: k, state: "withdrawn", who: r.user_name ?? null, at: r.cancelled_at ?? null, text: null });
    }
    steps.push({ key: "effect", state: "off", who: null, at: null, text: null });
    return steps;
  }
  /* live: applied, hr_reviewed, pre_approved, pending_final or returned */
  const cur = st === "returned" ? stepOf(r.returned_from ?? "applied", topTier) : stepOf(st, topTier);
  let past = true;
  for (const k of order) {
    if (k === cur) {
      past = false;
      steps.push(st === "returned"
        ? { key: k, state: "returned", who: r.returned_by_name ?? null, at: r.returned_at ?? null, text: r.return_question ?? null }
        : { key: k, state: "now", who: null, at: null, text: null,
            ...(r.returned_at && stepOf(r.returned_from ?? "", topTier) === k ? { flags: { returned_resubmitted: true } } : {}) });
      continue;
    }
    steps.push(past && signed(k) ? { key: k, state: "done", who: sig[k]![0], at: sig[k]![1], text: null } : { key: k, state: "todo", who: null, at: null, text: null });
  }
  steps.push({ key: "effect", state: "todo", who: null, at: null, text: null, ...(releasedMonths.length ? { flags: { released_months: releasedMonths.join(",") } } : {}) });
  return steps;
}
