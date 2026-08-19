/* v1.4.246 — the HR forms as shareable PDFs.

   Same deal as lib/doc-pdf.ts: a real file, built in the browser, handed to
   the phone's share sheet. These two forms are laid out as bordered tables
   rather than a sales document, so they get their own drawing code, but they
   reuse the PDF writer, the fonts, the image embedding and the colours.

   SAME ACCEPTED DEBT: role-panels.tsx (claim) and app/portal/page.tsx (leave)
   still hold the HTML versions for screen and print. A change to a form must
   be made in BOTH places. */

import { Canvas, assemblePdf, loadImage, COLOURS, GEOM, widthOf, type Img } from "@/lib/doc-pdf";
import { resolveIssuer, type Issuer } from "@/lib/issuers";

const { NAVY, GOLD, GREY, SLATE, HAIR } = COLOURS;
const { PAGE_W, PAGE_H } = GEOM;
const FM = 9 * 2.834645;                 // the forms print at a 9mm margin
const FW = PAGE_W - 2 * FM;

const dmy = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : iso;
};
/** DB timestamps are UTC; every printed time is Malaysia time (v1.4.127). */
const myt = (iso: string | null | undefined): string => {
  if (!iso) return "";
  if (iso.length <= 10) return dmy(iso);
  const d = new Date(new Date(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")).getTime() + 8 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return dmy(iso);
  const i = d.toISOString();
  return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)} MYT`;
};
const rmv = (c: number) => (c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------ shared parts */
/* v1.28.0 — the letterhead, footer and document-control row follow the
   document's own legal issuer (issuer_code, migration 0073): a legacy form
   (NULL) re-prints with AZ ONE OFFICIAL's letterhead and its AZOO-HR-*
   controlled-document number forever; a new form carries A2Z's. */

/** This one-line footer has always printed the registered address WITHOUT the
    trailing country ("... 81200 Johor Bahru, Johor") — keep that exact form so
    a legacy re-print stays byte-identical to the original. */
const footerAddress = (a: string) => a.replace(/, Malaysia$/, "");

function letterhead(c: Canvas, issuer: Issuer, subtitle: string): number {
  let y = FM;
  c.rect(FM, y, FW, 3.75, GOLD); y += 3.75 + 7;
  c.text(issuer.name, FM + FW / 2, y + 11, 13.5, { bold: true, align: "c", spacing: 0.4 });
  c.text("LIVE  -  CONNECT  -  GROW", FM + FW / 2, y + 20, 6, { bold: true, colour: GOLD, align: "c", spacing: 2.4 });
  c.text(subtitle, FM + FW / 2, y + 34, 9.75, { align: "c" });
  return y + 42;
}

function footer(c: Canvas, issuer: Issuer, ref: string) {
  const fy = PAGE_H - FM - 14;
  c.wrap(`${issuer.name} - ${issuer.registration} - ${footerAddress(issuer.address)} - This form accompanies the system record ${ref}; the in-system decision is authoritative.`,
    FM, fy, FW, 6, 8, { colour: GREY });
}

/** The 4-column key/value block both forms open with. */
function metaTable(c: Canvas, y: number, rows: [string, string, string, string][], wideLast = false): number {
  const kw = FW * 0.18, vw = FW * 0.32;
  for (let i = 0; i < rows.length; i++) {
    const [k1, v1, k2, v2] = rows[i]!;
    const last = wideLast && i === rows.length - 1;
    const h = 16;
    c.box(FM, y, kw, h, NAVY, 0.5);
    c.box(FM + kw, y, last ? FW - kw : vw, h, NAVY, 0.5);
    if (!last) {
      c.box(FM + kw + vw, y, kw, h, NAVY, 0.5);
      c.box(FM + 2 * kw + vw, y, vw, h, NAVY, 0.5);
    }
    c.rect(FM + 0.6, y + 0.6, kw - 1.2, h - 1.2, "0.949 0.957 0.973");
    if (!last) c.rect(FM + kw + vw + 0.6, y + 0.6, kw - 1.2, h - 1.2, "0.949 0.957 0.973");
    c.text(k1, FM + 5, y + 11, 7.5, { bold: true });
    c.text(v1, FM + kw + 5, y + 11, 7.5);
    if (!last) {
      c.text(k2, FM + kw + vw + 5, y + 11, 7.5, { bold: true });
      c.text(v2, FM + 2 * kw + vw + 5, y + 11, 7.5);
    }
    y += h;
  }
  return y;
}

interface SigCell { title: string; name: string; date: string; img: string | null; script?: string }

/** The three-column wet-ink signature table that closes both forms. */
function signatureTable(c: Canvas, y: number, cells: SigCell[]): number {
  const cw = FW / 3;
  const headH = 24, bodyH = 92;
  cells.forEach((cell, i) => {
    const x = FM + i * cw;
    c.box(x, y, cw, headH, NAVY, 0.5);
    c.rect(x + 0.6, y + 0.6, cw - 1.2, headH - 1.2, "0.949 0.957 0.973");
    const lines = cell.title.split("|");
    lines.forEach((l, k) => c.text(l, x + cw / 2, y + (lines.length === 1 ? 15 : 11 + k * 9), 7.5, { bold: true, align: "c" }));
    c.box(x, y + headH, cw, bodyH, NAVY, 0.5);
    c.text(`Name: ${cell.name}`, x + 6, y + headH + 13, 7.5);
    c.text("Signature:", x + 6, y + headH + 27, 7.5);
    if (cell.script) {
      c.text(cell.script, x + 44, y + headH + 27, 8.5, { colour: SLATE });
      c.text("(submitted in system)", x + 6, y + headH + 37, 6, { colour: GREY });
    }
    c.text(`Date: ${cell.date}`, x + 6, y + headH + bodyH - 8, 7.5);
  });
  return y + headH + bodyH;
}

/* ------------------------------------------------------------- claim form */
export interface ClaimLike {
  id: number; amount_cents: number; status?: string | null; items?: string | null;
  claim_date?: string | null; category?: string | null; description?: string | null;
  claimant?: string | null; claimant_full?: string | null; claimant_role?: string | null;
  claimant_department?: string | null; claimant_position?: string | null;
  created_at?: string | null; receipt_key?: string | null; decision_note?: string | null;
  hr_reviewed_by_name?: string | null; pre_approved_by_name?: string | null;
  pre_approved_by_full?: string | null; pre_approved_by_role?: string | null; pre_approved_at?: string | null;
  decided_by_name?: string | null; decided_by_full?: string | null; decided_at?: string | null;
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. */
  issuer_code?: string | null;
}

const SIG_FILE: Record<string, string> = {
  ceo: "ceo-sign.png", coo: "coo-sign.png", cco: "cco-sign.png",
  hr_admin: "hr-admin-sign.png", sales_marketing: "sales-marketing-sign.png",
};

type Placed = Record<string, { w: number; h: number }>;

export function drawClaim(c: ClaimLike, claimNo: string, imgs: Placed): string {
  const cv = new Canvas();
  const issuer = resolveIssuer(c.issuer_code);
  let y = letterhead(cv, issuer, "Employee Claim Form");

  /* An A2Z form is a DIFFERENT controlled document from an AZ ONE form — the
     letterhead names the employer — so the document number and version come
     from the issuer (A2Z-HR-CLM-001 v001 vs AZOO-HR-CLM-001 v002). */
  y = metaTable(cv, y, [
    ["Document No.", issuer.claimFormNo, "Version", issuer.claimFormVersion],
    ["Claim No.", claimNo, "Date", myt(c.created_at)],
    ["Employee", (c.claimant_full || c.claimant || "").toUpperCase(), "Department", (c.claimant_department ?? "").toUpperCase()],
    ["Position", (c.claimant_position ?? "").toUpperCase(), "Purpose", c.description ?? ""],
    ["Receipt", c.receipt_key ? "[x] Yes (attached in system)   [ ] No" : "[ ] Yes   [x] No", "", ""],
  ], true);

  y += 10;
  cv.text("Claim Details", FM, y, 8.25, { bold: true, colour: GOLD, spacing: 0.8 }); y += 6;

  let its: { claim_date: string; category: string; description?: string; amount_cents: number }[] = [];
  try { its = c.items ? JSON.parse(c.items) : []; } catch { its = []; }
  if (!its.length) {
    its = [{ claim_date: c.claim_date ?? "", category: c.category ?? "", description: c.description ?? "", amount_cents: c.amount_cents }];
  }
  const colW = [FW * 0.18, FW * 0.20, FW * 0.44, FW * 0.18];
  const edge = [FM, FM + colW[0]!, FM + colW[0]! + colW[1]!, FM + colW[0]! + colW[1]! + colW[2]!, FM + FW];
  cv.rect(FM, y, FW, 15, NAVY);
  ["Date", "Category", "Description", "Amount (RM)"].forEach((h, i) => {
    const x = i === 3 ? edge[4]! - 5 : edge[i]! + 5;
    cv.text(h, x, y + 10, 7, { bold: true, colour: COLOURS.WHITE, align: i === 3 ? "r" : "l", spacing: 0.5 });
  });
  y += 15;
  const rows = Math.max(its.length, 4);
  for (let i = 0; i < rows; i++) {
    const it = its[i];
    const h = 17;
    for (let k = 0; k < 4; k++) cv.box(edge[k]!, y, edge[k + 1]! - edge[k]!, h, HAIR, 0.5);
    if (it) {
      cv.text(dmy(it.claim_date), edge[0]! + 5, y + 11, 7.5);
      cv.text(it.category ? it.category[0]!.toUpperCase() + it.category.slice(1) : "", edge[1]! + 5, y + 11, 7.5);
      cv.text(it.description ?? "", edge[2]! + 5, y + 11, 7.5);
      cv.text(rmv(it.amount_cents), edge[4]! - 5, y + 11, 7.5, { align: "r" });
    }
    y += h;
  }
  y += 9;
  cv.text(`Total Claimed: RM ${rmv(c.amount_cents)}`, FM + FW, y, 9.75, { bold: true, align: "r" }); y += 12;
  cv.text("Declaration: I certify the above expenses were incurred for official Company business.", FM, y, 7.5, { colour: SLATE }); y += 11;

  const sys = c.status === "approved"
    ? `APPROVED IN SYSTEM${c.decided_by_name ? ` by ${c.decided_by_name}` : ""}${c.decided_at ? ` on ${myt(c.decided_at)}` : ""}`
    : c.status === "rejected" ? `REJECTED IN SYSTEM${c.decided_by_name ? ` by ${c.decided_by_name}` : ""}`
      : "PENDING SYSTEM APPROVAL";
  const chain = [c.hr_reviewed_by_name ? `HR reviewed by ${c.hr_reviewed_by_name}` : null,
    c.pre_approved_by_name ? `Pre-approved by ${c.pre_approved_by_name}` : null].filter(Boolean).join(" - ");
  y = cv.wrap(`System status: ${sys}${c.decision_note ? ` - Note: ${c.decision_note}` : ""}${chain ? ` - ${chain}` : ""}`,
    FM, y, FW, 7.5, 9.5, { bold: true });

  y += 6;
  const sigTop = y;
  y = signatureTable(cv, y, [
    { title: "Employee", name: c.claimant_full || c.claimant || "", date: myt(c.created_at),
      img: SIG_FILE[c.claimant_role ?? ""] ?? null,
      script: imgs.Im0 ? undefined : (c.claimant_full || c.claimant || "") },
    { title: "Administrative or|Head of Department (COO / CCO)",
      name: (c.pre_approved_by_full || c.pre_approved_by_name || "").toUpperCase(),
      date: (c.pre_approved_by_full || c.pre_approved_by_name) && c.pre_approved_at ? myt(c.pre_approved_at) : "", img: null },
    { title: "Chief Executive Officer (CEO)",
      name: (c.decided_by_full || c.decided_by_name || "").toUpperCase(),
      date: c.status === "approved" && c.decided_at ? myt(c.decided_at) : "", img: null },
  ]);
  placeSignatures(cv, sigTop, imgs);

  const receipt = imgs.Im3;
  if (receipt) {
    const bw = 150, bh = 118;
    const bx = FM + FW - bw;
    cv.box(bx, y + 8, bw, bh, NAVY, 0.5);
    cv.text("RECEIPT (UPLOADED BY STAFF)", bx + bw / 2, y + 19, 6, { bold: true, colour: GREY, align: "c", spacing: 0.8 });
    // fit inside the frame without stretching — a receipt photo is any shape
    const availW = bw - 12, availH = bh - 30;
    const k = Math.min(availW / receipt.w, availH / receipt.h);
    const iw = receipt.w * k, ih = receipt.h * k;
    const ix = bx + (bw - iw) / 2, iyTop = y + 8 + 24 + (availH - ih) / 2;
    cv.ops.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${(PAGE_H - iyTop - ih).toFixed(2)} cm /Im3 Do Q`);
  } else if (c.receipt_key) {
    cv.text("Receipt attached as PDF in the system - printed separately.", FM + FW, y + 16, 7, { colour: GREY, align: "r" });
  }

  footer(cv, issuer, claimNo);
  return cv.ops.join("\n");
}

/** Drops each officer's chop into its own signature cell, at a fixed size so
    a taller image can never shift the row (same rule as the sales document). */
function placeSignatures(cv: Canvas, sigTop: number, imgs: Placed) {
  const cw = FW / 3, maxW = 74, maxH = 30;
  ["Im0", "Im1", "Im2"].forEach((id, i) => {
    const im = imgs[id];
    if (!im) return;
    const k = Math.min(maxW / im.w, maxH / im.h);
    const iw = im.w * k, ih = im.h * k;
    const x = FM + i * cw + 44;
    const yTop = sigTop + 24 + 20 + (maxH - ih) / 2;
    cv.ops.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${x.toFixed(2)} ${(PAGE_H - yTop - ih).toFixed(2)} cm /${id} Do Q`);
  });
}

export async function buildClaimPdf(c: ClaimLike, claimNo: string): Promise<Blob> {
  const empFile = SIG_FILE[c.claimant_role ?? ""] ?? null;
  const preFile = (c.pre_approved_by_full || c.pre_approved_by_name)
    ? (c.pre_approved_by_role === "coo" ? "coo-sign.png" : "cco-sign.png") : null;
  const ceoFile = c.status === "approved" ? "ceo-sign.png" : null;
  const loaded = await Promise.all([
    empFile ? loadImage(`/signatures/${empFile}`, "Im0") : null,
    preFile ? loadImage(`/signatures/${preFile}`, "Im1") : null,
    ceoFile ? loadImage(`/signatures/${ceoFile}`, "Im2") : null,
    c.receipt_key ? loadImage(`/api/v1/staff/claims/${c.id}/receipt`, "Im3", true) : null,
  ]);
  const images = loaded.filter(Boolean) as Img[];
  const present: Placed = {};
  for (const im of images) present[im.id] = { w: im.w, h: im.h };
  return new Blob([assemblePdf(drawClaim(c, claimNo, present), images, claimNo) as BlobPart], { type: "application/pdf" });
}

/* ------------------------------------------------------------- leave form */
export interface LeaveLike {
  id: number; type: string; start_date: string; end_date: string; days: number;
  reason?: string | null; status?: string | null; stage?: string | null; created_at?: string | null;
  user_name?: string | null; user_full?: string | null; user_role?: string | null;
  user_department?: string | null; user_position?: string | null;
  hr_by_name?: string | null; hr_at?: string | null;
  preapp_by_name?: string | null; preapp_by_full?: string | null; preapp_by_role?: string | null; preapp_at?: string | null;
  final_by_name?: string | null; final_by_full?: string | null; final_at?: string | null;
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. */
  issuer_code?: string | null;
}

export function drawLeave(l: LeaveLike, lvNo: string, imgs: Placed): string {
  const cv = new Canvas();
  const issuer = resolveIssuer(l.issuer_code);
  let y = letterhead(cv, issuer, "Leave Application Form");
  const applicant = (l.user_full || l.user_name || "").toUpperCase();

  /* Same rule as the claim form: the document number and version belong to
     the issuing entity's controlled document, not to the layout. */
  y = metaTable(cv, y, [
    ["Document No.", issuer.leaveFormNo, "Version", issuer.leaveFormVersion],
    ["Leave No.", lvNo, "Date", myt(l.created_at)],
    ["Employee", applicant, "Department", (l.user_department ?? "").toUpperCase()],
    ["Position", (l.user_position ?? "").toUpperCase(), "Leave type", (l.type ?? "").toUpperCase()],
    ["Period", `${dmy(l.start_date)} - ${dmy(l.end_date)}`, "Days", String(l.days)],
    ["Reason", l.reason ?? "", "", ""],
  ], true);

  y += 12;
  const stage = l.stage ?? l.status ?? "pending";
  const statusLine = stage === "approved" ? `APPROVED IN SYSTEM${l.final_by_name ? ` by ${l.final_by_name}` : ""}${l.final_at ? ` on ${myt(l.final_at)}` : ""}`
    : stage === "rejected" ? "REJECTED IN SYSTEM" : "PENDING SYSTEM APPROVAL";
  cv.text(`System status: ${statusLine}`, FM, y, 8.25, { bold: true }); y += 11;
  const chain = [
    l.hr_by_name ? `HR reviewed by ${l.hr_by_name}${l.hr_at ? ` on ${myt(l.hr_at)}` : ""}` : null,
    l.preapp_by_name ? `Pre-approved by ${l.preapp_by_name}${l.preapp_at ? ` on ${myt(l.preapp_at)}` : ""}` : null,
  ].filter(Boolean).join(" - ");
  if (chain) { y = cv.wrap(chain, FM, y, FW, 7, 9, { colour: SLATE }); }

  y += 8;
  const sigTop = y;
  signatureTable(cv, y, [
    { title: "Employee", name: applicant, date: myt(l.created_at),
      img: null, script: imgs.Im0 ? undefined : (l.user_full || l.user_name || "") },
    { title: "Administrative or|Head of Department (COO / CCO)",
      name: (l.preapp_by_full || l.preapp_by_name || "").toUpperCase(),
      date: (l.preapp_by_full || l.preapp_by_name) && l.preapp_at ? myt(l.preapp_at) : "", img: null },
    { title: "Chief Executive Officer (CEO)",
      name: stage === "approved" ? (l.final_by_full || l.final_by_name || "").toUpperCase() : "",
      date: stage === "approved" && l.final_at ? myt(l.final_at) : "", img: null },
  ]);
  placeSignatures(cv, sigTop, imgs);

  footer(cv, issuer, lvNo);
  return cv.ops.join("\n");
}

export async function buildLeavePdf(l: LeaveLike, lvNo: string): Promise<Blob> {
  const empFile = SIG_FILE[l.user_role ?? ""] ?? null;
  const preFile = (l.preapp_by_full || l.preapp_by_name)
    ? (l.preapp_by_role === "coo" ? "coo-sign.png" : "cco-sign.png") : null;
  const ceoFile = (l.stage ?? l.status) === "approved" ? "ceo-sign.png" : null;
  const loaded = await Promise.all([
    empFile ? loadImage(`/signatures/${empFile}`, "Im0") : null,
    preFile ? loadImage(`/signatures/${preFile}`, "Im1") : null,
    ceoFile ? loadImage(`/signatures/${ceoFile}`, "Im2") : null,
  ]);
  const images = loaded.filter(Boolean) as Img[];
  const present: Placed = {};
  for (const im of images) present[im.id] = { w: im.w, h: im.h };
  return new Blob([assemblePdf(drawLeave(l, lvNo, present), images, lvNo) as BlobPart], { type: "application/pdf" });
}

void widthOf; // kept exported for callers that measure before drawing
