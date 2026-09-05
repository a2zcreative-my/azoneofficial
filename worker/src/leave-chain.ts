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
 *                (they skip pre-approval - no one pre-approves their own tier)
 * Reject at any active stage is terminal.
 */

import type { Role } from "./permissions";

export const HR_STAGE_ROLES: readonly Role[] = ["super_admin", "admin", "hr_admin"];
export const PREAPP_ROLES: readonly Role[] = ["super_admin", "admin", "coo", "cco"];
export const FINAL_ROLES: readonly Role[] = ["super_admin", "admin", "ceo"];

export function leaveNextStage(stage: string, applicantRole: string): string {
  if (stage === "applied") return "hr_reviewed";
  if (stage === "hr_reviewed") {
    // COO/CCO applicants skip pre-approval and go straight to final.
    return applicantRole === "coo" || applicantRole === "cco" ? "pending_final" : "pre_approved";
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
  } as Record<string, string>)[stage] ?? stage;
}
