/* v1.4.245 — the sales document as a REAL PDF file, built in the browser.

   Why hand-rolled and not a library: this ships to a phone, and the whole
   point is one tap from the Documents list into WhatsApp. A PDF library is
   ~400KB of JavaScript on a 4G connection before anything renders; this file
   is a few KB and needs no install step in the deploy loop. Everything below
   is plain PDF syntax and Web APIs.

   What it draws is the v1.4.243 layout — letterhead, meta strip, billing /
   delivery panels, line items with UOM and sub-lines, amount in words, totals
   ladder, closing block with the reserved signature zones. It is a SECOND
   implementation of that layout (lib/doc-template.ts is the first, for screen
   and print), so any change to one must be made in the other. That is the
   accepted cost of shipping a shareable file without a paid rendering
   service; if we ever move to Cloudflare Browser Rendering this file goes.

   Units: PDF points. The HTML layout is designed against 688px of A4, and
   688px = 516pt, so px * 0.75 = pt throughout. */

import type { DocFull, DocItem } from "@/lib/doc-template";

/* ---------------------------------------------------------------- metrics */
// Helvetica / Helvetica-Bold advance widths (per 1000 units) for ASCII 32-126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

function widthOf(s: string, size: number, bold: boolean): number {
  const tbl = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 32;
    w += (c >= 32 && c <= 126 ? tbl[c - 32] : 556) ?? 556;
  }
  return (w * size) / 1000;
}

/* PDF strings are Latin-1. Anything outside it (– — · ✔ …) is folded to an
   ASCII equivalent rather than dropped, so a document never prints gibberish. */
const FOLD: Record<string, string> = {
  "—": "-", "–": "-", "·": "-", "•": "-", "→": "->", "⇒": "=>", "✔": "OK",
  "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'", "&nbsp;": " ",
  "&amp;": "&", "&middot;": "-", "&mdash;": "-", "&minus;": "-", "&#10004;": "OK",
  /* v1.4.257: × was silently VANISHING — "6 HRS × 1.5" printed as "6 HRS 1.5",
     which on a payslip reads as a different calculation. Anything the fold map
     misses is dropped by the ASCII filter below, so a missing entry is
     invisible rather than obviously broken. */
  "×": "x", "÷": "/", "±": "+/-", "≤": "<=", "≥": ">=", "≈": "~", "™": "(TM)", "©": "(c)",
};
function ascii(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(FOLD)) out = out.split(k).join(v);
  return out.replace(/[^\x20-\x7e]/g, "");
}
const esc = (s: string) => ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/* ------------------------------------------------------------------ page */
const PT = 0.75;               // one CSS pixel
const PAGE_W = 595.28, PAGE_H = 841.89;
const M = 14 * 2.834645;       // the 14mm print margin, in points
const CW = PAGE_W - 2 * M;     // content width ~ 516pt

const NAVY = "0.102 0.161 0.275";
const GOLD = "0.788 0.635 0.153";
const GREY = "0.541 0.576 0.651";
const SLATE = "0.357 0.392 0.447";
const PANEL = "0.965 0.969 0.980";
const HAIR = "0.910 0.922 0.945";
const WHITE = "1 1 1";
const GREEN = "0.082 0.502 0.239";

export const COLOURS = { NAVY, GOLD, GREY, SLATE, PANEL, HAIR, WHITE, GREEN };
export const GEOM = { PT, PAGE_W, PAGE_H, M, CW };
export { widthOf };

export class Canvas {
  ops: string[] = [];
  y = M;                                   // distance from the TOP of the page
  /* v1.22.4: optional page height so a LANDSCAPE canvas (the roster grid)
     can flip its own y-axis. Every existing caller stays portrait. */
  constructor(private pageH: number = PAGE_H) {}
  private at(y: number) { return this.pageH - y; }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ops.push(`${fill} rg ${x.toFixed(2)} ${this.at(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  line(x1: number, y: number, x2: number, colour: string, weight = 0.5) {
    this.ops.push(`${colour} RG ${weight} w ${x1.toFixed(2)} ${this.at(y).toFixed(2)} m ${x2.toFixed(2)} ${this.at(y).toFixed(2)} l S`);
  }
  box(x: number, y: number, w: number, h: number, colour: string, weight = 0.5) {
    this.ops.push(`${colour} RG ${weight} w ${x.toFixed(2)} ${this.at(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  }
  /** y is the text BASELINE offset from the top of the page. */
  text(s: string, x: number, y: number, size: number, opts: { bold?: boolean; colour?: string; align?: "l" | "r" | "c"; spacing?: number } = {}) {
    const t = esc(s);
    if (!t) return;
    const bold = opts.bold ?? false;
    const spacing = opts.spacing ?? 0;
    let w = widthOf(ascii(s), size, bold);
    if (spacing) w += spacing * (ascii(s).length - 1);
    const px = opts.align === "r" ? x - w : opts.align === "c" ? x - w / 2 : x;
    this.ops.push(
      `BT ${opts.colour ?? NAVY} rg /${bold ? "F2" : "F1"} ${size} Tf ${spacing ? `${spacing} Tc ` : ""}` +
      `${px.toFixed(2)} ${this.at(y).toFixed(2)} Td (${t}) Tj${spacing ? " 0 Tc" : ""} ET`,
    );
  }
  /** Greedy wrap. Returns the baseline y after the last line. */
  wrap(s: string, x: number, y: number, w: number, size: number, lead: number, opts: { bold?: boolean; colour?: string } = {}) {
    const words = ascii(s).split(/\s+/).filter(Boolean);
    let line = "", cy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (widthOf(test, size, opts.bold ?? false) > w && line) {
        this.text(line, x, cy, size, opts); cy += lead; line = word;
      } else line = test;
    }
    if (line) { this.text(line, x, cy, size, opts); cy += lead; }
    return cy;
  }
}

/* ------------------------------------------------------------ amount words */
const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
function under1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} HUNDRED`); n %= 100; if (n) out.push("AND"); }
  if (n >= 20) out.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  else if (n) out.push(ONES[n] || "");
  return out.join(" ");
}
function inWords(n: number): string {
  if (n === 0) return "ZERO";
  const parts: string[] = [];
  for (const [v, name] of [[1e9, "BILLION"], [1e6, "MILLION"], [1e3, "THOUSAND"]] as [number, string][]) {
    if (n >= v) { parts.push(`${under1000(Math.floor(n / v))} ${name}`); n %= v; }
  }
  if (n) { if (parts.length && n < 100) parts.push("AND"); parts.push(under1000(n)); }
  return parts.join(" ");
}
function amountWords(cents: number): string {
  const r = Math.floor(cents / 100), s = cents % 100;
  return `RINGGIT MALAYSIA : ${inWords(r)}${s ? ` AND SEN ${inWords(s)}` : ""} ONLY`;
}

/* ------------------------------------------------------------ PNG → XObject */
export interface Img { id: string; w: number; h: number; rgb: Uint8Array; alpha: Uint8Array | null; zipped?: boolean; jpeg?: boolean }

/** Deflate, so a 1MB raw chop travels as ~50KB inside the PDF. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const out = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(out);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(await out);
}

/** Decodes a plain (non-interlaced, 8-bit) PNG — which is what the signature
    chops are. Anything else returns null and the signature zone prints empty,
    exactly as the HTML version does when the file is missing. */
export async function decodePng(buf: Uint8Array): Promise<Img | null> {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
    const idat: Uint8Array[] = [];
    while (p < buf.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);
      const body = buf.subarray(p + 8, p + 8 + len);
      if (type === "IHDR") {
        w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
        depth = buf[p + 16]!; ctype = buf[p + 17]!; interlace = buf[p + 20]!;
      } else if (type === "IDAT") idat.push(body);
      else if (type === "IEND") break;
      p += 12 + len;
    }
    if (depth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(ctype)) return null;
    const chan = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 4 ? 2 : 4;
    const merged = new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
    let o = 0; for (const c of idat) { merged.set(c, o); o += c.length; }
    const raw = await inflate(merged);

    // Undo the per-scanline PNG filters.
    const stride = w * chan;
    const px = new Uint8Array(stride * h);
    let pos = 0;
    for (let row = 0; row < h; row++) {
      const filter = raw[pos++]!;
      const cur = px.subarray(row * stride, (row + 1) * stride);
      const prev = row ? px.subarray((row - 1) * stride, row * stride) : null;
      for (let i = 0; i < stride; i++) {
        const x = raw[pos + i]!;
        const a = i >= chan ? cur[i - chan]! : 0;
        const b = prev ? prev[i]! : 0;
        const c = prev && i >= chan ? prev[i - chan]! : 0;
        let v = x;
        if (filter === 1) v = x + a;
        else if (filter === 2) v = x + b;
        else if (filter === 3) v = x + ((a + b) >> 1);
        else if (filter === 4) {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        cur[i] = v & 0xff;
      }
      pos += stride;
    }

    const rgb = new Uint8Array(w * h * 3);
    const alpha = chan === 2 || chan === 4 ? new Uint8Array(w * h) : null;
    for (let i = 0; i < w * h; i++) {
      if (chan === 1) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i]!;
      else if (chan === 2) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * 2]!; alpha![i] = px[i * 2 + 1]!; }
      else if (chan === 3) { rgb[i * 3] = px[i * 3]!; rgb[i * 3 + 1] = px[i * 3 + 1]!; rgb[i * 3 + 2] = px[i * 3 + 2]!; }
      else { rgb[i * 3] = px[i * 4]!; rgb[i * 3 + 1] = px[i * 4 + 1]!; rgb[i * 3 + 2] = px[i * 4 + 2]!; alpha![i] = px[i * 4 + 3]!; }
    }
    return { id: "Im0", w, h, rgb, alpha };
  } catch { return null; }
}

/* ------------------------------------------------------------- PDF assembly */
function bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function assemblePdf(content: string, images: Img[], title: string, landscape = false): Uint8Array {
  /* Object numbers are FIXED, never positional. An earlier draft appended the
     image before the fonts, so a document without a signature shifted /F1 and
     /F2 onto the wrong objects and printed bold and regular swapped. Layout:
       1 catalog - 2 pages - 3 page - 4 contents - 5 Helvetica - 6 Helvetica-Bold
       7 info - then two slots per image (the image, then its soft mask). */
  const objs: (Uint8Array | null)[] = [];
  const put = (n: number, s: string | Uint8Array) => { objs[n - 1] = typeof s === "string" ? bytes(s) : s; };
  const tail = bytes("\nendstream");
  const streamObj = (dict: string, body: Uint8Array) => {
    const head = bytes(`${dict}\nstream\n`);
    const out = new Uint8Array(head.length + body.length + tail.length);
    out.set(head); out.set(body, head.length); out.set(tail, head.length + body.length);
    return out;
  };

  const slot = (i: number) => 8 + i * 2;                  // image i lives here
  const xres = images.map((im, i) => `/${im.id} ${slot(i)} 0 R`).join(" ");
  put(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  put(2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  put(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${landscape ? PAGE_H : PAGE_W} ${landscape ? PAGE_W : PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${images.length ? ` /XObject << ${xres} >>` : ""} >> /Contents 4 0 R >>`);
  const cbytes = bytes(content);
  put(4, streamObj(`<< /Length ${cbytes.length} >>`, cbytes));
  put(5, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  put(6, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  put(7, `<< /Title (${esc(title)}) /Producer (AZ ONE OFFICIAL portal) >>`);
  images.forEach((img, i) => {
    const filt = img.jpeg ? "/Filter /DCTDecode " : img.zipped ? "/Filter /FlateDecode " : "";
    put(slot(i), streamObj(
      `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${filt}${img.alpha ? `/SMask ${slot(i) + 1} 0 R ` : ""}/Length ${img.rgb.length} >>`,
      img.rgb));
    if (img.alpha) {
      put(slot(i) + 1, streamObj(
        `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 ${img.zipped ? "/Filter /FlateDecode " : ""}/Length ${img.alpha.length} >>`,
        img.alpha));
    }
  });

  const parts: Uint8Array[] = [bytes("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  const offsets: number[] = [];
  let pos = parts[0]!.length;
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (!o) { offsets.push(0); continue; }        // free slot - never referenced
    const pre = bytes(`${i + 1} 0 obj\n`);
    const post = bytes("\nendobj\n");
    offsets.push(pos);
    parts.push(pre, o, post);
    pos += pre.length + o.length + post.length;
  }
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += off ? `${String(off).padStart(10, "0")} 00000 n \n` : `0000000000 65535 f \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(bytes(xref));

  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}

/** A receipt photo is almost always a JPEG. PDF speaks JPEG natively, so the
    bytes go in untouched — we only need the dimensions out of the SOF marker. */
export function readJpeg(buf: Uint8Array, id: string): Img | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = (buf[p + 5]! << 8) | buf[p + 6]!;
      const w = (buf[p + 7]! << 8) | buf[p + 8]!;
      const comps = buf[p + 9]!;
      if (comps !== 3) return null;              // greyscale / CMYK: skip rather than mangle
      return { id, w, h, rgb: buf, alpha: null, jpeg: true };
    }
    p += 2 + ((buf[p + 2]! << 8) | buf[p + 3]!);
  }
  return null;
}

/** Hand a finished PDF to the phone's share sheet, falling back to a download.
    Returns what actually happened so the caller can word its toast. */
export async function sharePdfFile(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded"> {
  if (typeof navigator.canShare === "function") {
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); } catch { /* sheet dismissed */ }
      return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}

/** Fetch an image and prepare it for embedding. Never throws. */
export async function loadImage(url: string, id: string, credentials = false): Promise<Img | null> {
  try {
    const r = await fetch(url, credentials ? { credentials: "include" } : undefined);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("jpeg") || ct.includes("jpg") || (buf[0] === 0xff && buf[1] === 0xd8)) return readJpeg(buf, id);
    const png = await decodePng(buf);
    if (!png) return null;
    png.id = id;
    png.rgb = await deflate(png.rgb);
    if (png.alpha) png.alpha = await deflate(png.alpha);
    png.zipped = true;
    return png;
  } catch { return null; }
}

/* ------------------------------------------------------------------ layout */
const money = (c: number) => (c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : iso;
};

/** Draws the whole document and returns the content stream. */
export function drawDoc(doc: DocFull, hasSig: boolean): string {
  const c = new Canvas();
  const items: DocItem[] = (() => { try { return JSON.parse(doc.items); } catch { return []; } })();
  const isDO = doc.doc_type === "DO";
  const isINV = doc.doc_type === "INV";
  const isService = doc.kind === "service";
  const title = { QT: "QUOTATION", DO: "DELIVERY ORDER", INV: "INVOICE" }[doc.doc_type] ?? doc.doc_type;
  const R = M + CW;                                  // right edge
  let y = M;

  // gold rule
  c.rect(M, y, CW, 3.75, GOLD); y += 3.75 + 9;

  // letterhead
  const brandTop = y;
  c.text("AZ ONE OFFICIAL", M, y + 11, 14.25, { bold: true });
  c.text("LIVE  -  CONNECT  -  GROW", M, y + 20, 5.6, { bold: true, colour: GOLD, spacing: 1.6 });
  let ay = y + 32;
  for (const l of [
    "Live Commerce Agency - SSM 202603168673 (JM1046169-H)",
    "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika,",
    "81200 Johor Bahru, Johor, Malaysia",
    "admin@azoneofficial.com - WhatsApp +60 12-383 4821",
  ]) { c.text(l, M, ay, 6.75, { colour: SLATE }); ay += 10.5; }

  // document type, right
  c.text(title, R, brandTop + 13, 17.25, { bold: true, align: "r", spacing: 1.4 });
  if (doc.kind) {
    const chip = isService ? "SERVICES" : "PRODUCTS";
    const cw = widthOf(chip, 6, true) + 11;
    c.box(R - cw, brandTop + 19, cw, 11, GOLD, 0.5);
    c.text(chip, R - cw / 2, brandTop + 26.5, 6, { bold: true, colour: "0.541 0.427 0.071", align: "c", spacing: 1.2 });
  }
  y = Math.max(ay - 4, brandTop + 42);
  c.line(M, y, R, NAVY, 1.9); y += 9;

  // meta strip — borderless, one hairline under it (CEO)
  const meta: [string, string, number][] = [
    ["SALES PERSON", doc.salesperson_name ? doc.salesperson_name.split(" ")[0]! : "-", 0.15],
    ["DOC NO.", doc.doc_number, 0.23],
    ["DATE", dmy(doc.created_at), 0.14],
    [isINV ? "PAYMENT DUE" : isDO ? "DELIVERY" : "VALID UNTIL",
      isINV ? (doc.due_date ? dmy(doc.due_date) : "On receipt")
        : isDO ? (doc.delivery_status === "delivered" ? "Delivered" : "Pending")
          : (doc.valid_until ? dmy(doc.valid_until) : "14 days"), 0.14],
    ["REFERENCE", doc.reference ? doc.reference : "N/A", 0.22],
    ["PAGE", "1 of 1", 0.12],
  ];
  let mx = M;
  for (const [k, v, frac] of meta) {
    c.text(k, mx, y + 6, 5.6, { colour: GREY, spacing: 0.75 });
    c.text(v, mx, y + 16, 8.25, { bold: true });
    mx += CW * frac;
  }
  y += 21; c.line(M, y, R, HAIR, 0.6); y += 7.5;

  // billing | delivery panels
  const shipTo = (doc.delivery_address ?? doc.customer_delivery_address ?? "").trim();
  const same = !shipTo || shipTo === (doc.address ?? "").trim();
  const billLines = [doc.contact_person, ...(doc.address ?? "").split("\n"), doc.customer_phone, doc.customer_email]
    .filter(Boolean) as string[];
  const shipLines = same ? [] : shipTo.split("\n");
  const panelH = Math.max(46, 30 + Math.max(billLines.length, shipLines.length + 1) * 9.5);
  const pw = (CW - 7.5) / 2;
  for (const [x, label, co, lines, note] of [
    [M, "BILLING ADDRESS", doc.company, billLines, ""],
    [M + pw + 7.5, isService ? "SERVICE ADDRESS" : "DELIVERY ADDRESS",
      same ? "Same as billing address" : doc.company, shipLines,
      same ? (isService ? "Work is carried out at the address on the left." : "Goods are delivered to the address on the left.") : ""],
  ] as [number, string, string, string[], string][]) {
    c.rect(x, y, pw, panelH, PANEL);
    c.rect(x, y, 2.25, panelH, GOLD);
    c.text(label, x + 7.5, y + 11, 6, { bold: true, colour: GREY, spacing: 1.2 });
    c.text(co, x + 7.5, y + 23, 9.4, { bold: true });
    let ly = y + 34;
    for (const l of lines) { c.text(l, x + 7.5, ly, 8.25); ly += 9.5; }
    if (note) c.wrap(note, x + 7.5, ly, pw - 15, 6.4, 8.5, { colour: GREY });
  }
  y += panelH + 8;

  // items
  const cols = isDO
    ? [{ w: 0.06, a: "c" }, { w: 0.70, a: "l" }, { w: 0.12, a: "c" }, { w: 0.12, a: "c" }]
    : [{ w: 0.05, a: "c" }, { w: 0.39, a: "l" }, { w: 0.08, a: "c" }, { w: 0.08, a: "c" },
       { w: 0.13, a: "r" }, { w: 0.12, a: "r" }, { w: 0.15, a: "r" }];
  const heads = isDO ? ["NO", isService ? "DESCRIPTION OF SERVICES" : "DESCRIPTION", "UOM", "QTY"]
    : ["NO", isService ? "DESCRIPTION OF SERVICES" : "DESCRIPTION", "UOM", "QTY", "UNIT PRICE", "DISCOUNT", "AMOUNT (RM)"];
  const edge: number[] = []; { let e = M; for (const col of cols) { edge.push(e); e += CW * col.w; } edge.push(R); }
  c.rect(M, y, CW, 16, NAVY);
  heads.forEach((h, i) => {
    const a = cols[i]!.a;
    const x = a === "r" ? edge[i + 1]! - 5.5 : a === "c" ? (edge[i]! + edge[i + 1]!) / 2 : edge[i]! + 5.5;
    c.text(h, x, y + 11, 6.4, { bold: true, colour: WHITE, align: a as "l" | "r" | "c", spacing: 0.6 });
  });
  y += 16;

  let gross = 0, lineDisc = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    gross += it.qty * it.unit_price_cents;
    lineDisc += it.disc_cents ?? 0;
    const rowTop = y;
    let ty = y + 12;
    ty = c.wrap(it.name, edge[1]! + 5.5, ty, CW * cols[1]!.w - 11, 8.25, 10.5, { bold: true });
    if (it.sku) { c.text(`SKU ${it.sku}`, edge[1]! + 5.5, ty, 6.75, { colour: GREY }); ty += 9; }
    for (const s of it.sub ?? []) {
      c.text("-", edge[1]! + 10, ty, 7.5, { colour: SLATE });
      ty = c.wrap(s, edge[1]! + 17, ty, CW * cols[1]!.w - 23, 7.5, 9.5, { colour: SLATE });
    }
    const cells = isDO
      ? [String(i + 1), "", it.uom ?? "", String(it.qty)]
      : [String(i + 1), "", it.uom ?? "", String(it.qty), money(it.unit_price_cents),
         it.disc_cents ? money(it.disc_cents) : "-", money(it.qty * it.unit_price_cents - (it.disc_cents ?? 0))];
    cells.forEach((v, k) => {
      if (!v || k === 1) return;
      const a = cols[k]!.a;
      const x = a === "r" ? edge[k + 1]! - 5.5 : a === "c" ? (edge[k]! + edge[k + 1]!) / 2 : edge[k]! + 5.5;
      c.text(v, x, rowTop + 12, 8.25, { align: a as "l" | "r" | "c" });
    });
    y = Math.max(ty + 2, rowTop + 21);
    c.line(M, y, R, HAIR, 0.6);
  }
  if (!items.length) { c.text("No line items", M + 8, y + 12, 8.25, { colour: GREY }); y += 20; }

  // amount in words + totals ladder
  if (!isDO) {
    y += 7.5;
    const tw = 180, bw = CW - tw - 9;
    const boxTop = y;
    c.text("AMOUNT IN WORDS", M + 7, y + 11, 5.6, { bold: true, colour: GREY, spacing: 1 });
    let wy = c.wrap(amountWords(doc.total_cents), M + 7, y + 22, bw - 14, 7.9, 10, { bold: true });
    wy = c.wrap("Prices are in Ringgit Malaysia and exclude SST. AZ ONE OFFICIAL is not registered for Sales & Service Tax; no service tax is charged on this document.",
      M + 7, wy + 4, bw - 14, 6.4, 8.4, { colour: GREY });

    const docDisc = doc.discount_cents ?? 0;
    const rows: [string, string, boolean][] = [["Gross", money(gross), false]];
    if (lineDisc) rows.push(["Less: line discounts", `- ${money(lineDisc)}`, false]);
    if (docDisc) rows.push(["Less: discount", `- ${money(docDisc)}`, false]);
    rows.push(["Subtotal", money(gross - lineDisc - docDisc), true]);
    if (doc.tax_percent) rows.push([`Tax (${doc.tax_percent}%)`, money(Math.round((gross - lineDisc - docDisc) * doc.tax_percent / 100)), false]);
    if (doc.delivery_cents) rows.push(["Delivery / postage", money(doc.delivery_cents), false]);
    let ty = y;
    for (const [k, v, bold] of rows) {
      if (bold) c.line(R - tw, ty, R, HAIR, 0.6);
      c.text(k, R - tw + 7, ty + 11, 8.25, { bold });
      c.text(v, R - 7, ty + 11, 8.25, { bold, align: "r" });
      ty += 15;
    }
    c.rect(R - tw, ty, tw, 20, NAVY);
    c.text("TOTAL (RM)", R - tw + 7, ty + 13.5, 9.75, { bold: true, colour: WHITE });
    c.text(money(doc.total_cents), R - 7, ty + 13.5, 9.75, { bold: true, colour: WHITE, align: "r" });
    const boxH = Math.max(wy - boxTop + 4, 30);
    c.box(M, boxTop, bw, boxH, NAVY, 0.6);
    y = Math.max(boxTop + boxH, ty + 20);
  }

  // closing block, pinned to the foot of the page
  const footY = PAGE_H - M - 22;
  const closeTop = footY - 134;   // 22 zone offset + 55 zone + 41 of signer lines + clearance
  const hdr = isINV ? "PAYMENT" : isDO ? "DELIVERY CONFIRMATION" : "COMMITMENT ORDER CONFIRMATION";
  c.line(M, closeTop, R, NAVY, 0.6);
  c.text(hdr, M + CW / 2, closeTop + 12, 8.25, { bold: true, align: "c", spacing: 0.5 });
  const clause = isINV
    ? "Payment by bank transfer to MAYBANK 5516 2328 7032 (AZ ONE OFFICIAL). Please send the transfer receipt via WhatsApp +60 12-383 4821 quoting the invoice number."
    : isDO
      ? "The goods listed above were delivered in the quantities stated. Please sign and return one copy as proof of receipt."
      : "We hereby accept the quoted items and agree that this signed document shall be deemed our official Purchase Order, subject to the terms above.";
  c.wrap(clause, M, closeTop + 72, 225, 7.5, 9.5, { colour: SLATE });
  if (isINV && doc.payment_status === "paid") {
    c.text(`OK PAID${doc.paid_at ? ` - ${dmy(doc.paid_at)}` : ""}`, M, closeTop + 112, 8.25, { bold: true, colour: GREEN });
  }

  // signature zones — identical height whether signed or blank, which is what
  // holds the two columns level (v1.4.243).
  const sigW = 126, gap = 9;
  const sig2X = R - sigW, sig1X = sig2X - gap - sigW;
  const zoneTop = closeTop + 22, zoneH = 55;
  for (const [x, label, l1, l2, l3, muted] of [
    [sig1X, isINV ? "AUTHORISED SIGNATURE" : isDO ? "DELIVERED BY" : "PREPARED BY",
      (doc.signer_name ?? "").toUpperCase(), doc.signer_position ?? "", "AZ ONE OFFICIAL", false],
    [sig2X, isINV ? "RECEIVED & ACKNOWLEDGED BY" : isDO ? "RECEIVED IN GOOD ORDER" : "ACCEPTED & CONFIRMED BY",
      "Name & designation", "Company chop", "Date", true],
  ] as [number, string, string, string, string, boolean][]) {
    c.line(x, zoneTop + zoneH, x + sigW, NAVY, 0.6);
    c.text(label, x + sigW / 2, zoneTop + zoneH + 10, 5.6, { colour: GREY, align: "c", spacing: 0.8 });
    const col = muted ? GREY : NAVY;
    c.text(l1, x + sigW / 2, zoneTop + zoneH + 21, 7.5, { bold: true, align: "c", colour: col });
    c.text(l2, x + sigW / 2, zoneTop + zoneH + 31, 7.5, { align: "c", colour: col });
    c.text(l3, x + sigW / 2, zoneTop + zoneH + 41, 6.4, { align: "c", colour: GREY });
  }
  if (hasSig) {
    // The image is placed INSIDE the reserved zone, so it can never push the rule.
    const iw = 105, ih = 48;
    c.ops.push(`q ${iw} 0 0 ${ih} ${(sig1X + (sigW - iw) / 2).toFixed(2)} ${(PAGE_H - zoneTop - zoneH).toFixed(2)} cm /Im0 Do Q`);
  }

  c.line(M, footY, R, HAIR, 0.6);
  c.text("AZ ONE OFFICIAL - Empowering Brands Through Live Commerce and Digital Connections - azoneofficial.com",
    M + CW / 2, footY + 9, 6, { colour: GREY, align: "c" });
  c.text("This is a computer-generated document; no signature is required unless indicated above.",
    M + CW / 2, footY + 17, 6, { colour: GREY, align: "c" });

  return c.ops.join("\n");
}

/** Build the shareable PDF. Never throws: a missing signature just prints a
    blank zone, exactly as the HTML template does. */
export async function buildDocPdf(doc: DocFull): Promise<Blob> {
  const role = doc.signer_role ?? (doc.created_by_role === "coo" ? "coo" : "ceo");
  const img = doc.signer_role === null ? null : await loadImage(`/signatures/${role}-sign.png`, "Im0");
  const content = drawDoc(doc, !!img);
  return new Blob([assemblePdf(content, img ? [img] : [], doc.doc_number) as BlobPart], { type: "application/pdf" });
}
