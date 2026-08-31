"use client";

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
const api = makeApi("/staff");
import { useCallback, useEffect, useRef, useState } from "react";
import { esc } from "@/lib/escape-html";
import { displayName } from "@/lib/names";
import { useSaveToast } from "@/components/ui/save-toast";
import { buildPayslipPdf, type PayslipData } from "@/lib/payslip-pdf";
import { sharePdfFile } from "@/lib/doc-pdf";
/* v1.28.0 — the payslip's employer of record is decided at RELEASE time and
   stored on payslip_releases.issuer_code; the letterhead resolves it here. */
import { resolveIssuer } from "@/lib/issuers";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { incompleteCents } from "@/lib/payroll-days";
import { btnSm, card } from "@/lib/ui-styles";
import { rowBtn, rowBtnPrimary, rowActions } from "@/components/ui/row-button";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const API = "/api/v1/staff";


const inputSm =
  "rounded-lg border border-input bg-background px-2 py-1 text-xs w-24";

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

/* v1.75.0 — the arithmetic moved to lib/payroll-days.ts so a test can run it
   with real numbers instead of a regex reading its source. Re-exported here
   under the old name so every call site in this file reads the same. */
function incompleteMonthAdj(basicCents: number, payableDays: number | null | undefined, workingDays: number | null | undefined): number {
  return incompleteCents(basicCents, workingDays, payableDays);
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
export type SlipExtras = { working_day: number; public_holiday: number; annual_leave: number; medical_leave: number; emergency_leave?: number; unpaid_leave?: number; unpaid_deduction_cents?: number; annual_bal: number; sick_bal: number;
  /* v1.75.0 — the employment-date figures. The server computes the
     incomplete-month deduction once and the slip prints THAT number. */
  month_working_days?: number; payable_days?: number; incomplete_deduction_cents?: number;
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
  const gross = e.basic_cents + e.commission_cents + e.allowance_cents + otCents;
  const unpaidDed = hourlySlip ? 0 : (x?.unpaid_deduction_cents ?? 0);
  const incompAdj = hourlySlip ? 0 : (x?.incomplete_deduction_cents ?? 0);
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
    /* v1.75.0: fractions are real now — half a day, or the hours somebody
       was short of eight. n2v already prints two decimals. */
    const d = x?.unpaid_leave ?? 0;
    deductions.push([`UNPAID LEAVE (${n2v(d)} DAY${d === 1 ? "" : "S"} × 1/26 MONTHLY WAGE)`, unpaidDed]);
  }
  /* v1.75.0: this line now only ever appears for a mid-month joiner or
     leaver, and says why — "EMPLOYED 12 OF 19", not "WORKED 15 OF 19", which
     read like an accusation about attendance and was arithmetically wrong. */
  if (incompAdj > 0) {
    const when = x?.joined_on && x.joined_on.slice(0, 7) === month ? `JOINED ${x.joined_on}`
      : x?.left_on && x.left_on.slice(0, 7) === month ? `LEFT ${x.left_on}` : "PART MONTH";
    deductions.push([`INCOMPLETE MONTH (${when} — EMPLOYED ${x?.payable_days ?? 0} OF ${x?.month_working_days ?? 0} WORKING DAYS)`, incompAdj]);
  }

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

  const w = window.open("", "_blank", "width=900,height=950");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Payslip ${esc(u.name)} ${esc(monthDMY(month))}</title>
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
  w.document.close();
}

/* v1.75.0 — a working day with no clock-in, or one clocked well short of
   eight hours. Proposed, never deducted on its own. */
type AbsenceRow = { user_id: number; name: string; missing: string[]; short: { d: string; hours: number }[] };

export function PayrollPanel({ readOnly = false, role = "" }: { readOnly?: boolean; role?: string }) {
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
  type PrCol = "staff" | "basic" | "comm" | "allow" | "ot" | "deduct" | "net";
  const [prSort, setPrSort] = useState<{ col: PrCol; asc: boolean }>({ col: "staff", asc: true });
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
      showToast(L("No file", "Tiada fail"), j?.error?.message ?? L("M2E file failed — check ⚙ M2E setup below", "Fail M2E gagal — semak persediaan ⚙ M2E di bawah"), "notice");
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
    if (r.ok) showToast(L("Saved", "Disimpan"), L("M2E settings stored — the 💳 button now fills them into every file", "Tetapan M2E disimpan — butang 💳 kini mengisinya ke dalam setiap fail"));
    else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Save failed", "Simpan gagal"), "notice");
  };
  const uploadM2eTemplate = async (f: File) => {
    /* v1.23.1: raw fetch (binary body, api() would JSON it); v1.26.2: through
       csrfFetch so it self-heals a missing csrf cookie like every other call. */
    const res = await csrfFetch(`${API}/payroll/m2e-template`, { method: "POST", body: f });
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (res.ok) { setM2eHasTpl(true); showToast(L("Saved", "Disimpan"), L("Blank M2E template stored — 💳 now generates the filled workbook", "Templat M2E kosong disimpan — 💳 kini menjana buku kerja yang terisi")); }
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
    const adj = incompleteMonthAdj(e.basic_cents, payableDays[id] ?? monthDays, monthDays);
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
    if (n === 0) showToast(L("No changes", "Tiada perubahan"), L("Every row already matches what's saved", "Setiap baris sudah sepadan dengan yang disimpan"), "notice");
    else showToast(L("Saved", "Disimpan"), L(`${n} ${n === 1 ? "entry" : "entries"} saved for ${month}`, `${n} entri disimpan untuk ${month}`));
    void load();
  };

  const [attDays, setAttDays] = useState<Record<number, number>>({});
  // v1.4.79: approved unpaid-leave days — the payslip auto-deducts these.
  const [unpaidDays, setUnpaidDays] = useState<Record<number, number>>({});
  /* v1.75.0 — how many of the month's working days each person was EMPLOYED
     for, from the server (joined_on / left_on). This, not the attendance
     clock, is what prorates a basic. Absent = the same for everyone except a
     mid-month joiner or leaver. */
  const [payableDays, setPayableDays] = useState<Record<number, number>>({});
  /* CEO: "Unpaid will be count based on their no data in." The scan finds
     them; a person decides. Marking is CEO-only on the server (unpaid_leave),
     so the card is too — a button that 403s is worse than no button. */
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [marking, setMarking] = useState("");
  /* One click = one recorded unpaid day. `hours` present means a short day:
     the server turns hours-short into a quarter-day fraction, so the rule
     lives in exactly one place rather than being computed here as well. */
  const markUnpaid = async (userId: number, date: string, hours?: number) => {
    setMarking(`${userId}|${date}`);
    const r = await api<{ days?: number; error?: { message?: string } }>(`/attendance/unpaid`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId, date,
        ...(hours !== undefined ? { hours_worked: hours } : {}),
        reason: hours !== undefined ? `Short day - clocked ${hours}h of 8h` : "No clock-in",
      }),
    });
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
  const [release, setRelease] = useState<{ available_from: string; released: { released_at: string; issuer_code?: string | null } | null } | null>(null);
  // v1.4.78: fixed basic per staff — auto-fills every month; adjust on increment.
  const [base, setBase] = useState<Record<number, number>>({});
  const [baseDraft, setBaseDraft] = useState<Record<number, number>>({});
  const [showBase, setShowBase] = useState(false);

  const load = useCallback(async () => {
    const [u, p, a, b] = await Promise.all([
      api<{ users?: StaffRow[]; staff?: StaffRow[] }>(`/users`),
      api<{ entries: (Entry & { name: string })[]; release?: { available_from: string; released: { released_at: string; issuer_code?: string | null } | null } }>(`/payroll?month=${month}`),
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
    const emap: Record<number, number> = {};
    for (const r of (a.data as { employed?: { user_id: number; payable_days: number }[] } | null)?.employed ?? []) {
      emap[r.user_id] = r.payable_days;
    }
    setPayableDays(emap);
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

  return (
    <div className={`${card} mt-4 md:mt-6`}>
      {toastNode}
      {payConfirmNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{L("Payroll processing", "Pemprosesan gaji")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "One-pass flow: everything auto-fills — Basic from base salaries, working days computed (Mon–Fri minus the holidays on the company calendar for that month), days worked from attendance — review, then Save all. A holiday the team did NOT observe (worked instead, to be replaced later) must be deleted from that month in the holiday calendar — the month then counts that day as a working day — and added on the actual replacement date, which reduces THAT month's working days. After any calendar change, press Re-fill days and Save all so saved entries recompute — otherwise payslips keep the old figures and staff are over- or under-paid. Net = basic + commission + allowance + overtime (hours × 1.5 × hourly ORP, where hourly = basic ÷ 26 ÷ 8) − manual deduction − unpaid leave (statutory rate: 1/26 of monthly wage per day, Employment Act — a FIXED divisor, separate from the month's working days) − incomplete month (basic × missing working days ÷ this month's working days; unpaid-leave days excluded so nothing deducts twice). Blank days box = full month. No KWSP/SOCSO/EIS lines yet — registration pending. Emergency leave is paid, never deducted.",
              "Aliran satu laluan: semuanya terisi automatik — Gaji pokok daripada gaji asas, hari bekerja dikira (Isnin–Jumaat tolak cuti pada kalendar syarikat bagi bulan itu), hari bekerja sebenar daripada kehadiran — semak, kemudian Simpan semua. Cuti yang TIDAK diambil oleh pasukan (bekerja seperti biasa, untuk diganti kemudian) mesti dipadam daripada bulan itu dalam kalendar cuti — bulan itu kemudian mengira hari tersebut sebagai hari bekerja — dan ditambah pada tarikh gantian sebenar, yang mengurangkan hari bekerja bulan TERSEBUT. Selepas sebarang perubahan kalendar, tekan Isi semula hari dan Simpan semua supaya entri yang disimpan dikira semula — jika tidak, slip gaji kekal dengan angka lama dan kakitangan terlebih atau terkurang bayar. Bersih = pokok + komisen + elaun + OT (jam × 1.5 × ORP sejam, di mana kadar sejam = pokok ÷ 26 ÷ 8) − potongan manual − cuti tanpa gaji (kadar statutori: 1/26 gaji bulanan sehari, Akta Kerja — pembahagi TETAP, berasingan daripada hari bekerja bulan itu) − bulan tidak lengkap (pokok × hari bekerja yang tiada ÷ hari bekerja bulan ini; hari cuti tanpa gaji dikecualikan supaya tiada potongan dua kali). Kotak hari kosong = bulan penuh. Belum ada baris KWSP/SOCSO/EIS — pendaftaran belum selesai. Cuti kecemasan dibayar, tidak sekali-kali dipotong.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-muted-foreground text-xs" title={L("Computed automatically: Monday–Friday minus every holiday on the company calendar (public, replacement and company days). Edit only for exceptions.", "Dikira secara automatik: Isnin–Jumaat tolak setiap cuti pada kalendar syarikat (cuti umum, gantian dan hari syarikat). Sunting hanya untuk pengecualian.")}>
            {L("Working days (auto)", "Hari bekerja (auto)")}{" "}
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
            title={L("Fixed monthly basic per staff — auto-fills every month; adjust here on increment", "Gaji pokok bulanan tetap bagi setiap kakitangan — terisi automatik setiap bulan; laraskan di sini apabila ada kenaikan")}
            onClick={() => setShowBase((v) => !v)}
          >
            {showBase ? L("Close base salaries", "Tutup gaji asas") : L("Base salaries", "Gaji asas")}
          </button>
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title={L("Days already auto-fill from attendance on load — this re-fills every box from clock-ins, overwriting manual edits", "Hari sudah terisi automatik daripada kehadiran semasa dimuat — ini mengisi semula setiap kotak daripada rekod daftar masuk, menulis ganti suntingan manual")}
            onClick={autoFillDays}
          >
            {L("Re-fill days", "Isi semula hari")}
          </button>
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title={L("Server-side repair: recomputes this month's working days from the holiday calendar and re-stores every saved entry's net — use after any calendar change", "Pembaikan di pelayan: mengira semula hari bekerja bulan ini daripada kalendar cuti dan menyimpan semula bersih setiap entri yang disimpan — guna selepas sebarang perubahan kalendar")}
            onClick={async () => {
              const r = await api<{ working_days?: number; rows?: number; error?: { message?: string } }>(`/payroll/recompute`, {
                method: "POST", body: JSON.stringify({ month }),
              });
              if (r.ok) showToast(L("Saved", "Disimpan"), L(`Recomputed ${r.data?.rows ?? 0} entries at ${r.data?.working_days ?? "?"} working days`, `${r.data?.rows ?? 0} entri dikira semula pada ${r.data?.working_days ?? "?"} hari bekerja`));
              else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Recompute failed", "Kira semula gagal"), "notice");
              void load();
            }}
          >
            {L("🔧 Recompute nets", "🔧 Kira semula bersih")}
          </button>
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title={L("Downloads the official Maybank2E template ALREADY FILLED — Home sheet + salary rows + value date (5th rule) — just open, enable macros, generate, upload, approve. Needs the one-time ⚙ M2E setup first.", "Muat turun templat rasmi Maybank2E yang SUDAH TERISI — helaian Home + baris gaji + tarikh nilai (peraturan ke-5) — hanya buka, aktifkan makro, jana, muat naik, luluskan. Perlukan persediaan ⚙ M2E sekali sahaja terlebih dahulu.")}
            onClick={() => void downloadM2e()}
          >
            {L("💳 M2E salary file", "💳 Fail gaji M2E")}
          </button>
          <a
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            title={L("Fallback: the same rows as a CSV whose columns match the template — paste at cell A5 yourself", "Sandaran: baris yang sama sebagai CSV dengan lajur sepadan templat — tampal di sel A5 sendiri")}
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
            {L("Save all", "Simpan semua")}
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}

      {!readOnly && (<>
        <details className="mt-2 text-xs">
          <summary className="text-muted-foreground cursor-pointer select-none">
            {L("⚙ M2E setup (one-time) — ", "⚙ Persediaan M2E (sekali sahaja) — ")}{m2eHasTpl === false || !m2eCid || !m2eAcc || !m2eCbid ? L("⚠ incomplete: 💳 needs this", "⚠ belum lengkap: 💳 memerlukannya") : L("complete", "lengkap")}
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
              <button type="button" className="border-border col-span-2 inline-flex h-8 items-center justify-center rounded-lg border px-3 font-medium hover:bg-secondary sm:col-span-1"
                onClick={() => void saveM2eSettings()}>
                {L("Save", "Simpan")}
              </button>
            </div>
            <div className="grid grid-cols-2 items-center gap-2 sm:flex">
              <span className="text-muted-foreground">{L("Blank template (.xlsm): ", "Templat kosong (.xlsm): ")}{m2eHasTpl ? L("✔ stored", "✔ disimpan") : L("not uploaded yet", "belum dimuat naik")}</span>
              <label className="border-border col-span-2 inline-flex h-8 w-fit cursor-pointer items-center rounded-lg border px-3 font-medium hover:bg-secondary sm:col-span-1">
                {m2eHasTpl ? L("Replace template", "Ganti templat") : L("Upload template", "Muat naik templat")}
                <input type="file" accept=".xlsm" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadM2eTemplate(f); e.target.value = ""; }} />
              </label>
            </div>
            <p className="text-muted-foreground">
              {L(
                "Then 💳 downloads the template already filled: Home sheet (Corporate ID, Client Batch ID, payer account, value date = 5th or the Friday before) + all salary rows from row 5 — Favourite Recipient Code auto-fills from each staff's Employee ID, Own Ref runs PAYROLL+date+01,02,… Open → enable macros → Generate File → upload → approve → Mark paid.",
                "Kemudian 💳 memuat turun templat yang sudah terisi: helaian Home (Corporate ID, Client Batch ID, akaun pembayar, tarikh nilai = 5 haribulan atau Jumaat sebelumnya) + semua baris gaji dari baris 5 — Favourite Recipient Code terisi automatik daripada Employee ID setiap kakitangan, Own Ref berjalan PAYROLL+tarikh+01,02,… Buka → aktifkan makro → Generate File → muat naik → luluskan → Tanda dibayar.",
              )}
            </p>
          </div>
        </details>

        {/* v1.19.0 (consolidation C3): the v1.4.226 percent-helper is gone —
            it multiplied month sales by a TYPED rate, a second commission
            engine beside the Commission tab's rate table. One engine now:
            entries are computed and approved on the Commission tab, and this
            button pulls the approved amounts into the COMMISSION boxes and
            marks them paid — the double-payment path is closed because a
            second click finds nothing left approved. */}
        <div className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs">
          <button type="button" className={btnSm}
            onClick={async () => {
              const r = await api<{ applied: { name: string; amount_cents: number }[]; skipped: string[] }>(
                `/payroll/pull-commission`, { method: "POST", body: JSON.stringify({ month }) });
              if (!r.ok) { showToast(L("No changes", "Tiada perubahan"), L("Payroll access required", "Akses gaji diperlukan"), "notice"); return; }
              const a = r.data?.applied ?? []; const sk = r.data?.skipped ?? [];
              showToast(a.length ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
                a.length
                  ? L(`Pulled ${a.length} approved commission ${a.length === 1 ? "entry" : "entries"} (${rm(a.reduce((x, y) => x + y.amount_cents, 0))})${sk.length ? ` · no payroll row yet: ${sk.join(", ")}` : ""}`, `${a.length} entri komisen diluluskan ditarik (${rm(a.reduce((x, y) => x + y.amount_cents, 0))})${sk.length ? ` · belum ada baris gaji: ${sk.join(", ")}` : ""}`)
                  : sk.length ? L(`No payroll rows for: ${sk.join(", ")} — save the payroll grid first`, `Tiada baris gaji untuk: ${sk.join(", ")} — simpan grid gaji dahulu`) : L("Nothing approved on the Commission tab for this month", "Tiada yang diluluskan pada tab Komisen untuk bulan ini"),
                a.length ? undefined : "notice");
              if (a.length) void load();
            }}>
            {L("Pull approved commission", "Tarik komisen diluluskan")} — {ym(month)}
          </button>
          <span className="text-muted-foreground">{L("Rates & approvals live on the Commission tab.", "Kadar & kelulusan berada di tab Komisen.")}</span>
        </div>
      </>)}

      {/* v1.75.0 (CEO: "Unpaid will be count based on their no data in") —
          days that look unpaid, offered one click at a time. Nothing here
          deducts anything until it is pressed: a missing punch is a client
          visit, a shoot, or a phone that died at least as often as it is an
          absence, and taking pay off somebody for a flat battery is how a
          payroll system loses the room. */}
      {canMarkUnpaid && !readOnly && absences.length > 0 && (
        <div className="border-warning/40 bg-warning-soft/40 mt-3 rounded-xl border p-3">
          <p className="text-sm font-semibold">
            {L("Days with no clock-in — not deducted unless you say so", "Hari tanpa daftar masuk — tidak dipotong melainkan anda tetapkan")}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L("Working days in this month with no clock-in and no approved leave, and days clocked short of 8 hours (break included). Marking one records it as unpaid leave at 1/26 of the monthly wage per day — a short day is charged only for the hours missed, rounded to a quarter day.", "Hari bekerja dalam bulan ini tanpa daftar masuk dan tanpa cuti diluluskan, serta hari yang kurang daripada 8 jam (termasuk rehat). Menandakannya merekodkannya sebagai cuti tanpa gaji pada 1/26 gaji bulanan sehari — hari pendek dikenakan hanya untuk jam yang kurang, dibundarkan kepada suku hari.")}
          </p>
          <div className="mt-2 space-y-2">
            {absences.map((a) => (
              <div key={a.user_id} className="text-xs">
                <span className="font-medium">{a.name}</span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {a.missing.map((d) => (
                    <button key={d} type="button" disabled={marking === `${a.user_id}|${d}`}
                      className="border-border hover:bg-secondary rounded-full border bg-white/60 px-2 py-0.5 disabled:opacity-50 dark:bg-transparent"
                      title={L(`Mark ${d} as a full unpaid day`, `Tanda ${d} sebagai hari tanpa gaji penuh`)}
                      onClick={() => void markUnpaid(a.user_id, d)}>
                      {d.slice(8)}/{d.slice(5, 7)} · {L("no clock-in", "tiada masuk")}
                    </button>
                  ))}
                  {a.short.map((sh) => (
                    <button key={sh.d} type="button" disabled={marking === `${a.user_id}|${sh.d}`}
                      className="border-border hover:bg-secondary rounded-full border bg-white/60 px-2 py-0.5 disabled:opacity-50 dark:bg-transparent"
                      title={L(`Clocked ${sh.hours}h of 8 — mark the missing hours unpaid`, `Direkod ${sh.hours}j daripada 8 — tanda jam yang kurang sebagai tanpa gaji`)}
                      onClick={() => void markUnpaid(a.user_id, sh.d, sh.hours)}>
                      {sh.d.slice(8)}/{sh.d.slice(5, 7)} · {sh.hours}h/8h
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
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
                  {L(`Payslips for ${monthDMY(month)} are RELEASED to staff (since ${release.released.released_at.slice(0, 16)} UTC).`, `Slip gaji untuk ${monthDMY(month)} telah DIKELUARKAN kepada kakitangan (sejak ${release.released.released_at.slice(0, 16)} UTC).`)}
                  {early && (
                    <>
                      {" "}<span className="font-semibold text-amber-700">{L(`⚠ Released EARLY — the automatic date was ${dmy(release.available_from)} (after this month closes). The salary run you pay this week is LAST month's.`, `⚠ DIKELUARKAN AWAL — tarikh automatik ialah ${dmy(release.available_from)} (selepas bulan ini ditutup). Larian gaji yang anda bayar minggu ini ialah bulan LEPAS.`)}</span>
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
                          title: L("⚠ Early release — check the month", "⚠ Keluaran awal — semak bulan"),
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

      {showBase && (
        <div className="border-border mt-3 rounded-lg border p-3">
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
                    className="border-input bg-background w-24 rounded-lg border px-2 py-1 text-sm"
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
            className="bg-primary text-primary-foreground mt-3 inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
            onClick={async () => {
              let n = 0;
              for (const u of staff) {
                if ((baseDraft[u.id] ?? 0) !== (base[u.id] ?? 0)) {
                  const res = await api(`/payroll/base`, { method: "POST", body: JSON.stringify({ user_id: u.id, base_salary_cents: baseDraft[u.id] ?? 0 }) });
                  if (res.ok) n++;
                }
              }
              if (n > 0) showToast(L("Saved", "Disimpan"), L(`Base salary updated for ${n} staff`, `Gaji asas dikemas kini untuk ${n} kakitangan`));
              else showToast(L("No changes", "Tiada perubahan"), L("Base salaries already match", "Gaji asas sudah sepadan"), "notice");
              void load();
            }}
          >
            {L("Save base salaries", "Simpan gaji asas")}
          </button>
        </div>
      )}

      <div className="mt-3 max-h-[30rem] overflow-x-auto overflow-y-auto">
        <table className="tbl-sticky w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              {([
                ["staff", L("Staff", "Kakitangan")],
                ["basic", L("Basic (RM)", "Gaji pokok (RM)")],
                ["comm", L("Commission", "Komisen")],
                ["allow", L("Allowance", "Elaun")],
                ["ot", L("OT (hrs)", "OT (jam)")],
                ["deduct", L("Deduction", "Potongan")],
                ["net", L("Net", "Bersih")]
              ] as [PrCol, string][]).map(([col, label]) => (
                <th key={col} className="text-muted-foreground cursor-pointer px-2 py-2 text-left text-xs font-semibold uppercase select-none"
                  title={col === "ot" ? L("Overtime hours — paid at 1.5 × hourly ORP (basic ÷ 26 ÷ 8), Employment Act normal-day rate\nSort by OT — click again to reverse", "Jam OT — dibayar pada 1.5 × ORP sejam (pokok ÷ 26 ÷ 8), kadar hari biasa Akta Kerja\nIsih ikut OT — klik lagi untuk terbalik") : L(`Sort by ${label} — click again to reverse`, `Isih ikut ${label} — klik lagi untuk terbalik`)}
                  onClick={() => cyclePr(col)}>
                  {label}{prSort.col === col ? (prSort.asc ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {[...staff].sort((a, b) => {
              const dir = prSort.asc ? 1 : -1;
              const ea = entry(a.id);
              const eb = entry(b.id);
              switch (prSort.col) {
                case "staff": return dir * displayName(a).localeCompare(displayName(b));
                case "basic": return dir * (ea.basic_cents - eb.basic_cents);
                case "comm": return dir * (ea.commission_cents - eb.commission_cents);
                case "allow": return dir * (ea.allowance_cents - eb.allowance_cents);
                case "ot": return dir * ((ea.ot_hours || 0) - (eb.ot_hours || 0));
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
              const ulDed = ul > 0 ? Math.round(((base[u.id] || e.basic_cents) / 26) * ul) : 0;
              const adj = hourlyRow ? 0 : incompleteMonthAdj(e.basic_cents, payableDays[u.id] ?? monthDays, monthDays);
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
                    {hourlyRow && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-900" title={L("Part-time live host — paid by the hour, RM15.00/h on clocked time; no OT", "Hos siaran langsung separuh masa — dibayar mengikut jam, RM15.00/jam pada masa berdaftar; tiada OT")}>{L("⏱ hourly", "⏱ ikut jam")}</span>}
                  </td>
                  {(["basic_cents", "commission_cents", "allowance_cents"] as const).map((k) => (
                    <td key={k} className="px-2 py-1.5">
                      {hourlyRow && k === "basic_cents" ? (
                        <span className="block text-xs" title={L("Auto from clock in–out — first in to last out per day, summed for the month. RM15.00/hour (CEO rule). Not editable.", "Auto daripada daftar masuk–keluar — masuk pertama hingga keluar terakhir setiap hari, dijumlahkan untuk bulan itu. RM15.00/jam (peraturan CEO). Tidak boleh disunting.")}>
                          <span className="font-medium">{(hourlyPay / 100).toFixed(2)}</span>
                          <span className="text-muted-foreground"> · {hmLabel(hourlyMins)}{L(" × RM15/h", " × RM15/jam")}</span>
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
                      <span className="text-muted-foreground text-xs" title={L("Part-time live hosts are not OT-eligible (CEO rule) — contract/permanent live hosts are", "Hos siaran langsung separuh masa tidak layak OT (peraturan CEO) — hos kontrak/tetap layak")}>—</span>
                    ) : (
                    <input
                      type="number" min={0} max={300} step="0.5"
                      className={inputSm}
                      disabled={readOnly}
                      value={e.ot_hours ? e.ot_hours.toString() : ""}
                      placeholder="0"
                      title={ot > 0 ? L(`= ${rm(ot)} at 1.5 × hourly ORP`, `= ${rm(ot)} pada 1.5 × ORP sejam`) : L("Overtime hours (halves allowed)", "Jam OT (separuh dibenarkan)")}
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
                        title={L(`Auto-deducted on the payslip: ${adj > 0 ? `incomplete month ${rm(adj)}` : ""}${adj > 0 && ulDed > 0 ? " + " : ""}${ulDed > 0 ? `unpaid leave ${rm(ulDed)}` : ""} — Basic stays full`, `Dipotong automatik pada slip gaji: ${adj > 0 ? `bulan tidak lengkap ${rm(adj)}` : ""}${adj > 0 && ulDed > 0 ? " + " : ""}${ulDed > 0 ? `cuti tanpa gaji ${rm(ulDed)}` : ""} — Gaji pokok kekal penuh`)}
                      >
                        −{rm(adj + ulDed)} auto
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {hourlyRow ? (
                      <span className="text-muted-foreground text-xs" title={L("Hourly pay is computed from clocked time directly — no worked-days proration", "Gaji sejam dikira terus daripada masa berdaftar — tiada prorata hari bekerja")}>{hmLabel(hourlyMins)}</span>
                    ) : !readOnly && (
                      <>
                        <input
                          type="number" min={0} max={31}
                          className="border-input bg-background w-12 rounded border px-1 py-0.5 text-xs"
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
                          ⏱{attDays[u.id] ?? 0}
                        </span>
                        {(unpaidDays[u.id] ?? 0) > 0 && (
                          <span
                            className="ml-1 text-[10px] font-semibold text-red-700"
                            title={L(`${unpaidDays[u.id]} approved unpaid-leave day(s) — the payslip deducts this automatically at basic ÷ 26 per day. Keep Basic full and do NOT deduct it again here.`, `${unpaidDays[u.id]} hari cuti tanpa gaji diluluskan — slip gaji memotong ini secara automatik pada pokok ÷ 26 sehari. Kekalkan Gaji pokok penuh dan JANGAN potong lagi di sini.`)}
                          >
                            UL:{unpaidDays[u.id]}
                          </span>
                        )}
                        {(base[u.id] ?? 0) > 0 && e.basic_cents !== base[u.id] && (
                          <button type="button" className="ml-1 text-xs underline" title={L("Reset Basic to the fixed base salary (use this to fix rows the old Prorate button shrank)", "Set semula Gaji pokok kepada gaji asas tetap (guna ini untuk membetulkan baris yang dikecilkan butang Prorate lama)")}
                            onClick={() => setEntries((m) => ({ ...m, [u.id]: { ...e, basic_cents: base[u.id] || 0 } }))}>
                            {L("Base", "Asas")}
                          </button>
                        )}
                        <button type="button" className="ml-2 text-xs underline" onClick={() => void save(u.id, u.name)}>
                          {L("Save", "Simpan")}
                        </button>
                      </>
                    )}
                    <button type="button" className={`${rowBtn} ml-2`} onClick={() => void printSlip(u)}>
                      {L("Payslip", "Slip gaji")}
                    </button>
                    <button type="button" className={`${rowBtn} ml-1.5`} title={L("Send this payslip as a PDF file", "Hantar slip gaji ini sebagai fail PDF")}
                      onClick={() => void sendSlip(u)}>
                      {L("Send PDF", "Hantar PDF")}
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
                  const adj = incompleteMonthAdj(e.basic_cents, payableDays[u.id] ?? monthDays, monthDays);
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
                  <td className="px-2 py-2">{L("TOTAL", "JUMLAH")} — {staff.length} {L("staff", "kakitangan")}</td>
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
  /* v1.28.0: the month's release-row issuer_code — the EMPLOYER this slip
     prints under. NULL = legacy month = AZ ONE OFFICIAL. */
  const [releaseIssuer, setReleaseIssuer] = useState<string | null>(null);

  // v1.4.80: a month's payslip unlocks on the 5th of the following month at
  // 10:00 MYT (next working day if that's a weekend/holiday), unless payroll
  // released it early.
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  useEffect(() => {
    void api<{ entry: (Entry & StaffRow) | null; extras: Parameters<typeof printPayslip>[3]; joined_on?: string | null; locked?: boolean; available_from?: string; release_issuer_code?: string | null }>(
      `/payroll/self?month=${month}`,
    ).then((r) => {
      setEntry(r.data?.entry ?? null);
      setExtras(r.data?.extras ?? null);
      setJoinedOn(r.data?.joined_on ?? null);
      setReleaseIssuer(r.data?.release_issuer_code ?? null); // v1.28.0
      setLockedUntil(r.data?.locked ? (r.data.available_from ?? null) : null);
    });
  }, [month]);

  // Months before the person joined the company have no payslip — the
  // button greys out instead of pretending one could exist.
  const beforeJoining = Boolean(joinedOn && month < joinedOn.slice(0, 7));

  const autoDed = entry
    ? (extras?.unpaid_deduction_cents ?? 0) + (extras?.incomplete_deduction_cents ?? 0)
    : 0;
  const otC = entry ? (entry.ot_cents ?? otPay(entry.basic_cents, entry.ot_hours)) : 0;
  const net = entry
    ? entry.basic_cents + entry.commission_cents + entry.allowance_cents + otC - entry.deduction_cents - autoDed
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
            {L("🔒 Your payslip for", "🔒 Slip gaji anda untuk")} <span className="font-medium">{monthDMY(month)}</span> {L("will be available on", "akan tersedia pada")}{" "}
            <span className="font-semibold">{dmy(lockedUntil)}, {lockedUntil.split(" ")[1]} MYT</span>.
          </p>
          <button
            type="button"
            disabled
            className="inline-flex h-8 cursor-not-allowed items-center rounded-lg bg-gray-300 px-3 text-xs font-medium text-gray-500"
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
            className="inline-flex h-8 cursor-not-allowed items-center rounded-lg bg-gray-300 px-3 text-xs font-medium text-gray-500"
          >
            {L("Print payslip", "Cetak slip gaji")}
          </button>
        </div>
      ) : entry ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {L("Basic", "Pokok")} {rm(entry.basic_cents)} · {L("Commission", "Komisen")} {rm(entry.commission_cents)} ·{" "}
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
