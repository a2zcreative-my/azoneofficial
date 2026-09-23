/* tests/upload-stream.mjs - v1.181.4: AN UPLOAD REACHES R2, INSIDE WORKERD.
 *
 * The CEO, 23-09-2026, on Claims: "When I add attachments it doesn't
 * uploaded into the R2". It didn't. v1.177.2 wrapped every R2 upload in
 * putGuarded(), which counts the bytes and sniffs the opening through a
 * TransformStream - and a piped stream has no length. R2's put() refuses a
 * stream it cannot measure:
 *
 *     TypeError: Provided readable stream must have a known length
 *     (request/response body or readable half of FixedLengthStream)
 *
 * putGuarded caught that and answered 500 "could not be stored", on every
 * claim receipt, payment proof, staff photo, document, logo and media upload.
 * Every other guard READ worker/src/shared.ts and approved of it. Only the
 * real runtime knows what put() accepts, so this guard runs putGuarded() in
 * the real runtime: wrangler's local workerd, a local R2 bucket, real
 * requests.
 *
 *   1. a PNG with its length stored whole, byte for byte;
 *   2. a PDF likewise (the payment-proof and receipt type);
 *   3. text sent as image/png is refused 400 content_mismatch, and NOTHING
 *      is left in the bucket;
 *   4. a declared length over the cap is refused 413 before a byte is read;
 *   5. a body that DOESN'T declare its length, over the cap, is refused 413
 *      by the counting stream;
 *   6. the same, under the cap, is stored (the buffered path).
 *
 * It needs worker/node_modules (run-guards installs it for the compile gate,
 * which runs first). If workerd cannot start at all the guard FAILS - a
 * guard that skips itself when the runtime is missing is how this shipped.
 */

import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
/* A BUNDLED specifier: esbuild reads it, so forward slashes on Windows. */
const importPath = (p) => p.replace(/\\/g, "/");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

const workerDir = join(root, "worker");
if (!existsSync(join(workerDir, "node_modules", "wrangler"))) {
  console.log("  ✗ worker/node_modules/wrangler is missing - this guard runs putGuarded inside workerd and cannot be skipped");
  process.exit(1);
}
process.env.WRANGLER_SEND_METRICS = "false";
const requireW = createRequire(join(workerDir, "package.json"));
const { unstable_dev } = requireW("wrangler");

const dir = mkdtempSync(join(tmpdir(), "upload-stream-"));
const entry = join(dir, "entry.ts");
writeFileSync(entry, `
import { putGuarded } from "${importPath(join(workerDir, "src", "shared.ts"))}";
export default {
  async fetch(request: Request, env: { MEDIA: R2Bucket }): Promise<Response> {
    const u = new URL(request.url);
    const key = "t/" + u.searchParams.get("key");
    /* ?synthetic=N: a body of N bytes built HERE, as a stream, so it has no
       length - the buffered path. Built inside the worker so the test does
       not depend on how the local proxy forwards a chunked upload. */
    const n = Number(u.searchParams.get("synthetic") ?? 0);
    if (n > 0) {
      const bytes = new Uint8Array(n);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      for (let i = 8; i < n; i++) bytes[i] = (i * 31) & 0xff;
      const body = new ReadableStream<Uint8Array>({
        start(c) { for (let i = 0; i < n; i += 16384) c.enqueue(bytes.slice(i, i + 16384)); c.close(); },
      });
      request = new Request(request.url, { method: "POST", headers: { "content-type": "image/png" }, body });
    }
    const refused = await putGuarded(env.MEDIA, key, request, {
      max: Number(u.searchParams.get("max")),
      contentType: request.headers.get("content-type") ?? "",
    });
    const obj = await env.MEDIA.get(key);
    const bytes = obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    let sum = 0;
    if (bytes) for (const b of bytes) sum = (sum + b) % 65521;
    return Response.json({
      status: refused ? refused.status : 200,
      error: refused ? await refused.json() : null,
      stored: bytes ? bytes.byteLength : null,
      sum,
    });
  },
};
`);
writeFileSync(join(dir, "wrangler.toml"), `name = "upload-stream-guard"
main = "entry.ts"
compatibility_date = "2025-01-01"
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "upload-stream-guard"
`);

const png = new Uint8Array(300_000);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (let i = 8; i < png.length; i++) png[i] = (i * 31) & 0xff;
const pdf = new TextEncoder().encode("%PDF-1.4\n" + "x".repeat(50_000) + "\n%%EOF\n");
const sumOf = (a) => { let s = 0; for (const b of a) s = (s + b) % 65521; return s; };

/* Windows can hold the temp folder for a moment after workerd exits; a
   folder left in %TEMP% is not a reason to fail a release. */
const tidy = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the OS will */ } };

let worker;
try {
  worker = await unstable_dev(entry, {
    config: join(dir, "wrangler.toml"),
    local: true,
    persist: false,
    logLevel: process.env.UPLOAD_GUARD_LOG ?? "error",
    experimental: { disableExperimentalWarning: true, testMode: true },
  });
} catch (e) {
  console.log(`  ✗ workerd did not start: ${e instanceof Error ? e.message : String(e)}`);
  tidy();
  process.exit(1);
}

const send = async (key, body, type, max, extra = {}) => {
  const r = await worker.fetch(`/?key=${key}&max=${max}`, { method: "POST", headers: { "content-type": type }, body, ...extra });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { status: r.status, raw: text.slice(0, 300) }; }
};

try {
  const a = await send("png", png, "image/png", 5 * 1024 * 1024);
  ok("1. a PNG with a declared length is stored", a.status === 200 && a.stored === png.length, JSON.stringify(a.error ?? a));
  ok("1. ...byte for byte", a.sum === sumOf(png));

  const b = await send("pdf", pdf, "application/pdf", 8 * 1024 * 1024);
  ok("2. a PDF (receipt / payment proof) is stored", b.status === 200 && b.stored === pdf.length, JSON.stringify(b.error ?? b));

  const c = await send("liar", new TextEncoder().encode("this is not a png, it only says it is"), "image/png", 5 * 1024 * 1024);
  ok("3. text sent as image/png is refused 400", c.status === 400 && c.error?.error?.code === "content_mismatch", JSON.stringify(c));
  ok("3. ...and nothing is left in the bucket", c.stored === null);


  const e = await send("stream-big&synthetic=300000", new Uint8Array(0), "image/png", 100_000);
  ok("5. an unmeasured body over the cap is refused 413", e.status === 413 && e.stored === null, JSON.stringify(e));

  const f = await send("stream-ok&synthetic=300000", new Uint8Array(0), "image/png", 5 * 1024 * 1024);
  ok("6. an unmeasured body under the cap is stored", f.status === 200 && f.stored === png.length && f.sum === sumOf(png), JSON.stringify(f.error ?? f));

  /* LAST, on purpose: this refusal answers before reading the 300 KB body,
     which is the point of it. Cloudflare copes; the local dev proxy keeps the
     connection and the NEXT request dies on the unread bytes ("Network
     connection lost"). Nothing may follow it. */
  const d = await send("big", png, "image/png", 100_000);
  ok("4. a declared length over the cap is refused 413", d.status === 413 && d.stored === null, JSON.stringify(d));
} finally {
  await worker.stop();
  tidy();
}

/* exitCode, not exit(): the house rule since v1.148.1 (Node on Windows can
   abort mid-teardown on a hard exit). run-guards gives every guard 120 s,
   so a handle wrangler forgot to close becomes a named failure, not a hang. */
if (failed) {
  console.log(`\nupload-stream: ${failed} failed, ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`upload-stream: ${passed} checks passed - putGuarded stores, counts and sniffs inside workerd.`);
}
