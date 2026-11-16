"use client";
import { holds } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { openPrintPreview } from "@/components/ui/document-preview";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { L, LeaveReq, User, leaveTypeL, withStepUp } from "@/components/portal/page-shared";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DetailGrid } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowBtnPrimary } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelTable } from "@/components/ui/skeleton";
import { SubR } from "@/components/ui/sub-label";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { sharePdfFile } from "@/lib/doc-pdf";
import { esc } from "@/lib/escape-html";
import { buildLeavePdf, leaveFormDecision } from "@/lib/form-pdf"; // leaveFormDecision v1.259.0
import { dmy, dmyMYT, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { resolveIssuer } from "@/lib/issuers";
import { properName } from "@/lib/names";
import { btnClass, btnSm, card, chipSmNeutral, chipSmWarn, inputClass, rowHead, td, tdR2, th, thR2, inputClassSm, textareaClass } from "@/lib/ui-styles";
import { AppIcon } from "@/components/ui/app-icon";
import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRecordFocus, useScrollToRecord, type RecordFocus } from "@/lib/record-focus";
/* v1.124.0 — the paper palette has one owner (lib/doc-theme.ts). This
   document is written into a separate window/iframe that cannot see the
   app stylesheet, so it needs literal hex, not var(--doc-*). */
import { DOC } from "@/lib/doc-theme";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { isPartialLeave, savedCoverage } from "@/lib/leave-coverage";
import { LeaveCalendar } from "@/components/portal/leave-calendar"; // v1.181.17
import { leaveChip, TeamCalendarGrid, monthName } from "@/components/portal/leave-overview"; // v1.196.0
import { ApplyLeave4, ApprovalQueue4, ApprovalsHead4, LeaveOverview4, MyBalances4, RowMenu, TeamSide, isLeaveView, period, typeName, type Balance4, type LeaveView4 as LeaveView } from "@/components/portal/leave4"; // v1.309.0 - Leave Workspace 4.0
import { ViewSwitch } from "@/components/portal/executive-cards"; // v1.309.0 - the phone view switch
import { PillSwitch } from "@/components/ui/panel"; // v1.325.0 - D-2
import { useTabViewAddress } from "@/lib/tab-view"; // v1.309.0 - the view in the address
import l4 from "./leave4.module.css";
import { LineTabs, TabAction, TabAside, TabPeriod } from "@/components/ui/line-tabs"; // v1.196.0
import lv from "./leave-page.module.css"; // v1.196.0 - the Leave page's tabs
import { usePortal } from "@/components/portal/portal-provider"; // v1.206.0 - the drawer's related links
import { SideDrawer } from "@/components/ui/side-drawer";
import { FillPanel } from "@/components/ui/fill-panel"; // v1.325.0 - D-4
import { AttendanceAdminPanel } from "@/components/portal/lazy-panels"; // v1.307.0 - Attendance 4.0: unpaid days moved here from Attendance > Settings
import { Avatar } from "@/components/ui/avatar";
import { StageDots, StageTimeline, type Stage, type StageState } from "@/components/ui/stage-timeline"; // v1.252.0
import { RecordActivity, RecordComments } from "@/components/portal/record-thread"; // v1.254.0 - one thread for Leave and Claims

function coverageLabel(l: LeaveReq): string {
  if (!isPartialLeave(l)) return "";
  const windows = savedCoverage(l);
  if (!windows) return L("Coverage needs management review", "Tempoh perlu disemak pihak pengurusan");
  const time = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}${m >= 1440 ? " (+1)" : ""}`;
  return `${l.day_part === "first_half" ? L("First half", "Separuh pertama") : L("Second half", "Separuh kedua")} (${windows.map(w => `${time(w.start)} - ${time(w.end)}`).join(", ")})`;
}

/* ================= Leave ================= */

export const LEAVE_TYPES = [
  "annual",
  "medical",
  "emergency",
  "unpaid",
  "replacement",
] as const;

/* v1.146.0 — the types that cost pay, said once for the browser too.
   The CEO, 09-09-2026: *"EL should not be as a paid leave. it is consider as
   unpaid but not restricted."* Unpaid means it is deducted at 1/26 of the
   monthly wage per day; UNRESTRICTED means there is no entitlement to run
   out of, which is why these two tiles say what they cost instead of how
   many are left. The worker holds the same rule and the money side of it. */
export const UNPAID_LEAVE_TYPES: readonly string[] = ["unpaid", "emergency"];
export const UNPAID_LEAVE_FROM = "01-09-2026";

export const STAGE_LABEL: Record<string, string> = {
  applied: "Awaiting HR review",
  hr_reviewed: "Awaiting pre-approval",
  pre_approved: "Awaiting CEO",
  pending_final: "Awaiting CEO",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  returned: "Returned for information",
  routed: "Awaiting the manager's approval", // v1.260.0
  routing_required: "Approval routing requires configuration",
};
/* BM twin of STAGE_LABEL — display only, the stage value itself stays EN. */
export const STAGE_LABEL_MS: Record<string, string> = {
  applied: "Menunggu semakan HR",
  hr_reviewed: "Menunggu pra-kelulusan",
  pre_approved: "Menunggu CEO",
  pending_final: "Menunggu CEO",
  approved: "Diluluskan",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
  returned: "Dikembalikan untuk maklumat",
  routed: "Menunggu kelulusan pengurus",
  routing_required: "Laluan kelulusan perlu ditetapkan",
};
export const stageL = (s: string) =>
  (getLang() === "ms" ? STAGE_LABEL_MS[s] : STAGE_LABEL[s]) ?? s;

/* v1.252.0 - NO COPY OF THE CHAIN HERE. The page used to keep its own lists
   of who acts at which stage (canActOnStage); the server now sends, with
   every request, whether THIS person can decide it now (`can_act`, from
   leave-chain.ts leaveCanActAt) and whom it waits on (`waiting_on`). */

/* v1.4.134: printable Leave Application Form — AZOO-HR-LVE-001, same flow
   and layout language as the claim form: employee e-signature + submission
   date, pre-approver name/signature/date, CEO full name + signature + date
   on approval, MYT everywhere, footer pinned to the A4 bottom, one page. */
/** v1.4.139: subhead label above placeholder fields (portal-wide pattern). */
export function Sub({
  t,
  children,
  className = "",
}: {
  t: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">
        {t}
      </span>
      {children}
    </label>
  );
}

/* v1.4.246: AZOO-HR-LVE-001 as a real PDF, handed to the phone's share sheet. */
export async function sendLeavePdf(l: LeaveReq) {
  const dd = (l.created_at ?? "").slice(0, 10);
  const no = `LVE-AZOO${dd.slice(8, 10)}${dd.slice(5, 7)}${dd.slice(2, 4)}-${l.day_seq ?? l.id}`;
  const blob = await buildLeavePdf({ ...l, coverage_label: coverageLabel(l) }, no);
  await sharePdfFile(blob, `${no}.pdf`, `Leave form ${no}`);
}

export function printLeaveForm(l: LeaveReq, meName: string) {
  /* v1.28.0: the form names the EMPLOYER, so it forever carries the issuer
     stamped on the row — a legacy print stays AZ ONE OFFICIAL with its
     AZOO-HR-LVE document number; an A2Z form is a different controlled
     document with its own number and version (see lib/issuers.ts). */
  const issuer = resolveIssuer(l.issuer_code);
  const myt = (iso: string | null | undefined): string => {
    if (!iso) return "";
    if (iso.length <= 10) return dmy(iso);
    const d = new Date(
      new Date(
        iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")
      ).getTime() +
        8 * 3600 * 1000
    );
    if (Number.isNaN(d.getTime())) return dmy(iso);
    const i = d.toISOString();
    return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
  };
  const cA = l.created_at ?? "";
  const dd = cA.slice(0, 10);
  const lvNo = `LVE-AZOO${dd.slice(8, 10)}${dd.slice(5, 7)}${dd.slice(2, 4)}-${l.day_seq ?? l.id}`;
  const stage = l.stage ?? l.status;
  const applicant = (l.user_full || l.user_name || meName || "").toUpperCase();
  const SIG_FILE: Record<string, string> = {
    ceo: "ceo-sign.png",
    coo: "coo-sign.png",
    cco: "cco-sign.png",
    hr_admin: "hr-admin-sign.png",
    sales_marketing: "sales-marketing-sign.png",
  };
  const empSig = SIG_FILE[l.applicant_role ?? ""] ?? null;
  /* v1.259.0 - who signed which box, from the record (lib/form-pdf.ts
     leaveFormDecision - the PDF reads the same rule) */
  const fd = leaveFormDecision(l);
  const statusLine = fd.record ? "EXECUTIVE LEAVE RECORD - recorded by the CEO (top of the organisation, no approver)" :
    stage === "approved"
      ? `APPROVED IN SYSTEM${fd.final ? " by " + fd.final.name + (fd.final.override ? " (CEO override)" : "") : ""}${fd.final?.at ? " on " + myt(fd.final.at) + " MYT" : ""}`
      : stage === "rejected"
        ? `REJECTED IN SYSTEM${l.final_by_name ? " by " + l.final_by_name : ""}${l.review_comment ? " · Note: " + l.review_comment : ""}`
        : stage === "cancelled"
          ? "CANCELLED BY APPLICANT"
          : `PENDING — ${stage === "applied" ? "awaiting HR review" : stage === "hr_reviewed" ? "HR ✓ — awaiting pre-approval" : "pre-approved — awaiting CEO"}`;
  const chainNotes = [
    fd.hr
      ? `HR reviewed by ${fd.hr.name}${fd.hr.at ? " on " + myt(fd.hr.at) + " MYT" : ""}`
      : "",
    fd.pre
      ? `Pre-approved by ${fd.pre.name}${fd.pre.at ? " on " + myt(fd.pre.at) + " MYT" : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  openPrintPreview(`<!doctype html><html><head><meta charset="utf-8">
  <title>${esc(lvNo)} — Leave Application Form</title>
  <style>
    @page { size: A4; margin: 0; } /* v1.4.239 — margin moved to @media print */
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color: ${DOC.navy}; font-size: 11.5px; margin: 0; padding: 10px; max-width: 210mm; margin-inline: auto;
           display: flex; flex-direction: column; min-height: 274mm; }
    h1 { text-align: center; margin: 2px 0 0; font-size: 18px; letter-spacing: .04em; }
    h1 small { display: block; font-size: 8px; letter-spacing: .32em; color: ${DOC.gold}; font-weight: 700; margin-top: 2px; }
    h2 { text-align: center; margin: 4px 0 9px; font-size: 13px; font-weight: 600; }
    .goldbar { height: 5px; background: linear-gradient(90deg, ${DOC.gold}, ${DOC.goldLight}, ${DOC.gold}); border-radius: 3px; margin-bottom: 7px; }
    table { width: 100%; border-collapse: collapse; }
    .meta td { border: 1px solid ${DOC.navy}; padding: 4px 8px; }
    .meta .k { background: #f2f4f8; font-weight: 700; width: 18%; }
    .meta .v { width: 32%; }
    .status { margin: 10px 0 6px; font-weight: 700; color: ${stage === "approved" ? "#166534" : stage === "rejected" ? "#b00020" : "${DOC.navy}"}; }
    .chain { margin: 0 0 8px; font-size: 10px; color: #555; }
    .sig th { border: 1px solid ${DOC.navy}; background: #f2f4f8; padding: 5px 8px; text-align: left; }
    .sig td.body { border: 1px solid ${DOC.navy}; padding: 6px 8px; height: 108px; vertical-align: top; }
    .cw { display: flex; flex-direction: column; height: 100%; }
    .nm { min-height: 26px; }
    .sg { height: 52px; }
    .dt { margin-top: auto; }
    .esig { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 15px; }
    .esub { display: block; font-size: 8px; color: ${DOC.muted}; }
    .sigimg { height: 46px; max-width: 150px; object-fit: contain; object-position: left center; display: block; margin-top: 1px; }
    .foot { margin-top: auto; padding-top: 6px; font-size: 8px; color: ${DOC.muted}; text-align: center; }
    @media print { body { padding: 9mm; min-height: 296mm; } } /* v1.4.239 */
  </style></head><body>
  <div class="goldbar"></div>
  <h1>${issuer.name}<small>LIVE · CONNECT · GROW</small></h1>
  <h2>Leave Application Form</h2>
  <table class="meta">
    <tr><td class="k">Document No.</td><td class="v">${issuer.leaveFormNo}</td><td class="k">Version</td><td class="v">${issuer.leaveFormVersion}</td></tr>
    <tr><td class="k">Leave No.</td><td class="v">${esc(lvNo)}</td><td class="k">Date</td><td class="v">${myt(cA)}${cA.length > 10 ? " MYT" : ""}</td></tr>
    <tr><td class="k">Employee</td><td class="v">${esc(applicant)}</td><td class="k">Department</td><td class="v">${esc((l.user_department ?? "").toUpperCase())}</td></tr>
    <tr><td class="k">Position</td><td class="v">${esc((l.user_position ?? "").toUpperCase())}</td><td class="k">Leave type</td><td class="v" style="text-transform:uppercase">${esc(l.type)}</td></tr>
    <tr><td class="k">Period</td><td class="v">${dmy(l.start_date)} → ${dmy(l.end_date)} ${esc(coverageLabel(l))}</td><td class="k">Days</td><td class="v">${l.days}</td></tr>
    <tr><td class="k">Reason</td><td class="v" colspan="3">${esc(l.reason ?? "")}</td></tr>
  </table>
  <p class="status">System status: ${statusLine}</p>
  ${chainNotes ? `<p class="chain">${chainNotes}</p>` : ""}
  <table class="sig">
    <tr><th style="width:33%">Employee</th><th style="width:34%">Administrative or<br/>Head of Department (COO / CCO)</th><th style="width:33%">${fd.finalTitle}${fd.final?.override ? "<br/>(CEO override)" : ""}</th></tr>
    <tr>
      <td class="body"><div class="cw"><div class="nm">Name: ${esc(applicant)}</div>
        <div class="sg">Signature:${
          empSig
            ? `<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/emp" alt="" onerror="this.style.display='none'"/><span class="esub">(submitted in system)</span>`
            : ` <span class="esig">${esc(l.user_full || l.user_name || meName || "")}</span><span class="esub">(submitted in system)</span>`
        }</div>
        <div class="dt">Date: ${myt(cA)}${cA.length > 10 ? " MYT" : ""}</div></div></td>
      <td class="body"><div class="cw">${
        fd.pre
          ? `<div class="nm">Name: ${esc(fd.pre.name.toUpperCase())}</div>
           <div class="sg">Signature:<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/pre" alt="" onerror="this.style.display='none'"/></div>
           <div class="dt">Date: ${fd.pre.at ? myt(fd.pre.at) + " MYT" : ""}</div>`
          : `<div class="nm">Name:</div><div class="sg">Signature:</div><div class="dt">Date:</div>`
      }</div></td>
      <td class="body"><div class="cw"><div class="nm">Name: ${esc((fd.final?.name ?? "").toUpperCase())}</div>
        <div class="sg">Signature:${fd.final ? (fd.final.role === "ceo" ? `<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/ceo" alt="" onerror="this.style.display='none'"/>` : `<span class="esub">(approved electronically in A2Z OS)</span>`) : ""}</div>
        <div class="dt">Date: ${fd.final?.at ? myt(fd.final.at) + " MYT" : ""}</div></div></td>
    </tr>
  </table>
  <p class="foot">${issuer.name} · ${issuer.registration} · ${issuer.address.replace(/, Malaysia$/, "")} · This form accompanies the system record ${esc(lvNo)}; the in-system decision is authoritative.</p>
  <script>window.onload = function () { window.print(); };</script>
  </body></html>`);
}

/* v1.4.249: the same number the printed form and the PDF carry, so a row, a
   printout and a shared file all name the record identically. */
/**
 * v1.91.0 — one leave, opened. CEO, 04-09-2026: *"Leave — whole company I
 * want to have a clickable to see the details of the leave application!"*
 *
 * The company board printed one line per leave and nothing could be opened:
 * the reason, who reviewed it and when, and the note a reviewer left were
 * all in the row the worker already returns and nowhere on the screen. The
 * name is the door now, on the in-progress rows and the decided ones alike,
 * and it opens the same grid the person sees on their own history plus the
 * approval trail. Module scope, per guard #30.
 */
/* v1.259.0 - the stage a CEO override decided at, in words */
const OVERRIDE_AT: Record<string, string> = { applied: "HR review", hr_reviewed: "pre-approval", pre_approved: "the final step", pending_final: "the final step" };
/** v1.259.0 (the CEO, 04-11-2026, F: "Avoid showing a completed Payroll
    processing stage before the actual run") - Attendance reads approved leave
    directly, so it counts from the approval; Payroll is said only as its own
    records have it: not prepared, prepared (not released), released. */
function effectLine(approvedAt: string | null, payroll?: { month: string; state: "not_prepared" | "prepared" | "released"; at: string | null }[]): string {
  const at = approvedAt ? dmyMYT(approvedAt) : "";
  const att = L(`Counts in Attendance and the roster from ${at || "the approval"}.`, `Dikira dalam Kehadiran dan jadual mulai ${at || "kelulusan"}.`);
  const pay = (payroll ?? []).map((p) => p.state === "released"
    ? L(`${monthName(p.month)} payslips released ${p.at ? dmyMYT(p.at) : ""}`.trim(), `Slip gaji ${monthName(p.month)} dikeluarkan ${p.at ? dmyMYT(p.at) : ""}`.trim())
    : p.state === "prepared" ? L(`${monthName(p.month)} payroll prepared, not released yet`, `Gaji ${monthName(p.month)} disediakan, belum dikeluarkan`)
    : L(`${monthName(p.month)} payroll not prepared yet`, `Gaji ${monthName(p.month)} belum disediakan`));
  return pay.length ? `${att} ${L("Payroll", "Gaji")}: ${pay.join("; ")}.` : att;
}
/** v1.260.0 - a step of a ROUTED request (the Organisation route): the
    manager's decision with their name and position, the CEO's Executive
    Leave Record, the routing step; HR's check and a reassignment are said on
    the step they belong to. Only what the server's timeline holds. */
type TStep = NonNullable<LeaveReq["timeline"]>[number];
function routedStage(s: TStep, at: (x: string | null) => string): Stage {
  const f = s.flags ?? {};
  const who = s.who ? properName(s.who) : "";
  const whoAt = [who, at(s.at)].filter(Boolean).join(" · ");
  const ap = typeof f.approver_name === "string" ? properName(f.approver_name) : "";
  const pos = typeof f.approver_position === "string" && f.approver_position ? f.approver_position : "";
  const state = s.state as StageState;
  if (s.key === "exec") return { key: s.key, state, title: L("Executive Leave Record", "Rekod Cuti Eksekutif"), sub: L(`Recorded by ${whoAt || "the CEO"} - the top of the organisation has no reporting manager, so nobody approves it`, `Direkod oleh ${whoAt || "CEO"} - puncak organisasi tiada pengurus pelapor, jadi tiada kelulusan`) };
  if (s.key === "routing") {
    if (f.routed) return { key: s.key, state, title: L("Routed by the Organisation chart", "Dihalakan mengikut carta Organisasi"), sub: whoAt || "—", note: s.text || undefined };
    return { key: s.key, state, title: L("Approval routing requires configuration", "Laluan kelulusan perlu ditetapkan"),
      sub: state === "now" ? L("No reporting manager on the Organisation chart yet - HR or the CEO sets it, then routes the request", "Belum ada pengurus pelapor pada carta Organisasi - HR atau CEO menetapkannya, kemudian menghalakan permohonan")
        : state === "withdrawn" ? L("Withdrawn by the applicant", "Ditarik balik oleh pemohon")
        : f.override ? L(`Decided by CEO override - ${whoAt || "the CEO"}`, `Diputuskan melalui pengecualian CEO - ${whoAt || "CEO"}`) : whoAt || "—",
      note: s.text || undefined };
  }
  /* v1.261.0 - up the chart: each step names its person; the last is the final approval */
  const multi = Number(f.steps ?? 1) > 1;
  const isFinal = f.final === true || !multi;
  const title = isFinal
    ? L(`${multi ? "Final approval" : "Manager's decision"} - ${ap || "the reporting manager"}${pos ? `, ${pos}` : ""}`, `${multi ? "Kelulusan akhir" : "Keputusan pengurus"} - ${ap || "pengurus pelapor"}${pos ? `, ${pos}` : ""}`)
    : L(`Approval ${f.step} of ${f.steps} - ${ap}${pos ? `, ${pos}` : ""}`, `Kelulusan ${f.step} daripada ${f.steps} - ${ap}${pos ? `, ${pos}` : ""}`);
  const extra = [
    typeof f.reassigned_from === "string" && f.reassigned_from ? L(`Reassigned from ${properName(f.reassigned_from)} to ${properName(String(f.reassigned_to ?? ""))}${f.reassign_note ? `: ${f.reassign_note}` : ""}`, `Diserahkan semula daripada ${properName(f.reassigned_from)} kepada ${properName(String(f.reassigned_to ?? ""))}${f.reassign_note ? `: ${f.reassign_note}` : ""}`) : "",
    f.hr_check === "verified" ? L(`HR verified - ${properName(String(f.hr_by ?? ""))} · ${at(String(f.hr_at ?? ""))}${f.hr_note ? `: ${f.hr_note}` : ""}`, `Disahkan HR - ${properName(String(f.hr_by ?? ""))} · ${at(String(f.hr_at ?? ""))}${f.hr_note ? `: ${f.hr_note}` : ""}`)
      : f.hr_check === "flagged" ? L(`HR flagged an issue - ${properName(String(f.hr_by ?? ""))}: ${f.hr_note ?? ""}`, `HR menandakan isu - ${properName(String(f.hr_by ?? ""))}: ${f.hr_note ?? ""}`) : "",
  ].filter(Boolean).join(" · ");
  switch (state) {
    case "done": return { key: s.key, state, title, sub: f.override ? L(`Decided by CEO override in the approver's place - ${whoAt}`, `Diputuskan melalui pengecualian CEO bagi pihak pelulus - ${whoAt}`) : L(`Approved by ${whoAt || "—"}`, `Diluluskan oleh ${whoAt || "—"}`), note: [s.text, extra].filter(Boolean).join(" · ") || undefined };
    case "rejected": return { key: s.key, state, title: `${title} - ${L("rejected", "ditolak")}`, sub: f.override ? L(`Rejected by CEO override - ${whoAt}`, `Ditolak melalui pengecualian CEO - ${whoAt}`) : L(`Rejected by ${whoAt || "—"}`, `Ditolak oleh ${whoAt || "—"}`), note: [s.text, extra].filter(Boolean).join(" · ") || undefined };
    case "skipped": return { key: s.key, state, title, sub: L(`Not needed - already decided by ${whoAt || "the same person"} (no one approves twice)`, `Tidak perlu - telah diputuskan oleh ${whoAt || "orang yang sama"} (tiada kelulusan dua kali)`) };
    case "now": return { key: s.key, state, title, sub: isFinal ? L(`Waiting on ${ap || "the reporting manager"} - the final approval`, `Menunggu ${ap || "pengurus pelapor"} - kelulusan akhir`) : L(`Waiting on ${ap} - then it goes up to the next person on the chart`, `Menunggu ${ap} - kemudian ke orang seterusnya dalam carta`), aside: L("Currently waiting", "Sedang menunggu"),
      note: [f.returned_resubmitted ? L("It was returned once for more information and resubmitted.", "Ia pernah dikembalikan untuk maklumat dan dihantar semula.") : "", extra].filter(Boolean).join(" · ") || undefined };
    case "returned": return { key: s.key, state, title, sub: L(`Returned for more information by ${whoAt || "the approver"} - waiting on the applicant`, `Dikembalikan untuk maklumat oleh ${whoAt || "pelulus"} - menunggu pemohon`), note: s.text || undefined, aside: L("With the applicant", "Pada pemohon") };
    case "withdrawn": return { key: s.key, state, title: L("Withdrawn by the applicant", "Ditarik balik oleh pemohon"), sub: s.at ? at(s.at) : "—" };
    case "off": return { key: s.key, state, title, sub: L("Not reached", "Tidak sampai") };
    default: return { key: s.key, state, title, sub: L("Not yet", "Belum"), note: extra || undefined };
  }
}
/** v1.252.0 - THE APPROVAL TIMELINE, in words, from the server's steps
    (leave-chain.ts leaveTimeline). Nothing is worked out here but the
    sentence: who, when, what is waited on, what was written. */
export function leaveStages(l: LeaveReq): Stage[] {
  const at = (x: string | null) => (x ? dmyMYT(x) : "");
  const title: Record<string, string> = {
    submitted: L("Application submitted", "Permohonan dihantar"),
    recorded: L("Recorded by management from Attendance", "Direkod oleh pengurusan dari Kehadiran"),
    hr: L("HR review", "Semakan HR"),
    pre: L("Pre-approval - COO or CCO", "Pra-kelulusan - COO atau CCO"),
    final: L("CEO decision", "Keputusan CEO"),
    effect: L("Attendance & Payroll", "Kehadiran & Gaji"),
  };
  const waits: Record<string, string> = {
    hr: L("Waiting on HR", "Menunggu HR"),
    pre: L("Waiting on the COO or the CCO - either one decides", "Menunggu COO atau CCO - salah seorang memutuskan"),
    final: L("Waiting on the CEO", "Menunggu CEO"),
  };
  return (l.timeline ?? []).map((s): Stage => {
    if (s.key === "line" || s.key === "exec" || s.key === "routing") return routedStage(s, at);
    const who = s.who ? properName(s.who) : "";
    const whoAt = [who, at(s.at)].filter(Boolean).join(" · ");
    const released = typeof s.flags?.released_months === "string" ? String(s.flags.released_months).split(",").map((m) => monthName(m)).join(", ") : "";
    /* v1.259.0 - a decision is named by who made it: the final step says
       "CEO decision" only when the CEO decided it (by_role) */
    const byRole = typeof s.flags?.by_role === "string" ? s.flags.by_role : "";
    const finalTitle = byRole && byRole !== "ceo" ? L("Final decision", "Keputusan akhir") : title.final;
    const base: Stage = { key: s.key, title: s.key === "final" ? finalTitle! : title[s.key] ?? s.key, state: s.state as StageState };
    const ovAt = typeof s.flags?.override_from === "string" ? (OVERRIDE_AT[s.flags.override_from] ?? "") : "";
    switch (s.state) {
      case "done":
        return { ...base,
          title: s.key === "recorded" && who ? L(`Recorded by ${who} from Attendance`, `Direkod oleh ${who} dari Kehadiran`) : base.title,
          sub: s.key === "effect" ? effectLine(s.at, s.payroll)
            : s.key === "final" && s.flags?.override ? L(`Decided by CEO override${ovAt ? ` at ${ovAt}` : ""} - ${who || "the CEO"}${s.at ? ` · ${at(s.at)}` : ""}`, `Diputuskan melalui pengecualian CEO${ovAt ? ` di ${ovAt}` : ""} - ${who || "CEO"}${s.at ? ` · ${at(s.at)}` : ""}`)
            : s.key === "final" ? L(`Approved by ${whoAt || "—"}`, `Diluluskan oleh ${whoAt || "—"}`)
            : whoAt || "—",
          note: s.text || undefined,
          warn: released ? L(`Payroll for ${released} was already released before this approval - HR to review.`, `Gaji untuk ${released} telah dikeluarkan sebelum kelulusan ini - HR perlu menyemak.`) : undefined,
        };
      case "now":
        return { ...base, sub: waits[s.key] ?? "", aside: L("Currently waiting", "Sedang menunggu"),
          note: s.flags?.returned_resubmitted ? L("It was returned once for more information and resubmitted.", "Ia pernah dikembalikan untuk maklumat dan dihantar semula.") : undefined };
      case "returned":
        return { ...base, sub: L(`Returned for more information by ${who || "the approver"}${s.at ? ` · ${at(s.at)}` : ""} - waiting on the applicant`, `Dikembalikan untuk maklumat oleh ${who || "pelulus"}${s.at ? ` · ${at(s.at)}` : ""} - menunggu pemohon`), note: s.text || undefined, aside: L("With the applicant", "Pada pemohon") };
      case "rejected":
        return { ...base, title: `${title[s.key] ?? s.key} - ${L("rejected", "ditolak")}`,
          sub: s.flags?.override ? L(`Rejected by CEO override - ${who || "the CEO"}${s.at ? ` · ${at(s.at)}` : ""}`, `Ditolak melalui pengecualian CEO - ${who || "CEO"}${s.at ? ` · ${at(s.at)}` : ""}`)
            : L(`Rejected by ${who || "the approver"}${s.at ? ` · ${at(s.at)}` : ""}`, `Ditolak oleh ${who || "pelulus"}${s.at ? ` · ${at(s.at)}` : ""}`), note: s.text || undefined };
      case "withdrawn":
        return { ...base, title: L("Withdrawn by the applicant", "Ditarik balik oleh pemohon"), sub: s.at ? at(s.at) : L("Withdrawn (the time was not recorded before November 2026)", "Ditarik balik (masa tidak direkod sebelum November 2026)") };
      /* v1.259.0 - an override is called one only on audit evidence;
         without it the stage is "not recorded", never a guessed override */
      case "skipped":
        return { ...base, sub: s.flags?.override ? L("Not reached - superseded by the CEO override", "Tidak sampai - digantikan oleh pengecualian CEO") : L("Not recorded - no signature or decision was stored for this stage", "Tidak direkod - tiada tandatangan atau keputusan disimpan bagi peringkat ini") };
      case "off":
        return { ...base, sub: L("Not reached", "Tidak sampai") };
      default:
        return { ...base, sub: s.key === "effect" ? L("When the leave is approved", "Apabila cuti diluluskan") : L("Not yet", "Belum"),
          warn: released ? L(`Payroll for ${released} is already released - HR to review when this is decided.`, `Gaji untuk ${released} telah dikeluarkan - HR perlu menyemak apabila ini diputuskan.`) : undefined };
    }
  });
}

/** v1.252.0 - the compact progress line for a list row or a card */
export function LeaveDots({ l }: { l: LeaveReq }) {
  const steps = (l.timeline ?? []).filter((s) => s.key !== "effect");
  if (!steps.length) return null;
  return <StageDots states={steps.map((s) => s.state as StageState)} label={`${stageL(l.stage ?? l.status)}`} />;
}

/**
 * v1.91.0 — one leave, opened (CEO, 04-09-2026: "Leave — whole company I
 * want to have a clickable to see the details of the leave application!").
 * v1.252.0 - in two parts the drawer shows under its own tabs: Progress (the
 * approval timeline, from the server) and Details (the record and the
 * printed form).
 */
export function LeaveDetail({ l, meName, part = "both" }: { l: LeaveReq; meName: string; part?: "both" | "progress" | "details" }) {
  const st = l.stage ?? l.status;
  const mc = (l as LeaveReq & { mc_media_id?: number | null }).mc_media_id;
  return (
    <div className={lv.detail}>
      {part !== "progress" && (
        <section className={lv.dSection} aria-label={L("Details", "Butiran")}>
          <p className={lv.dTitle}>{L("Details", "Butiran")}</p>
          <DetailGrid
            items={[
              { label: L("Leave no.", "No. cuti"), value: leaveNoOf(l) },
              { label: L("Type", "Jenis"), value: leaveTypeL(l.type).replace(/^./, (c) => c.toUpperCase()) + (UNPAID_LEAVE_TYPES.includes(l.type) ? L(" — unpaid", " — tanpa gaji") : "") },
              { label: L("Period", "Tempoh"), value: `${dmy(l.start_date)}${l.end_date !== l.start_date ? ` → ${dmy(l.end_date)}` : ""}` },
              { label: L("Days", "Hari"), value: `${l.days} ${coverageLabel(l)}` },
              { label: L("Applied", "Dimohon"), value: dmyMYT(l.created_at) },
              { label: L("Status", "Status"), value: stageL(st) },
              { label: L("Reason", "Sebab"), wide: true, value: l.reason ?? "" },
              { label: L("Decision note", "Catatan keputusan"), wide: true, value: l.review_comment ?? "" },
              ...(mc ? [{ label: L("Attachment", "Lampiran"), wide: true, value: L("A medical certificate is on file with this application.", "Sijil perubatan disimpan bersama permohonan ini.") }] : []),
            ]}
          />
          <div>
            <button type="button" className={rowBtn}
              title={L("Print the Leave Application Form", "Cetak Borang Permohonan Cuti")}
              onClick={() => printLeaveForm(l, meName)}>
              {L("Print form", "Cetak borang")}
            </button>
          </div>
        </section>
      )}
      {part !== "details" && (
        <section className={lv.dSection} aria-label={L("Leave approval timeline", "Garis masa kelulusan cuti")}>
          <p className={lv.dTitle}>{L("Leave approval timeline", "Garis masa kelulusan cuti")}</p>
          <p className={lv.sub}>{L("The current status and the next step - who decided each step and when.", "Status semasa dan langkah seterusnya - siapa memutuskan setiap langkah dan bila.")}</p>
          {(l.timeline ?? []).length > 0
            ? <StageTimeline stages={leaveStages(l)} label={L("Leave approval timeline", "Garis masa kelulusan cuti")} testId="leave-timeline" />
            : <p className={lv.sub}>{L("The timeline needs the latest server.", "Garis masa memerlukan pelayan terkini.")}</p>}
        </section>
      )}
    </div>
  );
}

/* v1.252.0 (D2) - THE COMMENT THREAD on one leave. The server decides who
   reads which note: the applicant never receives an internal one. */
/* v1.254.0 - the thread is the shared RecordComments (record-thread.tsx),
   which the Claim drawer reads too; same markup, same endpoint. */
export function LeaveComments({ id, own }: { id: number; own: boolean }) {
  return <RecordComments base={`/staff/leave/${id}`} own={own} testId="leave-comments" radioName={String(id)}
    ownPrompt={L("Write to HR and the approvers", "Tulis kepada HR dan pelulus")} />;
}

const ACTIVITY: Record<string, [string, string]> = {
  "leave.apply": ["Applied", "Dimohon"], "leave.advance.hr_reviewed": ["HR reviewed", "Disemak HR"], "leave.advance.pre_approved": ["Pre-approved", "Pra-diluluskan"],
  "leave.advance.pending_final": ["Pre-approved", "Pra-diluluskan"], "leave.advance.approved": ["Approved", "Diluluskan"], "leave.reject": ["Rejected", "Ditolak"],
  "leave.override_approve": ["Approved directly by the CEO", "Diluluskan terus oleh CEO"], "leave.override_reject": ["Rejected directly by the CEO", "Ditolak terus oleh CEO"],
  "leave.cancel": ["Withdrawn by the applicant", "Ditarik balik oleh pemohon"], "leave.return": ["Returned for more information", "Dikembalikan untuk maklumat"],
  "leave.resubmit": ["Answered and resubmitted", "Dijawab dan dihantar semula"], "leave.comment": ["Comment added", "Komen ditambah"],
  "leave.executive_record": ["Executive Leave Record", "Rekod Cuti Eksekutif"], "leave.routing_required": ["Routing requires configuration", "Laluan perlu ditetapkan"], "leave.route": ["Routed", "Dihalakan"], "leave.reroute": ["Re-routed by Organisation", "Dihalakan semula ikut Organisasi"],
  "leave.reassign": ["Reassigned", "Diserahkan semula"], "leave.hr_verified": ["HR verified", "Disahkan HR"], "leave.hr_flagged": ["HR flagged an issue", "HR menandakan isu"], "leave.advance.step": ["Approved a step", "Meluluskan satu langkah"],
    "leave.amend": ["Amended by the CEO", "Dipinda oleh CEO"], "leave.unpaid_record": ["Recorded from Attendance", "Direkod dari Kehadiran"],
};
/* v1.252.0 - THE ACTIVITY: the audit trail of this leave, as it happened
   (audit events, kept apart from comments). */
export function LeaveActivity({ id }: { id: number }) {
  return <RecordActivity base={`/staff/leave/${id}`} labels={ACTIVITY} testId="leave-activity"
    empty={L("Nothing recorded for this leave yet (older records kept no trail).", "Tiada rekod untuk cuti ini lagi (rekod lama tiada jejak).")} />;
}

/* v1.252.0 - THE DRAWER'S FOUR PARTS (the owner's mockup: Progress,
   Details, Comments, Activity). A returned request shows its question and
   the applicant's Edit & Resubmit on Progress. */
type DrawerTab = "progress" | "details" | "comments" | "activity";
export function LeaveDrawerBody({ l, own, meName, onResubmit }: { l: LeaveReq; own: boolean; meName: string; onResubmit: (answer: string, extra: Record<string, unknown>) => Promise<void> | void }) {
  const [tab, setTab] = useState<DrawerTab>("progress");
  const returned = l.stage === "returned";
  const [ans, setAns] = useState({ answer: "", start_date: l.start_date, end_date: l.end_date, days: l.days, reason: l.reason ?? "" });
  const changedDates = ans.start_date !== l.start_date || ans.end_date !== l.end_date || ans.days !== l.days;
  return (
    <div className={lv.drawerBody}>
      <LineTabs value={tab} onChange={(k) => setTab(k as DrawerTab)} label={L("Leave application", "Permohonan cuti")} tabs={[
        ["progress", L("Progress", "Kemajuan")], ["details", L("Details", "Butiran")], ["comments", L("Comments", "Komen")], ["activity", L("Activity", "Aktiviti")],
      ] as readonly (readonly [DrawerTab, string])[]} />
      {tab === "progress" && own && returned && (
        <section className={lv.returnBox} data-testid="leave-resubmit" aria-label={L("Returned for more information", "Dikembalikan untuk maklumat")}>
          <p className={lv.dTitle}>{L("Returned for more information", "Dikembalikan untuk maklumat")}</p>
          {l.return_question && <p className={lv.threadBody}>{l.return_question}</p>}
          <label className={lv.threadForm}><span className={lv.sub}>{L("Your answer", "Jawapan anda")}</span>
            <textarea className={inputClass} rows={2} maxLength={500} value={ans.answer} onChange={(e) => setAns({ ...ans, answer: e.target.value })} /></label>
          <div className={lv.resubGrid}>
            <label><span className={lv.sub}>{L("Start", "Mula")}</span><input type="date" className={inputClass} value={ans.start_date} onChange={(e) => setAns({ ...ans, start_date: e.target.value })} /></label>
            <label><span className={lv.sub}>{L("End", "Tamat")}</span><input type="date" className={inputClass} value={ans.end_date} onChange={(e) => setAns({ ...ans, end_date: e.target.value })} /></label>
            <label><span className={lv.sub}>{L("Days", "Hari")}</span><input type="number" min={0.5} step={0.5} className={inputClass} value={ans.days} onChange={(e) => setAns({ ...ans, days: Number(e.target.value) })} /></label>
          </div>
          <label className={lv.threadForm}><span className={lv.sub}>{L("Reason", "Sebab")}</span>
            <input className={inputClass} maxLength={1000} value={ans.reason} onChange={(e) => setAns({ ...ans, reason: e.target.value })} /></label>
          <div><button type="button" className={btnClass} disabled={ans.answer.trim().length < 3} onClick={() => void onResubmit(ans.answer.trim(), {
            ...(changedDates ? { start_date: ans.start_date, end_date: ans.end_date, days: ans.days } : {}), ...(ans.reason !== (l.reason ?? "") ? { reason: ans.reason } : {}),
          })}><AppIcon name="verify" />{L("Resubmit", "Hantar semula")}</button></div>
        </section>
      )}
      {(tab === "progress" || tab === "details") && <LeaveDetail l={l} meName={meName} part={tab} />}
      {tab === "comments" && <LeaveComments id={l.id} own={own} />}
      {tab === "activity" && <LeaveActivity id={l.id} />}
    </div>
  );
}

/* v1.206.0 - THE RECORDS AROUND ONE LEAVE, as links to the modules that own
   them (the brief: "Display related records using existing IDs and
   permissions"). Staff owns the person, Attendance the days, Payroll the
   pay: each is a link drawn only where the tab strip already shows that tab,
   and nothing here is a copy - no punch, no figure, no deduction. */
export function LeaveRelated({ l, onLeave }: { l: LeaveReq; onLeave: () => void }) {
  const { canOpen, openRecord, setTab } = usePortal();
  const unpaid = UNPAID_LEAVE_TYPES.includes(l.type);
  return (
    <section className={lv.dSection} aria-label={L("Related records", "Rekod berkaitan")}>
      <p className={lv.dTitle}>{L("Related records", "Rekod berkaitan")}</p>
      <ul className={lv.related}>
        <li>
          <span><strong>{L("Employee", "Pekerja")}</strong><span>{[properName(l.user_full || l.user_name || ""), l.user_position, l.user_department].filter(Boolean).join(" · ") || "—"}</span></span>
          {l.user_id && canOpen("Staff Details") && <button type="button" className={rowBtn} onClick={() => { onLeave(); openRecord("Staff Details", "staff", l.user_id!); }}>{L("View staff profile", "Lihat profil kakitangan")}</button>}
        </li>
        <li>
          <span><strong>{L("Attendance", "Kehadiran")}</strong><span>{L("Approved leave marks these days on the person's attendance; the punches and the roster are Attendance's.", "Cuti yang diluluskan menandakan hari-hari ini pada kehadiran; rekod punch dan roster milik Kehadiran.")}</span></span>
          {canOpen("Attendance") && <button type="button" className={rowBtn} onClick={() => { onLeave(); setTab("Attendance"); }}>{L("View in Attendance", "Lihat di Kehadiran")}</button>}
        </li>
        {canOpen("Payroll") && (
          <li>
            <span><strong>{L("Payroll", "Gaji")}</strong><span>{unpaid
              ? L("Unpaid: Payroll deducts these days by its own rule, in the payroll month the leave starts. No figure is shown here.", "Tanpa gaji: Gaji memotong hari-hari ini mengikut peraturannya sendiri, dalam bulan gaji cuti itu bermula. Tiada angka dipaparkan di sini.")
              : L("Paid leave: no deduction.", "Cuti bergaji: tiada potongan.")}</span></span>
            <button type="button" className={rowBtn} onClick={() => { onLeave(); setTab("Payroll"); }}>{L("View in Payroll", "Lihat di Gaji")}</button>
          </li>
        )}
      </ul>
    </section>
  );
}

export function leaveNoOf(l: {
  created_at?: string | null;
  day_seq?: number | null;
  id: number;
}) {
  const dd = (l.created_at ?? "").slice(0, 10);
  return `LVE-AZOO${dd.slice(8, 10)}${dd.slice(5, 7)}${dd.slice(2, 4)}-${l.day_seq ?? l.id}`;
}

/* ===================== Leave entitlement (v1.62.0) =====================
   The CEO, 27-08-2026: "I as CEO can change or update their leave entitle to
   all the staff so that I can control their Annual Leave entitlement which is
   no abuse!"

   Until now nothing in the portal called the entitlement routes at all, so
   every person silently ran on the built-in defaults and nobody could change
   anyone's days. This card is the missing screen.

   Three things it deliberately does NOT do, all agreed with him:
     - It does not offer medical leave. That is statutory under the
       Employment Act 1955 and the API refuses it outright.
     - It does not appear for HR. `leave_entitlement` is ceo + super_admin;
       HR still processes leave, it just cannot decide what anyone is owed.
     - A raise does not hand over the days at once — annual leave accrues
       pro-rata across the year, so a rise lands as a higher monthly
       accrual. That is the "no abuse" part working. */
/* v1.146.0 — emergency left this grid with the entitlement itself. It is
   unpaid and unrestricted now: there is no number to set, and a box that
   still accepted one would be a promise the payroll does not keep. */
export const ENT_TYPES = ["annual"] as const;
export type EntType = (typeof ENT_TYPES)[number];
export interface EntCell {
  days: number;          // entitlement for the year
  set: boolean;          // a chosen figure, or the built-in default?
  adjust: number;        // the CEO's +/- carried on top of the accrual
  used: number;          // days taken (already includes any correction)
  used_adjust: number;
  eligible: number;      // what the person can actually take TODAY
}
export interface EntRow {
  id: number;
  name: string;
  role: string;
  /* v1.93.0 — a part-time host: listed, but with no entitlement to edit. */
  hourly?: boolean;
  entitlement: Record<EntType, EntCell>;
}

export function LeaveEntitlement() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<EntRow[]>([]);
  const [defaults, setDefaults] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  /* What the boxes currently show, keyed "<id>:<type>". Kept as strings so a
     half-typed "1" does not become the number 1 and save itself. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState<Record<EntType, string>>({ annual: "" });
  /* Which person's eligible-days panel is open, and what is typed in it. */
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [adj, setAdj] = useState<Record<string, string>>({});
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();

  const load = useCallback(async () => {
    const r = await api<{ staff: EntRow[]; defaults: Record<string, number> }>(
      `/staff/leave/entitlements?year=${year}`,
    );
    if (r.data?.staff) {
      setRows(r.data.staff);
      setDefaults(r.data.defaults ?? {});
      const d: Record<string, string> = {};
      for (const p of r.data.staff) {
        for (const t of ENT_TYPES) d[`${p.id}:${t}`] = String(p.entitlement[t]?.days ?? 0);
      }
      setDraft(d);
    }
    setLoaded(true);
  }, [year]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(["leave"], load);

  const saveOne = async (p: EntRow, type: EntType) => {
    const key = `${p.id}:${type}`;
    const days = Number(draft[key]);
    if (!Number.isFinite(days) || days < 0) {
      toast(L("Not saved", "Tidak disimpan"),
            L("Days must be 0 or more", "Hari mesti 0 atau lebih"), "notice");
      return;
    }
    setBusy(key);
    const r = await api<{ ok: true }>(`/staff/leave/entitlement`, {
      method: "PUT",
      body: JSON.stringify({ user_id: p.id, year, type, entitled: days }),
    });
    setBusy(null);
    if (!r.ok) {
      toast(L("Not saved", "Tidak disimpan"),
            (r.data as { error?: { message?: string } } | null)?.error?.message
              ?? L("The server refused that change", "Pelayan menolak perubahan itu"), "notice");
      return;
    }
    toast(L("Saved", "Disimpan"),
          `${p.name} — ${leaveTypeL(type)} ${days} ${L("days", "hari")} (${year})`);
    void load();
  };

  /* One writer for all three eligible controls — the server decides which
     field it was given. `field` is what to send: an adjustment, a used
     correction, or a target eligible figure it converts into an adjustment. */
  const saveEligible = async (
    p: EntRow, type: EntType, field: "adjust" | "used_adjust" | "set_eligible",
  ) => {
    const key = `${p.id}:${type}:${field}`;
    const raw = adj[key];
    if (raw === undefined || raw === "") {
      toast(L("Nothing to save", "Tiada untuk disimpan"),
            L("Type a number first", "Taip nombor dahulu"), "notice");
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      toast(L("Not saved", "Tidak disimpan"),
            L("That is not a number", "Itu bukan nombor"), "notice");
      return;
    }
    setBusy(key);
    const r = await api<{ eligible: number; adjust: number }>(`/staff/leave/eligible`, {
      method: "PUT",
      body: JSON.stringify({ user_id: p.id, year, type, [field]: value }),
    });
    setBusy(null);
    if (!r.ok) {
      toast(L("Not saved", "Tidak disimpan"),
            (r.data as { error?: { message?: string } } | null)?.error?.message
              ?? L("The server refused that change", "Pelayan menolak perubahan itu"), "notice");
      return;
    }
    setAdj((d) => ({ ...d, [key]: "" }));
    toast(L("Saved", "Disimpan"),
          L(`${p.name} — ${r.data?.eligible ?? 0} days eligible now`,
            `${p.name} — ${r.data?.eligible ?? 0} hari layak sekarang`));
    void load();
  };

  const setEveryone = async (type: EntType) => {
    const days = Number(bulk[type]);
    if (!Number.isFinite(days) || days < 0 || bulk[type] === "") {
      toast(L("Nothing to set", "Tiada untuk ditetapkan"),
            L("Type the number of days first", "Taip bilangan hari dahulu"), "notice");
      return;
    }
    /* A set-all touches everybody's pay-adjacent record, so it asks first and
       names the number and the year it is about to write. */
    if (!(await confirm({
      title: L(`Set ${leaveTypeL(type)} leave for all ${rows.length} staff?`,
               `Tetapkan cuti ${leaveTypeL(type)} untuk semua ${rows.length} kakitangan?`),
      message: L(`Everyone gets ${days} days for ${year}. This replaces every current figure, including any you set by hand.`,
                 `Semua orang mendapat ${days} hari bagi ${year}. Ini menggantikan setiap angka semasa, termasuk yang anda tetapkan sendiri.`),
      confirmLabel: L("Set for everyone", "Tetapkan untuk semua"),
      cancelLabel: L("Cancel", "Batal"),
      variant: "danger",
    }))) return;
    setBusy(`bulk:${type}`);
    const r = await api<{ updated: number; changed: number }>(`/staff/leave/entitlements/bulk`, {
      method: "PUT",
      body: JSON.stringify({ year, type, entitled: days }),
    });
    setBusy(null);
    if (!r.ok) {
      toast(L("Not saved", "Tidak disimpan"),
            (r.data as { error?: { message?: string } } | null)?.error?.message
              ?? L("The server refused that change", "Pelayan menolak perubahan itu"), "notice");
      return;
    }
    setBulk((b) => ({ ...b, [type]: "" }));
    toast(L("Saved", "Disimpan"),
          L(`${r.data?.changed ?? 0} of ${r.data?.updated ?? 0} staff changed`,
            `${r.data?.changed ?? 0} daripada ${r.data?.updated ?? 0} kakitangan berubah`));
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      {confirmNode}
      <div className={rowHead}>
        <div>
          <h3 className="font-semibold">{L("Leave entitlement", "Kelayakan cuti")}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("How many days each person is owed. Annual leave accrues month by month, so raising it mid-year adds to what accrues from here — it does not hand over the whole year at once.",
               "Berapa hari yang layak untuk setiap orang. Cuti tahunan terkumpul bulan demi bulan, jadi menaikkannya pertengahan tahun menambah kepada yang terkumpul dari sini — bukan memberi setahun penuh serta-merta.")}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{L("Year", "Tahun")}</span>
          <select className={`${inputClass} w-28`} value={year}
            onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>

      {/* ---- set everyone at once ---- */}
      <div className="border-border mt-4 grid gap-2 rounded-xl border p-3 sm:grid-cols-2">
        {ENT_TYPES.map((t) => (
          <div key={t} className="flex items-end gap-2">
            <Sub t={L(`Set ${leaveTypeL(t)} for everyone`, `Tetapkan ${leaveTypeL(t)} untuk semua`)}
                 className="flex-1">
              <input type="number" min={0} max={365} step={0.5} className={inputClass}
                placeholder={String(defaults[t] ?? 0)}
                value={bulk[t]}
                onChange={(e) => setBulk((b) => ({ ...b, [t]: e.target.value }))} />
            </Sub>
            <button type="button" className={btnSm} disabled={busy === `bulk:${t}`}
              onClick={() => void setEveryone(t)}>
              {busy === `bulk:${t}` ? L("Setting…", "Menetapkan…") : L("Apply to all", "Guna untuk semua")}
            </button>
          </div>
        ))}
      </div>

      {/* v1.77.0 — skeleton until the first fetch lands. */}
      {!loaded && <SkelTable rows={6} cols={ENT_TYPES.length + 2} className="mt-3" />}

      {loaded && rows.length === 0 && (
        <p className="text-muted-foreground mt-4 text-sm">
          {L("No active staff to show.", "Tiada kakitangan aktif untuk dipaparkan.")}
        </p>
      )}

      {loaded && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("Staff", "Kakitangan")}</th>
                {ENT_TYPES.map((t) => (
                  <th key={t} className={thR2}>
                    {leaveTypeL(t)}
                    <span className="text-muted-foreground block text-[10px] font-normal normal-case">
                      {L("per year", "setahun")}
                    </span>
                  </th>
                ))}
                <th className={thR2}>{L("Eligible now", "Layak sekarang")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Fragment key={p.id}>
                <tr className="border-border/60 border-b">
                  <td className={td}>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted-foreground text-xs uppercase">{p.role}{p.hourly ? ` · ${L("part-time", "sambilan")}` : ""}</div>
                  </td>
                  {/* v1.93.0 (CEO: "part time live host should not entitle any
                      leave or medical leave since they are part time staff") —
                      one quiet cell across the row instead of boxes that the
                      server would refuse. */}
                  {p.hourly && (
                    <td className={`${td} text-muted-foreground text-xs`} colSpan={ENT_TYPES.length + 1}>
                      {L("Paid by the hour — no annual, medical or emergency leave. Days not worked are simply not billed.",
                         "Dibayar mengikut jam — tiada cuti tahunan, perubatan atau kecemasan. Hari tidak bekerja tidak dibilkan.")}
                    </td>
                  )}
                  {!p.hourly && ENT_TYPES.map((t) => {
                    const key = `${p.id}:${t}`;
                    const stored = p.entitlement[t];
                    const dirty = draft[key] !== String(stored?.days ?? 0);
                    return (
                      <td key={t} className={tdR2}>
                        <div className="flex items-center justify-end gap-1.5">
                          <input type="number" min={0} max={365} step={0.5}
                            className={`${inputClass} w-20 text-right`}
                            value={draft[key] ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") void saveOne(p, t); }} />
                          <button type="button" className={btnSm}
                            disabled={!dirty || busy === key}
                            onClick={() => void saveOne(p, t)}>
                            {busy === key ? "…" : L("Save", "Simpan")}
                          </button>
                        </div>
                        {/* Say plainly when a number is the built-in default
                            rather than one somebody chose. */}
                        {!stored?.set && (
                          <div className="text-muted-foreground mt-0.5 text-[11px]">
                            {L("default", "lalai")}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {/* v1.62.0 — what each person can actually take TODAY, and
                      the way in to changing it. Shown per type on one line so
                      the table stays one row per person. */}
                  {!p.hourly && <td className={tdR2}>
                    <div className="flex items-center justify-end gap-2">
                      <div className="text-right">
                        {ENT_TYPES.map((t) => (
                          <div key={t} className="text-xs">
                            <span className="font-semibold tabular-nums">{p.entitlement[t]?.eligible ?? 0}</span>
                            <span className="text-muted-foreground"> {leaveTypeL(t).toLowerCase()}</span>
                            {(p.entitlement[t]?.adjust ?? 0) !== 0 && (
                              <span className="text-muted-foreground">
                                {" "}({(p.entitlement[t]!.adjust > 0 ? "+" : "")}{p.entitlement[t]!.adjust})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      <button type="button" className={btnSm}
                        onClick={() => setOpenRow(openRow === p.id ? null : p.id)}>
                        {openRow === p.id ? L("Close", "Tutup") : L("Adjust", "Laras")}
                      </button>
                    </div>
                  </td>}
                </tr>
                {openRow === p.id && !p.hourly && (
                  <tr className="border-border/60 border-b last:border-0">
                    <td className="px-3 pt-0 pb-3" colSpan={ENT_TYPES.length + 2}>
                      <div className="bg-secondary/40 grid gap-3 rounded-xl p-3 sm:grid-cols-2">
                        {ENT_TYPES.map((t) => {
                          const c = p.entitlement[t];
                          const k = (f: string) => `${p.id}:${t}:${f}`;
                          return (
                            <div key={t} className="space-y-2">
                              <p className="text-xs font-semibold">{leaveTypeL(t)}</p>
                              <p className="text-muted-foreground text-[11px]">
                                {L(`${c?.days ?? 0}/year · ${c?.used ?? 0} taken · ${c?.eligible ?? 0} eligible now`,
                                   `${c?.days ?? 0}/tahun · ${c?.used ?? 0} diambil · ${c?.eligible ?? 0} layak sekarang`)}
                              </p>

                              {/* 1. carry-forward / one-off grant — the figure
                                     that rides on top of the accrual */}
                              <div className="flex items-end gap-1.5">
                                <Sub t={L("Adjustment (+ / −)", "Pelarasan (+ / −)")} className="flex-1">
                                  <input type="number" step={0.5} className={inputClass}
                                    placeholder={String(c?.adjust ?? 0)}
                                    value={adj[k("adjust")] ?? ""}
                                    onChange={(e) => setAdj((d) => ({ ...d, [k("adjust")]: e.target.value }))} />
                                </Sub>
                                <button type="button" className={btnSm}
                                  disabled={busy === k("adjust")}
                                  onClick={() => void saveEligible(p, t, "adjust")}>
                                  {busy === k("adjust") ? "…" : L("Save", "Simpan")}
                                </button>
                              </div>

                              {/* 2. correct the days recorded as taken */}
                              <div className="flex items-end gap-1.5">
                                <Sub t={L("Correct days taken (+ / −)", "Betulkan hari diambil (+ / −)")} className="flex-1">
                                  <input type="number" step={0.5} className={inputClass}
                                    placeholder={String(c?.used_adjust ?? 0)}
                                    value={adj[k("used_adjust")] ?? ""}
                                    onChange={(e) => setAdj((d) => ({ ...d, [k("used_adjust")]: e.target.value }))} />
                                </Sub>
                                <button type="button" className={btnSm}
                                  disabled={busy === k("used_adjust")}
                                  onClick={() => void saveEligible(p, t, "used_adjust")}>
                                  {busy === k("used_adjust") ? "…" : L("Save", "Simpan")}
                                </button>
                              </div>

                              {/* 3. type the eligible figure you want today */}
                              <div className="flex items-end gap-1.5">
                                <Sub t={L("Set eligible now to", "Tetapkan layak sekarang kepada")} className="flex-1">
                                  <input type="number" min={0} step={0.5} className={inputClass}
                                    placeholder={String(c?.eligible ?? 0)}
                                    value={adj[k("set_eligible")] ?? ""}
                                    onChange={(e) => setAdj((d) => ({ ...d, [k("set_eligible")]: e.target.value }))} />
                                </Sub>
                                <button type="button" className={btnSm}
                                  disabled={busy === k("set_eligible")}
                                  onClick={() => void saveEligible(p, t, "set_eligible")}>
                                  {busy === k("set_eligible") ? "…" : L("Set", "Tetapkan")}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground mt-3 text-[11px]">
        {L("Medical leave is set by law and cannot be changed here. Every change is recorded with who made it and what it replaced.",
           "Cuti sakit ditetapkan oleh undang-undang dan tidak boleh diubah di sini. Setiap perubahan direkodkan dengan siapa yang membuatnya dan angka yang digantikan.")}
      </p>
    </div>
  );
}

/* Whose approval a leave request is waiting on. Module scope because two
   places read it now: the board badge, and the CEO override confirm, which
   has to say out loud which stage is being skipped. */
export function waitingOnLabel(l: LeaveReq): string {
  /* v1.252.0 - the server's answer first: either the COO or the CCO decides */
  if (l.waiting_on === "approver") return `${properName(l.approver_name ?? "")}${l.approver_position ? ` (${l.approver_position})` : ""}` || L("the reporting manager", "pengurus pelapor");
  if (l.waiting_on === "configuration") return L("routing set-up (HR or the CEO)", "penetapan laluan (HR atau CEO)");
  if (l.waiting_on) return l.waiting_on === "hr" ? "HR" : l.waiting_on === "coo_cco" ? L("COO or CCO", "COO atau CCO") : l.waiting_on === "ceo" ? "CEO" : L("the applicant (returned for information)", "pemohon (dikembalikan untuk maklumat)");
  const st = l.stage ?? "";
  if (st === "applied") return "HR";
  if (st === "hr_reviewed")
    return ["coo", "cco"].includes(l.applicant_role ?? "") ? "CEO" : "COO / CCO";
  return "CEO";
}

export function Leave({ user, initialView, focus }: { user: User; initialView?: string; focus?: RecordFocus | null }) {
  /* v1.206.0 - the one leave open in the details drawer (any list, a search hit, a notification) */
  const [drawerId, setDrawerId] = useState<number | null>(null);
  /* v1.196.0 - THE LEAVE PAGE, TABBED (the owner's brief and photo,
     23-10-2026): Overview, Apply Leave, My Leave, Team Calendar, Approvals &
     Management. Every zone below is the zone it was, shown under its tab and
     hidden - never unmounted - under the others, so a half-typed application
     survives a look at the calendar. The gates are the ones the zones had. */
  /* v1.203.0 - a Dashboard quick action may open a tab straight on its form.
     v1.309.0 (L-0) - and every view has its address (?tab=Leave&view=...),
     Back and Forward move between them. */
  const [view, setView] = useState<LeaveView>(() => (isLeaveView(initialView ?? null) ? initialView as LeaveView : "overview"));
  const [applyOpen, setApplyOpen] = useState(false); // v1.325.0 (D-3) - the Apply Leave drawer
  const [applyDone, setApplyDone] = useState(false);
  const [seenStart, setSeenStart] = useState(initialView);
  if (initialView !== seenStart) { setSeenStart(initialView); if (isLeaveView(initialView ?? null)) setView(initialView as LeaveView); }
  const [leaveQ, setLeaveQ] = useState("");
  const [mineType, setMineType] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const canApproveRole = [
    "super_admin",
    "admin",
    "hr_admin",
    "coo",
    "cco",
    "ceo",
  ].includes(user.role);
  const { confirm: askOverride, node: overrideConfirmNode } = useConfirm();
  /* v1.127.0 — the step-up dialog for a final approval (withStepUp). */
  const { prompt, node: stepUpNode } = usePrompt();
  const { show: showLeaveToast, node: leaveToastNode } = useSaveToast();
  /* v1.83.0 (CEO: "leave application and history I want to view and to edit
     if necessary or to remove if require. filter by month") — the decided
     list was five lines of plain text with no way to reach any of them. */
  const [leaveMonth, setLeaveMonth] = useState("");
  /* v1.91.0 — which company-board row is open. */
  /* v1.206.0 - the company register's filters and page, and My Leave's status */
  const [regQ, setRegQ] = useState("");
  const [regDept, setRegDept] = useState("");
  const [regStatus, setRegStatus] = useState<"" | "mine" | "routing" | "progress" | "approved" | "rejected" | "cancelled">("");
  const [regPage, setRegPage] = useState(0);
  const [regPer, setRegPer] = useState(10);
  const [mineStatus, setMineStatus] = useState<"" | "progress" | "approved" | "rejected" | "cancelled">("");
  const [editLeave, setEditLeave] = useState<{
    id: number; type: string; start_date: string; end_date: string; days: number; reason: string; day_part: string;
  } | null>(null);
  const { confirm: askRemoveLeave, node: removeLeaveNode } = useConfirm();
  /* Amending a leave is the CEO's alone, exactly like recording an unpaid
     day: it can move a day between payroll months or turn a paid one unpaid.
     The server enforces the same list; this only decides what is drawn. */
  const canAmend = ["ceo", "super_admin"].includes(user.role);
  /* v1.104.0 (roadmap phase 02) - three remembered views, each its own
     entry: balance, my applications, and (for an approver) everyone's. They
     used to load in SERIES - balance, then mine, then all - so an approver
     waited three round-trips before the board drew; now they run at once,
     and the last-seen figures paint before any of them returns. A write on
     any leave bumps "leave" and all three refetch (the topic wiring moved
     INTO the hook).
     v1.77.0 (kept): skeleton until the first EVER fetch lands - for an
     approver that means all three, since the board is the point. */
  const balanceView = useCachedApi<{ balances: Record<string, { entitled: number; used: number; accrued?: number }>; hourly?: boolean }>(
    "/staff/leave/balance", true, ["leave"],
  );
  const mineView = useCachedApi<{ leave: LeaveReq[] }>("/staff/leave", true, ["leave"]);
  /* v1.21.0 (CEO: "I still cant see any list applied… who is the person
     that apply leave and waiting for their Head approval"): keep the WHOLE
     list. The board below shows every in-progress application with whose
     approval it waits on; the action buttons appear only on rows this viewer
     can act on (the old filter hid everything else, so COO/CEO saw an empty
     board while requests sat at HR). */
  const allView = useCachedApi<{ leave: LeaveReq[] }>("/staff/leave?all=1", canApproveRole, ["leave"]);
  const balances = useMemo(() => balanceView.data?.balances ?? {}, [balanceView.data]);
  /* v1.93.0 — a part-time host: no entitlement, no form; one line says why. */
  const hourly = Boolean(balanceView.data?.hourly);
  /* v1.260.0 - GET /leave also carries the requests ROUTED to you to decide
     (a team lead outside the management tier is an approver too): your own
     stay under My Leave; the ones you decide make the board */
  const mineRaw = useMemo(() => mineView.data?.leave ?? [], [mineView.data]);
  const mine = useMemo(() => mineRaw.filter((l) => l.user_id == null || l.user_id === user.id), [mineRaw, user.id]);
  const routedToMe = useMemo(() => mineRaw.filter((l) => l.user_id != null && l.user_id !== user.id), [mineRaw, user.id]);
  const canApprove = canApproveRole || routedToMe.length > 0;
  const all = useMemo(() => (canApproveRole ? allView.data?.leave ?? [] : routedToMe), [allView.data, canApproveRole, routedToMe]);
  const loaded = !balanceView.loading && !mineView.loading && (!canApproveRole || !allView.loading);
  const refreshBalance = balanceView.refresh, refreshMine = mineView.refresh, refreshAll = allView.refresh;
  const load = useCallback(async () => { refreshBalance(); refreshMine(); if (canApproveRole) refreshAll(); }, [refreshBalance, refreshMine, refreshAll, canApproveRole]);
  /* v1.205.0 - a search hit, a notification or a Desk item opens the request
     where it already lives: your own under My Leave, anyone else's on the
     company board under Approvals & Management - the row opened, the month
     and search filters cleared so it is in the list */
  const focused = useRecordFocus(focus, loaded, (f) => {
    if (f.kind !== "leave") return;
    setLeaveQ(""); setLeaveMonth(""); setRegQ(""); setRegDept(""); setRegStatus(""); setMineStatus("");
    if (mine.some((l) => l.id === f.id)) { setView("mine"); setDrawerId(f.id); return; }
    if (canApprove && all.some((l) => l.id === f.id)) { setView("manage"); setDrawerId(f.id); return; }
    setView(canApprove ? "manage" : "mine");
  });
  useScrollToRecord(focused);

  /* v1.309.0 (L-3) - THE ONE SENDER of a new request, used by the Apply
     form (leave4.tsx). The form has already shown the server's own count and
     checks (GET /leave/quote); this sends, asks for the CEO's authenticator
     code only when the server says an Executive Leave Record needs it, and
     reports a phone with no signal honestly (lib/outbox.ts keeps it). */
  type Applied = { id?: number; stage?: string; route?: string; approver?: string; days?: number; error?: { code?: string; message?: string } };
  const submitLeave = async (body: Record<string, unknown>) => {
    let res = await api<Applied>(`/staff/leave`, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok && res.status === 401 && res.data?.error?.code === "totp_required") {
      const stepped = await withStepUp<Applied>((totp) => api(`/staff/leave`, { method: "POST", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) }), prompt);
      res = { ...res, ...stepped };
    }
    if (res.ok || res.queued) {
      showLeaveToast(res.queued ? L("Kept — no signal", "Disimpan — tiada isyarat") : L("Leave requested", "Cuti dimohon"),
        res.queued ? L("Saved on this phone. It is sent the moment you are back online.", "Disimpan pada telefon ini. Ia dihantar sebaik sahaja anda kembali dalam talian.") : "", res.queued ? "notice" : "success");
      void load();
    }
    return { ok: res.ok, queued: res.queued, data: res.data };
  };
  const act = async (id: number, action: string, comment = "", extra: Record<string, unknown> = {}) => {
    /* v1.252.0 - a rejection says why (the applicant reads it); a return
       asks the applicant a question (D1). Asked here, before the request. */
    if ((action === "reject" || action === "return") && !comment.trim()) {
      const p = await prompt(action === "reject"
        ? { title: L("Reject this leave application?", "Tolak permohonan cuti ini?"), label: L("The reason - the applicant reads it (at least 5 characters)", "Sebabnya - pemohon akan membacanya (sekurang-kurangnya 5 aksara)"), required: true }
        : { title: L("Return for more information", "Kembalikan untuk maklumat"), label: L("Your question for the applicant (at least 10 characters). It comes back to you when they resubmit.", "Soalan anda kepada pemohon (sekurang-kurangnya 10 aksara). Ia kembali kepada anda apabila mereka menghantar semula."), required: true });
      if (!p?.value?.trim()) return;
      comment = p.value.trim();
    }
    /* v1.77.0 — approving or rejecting somebody's leave used to report
       nothing at all: the row simply moved. A decision about a person's time
       off should say what it did. */
    /* v1.127.0: the last approval in the chain signs the form, so the server
       asks for a live code. withStepUp sends the decision, and only when the
       server says a code is needed does it ask for one and send again. */
    const res = await withStepUp<{ stage?: string; error?: { message?: string } }>(
      (totp) => api(`/staff/leave/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, comment, ...extra, ...(totp ? { totp } : {}) }),
      }),
      prompt,
    );
    if (!res.ok) {
      showLeaveToast(L("Not changed", "Tidak diubah"),
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showLeaveToast(
      action === "reject" ? L("Rejected", "Ditolak")
      : action === "cancel" ? L("Cancelled", "Dibatalkan")
      : action === "return" ? L("Returned for information", "Dikembalikan untuk maklumat")
      : action === "resubmit" ? L("Resubmitted", "Dihantar semula")
      : res.data?.stage === "approved" ? L("Approved", "Diluluskan") : L("Approved - passed on", "Diluluskan - dihantar ke peringkat seterusnya"),
      action === "cancel"
        ? L("Your application has been withdrawn.", "Permohonan anda telah ditarik balik.")
        : action === "resubmit" ? L("It is back with the approver who asked.", "Ia kembali kepada pelulus yang bertanya.")
        : L("The staff member has been notified.", "Kakitangan telah dimaklumkan."),
    );
    void load();
  };
  const saveAmend = async () => {
    if (!editLeave) return;
    const res = await api<{ error?: { message?: string } }>(`/staff/leave/${editLeave.id}/amend`, {
      method: "PUT",
      body: JSON.stringify({
        type: editLeave.type, start_date: editLeave.start_date, end_date: editLeave.end_date,
        days: editLeave.days, reason: editLeave.reason, day_part: editLeave.days === 0.5 ? editLeave.day_part : "full",
      }),
    });
    if (!res.ok) {
      showLeaveToast(L("Not amended", "Tidak dipinda"),
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showLeaveToast(L("Amended", "Dipinda"),
      L("The staff member has been told. Press Recompute nets on Payroll if this month is already saved.",
        "Kakitangan telah dimaklumkan. Tekan Kira semula bersih pada Gaji jika bulan ini sudah disimpan."));
    setEditLeave(null);
    void load();
  };
  const removeLeave = async (l: LeaveReq) => {
    const yes = await askRemoveLeave({
      title: L("Remove this leave record?", "Buang rekod cuti ini?"),
      message: L(
        `${properName(l.user_full || l.user_name || "")} — ${leaveTypeL(l.type)}, ${dmy(l.start_date)}. The record is deleted and they are told. If it was unpaid, the deduction goes with it; press Recompute nets on Payroll afterwards.`,
        `${properName(l.user_full || l.user_name || "")} — ${leaveTypeL(l.type)}, ${dmy(l.start_date)}. Rekod dipadam dan mereka dimaklumkan. Jika ia tanpa gaji, potongan turut dibuang; tekan Kira semula bersih pada Gaji selepas ini.`,
      ),
      confirmLabel: L("Remove", "Buang"),
      variant: "danger",
    });
    if (!yes) return;
    const res = await api<{ error?: { message?: string } }>(`/staff/leave/${l.id}`, { method: "DELETE" });
    if (!res.ok) {
      showLeaveToast(L("Not removed", "Tidak dibuang"),
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showLeaveToast(L("Removed", "Dibuang"), L("The staff member has been told.", "Kakitangan telah dimaklumkan."));
    setDrawerId(null);
    void load();
  };
  /* v1.72.0 (CEO: "I want to have a function for me to approved the leave
     form of all the staff which is can by pass their HOD") — the chain is
     untouched; this is the way past a stage whose approver is away. The
     server refuses `override` from anyone but the CEO, and refuses it on
     your own application, so this button cannot do anything a hand-made
     request could not. The stages skipped stay visibly unsigned on the
     printed form — that is the record. */
  /* v1.309.0 (L-12) - only the verified company owner (the server decides
     is_owner; this only decides what is drawn - the route refuses anyone else) */
  const canOverride = user.role === "ceo" && user.is_owner === true;
  /* v1.260.0 - Route now, Re-route, Reassign, the HR check: one sender */
  const [reassign, setReassign] = useState<{ id: number; to: number; why: string } | null>(null);
  const routeAct = async (id: number, action: string, ask?: { title: string; label: string }, extra: Record<string, unknown> = {}) => {
    let comment = "";
    if (ask) {
      const p = await prompt({ title: ask.title, label: ask.label, required: true });
      if (!p?.value?.trim()) return;
      comment = p.value.trim();
    }
    const res = await api<{ approver?: string; error?: { message?: string } }>(`/staff/leave/${id}`, { method: "PATCH", body: JSON.stringify({ action, ...(comment ? { comment } : {}), ...extra }) });
    if (!res.ok) { showLeaveToast(L("Not changed", "Tidak diubah"), res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice"); return; }
    showLeaveToast(
      action === "hr_verify" ? L("HR verified", "Disahkan HR") : action === "hr_flag" ? L("Issue flagged", "Isu ditandakan") : action === "reassign" ? L("Reassigned", "Diserahkan semula") : L("Routed", "Dihalakan"),
      res.data?.approver ? L(`It now waits on ${properName(res.data.approver)}.`, `Kini menunggu ${properName(res.data.approver)}.`) : L("It is on the record with your name and the time.", "Ia direkod dengan nama anda dan masa."),
    );
    void load();
  };
  const overrideAct = async (l: LeaveReq, action: "approve" | "reject") => {
    const nm = properName(l.user_full || l.user_name || "");
    if (
      !(await askOverride({
        title:
          action === "approve"
            ? L("Approve now, skipping the chain?", "Luluskan terus, langkau rantaian?")
            : L("Reject now, skipping the chain?", "Tolak terus, langkau rantaian?"),
        message: L(
          `${nm} — ${leaveTypeL(l.type)}, ${dmy(l.start_date)} → ${dmy(l.end_date)} (${l.days}d). This is currently waiting on ${waitingOnLabel(l)}. Deciding it here records you as the only signature; the stages that were skipped stay blank on the form.`,
          `${nm} — ${leaveTypeL(l.type)}, ${dmy(l.start_date)} → ${dmy(l.end_date)} (${l.days}h). Ini sedang menunggu ${waitingOnLabel(l)}. Membuat keputusan di sini merekodkan anda sebagai satu-satunya tandatangan; peringkat yang dilangkau kekal kosong pada borang.`
        ),
        confirmLabel:
          action === "approve"
            ? L("Approve now", "Luluskan terus")
            : L("Reject now", "Tolak terus"),
        variant: action === "approve" ? "default" : "danger",
      }))
    )
      return;
    /* v1.260.0 (D7) - on a routed request the override decides in the
       approver's place: the reason is required and the approver is told */
    /* v1.309.0 (L-12) - every override states its reason (routed or not,
       approve or reject); the authenticator is asked for both */
    let why = "";
    {
      const p = await prompt({ title: L("Why are you deciding in the approver's place?", "Mengapa anda membuat keputusan bagi pihak pelulus?"), label: L(`The reason - ${waitingOnLabel(l)} is told (at least 5 characters)`, `Sebabnya - ${waitingOnLabel(l)} dimaklumkan (sekurang-kurangnya 5 aksara)`), required: true, confirmLabel: action === "approve" ? L("Approve now", "Luluskan terus") : L("Reject now", "Tolak terus") });
      if (!p?.value?.trim()) return;
      why = p.value.trim();
    }
    /* The CEO override is a final approval by definition — it goes straight
       to approved with his chop on it, so it always meets the step-up. */
    const res = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api(`/staff/leave/${l.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, override: true, ...(why ? { comment: why } : {}), ...(totp ? { totp } : {}) }),
      }),
      prompt,
    );
    if (!res.ok) {
      showLeaveToast(L("Not changed", "Tidak diubah"),
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showLeaveToast(
      action === "approve" ? L("Approved by you", "Diluluskan oleh anda") : L("Rejected", "Ditolak"),
      L(`${nm} has been notified. The stages that were skipped stay blank on the form.`,
        `${nm} telah dimaklumkan. Peringkat yang dilangkau kekal kosong pada borang.`),
    );
    void load();
  };

  /* v1.62.0 — the CEO's entitlement control. Mirrors the server's
     `leave_entitlement` permission exactly; the API refuses anyone else
     regardless of what the client renders. */
  const canSetEntitlement = holds("leave_entitlement", ["ceo", "super_admin"].includes(user.role));
  /* v1.196.0 - the search over a leave list: the person, the type, the
     reason or the leave number */
  const qNeedle = leaveQ.trim().toLowerCase();
  const matchQ = (l: LeaveReq) => !qNeedle || [l.user_full ?? "", l.user_name ?? "", leaveTypeL(l.type), l.type, l.reason ?? "", leaveNoOf(l)]
    .some((t) => t.toLowerCase().includes(qNeedle));

  const canManage = canApprove || canSetEntitlement;
  /* v1.325.0 (Global UI System D-3, the CEO's approval) - Apply Leave is not a
     view any more: it is a button that opens the same three steps in the drawer */
  const openView = (v: LeaveView) => { if (v === "apply") { setApplyDone(false); setApplyOpen(true); return; } setView(v); window.scrollTo({ top: 0 }); };

  const VIEW_TABS: readonly (readonly [LeaveView, string, string])[] = [
    ["overview", L("Overview", "Gambaran"), L("This month, waiting on you, who is away", "Bulan ini, menunggu anda, siapa bercuti")],
    ...(!hourly ? ([["mine", L("My Leave", "Cuti Saya"), L("Balance and history", "Baki dan sejarah")]] as const) : []),
    ["calendar", L("Team Calendar", "Kalendar Pasukan"), L("Leave, holidays and availability", "Cuti, cuti umum dan ketersediaan")],
    ...(canManage ? ([["manage", L("Approvals & Management", "Kelulusan & Pengurusan"), L("The queue, policy and every request", "Barisan, dasar dan setiap permohonan")]] as const) : []),
  ];
  /* a view this person does not have (a part-timer's Apply, a staff member's
     Approvals) falls back to the Overview once their lists are known - never
     a blank page; the address follows what is shown */
  /* an address or a link that still asks for ?view=apply (the Dashboard's Apply Leave) opens the drawer over the Overview */
  if (view === "apply") { setView("overview"); if (!hourly) { setApplyDone(false); setApplyOpen(true); } }
  const shown: LeaveView = !loaded || VIEW_TABS.some((t) => t[0] === view) ? view : "overview";
  useTabViewAddress("Leave", shown, setView, isLeaveView);
  const [calYm, setCalYm] = useState(mytToday().slice(0, 7));
  const [calDay, setCalDay] = useState(mytToday());
  const [byPerson, setByPerson] = useState(false);
  const canByPerson = holds("team_manage", ["super_admin", "admin", "hr_admin", "ceo", "coo", "cco"].includes(user.role));

  return (
    /* v1.309.0 - LEAVE WORKSPACE 4.0: five views (the CEO's five references),
       each zone mounted once and hidden under the others, so a half-typed
       application survives a look at the calendar. One engine underneath. */
    <TabPage>
      {overrideConfirmNode}
      {stepUpNode}
      {removeLeaveNode}
      {leaveToastNode}
      <div className="erp-desktop-only">
        <LineTabs value={shown} onChange={(k) => openView(k)} label={L("Leave", "Cuti")} tabs={VIEW_TABS.map(([k, t]) => [k, t] as const)}
          aside={
            <TabAside>
              <TabPeriod>{monthName(mytToday().slice(0, 7))}</TabPeriod>
              {!hourly && <TabAction icon="add" onClick={() => openView("apply")}>{L("Apply Leave", "Mohon Cuti")}</TabAction>}
            </TabAside>
          } />
      </div>
      <div className={`erp-phone-only ${l4.viewBar}`} data-testid="leave-view-bar">
        <ViewSwitch value={shown} onChange={(k) => openView(k)} label={L("Leave view", "Paparan cuti")} options={VIEW_TABS} />
        {!hourly && <TabAction icon="add" onClick={() => openView("apply")}>{L("Apply", "Mohon")}</TabAction>}
      </div>

      <TabZone label={L("Overview", "Gambaran")} className={shown !== "overview" ? lv.off : ""}>
        <LeaveOverview4 userId={user.id} mine={mine} all={all} company={canApproveRole} loaded={loaded} hourly={hourly}
          open={openView} onView={(id) => setDrawerId(id)} />
      </TabZone>

      {/* v1.325.0 (D-3) - the same three steps, the same checks and the same submit, in the drawer;
          it asks before discarding a half-written application, and not once it is submitted.
          v1.326.0 - the form drawer (the CEO's Apply Leave reference): its icon, the steps under the title, Cancel / Review pinned */}
      {!hourly && (
      <SideDrawer open={applyOpen} onClose={() => { setApplyOpen(false); setApplyDone(false); }} dirty={applyDone ? false : "auto"} form icon="date"
        title={L("Apply Leave", "Mohon Cuti")} subtitle={L("Submit a new leave request for approval", "Hantar permohonan cuti baharu untuk kelulusan")}>
        <ApplyLeave4 types={LEAVE_TYPES} toast={showLeaveToast} submit={submitLeave} onSubmitted={() => { setApplyDone(true); void load(); }} />
      </SideDrawer>
      )}

      {!hourly && (
      <TabZone label={L("My balance", "Baki saya")} className={shown !== "mine" ? lv.off : ""}>
        <MyBalances4 balances={balances as Record<string, Balance4>} loaded={loaded} userId={user.id} />
      </TabZone>
      )}

      {canManage && (
      <TabZone label={L("Approvals & management", "Kelulusan & pengurusan")} className={shown !== "manage" ? lv.off : ""}>
        <ApprovalsHead4 all={all} loaded={loaded} canEditPolicy={canSetEntitlement} onManagePolicy={() => setPolicyOpen(true)} />
        {canApprove && <ApprovalQueue4 all={all} loaded={loaded} onView={(id) => setDrawerId(id)} act={(id, a) => void act(id, a)} />}
      {canApprove &&
        (() => {
          /* v1.21.0 — the whole approval chain sees the whole board.
             v1.206.0 - one register, as a table: what is in progress first
             (whose approval it waits on), then every decided record, newest
             first; searched by person, type, reason or leave no., filtered by
             department, status and month (by OVERLAP, v1.83.0: a leave from
             the 29th into the next month appears under both), and paged. The
             decision buttons are on the row as before, for the stage that
             waits on you; everything else opens the details drawer. */
          const TERMINAL = ["approved", "rejected", "cancelled"];
          const regNeedle = regQ.trim().toLowerCase();
          const depts = [...new Set(all.map((l) => (l.user_department ?? "").trim()).filter(Boolean))].sort();
          const months = [...new Set(all.flatMap((l) => [l.start_date.slice(0, 7), l.end_date.slice(0, 7)]))].sort().reverse();
          const rows = all
            .filter((l) => !regNeedle || [l.user_full ?? "", l.user_name ?? "", leaveTypeL(l.type), l.type, l.reason ?? "", leaveNoOf(l)].some((t) => t.toLowerCase().includes(regNeedle)))
            .filter((l) => !regDept || (l.user_department ?? "").trim() === regDept)
            .filter((l) => { const st = l.stage ?? l.status; return !regStatus || (regStatus === "mine" ? l.can_act === true : regStatus === "routing" ? st === "routing_required" : regStatus === "progress" ? !TERMINAL.includes(st) : st === regStatus); })
            .filter((l) => !leaveMonth || (l.start_date <= `${leaveMonth}-31` && l.end_date >= `${leaveMonth}-01`))
            .sort((a, b) => Number(TERMINAL.includes(a.stage ?? a.status)) - Number(TERMINAL.includes(b.stage ?? b.status)) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
          const pages = Math.max(1, Math.ceil(rows.length / regPer));
          const page = Math.min(regPage, pages - 1);
          const shown = rows.slice(page * regPer, page * regPer + regPer);
          const who = (l: LeaveReq) => properName(l.user_full || l.user_name || "");
          const reset = () => setRegPage(0);
          return (
            <section className={card} aria-label={L("Leave — whole company", "Cuti — seluruh syarikat")}>
              <div className={lv.regHead}>
                <div>
                  <p className={lv.title}>{canApproveRole ? L("All leave requests", "Semua permohonan cuti") : L("Requests routed to you", "Permohonan yang dihalakan kepada anda")}</p>
                  <p className={lv.sub}>{L("Everything in progress and whose approval it waits on, then every decided record — including unpaid days recorded from Attendance. Decide in the Approval Queue above or in the request's details.", "Semua yang sedang diproses dan kelulusan siapa yang ditunggu, kemudian setiap rekod yang diputuskan — termasuk hari tanpa gaji yang direkodkan dari Kehadiran. Putuskan dalam Barisan Kelulusan di atas atau dalam butiran permohonan.")}</p>
                </div>
              </div>
              <div className={lv.filters}>
                <label className={lv.searchField}>
                  <AppIcon name="search" />
                  <input value={regQ} onChange={(e) => { setRegQ(e.target.value); reset(); }} placeholder={L("Search staff, leave type, reason or leave no.", "Cari kakitangan, jenis cuti, sebab atau no. cuti")} aria-label={L("Search the company's leave", "Cari cuti syarikat")} />
                </label>
                <select className={inputClassSm} value={regDept} onChange={(e) => { setRegDept(e.target.value); reset(); }} aria-label={L("Department", "Jabatan")}>
                  <option value="">{L("All departments", "Semua jabatan")}</option>
                  {depts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className={inputClassSm} value={regStatus} onChange={(e) => { setRegStatus(e.target.value as typeof regStatus); reset(); }} aria-label={L("Status", "Status")}>
                  <option value="">{L("All statuses", "Semua status")}</option>
                  <option value="mine">{L("Waiting for my approval", "Menunggu kelulusan saya")}</option>
                  <option value="progress">{L("In progress", "Sedang diproses")}</option>
                  <option value="routing">{L("Requires configuration", "Perlu ditetapkan")}</option>
                  <option value="approved">{L("Approved", "Diluluskan")}</option>
                  <option value="rejected">{L("Rejected", "Ditolak")}</option>
                  <option value="cancelled">{L("Cancelled", "Dibatalkan")}</option>
                </select>
                <select className={inputClassSm} value={leaveMonth} onChange={(e) => { setLeaveMonth(e.target.value); reset(); }} aria-label={L("Filter by month", "Tapis ikut bulan")}
                  title={L("Show every leave taken in this month. A leave spanning two months appears under both.", "Tunjuk setiap cuti yang diambil dalam bulan ini. Cuti merentasi dua bulan muncul pada kedua-duanya.")}>
                  <option value="">{L("Every month", "Setiap bulan")}</option>
                  {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
                </select>
              </div>
              {/* v1.77.0 — skeleton until the first fetch lands. */}
              {!loaded ? <SkelTable rows={5} cols={7} /> : (
                <FillPanel testid="leave-register-fill" className={lv.regWrap}>
                  <table className={lv.reg} aria-label={L("Leave — whole company", "Cuti — seluruh syarikat")}>
                    <thead><tr>
                      <th>{L("Applied", "Dimohon")}</th><th>{L("Staff", "Kakitangan")}</th><th>{L("Leave type", "Jenis cuti")}</th><th>{L("Leave period", "Tempoh cuti")}</th>
                      <th className={lv.num}>{L("Days", "Hari")}</th><th>{L("Status", "Status")}</th><th><span className={lv.srOnly}>{L("Actions", "Tindakan")}</span></th>
                    </tr></thead>
                    <tbody>
                      {shown.length === 0 && <tr><td colSpan={7} className={lv.emptyCell}>{all.length === 0 ? L("Nothing yet.", "Tiada lagi.") : L("No leave matches — clear the search or a filter.", "Tiada cuti sepadan — kosongkan carian atau penapis.")}</td></tr>}
                      {shown.map((l) => {
                        const st = l.stage ?? l.status;
                        const inProgress = !TERMINAL.includes(st);
                        const mine = inProgress && l.can_act === true; // v1.252.0 - the server's answer for this person
                        const chip = leaveChip(st);
                        return (
                          <tr key={l.id} data-record={`leave:${l.id}`} className={mine ? lv.rowMine : ""}>
                            <td data-label={L("Applied", "Dimohon")} className={lv.muted}>{l.created_at ? dmy(l.created_at.slice(0, 10)) : "—"}</td>
                            <td className={lv.personCell}>
                              <button type="button" className={lv.person} onClick={() => setDrawerId(l.id)} title={L("Open the application", "Buka permohonan")}>
                                <Avatar name={who(l)} userId={l.user_id} size="sm" />
                                <span className={lv.personText}><strong>{who(l)}</strong><span>{l.user_department || l.user_position || "—"}</span></span>
                              </button>
                            </td>
                            <td data-label={L("Leave type", "Jenis cuti")} className={l.type === "unpaid" ? lv.danger : ""}>{typeName(l.type)}</td>
                            <td data-label={L("Leave period", "Tempoh cuti")}>{period(l.start_date, l.end_date)}<span className={lv.cov}>{coverageLabel(l)}</span></td>
                            <td data-label={L("Days", "Hari")} className={lv.num}>{l.days}</td>
                            <td data-label={L("Status", "Status")}>
                              <span className={lv.statusCell}>
                                <LeaveDots l={l} />
                                {inProgress
                                  ? <span className={mine ? chipSmWarn : chipSmNeutral}>{l.stage === "returned" ? L("Returned to the applicant", "Dikembalikan kepada pemohon") : <>{L("Waiting on", "Menunggu")} {waitingOnLabel(l)}</>}</span>
                                  : <span className={chip[0]}>{chip[1]}</span>}
                                {mine && <span className={lv.yourAction}>{L("Your action", "Tindakan anda")}</span>}
                              </span>
                            </td>
                            <td className={lv.actCell}>
                              <span>
                                {/* v1.309.0 - decisions are made in the Approval Queue above and in the drawer; the register lists */}
                                <button type="button" className={rowBtn} onClick={() => setDrawerId(l.id)}>{L("View", "Lihat")}</button>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </FillPanel>
              )}
              {loaded && rows.length > 0 && (
                <div className={lv.pager}>
                  <span>{L(`Showing ${page * regPer + 1}–${Math.min(rows.length, page * regPer + regPer)} of ${rows.length}`, `Memaparkan ${page * regPer + 1}–${Math.min(rows.length, page * regPer + regPer)} daripada ${rows.length}`)}</span>
                  <select className={inputClassSm} value={regPer} onChange={(e) => { setRegPer(Number(e.target.value)); reset(); }} aria-label={L("Rows per page", "Baris setiap halaman")}>
                    {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / {L("page", "halaman")}</option>)}
                  </select>
                  <span className={lv.pageBtns}>
                    <button type="button" className={rowBtn} disabled={page === 0} onClick={() => setRegPage(page - 1)} aria-label={L("Previous page", "Halaman sebelumnya")}><AppIcon name="previous" /></button>
                    <span>{page + 1} / {pages}</span>
                    <button type="button" className={rowBtn} disabled={page >= pages - 1} onClick={() => setRegPage(page + 1)} aria-label={L("Next page", "Halaman seterusnya")}><AppIcon name="next" /></button>
                  </span>
                </div>
              )}
            </section>
          );
        })()}
      </TabZone>
      )}
      {/* v1.309.0 (ref 4) - Manage Policy: the CEO's entitlement editor, in a drawer */}
      {canSetEntitlement && (
        <SideDrawer open={policyOpen} onClose={() => setPolicyOpen(false)} wide title={L("Leave entitlement", "Kelayakan cuti")} subtitle={L("Each person's yearly figure - every change is audited", "Angka tahunan setiap orang - setiap perubahan diaudit")}>
          <LeaveEntitlement />
        </SideDrawer>
      )}
      {/* v1.307.0 - ATTENDANCE 4.0: Attendance's Settings tab is gone; its
          unpaid-day editor (an APPROVED unpaid leave record, what payroll
          reads) is a leave record, so it lives with the company's leave. The
          same card, the same gate as before: unpaid_leave, the CEO's. */}
      {shown === "manage" && holds("unpaid_leave", ["ceo", "super_admin"].includes(user.role)) && (
        <TabZone label={L("Unpaid leave days", "Hari cuti tanpa gaji")} hint={L("Record or correct a full or half unpaid day - it is stored as an approved unpaid leave record.", "Rekod atau betulkan hari tanpa gaji penuh atau separuh - disimpan sebagai rekod cuti tanpa gaji yang diluluskan.")}>
          <AttendanceAdminPanel role={user.role} areas={["unpaid"]} showPending={false} />
        </TabZone>
      )}
      {/* v1.309.0 (L-9) - ONE TEAM CALENDAR: the month grid with its legend,
          the day's availability and who is away by department beside it;
          managers may switch the grid to the person-by-day strip (the same
          month, with the department clash marks) */}
      <TabZone label={L("Team calendar", "Kalendar pasukan")} className={shown !== "calendar" ? lv.off : ""}>
        {canByPerson && (
          <div className={l4.calTools}><PillSwitch testid="cal" label={L("Calendar view", "Paparan kalendar")} value={byPerson ? "by-person" : "month"}
            onChange={(k) => setByPerson(k === "by-person")} options={[["month", L("Month", "Bulan")], ["by-person", L("By person", "Ikut orang")]] as const} /></div>
        )}
        <div className={l4.calLayout}>
          <div>
            {byPerson && canByPerson ? <LeaveCalendar /> : <TeamCalendarGrid userId={user.id} onMonth={setCalYm} onDay={setCalDay} />}
          </div>
          <TeamSide ym={calYm} day={calDay} />
        </div>
      </TabZone>
    {!hourly && (
      <TabZone label={L("My history", "Sejarah saya")} className={shown !== "mine" ? lv.off : ""}>
        {/* v1.206.0 - your applications as a table, each opening the details
            drawer; Print form, Send PDF and Cancel (while in progress) on the
            row as before */}
        <section className={card} aria-label={L("My leave history", "Sejarah cuti saya")} data-testid="leave-history">
          <p className={lv.title}>{L("Leave History", "Sejarah Cuti")}</p>
          <p className={lv.sub}>{L("All your leave requests and their current status.", "Semua permohonan cuti anda dan status semasanya.")}</p>
          <div className={lv.filters}>
            <label className={lv.searchField}>
              <AppIcon name="search" />
              <input value={leaveQ} onChange={(e) => setLeaveQ(e.target.value)} placeholder={L("Search by request, leave type…", "Cari mengikut permohonan, jenis cuti…")} aria-label={L("Search leave", "Cari cuti")} />
            </label>
            <select className={inputClassSm} value={mineType} onChange={(e) => setMineType(e.target.value)} aria-label={L("Leave type", "Jenis cuti")}>
              <option value="">{L("All leave types", "Semua jenis cuti")}</option>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{leaveTypeL(t)}</option>)}
            </select>
            <select className={inputClassSm} value={mineStatus} onChange={(e) => setMineStatus(e.target.value as typeof mineStatus)} aria-label={L("Status", "Status")}>
              <option value="">{L("All statuses", "Semua status")}</option>
              <option value="progress">{L("In progress", "Sedang diproses")}</option>
              <option value="approved">{L("Approved", "Diluluskan")}</option>
              <option value="rejected">{L("Rejected", "Ditolak")}</option>
              <option value="cancelled">{L("Cancelled", "Dibatalkan")}</option>
            </select>
          </div>
          {/* v1.77.0 — skeleton until the first fetch lands. */}
          {!loaded ? <SkelTable rows={4} cols={6} /> : mine.length === 0 ? (
            <p className={lv.empty}>{L("No requests yet.", "Tiada permohonan lagi.")}</p>
          ) : (
            <div className={lv.regWrap}>
              <table className={lv.reg} aria-label={L("My leave history", "Sejarah cuti saya")}>
                <thead><tr>
                  <th>{L("Request #", "Permohonan #")}</th><th>{L("Leave type", "Jenis cuti")}</th><th>{L("Period", "Tempoh")}</th>
                  <th className={lv.num}>{L("Days", "Hari")}</th><th>{L("Status", "Status")}</th><th>{L("Last update", "Kemas kini terakhir")}</th><th><span className={lv.srOnly}>{L("Actions", "Tindakan")}</span></th>
                </tr></thead>
                <tbody>
                  {mine.filter(matchQ).filter((l) => !mineType || l.type === mineType).filter((l) => { const st = l.stage ?? l.status; return !mineStatus || (mineStatus === "progress" ? !["approved", "rejected", "cancelled"].includes(st) : st === mineStatus); }).map((l) => {
                    const st = (l as LeaveReq).stage ?? l.status;
                    const inProgress = !["approved", "rejected", "cancelled"].includes(st);
                    const chip = leaveChip(st);
                    return (
                      <tr key={l.id} data-record={`leave:${l.id}`}>
                        <td className={lv.personCell}>
                          <button type="button" className={lv.leaveNo} onClick={() => setDrawerId(l.id)} title={L("Type, period, reason, comments and the approval trail", "Jenis, tempoh, sebab, komen dan jejak kelulusan")}>{leaveNoOf(l)}</button>
                        </td>
                        <td data-label={L("Leave type", "Jenis cuti")}>{typeName(l.type)}</td>
                        <td data-label={L("Leave period", "Tempoh cuti")}>{period(l.start_date, l.end_date)}<span className={lv.cov}>{coverageLabel(l)}</span></td>
                        <td data-label={L("Days", "Hari")} className={lv.num}>{l.days}</td>
                        <td data-label={L("Status", "Status")}><span className={lv.statusCell}><LeaveDots l={l} />{inProgress ? <span className={chipSmWarn}>{l.stage === "returned" ? L("Returned - your answer needed", "Dikembalikan - jawapan anda diperlukan") : stageL(st)}</span> : <span className={chip[0]}>{chip[1]}</span>}</span></td>
                        <td data-label={L("Last update", "Kemas kini terakhir")} className={lv.muted}>{dmyMYT(l.last_update ?? l.final_at ?? l.created_at) || "—"}</td>
                        <td className={lv.actCell}>
                          <span className={l4.rowActs}>
                            <button type="button" className={rowBtn} onClick={() => setDrawerId(l.id)}>{L("View", "Lihat")}</button>
                            <RowMenu label={L("More actions", "Lagi tindakan")} items={[
                              { label: L("Print form", "Cetak borang"), onClick: () => printLeaveForm(l, user.name) },
                              { label: L("Send PDF", "Hantar PDF"), onClick: () => void sendLeavePdf(l) },
                              ...(inProgress ? [{ label: L("Withdraw", "Tarik balik"), onClick: () => void act(l.id, "cancel"), danger: true }] : []),
                            ]} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </TabZone>
      )}
      {/* v1.206.0 - THE LEAVE DETAILS DRAWER, outside every zone (a hidden
          tab must not hide it): the record, its approval trail, the records
          around it as links, and the actions this person may take on it -
          the same functions the rows call, with the same gates */}
      {(() => {
        const d = drawerId == null ? null : all.find((x) => x.id === drawerId) ?? mine.find((x) => x.id === drawerId) ?? null;
        const st = d ? d.stage ?? d.status : "";
        const TERMINAL = ["approved", "rejected", "cancelled"];
        const inProgress = d ? !TERMINAL.includes(st) : false;
        const own = d ? d.user_id === user.id || (!d.user_id && mine.some((x) => x.id === d.id)) : false;
        const waitsOnMe = d ? inProgress && d.can_act === true && !own : false; // v1.252.0 - the server says who decides now
        const close = () => { setDrawerId(null); setEditLeave(null); };
        return (
          <SideDrawer open={d !== null} onClose={close} wide full
            title={d ? `${L("Leave application", "Permohonan cuti")} - ${leaveNoOf(d)}` : ""}
            subtitle={d ? `${leaveNoOf(d)} · ${stageL(st)}` : undefined}
            footer={d ? (
              <span className={lv.drawerActions}>
                {waitsOnMe && (
                  <>
                    <button type="button" className={btnClass} onClick={() => void act(d.id, "approve")}>
                      {d.stage === "routed" ? L("Approve", "Luluskan") : d.stage === "applied" ? L("Mark reviewed", "Tanda disemak") : d.stage === "hr_reviewed" ? L("Pre-approve", "Pra-lulus") : L("Final approve", "Kelulusan akhir")}
                    </button>
                    <button type="button" className={rowBtn} onClick={() => void act(d.id, "return")}>{L("Return for info", "Kembalikan untuk maklumat")}</button>
                    <button type="button" className={rowBtnDanger} onClick={() => void act(d.id, "reject")}>{L("Reject", "Tolak")}</button>
                  </>
                )}
                {!waitsOnMe && inProgress && canOverride && !own && (
                  <>
                    <button type="button" className={rowBtn} onClick={() => void overrideAct(d, "approve")}>{L("Approve now", "Luluskan terus")}</button>
                    <button type="button" className={rowBtnDanger} onClick={() => void overrideAct(d, "reject")}>{L("Reject", "Tolak")}</button>
                  </>
                )}
                {/* v1.260.0 - the Organisation route's own actions, only where the server allows them */}
                {d.can_route && <button type="button" className={btnClass} data-testid="route-now" onClick={() => void routeAct(d.id, "route")}>{L("Route now", "Halakan sekarang")}</button>}
                {d.can_reroute && <button type="button" className={rowBtn} data-testid="reroute" onClick={() => void routeAct(d.id, "reroute", { title: L("Re-route by the Organisation chart", "Halakan semula mengikut carta Organisasi"), label: L("Why - it goes to the applicant's reporting manager; decisions already made stay on the record (at least 5 characters)", "Sebabnya - ia pergi kepada pengurus pelapor pemohon; keputusan yang dibuat kekal dalam rekod (sekurang-kurangnya 5 aksara)") })}>{L("Re-route by Organisation", "Halakan semula ikut Organisasi")}</button>}
                {d.can_reassign && <button type="button" className={rowBtn} data-testid="reassign-open" onClick={() => setReassign(reassign?.id === d.id ? null : { id: d.id, to: d.reassign_to?.[0]?.id ?? 0, why: "" })}>{L("Reassign", "Serah semula")}</button>}
                {d.can_hr_check && (
                  <>
                    <button type="button" className={rowBtn} data-testid="hr-verify" onClick={() => void routeAct(d.id, "hr_verify")}>{L("HR verified", "Disahkan HR")}</button>
                    <button type="button" className={rowBtn} onClick={() => void routeAct(d.id, "hr_flag", { title: L("Flag an issue for the approver", "Tandakan isu untuk pelulus"), label: L("What is the issue - the approver and the applicant read it (at least 5 characters)", "Apakah isunya - pelulus dan pemohon membacanya (sekurang-kurangnya 5 aksara)") })}>{L("Flag an issue", "Tandakan isu")}</button>
                  </>
                )}
                {own && inProgress && <button type="button" className={rowBtnDanger} onClick={() => void act(d.id, "cancel")}>{L("Withdraw my application", "Tarik balik permohonan saya")}</button>}
                {canAmend && !inProgress && (
                  <>
                    <button type="button" className={rowBtn} title={L("Correct the type, the dates or the number of days", "Betulkan jenis, tarikh atau bilangan hari")}
                      onClick={() => setEditLeave(editLeave?.id === d.id ? null : { id: d.id, type: d.type, start_date: d.start_date, end_date: d.end_date, days: d.days, reason: d.reason ?? "", day_part: d.day_part ?? "" })}>
                      {editLeave?.id === d.id ? L("Close editing", "Tutup suntingan") : L("Edit", "Sunting")}
                    </button>
                    <button type="button" className={rowBtnDanger} onClick={() => void removeLeave(d)}>{L("Remove", "Buang")}</button>
                  </>
                )}
                {own && <button type="button" className={rowBtn} onClick={() => void sendLeavePdf(d)}>{L("Send PDF", "Hantar PDF")}</button>}
                <button type="button" className={rowBtn} onClick={close}>{L("Close", "Tutup")}</button>
              </span>
            ) : undefined}>
            {d && (
              <div className={lv.drawer}>
                <div className={lv.dHead}>
                  <Avatar name={properName(d.user_full || d.user_name || user.name)} size="lg" />
                  <span className={lv.dWho}>
                    <strong>{properName(d.user_full || d.user_name || user.name)}</strong>
                    <span>{[d.user_position, d.user_department].filter(Boolean).join(" · ") || (own ? L("You", "Anda") : "")}</span>
                  </span>
                  {inProgress ? <span className={waitsOnMe ? chipSmWarn : chipSmNeutral}>{d.stage === "returned" ? L("Returned to the applicant", "Dikembalikan kepada pemohon") : <>{L("Waiting on", "Menunggu")} {waitingOnLabel(d)}</>}</span> : <span className={leaveChip(st)[0]}>{leaveChip(st)[1]}</span>}
                </div>
                {/* v1.309.0 (L-4) - the supporting document, read through its own gated route (the applicant, the route, HR and the CEO) */}
                {d.has_attachment && (
                  <a className={rowBtn} href={`/api/v1/staff/leave/${d.id}/attachment`} target="_blank" rel="noopener noreferrer" data-testid="leave-attachment">
                    <AppIcon name="attach" /> {L("Open the attachment", "Buka lampiran")}
                  </a>
                )}
                {/* v1.260.0 - what the route needs the reader to know */}
                {d.stage === "routing_required" && <p className={lv.note} role="status" data-testid="routing-required">{L("Approval routing requires configuration: this person has no reporting manager on the Organisation chart. Set it there, then Route now.", "Laluan kelulusan perlu ditetapkan: orang ini tiada pengurus pelapor pada carta Organisasi. Tetapkannya di sana, kemudian Halakan sekarang.")}</p>}
                {d.line_changed && <p className={lv.note} role="status" data-testid="line-changed">{L(`Reporting line changed since submission - now ${properName(d.line_changed)}. This request stays with ${waitingOnLabel(d)} as submitted; reassign it if needed.`, `Garis pelaporan berubah selepas permohonan - kini ${properName(d.line_changed)}. Permohonan ini kekal dengan ${waitingOnLabel(d)} seperti dihantar; serah semula jika perlu.`)}</p>}
                {d.approver_away_until && inProgress && <p className={lv.note} role="status" data-testid="approver-away">{L(`${waitingOnLabel(d)} is on approved leave until ${dmy(d.approver_away_until)} - reassign the step if it cannot wait.`, `${waitingOnLabel(d)} bercuti sehingga ${dmy(d.approver_away_until)} - serah semula jika tidak boleh menunggu.`)}</p>}
                {reassign?.id === d.id && (
                  <div className={lv.amend} data-testid="leave-reassign">
                    <SubR t={L("Reassign to", "Serah kepada")}>
                      <select className={inputClassSm} value={reassign.to} onChange={(e) => setReassign({ ...reassign, to: Number(e.target.value) })} aria-label={L("Reassign to", "Serah kepada")}>
                        {(d.reassign_to ?? []).map((p) => <option key={p.id} value={p.id}>{properName(p.name)}{p.position ? ` - ${p.position}` : ""}</option>)}
                      </select>
                    </SubR>
                    <SubR t={L("Reason", "Sebab")}>
                      <textarea className={textareaClass} rows={2} maxLength={500} value={reassign.why} onChange={(e) => setReassign({ ...reassign, why: e.target.value })} aria-label={L("Reason for reassigning", "Sebab serah semula")} placeholder={L("Why it moves (at least 10 characters)", "Mengapa ia dipindahkan (sekurang-kurangnya 10 aksara)")} />
                    </SubR>
                    <span className={lv.drawerActions}>
                      <button type="button" className={btnClass} onClick={() => void routeAct(d.id, "reassign", undefined, { to_user: reassign.to, comment: reassign.why.trim() }).then(() => setReassign(null))}>{L("Reassign", "Serah semula")}</button>
                      <button type="button" className={rowBtn} onClick={() => setReassign(null)}>{L("Cancel", "Batal")}</button>
                    </span>
                    <p className={lv.sub}>{L("Only people above the applicant on the Organisation chart. The new approver, the old one and the applicant are told.", "Hanya mereka di atas pemohon pada carta Organisasi. Pelulus baharu, lama dan pemohon dimaklumkan.")}</p>
                  </div>
                )}
                {/* v1.83.0 — the amendment form, on the record it amends (CEO). */}
                {editLeave?.id === d.id && (
                  <div className={lv.amend}>
                    <SubR t={L("Type", "Jenis")}>
                      <select className={inputClass} value={editLeave.type}
                        onChange={(e) => setEditLeave({ ...editLeave, type: e.target.value })}>
                        {["annual", "medical", "emergency", "unpaid", "replacement"].map((t) => (
                          <option key={t} value={t}>{leaveTypeL(t)}</option>
                        ))}
                      </select>
                    </SubR>
                    <SubR t={L("Start", "Mula")}>
                      <input type="date" className={inputClass} value={editLeave.start_date}
                        onChange={(e) => setEditLeave({ ...editLeave, start_date: e.target.value })} />
                    </SubR>
                    <SubR t={L("End", "Tamat")}>
                      <input type="date" className={inputClass} value={editLeave.end_date}
                        onChange={(e) => setEditLeave({ ...editLeave, end_date: e.target.value })} />
                    </SubR>
                    <SubR t={L("Days (0.5 = half)", "Hari (0.5 = separuh)")}>
                      <input type="number" min={0.5} step={0.5} className={inputClass}
                        value={editLeave.days}
                        onChange={(e) => setEditLeave({ ...editLeave, days: Number(e.target.value) })} />
                    </SubR>
                    {editLeave.days === 0.5 && (
                      <SubR t={L("Scheduled workday half", "Separuh hari bekerja berjadual")}>
                        <select className={inputClass} value={editLeave.day_part} onChange={e => setEditLeave({ ...editLeave, day_part: e.target.value })}>
                          <option value="">{L("Select half", "Pilih separuh")}</option>
                          <option value="first_half">{L("First half", "Separuh pertama")}</option>
                          <option value="second_half">{L("Second half", "Separuh kedua")}</option>
                        </select>
                      </SubR>
                    )}
                    <SubR t={L("Reason", "Sebab")}>
                      <input className={inputClass} value={editLeave.reason}
                        onChange={(e) => setEditLeave({ ...editLeave, reason: e.target.value })} />
                    </SubR>
                    <span className={lv.drawerActions}>
                      <button type="button" className={rowBtnPrimary} onClick={() => void saveAmend()}>{L("Save", "Simpan")}</button>
                      <button type="button" className={rowBtn} onClick={() => setEditLeave(null)}>{L("Cancel", "Batal")}</button>
                    </span>
                    <p className={lv.sub}>
                      {L("Every change is recorded with who made it and what it replaced, and the staff member is notified. If this month's payroll is already saved, press Recompute nets on the Payroll tab afterwards.",
                         "Setiap perubahan direkodkan dengan siapa yang membuatnya dan apa yang digantikan, dan kakitangan dimaklumkan. Jika gaji bulan ini sudah disimpan, tekan Kira semula bersih pada tab Gaji selepas ini.")}
                    </p>
                  </div>
                )}
                <LeaveDrawerBody key={d.id} l={d} own={own} meName={user.name} onResubmit={(answer, extra) => act(d.id, "resubmit", answer, extra)} />
                <LeaveRelated l={d} onLeave={close} />
              </div>
            )}
          </SideDrawer>
        );
      })()}
    </TabPage>
  );
}
