/* v1.58.0 — cutting the studio background off a product photo, in the
 * browser, on the CEO's click.
 *
 * The CEO, on /catalog: "I still notice the photo of the Catalog no cut off
 * background, I just want the model only there!" His designer's catalog
 * shows cut-out models; the shop's product photos are studio shots. This
 * gives the ELFIA tab a "cut out background" button per photo (and one for
 * all of them): the model is matted out of the photo right here, previewed
 * by the person clicking, and saved through the SAME photo route as any
 * upload — so it reaches the shop like any photo change, and nothing
 * anywhere changes until he clicks.
 *
 * The machinery is vendored, not fetched: onnxruntime-web's wasm runtime
 * (/vendor/ort/) and the U²-Netp salient-object model (/vendor/u2netp.onnx,
 * 4.4 MB) ship with the portal. No third-party CDN at runtime — the same
 * rule as pdf.js.
 *
 * The matte: image → 320×320 → normalised RGB planes → U²-Netp → 320×320
 * saliency map → min-max normalised → scaled up with canvas smoothing →
 * alpha channel. A gentle S-curve on the alpha firms the subject and cleans
 * the halo without eating the hijab's soft edge.
 */

import type * as OrtNS from "onnxruntime-web";

const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise: Promise<{ ort: typeof OrtNS; session: OrtNS.InferenceSession }> | null = null;

/** Load the runtime + model once per page. ~5 s the first time, instant after. */
function getSession() {
  sessionPromise ??= (async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = "/vendor/ort/";
    /* One thread: the multi-threaded path needs cross-origin isolation
       headers the portal does not serve, and one thread mattes a photo in
       well under a second anyway. */
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create("/vendor/u2netp.onnx", {
      executionProviders: ["wasm"],
    });
    return { ort, session };
  })();
  return sessionPromise;
}

/** True when the image already has real transparency — cutting it again
    would only nibble at an already-cut photo. */
export function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4 * 97) { // sparse scan is plenty
    if (d[i]! < 250) return true;
  }
  return false;
}

/* v1.390.0 (the CEO, 19-11-2026: "when I remove background, the cut out was not really nice! it make the
   cutting area not nice"). The model is the same; what changed is everything around it:
     1. THE PHOTO KEEPS ITS SHAPE - it is padded to a square for the model, never squashed into one, so
        a tall portrait is not read as a squat one and the mask lines up with the person.
     2. TWO LOOKS - the photo and its mirror image are both read and the two masks averaged, which
        steadies the uncertain edges (a hijab against a pale wall, an arm against a sleeve).
     3. THE EDGE FOLLOWS THE PHOTO - the model's 320 px mask is refined against the full photo with an
        edge-preserving (guided) filter, then firmed with a smooth curve, so the outline snaps to the
        real edge of the hijab and clothes instead of a stretched, blurred blob.
     4. NO LEFTOVER SPECKS - only the person (the largest solid region, and anything touching it) is
        kept; stray bits of background the model half-believed in are dropped.
   The output is the same: a PNG with transparency, the same pixel size as the photo. */
const WORK = 1024; // the longest side the edge refinement works at (the photo is never enlarged)

/** one model pass on an image already drawn into a SIZE x SIZE canvas; returns SIZE x SIZE values */
async function runModel(sctx: CanvasRenderingContext2D): Promise<Float32Array> {
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  /* Match the reference preprocessing: scale by the image max, then mean/std - U2-Net's own transform. */
  let maxV = 1;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i]! > maxV) maxV = px[i]!;
    if (px[i + 1]! > maxV) maxV = px[i + 1]!;
    if (px[i + 2]! > maxV) maxV = px[i + 2]!;
  }
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = (px[i * 4]! / maxV - MEAN[0]!) / STD[0]!;
    input[plane + i] = (px[i * 4 + 1]! / maxV - MEAN[1]!) / STD[1]!;
    input[2 * plane + i] = (px[i * 4 + 2]! / maxV - MEAN[2]!) / STD[2]!;
  }
  const { ort, session } = await getSession();
  const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  return Float32Array.from(out[session.outputNames[0]!]!.data as Float32Array);
}

/** mean over a (2r+1) square window, by running sums - O(n) whatever the radius */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/** He, Sun and Tang's guided filter: smooths p while keeping the edges of the guide I */
function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i]! * p[i]!; II[i] = I[i]! * I[i]!; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i]! - mI[i]! * mp[i]!, v = mII[i]! - mI[i]! * mI[i]!;
    a[i] = cov / (v + eps); b[i] = mp[i]! - a[i]! * mI[i]!;
  }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i]! * I[i]! + mb[i]!;
  return q;
}

/** keep the person: the largest solid region, and soft edge pixels next to it */
function keepLargest(alpha: Float32Array, w: number, h: number): void {
  const n = w * h, label = new Int32Array(n).fill(-1);
  let best = -1, bestSize = 0, next = 0;
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || alpha[s]! < 0.5) continue;
    let top = 0, size = 0; stack[top++] = s; label[s] = next;
    while (top) {
      const i = stack[--top]!; size++;
      const x = i % w, y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && label[j] === -1 && alpha[j]! >= 0.5) { label[j] = next; stack[top++] = j; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
    next++;
  }
  if (best < 0) return;
  /* a pixel stays if it is in the person, or a soft pixel within a few pixels of it (the hijab's edge) */
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = label[i] === best ? 1 : 0;
  const reach = Math.max(2, Math.round(Math.max(w, h) / 200));
  const near = boxMean(Float32Array.from(keep), w, h, reach);
  for (let i = 0; i < n; i++) if (!keep[i] && (label[i] !== -1 || near[i]! === 0)) alpha[i] = 0;
}

/** Matte the subject out of a photo. Returns a PNG blob with transparency,
    same pixel size as the input. */
export async function cutoutPhoto(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const W = bitmap.width, H = bitmap.height;

  /* 1. the model's view: the photo padded (not squashed) into SIZE x SIZE, plus its mirror image */
  const sc = SIZE / Math.max(W, H);
  const dw = Math.max(1, Math.round(W * sc)), dh = Math.max(1, Math.round(H * sc));
  const ox = Math.floor((SIZE - dw) / 2), oy = Math.floor((SIZE - dh) / 2);
  const small = document.createElement("canvas");
  small.width = SIZE; small.height = SIZE;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("no canvas");
  /* the padding is the photo's own edge colour, stretched - a neutral border the model reads as background */
  sctx.fillStyle = "#808080"; sctx.fillRect(0, 0, SIZE, SIZE);
  sctx.drawImage(bitmap, 0, 0, W, 1, ox, 0, dw, oy);
  sctx.drawImage(bitmap, 0, H - 1, W, 1, ox, oy + dh, dw, SIZE - oy - dh);
  sctx.drawImage(bitmap, 0, 0, 1, H, 0, oy, ox, dh);
  sctx.drawImage(bitmap, W - 1, 0, 1, H, ox + dw, oy, SIZE - ox - dw, dh);
  sctx.drawImage(bitmap, ox, oy, dw, dh);
  const m1 = await runModel(sctx);
  /* the mirror image: the padded view (still in the canvas - the model only read it), flipped */
  const mirrorSrc = document.createElement("canvas");
  mirrorSrc.width = SIZE; mirrorSrc.height = SIZE;
  const mctx0 = mirrorSrc.getContext("2d", { willReadFrequently: true });
  if (!mctx0) throw new Error("no canvas");
  mctx0.translate(SIZE, 0); mctx0.scale(-1, 1);
  mctx0.drawImage(small, 0, 0);
  mctx0.setTransform(1, 0, 0, 1, 0, 0);
  const m2 = await runModel(mctx0);

  /* average the two looks (the mirror read back the right way round), only over the photo's own area */
  const raw = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const a = m1[(oy + y) * SIZE + ox + x]!, b = m2[(oy + y) * SIZE + (SIZE - 1 - (ox + x))]!;
    raw[y * dw + x] = (a + b) / 2;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = Math.max(hi - lo, 1e-6);
  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = dw; rawCanvas.height = dh;
  const rctx = rawCanvas.getContext("2d")!;
  const rimg = rctx.createImageData(dw, dh);
  for (let i = 0; i < raw.length; i++) {
    const v = Math.round(((raw[i]! - lo) / range) * 255);
    rimg.data[i * 4] = v; rimg.data[i * 4 + 1] = v; rimg.data[i * 4 + 2] = v; rimg.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);

  /* 3. refine at a working size against the photo itself */
  const ws = Math.min(1, WORK / Math.max(W, H));
  const ww = Math.max(1, Math.round(W * ws)), wh = Math.max(1, Math.round(H * ws));
  const work = document.createElement("canvas");
  work.width = ww; work.height = wh;
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  wctx.imageSmoothingEnabled = true; wctx.imageSmoothingQuality = "high";
  wctx.drawImage(bitmap, 0, 0, ww, wh);
  const photo = wctx.getImageData(0, 0, ww, wh).data;
  wctx.clearRect(0, 0, ww, wh);
  wctx.drawImage(rawCanvas, 0, 0, ww, wh);
  const up = wctx.getImageData(0, 0, ww, wh).data;
  const n = ww * wh;
  const guide = new Float32Array(n), p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    guide[i] = (0.299 * photo[i * 4]! + 0.587 * photo[i * 4 + 1]! + 0.114 * photo[i * 4 + 2]!) / 255;
    p[i] = up[i * 4]! / 255;
  }
  const r = Math.max(2, Math.round(Math.max(ww, wh) / 110));
  const q = guidedFilter(guide, p, ww, wh, r, 1e-3);
  /* firm it: below 0.12 is background, above 0.42 is the person (the old cut kept 0.35 up solid), a smooth ramp between keeps a soft edge.
     The photo only redraws the BORDER: where the model is sure (a dark helmet on a dark ground),
     its own answer stands, so a dark part of the person is never cut out with the background. */
  const ramp = (v: number) => { const t = Math.min(1, Math.max(0, (v - 0.12) / 0.3)); return t * t * (3 - 2 * t); };
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sure = Math.min(1, Math.max(0, (Math.abs(p[i]! - 0.5) * 2 - 0.6) / 0.35));
    alpha[i] = ramp(q[i]!) * (1 - sure) + ramp(p[i]!) * sure;
  }
  /* 4. only the person */
  keepLargest(alpha, ww, wh);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = ww; maskCanvas.height = wh;
  const mctx = maskCanvas.getContext("2d")!;
  const mimg = mctx.createImageData(ww, wh);
  for (let i = 0; i < n; i++) {
    mimg.data[i * 4] = 255; mimg.data[i * 4 + 1] = 255; mimg.data[i * 4 + 2] = 255;
    mimg.data[i * 4 + 3] = Math.round(alpha[i]! * 255);
  }
  mctx.putImageData(mimg, 0, 0);

  /* Full size: photo, then the refined mask as destination-in. */
  const outCanvas = document.createElement("canvas");
  outCanvas.width = W; outCanvas.height = H;
  const octx = outCanvas.getContext("2d");
  if (!octx) throw new Error("no canvas");
  octx.drawImage(bitmap, 0, 0);
  octx.globalCompositeOperation = "destination-in";
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(maskCanvas, 0, 0, W, H);

  const blob = await new Promise<Blob | null>((res) => outCanvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("no png");
  return blob;
}
