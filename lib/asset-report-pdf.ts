/* v1.303.0 - ASSETS WORKSPACE 4.0: an asset report as a PDF, drawn in the
   browser from the SAME rows the screen shows (assets-panel.tsx builds them
   once from lib/asset-figures.ts). Reuses lib/doc-pdf.ts (Canvas, assemblePdf
   with several pages); no PDF library. Landscape A4 so the company columns fit. */
import { Canvas, assemblePdf, COLOURS, GEOM, widthOf } from "@/lib/doc-pdf";

export interface AssetReportPdf { title: string; sub: string; head: string[]; numFrom: number; rows: string[][]; foot?: string[]; note?: string; made: string }

const W = GEOM.PAGE_H, H = GEOM.PAGE_W, M = GEOM.M; // landscape
const SIZE = 8, LEAD = 14;

function fit(s: string, w: number, bold = false): string {
  if (widthOf(s, SIZE, bold) <= w) return s;
  let t = s;
  while (t.length > 1 && widthOf(`${t}...`, SIZE, bold) > w) t = t.slice(0, -1);
  return `${t}...`;
}

export function drawAssetReport(r: AssetReportPdf): string[] {
  const cw = W - 2 * M;
  /* the first column (a name) gets the room the numbers do not need */
  const n = r.head.length;
  const textCols = Math.min(n, Math.max(1, r.numFrom));
  const numW = n > textCols ? Math.min(110, (cw * 0.55) / (n - textCols)) : 0;
  const textW = (cw - numW * (n - textCols)) / textCols;
  const xs: number[] = []; let x = M;
  for (let i = 0; i < n; i++) { xs.push(x); x += i < textCols ? textW : numW; }
  const colW = (i: number) => (i < textCols ? textW : numW) - 6;
  const perPage = Math.floor((H - 2 * M - 90) / LEAD);
  const chunks: string[][][] = [];
  for (let i = 0; i < Math.max(1, r.rows.length); i += perPage) chunks.push(r.rows.slice(i, i + perPage));
  return chunks.map((rows, k) => {
    const c = new Canvas(H);
    c.text("Assets - " + r.title, M, M + 12, 12, { bold: true });
    c.text(r.sub, M, M + 26, 8, { colour: COLOURS.GREY });
    c.text(`Generated ${r.made}`, W - M, M + 12, 8, { colour: COLOURS.GREY, align: "r" });
    let y = M + 50;
    c.rect(M, y - 10, cw, 14, COLOURS.PANEL);
    r.head.forEach((h, i) => c.text(fit(h, colW(i), true), i >= r.numFrom ? xs[i]! + colW(i) : xs[i]!, y, SIZE, { bold: true, align: i >= r.numFrom ? "r" : "l" }));
    y += LEAD;
    for (const row of rows) {
      row.forEach((v, i) => c.text(fit(v, colW(i)), i >= r.numFrom ? xs[i]! + colW(i) : xs[i]!, y, SIZE, { colour: COLOURS.SLATE, align: i >= r.numFrom ? "r" : "l" }));
      c.line(M, y + 4, W - M, COLOURS.HAIR, 0.4);
      y += LEAD;
    }
    if (k === chunks.length - 1 && r.foot) {
      r.foot.forEach((v, i) => c.text(fit(v, colW(i), true), i >= r.numFrom ? xs[i]! + colW(i) : xs[i]!, y, SIZE, { bold: true, align: i >= r.numFrom ? "r" : "l" }));
      y += LEAD;
    }
    if (k === chunks.length - 1 && r.note) c.wrap(r.note, M, y + 8, cw, 7.5, 10, { colour: COLOURS.GREY });
    c.text(`Page ${k + 1} of ${chunks.length}`, W - M, H - M + 10, 7, { colour: COLOURS.GREY, align: "r" });
    return c.ops.join("\n");
  });
}

export function buildAssetReportPdf(r: AssetReportPdf): Blob {
  return new Blob([assemblePdf(drawAssetReport(r), [], `Assets - ${r.title}`, true) as BlobPart], { type: "application/pdf" });
}
