"use client";

/**
 * Payroll processing (v1.4.36).
 *
 * Month picker → every staff member with Basic / Commission / Allowance /
 * Deduction amounts (RM). Save upserts one entry per person per month;
 * Payslip prints a branded AZ ONE OFFICIAL A4 payslip. Processed by the CEO
 * or hr_admin (hr_manage); COO/CCO see it read-only via exec view.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { displayName } from "@/lib/names";
import { useSaveToast } from "@/components/ui/save-toast";
import { buildPayslipPdf, type PayslipData } from "@/lib/payslip-pdf";
import { sharePdfFile } from "@/lib/doc-pdf";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { card } from "@/lib/ui-styles";
import { rowBtn, rowBtnPrimary, rowActions } from "@/components/ui/row-button";

const API = "/api/v1/staff";

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: null };
  }
}

const inputSm =
  "rounded-lg border border-input bg-background px-2 py-1 text-xs w-24";

const _COMPANY = {
  name: "AZ ONE OFFICIAL",
  ssm: "SSM Registration No. 202603168673 (JM1046169-H)",
  location: "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor, Malaysia",
};

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

/** v1.4.82 incomplete-month adjustment — the ONE formula used by the table,
    the payslip and the staff self-view so they can never disagree:
      missing = max(0, workingDays − workedDays)
      adjustable = max(0, missing − approvedUnpaidLeaveDays)   ← unpaid leave
        already deducts separately at basic ÷ 26 (v1.4.79); excluding it here
        prevents the same day being deducted twice
      adjustment = round(FULL basic × adjustable ÷ workingDays)
    workedDays null/undefined = full month = no adjustment. */
function incompleteMonthAdj(basicCents: number, workedDays: number | null | undefined, workingDays: number | null | undefined, unpaidLeaveDays: number): number {
  if (workedDays === null || workedDays === undefined || !workingDays || workingDays <= 0) return 0;
  const missing = Math.max(0, workingDays - workedDays);
  const adjustable = Math.max(0, missing - unpaidLeaveDays);
  return Math.round((basicCents * adjustable) / workingDays);
}

// v1.4.272: the local formatter became an alias of the global — payroll's
// numbers must print identically to every other tab's.
import { fmtRM, rm as rmBare, dmy, ym } from "@/lib/format";
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
export type SlipExtras = { working_day: number; public_holiday: number; annual_leave: number; medical_leave: number; emergency_leave?: number; unpaid_leave?: number; unpaid_deduction_cents?: number; annual_bal: number; sick_bal: number } | null;

export function payslipData(
  u: StaffRow & { employment_status?: string | null },
  e: Entry,
  month: string,
  x?: SlipExtras,
): PayslipData {
  const hourlySlip = isHourly(u) || (e.hourly_minutes != null && e.hourly_rate_cents != null);
  const otCents = hourlySlip ? 0 : (e.ot_cents ?? otPay(e.basic_cents, e.ot_hours));
  const gross = e.basic_cents + e.commission_cents + e.allowance_cents + otCents;
  const unpaidDed = hourlySlip ? 0 : (x?.unpaid_deduction_cents ?? 0);
  const incompAdj = hourlySlip ? 0 : incompleteMonthAdj(e.basic_cents, e.worked_days, e.month_working_days, x?.unpaid_leave ?? 0);
  const totalDed = e.deduction_cents + unpaidDed + incompAdj;
  const n2v = (v: number) => rmBare(Math.round(v * 100)); // v1.4.272: routed through the global
  const hrs = e.hourly_minutes != null ? `${Math.floor(e.hourly_minutes / 60)}H ${String(e.hourly_minutes % 60).padStart(2, "0")}M` : "";

  const earnings: [string, number][] = hourlySlip
    ? [[`HOURLY PAY (${hrs} × ${fmtRM(e.hourly_rate_cents ?? 1500)}/HOUR)`, e.basic_cents]]
    : [["BASIC PAY", e.basic_cents]];
  if (e.commission_cents > 0) earnings.push(["COMMISSION", e.commission_cents]);
  if (e.allowance_cents > 0) earnings.push(["ALLOWANCE", e.allowance_cents]);
  if (otCents > 0) earnings.push([`OVERTIME (${e.ot_hours ?? 0} HRS × 1.5 × HOURLY ORP)`, otCents]);

  const deductions: [string, number][] = [];
  if (e.deduction_cents > 0) deductions.push(["LATE / OTHER DEDUCTION", e.deduction_cents]);
  if (unpaidDed > 0) {
    const d = x?.unpaid_leave ?? 0;
    deductions.push([`UNPAID LEAVE (${n2v(d)} DAY${d === 1 ? "" : "S"} × 1/26 MONTHLY WAGE)`, unpaidDed]);
  }
  if (incompAdj > 0) deductions.push([`INCOMPLETE MONTH (WORKED ${e.worked_days} OF ${e.month_working_days} PAYABLE DAYS)`, incompAdj]);

  const others: [string, number][] = [];
  if (x) {
    others.push(["WORKING DAYS (TOTAL CLOCKED IN)", x.working_day]);
    if (x.public_holiday > 0) others.push(["PUBLIC HOLIDAY", x.public_holiday]);
    if (x.annual_leave > 0) others.push(["ANNUAL LEAVE", x.annual_leave]);
    if (x.medical_leave > 0) others.push(["MEDICAL LEAVE", x.medical_leave]);
    if ((x.emergency_leave ?? 0) > 0) others.push(["EMERGENCY LEAVE (PAID)", x.emergency_leave!]);
    if ((x.unpaid_leave ?? 0) > 0) others.push(["UNPAID LEAVE", x.unpaid_leave!]);
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
  };
}

/* v1.4.257: hand the slip to the phone's share sheet as a real file — the
   errand is a staff member standing at a bank counter being asked for one. */
export async function sendPayslipPdf(
  u: StaffRow & { employment_status?: string | null }, e: Entry, month: string, x?: SlipExtras,
) {
  const d = payslipData(u, e, month, x);
  const blob = await buildPayslipPdf(d);
  await sharePdfFile(blob, `Payslip-${(u.employee_id || u.name).replace(/\s+/g, "-")}-${month}.pdf`,
    `Payslip ${d.name} ${month}`);
}

export function printPayslip(
  u: StaffRow & { employment_status?: string | null },
  e: Entry,
  month: string,
  x?: SlipExtras,
) {
  /* v1.4.257: every figure below comes from payslipData() — the SAME function
     the PDF uses. v1.4.183's hourly rule, v1.4.79's unpaid-leave deduction and
     v1.4.82's incomplete-month adjustment all live there now. */
  const D = payslipData(u, e, month, x);
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
    ? D.deductions.map(([label, v]) => `<tr><td>${label}</td><td class="amt">${amt(v)}</td></tr>`).join("")
    : `<tr><td class="muted">NO DEDUCTION</td><td class="amt"></td></tr>`;
  const othersRows = D.others.map(([label, v]) => `<tr><td>${label}</td><td class="amt">${n2(v)}</td></tr>`).join("");

  const w = window.open("", "_blank", "width=900,height=950");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Payslip ${u.name} ${monthDMY(month)}</title>
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
        <td class="l">EMP'EE #</td><td>: ${u.employee_id ?? "—"}</td>
        <td class="l">DEPT.</td><td>: ${(u.department ?? "—").toUpperCase()}</td>
      </tr>
      <tr>
        <td class="l">EMP'EE NAME</td><td>: ${(u.full_name || u.name).toUpperCase()}</td>
        <td class="l">SECTION</td><td>: ${(u.position ?? "—").toUpperCase()}</td>
      </tr>
      <tr>
        <td class="l">I/C #</td><td>: ${u.ic_number ?? "—"}</td>
        <td></td><td></td>
      </tr>
      <tr>
        <td class="l">STATUS</td><td>: ${(u.employment_status ?? "—").replace("_", " ").toUpperCase()}</td>
        <td class="l">PERIOD</td><td>: ${period.from} &nbsp;TO&nbsp; ${period.to}</td>
      </tr>
      <tr>
        <td class="l">BANK NAME</td><td>: ${(u.bank_name ?? "—").toUpperCase()}</td>
        <td class="l">BANK ACCOUNT</td><td>: ${u.bank_account ?? "—"}</td>
      </tr>
    </table>
    <table class="cols">
      <thead>
        <tr><th style="width:38%">EARNINGS / INCOME</th><th style="width:31%">DEDUCTIONS</th><th style="width:31%">OTHERS</th></tr>
      </thead>
      <tbody>
        <tr class="main">
          <td><table class="inner">
            ${earn.map(([label, c]) => `<tr><td>${label}</td><td class="amt">${amt(c)}</td></tr>`).join("")}
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
  <p class="company">AZ ONE OFFICIAL <span>(SSM 202603168673 / JM1046169-H) · 34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor · Computer-generated payslip — no signature required.</span></p>
  <p class="privacy">SULIT / PRIVATE &amp; CONFIDENTIAL — This payslip is issued to the named employee pursuant to the Employment Act 1955 and contains personal data protected under the Personal Data Protection Act 2010 (PDPA). It must not be disclosed, copied, or shared with any other party without the employee's or the company's written consent. Retain for your records.</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
  w.document.close();
}

export function PayrollPanel({ readOnly = false }: { readOnly?: boolean }) {
  // Opens on the cycle month: July until 05-08, then August (v1.4.89).
  const [month, setMonth] = useState(payrollCycleMonth());
  const [staff, setStaff] = useState<StaffRow[]>([]);
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

  /* v1.4.203 — M2E: filled-.xlsm download + one-time setup (template upload,
     Corporate ID, payer account). The M2E USER ID/password are login
     credentials and are never asked for nor stored. */
  const [m2eCid, setM2eCid] = useState("");
  const [m2eAcc, setM2eAcc] = useState("");
  const [m2eCbid, setM2eCbid] = useState("");
  /* v1.4.226 (CEO: "add commission which is 1.5%"): month sales base +
     rate + target staff for the commission helper. */
  const [commBase, setCommBase] = useState<number | null>(null);
  const [commRate, setCommRate] = useState("1.5");
  const [commWho, setCommWho] = useState("");
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
      showToast("No file", j?.error?.message ?? "M2E file failed — check ⚙ M2E setup below", "notice");
      return;
    }
    const skipped = res.headers.get("X-M2E-Skipped");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `azoo-m2e-salary-${month}.xlsm`; a.click();
    URL.revokeObjectURL(url);
    if (skipped) showToast("Check bank details", `Skipped (fix in Staff Details, then re-download): ${decodeURIComponent(skipped)}`, "notice");
    else showToast("Saved", "M2E workbook downloaded — open, enable macros, generate + upload");
  };
  const saveM2eSettings = async () => {
    const r = await api<{ error?: { message?: string } }>(`/payroll/m2e-settings`, {
      method: "POST", body: JSON.stringify({ corporate_id: m2eCid, payer_account: m2eAcc, client_batch_id: m2eCbid }),
    });
    if (r.ok) showToast("Saved", "M2E settings stored — the 💳 button now fills them into every file");
    else showToast("No changes", r.data?.error?.message ?? "Save failed", "notice");
  };
  const uploadM2eTemplate = async (f: File) => {
    const res = await fetch(`${API}/payroll/m2e-template`, { method: "POST", credentials: "include", body: f });
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (res.ok) { setM2eHasTpl(true); showToast("Saved", "Blank M2E template stored — 💳 now generates the filled workbook"); }
    else showToast("No changes", j?.error?.message ?? "Template upload failed", "notice");
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
    setMsg("Days filled from clock-in records — review, correct if needed, then Save all. Net adjusts automatically; Basic stays full.");
    window.setTimeout(() => setMsg(""), 6000);
  };

  // v1.4.124: the net this panel displays, computed once and SAVED with the
  // entry — /expenses sums these stored figures, so the Expenses card and
  // this total always tally after Save all.
  const netFor = (id: number): number => {
    const e = entry(id);
    const uRow = staff.find((x) => x.id === id);
    if (uRow && isHourly(uRow)) {
      // v1.4.183: hourly pay (auto from the clock) + commission + allowance
      // − deduction. The server recomputes authoritatively on save anyway.
      const hourly = e.hourly_pay_live ?? e.basic_cents;
      return Math.max(0, hourly + e.commission_cents + e.allowance_cents - e.deduction_cents);
    }
    const ul = unpaidDays[id] ?? 0;
    const ulDed = ul > 0 ? Math.round(((base[id] || e.basic_cents) / 26) * ul) : 0;
    const d = workedDays[id];
    const adj = incompleteMonthAdj(e.basic_cents, typeof d === "number" && !Number.isNaN(d) ? d : null, monthDays, ul);
    const ot = otPay(e.basic_cents, e.ot_hours);
    return Math.max(0, e.basic_cents + e.commission_cents + e.allowance_cents + ot - e.deduction_cents - ulDed - adj);
  };

  const saveAll = async () => {
    setMsg("");
    let n = 0;
    for (const u of staff) {
      const e = entries[u.id];
      const d = workedDays[u.id];
      const hasDays = typeof d === "number" && !Number.isNaN(d);
      if (!e && !hasDays) continue; // nothing entered for this row
      if (fingerprint(u.id) === pristineRef.current[u.id]) continue; // unchanged
      const res = await api(`/payroll`, {
        method: "POST",
        body: JSON.stringify({
          ...entry(u.id), month,
          ot_cents: otPay(entry(u.id).basic_cents, entry(u.id).ot_hours),
          worked_days: hasDays ? d : null,
          month_working_days: hasDays ? monthDays : null,
          net_cents: netFor(u.id),
        }),
      });
      if (res.ok) n += 1;
    }
    if (n === 0) showToast("No changes", "Every row already matches what's saved", "notice");
    else showToast("Saved", `${n} ${n === 1 ? "entry" : "entries"} saved for ${month}`);
    void load();
  };

  const [attDays, setAttDays] = useState<Record<number, number>>({});
  // v1.4.79: approved unpaid-leave days — the payslip auto-deducts these.
  const [unpaidDays, setUnpaidDays] = useState<Record<number, number>>({});
  // v1.4.80: staff payslip release state for this month.
  const [release, setRelease] = useState<{ available_from: string; released: { released_at: string } | null } | null>(null);
  // v1.4.78: fixed basic per staff — auto-fills every month; adjust on increment.
  const [base, setBase] = useState<Record<number, number>>({});
  const [baseDraft, setBaseDraft] = useState<Record<number, number>>({});
  const [showBase, setShowBase] = useState(false);

  const load = useCallback(async () => {
    const [u, p, a, b] = await Promise.all([
      api<{ users?: StaffRow[]; staff?: StaffRow[] }>(`/users`),
      api<{ entries: (Entry & { name: string })[]; release?: { available_from: string; released: { released_at: string } | null } }>(`/payroll?month=${month}`),
      api<{ days: { user_id: number; days: number }[]; working_days?: number }>(`/payroll/attendance-days?month=${month}`),
      api<{ base: { user_id: number; base_salary_cents: number }[] }>(`/payroll/base`),
    ]);
    const dmap: Record<number, number> = {};
    for (const r of a.data?.days ?? []) dmap[r.user_id] = r.days;
    setAttDays(dmap);
    // v1.4.84: the month's working days are COMPUTED (Mon–Fri minus every
    // calendar holiday) — no more blanket 26. Still editable for exceptions.
    if (typeof a.data?.working_days === "number" && a.data.working_days > 0) setMonthDays(a.data.working_days);
    const umap: Record<number, number> = {};
    for (const r of (a.data as { unpaid?: { user_id: number; days: number }[] } | null)?.unpaid ?? []) umap[r.user_id] = r.days;
    setUnpaidDays(umap);
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
    const RANK: Record<string, number> = {
      ceo: 1, coo: 2, cco: 3, hr_admin: 4, sales_marketing: 5,
      admin: 6, editor: 7, marketing: 7, live_host: 7,
    };
    list.sort((a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9) || a.name.localeCompare(b.name));
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
    setEntries(map);
    setWorkedDays(savedDays);
    setRelease(p.data?.release ?? null);
    // Snapshot the just-loaded state per row for no-change detection.
    const snap: Record<number, string> = {};
    for (const u of list) {
      const e = map[u.id] ?? { user_id: u.id, basic_cents: bmap[u.id] ?? 0, commission_cents: 0, allowance_cents: 0, deduction_cents: 0 };
      const d = savedDays[u.id];
      // v1.4.128: the SAVED month_working_days anchors the snapshot — if the
      // calendar changed since this row was saved, it must count as dirty.
      snap[u.id] = JSON.stringify([e.basic_cents, e.commission_cents, e.allowance_cents, e.ot_hours ?? null, e.deduction_cents, d ?? null, (e as Entry & { month_working_days?: number | null }).month_working_days ?? null, e.note ?? null]);
    }
    pristineRef.current = snap;
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  // No saved entry for the month yet → Basic pre-fills from the fixed base
  // salary, so processors never retype it. Saving writes the real entry.
  const entry = (id: number): Entry =>
    entries[id] ?? { user_id: id, basic_cents: base[id] ?? 0, commission_cents: 0, allowance_cents: 0, deduction_cents: 0 };

  useEffect(() => {
    setCommBase(null);
    void fetch(`/api/v1/staff/payroll/commission-base?month=${month}`, { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : null))
      .then((d) => { if (d && typeof d === "object" && "total_cents" in d) setCommBase((d as { total_cents: number }).total_cents); })
      .catch(() => { /* old worker: helper hides itself */ });
  }, [month]);

  const setField = (id: number, key: keyof Entry, rmValue: string) => {
    const cents = Math.max(0, Math.round(Number(rmValue || 0) * 100));
    setEntries((m) => ({ ...m, [id]: { ...entry(id), [key]: cents } }));
  };

  const save = async (id: number, name?: string) => {
    setMsg("");
    if (fingerprint(id) === pristineRef.current[id]) {
      showToast("No changes", name ? `${name} — nothing to save` : "Nothing to save", "notice");
      return;
    }
    const d = workedDays[id];
    const res = await api<{ error?: { message?: string } }>(`/payroll`, {
      method: "POST",
      body: JSON.stringify({
        ...entry(id), month,
        ot_cents: otPay(entry(id).basic_cents, entry(id).ot_hours),
        worked_days: typeof d === "number" && !Number.isNaN(d) ? d : null,
        month_working_days: typeof d === "number" && !Number.isNaN(d) ? monthDays : null,
        net_cents: netFor(id),
      }),
    });
    if (res.ok) showToast("Saved", name ?? "Payroll entry saved");
    else setMsg(res.data?.error?.message ?? "Save failed");
    void load();
  };

  const printSlip = async (u: StaffRow) => {
    const d = await api<{ extras: SlipExtras }>(`/payroll/detail?user_id=${u.id}&month=${month}`);
    printPayslip(u, entry(u.id), month, d.data?.extras ?? null);
  };
  /* v1.4.257: same fetch, a real file instead of a print dialog — for the
     staff member who needs the slip somewhere the portal can't follow. */
  const sendSlip = async (u: StaffRow) => {
    const d = await api<{ extras: SlipExtras }>(`/payroll/detail?user_id=${u.id}&month=${month}`);
    await sendPayslipPdf(u, entry(u.id), month, d.data?.extras ?? null);
    showToast("Saved", `Payslip ready to send — ${displayName(u)} ${month}`);
  };

  return (
    <div className={`${card} mt-4 md:mt-6`}>
      {toastNode}
      {payConfirmNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Payroll processing</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            One-pass flow: everything auto-fills — Basic from base salaries,
            working days computed (Mon–Fri minus the holidays on the company
            calendar for that month), days worked from attendance — review,
            then Save all. A holiday the team did NOT observe (worked instead,
            to be replaced later) must be deleted from that month in the
            holiday calendar — the month then counts that day as a working
            day — and added on the actual replacement date, which reduces THAT
            month&apos;s working days. After any calendar change, press
            Re-fill days and Save all so saved entries recompute — otherwise
            payslips keep the old figures and staff are over- or under-paid.
            Net = basic + commission + allowance + overtime (hours × 1.5 ×
            hourly ORP, where hourly = basic ÷ 26 ÷ 8) − manual deduction − unpaid
            leave (statutory rate: 1/26 of monthly wage per day, Employment
            Act — a FIXED divisor, separate from the month&apos;s working
            days) − incomplete month (basic × missing working days ÷ this
            month&apos;s working days; unpaid-leave days excluded so nothing
            deducts twice). Blank days box = full month. No KWSP/SOCSO/EIS
            lines yet — registration pending. Emergency leave is paid, never
            deducted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-muted-foreground text-xs" title="Computed automatically: Monday–Friday minus every holiday on the company calendar (public, replacement and company days). Edit only for exceptions.">
            Working days (auto){" "}
            <input
              type="number" min={1} max={31}
              className="border-input bg-background w-16 rounded-lg border px-2 py-1 text-sm"
              value={monthDays}
              onChange={(e) => setMonthDays(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <input
            type="month"
            className="border-input bg-background rounded-lg border px-2 py-1 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title="Fixed monthly basic per staff — auto-fills every month; adjust here on increment"
            onClick={() => setShowBase((v) => !v)}
          >
            {showBase ? "Close base salaries" : "Base salaries"}
          </button>
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title="Days already auto-fill from attendance on load — this re-fills every box from clock-ins, overwriting manual edits"
            onClick={autoFillDays}
          >
            Re-fill days
          </button>
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title="Server-side repair: recomputes this month's working days from the holiday calendar and re-stores every saved entry's net — use after any calendar change"
            onClick={async () => {
              const r = await api<{ working_days?: number; rows?: number; error?: { message?: string } }>(`/payroll/recompute`, {
                method: "POST", body: JSON.stringify({ month }),
              });
              if (r.ok) showToast("Saved", `Recomputed ${r.data?.rows ?? 0} entries at ${r.data?.working_days ?? "?"} working days`);
              else showToast("No changes", r.data?.error?.message ?? "Recompute failed", "notice");
              void load();
            }}
          >
            🔧 Recompute nets
          </button>
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title="Downloads the official Maybank2E template ALREADY FILLED — Home sheet + salary rows + value date (5th rule) — just open, enable macros, generate, upload, approve. Needs the one-time ⚙ M2E setup first."
            onClick={() => void downloadM2e()}
          >
            💳 M2E salary file
          </button>
          <a
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title="Fallback: the same rows as a CSV whose columns match the template — paste at cell A5 yourself"
            href={`${API}/payroll/payment-file?month=${month}`}
            download
          >
            CSV
          </a>
          <button
            type="button"
            className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            onClick={() => void saveAll()}
          >
            Save all
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}

      {!readOnly && (
        <>
          <details className="mt-2 text-xs">
          <summary className="text-muted-foreground cursor-pointer select-none">
            ⚙ M2E setup (one-time) — {m2eHasTpl === false || !m2eCid || !m2eAcc || !m2eCbid ? "⚠ incomplete: 💳 needs this" : "complete"}
          </summary>
          <div className="border-border mt-2 space-y-2 rounded-lg border p-3">
            <p className="text-muted-foreground">
              Stored once, reused every month. Your M2E <span className="font-medium">User ID and password are never stored</span> — you still sign in yourself to upload and approve.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
              <label className="block">
                <span className="text-muted-foreground">Corporate ID</span>
                <input className="border-border mt-0.5 h-8 w-full rounded-lg border px-2 sm:w-36" value={m2eCid}
                  placeholder="e.g. MYXXXXX" onChange={(e) => setM2eCid(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Client Batch ID</span>
                <input className="border-border mt-0.5 h-8 w-full rounded-lg border px-2 sm:w-36" value={m2eCbid}
                  placeholder="e.g. MYXXXXX1D" title="From your working M2E batch — shown as Client Batch ID on the template's Home sheet"
                  onChange={(e) => setM2eCbid(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Payer account no</span>
                <input className="border-border mt-0.5 h-8 w-full rounded-lg border px-2 sm:w-44" value={m2eAcc}
                  inputMode="numeric" placeholder="Maybank account" onChange={(e) => setM2eAcc(e.target.value)} />
              </label>
              <button type="button" className="border-border col-span-2 inline-flex h-8 items-center justify-center rounded-lg border px-3 font-medium hover:bg-secondary sm:col-span-1"
                onClick={() => void saveM2eSettings()}>
                Save
              </button>
            </div>
            <div className="grid grid-cols-2 items-center gap-2 sm:flex">
              <span className="text-muted-foreground">Blank template (.xlsm): {m2eHasTpl ? "✔ stored" : "not uploaded yet"}</span>
              <label className="border-border col-span-2 inline-flex h-8 w-fit cursor-pointer items-center rounded-lg border px-3 font-medium hover:bg-secondary sm:col-span-1">
                {m2eHasTpl ? "Replace template" : "Upload template"}
                <input type="file" accept=".xlsm" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadM2eTemplate(f); e.target.value = ""; }} />
              </label>
            </div>
            <p className="text-muted-foreground">
              Then 💳 downloads the template already filled: Home sheet (Corporate ID, Client Batch ID, payer account, value date = 5th or the Friday before) + all salary rows from row 5 — Favourite Recipient Code auto-fills from each staff&apos;s Employee ID, Own Ref runs PAYROLL+date+01,02,… Open → enable macros → Generate File → upload → approve → Mark paid.
            </p>
          </div>
        </details>

        {/* v1.4.226: 💰 Commission helper — {month sales} × rate → a staff
            member's COMMISSION box. Draft only: he reviews, then Save all.
            Hidden entirely on an old worker (no base fetched). */}
        {commBase !== null && (
          <details className="text-xs">
            <summary className="cursor-pointer select-none font-medium">
              💰 Commission helper — {ym(month)} sales {rm(commBase)} × rate
            </summary>
            <div className="border-border mt-2 flex flex-wrap items-end gap-2 rounded-lg border p-3">
              <label className="block">
                <span className="text-muted-foreground">Rate %</span>
                <input className="border-border mt-0.5 h-8 w-20 rounded-lg border px-2" inputMode="decimal"
                  value={commRate} onChange={(e) => setCommRate(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Pay to</span>
                <select className="border-border mt-0.5 h-8 rounded-lg border px-2" value={commWho}
                  onChange={(e) => setCommWho(e.target.value)}>
                  <option value="">— choose staff —</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <p className="pb-1.5 font-semibold">
                = {rm(Math.round(commBase * (Number(commRate) || 0) / 100))}
              </p>
              <button type="button" className="bg-primary text-primary-foreground h-8 rounded-lg px-3 font-medium"
                disabled={!commWho || !Number(commRate)}
                onClick={() => {
                  const cents = Math.round(commBase * (Number(commRate) || 0) / 100);
                  const id = Number(commWho);
                  setEntries((m) => ({ ...m, [id]: { ...entry(id), commission_cents: cents } }));
                  showToast("Commission filled", `${rm(cents)} into the COMMISSION box — review, then Save all`);
                }}>
                Fill commission box
              </button>
            </div>
          </details>
        )}
        </>
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
                <span className="font-medium text-green-700">
                  Payslips for {monthDMY(month)} are RELEASED to staff (since {release.released.released_at.slice(0, 16)} UTC).
                  {early && (
                    <>
                      {" "}<span className="font-semibold text-amber-700">⚠ Released EARLY — the automatic date was {dmy(release.available_from)} (after this month closes). The salary run you pay this week is LAST month&apos;s.</span>
                      {" "}<button type="button" className="font-medium underline"
                        title="Take this month's payslips back from staff view — the automatic release date resumes"
                        onClick={async () => {
                          const res = await api(`/payroll/release`, { method: "POST", body: JSON.stringify({ month, undo: true }) });
                          setMsg(res.ok ? "Early release undone — automatic date resumes." : "Undo failed");
                          window.setTimeout(() => setMsg(""), 3000);
                          void load();
                        }}>Undo release</button>
                    </>
                  )}
                </span>
              );
            })()
          ) : (
            <>
              <span className="text-muted-foreground">
                Staff can view {monthDMY(month)} payslips from{" "}
                <span className="font-medium">{dmy(release.available_from)} {release.available_from.split(" ")[1]} MYT</span>
                {" "}(5th of the next month, or the next working day). Until then, only payroll processors see the figures.
                {(() => {
                  /* v1.4.211: when the CURRENT month is on screen, the
                     early release the CEO usually wants is LAST month's —
                     say so instead of relying on him remembering the rule. */
                  const nowM = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
                  const cycleM = new Date(new Date(Date.now() + 8 * 3600 * 1000).setUTCDate(0)).toISOString().slice(0, 7);
                  return month === nowM
                    ? <> Paying salaries early? The payslips to release are <span className="font-medium">{monthDMY(cycleM)}</span> — pick that month above, then Release now.</>
                    : null;
                })()}
              </span>{" "}
              <button
                type="button"
                className="font-medium underline"
                title="Release this month's payslips to staff now, before the automatic date"
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
                    const [yR, moR] = month.split("-").map(Number) as [number, number];
                    const prevM = new Date(Date.UTC(yR, moR - 2, 1)).toISOString().slice(0, 7);
                    const autoD = dmy(release.available_from);
                    const cycleM = new Date(new Date(Date.now() + 8 * 3600 * 1000).setUTCDate(0)).toISOString().slice(0, 7);
                    const ok = month === cycleM
                      ? await payConfirm({
                          title: `Release ${monthDMY(month)} payslips now?`,
                          message: `Ahead of the automatic date (${autoD} 10:00 MYT).\nThis is the normal early release when you pay salaries before the 5th.`,
                          confirmLabel: "Release now",
                        })
                      : await payConfirm({
                          title: "⚠ Early release — check the month",
                          message: `${monthDMY(month)} payslips release automatically on ${autoD} — AFTER the month closes.\n\nThe salary run you are paying now is LAST month's (${monthDMY(prevM)}) — its payslips release by themselves on the 5th, no action needed.`,
                          confirmLabel: `Release ${monthDMY(month)} anyway`,
                          variant: "danger",
                        });
                    if (!ok) return;
                  }
                  const res = await api(`/payroll/release`, { method: "POST", body: JSON.stringify({ month }) });
                  setMsg(res.ok ? "Payslips released to staff." : "Release failed");
                  window.setTimeout(() => setMsg(""), 3000);
                  void load();
                }}
              >
                Release now
              </button>
            </>
          )}
        </p>
      )}

      {showBase && (
        <div className="border-border mt-3 rounded-lg border p-3">
          <p className="text-sm font-semibold">Base salaries (fixed monthly basic)</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Every new month&apos;s Basic auto-fills from these figures — no retyping.
            When someone gets an increment, change it here and it applies from
            the next unsaved month onwards; months already saved stay as saved.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((u) => (
              <label key={u.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{displayName(u)}</span>
                <span className="flex items-center gap-1 whitespace-nowrap">
                  RM
                  <input
                    type="number" min={0} step="0.01"
                    className="border-input bg-background w-24 rounded-lg border px-2 py-1 text-sm"
                    value={baseDraft[u.id] ? (baseDraft[u.id]! / 100).toString() : ""}
                    placeholder="0.00"
                    onChange={(ev) => setBaseDraft((m) => ({ ...m, [u.id]: Math.max(0, Math.round(Number(ev.target.value || 0) * 100)) }))}
                  />
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="bg-primary text-primary-foreground mt-3 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            onClick={async () => {
              let n = 0;
              for (const u of staff) {
                if ((baseDraft[u.id] ?? 0) !== (base[u.id] ?? 0)) {
                  const res = await api(`/payroll/base`, { method: "POST", body: JSON.stringify({ user_id: u.id, base_salary_cents: baseDraft[u.id] ?? 0 }) });
                  if (res.ok) n++;
                }
              }
              if (n > 0) showToast("Saved", `Base salary updated for ${n} staff`);
              else showToast("No changes", "Base salaries already match", "notice");
              void load();
            }}
          >
            Save base salaries
          </button>
        </div>
      )}

      <div className="mt-3 max-h-[30rem] overflow-x-auto overflow-y-auto">
        <table className="tbl-sticky w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Staff</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Basic (RM)</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Commission</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Allowance</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase" title="Overtime hours — paid at 1.5 × hourly ORP (basic ÷ 26 ÷ 8), Employment Act normal-day rate">OT (hrs)</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Deduction</th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">Net</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => {
              const e = entry(u.id);
              const hourlyRow = isHourly(u); // v1.4.183
              const hourlyMins = e.hourly_minutes_live ?? e.hourly_minutes ?? 0;
              const hourlyPay = e.hourly_pay_live ?? (hourlyRow ? e.basic_cents : 0);
              // hourly rows: no unpaid-leave maths, no proration, no OT.
              const ul = hourlyRow ? 0 : (unpaidDays[u.id] ?? 0);
              const ulDed = ul > 0 ? Math.round(((base[u.id] || e.basic_cents) / 26) * ul) : 0;
              const adj = hourlyRow ? 0 : incompleteMonthAdj(e.basic_cents, workedDays[u.id] ?? e.worked_days ?? null, monthDays, ul);
              const ot = hourlyRow ? 0 : otPay(e.basic_cents, e.ot_hours);
              const net = netFor(u.id);
              return (
                <tr key={u.id} className="border-border border-b last:border-0">
                  <td className="px-2 py-1.5">
                    {/* v1.4.260: the payroll row names the person the way the
                        payslip and the bank file do. Reading a nickname here
                        and a legal name on the slip is how a mismatch with the
                        bank account goes unnoticed until a transfer bounces. */}
                    <span className="font-medium">{displayName(u)}</span>{" "}
                    <span className="text-muted-foreground text-xs">{u.position ?? u.role}</span>
                    {hourlyRow && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-900" title="Part-time live host — paid by the hour, RM15.00/h on clocked time; no OT">⏱ hourly</span>}
                  </td>
                  {(["basic_cents", "commission_cents", "allowance_cents"] as const).map((k) => (
                    <td key={k} className="px-2 py-1.5">
                      {hourlyRow && k === "basic_cents" ? (
                        <span className="block text-xs" title="Auto from clock in–out — first in to last out per day, summed for the month. RM15.00/hour (CEO rule). Not editable.">
                          <span className="font-medium">{(hourlyPay / 100).toFixed(2)}</span>
                          <span className="text-muted-foreground"> · {hmLabel(hourlyMins)} × RM15/h</span>
                        </span>
                      ) : (
                      <input
                        type="number" min={0} step="0.01"
                        className={inputSm}
                        disabled={readOnly}
                        value={e[k] ? (e[k] / 100).toString() : ""}
                        placeholder="0.00"
                        onChange={(ev) => setField(u.id, k, ev.target.value)}
                      />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    {hourlyRow ? (
                      <span className="text-muted-foreground text-xs" title="Part-time live hosts are not OT-eligible (CEO rule) — contract/permanent live hosts are">—</span>
                    ) : (
                    <input
                      type="number" min={0} max={300} step="0.5"
                      className={inputSm}
                      disabled={readOnly}
                      value={e.ot_hours ? e.ot_hours.toString() : ""}
                      placeholder="0"
                      title={ot > 0 ? `= ${rm(ot)} at 1.5 × hourly ORP` : "Overtime hours (halves allowed)"}
                      onChange={(ev) => {
                        const h = ev.target.value === "" ? null : Math.max(0, Number(ev.target.value));
                        setEntries((m) => ({ ...m, [u.id]: { ...e, ot_hours: h } }));
                      }}
                    />
                    )}
                    {ot > 0 && <span className="text-muted-foreground block text-[10px]">= {rm(ot)}</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number" min={0} step="0.01"
                      className={inputSm}
                      disabled={readOnly}
                      value={e.deduction_cents ? (e.deduction_cents / 100).toString() : ""}
                      placeholder="0.00"
                      onChange={(ev) => setField(u.id, "deduction_cents", ev.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="font-medium">{rm(Math.max(0, net))}</span>
                    {(adj > 0 || ulDed > 0) && (
                      <span
                        className="block text-[10px] text-red-700"
                        title={`Auto-deducted on the payslip: ${adj > 0 ? `incomplete month ${rm(adj)}` : ""}${adj > 0 && ulDed > 0 ? " + " : ""}${ulDed > 0 ? `unpaid leave ${rm(ulDed)}` : ""} — Basic stays full`}
                      >
                        −{rm(adj + ulDed)} auto
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {hourlyRow ? (
                      <span className="text-muted-foreground text-xs" title="Hourly pay is computed from clocked time directly — no worked-days proration">{hmLabel(hourlyMins)}</span>
                    ) : !readOnly && (
                      <>
                        <input
                          type="number" min={0} max={31}
                          className="border-input bg-background w-12 rounded border px-1 py-0.5 text-xs"
                          placeholder="d"
                          title={`Days worked (of ${monthDays}) — attendance recorded ${attDays[u.id] ?? 0} clock-in day(s) this month; edit freely to correct wrong or dishonest punches`}
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
                          title="Clock-in days recorded in Attendance this month"
                        >
                          ⏱{attDays[u.id] ?? 0}
                        </span>
                        {(unpaidDays[u.id] ?? 0) > 0 && (
                          <span
                            className="ml-1 text-[10px] font-semibold text-red-700"
                            title={`${unpaidDays[u.id]} approved unpaid-leave day(s) — the payslip deducts this automatically at basic ÷ 26 per day. Keep Basic full and do NOT deduct it again here.`}
                          >
                            UL:{unpaidDays[u.id]}
                          </span>
                        )}
                        {(base[u.id] ?? 0) > 0 && e.basic_cents !== base[u.id] && (
                          <button type="button" className="ml-1 text-xs underline" title="Reset Basic to the fixed base salary (use this to fix rows the old Prorate button shrank)"
                            onClick={() => setEntries((m) => ({ ...m, [u.id]: { ...e, basic_cents: base[u.id]! } }))}>
                            Base
                          </button>
                        )}
                        <button type="button" className="ml-2 text-xs underline" onClick={() => void save(u.id, u.name)}>
                          Save
                        </button>
                      </>
                    )}
                    <button type="button" className={`${rowBtn} ml-2`} onClick={() => void printSlip(u)}>
                      Payslip
                    </button>
                    <button type="button" className={`${rowBtn} ml-1.5`} title="Send this payslip as a PDF file"
                      onClick={() => void sendSlip(u)}>
                      Send PDF
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* v1.4.75: month totals — the final amount at a glance. Live: they
              update as figures are typed, before saving. */}
          <tfoot>
            {(() => {
              const tot = staff.reduce(
                (a, u) => {
                  const e = entry(u.id);
                  if (isHourly(u)) {
                    // v1.4.183: hourly rows — clocked pay, no UL/proration/OT
                    const hp = e.hourly_pay_live ?? e.basic_cents;
                    a.basic += hp; a.comm += e.commission_cents; a.allow += e.allowance_cents;
                    a.ded += e.deduction_cents;
                    a.net += Math.max(0, hp + e.commission_cents + e.allowance_cents - e.deduction_cents);
                    return a;
                  }
                  const ul = unpaidDays[u.id] ?? 0;
                  const ulDed = ul > 0 ? Math.round(((base[u.id] || e.basic_cents) / 26) * ul) : 0;
                  const adj = incompleteMonthAdj(e.basic_cents, workedDays[u.id] ?? e.worked_days ?? null, monthDays, ul);
                  const ot = otPay(e.basic_cents, e.ot_hours);
                  a.basic += e.basic_cents; a.comm += e.commission_cents;
                  a.allow += e.allowance_cents; a.ot += ot; a.ded += e.deduction_cents + ulDed + adj;
                  a.net += Math.max(0, e.basic_cents + e.commission_cents + e.allowance_cents + ot - e.deduction_cents - ulDed - adj);
                  return a;
                },
                { basic: 0, comm: 0, allow: 0, ot: 0, ded: 0, net: 0 },
              );
              return (
                <tr className="border-border border-t-2 font-semibold">
                  <td className="px-2 py-2">TOTAL — {staff.length} staff</td>
                  <td className="px-2 py-2 whitespace-nowrap">{rm(tot.basic)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{rm(tot.comm)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{rm(tot.allow)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{rm(tot.ot)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{tot.ded > 0 ? `− ${rm(tot.ded)}` : rm(0)}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-base">{rm(tot.net)}</td>
                  <td className="px-2 py-2"></td>
                </tr>
              );
            })()}
          </tfoot>
        </table>
      </div>
    </div>
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

  // v1.4.80: a month's payslip unlocks on the 5th of the following month at
  // 10:00 MYT (next working day if that's a weekend/holiday), unless payroll
  // released it early.
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  useEffect(() => {
    void api<{ entry: (Entry & StaffRow) | null; extras: Parameters<typeof printPayslip>[3]; joined_on?: string | null; locked?: boolean; available_from?: string }>(
      `/payroll/self?month=${month}`,
    ).then((r) => {
      setEntry(r.data?.entry ?? null);
      setExtras(r.data?.extras ?? null);
      setJoinedOn(r.data?.joined_on ?? null);
      setLockedUntil(r.data?.locked ? (r.data.available_from ?? null) : null);
    });
  }, [month]);

  // Months before the person joined AZ ONE OFFICIAL have no payslip — the
  // button greys out instead of pretending one could exist.
  const beforeJoining = Boolean(joinedOn && month < joinedOn.slice(0, 7));

  const autoDed = entry
    ? (extras?.unpaid_deduction_cents ?? 0) +
      incompleteMonthAdj(entry.basic_cents, entry.worked_days, entry.month_working_days, extras?.unpaid_leave ?? 0)
    : 0;
  const otC = entry ? (entry.ot_cents ?? otPay(entry.basic_cents, entry.ot_hours)) : 0;
  const net = entry
    ? entry.basic_cents + entry.commission_cents + entry.allowance_cents + otC - entry.deduction_cents - autoDed
    : 0;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">My payslip</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            View and print your payslip. Amounts are set by payroll processing
            and cannot be edited here.
          </p>
        </div>
        <input
          type="month"
          className="border-input bg-background rounded-lg border px-2 py-1 text-sm"
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
      {lockedUntil ? (
        <div className="border-border mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <p className="text-sm">
            🔒 Your payslip for <span className="font-medium">{monthDMY(month)}</span> will be available on{" "}
            <span className="font-semibold">{dmy(lockedUntil)}, {lockedUntil.split(" ")[1]} MYT</span>.
          </p>
          <button
            type="button"
            disabled
            className="inline-flex h-8 cursor-not-allowed items-center rounded-lg bg-gray-300 px-3 text-xs font-medium text-gray-500"
          >
            Print payslip
          </button>
        </div>
      ) : beforeJoining ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            You joined AZ ONE OFFICIAL on {dmy(joinedOn)} — no payslip exists for this month.
          </p>
          <button
            type="button"
            disabled
            className="inline-flex h-8 cursor-not-allowed items-center rounded-lg bg-gray-300 px-3 text-xs font-medium text-gray-500"
          >
            Print payslip
          </button>
        </div>
      ) : entry ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Basic {rm(entry.basic_cents)} · Commission {rm(entry.commission_cents)} ·
            Allowance {rm(entry.allowance_cents)} · OT {rm(otC)} ·
            Deductions {rm(entry.deduction_cents + autoDed)} ·{" "}
            <span className="font-semibold">Net {rm(Math.max(0, net))}</span>
          </span>
          <span className={rowActions}>
            <button type="button" className={rowBtn}
              onClick={() => printPayslip(entry, entry, month, extras)}>
              Print payslip
            </button>
            {/* v1.4.257: the errand this exists for is a bank or a landlord
                asking for a payslip while you are standing at their counter. */}
            <button type="button" className={rowBtnPrimary} title="Send the payslip as a PDF file"
              onClick={() => void sendPayslipPdf(entry, entry, month, extras)}>
              Send PDF
            </button>
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          No payslip for this month yet — it appears once payroll is processed.
        </p>
      )}
    </div>
  );
}
