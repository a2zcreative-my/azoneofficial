/**
 * v1.4.76 — client-side image compression before every R2 upload, because
 * the bucket is on the free tier. Balanced, not brutal: longest side capped
 * at 1600px and JPEG quality 0.82 — plenty for staff photos, receipts and
 * site media, typically 5–15× smaller than a phone-camera original.
 *
 * Safety rails:
 *  - non-images (PDFs, videos, documents) pass through untouched
 *  - GIFs pass through (canvas would kill the animation)
 *  - any failure falls back to the original file
 *  - if the "compressed" result is somehow larger, the original wins
 */
export async function compressImage(file: File | Blob, maxDim = 1600, quality = 0.82): Promise<Blob> {
  const type = file.type ?? "";
  if (!/^image\//.test(type) || type === "image/gif" || type === "image/svg+xml") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  }
}
