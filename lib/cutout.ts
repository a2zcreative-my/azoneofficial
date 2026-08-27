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

/** Matte the subject out of a photo. Returns a PNG blob with transparency,
    same pixel size as the input. */
export async function cutoutPhoto(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const W = bitmap.width, H = bitmap.height;

  /* The model's view: 320×320, normalised like its training data. */
  const small = document.createElement("canvas");
  small.width = SIZE; small.height = SIZE;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("no canvas");
  sctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;

  /* Match the reference preprocessing: scale by the image max, then
     mean/std — U²-Net's own transform. */
  let maxV = 1;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i]! > maxV) maxV = px[i]!;
    if (px[i + 1]! > maxV) maxV = px[i + 1]!;
    if (px[i + 2]! > maxV) maxV = px[i + 2]!;
  }
  const input = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  for (let i = 0; i < plane; i++) {
    input[i] = (px[i * 4]! / maxV - MEAN[0]!) / STD[0]!;
    input[plane + i] = (px[i * 4 + 1]! / maxV - MEAN[1]!) / STD[1]!;
    input[2 * plane + i] = (px[i * 4 + 2]! / maxV - MEAN[2]!) / STD[2]!;
  }

  const { ort, session } = await getSession();
  const feeds: Record<string, OrtNS.Tensor> = {
    [session.inputNames[0]!]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]),
  };
  const out = await session.run(feeds);
  const mask = out[session.outputNames[0]!]!.data as Float32Array;

  /* Min-max normalise, S-curve, into a 320×320 alpha canvas. */
  let lo = Infinity, hi = -Infinity;
  for (const v of mask) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = Math.max(hi - lo, 1e-6);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = SIZE; maskCanvas.height = SIZE;
  const mctx = maskCanvas.getContext("2d");
  if (!mctx) throw new Error("no canvas");
  const mimg = mctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < plane; i++) {
    let a = (mask[i]! - lo) / range;
    a = a < 0.35 ? a * a / 0.35 : a; // firm the cut below the subject, keep soft edges above
    const v = Math.max(0, Math.min(255, Math.round(a * 255)));
    mimg.data[i * 4] = 255; mimg.data[i * 4 + 1] = 255; mimg.data[i * 4 + 2] = 255;
    mimg.data[i * 4 + 3] = v;
  }
  mctx.putImageData(mimg, 0, 0);

  /* Full size: photo, then the smoothed mask as destination-in. */
  const outCanvas = document.createElement("canvas");
  outCanvas.width = W; outCanvas.height = H;
  const octx = outCanvas.getContext("2d");
  if (!octx) throw new Error("no canvas");
  octx.drawImage(bitmap, 0, 0);
  octx.globalCompositeOperation = "destination-in";
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.filter = "blur(1px)"; // feather the scaled-up mask edge one pixel
  octx.drawImage(maskCanvas, 0, 0, W, H);
  octx.filter = "none";

  const blob = await new Promise<Blob | null>((res) => outCanvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("no png");
  return blob;
}
