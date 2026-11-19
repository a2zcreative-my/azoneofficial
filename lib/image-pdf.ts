/* v1.389.0 - a PDF of whole-page pictures (the portfolio card's front and back), built in the
   browser. Same reason as lib/doc-pdf.ts: no PDF library to ship to a phone. Each page is one
   JPEG (DCTDecode) filling the page; the page is the size asked for, in points.
   54 x 86 mm (the printed card) is 153.07 x 243.78 pt. */

const enc = new TextEncoder();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** pages: JPEG data URLs with their pixel size; size: the page in points */
export function imagesToPdf(pages: { jpeg: string; w: number; h: number }[], size: { w: number; h: number }): Blob {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === "string" ? enc.encode(b) : b; parts.push(u); pos += u.length; };
  const obj = (n: number, body: () => void) => { offsets[n] = pos; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };

  push("%PDF-1.4\n%âãÏÓ\n");
  const nPages = pages.length;
  /* 1 catalog, 2 pages, then per page: page, content, image */
  const pageObj = (i: number) => 3 + i * 3;
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Count ${nPages} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`));
  const W = size.w.toFixed(2), H = size.h.toFixed(2);
  pages.forEach((p, i) => {
    const po = pageObj(i), co = po + 1, io = po + 2;
    obj(po, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${io} 0 R >> >> /Contents ${co} 0 R >>`));
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(co, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push("\nendstream"); });
    const bytes = b64ToBytes(p.jpeg.split(",")[1] ?? "");
    obj(io, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      push(bytes); push("\nendstream");
    });
  });
  const xref = pos;
  const count = 3 + nPages * 3;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export const MM_TO_PT = 72 / 25.4;
