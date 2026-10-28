"use client";
import { openPrintPreview } from "@/components/ui/document-preview";

/**
 * Payroll processing (v1.4.36).
 *
 * Month picker → every staff member with Basic / Commission / Allowance /
 * Deduction amounts (RM). Save upserts one entry per person per month;
 * Payslip prints a branded A4 payslip under the EMPLOYER stamped on the
 * month's release row (v1.28.0, lib/issuers.ts): legacy months stay
 * AZ ONE OFFICIAL, months released after the switch carry A2Z CREATIVE
 * MARKETING. Processed by the CEO or hr_admin (hr_manage); COO/CCO see it
 * read-only via exec view.
 */

import { makeApi, csrfFetch } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
import { bySeniority } from "@/lib/staff-order"; // v1.78.0 - one company order, shared with the Staff tab
const api = makeApi("/staff");
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { esc } from "@/lib/escape-html";
import { displayName } from "@/lib/names";
import { useSaveToast } from "@/components/ui/save-toast";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { buildPayslipPdf, type PayslipData } from "@/lib/payslip-pdf";
import { sharePdfFile } from "@/lib/doc-pdf";
/* v1.28.0 — the payslip's employer of record is decided at RELEASE time and
   stored on payslip_releases.issuer_code; the letterhead resolves it here. */
import { resolveIssuer } from "@/lib/issuers";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { incompleteCents } from "@/lib/payroll-days";
import { btnSm, btnSmPrimary, card, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClassSm } from "@/lib/ui-styles";
import { rowBtn, rowBtnPrimary, rowActions } from "@/components/ui/row-button";
/* v1.198.0 - the five-tab page */
import { LineTabs } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Avatar } from "@/components/ui/avatar";
import { SideDrawer } from "@/components/ui/side-drawer";
import { monthName } from "@/components/portal/leave-overview";
import { usePayrollHistory } from "@/components/portal/payroll-history"; // v1.207.0
import { Donut } from "@/components/ui/donut";
import pp from "./payroll-page.module.css";
import { getLang } from "@/lib/i18n";
import { Skel, SkelRows } from "@/components/ui/skeleton"; // v1.77.0 — skeletons until the first fetch lands

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const API = "/api/v1/staff";


/* v1.172.1 - the V3 dense control, at this table's width. */
const inputSm = `${inputClassSm} w-24`;

/* v1.28.0: the old _COMPANY constant is gone — company identity lives in
   lib/issuers.ts only, resolved per payslip from the release row's issuer. */

interface StaffRow {
  id: number;
  name: string;
  full_name?: string | null;
  left_on?: string | null;      // v1.4.101: resignation/termination effective date
  rejoined_on?: string | null;  // v1.4.101: payroll resumes from this month
  ic_number?: string | null;
  role: string;
  employee_id?: string | null;
  position?: string | null;
  department?: string | null;
  employment_status?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  joined_on?: string | null;
  photo_key?: string | null; // v1.198.0 - the row's avatar
}

interface Entry {
  user_id: number;
  basic_cents: number;
  commission_cents: number;
  allowance_cents: number;
  deduction_cents: number;
  worked_days?: number | null;
  month_working_days?: number | null;
  ot_hours?: number | null;
  ot_cents?: number;
  note?: string | null;
  // v1.4.183 — hourly (part-time live host) figures; *_live come freshly
  // computed from attendance on every GET, the plain ones are what's stored.
  hourly_minutes?: number | null;
  hourly_rate_cents?: number | null;
  hourly_minutes_live?: number;
  hourly_rate_live?: number;
  hourly_pay_live?: number;
  /* v1.80.0 — what the clock said before the split-shift gap came off, and
     how many minutes that was. Shown beside the figure: a wage that goes DOWN
     because of a code change must say so on the row, not in a changelog. */
  hourly_clocked_live?: number;
  /* v1.109.0 - the unpaid break deducted this month (one hour per day that
     ran past five hours), and the days it was deducted across. Replaces
     hourly_trimmed_live: a part-timer is no longer trimmed to a pattern. */
  hourly_break_live?: number;
  hourly_days_live?: number;
}

/* v1.4.183 (CEO): a PART-TIME LIVE HOST is paid RM15.00/hour on clocked
   time — no salary proration, no unpaid-leave maths, no OT. One predicate
   used by the table, the net formula and the payslip. */
function isHourly(u: { role: string; employment_status?: string | null }): boolean {
  return u.role === "live_host" && u.employment_status === "part_time";
}
function hmLabel(mins: number): string {
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** v1.4.85: overtime at the Employment Act normal-working-day rate —
    hourly ORP = monthly wage ÷ 26 ÷ 8; OT pay = 1.5 × hourly × hours.
    (Rest-day 2.0× and public-holiday 3.0× OT can be added when needed —
    say the word.) One formula, used by table, slip and self-view. */
/** v1.4.89: the payroll CYCLE month. A month's payroll is processed and paid
    up to the 5th of the following month — so until the 5th (MYT), the month
    the business is still working on is the PREVIOUS one. From the 5th, the
    cycle closes and the present month takes over. Both the processing panel
    and My payslip open on this month by default. */
function payrollCycleMonth(): string {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  if (now.getUTCDate() < 5) now.setUTCMonth(now.getUTCMonth() - 1);
  return now.toISOString().slice(0, 7);
}

function otPay(basicCents: number, hours: number | null | undefined): number {
  if (!hours || hours <= 0) return 0;
  return Math.round((basicCents / 26 / 8) * 1.5 * hours);
}

/* v1.75.0 — the arithmetic moved to lib/payroll-days.ts so a test can run it
   with real numbers instead of a regex reading its source. Re-exported here
   under the old name so every call site in this file reads the same. */
function incompleteMonthAdj(basicCents: number, payableDays: number | null | undefined, workingDays: number | null | undefined): number {
  return incompleteCents(basicCents, workingDays, payableDays);
}

// v1.4.272: the local formatter became an alias of the global — payroll's
// numbers must print identically to every other tab's.
import { fmtRM, rm as rmBare, dmy, dmyMYT } from "@/lib/format";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
const rm = fmtRM;

/** "YYYY-MM" → "MM-YYYY" for display. */
function monthDMY(m: string): string {
  const p = m.split("-");
  return p.length === 2 ? `${p[1]}-${p[0]}` : m;
}

/** Branded A4 payslip print — shared by the processing panel and every
    staff member's read-only "My payslip" card. */
/* v1.4.257: the slip's FIGURES, computed once and used by both the printed
   slip and the PDF. Payroll is the one place where two implementations
   drifting apart is not a cosmetic bug — it is two different answers to
   "what was I paid". So the layout may exist twice; the arithmetic does not. */
export type SlipExtras = { working_day: number; public_holiday: number; annual_leave: number; medical_leave: number; emergency_leave?: number; unpaid_leave?: number; unpaid_deduction_cents?: number; annual_bal: number; sick_bal: number;
  /* v1.148.0 — emergency_leave above is now ONLY the days that were paid
     (started before 01-09-2026). These two say the rest: the emergency days
     that were charged for, and the days from a plain unpaid request. Both
     are already inside unpaid_leave, which is the number the deduction was
     computed from — they exist so the slip can name WHY the unpaid line is
     not zero, never to be added to it. */
  emergency_unpaid?: number; unpaid_type_leave?: number;
  /* v1.75.0 — the employment-date figures. The server computes the
     incomplete-month deduction once and the slip prints THAT number. */
  month_working_days?: number; payable_days?: number; incomplete_deduction_cents?: number;
  /* v1.181.8 - what the two deductions were measured in. From September
     2026 both are calendar days of the month (Employment Act s.18A). */
  proration_basis?: "calendar" | "working"; proration_month_days?: number; proration_days?: number; unpaid_divisor?: number;
  /* v1.77.0 — what the unpaid deduction is MADE of, so the slip can say it:
     the rest days lost to fully-unpaid weeks, and whether the cap that keeps
     public holidays paid actually bit. */
  unpaid_rest_days?: number; unpaid_capped?: boolean; clocked_beyond_employment?: boolean;
  /* v1.77.0 — the public-holiday premium, from the server. */
  ph_worked?: number; ph_worked_dates?: string[]; ph_worked_minutes?: number; ph_worked_cents?: number;
  salary_advance_cents?: number;
  /* v1.181.4 - the advance requests that make up salary_advance_cents */
  salary_advance_items?: { claim_no: string; requested_on: string; paid_on: string; amount_cents: number }[];
  joined_on?: string | null; left_on?: string | null } | null;

/* v1.28.0: issuerCode is the month's payslip_releases.issuer_code — NULL or
   absent (legacy / not yet stamped) renders AZ ONE OFFICIAL, 'a2z' renders
   A2Z CREATIVE MARKETING (resolveIssuer, lib/issuers.ts). It rides on the
   returned PayslipData so the PDF twin draws the same employer. */
export function payslipData(
  u: StaffRow & { employment_status?: string | null },
  e: Entry,
  month: string,
  x?: SlipExtras,
  issuerCode?: string | null,
): PayslipData & { issuer_code: string | null } {
  const hourlySlip = isHourly(u) || (e.hourly_minutes != null && e.hourly_rate_cents != null);
  const otCents = hourlySlip ? 0 : (e.ot_cents ?? otPay(e.basic_cents, e.ot_hours));
  /* v1.77.0 — the premium for working a public holiday. The server computes
     it; the slip prints it and names the days. */
  const phCents = x?.ph_worked_cents ?? 0;
  const gross = e.basic_cents + phCents + e.commission_cents + e.allowance_cents + otCents;
  const unpaidDed = hourlySlip ? 0 : (x?.unpaid_deduction_cents ?? 0);
  const incompAdj = hourlySlip ? 0 : (x?.incomplete_deduction_cents ?? 0);
  const salaryAdvance = x?.salary_advance_cents ?? 0;
  const totalDed = e.deduction_cents + unpaidDed + incompAdj + salaryAdvance;
  const n2v = (v: number) => rmBare(Math.round(v * 100)); // v1.4.272: routed through the global
  const hrs = e.hourly_minutes != null ? `${Math.floor(e.hourly_minutes / 60)}H ${String(e.hourly_minutes % 60).padStart(2, "0")}M` : "";

  const earnings: [string, number][] = hourlySlip
    ? [[`HOURLY PAY (${hrs} × ${fmtRM(e.hourly_rate_cents ?? 1500)}/HOUR)`, e.basic_cents]]
    : [["BASIC PAY", e.basic_cents]];
  if (phCents > 0) {
    const n = x?.ph_worked ?? 0;
    const when = (x?.ph_worked_dates ?? []).map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)).join(", ");
    earnings.push([
      hourlySlip
        ? `PUBLIC HOLIDAY WORKED (${when} — ${Math.floor((x?.ph_worked_minutes ?? 0) / 60)}H ${String((x?.ph_worked_minutes ?? 0) % 60).padStart(2, "0")}M × 2ND RM15/HOUR)`
        : `PUBLIC HOLIDAY WORKED (${when} — ${n} × 2 DAYS ORP, EA s.60D(3))`,
      phCents,
    ]);
  }
  if (e.commission_cents > 0) earnings.push(["COMMISSION", e.commission_cents]);
  if (e.allowance_cents > 0) earnings.push(["ALLOWANCE", e.allowance_cents]);
  if (otCents > 0) earnings.push([`OVERTIME (${e.ot_hours ?? 0} HRS × 1.5 × HOURLY ORP)`, otCents]);

  const deductions: [string, number][] = [];
  if (e.deduction_cents > 0) deductions.push(["LATE / OTHER DEDUCTION", e.deduction_cents]);
  /* v1.181.4 - ONE LINE PER REQUEST, naming it. The CEO wanted the payslip
     to "appear the request": each advance prints the claim number the staff
     member was given on the Claims tab - CLM-AZOO{DDMMYY}-{n}, so the day
     it was requested is IN the number. Deliberately not longer: the PDF's
     deduction column is 31% of the page, and "SALARY ADVANCE CLM-AZOO230926-12"
     is what still fits at 6pt without being cut (a "(REQUESTED ..., PAID
     ...)" suffix was measured and truncated). Only when the items add up to
     the total does the slip itemise; anything else (an older server) prints
     the single line it always did, so the net can never move. */
  const advItems = x?.salary_advance_items ?? [];
  if (salaryAdvance > 0 && advItems.length > 0 && advItems.reduce((a, i) => a + i.amount_cents, 0) === salaryAdvance) {
    for (const it of advItems) deductions.push([`SALARY ADVANCE ${it.claim_no}`, it.amount_cents]);
  } else if (salaryAdvance > 0) deductions.push([`SALARY ADVANCE (${month})`, salaryAdvance]);
  if (unpaidDed > 0) {
    /* v1.75.0: fractions are real now — half a day, or the hours somebody
       was short of eight. n2v already prints two decimals.
       v1.77.0: the line states EVERY part of the sum. A week in which all of
       somebody's working days were unpaid loses that week's rest days too,
       and the whole deduction is capped so the public holidays stay paid.
       A payslip that showed only a total would leave the person holding it
       unable to check the one number that changed their pay. */
    const d = x?.unpaid_leave ?? 0;
    const rest = x?.unpaid_rest_days ?? 0;
    /* v1.181.8 - the fraction is the one the server used: 1/26 before
       September 2026, one calendar day of the month from then on (s.18A). */
    const parts = [`${n2v(d)} DAY${d === 1 ? "" : "S"} × 1/${x?.unpaid_divisor ?? 26} MONTHLY WAGE`];
    /* v1.148.0: when some of those days were EMERGENCY days, the line says
       so. Somebody who applied for emergency leave and never for unpaid
       leave would otherwise read a deduction headed UNPAID LEAVE and have no
       way to connect it to anything they did. */
    const eu = x?.emergency_unpaid ?? 0;
    if (eu > 0) {
      const plain = x?.unpaid_type_leave ?? 0;
      parts.push(plain > 0
        ? `${n2v(eu)} EMERGENCY + ${n2v(plain)} UNPAID`
        : `${n2v(eu)} EMERGENCY LEAVE — UNPAID FROM 01-09-2026`);
    }
    if (rest > 0) parts.push(`${rest} REST DAY${rest === 1 ? "" : "S"} IN FULLY UNPAID WEEKS`);
    if (x?.unpaid_capped) parts.push(`CAPPED — ${x.public_holiday} PUBLIC HOLIDAY${x.public_holiday === 1 ? "" : "S"} STAY PAID`);
    deductions.push([`UNPAID LEAVE (${parts.join("; ")})`, unpaidDed]);
  }
  /* v1.75.0: this line now only ever appears for a mid-month joiner or
     leaver, and says why — "EMPLOYED 12 OF 19", not "WORKED 15 OF 19", which
     read like an accusation about attendance and was arithmetically wrong. */
  if (incompAdj > 0) {
    const when = x?.joined_on && x.joined_on.slice(0, 7) === month ? `JOINED ${x.joined_on}`
      : x?.left_on && x.left_on.slice(0, 7) === month ? `LEFT ${x.left_on}` : "PART MONTH";
    deductions.push([x?.proration_basis === "calendar"
      ? `INCOMPLETE MONTH (${when} — ${x.proration_days ?? 0} OF ${x.proration_month_days ?? 0} CALENDAR DAYS)`
      : `INCOMPLETE MONTH (${when} — EMPLOYED ${x?.payable_days ?? 0} OF ${x?.month_working_days ?? 0} WORKING DAYS)`, incompAdj]);
  }

  const others: [string, number][] = [];
  if (x) {
    others.push(["WORKING DAYS (TOTAL CLOCKED IN)", x.working_day]);
    if (x.public_holiday > 0) others.push(["PUBLIC HOLIDAY", x.public_holiday]);
    if (x.annual_leave > 0) others.push(["ANNUAL LEAVE", x.annual_leave]);
    if (x.medical_leave > 0) others.push(["MEDICAL LEAVE", x.medical_leave]);
    /* v1.148.0: "(PAID)" is now only ever printed against days that really
       were paid — emergency leave that started before 01-09-2026. Days on or
       after that date appear on their own line, marked unpaid, and are part
       of the UNPAID LEAVE deduction above rather than a second, contradictory
       statement about the same days. */
    if ((x.emergency_leave ?? 0) > 0) others.push(["EMERGENCY LEAVE (PAID)", x.emergency_leave!]);
    if ((x.emergency_unpaid ?? 0) > 0) others.push(["EMERGENCY LEAVE (UNPAID — IN THE DEDUCTION ABOVE)", x.emergency_unpaid!]);
    if ((x.unpaid_leave ?? 0) > 0) others.push(["UNPAID LEAVE (TOTAL DAYS DEDUCTED)", x.unpaid_leave!]);
  }

  return {
    name: u.full_name || u.name,
    employee_id: u.employee_id, department: u.department, position: u.position,
    ic_number: u.ic_number, employment_status: u.employment_status,
    bank_name: u.bank_name, bank_account: u.bank_account,
    month, earnings, deductions, others,
    gross_cents: gross, deduction_cents: totalDed, net_cents: Math.max(0, gross - totalDed),
    note: e.note ?? null,
    annual_bal: x ? x.annual_bal : null, sick_bal: x ? x.sick_bal : null,
    issuer_code: issuerCode ?? null, // v1.28.0 — employer of record at release
  };
}

/* v1.4.257: hand the slip to the phone's share sheet as a real file — the
   errand is a staff member standing at a bank counter being asked for one. */
export async function sendPayslipPdf(
  u: StaffRow & { employment_status?: string | null }, e: Entry, month: string, x?: SlipExtras,
  issuerCode?: string | null, // v1.28.0 — release row's issuer_code
) {
  const d = payslipData(u, e, month, x, issuerCode);
  const blob = await buildPayslipPdf(d);
  await sharePdfFile(blob, `Payslip-${(u.employee_id || u.name).replace(/\s+/g, "-")}-${month}.pdf`,
    `Payslip ${d.name} ${month}`);
}

export function printPayslip(
  u: StaffRow & { employment_status?: string | null },
  e: Entry,
  month: string,
  x?: SlipExtras,
  issuerCode?: string | null, // v1.28.0 — release row's issuer_code
) {
  /* v1.28.0: the printed employer line follows the issuer stamped when the
     month was released — never the current operator, so a legacy slip
     re-prints under AZ ONE OFFICIAL forever. */
  const issuer = resolveIssuer(issuerCode);
  /* v1.4.257: every figure below comes from payslipData() — the SAME function
     the PDF uses. v1.4.183's hourly rule, v1.4.79's unpaid-leave deduction and
     v1.4.82's incomplete-month adjustment all live there now. */
  const D = payslipData(u, e, month, x, issuerCode);
  const gross = D.gross_cents;
  const totalDed = D.deduction_cents;
  const net = D.net_cents;
  const [yy, mm] = month.split("-");
  const lastDay = new Date(Number(yy), Number(mm), 0).getDate();
  const period = { from: `01-${mm}-${yy}`, to: `${String(lastDay).padStart(2, "0")}-${mm}-${yy}` };
  const amt = rmBare; // v1.4.272: global bare formatter
  const n2 = (v: number) => rmBare(Math.round(v * 100)); // v1.4.272: routed through the global

  // The same three columns the PDF draws, rendered as table rows.
  const earn = D.earnings;
  const dedRows = D.deductions.length > 0
    ? D.deductions.map(([label, v]) => `<tr><td>${esc(label)}</td><td class="amt">${amt(v)}</td></tr>`).join("")
    : `<tr><td class="muted">NO DEDUCTION</td><td class="amt"></td></tr>`;
  const othersRows = D.others.map(([label, v]) => `<tr><td>${esc(label)}</td><td class="amt">${n2(v)}</td></tr>`).join("");

  openPrintPreview(`<!doctype html><html><head><title>Payslip ${esc(u.name)} ${esc(monthDMY(month))}</title>
<style>
  @page { size: A4; margin: 0; } /* v1.4.239 — margin as body padding so the browser prints no headers */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; padding: 14mm; font-size: 12px; }
  .sheet { border: 1.5px solid #000; }
  .info { width: 100%; border-collapse: collapse; }
  .info td { padding: 3px 8px; vertical-align: top; }
  .info .l { font-weight: bold; white-space: nowrap; }
  .cols { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cols th { border: 1px solid #000; padding: 4px; text-align: center; }
  .cols > tbody > tr.main > td { border: 1px solid #000; padding: 0; vertical-align: top; height: 230px; }
  .cols > tbody > tr.totals > td { border: 1px solid #000; padding: 0; }
  .inner { width: 100%; border-collapse: collapse; }
  .inner td { padding: 3px 8px; }
  .inner .amt { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #444; }
  .total td { font-weight: bold; }
  .bottom { width: 100%; border-collapse: collapse; }
  .bottom td { border: 1px solid #000; padding: 5px 8px; }
  .nett { font-weight: bold; font-size: 13px; }
  .company { margin-top: 8px; font-weight: bold; font-size: 13px; }
  .company span { font-weight: normal; font-size: 11px; }
  .conf-row { text-align: right; margin-bottom: 4px; }
  .conf { display: inline-block; border: 1.5px solid #b00020; color: #b00020;
    font-weight: bold; font-size: 10px; letter-spacing: .8px; padding: 2px 8px; }
  .privacy { margin-top: 4px; font-size: 9.5px; color: #444; }
</style></head><body>
  <div class="conf-row">
    <span class="conf">SULIT / PRIVATE &amp; CONFIDENTIAL</span>
  </div>
  <div class="sheet">
    <table class="info">
      <tr>
        <td class="l">EMP'EE #</td><td>: ${esc(u.employee_id ?? "—")}</td>
        <td class="l">DEPT.</td><td>: ${esc((u.department ?? "—").toUpperCase())}</td>
      </tr>
      <tr>
        <td class="l">EMP'EE NAME</td><td>: ${esc((u.full_name || u.name).toUpperCase())}</td>
        <td class="l">SECTION</td><td>: ${esc((u.position ?? "—").toUpperCase())}</td>
      </tr>
      <tr>
        <td class="l">I/C #</td><td>: ${esc(u.ic_number ?? "—")}</td>
        <td></td><td></td>
      </tr>
      <tr>
        <td class="l">STATUS</td><td>: ${esc((u.employment_status ?? "—").replace("_", " ").toUpperCase())}</td>
        <td class="l">PERIOD</td><td>: ${period.from} &nbsp;TO&nbsp; ${period.to}</td>
      </tr>
      <tr>
        <td class="l">BANK NAME</td><td>: ${esc((u.bank_name ?? "—").toUpperCase())}</td>
        <td class="l">BANK ACCOUNT</td><td>: ${esc(u.bank_account ?? "—")}</td>
      </tr>
    </table>
    <table class="cols">
      <thead>
        <tr><th style="width:38%">EARNINGS / INCOME</th><th style="width:31%">DEDUCTIONS</th><th style="width:31%">OTHERS</th></tr>
      </thead>
      <tbody>
        <tr class="main">
          <td><table class="inner">
            ${earn.map(([label, c]) => `<tr><td>${esc(label)}</td><td class="amt">${amt(c)}</td></tr>`).join("")}
          </table></td>
          <td><table class="inner">${dedRows}</table></td>
          <td><table class="inner">${othersRows}</table></td>
        </tr>
        <tr class="totals">
          <td><table class="inner"><tr class="total"><td>TOTAL :</td><td class="amt">${amt(gross)}</td></tr></table></td>
          <td><table class="inner"><tr class="total"><td>TOTAL :</td><td class="amt">${amt(totalDed)}</td></tr></table></td>
          <td><table class="inner">
            <tr><td>ANNL. BAL. :</td><td class="amt">${x ? n2(x.annual_bal) : "—"}</td></tr>
            <tr><td>SICK BAL. :</td><td class="amt">${x ? n2(x.sick_bal) : "—"}</td></tr>
          </table></td>
        </tr>
      </tbody>
    </table>
    <table class="bottom">
      <tr>
        <td style="width:69%">${e.note ? "NOTE : " + e.note : ""}</td>
        <td class="nett" style="width:31%">NETT PAY : <span style="float:right">${amt(net)}</span></td>
      </tr>
    </table>
  </div>
  <p class="company">${issuer.name} <span>(SSM ${issuer.ssm} / ${issuer.oldReg}) · ${issuer.address.replace(/, Malaysia$/, "")} · Computer-generated payslip — no signature required.</span></p>
  <p class="privacy">SULIT / PRIVATE &amp; CONFIDENTIAL — This payslip is issued to the named employee pursuant to the Employment Act 1955 and contains personal data protected under the Personal Data Protection Act 2010 (PDPA). It must not be disclosed, copied, or shared with any other party without the employee's or the company's written consent. Retain for your records.</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
}

/* v1.75.0 — a working day with no clock-in, or one clocked well short of
   eight hours. Proposed, never deducted on its own. */
/* v1.81.0 — `of` and `break_minutes` come from the server, which resolves the
   person's own pattern. The chip used to print a hard-coded "/8h" beside a
   figure the server had measured against something else entirely: on a
   10:00-18:00 day with an hour of lunch the target is SEVEN, and on a
   part-timer's six-hour day it is six. */
type AbsenceRow = {
  user_id: number; name: string; missing: string[];
  short: { d: string; hours: number; of?: number; break_minutes?: number }[];
  /* v1.145.0 - days with a leave application still waiting on a decision.
     Reported separately by the server, and NOT pressable here: payroll follows
     the leave decision, it does not race it. */
  pending?: { d: string; type: string }[];
  partial_review?: { d: string; unresolved: boolean }[];
};

/** v1.77.0 — the server's unpaid-leave deduction, and what it is made of. */
type UnpaidDetail = {
  user_id: number;
  /** Days of approved unpaid leave, as recorded. */
  days: number;
  /** Rest days lost because their whole week was unpaid (the CEO's rule). */
  rest_days: number;
  cents: number;
  /** The deduction was reduced to keep the public holidays paid. */
  capped: boolean;
  /** More days clocked than the person was employed for — impossible, and
      it means a date in their staff record is wrong. */
  clocked_beyond_employment: boolean;
  clocked_days: number;
  payable_days: number;
  /** Public holidays worked — two days' ORP each (s.60D(3)(a)(i)); for a
      part-timer, a second RM15/h on those hours. */
  ph_worked: number;
  ph_worked_dates: string[];
  ph_worked_cents: number;
  salary_advance_cents: number;
};

/** v1.215.0 - one invoice the CEO/COO confirmed as paid in full (GET /payroll/commission-sources) */
interface CommSource {
  invoice_id: number; doc_number: string; company: string | null; amount_cents: number; payment_ref: string | null;
  paid_at: string | null; confirmed_at: string; confirmed_by_name: string | null; salesperson_id: number | null; closer_name: string | null;
}

export function PayrollPanel({ readOnly = false, role = "" }: { readOnly?: boolean; role?: string }) {
  // Opens on the cycle month: July until 05-08, then August (v1.4.89).
  const [month, setMonth] = useState(payrollCycleMonth());
  const [staff, setStaff] = useState<StaffRow[]>([]);
  /* v1.77.0 — skeleton until the first fetch lands. `staff` starts [] so an
     empty list cannot be told from a list still loading; this flag can. It
     flips once, after the FIRST load settles (ok or failed), so the table
     never reads "TOTAL — 0 staff" while the four requests are in flight. */
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<Record<number, Entry>>({});
  const [msg, setMsg] = useState("");
  // v1.4.82: incomplete months are an explicit DEDUCTION, never a shrunken
  // basic. Enter the month's working days once and each person's days worked;
  // NET adjusts live via incompleteMonthAdj() — e.g. RM2100 basic, joined
  // 20 July (10 of 26 days): basic shows RM2100, deduction RM1292.31,
  // net RM807.69. Same money as the old proration, but visible and fair.
  const [monthDays, setMonthDays] = useState(26);
  const { show: showToast, node: toastNode } = useSaveToast();
  const { confirm: payConfirm, node: payConfirmNode } = useConfirm(); // v1.4.240
  type PrCol = "rank" | "staff" | "basic" | "allow" | "comm" | "deduct" | "net"; // v1.215.0 - Sales Commission back; OT under Net
  /* v1.78.0 (CEO: "payroll should ascending with position which is CEO, COO,
     CCO, HR_admin, Sales Executive, Sales Marketing, Marketing Designer and
     lastly Live host and Part time last host") - the run opens in company
     order, not alphabetical. Every column header still sorts, and the STAFF
     header still gives A-Z; this is the resting state a salary run is read
     in. The order itself is lib/staff-order.ts, shared with the Staff tab
     and mirrored in the worker so the M2E file comes out the same way. */
  const [prSort, setPrSort] = useState<{ col: PrCol; asc: boolean }>({ col: "rank", asc: true });
  const cyclePr = (col: PrCol) => setPrSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: true });

  /* v1.4.203 — M2E: filled-.xlsm download + one-time setup (template upload,
     Corporate ID, payer account). The M2E USER ID/password are login
     credentials and are never asked for nor stored. */
  const [m2eCid, setM2eCid] = useState("");
  const [m2eAcc, setM2eAcc] = useState("");
  const [m2eCbid, setM2eCbid] = useState("");
  /* v1.4.226 (CEO: "add commission which is 1.5%"): month sales base +
     rate + target staff for the commission helper. */
  const [m2eHasTpl, setM2eHasTpl] = useState<boolean | null>(null);
  const loadM2e = useCallback(async () => {
    const r = await api<{ corporate_id?: string; payer_account?: string; client_batch_id?: string; has_template?: boolean }>(`/payroll/m2e-settings`);
    if (r.ok) { setM2eCid(r.data?.corporate_id ?? ""); setM2eAcc(r.data?.payer_account ?? ""); setM2eCbid(r.data?.client_batch_id ?? ""); setM2eHasTpl(!!r.data?.has_template); }
  }, []);
  useEffect(() => { void loadM2e(); }, [loadM2e]);
  const downloadM2e = async () => {
    const res = await fetch(`${API}/payroll/m2e-file?month=${month}`, { credentials: "include" });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      showToast(L("No file", "Tiada fail"), j?.error?.message ?? L("M2E file failed — check M2E setup below", "Fail M2E gagal — semak persediaan M2E di bawah"), "notice");
      return;
    }
    const skipped = res.headers.get("X-M2E-Skipped");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `azoo-m2e-salary-${month}.xlsm`; a.click();
    URL.revokeObjectURL(url);
    if (skipped) showToast(L("Check bank details", "Semak butiran bank"), `${L("Skipped (fix in Staff Details, then re-download)", "Dilangkau (betulkan dalam Butiran Kakitangan, kemudian muat turun semula)")}: ${decodeURIComponent(skipped)}`, "notice");
    else showToast(L("Saved", "Disimpan"), L("M2E workbook downloaded — open, enable macros, generate + upload", "Buku kerja M2E dimuat turun — buka, aktifkan makro, jana + muat naik"));
  };
  const saveM2eSettings = async () => {
    const r = await api<{ error?: { message?: string } }>(`/payroll/m2e-settings`, {
      method: "POST", body: JSON.stringify({ corporate_id: m2eCid, payer_account: m2eAcc, client_batch_id: m2eCbid }),
    });
    if (r.ok) showToast(L("Saved", "Disimpan"), L("M2E settings stored — the M2E salary file button now fills them into every file", "Tetapan M2E disimpan — butang fail gaji M2E kini mengisinya ke dalam setiap fail"));
    else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Save failed", "Simpan gagal"), "notice");
  };
  const uploadM2eTemplate = async (f: File) => {
    /* v1.23.1: raw fetch (binary body, api() would JSON it); v1.26.2: through
       csrfFetch so it self-heals a missing csrf cookie like every other call. */
    const res = await csrfFetch(`${API}/payroll/m2e-template`, { method: "POST", body: f });
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (res.ok) { setM2eHasTpl(true); showToast(L("Saved", "Disimpan"), L("Blank M2E template stored — the M2E salary file button now generates the filled workbook", "Templat M2E kosong disimpan — butang fail gaji M2E kini menjana buku kerja yang terisi")); }
    else showToast(L("No changes", "Tiada perubahan"), j?.error?.message ?? L("Template upload failed", "Muat naik templat gagal"), "notice");
  };
  // v1.4.87: change detection — snapshot of each row as loaded, so Save can
  // honestly say "No changes" instead of pretending to work.
  const pristineRef = useRef<Record<number, string>>({});
  const fingerprint = (id: number) => {
    const e = entry(id);
    const d = workedDays[id];
    // v1.4.128: monthDays included — a working-days change (e.g. a holiday
    // calendar correction) marks EVERY row dirty so Save all re-saves it.
    const hasD = typeof d === "number" && !Number.isNaN(d);
    return JSON.stringify([e.basic_cents, e.commission_cents, e.allowance_cents, e.ot_hours ?? null, e.deduction_cents, hasD ? d : null, hasD ? monthDays : null, e.note ?? null]);
  };
  const [workedDays, setWorkedDays] = useState<Record<number, number>>({});


  /** v1.4.77: auto-calculation from attendance — fill every "days" input
      with the clock-in day count. Values stay editable afterwards, so a
      wrong or cheated punch can be overridden before prorating (and fixed
      permanently in Attendance → corrections). */
  const autoFillDays = () => {
    const filled: Record<number, number> = {};
    for (const u of staff) filled[u.id] = attDays[u.id] ?? 0;
    setWorkedDays(filled);
    setMsg(L("Days filled from clock-in records — review, correct if needed, then Save all. Net adjusts automatically; Basic stays full.", "Hari diisi daripada rekod daftar masuk — semak, betulkan jika perlu, kemudian Simpan semua. Bersih dilaraskan automatik; Gaji pokok kekal penuh."));
    window.setTimeout(() => setMsg(""), 6000);
  };

  // v1.4.124: the net this panel displays, computed once and SAVED with the
  // entry — /expenses sums these stored figures, so the Expenses card and
  // this total always tally after Save all.
  /* v1.181.8 - the incomplete-month deduction for one row. The days come
     from the server (calendar days from September 2026, s.18A); a month
     before that, or a server that has not said, keeps the working-day sum. */
  const incFor = (id: number, basicCents: number): number =>
    proration !== null && proration.basis === "calendar"
      ? incompleteCents(basicCents, proration.month_days, proDays[id] ?? proration.month_days)
      : incompleteMonthAdj(basicCents, payableDays[id] ?? monthDays, monthDays);
  const netFor = (id: number, override?: Entry): number => {
    /* v1.97.1 — `override` lets a caller price a row it is ABOUT to write
       (Save base salaries re-filling Basic) without waiting for React state
       to settle; the formula stays this one. */
    const e = override ?? entry(id);
    const uRow = staff.find((x) => x.id === id);
    if (uRow && isHourly(uRow)) {
      // v1.4.183: hourly pay (auto from the clock) + commission + allowance
      // − deduction. The server recomputes authoritatively on save anyway.
      const hourly = e.hourly_pay_live ?? e.basic_cents;
      const phH = unpaidInfo[id]?.ph_worked_cents ?? 0; // v1.77.0: 2nd RM15/h on a public holiday
      const advance = unpaidInfo[id]?.salary_advance_cents ?? 0;
      return Math.max(0, hourly + phH + e.commission_cents + e.allowance_cents - e.deduction_cents - advance);
    }
    /* v1.77.0 — the server's figure, not a second copy of the formula. */
    const ulDed = unpaidInfo[id]?.cents ?? 0;
    const adj = incFor(id, e.basic_cents);
    const ot = otPay(e.basic_cents, e.ot_hours);
    const phW = unpaidInfo[id]?.ph_worked_cents ?? 0; // v1.77.0: 2 days' ORP per public holiday worked
    const advance = unpaidInfo[id]?.salary_advance_cents ?? 0;
    return Math.max(0, e.basic_cents + phW + e.commission_cents + e.allowance_cents + ot - e.deduction_cents - ulDed - adj - advance);
  };

  /* v1.148.0 — CHANGING A MONTH WHOSE PAYSLIPS ARE OUT.
     The API now refuses (409 month_released) on the four routes that set net
     pay, the same way it has always refused an overtime edit. A refusal with
     no way through would be worse than the bug: a genuine correction to a
     released month has to remain possible. So the refusal becomes a question
     — asked once, answered deliberately, and the retry is audited under the
     name of whoever said yes. A batch asks once for the whole batch, not
     once per person. */
  const forceAsked = useRef(false);
  const releaseOverride = async (serverMsg: string): Promise<boolean> =>
    await payConfirm({
      title: L("These payslips are already out", "Slip gaji ini sudah dikeluarkan"),
      message: `${serverMsg} ${L("Changing it now will not change the payslip anybody was handed — tell them and re-print, or this figure and their copy will disagree. This is logged under your name.", "Mengubahnya sekarang tidak akan mengubah slip gaji yang telah diterima sesiapa — beritahu mereka dan cetak semula, atau angka ini akan bercanggah dengan salinan mereka. Ini dilog atas nama anda.")}`,
      confirmLabel: L("Change it anyway", "Ubah juga"),
      variant: "danger",
    });
  /** POST that offers the override once when the month is released. `batch`
      carries the answer across the rows of one Save all. */
  const postPay = async (url: string, payload: Record<string, unknown>, batch = false) => {
    const send = (force: boolean) =>
      api<{ working_days?: number; rows?: number; error?: { code?: string; message?: string } }>(
        url, { method: "POST", body: JSON.stringify(force ? { ...payload, force_released: true } : payload) });
    if (batch && forceAsked.current) return await send(true);
    const first = await send(false);
    if (first.ok || first.data?.error?.code !== "month_released") return first;
    if (!(await releaseOverride(first.data?.error?.message ?? ""))) return first;
    if (batch) forceAsked.current = true;
    return await send(true);
  };

  const saveAll = async () => {
    setMsg("");
    forceAsked.current = false; // v1.148.0: each Save all asks for itself
    let n = 0;
    for (const u of staff) {
      const e = entries[u.id];
      const d = workedDays[u.id];
      const hasDays = typeof d === "number" && !Number.isNaN(d);
      if (!e && !hasDays) continue; // nothing entered for this row
      if (fingerprint(u.id) === pristineRef.current[u.id]) continue; // unchanged
      const res = await postPay(`/payroll`, {
        ...entry(u.id), month,
        ot_cents: otPay(entry(u.id).basic_cents, entry(u.id).ot_hours),
        worked_days: hasDays ? d : null,
        month_working_days: hasDays ? monthDays : null,
        net_cents: netFor(u.id),
        salary_advance_cents: unpaidInfo[u.id]?.salary_advance_cents ?? 0,
      }, true);
      if (res.ok) n += 1;
    }
    if (n === 0) showToast(L("No changes", "Tiada perubahan"), L("Every row already matches what's saved", "Setiap baris sudah sepadan dengan yang disimpan"), "notice");
    else showToast(L("Saved", "Disimpan"), L(`${n} ${n === 1 ? "entry" : "entries"} saved for ${month}`, `${n} entri disimpan untuk ${month}`));
    void load();
  };

  const [attDays, setAttDays] = useState<Record<number, number>>({});
  /* v1.134.0 (CEO: "once approved, it will directly recorded into the
     payroll") - approved overtime for the month, in minutes, per person.
     The OT hours box fills from it; the box stays editable, like days. */
  const [otApproved, setOtApproved] = useState<Record<number, { minutes: number; days: number }>>({});
  const otHoursFrom = (minutes: number) => Math.round((minutes / 60) * 2) / 2;
  // v1.4.79: approved unpaid-leave days — the payslip auto-deducts these.
  const [unpaidDays, setUnpaidDays] = useState<Record<number, number>>({});
  /* v1.77.0 — the unpaid-leave DEDUCTION, from the server, per person. The
     browser used to recompute `base / 26 * days` at three separate call
     sites. Once the rule grew a week clause and a public-holiday floor, three
     copies would have become three answers, and the first one anybody forgot
     to update would be a row disagreeing with its own payslip. The one thing
     the browser is allowed to do with this number is print it. */
  const [unpaidInfo, setUnpaidInfo] = useState<Record<number, UnpaidDetail>>({});
  /* v1.75.0 — how many of the month's working days each person was EMPLOYED
     for, from the server (joined_on / left_on). This, not the attendance
     clock, is what prorates a basic. Absent = the same for everyone except a
     mid-month joiner or leaver. */
  const [payableDays, setPayableDays] = useState<Record<number, number>>({});
  /* v1.181.8 - THE DAYS THE INCOMPLETE MONTH IS PRORATED OVER, from the
     server. From September 2026 that is calendar days (Employment Act
     s.18A): 20 of 30 for somebody who joined on the 11th. Before it, the
     month's working days, as it always was - so an old month still adds up
     to the payslip that was issued. The browser multiplies, because the
     basic is a box somebody can type in; it does not choose the days. */
  const [proration, setProration] = useState<{ basis: "calendar" | "working"; month_days: number; unpaid_divisor: number } | null>(null);
  const [proDays, setProDays] = useState<Record<number, number>>({});
  const calendarBasis = proration !== null && proration.basis === "calendar";
  /** What one unpaid day is a fraction of, as the server computed it. */
  const ulRate = `1/${proration?.unpaid_divisor ?? 26}`;
  /* CEO: "Unpaid will be count based on their no data in." The scan finds
     them; a person decides. Marking is CEO-only on the server (unpaid_leave),
     so the card is too — a button that 403s is worse than no button. */
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  /* v1.145.0 - how many days in this list are waiting on a leave decision.
     Counted from what the server sent, so it can never disagree with the
     chips below it. */
  const waitingOnLeave = absences.reduce((n, a) => n + (a.pending?.length ?? 0), 0);
  const [marking, setMarking] = useState("");
  /* One click = one recorded unpaid day. `hours` present means a short day:
     the server turns hours-short into a quarter-day fraction, so the rule
     lives in exactly one place rather than being computed here as well. */
  const markUnpaid = async (userId: number, date: string, hours?: number) => {
    setMarking(`${userId}|${date}`);
    /* v1.148.0: this is one of the four routes that can now refuse a
       released month. postPay asks the question and retries under audit. */
    const r = await postPay(`/attendance/unpaid`, {
      user_id: userId, date,
      ...(hours !== undefined ? { hours_worked: hours } : {}),
      reason: hours !== undefined ? `Short day - clocked ${hours}h of 8h` : "No clock-in",
    }) as { ok: boolean; data?: { days?: number; error?: { message?: string } } };
    setMarking("");
    if (!r.ok) {
      showToast(L("Not recorded", "Tidak direkod"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showToast(L("Recorded", "Direkod"),
      L(`${date} — ${r.data?.days ?? 1} day unpaid. The staff member has been notified.`,
        `${date} — ${r.data?.days ?? 1} hari tanpa gaji. Kakitangan telah dimaklumkan.`));
    void load();
  };
  const canMarkUnpaid = ["ceo", "super_admin"].includes(role);
  // v1.4.80: staff payslip release state for this month.
  // v1.28.0: released also carries issuer_code — the employer stamped at
  // release time, which every payslip printed for this month must show.
  const [release, setRelease] = useState<{ available_from: string; released: { released_at: string; issuer_code?: string | null } | null; employer?: string; employer_is_legacy?: boolean } | null>(null);
  // v1.4.78: fixed basic per staff — auto-fills every month; adjust on increment.
  const [base, setBase] = useState<Record<number, number>>({});
  const [baseDraft, setBaseDraft] = useState<Record<number, number>>({});
  /* v1.198.0 - the five tabs, the row being explained in the drawer, and
     what was loaded: the pristine snapshot as state (render reads it to say
     which rows are unsaved; pristineRef stays the one Save compares with)
     and which people had a saved entry. */
  type PayView = "overview" | "process" | "payslips" | "reports" | "settings";
  const [view, setView] = useState<PayView>("overview");
  const go = (v: PayView, anchor?: string) => {
    setView(v);
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };
  const [detailId, setDetailId] = useState<number | null>(null);
  /* v1.207.0 - the Processing table's search and department filter (the
     TOTAL row and every figure stay the whole month's), the saved rows that
     carry no saved net, and the month history - read once the Reports tab
     or a salary drawer is first opened */
  const [prQ, setPrQ] = useState("");
  const [prDept, setPrDept] = useState("");
  const [noNetIds, setNoNetIds] = useState<number[]>([]);
  const [histWanted, setHistWanted] = useState(false);
  if (!histWanted && (view === "reports" || detailId !== null)) setHistWanted(true);
  const [pristine, setPristine] = useState<Record<number, string>>({});
  /* v1.215.0 - PAYROLL 2.0, PHASE A (the owner's brief and answers,
     28-10-2026). The invoices the CEO/COO confirmed as paid in full this
     month, by closer - read-only, from /payroll/commission-sources. No
     commission policy is set yet, so nothing is calculated from them: the
     Sales Commission column shows the row's saved commission (RM 0.00 for
     every month since commission left pay on 22-10-2026) and says why. */
  const [commSrc, setCommSrc] = useState<{ month: string; policy: null | object; rows: CommSource[]; failed?: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void api<{ month: string; policy: null | object; rows: CommSource[] }>(`/payroll/commission-sources?month=${month}`)
      .then((r) => { if (alive) setCommSrc(r.ok && r.data ? r.data : { month, policy: null, rows: [], failed: true }); });
    return () => { alive = false; };
  }, [month]);
  const commOf = (uid: number) => (commSrc?.month === month ? commSrc.rows.filter((r) => r.salesperson_id === uid) : []);
  const [savedIds, setSavedIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    const [u, p, a, b] = await Promise.all([
      api<{ users?: StaffRow[]; staff?: StaffRow[] }>(`/users`),
      api<{ entries: (Entry & { name: string })[]; release?: { available_from: string; released: { released_at: string; issuer_code?: string | null } | null; employer?: string; employer_is_legacy?: boolean } }>(`/payroll?month=${month}`),
      api<{ days: { user_id: number; days: number }[]; working_days?: number; unpaid_detail?: UnpaidDetail[]; ot_approved?: { user_id: number; minutes: number; days: number }[] }>(`/payroll/attendance-days?month=${month}`),
      api<{ base: { user_id: number; base_salary_cents: number }[] }>(`/payroll/base`),
    ]);
    const dmap: Record<number, number> = {};
    for (const r of a.data?.days ?? []) dmap[r.user_id] = r.days;
    setAttDays(dmap);
    const omap: Record<number, { minutes: number; days: number }> = {};
    for (const r of a.data?.ot_approved ?? []) omap[r.user_id] = { minutes: r.minutes, days: r.days };
    setOtApproved(omap);
    /* v1.77.0 — the server's unpaid deduction and what it is made of. */
    const udmap: Record<number, UnpaidDetail> = {};
    for (const r of a.data?.unpaid_detail ?? []) udmap[r.user_id] = r;
    setUnpaidInfo(udmap);
    // v1.4.84: the month's working days are COMPUTED (Mon–Fri minus every
    // calendar holiday) — no more blanket 26. Still editable for exceptions.
    if (typeof a.data?.working_days === "number" && a.data.working_days > 0) setMonthDays(a.data.working_days);
    const umap: Record<number, number> = {};
    for (const r of (a.data as { unpaid?: { user_id: number; days: number }[] } | null)?.unpaid ?? []) umap[r.user_id] = r.days;
    const emap: Record<number, number> = {};
    for (const r of (a.data as { employed?: { user_id: number; payable_days: number }[] } | null)?.employed ?? []) {
      emap[r.user_id] = r.payable_days;
    }
    setPayableDays(emap);
    const pr = (a.data as { proration?: { basis: "calendar" | "working"; month_days: number; unpaid_divisor: number } } | null)?.proration ?? null;
    const pmap: Record<number, number> = {};
    for (const r of (a.data as { employed?: { user_id: number; proration_days?: number }[] } | null)?.employed ?? []) {
      if (typeof r.proration_days === "number") pmap[r.user_id] = r.proration_days;
    }
    setProration(pr);
    setProDays(pmap);
    setUnpaidDays(umap);
    /* The proposal list. Read-only viewers and non-CEOs never see it, so it
       is not fetched for them either.

       v1.77.0 — NOT AWAITED. It used to be, right here in the middle of
       load(), and the salary table is only put on screen at the END of this
       function. So the whole tab waited on a scan of every person against
       every day of the month, and until that came back the page read
       "TOTAL — 0 staff" — which looks exactly like a payroll with nobody in
       it. The scan is a suggestion card and can arrive late. The table
       cannot. */
    if (canMarkUnpaid && !readOnly) {
      void api<{ staff: AbsenceRow[] }>(`/payroll/absences?month=${month}`)
        .then((ab) => setAbsences(ab.data?.staff ?? []));
    }
    const bmap: Record<number, number> = {};
    for (const r of b.data?.base ?? []) bmap[r.user_id] = r.base_salary_cents;
    setBase(bmap);
    setBaseDraft(bmap);
    // v1.4.101: staff lifecycle — a resigned/terminated person is processed
    // up to and including the month of the effective date (final salary uses
    // days worked), disappears for the gap, and returns from the re-join
    // month if they come back.
    const monthEnd = `${month}-31`;
    const monthStart = `${month}-01`;
    const inMonth = (x: StaffRow) => {
      const leftOut = x.left_on && x.left_on < monthStart;      // gone before this month
      const backIn = x.rejoined_on && x.rejoined_on <= monthEnd; // already re-joined
      if (leftOut && !backIn) return false;
      return true;
    };
    const list = (u.data?.users ?? u.data?.staff ?? []).filter(
      (x) => x.role !== "customer" && x.role !== "super_admin" && inMonth(x),
    );
    /* v1.148.0 - this used to be a SECOND, hand-written role order living
       here: it put admin AFTER hr_admin and sales_marketing, the opposite of
       the order the CEO gave on 04-09-2026, and it collapsed editor,
       marketing and live_host into one tie. The main table hid the drift by
       re-sorting on screen with bySeniority, but the Base salaries grid
       renders this array straight, so it listed people in the wrong order on
       the one screen where somebody's pay is set. One company order, and
       this file already imported it. */
    list.sort(bySeniority);
    setStaff(list);
    const map: Record<number, Entry> = {};
    const savedDays: Record<number, number> = {};
    for (const e of p.data?.entries ?? []) {
      map[e.user_id] = e;
      if (e.worked_days !== null && e.worked_days !== undefined) savedDays[e.user_id] = e.worked_days;
    }
    // v1.4.84: days worked auto-fill from attendance — nothing to type unless
    // a correction is needed. Saved values always win; staff with ZERO
    // clock-ins are left blank (= full month) so someone who simply doesn't
    // punch is never silently zeroed out.
    for (const [uid, d] of Object.entries(dmap)) {
      const id = Number(uid);
      if (!(id in savedDays) && d > 0) savedDays[id] = d;
    }
    /* v1.139.0 - THE SNAPSHOT IS TAKEN BEFORE THE OT FILL.
       It used to be taken after, so the auto-filled OT hours became part of
       "what is already saved" and the row was never dirty: the box showed
       2.5, the chip was green, the net went up, and Save all answered "every
       row already matches what's saved" while payroll_entries.ot_cents - the
       figure the payslip, the M2E bank file and Expenses all read - stayed
       at zero. A fill is a proposed change, so it has to read as one.
       These are the entries AS LOADED; the fill below replaces objects
       rather than mutating them, so this copy keeps the saved truth. */
    const loadedEntries: Record<number, Entry | undefined> = { ...map };
    /* v1.134.0 - approved overtime lands in the OT hours box by itself.
       v1.159.2 (CEO: "OT approved should automatically fill based on
       approved hours!!") - the APPROVED total wins, always: the CEO approves
       every overtime himself on the Overtime card, so the box follows what
       he approved, including an approval made after the row was saved. A
       row whose saved figure differs is simply dirty, and Save all writes
       the approved hours. Rounded to the half hour the box accepts. */
    for (const [uid, o] of Object.entries(omap)) {
      const id = Number(uid);
      const h = otHoursFrom(o.minutes);
      if (h <= 0) continue;
      const cur = map[id];
      if (cur && cur.ot_hours === h) continue;
      /* An entry that does not exist yet still pre-fills Basic from the base
         salary, exactly as entry() would have. */
      map[id] = { ...(cur ?? { user_id: id, basic_cents: bmap[id] ?? 0, commission_cents: 0, allowance_cents: 0, deduction_cents: 0 }), ot_hours: h };
    }
    setEntries(map);
    setWorkedDays(savedDays);
    setRelease(p.data?.release ?? null);
    // Snapshot the just-loaded state per row for no-change detection.
    const snap: Record<number, string> = {};
    for (const u of list) {
      const e = loadedEntries[u.id] ?? { user_id: u.id, basic_cents: bmap[u.id] ?? 0, commission_cents: 0, allowance_cents: 0, deduction_cents: 0 };
      const d = savedDays[u.id];
      // v1.4.128: the SAVED month_working_days anchors the snapshot — if the
      // calendar changed since this row was saved, it must count as dirty.
      snap[u.id] = JSON.stringify([e.basic_cents, e.commission_cents, e.allowance_cents, e.ot_hours ?? null, e.deduction_cents, d ?? null, (e as Entry & { month_working_days?: number | null }).month_working_days ?? null, e.note ?? null]);
    }
    pristineRef.current = snap;
    setPristine(snap);
    setSavedIds((p.data?.entries ?? []).map((x) => x.user_id));
    setNoNetIds((p.data?.entries ?? []).filter((x) => typeof (x as Entry & { net_cents?: number | null }).net_cents !== "number").map((x) => x.user_id));
    setLoaded(true);
  }, [month]);
  useEffect(() => {
    /* v1.77.0 — `.finally` is the safety net: should one of the four
       requests reject, the skeleton still clears instead of shimmering
       forever (a skeleton that never ends is worse than a message). */
    void load().finally(() => setLoaded(true));
  }, [load]);

  // No saved entry for the month yet → Basic pre-fills from the fixed base
  // salary, so processors never retype it. Saving writes the real entry.
  const entry = (id: number): Entry =>
    entries[id] ?? { user_id: id, basic_cents: base[id] ?? 0, commission_cents: 0, allowance_cents: 0, deduction_cents: 0 };

  const setField = (id: number, key: keyof Entry, rmValue: string) => {
    const cents = Math.max(0, Math.round(Number(rmValue || 0) * 100));
    setEntries((m) => ({ ...m, [id]: { ...entry(id), [key]: cents } }));
  };

  const save = async (id: number, name?: string) => {
    setMsg("");
    if (fingerprint(id) === pristineRef.current[id]) {
      showToast(L("No changes", "Tiada perubahan"), name ? `${name} — ${L("nothing to save", "tiada apa untuk disimpan")}` : L("Nothing to save", "Tiada apa untuk disimpan"), "notice");
      return;
    }
    const d = workedDays[id];
    const res = await postPay(`/payroll`, {
      ...entry(id), month,
      ot_cents: otPay(entry(id).basic_cents, entry(id).ot_hours),
      worked_days: typeof d === "number" && !Number.isNaN(d) ? d : null,
      month_working_days: typeof d === "number" && !Number.isNaN(d) ? monthDays : null,
      net_cents: netFor(id),
      salary_advance_cents: unpaidInfo[id]?.salary_advance_cents ?? 0,
    });
    if (res.ok) showToast(L("Saved", "Disimpan"), name ?? L("Payroll entry saved", "Entri gaji disimpan"));
    else setMsg(res.data?.error?.message ?? L("Save failed", "Simpan gagal"));
    void load();
  };

  const printSlip = async (u: StaffRow) => {
    const d = await api<{ extras: SlipExtras }>(`/payroll/detail?user_id=${u.id}&month=${month}`);
    /* v1.28.0: the slip renders the employer stamped on the month's release
       row (NULL/unreleased = legacy AZ ONE OFFICIAL; released after the
       switch = A2Z). */
    printPayslip(u, entry(u.id), month, d.data?.extras ?? null, release?.released?.issuer_code ?? null);
  };
  /* v1.4.257: same fetch, a real file instead of a print dialog — for the
     staff member who needs the slip somewhere the portal can't follow. */
  const sendSlip = async (u: StaffRow) => {
    const d = await api<{ extras: SlipExtras }>(`/payroll/detail?user_id=${u.id}&month=${month}`);
    await sendPayslipPdf(u, entry(u.id), month, d.data?.extras ?? null, release?.released?.issuer_code ?? null);
    showToast(L("Saved", "Disimpan"), `${L("Payslip ready to send", "Slip gaji sedia untuk dihantar")} — ${displayName(u)} ${month}`);
  };

  /* ================= v1.198.0 - THE FIVE TABS =================
     The owner, 23-10-2026, with a mockup: Overview, Payroll Processing,
     Payslips, Reports & Export, Settings & Audit. Every zone is rendered and
     the closed ones are hidden (pp.off), so a figure typed in Processing
     survives a look at Reports. Nothing below computes pay: every figure is
     entry(), netFor(), incFor(), otPay() or the server's unpaidInfo, exactly
     as the table always used them; the month totals are the same reduce. */
  const figs = (u: StaffRow) => {
    const e = entry(u.id);
    const hourlyRow = isHourly(u);
    const ud = unpaidInfo[u.id];
    return {
      hourlyRow,
      basic: hourlyRow ? (e.hourly_pay_live ?? e.basic_cents) : e.basic_cents,
      ph: ud?.ph_worked_cents ?? 0,
      comm: e.commission_cents,
      allow: e.allowance_cents,
      ot: hourlyRow ? 0 : otPay(e.basic_cents, e.ot_hours),
      manual: e.deduction_cents,
      ul: hourlyRow ? 0 : (ud?.cents ?? 0),
      adj: hourlyRow ? 0 : incFor(u.id, e.basic_cents),
      advance: ud?.salary_advance_cents ?? 0,
      net: netFor(u.id),
    };
  };
  /* v1.4.75: month totals — the final amount at a glance. Live: they update
     as figures are typed, before saving. The reduce is the one the TOTAL row
     always used, now computed once for the row, the Overview and Reports. */
  const tot = staff.reduce(
    (a, u) => {
      const e = entry(u.id);
      if (isHourly(u)) {
        // v1.4.183: hourly rows — clocked pay, no UL/proration/OT
        const hp = e.hourly_pay_live ?? e.basic_cents;
        const phH = unpaidInfo[u.id]?.ph_worked_cents ?? 0;
        const advance = unpaidInfo[u.id]?.salary_advance_cents ?? 0;
        a.basic += hp; a.ph += phH; a.comm += e.commission_cents; a.allow += e.allowance_cents;
        a.ded += e.deduction_cents + advance;
        a.net += netFor(u.id); // v1.207.0 - THE formula (netFor), not a second copy of it
        return a;
      }
      const ulDed = unpaidInfo[u.id]?.cents ?? 0;
      const adj = incFor(u.id, e.basic_cents);
      const ot = otPay(e.basic_cents, e.ot_hours);
      const phW = unpaidInfo[u.id]?.ph_worked_cents ?? 0;
      const advance = unpaidInfo[u.id]?.salary_advance_cents ?? 0;
      a.basic += e.basic_cents; a.ph += phW; a.comm += e.commission_cents;
      a.allow += e.allowance_cents; a.ot += ot; a.ded += e.deduction_cents + ulDed + adj + advance;
      a.net += netFor(u.id); // v1.207.0 - THE formula (netFor), not a second copy of it
      return a;
    },
    { basic: 0, ph: 0, comm: 0, allow: 0, ot: 0, ded: 0, net: 0 },
  );
  /* the deductions, by kind - the same per-row figures, summed for Reports */
  const dedBy = staff.reduce((a, u) => {
    const f = figs(u);
    a.manual += f.manual; a.ul += f.ul; a.adj += f.adj; a.advance += f.advance;
    return a;
  }, { manual: 0, ul: 0, adj: 0, advance: 0 });

  /* each row's state, against what was loaded (the pristine snapshot) */
  const isDirty = (id: number) => fingerprint(id) !== pristine[id];
  const rowState = (id: number): "dirty" | "new" | "released" | "saved" =>
    isDirty(id) ? "dirty" : !savedIds.includes(id) ? "new" : release?.released ? "released" : "saved";
  const dirtyCount = loaded ? staff.filter((u) => isDirty(u.id)).length : 0;
  const savedCount = loaded ? staff.filter((u) => savedIds.includes(u.id)).length : 0;
  const stateChip = (id: number) => {
    const s = rowState(id);
    return s === "dirty" ? <span className={chipWarn}>{L("Unsaved", "Belum disimpan")}</span>
      : s === "new" ? <span className={chipNeutral}>{L("Not saved", "Belum disimpan")}</span>
      : s === "released" ? <span className={chipSuccess}>{L("Released", "Dikeluarkan")}</span>
      : <span className={chipInfo}>{L("Saved", "Disimpan")}</span>;
  };

  /* what needs a look before the run is paid - only what the screen already knew */
  const noClockDays = absences.reduce((n, a) => n + a.missing.length, 0);
  const shortDays = absences.reduce((n, a) => n + a.short.length, 0);
  const datesWrong = staff.filter((u) => unpaidInfo[u.id]?.clocked_beyond_employment);
  const offBase = staff.filter((u) => !isHourly(u) && (base[u.id] ?? 0) > 0 && entry(u.id).basic_cents !== base[u.id]);
  const m2eIncomplete = m2eHasTpl === false || !m2eCid || !m2eAcc || !m2eCbid;
  const releaseAt = release ? `${dmy(release.available_from)} ${(release.available_from.split(" ")[1] ?? "").slice(0, 5)} MYT` : "";
  const monthLabel = monthName(month);
  const detailUser = detailId === null ? null : staff.find((x) => x.id === detailId) ?? null;
  /* v1.207.0 - the month history (saved entries per month; payroll-history.tsx) */
  const history = usePayrollHistory(month, histWanted);
  /* rows the bank file will not price from a saved net: saved without one
     (it would use its older fallback) or not saved at all (not in the file) */
  const noNetRows = loaded ? staff.filter((u) => savedIds.includes(u.id) && noNetIds.includes(u.id)) : [];
  const notSavedRows = loaded ? staff.filter((u) => !savedIds.includes(u.id)) : [];
  /* net pay by department, from netFor - the By Department table's own reduce */
  const byDept = Object.entries(staff.reduce<Record<string, { n: number; net: number }>>((m, u) => {
    const k = u.department || L("No department", "Tiada jabatan");
    const cur = m[k] ?? { n: 0, net: 0 };
    m[k] = { n: cur.n + 1, net: cur.net + Math.max(0, netFor(u.id)) };
    return m;
  }, {})).sort((a, b) => b[1].net - a[1].net);
  const deptMax = Math.max(1, ...byDept.map(([, v]) => v.net));
  /* what the month pays out before deductions, by kind - the TOTAL row's figures */
  const costSlices = [
    { label: L("Basic salary", "Gaji pokok"), value: tot.basic, color: "var(--primary)" },
    { label: L("Public holidays worked", "Cuti umum bekerja"), value: tot.ph, color: "var(--info)" },
    { label: L("Commission", "Komisen"), value: tot.comm, color: "var(--purple, #7c3aed)" },
    { label: L("Allowances", "Elaun"), value: tot.allow, color: "var(--success)" },
    { label: L("Overtime", "OT"), value: tot.ot, color: "var(--gold-solid)" },
  ].filter((x) => x.value > 0);
  const grossTot = costSlices.reduce((a, x) => a + x.value, 0);
  const prNeedle = prQ.trim().toLowerCase();
  const prDepts = [...new Set(staff.map((u) => u.department || "").filter(Boolean))].sort();
  const prMatch = (u: StaffRow) => (!prNeedle || [displayName(u), u.employee_id ?? "", u.position ?? "", u.department ?? ""].some((t) => t.toLowerCase().includes(prNeedle)))
    && (!prDept || (u.department ?? "") === prDept);

  /* v1.198.0 - "Do not create or send payment files without the
     appropriate approval": both bank files ask first, with the month, the
     head count and the net on screen, and say what the file is built from. */
  const confirmPaymentFile = (kind: "m2e" | "csv") => payConfirm({
    title: kind === "m2e"
      ? L(`Download the M2E salary file for ${monthLabel}?`, `Muat turun fail gaji M2E untuk ${monthLabel}?`)
      : L(`Download the payment CSV for ${monthLabel}?`, `Muat turun CSV pembayaran untuk ${monthLabel}?`),
    message: L(
      `${staff.length} staff · net ${rm(tot.net)} on screen.\nThe file is built from the SAVED payroll entries${dirtyCount > 0 ? ` — ${dirtyCount} row${dirtyCount === 1 ? " has" : "s have"} unsaved changes that will NOT be in it until you Save all` : ""}.${noNetRows.length > 0 ? `\n${noNetRows.length} saved row${noNetRows.length === 1 ? " has" : "s have"} no saved net and would be priced with an older formula — save ${noNetRows.length === 1 ? "it" : "them"} first.` : ""}\nUpload it to Maybank only once this payroll has been approved.`,
      `${staff.length} kakitangan · bersih ${rm(tot.net)} pada skrin.\nFail ini dibina daripada entri gaji yang DISIMPAN${dirtyCount > 0 ? ` — ${dirtyCount} baris mempunyai perubahan belum disimpan yang TIDAK akan dimasukkan sehingga anda Simpan semua` : ""}.\nMuat naik ke Maybank hanya selepas gaji ini diluluskan.`,
    ),
    confirmLabel: L("Download", "Muat turun"),
  });
  const downloadCsv = async () => {
    if (!(await confirmPaymentFile("csv"))) return;
    const a = document.createElement("a");
    a.href = `${API}/payroll/payment-file?month=${month}`;
    a.download = "";
    a.click();
  };

  const head = (icon: AppIconName, tone: string | undefined, title: string, sub?: ReactNode, action?: ReactNode) => (
    <div className={pp.head}>
      <div className={pp.lead}>
        <span className={`${pp.well} ${tone ?? ""}`}><AppIcon name={icon} /></span>
        <div className={pp.headText}>
          <p className={pp.title}>{title}</p>
          {sub && <p className={pp.sub}>{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );

  return (
    <TabPage>
      {toastNode}
      {payConfirmNode}
      <LineTabs value={view} onChange={(k) => go(k)} label={L("Payroll", "Gaji")} tabs={[
        ["overview", L("Overview", "Gambaran")],
        ["process", L("Payroll Processing", "Pemprosesan Gaji")],
        ["payslips", L("Payslips", "Slip Gaji")],
        ["reports", L("Reports & Export", "Laporan & Eksport")],
        ["settings", L("Settings & Audit", "Tetapan & Audit")],
      ] as const} aside={
        <label className={pp.monthPick}>
          <AppIcon name="date" />
          <input
            type="month"
            aria-label={L("Payroll month", "Bulan gaji")}
            value={month}
            onChange={(e) => { if (e.target.value) setMonth(e.target.value); }}
          />
        </label>
      } />

      {/* ============================== OVERVIEW ============================== */}
      <TabZone label={L("Overview", "Gambaran")} className={view !== "overview" ? pp.off : ""}>
        <div className={pp.kpis}>
        <KpiRow label={L(`Payroll at a glance — ${monthLabel}`, `Gaji sepintas lalu — ${monthLabel}`)}>
          <KpiTile icon="users" tone="gold" label={L("Total Staff", "Jumlah Kakitangan")} busy={!loaded}
            value={staff.length}
            sub={L(`${staff.filter((u) => isHourly(u)).length} paid by the hour`, `${staff.filter((u) => isHourly(u)).length} dibayar ikut jam`)} />
          <KpiTile icon="money" tone="green" label={L("Total Payroll (Net)", "Jumlah Gaji (Bersih)")} busy={!loaded}
            value={rm(tot.net)}
            sub={dirtyCount > 0 ? L(`Includes ${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`, `Termasuk ${dirtyCount} perubahan belum disimpan`) : monthLabel} />
          <KpiTile icon="date" tone="blue" label={L("Payslip Date", "Tarikh Slip Gaji")} busy={!release}
            value={release ? dmy(release.available_from) : "—"}
            sub={release?.released ? L("Released early", "Dikeluarkan awal") : L(`Available from ${(release?.available_from.split(" ")[1] ?? "").slice(0, 5)} MYT`, `Tersedia dari ${(release?.available_from.split(" ")[1] ?? "").slice(0, 5)} MYT`)} />
          <KpiTile icon="time" tone="gold" label={L("Working Days", "Hari Bekerja")} busy={!loaded}
            value={monthDays}
            sub={calendarBasis ? L(`Prorated on ${proration?.month_days} calendar days`, `Prorata pada ${proration?.month_days} hari kalendar`) : monthLabel} />
          <KpiTile icon="document" tone="purple" label={L("Payslips Released", "Slip Gaji Dikeluarkan")} busy={!loaded}
            value={`${release?.released ? staff.length : 0} / ${staff.length}`}
            sub={release?.released ? L("100% released", "100% dikeluarkan") : L("0% released", "0% dikeluarkan")} />
        </KpiRow>
        </div>

        {loaded && (noClockDays + shortDays + waitingOnLeave + datesWrong.length + offBase.length + dirtyCount > 0 || release?.employer_is_legacy) && (
          <div className={`${card} ${pp.alert}`} role="status">
            <span className={`${pp.well} ${pp.goldWell}`}><AppIcon name="warning" /></span>
            <div className={pp.alertBody}>
              <p className={pp.title}>{L("Needs your review before this run is paid", "Perlu semakan anda sebelum gaji ini dibayar")}</p>
              <ul className={pp.alertList}>
                {canMarkUnpaid && noClockDays + shortDays > 0 && (
                  <li>{L(`Days with no clock-in — not deducted unless you say so: ${noClockDays} with no clock-in, ${shortDays} short, across ${absences.length} staff.`,
                         `Hari tanpa daftar masuk — tidak dipotong melainkan anda tetapkan: ${noClockDays} tanpa daftar masuk, ${shortDays} pendek, untuk ${absences.length} kakitangan.`)}</li>
                )}
                {canMarkUnpaid && waitingOnLeave > 0 && (
                  <li>{L(`${waitingOnLeave} day${waitingOnLeave === 1 ? "" : "s"} waiting on a leave decision — decide the leave first.`, `${waitingOnLeave} hari menunggu keputusan cuti — putuskan cuti dahulu.`)}</li>
                )}
                {datesWrong.length > 0 && (
                  <li>{L("Clock-ins outside the employment dates — check the staff record: ", "Daftar masuk di luar tarikh pekerjaan — semak rekod kakitangan: ")}<span data-no-translate>{datesWrong.map((u) => displayName(u)).join(", ")}</span></li>
                )}
                {offBase.length > 0 && (
                  <li>{L("Basic differs from the base salary: ", "Gaji pokok berbeza daripada gaji asas: ")}<span data-no-translate>{offBase.map((u) => displayName(u)).join(", ")}</span></li>
                )}
                {dirtyCount > 0 && (
                  <li>{L(`${dirtyCount} row${dirtyCount === 1 ? " has" : "s have"} changes not saved yet — the payslip, the bank file and Expenses read the saved figures.`, `${dirtyCount} baris mempunyai perubahan belum disimpan — slip gaji, fail bank dan Perbelanjaan membaca angka yang disimpan.`)}</li>
                )}
                {release?.employer_is_legacy && (
                  <li>{L("This month was released without an employer stamp — see Settings & Audit.", "Bulan ini dikeluarkan tanpa cap majikan — lihat Tetapan & Audit.")}</li>
                )}
              </ul>
            </div>
            <button type="button" className={btnSm} onClick={() => go("process", canMarkUnpaid && absences.length > 0 ? "payroll-absences" : "payroll-table")}>
              {L("Review attendance", "Semak kehadiran")}
            </button>
          </div>
        )}

        <div className={pp.split}>
          <section className={card} aria-label={L("Payroll summary", "Ringkasan gaji")}>
            {head("money", pp.greenWell, L("Payroll Summary", "Ringkasan Gaji"), L(`${monthLabel} — live, as the table reads now`, `${monthLabel} — langsung, seperti jadual sekarang`))}
            {!loaded ? <SkelRows rows={6} /> : (
              <dl className={pp.statement}>
                <div><dt>{L("Basic salary", "Gaji pokok")}</dt><dd>{rm(tot.basic)}</dd></div>
                {tot.ph > 0 && <div><dt>{L("Public holidays worked", "Cuti umum bekerja")}</dt><dd>{rm(tot.ph)}</dd></div>}
                {tot.comm > 0 && <div><dt>{L("Commission (paid months only)", "Komisen (bulan dibayar sahaja)")}</dt><dd>{rm(tot.comm)}</dd></div>}
                <div><dt>{L("Allowances", "Elaun")}</dt><dd>{rm(tot.allow)}</dd></div>
                <div><dt>{L("Overtime", "OT")}</dt><dd>{rm(tot.ot)}</dd></div>
                <div className={tot.ded > 0 ? pp.minus : ""}><dt>{L("Deductions", "Potongan")}</dt><dd>{tot.ded > 0 ? `− ${rm(tot.ded)}` : rm(0)}</dd></div>
                <div className={pp.total}><dt>{L("Net pay", "Gaji bersih")}</dt><dd>{rm(tot.net)}</dd></div>
              </dl>
            )}
          </section>

          <section className={card} aria-label={L("Payroll timeline", "Garis masa gaji")}>
            {head("orders", pp.blueWell, L("Payroll Timeline", "Garis Masa Gaji"), L("Where this month's run stands", "Kedudukan larian bulan ini"))}
            <ol className={pp.steps}>
              {[
                { t: L("Calculate payroll", "Kira gaji"), s: L("Basic, allowance, OT and deductions", "Pokok, elaun, OT dan potongan"),
                  done: loaded && savedCount === staff.length && dirtyCount === 0,
                  note: loaded ? L(`${savedCount} of ${staff.length} saved`, `${savedCount} daripada ${staff.length} disimpan`) : "" },
                { t: L("Review & adjust", "Semak & laras"), s: L("Attendance, leave and adjustments", "Kehadiran, cuti dan pelarasan"),
                  done: loaded && noClockDays + shortDays + waitingOnLeave + datesWrong.length + offBase.length + dirtyCount === 0,
                  note: loaded ? (noClockDays + shortDays + waitingOnLeave + datesWrong.length + offBase.length + dirtyCount === 0 ? L("Nothing to review", "Tiada untuk disemak") : L("Needs review", "Perlu disemak")) : "" },
                { t: L("Generate payslips", "Jana slip gaji"), s: L("Preview and send as PDF", "Pratonton dan hantar sebagai PDF"),
                  done: loaded && savedCount === staff.length && dirtyCount === 0,
                  note: loaded && savedCount === staff.length && dirtyCount === 0 ? L("Ready", "Sedia") : L("After every row is saved", "Selepas setiap baris disimpan") },
                { t: L("Release to staff", "Keluarkan kepada kakitangan"), s: L("Payslips available in the staff portal", "Slip gaji tersedia dalam portal kakitangan"),
                  done: !!release?.released,
                  note: release?.released ? L("Released", "Dikeluarkan") : releaseAt },
              ].map((st, i) => (
                <li key={st.t} className={`${pp.step} ${st.done ? pp.stepDone : ""}`}>
                  <span className={pp.stepNo} aria-hidden="true">{st.done ? <AppIcon name="success" /> : i + 1}</span>
                  <span className={pp.stepText}><strong>{st.t}</strong><span>{st.s}</span></span>
                  <span className={pp.stepNote}>{st.note}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* v1.207.0 - the month's cost by kind and by department: the TOTAL
            row's own figures and the By Department reduce, drawn */}
        <div className={pp.split}>
          <section className={card} aria-label={L("Payroll cost breakdown", "Pecahan kos gaji")}>
            {head("chart", pp.goldWell, L("Payroll Cost Breakdown", "Pecahan Kos Gaji"), L(`${monthLabel} — what the month pays before deductions`, `${monthLabel} — yang dibayar bulan ini sebelum potongan`))}
            {!loaded ? <SkelRows rows={5} /> : grossTot === 0 ? <p className={pp.sub}>{L("Nothing on the table yet for this month.", "Belum ada apa-apa dalam jadual bulan ini.")}</p> : (
              <div className={pp.donutRow}>
                <Donut slices={costSlices} centerLabel={(grossTot / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })} centerSub={L("RM gross", "RM kasar")} size={150} hideLegend />
                <ul className={pp.legend}>
                  {costSlices.map((x) => (
                    <li key={x.label}><span className={pp.legendDot} style={{ background: x.color }} aria-hidden="true" /><span>{x.label}</span><strong>{Math.round((x.value * 1000) / grossTot) / 10}%</strong><span className={pp.legendAmt}>{rm(x.value)}</span></li>
                  ))}
                  <li className={pp.legendMinus}><span className={pp.legendDot} aria-hidden="true" /><span>{L("Deductions", "Potongan")}</span><strong /><span className={pp.legendAmt}>{tot.ded > 0 ? `− ${rm(tot.ded)}` : rm(0)}</span></li>
                </ul>
              </div>
            )}
          </section>
          <section className={card} aria-label={L("Department payroll cost", "Kos gaji jabatan")}>
            {head("users", pp.blueWell, L("Department Payroll Cost", "Kos Gaji Jabatan"), L(`${monthLabel} — net pay by department`, `${monthLabel} — gaji bersih mengikut jabatan`))}
            {!loaded ? <SkelRows rows={4} /> : (
              <ul className={pp.bars}>
                {byDept.map(([k, v]) => (
                  <li key={k}>
                    <span className={pp.barName}>{k}<span>{v.n} {L("staff", "kakitangan")}</span></span>
                    <span className={pp.barTrack} aria-hidden="true"><span className={pp.barFill} style={{ width: `${(v.net / deptMax) * 100}%` }} /></span>
                    <span className={pp.barAmt}>{rm(v.net)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={pp.split}>
          <section className={card} aria-label={L("Quick actions", "Tindakan pantas")}>
            {head("fast", pp.goldWell, L("Quick Actions", "Tindakan Pantas"))}
            <div className={pp.quick}>
              {!readOnly && <button type="button" className={pp.qa} onClick={() => go("settings", "payroll-base")}><span className={`${pp.qaIcon} ${pp.purpleWell}`}><AppIcon name="money" /></span><span><strong>{L("Base salaries", "Gaji asas")}</strong><span>{L("Update staff base pay", "Kemas kini gaji asas")}</span></span></button>}
              <button type="button" className={pp.qa} onClick={() => go("process", "payroll-tools")}><span className={`${pp.qaIcon} ${pp.blueWell}`}><AppIcon name="date" /></span><span><strong>{L("Re-fill days", "Isi semula hari")}</strong><span>{L("Days worked from clock-ins", "Hari bekerja daripada daftar masuk")}</span></span></button>
              <button type="button" className={pp.qa} onClick={() => go("process", "payroll-tools")}><span className={`${pp.qaIcon} ${pp.goldWell}`}><AppIcon name="fix" /></span><span><strong>{L("Recompute nets", "Kira semula bersih")}</strong><span>{L("After a calendar change", "Selepas perubahan kalendar")}</span></span></button>
              <button type="button" className={pp.qa} onClick={() => go("reports", "payroll-export")}><span className={`${pp.qaIcon} ${pp.greenWell}`}><AppIcon name="download" /></span><span><strong>{L("Export", "Eksport")}</strong><span>{L("M2E salary file and CSV", "Fail gaji M2E dan CSV")}</span></span></button>
            </div>
          </section>
          <section className={card} aria-label={L("Helpful information", "Maklumat berguna")}>
            {head("info", pp.blueWell, L("Helpful Information", "Maklumat Berguna"))}
            <ul className={pp.links}>
              <li><button type="button" onClick={() => go("settings", "pay-cfg-calc")}>{L("Payroll calculation details", "Butiran pengiraan gaji")}</button></li>
              <li><button type="button" onClick={() => go("settings", "pay-cfg-rates")}>{L("How OT and deductions work", "Cara OT dan potongan berfungsi")}</button></li>
              <li><button type="button" onClick={() => go("process", canMarkUnpaid && absences.length > 0 ? "payroll-absences" : "payroll-table")}>{L("Days with no clock-in policy", "Polisi hari tanpa daftar masuk")}</button></li>
              <li><button type="button" onClick={() => go("payslips", "payroll-release")}>{L("Payslip release and access", "Keluaran dan akses slip gaji")}</button></li>
              <li><button type="button" onClick={() => go("settings", "pay-cfg-rates")}>{L("Employment Act reference", "Rujukan Akta Kerja")}</button></li>
            </ul>
          </section>
        </div>
      </TabZone>

      {/* ========================= PAYROLL PROCESSING ========================= */}
      <TabZone label={L("Payroll processing", "Pemprosesan gaji")} className={view !== "process" ? pp.off : ""}>
      <div id="payroll-absences">
      {canMarkUnpaid && !readOnly && absences.length > 0 && (
        <div className="border-warning/40 bg-warning-soft/40 mt-3 rounded-xl border p-3">
          <p className="text-sm font-semibold">
            {L("Days with no clock-in — not deducted unless you say so", "Hari tanpa daftar masuk — tidak dipotong melainkan anda tetapkan")}
          </p>
          {/* v1.145.0 (CEO: "on payrolls, should check if there is any apply
              leave pending before judgement") — said at the top, because it
              is a reason to stop and go to the Leave tab, not a footnote. */}
          {waitingOnLeave > 0 && (
            <p className="text-warning mt-1 text-xs font-semibold">
              {L(`${waitingOnLeave} day${waitingOnLeave === 1 ? "" : "s"} here are waiting on a leave decision — decide the leave first, then this list is right.`,
                 `${waitingOnLeave} hari di sini menunggu keputusan cuti — putuskan cuti dahulu, barulah senarai ini betul.`)}
            </p>
          )}
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Working days in this month with no clock-in and no approved leave, and days clocked short of the hours that person's schedule owes — the unpaid break is already taken off, so a 10:00–18:00 day owes 7 hours, not 8. Marking one records it as unpaid leave, deducted at one calendar day of the month's wage (monthly wage ÷ the days in that month, Employment Act s.18A; 1/26 for months before September 2026) — a short day is charged only for the hours missed, rounded to a quarter day.", "Hari bekerja dalam bulan ini tanpa daftar masuk dan tanpa cuti diluluskan, serta hari yang kurang daripada jam yang dijadualkan untuk orang itu — rehat tanpa gaji sudah ditolak, jadi hari 10:00–18:00 memerlukan 7 jam, bukan 8. Menandakannya merekodkannya sebagai cuti tanpa gaji, dipotong pada satu hari kalendar daripada gaji bulan itu (gaji bulanan ÷ bilangan hari bulan itu, Akta Kerja s.18A; 1/26 bagi bulan sebelum September 2026) — hari pendek dikenakan hanya untuk jam yang kurang, dibundarkan kepada suku hari.")}
          </p>
          <div className="mt-2 space-y-2">
            {absences.map((a) => (
              <div key={a.user_id} className="text-xs">
                <span className="font-medium">{a.name}</span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {(a.partial_review ?? []).map((p) => (
                    <span key={`partial-${p.d}`} className={chipNeutral}>
                      {dmy(p.d)} · {p.unresolved ? L("Partial leave: coverage needs review", "Cuti separa: tempoh perlu disemak") : L("Half-day: review remaining attendance", "Separuh hari: semak baki kehadiran")}
                    </span>
                  ))}
                  {a.missing.map((d) => (
                    <button key={d} type="button" disabled={marking === `${a.user_id}|${d}`}
                      className="border-border hover:bg-secondary rounded-full border bg-white/60 px-2 py-0.5 disabled:opacity-50 dark:bg-transparent"
                      title={L(`Mark ${d} as a full unpaid day`, `Tanda ${d} sebagai hari tanpa gaji penuh`)}
                      onClick={() => void markUnpaid(a.user_id, d)}>
                      {d.slice(8)}/{d.slice(5, 7)} · {L("no clock-in", "tiada masuk")}
                    </button>
                  ))}
                  {/* v1.145.0 - waiting on a decision: shown, named, and not a
                      button. Deducting a day somebody has applied for answers
                      their application by ignoring it. */}
                  {(a.pending ?? []).map((pw) => (
                    <span key={`p${pw.d}`}
                      className="border-warning text-warning rounded-full border border-dashed px-2 py-0.5"
                      title={L(`${pw.type} leave applied for this day and still waiting on a decision — decide it on the Leave tab`, `Cuti ${pw.type} dipohon untuk hari ini dan masih menunggu keputusan — putuskan di tab Cuti`)}>
                      {pw.d.slice(8)}/{pw.d.slice(5, 7)} · {L(`${pw.type} leave pending`, `cuti ${pw.type} menunggu`)}
                    </span>
                  ))}
                  {a.short.map((sh) => (
                    <button key={sh.d} type="button" disabled={marking === `${a.user_id}|${sh.d}`}
                      className="border-border hover:bg-secondary rounded-full border bg-white/60 px-2 py-0.5 disabled:opacity-50 dark:bg-transparent"
                      title={L(`Clocked ${sh.hours}h of the ${sh.of ?? 8}h this day owes${(sh.break_minutes ?? 0) > 0 ? ` (schedule less a ${sh.break_minutes}-minute unpaid break)` : ""} — mark the missing hours unpaid`, `Direkod ${sh.hours}j daripada ${sh.of ?? 8}j yang diperlukan hari ini${(sh.break_minutes ?? 0) > 0 ? ` (jadual tolak rehat tanpa gaji ${sh.break_minutes} minit)` : ""} — tanda jam yang kurang sebagai tanpa gaji`)}
                      onClick={() => void markUnpaid(a.user_id, sh.d, sh.hours)}>
                      {sh.d.slice(8)}/{sh.d.slice(5, 7)} · {sh.hours}h/{sh.of ?? 8}h
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    <div className={card}>
      <div className={pp.head}>
        <div className={pp.lead}>
          <div className={pp.headText}>
            <p className={pp.title}>{L("Staff Payroll Details", "Butiran Gaji Kakitangan")}</p>
            <p className={pp.sub}>
              {L(`Review and process payroll for ${monthLabel}.`, `Semak dan proses gaji untuk ${monthLabel}.`)}{" "}
              {release && !release.released && L(`Staff can view their payslips from ${releaseAt}.`, `Kakitangan boleh melihat slip gaji dari ${releaseAt}.`)}
            </p>
          </div>
        </div>
        <div id="payroll-tools" className={pp.tools}>
          <label className={pp.field} title={L("Computed automatically: Monday–Friday minus every holiday on the company calendar (public, replacement and company days). Edit only for exceptions.", "Dikira secara automatik: Isnin–Jumaat tolak setiap cuti pada kalendar syarikat (cuti umum, gantian dan hari syarikat). Sunting hanya untuk pengecualian.")}>
            <span>{L("Working days (auto)", "Hari bekerja (auto)")}</span>
            <input
              type="number" min={1} max={31}
              className={`${inputClassSm} ${pp.daysBox}`}
              value={monthDays}
              onChange={(e) => setMonthDays(Math.max(1, Number(e.target.value)))}
            />
          </label>
          {!readOnly && (
            <button
              type="button"
              className={btnSm}
              title={L("Fixed monthly basic per staff — auto-fills every month; adjust here on increment", "Gaji pokok bulanan tetap bagi setiap kakitangan — terisi automatik setiap bulan; laraskan di sini apabila ada kenaikan")}
              onClick={() => go("settings", "payroll-base")}
            >
              {L("Base salaries", "Gaji asas")}
            </button>
          )}
          <button
            type="button"
            className={btnSm}
            title={L("Days already auto-fill from attendance on load — this re-fills every box from clock-ins, overwriting manual edits", "Hari sudah terisi automatik daripada kehadiran semasa dimuat — ini mengisi semula setiap kotak daripada rekod daftar masuk, menulis ganti suntingan manual")}
            onClick={autoFillDays}
          >
            {L("Re-fill days", "Isi semula hari")}
          </button>
          <button
            type="button"
            className={btnSm}
            title={L("Server-side repair: recomputes this month's working days from the holiday calendar and re-stores every saved entry's net — use after any calendar change", "Pembaikan di pelayan: mengira semula hari bekerja bulan ini daripada kalendar cuti dan menyimpan semula bersih setiap entri yang disimpan — guna selepas sebarang perubahan kalendar")}
            onClick={async () => {
              const r = await postPay(`/payroll/recompute`, { month });
              if (r.ok) showToast(L("Saved", "Disimpan"), L(`Recomputed ${r.data?.rows ?? 0} entries at ${r.data?.working_days ?? "?"} working days`, `${r.data?.rows ?? 0} entri dikira semula pada ${r.data?.working_days ?? "?"} hari bekerja`));
              else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Recompute failed", "Kira semula gagal"), "notice");
              void load();
            }}
          >
            <><AppIcon name="fix" />{L("Recompute nets", "Kira semula bersih")}</>
          </button>
        </div>
      </div>
      {msg && <p className={pp.okMsg}>{msg}</p>}

      {/* v1.183.0 - COMMISSION IS RETIRED FROM PAY (the owner, 22-10-2026,
          with the Commission tab). The "Pull approved commission" button
          and the COMMISSION column are gone: no new month can carry a
          commission figure. `commission_cents` stays in the record and in
          every net formula, so a month that was paid with commission keeps
          its net and its payslip line; a new month holds 0. The worker's
          /payroll/pull-commission and the commission routes are dormant. */}

      {/* v1.176.1 - ONE SCROLLER, SIDEWAYS. The owner, 22-09-2026: "payroll
          tabs like that stuck". The register is a record, not a widget: the
          page scrolls it, and only the money slides sideways past the pinned
          name column. `.erp-table-scroll` is the system's name for that. */}
      {/* v1.207.0 - find a person; the TOTAL row stays the whole month */}
      <div className={pp.filters}>
        <label className={pp.searchField}>
          <AppIcon name="search" />
          <input value={prQ} onChange={(e) => setPrQ(e.target.value)} placeholder={L("Find staff by name, ID or position", "Cari kakitangan ikut nama, ID atau jawatan")} aria-label={L("Find staff in payroll", "Cari kakitangan dalam gaji")} />
        </label>
        <select className={inputClassSm} value={prDept} onChange={(e) => setPrDept(e.target.value)} aria-label={L("Department", "Jabatan")}>
          <option value="">{L("All departments", "Semua jabatan")}</option>
          {prDepts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {(prQ || prDept) && <span className={pp.sub}>{L(`Showing ${staff.filter(prMatch).length} of ${staff.length} — the TOTAL row is still the whole month`, `Memaparkan ${staff.filter(prMatch).length} daripada ${staff.length} — baris JUMLAH masih seluruh bulan`)}</span>}
      </div>
      <div id="payroll-table" className={`erp-table-scroll erp-mt-3 ${pp.tableWrap}`}>
        <table className="tbl-sticky tbl-sticky-lead w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className={pp.headRow}>
              {([
                ["staff", L("Staff", "Kakitangan")],
                ["basic", L("Basic (RM)", "Gaji pokok (RM)")],
                ["allow", L("Allowance", "Elaun")],
                ["comm", L("Sales Commission (RM)", "Komisen Jualan (RM)")],
                /* v1.176.1 - SAY WHICH DEDUCTION THIS IS: the MANUAL
                   late/other deduction. The automatic ones - unpaid leave,
                   incomplete month, salary advance - are computed by the
                   server and itemised under Net. */
                ["deduct", L("Deduction (manual)", "Potongan (manual)")],
                ["days", L("Days", "Hari")],
                ["net", L("Net", "Bersih")],
                ["status", L("Status", "Status")],
                ["actions", L("Actions", "Tindakan")],
              ] as [PrCol | "days" | "status" | "actions", string][]).map(([col, label]) => (col === "days" || col === "status" || col === "actions") ? (
                <th key={col} className={pp.th}>{label}</th>
              ) : (
                <th key={col} className={`${pp.th} ${pp.sortable}`}
                  aria-sort={prSort.col === col ? (prSort.asc ? "ascending" : "descending") : undefined}
                  title={col === "comm" ? L("Sales commission - read-only. It counts only invoices the CEO/COO confirmed as paid in full; no commission policy is set yet, so nothing is calculated.\nSort by commission - click again to reverse", "Komisen jualan - baca sahaja. Hanya invois yang disahkan dibayar penuh oleh CEO/COO dikira; tiada polisi komisen lagi, jadi tiada apa dikira.\nIsih ikut komisen - klik lagi untuk terbalik") : L(`Sort by ${label} — click again to reverse`, `Isih ikut ${label} — klik lagi untuk terbalik`)}
                  onClick={() => cyclePr(col)}>
                  {label}{prSort.col === col ? (prSort.asc ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* v1.77.0 — skeleton until the first fetch lands, in the real
                column shape so nothing jumps when the figures land. */}
            {!loaded ? Array.from({ length: 6 }, (_, i) => (
              <tr key={`skel-${i}`} className={pp.row} aria-hidden>
                <td className={pp.td}><Skel className="h-4 w-32 max-w-full" /></td>
                <td className={pp.td}><Skel className="h-7 w-24" /></td>
                <td className={pp.td}><Skel className="h-7 w-24" /></td>
                <td className={pp.td}><Skel className="h-7 w-16" /></td>
                <td className={pp.td}><Skel className="h-7 w-24" /></td>
                <td className={pp.td}><Skel className="h-7 w-16" /></td>
                <td className={pp.td}><Skel className="h-4 w-20" /></td>
                <td className={pp.td}><Skel className="h-5 w-16" /></td>
                <td className={pp.td}><Skel className="h-7 w-32" /></td>
              </tr>
            )) : [...staff].filter(prMatch).sort((a, b) => {
              const dir = prSort.asc ? 1 : -1;
              const ea = entry(a.id);
              const eb = entry(b.id);
              switch (prSort.col) {
                case "rank": return dir * bySeniority(a, b);
                case "staff": return dir * displayName(a).localeCompare(displayName(b));
                case "basic": return dir * (ea.basic_cents - eb.basic_cents);
                case "allow": return dir * (ea.allowance_cents - eb.allowance_cents);
                case "comm": return dir * ((ea.commission_cents || 0) - (eb.commission_cents || 0));
                case "deduct": return dir * (ea.deduction_cents - eb.deduction_cents);
                case "net": return dir * (netFor(a.id) - netFor(b.id));
                default: return 0;
              }
            }).map((u) => {
              const e = entry(u.id);
              const hourlyRow = isHourly(u); // v1.4.183
              const hourlyMins = e.hourly_minutes_live ?? e.hourly_minutes ?? 0;
              const hourlyPay = e.hourly_pay_live ?? (hourlyRow ? e.basic_cents : 0);
              // hourly rows: no unpaid-leave maths, no proration, no OT.
              const ul = hourlyRow ? 0 : (unpaidDays[u.id] ?? 0);
              const ud = unpaidInfo[u.id];
              const ulDed = hourlyRow ? 0 : (ud?.cents ?? 0);
              const advance = ud?.salary_advance_cents ?? 0;
              const adj = hourlyRow ? 0 : incFor(u.id, e.basic_cents);
              const ot = hourlyRow ? 0 : otPay(e.basic_cents, e.ot_hours);
              const net = netFor(u.id);
              return (
                <tr key={u.id} className={`${pp.row} ${isDirty(u.id) ? pp.rowDirty : ""}`}>
                  <td className={`${pp.td} ${pp.staffCell}`}>
                    {/* v1.4.260: the payroll row names the person the way the
                        payslip and the bank file do. v1.79.0: the NAME never
                        breaks - the title underneath may. */}
                    <span className={pp.who}>
                      <Avatar name={displayName(u)} photoKey={u.photo_key} size="sm" />
                      <span className={pp.whoText}>
                        <span className={pp.whoName}>{displayName(u)}</span>
                        <span className={pp.whoRole}>
                          {u.position ?? u.role}
                          {hourlyRow && <span className={`${chipWarn} ${pp.chipTight}`} title={L("Part-time live host — paid by the hour, RM15.00/h on clocked time; no OT","Hos siaran langsung separuh masa — dibayar mengikut jam, RM15.00/jam pada masa berdaftar; tiada OT")}><AppIcon name="time" />{L("hourly","ikut jam")}</span>}
                        </span>
                      </span>
                    </span>
                  </td>
                  {(["basic_cents", "allowance_cents"] as const).map((k) => (
                    <td key={k} className="px-2 py-1.5">
                      {hourlyRow && k === "basic_cents" ? (
                        <span className="block text-xs" title={L("Auto from clock in–out, counting only time inside the person's scheduled blocks plus any live session or roster block outside them. RM15.00/hour (CEO rule). Not editable.", "Auto daripada daftar masuk–keluar, mengira hanya masa dalam blok berjadual orang itu campur sesi LIVE atau blok roster di luarnya. RM15.00/jam (peraturan CEO). Tidak boleh disunting.")}>
                          <span className="font-medium">{(hourlyPay / 100).toFixed(2)}</span>
                          <span className="text-muted-foreground"> · {hmLabel(hourlyMins)}{L(" × RM15/h", " × RM15/jam")}</span>
                          {/* v1.109.0 — CEO: "based on their working hour and
                              minus 1 hour of break". The row says what the
                              clock said and what came off it, so a figure that
                              is an hour a day short of the clock explains
                              itself where the eye already is. */}
                          {(e.hourly_break_live ?? 0) > 0 && (
                            <span className="text-muted-foreground block text-[10px]"
                              title={L(`Clocked ${hmLabel(e.hourly_clocked_live ?? 0)} in total over ${e.hourly_days_live ?? 0} day(s). One hour of unpaid break is deducted on each day that ran past five hours — ${hmLabel(e.hourly_break_live ?? 0)} this month.`, `Berdaftar ${hmLabel(e.hourly_clocked_live ?? 0)} semuanya dalam ${e.hourly_days_live ?? 0} hari. Satu jam rehat tanpa gaji ditolak pada setiap hari yang melebihi lima jam — ${hmLabel(e.hourly_break_live ?? 0)} bulan ini.`)}>
                              {L(`clocked ${hmLabel(e.hourly_clocked_live ?? 0)} · ${hmLabel(e.hourly_break_live ?? 0)} break`,
                                 `berdaftar ${hmLabel(e.hourly_clocked_live ?? 0)} · ${hmLabel(e.hourly_break_live ?? 0)} rehat`)}
                            </span>
                          )}
                        </span>
                      ) : (
                      <input
                        type="number" min={0} step="0.01"
                        className={inputSm}
                        disabled={readOnly}
                        aria-label={`${k === "basic_cents" ? L("Basic (RM)", "Gaji pokok (RM)") : L("Allowance", "Elaun")} — ${displayName(u)}`}
                        value={e[k] ? (e[k] / 100).toString() : ""}
                        placeholder="0.00"
                        onChange={(ev) => setField(u.id, k, ev.target.value)}
                      />
                      )}
                      {/* v1.77.0 — a public holiday worked earns two days' ORP
                          on top (a second RM15/h for a part-timer). It sits
                          under BASIC because that is what it is a premium on,
                          and it names the day so it can be checked against
                          the calendar. */}
                      {k === "basic_cents" && (ud?.ph_worked_cents ?? 0) > 0 && (
                        <span className="block text-[10px] text-success">
                          +{rm(ud!.ph_worked_cents)} · {L(
                            `${ud!.ph_worked} public holiday${ud!.ph_worked === 1 ? "" : "s"} worked (${ud!.ph_worked_dates.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)).join(", ")})`,
                            `${ud!.ph_worked} cuti umum bekerja (${ud!.ph_worked_dates.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)).join(", ")})`,
                          )}
                        </span>
                      )}
                    </td>
                  ))}
                  {/* v1.215.0 - SALES COMMISSION replaces the OT column (the
                      owner's Payroll 2.0 brief). Read-only: the row's saved
                      commission (no box - the server sums it once a policy
                      exists), how many invoices the CEO/COO confirmed as paid
                      for this closer this month, the sync state, and the
                      breakdown. OT is still paid - it moved under Net. */}
                  <td className={pp.td}>
                    <span className={pp.commCell}>
                      <span className={pp.commAmt}>{rm(e.commission_cents || 0)}</span>
                      <span className={pp.commSub}>
                        {commSrc === null ? "…" : commOf(u.id).length === 0
                          ? L("No confirmed invoices", "Tiada invois disahkan")
                          : L(`${commOf(u.id).length} confirmed paid invoice${commOf(u.id).length === 1 ? "" : "s"}`, `${commOf(u.id).length} invois disahkan dibayar`)}
                      </span>
                      <span className={pp.commChip}>{L("No policy yet", "Tiada polisi lagi")}</span>
                      <button type="button" className={pp.commLink} onClick={() => setDetailId(u.id)}
                        aria-label={`${L("Commission breakdown", "Pecahan komisen")} — ${displayName(u)}`}>
                        {L("View breakdown", "Lihat pecahan")}
                      </button>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number" min={0} step="0.01"
                      className={inputSm}
                      disabled={readOnly}
                      aria-label={`${L("Deduction (manual)", "Potongan (manual)")} — ${displayName(u)}`}
                      value={e.deduction_cents ? (e.deduction_cents / 100).toString() : ""}
                      placeholder="0.00"
                      onChange={(ev) => setField(u.id, "deduction_cents", ev.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {hourlyRow ? (
                      <span className="text-muted-foreground text-xs" title={L("Hourly pay is computed from clocked time directly — no worked-days proration", "Gaji sejam dikira terus daripada masa berdaftar — tiada prorata hari bekerja")}>{hmLabel(hourlyMins)}</span>
                    ) : !readOnly && (
                      <>
                        <input
                          type="number" min={0} max={31}
                          className={`${inputClassSm} ${pp.dayInput}`}
                          aria-label={`${L("Days worked", "Hari bekerja")} — ${displayName(u)}`}
                          placeholder={L("d", "h")}
                          title={L(`Days worked (of ${monthDays}) — attendance recorded ${attDays[u.id] ?? 0} clock-in day(s) this month; edit freely to correct wrong or dishonest punches`, `Hari bekerja (daripada ${monthDays}) — kehadiran merekod ${attDays[u.id] ?? 0} hari daftar masuk bulan ini; sunting bebas untuk membetulkan ketukan yang salah atau tidak jujur`)}
                          value={workedDays[u.id] ?? ""}
                          onChange={(ev) => setWorkedDays((m) => {
                            // Blank = full month (no adjustment) — an empty box
                            // must never be read as "0 days worked".
                            const next = { ...m };
                            if (ev.target.value === "") delete next[u.id];
                            else next[u.id] = Number(ev.target.value);
                            return next;
                          })}
                        />
                        <span
                          className="text-muted-foreground ml-1 text-[10px]"
                          title={L("Clock-in days recorded in Attendance this month", "Hari daftar masuk direkod dalam Kehadiran bulan ini")}
                        >
                          <AppIcon name="time" className="mr-0.5 -mt-0.5 h-3 w-3" />{attDays[u.id] ?? 0}
                        </span>
                        {(unpaidDays[u.id] ?? 0) > 0 && (
                          <span
                            className="ml-1 text-[10px] font-semibold text-danger"
                            title={L(`${unpaidDays[u.id]} approved unpaid-leave day(s) — the payslip deducts this automatically at ${ulRate} of the monthly wage per day. Keep Basic full and do NOT deduct it again here.`, `${unpaidDays[u.id]} hari cuti tanpa gaji diluluskan — slip gaji memotong ini secara automatik pada ${ulRate} gaji bulanan sehari. Kekalkan Gaji pokok penuh dan JANGAN potong lagi di sini.`)}
                          >
                            UL:{unpaidDays[u.id]}
                          </span>
                        )}
                        {(base[u.id] ?? 0) > 0 && e.basic_cents !== base[u.id] && (
                          /* v1.97.1 — a Basic that disagrees with the base is
                             said out loud, with the two figures, not hinted at
                             by a 10px link. The button puts the base in the
                             draft; Save writes it. */
                          <button type="button"
                            className="ml-1 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning underline-offset-2 hover:underline"
                            title={L(`Basic here is ${fmtRM(e.basic_cents)} but the base salary is ${fmtRM(base[u.id] ?? 0)}. Press to put the base in this row, then Save.`,
                                     `Gaji pokok di sini ${fmtRM(e.basic_cents)} tetapi gaji asas ialah ${fmtRM(base[u.id] ?? 0)}. Tekan untuk meletakkan asas dalam baris ini, kemudian Simpan.`)}
                            onClick={() => setEntries((m) => ({ ...m, [u.id]: { ...e, basic_cents: base[u.id] || 0 } }))}>
                            {L("≠ base", "≠ asas")} {fmtRM(base[u.id] ?? 0)} · {L("Use base", "Guna asas")}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  {/* v1.78.0 (CEO: "why it wrapped like this? ... I want
                      minimalist style to make it easy in order") — this cell
                      was `whitespace-nowrap`, so each explanation line below
                      was forced onto ONE line. Two of them run to eighty
                      characters, so the column grew to fit, the table
                      overflowed, and the STAFF column was squeezed until
                      names broke one word per row. The figure still never
                      wraps; the prose under it now does, inside a fixed
                      width, and says the short version with the long one on
                      hover. */}
                  <td className="w-[13rem] px-2 py-1.5 align-top">
                    <span className="block font-medium whitespace-nowrap">{rm(Math.max(0, net))}</span>
                    {/* v1.215.0 - overtime is still paid, and still in Net: it
                        is said here, under the figure it is part of. The hours
                        follow CEO-approved overtime; a different figure is
                        typed in the row's details. */}
                    {!hourlyRow && ot > 0 && (
                      <span className={pp.otLine} title={L("Overtime included in Net: hours × 1.5 × hourly ORP (basic ÷ 26 ÷ 8), Employment Act normal-day rate", "OT termasuk dalam Bersih: jam × 1.5 × ORP sejam (pokok ÷ 26 ÷ 8), kadar hari biasa Akta Kerja")}>
                        {L(`incl. OT ${e.ot_hours ?? 0} h · ${rm(ot)}`, `termasuk OT ${e.ot_hours ?? 0} j · ${rm(ot)}`)}
                      </span>
                    )}
                    {!hourlyRow && otApproved[u.id] && otApproved[u.id]!.minutes > 0 && (e.ot_hours ?? 0) !== otHoursFrom(otApproved[u.id]!.minutes) && (
                      <span className={pp.otWarn} title={L("The OT hours on this row differ from the overtime approved this month - check the row's details.", "Jam OT pada baris ini berbeza daripada OT yang diluluskan bulan ini - semak butiran baris.")}>
                        {L(`approved OT ${otHoursFrom(otApproved[u.id]!.minutes)} h - row differs`, `OT diluluskan ${otHoursFrom(otApproved[u.id]!.minutes)} j - baris berbeza`)}
                      </span>
                    )}
                    {/* v1.77.0 — THE REASON IS ON THE SCREEN NOW.
                        It used to be a hover tooltip reading "− RM X auto",
                        and two completely different deductions rendered
                        identically: unpaid leave at 1/26, and an incomplete
                        month at 1/working-days. That is how a RM 1,052.63
                        charge sat on a row for a fortnight without anybody
                        being able to see what it was for. A number that
                        changes somebody's salary says what it is. */}
                    {(adj > 0 || ulDed > 0) && (
                      <span className="mt-0.5 block text-[10px] leading-snug text-danger">
                        <span className="whitespace-nowrap">−{rm(adj + ulDed)}</span>
                        {adj > 0 && (
                          <span className="block"
                            title={calendarBasis
                              ? L(`Incomplete month: employed for ${proDays[u.id] ?? proration.month_days} of this month's ${proration.month_days} calendar days (Employment Act s.18A). Only a joiner, a leaver or a re-joiner is prorated.`,
                                  `Bulan tidak lengkap: bekerja ${proDays[u.id] ?? proration.month_days} daripada ${proration.month_days} hari kalendar bulan ini (Akta Kerja s.18A). Hanya pekerja baharu, berhenti atau kembali dikira prorata.`)
                              : L(`Incomplete month: employed for ${payableDays[u.id] ?? monthDays} of this month's ${monthDays} working days. Only a joiner, a leaver or a re-joiner is prorated.`,
                                  `Bulan tidak lengkap: bekerja ${payableDays[u.id] ?? monthDays} daripada ${monthDays} hari bekerja bulan ini. Hanya pekerja baharu, berhenti atau kembali dikira prorata.`)}>
                            {calendarBasis
                              ? L(`incomplete month · ${proDays[u.id] ?? proration.month_days}/${proration.month_days} calendar days`,
                                  `bulan tidak lengkap · ${proDays[u.id] ?? proration.month_days}/${proration.month_days} hari kalendar`)
                              : L(`incomplete month · ${payableDays[u.id] ?? monthDays}/${monthDays} days`,
                                  `bulan tidak lengkap · ${payableDays[u.id] ?? monthDays}/${monthDays} hari`)}
                          </span>
                        )}
                        {ulDed > 0 && (
                          <span className="block"
                            title={L(`Unpaid leave: ${ud?.days ?? ul} day(s) at ${ulRate} of the monthly wage${(ud?.rest_days ?? 0) > 0 ? `, plus ${ud?.rest_days} rest day(s) lost because every working day in those weeks was unpaid` : ""}${ud?.capped ? ". Capped so the month's public holidays stay paid." : "."}`,
                                     `Cuti tanpa gaji: ${ud?.days ?? ul} hari pada ${ulRate} gaji bulanan${(ud?.rest_days ?? 0) > 0 ? `, campur ${ud?.rest_days} hari rehat yang hilang kerana semua hari bekerja minggu itu tanpa gaji` : ""}${ud?.capped ? ". Dihadkan supaya cuti umum bulan itu kekal dibayar." : "."}`)}>
                            {L(`unpaid · ${ud?.days ?? ul}d`, `tanpa gaji · ${ud?.days ?? ul}h`)}
                            {(ud?.rest_days ?? 0) > 0 && L(` + ${ud?.rest_days} rest`, ` + ${ud?.rest_days} rehat`)}
                            {ud?.capped && L(" · capped", " · dihad")}
                          </span>
                        )}
                      </span>
                    )}
                    {advance > 0 && <span className="mt-0.5 block text-[10px] leading-snug text-danger">−{rm(advance)} · {L("salary advance", "pendahuluan gaji")}</span>}
                    {/* Employment dates and the clock disagreeing is not a
                        deduction question — it is a wrong date somewhere, and
                        it is money either way. */}
                    {ud?.clocked_beyond_employment && (
                      <span className="mt-0.5 block text-[10px] leading-snug font-semibold text-warning"
                        title={L(`Employed for ${ud.payable_days} of ${monthDays} working days but clocked in on ${ud.clocked_days}. Both cannot be true — check Joined on / End date / Re-joined on in the staff record.`,
                                 `Bekerja ${ud.payable_days} daripada ${monthDays} hari tetapi mendaftar masuk ${ud.clocked_days} hari. Kedua-duanya tidak boleh benar — semak Tarikh masuk / Tarikh tamat / Tarikh kembali.`)}>
                        {L(`${ud.payable_days} employed / ${ud.clocked_days} clocked — check dates`,
                           `${ud.payable_days} bekerja / ${ud.clocked_days} daftar — semak tarikh`)}
                      </span>
                    )}
                  </td>
                  <td className={pp.td}>{stateChip(u.id)}</td>
                  <td className={`${pp.td} ${pp.actionsCell}`}>
                    <span className={pp.actions}>
                      {!readOnly && !hourlyRow && (
                        <button type="button" className={rowBtnPrimary} onClick={() => void save(u.id, u.name)}>
                          {L("Save", "Simpan")}
                        </button>
                      )}
                      <button type="button" className={`${rowBtn} ${pp.iconBtn}`} onClick={() => setDetailId(u.id)}
                        aria-label={`${L("Salary breakdown", "Pecahan gaji")} — ${displayName(u)}`}
                        title={L("Salary breakdown", "Pecahan gaji")}>
                        <AppIcon name="preview" />
                      </button>
                      <button type="button" className={rowBtn} onClick={() => void printSlip(u)}>
                        {L("Payslip", "Slip gaji")}
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {/* v1.77.0 — the TOTAL row is the line the CEO saw read "0 staff"
                while loading; until the first fetch lands it is a skeleton too. */}
            {!loaded ? (
              <tr className={pp.footRow} aria-hidden>
                <td className={pp.td}><Skel className="h-4 w-32" /></td>
                <td className={pp.td}><Skel className="h-4 w-20" /></td>
                <td className={pp.td}><Skel className="h-4 w-20" /></td>
                <td className={pp.td}><Skel className="h-4 w-20" /></td>
                <td className={pp.td}><Skel className="h-4 w-20" /></td>
                <td className={pp.td}></td>
                <td className={pp.td}><Skel className="h-5 w-24" /></td>
                <td className={pp.td}></td>
                <td className={pp.td}></td>
              </tr>
            ) : (
              <tr className={pp.footRow}>
                <td className={pp.td}>{L("TOTAL", "JUMLAH")} — {staff.length} {L("staff", "kakitangan")}</td>
                <td className={pp.td}>
                  {rm(tot.basic)}
                  {tot.ph > 0 && (
                    <span className={pp.plusNote}>
                      +{rm(tot.ph)} {L("public holidays worked", "cuti umum bekerja")}
                    </span>
                  )}
                </td>
                <td className={pp.td}>{rm(tot.allow)}</td>
                <td className={pp.td}>{rm(tot.comm)}</td>
                <td className={pp.td}>{tot.ded > 0 ? `− ${rm(tot.ded)}` : rm(0)}</td>
                <td className={pp.td}></td>
                <td className={`${pp.td} ${pp.netTotal}`}>{rm(tot.net)}{tot.ot > 0 && <span className={pp.otLine}>{L(`incl. OT ${rm(tot.ot)}`, `termasuk OT ${rm(tot.ot)}`)}</span>}</td>
                <td className={pp.td}></td>
                <td className={pp.td}></td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className={pp.saveBar}>
        <button
          type="button"
          className={btnSmPrimary}
          onClick={() => void saveAll()}
        >
          {L("Save all", "Simpan semua")}
        </button>
        <span className={pp.sub}>
          {dirtyCount > 0
            ? L(`${dirtyCount} row${dirtyCount === 1 ? " has" : "s have"} unsaved changes.`, `${dirtyCount} baris mempunyai perubahan belum disimpan.`)
            : L("Every row matches what is saved.", "Setiap baris sepadan dengan yang disimpan.")}{" "}
          {L("Payslips and release are on Payslips; the M2E salary file and CSV on Reports & Export.", "Slip gaji dan keluaran di Slip Gaji; fail gaji M2E dan CSV di Laporan & Eksport.")}
        </span>
      </div>
    </div>
      </TabZone>

      {/* ============================== PAYSLIPS ============================== */}
      <TabZone label={L("Payslips", "Slip gaji")} className={view !== "payslips" ? pp.off : ""}>
        <section id="payroll-release" className={card} aria-label={L("Payslip release", "Keluaran slip gaji")}>
          {head("date", pp.blueWell, L("Payslip Release", "Keluaran Slip Gaji"),
            L("Staff see only their own payslip, under Profile → My pay, from the release date. Until then only payroll processors see the figures.",
              "Kakitangan hanya melihat slip gaji sendiri, di Profil → Gaji saya, dari tarikh keluaran. Sehingga itu hanya pemproses gaji melihat angkanya."),
            release ? (release.released ? <span className={chipSuccess}>{L("Released", "Dikeluarkan")}</span> : <span className={chipInfo}>{L(`Scheduled ${releaseAt}`, `Dijadualkan ${releaseAt}`)}</span>) : null)}
      {release?.employer && (
        <p className={`mt-2 text-xs ${release.employer_is_legacy ?"text-warning font-medium" :"text-muted-foreground"}`}>
          {L("Employer of record on these payslips: ", "Majikan direkodkan pada slip gaji ini: ")}
          <span className="font-semibold">{release.employer}</span>
          {release.employer_is_legacy && L(
            " — this month was released without an employer stamp, so the slips print the legacy entity. Apply migration 0104, which corrects months from August 2026 onward.",
            " — bulan ini dikeluarkan tanpa cap majikan, jadi slip mencetak entiti lama. Guna migrasi 0104, yang membetulkan bulan dari Ogos 2026 ke atas.",
          )}
        </p>
      )}
      {release && (
        <p className="mt-2 text-xs">
          {release.released ? (
            (() => {
              /* v1.4.210 (CEO: "if I release payslip earlier than 5th, it
                 is for last month instead of next month"): a release BEFORE
                 the automatic date is almost always the wrong month — the
                 run paid in early August is JULY's, and July opens by
                 itself on the 5th. Flag it and offer one-click undo. */
              const nowMYT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
              const early = release.available_from > nowMYT;
              return (
                <span className="font-medium text-success">
                  {L(`Payslips for ${monthDMY(month)} are RELEASED to staff (since ${release.released.released_at.slice(0, 16)} UTC).`, `Slip gaji untuk ${monthDMY(month)} telah DIKELUARKAN kepada kakitangan (sejak ${release.released.released_at.slice(0, 16)} UTC).`)}
                  {early && (
                    <>
                      {""}<span className="font-semibold text-warning">{L(`Released EARLY — the automatic date was ${dmy(release.available_from)} (after this month closes). The salary run you pay this week is LAST month's.`, `DIKELUARKAN AWAL — tarikh automatik ialah ${dmy(release.available_from)} (selepas bulan ini ditutup). Larian gaji yang anda bayar minggu ini ialah bulan LEPAS.`)}</span>
                      {" "}<button type="button" className="font-medium underline"
                        title={L("Take this month's payslips back from staff view — the automatic release date resumes", "Tarik balik slip gaji bulan ini daripada paparan kakitangan — tarikh keluaran automatik disambung semula")}
                        onClick={async () => {
                          const res = await api(`/payroll/release`, { method: "POST", body: JSON.stringify({ month, undo: true }) });
                          setMsg(res.ok ? L("Early release undone — automatic date resumes.", "Keluaran awal dibatalkan — tarikh automatik disambung semula.") : L("Undo failed", "Batal gagal"));
                          window.setTimeout(() => setMsg(""), 3000);
                          void load();
                        }}>{L("Undo release", "Batal keluaran")}</button>
                    </>
                  )}
                </span>
              );
            })()
          ) : (
            <>
              <span className="text-muted-foreground">
                {L("Staff can view", "Kakitangan boleh melihat slip gaji")} {monthDMY(month)} {L("payslips from", "dari")}{" "}
                <span className="font-medium">{dmy(release.available_from)} {release.available_from.split(" ")[1]} MYT</span>
                {" "}{L("(5th of the next month, or the next working day). Until then, only payroll processors see the figures.", "(5 haribulan bulan berikutnya, atau hari bekerja berikutnya). Sehingga itu, hanya pemproses gaji melihat angkanya.")}
                {(() => {
                  /* v1.4.211: when the CURRENT month is on screen, the
                     early release the CEO usually wants is LAST month's —
                     say so instead of relying on him remembering the rule. */
                  const nowM = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
                  const cycleM = new Date(new Date(Date.now() + 8 * 3600 * 1000).setUTCDate(0)).toISOString().slice(0, 7);
                  return month === nowM
                    ? <> {L("Paying salaries early? The payslips to release are", "Membayar gaji awal? Slip gaji yang perlu dikeluarkan ialah")} <span className="font-medium">{monthDMY(cycleM)}</span>{L(" — pick that month above, then Release now.", " — pilih bulan itu di atas, kemudian Keluarkan sekarang.")}</>
                    : null;
                })()}
              </span>{" "}
              <button
                type="button"
                className="font-medium underline"
                title={L("Release this month's payslips to staff now, before the automatic date", "Keluarkan slip gaji bulan ini kepada kakitangan sekarang, sebelum tarikh automatik")}
                onClick={async () => {
                  /* v1.4.210: releasing before the automatic date usually
                     means the wrong month is on screen — confirm with the
                     CEO's own flow rule spelled out. */
                  const nowMYT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
                  if (release.available_from > nowMYT) {
                    /* v1.4.211 (CEO: "if I want to release the payslip
                       earlier then how?"): early release of the month
                       being PAID (= last calendar month, before its
                       automatic 5th) is the LEGITIMATE case — benign
                       confirm. Early release of the current/future month
                       keeps the strong wrong-month warning (v1.4.210). */
                    const [yR, moR] = month.split("-").map(Number);
                    const prevM = new Date(Date.UTC(yR || 0, (moR || 0) - 2, 1)).toISOString().slice(0, 7);
                    const autoD = dmy(release.available_from);
                    const cycleM = new Date(new Date(Date.now() + 8 * 3600 * 1000).setUTCDate(0)).toISOString().slice(0, 7);
                    const ok = month === cycleM
                      ? await payConfirm({
                          title: L(`Release ${monthDMY(month)} payslips now?`, `Keluarkan slip gaji ${monthDMY(month)} sekarang?`),
                          message: L(`Ahead of the automatic date (${autoD} 10:00 MYT).\nThis is the normal early release when you pay salaries before the 5th.`, `Lebih awal daripada tarikh automatik (${autoD} 10:00 MYT).\nIni keluaran awal biasa apabila anda membayar gaji sebelum 5 haribulan.`),
                          confirmLabel: L("Release now", "Keluarkan sekarang"),
                        })
                      : await payConfirm({
                          title: L("Early release — check the month", "Keluaran awal — semak bulan"),
                          message: L(`${monthDMY(month)} payslips release automatically on ${autoD} — AFTER the month closes.\n\nThe salary run you are paying now is LAST month's (${monthDMY(prevM)}) — its payslips release by themselves on the 5th, no action needed.`, `Slip gaji ${monthDMY(month)} dikeluarkan secara automatik pada ${autoD} — SELEPAS bulan ini ditutup.\n\nLarian gaji yang anda bayar sekarang ialah bulan LEPAS (${monthDMY(prevM)}) — slip gajinya dikeluarkan sendiri pada 5 haribulan, tiada tindakan diperlukan.`),
                          confirmLabel: L(`Release ${monthDMY(month)} anyway`, `Keluarkan ${monthDMY(month)} juga`),
                          variant: "danger",
                        });
                    if (!ok) return;
                  }
                  const res = await api(`/payroll/release`, { method: "POST", body: JSON.stringify({ month }) });
                  setMsg(res.ok ? L("Payslips released to staff.", "Slip gaji dikeluarkan kepada kakitangan.") : L("Release failed", "Keluaran gagal"));
                  window.setTimeout(() => setMsg(""), 3000);
                  void load();
                }}
              >
                {L("Release now", "Keluarkan sekarang")}
              </button>
            </>
          )}
        </p>
      )}
        </section>

        <section className={card} aria-label={L("Payslips", "Slip gaji")}>
          {head("document", pp.purpleWell, L(`Payslips — ${monthLabel}`, `Slip Gaji — ${monthLabel}`),
            L("Preview prints the A4 payslip; Send PDF makes a file to share. Save a row first so the payslip carries the saved figures.",
              "Pratonton mencetak slip gaji A4; Hantar PDF membuat fail untuk dikongsi. Simpan baris dahulu supaya slip gaji membawa angka yang disimpan."))}
          {!loaded ? <SkelRows rows={4} /> : (
            <div className={`erp-table-scroll erp-mt-3 ${pp.tableWrap}`}>
              <table className={pp.plain}>
                <thead><tr><th>{L("Staff", "Kakitangan")}</th><th className={pp.num}>{L("Net pay", "Gaji bersih")}</th><th>{L("Status", "Status")}</th><th>{L("Actions", "Tindakan")}</th></tr></thead>
                <tbody>
                  {[...staff].sort(bySeniority).map((u) => (
                    <tr key={u.id}>
                      <td><span className={pp.who}><Avatar name={displayName(u)} photoKey={u.photo_key} size="sm" /><span className={pp.whoText}><span className={pp.whoName}>{displayName(u)}</span><span className={pp.whoRole}>{u.position ?? u.role}</span></span></span></td>
                      <td className={pp.num}>{rm(Math.max(0, netFor(u.id)))}</td>
                      <td>{stateChip(u.id)}</td>
                      <td>
                        <span className={pp.actions}>
                          <button type="button" className={rowBtn} onClick={() => void printSlip(u)}>{L("Preview", "Pratonton")}</button>
                          <button type="button" className={rowBtn} title={L("Send this payslip as a PDF file", "Hantar slip gaji ini sebagai fail PDF")}
                            onClick={() => void sendSlip(u)}>
                            {L("Send PDF", "Hantar PDF")}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </TabZone>

      {/* ========================== REPORTS & EXPORT ========================== */}
      <TabZone label={L("Reports and export", "Laporan dan eksport")} className={view !== "reports" ? pp.off : ""}>
        <section id="payroll-export" className={card} aria-label={L("Bank payment file", "Fail pembayaran bank")}>
          {head("pay", pp.greenWell, L("Bank Payment File", "Fail Pembayaran Bank"),
            L("Built from the SAVED entries. Both files ask before downloading; upload to Maybank only once the payroll is approved.",
              "Dibina daripada entri yang DISIMPAN. Kedua-dua fail bertanya sebelum dimuat turun; muat naik ke Maybank hanya selepas gaji diluluskan."))}
          <div className={pp.exportRow}>
            <button
              type="button"
              className={btnSmPrimary}
              title={L("Downloads the official Maybank2E template ALREADY FILLED — Home sheet + salary rows + value date (5th rule) — just open, enable macros, generate, upload, approve. Needs the one-time M2E setup first.", "Muat turun templat rasmi Maybank2E yang SUDAH TERISI — helaian Home + baris gaji + tarikh nilai (peraturan ke-5) — hanya buka, aktifkan makro, jana, muat naik, luluskan. Perlukan persediaan M2E sekali sahaja terlebih dahulu.")}
              onClick={async () => { if (await confirmPaymentFile("m2e")) void downloadM2e(); }}
            >
              <><AppIcon name="pay" />{L("M2E salary file", "Fail gaji M2E")}</>
            </button>
            <button
              type="button"
              className={btnSm}
              title={L("Fallback: the same rows as a CSV whose columns match the template — paste at cell A5 yourself", "Sandaran: baris yang sama sebagai CSV dengan lajur sepadan templat — tampal di sel A5 sendiri")}
              onClick={() => void downloadCsv()}
            >
              <><AppIcon name="download" />CSV</>
            </button>
            {loaded && noNetRows.length + notSavedRows.length > 0 && (
              /* v1.207.0 - audit finding 3, warned and not changed: the files
                 price a saved row by its SAVED net; a row without one falls
                 back to an older formula, and an unsaved row is not in them */
              <span className={pp.warnText} role="status">
                {noNetRows.length > 0 && L(`${noNetRows.length} saved row${noNetRows.length === 1 ? " has" : "s have"} no saved net — the files would price ${noNetRows.length === 1 ? "it" : "them"} with an older formula. Save ${noNetRows.length === 1 ? "it" : "them"} first: `, `${noNetRows.length} baris disimpan tiada bersih disimpan — fail akan mengiranya dengan formula lama. Simpan dahulu: `)}
                {noNetRows.length > 0 && <span data-no-translate>{noNetRows.map((u) => displayName(u)).join(", ")}. </span>}
                {notSavedRows.length > 0 && L(`${notSavedRows.length} not saved — not in the files: `, `${notSavedRows.length} belum disimpan — tiada dalam fail: `)}
                {notSavedRows.length > 0 && <span data-no-translate>{notSavedRows.map((u) => displayName(u)).join(", ")}.</span>}
              </span>
            )}
            <span className={m2eIncomplete ? pp.warnText : pp.sub}>
              {m2eIncomplete
                ? L("M2E setup is incomplete — finish it under Settings & Audit first.", "Persediaan M2E belum lengkap — lengkapkan di Tetapan & Audit dahulu.")
                : L("M2E setup complete.", "Persediaan M2E lengkap.")}
              {m2eIncomplete && <> <button type="button" className={pp.inlineLink} onClick={() => go("settings", "payroll-m2e")}>{L("Open M2E setup", "Buka persediaan M2E")}</button></>}
            </span>
          </div>
        </section>

        {/* v1.207.0 - the months before, as their saved records hold them */}
        <section className={card} aria-label={L("Payroll history", "Sejarah gaji")}>
          {head("orders", pp.purpleWell, L("Payroll History", "Sejarah Gaji"), L("The last twelve months as saved: who was saved, the saved net, and whether the payslips are out. View opens that month.", "Dua belas bulan lepas seperti disimpan: siapa disimpan, bersih disimpan, dan sama ada slip gaji sudah dikeluarkan. Lihat membuka bulan itu."))}
          {history.loading || !histWanted ? <SkelRows rows={6} /> : (
            <div className={`erp-table-scroll erp-mt-3 ${pp.tableWrap}`}>
              <table className={pp.plain} aria-label={L("Payroll history", "Sejarah gaji")}>
                <thead><tr>
                  <th>{L("Payroll month", "Bulan gaji")}</th><th className={pp.num}>{L("Staff saved", "Kakitangan disimpan")}</th>
                  <th className={pp.num}>{L("Saved net", "Bersih disimpan")}</th><th>{L("Status", "Status")}</th><th><span className={pp.srOnly}>{L("Action", "Tindakan")}</span></th>
                </tr></thead>
                <tbody>
                  {history.rows.map((h) => (
                    <tr key={h.month} className={h.month === month ? pp.histOn : ""}>
                      <td><strong>{monthName(h.month)}</strong></td>
                      <td className={pp.num}>{h.failed ? "—" : h.saved}</td>
                      <td className={pp.num}>{h.failed || h.saved === 0 ? "—" : rm(h.net)}{h.noNet > 0 && <span className={pp.histWarn}>{L(` · ${h.noNet} without a saved net`, ` · ${h.noNet} tanpa bersih disimpan`)}</span>}</td>
                      <td>{h.failed ? <span className={chipNeutral}>{L("Not read", "Tidak dibaca")}</span>
                        : h.released ? <span className={chipSuccess}>{L("Released", "Dikeluarkan")}</span>
                        : h.saved > 0 ? <span className={chipWarn}>{L("Not released", "Belum dikeluarkan")}</span>
                        : <span className={chipNeutral}>{L("Nothing saved", "Tiada disimpan")}</span>}</td>
                      <td className={pp.num}>{h.month !== month && <button type="button" className={rowBtn} onClick={() => setMonth(h.month)}>{L("View", "Lihat")}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className={pp.split}>
          <section className={card} aria-label={L("Payroll totals", "Jumlah gaji")}>
            {head("chart", pp.goldWell, L(`Payroll Totals — ${monthLabel}`, `Jumlah Gaji — ${monthLabel}`), L("The same figures as the TOTAL row", "Angka yang sama dengan baris JUMLAH"))}
            {!loaded ? <SkelRows rows={8} /> : (
              <dl className={pp.statement}>
                <div><dt>{L("Basic salary", "Gaji pokok")}</dt><dd>{rm(tot.basic)}</dd></div>
                {tot.ph > 0 && <div><dt>{L("Public holidays worked", "Cuti umum bekerja")}</dt><dd>{rm(tot.ph)}</dd></div>}
                {tot.comm > 0 && <div><dt>{L("Commission (paid months only)", "Komisen (bulan dibayar sahaja)")}</dt><dd>{rm(tot.comm)}</dd></div>}
                <div><dt>{L("Allowances", "Elaun")}</dt><dd>{rm(tot.allow)}</dd></div>
                <div><dt>{L("Overtime", "OT")}</dt><dd>{rm(tot.ot)}</dd></div>
                <div className={dedBy.manual > 0 ? pp.minus : ""}><dt>{L("Manual deductions", "Potongan manual")}</dt><dd>{dedBy.manual > 0 ? `− ${rm(dedBy.manual)}` : rm(0)}</dd></div>
                <div className={dedBy.ul > 0 ? pp.minus : ""}><dt>{L("Unpaid leave", "Cuti tanpa gaji")}</dt><dd>{dedBy.ul > 0 ? `− ${rm(dedBy.ul)}` : rm(0)}</dd></div>
                <div className={dedBy.adj > 0 ? pp.minus : ""}><dt>{L("Incomplete month", "Bulan tidak lengkap")}</dt><dd>{dedBy.adj > 0 ? `− ${rm(dedBy.adj)}` : rm(0)}</dd></div>
                <div className={dedBy.advance > 0 ? pp.minus : ""}><dt>{L("Salary advances", "Pendahuluan gaji")}</dt><dd>{dedBy.advance > 0 ? `− ${rm(dedBy.advance)}` : rm(0)}</dd></div>
                <div className={tot.ded > 0 ? pp.minus : ""}><dt>{L("Total deductions", "Jumlah potongan")}</dt><dd>{tot.ded > 0 ? `− ${rm(tot.ded)}` : rm(0)}</dd></div>
                <div className={pp.total}><dt>{L("Net pay", "Gaji bersih")}</dt><dd>{rm(tot.net)}</dd></div>
              </dl>
            )}
          </section>
          <section className={card} aria-label={L("By department", "Mengikut jabatan")}>
            {head("users", pp.blueWell, L("By Department", "Mengikut Jabatan"), L("Net pay by department, from the rows above", "Gaji bersih mengikut jabatan, daripada baris di atas"))}
            {!loaded ? <SkelRows rows={4} /> : (
              <table className={pp.plain}>
                <thead><tr><th>{L("Department", "Jabatan")}</th><th className={pp.num}>{L("Staff", "Kakitangan")}</th><th className={pp.num}>{L("Net pay", "Gaji bersih")}</th></tr></thead>
                <tbody>
                  {byDept.map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td className={pp.num}>{v.n}</td><td className={pp.num}>{rm(v.net)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className={card} aria-label={L("Monthly payroll report", "Laporan gaji bulanan")}>
          {head("document", pp.purpleWell, L(`Monthly Report — ${monthLabel}`, `Laporan Bulanan — ${monthLabel}`), L("Every person's pay, read-only", "Gaji setiap orang, baca sahaja"))}
          {!loaded ? <SkelRows rows={5} /> : (
            <div className={`erp-table-scroll erp-mt-3 ${pp.tableWrap}`}>
              <table className={pp.plain}>
                <thead><tr>
                  <th>{L("Staff", "Kakitangan")}</th><th className={pp.num}>{L("Basic", "Pokok")}</th><th className={pp.num}>{L("Allowance", "Elaun")}</th>
                  <th className={pp.num}>{L("OT", "OT")}</th><th className={pp.num}>{L("Deductions", "Potongan")}</th><th className={pp.num}>{L("Net", "Bersih")}</th>
                </tr></thead>
                <tbody>
                  {[...staff].sort(bySeniority).map((u) => {
                    const f = figs(u);
                    const ded = f.manual + f.ul + f.adj + f.advance;
                    return (
                      <tr key={u.id}>
                        <td><span className={pp.whoName}>{displayName(u)}</span></td>
                        <td className={pp.num}>{rm(f.basic + f.ph)}</td>
                        <td className={pp.num}>{rm(f.allow)}</td>
                        <td className={pp.num}>{rm(f.ot)}</td>
                        <td className={pp.num}>{ded > 0 ? `− ${rm(ded)}` : rm(0)}</td>
                        <td className={`${pp.num} ${pp.strong}`}>{rm(Math.max(0, f.net))}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td>{L("TOTAL", "JUMLAH")} — {staff.length} {L("staff", "kakitangan")}</td>
                  <td className={pp.num}>{rm(tot.basic + tot.ph)}</td><td className={pp.num}>{rm(tot.allow)}</td><td className={pp.num}>{rm(tot.ot)}</td>
                  <td className={pp.num}>{tot.ded > 0 ? `− ${rm(tot.ded)}` : rm(0)}</td><td className={`${pp.num} ${pp.strong}`}>{rm(tot.net)}</td>
                </tr></tfoot>
              </table>
            </div>
          )}
        </section>
      </TabZone>

      {/* ========================== SETTINGS & AUDIT ========================== */}
      <TabZone label={L("Settings and audit", "Tetapan dan audit")} className={view !== "settings" ? pp.off : ""}>
      {!readOnly && (
        <div id="payroll-base" className={`${card} scroll-mt-36`}>
          <p className="text-sm font-semibold">{L("Base salaries (fixed monthly basic)", "Gaji asas (gaji pokok bulanan tetap)")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Every new month's Basic auto-fills from these figures — no retyping. When someone gets an increment, change it here and it applies from the next unsaved month onwards; months already saved stay as saved.",
              "Gaji pokok setiap bulan baharu terisi automatik daripada angka ini — tiada taipan semula. Apabila seseorang menerima kenaikan, ubah di sini dan ia terpakai dari bulan belum disimpan yang berikutnya; bulan yang sudah disimpan kekal seperti disimpan.",
            )}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((u) => (
              <label key={u.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{displayName(u)}</span>
                <span className="flex items-center gap-1 whitespace-nowrap">
                  RM
                  <input
                    type="number" min={0} step="0.01"
                    className={`${inputClassSm} w-24`}
                    value={baseDraft[u.id] ? ((baseDraft[u.id] || 0) / 100).toString() : ""}
                    placeholder="0.00"
                    onChange={(ev) => setBaseDraft((m) => ({ ...m, [u.id]: Math.max(0, Math.round(Number(ev.target.value || 0) * 100)) }))}
                  />
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className={`${btnSmPrimary} mt-3`}
            onClick={async () => {
              /* v1.97.1 (CEO: "Base salaries was not sync with staff table
                 Basic! then Net why didnt correcly count? this is something
                 that bug or wrong flow!") — it was the flow. A base change
                 used to reach only months not yet saved; the open month,
                 already saved at the OLD base, kept it, and the only sign was
                 a 10px "Base" link. Now a base change is carried into the
                 open month at once, for every row that was simply following
                 the base (Basic == old base, or never saved), and the row is
                 saved with its net recomputed - so the table and the panel
                 above it say the same figure the moment the button is
                 pressed. Two things are deliberately NOT touched: a month
                 already RELEASED to staff (a payslip somebody has read does
                 not change under them - reopen it on purpose), and a Basic
                 that was set by hand to something other than the old base
                 (that was a decision; it is flagged in the row, not undone). */
              let n = 0;
              const carried: string[] = [];
              const held: string[] = [];
              /* v1.159.3 (CEO: "previous month should not update the base, it
                 is only the present month which is to avoid that they
                 manipulate the payslip which is incorrect!") - a base change
                 is carried into the PRESENT month only. A month that has
                 passed is a payslip that was paid; it keeps its figures
                 whatever the base becomes now. */
              const presentMonth = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
              const pastMonth = month < presentMonth;
              for (const u of staff) {
                const oldBase = base[u.id] ?? 0;
                const newBase = baseDraft[u.id] ?? 0;
                if (newBase === oldBase) continue;
                const res = await api(`/payroll/base`, { method: "POST", body: JSON.stringify({ user_id: u.id, base_salary_cents: newBase }) });
                if (!res.ok) continue;
                n++;
                if (isHourly(u)) continue;                 // an hourly basic comes from the clock, not from here
                if (pastMonth || release?.released) { held.push(u.name); continue; }
                const cur = entry(u.id);
                /* v1.159.2 (CEO: "Once I click on Save Base Salaries button,
                   it should update automatically Basic!") - the base IS the
                   Basic. Every row of an unreleased month takes the new base,
                   including one that was typed by hand: the base salary is
                   where a person's pay is decided, and a Basic that disagrees
                   with it is the thing he keeps finding. A released month is
                   the one exception, as before. */
                if (cur.basic_cents === newBase) continue;
                const next: Entry = { ...cur, basic_cents: newBase };
                const d = workedDays[u.id];
                const hasDays = typeof d === "number" && !Number.isNaN(d);
                const r2 = await api(`/payroll`, {
                  method: "POST",
                  body: JSON.stringify({
                    ...next, month,
                    ot_cents: otPay(next.basic_cents, next.ot_hours),
                    worked_days: hasDays ? d : null,
                    month_working_days: hasDays ? monthDays : null,
                    net_cents: netFor(u.id, next),
                    salary_advance_cents: unpaidInfo[u.id]?.salary_advance_cents ?? 0,
                  }),
                });
                if (r2.ok) carried.push(`${u.name} (${fmtRM(cur.basic_cents)} → ${fmtRM(newBase)})`);
                else held.push(u.name);
              }
              if (n === 0) {
                showToast(L("No changes", "Tiada perubahan"), L("Base salaries already match", "Gaji asas sudah sepadan"), "notice");
              } else {
                const parts = [L(`Base salary updated for ${n} staff.`, `Gaji asas dikemas kini untuk ${n} kakitangan.`)];
                if (carried.length) parts.push(L(`${month} Basic re-filled and saved: ${carried.join(", ")}.`, `Gaji pokok ${month} diisi semula dan disimpan: ${carried.join(", ")}.`));
                if (held.length) parts.push(pastMonth
                  ? L(`${month} has passed, so its Basic was left as paid for ${held.join(", ")} - the new base applies from ${presentMonth}.`,
                      `${month} sudah berlalu, jadi Gaji pokoknya dikekalkan seperti yang dibayar untuk ${held.join(", ")} - asas baharu terpakai dari ${presentMonth}.`)
                  : release?.released
                  ? L(`${month} is already released to staff, so its Basic was left as saved for ${held.join(", ")} - use "Use base" in the row if it must change.`,
                      `${month} sudah dikeluarkan kepada kakitangan, jadi Gaji pokoknya dikekalkan untuk ${held.join(", ")} - guna "Guna asas" dalam baris jika perlu diubah.`)
                  : L(`Basic for ${held.join(", ")} could not be saved - press Save on the row.`,
                      `Gaji pokok ${held.join(", ")} tidak dapat disimpan - tekan Simpan pada baris.`));
                showToast(L("Saved", "Disimpan"), parts.join(" "), held.length ? "notice" : undefined);
              }
              void load();
            }}
          >
            {L("Save base salaries", "Simpan gaji asas")}
          </button>
        </div>
      )}

        <div id="payroll-m2e">
    {!readOnly && (<details className={`${card} text-xs`}>
          <summary className="text-muted-foreground cursor-pointer select-none">
            {L("M2E setup (one-time) — ", "Persediaan M2E (sekali sahaja) — ")}{m2eHasTpl === false || !m2eCid || !m2eAcc || !m2eCbid ? L("incomplete — the M2E salary file needs this", "belum lengkap — fail gaji M2E memerlukannya") : L("complete", "lengkap")}
          </summary>
          <div className="border-border mt-2 space-y-2 rounded-lg border p-3">
            <p className="text-muted-foreground">
              {L("Stored once, reused every month. Your M2E ", "Disimpan sekali, diguna semula setiap bulan. ")}<span className="font-medium">{L("User ID and password are never stored", "User ID dan kata laluan M2E anda tidak pernah disimpan")}</span>{L(" — you still sign in yourself to upload and approve.", " — anda masih log masuk sendiri untuk memuat naik dan meluluskan.")}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
              <label className="block">
                <span className="text-muted-foreground">Corporate ID</span>
                <input className="border-border mt-0.5 h-8 w-full rounded-lg border px-2 sm:w-36" value={m2eCid}
                  placeholder={L("e.g. MYXXXXX", "cth. MYXXXXX")} onChange={(e) => setM2eCid(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Client Batch ID</span>
                <input className="border-border mt-0.5 h-8 w-full rounded-lg border px-2 sm:w-36" value={m2eCbid}
                  placeholder={L("e.g. MYXXXXX1D", "cth. MYXXXXX1D")} title={L("From your working M2E batch — shown as Client Batch ID on the template's Home sheet", "Daripada kelompok M2E anda yang berjaya — dipaparkan sebagai Client Batch ID pada helaian Home templat")}
                  onChange={(e) => setM2eCbid(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{L("Payer account no", "No akaun pembayar")}</span>
                <input className="border-border mt-0.5 h-8 w-full rounded-lg border px-2 sm:w-44" value={m2eAcc}
                  inputMode="numeric" placeholder={L("Maybank account", "Akaun Maybank")} onChange={(e) => setM2eAcc(e.target.value)} />
              </label>
          <button type="button" className={`${btnSm} col-span-2 sm:col-span-1`}
                onClick={() => void saveM2eSettings()}>
                {L("Save", "Simpan")}
              </button>
            </div>
            <div className="grid grid-cols-2 items-center gap-2 sm:flex">
              <span className="text-muted-foreground">{L("Blank template (.xlsm): ", "Templat kosong (.xlsm): ")}{m2eHasTpl ? L("✔ stored", "✔ disimpan") : L("not uploaded yet", "belum dimuat naik")}</span>
              <label className={`${btnSm} col-span-2 w-fit cursor-pointer sm:col-span-1`}>
                {m2eHasTpl ? L("Replace template", "Ganti templat") : L("Upload template", "Muat naik templat")}
                <input type="file" accept=".xlsm" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadM2eTemplate(f); e.target.value = ""; }} />
              </label>
            </div>
            <p className="text-muted-foreground">
              {L(
                "The M2E salary file button then downloads the template already filled: Home sheet (Corporate ID, Client Batch ID, payer account, value date = 5th or the Friday before) + all salary rows from row 5 — Favourite Recipient Code auto-fills from each staff's Employee ID, Own Ref runs PAYROLL+date+01,02,… Open → enable macros → Generate File → upload → approve → Mark paid.",
                "Kemudian butang fail gaji M2E memuat turun templat yang sudah terisi: helaian Home (Corporate ID, Client Batch ID, akaun pembayar, tarikh nilai = 5 haribulan atau Jumaat sebelumnya) + semua baris gaji dari baris 5 — Favourite Recipient Code terisi automatik daripada Employee ID setiap kakitangan, Own Ref berjalan PAYROLL+tarikh+01,02,… Buka → aktifkan makro → Generate File → muat naik → luluskan → Tanda dibayar.",
              )}
            </p>
          </div>
        </details>)}
        </div>

        <section className={card} aria-label={L("Current payroll configuration", "Konfigurasi gaji semasa")}>
          {head("balance", pp.goldWell, L("Current Payroll Configuration", "Konfigurasi Gaji Semasa"), L(`The rules this month is calculated on — ${monthLabel}`, `Peraturan bulan ini dikira — ${monthLabel}`))}
          <dl id="pay-cfg-rates" className={pp.config}>
            <div><dt>{L("Working days", "Hari bekerja")}</dt><dd>{L(`${monthDays} — Monday–Friday minus the holidays on the company calendar`, `${monthDays} — Isnin–Jumaat tolak cuti pada kalendar syarikat`)}</dd></div>
            <div><dt>{L("Incomplete month", "Bulan tidak lengkap")}</dt><dd>{calendarBasis ? L(`Calendar days — ${proration?.month_days} this month (Employment Act s.18A)`, `Hari kalendar — ${proration?.month_days} bulan ini (Akta Kerja s.18A)`) : L("Working days of the month (months before September 2026)", "Hari bekerja bulan itu (bulan sebelum September 2026)")}</dd></div>
            <div><dt>{L("Unpaid leave", "Cuti tanpa gaji")}</dt><dd>{L(`${ulRate} of the monthly wage per day; never touches a public holiday`, `${ulRate} gaji bulanan sehari; tidak menyentuh cuti umum`)}</dd></div>
            <div><dt>{L("Overtime", "OT")}</dt><dd>{L("1.5 × hourly ORP, where hourly ORP = basic ÷ 26 ÷ 8 (Employment Act normal-day rate)", "1.5 × ORP sejam, di mana ORP sejam = pokok ÷ 26 ÷ 8 (kadar hari biasa Akta Kerja)")}</dd></div>
            <div><dt>{L("Public holiday worked", "Cuti umum bekerja")}</dt><dd>{L("Two days' ORP each (s.60D(3)); a part-timer a second RM15/h on those hours", "Dua hari ORP setiap satu (s.60D(3)); pekerja separuh masa RM15/jam kedua bagi jam tersebut")}</dd></div>
            <div><dt>{L("Part-time live hosts", "Hos live separuh masa")}</dt><dd>{L("RM15.00/h on clocked time; one hour unpaid break on a day past five hours; no OT", "RM15.00/jam pada masa berdaftar; satu jam rehat tanpa gaji bagi hari melebihi lima jam; tiada OT")}</dd></div>
            <div><dt>{L("Statutory", "Berkanun")}</dt><dd>{L("No KWSP/SOCSO/EIS lines yet — registration pending", "Belum ada baris KWSP/SOCSO/EIS — pendaftaran belum selesai")}</dd></div>
            <div><dt>{L("Payslip release", "Keluaran slip gaji")}</dt><dd>{L("10:00 MYT on the 5th of the next month, or the next working day", "10:00 MYT pada 5 haribulan bulan berikutnya, atau hari bekerja berikutnya")}</dd></div>
            <div><dt>{L("Days with no clock-in", "Hari tanpa daftar masuk")}</dt><dd>{L("Listed for review, never deducted until someone marks the day", "Disenaraikan untuk semakan, tidak dipotong sehingga seseorang menandakan hari itu")}</dd></div>
          </dl>
          <div id="pay-cfg-calc">
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium">{L("Payroll calculation details", "Butiran pengiraan gaji")}</summary>
<p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "One-pass flow: everything auto-fills — Basic from base salaries, working days computed (Mon–Fri minus the holidays on the company calendar for that month), days worked from attendance — review, then Save all. A holiday the team did NOT observe (worked instead, to be replaced later) must be deleted from that month in the holiday calendar — the month then counts that day as a working day — and added on the actual replacement date, which reduces THAT month's working days. After any calendar change, press Re-fill days and Save all so saved entries recompute — otherwise payslips keep the old figures and staff are over- or under-paid. Net = basic + public holidays worked (2 days' ORP each — EA s.60D(3); a part-timer gets a second RM15/h on those hours) + allowance + overtime (commission retired from October 2026 - a month paid with one keeps its figure) (hours × 1.5 × hourly ORP, where hourly = basic ÷ 26 ÷ 8) − manual deduction − unpaid leave (monthly wage ÷ the calendar days of the month, per day — Employment Act s.18A, so 1/30 in September and 1/31 in October; a week in which every working day is unpaid also loses that week's rest days, and the deduction can never touch a public holiday) − incomplete month (basic × calendar days not employed ÷ the calendar days of the month, s.18A — joiners, leavers and re-joiners only). Months before September 2026 keep the rule their payslips were issued on: unpaid leave at 1/26 and an incomplete month on working days. Overtime and holiday work stay on ÷ 26, the ordinary rate of pay (s.60I). Blank days box = full month. No KWSP/SOCSO/EIS lines yet — registration pending. Emergency leave that STARTED on or after 01-09-2026 is UNPAID and is already inside the unpaid-leave deduction — never key it in again as a manual deduction. Emergency leave that started before that date stays paid.",
              "Aliran satu laluan: semuanya terisi automatik — Gaji pokok daripada gaji asas, hari bekerja dikira (Isnin–Jumaat tolak cuti pada kalendar syarikat bagi bulan itu), hari bekerja sebenar daripada kehadiran — semak, kemudian Simpan semua. Cuti yang TIDAK diambil oleh pasukan (bekerja seperti biasa, untuk diganti kemudian) mesti dipadam daripada bulan itu dalam kalendar cuti — bulan itu kemudian mengira hari tersebut sebagai hari bekerja — dan ditambah pada tarikh gantian sebenar, yang mengurangkan hari bekerja bulan TERSEBUT. Selepas sebarang perubahan kalendar, tekan Isi semula hari dan Simpan semua supaya entri yang disimpan dikira semula — jika tidak, slip gaji kekal dengan angka lama dan kakitangan terlebih atau terkurang bayar. Bersih = pokok + cuti umum bekerja (2 hari ORP setiap satu — Akta Kerja s.60D(3); pekerja separuh masa mendapat RM15/jam kedua bagi jam tersebut) + komisen + elaun + OT (jam × 1.5 × ORP sejam, di mana kadar sejam = pokok ÷ 26 ÷ 8) − potongan manual − cuti tanpa gaji (gaji bulanan ÷ hari kalendar bulan itu, bagi setiap hari — Akta Kerja s.18A, jadi 1/30 pada September dan 1/31 pada Oktober; minggu yang semua hari bekerjanya tanpa gaji turut kehilangan hari rehat minggu itu, dan potongan tidak sekali-kali menyentuh cuti umum) − bulan tidak lengkap (pokok × hari kalendar tidak bekerja ÷ hari kalendar bulan itu, s.18A — pekerja baharu, berhenti dan kembali sahaja). Bulan sebelum September 2026 kekal dengan peraturan slip gajinya dikeluarkan: cuti tanpa gaji pada 1/26 dan bulan tidak lengkap mengikut hari bekerja. OT dan kerja pada cuti umum kekal ÷ 26, iaitu kadar gaji biasa (s.60I). Kotak hari kosong = bulan penuh. Belum ada baris KWSP/SOCSO/EIS — pendaftaran belum selesai. Cuti kecemasan yang BERMULA pada atau selepas 01-09-2026 adalah TANPA GAJI dan sudah termasuk dalam potongan cuti tanpa gaji — jangan sekali-kali memasukkannya semula sebagai potongan manual. Cuti kecemasan yang bermula sebelum tarikh itu kekal dibayar.",
            )}
          </p>
          </details>
          </div>
        </section>

        <section className={card} aria-label={L("Audit", "Audit")}>
          {head("verify", pp.blueWell, L("Audit", "Audit"), L("What this month's record says, checked against the screen", "Apa yang dikatakan rekod bulan ini, disemak dengan skrin"))}
          <ul className={pp.audit}>
            <li><span>{L("Employer of record", "Majikan direkodkan")}</span><strong className={release?.employer_is_legacy ? pp.warnText : ""}>{release?.employer ?? "—"}{release?.employer_is_legacy ? L(" — released without an employer stamp", " — dikeluarkan tanpa cap majikan") : ""}</strong></li>
            <li><span>{L("Release", "Keluaran")}</span><strong>{release?.released ? L(`Released ${release.released.released_at.slice(0, 16)} UTC`, `Dikeluarkan ${release.released.released_at.slice(0, 16)} UTC`) : L(`Not released — scheduled ${releaseAt}`, `Belum dikeluarkan — dijadualkan ${releaseAt}`)}</strong></li>
            <li><span>{L("Saved entries", "Entri disimpan")}</span><strong>{loaded ? L(`${savedCount} of ${staff.length}`, `${savedCount} daripada ${staff.length}`) : "—"}</strong></li>
            <li><span>{L("Unsaved changes", "Perubahan belum disimpan")}</span><strong className={dirtyCount > 0 ? pp.warnText : ""}>{loaded ? dirtyCount : "—"}</strong></li>
            <li><span>{L("Base salaries set", "Gaji asas ditetapkan")}</span><strong>{loaded ? L(`${staff.filter((u) => (base[u.id] ?? 0) > 0).length} of ${staff.length}`, `${staff.filter((u) => (base[u.id] ?? 0) > 0).length} daripada ${staff.length}`) : "—"}</strong></li>
            <li><span>{L("M2E setup", "Persediaan M2E")}</span><strong className={m2eIncomplete ? pp.warnText : ""}>{m2eIncomplete ? L("Incomplete", "Belum lengkap") : L("Complete", "Lengkap")}</strong></li>
            <li><span>{L("Changing a released month", "Mengubah bulan yang dikeluarkan")}</span><strong>{L("Asks first, and is logged under the name of whoever confirms", "Bertanya dahulu, dan dilog atas nama yang mengesahkan")}</strong></li>
          </ul>
        </section>
      </TabZone>

      {/* the salary breakdown - beside the table, never in it */}
      <SideDrawer
        open={detailUser !== null}
        onClose={() => setDetailId(null)}
        title={detailUser ? displayName(detailUser) : ""}
        subtitle={detailUser ? `${detailUser.position ?? detailUser.role} · ${monthLabel}` : undefined}
        footer={detailUser ? (
          <span className={pp.actions}>
            <button type="button" className={rowBtn} onClick={() => void printSlip(detailUser)}>{L("Payslip", "Slip gaji")}</button>
            <button type="button" className={rowBtn} onClick={() => void sendSlip(detailUser)}>{L("Send PDF", "Hantar PDF")}</button>
          </span>
        ) : undefined}
      >
        {detailUser && (() => {
          const f = figs(detailUser);
          const e = entry(detailUser.id);
          const ud = unpaidInfo[detailUser.id];
          const oa = otApproved[detailUser.id];
          /* v1.207.0 - the same figures (figs(): entry, netFor, incFor,
             otPay and the server's unpaidInfo), grouped as the reference
             groups them; gross and total deductions are sums of these lines */
          const gross = f.basic + f.ph + f.comm + f.allow + f.ot;
          const dedTotal = f.manual + f.ul + f.adj + f.advance;
          const past = history.rows.filter((h) => h.month !== month && h.byUser[detailUser.id] !== undefined).slice(0, 6);
          return (
            <div className={pp.drawer}>
              <div className={pp.dHead}>
                <Avatar name={displayName(detailUser)} size="lg" />
                <span className={pp.dWho}>
                  <strong>{displayName(detailUser)}</strong>
                  <span>{[detailUser.position ?? detailUser.role, detailUser.department, detailUser.employee_id].filter(Boolean).join(" · ")}</span>
                </span>
                {stateChip(detailUser.id)}
              </div>
              <div className={pp.dSummary}>
                <div className={pp.dNet}><span>{L("Net pay", "Gaji bersih")}</span><strong>{rm(Math.max(0, f.net))}</strong></div>
                <div><span>{f.hourlyRow ? L("Hourly pay", "Gaji ikut jam") : L("Basic salary", "Gaji pokok")}</span><strong>{rm(f.basic)}</strong></div>
                <div><span>{L("Other earnings", "Pendapatan lain")}</span><strong>{rm(gross - f.basic)}</strong></div>
                <div><span>{L("Deductions", "Potongan")}</span><strong>{dedTotal > 0 ? `− ${rm(dedTotal)}` : rm(0)}</strong></div>
              </div>
              <p className={pp.drawerHead}>{L("Earnings", "Pendapatan")}</p>
              <dl className={pp.statement}>
                {f.hourlyRow
                  ? <div><dt>{L(`Hourly pay · ${hmLabel(e.hourly_minutes_live ?? e.hourly_minutes ?? 0)} × RM15/h`, `Gaji ikut jam · ${hmLabel(e.hourly_minutes_live ?? e.hourly_minutes ?? 0)} × RM15/jam`)}</dt><dd>{rm(f.basic)}</dd></div>
                  : <div><dt>{L("Basic salary", "Gaji pokok")}</dt><dd>{rm(f.basic)}</dd></div>}
                {f.ph > 0 && <div><dt>{L(`Public holidays worked (${ud?.ph_worked ?? 0})`, `Cuti umum bekerja (${ud?.ph_worked ?? 0})`)}</dt><dd>+ {rm(f.ph)}</dd></div>}
                {f.comm > 0 && <div><dt>{L("Commission", "Komisen")}</dt><dd>+ {rm(f.comm)}</dd></div>}
                <div><dt>{L("Allowance", "Elaun")}</dt><dd>+ {rm(f.allow)}</dd></div>
                {!f.hourlyRow && <div><dt>{L(`Overtime · ${e.ot_hours ?? 0}h × 1.5 × hourly ORP`, `OT · ${e.ot_hours ?? 0}j × 1.5 × ORP sejam`)}</dt><dd>+ {rm(f.ot)}</dd></div>}
                <div className={pp.subtotal}><dt>{L("Total earnings", "Jumlah pendapatan")}</dt><dd>{rm(gross)}</dd></div>
              </dl>
              <p className={pp.drawerHead}>{L("Deductions", "Potongan")}</p>
              <dl className={pp.statement}>
                <div className={f.manual > 0 ? pp.minus : ""}><dt>{L("Manual deduction", "Potongan manual")}</dt><dd>− {rm(f.manual)}</dd></div>
                {!f.hourlyRow && <div className={f.ul > 0 ? pp.minus : ""}><dt>{L(`Unpaid leave · ${ud?.days ?? 0}d at ${ulRate}${(ud?.rest_days ?? 0) > 0 ? ` + ${ud?.rest_days} rest` : ""}${ud?.capped ? " · capped" : ""}`, `Cuti tanpa gaji · ${ud?.days ?? 0}h pada ${ulRate}${(ud?.rest_days ?? 0) > 0 ? ` + ${ud?.rest_days} rehat` : ""}${ud?.capped ? " · dihad" : ""}`)}</dt><dd>− {rm(f.ul)}</dd></div>}
                {!f.hourlyRow && f.adj > 0 && <div className={pp.minus}><dt>{calendarBasis
                  ? L(`Incomplete month · ${proDays[detailUser.id] ?? proration?.month_days}/${proration?.month_days} calendar days`, `Bulan tidak lengkap · ${proDays[detailUser.id] ?? proration?.month_days}/${proration?.month_days} hari kalendar`)
                  : L(`Incomplete month · ${payableDays[detailUser.id] ?? monthDays}/${monthDays} days`, `Bulan tidak lengkap · ${payableDays[detailUser.id] ?? monthDays}/${monthDays} hari`)}</dt><dd>− {rm(f.adj)}</dd></div>}
                {f.advance > 0 && <div className={pp.minus}><dt>{L("Salary advance", "Pendahuluan gaji")}</dt><dd>− {rm(f.advance)}</dd></div>}
                {/* no statutory line is calculated anywhere in this system (audit; reported for review) */}
                <div className={pp.muted}><dt>{L("Statutory (EPF, SOCSO, EIS, PCB)", "Berkanun (KWSP, PERKESO, SIP, PCB)")}</dt><dd>{L("Not calculated — registration pending", "Tidak dikira — pendaftaran belum selesai")}</dd></div>
                <div className={pp.subtotal}><dt>{L("Total deductions", "Jumlah potongan")}</dt><dd>{dedTotal > 0 ? `− ${rm(dedTotal)}` : rm(0)}</dd></div>
                <div className={pp.total}><dt>{L("Net pay", "Gaji bersih")}</dt><dd>{rm(Math.max(0, f.net))}</dd></div>
              </dl>
              {/* v1.215.0 - the breakdown behind the Sales Commission column:
                  the invoices the CEO/COO confirmed as paid in full this month
                  for this closer. Read-only; no amount is typed anywhere. */}
              <p className={pp.drawerHead}>{L("Sales commission", "Komisen jualan")}</p>
              {commSrc === null ? <SkelRows rows={2} /> : commSrc.failed ? (
                <p className={pp.sub}>{L("The confirmed invoices could not be read just now.", "Invois yang disahkan tidak dapat dibaca sekarang.")}</p>
              ) : commOf(detailUser.id).length === 0 ? (
                <p className={pp.sub}>{L("No invoice of this person's was confirmed as paid in full this month.", "Tiada invois orang ini disahkan dibayar penuh bulan ini.")}</p>
              ) : (
                <ul className={pp.commList}>
                  {commOf(detailUser.id).map((r) => (
                    <li key={r.invoice_id}>
                      <span className={pp.commInv}><strong>{r.doc_number}</strong><span>{r.company ?? "—"}</span></span>
                      <span className={pp.commInvAmt}>{rm(r.amount_cents)}</span>
                      <span className={pp.commBy}>{L(`Confirmed by ${r.confirmed_by_name ?? "—"} · ${dmyMYT(r.confirmed_at).slice(0, 10)}`, `Disahkan oleh ${r.confirmed_by_name ?? "—"} · ${dmyMYT(r.confirmed_at).slice(0, 10)}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className={pp.commNote}>{L("No commission policy is set - nothing is calculated from these invoices yet. The commission on this row is the saved figure.", "Tiada polisi komisen ditetapkan - tiada apa dikira daripada invois ini lagi. Komisen pada baris ini ialah angka yang disimpan.")}</p>
              <p className={pp.drawerHead}>{L("Attendance this month", "Kehadiran bulan ini")}</p>
              <dl className={pp.config}>
                {f.hourlyRow ? (
                  <>
                    <div><dt>{L("Clocked", "Berdaftar")}</dt><dd>{hmLabel(e.hourly_clocked_live ?? 0)} · {L(`${e.hourly_days_live ?? 0} day(s)`, `${e.hourly_days_live ?? 0} hari`)}</dd></div>
                    <div><dt>{L("Unpaid break", "Rehat tanpa gaji")}</dt><dd>{hmLabel(e.hourly_break_live ?? 0)}</dd></div>
                  </>
                ) : (
                  <>
                    <div><dt>{L("Days worked box", "Kotak hari bekerja")}</dt><dd>{workedDays[detailUser.id] ?? L("blank = full month", "kosong = bulan penuh")} / {monthDays}</dd></div>
                    <div><dt>{L("Clock-in days", "Hari daftar masuk")}</dt><dd>{attDays[detailUser.id] ?? 0}</dd></div>
                    <div><dt>{L("Approved OT", "OT diluluskan")}</dt><dd>{oa && oa.minutes > 0 ? L(`${otHoursFrom(oa.minutes)}h · ${oa.days} day(s)`, `${otHoursFrom(oa.minutes)}j · ${oa.days} hari`) : "—"}</dd></div>
                    {/* v1.215.0 - the OT box left the table (the owner's
                        Payroll 2.0 brief); the hours are still the row's own
                        and are corrected here, then saved with Save as before. */}
                    <div><dt><label htmlFor={`ot-h-${detailUser.id}`}>{L("OT hours on this row", "Jam OT pada baris ini")}</label></dt><dd>
                      {readOnly ? `${e.ot_hours ?? 0} h` : (
                        <input id={`ot-h-${detailUser.id}`} type="number" min={0} step="0.5"
                          className={`${inputClassSm} ${pp.otInput}`}
                          value={e.ot_hours ?? ""} placeholder="0"
                          onChange={(ev) => {
                            const h = ev.target.value === "" ? null : Math.max(0, Number(ev.target.value));
                            setEntries((m) => ({ ...m, [detailUser.id]: { ...e, ot_hours: h } }));
                          }} />
                      )}
                    </dd></div>
                    <div><dt>{L("Unpaid leave days", "Hari cuti tanpa gaji")}</dt><dd>{unpaidDays[detailUser.id] ?? 0}</dd></div>
                    <div><dt>{L("Base salary", "Gaji asas")}</dt><dd>{(base[detailUser.id] ?? 0) > 0 ? rm(base[detailUser.id] ?? 0) : "—"}</dd></div>
                  </>
                )}
              </dl>
              <p className={pp.drawerHead}>{L("Recent months (saved)", "Bulan terkini (disimpan)")}</p>
              {history.loading ? <SkelRows rows={3} /> : past.length === 0 ? <p className={pp.sub}>{L("No earlier saved month for this person.", "Tiada bulan terdahulu yang disimpan untuk orang ini.")}</p> : (
                <dl className={pp.config}>
                  {past.map((h) => {
                    const v = h.byUser[detailUser.id];
                    return <div key={h.month}><dt>{monthName(h.month)}{h.released ? "" : L(" · not released", " · belum dikeluarkan")}</dt><dd>{typeof v === "number" ? rm(v) : L("saved, no net", "disimpan, tiada bersih")}</dd></div>;
                  })}
                </dl>
              )}
              <p className={pp.sub}>{L("Figures are live and include anything typed but not yet saved.", "Angka adalah langsung dan termasuk apa-apa yang ditaip tetapi belum disimpan.")}</p>
            </div>
          );
        })()}
      </SideDrawer>
    </TabPage>
  );
}

/**
 * "My payslip" (v1.4.40): every staff member can view and PRINT their own
 * payslip for a chosen month — amounts are display-only, editing lives with
 * the payroll processors (CEO/COO). No entry yet → clearly says so.
 */
export function MyPayslip() {
  // v1.4.86: future months are not selectable — no payslip can exist for a
  // month that hasn't happened. v1.4.89: the picker follows the payroll
  // CYCLE — until the 5th the latest month offered (and shown by default)
  // is the PREVIOUS month, whose slip is the one about to release; the
  // present month only appears from the 5th, after the cycle closes.
  const nowMonth = payrollCycleMonth();
  const [month, setMonth] = useState(nowMonth);
  const [entry, setEntry] = useState<(Entry & StaffRow) | null>(null);
  const [extras, setExtras] = useState<Parameters<typeof printPayslip>[3]>(null);
  const [joinedOn, setJoinedOn] = useState<string | null>(null);
  /* v1.28.0: the month's release-row issuer_code — the EMPLOYER this slip
     prints under. NULL = legacy month = AZ ONE OFFICIAL. */
  const [releaseIssuer, setReleaseIssuer] = useState<string | null>(null);

  // v1.4.80: a month's payslip unlocks on the 5th of the following month at
  // 10:00 MYT (next working day if that's a weekend/holiday), unless payroll
  // released it early.
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands. `entry === null` is also
     the honest "no payslip yet" state, so it cannot double as "loading";
     this flag flips once the first request settles, ok or not. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api<{ entry: (Entry & StaffRow) | null; extras: Parameters<typeof printPayslip>[3]; joined_on?: string | null; locked?: boolean; available_from?: string; release_issuer_code?: string | null }>(
      `/payroll/self?month=${month}`,
    ).then((r) => {
      setEntry(r.data?.entry ?? null);
      setExtras(r.data?.extras ?? null);
      setJoinedOn(r.data?.joined_on ?? null);
      setReleaseIssuer(r.data?.release_issuer_code ?? null); // v1.28.0
      setLockedUntil(r.data?.locked ? (r.data.available_from ?? null) : null);
    }).finally(() => setLoaded(true));
  }, [month]);

  // Months before the person joined the company have no payslip — the
  // button greys out instead of pretending one could exist.
  const beforeJoining = Boolean(joinedOn && month < joinedOn.slice(0, 7));

  const autoDed = entry
    ? (extras?.unpaid_deduction_cents ?? 0) + (extras?.incomplete_deduction_cents ?? 0) + (extras?.salary_advance_cents ?? 0)
    : 0;
  const otC = entry ? (entry.ot_cents ?? otPay(entry.basic_cents, entry.ot_hours)) : 0;
  const net = entry
    ? entry.basic_cents + (extras?.ph_worked_cents ?? 0) + entry.commission_cents + entry.allowance_cents + otC - entry.deduction_cents - autoDed
    : 0;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{L("My payslip", "Slip gaji saya")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "View and print your payslip. Amounts are set by payroll processing and cannot be edited here.",
              "Lihat dan cetak slip gaji anda. Amaun ditetapkan oleh pemprosesan gaji dan tidak boleh disunting di sini.",
            )}
          </p>
        </div>
        <input
          type="month"
          className={inputClassSm}
          value={month}
          min={joinedOn ? joinedOn.slice(0, 7) : undefined}
          max={nowMonth}
          onChange={(e) => {
            // Some browsers render max but still allow typing past it —
            // clamp so a future month can never be requested.
            const v = e.target.value;
            if (!v) return;
            setMonth(v > nowMonth ? nowMonth : v);
          }}
        />
      </div>
      {/* v1.77.0 — skeleton until the first fetch lands: the amounts line and
          its two buttons, in the row's real layout, so nothing jumps. */}
      {!loaded ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-hidden>
          <Skel className="h-4 w-full max-w-md" />
          <span className={rowActions}>
            <Skel className="h-7 w-24" />
            <Skel className="h-7 w-20" />
          </span>
        </div>
      ) : lockedUntil ? (
        <div className="border-border mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <p className="text-sm">
            <><AppIcon name="lock" className="mr-1 -mt-0.5 h-3.5 w-3.5" />{L("Your payslip for", "Slip gaji anda untuk")}</> <span className="font-medium">{monthDMY(month)}</span> {L("will be available on", "akan tersedia pada")}{" "}
            <span className="font-semibold">{dmy(lockedUntil)}, {lockedUntil.split(" ")[1]} MYT</span>.
          </p>
          <button
            type="button"
            disabled
            className={`${btnSm} cursor-not-allowed`}
          >
            {L("Print payslip", "Cetak slip gaji")}
          </button>
        </div>
      ) : beforeJoining ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {/* v1.28.0: entity-neutral — which company employs the person is
                the payslip's business, not this helper line's. */}
            {L("You joined us on", "Anda menyertai kami pada")} {dmy(joinedOn)}{L(" — no payslip exists for this month.", " — tiada slip gaji wujud untuk bulan ini.")}
          </p>
          <button
            type="button"
            disabled
            className={`${btnSm} cursor-not-allowed`}
          >
            {L("Print payslip", "Cetak slip gaji")}
          </button>
        </div>
      ) : entry ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {L("Basic", "Pokok")} {rm(entry.basic_cents)} ·{" "}{entry.commission_cents > 0 ? <>{L("Commission", "Komisen")} {rm(entry.commission_cents)} ·{" "}</> : null}
            {L("Allowance", "Elaun")} {rm(entry.allowance_cents)} · OT {rm(otC)} ·{" "}
            {L("Deductions", "Potongan")} {rm(entry.deduction_cents + autoDed)} ·{" "}
            <span className="font-semibold">{L("Net", "Bersih")} {rm(Math.max(0, net))}</span>
          </span>
          <span className={rowActions}>
            <button type="button" className={rowBtn}
              onClick={() => printPayslip(entry, entry, month, extras, releaseIssuer)}>
              {L("Print payslip", "Cetak slip gaji")}
            </button>
            {/* v1.4.257: the errand this exists for is a bank or a landlord
                asking for a payslip while you are standing at their counter. */}
            <button type="button" className={rowBtnPrimary} title={L("Send the payslip as a PDF file", "Hantar slip gaji sebagai fail PDF")}
              onClick={() => void sendPayslipPdf(entry, entry, month, extras, releaseIssuer)}>
              {L("Send PDF", "Hantar PDF")}
            </button>
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          {L("No payslip for this month yet — it appears once payroll is processed.", "Belum ada slip gaji untuk bulan ini — ia muncul setelah gaji diproses.")}
        </p>
      )}
    </div>
  );
}
