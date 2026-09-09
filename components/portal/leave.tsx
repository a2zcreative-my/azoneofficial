"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { L, LeaveReq, User, leaveTypeL, withStepUp } from "@/components/portal/page-shared";
import { RestDayCreditCard } from "@/components/portal/rest-day-credits";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DetailGrid, RecordToggle } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowBtnPrimary } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows, SkelTable } from "@/components/ui/skeleton";
import { SubR } from "@/components/ui/sub-label";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { sharePdfFile } from "@/lib/doc-pdf";
import { esc } from "@/lib/escape-html";
import { buildLeavePdf } from "@/lib/form-pdf";
import { dmy, dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { resolveIssuer } from "@/lib/issuers";
import { properName } from "@/lib/names";
import { btnClass, btnGhost, btnSm, card, inputClass, rowHead, td, tdR2, th, thR2 } from "@/lib/ui-styles";
import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
/* v1.124.0 — the paper palette has one owner (lib/doc-theme.ts). This
   document is written into a separate window/iframe that cannot see the
   app stylesheet, so it needs literal hex, not var(--doc-*). */
import { DOC } from "@/lib/doc-theme";
import { usePrompt } from "@/components/ui/prompt-dialog";

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
export const UNPAID_LEAVE_FROM = "01-10-2026";

export const STAGE_LABEL: Record<string, string> = {
  applied: "Awaiting HR review",
  hr_reviewed: "Awaiting pre-approval",
  pre_approved: "Awaiting CEO",
  pending_final: "Awaiting CEO",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
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
};
export const stageL = (s: string) =>
  (getLang() === "ms" ? STAGE_LABEL_MS[s] : STAGE_LABEL[s]) ?? s;

// Which stage a reviewer role can act on (mirrors the Worker's chain).
export function canActOnStage(
  role: string,
  stage: string,
  applicantRole: string
): boolean {
  const HR = ["super_admin", "admin", "hr_admin"];
  const PRE = ["super_admin", "admin", "coo", "cco"];
  const FIN = ["super_admin", "admin", "ceo"];
  if (stage === "applied") return HR.includes(role);
  if (stage === "hr_reviewed")
    return applicantRole === "coo" || applicantRole === "cco"
      ? FIN.includes(role)
      : PRE.includes(role);
  if (stage === "pre_approved" || stage === "pending_final")
    return FIN.includes(role);
  return false;
}

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
  const blob = await buildLeavePdf(l, no);
  await sharePdfFile(blob, `${no}.pdf`, `Leave form ${no}`);
}

export function printLeaveForm(l: LeaveReq, meName: string) {
  /* v1.28.0: the form names the EMPLOYER, so it forever carries the issuer
     stamped on the row — a legacy print stays AZ ONE OFFICIAL with its
     AZOO-HR-LVE document number; an A2Z form is a different controlled
     document with its own number and version (see lib/issuers.ts). */
  const issuer = resolveIssuer(l.issuer_code);
  const w = window.open("", "_blank", "width=900,height=950");
  if (!w) return;
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
  const statusLine =
    stage === "approved"
      ? `APPROVED IN SYSTEM${l.final_by_name ? " by " + l.final_by_name : ""}${l.final_at ? " on " + myt(l.final_at) + " MYT" : ""}`
      : stage === "rejected"
        ? `REJECTED IN SYSTEM${l.final_by_name ? " by " + l.final_by_name : ""}${l.review_comment ? " · Note: " + l.review_comment : ""}`
        : stage === "cancelled"
          ? "CANCELLED BY APPLICANT"
          : `PENDING — ${stage === "applied" ? "awaiting HR review" : stage === "hr_reviewed" ? "HR ✓ — awaiting pre-approval" : "pre-approved — awaiting CEO"}`;
  const chainNotes = [
    l.hr_by_name
      ? `HR reviewed by ${l.hr_by_name}${l.hr_at ? " on " + myt(l.hr_at) + " MYT" : ""}`
      : "",
    l.preapp_by_name
      ? `Pre-approved by ${l.preapp_by_name}${l.preapp_at ? " on " + myt(l.preapp_at) + " MYT" : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
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
    <tr><td class="k">Period</td><td class="v">${dmy(l.start_date)} → ${dmy(l.end_date)}</td><td class="k">Days</td><td class="v">${l.days}</td></tr>
    <tr><td class="k">Reason</td><td class="v" colspan="3">${esc(l.reason ?? "")}</td></tr>
  </table>
  <p class="status">System status: ${statusLine}</p>
  ${chainNotes ? `<p class="chain">${chainNotes}</p>` : ""}
  <table class="sig">
    <tr><th style="width:33%">Employee</th><th style="width:34%">Administrative or<br/>Head of Department (COO / CCO)</th><th style="width:33%">Chief Executive Officer (CEO)</th></tr>
    <tr>
      <td class="body"><div class="cw"><div class="nm">Name: ${esc(applicant)}</div>
        <div class="sg">Signature:${
          empSig
            ? `<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/emp" alt="" onerror="this.style.display='none'"/><span class="esub">(submitted in system)</span>`
            : ` <span class="esig">${esc(l.user_full || l.user_name || meName || "")}</span><span class="esub">(submitted in system)</span>`
        }</div>
        <div class="dt">Date: ${myt(cA)}${cA.length > 10 ? " MYT" : ""}</div></div></td>
      <td class="body"><div class="cw">${
        l.preapp_by_full || l.preapp_by_name
          ? `<div class="nm">Name: ${esc((l.preapp_by_full || l.preapp_by_name || "").toUpperCase())}</div>
           <div class="sg">Signature:<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/pre" alt="" onerror="this.style.display='none'"/></div>
           <div class="dt">Date: ${l.preapp_at ? myt(l.preapp_at) + " MYT" : ""}</div>`
          : `<div class="nm">Name:</div><div class="sg">Signature:</div><div class="dt">Date:</div>`
      }</div></td>
      <td class="body"><div class="cw"><div class="nm">Name: ${esc(stage === "approved" ? (l.final_by_full || l.final_by_name || "").toUpperCase() : "")}</div>
        <div class="sg">Signature:${stage === "approved" ? `<img class="sigimg" src="/api/v1/staff/leave/${l.id}/signature/ceo" alt="" onerror="this.style.display='none'"/>` : ""}</div>
        <div class="dt">Date: ${stage === "approved" && l.final_at ? myt(l.final_at) + " MYT" : ""}</div></div></td>
    </tr>
  </table>
  <p class="foot">${issuer.name} · ${issuer.registration} · ${issuer.address.replace(/, Malaysia$/, "")} · This form accompanies the system record ${esc(lvNo)}; the in-system decision is authoritative.</p>
  <script>window.onload = function () { window.print(); };</script>
  </body></html>`);
  w.document.close();
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
export function LeaveDetail({ l, meName }: { l: LeaveReq; meName: string }) {
  const whoAt = (name?: string | null, full?: string | null, at?: string | null) =>
    name || full ? `${properName(full || name || "")}${at ? ` · ${dmyMYT(at)}` : ""}` : "";
  return (
    <div className="mt-1">
      <DetailGrid
        items={[
          {
            label: L("Applicant", "Pemohon"),
            wide: true,
            value: [properName(l.user_full || l.user_name || ""), l.user_position, l.user_department].filter(Boolean).join(" · "),
          },
          { label: L("Leave no.", "No. cuti"), value: leaveNoOf(l) },
          { label: L("Type", "Jenis"), value: leaveTypeL(l.type) },
          { label: L("Period", "Tempoh"), value: `${dmy(l.start_date)}${l.end_date !== l.start_date ? ` → ${dmy(l.end_date)}` : ""}` },
          { label: L("Days", "Hari"), value: `${l.days}` },
          { label: L("Applied", "Dimohon"), value: dmyMYT(l.created_at) },
          { label: L("Status", "Status"), value: stageL(l.stage ?? l.status) },
          { label: L("Reason", "Sebab"), wide: true, value: l.reason ?? "" },
          { label: L("HR reviewed", "Disemak HR"), wide: true, value: whoAt(l.hr_by_name, null, l.hr_at) },
          { label: L("Pre-approved", "Pra-lulus"), wide: true, value: whoAt(l.preapp_by_name, l.preapp_by_full, l.preapp_at) },
          { label: L("Final", "Akhir"), wide: true, value: whoAt(l.final_by_name, l.final_by_full, l.final_at) },
          { label: L("Reviewer note", "Catatan penyemak"), wide: true, value: l.review_comment ?? "" },
        ]}
      />
      <div className="mt-1.5">
        <button type="button" className={rowBtn}
          title={L("Print the Leave Application Form", "Cetak Borang Permohonan Cuti")}
          onClick={() => printLeaveForm(l, meName)}>
          {L("Print form", "Cetak borang")}
        </button>
      </div>
    </div>
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
  const st = l.stage ?? "";
  if (st === "applied") return "HR";
  if (st === "hr_reviewed")
    return ["coo", "cco"].includes(l.applicant_role ?? "") ? "CEO" : "COO / CCO";
  return "CEO";
}

export function Leave({ user }: { user: User }) {
  const [openLeave, setOpenLeave] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    type: "annual",
    start_date: "",
    end_date: "",
    days: 1,
    reason: "",
  });
  const canApprove = [
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
  /* v1.92.0 — which management area is open below the personal half. */
  const [mgmt, setMgmt] = useState<"" | "company" | "entitlement">("company");
  /* v1.91.0 — which company-board row is open. */
  const [openAll, setOpenAll] = useState<number | null>(null);
  const [editLeave, setEditLeave] = useState<{
    id: number; type: string; start_date: string; end_date: string; days: number; reason: string;
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
  const allView = useCachedApi<{ leave: LeaveReq[] }>("/staff/leave?all=1", canApprove, ["leave"]);
  const balances = useMemo(() => balanceView.data?.balances ?? {}, [balanceView.data]);
  /* v1.93.0 — a part-time host: no entitlement, no form; one line says why. */
  const hourly = Boolean(balanceView.data?.hourly);
  const mine = useMemo(() => mineView.data?.leave ?? [], [mineView.data]);
  const all = useMemo(() => allView.data?.leave ?? [], [allView.data]);
  const loaded = !balanceView.loading && !mineView.loading && (!canApprove || !allView.loading);
  const refreshBalance = balanceView.refresh, refreshMine = mineView.refresh, refreshAll = allView.refresh;
  const load = useCallback(async () => { refreshBalance(); refreshMine(); if (canApprove) refreshAll(); }, [refreshBalance, refreshMine, refreshAll, canApprove]);

  /* v1.90.2 — CEO, 04-09-2026: *"One of my staff unable to update their
     leave application, please check any bug?"* Her screenshot: start date
     filled, END DATE EMPTY, days 1, Submit pressed - and nothing. This
     function used to `return` in silence whenever the end date was blank,
     so a one-day leave, the commonest kind, needed a second date typed
     that nobody said was required. Three changes: a blank end date means
     the same day; a bad request is SAID, not swallowed; the server's answer
     is reported either way (guard #25 - every mutation reports). */
  const apply = async () => {
    const start = draft.start_date;
    const end = draft.end_date || draft.start_date;
    if (!start) {
      showLeaveToast(L("Not sent", "Tidak dihantar"), L("Pick the first day of the leave", "Pilih hari pertama cuti"), "notice");
      return;
    }
    if (end < start) {
      showLeaveToast(L("Not sent", "Tidak dihantar"), L("The end date is before the start date", "Tarikh tamat lebih awal daripada tarikh mula"), "notice");
      return;
    }
    if (!(draft.days > 0)) {
      showLeaveToast(L("Not sent", "Tidak dihantar"), L("Days must be at least 0.5", "Hari mestilah sekurang-kurangnya 0.5"), "notice");
      return;
    }
    const res = await api<{ id?: number; error?: { message?: string } }>(`/staff/leave`, {
      method: "POST",
      body: JSON.stringify({ ...draft, start_date: start, end_date: end }),
    });
    if (!res.ok) {
      showLeaveToast(L("Not sent", "Tidak dihantar"),
        res.data?.error?.message ?? L("The server refused the request", "Pelayan menolak permohonan"), "notice");
      return;
    }
    /* v1.105.0 - kept on the phone (lib/outbox.ts); sent when the signal is
       back. Not "requested" yet, and the toast must not say it is. */
    showLeaveToast(
      res.queued ? L("Kept — no signal", "Disimpan — tiada isyarat") : L("Leave requested", "Cuti dimohon"),
      res.queued
        ? L("Saved on this phone. It will be sent to HR the moment you are back online.", "Disimpan pada telefon ini. Ia akan dihantar kepada HR sebaik sahaja anda kembali dalam talian.")
        : `${leaveTypeL(draft.type)} · ${draft.days} ${L("day(s)", "hari")} · ${dmy(start)}${end !== start ? ` – ${dmy(end)}` : ""} · ${L("waiting for HR", "menunggu HR")}`,
      res.queued ? "notice" : "success",
    );
    setDraft({
      type: "annual",
      start_date: "",
      end_date: "",
      days: 1,
      reason: "",
    });
    void load();
  };
  const act = async (id: number, action: string, comment = "") => {
    /* v1.77.0 — approving or rejecting somebody's leave used to report
       nothing at all: the row simply moved. A decision about a person's time
       off should say what it did. */
    /* v1.127.0: the last approval in the chain signs the form, so the server
       asks for a live code. withStepUp sends the decision, and only when the
       server says a code is needed does it ask for one and send again. */
    const res = await withStepUp<{ stage?: string; error?: { message?: string } }>(
      (totp) => api(`/staff/leave/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, comment, ...(totp ? { totp } : {}) }),
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
      : res.data?.stage === "approved" ? L("Approved", "Diluluskan") : L("Passed on", "Dihantar ke peringkat seterusnya"),
      action === "cancel"
        ? L("Your application has been withdrawn.", "Permohonan anda telah ditarik balik.")
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
        days: editLeave.days, reason: editLeave.reason,
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
    void load();
  };
  /* v1.72.0 (CEO: "I want to have a function for me to approved the leave
     form of all the staff which is can by pass their HOD") — the chain is
     untouched; this is the way past a stage whose approver is away. The
     server refuses `override` from anyone but the CEO, and refuses it on
     your own application, so this button cannot do anything a hand-made
     request could not. The stages skipped stay visibly unsigned on the
     printed form — that is the record. */
  const canOverride = ["ceo", "super_admin"].includes(user.role);
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
    /* The CEO override is a final approval by definition — it goes straight
       to approved with his chop on it, so it always meets the step-up. */
    const res = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api(`/staff/leave/${l.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, override: true, ...(totp ? { totp } : {}) }),
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
  const canSetEntitlement = ["ceo", "super_admin"].includes(user.role);
  /* the badge on the chooser: how many applications are still in progress */
  const mgmtPending = all.filter((l) => !["approved", "rejected", "cancelled"].includes(l.stage ?? l.status)).length;

  return (
    <div className="space-y-4 md:space-y-6">
      {overrideConfirmNode}
      {stepUpNode}
      {removeLeaveNode}
      {leaveToastNode}
      {/* v1.77.0 — skeleton until the first fetch lands: one tile per leave
          type in the same grid, so the row is the same height either way. */}
      {!loaded && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-hidden>
          {LEAVE_TYPES.map((t) => (
            <div key={t} className={card}>
              <Skel className="h-3 w-20" />
              <Skel className="mt-2 h-6 w-24" />
              <Skel className="mt-1.5 h-2.5 w-28 max-w-full" />
            </div>
          ))}
        </div>
      )}
      {loaded && hourly && (
        <div className={card}>
          <p className="text-sm font-semibold">{L("Leave", "Cuti")}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {L("You are a part-time host, paid by the hour, so there is no annual, medical or emergency leave entitlement and nothing to apply for here. Days you do not work are simply not billed.",
               "Anda hos sambilan yang dibayar mengikut jam, jadi tiada kelayakan cuti tahunan, perubatan atau kecemasan dan tiada apa yang perlu dimohon di sini. Hari yang anda tidak bekerja tidak dibilkan.")}
          </p>
        </div>
      )}
      {loaded && !hourly && (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {LEAVE_TYPES.map((t) => {
          const b = balances[t] ?? { entitled: 0, used: 0, accrued: 0 };
          // Eligible now = what has accrued this year minus what's been used.
          const availableNow = Math.max(0, (b.accrued ?? b.entitled) - b.used);
          /* v1.146.0 — a tile for a type with no ceiling cannot show what is
             left of it. "0 eligible now" would read as "you may not take
             any", which is the opposite of the rule: take what you need, and
             each day costs a day's pay. So it says the cost and the count. */
          const costsPay = UNPAID_LEAVE_TYPES.includes(t);
          return (
            <div key={t} className={card}>
              <p className="text-xs font-medium tracking-wide uppercase">
                {leaveTypeL(t)}
              </p>
              {costsPay ? (
                <>
                  <p className="text-warning mt-1 text-lg font-semibold">
                    {L("Unpaid", "Tanpa gaji")}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {L(`No limit · ${b.used} taken this year`,
                       `Tiada had · ${b.used} diambil tahun ini`)}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-lg font-semibold">
                    {availableNow}
                    <span className="text-muted-foreground text-xs font-normal">
                      {" "}
                      {L("eligible now", "layak sekarang")}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {L(
                      `${b.entitled}/year · ${b.used} used`,
                      `${b.entitled}/tahun · ${b.used} digunakan`
                    )}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
      )}

      {!hourly && (
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">
            {L("Apply for leave", "Mohon cuti")}
          </p>
          <div className="mt-3 space-y-3">
            <Sub t={L("Leave type", "Jenis cuti")}>
              <select
                className={inputClass}
                value={draft.type}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, type: e.target.value }))
                }
              >
                {/* v1.146.0 — the cost is named where the choice is made.
                    Somebody applying for emergency leave believing it is paid
                    finds out on their payslip, which is the worst place to
                    find out anything. */}
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {leaveTypeL(t)}
                    {UNPAID_LEAVE_TYPES.includes(t) ? L(" — unpaid", " — tanpa gaji") : ""}
                  </option>
                ))}
              </select>
            </Sub>
            <div className="grid grid-cols-2 gap-3">
              <Sub t={L("Start date", "Tarikh mula")}>
                <input
                  type="date"
                  className={inputClass}
                  value={draft.start_date}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      start_date: e.target.value,
                      /* a one-day leave is the common case: the end follows
                         the start until somebody moves it later */
                      end_date: !d.end_date || d.end_date < e.target.value ? e.target.value : d.end_date,
                    }))
                  }
                />
              </Sub>
              <Sub t={L("End date", "Tarikh tamat")}>
                <input
                  type="date"
                  className={inputClass}
                  value={draft.end_date}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, end_date: e.target.value }))
                  }
                />
              </Sub>
            </div>
            <Sub t={L("Days (0.5 = half day)", "Hari (0.5 = separuh hari)")}>
              <input
                type="number"
                min={0.5}
                step={0.5}
                className={inputClass}
                value={draft.days}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, days: Number(e.target.value) }))
                }
              />
            </Sub>
            <Sub t={L("Reason (optional)", "Sebab (pilihan)")}>
              <textarea
                className={inputClass}
                rows={2}
                placeholder={L(
                  "e.g. Family matters in Melaka",
                  "cth. Urusan keluarga di Melaka"
                )}
                value={draft.reason}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, reason: e.target.value }))
                }
              />
            </Sub>
            <button
              type="button"
              className={btnClass}
              onClick={() => void apply()}
            >
              {L("Submit request", "Hantar permohonan")}
            </button>
          </div>
        </div>

        <div className={card}>
          <p className="text-sm font-semibold">
            {L("My leave history", "Sejarah cuti saya")}
          </p>
          {/* v1.77.0 — skeleton until the first fetch lands. */}
          {!loaded && <SkelRows rows={4} className="max-h-72" />}
          {loaded && mine.length === 0 && (
            <p className="text-muted-foreground mt-2 text-sm">
              {L("No requests yet.", "Tiada permohonan lagi.")}
            </p>
          )}
          <div className="max-h-72 overflow-y-auto">
            {loaded && mine.map((l) => (
              <div
                key={l.id}
                className="border-border border-b py-2 text-sm last:border-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    {/* v1.4.249: the leave number opens the record; type, period,
                    reason and the reviewer's comment moved into the panel. */}
                    <RecordToggle
                      open={openLeave === l.id}
                      title={L(
                        "Type, period, reason and comments",
                        "Jenis, tempoh, sebab dan komen"
                      )}
                      onToggle={() =>
                        setOpenLeave(openLeave === l.id ? null : l.id)
                      }
                    >
                      {leaveNoOf(l)}
                    </RecordToggle>
                    {" · "}
                    {l.days}d ·{" "}
                    <span className="font-medium">
                      {stageL((l as LeaveReq).stage ?? l.status)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      className={rowBtn}
                      title={L(
                        "Print the Leave Application Form",
                        "Cetak Borang Permohonan Cuti"
                      )}
                      onClick={() => printLeaveForm(l, user.name)}
                    >
                      {L("Print form", "Cetak borang")}
                    </button>
                    {/* v1.4.246: the same form as a real PDF file, into the share sheet. */}
                    <button
                      type="button"
                      className={rowBtn}
                      title={L(
                        "Send the leave form as a PDF file",
                        "Hantar borang cuti sebagai fail PDF"
                      )}
                      onClick={() => void sendLeavePdf(l)}
                    >
                      {L("Send PDF", "Hantar PDF")}
                    </button>
                    {!["approved", "rejected", "cancelled"].includes(
                      (l as LeaveReq).stage ?? ""
                    ) && (
                      <button
                        type="button"
                        className={rowBtnDanger}
                        onClick={() => void act(l.id, "cancel")}
                      >
                        {L("Cancel", "Batal")}
                      </button>
                    )}
                  </span>
                </div>
                {openLeave === l.id && (
                  <DetailGrid
                    items={[
                      { label: L("Type", "Jenis"), value: leaveTypeL(l.type) },
                      {
                        label: L("Period", "Tempoh"),
                        value: `${dmy(l.start_date)} → ${dmy(l.end_date)}`,
                      },
                      { label: L("Days", "Hari"), value: `${l.days}` },
                      {
                        label: L("Reason", "Sebab"),
                        wide: true,
                        value: l.reason ?? "",
                      },
                      {
                        label: L("Reviewer note", "Catatan penyemak"),
                        wide: true,
                        value: l.review_comment ?? "",
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* v1.86.0 (CEO: "leave to review should inside the leave") — rest-day
          work waiting to become replacement leave. It is the one half of the
          old "Leave to review" card that is NOT a leave record: the other
          half listed unpaid days the register below already carries, which is
          what made the two cards look like the same function. CEO-only, and
          it renders nothing for anyone else. */}
      <RestDayCreditCard role={user.role} />

      {/* v1.92.0 — CEO, 04-09-2026: *"Leave entitlement and Leave — whole
          company should be in the minimalist interface and below of the
          table mine eligible leave and Apply for leave."* The entitlement
          editor used to sit ABOVE the CEO's own balances and form — a table
          for the whole company before the four boxes he came to use. Both
          management areas now sit below, behind one chooser, one open at a
          time: the board first, because it is the one with things waiting. */}
      {(canApprove || canSetEntitlement) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {canApprove && (
            <button type="button" aria-pressed={mgmt === "company"}
              className={mgmt === "company"
                ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium"
                : "border-border text-muted-foreground hover:bg-secondary/70 rounded-full border px-3 py-1 text-xs"}
              onClick={() => setMgmt(mgmt === "company" ? "" : "company")}>
              {L("Leave — whole company", "Cuti — seluruh syarikat")}
              {mgmtPending > 0 && <span className="bg-bear ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white">{mgmtPending}</span>}
            </button>
          )}
          {canSetEntitlement && (
            <button type="button" aria-pressed={mgmt === "entitlement"}
              className={mgmt === "entitlement"
                ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium"
                : "border-border text-muted-foreground hover:bg-secondary/70 rounded-full border px-3 py-1 text-xs"}
              onClick={() => setMgmt(mgmt === "entitlement" ? "" : "entitlement")}>
              {L("Leave entitlement", "Kelayakan cuti")}
            </button>
          )}
        </div>
      )}
      {canSetEntitlement && mgmt === "entitlement" && <LeaveEntitlement />}

      {canApprove && mgmt === "company" &&
        (() => {
          /* v1.21.0 — the whole approval chain sees the whole board. */
          const TERMINAL = ["approved", "rejected", "cancelled"];
          const pending = all.filter(
            (l) => !TERMINAL.includes(l.stage ?? l.status)
          );
          /* v1.83.0 — the WHOLE history, filtered by month, not the last
             five. A month filter is the only one that matters here: a leave
             question is nearly always "what happened in August", and it is
             the same month the payslip is being checked against. Matched by
             OVERLAP, so a leave running from the 29th into the next month
             appears under both — it was taken in both. */
          const decidedAll = all.filter((l) => TERMINAL.includes(l.stage ?? l.status));
          const decided = leaveMonth
            ? decidedAll.filter((l) => l.start_date <= `${leaveMonth}-31` && l.end_date >= `${leaveMonth}-01`)
            : decidedAll.slice(0, 8);
          const waitingOn = waitingOnLabel;
          const who = (l: LeaveReq) =>
            properName(l.user_full || l.user_name || "");
          return (
            <div className={card}>
              <p className="text-sm font-semibold">
                {L(
                  "Leave — whole company",
                  "Cuti — seluruh syarikat"
                )}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {L(
                  "Everything in progress and whose approval it waits on, then every decided record — including unpaid days recorded from Attendance. Action buttons appear on the ones waiting on you.",
                  "Semua yang sedang diproses dan kelulusan siapa yang ditunggu, kemudian setiap rekod yang diputuskan — termasuk hari tanpa gaji yang direkodkan dari Kehadiran. Butang tindakan muncul pada yang menunggu anda."
                )}
              </p>
              {/* v1.77.0 — skeleton until the first fetch lands. */}
              {!loaded && <SkelRows rows={4} className="max-h-80" />}
              {loaded && pending.length === 0 && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {L("Nothing in progress.", "Tiada yang sedang diproses.")}
                </p>
              )}
              <div className="max-h-80 overflow-y-auto">
                {loaded && pending.map((l) => {
                  const mine =
                    canActOnStage(
                      user.role,
                      l.stage ?? "",
                      l.applicant_role ?? ""
                    ) && l.user_id !== user.id;
                  return (
                    <div key={l.id} className="border-border border-b py-2 text-sm last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <button type="button" className="font-medium underline decoration-dotted underline-offset-2"
                          aria-expanded={openAll === l.id}
                          title={L("Open the application", "Buka permohonan")}
                          onClick={() => setOpenAll(openAll === l.id ? null : l.id)}>
                          {who(l)}
                        </button> ·{" "}
                        {leaveTypeL(l.type)} · {dmy(l.start_date)} →{" "}
                        {dmy(l.end_date)} ({l.days}d)
                        <span
                          className={`ml-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${mine ? "bg-warning-soft text-warning" : "bg-secondary text-muted-foreground"}`}
                        >
                          {L("waiting on", "menunggu")} {waitingOn(l)}
                        </span>
                      </span>
                      {!mine && canOverride && l.user_id !== user.id && (
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            className={btnGhost}
                            title={L(
                              "Approve without waiting for the stages before you",
                              "Luluskan tanpa menunggu peringkat sebelum anda"
                            )}
                            onClick={() => void overrideAct(l, "approve")}
                          >
                            {L("Approve now", "Luluskan terus")}
                          </button>
                          <button
                            type="button"
                            className="text-destructive text-sm underline"
                            onClick={() => void overrideAct(l, "reject")}
                          >
                            {L("Reject", "Tolak")}
                          </button>
                        </span>
                      )}
                      {mine && (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => void act(l.id, "approve")}
                          >
                            {l.stage === "applied"
                              ? L("Mark reviewed", "Tanda disemak")
                              : l.stage === "hr_reviewed"
                                ? L("Pre-approve", "Pra-lulus")
                                : L("Final approve", "Kelulusan akhir")}
                          </button>
                          <button
                            type="button"
                            className="text-destructive text-sm underline"
                            onClick={() => void act(l.id, "reject")}
                          >
                            {L("Reject", "Tolak")}
                          </button>
                        </span>
                      )}
                    </div>
                    {openAll === l.id && <LeaveDetail l={l} meName={user.name} />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                    {leaveMonth ? L("Decided this month", "Diputuskan bulan ini") : L("Recently decided", "Keputusan terkini")}
                  </p>
                  <span className="flex items-center gap-2">
                    <input
                      type="month"
                      className="border-input bg-background h-8 rounded-lg border px-2 text-xs"
                      value={leaveMonth}
                      aria-label={L("Filter by month", "Tapis ikut bulan")}
                      title={L("Show every leave taken in this month. A leave spanning two months appears under both.", "Tunjuk setiap cuti yang diambil dalam bulan ini. Cuti merentasi dua bulan muncul pada kedua-duanya.")}
                      onChange={(e) => setLeaveMonth(e.target.value)}
                    />
                    {leaveMonth && (
                      <button type="button" className="text-muted-foreground text-xs underline"
                        onClick={() => setLeaveMonth("")}>
                        {L("Clear", "Kosongkan")}
                      </button>
                    )}
                  </span>
                </div>
                {decided.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {leaveMonth
                      ? L("No leave decided in that month.", "Tiada cuti diputuskan pada bulan itu.")
                      : L("Nothing decided yet.", "Tiada keputusan lagi.")}
                  </p>
                ) : (
                  <div className="border-border divide-border mt-2 divide-y rounded-lg border">
                    {decided.map((l) => (
                      <div key={l.id} className="px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <p className="min-w-0 text-xs">
                            <button type="button" className="font-medium underline decoration-dotted underline-offset-2"
                              aria-expanded={openAll === l.id}
                              title={L("Open the application", "Buka permohonan")}
                              onClick={() => setOpenAll(openAll === l.id ? null : l.id)}>
                              {who(l)}
                            </button>
                            <span className="text-muted-foreground">
                              {" · "}<span className={l.type === "unpaid" ? "text-danger font-medium" : ""}>{leaveTypeL(l.type)}</span>
                              {" · "}{dmy(l.start_date)}{l.end_date !== l.start_date ? ` → ${dmy(l.end_date)}` : ""}
                              {" · "}{l.days === 1 ? L("1 day", "1 hari") : l.days === 0.5 ? L("half day", "setengah hari") : `${l.days} ${L("days", "hari")}`}
                              {" · "}{stageL(l.stage ?? l.status)}
                            </span>
                          </p>
                          {canAmend && (
                            <span className="flex shrink-0 items-center gap-2">
                              <button type="button" className={rowBtn}
                                title={L("Correct the type, the dates or the number of days", "Betulkan jenis, tarikh atau bilangan hari")}
                                onClick={() => setEditLeave(editLeave?.id === l.id ? null : {
                                  id: l.id, type: l.type, start_date: l.start_date,
                                  end_date: l.end_date, days: l.days, reason: l.reason ?? "",
                                })}>
                                {editLeave?.id === l.id ? L("Close", "Tutup") : L("Edit", "Sunting")}
                              </button>
                              <button type="button" className={rowBtnDanger}
                                onClick={() => void removeLeave(l)}>
                                {L("Remove", "Buang")}
                              </button>
                            </span>
                          )}
                        </div>
                        {l.reason && editLeave?.id !== l.id && openAll !== l.id && (
                          <p className="text-muted-foreground mt-0.5 text-[11px]">{l.reason}</p>
                        )}
                        {openAll === l.id && editLeave?.id !== l.id && <LeaveDetail l={l} meName={user.name} />}
                        {/* v1.83.0 — the amendment form, on the row it amends.
                            A modal would hide the record being changed at the
                            moment it matters most. */}
                        {editLeave?.id === l.id && (
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
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
                            <SubR t={L("Reason", "Sebab")} className="sm:col-span-3">
                              <input className={inputClass} value={editLeave.reason}
                                onChange={(e) => setEditLeave({ ...editLeave, reason: e.target.value })} />
                            </SubR>
                            <div className="flex items-end gap-2">
                              <button type="button" className={rowBtnPrimary} onClick={() => void saveAmend()}>
                                {L("Save", "Simpan")}
                              </button>
                              <button type="button" className={rowBtn} onClick={() => setEditLeave(null)}>
                                {L("Cancel", "Batal")}
                              </button>
                            </div>
                            <p className="text-muted-foreground text-[11px] sm:col-span-4">
                              {L("Every change is recorded with who made it and what it replaced, and the staff member is notified. If this month's payroll is already saved, press Recompute nets on the Payroll tab afterwards.",
                                 "Setiap perubahan direkodkan dengan siapa yang membuatnya dan apa yang digantikan, dan kakitangan dimaklumkan. Jika gaji bulan ini sudah disimpan, tekan Kira semula bersih pada tab Gaji selepas ini.")}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
