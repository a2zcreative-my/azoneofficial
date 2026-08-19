/* v1.4.257 — the payslip as a shareable PDF.

   Tier 5, the part worth building. The payslip is the one document staff are
   asked for OUTSIDE the portal — a loan application, a rental agent, a visa
   form — and "log in and print it" is not an answer when someone is standing
   at a counter.

   The ID badge and the HR attendance summary deliberately did NOT get this:
   a badge is a card you print on stock, and the HR summary is an internal
   multi-page report nobody sends. Adding a PDF writer for either would have
   bought a fourth and fifth hand-maintained layout for no real errand.

   ⚠ SAME ACCEPTED DEBT as lib/doc-pdf.ts and lib/form-pdf.ts: the payslip now
   exists twice — printPayslip() in payroll-panel.tsx drives screen and print,
   this file draws the same slip in PDF primitives. CHANGE ONE, CHANGE THE
   OTHER. Cloudflare Browser Rendering is what collapses all three back into
   one template each; until then, three files mirror three templates. */

import { Canvas, assemblePdf, COLOURS, GEOM, widthOf, type Img } from "@/lib/doc-pdf";
import { resolveIssuer } from "@/lib/issuers";

const { NAVY, GOLD, GREY, SLATE, HAIR } = COLOURS;
const { PAGE_W, PAGE_H } = GEOM;
const M = 14 * 2.834645;              // the printed slip's 14mm margin
const W = PAGE_W - 2 * M;

const amt = (c: number) => (c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n2 = (v: number) => v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PayslipData {
  name: string;
  employee_id?: string | null;
  department?: string | null;
  position?: string | null;
  ic_number?: string | null;
  employment_status?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  month: string;                       // YYYY-MM
  earnings: [string, number][];
  deductions: [string, number][];
  others: [string, number][];
  gross_cents: number;
  deduction_cents: number;
  net_cents: number;
  note?: string | null;
  annual_bal?: number | null;
  sick_bal?: number | null;
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. The
     letterhead and footer name the employer, so they follow this. */
  issuer_code?: string | null;
}

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** This one-line footer has always printed the registered address WITHOUT the
    trailing country ("... 81200 Johor Bahru, Johor") — keep that exact form so
    a legacy re-print stays byte-identical to the original. */
const footerAddress = (a: string) => a.replace(/, Malaysia$/, "");

export function drawPayslip(p: PayslipData): string {
  const c = new Canvas();
  const issuer = resolveIssuer(p.issuer_code);
  const [yy, mm] = p.month.split("-");
  const lastDay = new Date(Number(yy), Number(mm), 0).getDate();
  const from = `01-${mm}-${yy}`;
  const to = `${String(lastDay).padStart(2, "0")}-${mm}-${yy}`;

  let y = M;
  c.rect(M, y, W, 3.75, GOLD); y += 3.75 + 8;
  c.text(issuer.name, M, y + 11, 13.5, { bold: true, spacing: 0.4 });
  /* SULIT sits opposite the name, as on the printed slip — a payslip that
     leaves the building should say what it is before anyone reads a figure. */
  c.text("SULIT / PRIVATE & CONFIDENTIAL", M + W, y + 10, 7.5, { bold: true, colour: "0.72 0.11 0.11", align: "r" });
  y += 20;
  c.text(`PAYSLIP — ${MONTHS[Number(mm) - 1]} ${yy}`, M, y + 9, 9.75, { bold: true, colour: SLATE });
  y += 18;
  c.line(M, y, M + W, HAIR, 0.7); y += 12;

  // ---- who and when: two label/value pairs per row, as printed
  const pairs: [string, string, string, string][] = [
    ["EMP'EE #", p.employee_id ?? "—", "DEPT.", (p.department ?? "—").toUpperCase()],
    ["EMP'EE NAME", p.name.toUpperCase(), "SECTION", (p.position ?? "—").toUpperCase()],
    ["I/C #", p.ic_number ?? "—", "PERIOD", `${from}  TO  ${to}`],
    ["STATUS", (p.employment_status ?? "—").replace(/_/g, " ").toUpperCase(), "BANK", (p.bank_name ?? "—").toUpperCase()],
    ["BANK ACCOUNT", p.bank_account ?? "—", "", ""],
  ];
  for (const [k1, v1, k2, v2] of pairs) {
    c.text(k1, M, y, 7.5, { colour: GREY });
    c.text(`: ${v1}`, M + 78, y, 7.5, { bold: true });
    if (k2) {
      c.text(k2, M + W / 2 + 10, y, 7.5, { colour: GREY });
      c.text(`: ${v2}`, M + W / 2 + 88, y, 7.5, { bold: true });
    }
    y += 13;
  }
  y += 6;

  // ---- three columns, exactly the printed slip's shape
  const colW = [W * 0.38, W * 0.31, W * 0.31];
  const x0 = [M, M + colW[0]!, M + colW[0]! + colW[1]!];
  c.rect(M, y, W, 15, NAVY);
  ["EARNINGS / INCOME", "DEDUCTIONS", "OTHERS"].forEach((h, i) =>
    c.text(h, x0[i]! + 6, y + 10, 7, { bold: true, colour: COLOURS.WHITE, spacing: 0.5 }));
  y += 15;

  const bodyRows = Math.max(p.earnings.length, p.deductions.length || 1, p.others.length, 4);
  const rowH = 13;
  const bodyH = bodyRows * rowH + 6;
  for (let i = 0; i < 3; i++) c.box(x0[i]!, y, colW[i]!, bodyH, HAIR, 0.5);

  /* A payslip label can be long — "UNPAID LEAVE (1.00 DAY x 1/26 MONTHLY
     WAGE)" — and these columns are 31% of the page. Shrink the label to fit
     its own column before it can run under the next one's figures, and only
     truncate once 5.5pt still won't do. A number must never be crowded. */
  const column = (i: number, rows: [string, string][], muted = false) => {
    let ry = y + 12;
    for (const [label, value] of rows) {
      const room = colW[i]! - 12 - (value ? widthOf(value, 7, false) + 8 : 0);
      let size = 7;
      let text = label;
      while (size > 5.5 && widthOf(text, size, false) > room) size -= 0.5;
      if (widthOf(text, size, false) > room) {
        while (text.length > 4 && widthOf(text + "..", size, false) > room) text = text.slice(0, -1);
        text += "..";
      }
      c.text(text, x0[i]! + 6, ry, size, { colour: muted ? GREY : undefined });
      if (value) c.text(value, x0[i]! + colW[i]! - 6, ry, 7, { align: "r" });
      ry += rowH;
    }
  };
  column(0, p.earnings.map(([l, v]) => [l, amt(v)]));
  column(1, p.deductions.length ? p.deductions.map(([l, v]) => [l, amt(v)]) : [["NO DEDUCTION", ""]], !p.deductions.length);
  column(2, p.others.map(([l, v]) => [l, n2(v)]));
  y += bodyH;

  // ---- totals strip
  const totH = 17;
  for (let i = 0; i < 3; i++) {
    c.box(x0[i]!, y, colW[i]!, totH, HAIR, 0.5);
    c.rect(x0[i]! + 0.6, y + 0.6, colW[i]! - 1.2, totH - 1.2, "0.949 0.957 0.973");
  }
  c.text("TOTAL :", x0[0]! + 6, y + 11, 7.5, { bold: true });
  c.text(amt(p.gross_cents), x0[0]! + colW[0]! - 6, y + 11, 7.5, { bold: true, align: "r" });
  c.text("TOTAL :", x0[1]! + 6, y + 11, 7.5, { bold: true });
  c.text(amt(p.deduction_cents), x0[1]! + colW[1]! - 6, y + 11, 7.5, { bold: true, align: "r" });
  c.text("ANNL. BAL. :", x0[2]! + 6, y + 7, 6.5);
  c.text(p.annual_bal != null ? n2(p.annual_bal) : "—", x0[2]! + colW[2]! - 6, y + 7, 6.5, { align: "r" });
  c.text("SICK BAL. :", x0[2]! + 6, y + 14, 6.5);
  c.text(p.sick_bal != null ? n2(p.sick_bal) : "—", x0[2]! + colW[2]! - 6, y + 14, 6.5, { align: "r" });
  y += totH + 10;

  // ---- the number the whole page exists for
  const nettW = W * 0.42;
  if (p.note) c.wrap(`NOTE : ${p.note}`, M, y + 4, W - nettW - 14, 7, 9.5, { colour: SLATE });
  c.rect(M + W - nettW, y, nettW, 24, NAVY);
  c.text("NETT PAY", M + W - nettW + 10, y + 15, 8.5, { bold: true, colour: COLOURS.WHITE, spacing: 0.6 });
  c.text(`RM ${amt(p.net_cents)}`, M + W - 10, y + 15, 10.5, { bold: true, colour: COLOURS.WHITE, align: "r" });

  // ---- footer
  const fy = PAGE_H - M - 32;
  /* NB: this footer's "(SSM ... / ...)" slash style predates lib/issuers.ts's
     combined `registration` string — compose it from ssm/oldReg to keep the
     punctuation byte-identical. */
  c.wrap(`${issuer.name} (SSM ${issuer.ssm} / ${issuer.oldReg}) - ${footerAddress(issuer.address)} - Computer-generated payslip, no signature required.`,
    M, fy, W, 6.5, 8.5, { colour: GREY });
  c.wrap("SULIT / PRIVATE & CONFIDENTIAL - issued to the named employee under the Employment Act 1955 and containing personal data protected by the PDPA 2010. Do not disclose, copy or share it without the employee's or the company's written consent.",
    M, fy + 20, W, 6, 8, { colour: GREY });

  return c.ops.join("\n");
}

export async function buildPayslipPdf(p: PayslipData): Promise<Blob> {
  const imgs: Img[] = [];
  const title = `Payslip ${p.name} ${p.month}`;
  return new Blob([assemblePdf(drawPayslip(p), imgs, title) as BlobPart], { type: "application/pdf" });
}
