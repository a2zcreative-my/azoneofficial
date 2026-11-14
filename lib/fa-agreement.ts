/* v1.302.0 - FINANCIAL ADVISORY 2.0, PHASE 5: the DRAFT agreement as a PDF,
   built in the browser from the SAME blocks the preview shows (the server
   merges the template - worker/src/fa-templates.ts mergeBlocks - and this
   file only draws them), so the preview is the document.

   Every page carries the DRAFT watermark and the line "Draft - not for
   signing or sending": sending and signing stay switched off
   (FA_LEGAL.agreement). The file is downloaded, never shared from here.
   A masked IC (bullets) prints as X. Reuses lib/doc-pdf.ts (Canvas,
   assemblePdf - several pages since 1.302.0); no PDF library. */
import { Canvas, assemblePdf, COLOURS, GEOM, widthOf } from "@/lib/doc-pdf";

export type Part = { t: string; field?: string; missing?: boolean };
export type Block = { kind: "h" | "p"; parts: Part[] };
export interface AgreementDraft {
  blocks: Block[];
  company: { name: string; registration: string };
  case_ref: string | null;
  version: { name: string; version: number };
  sha256: string | null;
}

const { PAGE_W, PAGE_H, M, CW } = GEOM;
const BODY = 9.5, LEAD = 13.5, HEAD = 11, HEAD_LEAD = 16;
const TOP = M + 46, BOTTOM = PAGE_H - M - 26;
export const pdfSafe = (s: string) => s.replace(/•/g, "X");
const textOf = (b: Block) => pdfSafe(b.parts.map((p) => p.t).join(""));

type Line = { text: string; bold: boolean; size: number; gap: number };
function linesOf(blocks: Block[]): Line[] {
  const out: Line[] = [];
  for (const b of blocks) {
    const bold = b.kind === "h", size = bold ? HEAD : BODY;
    const words = textOf(b).split(/\s+/).filter(Boolean);
    let line = "", first = true;
    const push = (t: string) => { out.push({ text: t, bold, size, gap: first ? (bold ? 10 : 6) : 0 }); first = false; };
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (line && widthOf(test, size, bold) > CW) { push(line); line = w; } else line = test;
    }
    if (line) push(line);
  }
  return out;
}

/** the content streams, one per page */
export function drawAgreement(d: AgreementDraft): string[] {
  const lines = linesOf(d.blocks);
  const pages: Line[][] = [[]];
  let y = TOP;
  for (const l of lines) {
    const need = l.gap + (l.bold ? HEAD_LEAD : LEAD);
    if (y + need > BOTTOM && pages[pages.length - 1]!.length) { pages.push([]); y = TOP; }
    pages[pages.length - 1]!.push(l);
    y += need;
  }
  return pages.map((page, k) => {
    const c = new Canvas();
    /* the watermark first, so the text sits on it */
    c.ops.push(`q 0.90 0.91 0.93 rg BT /F2 120 Tf 0.7071 0.7071 -0.7071 0.7071 ${(PAGE_W / 2 - 205).toFixed(2)} ${(PAGE_H / 2 - 150).toFixed(2)} Tm (DRAFT) Tj ET Q`);
    c.text(d.company.name, M, M + 12, 11, { bold: true });
    c.text(d.company.registration, M, M + 24, 7.5, { colour: COLOURS.GREY });
    c.text("DRAFT - NOT FOR SIGNING OR SENDING", PAGE_W - M, M + 12, 8, { bold: true, colour: COLOURS.GOLD, align: "r" });
    c.text(d.case_ref ?? "", PAGE_W - M, M + 24, 7.5, { colour: COLOURS.GREY, align: "r" });
    c.line(M, M + 32, PAGE_W - M, COLOURS.HAIR, 0.75);
    let cy = TOP;
    for (const l of page) {
      cy += l.gap;
      c.text(l.text, M, cy, l.size, { bold: l.bold, colour: l.bold ? COLOURS.NAVY : COLOURS.SLATE });
      cy += l.bold ? HEAD_LEAD : LEAD;
    }
    c.line(M, PAGE_H - M - 14, PAGE_W - M, COLOURS.HAIR, 0.5);
    c.text(`${d.version.name} - version ${d.version.version}${d.sha256 ? ` - text ${d.sha256.slice(0, 12)}` : ""}`, M, PAGE_H - M - 4, 7, { colour: COLOURS.GREY });
    c.text(`Draft - page ${k + 1} of ${pages.length}`, PAGE_W - M, PAGE_H - M - 4, 7, { colour: COLOURS.GREY, align: "r" });
    return c.ops.join("\n");
  });
}

export function buildAgreementPdf(d: AgreementDraft): Blob {
  return new Blob([assemblePdf(drawAgreement(d), [], `DRAFT ${d.version.name} ${d.case_ref ?? ""}`.trim()) as BlobPart], { type: "application/pdf" });
}

/** a plain download - a draft agreement is never shared to a chat from here */
export function downloadPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
