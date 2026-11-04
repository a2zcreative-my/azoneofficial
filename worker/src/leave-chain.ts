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
import { reportingLine, type OrgPerson } from "../../lib/org-tree";

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
  /** v1.260.0 - a ROUTED request (stage `routed`) is decided by exactly the
      person its frozen route names for the current step (or the person that
      step was reassigned to): leave_requests.approver_id. Nobody else, by
      role or otherwise. */
  approverId?: number | null,
): boolean {
  // No one reviews their own request at any stage.
  if (user.id === applicantId) return false;
  if (stage === "routed") return approverId != null && user.id === Number(approverId);
  if (stage === "routing_required") return false; // nobody approves until it is routed
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
    routed: "waiting on the approver",
    routing_required: "approval routing requires configuration",
  } as Record<string, string>)[stage] ?? stage;
}

/** v1.252.0 - who a live request waits on: "hr", "coo_cco" (either one
    decides), "ceo", or "applicant" (returned with a question). null when
    nothing is waited on. */
export type LeaveWaiter = "hr" | "coo_cco" | "ceo" | "applicant" | "approver" | "configuration";
export function leaveWaitingOn(stage: string, applicantRole: string): LeaveWaiter | null {
  if (stage === "routed") return "approver"; // v1.260.0 - the named person (approver_id)
  if (stage === "routing_required") return "configuration";
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
  /* v1.259.0 - the evidence the labels are read from */
  preapp_by_role?: string | null; final_by_role?: string | null;
  /** the stage a CEO override decided at, read from audit_log
      (leave.override_approve / leave.override_reject); null = none on record */
  override_from?: string | null;
}

/** v1.259.0 (claude/LEAVE-ROUTING-AUDIT.md revision 2, section 8, L1).
    Since 1.243.0 the CEO's NORMAL approval of a COO or CCO request is
    written to preapp_by / preapp_at - the column follows the stage it was
    taken at (hr_reviewed) - and final_by stays empty. That signature IS the
    final decision. Who actually decided a request, and when, read from the
    row as it is stored (nothing is rewritten); null while undecided. */
export function leaveDecider(r: Pick<LeaveTimelineRow, "stage" | "applicant_role" | "preapp_by_name" | "preapp_at" | "preapp_by_role" | "final_by_name" | "final_at" | "final_by_role">): { name: string | null; at: string | null; role: string | null; via: "final" | "preapp" } | null {
  if (r.final_at) return { name: r.final_by_name ?? null, at: r.final_at, role: r.final_by_role ?? null, via: "final" };
  const topTier = r.applicant_role === "coo" || r.applicant_role === "cco";
  if (r.stage === "approved" && topTier && r.preapp_at) return { name: r.preapp_by_name ?? null, at: r.preapp_at, role: r.preapp_by_role ?? null, via: "preapp" };
  return null;
}

/** v1.259.0 - where an approved leave stands in Payroll, from the payroll
    records only: no payroll_entries row for the person and month = not
    prepared; a row = prepared, not released; payslip_releases = released.
    Attendance and Payroll read approved leave directly - nothing is synced,
    so nothing is shown as "processed" that the records do not prove. */
export interface LeavePayrollMonth { month: string; state: "not_prepared" | "prepared" | "released"; at: string | null }
export type LeaveStepState = "done" | "now" | "todo" | "skipped" | "rejected" | "withdrawn" | "returned" | "off";
export interface LeaveStep {
  key: "submitted" | "recorded" | "hr" | "pre" | "final" | "effect" | "line" | "exec" | "routing";
  state: LeaveStepState;
  who: string | null; at: string | null;
  /** the words a person wrote at that step: the rejection note, the question asked */
  text: string | null;
  /** facts the screen says in words: returned_resubmitted, override,
      not_recorded, released_months, by_role */
  flags?: Record<string, string | boolean>;
  /** v1.259.0 - the effect step: each month the leave falls in, as Payroll has it */
  payroll?: LeavePayrollMonth[];
}

/** v1.252.0 - THE APPROVAL TIMELINE of one request, from the row alone.
    Signed stages are "done" with who and when; the stage a request was
    rejected or withdrawn at says so and everything after it is "off"; a
    returned request shows the question at the stage it left. A withdrawal
    from before 1.252.0 has no time - none was stored, none is invented.

    v1.259.0 (the CEO's review, 04-11-2026: "use the historical approval and
    audit evidence to distinguish"). An unsigned stage of an approved request
    is "skipped" with override = true ONLY when audit_log holds the CEO's
    override (override_from); without that evidence it is "skipped" with
    not_recorded = true - never called an override it cannot prove. The
    CEO's normal approval of a COO/CCO request (stored in preapp_by, L1) is
    the final step, done, by him. by_role names who decided, so a decision
    the CEO did not make is never labelled his. */
export function leaveTimeline(r: LeaveTimelineRow, releasedMonths: string[] = [], payroll: LeavePayrollMonth[] = []): LeaveStep[] {
  const rel = releasedMonths.length ? { released_months: releasedMonths.join(",") } : null;
  if (r.recorded_direct) {
    return [
      { key: "recorded", state: "done", who: r.final_by_name ?? null, at: r.created_at, text: null, ...(r.final_by_role ? { flags: { by_role: r.final_by_role } } : {}) },
      { key: "effect", state: "done", who: null, at: r.created_at, text: null, ...(rel ? { flags: rel } : {}), payroll },
    ];
  }
  const topTier = r.applicant_role === "coo" || r.applicant_role === "cco";
  const order: ("hr" | "pre" | "final")[] = topTier ? ["hr", "final"] : ["hr", "pre", "final"];
  const decider = leaveDecider(r);
  const sig: Record<string, [string | null, string | null]> = {
    hr: [r.hr_by_name ?? null, r.hr_at ?? null],
    pre: [r.preapp_by_name ?? null, r.preapp_at ?? null],
    final: r.stage === "approved" && decider ? [decider.name, decider.at] : [null, null],
  };
  const signed = (k: string) => !!sig[k]![1];
  const steps: LeaveStep[] = [{ key: "submitted", state: "done", who: r.user_name ?? null, at: r.created_at, text: null }];
  const st = r.stage;
  const overridden = !!r.override_from;
  if (st === "approved") {
    for (const k of order) steps.push(signed(k)
      ? { key: k, state: "done", who: sig[k]![0], at: sig[k]![1], text: k === "final" ? r.review_comment ?? null : null,
          ...(k === "final" ? { flags: { ...(overridden ? { override: true, override_from: String(r.override_from) } : {}), ...(decider?.role ? { by_role: decider.role } : {}) } } : {}) }
      : { key: k, state: "skipped", who: null, at: null, text: null, flags: overridden ? { override: true } : { not_recorded: true } });
    steps.push({ key: "effect", state: "done", who: null, at: decider?.at ?? null, text: null, ...(rel ? { flags: rel } : {}), payroll });
    return steps;
  }
  if (st === "rejected" || st === "cancelled") {
    let ended = false;
    for (const k of order) {
      if (ended) { steps.push({ key: k, state: "off", who: null, at: null, text: null }); continue; }
      if (k !== "final" && signed(k)) { steps.push({ key: k, state: "done", who: sig[k]![0], at: sig[k]![1], text: null }); continue; }
      ended = true;
      steps.push(st === "rejected"
        ? { key: k, state: "rejected", who: r.final_by_name ?? null, at: r.final_at ?? null, text: r.review_comment ?? null,
            ...(overridden || r.final_by_role ? { flags: { ...(overridden ? { override: true, override_from: String(r.override_from) } : {}), ...(r.final_by_role ? { by_role: r.final_by_role } : {}) } } : {}) }
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
  steps.push({ key: "effect", state: "todo", who: null, at: null, text: null, ...(rel ? { flags: rel } : {}) });
  return steps;
}

/* =====================================================================
 * v1.260.0 - LEAVE APPROVAL FOLLOWS THE ORGANISATION CHART.
 * claude/LEAVE-ROUTING-AUDIT.md revision 2 and the CEO's "approved"
 * (04-11-2026): D1 (c) an ordinary employee is approved by their REPORTING
 * MANAGER on the Organisation chart, final - no HR stage, no CEO stage;
 * D2 (b) the COO and the CCO by the CEO, their manager; D3 (a) the CEO's own
 * leave is an Executive Leave Record - nobody approves it, nothing is
 * signed. No valid manager = "Approval Routing Requires Configuration",
 * never a random approver. The route is worked out HERE from the chart's
 * own tree (lib/org-tree.ts reportingLine -> buildOrg, the same answer the
 * chart and the reporting-line card draw) and FROZEN on the request when it
 * is submitted: a later change of manager never redirects it silently.
 * Requests submitted before this (route_json NULL) keep the rules above.
 * ===================================================================== */

/* v1.261.0 (the CEO, 04-11-2026: "it is supposed to HR and Admin -> CCO ->
   CEO, refer to organisation"; his answer: "Up the chart to the CEO") -
   route version 2: the request climbs the WHOLE reporting line, nearest
   first, and the CEO at the top gives the final approval. Version 1 (the
   direct manager alone, final) stays readable on the requests frozen with it. */
export const LEAVE_ROUTE_VERSION = 2;
export interface LeavePerson { id: number; name: string; position: string | null; role: string; department: string | null }
export interface LeaveRouteStep { n: number; key: "line"; approver: LeavePerson; basis: "reporting_line"; final: boolean }
export interface LeaveRoute {
  v: number;
  kind: "manager" | "executive_record" | "routing_required";
  applicant: LeavePerson & { manager_id: number | null };
  steps: LeaveRouteStep[];
  /** why there is no route: not on the chart (no reporting line, a leaver, a loop) */
  reason?: "no_manager";
}
const personOf = (u: OrgPerson): LeavePerson => ({ id: u.id, name: (u.full_name ?? "").trim() || u.name, position: u.position ?? null, role: u.role, department: (u.department ?? "").trim() || null });

/** THE ROUTE of a new request, from the chart as it stands now. */
export function leaveRoute(list: OrgPerson[], applicantId: number): LeaveRoute {
  const me = list.find((u) => u.id === applicantId);
  const line = me ? reportingLine(list, applicantId) : null;
  const applicant = me ? { ...personOf(me), manager_id: null as number | null } : { id: applicantId, name: "", position: null, role: "", department: null, manager_id: null };
  if (me && line?.kind === "ceo") return { v: LEAVE_ROUTE_VERSION, kind: "executive_record", applicant, steps: [] };
  const sup = line && line.kind === "staff" && line.placed ? line.supervisor : null;
  if (!me || !sup || sup.id === applicantId) return { v: LEAVE_ROUTE_VERSION, kind: "routing_required", applicant, steps: [], reason: "no_manager" };
  /* everyone above, nearest first, to the top of the chart (the CEO) - one
     step each, never the same person twice (leaveAbove walks distinct people) */
  const chain = leaveAbove(list, applicantId);
  const steps: LeaveRouteStep[] = chain.map((p, i) => ({ n: i + 1, key: "line", approver: p, basis: "reporting_line", final: i === chain.length - 1 }));
  return { v: LEAVE_ROUTE_VERSION, kind: "manager", applicant: { ...applicant, manager_id: sup.id }, steps };
}

/** v1.261.0 - the step after `stepNo` that still needs a decision: a step
    whose approver is the person who just decided is satisfied by that same
    decision (no one approves twice, e.g. after a reassignment to someone
    further up). null = nothing left - the request is approved. */
export function leaveNextStep(route: LeaveRoute, stepNo: number, decidedBy: number): LeaveRouteStep | null {
  for (const s of route.steps) if (s.n > stepNo && s.approver.id !== decidedBy) return s;
  return null;
}

/** Everyone ABOVE a person on the chart, nearest first - the only people a
    step may be reassigned to (never a peer, a junior, HR by role, or the
    applicant). */
export function leaveAbove(list: OrgPerson[], personId: number): LeavePerson[] {
  const out: LeavePerson[] = [];
  let cur = personId;
  for (let hop = 0; hop < 64; hop++) {
    const sup = reportingLine(list, cur)?.supervisor;
    if (!sup || out.some((p) => p.id === sup.id)) break;
    out.push(personOf(sup));
    cur = sup.id;
  }
  return out;
}

export function parseLeaveRoute(json: unknown): LeaveRoute | null {
  if (typeof json !== "string" || !json) return null;
  try { const r = JSON.parse(json) as LeaveRoute; return r && Array.isArray(r.steps) ? r : null; } catch { return null; }
}

export interface LeaveDecisionRow { kind: string; step_no: number | null; actor_name: string | null; actor_role: string | null; note: string | null; created_at: string; from_name?: string | null; to_name?: string | null }

/** THE TIMELINE of a routed request: only the steps its route holds - no HR,
    COO/CCO or CEO stage is drawn unless the route names it. Each decision
    from leave_decisions, with who and when; HR's check and a reassignment
    are said on the step they belong to. */
export function leaveRoutedTimeline(r: LeaveTimelineRow & { step_no?: number | null }, route: LeaveRoute, decisions: LeaveDecisionRow[], releasedMonths: string[] = [], payroll: LeavePayrollMonth[] = []): LeaveStep[] {
  const rel = releasedMonths.length ? { released_months: releasedMonths.join(",") } : null;
  const steps: LeaveStep[] = [{ key: "submitted", state: "done", who: r.user_name ?? null, at: r.created_at, text: null }];
  const st = r.stage;
  const effect = (): LeaveStep => st === "approved"
    ? { key: "effect", state: "done", who: null, at: r.final_at ?? r.created_at, text: null, ...(rel ? { flags: rel } : {}), payroll }
    : st === "rejected" || st === "cancelled" ? { key: "effect", state: "off", who: null, at: null, text: null }
    : { key: "effect", state: "todo", who: null, at: null, text: null, ...(rel ? { flags: rel } : {}) };
  if (route.kind === "executive_record") {
    const rec = decisions.find((d) => d.kind === "recorded");
    steps.push({ key: "exec", state: st === "cancelled" ? "withdrawn" : "done", who: rec?.actor_name ?? r.user_name ?? null, at: rec?.created_at ?? r.created_at, text: null, flags: { executive_record: true } });
    steps.push(effect());
    return steps;
  }
  const hr = [...decisions].reverse().find((d) => d.kind === "hr_verified" || d.kind === "hr_flagged");
  const hrFlags = hr ? { hr_check: hr.kind === "hr_verified" ? "verified" : "flagged", hr_by: hr.actor_name ?? "", hr_at: hr.created_at, ...(hr.note ? { hr_note: hr.note } : {}) } : {};
  if (route.kind === "routing_required") {
    steps.push({ key: "routing", state: st === "cancelled" ? "withdrawn" : st === "rejected" ? "rejected" : st === "approved" ? "done" : "now",
      who: st === "rejected" || st === "approved" ? r.final_by_name ?? null : null, at: st === "rejected" || st === "approved" ? r.final_at ?? null : st === "cancelled" ? r.cancelled_at ?? null : null,
      text: st === "rejected" ? r.review_comment ?? null : null, flags: { routing_required: true, ...(st === "approved" || st === "rejected" ? { override: true } : {}) } });
    steps.push(effect());
    return steps;
  }
  /* routed later (Route now, or a request from before re-routed by the Organisation): said as its own blue step */
  const routedDec = decisions.find((d) => d.kind === "routed");
  if (routedDec) steps.push({ key: "routing", state: "done", who: routedDec.actor_name, at: routedDec.created_at, text: routedDec.note, flags: { routed: true } });
  const cur = Number(r.step_no ?? 1);
  let ended = false;
  for (const s of route.steps) {
    const dec = decisions.find((d) => d.step_no === s.n && ["approved", "rejected", "override"].includes(d.kind));
    const re = [...decisions].reverse().find((d) => d.step_no === s.n && d.kind === "reassigned");
    const base = { approver_name: re?.to_name ?? s.approver.name, approver_position: s.approver.position ?? "", step: String(s.n), steps: String(route.steps.length), ...(s.final ? { final: true } : {}),
      ...(re ? { reassigned_from: re.from_name ?? "", reassigned_to: re.to_name ?? "", reassign_note: re.note ?? "" } : {}), ...(s.n === cur ? hrFlags : {}) };
    if (ended) { steps.push({ key: "line", state: "off", who: null, at: null, text: null, flags: base }); continue; }
    if (dec) {
      const override = dec.kind === "override";
      const rejected = dec.kind === "rejected" || (override && st === "rejected");
      steps.push({ key: "line", state: rejected ? "rejected" : "done", who: dec.actor_name, at: dec.created_at, text: dec.note, flags: { ...base, ...(dec.actor_role ? { by_role: dec.actor_role } : {}), ...(override ? { override: true } : {}) } });
      if (rejected) ended = true;
      continue;
    }
    if (s.n === cur && st === "routed") { steps.push({ key: "line", state: "now", who: null, at: null, text: null, flags: { ...base, ...(r.returned_at && r.returned_from === "routed" ? { returned_resubmitted: true } : {}) } }); continue; }
    if (s.n === cur && st === "returned") { steps.push({ key: "line", state: "returned", who: r.returned_by_name ?? null, at: r.returned_at ?? null, text: r.return_question ?? null, flags: base }); continue; }
    if (s.n === cur && st === "cancelled") { steps.push({ key: "line", state: "withdrawn", who: r.user_name ?? null, at: r.cancelled_at ?? null, text: null, flags: base }); ended = true; continue; }
    /* approved with no decision of its own: the same person already decided
       an earlier step (a reassignment upward) - one approval, said so */
    if (st === "approved") { const by = decisions.find((d) => ["approved", "override"].includes(d.kind) && (d.step_no ?? 0) < s.n); steps.push({ key: "line", state: "skipped", who: by?.actor_name ?? null, at: by?.created_at ?? null, text: null, flags: { ...base, merged: true } }); continue; }
    steps.push({ key: "line", state: st === "rejected" || st === "cancelled" ? "off" : "todo", who: null, at: null, text: null, flags: base });
  }
  steps.push(effect());
  return steps;
}
