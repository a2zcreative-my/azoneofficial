/* v1.393.0 - THE ONE READING OF AN UPLOADED CARD PAGE (Digital Cards Stage 4, the CEO 21-11-2026).
 *
 * The server checks every page with this file, and the portal checks the same file the same way
 * before it uploads (only so the designer hears at once - the server's answer is the one that
 * counts). No dependency, no decoding: the type comes from the file's own first bytes (the
 * extension and the browser's claim are ignored) and the size from its header - a PNG's IHDR,
 * a JPEG's start-of-frame marker.
 *
 *   readImageHeader(bytes)          -> { mime, width, height, components } | { error }
 *   pageFileProblems(header, size, format)  -> the reasons this file cannot be the page
 *
 * A CMYK JPEG (4 colour components) is refused: screens are RGB, and its colours would shift.
 * Digital cards are for screens, so DPI is never read or required (D9).
 */

export type ImageMime = "image/png" | "image/jpeg";
export interface ImageHeader { mime: ImageMime; width: number; height: number; components: number }
export type HeaderResult = ImageHeader | { error: "not_image" | "unreadable" };

const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;

export function readImageHeader(bytes: Uint8Array): HeaderResult {
  /* PNG: the 8-byte signature, then the IHDR chunk - width and height, big-endian */
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    if (bytes.length < 26 || String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== "IHDR") return { error: "unreadable" };
    const colour = bytes[25]!; // 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA
    return { mime: "image/png", width: u32(bytes, 16), height: u32(bytes, 20), components: colour === 6 ? 4 : colour === 4 ? 2 : colour === 0 ? 1 : 3 };
  }
  /* JPEG: SOI, then markers until a start-of-frame (SOF0-SOF15 but DHT C4, JPG C8 and DAC CC) */
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) return { error: "unreadable" };
      const marker = bytes[i + 1]!;
      if (marker === 0xff) { i += 1; continue; } // fill byte
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; } // no length
      if (marker === 0xd9 || marker === 0xda) return { error: "unreadable" }; // end, or scan before any frame
      const len = u16(bytes, i + 2);
      if (len < 2) return { error: "unreadable" };
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 9 >= bytes.length) return { error: "unreadable" };
        return { mime: "image/jpeg", height: u16(bytes, i + 5), width: u16(bytes, i + 7), components: bytes[i + 9]! };
      }
      i += 2 + len;
    }
    return { error: "unreadable" };
  }
  return { error: "not_image" };
}

/** what a page file must be, from the card format (lib/card-rules.ts CardFormat's fields) */
export interface PageFormat { width_px: number; height_px: number; accepted_types: string[]; max_bytes: number }

/** the reasons a file cannot be this page - empty when it can. `bytes` is the file's real length. */
export function pageFileProblems(h: HeaderResult, bytes: number, f: PageFormat, lang: "en" | "ms" = "en"): string[] {
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);
  const out: string[] = [];
  if ("error" in h) {
    out.push(h.error === "not_image"
      ? L("This file is not a PNG or JPG image.", "Fail ini bukan imej PNG atau JPG.")
      : L("This image could not be read - save it again as PNG or JPG.", "Imej ini tidak dapat dibaca - simpan semula sebagai PNG atau JPG."));
    return out;
  }
  if (!f.accepted_types.includes(h.mime)) out.push(L(`${h.mime === "image/png" ? "PNG" : "JPG"} files are not accepted for this format.`, `Fail ${h.mime === "image/png" ? "PNG" : "JPG"} tidak diterima untuk format ini.`));
  if (h.width !== f.width_px || h.height !== f.height_px) {
    out.push(L(`The image is ${h.width} × ${h.height} px - it must be exactly ${f.width_px} × ${f.height_px} px.`, `Imej ini ${h.width} × ${h.height} px - ia mesti tepat ${f.width_px} × ${f.height_px} px.`));
  }
  if (h.mime === "image/jpeg" && h.components === 4) out.push(L("This JPG is CMYK (for print). Save it as RGB.", "JPG ini CMYK (untuk cetakan). Simpan sebagai RGB."));
  if (bytes > f.max_bytes) out.push(L(`The file is ${(bytes / 1048576).toFixed(1)} MB - the limit is ${Math.round(f.max_bytes / 1048576)} MB.`, `Fail ini ${(bytes / 1048576).toFixed(1)} MB - hadnya ${Math.round(f.max_bytes / 1048576)} MB.`));
  if (bytes <= 0) out.push(L("The file is empty.", "Fail ini kosong."));
  return out;
}
