/* v1.4.203 — fill the official Maybank2E RCGEN2 template (.xlsm) inside the
   Worker, so 💳 downloads a ready-to-upload workbook with the Home sheet +
   salary rows already in place.

   An .xlsm is a ZIP of XML parts plus vbaProject.bin. We never touch the VBA:
   we unzip, patch two worksheet XMLs (Home + "Salary Bulk Payment (MY)") with
   inline-string / numeric cells, and rezip. Entries are re-stored UNCOMPRESSED
   (method 0) — a perfectly valid ZIP that Excel opens happily — so the writer
   needs no deflate. Reading uses DecompressionStream("deflate-raw"), which
   Cloudflare Workers support natively. Inline strings also preserve leading
   zeros (value dates like 05012027, IC numbers) that Excel paste would eat. */

export interface M2eHome {
  corporateId: string;
  clientBatchId: string;
  payerAccount: string;
  valueDate: string; // DDMMYYYY
}

export interface M2eRow {
  mode: string;        // A  IT | IG
  valueDate: string;   // B  DDMMYYYY
  name: string;        // C  ≤40
  faveCode: string;    // D  Favourite Recipient Code ("" to skip)
  amount: number;      // E  RM
  account: string;     // F  digits
  bankCode: string;    // G  e.g. MBBEMYKL
  newIc: string;       // J  digits ("" to skip)
  ownRef: string;      // N
  recipientDesc: string; // O
  payerDesc: string;   // Q
}

/* ---------- minimal ZIP ---------- */

interface ZipEntry { name: string; data: Uint8Array }

const td = new TextDecoder();
const te = new TextEncoder();

function u16(b: Uint8Array, o: number): number { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number): number { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  // Find End Of Central Directory (scan back for PK\x05\x06)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip (EOCD missing)");
  const count = u16(bytes, eocd + 10);
  let off = u32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(bytes, off) !== 0x02014b50) throw new Error("bad central directory");
    const method = u16(bytes, off + 10);
    const csize = u32(bytes, off + 20);
    const nameLen = u16(bytes, off + 28);
    const extraLen = u16(bytes, off + 30);
    const commentLen = u16(bytes, off + 32);
    const lho = u32(bytes, off + 42);
    const name = td.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    // local header: its own name/extra lengths locate the data start
    const lnl = u16(bytes, lho + 26);
    const lel = u16(bytes, lho + 28);
    const dataStart = lho + 30 + lnl + lel;
    const raw = bytes.subarray(dataStart, dataStart + csize);
    const data = method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : (() => { throw new Error(`zip method ${method}`); })();
    entries.push({ name, data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameB = te.encode(e.name);
    const crc = crc32(e.data);
    const lh = new Uint8Array(30 + nameB.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);          // version needed
    dv.setUint16(6, 0, true);           // flags
    dv.setUint16(8, 0, true);           // method 0 = store
    dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); // time/date (fixed)
    dv.setUint32(14, crc, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.data.length, true);
    dv.setUint16(26, nameB.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    chunks.push(lh, e.data);
    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);
    offset += lh.length + e.data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { chunks.push(c); cdSize += c.length; }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  chunks.push(eocd);
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/* ---------- worksheet XML patching ---------- */

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type CellVal = { col: string; text?: string; num?: number };

function cellXml(col: string, row: number, v: CellVal, keepStyle?: string): string {
  const s = keepStyle ? ` s="${keepStyle}"` : "";
  if (v.num !== undefined) return `<c r="${col}${row}"${s}><v>${v.num}</v></c>`;
  return `<c r="${col}${row}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v.text ?? "")}</t></is></c>`;
}

const COL_ORD = (c: string): number => {
  let n = 0;
  for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

/** Set cells in one worksheet XML. cells: row -> CellVal[] (cols unique). */
export function patchSheetXml(xml: string, cells: Map<number, CellVal[]>): string {
  for (const [row, vals] of cells) {
    const rowRe = new RegExp(`<row r="${row}"(?:[^>]*)>([\\s\\S]*?)</row>|<row r="${row}"(?:[^>]*)/>`);
    const m = xml.match(rowRe);
    if (m) {
      let inner = m[1] ?? "";
      for (const v of vals) {
        // replace existing cell (self-closing or full), keep its style
        const cellRe = new RegExp(`<c r="${v.col}${row}"([^>]*?)/>|<c r="${v.col}${row}"([^>]*?)>[\\s\\S]*?</c>`);
        const cm = inner.match(cellRe);
        const styleM = cm ? (cm[1] ?? cm[2] ?? "").match(/\bs="(\d+)"/) : null;
        const nc = cellXml(v.col, row, v, styleM?.[1]);
        if (cm) inner = inner.replace(cellRe, nc);
        else {
          // insert in column order
          const cellsIn = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)];
          let inserted = false;
          for (const ci of cellsIn) {
            if (COL_ORD(ci[1]) > COL_ORD(v.col)) {
              inner = inner.slice(0, ci.index!) + nc + inner.slice(ci.index!);
              inserted = true;
              break;
            }
          }
          if (!inserted) inner += nc;
        }
      }
      const openTag = m[0].startsWith("<row") ? m[0].match(/^<row[^>]*?(\/?)>/)![0].replace(/\/>$/, ">") : `<row r="${row}">`;
      xml = xml.replace(rowRe, `${openTag}${inner}</row>`);
    } else {
      // create the row, inserted before the first row with a larger r (or </sheetData>)
      const nc = vals
        .slice()
        .sort((a, b) => COL_ORD(a.col) - COL_ORD(b.col))
        .map((v) => cellXml(v.col, row, v))
        .join("");
      const newRow = `<row r="${row}">${nc}</row>`;
      const rows = [...xml.matchAll(/<row r="(\d+)"/g)];
      const after = rows.find((r) => parseInt(r[1], 10) > row);
      if (after) xml = xml.slice(0, after.index!) + newRow + xml.slice(after.index!);
      else xml = xml.replace("</sheetData>", `${newRow}</sheetData>`);
    }
  }
  return xml;
}

/** Map sheet display names -> entry path (xl/worksheets/sheetN.xml). */
function sheetPaths(entries: ZipEntry[]): Map<string, string> {
  const get = (n: string) => entries.find((e) => e.name === n);
  const wb = td.decode(get("xl/workbook.xml")!.data);
  const rels = td.decode(get("xl/_rels/workbook.xml.rels")!.data);
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) relMap.set(m[1], m[2]);
  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const target = relMap.get(m[2]);
    if (target) out.set(m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"'), target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  return out;
}

export async function fillM2eTemplate(template: Uint8Array, home: M2eHome, rows: M2eRow[]): Promise<Uint8Array> {
  const entries = await unzip(template);
  const paths = sheetPaths(entries);
  const homePath = paths.get("Home");
  const salPath = paths.get("Salary Bulk Payment (MY)");
  if (!homePath || !salPath) throw new Error("template sheets not found (Home / Salary Bulk Payment (MY))");

  const homeEntry = entries.find((e) => e.name === homePath)!;
  const homeCells = new Map<number, CellVal[]>([
    [5, [{ col: "E", text: home.corporateId }]],
    [6, [{ col: "E", text: home.clientBatchId }]],
    [7, [{ col: "E", text: home.payerAccount }]],
    [8, [{ col: "E", text: home.valueDate }]],
  ]);
  homeEntry.data = te.encode(patchSheetXml(td.decode(homeEntry.data), homeCells));

  const salEntry = entries.find((e) => e.name === salPath)!;
  const salCells = new Map<number, CellVal[]>();
  rows.forEach((r, i) => {
    const rn = 5 + i;
    const vals: CellVal[] = [
      { col: "A", text: r.mode },
      { col: "B", text: r.valueDate },
      { col: "C", text: r.name },
      { col: "E", num: Math.round(r.amount * 100) / 100 },
      { col: "F", text: r.account },
      { col: "G", text: r.bankCode },
      { col: "N", text: r.ownRef },
      { col: "O", text: r.recipientDesc },
      { col: "Q", text: r.payerDesc },
    ];
    if (r.faveCode) vals.push({ col: "D", text: r.faveCode });
    if (r.newIc) vals.push({ col: "J", text: r.newIc });
    salCells.set(rn, vals);
  });
  salEntry.data = te.encode(patchSheetXml(td.decode(salEntry.data), salCells));

  return zipStore(entries);
}
